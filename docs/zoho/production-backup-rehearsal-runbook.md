# Production backup and restored-snapshot rehearsal runbook

Status: **review only; no database connection or mutation authorized**
Prepared: November 6, 2026

Release note, November 11, 2026: this remains an optional stricter rehearsal procedure. The deployment owner explicitly waived it as a mandatory gate for the current internal-use release after reviewing the additive migrations and independently verifying the protected production backup hash. Nothing in this runbook executes automatically.

This procedure creates a PostgreSQL 17 custom-format backup of `onboarding-portal-db`, restores it only into a new isolated resource named `kzero-onboarding-rehearsal`, and rehearses pending migrations 10–13 there. It must not use or overwrite `kzero-onboarding-zoho-testing`.

No command in the execution sections has been run while preparing this document.

The reviewed operator sequence for the first protected archive is maintained in `docs/zoho/production-backup-execution-procedure.md`. Complete that procedure and retain its evidence before beginning any restore step in this runbook.

## 1. Confirmed deployment and database identities

- Current rolled-back Production commit: `1abfcfe`
- Incompatible updated commit: `c4cf367`
- Production database resource: `onboarding-portal-db`
- Existing isolated test resource: `kzero-onboarding-zoho-testing`
- Required new rehearsal resource: `kzero-onboarding-rehearsal`

Commit `1abfcfe` uses the migration-9 Prisma schema and does not query `assignedSeBookingUrl`, the Zoho tables, or the Staff SSO tables. Preserve the Vercel Instant Rollback by freezing pushes to the configured Production branch and recording the active deployment ID, commit SHA, Production alias, and timestamp before every approved database step. Do not promote any updated application containing the Zoho foundation or Staff SSO configuration code until production itself has migrations 10–13; that later production action is outside this rehearsal.

## 2. Backup availability and tool prerequisites

Current Prisma documentation says self-service automatic snapshots are available on Starter, Pro, and Business. Free does not provide a restorable automatic-backup history, so this plan relies on an operator-created `pg_dump`. Inspect the `onboarding-portal-db` **Backups** tab and plan label read-only before proceeding. If an unexpected provider snapshot exists, record it as additional evidence; do not restore it in place.

Official references:

- [Prisma Postgres backups](https://docs.prisma.io/docs/postgres/database/backups)
- [Prisma Postgres connection strings](https://www.prisma.io/docs/postgres/database/connecting-to-your-database)
- [Prisma Postgres import/restore guidance](https://www.prisma.io/docs/prisma-postgres/import-from-existing-database-postgresql)
- [PostgreSQL 17 `pg_dump`](https://www.postgresql.org/docs/17/app-pgdump.html)

Run the offline Windows PowerShell 5.1 backup safety suite before any storage preparation or database connection:

```powershell
npm.cmd run test:production-online-backup-offline
```

The suite exercises valid/invalid paths, reparse-point rejection, BitLocker states, ACL validation, PostgreSQL tool versions, zero/one/multiple command rows, archive validation/quarantine, metadata separation, and credential cleanup using disposable fixtures and mocks.

PostgreSQL 17 command-line tools have been installed according to the operator. Independently verify the exact executables and their major versions before the first connection; the installation statement alone is not execution evidence. A local database server is not required.

Verify the tools before any connection:

```powershell
Import-Module .\scripts\production-online-backup-support.psm1 -Force
Resolve-Postgres17Tools -BinPath 'C:\Program Files\PostgreSQL\17\bin' | Format-List
```

**Checkpoint A:** all three resolved paths must be under `C:\Program Files\PostgreSQL\17\bin`, and each executable must report `17.x`. The procedure invokes those absolute paths and never falls back to another installation on `PATH`.

## 3. Secure working directory

Choose an approved BitLocker-encrypted local volume with sufficient free space. The dedicated directory must be outside this Git repository and any cloud-synchronized consumer folder. The dump contains production customer data, encrypted OIDC material, document metadata, and contact information.

Run only after selecting the approved path:

```powershell
Set-Location 'C:\Users\BenEakin\Documents\onboarding-portal'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\prepare-production-online-backup.ps1
```

The PowerShell 5.1 preparation script requires a drive-rooted absolute local parent path and creates a new timestamped child directory. It rejects drive-relative paths such as `C:backup`, UNC paths, drive roots, repository paths, existing targets, and reparse points in any path segment. It does not change an unrelated parent directory's ACL.

It obtains the destination volume using `Get-BitLockerVolume` and requires the matching mount point, `FullyEncrypted`, protection `On`, and 100% encryption. It records exact `pg_database_size(...)` byte evidence and requires available space of at least three times that value. It removes ACL inheritance only on the new child, grants only the operator and `NT AUTHORITY\SYSTEM`, and reads the ACL back. If size evidence, BitLocker status, or access cannot be proved, stop.

**Checkpoint B:** `OFFLINE BACKUP PREPARATION PASSED` is reported; `preparation-evidence.json` records no database connection or backup; the dedicated path, BitLocker status, ACL, free-space check, and exact PostgreSQL 17 tools are independently reviewed.

Do not commit, upload to an unapproved location, attach to a ticket, or leave the archive on an unencrypted workstation.

## 4. Obtain the production direct connection safely

### Required hardened read-only verification

Before creating the backup session described below, run the repository's reviewed read-only verifier from a fresh PowerShell process:

```powershell
Set-Location 'C:\Users\BenEakin\Documents\onboarding-portal'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\production-prebackup-readonly.ps1
```

The script prompts separately for the production pooled and direct URLs using `SecureString`. Before connecting, provide the Prisma **database** ID for `onboarding-portal-db` (it must begin with `db_`); a `proj_` project ID is rejected in that field. A project ID may be entered separately as optional supporting evidence. Non-secret identity inputs are trimmed before their prefixes and safe identifier characters are validated, so incidental leading or trailing whitespace from CLI copy/paste does not cause a false rejection.

Prisma's PostgreSQL URL username is a database user shared by every credential for that database; it is not the `con_` connection-resource ID. The script therefore does not search either URL for `con_`. It requires the pooled and direct URLs to have the same database username and password, comparing the password only through process-local keyed proofs that are never printed. It independently requires the operator to confirm the database resource, `db_` database ID, and shared `con_` credential ID. The URL alone cannot cryptographically establish which `con_` resource issued its password. When stronger provider evidence is required, use authenticated Prisma metadata before this script: `npx prisma postgres connection list <database-id>` or the documented `GET /v1/connections?databaseId=<database-id>` REST operation can establish that a connection ID belongs to the database. Do not place API tokens or connection strings in this runbook or shell history.

The script confirms that the hosts are respectively `pooled.db.prisma.io` and `db.prisma.io`, and that both URLs name the same database while producing distinct endpoint fingerprints. It compares both fingerprints with the rehearsal resource, enforces TLS and `default_transaction_read_only=on`, verifies the exact nine migrations and their SQL checksums, checks the exact table inventory, and reports active transactions. Its top-level `try/finally` removes every temporary `PG*` value it creates on success, validation failure, query failure, or an interruption for which PowerShell executes cleanup. It never reads an environment file and contains no backup, restore, or migration command.

The identity-validation tests are entirely offline and make zero database connections:

```powershell
Set-Location 'C:\Users\BenEakin\Documents\onboarding-portal'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\production-prebackup-readonly.ps1 -OfflineSelfTest
```

`-ExecutionPolicy Bypass` applies only to this child PowerShell process; it does not change the machine or user execution policy.

The offline suite runs under Windows PowerShell 5.1 with `StrictMode` enabled. It exercises the same production query runner and result validators for zero, one, and multiple native-command rows; database identity; the exact nine migrations and checksums; table inventory; transaction summaries; native failures; malformed results; and cleanup after failure. Query results are normalized explicitly because Windows PowerShell otherwise unwraps a one-row pipeline result to a scalar string, on which `.Count` is unavailable under `StrictMode`. Database-stage failures include a sanitized stage and script call-site line number without including connection values.

Stop if the script does not end with `READ-ONLY PRODUCTION PRE-BACKUP VERIFICATION PASSED` and `Temporary PostgreSQL connection environment cleanup completed`. Record only its sanitized results. The script does not verify Vercel: independently confirm that live Production still serves commit `1abfcfeb9547fdd538c85dc29309ea4b455df4eb`.

The remaining masked-input procedure in this section is for the later, separately approved `pg_dump` session. Do not retain or reuse credentials from the read-only verification process.

In Prisma Console, open the exact resource `onboarding-portal-db`, select **Connect to your database**, and obtain a **direct** connection string. If a dedicated temporary credential is created for the backup, record its credential identifier and delete that credential after the archive and rehearsal evidence are secured. Generating or deleting a credential is a separately authorized provider action; it must not modify the Vercel Production environment variables.

The direct URL must use the provider's direct host (`db.prisma.io`), not `pooled.db.prisma.io`. Do not copy it into `.env`, `.env.local`, `.env.zoho-test.local`, `.env.zoho-rehearsal.local`, command history, documentation, or chat.

Open a fresh PowerShell window with transcription disabled. Paste the URL only into a masked prompt:

```powershell
function Set-PgEnvironmentFromSecureUrl {
  param(
    [Parameter(Mandatory)] [Security.SecureString] $SecureUrl,
    [Parameter(Mandatory)] [string] $ApplicationName
  )

  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureUrl)
  try {
    $raw = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $uri = [Uri]$raw
    if ($uri.Scheme -notin @('postgres', 'postgresql')) { throw 'Expected a PostgreSQL URL.' }
    if ($uri.Host -ne 'db.prisma.io') { throw 'Expected the Prisma Postgres direct host db.prisma.io.' }
    if ($uri.Query -notmatch '(^|[?&])sslmode=require(&|$)') { throw 'Provider-issued sslmode=require is required.' }

    $separator = $uri.UserInfo.IndexOf(':')
    if ($separator -lt 1) { throw 'Connection URL is missing credentials.' }
    $env:PGUSER = [Uri]::UnescapeDataString($uri.UserInfo.Substring(0, $separator))
    $env:PGPASSWORD = [Uri]::UnescapeDataString($uri.UserInfo.Substring($separator + 1))
    $env:PGHOST = $uri.Host
    $env:PGPORT = if ($uri.IsDefaultPort) { '5432' } else { [string]$uri.Port }
    $env:PGDATABASE = [Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/'))
    $env:PGSSLMODE = 'require'
    $env:PGCONNECT_TIMEOUT = '15'
    $env:PGAPPNAME = $ApplicationName

    $identityText = "$($env:PGUSER)@$($env:PGHOST):$($env:PGPORT)/$($env:PGDATABASE)"
    $bytes = [Text.Encoding]::UTF8.GetBytes($identityText)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
      $hash = $sha.ComputeHash($bytes)
      -join ($hash[0..7] | ForEach-Object { $_.ToString('x2') })
    } finally {
      $sha.Dispose()
    }
  } finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $raw = $null
  }
}

function Clear-PgEnvironment {
  'PGUSER','PGPASSWORD','PGHOST','PGPORT','PGDATABASE','PGSSLMODE','PGCONNECT_TIMEOUT','PGAPPNAME' |
    ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
}

$productionUrl = Read-Host 'Paste onboarding-portal-db DIRECT URL' -AsSecureString
$productionFingerprint = Set-PgEnvironmentFromSecureUrl -SecureUrl $productionUrl -ApplicationName 'kzero-production-backup'
$productionUrl.Dispose()
Remove-Variable productionUrl
"Production credential fingerprint: $productionFingerprint"
```

This outputs only a SHA-256 fingerprint of the non-password connection identity. It does not output the URL, username, or password. The password remains temporarily in the current process environment so libpq tools can authenticate without placing it on their command line. Close this PowerShell window after clearing the variables.

**Checkpoint C:** in Prisma Console, independently record that this credential belongs to `onboarding-portal-db`. Stop if the resource name, direct-host check, recorded credential identifier, or expected fingerprint evidence is uncertain.

## 5. Online production backup

The exact guarded PowerShell sequence is implemented by `scripts/run-production-online-backup.ps1` and documented in [production-backup-execution-procedure.md](./production-backup-execution-procedure.md). It is prepared but **not authorized by this task**. After all approval checkpoints pass, run it from the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\BenEakin\Documents\onboarding-portal\scripts\run-production-online-backup.ps1"
```

Do not manually paste the longer reference block.

PostgreSQL 17 `pg_dump` creates a transactionally consistent snapshot while ordinary readers and writers continue. Therefore the primary procedure does not require an all-traffic write freeze and does not collect separately timed production row counts for comparison with the archive. Those live observations would not share the archive's snapshot boundary.

The online procedure still requires an operational DDL freeze: no migration, `db push`, schema command, restore, table rewrite, index operation, or schema-changing deployment may overlap the dump. Immediately before `pg_dump`, it revalidates:

- the direct production fingerprint `574952707912a7c3`, direct host, TLS, and primary-server state;
- exactly migrations 1–9, their order, successful status, and SQL checksums;
- no unexplained transaction older than five minutes;
- no granted `ACCESS EXCLUSIVE` lock or ungranted lock for the production database;
- no blocked production-database session;
- no active DDL statement in the production database;
- no production activity row hidden by insufficient PostgreSQL monitoring permissions.

Stop and use the optional controlled-maintenance alternative if any online gate fails, load is unsafe, DDL cannot be excluded, or PostgreSQL must be coordinated atomically with external Blob object contents. The archive includes Blob metadata/references, not the Blob objects themselves.

The guarded archive operation is:

```powershell
& $pgDumpPath `
  --format=custom `
  --compress=9 `
  --lock-wait-timeout=30000 `
  --file=$dumpPath
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed. Do not continue.' }
```

It intentionally omits `--serializable-deferrable`; PostgreSQL documents that option as not beneficial for disaster-recovery dumps and potentially subject to an indefinite wait with active read-write transactions. The full execution block uses the exact resolved PostgreSQL 17 executable paths, the direct URL through masked process environment variables, `default_transaction_read_only=on` for source-side preflight, a database-scoped lock/activity query, `pg_restore --list`, SHA-256 evidence, and `finally` credential cleanup.

The custom archive includes the full database schema, data, sequences, constraints, large objects, and `_prisma_migrations`; no schema or table filter is used. Ownership and ACL portability are handled at restore with `--no-owner --no-privileges`.

**Checkpoint D:** the online risk gates, exact production identity, nine migrations, and checksums all pass. Stop on any difference.

The metadata records the expected rollback commit separately from the operator-confirmed live Vercel deployment ID, alias, commit, verification time, observed database results, and validated archive results. A hardcoded expected commit is never described as live-deployment verification.

**Checkpoint E:** `pg_dump` and `pg_restore --list` both exit `0`; the archive is non-empty; its SHA-256 is recorded; the restore list contains the protected application tables and `_prisma_migrations`; metadata is non-empty; temporary credentials are cleared. On any failure, no success evidence is created and partial artifacts are quarantined under `INVALID-PARTIAL`. Release the DDL freeze after validation. Ordinary application writes were not stopped.

### Optional controlled-maintenance alternative

Retain the stricter all-traffic freeze as an approved fallback. Keep the rollback deployment and Production alias unchanged, block portal/admin writes and other database writers, drain in-flight work, confirm the database is operationally quiet, run the same guarded custom dump, and release the freeze only after archive validation. This alternative provides operational quiet; it is not required for PostgreSQL snapshot consistency.

## 6. Create the independent rehearsal database

This is a manual Prisma Console/Vercel operation and is not authorized yet.

1. Create a new Prisma Postgres database named exactly `kzero-onboarding-rehearsal` in the appropriate KZero-controlled workspace and preferably the same region as production.
2. Do **not** attach it to the `onboarding-portal2.0` Production project or any Production environment.
3. If creation through Vercel would automatically inject credentials into the production project, stop and create it through Prisma Console or a separate non-production Vercel project instead.
4. Restrict Console/workspace access to the named rehearsal operators. This resource contains a full copy of production customer data.
5. Generate one dedicated rehearsal credential and securely save both its pooled and direct URLs.
6. Record the resource ID, region, credential identifier, creation time, and intended deletion date without recording secrets.

Create an ignored local file at:

```text
C:\Users\BenEakin\Documents\onboarding-portal\.env.zoho-rehearsal.local
```

Populate only rehearsal values:

```dotenv
ZOHO_PHASE7A_DATABASE_RESOURCE_NAME=kzero-onboarding-rehearsal
ZOHO_PHASE7A_DATABASE_URL=<rehearsal pooled URL>
ZOHO_PHASE7A_DIRECT_URL=<rehearsal direct URL>
ZOHO_PHASE7A_ISOLATED_CONFIRMATION=I_CONFIRM_KZERO_ONBOARDING_REHEARSAL_IS_ISOLATED
ZOHO_PHASE7A_BACKUP_RESTORE_REFERENCE=
ZOHO_PHASE7A_BACKUP_RESTORE_CONFIRMED=
ZOHO_PHASE7A_BACKUP_SOURCE_RESOURCE_NAME=onboarding-portal-db
ZOHO_PHASE7A_BACKUP_ARCHIVE_SHA256=
ZOHO_PHASE7A_PRODUCTION_DATABASE_FINGERPRINT=
ZOHO_PHASE7A_PRODUCTION_DIRECT_DATABASE_FINGERPRINT=
ZOHO_PHASE7A_REHEARSAL_MIGRATION_CONFIRMATION=
```

The repository ignores `.env*`; verify before adding credentials:

```powershell
git check-ignore -v .env.zoho-rehearsal.local
git status --short -- .env.zoho-rehearsal.local
npm.cmd run check:zoho-production-rehearsal-config
```

The last command is offline and must report `connected: false`, `resourceName: kzero-onboarding-rehearsal`, and `targetProfile: rehearsal`. It must not report the existing `kzero-onboarding-zoho-testing` resource.

## 7. Destination identity and empty-database check

The guarded restore entrypoint performs the destination identity, emptiness, archive, restore, and post-restore baseline checks as one operation. Do not paste the older manual restore block or load either database URL from an environment file. Before starting, obtain these independent facts from the authenticated Prisma Console and retain them in the protected operator evidence record:

- resource name exactly `kzero-onboarding-rehearsal`;
- its `db_` database ID and `con_` connection ID;
- pooled fingerprint `08ff4f34119b6190` and direct fingerprint `d68f44858bab013e` from the already-approved rehearsal preflight;
- confirmation that this resource is not attached to any live application, Preview deployment, cron, webhook, Zoho integration, or email automation;
- a fresh rehearsal **direct** URL from that same independently identified resource.

The archive is fixed to:

`C:\KZeroSecureBackups\kzero-onboarding-production-backup-20261110-204450Z\onboarding-portal-db-20261110-213753Z.dump`

Its required SHA-256 is:

`F902E6744F652C95C904CD3604BDA9D32B08DD9206A4624C7909AFC89CD11923`

Because Prisma Postgres resources commonly report database `postgres` on shared hosts, PostgreSQL output alone cannot cryptographically bind the entered URL to a Prisma `db_` or `con_` identifier. The script therefore combines the exact verified connection fingerprint with independently obtained Console resource evidence and explicit operator confirmation. Stop if the Console evidence cannot be established.

Immediately before restore, the script requires zero objects in the public schema, zero non-system tables, no `_prisma_migrations` table, and no other client session connected to the target database. It rejects the recorded Production fingerprints and any direct URL that does not produce the exact rehearsal direct fingerprint. That exact-match rule also prevents using the preserved `kzero-onboarding-zoho-testing` credential.

**Checkpoint F:** Console says `kzero-onboarding-rehearsal`; it is not attached to any application or automation; the independently recorded IDs are present; both rehearsal fingerprints match; PostgreSQL is version 17; no public object, non-system table, migration table, or competing client session exists. Stop if any condition fails.

## 8. Guarded restore

First run the offline Windows PowerShell 5.1 suite:

```powershell
npm.cmd run test:production-rehearsal-restore-offline
```

After separate restore approval, run from the repository root in a clean Windows PowerShell 5.1 process:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-production-rehearsal-restore.ps1
```

The direct URL is entered through a masked `SecureString` prompt and is converted only in memory to libpq environment variables. It is never supplied as a process argument. The entrypoint uses PostgreSQL 17 `pg_restore` with `--single-transaction --exit-on-error --no-owner --no-privileges`; it does not use `--clean`, `--create`, or run `ANALYZE`. A restore error is terminal: do not retry and do not reset the database. Provisioning a replacement empty rehearsal resource requires a separate exact-resource approval.

**Checkpoint G:** `RestoreSucceeded` is `True` only after the archive hash/list, target identity/emptiness, transactional restore, exact nine-migration history/checksums, exact baseline table inventory, and restored MSP/plan/task presence have all passed. `CredentialCleanupCompleted` must be `True`, `Migrations10Through13Applied` and `ExternalAutomationInvoked` must be `False`. No external Blob object is read or changed.

## 9. Restore verification before migrations

The restored rehearsal database is the authoritative representation of the `pg_dump` snapshot. Do not compare it with live production counts gathered before or after the dump: production may have accepted valid concurrent commits on either side of the snapshot boundary.

The restore entrypoint already performs the first post-restore identity, migration, checksum, table, and protected-record presence verification. Record its sanitized result. It intentionally does not set backup-restore evidence variables and does not apply migrations 10–13. After credentials have been removed from the process, place the rehearsal pooled/direct URLs into the already ignored `.env.zoho-rehearsal.local` only for the separately approved harness verification, then run:

```powershell
npm.cmd run preflight:zoho-production-rehearsal-db
```

Expected before migration:

- exactly nine successful Prisma migrations ending at `20260715153000_add_document_storage_fields`;
- no failed or rolled-back migration;
- the baseline application tables are present;
- zero Zoho migrations are present.

The migration rehearsal itself captures counts and SHA-256 digests of protected pre-Zoho columns from the restored snapshot before applying anything, then captures and compares the same protected state after migrations 10–13. Coverage includes:

- MSP records;
- NFR and Customer Plan IDs, status, stage, progress, counts, and pilot data;
- task IDs, ownership, statuses, order, and existing timestamps;
- SaaS application submissions;
- document metadata and storage references;
- encrypted OIDC configuration;
- admin notifications and read state.

**Checkpoint H:** archive hash and restored resource identity match their approved evidence; the restored database has exactly the nine-migration baseline with matching checksums; all protected tables are present; baseline protected counts/digests have been captured from the restored snapshot; and the rehearsal resource remains isolated. Only then may the backup restore be marked verified. No claim is made that a separately timed live production count must match.

Set these values in `.env.zoho-rehearsal.local` using the approved dump SHA-256 or immutable evidence record, never a credential:

```dotenv
ZOHO_PHASE7A_BACKUP_RESTORE_REFERENCE=<approved dump SHA-256/evidence reference>
ZOHO_PHASE7A_BACKUP_RESTORE_CONFIRMED=I_CONFIRM_PHASE7A_BACKUP_RESTORE_VERIFIED
ZOHO_PHASE7A_BACKUP_SOURCE_RESOURCE_NAME=onboarding-portal-db
ZOHO_PHASE7A_BACKUP_ARCHIVE_SHA256=<64-character SHA-256 of the verified custom-format archive>
ZOHO_PHASE7A_PRODUCTION_DATABASE_FINGERPRINT=<16-character fingerprint recorded during production backup preflight>
ZOHO_PHASE7A_PRODUCTION_DIRECT_DATABASE_FINGERPRINT=<16-character direct fingerprint recorded during production backup preflight>
ZOHO_PHASE7A_REHEARSAL_MIGRATION_CONFIRMATION=I_CONFIRM_REHEARSAL_9_TO_13_MIGRATION
```

## 10. Rehearse migrations 10–13

The restored database must begin with exactly migrations 1–9. Prisma must then apply these four pending migrations in this immutable repository order:

```text
10  20261104150000_add_zoho_phase_1a_foundation
11  20261104210000_add_zoho_phase_4_dispatcher
12  20261105120000_add_zoho_phase_5_nudge_engine
13  20261106150000_add_staff_sso_configuration
```

Stop if migration history contains any additional, failed, rolled-back, reordered, or edited migration. Record SHA-256 hashes of all four `migration.sql` files in the protected rehearsal evidence before execution.

**Harness status:** the harness now has separate exact profiles for the nine-migration restored baseline, the preserved historical 12-migration test resource, and the complete 13-migration rehearsal result. Rehearsal mode is rejected for the historical test profile. Before authorizing execution, review and pass `npm.cmd run test:zoho-phase-7a-safety`; do not edit migration history, skip migration 13, or weaken database-identity safeguards as a workaround.

Run only after Checkpoint H and separate migration-rehearsal approval:

```powershell
npm.cmd run rehearse:zoho-production-snapshot
```

The command must:

1. identify only `kzero-onboarding-rehearsal`;
2. require the exact nine-migration baseline;
3. snapshot protected counts and SHA-256 digests;
4. run `prisma migrate deploy` through the rehearsal direct URL;
5. require exactly 13 migrations in repository order;
6. fail if any protected count or digest changes;
7. run the read-only Phase 1A verifier;
8. run the real PostgreSQL integration suite using only uniquely prefixed fixtures, including the Staff SSO schema checks below.

After a successful rehearsal, the same tests can be rerun with:

```powershell
npm.cmd run test:zoho-production-rehearsal-db
```

Expected final migration:

```text
20261106150000_add_staff_sso_configuration
```

Expected automation safety state:

- all historical plans are `LEGACY` and `EXCLUDED`;
- `automaticJ1Allowed=false`;
- no historical task timestamps are invented;
- no contacts, communication contexts, outbox events, journey sends, audits, nudge runs, nudge decisions, Staff SSO configurations, staff identities, or Staff SSO audits are created by migration;
- all Zoho external-write flags remain disabled.

### Migration 13 Staff SSO schema verification

The rehearsal must verify migration `20261106150000_add_staff_sso_configuration` after migrations 10, 11, and 12. It is additive and must create exactly these empty tables:

- `staff_sso_configurations`
- `staff_identities`
- `staff_sso_audits`

It must also create enum types `StaffSsoStatus` (`DRAFT`, `VALIDATED`, `ENABLED`, `DISABLED`) and `StaffApplicationRole` (`ADMIN`, `SALES_ENGINEER`, `VIEWER`). Verify the primary keys, the unique constraint/index on `staff_identities(issuer, subject)`, the role/active lookup index, both audit indexes, and the two foreign keys to `staff_sso_configurations(id)` with `ON DELETE CASCADE` and `ON UPDATE CASCADE`.

Extend the guarded PostgreSQL rehearsal suite before execution so it verifies:

1. all three Staff SSO tables are initially empty after migration;
2. a draft configuration can be inserted and rolled back without residue;
3. an identity cannot reference a missing configuration;
4. duplicate `(issuer, subject)` identities are rejected;
5. valid `ADMIN`, `SALES_ENGINEER`, and `VIEWER` rows persist, while invalid enum values are rejected;
6. configuration deletion cascades only to its test identities/audits;
7. an injected failure rolls back configuration, identity, and audit writes atomically;
8. test cleanup removes only uniquely prefixed rehearsal fixtures;
9. no plaintext client secret is stored—the database contains only the encrypted value, IV, and authentication tag produced by the application using a rehearsal-only encryption key.

Do not point these fixture-producing checks at production. Do not reuse the existing `kzero-onboarding-zoho-testing` resource; run them only on the independently verified restored-snapshot rehearsal resource or on a disposable clone of it.

### Rolled-back application compatibility check

After the final migration count reaches 13, keep commit `1abfcfe` running against a disposable clone of the migrated rehearsal database and repeat the dashboard, NFR portal, Customer portal, task completion, documents, SaaS applications, MSP/customer OIDC, and notification smoke tests. The old application must ignore the added Zoho and Staff SSO objects. Any failure blocks production approval; do not work around it by dropping migration-13 objects.

Prepare that runtime check as follows, but do not execute it until the 9-to-13 rehearsal has passed:

1. Create a second disposable database from the successfully migrated rehearsal evidence. It must not be Production, `kzero-onboarding-zoho-testing`, or the protected primary rehearsal resource used for digest evidence.
2. Verify its pooled/direct identity and exact 13-migration history with the same safety rules.
3. Create a detached Git worktree outside the main working tree at exact commit `1abfcfe`; record `git rev-parse HEAD` from that worktree.
4. Install/build that commit without changing the current worktree or Production deployment settings.
5. Supply the disposable clone's pooled URL only to the isolated runtime process. Do not place production or rehearsal credentials in Git, command arguments, or the old worktree's tracked files.
6. Keep every Zoho flag disabled and do not configure Staff SSO in the old application.
7. Run read-only dashboard/portal/OIDC/document/application/notification smoke checks first. Use only uniquely prefixed synthetic records for mutation checks and remove only those records afterward.
8. Capture sanitized route results, the exact commit, database fingerprints, and migration count. A build-only result is insufficient: the server must execute its real Prisma queries against the disposable 13-migration clone.
9. Remove the detached worktree and disposable compatibility database only after evidence review and an exact resource-identity recheck.

This compatibility procedure is a separately authorized future database/runtime operation. The current harness update does not create the clone, worktree, records, or connections.

## 11. Data protection and cleanup

- Treat the rehearsal database as production-confidential data.
- Grant access only to named operators; do not attach it to Preview or Production applications during the migration rehearsal.
- Do not call Zoho, send email, enable cron, or run test fixtures that use real recipient addresses.
- Keep all Zoho flags at the dormant values documented in `production-recovery-plan.md`.
- Record an owner and deletion deadline before creating the resource.
- After evidence is approved and retention requirements expire, delete the exact `kzero-onboarding-rehearsal` resource through an authorized Console/CLI action only after re-verifying its resource ID. Never delete by a computed or partial name.
- Delete local dump/manifests using the organization's approved secure-erasure/retention procedure. Ordinary deletion is not guaranteed secure on SSDs; encryption-key destruction or managed encrypted-storage retention is preferred.
- Delete the dedicated temporary source credential after the backup is verified, without rotating or changing the credential used by Production.
- Clear all `PG*` variables and close the PowerShell session:

  ```powershell
  Clear-PgEnvironment
  exit
  ```

## 12. Stop conditions

Stop immediately if:

- Production no longer serves commit `1abfcfe`;
- a new Production deployment replaced the rollback;
- the production resource is not exactly `onboarding-portal-db`;
- production migration history is not exactly 1–9;
- PostgreSQL tools are not version 17;
- either URL is pooled or is shown in output/history;
- source and destination fingerprints match;
- the destination is not exactly `kzero-onboarding-rehearsal` or is attached to Production;
- the destination contains any application table before restore;
- dump/hash/archive validation fails;
- restore reports any error;
- restored baseline migration history is not exactly 1–9, final history is not exactly 1–13, or protected restored-snapshot counts/digests change across migrations 10–13;
- the guarded offline safety suite fails or the Staff SSO database checks are absent;
- any required Staff SSO table, enum, index, unique constraint, or foreign key is missing or differs from migration 13;
- any Staff SSO table is non-empty immediately after migration, before uniquely prefixed test fixtures are created;
- commit `1abfcfe` fails its smoke test against the expanded 13-migration schema;
- the protected pre/post migration comparator reports any difference;
- any Zoho sending/dispatch/nudge flag is enabled.

This runbook ends at rehearsal. It does not authorize migrating `onboarding-portal-db`, promoting any updated application commit, changing Production environment variables, enabling Staff SSO, or enabling external Zoho automation.
