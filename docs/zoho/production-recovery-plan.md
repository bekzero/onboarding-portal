# Zoho production schema recovery plan

Status: **simplified internal-use release prepared; production execution still requires operator approval**
Prepared: November 6, 2026

Release decision recorded November 11, 2026: the deployment owner accepted proceeding without a restored-production-snapshot rehearsal because the portal is currently internal-use, migrations 10–13 were reviewed as additive, and a protected production backup with independently verified SHA-256 exists. The rehearsal procedures remain available as an optional stricter path, but they are not a mandatory gate for this release. This decision does not authorize this document or any script to connect, migrate, push, deploy, or enable automation automatically.

This plan preserves the currently rolled-back production deployment while the production data is backed up, restored into a new rehearsal database, and tested. It does not authorize a production database connection, migration, Vercel promotion, Zoho write, email, journey trigger, or cron execution.

## 1. Root cause and current state

The failed code path matches Prisma Client generated from the current schema at Git commit `c4cf367965f12ebf5c608bdfb888c0361a20ac2b` (`feat: add Zoho automation integration foundation`). That client selects `onboarding_plans.assignedSeBookingUrl` in the normal Sales Engineer dashboard query. Production still had the migration-9 schema, so PostgreSQL correctly rejected the query because migration 10 had not created the column. The failed Vercel deployment's exact Git SHA still requires the authoritative Vercel check below.

The required column already exists in:

```text
20261104150000_add_zoho_phase_1a_foundation
```

Do not create a replacement migration for this column. The root problem is deployment order, not a missing repository migration.

Repository facts verified locally:

- `main`, `origin/main`, and current HEAD are all `c4cf367`.
- The repository contains exactly 13 migrations in dependency order.
- Migrations 1–9 end at `20260715153000_add_document_storage_fields`.
- Migrations 10–12 are the Zoho foundation/dispatcher/nudge migrations, and migration 13 is the additive Staff SSO configuration migration listed below.
- The immediate parent of the Zoho foundation commit is `1abfcfe` (`Add interactive portal spotlight tour`). Its Prisma schema does not reference `assignedSeBookingUrl` or the Zoho models and is compatible with the migration-9 database.
- The linked local Vercel project is `onboarding-portal2.0`. The production rollback is confirmed at `1abfcfe`; the incompatible deployment is confirmed at `c4cf367`.
- The production Prisma Postgres resource is confirmed as `onboarding-portal-db`.
- The existing isolated test resource remains `kzero-onboarding-zoho-testing` and must not be overwritten by the restored-snapshot rehearsal.

### Required manual production identity check

Before any approval, an authorized operator must open the Vercel project and record, without copying secrets:

1. the deployment ID currently receiving the Production alias;
2. its Git commit SHA and deployment creation time;
3. the failed deployment ID and its Git commit SHA;
4. the Instant Rollback event and the deployment it restored;
5. the current Production domain aliases;
6. the production database resource attached to the project and the environments to which it is attached.

The live rollback is confirmed at `1abfcfe`. Record the deployment ID and current Production alias immediately before the backup and again before any later release so a newer Git deployment cannot silently replace it.

### Does the rollback restore compatibility?

It does if both conditions are true:

- the live deployment was built from a pre-Zoho schema commit such as `1abfcfe`; and
- production remains at the migration-9 baseline.

The Instant Rollback changes the served deployment, not the database. A successful dashboard smoke test is useful evidence, but it does not replace recording the live deployment SHA and running a read-only `prisma migrate status` against the identified production database during the approved maintenance procedure.

Keep the current Production alias pinned to the rolled-back deployment. Freeze pushes to the configured Vercel Production branch (currently expected to be `main`) because a new Git deployment could replace the rollback. An authorized Vercel operator must also verify the project's Production Branch and rollback/promotion behavior. Do not redeploy or promote `main` until the release approval checklist in this document is complete.

## 2. Exact schema required by the updated application

The latest application requires all 13 repository migrations. The production delta from the expected migration-9 baseline is:

1. `20261104150000_add_zoho_phase_1a_foundation`
2. `20261104210000_add_zoho_phase_4_dispatcher`
3. `20261105120000_add_zoho_phase_5_nudge_engine`
4. `20261106150000_add_staff_sso_configuration`

### Migration 10: Phase 1A

New `onboarding_plans` columns:

- `automationOrigin`
- `automationEnrollmentState`
- `automationTaskMappingState`
- `automaticJ1Allowed`
- `automationEnrolledAt`
- `automationEnrolledBy`
- `nextTaskSince`
- `kickoffBookedAt`
- `kickoffBookedBy`
- `assignedSeName`
- `assignedSeEmail`
- `assignedSeBookingUrl`
- `nudgeTaskKey`
- `nudgeStartedAt`
- `nudgeStatus`

New `onboarding_tasks` columns:

- `templateKey`
- `statusChangedAt`
- `completedAt`

New tables:

- `plan_contacts`
- `zoho_communication_contexts`
- `zoho_recipient_sequences`
- `zoho_outbox_events`
- `zoho_journey_sends`
- `zoho_automation_audits`

The migration also creates the related enums, constraints, indexes, and foreign keys. It classifies every existing plan as `LEGACY` and `EXCLUDED`, keeps `automaticJ1Allowed=false`, and maps only exact version-1 task title/order matches to stable keys. It does not invent task timestamps or create contacts, contexts, events, sends, or audit rows.

### Migration 11: Phase 4 dispatcher

New `zoho_communication_contexts` columns:

- `processingClaimId`
- `processingClaimedAt`
- `processingLeaseExpiresAt`

New `zoho_outbox_events` columns:

- `isStopState`
- `lastAttemptAt`
- `lastProcessingDurationMs`
- `lastProviderOutcome`

New table:

- `zoho_api_throttles`

### Migration 12: Phase 5 nudge engine

New tables:

- `zoho_nudge_evaluation_runs`
- `zoho_nudge_evaluation_decisions`

It also creates the related enums, constraints, indexes, and foreign keys. It creates no evaluation runs or decisions.

### Migration 13: Staff SSO configuration

New enums:

- `StaffSsoStatus`: `DRAFT`, `VALIDATED`, `ENABLED`, `DISABLED`
- `StaffApplicationRole`: `ADMIN`, `SALES_ENGINEER`, `VIEWER`

New tables:

- `staff_sso_configurations`
- `staff_identities`
- `staff_sso_audits`

The migration creates primary keys, a unique `(issuer, subject)` identity constraint/index, the identity role/active index, audit lookup indexes, and foreign keys from identities/audits to the singleton configuration with cascading update/delete behavior. It inserts no configuration, identity, audit, client secret, or role assignment. Stored client-secret columns are only the encrypted value, authentication tag, and IV; encryption keys remain deployment-managed secrets and are never database columns.

## 3. Runtime compatibility matrix

| Application | Database schema | Compatibility |
|---|---|---|
| Rolled-back pre-Zoho code | Migrations 1–9 | Compatible; expected current recovery state |
| Rolled-back pre-Zoho code | Migrations 1–13 | Compatible by SQL inspection; additions do not remove or rename baseline fields. This must be proven by the restored-snapshot smoke test before production approval. |
| Updated `c4cf367` code | Migrations 1–9 | **Incompatible**; dashboard and other queries can request missing columns/tables |
| Zoho foundation `c4cf367` code | Migrations 1–13 | Backward-compatible target by inspection; migration 13 is ignored by this older updated build |
| Latest application with Staff SSO | Migrations 1–9 or 1–12 | **Incompatible**; Staff SSO Prisma queries require migration 13 |
| Latest application with Staff SSO | Migrations 1–13 | Intended release state; build/unit checks passed, but restored-snapshot and Staff SSO PostgreSQL integration validation remain required |

This permits migration-before-application deployment: keep the old application serving, expand the schema, verify it, and only then promote the updated application. Database rollback by dropping the new objects is not the preferred recovery path because it would be destructive and could discard new records. After schema expansion, application rollback to the pre-Zoho deployment remains available.

## 4. Backup and restored-snapshot rehearsal

Do not reuse or overwrite `kzero-onboarding-zoho-testing`. Provision a new, separately named PostgreSQL resource specifically for the restored production snapshot rehearsal. It must not be attached to the Production Vercel environment.

### Backup procedure

1. Name a database operator and recovery owner.
2. Record the production database resource ID/name, database name, UTC time, and current migration history without recording a connection string.
3. Take a provider-managed snapshot/backup if the production plan supports it. Record its immutable reference.
4. Where policy permits, also create a custom-format logical backup from an approved secured workstation using the production direct connection only for this operation:

   ```powershell
   pg_dump --format=custom --no-owner --no-privileges --file kzero-pre-zoho.dump "$env:DIRECT_URL"
   ```

5. Verify that the dump is non-empty and readable:

   ```powershell
   pg_restore --list .\kzero-pre-zoho.dump
   Get-Item .\kzero-pre-zoho.dump | Select-Object Name,Length,LastWriteTimeUtc
   ```

6. Restore the backup into the new rehearsal database. A backup is not considered verified until this restore succeeds and the protected baseline matches production.
7. Store dumps and comparison output in an approved encrypted location outside Git. Do not put OIDC secrets, document URLs, contact details, or database credentials into tickets or build logs.

### Rehearsal environment contract

Use the separate ignored `.env.zoho-rehearsal.local` file documented in `production-backup-rehearsal-runbook.md`. The Phase 7A safety code now has a distinct, hard-coded `kzero-onboarding-rehearsal` profile and confirmation phrase while leaving the existing `kzero-onboarding-zoho-testing` profile unchanged. It must:

- accept only dedicated rehearsal variables, never generic `DATABASE_URL`/`DIRECT_URL`;
- require exact resource-name and explicit isolation confirmations;
- reject a target matching any generic application database URL;
- reject production-like database names;
- verify pooled and direct connections resolve to the same database/schema and return the same migration history;
- require a backup/restore evidence reference;
- require the baseline to end exactly at migration 9;
- refuse a target on which any Zoho migration is already present.

### Existing protected-state comparator

`scripts/zoho-phase-7a-db.mjs` already snapshots counts and SHA-256 digests of the protected baseline columns, applies migrations with `prisma migrate deploy`, and fails if any protected digest changes. It covers:

- MSP records, identity, enrollment, access mode, and Sales Engineer assignment;
- NFR and Customer Plan IDs, tenant/customer identity, progress, current stage, status, activity, app count, and First Customer Pilot data;
- task IDs, plan relationships, titles, descriptions, statuses, owners, order, due labels, and timestamps that existed before Zoho;
- SaaS application submissions;
- document metadata and storage references;
- encrypted OIDC configuration fields;
- admin notifications, including read state.

The comparator intentionally hashes protected rows instead of printing them. It includes task IDs and completion status, so an ID rewrite, completion change, progress reset, stage change, lost document, changed application, modified OIDC record, or removed notification fails the rehearsal.

The guarded Phase 7A harness now defines separate exact profiles for the nine-migration production baseline, preserved 12-migration historical test resource, and complete 13-migration schema. It refuses rehearsal mode on `kzero-onboarding-zoho-testing`, verifies repository SQL checksums against `_prisma_migrations`, and requires the Staff SSO PostgreSQL cases for the rehearsal profile. Run its offline safety suite before any connection. Do not bypass or weaken target-identity, restored-snapshot, fingerprint, backup-source, or production-rejection checks.

The migration-13 database checks must confirm the three Staff SSO tables and both enums, the unique `(issuer, subject)` identity constraint, role/active and audit indexes, both cascading foreign keys, initially empty tables, duplicate-identity rejection, foreign-key rejection, transactional rollback, and cleanup limited to uniquely prefixed fixtures. Application persistence testing must use a rehearsal-only `STAFF_SSO_ENCRYPTION_KEY` and prove that plaintext client secrets never appear in database rows or test output.

After adapting only the target-name guard for the new rehearsal resource, use the existing command:

```powershell
npm.cmd run rehearse:zoho-phase-7a-db
```

The environment must also contain:

```text
ZOHO_PHASE7A_ISOLATED_CONFIRMATION=I_CONFIRM_KZERO_ONBOARDING_REHEARSAL_IS_ISOLATED
ZOHO_PHASE7A_BACKUP_RESTORE_CONFIRMED=I_CONFIRM_PHASE7A_BACKUP_RESTORE_VERIFIED
ZOHO_PHASE7A_BACKUP_RESTORE_REFERENCE=<approved immutable restore evidence reference>
ZOHO_PHASE7A_BACKUP_SOURCE_RESOURCE_NAME=onboarding-portal-db
ZOHO_PHASE7A_BACKUP_ARCHIVE_SHA256=<verified 64-character archive SHA-256>
ZOHO_PHASE7A_PRODUCTION_DATABASE_FINGERPRINT=<independently recorded production pooled fingerprint>
ZOHO_PHASE7A_PRODUCTION_DIRECT_DATABASE_FINGERPRINT=<independently recorded production direct fingerprint>
ZOHO_PHASE7A_REHEARSAL_MIGRATION_CONFIRMATION=I_CONFIRM_REHEARSAL_9_TO_13_MIGRATION
```

Do not run this command until its target summary reports the new rehearsal resource and independently recorded fingerprints. Never point it at production or the existing empty Zoho test database.

### Rehearsal pass criteria

- Baseline migration history is exactly migrations 1–9 with no failed/rolled-back entries.
- All four pending migrations apply in order (10, 11, 12, then 13) and the final history is exactly migrations 1–13.
- `protectedStateDifferences` is empty.
- Every pre-existing plan is `LEGACY`, `EXCLUDED`, and `automaticJ1Allowed=false`.
- Historical `statusChangedAt`, `completedAt`, `nextTaskSince`, kickoff, enrollment, and nudge timestamps remain null.
- The stable-key verifier reports all unmapped/ambiguous plans for manual review; it does not repair them.
- All new automation and Staff SSO tables are empty immediately after migration.
- Migration duration, table-lock observations, database CPU/connections, and application-unavailable time are recorded.
- Phase 7A PostgreSQL tests, extended with Staff SSO schema/constraint/transaction cases, run only against expendable rehearsal fixtures and clean up only those fixtures.
- Rolled-back and updated application builds both pass dashboard/portal smoke tests against separate disposable clones of the migrated rehearsal database.
- Commit `1abfcfe` remains compatible with the 13-migration schema: it must neither query nor mutate Staff SSO/Zoho objects, and its existing onboarding workflows must pass unchanged.

The compatibility result must come from the actual `1abfcfe` application runtime executing its Prisma queries against a separately verified disposable clone of the migrated rehearsal database. A current-code build, SQL inspection, or unit test alone is not sufficient. Follow the detached-worktree procedure in `production-backup-rehearsal-runbook.md`; never repoint Production or use `kzero-onboarding-zoho-testing` for this check.

## 5. Migration safety assessment

The four pending migrations are additive by SQL inspection: they contain no `DROP`, `TRUNCATE`, baseline column rename, task-ID rewrite, progress update, document/application mutation, OIDC mutation, or notification mutation. Migrations 11 and 12 only add Zoho coordination tables/columns. Migration 13 only adds Staff SSO enums, tables, indexes, and foreign keys and performs no data backfill.

Migration 10 deliberately updates only new automation classification/mapping fields. Its stable-key backfill requires exact title **and** order and refuses duplicate template slots. The unique `(onboardingPlanId, templateKey)` index is applied after that conservative mapping.

They are suitable for ordered production deployment after the explicit November 11 rehearsal waiver. Remaining operational risks to monitor during the approved migration window are:

- `ALTER TABLE` locks on `onboarding_plans` and `onboarding_tasks`;
- full scans/updates for legacy classification and task mapping;
- non-concurrent unique/index creation on existing tasks;
- migration transaction duration and connection timeout behavior on the real dataset size;
- unexpected migration history drift or manually changed production schema;
- historical task shapes that remain unmapped and automation-ineligible.
- a migration-13 schema mismatch or missing Staff SSO constraints;
- accidental use of a production Staff SSO encryption/bootstrap secret in rehearsal;
- an unverified assumption that the rolled-back application ignores the expanded 13-migration schema.

No ambiguous task mapping should block ordinary onboarding operation. It must keep the affected plan excluded from automation until reviewed.

## 6. Preview and staging isolation

Before creating any new Preview deployment:

1. Provision or select a staging database that is neither production nor `kzero-onboarding-zoho-testing` if that database must be preserved for Phase 7A/7B evidence.
2. In Vercel, inspect every database integration and environment variable scope. Set Preview `DATABASE_URL` to the staging pooled URL only. Do not expose the production direct URL to Preview.
3. Keep migration credentials out of normal application deployments. Supply a direct URL only to an explicitly approved migration job/operator.
4. Verify Preview does not inherit Production-only `DATABASE_URL`, `DIRECT_URL`, Blob, OAuth, or Zoho credentials through a Storage integration or shared environment scope.
5. Deploy a Preview and expose only a sanitized database identity endpoint or use provider/CLI metadata to confirm it reaches staging. Do not print connection strings.
6. Do not run database-dependent Preview testing for the latest application until the staging migration history is exactly 13.

All environments must retain these dormant defaults:

```text
ZOHO_DISPATCH_ENABLED=false
ZOHO_EVENT_EMISSION_ENABLED=false
ZMA_NUDGE_EVALUATION_ENABLED=false
ZOHO_GLOBAL_KILL_SWITCH=true
ZOHO_CONTACT_SYNC_ENABLED=false
ZOHO_JOURNEY_TRIGGERING_ENABLED=false
ZOHO_AUTOMATIC_DISPATCH_ENABLED=false
ZOHO_PRODUCTION_DISPATCH_APPROVED=false
ZOHO_DISPATCH_MODE=disabled
ZOHO_TEST_SYNC_ENABLED=false
ZOHO_TEST_FIXTURE_ENABLED=false
```

No cron schedule is to be enabled.

## 7. Approved release order

### Before the maintenance window

1. Verify the current Vercel Production deployment SHA and successful dashboard/portal operation.
2. Verify production database identity and migration history read-only; expected final migration is migration 9.
3. Record the deployment owner's explicit restored-snapshot rehearsal waiver and reconfirm the independently verified production backup hash.
4. Review all task-mapping findings and accept that unresolved plans remain excluded.
5. Confirm a verified restorable backup, recovery owner, maintenance window, and rollback decision points.
6. Build the exact release commit and record its SHA/artifact. Do not use an uncommitted local worktree as the release artifact.
7. Confirm Production and Preview environment scopes and all dormant Zoho flags.
8. Because no restored-snapshot timing evidence exists, avoid onboarding writes during the short migration window and stop if lock waits or migration errors occur.

### Production migration, before application promotion

1. Keep the rolled-back deployment serving and keep its Production alias unchanged.
2. Take/confirm the final pre-change backup and record its UTC reference.
3. Independently verify the production database resource, database/schema, and migration history. Stop on any mismatch.
4. From an approved operator environment with only the production direct migration URL injected for this command, run:

   ```powershell
   npx.cmd prisma migrate status
   npx.cmd prisma migrate deploy
   ```

5. Confirm exactly 13 successful migration records and no failed migration.
6. Run the read-only Phase 1A verifier with production-safe explicit authorization and capture only sanitized counts/plan identifiers. Do not run the fixture-producing Phase 7A database tests on production.
7. Repeat protected row counts/digests and confirm new automation and Staff SSO tables are empty.
8. Smoke-test the still-serving rolled-back dashboard, NFR/Customer portals, task completion, documents, SaaS apps, OIDC login, and notifications. Because the schema change is additive, these checks must pass before the updated application is promoted.

### Updated application release

1. Create a Preview from the exact release commit against the migrated staging/rehearsal database, never production.
2. Run build and smoke tests, including the dashboard query that selects `assignedSeBookingUrl`.
3. Reconfirm production migration history is 13 and dormant Zoho flags remain set.
4. Promote/deploy the exact approved commit to Production.
5. Verify dashboard, plan lists, case preview, both portal types, task mutations, documents, SaaS applications, OIDC, and notifications.
6. Confirm no outbox events, nudge runs, Zoho contacts, or journey calls were produced.
7. Keep the previous deployment available for application rollback until the observation window closes.

## 8. Rollback and recovery options

### If migration fails before completion

- Do not promote the new application.
- Keep the current rolled-back deployment serving if Prisma/PostgreSQL reports the migration transaction rolled back cleanly.
- Inspect `_prisma_migrations` and PostgreSQL state with the database owner. Do not use `prisma migrate resolve`, edit migration rows, or rerun blindly without an approved diagnosis.
- Restore the verified pre-change backup into a separate database first to prove recovery. Switch production only through the provider-approved recovery procedure and only with the recovery owner’s approval.

### If migration succeeds but verification fails

- Do not deploy the updated application.
- Keep or restore the rolled-back application deployment.
- Preserve the migrated database and logs for diagnosis; do not drop the new schema ad hoc.
- If protected baseline data changed, stop writes and invoke the verified provider snapshot/logical-restore recovery procedure. Recheck protected digests before reopening writes.

### If the updated application fails after a verified migration

- Instant Rollback the application to the recorded pre-Zoho deployment.
- Leave the expanded schema in place. The old code does not depend on or mutate the added Zoho fields/tables, and this avoids destructive schema rollback.
- Keep every Zoho flag disabled and diagnose in staging.

### Database point-in-time recovery

Use only the provider-supported snapshot/PITR or verified logical restore procedure. Record the recovery point, expected data-loss window, operator, and post-restore migration history. A database restore can discard legitimate onboarding changes made after the backup, so it is a last-resort recovery decision, not the routine application rollback.

## 9. Production approval prerequisites

For the simplified internal-use release, production migration approval requires the following. The restored-snapshot rehearsal items retained elsewhere in this document are optional under the recorded November 11 waiver:

- authoritative current Vercel deployment ID and commit SHA;
- read-only production database identity and exact migration history;
- verified protected production backup and independently recomputed SHA-256;
- accepted list of ambiguous/missing historical task mappings;
- measured migration duration and approved maintenance/write-pause plan;
- verified Preview/staging database isolation;
- exact release SHA and successful build/tests;
- SHA-256 evidence for pending migration files 10–13 and a final 13-record migration history;
- passing offline Staff SSO schema/constraint and authorization tests;
- post-migration smoke tests of the still-serving `1abfcfe` deployment before promoting updated code;
- named migration operator, release operator, and recovery owner;
- validated Production and Preview environment-variable scopes;
- all Zoho sending/event/nudge/dispatch flags confirmed dormant;
- dashboard and portal smoke-test checklist plus rollback decision time.

The earlier empty-database Phase 7A result (12 migrations, 8 real PostgreSQL tests, and 79 existing automated tests) predates migration 13. It is supporting evidence for migrations 1–12 only; it neither validates Staff SSO persistence nor replaces the restored-production-snapshot rehearsal.

## 10. Manual actions still required

1. Reconfirm in the Vercel UI that the Production alias still serves the recorded `1abfcfe` rollback deployment immediately before the backup; no credentials should be added to the repository.
2. Confirm whether production is exactly at migration 9 using a read-only, independently verified connection.
3. Reconfirm the protected archive SHA-256 and retain the archive outside Git; a restore rehearsal is optional for this release.
4. Review Vercel environment scopes so Preview cannot reach production PostgreSQL.
5. Approve a short migration window, migration operator, release operator, and recovery owner.
6. Only after approval, perform migration-before-application deployment in the order above.

No production database change, deployment, promotion, Zoho write, email, journey trigger, or cron activation was performed while preparing this plan.
