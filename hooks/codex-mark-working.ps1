$ErrorActionPreference = 'Stop'

$ttHome = if ($env:TT_HOME) { $env:TT_HOME } else { Join-Path $env:USERPROFILE '.terminal-talk' }
$common = Join-Path $ttHome 'app\codex-hook-common.psm1'
if (-not (Test-Path $common)) {
    $common = Join-Path (Split-Path $PSScriptRoot -Parent) 'app\codex-hook-common.psm1'
}
try { Import-Module $common -Force -DisableNameChecking -ErrorAction Stop }
catch { Write-Error "codex-mark-working: common module import failed: $($_.Exception.Message)"; exit 1 }

$payload = Read-CodexHookPayload
$sync = if ($payload) { Sync-CodexHookSession -Payload $payload -Caller 'codex-mark-working' -UpdateTitle } else { $null }
if ($sync -and $sync.short) {
    Set-CodexWorkingFlag -Short ([string]$sync.short) -Action mark -Caller 'codex-mark-working'
}

exit 0
