[CmdletBinding()]
param(
    [string]$Kind = '',
    [string]$ProjectDir = '',
    [string]$InitialLabel = '',
    [int]$InitialIndex = -1,
    [string]$LaunchToken = '',
    [string]$LaunchMode = 'default',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Sanitise-LaunchLabel([string]$Value) {
    if (-not $Value) { return '' }
    return (($Value -replace '[\r\n\t]', ' ').Trim()).Substring(0, [Math]::Min(60, (($Value -replace '[\r\n\t]', ' ').Trim()).Length))
}

function Clamp-LaunchIndex([int]$Value) {
    if ($Value -lt 0) { return -1 }
    if ($Value -gt 23) { return 23 }
    return $Value
}

function Resolve-AssistantCommand([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) { throw "$Name command not found on PATH" }
    if ($cmd.Source) { return $cmd.Source }
    if ($cmd.Path) { return $cmd.Path }
    if ($cmd.Definition) { return $cmd.Definition }
    return $Name
}

function Get-AssistantLaunchArgs([string]$AssistantKind, [string]$Mode) {
    $m = if ($Mode) { $Mode.ToLowerInvariant() } else { 'default' }
    if ($AssistantKind -eq 'Claude') {
        switch ($m) {
            'default' { return @() }
            'dangerous' { return @('--dangerously-skip-permissions') }
            default { throw "Unsupported Claude launch mode: $Mode" }
        }
    }

    switch ($m) {
        'default' { return @() }
        'dangerous' { return @('--dangerously-bypass-approvals-and-sandbox') }
        default { throw "Unsupported Codex launch mode: $Mode" }
    }
}

function Write-LaunchLog([string]$Message) {
    try {
        $homeDir = if ($env:TT_HOME) { $env:TT_HOME } else { Join-Path $env:USERPROFILE '.terminal-talk' }
        $queueDir = Join-Path $homeDir 'queue'
        if (-not (Test-Path -LiteralPath $queueDir)) {
            New-Item -ItemType Directory -Path $queueDir -Force | Out-Null
        }
        $line = '{0} [assistant-session-launch] {1}' -f (Get-Date -Format 'HH:mm:ss.fff'), $Message
        Add-Content -LiteralPath (Join-Path $queueDir '_hook.log') -Value $line -Encoding UTF8
    } catch {}
}

function Set-TerminalTitle([string]$Title) {
    if (-not $Title) { return }
    try { $Host.UI.RawUI.WindowTitle = $Title } catch {}
    try { [Console]::Title = $Title } catch {}
}

function Add-PropertyValue($Entry, [string]$Name, $Value) {
    if (-not $Entry -or -not $Name) { return }
    if ($Entry -is [System.Collections.IDictionary]) {
        $Entry[$Name] = $Value
        return
    }
    if ($Entry.PSObject.Properties.Name -contains $Name) {
        $Entry.$Name = $Value
    } else {
        Add-Member -InputObject $Entry -NotePropertyName $Name -NotePropertyValue $Value
    }
}

function Apply-LaunchIntentToEntry($Entry, [string]$AssistantKind, [string]$Label, [int]$Index, [string]$Token) {
    if (-not $Entry) { return }
    if ($Label) {
        Add-PropertyValue $Entry 'label' $Label
        if ($Entry -is [System.Collections.IDictionary] -and $Entry.ContainsKey('auto_label')) { [void]$Entry.Remove('auto_label') }
    }
    if ($Index -ge 0) {
        Add-PropertyValue $Entry 'index' ([int]$Index)
    }
    Add-PropertyValue $Entry 'pinned' $true
    Add-PropertyValue $Entry 'source_kind' 'toolbar-launch'
    Add-PropertyValue $Entry 'source_label' $(if ($AssistantKind -eq 'Claude') { 'Claude Code' } else { 'Codex' })
    if ($Token) { Add-PropertyValue $Entry 'source_originator' "toolbar-launch:$Token" }
}

function Register-ClaudeLaunchIntent([int]$ClaudePid, [string]$Short, [string]$Label, [int]$Index, [string]$Token) {
    if ($ClaudePid -le 0 -or -not $Short) { return }
    $homeDir = if ($env:TT_HOME) { $env:TT_HOME } else { Join-Path $env:USERPROFILE '.terminal-talk' }
    $registryPath = if ($env:TT_REGISTRY_PATH) { $env:TT_REGISTRY_PATH } else { Join-Path $homeDir 'session-colours.json' }
    $sessionsDir = Join-Path $homeDir 'sessions'
    $logPath = Join-Path $homeDir 'queue\_hook.log'
    Import-Module (Join-Path $PSScriptRoot 'session-registry.psm1') -Force -DisableNameChecking -ErrorAction Stop
    $locked = Enter-RegistryLock -RegistryPath $registryPath
    try {
        $assignments = Read-Registry -RegistryPath $registryPath
        $now = [DateTimeOffset]::Now.ToUnixTimeSeconds()
        $sessionId = "claude-provisional-$ClaudePid"
        $null = Update-SessionAssignment -Assignments $assignments -Short $Short `
                                         -SessionId $sessionId -ClaudePid $ClaudePid -Now $now `
                                         -LogPath $logPath -Caller 'assistant-session-launch'
        Apply-LaunchIntentToEntry $assignments[$Short] 'Claude' $Label $Index $Token
        Save-Registry -RegistryPath $registryPath -Assignments $assignments `
                      -Caller 'assistant-session-launch' -LogPath $logPath
        Write-SessionPidFile -SessionsDir $sessionsDir -ClaudePid $ClaudePid -SessionId $sessionId -Short $Short -Now $now
        Write-LaunchLog "registered Claude launch intent pid=$ClaudePid short=$Short label=$Label index=$Index"
    } finally {
        if ($locked) { Exit-RegistryLock -RegistryPath $registryPath }
    }
}

function Get-RegistryEntryForPid([int]$ClaudePid, [string]$FallbackShort) {
    try {
        $homeDir = if ($env:TT_HOME) { $env:TT_HOME } else { Join-Path $env:USERPROFILE '.terminal-talk' }
        $registryPath = if ($env:TT_REGISTRY_PATH) { $env:TT_REGISTRY_PATH } else { Join-Path $homeDir 'session-colours.json' }
        Import-Module (Join-Path $PSScriptRoot 'session-registry.psm1') -Force -DisableNameChecking -ErrorAction SilentlyContinue
        $assignments = Read-Registry -RegistryPath $registryPath
        foreach ($key in @($assignments.Keys)) {
            $entry = $assignments[$key]
            if ($entry.claude_pid -and [int]$entry.claude_pid -eq $ClaudePid) {
                return [pscustomobject]@{ short = $key; entry = $entry }
            }
        }
        if ($FallbackShort -and $assignments.ContainsKey($FallbackShort)) {
            return [pscustomobject]@{ short = $FallbackShort; entry = $assignments[$FallbackShort] }
        }
    } catch {}
    return $null
}

function Format-ClaudeLaunchTitle([int]$ClaudePid, [string]$FallbackShort, [string]$FallbackLabel, [int]$FallbackIndex) {
    $entryInfo = Get-RegistryEntryForPid -ClaudePid $ClaudePid -FallbackShort $FallbackShort
    $entry = if ($entryInfo) { $entryInfo.entry } else { $null }
    try {
        Import-Module (Join-Path $PSScriptRoot 'codex-terminal.psm1') -Force -DisableNameChecking -ErrorAction SilentlyContinue
        $identity = Get-TerminalTalkIdentityText -Entry $entry -FallbackLabel $(if ($FallbackLabel) { $FallbackLabel } else { 'Claude Code' })
        $idx = $FallbackIndex
        if ($entry -and $entry.index -ne $null) { $idx = [int]$entry.index }
        $marker = Get-TerminalTalkTitleMarker -Index $idx
        return (($marker, $identity) | Where-Object { $_ }) -join ' '
    } catch {
        return $(if ($FallbackLabel) { $FallbackLabel } else { 'Claude Code' })
    }
}

$Kind = if ($Kind) { $Kind } elseif ($env:TT_CREATE_SESSION_KIND) { $env:TT_CREATE_SESSION_KIND } else { 'Codex' }
if ($Kind -notin @('Codex', 'Claude')) { throw "Unsupported assistant kind: $Kind" }

$ProjectDir = if ($ProjectDir) { $ProjectDir } elseif ($env:TT_CREATE_SESSION_PROJECT_DIR) { $env:TT_CREATE_SESSION_PROJECT_DIR } else { (Get-Location).Path }
$InitialLabel = if ($InitialLabel) { $InitialLabel } else { [string]$env:TT_CREATE_SESSION_INITIAL_LABEL }
if ($InitialIndex -lt 0 -and $env:TT_CREATE_SESSION_INITIAL_INDEX) {
    $parsedIndex = -1
    if ([int]::TryParse([string]$env:TT_CREATE_SESSION_INITIAL_INDEX, [ref]$parsedIndex)) {
        $InitialIndex = $parsedIndex
    }
}
$LaunchToken = if ($LaunchToken) { $LaunchToken } else { [string]$env:TT_CREATE_SESSION_LAUNCH_TOKEN }
$LaunchMode = if ($LaunchMode -and $LaunchMode -ne 'default') { $LaunchMode } elseif ($env:TT_CREATE_SESSION_LAUNCH_MODE) { [string]$env:TT_CREATE_SESSION_LAUNCH_MODE } else { 'default' }

$ProjectDir = (Resolve-Path -LiteralPath $ProjectDir).Path
if (-not (Test-Path -LiteralPath $ProjectDir -PathType Container)) {
    throw "Project folder does not exist: $ProjectDir"
}

$label = Sanitise-LaunchLabel $InitialLabel
$index = Clamp-LaunchIndex $InitialIndex
$token = if ($LaunchToken) { $LaunchToken } else { [Guid]::NewGuid().ToString('N').Substring(0, 16) }
$windowTitle = if ($env:TT_CREATE_SESSION_WINDOW_TITLE) { [string]$env:TT_CREATE_SESSION_WINDOW_TITLE } else { "$Kind TT" }
Set-TerminalTitle $windowTitle

$env:TT_LAUNCH_KIND = $Kind
$env:TT_LAUNCH_LABEL = $label
$env:TT_LAUNCH_INDEX = [string]$index
$env:TT_LAUNCH_TOKEN = $token
$env:TT_LAUNCH_MODE = if ($LaunchMode) { $LaunchMode } else { 'default' }

Set-Location -LiteralPath $ProjectDir
$assistantArgs = Get-AssistantLaunchArgs -AssistantKind $Kind -Mode $LaunchMode

if ($DryRun) {
    [pscustomobject]@{
        kind = $Kind
        projectDir = $ProjectDir
        initialLabel = $label
        initialIndex = $index
        launchToken = $token
        launchMode = $LaunchMode
        assistantArgs = $assistantArgs
    } | ConvertTo-Json -Compress
    return
}

if ($Kind -eq 'Codex') {
    $codexLaunch = Join-Path $PSScriptRoot 'codex-launch.ps1'
    if (-not (Test-Path -LiteralPath $codexLaunch)) { throw "Missing launcher: $codexLaunch" }

    $powerShellExe = Join-Path $PSHOME 'powershell.exe'
    if (-not (Test-Path -LiteralPath $powerShellExe)) { $powerShellExe = 'powershell.exe' }

    $args = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', $codexLaunch,
        '-InitialLabel', $label,
        '-InitialIndex', [string]$index,
        '-LaunchToken', $token
    ) + $assistantArgs
    & $powerShellExe @args
    return
}

$claudeCommand = Resolve-AssistantCommand 'claude'
$provisionalShort = if ($token -match '^[a-fA-F0-9]{8,}$') { $token.Substring(0, 8).ToLowerInvariant() } else { [Guid]::NewGuid().ToString('N').Substring(0, 8) }
$startArgs = @{
    FilePath = $claudeCommand
    WorkingDirectory = $ProjectDir
    NoNewWindow = $true
    PassThru = $true
}
if ($assistantArgs -and $assistantArgs.Count -gt 0) {
    $startArgs.ArgumentList = $assistantArgs
}

$proc = Start-Process @startArgs
Register-ClaudeLaunchIntent -ClaudePid $proc.Id -Short $provisionalShort -Label $label -Index $index -Token $token
$lastTitle = ''
try {
    while ($true) {
        try { $proc.Refresh() } catch {}
        $title = Format-ClaudeLaunchTitle -ClaudePid $proc.Id -FallbackShort $provisionalShort -FallbackLabel $label -FallbackIndex $index
        if ($title -and $title -ne $lastTitle) {
            Set-TerminalTitle $title
            $lastTitle = $title
        }
        if ($proc.HasExited) { break }
        Start-Sleep -Milliseconds 750
    }
} finally {
    try {
        $homeDir = if ($env:TT_HOME) { $env:TT_HOME } else { Join-Path $env:USERPROFILE '.terminal-talk' }
        $pidFile = Join-Path (Join-Path $homeDir 'sessions') "$($proc.Id).json"
        if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue }
    } catch {}
}
