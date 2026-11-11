[CmdletBinding()]
param(
  [string]$PostgresBinPath = 'C:\Program Files\PostgreSQL\17\bin'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'production-online-backup-support.psm1') -Force

$backupParent = Read-Host 'Existing absolute local parent directory on approved BitLocker storage'
$databaseSizeBytesText = Read-Host 'Observed production pg_database_size in bytes from approved read-only evidence'
$databaseSizeBytes = 0L
if (-not [long]::TryParse($databaseSizeBytesText, [ref]$databaseSizeBytes) -or $databaseSizeBytes -le 0) {
  throw 'Observed production database size must be a positive integer.'
}
$databaseSizeEvidenceReference = (Read-Host 'Approved database-size evidence reference and UTC timestamp').Trim()
if ([string]::IsNullOrWhiteSpace($databaseSizeEvidenceReference)) { throw 'Database-size evidence reference is required.' }
$requiredFreeBytes = Get-RequiredBackupFreeBytes -ObservedDatabaseSizeBytes $databaseSizeBytes -HeadroomMultiplier 3

$tools = Resolve-Postgres17Tools -BinPath $PostgresBinPath
$prepared = New-ProtectedBackupDirectory `
  -BackupParent $backupParent `
  -RepositoryRoot $repositoryRoot `
  -RequiredFreeBytes $requiredFreeBytes

$evidence = [ordered]@{
  preparedUtc = (Get-Date).ToUniversalTime().ToString('o')
  backupRoot = $prepared.BackupRoot
  destinationVolume = $prepared.DestinationVolume
  requiredFreeBytes = $prepared.RequiredFreeBytes
  observedProductionDatabaseSizeBytes = $databaseSizeBytes
  databaseSizeEvidenceReference = $databaseSizeEvidenceReference
  freeSpaceHeadroomMultiplier = 3
  availableFreeBytes = $prepared.AvailableFreeBytes
  operatorIdentity = $prepared.OperatorIdentity
  postgres17Tools = [ordered]@{
    pgDump = $tools.pg_dump
    pgRestore = $tools.pg_restore
    psql = $tools.psql
  }
  databaseConnected = $false
  backupExecuted = $false
}
$evidencePath = Join-Path $prepared.BackupRoot 'preparation-evidence.json'
[IO.File]::WriteAllText($evidencePath, ($evidence | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))

Write-Output 'OFFLINE BACKUP PREPARATION PASSED'
Write-Output "BackupRoot: $($prepared.BackupRoot)"
Write-Output "Evidence: $evidencePath"
Write-Output 'No PostgreSQL connection or backup operation was performed.'
