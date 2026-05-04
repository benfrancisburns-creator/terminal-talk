param(
    [string]$Short = '',
    [int]$DelaySeconds = 120,
    [string]$Caller = 'codex-plugin-cleanup',
    [switch]$PurgeQueue
)

$ErrorActionPreference = 'SilentlyContinue'

$ttHome = if ($env:TT_HOME) { $env:TT_HOME } else { Join-Path $env:USERPROFILE '.terminal-talk' }
$common = Join-Path $ttHome 'app\codex-hook-common.psm1'
if (-not (Test-Path $common)) {
    $common = Join-Path (Split-Path $PSScriptRoot -Parent) 'app\codex-hook-common.psm1'
}
Import-Module $common -Force -DisableNameChecking -ErrorAction SilentlyContinue

$shortId = ([string]$Short).Trim().ToLowerInvariant()
if ($shortId -notmatch '^[a-f0-9]{8}$') { exit 0 }
if ($DelaySeconds -gt 0) {
    Start-Sleep -Seconds $DelaySeconds
}

[void](Remove-CodexPluginSession -Short $shortId -Caller $Caller -PurgeQueue:$PurgeQueue)
exit 0
