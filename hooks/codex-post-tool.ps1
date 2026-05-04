$ErrorActionPreference = 'Stop'

$ttHome = if ($env:TT_HOME) { $env:TT_HOME } else { Join-Path $env:USERPROFILE '.terminal-talk' }
$common = Join-Path $ttHome 'app\codex-hook-common.psm1'
if (-not (Test-Path $common)) {
    $common = Join-Path (Split-Path $PSScriptRoot -Parent) 'app\codex-hook-common.psm1'
}
try { Import-Module $common -Force -DisableNameChecking -ErrorAction Stop }
catch { Write-Error "codex-post-tool: common module import failed: $($_.Exception.Message)"; exit 1 }

$payload = Read-CodexHookPayload
$short = if ($payload) { Resolve-CodexHookWorkingShort -Payload $payload -Caller 'codex-post-tool' } else { '' }
if ($short) {
    Set-CodexWorkingFlag -Short ([string]$short) -Action mark -Caller 'codex-post-tool'
}

exit 0
