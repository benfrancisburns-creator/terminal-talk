#requires -Version 5.1
[CmdletBinding()]
param(
  [ValidateSet('Prepare', 'ResetTake', 'Restore', 'Status')]
  [string]$Mode = 'Status',
  [string]$TtHome = "$env:USERPROFILE\.terminal-talk",
  [string]$BackupRoot = (Join-Path (Resolve-Path .) 'tmp\terminal-talk-video-state'),
  [switch]$IncludeLogs
)

$ErrorActionPreference = 'Stop'

$RegistryPath = Join-Path $TtHome 'session-colours.json'
$QueueDir = Join-Path $TtHome 'queue'
$SessionsDir = Join-Path $TtHome 'sessions'
$LatestPath = Join-Path $BackupRoot 'latest.txt'

function New-StateDir {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $dir = Join-Path $BackupRoot $stamp
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $dir 'queue-original') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $dir 'sessions-original') -Force | Out-Null
  return $dir
}

function Copy-FileIfExists([string]$From, [string]$To) {
  if (Test-Path -LiteralPath $From) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $To) -Force | Out-Null
    Copy-Item -LiteralPath $From -Destination $To -Force
  }
}

function Move-Children([string]$FromDir, [string]$ToDir, [switch]$Logs) {
  if (!(Test-Path -LiteralPath $FromDir)) { return 0 }
  New-Item -ItemType Directory -Path $ToDir -Force | Out-Null
  $count = 0
  foreach ($item in Get-ChildItem -LiteralPath $FromDir -Force) {
    if (!$Logs -and $item.Name -match '^_.*\.log$') { continue }
    $dest = Join-Path $ToDir $item.Name
    Move-Item -LiteralPath $item.FullName -Destination $dest -Force
    $count++
  }
  return $count
}

function Restore-Children([string]$FromDir, [string]$ToDir) {
  if (!(Test-Path -LiteralPath $FromDir)) { return 0 }
  New-Item -ItemType Directory -Path $ToDir -Force | Out-Null
  $count = 0
  foreach ($item in Get-ChildItem -LiteralPath $FromDir -Force) {
    $dest = Join-Path $ToDir $item.Name
    Move-Item -LiteralPath $item.FullName -Destination $dest -Force
    $count++
  }
  return $count
}

function Write-CleanRegistry {
  New-Item -ItemType Directory -Path (Split-Path -Parent $RegistryPath) -Force | Out-Null
  [ordered]@{ assignments = [ordered]@{} } |
    ConvertTo-Json -Depth 6 |
    Set-Content -LiteralPath $RegistryPath -Encoding UTF8
}

function Get-LatestStateDir {
  if (!(Test-Path -LiteralPath $LatestPath)) {
    throw "No latest video-state backup found at $LatestPath"
  }
  $dir = (Get-Content -LiteralPath $LatestPath -Raw).Trim()
  if (!$dir -or !(Test-Path -LiteralPath $dir)) {
    throw "Latest video-state backup is missing: $dir"
  }
  return $dir
}

if ($Mode -eq 'Status') {
  $queueCount = if (Test-Path -LiteralPath $QueueDir) {
    @(Get-ChildItem -LiteralPath $QueueDir -Force | Where-Object { $_.Name -notmatch '^_.*\.log$' }).Count
  } else { 0 }
  $sessionCount = if (Test-Path -LiteralPath $SessionsDir) {
    @(Get-ChildItem -LiteralPath $SessionsDir -Force).Count
  } else { 0 }
  $assignments = 0
  if (Test-Path -LiteralPath $RegistryPath) {
    try {
      $json = Get-Content -LiteralPath $RegistryPath -Raw | ConvertFrom-Json
      $assignments = @($json.assignments.PSObject.Properties).Count
    } catch {}
  }
  [pscustomobject]@{
    TtHome = $TtHome
    RegistryAssignments = $assignments
    QueueArtifacts = $queueCount
    SessionFiles = $sessionCount
    LatestBackup = if (Test-Path -LiteralPath $LatestPath) { (Get-Content -LiteralPath $LatestPath -Raw).Trim() } else { '' }
  }
  return
}

if ($Mode -eq 'Prepare') {
  if (!(Test-Path -LiteralPath $TtHome)) { throw "Terminal Talk home not found: $TtHome" }
  New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
  $stateDir = New-StateDir
  Copy-FileIfExists -From $RegistryPath -To (Join-Path $stateDir 'session-colours.original.json')
  $queueMoved = Move-Children -FromDir $QueueDir -ToDir (Join-Path $stateDir 'queue-original') -Logs:$IncludeLogs
  $sessionsMoved = Move-Children -FromDir $SessionsDir -ToDir (Join-Path $stateDir 'sessions-original') -Logs
  Write-CleanRegistry
  Set-Content -LiteralPath $LatestPath -Value $stateDir -Encoding UTF8
  [pscustomobject]@{
    Mode = 'Prepare'
    Backup = $stateDir
    QueueMoved = $queueMoved
    SessionsMoved = $sessionsMoved
    Registry = 'clean'
  }
  return
}

if ($Mode -eq 'ResetTake') {
  $stateDir = Get-LatestStateDir
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $takeQueue = Join-Path $stateDir "queue-take-$stamp"
  $takeSessions = Join-Path $stateDir "sessions-take-$stamp"
  Copy-FileIfExists -From $RegistryPath -To (Join-Path $stateDir "session-colours.take-$stamp.json")
  $queueMoved = Move-Children -FromDir $QueueDir -ToDir $takeQueue -Logs:$IncludeLogs
  $sessionsMoved = Move-Children -FromDir $SessionsDir -ToDir $takeSessions -Logs
  Write-CleanRegistry
  [pscustomobject]@{
    Mode = 'ResetTake'
    Backup = $stateDir
    QueueMoved = $queueMoved
    SessionsMoved = $sessionsMoved
    Registry = 'clean'
  }
  return
}

if ($Mode -eq 'Restore') {
  $stateDir = Get-LatestStateDir
  $recordedQueue = Join-Path $stateDir 'queue-recorded'
  $recordedSessions = Join-Path $stateDir 'sessions-recorded'
  $queueRecorded = Move-Children -FromDir $QueueDir -ToDir $recordedQueue -Logs:$IncludeLogs
  $sessionsRecorded = Move-Children -FromDir $SessionsDir -ToDir $recordedSessions -Logs
  $queueRestored = Restore-Children -FromDir (Join-Path $stateDir 'queue-original') -ToDir $QueueDir
  $sessionsRestored = Restore-Children -FromDir (Join-Path $stateDir 'sessions-original') -ToDir $SessionsDir
  $originalRegistry = Join-Path $stateDir 'session-colours.original.json'
  if (Test-Path -LiteralPath $originalRegistry) {
    Copy-Item -LiteralPath $originalRegistry -Destination $RegistryPath -Force
  } else {
    Write-CleanRegistry
  }
  [pscustomobject]@{
    Mode = 'Restore'
    Backup = $stateDir
    QueueRecorded = $queueRecorded
    SessionsRecorded = $sessionsRecorded
    QueueRestored = $queueRestored
    SessionsRestored = $sessionsRestored
    Registry = 'restored'
  }
}
