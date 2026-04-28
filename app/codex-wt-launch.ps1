[CmdletBinding()]
param(
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
    [string[]]$CodexArgs = @()
)

$ErrorActionPreference = 'SilentlyContinue'

$ttHome = Join-Path $env:USERPROFILE '.terminal-talk'
$queueDir = Join-Path $ttHome 'queue'
$registryPath = Join-Path $ttHome 'session-colours.json'
$currentDir = (Get-Location).Path
$launchMs = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()

if (-not (Test-Path $queueDir)) {
    New-Item -ItemType Directory -Path $queueDir -Force | Out-Null
}

function Log($m) {
    $logPath = Join-Path $queueDir '_hook.log'
    try { "$(Get-Date -Format 'HH:mm:ss.fff') [codex-wt-launch] $m" | Out-File $logPath -Append -Encoding utf8 } catch {}
}

function Join-ProcessArguments([string[]]$Items) {
    return (($Items | ForEach-Object {
        $s = [string]$_
        if ($s -match '[\s"]') {
            '"' + ($s -replace '"', '\"') + '"'
        } else {
            $s
        }
    }) -join ' ')
}

Import-Module (Join-Path $PSScriptRoot 'session-registry.psm1') -Force -DisableNameChecking -ErrorAction SilentlyContinue
Import-Module (Join-Path $PSScriptRoot 'codex-terminal.psm1') -Force -DisableNameChecking -ErrorAction SilentlyContinue

$provisionalShort = New-ProvisionalCodexShort -CodexPid $PID -CurrentDir $currentDir -LaunchMs $launchMs
$provisionalSessionId = "codex-provisional-$PID-$launchMs"
$entry = $null

$locked = Enter-RegistryLock -RegistryPath $registryPath
try {
    if ($locked) {
        $all = Read-Registry -RegistryPath $registryPath
        $null = Update-SessionAssignment -Assignments $all -Short $provisionalShort `
                                         -SessionId $provisionalSessionId -ClaudePid 0 `
                                         -Now ([DateTimeOffset]::Now.ToUnixTimeSeconds()) `
                                         -LogPath (Join-Path $queueDir '_hook.log') -Caller 'codex-wt-launch'
        $entry = $all[$provisionalShort]
        Save-Registry -RegistryPath $registryPath -Assignments $all -Caller 'codex-wt-launch' -LogPath (Join-Path $queueDir '_hook.log')
    } else {
        Log "registry lock unavailable before wt launch; using fallback title/colour"
    }
} finally {
    if ($locked) { Exit-RegistryLock -RegistryPath $registryPath }
}

if (-not $entry) {
    $entry = [pscustomobject]@{ index = 0; label = '' }
}

$tabTitle = Format-CodexWindowTitle -Short $provisionalShort -Entry $entry -CurrentDir $currentDir -Attaching
$tabHex = Get-TerminalTalkPaletteHex -Index ([int]$entry.index)
$codexLaunch = Join-Path $PSScriptRoot 'codex-launch.ps1'
$powershellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$launchArgs = @(
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-NoExit',
    '-File',
    $codexLaunch,
    '-PreassignedShort',
    $provisionalShort,
    '-PreassignedSessionId',
    $provisionalSessionId
) + $CodexArgs

$wt = Get-Command wt.exe -ErrorAction SilentlyContinue
if ($wt) {
    $wtArgs = @(
        'new-tab',
        '--title',
        $tabTitle,
        '--tabColor',
        "#$tabHex",
        '--startingDirectory',
        $currentDir,
        $powershellExe
    ) + $launchArgs
    $wtArgumentLine = Join-ProcessArguments -Items $wtArgs
    try {
        Start-Process -FilePath $wt.Source -ArgumentList $wtArgumentLine -WorkingDirectory $currentDir
        Log "started wt title=$tabTitle tabColor=#$tabHex short=$provisionalShort args=$wtArgumentLine"
        exit 0
    } catch {
        Log "wt launch failed: $($_.Exception.Message)"
    }
}

try {
    Start-Process -FilePath $powershellExe -ArgumentList (Join-ProcessArguments -Items $launchArgs) -WorkingDirectory $currentDir
    Log "started powershell fallback title=$tabTitle short=$provisionalShort"
} catch {
    Write-Error "failed to launch Terminal Talk Codex: $($_.Exception.Message)"
    exit 1
}
