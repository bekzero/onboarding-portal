# Zoho Phase 1A migration runbook

Status: prepared, not applied
Migration: `20261104150000_add_zoho_phase_1a_foundation`

This migration is additive and does not enable Zoho dispatch. It must first be rehearsed against an isolated, access-controlled copy of production. Do not use `prisma db push`, `prisma migrate dev`, or a destructive reset.

## What the migration changes

- Adds automation classification, Sales Engineer, kickoff, nudge, and next-task fields to existing plans.
- Adds nullable stable identity and truthful transition timestamp fields to existing tasks.
- Backfills only exact version-1 task title/order matches; ambiguous or incomplete plans remain automation-ineligible.
- Creates plan contact, communication context, recipient sequence, outbox, journey-send, and audit tables.
- Creates no plan contacts, communication contexts, outbox events, journey sends, or audit records.
- Leaves historical `statusChangedAt`, `completedAt`, `nextTaskSince`, `kickoffBookedAt`, and enrollment timestamps null.
- Does not modify task IDs, task status, progress, stage ownership, documents, SaaS applications, OIDC records, or admin notifications.

## Migration risks

- `ALTER TABLE` statements and index creation take PostgreSQL locks. Apply during a maintenance window sized from the rehearsal.
- The historical classification and mapping statements scan existing plans/tasks. Record their observed duration and lock impact on the isolated copy.
- Exact title/order mapping intentionally leaves older or locally altered task shapes unresolved. Those plans remain `EXCLUDED` and become `NEEDS_REVIEW`.
- Future outbox, send-ledger, or active-context rows use restrictive plan foreign keys. A plan with retained automation evidence cannot be deleted until a later authorized retention workflow handles that evidence; ordinary plan contacts follow their plan's existing deletion lifecycle.
- The unique task-key index is safe because the backfill refuses duplicate template slots. Verify its creation on the isolated copy.

## 1. Take and verify a backup

1. Identify the production database and resource owner without copying credentials into a ticket or source control.
2. Use the managed Prisma Postgres backup/snapshot mechanism if it is available on the production plan. Record the snapshot ID, UTC time, database identifier, and operator.
3. Also take a PostgreSQL custom-format backup from an approved workstation where policy permits:

   ```powershell
   pg_dump --format=custom --no-owner --no-privileges --file phase-1a-predeploy.dump "$env:DIRECT_URL"
   ```

4. Verify the dump can be listed and is non-empty:

   ```powershell
   pg_restore --list phase-1a-predeploy.dump
   Get-Item phase-1a-predeploy.dump | Select-Object Name,Length,LastWriteTimeUtc
   ```

5. A backup is not considered verified until it restores successfully into a separate empty PostgreSQL database and the baseline checks below match.

## 2. Create an isolated rehearsal database

1. Provision a separate PostgreSQL database with no application traffic and restricted access.
2. Restore the verified dump into that database.
3. In a new terminal, set `DATABASE_URL` to the isolated database only. Do not reuse a terminal containing the production value.
4. Confirm the server/database identity with a read-only query before running Prisma:

   ```sql
   SELECT current_database(), inet_server_addr(), current_user;
   ```

5. Record baseline counts for `msps`, `onboarding_plans`, `onboarding_tasks`, `saas_app_submissions`, `documents`, `oidc_configs`, and `admin_notifications`.
6. Record task IDs/statuses and plan progress/status/timestamps to a protected comparison file. Do not log OIDC secrets or document URLs.

## 3. Review and rehearse

1. Review `prisma/migrations/20261104150000_add_zoho_phase_1a_foundation/migration.sql` with the database owner. Confirm it contains no `DROP`, `TRUNCATE`, task-ID rewrite, or business-state update.
2. Check pending migrations:

   ```powershell
   npx prisma migrate status
   ```

3. Apply only to the isolated database:

   ```powershell
   npx prisma migrate deploy
   ```

4. Run the read-only mapping/protection report:

   ```powershell
   $env:ZOHO_FOUNDATION_VERIFY_READ_ONLY='1'
   npm run verify:zoho-phase-1a
   ```

   Exit code `2` means the report found mapping or protection issues that require review; it does not modify them.

5. Confirm the new tables are empty immediately after migration:

   ```sql
   SELECT
     (SELECT count(*) FROM plan_contacts) AS plan_contacts,
     (SELECT count(*) FROM zoho_communication_contexts) AS contexts,
     (SELECT count(*) FROM zoho_outbox_events) AS outbox_events,
     (SELECT count(*) FROM zoho_journey_sends) AS journey_sends,
     (SELECT count(*) FROM zoho_automation_audits) AS audit_rows;
   ```

6. Compare all baseline row counts and captured business fields. Existing task IDs, statuses, plan progress/status, timestamps, notifications, documents, applications, and OIDC records must match exactly.
7. Confirm every pre-migration plan is `LEGACY`, `EXCLUDED`, and `automaticJ1Allowed=false`.
8. Confirm all pre-migration transition/enrollment/kickoff/nudge timestamps are null.
9. Exercise the portal and admin task completion flows on expendable copied records. Verify existing template-derived URLs still work and persisted CUIDs do not change.
10. Test two copied plans sharing one email by manually inserting normalized test contacts, then verify the communication-context primary key rejects a second row for that normalized email. Test duplicate outbox `eventKey`, recipient/sequence, and journey `dedupeKey` rejection using a rollback-only SQL transaction.

## 4. Resolve mapping findings

- `missingMappings`: no stable key was assigned; inspect the task and the plan's template history.
- `ambiguousMappings`: title and order indicate different version-1 tasks, or duplicate rows claim one template slot. Do not choose automatically.
- `duplicateMappings`: invalid duplicate stable keys; the database constraint should prevent these after migration.
- `taskCountMismatches`: the plan does not contain exactly the 14 version-1 tasks.
- `planMappingStateMismatches`: the plan's eligibility marker does not reflect the observed mapping.

Keep affected plans `EXCLUDED` and `NEEDS_REVIEW`. A later authorized remediation must record the evidence used to assign a key. Never infer completion times while resolving identity.

## 5. Production application checklist

Production application requires all of the following:

- verified backup and successful restore rehearsal;
- isolated migration rehearsal with before/after comparisons;
- reviewed mapping report and an accepted list of unresolved legacy plans;
- measured lock/runtime impact and approved maintenance window;
- named database operator and rollback owner;
- `ZOHO_DISPATCH_ENABLED=false` in every deployment environment;
- application build using the generated Phase 1A Prisma client;
- confirmation that no Phase 1B routes, cron definitions, OAuth credentials, or event emitters are deployed.

During the approved window, independently confirm the production database identity, run `npx prisma migrate status`, then run `npx prisma migrate deploy`. Immediately repeat the empty-table, legacy-classification, timestamp-null, row-count, task-ID, and portal smoke checks. If any invariant fails, stop; do not attempt a reset or ad hoc destructive correction.

## Phase 1B blockers

- Resolve all task mappings for any plan proposed for automation.
- Populate truthful plan contacts and verified first/last names through an authorized workflow.
- Populate assigned-SE email and booking URL with verified values.
- Complete the controlled Zoho list/topic/double-opt-in test.
- Approve context assignment/release controls, subscription verification, J8 scope, recipients, sender/Reply-To, and historical enrollment behavior.
- Build audited admin controls before any historical enrollment or context assignment.
- Keep external dispatch disabled until the dispatcher, fake-adapter tests, and controlled ZMA test journeys are approved.
