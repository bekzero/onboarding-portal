export const BASELINE_MIGRATIONS = Object.freeze([
  "20260617185715_init",
  "20260617194303_add_admin_reporting_fields",
  "20260617194747_add_onboarding_plan_reporting_fields",
  "20260619110000_add_first_customer_pilot_fields",
  "20260625143000_add_admin_notifications",
  "20260703120000_add_msp_enrollment_date",
  "20260713120000_add_msp_gmm_partner_flag",
  "20260715120000_add_customer_name_to_onboarding_plan",
  "20260715153000_add_document_storage_fields"
]);

export const ZOHO_MIGRATIONS = Object.freeze([
  "20261104150000_add_zoho_phase_1a_foundation",
  "20261104210000_add_zoho_phase_4_dispatcher",
  "20261105120000_add_zoho_phase_5_nudge_engine"
]);

export const STAFF_SSO_MIGRATION = "20261106150000_add_staff_sso_configuration";
export const HISTORICAL_TEST_MIGRATIONS = Object.freeze([...BASELINE_MIGRATIONS, ...ZOHO_MIGRATIONS]);
export const CURRENT_MIGRATIONS = Object.freeze([...HISTORICAL_TEST_MIGRATIONS, STAFF_SSO_MIGRATION]);
export const REHEARSAL_PENDING_MIGRATIONS = Object.freeze([...ZOHO_MIGRATIONS, STAFF_SSO_MIGRATION]);

export const MIGRATION_PROFILES = Object.freeze({
  baseline9: BASELINE_MIGRATIONS,
  historical12: HISTORICAL_TEST_MIGRATIONS,
  current13: CURRENT_MIGRATIONS
});

export function assertExactMigrationHistory(info, profileName) {
  const expected = MIGRATION_PROFILES[profileName];
  if (!expected) throw new Error(`Unknown migration profile: ${profileName}`);
  const failed = info.migrationHistory?.filter((entry) => entry.failed) ?? [];
  const rolledBack = info.migrationHistory?.filter((entry) => entry.rolledBack) ?? [];
  if (failed.length) throw new Error(`Database has ${failed.length} unfinished migration(s).`);
  if (rolledBack.length) throw new Error(`Database has ${rolledBack.length} rolled-back migration record(s).`);
  if (JSON.stringify(info.applied) !== JSON.stringify(expected)) {
    if (info.applied.length === expected.length && expected.every((migration) => info.applied.includes(migration))) {
      throw new Error(`Migration history for ${profileName} is not in the approved order.`);
    }
    throw new Error(`Migration history must exactly match ${profileName} (${expected.length} migrations) in approved order.`);
  }
  return profileName;
}

export function classifyExactMigrationHistory(info) {
  if (info.migrationHistory?.some((entry) => entry.failed || entry.rolledBack)) return "invalid";
  for (const [name, expected] of Object.entries(MIGRATION_PROFILES)) {
    if (JSON.stringify(info.applied) === JSON.stringify(expected)) return name;
  }
  return info.applied.length === 0 && !info.migrationTableExists ? "empty" : "unknown";
}
