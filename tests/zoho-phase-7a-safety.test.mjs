import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BASELINE_MIGRATIONS,
  CURRENT_MIGRATIONS,
  HISTORICAL_TEST_MIGRATIONS,
  assertExactMigrationHistory,
  classifyExactMigrationHistory
} from "../scripts/zoho-phase-7a-migrations.mjs";
import {
  BACKUP_CONFIRMATION,
  getPhase7aTarget,
  PRODUCTION_RESOURCE_NAME,
  REHEARSAL_ISOLATION_CONFIRMATION,
  REHEARSAL_MIGRATION_CONFIRMATION,
  REHEARSAL_RESOURCE_NAME
} from "../scripts/zoho-phase-7a-safety.mjs";

const managed = [
  'ZOHO_PHASE7A_TARGET_PROFILE', 'ZOHO_PHASE7A_DATABASE_URL', 'ZOHO_PHASE7A_DIRECT_URL', 'ZOHO_PHASE7A_DATABASE_RESOURCE_NAME',
  'ZOHO_PHASE7A_ISOLATED_CONFIRMATION', 'ZOHO_PHASE7A_BACKUP_RESTORE_CONFIRMED', 'ZOHO_PHASE7A_BACKUP_RESTORE_REFERENCE',
  'ZOHO_PHASE7A_BACKUP_SOURCE_RESOURCE_NAME', 'ZOHO_PHASE7A_BACKUP_ARCHIVE_SHA256', 'ZOHO_PHASE7A_PRODUCTION_DATABASE_FINGERPRINT',
  'ZOHO_PHASE7A_PRODUCTION_DIRECT_DATABASE_FINGERPRINT', 'ZOHO_PHASE7A_REHEARSAL_MIGRATION_CONFIRMATION', 'DATABASE_URL', 'DIRECT_URL'
];
const saved = {};

beforeEach(() => {
  for (const key of managed) { saved[key] = process.env[key]; delete process.env[key]; }
  Object.assign(process.env, {
    ZOHO_PHASE7A_TARGET_PROFILE: 'rehearsal',
    ZOHO_PHASE7A_DATABASE_URL: 'postgresql://rehearsal_pool:secret@pooled.example.invalid:5432/rehearsal_db?sslmode=require',
    ZOHO_PHASE7A_DIRECT_URL: 'postgresql://rehearsal_direct:secret@direct.example.invalid:5432/rehearsal_db?sslmode=require',
    ZOHO_PHASE7A_DATABASE_RESOURCE_NAME: REHEARSAL_RESOURCE_NAME,
    ZOHO_PHASE7A_ISOLATED_CONFIRMATION: REHEARSAL_ISOLATION_CONFIRMATION,
    ZOHO_PHASE7A_BACKUP_RESTORE_CONFIRMED: BACKUP_CONFIRMATION,
    ZOHO_PHASE7A_BACKUP_RESTORE_REFERENCE: 'approved-backup-evidence-reference',
    ZOHO_PHASE7A_BACKUP_SOURCE_RESOURCE_NAME: PRODUCTION_RESOURCE_NAME,
    ZOHO_PHASE7A_BACKUP_ARCHIVE_SHA256: 'a'.repeat(64),
    ZOHO_PHASE7A_PRODUCTION_DATABASE_FINGERPRINT: 'b'.repeat(16),
    ZOHO_PHASE7A_PRODUCTION_DIRECT_DATABASE_FINGERPRINT: 'c'.repeat(16),
    ZOHO_PHASE7A_REHEARSAL_MIGRATION_CONFIRMATION: REHEARSAL_MIGRATION_CONFIRMATION
  });
});

afterEach(() => { for (const key of managed) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key]; });

function info(applied, overrides = {}) {
  return { applied, migrationTableExists: true, migrationHistory: applied.map((migrationName) => ({ migrationName, failed: false, rolledBack: false })), ...overrides };
}

test('exact 9, historical 12, and current 13 histories are independently recognized', () => {
  assert.equal(assertExactMigrationHistory(info([...BASELINE_MIGRATIONS]), 'baseline9'), 'baseline9');
  assert.equal(assertExactMigrationHistory(info([...HISTORICAL_TEST_MIGRATIONS]), 'historical12'), 'historical12');
  assert.equal(assertExactMigrationHistory(info([...CURRENT_MIGRATIONS]), 'current13'), 'current13');
  assert.equal(classifyExactMigrationHistory(info([...HISTORICAL_TEST_MIGRATIONS])), 'historical12');
});

test('missing Staff SSO, incorrect order, unexpected extras, and failed migrations fail closed', () => {
  assert.throws(() => assertExactMigrationHistory(info([...HISTORICAL_TEST_MIGRATIONS]), 'current13'), /exactly match current13/);
  const reordered = [...CURRENT_MIGRATIONS]; [reordered[10], reordered[11]] = [reordered[11], reordered[10]];
  assert.throws(() => assertExactMigrationHistory(info(reordered), 'current13'), /approved order/);
  assert.throws(() => assertExactMigrationHistory(info([...CURRENT_MIGRATIONS, 'unexpected_migration']), 'current13'), /exactly match/);
  const failed = info([...CURRENT_MIGRATIONS], { migrationHistory: [...CURRENT_MIGRATIONS.map((migrationName) => ({ migrationName, failed: false, rolledBack: false })), { migrationName: 'failed', failed: true, rolledBack: false }] });
  assert.throws(() => assertExactMigrationHistory(failed, 'current13'), /unfinished migration/);
});

test('rehearsal safety requires exact resource, backup source, archive evidence, fingerprints, and approval', () => {
  const target = getPhase7aTarget({ requireBackup: true, requireRehearsalMigrationApproval: true });
  assert.equal(target.resourceName, REHEARSAL_RESOURCE_NAME);
  assert.equal(target.targetProfile, 'rehearsal');
  process.env.ZOHO_PHASE7A_BACKUP_SOURCE_RESOURCE_NAME = 'wrong-source';
  assert.throws(() => getPhase7aTarget({ requireBackup: true }), /BACKUP_SOURCE_RESOURCE_NAME/);
  process.env.ZOHO_PHASE7A_BACKUP_SOURCE_RESOURCE_NAME = PRODUCTION_RESOURCE_NAME;
  process.env.ZOHO_PHASE7A_REHEARSAL_MIGRATION_CONFIRMATION = 'not-approved';
  assert.throws(() => getPhase7aTarget({ requireBackup: true, requireRehearsalMigrationApproval: true }), /9-to-13 rehearsal/);
});

test('wrong resource, mismatched production fingerprints, and attempted application database reuse are rejected', () => {
  process.env.ZOHO_PHASE7A_DATABASE_RESOURCE_NAME = 'onboarding-portal-db';
  assert.throws(() => getPhase7aTarget(), /must be exactly kzero-onboarding-rehearsal/);
  process.env.ZOHO_PHASE7A_DATABASE_RESOURCE_NAME = REHEARSAL_RESOURCE_NAME;
  const target = getPhase7aTarget();
  process.env.ZOHO_PHASE7A_PRODUCTION_DATABASE_FINGERPRINT = target.databaseFingerprint;
  assert.throws(() => getPhase7aTarget({ requireBackup: true }), /matches a recorded production fingerprint/);
  process.env.ZOHO_PHASE7A_PRODUCTION_DATABASE_FINGERPRINT = 'b'.repeat(16);
  process.env.DATABASE_URL = process.env.ZOHO_PHASE7A_DATABASE_URL;
  assert.throws(() => getPhase7aTarget(), /matching DATABASE_URL/);
});

test('database harness preserves historical test mode and gates Staff SSO cases to rehearsal', async () => {
  const runner = await readFile(new URL('../scripts/zoho-phase-7a-db.mjs', import.meta.url), 'utf8');
  const integration = await readFile(new URL('./zoho-phase-7a-db.test.mjs', import.meta.url), 'utf8');
  assert.match(runner, /targetProfile === 'test' \? 'historical12' : 'current13'/);
  assert.match(runner, /Migration rehearsal is permitted only.*historical 12-migration test database is immutable/);
  assert.match(runner, /assertExactMigrationHistory\(beforeInfo, 'baseline9'\)/);
  assert.match(runner, /assertExactMigrationHistory\(afterInfo, 'current13'\)/);
  assert.match(integration, /includesStaffSso = target\.targetProfile === 'rehearsal'/);
  assert.match(integration, /duplicate identity rejection|staff_identities_issuer_subject_key|23505/);
  assert.match(integration, /encryptedClientSecret/);
  assert.doesNotMatch(runner, /migrationCount\s*>=|applied\.length\s*>=/);
});

test('migration 13 is additive and contains the required Staff SSO constraints', async () => {
  const sql = await readFile(new URL('../prisma/migrations/20261106150000_add_staff_sso_configuration/migration.sql', import.meta.url), 'utf8');
  for (const object of ['staff_sso_configurations', 'staff_identities', 'staff_sso_audits', 'StaffSsoStatus', 'StaffApplicationRole', 'staff_identities_issuer_subject_key']) assert.match(sql, new RegExp(object));
  assert.match(sql, /ON DELETE CASCADE ON UPDATE CASCADE/g);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE)\b|ALTER TABLE "(?:msps|onboarding_plans|onboarding_tasks|documents|saas_app_submissions|oidc_configs|admin_notifications)"/i);
  assert.doesNotMatch(sql, /^\s*(?:INSERT INTO|UPDATE\s+"|DELETE FROM)\b/im);
});
