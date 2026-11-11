[CmdletBinding()]
param(
  [switch] $OfflineSelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedResourceName = 'onboarding-portal-db'
$ExpectedProductionCommit = '1abfcfeb9547fdd538c85dc29309ea4b455df4eb'
$ExpectedResourceConfirmation = 'I_CONFIRM_PRODUCTION_CREDENTIALS_BELONG_TO_ONBOARDING_PORTAL_DB'
$RehearsalFingerprints = @('08ff4f34119b6190', 'd68f44858bab013e')
$ExpectedMigrations = @(
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
$ExpectedTables = @(
  '_prisma_migrations',
  'admin_notifications',
  'documents',
  'msps',
  'oidc_configs',
  'onboarding_plans',
  'onboarding_tasks',
  'saas_app_submissions'
) | Sort-Object
$TemporaryPgVariables = @(
  'PGAPPNAME',
  'PGCONNECT_TIMEOUT',
  'PGDATABASE',
  'PGHOST',
  'PGOPTIONS',
  'PGPASSWORD',
  'PGPORT',
  'PGSSLMODE',
  'PGUSER'
)
$ConflictingPgVariables = @(
  'PGAPPNAME',
  'PGCONNECT_TIMEOUT',
  'PGDATABASE',
  'PGHOST',
  'PGOPTIONS',
  'PGPASSFILE',
  'PGPASSWORD',
  'PGPORT',
  'PGSERVICE',
  'PGSERVICEFILE',
  'PGSSLMODE',
  'PGTARGETSESSIONATTRS',
  'PGUSER'
)

$RepositoryRoot = Split-Path -Parent $PSScriptRoot
$PsqlPath = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
$TemporaryEnvironmentApplied = $false
$PooledSecure = $null
$DirectSecure = $null
$ProductionPooled = $null
$ProductionDirect = $null
$DatabaseId = $null
$ProjectId = $null
$PooledCredentialId = $null
$DirectCredentialId = $null
$CredentialComparisonKey = New-Object byte[] 32
$randomNumberGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $randomNumberGenerator.GetBytes($CredentialComparisonKey)
} finally {
  $randomNumberGenerator.Dispose()
}

function Read-NormalizedIdentityInput {
  param(
    [Parameter(Mandatory)] [string] $Prompt,
    [Parameter(Mandatory)] [string] $FieldName,
    [switch] $AllowEmpty,
    [scriptblock] $InputReader
  )

  $rawValue = if ($null -ne $InputReader) {
    & $InputReader $Prompt
  } else {
    Read-Host $Prompt
  }

  if ($null -eq $rawValue) {
    $rawValue = ''
  }
  $normalizedValue = ([string]$rawValue).Trim()
  if (-not $AllowEmpty -and [string]::IsNullOrWhiteSpace($normalizedValue)) {
    throw "$FieldName is required."
  }
  return $normalizedValue
}

function Assert-ProductionResourceEvidence {
  param(
    [Parameter(Mandatory)] [string] $ResourceName,
    [Parameter(Mandatory)] [string] $DatabaseId,
    [AllowEmptyString()] [string] $ProjectId,
    [Parameter(Mandatory)] [string] $PooledCredentialId,
    [Parameter(Mandatory)] [string] $DirectCredentialId,
    [Parameter(Mandatory)] [string] $Confirmation
  )

  if ($ResourceName -ne $script:ExpectedResourceName) {
    throw 'The independently verified Prisma resource name is not the approved production resource.'
  }
  if ($DatabaseId -notmatch '^db_[A-Za-z0-9][A-Za-z0-9_-]*$') {
    throw 'Database ID validation failed: enter the Prisma database identifier beginning with db_; a project ID is not accepted.'
  }
  if ($ProjectId -and $ProjectId -notmatch '^proj_[A-Za-z0-9][A-Za-z0-9_-]*$') {
    throw 'Project ID validation failed: optional Prisma project evidence must begin with proj_.'
  }
  if ($PooledCredentialId -notmatch '^con_[A-Za-z0-9][A-Za-z0-9_-]*$' -or
      $DirectCredentialId -notmatch '^con_[A-Za-z0-9][A-Za-z0-9_-]*$') {
    throw 'Credential ID validation failed: both identifiers must begin with con_.'
  }
  if ($PooledCredentialId -ne $DirectCredentialId) {
    throw 'The pooled and direct URLs must be independently confirmed as endpoints of the same Prisma con_ credential.'
  }
  if ($Confirmation -ne $script:ExpectedResourceConfirmation) {
    throw 'Independent production resource and credential confirmation was not supplied.'
  }
}

function Assert-ProductionConnectionPair {
  param(
    [Parameter(Mandatory)] $Pooled,
    [Parameter(Mandatory)] $Direct,
    [string[]] $DisallowedFingerprints = $script:RehearsalFingerprints
  )

  if ($Pooled.DatabaseUser -cne $Direct.DatabaseUser -or
      -not (Test-ByteArrayEquality -First $Pooled.CredentialProof -Second $Direct.CredentialProof)) {
    throw 'The pooled and direct URLs do not contain the same Prisma database username and password pair.'
  }
  if ($Pooled.Database -ne $Direct.Database) {
    throw 'Production pooled and direct URLs name different databases.'
  }
  if ($Pooled.Fingerprint -eq $Direct.Fingerprint) {
    throw 'Production pooled and direct connection identities unexpectedly match.'
  }
  if ($DisallowedFingerprints -contains $Pooled.Fingerprint -or
      $DisallowedFingerprints -contains $Direct.Fingerprint) {
    throw 'A production connection fingerprint matches the rehearsal database.'
  }
}

function Test-ByteArrayEquality {
  param(
    [Parameter(Mandatory)] [byte[]] $First,
    [Parameter(Mandatory)] [byte[]] $Second
  )

  if ($First.Length -ne $Second.Length) {
    return $false
  }
  $difference = 0
  for ($index = 0; $index -lt $First.Length; $index += 1) {
    $difference = $difference -bor ($First[$index] -bxor $Second[$index])
  }
  return $difference -eq 0
}

function Clear-TemporaryPgEnvironment {
  if ($script:TemporaryEnvironmentApplied) {
    foreach ($variableName in $script:TemporaryPgVariables) {
      Remove-Item "Env:$variableName" -ErrorAction SilentlyContinue
    }
    $script:TemporaryEnvironmentApplied = $false
  }
}

function Get-ConnectionFingerprint {
  param(
    [Parameter(Mandatory)] [Security.SecureString] $SecureUrl,
    [Parameter(Mandatory)] [ValidateSet('pooled', 'direct')] [string] $Kind,
    [switch] $SetLibpqEnvironment
  )

  $pointer = [IntPtr]::Zero
  $raw = $null
  $username = $null
  $password = $null
  $passwordBytes = $null
  $credentialProof = $null

  try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureUrl)
    $raw = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $uri = [Uri]$raw

    if ($uri.Scheme -notin @('postgres', 'postgresql')) {
      throw "$Kind URL must use the postgres or postgresql scheme."
    }

    $expectedHost = if ($Kind -eq 'pooled') { 'pooled.db.prisma.io' } else { 'db.prisma.io' }
    if ($uri.Host -ne $expectedHost) {
      throw "$Kind URL must use the expected Prisma Postgres host."
    }
    if ($uri.Query -notmatch '(^|[?&])sslmode=require(&|$)') {
      throw "$Kind URL must contain sslmode=require."
    }

    $separator = $uri.UserInfo.IndexOf(':')
    if ($separator -lt 1) {
      throw "$Kind URL is missing credentials."
    }

    $username = [Uri]::UnescapeDataString($uri.UserInfo.Substring(0, $separator))
    $password = [Uri]::UnescapeDataString($uri.UserInfo.Substring($separator + 1))
    $passwordBytes = [Text.Encoding]::UTF8.GetBytes($password)
    $hmac = [Security.Cryptography.HMACSHA256]::new($script:CredentialComparisonKey)
    try {
      $credentialProof = $hmac.ComputeHash($passwordBytes)
    } finally {
      $hmac.Dispose()
    }
    $database = [Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/'))
    $port = if ($uri.IsDefaultPort) { '5432' } else { [string]$uri.Port }
    if (-not $database) {
      throw "$Kind URL does not name a database."
    }

    $identity = "$($username.ToLowerInvariant())@$($uri.Host.ToLowerInvariant()):$port/$($database.ToLowerInvariant())"
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
      $hash = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($identity))
      $fingerprint = -join ($hash[0..7] | ForEach-Object { $_.ToString('x2') })
    } finally {
      $sha.Dispose()
    }

    if ($SetLibpqEnvironment) {
      $script:TemporaryEnvironmentApplied = $true
      $env:PGUSER = $username
      $env:PGPASSWORD = $password
      $env:PGHOST = $uri.Host
      $env:PGPORT = $port
      $env:PGDATABASE = $database
      $env:PGSSLMODE = 'require'
      $env:PGCONNECT_TIMEOUT = '15'
      $env:PGAPPNAME = 'kzero-production-readonly-prebackup'
      $env:PGOPTIONS = '-c default_transaction_read_only=on -c statement_timeout=30000'
    }

    return [pscustomobject]@{
      Kind = $Kind
      Database = $database
      DatabaseUser = $username
      CredentialProof = $credentialProof
      Fingerprint = $fingerprint
    }
  } finally {
    if ($pointer -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    $raw = $null
    $username = $null
    $password = $null
    if ($null -ne $passwordBytes) {
      [Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
    }
  }
}

function ConvertTo-LineArray {
  param([AllowNull()] $InputObject)

  $lines = @($InputObject | Where-Object {
    $null -ne $_ -and -not [string]::IsNullOrWhiteSpace([string]$_)
  })
  Write-Output -NoEnumerate $lines
}

function Invoke-NativePsqlCommand {
  param([Parameter(Mandatory)] [string] $Sql)

  $nativeOutput = @(& $script:PsqlPath -X --set=ON_ERROR_STOP=1 --tuples-only --no-align --command $Sql 2>$null)
  $nativeExitCode = $LASTEXITCODE
  [pscustomobject]@{
    ExitCode = $nativeExitCode
    Lines = $nativeOutput
  }
}

function Invoke-ReadOnlyPsql {
  param(
    [Parameter(Mandatory)] [string] $Sql,
    [Parameter(Mandatory)] [string] $Stage,
    [scriptblock] $CommandInvoker
  )

  $callLine = $MyInvocation.ScriptLineNumber
  try {
    $result = if ($null -ne $CommandInvoker) {
      & $CommandInvoker $Sql
    } else {
      Invoke-NativePsqlCommand -Sql $Sql
    }
  } catch {
    throw "[Stage: $Stage] [Script line: $callLine] PostgreSQL command execution failed; credential-bearing diagnostics were suppressed."
  }

  if ($null -eq $result -or
      $null -eq $result.PSObject.Properties['ExitCode'] -or
      $null -eq $result.PSObject.Properties['Lines']) {
    throw "[Stage: $Stage] [Script line: $callLine] PostgreSQL command returned a malformed execution result."
  }
  if ([int]$result.ExitCode -ne 0) {
    throw "[Stage: $Stage] [Script line: $callLine] Read-only PostgreSQL query failed with native exit code $([int]$result.ExitCode); diagnostics were suppressed."
  }

  ConvertTo-LineArray -InputObject $result.Lines
}

function Assert-DatabaseIdentityResult {
  param(
    [AllowNull()] [object[]] $Lines,
    [Parameter(Mandatory)] [string] $ExpectedDatabase
  )

  $callLine = $MyInvocation.ScriptLineNumber
  $safeLines = @($Lines | Where-Object {
    $null -ne $_ -and -not [string]::IsNullOrWhiteSpace([string]$_)
  })
  if ($safeLines.Count -ne 1) {
    throw "[Stage: database-identity] [Script line: $callLine] Expected exactly one identity row; found $($safeLines.Count)."
  }
  $identity = @(([string]$safeLines[0]) -split '\|', 4)
  if ($identity.Count -ne 4 -or
      $identity[0] -ne $ExpectedDatabase -or
      $identity[1] -ne 'public' -or
      $identity[2] -notmatch '^17\.' -or
      $identity[3] -ne 'on') {
    throw "[Stage: database-identity] [Script line: $callLine] Database identity, schema, PostgreSQL version, or read-only enforcement did not match expectations."
  }
  Write-Output -NoEnumerate $identity
}

function Assert-MigrationHistoryResult {
  param(
    [AllowNull()] [object[]] $Lines,
    [Parameter(Mandatory)] [string] $MigrationRoot
  )

  $callLine = $MyInvocation.ScriptLineNumber
  $safeLines = @($Lines | Where-Object {
    $null -ne $_ -and -not [string]::IsNullOrWhiteSpace([string]$_)
  })
  if ($safeLines.Count -ne $script:ExpectedMigrations.Count) {
    throw "[Stage: migration-history] [Script line: $callLine] Expected exactly nine migration records; found $($safeLines.Count)."
  }

  $results = @()
  for ($index = 0; $index -lt $script:ExpectedMigrations.Count; $index += 1) {
    $parts = @(([string]$safeLines[$index]) -split '\|', 3)
    if ($parts.Count -ne 3) {
      throw "[Stage: migration-history] [Script line: $callLine] Migration record $($index + 1) is malformed."
    }
    $name = $parts[0]
    $databaseChecksum = $parts[1]
    $status = $parts[2]
    if ($name -ne $script:ExpectedMigrations[$index]) {
      throw "[Stage: migration-history] [Script line: $callLine] Unexpected or duplicate migration at position $($index + 1)."
    }
    if ($status -ne 'SUCCESS') {
      throw "[Stage: migration-history] [Script line: $callLine] Migration $name is not successfully applied (status: $status)."
    }

    $migrationFile = Join-Path $MigrationRoot "$name\migration.sql"
    if (-not (Test-Path -LiteralPath $migrationFile -PathType Leaf)) {
      throw "[Stage: migration-checksum] [Script line: $callLine] Repository migration file is missing: $name."
    }
    $repositoryChecksum = (Get-FileHash -Algorithm SHA256 -LiteralPath $migrationFile).Hash
    if ($databaseChecksum -ine $repositoryChecksum) {
      throw "[Stage: migration-checksum] [Script line: $callLine] Migration SQL checksum mismatch: $name."
    }
    $results += [pscustomobject]@{
      Position = $index + 1
      Migration = $name
      Status = $status
      ChecksumMatches = $true
    }
  }
  $results
}

function Assert-TableInventoryResult {
  param([AllowNull()] [object[]] $Lines)

  $callLine = $MyInvocation.ScriptLineNumber
  $actualTables = @($Lines | Where-Object {
    $null -ne $_ -and -not [string]::IsNullOrWhiteSpace([string]$_)
  }) | Sort-Object
  $tableDifference = @(Compare-Object $script:ExpectedTables $actualTables)
  if ($tableDifference.Count -gt 0) {
    throw "[Stage: table-inventory] [Script line: $callLine] Production table inventory differs from the exact migration-nine baseline."
  }
}

function Assert-TransactionActivityResult {
  param([AllowNull()] [object[]] $Lines)

  $callLine = $MyInvocation.ScriptLineNumber
  $safeLines = @($Lines | Where-Object {
    $null -ne $_ -and -not [string]::IsNullOrWhiteSpace([string]$_)
  })
  if ($safeLines.Count -ne 1) {
    throw "[Stage: transaction-activity] [Script line: $callLine] Expected exactly one transaction summary row; found $($safeLines.Count)."
  }
  $activity = @(([string]$safeLines[0]) -split '\|', 4)
  if ($activity.Count -ne 4 -or @($activity | Where-Object { $_ -notmatch '^\d+$' }).Count -gt 0) {
    throw "[Stage: transaction-activity] [Script line: $callLine] Transaction summary was null or malformed."
  }
  Write-Output -NoEnumerate $activity
}

function Invoke-OfflineIdentityTests {
  $passed = 0

  function Assert-Throws {
    param(
      [Parameter(Mandatory)] [scriptblock] $Operation,
      [string] $ExpectedMessagePattern
    )
    $threw = $false
    $failureMessage = $null
    foreach ($variableName in $script:TemporaryPgVariables) {
      Set-Item "Env:$variableName" 'OFFLINE_FAILURE_TEST_VALUE'
    }
    $script:TemporaryEnvironmentApplied = $true
    try {
      & $Operation
    } catch {
      $threw = $true
      $failureMessage = $_.Exception.Message
    } finally {
      Clear-TemporaryPgEnvironment
    }
    $remainingAfterFailure = @($script:TemporaryPgVariables | Where-Object { Test-Path "Env:$_" })
    if ($remainingAfterFailure.Count -gt 0) {
      throw 'Temporary PostgreSQL environment cleanup failed during an offline failure test.'
    }
    if (-not $threw) { throw 'Expected offline validation failure did not occur.' }
    if ($ExpectedMessagePattern -and $failureMessage -notmatch $ExpectedMessagePattern) {
      throw 'Offline validation failed without the expected sanitized stage and script-line context.'
    }
  }

  function Get-DummyFingerprint {
    param(
      [Parameter(Mandatory)] [string] $Url,
      [Parameter(Mandatory)] [ValidateSet('pooled', 'direct')] [string] $Kind
    )
    $secure = ConvertTo-SecureString $Url -AsPlainText -Force
    try { return Get-ConnectionFingerprint -SecureUrl $secure -Kind $Kind }
    finally { $secure.Dispose() }
  }

  $realisticDatabaseId = Read-NormalizedIdentityInput `
    -Prompt 'offline database ID' `
    -FieldName 'Database ID' `
    -InputReader { param($promptText) '  db_2zX4Y7pQ8mN6vB3cD9eF1gH5JkL  ' }
  $realisticProjectId = Read-NormalizedIdentityInput `
    -Prompt 'offline project ID' `
    -FieldName 'Project ID' `
    -AllowEmpty `
    -InputReader { param($promptText) ' proj_2zX4Y7pQ8mN6vB3cD9eF1gH5JkL ' }
  $realisticCredentialId = Read-NormalizedIdentityInput `
    -Prompt 'offline credential ID' `
    -FieldName 'Credential ID' `
    -InputReader { param($promptText) ' con_2zX4Y7pQ8mN6vB3cD9eF1gH5JkL ' }

  Assert-ProductionResourceEvidence `
    -ResourceName 'onboarding-portal-db' `
    -DatabaseId $realisticDatabaseId `
    -ProjectId $realisticProjectId `
    -PooledCredentialId $realisticCredentialId `
    -DirectCredentialId $realisticCredentialId `
    -Confirmation $ExpectedResourceConfirmation
  $pooled = Get-DummyFingerprint `
    -Url 'postgresql://prisma_db_user_7Yz:paired-secret@pooled.db.prisma.io:5432/production_test?sslmode=require' `
    -Kind pooled
  $direct = Get-DummyFingerprint `
    -Url 'postgresql://prisma_db_user_7Yz:paired-secret@db.prisma.io:5432/production_test?sslmode=require' `
    -Kind direct
  Assert-ProductionConnectionPair `
    -Pooled $pooled `
    -Direct $direct `
    -DisallowedFingerprints @('unrelated')
  $passed += 1

  Assert-Throws {
    $invalidDatabaseId = Read-NormalizedIdentityInput `
      -Prompt 'offline database ID' `
      -FieldName 'Database ID' `
      -InputReader { param($promptText) 'proj_2zX4Y7pQ8mN6vB3cD9eF1gH5JkL' }
    Assert-ProductionResourceEvidence `
      -ResourceName 'onboarding-portal-db' `
      -DatabaseId $invalidDatabaseId `
      -ProjectId '' `
      -PooledCredentialId $realisticCredentialId `
      -DirectCredentialId $realisticCredentialId `
      -Confirmation $ExpectedResourceConfirmation
  }
  $passed += 1

  Assert-Throws {
    Read-NormalizedIdentityInput `
      -Prompt 'offline database ID' `
      -FieldName 'Database ID' `
      -InputReader { param($promptText) '' }
  }
  $passed += 1

  Assert-Throws {
    Read-NormalizedIdentityInput `
      -Prompt 'offline database ID' `
      -FieldName 'Database ID' `
      -InputReader { param($promptText) " `t " }
  }
  $passed += 1

  Assert-Throws {
    Assert-ProductionResourceEvidence `
      -ResourceName 'kzero-onboarding-rehearsal' `
      -DatabaseId $realisticDatabaseId `
      -ProjectId $realisticProjectId `
      -PooledCredentialId $realisticCredentialId `
      -DirectCredentialId $realisticCredentialId `
      -Confirmation $ExpectedResourceConfirmation
  }
  $passed += 1

  Assert-Throws {
    Get-DummyFingerprint `
      -Url 'postgresql://prisma_db_user_7Yz:paired-secret@db.prisma.io:5432/production_test?sslmode=require' `
      -Kind pooled
  }
  Assert-Throws {
    Get-DummyFingerprint `
      -Url 'postgresql://prisma_db_user_7Yz:paired-secret@pooled.db.prisma.io:5432/production_test?sslmode=require' `
      -Kind direct
  }
  $passed += 1

  Assert-Throws {
    Get-DummyFingerprint `
      -Url 'postgresql://prisma_db_user_7Yz:paired-secret@db.prisma.io:5432/production_test?sslmode=disable' `
      -Kind direct
  }
  $passed += 1

  $differentDatabase = Get-DummyFingerprint `
    -Url 'postgresql://prisma_db_user_7Yz:paired-secret@db.prisma.io:5432/different_database?sslmode=require' `
    -Kind direct
  Assert-Throws {
    Assert-ProductionConnectionPair `
      -Pooled $pooled `
      -Direct $differentDatabase `
      -DisallowedFingerprints @('unrelated')
  }
  $passed += 1

  Assert-Throws {
    Assert-ProductionResourceEvidence `
      -ResourceName 'onboarding-portal-db' `
      -DatabaseId 'proj_not_a_database' `
      -ProjectId '' `
      -PooledCredentialId 'con_sharedcredential' `
      -DirectCredentialId 'con_sharedcredential' `
      -Confirmation $ExpectedResourceConfirmation
  }
  $passed += 1

  Assert-Throws {
    Assert-ProductionResourceEvidence `
      -ResourceName 'onboarding-portal-db' `
      -DatabaseId 'db_offlinetest' `
      -ProjectId 'proj_offlinetest' `
      -PooledCredentialId 'con_firstcredential' `
      -DirectCredentialId 'con_secondcredential' `
      -Confirmation $ExpectedResourceConfirmation
  }
  $passed += 1

  $differentCredential = Get-DummyFingerprint `
    -Url 'postgresql://prisma_db_user_7Yz:different-secret@db.prisma.io:5432/production_test?sslmode=require' `
    -Kind direct
  Assert-Throws {
    Assert-ProductionConnectionPair `
      -Pooled $pooled `
      -Direct $differentCredential `
      -DisallowedFingerprints @('unrelated')
  }
  $passed += 1

  Assert-Throws {
    Assert-ProductionConnectionPair `
      -Pooled $pooled `
      -Direct $direct `
      -DisallowedFingerprints @($pooled.Fingerprint)
  }
  $passed += 1

  $zeroRows = Invoke-ReadOnlyPsql `
    -Sql 'offline zero rows' `
    -Stage 'offline-zero' `
    -CommandInvoker { param($sql) [pscustomobject]@{ ExitCode = 0; Lines = @() } }
  if ($zeroRows.Count -ne 0) { throw 'Zero-row normalization failed.' }
  $oneRow = Invoke-ReadOnlyPsql `
    -Sql 'offline one row' `
    -Stage 'offline-one' `
    -CommandInvoker { param($sql) [pscustomobject]@{ ExitCode = 0; Lines = 'one' } }
  if ($oneRow.Count -ne 1 -or $oneRow[0] -ne 'one') { throw 'One-row normalization failed.' }
  $multipleRows = Invoke-ReadOnlyPsql `
    -Sql 'offline multiple rows' `
    -Stage 'offline-multiple' `
    -CommandInvoker { param($sql) [pscustomobject]@{ ExitCode = 0; Lines = @('one', 'two') } }
  if ($multipleRows.Count -ne 2) { throw 'Multiple-row normalization failed.' }
  $passed += 1

  Assert-Throws `
    -ExpectedMessagePattern '^\[Stage: offline-connection\] \[Script line: \d+\]' `
    -Operation {
      Invoke-ReadOnlyPsql `
        -Sql 'offline connection failure' `
        -Stage 'offline-connection' `
        -CommandInvoker { param($sql) throw 'synthetic connection failure' }
    }
  Assert-Throws {
    Invoke-ReadOnlyPsql `
      -Sql 'offline native failure' `
      -Stage 'offline-native' `
      -CommandInvoker { param($sql) [pscustomobject]@{ ExitCode = 2; Lines = @() } }
  }
  Assert-Throws {
    Invoke-ReadOnlyPsql `
      -Sql 'offline malformed result' `
      -Stage 'offline-malformed' `
      -CommandInvoker { param($sql) $null }
  }
  Assert-Throws {
    Invoke-ReadOnlyPsql `
      -Sql 'offline missing result properties' `
      -Stage 'offline-malformed' `
      -CommandInvoker { param($sql) [pscustomobject]@{ Unexpected = $true } }
  }
  $passed += 1

  $validIdentity = Assert-DatabaseIdentityResult `
    -Lines @('production_test|public|17.6|on') `
    -ExpectedDatabase 'production_test'
  if ($validIdentity.Count -ne 4) { throw 'Valid identity parsing failed.' }
  Assert-Throws {
    Assert-DatabaseIdentityResult -Lines @() -ExpectedDatabase 'production_test'
  }
  Assert-Throws {
    Assert-DatabaseIdentityResult -Lines @('one', 'two') -ExpectedDatabase 'production_test'
  }
  Assert-Throws {
    Assert-DatabaseIdentityResult -Lines @($null) -ExpectedDatabase 'production_test'
  }
  Assert-Throws {
    Assert-DatabaseIdentityResult -Lines @('malformed') -ExpectedDatabase 'production_test'
  }
  $passed += 1

  $migrationRoot = Join-Path $script:RepositoryRoot 'prisma\migrations'
  $validMigrationLines = @($script:ExpectedMigrations | ForEach-Object {
    $migrationFile = Join-Path $migrationRoot "$_\migration.sql"
    $checksum = (Get-FileHash -Algorithm SHA256 -LiteralPath $migrationFile).Hash
    "$_|$checksum|SUCCESS"
  })
  $validMigrationResults = @(Assert-MigrationHistoryResult `
    -Lines $validMigrationLines `
    -MigrationRoot $migrationRoot)
  if ($validMigrationResults.Count -ne 9) { throw 'Valid nine-migration verification failed.' }
  $passed += 1

  Assert-Throws {
    Assert-MigrationHistoryResult `
      -Lines @($validMigrationLines | Select-Object -First 8) `
      -MigrationRoot $migrationRoot
  }
  Assert-Throws {
    $duplicateLines = @($validMigrationLines)
    $duplicateLines[8] = $duplicateLines[7]
    Assert-MigrationHistoryResult -Lines $duplicateLines -MigrationRoot $migrationRoot
  }
  Assert-Throws {
    $failedLines = @($validMigrationLines)
    $failedLines[4] = $failedLines[4] -replace '\|SUCCESS$', '|FAILED'
    Assert-MigrationHistoryResult -Lines $failedLines -MigrationRoot $migrationRoot
  }
  Assert-Throws {
    $incompleteLines = @($validMigrationLines)
    $incompleteLines[4] = $incompleteLines[4] -replace '\|SUCCESS$', '|INCOMPLETE'
    Assert-MigrationHistoryResult -Lines $incompleteLines -MigrationRoot $migrationRoot
  }
  Assert-Throws {
    $invalidChecksumLines = @($validMigrationLines)
    $invalidChecksumLines[4] = $invalidChecksumLines[4] -replace '\|[^|]+\|SUCCESS$', '|invalid-checksum|SUCCESS'
    Assert-MigrationHistoryResult -Lines $invalidChecksumLines -MigrationRoot $migrationRoot
  }
  Assert-Throws {
    Assert-MigrationHistoryResult -Lines @($null) -MigrationRoot $migrationRoot
  }
  $passed += 1

  Assert-TableInventoryResult -Lines $script:ExpectedTables
  Assert-Throws {
    Assert-TableInventoryResult -Lines @($script:ExpectedTables | Select-Object -Skip 1)
  }
  Assert-Throws {
    Assert-TableInventoryResult -Lines @($script:ExpectedTables + 'unexpected_table')
  }
  Assert-Throws {
    Assert-TableInventoryResult -Lines @($null)
  }
  $passed += 1

  $validActivity = Assert-TransactionActivityResult -Lines @('1|2|3|4')
  if ($validActivity.Count -ne 4) { throw 'Valid transaction summary parsing failed.' }
  Assert-Throws { Assert-TransactionActivityResult -Lines @() }
  Assert-Throws { Assert-TransactionActivityResult -Lines @('1|2|not-a-number|4') }
  Assert-Throws { Assert-TransactionActivityResult -Lines @('1|2|3|4', '5|6|7|8') }
  Assert-Throws { Assert-TransactionActivityResult -Lines @($null) }
  $passed += 1

  foreach ($variableName in $TemporaryPgVariables) {
    Set-Item "Env:$variableName" 'OFFLINE_TEST_VALUE'
  }
  $script:TemporaryEnvironmentApplied = $true
  try {
    throw 'Injected offline verification failure.'
  } catch {
    # Expected failure used to exercise the same cleanup path as verification.
  } finally {
    Clear-TemporaryPgEnvironment
  }
  $remaining = @($TemporaryPgVariables | Where-Object { Test-Path "Env:$_" })
  if ($remaining.Count -gt 0) {
    throw "Temporary environment cleanup failed for: $($remaining -join ', ')."
  }
  $passed += 1

  [pscustomobject]@{
    Offline = $true
    DatabaseConnections = 0
    TestsPassed = $passed
    TestsFailed = 0
  } | Format-List
}

if ($OfflineSelfTest) {
  try {
    Invoke-OfflineIdentityTests
  } finally {
    [Array]::Clear($CredentialComparisonKey, 0, $CredentialComparisonKey.Length)
  }
  return
}

try {
  if (-not (Test-Path -LiteralPath $PsqlPath -PathType Leaf)) {
    throw 'PostgreSQL 17 psql.exe was not found at the approved path.'
  }
  $versionOutput = @(& $PsqlPath --version 2>$null)
  $versionExitCode = $LASTEXITCODE
  if ($versionExitCode -ne 0 -or
      $versionOutput.Count -ne 1 -or
      [string]$versionOutput[0] -notmatch '^psql \(PostgreSQL\) 17\.') {
    throw '[Stage: psql-runtime] The approved PostgreSQL 17 psql executable could not be verified.'
  }

  $preExistingVariables = @($ConflictingPgVariables | Where-Object { Test-Path "Env:$_" })
  if ($preExistingVariables.Count -gt 0) {
    throw "Refusing to run while libpq environment variables already exist: $($preExistingVariables -join ', '). Open a clean PowerShell session."
  }

  $resourceName = Read-NormalizedIdentityInput `
    -Prompt 'Enter the Prisma production resource name shown in the Console' `
    -FieldName 'Production resource name'
  $DatabaseId = Read-NormalizedIdentityInput `
    -Prompt 'Enter the Prisma database ID beginning with db_ for onboarding-portal-db' `
    -FieldName 'Database ID'
  $ProjectId = Read-NormalizedIdentityInput `
    -Prompt 'Optional: enter the Prisma project ID beginning with proj_ (or press Enter)' `
    -FieldName 'Project ID' `
    -AllowEmpty
  $PooledCredentialId = Read-NormalizedIdentityInput `
    -Prompt 'Enter the non-secret pooled credential ID shown for that resource' `
    -FieldName 'Pooled credential ID'
  $DirectCredentialId = Read-NormalizedIdentityInput `
    -Prompt 'Enter the non-secret direct credential ID shown for that resource' `
    -FieldName 'Direct credential ID'
  $resourceConfirmation = Read-NormalizedIdentityInput `
    -Prompt "Type $ExpectedResourceConfirmation after independently verifying both credentials" `
    -FieldName 'Production resource confirmation'
  Assert-ProductionResourceEvidence `
    -ResourceName $resourceName `
    -DatabaseId $DatabaseId `
    -ProjectId $ProjectId `
    -PooledCredentialId $PooledCredentialId `
    -DirectCredentialId $DirectCredentialId `
    -Confirmation $resourceConfirmation

  try {
    $PooledSecure = Read-Host 'Paste onboarding-portal-db POOLED URL' -AsSecureString
    $ProductionPooled = Get-ConnectionFingerprint -SecureUrl $PooledSecure -Kind pooled
  } finally {
    if ($null -ne $PooledSecure) {
      $PooledSecure.Dispose()
      $PooledSecure = $null
    }
  }

  try {
    $DirectSecure = Read-Host 'Paste onboarding-portal-db DIRECT URL' -AsSecureString
    $ProductionDirect = Get-ConnectionFingerprint -SecureUrl $DirectSecure -Kind direct -SetLibpqEnvironment
  } finally {
    if ($null -ne $DirectSecure) {
      $DirectSecure.Dispose()
      $DirectSecure = $null
    }
  }

  Assert-ProductionConnectionPair `
    -Pooled $ProductionPooled `
    -Direct $ProductionDirect

  $identitySql = @'
SELECT current_database() || '|' ||
       current_schema() || '|' ||
       current_setting('server_version') || '|' ||
       current_setting('transaction_read_only');
'@
  $identityLines = Invoke-ReadOnlyPsql `
    -Sql $identitySql `
    -Stage 'database-identity'
  $identity = Assert-DatabaseIdentityResult `
    -Lines $identityLines `
    -ExpectedDatabase $ProductionDirect.Database

  $migrationSql = @'
SELECT migration_name || '|' || checksum || '|' ||
  CASE
    WHEN finished_at IS NOT NULL AND rolled_back_at IS NULL THEN 'SUCCESS'
    WHEN rolled_back_at IS NOT NULL THEN 'ROLLED_BACK'
    WHEN logs IS NOT NULL THEN 'FAILED'
    ELSE 'INCOMPLETE'
  END
FROM "_prisma_migrations"
ORDER BY started_at, migration_name;
'@
  $migrationLines = Invoke-ReadOnlyPsql `
    -Sql $migrationSql `
    -Stage 'migration-history'
  $migrationResults = @(Assert-MigrationHistoryResult `
    -Lines $migrationLines `
    -MigrationRoot (Join-Path $RepositoryRoot 'prisma\migrations'))

  $tableSql = @'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
'@
  $actualTables = Invoke-ReadOnlyPsql `
    -Sql $tableSql `
    -Stage 'table-inventory'
  Assert-TableInventoryResult -Lines $actualTables

  $activitySql = @'
SELECT
  (count(*) FILTER (WHERE state <> 'idle'))::text || '|' ||
  (count(*) FILTER (WHERE xact_start IS NOT NULL))::text || '|' ||
  (count(*) FILTER (WHERE backend_xid IS NOT NULL))::text || '|' ||
  COALESCE(
    max(EXTRACT(EPOCH FROM clock_timestamp() - xact_start))
      FILTER (WHERE xact_start IS NOT NULL),
    0
  )::bigint::text
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid();
'@
  $activityLines = Invoke-ReadOnlyPsql `
    -Sql $activitySql `
    -Stage 'transaction-activity'
  $activity = Assert-TransactionActivityResult -Lines $activityLines

  Write-Output ''
  Write-Output 'READ-ONLY PRODUCTION PRE-BACKUP VERIFICATION PASSED'
  [pscustomobject]@{
    ResourceName = $ExpectedResourceName
    DatabaseIdValidated = $true
    ProjectEvidenceProvided = -not [string]::IsNullOrWhiteSpace($ProjectId)
    ManualCredentialAssociationConfirmed = $true
    PairedUrlCredentialsMatch = $true
    Database = $identity[0]
    Schema = $identity[1]
    PostgreSQLVersion = $identity[2]
    TransactionReadOnly = $identity[3]
    ProductionPooledFingerprint = $ProductionPooled.Fingerprint
    ProductionDirectFingerprint = $ProductionDirect.Fingerprint
    RehearsalFingerprintCollision = $false
    ExactMigrationCount = $migrationResults.Count
    MigrationChecksumsMatch = $true
    ExactTableInventoryMatches = $true
    NonIdleSessions = [int64]$activity[0]
    OpenTransactions = [int64]$activity[1]
    TransactionsWithXid = [int64]$activity[2]
    OldestOpenTransactionSeconds = [int64]$activity[3]
  } | Format-List
  $migrationResults | Format-Table -AutoSize
  Write-Warning "Before any backup, independently verify that live Vercel Production serves commit $ExpectedProductionCommit."
  Write-Warning 'A point-in-time transaction result does not replace the required production write freeze during source-count capture and pg_dump.'
} finally {
  if ($null -ne $PooledSecure) {
    $PooledSecure.Dispose()
  }
  if ($null -ne $DirectSecure) {
    $DirectSecure.Dispose()
  }
  Clear-TemporaryPgEnvironment
  $ProductionPooled = $null
  $ProductionDirect = $null
  $DatabaseId = $null
  $ProjectId = $null
  $PooledCredentialId = $null
  $DirectCredentialId = $null
  [Array]::Clear($CredentialComparisonKey, 0, $CredentialComparisonKey.Length)
  Write-Output 'Temporary PostgreSQL connection environment cleanup completed.'
}
