[CmdletBinding()]
param(
  [string]$ArchivePath = 'C:\KZeroSecureBackups\kzero-onboarding-production-backup-20261110-204450Z\onboarding-portal-db-20261110-213753Z.dump'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-RehearsalConnectionFingerprint {
  [CmdletBinding()]
  param([Parameter(Mandatory)][Uri]$Uri)
  $port = if ($Uri.IsDefaultPort) { 5432 } else { $Uri.Port }
  $database = [Uri]::UnescapeDataString($Uri.AbsolutePath.TrimStart('/')).ToLowerInvariant()
  $username = [Uri]::UnescapeDataString($Uri.UserInfo.Substring(0,$Uri.UserInfo.IndexOf(':'))).ToLowerInvariant()
  $identity = "$username@$($Uri.Host.ToLowerInvariant()):$port/$database"
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($identity))
    return -join ($hash[0..7] | ForEach-Object { $_.ToString('x2') })
  } finally { $sha.Dispose() }
}

function Assert-RehearsalArchiveList {
  [CmdletBinding()]
  param(
    [AllowNull()]$Rows,
    [Parameter(Mandatory)][string[]]$RequiredTables
  )
  $normalized = @($Rows)
  if ($normalized.Count -eq 0) { throw 'Archive restore list is empty.' }
  foreach ($table in $RequiredTables) {
    $escaped = [regex]::Escape($table)
    if (@($normalized | Where-Object { [string]$_ -match "\bTABLE public $escaped\b" }).Count -eq 0) {
      throw "Archive restore list is missing required table definition: $table."
    }
    if (@($normalized | Where-Object { [string]$_ -match "\bTABLE DATA public $escaped\b" }).Count -eq 0) {
      throw "Archive restore list is missing required table data entry: $table."
    }
  }
}

function Assert-EmptyRehearsalDestination {
  [CmdletBinding()]
  param([AllowNull()]$Rows)
  $row = Assert-SingleCommandRow -Rows $Rows -Stage 'Rehearsal empty-destination preflight'
  $rawParts = @($row -split '\|', 6)
  $parts = @($rawParts | ForEach-Object { $_.Trim() })
  if ($parts.Count -ne 6 -or @($parts[0..4] | Where-Object { $_ -notmatch '^\d+$' }).Count -gt 0 -or $parts[5] -notin @('yes','no')) {
    throw 'Rehearsal empty-destination preflight returned malformed evidence.'
  }
  if ([int64]$parts[0] -ne 0 -or [int64]$parts[1] -ne 0 -or [int64]$parts[2] -ne 0 -or [int64]$parts[3] -ne 0 -or [int64]$parts[4] -ne 0 -or $parts[5] -ne 'no') {
    throw 'Rehearsal destination is not empty or has another client session.'
  }
}

function Assert-RestoredMigrationHistory {
  [CmdletBinding()]
  param(
    [AllowNull()]$Rows,
    [Parameter(Mandatory)][string[]]$ExpectedMigrations,
    [Parameter(Mandatory)][string]$RepositoryRoot
  )
  $normalized = @($Rows)
  if ($normalized.Count -ne $ExpectedMigrations.Count) { throw 'Restored migration count is not exactly nine.' }
  for ($index=0; $index -lt $ExpectedMigrations.Count; $index++) {
    $parts = @(([string]$normalized[$index]) -split '\|', 3)
    if ($parts.Count -ne 3 -or $parts[0] -ne $ExpectedMigrations[$index] -or $parts[2] -ne 'SUCCESS') {
      throw "Restored migration history differs at position $($index + 1)."
    }
    $migrationFile = Join-Path $RepositoryRoot "prisma\migrations\$($parts[0])\migration.sql"
    if ($parts[1] -ine (Get-FileHash -Algorithm SHA256 -LiteralPath $migrationFile).Hash) {
      throw "Restored migration checksum differs at position $($index + 1)."
    }
  }
}

function Assert-RestoredTableInventory {
  [CmdletBinding()]
  param(
    [AllowNull()]$Rows,
    [Parameter(Mandatory)][string[]]$ExpectedTables
  )
  $actual = @($Rows | Where-Object { $null -ne $_ -and -not [string]::IsNullOrWhiteSpace([string]$_) } | ForEach-Object { ([string]$_).Trim() } | Sort-Object)
  $expected = @($ExpectedTables | Sort-Object)
  if (@(Compare-Object $expected $actual).Count -ne 0) { throw 'Restored public table inventory differs from the exact migration-nine baseline.' }
}

function Get-RestoredRecordCounts {
  [CmdletBinding()]
  param([AllowNull()]$Rows)
  $row = Assert-SingleCommandRow -Rows $Rows -Stage 'Restored protected-record counts'
  $rawParts = @($row -split '\|', 7)
  $parts = @($rawParts | ForEach-Object { $_.Trim() })
  if ($parts.Count -ne 7 -or @($parts | Where-Object { $_ -notmatch '^\d+$' }).Count -gt 0) {
    throw 'Restored protected-record counts returned malformed evidence.'
  }
  $counts = [pscustomobject][ordered]@{
    msps=[int64]$parts[0]
    onboardingPlans=[int64]$parts[1]
    onboardingTasks=[int64]$parts[2]
    saasAppSubmissions=[int64]$parts[3]
    documents=[int64]$parts[4]
    oidcConfigurations=[int64]$parts[5]
    adminNotifications=[int64]$parts[6]
  }
  if ($counts.msps -le 0 -or $counts.onboardingPlans -le 0 -or $counts.onboardingTasks -le 0) {
    throw 'Restored snapshot does not contain the expected MSP and onboarding records.'
  }
  return $counts
}

function Invoke-ProductionRehearsalRestoreEntrypoint {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$ArchivePath,
    [scriptblock]$InputReader,
    [scriptblock]$ToolResolver,
    [scriptblock]$HashReader,
    [scriptblock]$RestoreListInvoker,
    [scriptblock]$PsqlInvoker,
    [scriptblock]$RestoreInvoker,
    [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$ExpectedArchiveSha256 = 'F902E6744F652C95C904CD3604BDA9D32B08DD9206A4624C7909AFC89CD11923',
    [string]$ExpectedPooledFingerprint = '08ff4f34119b6190',
    [string]$ExpectedDirectFingerprint = 'd68f44858bab013e',
    [string[]]$ForbiddenFingerprints = @('8c19783b98dac1b0','574952707912a7c3')
  )

  Import-Module (Join-Path $RepositoryRoot 'scripts\production-online-backup-support.psm1') -Force
  if ($null -eq $InputReader) { $InputReader = { param($Prompt,$Secure) if($Secure){Read-Host $Prompt -AsSecureString}else{Read-Host $Prompt} } }
  if ($null -eq $ToolResolver) { $ToolResolver = { Resolve-Postgres17Tools -BinPath 'C:\Program Files\PostgreSQL\17\bin' } }
  if ($null -eq $HashReader) { $HashReader = { param($Path) (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash } }

  $expectedMigrations = @(
    '20260617185715_init','20260617194303_add_admin_reporting_fields',
    '20260617194747_add_onboarding_plan_reporting_fields','20260619110000_add_first_customer_pilot_fields',
    '20260625143000_add_admin_notifications','20260703120000_add_msp_enrollment_date',
    '20260713120000_add_msp_gmm_partner_flag','20260715120000_add_customer_name_to_onboarding_plan',
    '20260715153000_add_document_storage_fields'
  )
  $expectedTables = @('_prisma_migrations','admin_notifications','documents','msps','oidc_configs','onboarding_plans','onboarding_tasks','saas_app_submissions')
  $pgVariables = @('PGAPPNAME','PGCONNECT_TIMEOUT','PGDATABASE','PGHOST','PGOPTIONS','PGPASSWORD','PGPORT','PGSSLMODE','PGUSER','PGPASSFILE','PGSERVICE','PGSERVICEFILE')
  $secureUrl = $null
  $pointer = [IntPtr]::Zero
  $rawUrl = $null
  $environmentApplied = $false
  $cleanupCompleted = $false
  $result = $null

  try {
    $resolvedArchive = (Resolve-Path -LiteralPath $ArchivePath -ErrorAction Stop).Path
    Assert-PathOutsideRepository -Path $resolvedArchive -RepositoryRoot $RepositoryRoot
    Assert-NoReparsePointPath -Path $resolvedArchive
    $archiveItem = Get-Item -LiteralPath $resolvedArchive -Force
    if (($archiveItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $archiveItem.Length -le 0) { throw 'Approved archive is empty or is a reparse point.' }
    $archiveHash = ([string](& $HashReader $resolvedArchive)).Trim().ToUpperInvariant()
    if ($archiveHash -ne $ExpectedArchiveSha256.ToUpperInvariant()) { throw 'Archive SHA-256 does not match the independently verified production backup.' }

    $tools = & $ToolResolver
    foreach ($name in @('psql','pg_restore')) {
      if ($tools.PSObject.Properties.Name -notcontains $name -or [string]::IsNullOrWhiteSpace([string]$tools.$name)) { throw "PostgreSQL 17 tool resolution is missing $name." }
    }
    if ($null -eq $RestoreListInvoker) {
      $RestoreListInvoker = { param($Path,$PgRestore) $rows=@(& $PgRestore --list $Path 2>$null);[pscustomobject]@{ExitCode=$LASTEXITCODE;Rows=$rows} }
    }
    $archiveList = & $RestoreListInvoker $resolvedArchive $tools.pg_restore
    if ($archiveList.ExitCode -ne 0) { throw 'PostgreSQL 17 could not read the custom archive.' }
    Assert-RehearsalArchiveList -Rows $archiveList.Rows -RequiredTables $expectedTables

    foreach ($name in $pgVariables) { if (Test-Path "Env:$name") { throw "Open a clean PowerShell session; $name is already set." } }
    $resourceName = ([string](& $InputReader 'Confirmed destination resource name' $false)).Trim()
    $databaseId = ([string](& $InputReader 'Confirmed rehearsal Prisma database ID (db_)' $false)).Trim()
    $connectionId = ([string](& $InputReader 'Confirmed rehearsal Prisma connection ID (con_)' $false)).Trim()
    $pooledFingerprint = ([string](& $InputReader 'Independently verified rehearsal pooled fingerprint' $false)).Trim().ToLowerInvariant()
    if ($resourceName -ne 'kzero-onboarding-rehearsal') { throw 'Destination resource must be exactly kzero-onboarding-rehearsal.' }
    if ($databaseId -notmatch '^db_[A-Za-z0-9][A-Za-z0-9_-]*$') { throw 'Invalid rehearsal database ID.' }
    if ($connectionId -notmatch '^con_[A-Za-z0-9][A-Za-z0-9_-]*$') { throw 'Invalid rehearsal connection ID.' }
    if ($pooledFingerprint -ne $ExpectedPooledFingerprint) { throw 'Rehearsal pooled fingerprint evidence does not match.' }
    if ([string](& $InputReader 'Type I_CONFIRM_REHEARSAL_NOT_ATTACHED_TO_LIVE_APPLICATION_OR_AUTOMATION' $false) -ne 'I_CONFIRM_REHEARSAL_NOT_ATTACHED_TO_LIVE_APPLICATION_OR_AUTOMATION') { throw 'Rehearsal isolation confirmation was not supplied.' }
    if ([string](& $InputReader 'Type I_CONFIRM_RESTORE_ONLY_TO_KZERO_ONBOARDING_REHEARSAL' $false) -ne 'I_CONFIRM_RESTORE_ONLY_TO_KZERO_ONBOARDING_REHEARSAL') { throw 'Rehearsal-only restore authorization was not supplied.' }

    $secureUrl = & $InputReader 'Paste kzero-onboarding-rehearsal DIRECT URL' $true
    if ($null -eq $secureUrl -or $secureUrl -isnot [Security.SecureString]) { throw 'Rehearsal direct URL prompt was cancelled or invalid.' }
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
    $rawUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $uri = [Uri]$rawUrl
    if ($uri.Scheme -notin @('postgres','postgresql') -or $uri.Host -ne 'db.prisma.io') { throw 'Expected a Prisma PostgreSQL direct URL.' }
    if ($uri.Port -ne 5432) { throw 'Expected explicit PostgreSQL port 5432.' }
    if ($uri.Query -notmatch '(^|[?&])sslmode=require(&|$)') { throw 'sslmode=require is mandatory.' }
    $separator = $uri.UserInfo.IndexOf(':')
    if ($separator -lt 1 -or $separator -ge ($uri.UserInfo.Length - 1)) { throw 'Rehearsal direct URL is missing credentials.' }
    $directFingerprint = Get-RehearsalConnectionFingerprint -Uri $uri
    if ($ForbiddenFingerprints -contains $directFingerprint) { throw 'A protected production database credential was supplied.' }
    if ($directFingerprint -ne $ExpectedDirectFingerprint) { throw 'Direct URL does not match the verified kzero-onboarding-rehearsal fingerprint; production and existing test targets are refused.' }

    $env:PGUSER=[Uri]::UnescapeDataString($uri.UserInfo.Substring(0,$separator))
    $env:PGPASSWORD=[Uri]::UnescapeDataString($uri.UserInfo.Substring($separator+1))
    $env:PGHOST=$uri.Host
    $env:PGPORT='5432'
    $env:PGDATABASE=[Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/'))
    $env:PGSSLMODE='require'
    $env:PGCONNECT_TIMEOUT='15'
    $env:PGAPPNAME='kzero-production-rehearsal-restore'
    $environmentApplied = $true

    if ($null -eq $PsqlInvoker) {
      $PsqlInvoker = { param($Stage,$Sql,$Psql) $rows=@(& $Psql -X --quiet --set=ON_ERROR_STOP=1 --tuples-only --no-align --command $Sql 2>$null);[pscustomobject]@{ExitCode=$LASTEXITCODE;Rows=$rows} }
    }
    if ($null -eq $RestoreInvoker) {
      $RestoreInvoker = { param($Path,$PgRestore,$Arguments) & $PgRestore @Arguments $Path 2>$null;return $LASTEXITCODE }
    }

    $identitySql = "BEGIN READ ONLY; SELECT current_database() || '|' || current_schema() || '|' || current_setting('server_version') || '|' || current_setting('transaction_read_only') || '|' || CASE WHEN pg_is_in_recovery() THEN 'standby' ELSE 'primary' END || '|' || current_user; COMMIT;"
    $identityResult = & $PsqlInvoker 'pre-identity' $identitySql $tools.psql
    $identity = Test-ProductionSourceIdentity -QuerySucceeded ($identityResult.ExitCode -eq 0) -Rows $identityResult.Rows -ExpectedDatabaseName $env:PGDATABASE
    if (-not $identity.isValid) { throw "Rehearsal destination identity failed: $($identity.failedCheck)." }

    $emptySql = @'
BEGIN READ ONLY;
SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')::text || '|' ||
  (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public')::text || '|' ||
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')::text || '|' ||
  (SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema'))::text || '|' ||
  (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid())::text || '|' ||
  CASE WHEN to_regclass('public._prisma_migrations') IS NULL THEN 'no' ELSE 'yes' END;
COMMIT;
'@
    $emptyResult = & $PsqlInvoker 'pre-empty' $emptySql $tools.psql
    if ($emptyResult.ExitCode -ne 0) { throw 'Rehearsal empty-destination query failed.' }
    Assert-EmptyRehearsalDestination -Rows $emptyResult.Rows

    $restoreArguments = @('--single-transaction','--exit-on-error','--no-owner','--no-privileges',"--dbname=$($env:PGDATABASE)")
    $restoreExitCode = [int](& $RestoreInvoker $resolvedArchive $tools.pg_restore $restoreArguments)
    if ($restoreExitCode -ne 0) { throw "Transactional rehearsal restore failed with exit code $restoreExitCode. No retry or reset was attempted." }

    $postIdentityResult = & $PsqlInvoker 'post-identity' $identitySql $tools.psql
    $postIdentity = Test-ProductionSourceIdentity -QuerySucceeded ($postIdentityResult.ExitCode -eq 0) -Rows $postIdentityResult.Rows -ExpectedDatabaseName $env:PGDATABASE
    if (-not $postIdentity.isValid) { throw "Post-restore destination identity failed: $($postIdentity.failedCheck)." }
    $migrationSql = 'BEGIN READ ONLY; SELECT migration_name || ''|'' || checksum || ''|'' || CASE WHEN finished_at IS NOT NULL AND rolled_back_at IS NULL THEN ''SUCCESS'' WHEN rolled_back_at IS NOT NULL THEN ''ROLLED_BACK'' WHEN logs IS NOT NULL THEN ''FAILED'' ELSE ''INCOMPLETE'' END FROM "_prisma_migrations" ORDER BY started_at, migration_name; COMMIT;'
    $migrationResult = & $PsqlInvoker 'post-migrations' $migrationSql $tools.psql
    if ($migrationResult.ExitCode -ne 0) { throw 'Post-restore migration verification query failed.' }
    Assert-RestoredMigrationHistory -Rows $migrationResult.Rows -ExpectedMigrations $expectedMigrations -RepositoryRoot $RepositoryRoot
    $tableSql = "BEGIN READ ONLY; SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name; COMMIT;"
    $tableResult = & $PsqlInvoker 'post-tables' $tableSql $tools.psql
    if ($tableResult.ExitCode -ne 0) { throw 'Post-restore table verification query failed.' }
    Assert-RestoredTableInventory -Rows $tableResult.Rows -ExpectedTables $expectedTables
    $countSql = 'BEGIN READ ONLY; SELECT (SELECT count(*) FROM "msps")::text || ''|'' || (SELECT count(*) FROM "onboarding_plans")::text || ''|'' || (SELECT count(*) FROM "onboarding_tasks")::text || ''|'' || (SELECT count(*) FROM "saas_app_submissions")::text || ''|'' || (SELECT count(*) FROM "documents")::text || ''|'' || (SELECT count(*) FROM "oidc_configs")::text || ''|'' || (SELECT count(*) FROM "admin_notifications")::text; COMMIT;'
    $countResult = & $PsqlInvoker 'post-counts' $countSql $tools.psql
    if ($countResult.ExitCode -ne 0) { throw 'Post-restore protected-record verification query failed.' }
    $counts = Get-RestoredRecordCounts -Rows $countResult.Rows

    $result = [pscustomobject][ordered]@{
      RestoreSucceeded=$true
      ResourceName='kzero-onboarding-rehearsal'
      ArchiveSha256=$archiveHash
      DirectFingerprint=$directFingerprint
      MigrationCount=9
      FinalMigration=$expectedMigrations[-1]
      TableCount=$expectedTables.Count
      ProtectedRecordCounts=$counts
      ExternalBlobObjectsModified=$false
      Migrations10Through13Applied=$false
      ExternalAutomationInvoked=$false
    }
  } finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($null -ne $secureUrl) { $secureUrl.Dispose() }
    $rawUrl = $null
    if ($environmentApplied) { Clear-ProductionBackupPgEnvironment }
    $cleanupCompleted = -not (Test-Path Env:PGPASSWORD) -and -not (Test-Path Env:PGUSER) -and -not (Test-Path Env:PGHOST)
    Write-Host 'Temporary rehearsal PostgreSQL credential cleanup completed.'
  }
  if (-not $cleanupCompleted) { throw 'Temporary PostgreSQL credential cleanup could not be confirmed.' }
  $result | Add-Member -NotePropertyName CredentialCleanupCompleted -NotePropertyValue $true
  return $result
}

if ($MyInvocation.InvocationName -ne '.') {
  $restoreResult = Invoke-ProductionRehearsalRestoreEntrypoint -ArchivePath $ArchivePath
  $restoreResult | Format-List
  $restoreResult.ProtectedRecordCounts | Format-List
}
