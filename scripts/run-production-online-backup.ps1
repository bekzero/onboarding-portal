[CmdletBinding()]
param(
  [switch]$IdentityDiagnosticOnly,
  [switch]$RiskDiagnosticOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-ProductionOnlineBackupEntrypoint {
  [CmdletBinding()]
  param(
    [scriptblock]$InputReader,
    [scriptblock]$BitLockerReader,
    [scriptblock]$AclReader,
    [scriptblock]$FreeSpaceReader,
    [scriptblock]$ToolResolver,
    [scriptblock]$OperatorIdentityProvider,
    [scriptblock]$CoreInvoker,
    [switch]$IdentityDiagnosticOnly,
    [switch]$RiskDiagnosticOnly,
    [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$ExpectedDirectFingerprint = '574952707912a7c3',
    [string[]]$ForbiddenFingerprints = @('08ff4f34119b6190','d68f44858bab013e')
  )

  if ($IdentityDiagnosticOnly -and $RiskDiagnosticOnly) { throw 'Choose only one diagnostic-only mode.' }

  Import-Module (Join-Path $RepositoryRoot 'scripts\production-online-backup-support.psm1') -Force
  if ($null -eq $InputReader) {
    $InputReader = { param($Prompt,$Secure) if ($Secure) { Read-Host $Prompt -AsSecureString } else { Read-Host $Prompt } }
  }
  if ($null -eq $BitLockerReader) { $BitLockerReader = { param($MountPoint) Get-BitLockerVolume -MountPoint $MountPoint -ErrorAction Stop } }
  if ($null -eq $AclReader) { $AclReader = { param($Path) Get-Acl -LiteralPath $Path -ErrorAction Stop } }
  if ($null -eq $FreeSpaceReader) { $FreeSpaceReader = { param($Root) (New-Object IO.DriveInfo -ArgumentList $Root).AvailableFreeSpace } }
  if ($null -eq $ToolResolver) { $ToolResolver = { Resolve-Postgres17Tools -BinPath 'C:\Program Files\PostgreSQL\17\bin' } }
  if ($null -eq $OperatorIdentityProvider) { $OperatorIdentityProvider = { [Security.Principal.WindowsIdentity]::GetCurrent().Name } }
  if ($null -eq $CoreInvoker) { $CoreInvoker = { param($Arguments) Invoke-GuardedBackupCore @Arguments } }

  $expectedCommit = '1abfcfeb9547fdd538c85dc29309ea4b455df4eb'
  $expectedMigrations = @(
    '20260617185715_init','20260617194303_add_admin_reporting_fields',
    '20260617194747_add_onboarding_plan_reporting_fields','20260619110000_add_first_customer_pilot_fields',
    '20260625143000_add_admin_notifications','20260703120000_add_msp_enrollment_date',
    '20260713120000_add_msp_gmm_partner_flag','20260715120000_add_customer_name_to_onboarding_plan',
    '20260715153000_add_document_storage_fields'
  )
  $requiredTables = @('_prisma_migrations','msps','onboarding_plans','onboarding_tasks','saas_app_submissions','documents','oidc_configs','admin_notifications')
  $pgVariables = @('PGAPPNAME','PGCONNECT_TIMEOUT','PGDATABASE','PGHOST','PGOPTIONS','PGPASSWORD','PGPORT','PGSSLMODE','PGUSER')
  $secureUrl = $null
  $pointer = [IntPtr]::Zero
  $rawUrl = $null
  $environmentApplied = $false

  try {
    $backupRootInput = & $InputReader 'Prepared dedicated backup directory from preparation-evidence.json' $false
    if ([string]::IsNullOrWhiteSpace([string]$backupRootInput)) { throw 'Backup directory prompt was cancelled or empty.' }
    $backupRoot = (Resolve-Path -LiteralPath (Get-NormalizedAbsoluteLocalPath ([string]$backupRootInput)) -ErrorAction Stop).Path
    Assert-PathOutsideRepository -Path $backupRoot -RepositoryRoot $RepositoryRoot
    Assert-NoReparsePointPath -Path $backupRoot
    if ((Split-Path -Leaf $backupRoot) -notmatch '^kzero-onboarding-production-backup-\d{8}-\d{6}Z$') { throw 'Backup directory is not a dedicated preparation-script directory.' }

    $preparationEvidencePath = Join-Path $backupRoot 'preparation-evidence.json'
    if (-not (Test-Path -LiteralPath $preparationEvidencePath -PathType Leaf)) { throw 'Preparation evidence is missing.' }
    $preparationEvidence = Get-Content -LiteralPath $preparationEvidencePath -Raw | ConvertFrom-Json
    if ($preparationEvidence.backupRoot -ne $backupRoot -or $preparationEvidence.databaseConnected -ne $false -or $preparationEvidence.backupExecuted -ne $false) { throw 'Preparation evidence does not match this unused backup directory.' }
    foreach ($property in @('observedProductionDatabaseSizeBytes','databaseSizeEvidenceReference','freeSpaceHeadroomMultiplier','requiredFreeBytes')) {
      if ($preparationEvidence.PSObject.Properties.Name -notcontains $property) { throw "Preparation evidence is missing $property." }
    }
    $calculatedFreeBytes = Get-RequiredBackupFreeBytes -ObservedDatabaseSizeBytes ([long]$preparationEvidence.observedProductionDatabaseSizeBytes) -HeadroomMultiplier ([int]$preparationEvidence.freeSpaceHeadroomMultiplier)
    if ([string]::IsNullOrWhiteSpace([string]$preparationEvidence.databaseSizeEvidenceReference) -or $calculatedFreeBytes -ne [long]$preparationEvidence.requiredFreeBytes) { throw 'Approved database-size evidence or free-space headroom is invalid.' }

    $volumeRows = @(& $BitLockerReader ([IO.Path]::GetPathRoot($backupRoot)).TrimEnd('\'))
    if ($volumeRows.Count -ne 1) { throw 'Could not identify exactly one BitLocker destination volume.' }
    Assert-BitLockerProtection -Path $backupRoot -Volume $volumeRows[0]
    $operator = [string](& $OperatorIdentityProvider)
    if ([string]::IsNullOrWhiteSpace($operator)) { throw 'Authenticated Windows operator identity is unavailable.' }
    Assert-RestrictedBackupAcl -Acl (& $AclReader $backupRoot) -AllowedIdentities @($operator,'NT AUTHORITY\SYSTEM')
    $availableFreeBytes = [long](& $FreeSpaceReader ([IO.Path]::GetPathRoot($backupRoot)))
    if ($availableFreeBytes -lt [long]$preparationEvidence.requiredFreeBytes) { throw 'Available space fell below the approved preparation threshold.' }

    $tools = & $ToolResolver
    foreach ($name in @('psql','pg_dump','pg_restore')) {
      if ($tools.PSObject.Properties.Name -notcontains $name -or [string]::IsNullOrWhiteSpace([string]$tools.$name)) { throw "PostgreSQL tool resolution is missing $name." }
    }
    foreach ($name in $pgVariables + @('PGPASSFILE','PGSERVICE','PGSERVICEFILE')) {
      if (Test-Path "Env:$name") { throw "Open a clean PowerShell session; $name is already set." }
    }

    $databaseId = [string](& $InputReader 'Confirmed production Prisma database ID (db_)' $false)
    $connectionId = [string](& $InputReader 'Confirmed production Prisma connection ID (con_)' $false)
    if ($databaseId.Trim() -notmatch '^db_[A-Za-z0-9][A-Za-z0-9_-]*$') { throw 'Invalid production database ID.' }
    if ($connectionId.Trim() -notmatch '^con_[A-Za-z0-9][A-Za-z0-9_-]*$') { throw 'Invalid production connection ID.' }
    $databaseId = $databaseId.Trim(); $connectionId = $connectionId.Trim()
    if ([string](& $InputReader 'Type I_CONFIRM_DDL_AND_DEPLOYMENT_FREEZE_ACTIVE' $false) -ne 'I_CONFIRM_DDL_AND_DEPLOYMENT_FREEZE_ACTIVE') { throw 'DDL/deployment freeze confirmation was not supplied.' }
    if ([string](& $InputReader 'Type I_CONFIRM_ONLINE_BACKUP_FROM_ONBOARDING_PORTAL_DB' $false) -ne 'I_CONFIRM_ONLINE_BACKUP_FROM_ONBOARDING_PORTAL_DB') { throw 'Online backup confirmation was not supplied.' }

    $liveDeploymentId = ([string](& $InputReader 'Operator-confirmed live Vercel Production deployment ID' $false)).Trim()
    $liveDeploymentCommit = ([string](& $InputReader 'Operator-confirmed live Production commit SHA' $false)).Trim().ToLowerInvariant()
    $liveDeploymentAlias = ([string](& $InputReader 'Operator-confirmed live Production alias' $false)).Trim()
    $verifiedText = ([string](& $InputReader 'UTC verification time in ISO 8601 format' $false)).Trim()
    $verifiedUtc = [DateTimeOffset]::MinValue
    if ([string]::IsNullOrWhiteSpace($liveDeploymentId) -or [string]::IsNullOrWhiteSpace($liveDeploymentAlias)) { throw 'Live deployment ID and alias evidence are required.' }
    if ($liveDeploymentCommit -ne $expectedCommit) { throw 'Operator-confirmed live commit is not the approved rollback commit.' }
    if (-not [DateTimeOffset]::TryParse($verifiedText,[ref]$verifiedUtc)) { throw 'Live deployment verification time is invalid.' }

    $secureUrl = & $InputReader 'Paste onboarding-portal-db DIRECT URL' $true
    if ($null -eq $secureUrl -or $secureUrl -isnot [Security.SecureString]) { throw 'Production direct URL prompt was cancelled or invalid.' }
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
    $rawUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $uri = [Uri]$rawUrl
    if ($uri.Scheme -notin @('postgres','postgresql') -or $uri.Host -ne 'db.prisma.io') { throw 'Expected a Prisma PostgreSQL direct URL.' }
    if ($uri.Port -ne 5432 -and -not $uri.IsDefaultPort) { throw 'Expected PostgreSQL port 5432.' }
    if ($uri.Query -notmatch '(^|[?&])sslmode=require(&|$)') { throw 'sslmode=require is mandatory.' }
    $separator = $uri.UserInfo.IndexOf(':')
    if ($separator -lt 1) { throw 'Direct URL is missing credentials.' }
    $env:PGUSER=[Uri]::UnescapeDataString($uri.UserInfo.Substring(0,$separator)); $env:PGPASSWORD=[Uri]::UnescapeDataString($uri.UserInfo.Substring($separator+1))
    $env:PGHOST=$uri.Host; $env:PGPORT='5432'; $env:PGDATABASE=[Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/'))
    $env:PGSSLMODE='require'; $env:PGCONNECT_TIMEOUT='15'; $env:PGAPPNAME='kzero-online-production-backup'; $env:PGOPTIONS='-c default_transaction_read_only=on'
    $environmentApplied = $true

    $identityText="$($env:PGUSER.ToLowerInvariant())@$($env:PGHOST.ToLowerInvariant()):$($env:PGPORT)/$($env:PGDATABASE.ToLowerInvariant())"
    $sha=[Security.Cryptography.SHA256]::Create(); try {$hash=$sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($identityText));$directFingerprint=-join($hash[0..7]|ForEach-Object{$_.ToString('x2')})} finally {$sha.Dispose()}
    if ($directFingerprint -ne $ExpectedDirectFingerprint) { throw 'Direct fingerprint is not the verified production fingerprint.' }
    if ($ForbiddenFingerprints -contains $directFingerprint) { throw 'Production fingerprint collides with rehearsal evidence.' }

    $stamp=(Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmssZ')
    $dumpPath=Join-Path $backupRoot "onboarding-portal-db-$stamp.dump"; $listPath=Join-Path $backupRoot "onboarding-portal-db-$stamp.restore-list.txt"; $metadataPath=Join-Path $backupRoot "onboarding-portal-db-$stamp.metadata.json"
    foreach($path in @($dumpPath,$listPath,$metadataPath)){if(Test-Path -LiteralPath $path){throw "Refusing to overwrite: $path"}}

    $arguments=@{RepositoryRoot=$RepositoryRoot;BackupRoot=$backupRoot;DumpPath=$dumpPath;RestoreListPath=$listPath;MetadataPath=$metadataPath;PsqlPath=$tools.psql;PgDumpPath=$tools.pg_dump;PgRestorePath=$tools.pg_restore;ExpectedMigrations=$expectedMigrations;RequiredTables=$requiredTables;ExpectedDatabaseName=$env:PGDATABASE;DirectFingerprint=$directFingerprint;ExpectedEvidence=@{resource='onboarding-portal-db';directFingerprint=$ExpectedDirectFingerprint;rollbackCommit=$expectedCommit;migrationCount=9;requiredFreeBytes=[long]$preparationEvidence.requiredFreeBytes;observedProductionDatabaseSizeBytes=[long]$preparationEvidence.observedProductionDatabaseSizeBytes;freeSpaceHeadroomMultiplier=[int]$preparationEvidence.freeSpaceHeadroomMultiplier};OperatorConfirmedDeployment=@{deploymentId=$liveDeploymentId;alias=$liveDeploymentAlias;commit=$liveDeploymentCommit;verificationUtc=$verifiedUtc.ToUniversalTime().ToString('o');verifiedBy=$operator};ObservedConnection=@{databaseId=$databaseId;connectionId=$connectionId};IdentityDiagnosticOnly=$IdentityDiagnosticOnly;RiskDiagnosticOnly=$RiskDiagnosticOnly}
    $result = & $CoreInvoker $arguments
    if ($IdentityDiagnosticOnly) {
      if ($null -eq $result -or $result.IdentityDiagnosticOnly -ne $true -or $result.IdentityValidated -ne $true) { throw 'Identity-only diagnostic did not return validated evidence.' }
      return $result
    }
    if ($RiskDiagnosticOnly) {
      if ($null -eq $result -or $result.RiskDiagnosticOnly -ne $true -or $result.IdentityValidated -ne $true) { throw 'Risk-only diagnostic did not return identity-validated evidence.' }
      return $result
    }
    if ($null -eq $result -or $result.BackupSucceeded -ne $true -or -not (Test-Path -LiteralPath $dumpPath -PathType Leaf) -or -not (Test-Path -LiteralPath $listPath -PathType Leaf) -or -not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) { throw 'Guarded backup did not return complete validated success evidence.' }
    return $result
  } finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($null -ne $secureUrl) { $secureUrl.Dispose() }
    $rawUrl = $null
    if ($environmentApplied) { Clear-ProductionBackupPgEnvironment }
    Write-Host 'Temporary PostgreSQL connection environment cleanup completed.'
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  $result = Invoke-ProductionOnlineBackupEntrypoint -IdentityDiagnosticOnly:$IdentityDiagnosticOnly -RiskDiagnosticOnly:$RiskDiagnosticOnly
  if ($RiskDiagnosticOnly) {
    $result | Select-Object BackupSucceeded,RiskDiagnosticOnly,IdentityValidated,SafeForOnlineBackup | Format-List
    Write-Output 'Sanitized risk diagnostic:'
    $result.Diagnostic | ConvertTo-Json -Depth 4
  } else {
    $result | Format-List
  }
}
