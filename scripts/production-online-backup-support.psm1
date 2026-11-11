Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:PgEnvironmentVariables = @(
  'PGAPPNAME', 'PGCONNECT_TIMEOUT', 'PGDATABASE', 'PGHOST', 'PGOPTIONS',
  'PGPASSWORD', 'PGPORT', 'PGSSLMODE', 'PGUSER'
)

function Get-NormalizedAbsoluteLocalPath {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Path)

  $value = $Path.Trim()
  if ($value -notmatch '^[A-Za-z]:[\\/]') {
    throw 'Path must be a drive-rooted absolute local path such as X:\Backups; drive-relative and UNC paths are not accepted.'
  }
  if ($value.IndexOfAny([IO.Path]::GetInvalidPathChars()) -ge 0) {
    throw 'Path contains an invalid character.'
  }
  $fullPath = [IO.Path]::GetFullPath($value).TrimEnd('\')
  $root = [IO.Path]::GetPathRoot($fullPath).TrimEnd('\')
  if ($fullPath -eq $root) {
    throw 'A drive root cannot be used as the backup directory.'
  }
  return $fullPath
}

function Assert-PathOutsideRepository {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$RepositoryRoot
  )

  $candidate = (Get-NormalizedAbsoluteLocalPath -Path $Path).TrimEnd('\')
  $repository = (Get-NormalizedAbsoluteLocalPath -Path $RepositoryRoot).TrimEnd('\')
  if ($candidate.Equals($repository, [StringComparison]::OrdinalIgnoreCase) -or
      $candidate.StartsWith($repository + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Backup storage must be outside the repository and cannot be the repository root.'
  }
}

function Assert-NoReparsePointPath {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Path,
    [scriptblock]$ItemReader
  )

  $resolved = Get-NormalizedAbsoluteLocalPath -Path $Path
  if ($null -eq $ItemReader) {
    $ItemReader = { param($LiteralPath) Get-Item -LiteralPath $LiteralPath -Force -ErrorAction Stop }
  }
  $current = $resolved
  while ($true) {
    $item = & $ItemReader $current
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'Backup path contains a symlink, junction, mount point, or other reparse point.'
    }
    $parent = [IO.Directory]::GetParent($current)
    if ($null -eq $parent) { break }
    $current = $parent.FullName
  }
}

function Assert-BitLockerProtection {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)]$Volume
  )

  $expectedRoot = [IO.Path]::GetPathRoot((Get-NormalizedAbsoluteLocalPath -Path $Path)).TrimEnd('\').ToUpperInvariant()
  $actualRoot = ([string]$Volume.MountPoint).TrimEnd('\').ToUpperInvariant()
  if ($actualRoot -ne $expectedRoot) { throw 'BitLocker evidence belongs to a different destination volume.' }
  if ([string]$Volume.VolumeStatus -ne 'FullyEncrypted') { throw 'Destination volume is not fully encrypted.' }
  if ([string]$Volume.ProtectionStatus -ne 'On') { throw 'BitLocker protection is not enabled.' }
  if ([int]$Volume.EncryptionPercentage -ne 100) { throw 'Destination volume encryption is incomplete.' }
  if ([string]$Volume.LockStatus -eq 'Locked') { throw 'Destination volume is locked.' }
}

function Assert-RestrictedBackupAcl {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)]$Acl,
    [Parameter(Mandatory)][string[]]$AllowedIdentities
  )

  if (-not $Acl.AreAccessRulesProtected) { throw 'Backup directory ACL inheritance is still enabled.' }
  $normalizedAllowed = @($AllowedIdentities | ForEach-Object { $_.ToUpperInvariant() })
  $rules = @($Acl.Access)
  if ($rules.Count -eq 0) { throw 'Backup directory has no explicit access rules.' }
  foreach ($rule in $rules) {
    $identity = ([string]$rule.IdentityReference).ToUpperInvariant()
    if ($normalizedAllowed -notcontains $identity) { throw 'Backup directory has an unexpected access identity.' }
    if ([string]$rule.AccessControlType -ne 'Allow') { throw 'Backup directory contains an unexpected deny rule.' }
    if ($rule.PSObject.Properties.Name -contains 'IsInherited' -and $rule.IsInherited) { throw 'Backup directory contains an inherited access rule.' }
    if ($rule.PSObject.Properties.Name -contains 'FileSystemRights' -and
        (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne [Security.AccessControl.FileSystemRights]::FullControl)) {
      throw 'Backup directory required identity does not have FullControl.'
    }
  }
  foreach ($required in $normalizedAllowed) {
    if (@($rules | Where-Object { ([string]$_.IdentityReference).ToUpperInvariant() -eq $required }).Count -eq 0) {
      throw 'Backup directory is missing a required access identity.'
    }
  }
}

function Resolve-Postgres17Tools {
  [CmdletBinding()]
  param(
    [string]$BinPath = 'C:\Program Files\PostgreSQL\17\bin',
    [scriptblock]$VersionReader
  )

  $resolvedBin = (Resolve-Path -LiteralPath $BinPath -ErrorAction Stop).Path.TrimEnd('\')
  if ($null -eq $VersionReader) {
    $VersionReader = {
      param($Executable)
      $output = @(& $Executable --version 2>&1)
      if ($LASTEXITCODE -ne 0) { throw "PostgreSQL tool version check failed for $([IO.Path]::GetFileName($Executable))." }
      return $output
    }
  }
  $result = [ordered]@{}
  foreach ($name in @('pg_dump', 'pg_restore', 'psql')) {
    $path = Join-Path $resolvedBin ($name + '.exe')
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required PostgreSQL 17 executable is missing: $name.exe." }
    $resolved = (Resolve-Path -LiteralPath $path).Path
    if (-not ([IO.Path]::GetDirectoryName($resolved)).Equals($resolvedBin, [StringComparison]::OrdinalIgnoreCase)) {
      throw "PostgreSQL tool resolved outside the approved PostgreSQL 17 directory: $name.exe."
    }
    $rows = @(& $VersionReader $resolved)
    if ($rows.Count -ne 1 -or ([string]$rows[0]) -notmatch '(?i)\b17\.\d+(?:\.\d+)?\b') {
      throw "PostgreSQL tool does not report major version 17: $name.exe."
    }
    $result[$name] = $resolved
  }
  return [pscustomobject]$result
}

function Assert-SingleCommandRow {
  [CmdletBinding()]
  param(
    [AllowNull()]$Rows,
    [Parameter(Mandatory)][string]$Stage
  )
  $normalized = @($Rows)
  if ($normalized.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$normalized[0])) {
    throw "$Stage returned $($normalized.Count) rows; exactly one non-empty row is required."
  }
  return [string]$normalized[0]
}

function Test-ProductionSourceIdentity {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][bool]$QuerySucceeded,
    [AllowNull()]$Rows,
    [Parameter(Mandatory)][string]$ExpectedDatabaseName
  )

  $normalizedRows = @($Rows)
  $resultColumnCount = 0
  $databaseNameMatches = $false
  $schemaMatches = $false
  $serverMajorMatches = $false
  $transactionReadOnlyEnabled = $false
  $primaryServerVerified = $false
  $databasePrincipalPresent = $false
  $databaseName = $null
  $serverVersion = $null

  if ($QuerySucceeded -and $normalizedRows.Count -eq 1 -and
      -not [string]::IsNullOrWhiteSpace([string]$normalizedRows[0])) {
    $rawParts = @(([string]$normalizedRows[0]) -split '\|', 6)
    $parts = @($rawParts | ForEach-Object { $_.Trim() })
    $resultColumnCount = $parts.Count
    if ($resultColumnCount -eq 6) {
      $databaseName = $parts[0]
      $serverVersion = $parts[2]
      $databaseNameMatches = $parts[0] -eq $ExpectedDatabaseName.Trim()
      $schemaMatches = $parts[1] -eq 'public'
      $serverMajorMatches = $parts[2] -match '^17(?:\.|$)'
      $transactionReadOnlyEnabled = $parts[3].ToLowerInvariant() -eq 'on'
      # The legacy query returns PostgreSQL's documented false marker (f). New
      # queries return the canonical word primary. Both require the same strict
      # condition: pg_is_in_recovery() is false.
      $primaryValue = $parts[4].ToLowerInvariant()
      $primaryServerVerified = $primaryValue -in @('f', 'primary')
      $databasePrincipalPresent = -not [string]::IsNullOrWhiteSpace($parts[5])
    }
  }

  $failedCheck = $null
  if (-not $QuerySucceeded) { $failedCheck = 'identityQuerySucceeded' }
  elseif ($normalizedRows.Count -ne 1) { $failedCheck = 'resultRowCount' }
  elseif ($resultColumnCount -ne 6) { $failedCheck = 'resultColumnCount' }
  elseif (-not $databaseNameMatches) { $failedCheck = 'databaseNameMatches' }
  elseif (-not $schemaMatches) { $failedCheck = 'schemaMatches' }
  elseif (-not $serverMajorMatches) { $failedCheck = 'serverMajorMatches' }
  elseif (-not $transactionReadOnlyEnabled) { $failedCheck = 'transactionReadOnlyEnabled' }
  elseif (-not $primaryServerVerified) { $failedCheck = 'primaryServerVerified' }
  elseif (-not $databasePrincipalPresent) { $failedCheck = 'databasePrincipalPresent' }

  return [pscustomobject][ordered]@{
    isValid = $null -eq $failedCheck
    identityQuerySucceeded = $QuerySucceeded
    databaseNameMatches = $databaseNameMatches
    schemaMatches = $schemaMatches
    serverMajorMatches = $serverMajorMatches
    transactionReadOnlyEnabled = $transactionReadOnlyEnabled
    primaryServerVerified = $primaryServerVerified
    databasePrincipalPresent = $databasePrincipalPresent
    resultRowCount = $normalizedRows.Count
    resultColumnCount = $resultColumnCount
    failedCheck = $failedCheck
    databaseName = $databaseName
    serverVersion = $serverVersion
  }
}

function Get-OnlineRiskDiagnostic {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][bool]$QuerySucceeded,
    [AllowNull()]$Rows
  )

  $normalizedRows = @($Rows)
  $parts = @()
  if ($QuerySucceeded -and $normalizedRows.Count -eq 1 -and
      -not [string]::IsNullOrWhiteSpace([string]$normalizedRows[0])) {
    $rawParts = @(([string]$normalizedRows[0]) -split '\|', 10)
    $parts = @($rawParts | ForEach-Object { $_.Trim() })
  }

  $resultColumnCount = $parts.Count
  $counterNames = @(
    'transactionsOlderThanFiveMinutes', 'accessExclusiveLocks', 'waitingLocks',
    'blockedSessions', 'activeDdlSessions', 'recognizedProviderBackgroundWorkers',
    'hiddenClientSessions', 'unknownBackendSessions'
  )
  $counters = [ordered]@{}
  foreach ($name in $counterNames) {
    $counters[$name] = [pscustomobject][ordered]@{ state='unknown'; count=$null }
  }

  $hasPgReadAllStats = $null
  $isSuperuser = $null
  $parseSucceeded = $QuerySucceeded -and $normalizedRows.Count -eq 1 -and $resultColumnCount -eq 10
  if ($parseSucceeded) {
    for ($index=0; $index -lt 8; $index++) {
      if ($parts[$index] -notmatch '^\d+$') { $parseSucceeded = $false; break }
      $value = [int64]$parts[$index]
      $state = if ($index -eq 6 -and $value -gt 0) { 'hidden' } elseif ($index -eq 7 -and $value -gt 0) { 'unknown' } elseif ($value -eq 0) { 'zero' } else { 'nonzero' }
      $counters[$counterNames[$index]] = [pscustomobject][ordered]@{ state=$state; count=$value }
    }
    if ($parseSucceeded) {
      if ($parts[8] -notin @('yes','no') -or $parts[9] -notin @('yes','no')) {
        $parseSucceeded = $false
      } else {
        $hasPgReadAllStats = $parts[8] -eq 'yes'
        $isSuperuser = $parts[9] -eq 'yes'
      }
    }
  }

  $monitoringVisibility = 'unknown'
  if ($parseSucceeded) {
    if ($counters.hiddenClientSessions.count -gt 0) { $monitoringVisibility = 'hidden' }
    elseif ($counters.unknownBackendSessions.count -gt 0) { $monitoringVisibility = 'unknown' }
    elseif ($hasPgReadAllStats -or $isSuperuser) { $monitoringVisibility = 'full' }
    else { $monitoringVisibility = 'restricted' }
  }
  $evidenceComplete = $parseSucceeded -and $monitoringVisibility -eq 'full'
  $failedChecks = @()
  if (-not $QuerySucceeded) { $failedChecks += 'riskQuerySucceeded' }
  elseif ($normalizedRows.Count -ne 1) { $failedChecks += 'resultRowCount' }
  elseif (-not $parseSucceeded) { $failedChecks += 'resultFormat' }
  if ($parseSucceeded) {
    foreach ($name in $counterNames[0..4]) {
      if ($counters[$name].count -gt 0) { $failedChecks += $name }
    }
    if ($counters.hiddenClientSessions.count -gt 0) { $failedChecks += 'hiddenClientSessions' }
    if ($counters.unknownBackendSessions.count -gt 0) { $failedChecks += 'unknownBackendSessions' }
    if (-not $evidenceComplete) { $failedChecks += 'monitoringVisibility' }
  }

  return [pscustomobject][ordered]@{
    riskQuerySucceeded = $QuerySucceeded
    parseSucceeded = $parseSucceeded
    resultRowCount = $normalizedRows.Count
    resultColumnCount = $resultColumnCount
    transactionsOlderThanFiveMinutes = $counters.transactionsOlderThanFiveMinutes
    accessExclusiveLocks = $counters.accessExclusiveLocks
    waitingLocks = $counters.waitingLocks
    blockedSessions = $counters.blockedSessions
    activeDdlSessions = $counters.activeDdlSessions
    recognizedProviderBackgroundWorkers = $counters.recognizedProviderBackgroundWorkers
    hiddenClientSessions = $counters.hiddenClientSessions
    unknownBackendSessions = $counters.unknownBackendSessions
    hasPgReadAllStats = $hasPgReadAllStats
    isSuperuser = $isSuperuser
    monitoringVisibility = $monitoringVisibility
    evidenceComplete = $evidenceComplete
    safeForOnlineBackup = $parseSucceeded -and $evidenceComplete -and $failedChecks.Count -eq 0
    failedChecks = @($failedChecks)
  }
}

function Assert-OnlineRiskResult {
  [CmdletBinding()]
  param(
    [AllowNull()]$Rows,
    [bool]$QuerySucceeded = $true
  )
  $diagnostic = Get-OnlineRiskDiagnostic -QuerySucceeded $QuerySucceeded -Rows $Rows
  if (-not $diagnostic.safeForOnlineBackup) {
    throw "Online safety preflight failed. Sanitized diagnostic: $($diagnostic | ConvertTo-Json -Depth 4 -Compress)"
  }
  return $diagnostic
}

function Clear-ProductionBackupPgEnvironment {
  [CmdletBinding()]
  param()
  foreach ($name in $script:PgEnvironmentVariables) {
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
  }
}

function Assert-ArchiveArtifacts {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$ArchivePath,
    [Parameter(Mandatory)][string]$RestoreListPath,
    [Parameter(Mandatory)][string[]]$RequiredTables
  )
  if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) { throw 'Backup archive was not created.' }
  if ((Get-Item -LiteralPath $ArchivePath).Length -le 0) { throw 'Backup archive is empty or partial.' }
  if (-not (Test-Path -LiteralPath $RestoreListPath -PathType Leaf)) { throw 'Restore-list evidence was not created.' }
  $rows = @(Get-Content -LiteralPath $RestoreListPath)
  if ($rows.Count -eq 0) { throw 'Restore-list evidence is empty.' }
  foreach ($table in $RequiredTables) {
    if (@($rows | Where-Object { $_ -match "TABLE DATA public $([regex]::Escape($table))\b" }).Count -eq 0) {
      throw "Archive list is missing protected table data: $table."
    }
  }
}

function Move-InvalidArchiveToQuarantine {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$ArchivePath,
    [Parameter(Mandatory)][string]$BackupRoot
  )
  if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) { return $null }
  $root = (Resolve-Path -LiteralPath $BackupRoot).Path.TrimEnd('\')
  $archive = (Resolve-Path -LiteralPath $ArchivePath).Path
  if (-not $archive.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to quarantine an archive outside the dedicated backup directory.'
  }
  $quarantine = Join-Path $root 'INVALID-PARTIAL'
  if (-not (Test-Path -LiteralPath $quarantine)) { New-Item -ItemType Directory -Path $quarantine -ErrorAction Stop | Out-Null }
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmssZ')
  $destination = Join-Path $quarantine ((Split-Path -Leaf $archive) + ".$stamp.invalid-partial")
  Move-Item -LiteralPath $archive -Destination $destination -ErrorAction Stop
  return $destination
}

function New-ProductionBackupMetadata {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][hashtable]$Expected,
    [Parameter(Mandatory)][hashtable]$OperatorConfirmedDeployment,
    [Parameter(Mandatory)][hashtable]$ObservedDatabase,
    [Parameter(Mandatory)][hashtable]$Archive
  )
  return [ordered]@{
    evidenceCreatedUtc = (Get-Date).ToUniversalTime().ToString('o')
    expected = $Expected
    operatorConfirmedLiveDeployment = $OperatorConfirmedDeployment
    observedDatabase = $ObservedDatabase
    archive = $Archive
  }
}

function Get-RequiredBackupFreeBytes {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][long]$ObservedDatabaseSizeBytes,
    [int]$HeadroomMultiplier = 3
  )
  if ($ObservedDatabaseSizeBytes -le 0) { throw 'Observed production database size must be greater than zero.' }
  if ($HeadroomMultiplier -lt 2) { throw 'Backup free-space headroom multiplier must be at least 2.' }
  if ($ObservedDatabaseSizeBytes -gt [long]::MaxValue / $HeadroomMultiplier) { throw 'Backup free-space calculation overflowed.' }
  return [long]($ObservedDatabaseSizeBytes * $HeadroomMultiplier)
}

function Invoke-GuardedBackupCore {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$RepositoryRoot,
    [Parameter(Mandatory)][string]$BackupRoot,
    [Parameter(Mandatory)][string]$DumpPath,
    [Parameter(Mandatory)][string]$RestoreListPath,
    [Parameter(Mandatory)][string]$MetadataPath,
    [Parameter(Mandatory)][string]$PsqlPath,
    [Parameter(Mandatory)][string]$PgDumpPath,
    [Parameter(Mandatory)][string]$PgRestorePath,
    [Parameter(Mandatory)][string[]]$ExpectedMigrations,
    [Parameter(Mandatory)][string[]]$RequiredTables,
    [Parameter(Mandatory)][string]$ExpectedDatabaseName,
    [Parameter(Mandatory)][string]$DirectFingerprint,
    [Parameter(Mandatory)][hashtable]$ExpectedEvidence,
    [Parameter(Mandatory)][hashtable]$OperatorConfirmedDeployment,
    [Parameter(Mandatory)][hashtable]$ObservedConnection,
    [scriptblock]$PsqlInvoker,
    [scriptblock]$DumpInvoker,
    [scriptblock]$RestoreListInvoker,
    [scriptblock]$UtcNowProvider,
    [switch]$IdentityDiagnosticOnly,
    [switch]$RiskDiagnosticOnly
  )
  if ($IdentityDiagnosticOnly -and $RiskDiagnosticOnly) { throw 'Choose only one diagnostic-only mode.' }
  if ($null -eq $UtcNowProvider) { $UtcNowProvider = { [DateTimeOffset]::UtcNow } }
  if ($null -eq $PsqlInvoker) {
    $PsqlInvoker = {
      param($Stage,$Sql)
      $rows = @(& $PsqlPath -X --set=ON_ERROR_STOP=1 --tuples-only --no-align --command $Sql 2>$null)
      [pscustomobject]@{ ExitCode=$LASTEXITCODE; Rows=$rows }
    }.GetNewClosure()
  }
  if ($null -eq $DumpInvoker) {
    $DumpInvoker = {
      & $PgDumpPath --format=custom --compress=9 --lock-wait-timeout=30000 --file=$DumpPath
      return $LASTEXITCODE
    }.GetNewClosure()
  }
  if ($null -eq $RestoreListInvoker) {
    $RestoreListInvoker = {
      & $PgRestorePath --list --file=$RestoreListPath $DumpPath
      return $LASTEXITCODE
    }.GetNewClosure()
  }

  $identitySql = "SELECT current_database() || '|' || current_schema() || '|' || current_setting('server_version') || '|' || current_setting('transaction_read_only') || '|' || CASE WHEN pg_is_in_recovery() THEN 'standby' ELSE 'primary' END || '|' || current_user;"
  $migrationSql = 'SELECT migration_name || ''|'' || checksum || ''|'' || CASE WHEN finished_at IS NOT NULL AND rolled_back_at IS NULL THEN ''SUCCESS'' WHEN rolled_back_at IS NOT NULL THEN ''ROLLED_BACK'' WHEN logs IS NOT NULL THEN ''FAILED'' ELSE ''INCOMPLETE'' END FROM "_prisma_migrations" ORDER BY started_at, migration_name;'
  $riskSql = @'
WITH target_database AS (
  SELECT oid FROM pg_database WHERE datname = current_database()
), target_activity AS (
  SELECT * FROM pg_stat_activity
  WHERE datid = (SELECT oid FROM target_database) AND pid <> pg_backend_pid()
)
SELECT
  (SELECT count(*) FROM target_activity WHERE xact_start < clock_timestamp() - interval '5 minutes')::text || '|' ||
  (SELECT count(*) FROM pg_locks WHERE database = (SELECT oid FROM target_database) AND mode = 'AccessExclusiveLock')::text || '|' ||
  (SELECT count(*) FROM pg_locks WHERE database = (SELECT oid FROM target_database) AND NOT granted)::text || '|' ||
  (SELECT count(*) FROM target_activity WHERE cardinality(pg_blocking_pids(pid)) > 0)::text || '|' ||
  (SELECT count(*) FROM target_activity WHERE state = 'active' AND query ~* '^\s*(alter|create|drop|truncate|reindex|cluster|vacuum\s+full)\b')::text || '|' ||
  (SELECT count(*) FROM target_activity
    WHERE backend_type IN ('ppg_archiver_guard','ppg_metrics','ppg_storage_guard')
      AND state IS NULL AND usename IS NOT NULL AND query IS NOT NULL)::text || '|' ||
  (SELECT count(*) FROM target_activity
    WHERE backend_type = 'client backend'
      AND (state IS NULL OR usename IS NULL OR query IS NULL))::text || '|' ||
  (SELECT count(*) FROM target_activity
    WHERE backend_type IS NULL
       OR backend_type NOT IN ('client backend','ppg_archiver_guard','ppg_metrics','ppg_storage_guard')
       OR (backend_type IN ('ppg_archiver_guard','ppg_metrics','ppg_storage_guard')
           AND (state IS NOT NULL OR usename IS NULL OR query IS NULL)))::text || '|' ||
  CASE WHEN pg_has_role(current_user, 'pg_read_all_stats', 'MEMBER') THEN 'yes' ELSE 'no' END || '|' ||
  CASE WHEN current_setting('is_superuser') = 'on' THEN 'yes' ELSE 'no' END;
'@

  $dumpStarted = $false
  try {
    $identityResult = & $PsqlInvoker 'identity' $identitySql
    $identity = Test-ProductionSourceIdentity `
      -QuerySucceeded ($identityResult.ExitCode -eq 0) `
      -Rows $identityResult.Rows `
      -ExpectedDatabaseName $ExpectedDatabaseName
    if (-not $identity.isValid) {
      $safeDiagnostic = [ordered]@{
        identityQuerySucceeded = $identity.identityQuerySucceeded
        databaseNameMatches = $identity.databaseNameMatches
        schemaMatches = $identity.schemaMatches
        serverMajorMatches = $identity.serverMajorMatches
        transactionReadOnlyEnabled = $identity.transactionReadOnlyEnabled
        primaryServerVerified = $identity.primaryServerVerified
        databasePrincipalPresent = $identity.databasePrincipalPresent
        resultRowCount = $identity.resultRowCount
        resultColumnCount = $identity.resultColumnCount
        failedCheck = $identity.failedCheck
      }
      throw "Source identity validation failed. Sanitized diagnostic: $($safeDiagnostic | ConvertTo-Json -Compress)"
    }
    if ($IdentityDiagnosticOnly) {
      return [pscustomobject]@{
        BackupSucceeded = $false
        IdentityDiagnosticOnly = $true
        IdentityValidated = $true
        Diagnostic = [pscustomobject][ordered]@{
          identityQuerySucceeded = $identity.identityQuerySucceeded
          databaseNameMatches = $identity.databaseNameMatches
          schemaMatches = $identity.schemaMatches
          serverMajorMatches = $identity.serverMajorMatches
          transactionReadOnlyEnabled = $identity.transactionReadOnlyEnabled
          primaryServerVerified = $identity.primaryServerVerified
          databasePrincipalPresent = $identity.databasePrincipalPresent
          resultRowCount = $identity.resultRowCount
          resultColumnCount = $identity.resultColumnCount
          failedCheck = $identity.failedCheck
        }
      }
    }

    if ($RiskDiagnosticOnly) {
      $riskResult = & $PsqlInvoker 'risk' $riskSql
      $riskDiagnostic = Get-OnlineRiskDiagnostic `
        -QuerySucceeded ($riskResult.ExitCode -eq 0) `
        -Rows $riskResult.Rows
      return [pscustomobject]@{
        BackupSucceeded = $false
        RiskDiagnosticOnly = $true
        IdentityValidated = $true
        SafeForOnlineBackup = $riskDiagnostic.safeForOnlineBackup
        Diagnostic = $riskDiagnostic
      }
    }

    $migrationResult = & $PsqlInvoker 'migrations' $migrationSql
    $migrationRows = @($migrationResult.Rows)
    if ($migrationResult.ExitCode -ne 0 -or $migrationRows.Count -ne $ExpectedMigrations.Count) { throw 'Source no longer has the exact expected migration count.' }
    for ($index=0; $index -lt $ExpectedMigrations.Count; $index++) {
      $parts = @($migrationRows[$index] -split '\|',3)
      if ($parts.Count -ne 3 -or $parts[0] -ne $ExpectedMigrations[$index] -or $parts[2] -ne 'SUCCESS') { throw "Unexpected migration at position $($index + 1)." }
      $migrationFile = Join-Path $RepositoryRoot "prisma\migrations\$($parts[0])\migration.sql"
      if ($parts[1] -ine (Get-FileHash -Algorithm SHA256 -LiteralPath $migrationFile).Hash) { throw "Migration checksum mismatch at position $($index + 1)." }
    }

    $riskResult = & $PsqlInvoker 'risk' $riskSql
    Assert-OnlineRiskResult -QuerySucceeded ($riskResult.ExitCode -eq 0) -Rows $riskResult.Rows | Out-Null

    $sourceObservedUtc = (& $UtcNowProvider).ToUniversalTime().ToString('o')
    $dumpStarted = $true
    $dumpExitCode = [int](& $DumpInvoker)
    if ($dumpExitCode -ne 0) { throw "pg_dump failed with exit code $dumpExitCode." }
    $listExitCode = [int](& $RestoreListInvoker)
    if ($listExitCode -ne 0) { throw "pg_restore --list failed with exit code $listExitCode." }
    Assert-ArchiveArtifacts -ArchivePath $DumpPath -RestoreListPath $RestoreListPath -RequiredTables $RequiredTables

    $dumpInfo = Get-Item -LiteralPath $DumpPath
    $dumpHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $DumpPath).Hash
    $listHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $RestoreListPath).Hash
    $observed = @{} + $ObservedConnection
    $observed.observationUtc = $sourceObservedUtc
    $observed.snapshotBoundaryOwnedByPgDump = $true
    $observed.observationIsSnapshotEvidence = $false
    $observed.databaseName = $identity.databaseName
    $observed.databasePrincipalPresent = $identity.databasePrincipalPresent
    $observed.serverVersion = $identity.serverVersion
    $observed.directFingerprint = $DirectFingerprint
    $observed.migrationCount = $ExpectedMigrations.Count
    $observed.finalMigration = $ExpectedMigrations[-1]
    $metadata = New-ProductionBackupMetadata -Expected $ExpectedEvidence -OperatorConfirmedDeployment $OperatorConfirmedDeployment -ObservedDatabase $observed -Archive @{
      validated=$true; format='PostgreSQL custom'; compressionEnabled=$true; lockWaitTimeoutMilliseconds=30000;
      fileName=$dumpInfo.Name; bytes=$dumpInfo.Length; sha256=$dumpHash;
      restoreListFileName=(Split-Path -Leaf $RestoreListPath); restoreListSha256=$listHash;
      restoredSnapshotCountsAndDigestsPending=$true
    }
    $utf8NoBom = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($MetadataPath,($metadata | ConvertTo-Json -Depth 6),$utf8NoBom)
    if ((Get-Item -LiteralPath $MetadataPath).Length -le 0) { throw 'Backup metadata was not written.' }
    return [pscustomobject]@{ BackupSucceeded=$true; Archive=$dumpInfo.Name; Bytes=$dumpInfo.Length; Sha256=$dumpHash; Metadata=(Split-Path -Leaf $MetadataPath) }
  } catch {
    $failureMessage = $_.Exception.Message
    if ($dumpStarted -and (Test-Path -LiteralPath $DumpPath -PathType Leaf)) {
      $quarantinedArchive = Move-InvalidArchiveToQuarantine -ArchivePath $DumpPath -BackupRoot $BackupRoot
      $quarantineRoot = Split-Path -Parent $quarantinedArchive
      foreach ($artifact in @($RestoreListPath,$MetadataPath)) {
        if (Test-Path -LiteralPath $artifact -PathType Leaf) { Move-Item -LiteralPath $artifact -Destination (Join-Path $quarantineRoot ((Split-Path -Leaf $artifact) + '.invalid')) -ErrorAction Stop }
      }
    }
    throw $failureMessage
  }
}

function New-ProtectedBackupDirectory {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$BackupParent,
    [Parameter(Mandatory)][string]$RepositoryRoot,
    [Parameter(Mandatory)][long]$RequiredFreeBytes,
    [string]$OperatorIdentity = ([Security.Principal.WindowsIdentity]::GetCurrent().Name),
    [scriptblock]$BitLockerReader,
    [scriptblock]$FreeSpaceReader,
    [scriptblock]$AclWriter,
    [scriptblock]$AclReader,
    [scriptblock]$ItemReader,
    [datetime]$Timestamp = [datetime]::UtcNow
  )
  if ($RequiredFreeBytes -le 0) { throw 'Required free-space evidence must be greater than zero.' }
  if ([string]::IsNullOrWhiteSpace($OperatorIdentity)) { throw 'Authenticated Windows operator identity is unavailable.' }
  $parent = Get-NormalizedAbsoluteLocalPath -Path $BackupParent
  Assert-PathOutsideRepository -Path $parent -RepositoryRoot $RepositoryRoot
  if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw 'Approved backup parent directory does not exist.' }
  Assert-NoReparsePointPath -Path $parent -ItemReader $ItemReader

  if ($null -eq $BitLockerReader) {
    if ($null -eq (Get-Command Get-BitLockerVolume -ErrorAction SilentlyContinue)) { throw 'Get-BitLockerVolume is unavailable; encryption cannot be verified.' }
    $BitLockerReader = { param($MountPoint) Get-BitLockerVolume -MountPoint $MountPoint -ErrorAction Stop }
  }
  $root = [IO.Path]::GetPathRoot($parent)
  $volumeRows = @(& $BitLockerReader $root.TrimEnd('\'))
  if ($volumeRows.Count -ne 1) { throw 'BitLocker status did not identify exactly one destination volume.' }
  Assert-BitLockerProtection -Path $parent -Volume $volumeRows[0]

  if ($null -eq $FreeSpaceReader) {
    $FreeSpaceReader = { param($DriveRoot) ([IO.DriveInfo]::new($DriveRoot)).AvailableFreeSpace }
  }
  $available = [long](& $FreeSpaceReader $root)
  if ($available -lt $RequiredFreeBytes) { throw 'Destination volume does not have the approved minimum free space.' }

  $leaf = 'kzero-onboarding-production-backup-' + $Timestamp.ToUniversalTime().ToString('yyyyMMdd-HHmmssZ')
  $backupRoot = Join-Path $parent $leaf
  if (Test-Path -LiteralPath $backupRoot) { throw 'Dedicated backup directory already exists; choose a new timestamped operation.' }
  New-Item -ItemType Directory -Path $backupRoot -ErrorAction Stop | Out-Null
  try {
    Assert-NoReparsePointPath -Path $backupRoot -ItemReader $ItemReader
    if ($null -eq $AclWriter) {
      $AclWriter = {
        param($Path, $Operator)
        & icacls.exe $Path /inheritance:r /grant:r "$Operator`:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not restrict backup-directory access.' }
      }
    }
    & $AclWriter $backupRoot $OperatorIdentity
    if ($null -eq $AclReader) { $AclReader = { param($Path) Get-Acl -LiteralPath $Path -ErrorAction Stop } }
    $acl = & $AclReader $backupRoot
    Assert-RestrictedBackupAcl -Acl $acl -AllowedIdentities @($OperatorIdentity, 'NT AUTHORITY\SYSTEM')
  } catch {
    if ((Test-Path -LiteralPath $backupRoot -PathType Container) -and
        @(Get-ChildItem -LiteralPath $backupRoot -Force).Count -eq 0) {
      Remove-Item -LiteralPath $backupRoot -Force -ErrorAction SilentlyContinue
    }
    throw
  }
  return [pscustomobject]@{
    BackupRoot = $backupRoot
    DestinationVolume = $root
    AvailableFreeBytes = $available
    RequiredFreeBytes = $RequiredFreeBytes
    OperatorIdentity = $OperatorIdentity
  }
}

Export-ModuleMember -Function @(
  'Get-NormalizedAbsoluteLocalPath', 'Assert-PathOutsideRepository', 'Assert-NoReparsePointPath',
  'Assert-BitLockerProtection', 'Assert-RestrictedBackupAcl', 'Resolve-Postgres17Tools',
  'Assert-SingleCommandRow', 'Test-ProductionSourceIdentity', 'Get-OnlineRiskDiagnostic', 'Assert-OnlineRiskResult', 'Clear-ProductionBackupPgEnvironment',
  'Assert-ArchiveArtifacts', 'Move-InvalidArchiveToQuarantine', 'New-ProductionBackupMetadata',
  'Get-RequiredBackupFreeBytes', 'Invoke-GuardedBackupCore', 'New-ProtectedBackupDirectory'
)
