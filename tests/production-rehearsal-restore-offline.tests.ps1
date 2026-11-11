$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $repositoryRoot 'scripts\run-production-rehearsal-restore.ps1')

$script:passed = 0
$script:failed = 0

function Invoke-Test {
  param([string]$Name, [scriptblock]$Body)
  try {
    & $Body
    $script:passed++
    Write-Host "PASS $Name"
  } catch {
    $script:failed++
    Write-Host "FAIL $Name - $($_.Exception.Message)"
  }
}

function Assert-True { param([bool]$Value,[string]$Message) if (-not $Value) { throw $Message } }
function Assert-Throws {
  param([scriptblock]$Body,[string]$Pattern)
  $message = $null
  try { & $Body } catch { $message = $_.Exception.Message }
  if ($null -eq $message) { throw 'Expected an exception.' }
  if ($message -notlike "*$Pattern*") { throw "Unexpected exception: $message" }
}

function New-TestRestoreContext {
  param(
    [string]$DirectUrl = 'postgres://rehearsal_user:rehearsal_password@db.prisma.io:5432/postgres?sslmode=require',
    [string]$EmptyRow = '0|0|0|0|0|no',
    [int]$RestoreExitCode = 0,
    [string]$Hash = ('A' * 64),
    [string[]]$MigrationRows,
    [string[]]$TableRows,
    [string]$CountRow = '2|3|10|1|1|1|1'
  )
  $expectedMigrations = @(
    '20260617185715_init','20260617194303_add_admin_reporting_fields',
    '20260617194747_add_onboarding_plan_reporting_fields','20260619110000_add_first_customer_pilot_fields',
    '20260625143000_add_admin_notifications','20260703120000_add_msp_enrollment_date',
    '20260713120000_add_msp_gmm_partner_flag','20260715120000_add_customer_name_to_onboarding_plan',
    '20260715153000_add_document_storage_fields'
  )
  $expectedTables = @('_prisma_migrations','admin_notifications','documents','msps','oidc_configs','onboarding_plans','onboarding_tasks','saas_app_submissions')
  if ($null -eq $MigrationRows) {
    $MigrationRows = @($expectedMigrations | ForEach-Object {
      $checksum = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $repositoryRoot "prisma\migrations\$_\migration.sql")).Hash
      "$_|$checksum|SUCCESS"
    })
  }
  if ($null -eq $TableRows) { $TableRows = @($expectedTables | Sort-Object) }
  $secureUrl = ConvertTo-SecureString $DirectUrl -AsPlainText -Force
  $uri = [Uri]$DirectUrl
  $directFingerprint = Get-RehearsalConnectionFingerprint -Uri $uri
  $state = [pscustomobject]@{RestoreCalled=$false;RestoreArguments=@()}
  $inputReader = {
    param($Prompt,$Secure)
    if ($Secure) { return $secureUrl }
    if ($Prompt -like '*resource name*') { return 'kzero-onboarding-rehearsal' }
    if ($Prompt -like '*database ID*') { return 'db_rehearsal123' }
    if ($Prompt -like '*connection ID*') { return 'con_rehearsal123' }
    if ($Prompt -like '*pooled fingerprint*') { return 'pooltest123456789' }
    if ($Prompt -like '*NOT_ATTACHED*') { return 'I_CONFIRM_REHEARSAL_NOT_ATTACHED_TO_LIVE_APPLICATION_OR_AUTOMATION' }
    if ($Prompt -like '*RESTORE_ONLY*') { return 'I_CONFIRM_RESTORE_ONLY_TO_KZERO_ONBOARDING_REHEARSAL' }
    throw "Unexpected test prompt: $Prompt"
  }.GetNewClosure()
  $toolResolver = { [pscustomobject]@{psql='mock-psql.exe';pg_restore='mock-pg_restore.exe'} }
  $hashReader = { param($Path) $Hash }.GetNewClosure()
  $restoreList = {
    param($Path,$Tool)
    $rows = @()
    foreach ($table in $expectedTables) {
      $rows += "1; 0 0 TABLE public $table owner"
      $rows += "2; 0 0 TABLE DATA public $table owner"
    }
    [pscustomobject]@{ExitCode=0;Rows=$rows}
  }.GetNewClosure()
  $psql = {
    param($Stage,$Sql,$Tool)
    switch ($Stage) {
      'pre-identity' { [pscustomobject]@{ExitCode=0;Rows=@('postgres|public|17.2|on|primary|rehearsal_user')} }
      'pre-empty' { [pscustomobject]@{ExitCode=0;Rows=@($EmptyRow)} }
      'post-identity' { [pscustomobject]@{ExitCode=0;Rows=@('postgres|public|17.2|on|primary|rehearsal_user')} }
      'post-migrations' { [pscustomobject]@{ExitCode=0;Rows=@($MigrationRows)} }
      'post-tables' { [pscustomobject]@{ExitCode=0;Rows=@($TableRows)} }
      'post-counts' { [pscustomobject]@{ExitCode=0;Rows=@($CountRow)} }
      default { throw "Unexpected test stage: $Stage" }
    }
  }.GetNewClosure()
  $restore = {
    param($Path,$Tool,$Arguments)
    $state.RestoreCalled = $true
    $state.RestoreArguments = @($Arguments)
    return $RestoreExitCode
  }.GetNewClosure()
  return [pscustomobject]@{
    DirectFingerprint=$directFingerprint; Hash=$Hash; InputReader=$inputReader; ToolResolver=$toolResolver;
    HashReader=$hashReader; RestoreListInvoker=$restoreList; PsqlInvoker=$psql; RestoreInvoker=$restore; State=$state
  }
}

$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('kzero-restore-offline-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
$archivePath = Join-Path $fixtureRoot 'verified.dump'
[IO.File]::WriteAllBytes($archivePath, [byte[]](1,2,3,4))

try {
  Invoke-Test 'verified archive and rehearsal target complete successfully' {
    $context = New-TestRestoreContext
    $result = Invoke-ProductionRehearsalRestoreEntrypoint -ArchivePath $archivePath -InputReader $context.InputReader -ToolResolver $context.ToolResolver -HashReader $context.HashReader -RestoreListInvoker $context.RestoreListInvoker -PsqlInvoker $context.PsqlInvoker -RestoreInvoker $context.RestoreInvoker -ExpectedArchiveSha256 $context.Hash -ExpectedPooledFingerprint 'pooltest123456789' -ExpectedDirectFingerprint $context.DirectFingerprint -ForbiddenFingerprints @('forbidden0000001')
    Assert-True $result.RestoreSucceeded 'Restore success was not reported.'
    Assert-True $result.CredentialCleanupCompleted 'Credential cleanup was not reported.'
    Assert-True $context.State.RestoreCalled 'Restore invoker was not called.'
    foreach ($flag in @('--single-transaction','--exit-on-error','--no-owner','--no-privileges','--dbname=postgres')) { Assert-True ($context.State.RestoreArguments -contains $flag) "Missing restore flag $flag" }
    Assert-True (-not ($context.State.RestoreArguments -contains '--clean')) 'Restore must not use --clean.'
    Assert-True (-not ($context.State.RestoreArguments -contains '--create')) 'Restore must not use --create.'
    Assert-True (-not (Test-Path Env:PGPASSWORD)) 'PGPASSWORD survived cleanup.'
  }

  Invoke-Test 'wrong archive checksum fails before restore' {
    $context = New-TestRestoreContext -Hash ('B' * 64)
    Assert-Throws { Invoke-ProductionRehearsalRestoreEntrypoint -ArchivePath $archivePath -InputReader $context.InputReader -ToolResolver $context.ToolResolver -HashReader $context.HashReader -RestoreListInvoker $context.RestoreListInvoker -PsqlInvoker $context.PsqlInvoker -RestoreInvoker $context.RestoreInvoker -ExpectedArchiveSha256 ('A' * 64) -ExpectedPooledFingerprint 'pooltest123456789' -ExpectedDirectFingerprint $context.DirectFingerprint } 'SHA-256'
    Assert-True (-not $context.State.RestoreCalled) 'Restore ran after hash failure.'
  }

  Invoke-Test 'wrong database identity fails before PostgreSQL execution' {
    $context = New-TestRestoreContext
    Assert-Throws { Invoke-ProductionRehearsalRestoreEntrypoint -ArchivePath $archivePath -InputReader $context.InputReader -ToolResolver $context.ToolResolver -HashReader $context.HashReader -RestoreListInvoker $context.RestoreListInvoker -PsqlInvoker $context.PsqlInvoker -RestoreInvoker $context.RestoreInvoker -ExpectedArchiveSha256 $context.Hash -ExpectedPooledFingerprint 'pooltest123456789' -ExpectedDirectFingerprint 'wrongfingerprint' } 'does not match'
    Assert-True (-not $context.State.RestoreCalled) 'Restore ran for a wrong target.'
  }

  Invoke-Test 'production fingerprint is explicitly rejected' {
    $context = New-TestRestoreContext
    Assert-Throws { Invoke-ProductionRehearsalRestoreEntrypoint -ArchivePath $archivePath -InputReader $context.InputReader -ToolResolver $context.ToolResolver -HashReader $context.HashReader -RestoreListInvoker $context.RestoreListInvoker -PsqlInvoker $context.PsqlInvoker -RestoreInvoker $context.RestoreInvoker -ExpectedArchiveSha256 $context.Hash -ExpectedPooledFingerprint 'pooltest123456789' -ExpectedDirectFingerprint $context.DirectFingerprint -ForbiddenFingerprints @($context.DirectFingerprint) } 'protected production'
    Assert-True (-not $context.State.RestoreCalled) 'Restore ran with protected credentials.'
  }

  Invoke-Test 'nonempty destination fails closed' {
    $context = New-TestRestoreContext -EmptyRow '1|0|0|0|0|no'
    Assert-Throws { Invoke-ProductionRehearsalRestoreEntrypoint -ArchivePath $archivePath -InputReader $context.InputReader -ToolResolver $context.ToolResolver -HashReader $context.HashReader -RestoreListInvoker $context.RestoreListInvoker -PsqlInvoker $context.PsqlInvoker -RestoreInvoker $context.RestoreInvoker -ExpectedArchiveSha256 $context.Hash -ExpectedPooledFingerprint 'pooltest123456789' -ExpectedDirectFingerprint $context.DirectFingerprint } 'not empty'
    Assert-True (-not $context.State.RestoreCalled) 'Restore ran against a nonempty target.'
    Assert-True (-not (Test-Path Env:PGPASSWORD)) 'Credentials survived the empty-target failure.'
  }

  Invoke-Test 'restore failure is not retried and credentials are cleaned' {
    $context = New-TestRestoreContext -RestoreExitCode 7
    Assert-Throws { Invoke-ProductionRehearsalRestoreEntrypoint -ArchivePath $archivePath -InputReader $context.InputReader -ToolResolver $context.ToolResolver -HashReader $context.HashReader -RestoreListInvoker $context.RestoreListInvoker -PsqlInvoker $context.PsqlInvoker -RestoreInvoker $context.RestoreInvoker -ExpectedArchiveSha256 $context.Hash -ExpectedPooledFingerprint 'pooltest123456789' -ExpectedDirectFingerprint $context.DirectFingerprint } 'failed with exit code 7'
    Assert-True $context.State.RestoreCalled 'Restore failure scenario did not invoke restore.'
    Assert-True ($context.State.RestoreArguments -contains '--single-transaction') 'Transaction rollback protection was omitted.'
    Assert-True ($context.State.RestoreArguments -contains '--exit-on-error') 'Exit-on-error protection was omitted.'
    Assert-True (-not (Test-Path Env:PGPASSWORD)) 'Credentials survived restore failure.'
  }

  Invoke-Test 'post-restore migration verification rejects an invalid checksum' {
    $context = New-TestRestoreContext
    $badRows = @($context.PsqlInvoker.Invoke('post-migrations','', 'mock').Rows)
    $badRows[0] = '20260617185715_init|' + ('0' * 64) + '|SUCCESS'
    $context = New-TestRestoreContext -MigrationRows $badRows
    Assert-Throws { Invoke-ProductionRehearsalRestoreEntrypoint -ArchivePath $archivePath -InputReader $context.InputReader -ToolResolver $context.ToolResolver -HashReader $context.HashReader -RestoreListInvoker $context.RestoreListInvoker -PsqlInvoker $context.PsqlInvoker -RestoreInvoker $context.RestoreInvoker -ExpectedArchiveSha256 $context.Hash -ExpectedPooledFingerprint 'pooltest123456789' -ExpectedDirectFingerprint $context.DirectFingerprint } 'checksum differs'
    Assert-True (-not (Test-Path Env:PGPASSWORD)) 'Credentials survived post-restore verification failure.'
  }
} finally {
  Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Offline rehearsal restore tests: $script:passed passed, $script:failed failed."
if ($script:failed -gt 0) { exit 1 }
