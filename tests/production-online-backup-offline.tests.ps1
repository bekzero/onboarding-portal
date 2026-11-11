Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $repositoryRoot 'scripts\production-online-backup-support.psm1') -Force
. (Join-Path $repositoryRoot 'scripts\run-production-online-backup.ps1')
$passed = 0
$failed = 0

function Invoke-Test {
  param([string]$Name, [scriptblock]$Body)
  try { & $Body; $script:passed++; Write-Output "PASS $Name" }
  catch { $script:failed++; Write-Output "FAIL $Name`: $($_.Exception.Message)" }
}
function Assert-Throws { param([scriptblock]$Body) try { & $Body; throw 'Expected failure did not occur.' } catch { if ($_.Exception.Message -eq 'Expected failure did not occur.') { throw } } }
function New-FakeAcl { param([string[]]$Identities, [bool]$Protected = $true)
  [pscustomobject]@{ AreAccessRulesProtected=$Protected; Access=@($Identities | ForEach-Object { [pscustomobject]@{ IdentityReference=$_; AccessControlType='Allow'; IsInherited=$false; FileSystemRights=[Security.AccessControl.FileSystemRights]::FullControl } }) }
}
function New-EntrypointFixture {
  param([string]$Parent,[string]$Leaf)
  $root=Join-Path $Parent $Leaf; New-Item -ItemType Directory -Path $root | Out-Null
  $evidence=[ordered]@{backupRoot=$root;databaseConnected=$false;backupExecuted=$false;observedProductionDatabaseSizeBytes=1024;databaseSizeEvidenceReference='approved-size-evidence-2026-11-10T15:00:00Z';freeSpaceHeadroomMultiplier=3;requiredFreeBytes=3072}
  [IO.File]::WriteAllText((Join-Path $root 'preparation-evidence.json'),($evidence|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
  return $root
}

$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('kzero-online-backup-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
try {
  Invoke-Test 'absolute path accepts drive-rooted path' { if ((Get-NormalizedAbsoluteLocalPath $fixtureRoot) -ne $fixtureRoot.TrimEnd('\')) { throw 'Path normalization mismatch.' } }
  Invoke-Test 'drive-relative path rejected' { Assert-Throws { Get-NormalizedAbsoluteLocalPath 'C:backup' } }
  Invoke-Test 'UNC path rejected' { Assert-Throws { Get-NormalizedAbsoluteLocalPath '\\server\share\backup' } }
  Invoke-Test 'repository path rejected' { Assert-Throws { Assert-PathOutsideRepository -Path (Join-Path $repositoryRoot 'backup') -RepositoryRoot $repositoryRoot } }
  Invoke-Test 'reparse point evidence rejected' {
    $reader={ param($Path) [pscustomobject]@{ Attributes=[IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint } }
    Assert-Throws { Assert-NoReparsePointPath -Path $fixtureRoot -ItemReader $reader }
  }
  $goodVolume=[pscustomobject]@{ MountPoint=([IO.Path]::GetPathRoot($fixtureRoot)); VolumeStatus='FullyEncrypted'; ProtectionStatus='On'; EncryptionPercentage=100; LockStatus='Unlocked' }
  Invoke-Test 'BitLocker completed and protected accepted' { Assert-BitLockerProtection -Path $fixtureRoot -Volume $goodVolume }
  Invoke-Test 'BitLocker incomplete rejected' { $v=$goodVolume.PSObject.Copy(); $v.EncryptionPercentage=99; Assert-Throws { Assert-BitLockerProtection -Path $fixtureRoot -Volume $v } }
  Invoke-Test 'BitLocker protection off rejected' { $v=$goodVolume.PSObject.Copy(); $v.ProtectionStatus='Off'; Assert-Throws { Assert-BitLockerProtection -Path $fixtureRoot -Volume $v } }
  Invoke-Test 'BitLocker wrong volume rejected' { $v=$goodVolume.PSObject.Copy(); $v.MountPoint='Z:'; Assert-Throws { Assert-BitLockerProtection -Path $fixtureRoot -Volume $v } }
  $operator='TEST\Operator'
  Invoke-Test 'restricted ACL accepted' { Assert-RestrictedBackupAcl -Acl (New-FakeAcl @($operator,'NT AUTHORITY\SYSTEM')) -AllowedIdentities @($operator,'NT AUTHORITY\SYSTEM') }
  Invoke-Test 'unexpected ACL rejected' { Assert-Throws { Assert-RestrictedBackupAcl -Acl (New-FakeAcl @($operator,'NT AUTHORITY\SYSTEM','BUILTIN\Users')) -AllowedIdentities @($operator,'NT AUTHORITY\SYSTEM') } }
  Invoke-Test 'inherited ACL rejected' { Assert-Throws { Assert-RestrictedBackupAcl -Acl (New-FakeAcl @($operator,'NT AUTHORITY\SYSTEM') $false) -AllowedIdentities @($operator,'NT AUTHORITY\SYSTEM') } }

  $toolBin=Join-Path $fixtureRoot 'pg17'; New-Item -ItemType Directory -Path $toolBin | Out-Null
  'pg_dump','pg_restore','psql' | ForEach-Object { New-Item -ItemType File -Path (Join-Path $toolBin ($_.ToString()+'.exe')) | Out-Null }
  Invoke-Test 'exact PostgreSQL 17 tools accepted' { $tools=Resolve-Postgres17Tools -BinPath $toolBin -VersionReader { param($p) "$([IO.Path]::GetFileNameWithoutExtension($p)) (PostgreSQL) 17.11" }; if (-not $tools.pg_dump) { throw 'Missing tool.' } }
  Invoke-Test 'wrong PostgreSQL tool version rejected' { Assert-Throws { Resolve-Postgres17Tools -BinPath $toolBin -VersionReader { param($p) 'tool (PostgreSQL) 16.9' } } }

  Invoke-Test 'zero command rows rejected' { Assert-Throws { Assert-SingleCommandRow -Rows @() -Stage 'test' } }
  Invoke-Test 'one command row accepted' { if ((Assert-SingleCommandRow -Rows @('one') -Stage 'test') -ne 'one') { throw 'Row mismatch.' } }
  Invoke-Test 'multiple command rows rejected' { Assert-Throws { Assert-SingleCommandRow -Rows @('one','two') -Stage 'test' } }
  Invoke-Test 'source identity accepts realistic PostgreSQL short false response' {
    $result=Test-ProductionSourceIdentity -QuerySucceeded $true -Rows @('postgres|public|17.2|on|f|username') -ExpectedDatabaseName 'postgres'
    if(-not $result.isValid -or $null -ne $result.failedCheck){throw 'Valid short boolean response was rejected.'}
  }
  Invoke-Test 'source identity accepts canonical primary response' {
    $result=Test-ProductionSourceIdentity -QuerySucceeded $true -Rows @('postgres|public|17.2|on|primary|username') -ExpectedDatabaseName 'postgres'
    if(-not $result.isValid -or -not $result.primaryServerVerified){throw 'Canonical primary response was rejected.'}
  }
  Invoke-Test 'source identity trims harmless field whitespace' {
    $result=Test-ProductionSourceIdentity -QuerySucceeded $true -Rows @('  postgres | public | 17.2 | on | primary | username  ') -ExpectedDatabaseName 'postgres'
    if(-not $result.isValid){throw "Whitespace-normalized identity failed: $($result.failedCheck)"}
  }
  Invoke-Test 'source identity reports incorrect schema' {
    $result=Test-ProductionSourceIdentity -QuerySucceeded $true -Rows @('postgres|private|17.2|on|f|username') -ExpectedDatabaseName 'postgres'
    if($result.isValid -or $result.failedCheck -ne 'schemaMatches'){throw 'Incorrect schema was not identified.'}
  }
  Invoke-Test 'source identity reports database-name mismatch' {
    $result=Test-ProductionSourceIdentity -QuerySucceeded $true -Rows @('other_database|public|17.2|on|f|username') -ExpectedDatabaseName 'postgres'
    if($result.isValid -or $result.failedCheck -ne 'databaseNameMatches'){throw 'Database-name mismatch was not identified.'}
  }
  Invoke-Test 'source identity reports read-only disabled' {
    $result=Test-ProductionSourceIdentity -QuerySucceeded $true -Rows @('postgres|public|17.2|off|f|username') -ExpectedDatabaseName 'postgres'
    if($result.isValid -or $result.failedCheck -ne 'transactionReadOnlyEnabled'){throw 'Read-only failure was not identified.'}
  }
  Invoke-Test 'source identity reports standby server' {
    $result=Test-ProductionSourceIdentity -QuerySucceeded $true -Rows @('postgres|public|17.2|on|standby|username') -ExpectedDatabaseName 'postgres'
    if($result.isValid -or $result.failedCheck -ne 'primaryServerVerified'){throw 'Standby server was not identified.'}
  }
  Invoke-Test 'source identity reports empty response' {
    $result=Test-ProductionSourceIdentity -QuerySucceeded $true -Rows @() -ExpectedDatabaseName 'postgres'
    if($result.isValid -or $result.failedCheck -ne 'resultRowCount' -or $result.resultColumnCount -ne 0){throw 'Empty response was not identified.'}
  }
  Invoke-Test 'source identity reports malformed response' {
    $result=Test-ProductionSourceIdentity -QuerySucceeded $true -Rows @('postgres|public|17.2') -ExpectedDatabaseName 'postgres'
    if($result.isValid -or $result.failedCheck -ne 'resultColumnCount' -or $result.resultColumnCount -ne 3){throw 'Malformed response was not identified.'}
  }
  Invoke-Test 'source identity reports missing database principal' {
    $result=Test-ProductionSourceIdentity -QuerySucceeded $true -Rows @('postgres|public|17.2|on|f|   ') -ExpectedDatabaseName 'postgres'
    if($result.isValid -or $result.failedCheck -ne 'databasePrincipalPresent'){throw 'Missing database principal was not identified.'}
  }
  Invoke-Test 'source identity reports query failure without parsing output' {
    $result=Test-ProductionSourceIdentity -QuerySucceeded $false -Rows $null -ExpectedDatabaseName 'postgres'
    if($result.isValid -or $result.failedCheck -ne 'identityQuerySucceeded'){throw 'Query failure was not identified.'}
  }
  Invoke-Test 'clean online risk row with full visibility accepted' {
    $result=Assert-OnlineRiskResult @('0|0|0|0|0|0|0|0|yes|no')
    if(-not $result.safeForOnlineBackup -or $result.monitoringVisibility -ne 'full'){throw 'Clean risk evidence was rejected.'}
  }
  Invoke-Test 'all three recognized provider background workers with legitimate NULL states are safe' {
    $result=Get-OnlineRiskDiagnostic -QuerySucceeded $true -Rows @('0|0|0|0|0|3|0|0|yes|yes')
    if(-not $result.safeForOnlineBackup -or $result.recognizedProviderBackgroundWorkers.count -ne 3 -or $result.failedChecks.Count -ne 0){throw 'Recognized provider workers caused a false positive.'}
  }
  Invoke-Test 'normal visible client sessions are safe' {
    $result=Get-OnlineRiskDiagnostic -QuerySucceeded $true -Rows @('0|0|0|0|0|0|0|0|yes|no')
    if(-not $result.safeForOnlineBackup -or $result.hiddenClientSessions.count -ne 0 -or $result.unknownBackendSessions.count -ne 0){throw 'Visible client sessions were not accepted.'}
  }
  Invoke-Test 'long transaction risk is identified' {
    $result=Get-OnlineRiskDiagnostic -QuerySucceeded $true -Rows @('1|0|0|0|0|0|0|0|yes|no')
    if($result.safeForOnlineBackup -or $result.transactionsOlderThanFiveMinutes.state -ne 'nonzero' -or $result.failedChecks -notcontains 'transactionsOlderThanFiveMinutes'){throw 'Long transaction was not identified.'}
  }
  Invoke-Test 'AccessExclusiveLock risk is identified' {
    $result=Get-OnlineRiskDiagnostic -QuerySucceeded $true -Rows @('0|1|0|0|0|0|0|0|yes|no')
    if($result.safeForOnlineBackup -or $result.accessExclusiveLocks.count -ne 1 -or $result.failedChecks -notcontains 'accessExclusiveLocks'){throw 'Exclusive lock was not identified.'}
  }
  Invoke-Test 'waiting lock risk is identified' {
    $result=Get-OnlineRiskDiagnostic -QuerySucceeded $true -Rows @('0|0|2|0|0|0|0|0|yes|no')
    if($result.safeForOnlineBackup -or $result.waitingLocks.count -ne 2 -or $result.failedChecks -notcontains 'waitingLocks'){throw 'Waiting locks were not identified.'}
  }
  Invoke-Test 'blocked session risk is identified' {
    $result=Get-OnlineRiskDiagnostic -QuerySucceeded $true -Rows @('0|0|0|1|0|0|0|0|yes|no')
    if($result.safeForOnlineBackup -or $result.blockedSessions.count -ne 1 -or $result.failedChecks -notcontains 'blockedSessions'){throw 'Blocked session was not identified.'}
  }
  Invoke-Test 'active DDL risk is identified' {
    $result=Get-OnlineRiskDiagnostic -QuerySucceeded $true -Rows @('0|0|0|0|1|0|0|0|yes|no')
    if($result.safeForOnlineBackup -or $result.activeDdlSessions.count -ne 1 -or $result.failedChecks -notcontains 'activeDdlSessions'){throw 'Active DDL was not identified.'}
  }
  Invoke-Test 'hidden client activity risk is identified' {
    $result=Get-OnlineRiskDiagnostic -QuerySucceeded $true -Rows @('0|0|0|0|0|0|1|0|yes|yes')
    if($result.safeForOnlineBackup -or $result.hiddenClientSessions.state -ne 'hidden' -or $result.monitoringVisibility -ne 'hidden' -or $result.failedChecks -notcontains 'hiddenClientSessions'){throw 'Hidden client activity was not identified.'}
  }
  Invoke-Test 'unknown backend type fails closed' {
    $result=Get-OnlineRiskDiagnostic -QuerySucceeded $true -Rows @('0|0|0|0|0|0|0|1|yes|yes')
    if($result.safeForOnlineBackup -or $result.unknownBackendSessions.state -ne 'unknown' -or $result.monitoringVisibility -ne 'unknown' -or $result.failedChecks -notcontains 'unknownBackendSessions'){throw 'Unknown backend was not rejected.'}
  }
  Invoke-Test 'restricted monitoring visibility is never treated as safe' {
    $result=Get-OnlineRiskDiagnostic -QuerySucceeded $true -Rows @('0|0|0|0|0|0|0|0|no|no')
    if($result.safeForOnlineBackup -or $result.monitoringVisibility -ne 'restricted' -or $result.failedChecks -notcontains 'monitoringVisibility'){throw 'Restricted visibility was treated as safe.'}
  }
  Invoke-Test 'superuser visibility is recognized without pg_read_all_stats membership' {
    $result=Get-OnlineRiskDiagnostic -QuerySucceeded $true -Rows @('0|0|0|0|0|0|0|0|no|yes')
    if(-not $result.safeForOnlineBackup -or $result.monitoringVisibility -ne 'full'){throw 'Superuser visibility was not recognized.'}
  }
  Invoke-Test 'multiple simultaneous online risks are all reported' {
    $result=Get-OnlineRiskDiagnostic -QuerySucceeded $true -Rows @('2|1|4|1|1|3|1|1|yes|yes')
    if($result.safeForOnlineBackup -or $result.failedChecks.Count -ne 8){throw 'Multiple risks were not reported independently.'}
  }
  Invoke-Test 'recognized background workers do not mask their long transaction or exclusive lock' {
    $result=Get-OnlineRiskDiagnostic -QuerySucceeded $true -Rows @('1|1|0|0|0|3|0|0|yes|yes')
    if($result.safeForOnlineBackup -or $result.failedChecks -notcontains 'transactionsOlderThanFiveMinutes' -or $result.failedChecks -notcontains 'accessExclusiveLocks'){throw 'Provider workers masked a transaction or lock risk.'}
  }
  Invoke-Test 'malformed and unavailable risk evidence remains unknown' {
    $malformed=Get-OnlineRiskDiagnostic -QuerySucceeded $true -Rows @('0|bad')
    $unavailable=Get-OnlineRiskDiagnostic -QuerySucceeded $false -Rows $null
    if($malformed.safeForOnlineBackup -or $malformed.monitoringVisibility -ne 'unknown' -or $unavailable.safeForOnlineBackup -or $unavailable.transactionsOlderThanFiveMinutes.state -ne 'unknown'){throw 'Unknown evidence was treated as safe.'}
  }
  Invoke-Test 'multiple risk rows remain unknown and unsafe' {
    $result=Get-OnlineRiskDiagnostic -QuerySucceeded $true -Rows @('0|0|0|0|0|0|0|0|yes|no','0|0|0|0|0|0|0|0|yes|no')
    if($result.safeForOnlineBackup -or $result.resultRowCount -ne 2 -or $result.monitoringVisibility -ne 'unknown' -or $result.failedChecks -notcontains 'resultRowCount'){throw 'Multiple risk rows were not rejected.'}
  }
  Invoke-Test 'unsafe online risk row is rejected by normal enforcement' { Assert-Throws { Assert-OnlineRiskResult @('0|1|0|0|0|3|0|0|yes|yes') } }

  $archive=Join-Path $fixtureRoot 'archive.dump'; $list=Join-Path $fixtureRoot 'archive.list'
  Invoke-Test 'empty archive rejected' { New-Item -ItemType File -Path $archive -Force | Out-Null; 'TABLE DATA public msps' | Set-Content $list; Assert-Throws { Assert-ArchiveArtifacts -ArchivePath $archive -RestoreListPath $list -RequiredTables @('msps') } }
  Invoke-Test 'complete archive evidence accepted' { [IO.File]::WriteAllBytes($archive,[byte[]](1,2,3)); '1; 0 0 TABLE DATA public msps owner' | Set-Content $list; Assert-ArchiveArtifacts -ArchivePath $archive -RestoreListPath $list -RequiredTables @('msps') }
  Invoke-Test 'partial archive quarantined' { $q=Move-InvalidArchiveToQuarantine -ArchivePath $archive -BackupRoot $fixtureRoot; if (-not (Test-Path $q) -or (Test-Path $archive)) { throw 'Quarantine failed.' } }
  Invoke-Test 'metadata distinguishes expected and operator-confirmed deployment' {
    $m=New-ProductionBackupMetadata -Expected @{commit='expected'} -OperatorConfirmedDeployment @{commit='confirmed';verificationUtc='time'} -ObservedDatabase @{migrationCount=9} -Archive @{validated=$true}
    if ($m.expected.commit -eq $m.operatorConfirmedLiveDeployment.commit) { throw 'Metadata sections were conflated.' }
  }
  Invoke-Test 'free-space threshold provides three-times database-size headroom' {
    if ((Get-RequiredBackupFreeBytes -ObservedDatabaseSizeBytes 1048576 -HeadroomMultiplier 3) -ne 3145728) { throw 'Headroom calculation mismatch.' }
  }
  Invoke-Test 'guarded backup core completes mocked success path and writes PowerShell 5.1 metadata' {
    $operationRoot=Join-Path $fixtureRoot 'mock-success'; New-Item -ItemType Directory -Path $operationRoot | Out-Null
    $dump=Join-Path $operationRoot 'backup.dump'; $list=Join-Path $operationRoot 'backup.list'; $metadata=Join-Path $operationRoot 'backup.metadata.json'
    $migrations=@('20260617185715_init','20260617194303_add_admin_reporting_fields','20260617194747_add_onboarding_plan_reporting_fields','20260619110000_add_first_customer_pilot_fields','20260625143000_add_admin_notifications','20260703120000_add_msp_enrollment_date','20260713120000_add_msp_gmm_partner_flag','20260715120000_add_customer_name_to_onboarding_plan','20260715153000_add_document_storage_fields')
    $migrationRows=@($migrations | ForEach-Object { $hash=(Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $repositoryRoot "prisma\migrations\$_\migration.sql")).Hash; "$_|$hash|SUCCESS" })
    $tables=@('_prisma_migrations','msps','onboarding_plans','onboarding_tasks','saas_app_submissions','documents','oidc_configs','admin_notifications')
    $psql={ param($stage,$sql) switch($stage){ 'identity' {[pscustomobject]@{ExitCode=0;Rows=@('postgres|public|17.2|on|primary|test_user')}} 'migrations' {[pscustomobject]@{ExitCode=0;Rows=$migrationRows}} 'risk' {[pscustomobject]@{ExitCode=0;Rows=@('0|0|0|0|0|3|0|0|yes|yes')}} } }
    $dumpMock={ [IO.File]::WriteAllBytes($dump,[byte[]](1,2,3,4)); 0 }
    $restoreMock={ @($tables | ForEach-Object { "1; 0 0 TABLE DATA public $_ owner" }) | Set-Content -LiteralPath $list; 0 }
    $result=Invoke-GuardedBackupCore -RepositoryRoot $repositoryRoot -BackupRoot $operationRoot -DumpPath $dump -RestoreListPath $list -MetadataPath $metadata -PsqlPath 'mock-psql' -PgDumpPath 'mock-dump' -PgRestorePath 'mock-restore' -ExpectedMigrations $migrations -RequiredTables $tables -ExpectedDatabaseName 'postgres' -DirectFingerprint '574952707912a7c3' -ExpectedEvidence @{rollbackCommit='expected';requiredFreeBytes=300} -OperatorConfirmedDeployment @{deploymentId='dpl_test';commit='confirmed';verifiedBy='TEST\Operator'} -ObservedConnection @{databaseId='db_test';connectionId='con_test'} -PsqlInvoker $psql -DumpInvoker $dumpMock -RestoreListInvoker $restoreMock -UtcNowProvider { [DateTimeOffset]'2026-11-10T15:00:00Z' }
    if (-not $result.BackupSucceeded -or -not (Test-Path $metadata)) { throw 'Mock success evidence was not created.' }
    $parsed=Get-Content -LiteralPath $metadata -Raw | ConvertFrom-Json
    if ($parsed.operatorConfirmedLiveDeployment.verifiedBy -ne 'TEST\Operator' -or -not $parsed.archive.validated) { throw 'Metadata content is invalid.' }
  }
  Invoke-Test 'guarded backup core quarantines mocked dump failure and cleanup can run' {
    $operationRoot=Join-Path $fixtureRoot 'mock-failure'; New-Item -ItemType Directory -Path $operationRoot | Out-Null
    $dump=Join-Path $operationRoot 'backup.dump'; $list=Join-Path $operationRoot 'backup.list'; $metadata=Join-Path $operationRoot 'backup.metadata.json'
    $migrations=@('20260617185715_init','20260617194303_add_admin_reporting_fields','20260617194747_add_onboarding_plan_reporting_fields','20260619110000_add_first_customer_pilot_fields','20260625143000_add_admin_notifications','20260703120000_add_msp_enrollment_date','20260713120000_add_msp_gmm_partner_flag','20260715120000_add_customer_name_to_onboarding_plan','20260715153000_add_document_storage_fields')
    $migrationRows=@($migrations | ForEach-Object { $hash=(Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $repositoryRoot "prisma\migrations\$_\migration.sql")).Hash; "$_|$hash|SUCCESS" })
    $psql={ param($stage,$sql) switch($stage){ 'identity' {[pscustomobject]@{ExitCode=0;Rows=@('postgres|public|17.2|on|f|test_user')}} 'migrations' {[pscustomobject]@{ExitCode=0;Rows=$migrationRows}} 'risk' {[pscustomobject]@{ExitCode=0;Rows=@('0|0|0|0|0|3|0|0|yes|yes')}} } }
    try {
      $env:PGPASSWORD='mock-secret'
      Assert-Throws { Invoke-GuardedBackupCore -RepositoryRoot $repositoryRoot -BackupRoot $operationRoot -DumpPath $dump -RestoreListPath $list -MetadataPath $metadata -PsqlPath 'mock-psql' -PgDumpPath 'mock-dump' -PgRestorePath 'mock-restore' -ExpectedMigrations $migrations -RequiredTables @('msps') -ExpectedDatabaseName 'postgres' -DirectFingerprint '574952707912a7c3' -ExpectedEvidence @{rollbackCommit='expected'} -OperatorConfirmedDeployment @{deploymentId='dpl_test';verifiedBy='TEST\Operator'} -ObservedConnection @{databaseId='db_test'} -PsqlInvoker $psql -DumpInvoker { [IO.File]::WriteAllBytes($dump,[byte[]](9,9)); 7 } -RestoreListInvoker { 0 } }
    } finally { Clear-ProductionBackupPgEnvironment }
    if (Test-Path $metadata) { throw 'Failure created success metadata.' }
    if (@(Get-ChildItem -LiteralPath (Join-Path $operationRoot 'INVALID-PARTIAL') -File).Count -ne 1) { throw 'Partial archive was not quarantined.' }
    if (Test-Path Env:PGPASSWORD) { throw 'Credential cleanup failed.' }
  }
  Invoke-Test 'identity diagnostic-only core cannot reach pg_dump' {
    $operationRoot=Join-Path $fixtureRoot 'mock-identity-only'; New-Item -ItemType Directory -Path $operationRoot | Out-Null
    $script:identityOnlyDumpCalls=0
    $result=Invoke-GuardedBackupCore -RepositoryRoot $repositoryRoot -BackupRoot $operationRoot -DumpPath (Join-Path $operationRoot 'never.dump') -RestoreListPath (Join-Path $operationRoot 'never.list') -MetadataPath (Join-Path $operationRoot 'never.json') -PsqlPath 'mock-psql' -PgDumpPath 'mock-dump' -PgRestorePath 'mock-restore' -ExpectedMigrations @('unused') -RequiredTables @('unused') -ExpectedDatabaseName 'postgres' -DirectFingerprint '574952707912a7c3' -ExpectedEvidence @{rollbackCommit='expected'} -OperatorConfirmedDeployment @{deploymentId='dpl_test'} -ObservedConnection @{databaseId='db_test'} -PsqlInvoker {param($stage,$sql)[pscustomobject]@{ExitCode=0;Rows=@('postgres|public|17.2|on|primary|test_user')}} -DumpInvoker {$script:identityOnlyDumpCalls++;0} -RestoreListInvoker {0} -IdentityDiagnosticOnly
    if(-not $result.IdentityValidated -or $result.BackupSucceeded -ne $false -or $script:identityOnlyDumpCalls -ne 0){throw 'Identity-only mode could reach backup execution.'}
  }
  Invoke-Test 'risk diagnostic-only core cannot reach migrations or backup tools' {
    $operationRoot=Join-Path $fixtureRoot 'mock-risk-only'; New-Item -ItemType Directory -Path $operationRoot | Out-Null
    $script:riskOnlyDumpCalls=0
    $result=Invoke-GuardedBackupCore -RepositoryRoot $repositoryRoot -BackupRoot $operationRoot -DumpPath (Join-Path $operationRoot 'never.dump') -RestoreListPath (Join-Path $operationRoot 'never.list') -MetadataPath (Join-Path $operationRoot 'never.json') -PsqlPath 'mock-psql' -PgDumpPath 'mock-dump' -PgRestorePath 'mock-restore' -ExpectedMigrations @('unused') -RequiredTables @('unused') -ExpectedDatabaseName 'postgres' -DirectFingerprint '574952707912a7c3' -ExpectedEvidence @{rollbackCommit='expected'} -OperatorConfirmedDeployment @{deploymentId='dpl_test'} -ObservedConnection @{databaseId='db_test'} -PsqlInvoker {param($stage,$sql)switch($stage){'identity'{[pscustomobject]@{ExitCode=0;Rows=@('postgres|public|17.2|on|primary|test_user')}}'risk'{foreach($type in @('ppg_archiver_guard','ppg_metrics','ppg_storage_guard')){if(-not $sql.Contains("'$type'")){throw "Risk SQL omitted $type."}};if(-not $sql.Contains("backend_type = 'client backend'") -or -not $sql.Contains('state IS NULL AND usename IS NOT NULL AND query IS NOT NULL')){throw 'Risk SQL omitted visibility classification.'};[pscustomobject]@{ExitCode=0;Rows=@('1|0|0|0|0|3|0|0|yes|yes')}}'migrations'{throw 'Risk-only mode reached migrations.'}}} -DumpInvoker {$script:riskOnlyDumpCalls++;0} -RestoreListInvoker {throw 'Risk-only mode reached pg_restore.'} -RiskDiagnosticOnly
    if(-not $result.IdentityValidated -or $result.SafeForOnlineBackup -ne $false -or $result.Diagnostic.transactionsOlderThanFiveMinutes.count -ne 1 -or $script:riskOnlyDumpCalls -ne 0){throw 'Risk-only mode did not stop safely.'}
  }
  Invoke-Test 'guarded core identity failure emits only sanitized comparison evidence' {
    $operationRoot=Join-Path $fixtureRoot 'mock-identity-failure'; New-Item -ItemType Directory -Path $operationRoot | Out-Null
    $message=$null
    try {
      Invoke-GuardedBackupCore -RepositoryRoot $repositoryRoot -BackupRoot $operationRoot -DumpPath (Join-Path $operationRoot 'never.dump') -RestoreListPath (Join-Path $operationRoot 'never.list') -MetadataPath (Join-Path $operationRoot 'never.json') -PsqlPath 'mock-psql' -PgDumpPath 'mock-dump' -PgRestorePath 'mock-restore' -ExpectedMigrations @('unused') -RequiredTables @('unused') -ExpectedDatabaseName 'postgres' -DirectFingerprint '574952707912a7c3' -ExpectedEvidence @{rollbackCommit='expected'} -OperatorConfirmedDeployment @{deploymentId='dpl_test'} -ObservedConnection @{databaseId='db_test'} -PsqlInvoker {param($stage,$sql)[pscustomobject]@{ExitCode=0;Rows=@('postgres|private|17.2|on|primary|private_database_user')}} -DumpInvoker {throw 'dump must not run'} -RestoreListInvoker {throw 'restore list must not run'}
      throw 'Expected identity validation failure did not occur.'
    } catch { $message=$_.Exception.Message }
    if($message -notmatch '"failedCheck":"schemaMatches"' -or $message -match 'private_database_user'){throw 'Identity error was not sanitized or specific.'}
  }
  Invoke-Test 'full entrypoint mocked success returns success only after all artifacts exist' {
    $root=New-EntrypointFixture -Parent $fixtureRoot -Leaf 'kzero-onboarding-production-backup-20261110-160000Z'
    $url='postgres://test_user:test_password@db.prisma.io:5432/postgres?sslmode=require';$secure=ConvertTo-SecureString $url -AsPlainText -Force
    $identity='test_user@db.prisma.io:5432/postgres';$sha=[Security.Cryptography.SHA256]::Create();try{$h=$sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($identity));$fingerprint=-join($h[0..7]|ForEach-Object{$_.ToString('x2')})}finally{$sha.Dispose()}
    $reader={param($prompt,$isSecure) if($isSecure){return $secure};switch -Wildcard($prompt){'Prepared*'{return $root};'Confirmed production Prisma database*'{return 'db_test'};'Confirmed production Prisma connection*'{return 'con_test'};'Type I_CONFIRM_DDL*'{return 'I_CONFIRM_DDL_AND_DEPLOYMENT_FREEZE_ACTIVE'};'Type I_CONFIRM_ONLINE*'{return 'I_CONFIRM_ONLINE_BACKUP_FROM_ONBOARDING_PORTAL_DB'};'*deployment ID'{return 'dpl_test'};'*commit SHA'{return '1abfcfeb9547fdd538c85dc29309ea4b455df4eb'};'*alias'{return 'partners.kzero.com'};'UTC verification*'{return '2026-11-10T16:00:00Z'};default{throw "Unexpected prompt: $prompt"}}}
    $core={param($a)[IO.File]::WriteAllBytes($a.DumpPath,[byte[]](1));'list'|Set-Content $a.RestoreListPath;'{}'|Set-Content $a.MetadataPath;[pscustomobject]@{BackupSucceeded=$true;Archive=(Split-Path -Leaf $a.DumpPath);Bytes=1;Sha256='mock';Metadata=(Split-Path -Leaf $a.MetadataPath)}}
    $result=Invoke-ProductionOnlineBackupEntrypoint -RepositoryRoot $repositoryRoot -ExpectedDirectFingerprint $fingerprint -InputReader $reader -BitLockerReader {param($m)[pscustomobject]@{MountPoint=$m;VolumeStatus='FullyEncrypted';ProtectionStatus='On';EncryptionPercentage=100;LockStatus='Unlocked'}} -AclReader {param($p) New-FakeAcl @('TEST\Operator','NT AUTHORITY\SYSTEM')} -FreeSpaceReader {param($r) 999999} -ToolResolver {[pscustomobject]@{psql='mock-psql';pg_dump='mock-dump';pg_restore='mock-restore'}} -OperatorIdentityProvider {'TEST\Operator'} -CoreInvoker $core
    if ($result.BackupSucceeded -ne $true -or (Test-Path Env:PGPASSWORD)) {throw 'Entrypoint success or cleanup failed.'}
  }
  Invoke-Test 'full entrypoint diagnostic-only mode accepts identity evidence without backup artifacts' {
    $root=New-EntrypointFixture -Parent $fixtureRoot -Leaf 'kzero-onboarding-production-backup-20261110-163000Z'
    $url='postgres://test_user:test_password@db.prisma.io:5432/postgres?sslmode=require';$secure=ConvertTo-SecureString $url -AsPlainText -Force
    $identity='test_user@db.prisma.io:5432/postgres';$sha=[Security.Cryptography.SHA256]::Create();try{$h=$sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($identity));$fingerprint=-join($h[0..7]|ForEach-Object{$_.ToString('x2')})}finally{$sha.Dispose()}
    $reader={param($prompt,$isSecure) if($isSecure){return $secure};switch -Wildcard($prompt){'Prepared*'{return $root};'Confirmed production Prisma database*'{return 'db_test'};'Confirmed production Prisma connection*'{return 'con_test'};'Type I_CONFIRM_DDL*'{return 'I_CONFIRM_DDL_AND_DEPLOYMENT_FREEZE_ACTIVE'};'Type I_CONFIRM_ONLINE*'{return 'I_CONFIRM_ONLINE_BACKUP_FROM_ONBOARDING_PORTAL_DB'};'*deployment ID'{return 'dpl_test'};'*commit SHA'{return '1abfcfeb9547fdd538c85dc29309ea4b455df4eb'};'*alias'{return 'partners.kzero.com'};'UTC verification*'{return '2026-11-10T16:30:00Z'};default{throw "Unexpected prompt: $prompt"}}}
    $core={param($a)if(-not $a.IdentityDiagnosticOnly){throw 'Diagnostic switch was not forwarded.'};[pscustomobject]@{BackupSucceeded=$false;IdentityDiagnosticOnly=$true;IdentityValidated=$true;Diagnostic=[pscustomobject]@{failedCheck=$null}}}
    $result=Invoke-ProductionOnlineBackupEntrypoint -IdentityDiagnosticOnly -RepositoryRoot $repositoryRoot -ExpectedDirectFingerprint $fingerprint -InputReader $reader -BitLockerReader {param($m)[pscustomobject]@{MountPoint=$m;VolumeStatus='FullyEncrypted';ProtectionStatus='On';EncryptionPercentage=100;LockStatus='Unlocked'}} -AclReader {param($p) New-FakeAcl @('TEST\Operator','NT AUTHORITY\SYSTEM')} -FreeSpaceReader {param($r) 999999} -ToolResolver {[pscustomobject]@{psql='mock-psql';pg_dump='mock-dump';pg_restore='mock-restore'}} -OperatorIdentityProvider {'TEST\Operator'} -CoreInvoker $core
    if(-not $result.IdentityValidated -or $result.BackupSucceeded -ne $false -or (Test-Path Env:PGPASSWORD)){throw 'Entrypoint identity-only result or cleanup failed.'}
  }
  Invoke-Test 'full entrypoint risk-only mode returns sanitized counters without backup artifacts' {
    $root=New-EntrypointFixture -Parent $fixtureRoot -Leaf 'kzero-onboarding-production-backup-20261110-164500Z'
    $url='postgres://test_user:test_password@db.prisma.io:5432/postgres?sslmode=require';$secure=ConvertTo-SecureString $url -AsPlainText -Force
    $identity='test_user@db.prisma.io:5432/postgres';$sha=[Security.Cryptography.SHA256]::Create();try{$h=$sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($identity));$fingerprint=-join($h[0..7]|ForEach-Object{$_.ToString('x2')})}finally{$sha.Dispose()}
    $reader={param($prompt,$isSecure) if($isSecure){return $secure};switch -Wildcard($prompt){'Prepared*'{return $root};'Confirmed production Prisma database*'{return 'db_test'};'Confirmed production Prisma connection*'{return 'con_test'};'Type I_CONFIRM_DDL*'{return 'I_CONFIRM_DDL_AND_DEPLOYMENT_FREEZE_ACTIVE'};'Type I_CONFIRM_ONLINE*'{return 'I_CONFIRM_ONLINE_BACKUP_FROM_ONBOARDING_PORTAL_DB'};'*deployment ID'{return 'dpl_test'};'*commit SHA'{return '1abfcfeb9547fdd538c85dc29309ea4b455df4eb'};'*alias'{return 'partners.kzero.com'};'UTC verification*'{return '2026-11-10T16:45:00Z'};default{throw "Unexpected prompt: $prompt"}}}
    $core={param($a)if(-not $a.RiskDiagnosticOnly){throw 'Risk diagnostic switch was not forwarded.'};[pscustomobject]@{BackupSucceeded=$false;RiskDiagnosticOnly=$true;IdentityValidated=$true;SafeForOnlineBackup=$false;Diagnostic=[pscustomobject]@{waitingLocks=[pscustomobject]@{state='nonzero';count=1}}}}
    $result=Invoke-ProductionOnlineBackupEntrypoint -RiskDiagnosticOnly -RepositoryRoot $repositoryRoot -ExpectedDirectFingerprint $fingerprint -InputReader $reader -BitLockerReader {param($m)[pscustomobject]@{MountPoint=$m;VolumeStatus='FullyEncrypted';ProtectionStatus='On';EncryptionPercentage=100;LockStatus='Unlocked'}} -AclReader {param($p) New-FakeAcl @('TEST\Operator','NT AUTHORITY\SYSTEM')} -FreeSpaceReader {param($r) 999999} -ToolResolver {[pscustomobject]@{psql='mock-psql';pg_dump='mock-dump';pg_restore='mock-restore'}} -OperatorIdentityProvider {'TEST\Operator'} -CoreInvoker $core
    if($result.RiskDiagnosticOnly -ne $true -or $result.Diagnostic.waitingLocks.count -ne 1 -or (Test-Path Env:PGPASSWORD)){throw 'Entrypoint risk-only result or cleanup failed.'}
  }
  Invoke-Test 'full entrypoint mocked failure cleans credentials and reports no success' {
    $root=New-EntrypointFixture -Parent $fixtureRoot -Leaf 'kzero-onboarding-production-backup-20261110-170000Z'
    $url='postgres://test_user:test_password@db.prisma.io:5432/postgres?sslmode=require';$secure=ConvertTo-SecureString $url -AsPlainText -Force
    $identity='test_user@db.prisma.io:5432/postgres';$sha=[Security.Cryptography.SHA256]::Create();try{$h=$sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($identity));$fingerprint=-join($h[0..7]|ForEach-Object{$_.ToString('x2')})}finally{$sha.Dispose()}
    $reader={param($prompt,$isSecure)if($isSecure){return $secure};switch -Wildcard($prompt){'Prepared*'{$root};'*database ID*'{'db_test'};'*connection ID*'{'con_test'};'Type I_CONFIRM_DDL*'{'I_CONFIRM_DDL_AND_DEPLOYMENT_FREEZE_ACTIVE'};'Type I_CONFIRM_ONLINE*'{'I_CONFIRM_ONLINE_BACKUP_FROM_ONBOARDING_PORTAL_DB'};'*deployment ID'{'dpl_test'};'*commit SHA'{'1abfcfeb9547fdd538c85dc29309ea4b455df4eb'};'*alias'{'partners.kzero.com'};'UTC verification*'{'2026-11-10T17:00:00Z'}}}
    Assert-Throws {Invoke-ProductionOnlineBackupEntrypoint -RepositoryRoot $repositoryRoot -ExpectedDirectFingerprint $fingerprint -InputReader $reader -BitLockerReader {param($m)[pscustomobject]@{MountPoint=$m;VolumeStatus='FullyEncrypted';ProtectionStatus='On';EncryptionPercentage=100;LockStatus='Unlocked'}} -AclReader {param($p) New-FakeAcl @('TEST\Operator','NT AUTHORITY\SYSTEM')} -FreeSpaceReader {param($r)999999} -ToolResolver {[pscustomobject]@{psql='mock';pg_dump='mock';pg_restore='mock'}} -OperatorIdentityProvider {'TEST\Operator'} -CoreInvoker {param($a)throw 'mock core failure'}}
    if(Test-Path Env:PGPASSWORD){throw 'Credentials remained after failure.'}
  }
  Invoke-Test 'full entrypoint cancellation cannot invoke backup core' {
    $script:coreCalls=0
    Assert-Throws {Invoke-ProductionOnlineBackupEntrypoint -RepositoryRoot $repositoryRoot -InputReader {param($p,$s)$null} -CoreInvoker {param($a)$script:coreCalls++}}
    if($script:coreCalls -ne 0 -or (Test-Path Env:PGPASSWORD)){throw 'Cancellation reached core or left credentials.'}
  }
  Invoke-Test 'credential environment cleanup after failure' {
    try { $env:PGPASSWORD='offline-test'; $env:PGHOST='offline-test'; throw 'injected' } catch {} finally { Clear-ProductionBackupPgEnvironment }
    if ((Test-Path Env:PGPASSWORD) -or (Test-Path Env:PGHOST)) { throw 'Credential environment remained.' }
  }
  Invoke-Test 'actual directory preparation function succeeds with offline providers' {
    $parent=Join-Path $fixtureRoot 'approved-parent'; New-Item -ItemType Directory -Path $parent | Out-Null
    $acl=New-FakeAcl @($operator,'NT AUTHORITY\SYSTEM')
    $prepared=New-ProtectedBackupDirectory -BackupParent $parent -RepositoryRoot $repositoryRoot -RequiredFreeBytes 1024 -OperatorIdentity $operator -BitLockerReader { param($root) $goodVolume } -FreeSpaceReader { param($root) 1048576 } -AclWriter { param($path,$identity) } -AclReader { param($path) $acl } -Timestamp ([datetime]'2026-11-10T15:00:00Z')
    if (-not (Test-Path -LiteralPath $prepared.BackupRoot -PathType Container)) { throw 'Dedicated directory was not created.' }
  }
} finally {
  if (Test-Path -LiteralPath $fixtureRoot) { Remove-Item -LiteralPath $fixtureRoot -Recurse -Force }
}

Write-Output "Offline production backup tests: $passed passed, $failed failed"
if ($failed -ne 0) { exit 1 }
