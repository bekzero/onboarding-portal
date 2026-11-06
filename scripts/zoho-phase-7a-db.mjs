import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { Pool } from "pg";
import { getPhase7aTarget, safeTargetSummary } from "./zoho-phase-7a-safety.mjs";

const mode = process.argv[2] ?? "preflight";
const allowedModes = new Set(["config", "initialize", "preflight", "rehearse", "verify"]);
if (!allowedModes.has(mode)) throw new Error(`Unknown Phase 7A mode: ${mode}`);

const ZOHO_MIGRATIONS = [
  "20261104150000_add_zoho_phase_1a_foundation",
  "20261104210000_add_zoho_phase_4_dispatcher",
  "20261105120000_add_zoho_phase_5_nudge_engine"
];
const REPOSITORY_MIGRATIONS = [
  "20260617185715_init",
  "20260617194303_add_admin_reporting_fields",
  "20260617194747_add_onboarding_plan_reporting_fields",
  "20260619110000_add_first_customer_pilot_fields",
  "20260625143000_add_admin_notifications",
  "20260703120000_add_msp_enrollment_date",
  "20260713120000_add_msp_gmm_partner_flag",
  "20260715120000_add_customer_name_to_onboarding_plan",
  "20260715153000_add_document_storage_fields",
  ...ZOHO_MIGRATIONS
];
const BASELINE_LAST_MIGRATION = "20260715153000_add_document_storage_fields";

const protectedTables = {
  msps: ['id','name','slug','primaryContactEmail','assignedSalesEngineer','accessMode','enrollmentDate','isGmmPartner','createdAt','updatedAt'],
  onboarding_plans: ['id','mspId','planId','title','tenantType','customerName','progress','currentStage','status','lastActivityAt','submittedAppCount','firstCustomerAlias','firstCustomerEstimatedUserCount','firstCustomerTargetRolloutTiming','firstCustomerAdminContactName','firstCustomerAdminContactEmail','firstCustomerNotes','createdAt','updatedAt'],
  onboarding_tasks: ['id','onboardingPlanId','title','description','status','owner','order','dueLabel','createdAt','updatedAt'],
  saas_app_submissions: ['id','onboardingPlanId','appName','loginUrl','priority','notes','status','createdAt','updatedAt'],
  documents: ['id','onboardingPlanId','fileName','mimeType','fileSize','storageUrl','storageKey','uploadedBy','uploadedByRole','status','createdAt','updatedAt'],
  oidc_configs: ['id','mspId','tenantRealm','clientId','encryptedClientSecret','secretIv','secretAuthTag','issuerUrl','redirectUri','configuredAt'],
  admin_notifications: ['id','mspId','planId','taskId','type','mspName','taskTitle','stage','isRead','readAt','createdAt','updatedAt']
};

function quote(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

async function snapshot(pool) {
  const result = {};
  for (const [table, columns] of Object.entries(protectedTables)) {
    const selected = columns.map(quote).join(', ');
    const rows = (await pool.query(`SELECT ${selected} FROM ${quote(table)} ORDER BY "id"`)).rows;
    result[table] = {
      count: rows.length,
      digest: createHash('sha256').update(JSON.stringify(canonical(rows))).digest('hex')
    };
  }
  return result;
}

function compareSnapshots(before, after) {
  const differences = [];
  for (const table of Object.keys(protectedTables)) {
    if (before[table].count !== after[table].count || before[table].digest !== after[table].digest) {
      differences.push({ table, beforeCount: before[table].count, afterCount: after[table].count });
    }
  }
  return differences;
}

async function inspect(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const identity = await client.query('SELECT current_database() AS database, current_schema() AS schema');
    const migrationTable = await client.query(`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS exists`);
    const tables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const tableStates = [];
    for (const row of tables.rows) {
      const tableName = row.table_name;
      const hasRows = await client.query(`SELECT EXISTS (SELECT 1 FROM ${quote(tableName)} LIMIT 1) AS "hasRows"`);
      tableStates.push({ name: tableName, hasRows: hasRows.rows[0].hasRows });
    }
    const migrations = migrationTable.rows[0].exists
      ? await client.query(`
          SELECT migration_name, finished_at, rolled_back_at
          FROM "_prisma_migrations"
          ORDER BY started_at, migration_name
        `)
      : { rows: [] };
    await client.query('COMMIT');
    const applied = migrations.rows.filter((row) => row.finished_at && !row.rolled_back_at).map((row) => row.migration_name);
    const failed = migrations.rows.filter((row) => !row.finished_at && !row.rolled_back_at).map((row) => row.migration_name);
    return {
      identity: identity.rows[0],
      migrationTableExists: migrationTable.rows[0].exists,
      migrationHistory: migrations.rows.map((row) => ({
        migrationName: row.migration_name,
        applied: Boolean(row.finished_at && !row.rolled_back_at),
        failed: Boolean(!row.finished_at && !row.rolled_back_at),
        rolledBack: Boolean(row.rolled_back_at)
      })),
      tables: tableStates,
      applied,
      failed
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function assertBaseline(info, expectedState) {
  if (info.failed.length) throw new Error(`Database has ${info.failed.length} unfinished migration(s).`);
  if (!info.applied.includes(BASELINE_LAST_MIGRATION)) throw new Error(`Required baseline migration ${BASELINE_LAST_MIGRATION} is not applied.`);
  const present = ZOHO_MIGRATIONS.filter((migration) => info.applied.includes(migration));
  if (expectedState === 'before') {
    if (present.length) throw new Error(`Rehearsal target already has ${present.length} Zoho migration(s); restore a fresh baseline snapshot.`);
    if (info.applied.at(-1) !== BASELINE_LAST_MIGRATION) throw new Error('The restored database has unexpected migrations after the approved baseline.');
  }
  if (expectedState === 'after') {
    if (present.length !== ZOHO_MIGRATIONS.length) throw new Error(`Expected all ${ZOHO_MIGRATIONS.length} Zoho migrations, found ${present.length}.`);
    if (JSON.stringify(info.applied.slice(-ZOHO_MIGRATIONS.length)) !== JSON.stringify(ZOHO_MIGRATIONS)) {
      throw new Error('Zoho migrations were not applied in the approved dependency order.');
    }
    if (JSON.stringify(info.applied) !== JSON.stringify(REPOSITORY_MIGRATIONS)) {
      throw new Error(`Expected exactly ${REPOSITORY_MIGRATIONS.length} successful repository migrations in dependency order.`);
    }
  }
}

function run(command, args, env, allowedStatuses = [0]) {
  const executable = process.platform === 'win32' && command === 'npx' ? 'npx.cmd' : command;
  const result = spawnSync(executable, args, { env, shell: false, stdio: 'inherit' });
  if (!allowedStatuses.includes(result.status)) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
  return result.status;
}

const target = getPhase7aTarget({
  requireBackup: mode === 'rehearse',
  requireEmptyInitialization: mode === 'initialize'
});
console.log(JSON.stringify({ phase: '7A', mode, target: safeTargetSummary(target) }, null, 2));

if (mode === 'config') {
  console.log(JSON.stringify({ connected: false, configurationValid: true }, null, 2));
  process.exit(0);
}

let pool = new Pool({ connectionString: target.connectionString, max: 4 });
let directPool = ['initialize', 'preflight'].includes(mode)
  ? new Pool({ connectionString: target.directConnectionString, max: 1 })
  : null;
try {
  const beforeInfo = await inspect(pool);
  if (beforeInfo.identity.database !== target.databaseName) throw new Error('Connected database identity does not match the isolated target URL.');

  if (mode === 'preflight' || mode === 'initialize') {
    const directInfo = await inspect(directPool);
    if (
      directInfo.identity.database !== beforeInfo.identity.database ||
      directInfo.identity.schema !== beforeInfo.identity.schema
    ) {
      throw new Error('Pooled and direct URLs did not resolve to the same database and schema.');
    }
    if (JSON.stringify(directInfo.migrationHistory) !== JSON.stringify(beforeInfo.migrationHistory)) {
      throw new Error('Pooled and direct URLs returned different Prisma migration histories.');
    }
    if (JSON.stringify(directInfo.tables) !== JSON.stringify(beforeInfo.tables)) {
      throw new Error('Pooled and direct URLs returned different table inventories.');
    }
    if (mode === 'initialize') {
      if (beforeInfo.tables.length || beforeInfo.migrationTableExists || beforeInfo.migrationHistory.length) {
        throw new Error('Empty-database initialization refused because the target schema or migration history is not empty.');
      }
      await pool.end();
      pool = null;
      await directPool.end();
      directPool = null;
      run('npx', ['prisma', 'migrate', 'deploy'], {
        ...process.env,
        DATABASE_URL: target.directConnectionString
      });
      pool = new Pool({ connectionString: target.connectionString, max: 4 });
      const initialized = await inspect(pool);
      assertBaseline(initialized, 'after');
      console.log(JSON.stringify({
        initialized: true,
        appliedMigrationCount: initialized.applied.length,
        finalMigration: initialized.applied.at(-1)
      }, null, 2));
      process.exitCode = 0;
    } else {
      const zohoApplied = ZOHO_MIGRATIONS.filter((migration) => beforeInfo.applied.includes(migration));
    const applicationTables = beforeInfo.tables.filter((table) => table.name !== '_prisma_migrations');
    console.log(JSON.stringify({
      identity: {
        database: beforeInfo.identity.database,
        schema: beforeInfo.identity.schema,
        pooledAndDirectAgree: true,
        pooledFingerprint: target.databaseFingerprint,
        directFingerprint: target.directDatabaseFingerprint
      },
      migrationTableExists: beforeInfo.migrationTableExists,
      migrationHistory: beforeInfo.migrationHistory,
      applicationTables,
      applicationTableCount: applicationTables.length,
      schemaEmpty: beforeInfo.tables.length === 0,
      applicationDataEmpty: applicationTables.every((table) => !table.hasRows),
      appliedMigrationCount: beforeInfo.applied.length,
      failedMigrationCount: beforeInfo.failed.length,
      repositoryMigrationHistoryMatches: JSON.stringify(beforeInfo.applied) === JSON.stringify(REPOSITORY_MIGRATIONS),
      baselinePresent: beforeInfo.applied.includes(BASELINE_LAST_MIGRATION),
      zohoMigrationsApplied: zohoApplied
    }, null, 2));
    process.exitCode = 0;
    }
  } else if (mode === 'verify') {
    assertBaseline(beforeInfo, 'after');
    run('node', ['scripts/verify-zoho-phase-1a.mjs'], {
      ...process.env,
      DATABASE_URL: target.connectionString,
      NODE_ENV: 'test',
      VERCEL_ENV: 'test',
      ZOHO_FOUNDATION_VERIFY_READ_ONLY: '1'
    }, [0, 2]);
    run('node', ['--test', 'tests/zoho-phase-7a-db.test.mjs'], process.env);
  } else {
    assertBaseline(beforeInfo, 'before');
    const before = await snapshot(pool);
    await pool.end();
    pool = null;
    const startedAt = Date.now();
    run('npx', ['prisma', 'migrate', 'deploy'], { ...process.env, DATABASE_URL: target.directConnectionString });
    const migrationDurationMs = Date.now() - startedAt;
    pool = new Pool({ connectionString: target.connectionString, max: 4 });
    const afterInfo = await inspect(pool);
    assertBaseline(afterInfo, 'after');
    const after = await snapshot(pool);
    const differences = compareSnapshots(before, after);
    console.log(JSON.stringify({ migrationDurationMs, protectedStateDifferences: differences, protectedTableCounts: Object.fromEntries(Object.entries(after).map(([table, value]) => [table, value.count])) }, null, 2));
    if (differences.length) throw new Error('Protected pre/post migration state differs. Stop and investigate; do not continue toward production.');
    run('node', ['scripts/verify-zoho-phase-1a.mjs'], {
      ...process.env,
      DATABASE_URL: target.connectionString,
      NODE_ENV: 'test',
      VERCEL_ENV: 'test',
      ZOHO_FOUNDATION_VERIFY_READ_ONLY: '1'
    }, [0, 2]);
    run('node', ['--test', 'tests/zoho-phase-7a-db.test.mjs'], process.env);
  }
} finally {
  if (directPool) await directPool.end();
  if (pool) await pool.end();
}
