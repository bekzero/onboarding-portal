import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { Pool } from "pg";
import {
  getPhase7aTarget,
  REHEARSAL_ISOLATION_CONFIRMATION,
  REHEARSAL_RESOURCE_NAME,
  safeTargetSummary
} from "./zoho-phase-7a-safety.mjs";
import {
  BASELINE_MIGRATIONS,
  classifyExactMigrationHistory,
  CURRENT_MIGRATIONS,
  HISTORICAL_TEST_MIGRATIONS,
  REHEARSAL_PENDING_MIGRATIONS,
  assertExactMigrationHistory
} from "./zoho-phase-7a-migrations.mjs";

const mode = process.argv[2] ?? "preflight";
const targetProfile = process.argv[3] ?? "test";
const allowedModes = new Set(["config", "initialize", "preflight", "rehearse", "verify"]);
if (!allowedModes.has(mode)) throw new Error(`Unknown Phase 7A mode: ${mode}`);
if (!new Set(["test", "rehearsal"]).has(targetProfile)) throw new Error(`Unknown Phase 7A target profile: ${targetProfile}`);
if (mode === 'rehearse' && targetProfile !== 'rehearsal') throw new Error('Migration rehearsal is permitted only for the separately verified rehearsal target. The historical 12-migration test database is immutable.');
if (mode === 'initialize') throw new Error('Empty initialization is retired for these named resources: preserve the historical 12-migration test database and restore the nine-migration production snapshot into the rehearsal database.');
process.env.ZOHO_PHASE7A_TARGET_PROFILE = targetProfile;

const MIGRATIONS_DIRECTORY = join(process.cwd(), "prisma", "migrations");

function repositoryMigrationManifest() {
  const directories = readdirSync(MIGRATIONS_DIRECTORY, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  if (JSON.stringify(directories) !== JSON.stringify(CURRENT_MIGRATIONS)) {
    throw new Error("Repository migration directories do not exactly match the approved 13-migration manifest.");
  }
  return Object.fromEntries(CURRENT_MIGRATIONS.map((name) => {
    const sql = readFileSync(join(MIGRATIONS_DIRECTORY, name, "migration.sql"));
    return [name, createHash("sha256").update(sql).digest("hex")];
  }));
}

const migrationManifest = repositoryMigrationManifest();

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
          SELECT migration_name, checksum, finished_at, rolled_back_at
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
        checksum: row.checksum,
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

function assertMigrationChecksums(info) {
  for (const entry of info.migrationHistory) {
    const expected = migrationManifest[entry.migrationName];
    if (!expected) throw new Error(`Unexpected migration record: ${entry.migrationName}.`);
    if (entry.checksum !== expected) throw new Error(`Migration integrity check failed for ${entry.migrationName}.`);
  }
}

function assertRecognizedPreflightHistory(info, profile) {
  const classification = classifyExactMigrationHistory(info);
  const allowed = profile === 'test' ? new Set(['empty', 'historical12']) : new Set(['empty', 'baseline9', 'current13']);
  if (!allowed.has(classification)) throw new Error(`The ${profile} target has unsupported migration history: ${classification}.`);
  if (classification !== 'empty') assertMigrationChecksums(info);
  return classification;
}

function run(command, args, env, allowedStatuses = [0]) {
  const executable = process.platform === 'win32' && command === 'npx' ? 'npx.cmd' : command;
  const result = spawnSync(executable, args, { env, shell: false, stdio: 'inherit' });
  if (!allowedStatuses.includes(result.status)) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
  return result.status;
}

const target = getPhase7aTarget({
  requireBackup: targetProfile === 'rehearsal' && ['rehearse', 'verify'].includes(mode),
  requireEmptyInitialization: mode === 'initialize',
  requireRehearsalMigrationApproval: mode === 'rehearse',
  expectedResourceName: targetProfile === 'rehearsal' ? REHEARSAL_RESOURCE_NAME : undefined,
  expectedIsolationConfirmation: targetProfile === 'rehearsal' ? REHEARSAL_ISOLATION_CONFIRMATION : undefined
});
console.log(JSON.stringify({ phase: '7A', mode, targetProfile, target: safeTargetSummary(target) }, null, 2));

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
      assertExactMigrationHistory(initialized, 'current13');
      assertMigrationChecksums(initialized);
      console.log(JSON.stringify({
        initialized: true,
        appliedMigrationCount: initialized.applied.length,
        finalMigration: initialized.applied.at(-1)
      }, null, 2));
      process.exitCode = 0;
    } else {
      const historyProfile = assertRecognizedPreflightHistory(beforeInfo, targetProfile);
      const pendingApplied = REHEARSAL_PENDING_MIGRATIONS.filter((migration) => beforeInfo.applied.includes(migration));
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
      migrationHistoryProfile: historyProfile,
      repositoryMigrationHistoryMatches: JSON.stringify(beforeInfo.applied) === JSON.stringify(CURRENT_MIGRATIONS),
      baselinePresent: BASELINE_MIGRATIONS.every((migration) => beforeInfo.applied.includes(migration)),
      pendingMigrationsApplied: pendingApplied
    }, null, 2));
    process.exitCode = 0;
    }
  } else if (mode === 'verify') {
    assertExactMigrationHistory(beforeInfo, targetProfile === 'test' ? 'historical12' : 'current13');
    assertMigrationChecksums(beforeInfo);
    run('node', ['scripts/verify-zoho-phase-1a.mjs'], {
      ...process.env,
      DATABASE_URL: target.connectionString,
      NODE_ENV: 'test',
      VERCEL_ENV: 'test',
      ZOHO_FOUNDATION_VERIFY_READ_ONLY: '1'
    }, [0, 2]);
    run('node', ['--test', 'tests/zoho-phase-7a-db.test.mjs'], process.env);
  } else {
    assertExactMigrationHistory(beforeInfo, 'baseline9');
    assertMigrationChecksums(beforeInfo);
    const before = await snapshot(pool);
    await pool.end();
    pool = null;
    const startedAt = Date.now();
    run('npx', ['prisma', 'migrate', 'deploy'], { ...process.env, DATABASE_URL: target.directConnectionString });
    const migrationDurationMs = Date.now() - startedAt;
    pool = new Pool({ connectionString: target.connectionString, max: 4 });
    const afterInfo = await inspect(pool);
    assertExactMigrationHistory(afterInfo, 'current13');
    assertMigrationChecksums(afterInfo);
    const after = await snapshot(pool);
    const differences = compareSnapshots(before, after);
    console.log(JSON.stringify({
      migrationDurationMs,
      protectedStateDifferences: differences,
      protectedBaselineSnapshot: before,
      protectedPostMigrationSnapshot: after,
    }, null, 2));
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
