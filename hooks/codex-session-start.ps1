$ErrorActionPreference = 'Stop'

$ttHome = if ($env:TT_HOME) { $env:TT_HOME } else { Join-Path $env:USERPROFILE '.terminal-talk' }
$common = Join-Path $ttHome 'app\codex-hook-common.psm1'
if (-not (Test-Path $common)) {
    $common = Join-Path (Split-Path $PSScriptRoot -Parent) 'app\codex-hook-common.psm1'
}
try { Import-Module $common -Force -DisableNameChecking -ErrorAction Stop }
catch { Write-Error "codex-session-start: common module import failed: $($_.Exception.Message)"; exit 1 }

$payload = Read-CodexHookPayload
if ($payload) {
    $sync = Sync-CodexHookSession -Payload $payload -Caller 'codex-session-start' -UpdateTitle
    [void](Start-CodexPluginStartAnnouncement -Sync $sync -Caller 'codex-session-start')
}

exit 0
