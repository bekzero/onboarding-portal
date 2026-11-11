# First protected production backup execution procedure

Status: **prepared for operator review; no database operation has been run**

This is the primary online-backup procedure for `onboarding-portal-db`. PostgreSQL 17 `pg_dump` takes a transactionally consistent snapshot while ordinary readers and writers continue. The procedure does not compare separately timed live row counts with the archive. Snapshot counts and digests are established only after restore into `kzero-onboarding-rehearsal`.

The stricter controlled-maintenance alternative remains in [production-backup-rehearsal-runbook.md](./production-backup-rehearsal-runbook.md). Use it if the online safety gates below cannot be met.

## Confirmed identity evidence

- Production resource: `onboarding-portal-db`
- Production baseline: exactly nine successful migrations with matching SQL checksums
- Production pooled fingerprint: `8c19783b98dac1b0`
- Production direct fingerprint: `574952707912a7c3`
- Rehearsal resource: `kzero-onboarding-rehearsal`
- Rehearsal fingerprints: pooled `08ff4f34119b6190`, direct `d68f44858bab013e`
- PostgreSQL client tools: 17.11
- Production server: 17.2
- Active rollback commit: `1abfcfeb9547fdd538c85dc29309ea4b455df4eb`

Fingerprints and resource IDs are identifiers, not credentials. The archive remains confidential production data.

## 1. Is an online backup appropriate?

Yes, provided every gate below passes. PostgreSQL documents that `pg_dump` produces consistent backups while a database is concurrently used and does not block ordinary readers or writers. The custom archive contains the snapshot selected by `pg_dump`, not a blend of rows observed at different times.

Ordinary transactional portal writes may continue, including task updates, admin changes, document metadata changes, and SaaS submissions. The snapshot contains transactions committed before its snapshot boundary and excludes later or uncommitted changes.

Stop and use the controlled-maintenance alternative if any condition applies:

- a Prisma migration, `db push`, schema change, index operation, table rewrite, restore, or deployment that changes database structure may overlap the dump;
- an `ACCESS EXCLUSIVE` lock is granted or waiting;
- a transaction has been open longer than the approved five-minute threshold and cannot be explained safely;
- the database is a standby (`pg_is_in_recovery()` is true), or identity/migration/checksum evidence changed;
- the direct connection, TLS, production fingerprint, tool version, archive destination, or available disk space cannot be verified;
- the application requires an atomic backup of PostgreSQL plus external Vercel Blob object contents. `pg_dump` includes document metadata and Blob references, not Blob objects;
- provider load, latency, or errors make the additional sequential dump connection unsafe;
- an untrusted source database administrator could have created malicious database objects. PostgreSQL warns that restores execute source-defined code; restoration is permitted only from this trusted KZero source into the isolated target.

Active short-lived background writers are not by themselves unsafe. They can increase load. No schema-changing job may run, and all Zoho dispatch, email, cron, and Staff SSO activation controls must remain disabled.

The command uses `--lock-wait-timeout=30000`, so it fails rather than waiting indefinitely on a conflicting schema lock. It intentionally does not use `--serializable-deferrable`: PostgreSQL states that option is not beneficial for disaster-recovery dumps and can delay startup indefinitely when read-write transactions are active. The default `pg_dump` snapshot is the required consistent restore baseline.

## 2. Preparation and manual approval

Before preparing storage, run the offline Windows PowerShell 5.1 suite:

```powershell
Set-Location 'C:\Users\BenEakin\Documents\onboarding-portal'
npm.cmd run test:production-online-backup-offline
```

It uses disposable local fixtures and mocks to exercise the same exported functions used by the operator procedure. It makes no PostgreSQL connection and invokes no dump or restore operation. Stop unless every case passes.

1. Record the active Vercel Production deployment ID, alias, commit, and UTC time. Do not deploy, promote, migrate, or change Vercel settings.
2. Establish an operational **DDL freeze** for the dump window: no migration, schema command, Prisma Studio write, restore, or deployment. Ordinary application data writes may continue.
3. Confirm no production cron and record the dormant Zoho/Staff SSO flags.
4. Select an approved BitLocker-encrypted or equivalent access-restricted destination outside Git and consumer sync folders.
5. Record the operator, approval reference, recovery owner, destination, planned start time, and the independently confirmed production `db_` and `con_` IDs.
6. Confirm `kzero-onboarding-rehearsal` and `kzero-onboarding-zoho-testing` are not connected to Production. This backup procedure connects to neither.

Prepare the local destination in a fresh Windows PowerShell 5.1 window with transcription disabled. The preparation script uses the same functions covered by the offline test suite. It does not connect to PostgreSQL:

```powershell
Set-Location 'C:\Users\BenEakin\Documents\onboarding-portal'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\prepare-production-online-backup.ps1
```

The script prompts for an existing absolute local parent directory, the exact `pg_database_size(...)` byte value from approved production read-only evidence, and that evidence's reference/UTC timestamp. It calculates the minimum free-space threshold as three times the observed database size, then creates a new timestamped child directory. It rejects `C:backup`, UNC paths, drive roots, repository paths, existing targets, and any parent/child path containing a reparse point. It never changes the parent directory ACL.

Encryption is verified with `Get-BitLockerVolume`, not only a command exit code. The returned mount point must be the destination volume, `VolumeStatus` must be `FullyEncrypted`, `ProtectionStatus` must be `On`, and `EncryptionPercentage` must be `100`. If this cmdlet is unavailable or the organization uses approved non-BitLocker encrypted storage, stop and obtain a separately reviewed equivalent verifier; do not bypass the check.

The dedicated child directory has inheritance removed and grants only the named operator and `NT AUTHORITY\SYSTEM`; the resulting ACL is read back and verified. Available space must meet the three-times threshold. The backup block recalculates that threshold from the recorded size and refuses altered or incomplete preparation evidence.

No current production database-size byte value is stored in this repository. Therefore headroom is **not yet confirmed for the real destination**. Obtain and approve the exact size evidence before running preparation; do not guess it or reuse an old human-readable `pg_size_pretty` value.

The script resolves only these executables and requires each to report major version 17:

```text
C:\Program Files\PostgreSQL\17\bin\pg_dump.exe
C:\Program Files\PostgreSQL\17\bin\pg_restore.exe
C:\Program Files\PostgreSQL\17\bin\psql.exe
```

It writes `preparation-evidence.json` inside the protected directory with `databaseConnected=false` and `backupExecuted=false`.

### Approval checkpoint

An authorized operator must explicitly approve the DDL freeze, encrypted destination, production direct credential association, expected fingerprint, online risk observations, and recovery owner. Do not proceed on verbal assumptions or if an overlapping deployment/migration cannot be ruled out.

## 3. Guarded online backup commands

Use only the verified production direct URL. Paste it into the masked prompt. It must never appear in a command argument, file, transcript, log, documentation, or chat.

After the preparation and approval checkpoints pass, execute the complete guarded procedure with one command from the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\BenEakin\Documents\onboarding-portal\scripts\run-production-online-backup.ps1"
```

If a source-identity check needs to be repeated before authorizing another backup attempt, use the diagnostic-only form first:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\BenEakin\Documents\onboarding-portal\scripts\run-production-online-backup.ps1" -IdentityDiagnosticOnly
```

This mode performs the same local storage, deployment-evidence, credential, TLS, and fingerprint gates, then executes only the read-only source identity query. It returns before migration checks, online-risk checks, `pg_dump`, `pg_restore --list`, or artifact creation. Failure output contains only sanitized booleans/counts and the failed comparison name; it never includes the connection URL, password, token, or database username.

To inspect the online lock/activity gates without allowing a backup to start, use:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\BenEakin\Documents\onboarding-portal\scripts\run-production-online-backup.ps1" -RiskDiagnosticOnly
```

Risk-only mode performs the same local storage, deployment-evidence, credential, TLS, fingerprint, and source-identity gates. It then runs only the read-only, count-based activity/lock diagnostic and returns before migration inspection, `pg_dump`, `pg_restore --list`, or artifact creation. It never returns other sessions' SQL text, usernames, or customer data.

The visibility classifier recognizes only the observed Prisma Postgres provider workers `ppg_archiver_guard`, `ppg_metrics`, and `ppg_storage_guard` when each has its documented observed shape: `state` is null while username and query visibility remain present. Their null state is not treated as hidden client activity. They are not removed from the source set: long transactions, `AccessExclusiveLock` entries, waiting locks, blocking, and active DDL checks still cover them. A client backend with missing state/username/query evidence is counted as `hiddenClientSessions`; an absent, unrecognized, or unexpectedly shaped backend type is counted as `unknownBackendSessions` and fails closed. Full visibility also continues to require `pg_read_all_stats` membership or superuser evidence; those flags alone cannot override hidden clients, unknown backends, or any safety counter.

The script requires explicit DDL/deployment-freeze and production-source confirmation phrases before it accepts the masked direct URL. A cancelled or empty prompt fails before `Invoke-GuardedBackupCore` can start `pg_dump`. The script reports `BackupSucceeded : True` only after the archive, restore list, metadata, and their validation have completed.

The block below is retained only as an auditable mapping of the reviewed checks. Operators must use the executable script above rather than pasting this block.

<details>
<summary>Reviewed guarded logic reference</summary>

```powershell
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path 'C:\Users\BenEakin\Documents\onboarding-portal').Path
Import-Module (Join-Path $repoRoot 'scripts\production-online-backup-support.psm1') -Force

$expectedDirectFingerprint = '574952707912a7c3'
$forbiddenFingerprints = @('08ff4f34119b6190','d68f44858bab013e')
$expectedCommit = '1abfcfeb9547fdd538c85dc29309ea4b455df4eb'
$expectedMigrations = @(
  '20260617185715_init',
  '20260617194303_add_admin_reporting_fields',
  '20260617194747_add_onboarding_plan_reporting_fields',
  '20260619110000_add_first_customer_pilot_fields',
  '20260625143000_add_admin_notifications',
  '20260703120000_add_msp_enrollment_date',
  '20260713120000_add_msp_gmm_partner_flag',
  '20260715120000_add_customer_name_to_onboarding_plan',
  '20260715153000_add_document_storage_fields'
)
$pgVariables = @('PGAPPNAME','PGCONNECT_TIMEOUT','PGDATABASE','PGHOST','PGOPTIONS','PGPASSWORD','PGPORT','PGSSLMODE','PGUSER')
$requiredTables = @('_prisma_migrations','msps','onboarding_plans','onboarding_tasks','saas_app_submissions','documents','oidc_configs','admin_notifications')

$backupRootInput = Read-Host 'Prepared dedicated backup directory from preparation-evidence.json'
$backupRoot = (Resolve-Path -LiteralPath (Get-NormalizedAbsoluteLocalPath $backupRootInput) -ErrorAction Stop).Path
Assert-PathOutsideRepository -Path $backupRoot -RepositoryRoot $repoRoot
Assert-NoReparsePointPath -Path $backupRoot
if ((Split-Path -Leaf $backupRoot) -notmatch '^kzero-onboarding-production-backup-\d{8}-\d{6}Z$') {
  throw 'Backup directory is not a dedicated preparation-script directory.'
}
$preparationEvidencePath = Join-Path $backupRoot 'preparation-evidence.json'
if (-not (Test-Path -LiteralPath $preparationEvidencePath -PathType Leaf)) { throw 'Preparation evidence is missing.' }
$preparationEvidence = Get-Content -LiteralPath $preparationEvidencePath -Raw | ConvertFrom-Json
if ($preparationEvidence.backupRoot -ne $backupRoot -or $preparationEvidence.databaseConnected -ne $false -or $preparationEvidence.backupExecuted -ne $false) {
  throw 'Preparation evidence does not match this unused backup directory.'
}
$requiredSizeProperties = @('observedProductionDatabaseSizeBytes','databaseSizeEvidenceReference','freeSpaceHeadroomMultiplier','requiredFreeBytes')
foreach ($property in $requiredSizeProperties) {
  if ($preparationEvidence.PSObject.Properties.Name -notcontains $property) { throw "Preparation evidence is missing $property." }
}
$calculatedFreeBytes = Get-RequiredBackupFreeBytes -ObservedDatabaseSizeBytes ([long]$preparationEvidence.observedProductionDatabaseSizeBytes) -HeadroomMultiplier ([int]$preparationEvidence.freeSpaceHeadroomMultiplier)
if ([string]::IsNullOrWhiteSpace([string]$preparationEvidence.databaseSizeEvidenceReference) -or $calculatedFreeBytes -ne [long]$preparationEvidence.requiredFreeBytes) {
  throw 'Approved database-size evidence or free-space headroom is invalid.'
}
$volume = @(Get-BitLockerVolume -MountPoint ([IO.Path]::GetPathRoot($backupRoot)).TrimEnd('\') -ErrorAction Stop)
if ($volume.Count -ne 1) { throw 'Could not identify exactly one BitLocker destination volume.' }
Assert-BitLockerProtection -Path $backupRoot -Volume $volume[0]
$operator = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ([string]::IsNullOrWhiteSpace($operator)) { throw 'Authenticated Windows operator identity is unavailable.' }
Assert-RestrictedBackupAcl -Acl (Get-Acl -LiteralPath $backupRoot) -AllowedIdentities @($operator,'NT AUTHORITY\SYSTEM')
$destinationDrive = New-Object IO.DriveInfo -ArgumentList ([IO.Path]::GetPathRoot($backupRoot))
$availableFreeBytes = $destinationDrive.AvailableFreeSpace
if ($availableFreeBytes -lt [long]$preparationEvidence.requiredFreeBytes) { throw 'Available space fell below the approved preparation threshold.' }

$tools = Resolve-Postgres17Tools -BinPath 'C:\Program Files\PostgreSQL\17\bin'
$psqlPath = $tools.psql
$pgDumpPath = $tools.pg_dump
$pgRestorePath = $tools.pg_restore
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmssZ')
$dumpPath = Join-Path $backupRoot "onboarding-portal-db-$stamp.dump"
$listPath = Join-Path $backupRoot "onboarding-portal-db-$stamp.restore-list.txt"
$metadataPath = Join-Path $backupRoot "onboarding-portal-db-$stamp.metadata.json"

foreach ($name in $pgVariables + @('PGPASSFILE','PGSERVICE','PGSERVICEFILE')) {
  if (Test-Path "Env:$name") { throw "Open a clean PowerShell session; $name is already set." }
}
foreach ($path in @($dumpPath,$listPath,$metadataPath)) {
  if (Test-Path -LiteralPath $path) { throw "Refusing to overwrite: $path" }
}

$secureUrl = $null
$pointer = [IntPtr]::Zero
$rawUrl = $null
$backupSucceeded = $false
try {
  $databaseId = (Read-Host 'Confirmed production Prisma database ID (db_)').Trim()
  $connectionId = (Read-Host 'Confirmed production Prisma connection ID (con_)').Trim()
  if ($databaseId -notmatch '^db_[A-Za-z0-9][A-Za-z0-9_-]*$') { throw 'Invalid production database ID.' }
  if ($connectionId -notmatch '^con_[A-Za-z0-9][A-Za-z0-9_-]*$') { throw 'Invalid production connection ID.' }
  if ((Read-Host 'Type I_CONFIRM_ONLINE_BACKUP_FROM_ONBOARDING_PORTAL_DB') -ne 'I_CONFIRM_ONLINE_BACKUP_FROM_ONBOARDING_PORTAL_DB') {
    throw 'Online backup confirmation was not supplied.'
  }

  $liveDeploymentId = (Read-Host 'Operator-confirmed live Vercel Production deployment ID').Trim()
  $liveDeploymentCommit = (Read-Host 'Operator-confirmed live Production commit SHA').Trim().ToLowerInvariant()
  $liveDeploymentAlias = (Read-Host 'Operator-confirmed live Production alias').Trim()
  $liveDeploymentVerifiedUtcText = (Read-Host 'UTC verification time in ISO 8601 format').Trim()
  $liveDeploymentVerifiedUtc = [DateTimeOffset]::MinValue
  if ([string]::IsNullOrWhiteSpace($liveDeploymentId) -or [string]::IsNullOrWhiteSpace($liveDeploymentAlias)) { throw 'Live deployment ID and alias evidence are required.' }
  if ($liveDeploymentCommit -ne $expectedCommit) { throw 'Operator-confirmed live commit is not the approved rollback commit.' }
  if (-not [DateTimeOffset]::TryParse($liveDeploymentVerifiedUtcText,[ref]$liveDeploymentVerifiedUtc)) { throw 'Live deployment verification time is invalid.' }

  $secureUrl = Read-Host 'Paste onboarding-portal-db DIRECT URL' -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
  $rawUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $uri = [Uri]$rawUrl
  if ($uri.Scheme -notin @('postgres','postgresql')) { throw 'Expected a PostgreSQL URL.' }
  if ($uri.Host -ne 'db.prisma.io') { throw 'Expected direct host db.prisma.io.' }
  if ($uri.Port -ne 5432 -and -not $uri.IsDefaultPort) { throw 'Expected PostgreSQL port 5432.' }
  if ($uri.Query -notmatch '(^|[?&])sslmode=require(&|$)') { throw 'sslmode=require is mandatory.' }
  $separator = $uri.UserInfo.IndexOf(':')
  if ($separator -lt 1) { throw 'Direct URL is missing credentials.' }

  $env:PGUSER = [Uri]::UnescapeDataString($uri.UserInfo.Substring(0,$separator))
  $env:PGPASSWORD = [Uri]::UnescapeDataString($uri.UserInfo.Substring($separator + 1))
  $env:PGHOST = $uri.Host
  $env:PGPORT = '5432'
  $env:PGDATABASE = [Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/'))
  $env:PGSSLMODE = 'require'
  $env:PGCONNECT_TIMEOUT = '15'
  $env:PGAPPNAME = 'kzero-online-production-backup'
  $env:PGOPTIONS = '-c default_transaction_read_only=on'

  $identityText = "$($env:PGUSER.ToLowerInvariant())@$($env:PGHOST.ToLowerInvariant()):$($env:PGPORT)/$($env:PGDATABASE.ToLowerInvariant())"
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($identityText))
    $directFingerprint = -join ($hash[0..7] | ForEach-Object { $_.ToString('x2') })
  } finally { $sha.Dispose() }
  if ($directFingerprint -ne $expectedDirectFingerprint) { throw 'Direct fingerprint is not the verified production fingerprint.' }
  if ($forbiddenFingerprints -contains $directFingerprint) { throw 'Production fingerprint collides with rehearsal evidence.' }

  $result = Invoke-GuardedBackupCore `
    -RepositoryRoot $repoRoot -BackupRoot $backupRoot -DumpPath $dumpPath -RestoreListPath $listPath -MetadataPath $metadataPath `
    -PsqlPath $psqlPath -PgDumpPath $pgDumpPath -PgRestorePath $pgRestorePath `
    -ExpectedMigrations $expectedMigrations -RequiredTables $requiredTables -ExpectedDatabaseName $env:PGDATABASE `
    -DirectFingerprint $directFingerprint `
    -ExpectedEvidence @{ resource='onboarding-portal-db'; directFingerprint=$expectedDirectFingerprint; rollbackCommit=$expectedCommit; migrationCount=9; requiredFreeBytes=[long]$preparationEvidence.requiredFreeBytes; observedProductionDatabaseSizeBytes=[long]$preparationEvidence.observedProductionDatabaseSizeBytes; freeSpaceHeadroomMultiplier=[int]$preparationEvidence.freeSpaceHeadroomMultiplier } `
    -OperatorConfirmedDeployment @{ deploymentId=$liveDeploymentId; alias=$liveDeploymentAlias; commit=$liveDeploymentCommit; verificationUtc=$liveDeploymentVerifiedUtc.ToUniversalTime().ToString('o'); verifiedBy=$operator } `
    -ObservedConnection @{ databaseId=$databaseId; connectionId=$connectionId }
  $backupSucceeded = $true
  $result | Format-List
} finally {
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  if ($null -ne $secureUrl) { $secureUrl.Dispose() }
  $rawUrl = $null
  Clear-ProductionBackupPgEnvironment
  Write-Output 'Temporary PostgreSQL connection environment cleanup completed.'
}
```

</details>

Do not claim success unless the block reports `BackupSucceeded : True`, `pg_dump` and `pg_restore --list` exit zero, the archive is nonempty, required table data appears in the list, SHA-256 values are recorded, and stderr contains no unresolved warning. A dump, restore-list validation, or metadata failure leaves no success metadata: any partial archive and related evidence are moved under the protected directory's `INVALID-PARTIAL` subdirectory and explicitly marked invalid. Do not restore, hash as approved evidence, or reuse those artifacts. Retain them only for the approved diagnostic/secure-disposal period.

Preserve the DDL freeze until the dump and archive validation finish; then release it. Ordinary application writes did not need to stop.

The source identity/migration/risk queries are observations immediately before the dump. They are not the archive snapshot boundary and are not row-count evidence. Do not compare live production counts collected before or after the dump with restored counts.

## 4. Archive protection and structural validation

Retain together on approved encrypted storage:

- custom archive, byte length, and SHA-256;
- `pg_restore --list` output and SHA-256;
- sanitized metadata JSON that separately records expected values, operator-confirmed live deployment evidence, observed database results, and validated archive results;
- DDL-freeze approval, start/end, tool versions, operator, destination ACL/encryption evidence, and any warnings.

Make the archive immutable under the approved storage process. Hash any approved copy and require an exact match. Do not put it in Git, Vercel artifacts, chat, tickets, or unapproved cloud storage.

`pg_restore --list` proves the custom archive is readable and structurally contains expected objects. Only a later successful isolated restore proves operational restorability.

## 5. Optional controlled-maintenance alternative

Use the existing all-traffic freeze procedure if online gates fail, the production load is too high, concurrent DDL cannot be excluded, a long-running transaction cannot be resolved, or the recovery objective requires separately collected source observations to remain stable. Keep the rollback deployment and alias unchanged. Block all traffic, drain in-flight work, confirm zero active transactions twice, run the same guarded dump, validate/hash it, and release the freeze only after evidence succeeds.

This alternative is stricter, not more transactionally consistent than `pg_dump` itself. It is useful for operational quiet and external-system coordination.

## 6. Isolated restore and snapshot-based migration comparison

No restore or migration is authorized by this procedure. When separately approved:

1. Recompute the archive SHA-256 and require the approved value.
2. Run `npm.cmd run check:zoho-production-rehearsal-config`; it must report `connected: false`, `kzero-onboarding-rehearsal`, and fingerprints `08ff4f34119b6190` / `d68f44858bab013e`.
3. Run `npm.cmd run preflight:zoho-production-rehearsal-db`; require an independently verified empty rehearsal target. Never use production or `kzero-onboarding-zoho-testing`.
4. Restore with the rehearsal **direct** URL via masked process environment variables and:

   ```powershell
   Import-Module .\scripts\production-online-backup-support.psm1 -Force
   $pgRestorePath = (Resolve-Postgres17Tools -BinPath 'C:\Program Files\PostgreSQL\17\bin').pg_restore
   & $pgRestorePath `
     --single-transaction `
     --exit-on-error `
     --no-owner `
     --no-privileges `
     --dbname=$env:PGDATABASE `
     $dumpPath
   if ($LASTEXITCODE -ne 0) { throw 'Restore failed.' }
   ```

5. Clear rehearsal credentials in `finally` and run `npm.cmd run preflight:zoho-production-rehearsal-db`. Require exactly nine successful migrations, matching repository checksums, and the baseline tables.
6. Only after the restore is verified, set the guarded backup evidence values described in the rehearsal runbook. Do not fabricate restore confirmation.
7. Run `npm.cmd run test:zoho-phase-7a-safety`.
8. With explicit 9-to-13 approval, run:

   ```powershell
   npm.cmd run rehearse:zoho-production-snapshot
   ```

The rehearsal harness must:

- capture protected baseline counts and SHA-256 digests from the **restored snapshot** before migration;
- require exactly migrations 1-9 and no failed/rolled-back/unknown record;
- apply migrations 10, 11, 12, and 13 in repository order;
- require exactly 13 successful migrations with repository checksums;
- capture the same protected columns afterward;
- fail unless counts and digests are identical;
- verify historical automation exclusions, initially empty Zoho/Staff SSO tables, and the Staff SSO constraints;
- use only isolated fixtures and mocked external providers.

Keep these disabled in the isolated environment: Zoho event emission, contact synchronization, journey triggering, automatic dispatch, nudge evaluation, production approval, cron, external email, and Staff SSO activation. Use non-production application origins and storage; do not allow restored contacts to trigger external calls.

## 7. Evidence required before migration rehearsal approval

- active rollback deployment evidence;
- production identity and passed nine-migration/checksum verifier output;
- DDL-freeze approval and online risk-check result;
- archive file, byte length, UTC time, SHA-256, ACL/encryption evidence, and clean `pg_dump` exit;
- readable restore list, SHA-256, required tables, and reviewed warnings;
- independently verified rehearsal identity/fingerprints and proof it is not attached to Production;
- successful isolated restore with exact nine-migration history;
- restored-snapshot baseline protected counts and SHA-256 digests captured by the harness;
- explicit approval to apply only migrations 10-13;
- final exact 13-migration history, zero protected-state differences, test results, and dormant side-effect flags.

Do not populate `ZOHO_PHASE7A_BACKUP_RESTORE_CONFIRMED` until the isolated restore is actually complete and verified. Do not claim production counts match the snapshot unless they were read from that same restored archive.
