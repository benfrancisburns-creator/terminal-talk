[CmdletBinding()]
param(
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
    [string[]]$CodexArgs = @(),
    [string]$PreassignedShort = '',
    [string]$PreassignedSessionId = '',
    [string]$InitialLabel = '',
    [int]$InitialIndex = -1,
    [string]$LaunchToken = ''
)

$ErrorActionPreference = 'SilentlyContinue'

$ttHome = if ($env:TT_HOME) { $env:TT_HOME } else { Join-Path $env:USERPROFILE '.terminal-talk' }
$queueDir = Join-Path $ttHome 'queue'
$sessionsDir = Join-Path $ttHome 'sessions'
$registryPath = if ($env:TT_REGISTRY_PATH) { $env:TT_REGISTRY_PATH } else { Join-Path $ttHome 'session-colours.json' }
$codexSessionsDir = Join-Path $env:USERPROFILE '.codex\sessions'
$logPath = Join-Path $queueDir '_hook.log'
$currentDir = (Get-Location).Path
$launchStartUtc = [DateTime]::UtcNow
$launchMs = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()

if (-not (Test-Path $queueDir)) {
    New-Item -ItemType Directory -Path $queueDir -Force | Out-Null
}
if (-not (Test-Path $sessionsDir)) {
    New-Item -ItemType Directory -Path $sessionsDir -Force | Out-Null
}

function Log($m) {
    try { "$(Get-Date -Format 'HH:mm:ss.fff') [codex-launch] $m" | Out-File $logPath -Append -Encoding utf8 } catch {}
}

Import-Module (Join-Path $PSScriptRoot 'session-registry.psm1') -Force -DisableNameChecking -ErrorAction SilentlyContinue
Import-Module (Join-Path $PSScriptRoot 'codex-terminal.psm1') -Force -DisableNameChecking -ErrorAction SilentlyContinue

function Test-HasUserIntent($entry) {
    if (-not $entry) { return $false }
    if ($entry.label -and ([string]$entry.label).Trim().Length -gt 0) { return $true }
    if ($entry.pinned -eq $true) { return $true }
    if ($entry.voice -and -not ($entry.ContainsKey('voice_auto') -and $entry.voice_auto -eq $true)) { return $true }
    if ($entry.ContainsKey('voice_auto') -and $entry.voice_auto -eq $false) { return $true }
    if ($entry.muted -eq $true) { return $true }
    if ($entry.focus -eq $true) { return $true }
    if ($entry.ContainsKey('heartbeat_enabled') -and ($entry.heartbeat_enabled -is [bool])) { return $true }
    if ($entry.speech_includes -and $entry.speech_includes.Count -gt 0) { return $true }
    return $false
}

function Merge-IntentFields($from, $into) {
    if (-not $from -or -not $into) { return }
    if ($from.label -and (-not $into.label -or ([string]$into.label).Trim().Length -eq 0)) {
        $into.label = [string]$from.label
    }
    if ($from.pinned -eq $true -and $into.pinned -ne $true) {
        $into.pinned = $true
    }
    if ($from.voice -and -not $into.voice) {
        $into.voice = [string]$from.voice
    }
    if ($from.ContainsKey('voice_auto') -and ($from.voice_auto -is [bool]) -and -not $into.ContainsKey('voice_auto')) {
        $into.voice_auto = [bool]$from.voice_auto
    }
    if ($from.muted -eq $true -and $into.muted -ne $true) {
        $into.muted = $true
    }
    if ($from.focus -eq $true -and $into.focus -ne $true) {
        $into.focus = $true
    }
    if ($from.ContainsKey('heartbeat_enabled') -and ($from.heartbeat_enabled -is [bool]) -and
        -not ($into.ContainsKey('heartbeat_enabled') -and ($into.heartbeat_enabled -is [bool]))) {
        $into.heartbeat_enabled = [bool]$from.heartbeat_enabled
    }
    if ($from.speech_includes -and $from.speech_includes.Count -gt 0 -and (-not $into.speech_includes -or $into.speech_includes.Count -eq 0)) {
        $into.speech_includes = $from.speech_includes
    }
}

function Get-EntryForShort([string]$Short) {
    try {
        $all = Read-Registry -RegistryPath $registryPath
        if ($all.ContainsKey($Short)) { return $all[$Short] }
    } catch {}
    return $null
}

function Set-TerminalTitle([string]$Title) {
    if (-not $Title) { return }
    try { $Host.UI.RawUI.WindowTitle = $Title } catch {}
}

function Sanitise-InitialLabel([string]$Value) {
    if (-not $Value) { return '' }
    $clean = ($Value -replace '[\r\n\t]', ' ').Trim()
    if ($clean.Length -gt 60) { return $clean.Substring(0, 60) }
    return $clean
}

function Clamp-InitialIndex([int]$Value) {
    if ($Value -lt 0) { return -1 }
    if ($Value -gt 23) { return 23 }
    return $Value
}

function Apply-InitialIntent($Entry) {
    if (-not $Entry) { return }
    $label = Sanitise-InitialLabel $InitialLabel
    $index = Clamp-InitialIndex $InitialIndex
    $hasIntent = $false
    $marker = ''
    if ($LaunchToken) { $marker = "toolbar-launch:$LaunchToken" }
    if ($marker -and $Entry.ContainsKey('source_originator') -and $Entry.source_originator -eq $marker) { return }
    if ($label) {
        $Entry.label = $label
        if ($Entry.ContainsKey('auto_label')) { [void]$Entry.Remove('auto_label') }
        $hasIntent = $true
    }
    if ($index -ge 0) {
        $Entry.index = [int]$index
        $hasIntent = $true
    }
    if ($hasIntent) {
        $Entry.pinned = $true
        $Entry.source_kind = 'toolbar-launch'
        $Entry.source_label = 'Codex'
        if ($marker) { $Entry.source_originator = $marker }
    }
}

function Sync-CodexAssignment([string]$Short, [string]$SessionId, [int]$CodexPid, [string]$ProvisionalShort = '') {
    $now = [DateTimeOffset]::Now.ToUnixTimeSeconds()
    $entry = $null
    $locked = Enter-RegistryLock -RegistryPath $registryPath
    try {
        $all = Read-Registry -RegistryPath $registryPath
        if ($ProvisionalShort -and $Short -ne $ProvisionalShort -and $all.ContainsKey($ProvisionalShort) -and $all.ContainsKey($Short)) {
            $prov = $all[$ProvisionalShort]
            $real = $all[$Short]
            if ([int]$prov.claude_pid -eq $CodexPid) {
                Merge-IntentFields -from $prov -into $real
            }
        }
        $null = Update-SessionAssignment -Assignments $all -Short $Short `
                                         -SessionId $SessionId -ClaudePid $CodexPid -Now $now `
                                         -LogPath $logPath -Caller 'codex-launch'
        if ($ProvisionalShort -and $Short -ne $ProvisionalShort -and $all.ContainsKey($ProvisionalShort)) {
            if ([int]$all[$ProvisionalShort].claude_pid -eq $CodexPid) {
                [void]$all.Remove($ProvisionalShort)
                Log "removed provisional assignment $ProvisionalShort after binding $Short"
            }
        }
        $entry = $all[$Short]
        Apply-InitialIntent $entry
        Save-Registry -RegistryPath $registryPath -Assignments $all -Caller 'codex-launch' -LogPath $logPath
    } finally {
        if ($locked) { Exit-RegistryLock -RegistryPath $registryPath }
    }
    return $entry
}

function Remove-ProvisionalAssignment([string]$Short, [int]$CodexPid) {
    if (-not $Short) { return }
    $locked = Enter-RegistryLock -RegistryPath $registryPath
    try {
        $all = Read-Registry -RegistryPath $registryPath
        if (-not $all.ContainsKey($Short)) { return }
        $entry = $all[$Short]
        if ([int]$entry.claude_pid -ne $CodexPid) { return }
        if (Test-HasUserIntent $entry) { return }
        [void]$all.Remove($Short)
        Save-Registry -RegistryPath $registryPath -Assignments $all -Caller 'codex-launch-cleanup' -LogPath $logPath
        Log "removed provisional assignment $Short on exit"
    } finally {
        if ($locked) { Exit-RegistryLock -RegistryPath $registryPath }
    }
}

function Remove-SessionPidFile([int]$CodexPid) {
    if (-not $CodexPid) { return }
    try {
        $pidFile = Join-Path $sessionsDir "$CodexPid.json"
        if (Test-Path $pidFile) { Remove-Item -Force $pidFile -ErrorAction SilentlyContinue }
    } catch {}
}

function Test-LiveProcessId([int]$ProcessId) {
    if ($ProcessId -le 0) { return $false }
    try {
        $p = Get-Process -Id $ProcessId -ErrorAction Stop
        return $null -ne $p
    } catch {
        return $false
    }
}

function Test-CodexCandidateOwnedByOtherLiveProcess([string]$Short, [int]$CodexPid) {
    if (-not $Short -or $Short -notmatch '^[a-fA-F0-9]{8}$') { return $false }
    try {
        $all = Read-Registry -RegistryPath $registryPath
        if (-not $all.ContainsKey($Short)) { return $false }
        $ownerPid = if ($all[$Short].claude_pid) { [int]$all[$Short].claude_pid } else { 0 }
        if ($ownerPid -le 0 -or $ownerPid -eq $CodexPid) { return $false }
        if (Test-LiveProcessId -ProcessId $ownerPid) {
            Log "skip rollout candidate $Short for pid=$CodexPid; already owned by live pid=$ownerPid"
            return $true
        }
    } catch {}
    return $false
}

function Get-RegistryEntryForLaunchMarker([string]$Marker, [string]$ExcludeShort = '') {
    if (-not $Marker) { return $null }
    try {
        $all = Read-Registry -RegistryPath $registryPath
        foreach ($key in @($all.Keys)) {
            if ($ExcludeShort -and $key -eq $ExcludeShort) { continue }
            $entry = $all[$key]
            if (-not $entry) { continue }
            $originator = ''
            try {
                if ($entry.ContainsKey('source_originator')) { $originator = [string]$entry.source_originator }
            } catch {}
            if ($originator -eq $Marker) {
                return [pscustomobject]@{ short = $key; entry = $entry }
            }
        }
    } catch {}
    return $null
}

function Get-CodexRolloutCandidateForLaunch([int]$CodexPid) {
    if (-not (Test-Path $codexSessionsDir)) { return $null }
    $cutoff = $launchStartUtc.AddSeconds(-5)
    $candidates = @()
    try {
        Get-ChildItem -Path $codexSessionsDir -Recurse -File -Filter 'rollout-*.jsonl' -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTimeUtc -ge $cutoff } |
            ForEach-Object {
                $meta = Get-CodexRolloutSessionMeta -Path $_.FullName
                if ($meta -and -not (Test-CodexCandidateOwnedByOtherLiveProcess -Short ([string]$meta.short) -CodexPid $CodexPid)) {
                    $candidates += $meta
                }
            }
    } catch {}
    if ($candidates.Count -eq 0) { return $null }
    return Select-CodexRolloutCandidate -Candidates $candidates -TargetCwd $currentDir -LaunchStartUtc $launchStartUtc
}

$codexCommand = Get-Command codex -ErrorAction SilentlyContinue
if (-not $codexCommand) {
    Write-Error "codex command not found on PATH"
    exit 1
}

$originalTitle = ''
try { $originalTitle = $Host.UI.RawUI.WindowTitle } catch {}

$launchFile = $codexCommand.Source
$launchArgs = @()
if ($launchFile -like '*.ps1') {
    $launchArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $launchFile) + $CodexArgs
    $launchFile = 'powershell.exe'
} else {
    $launchArgs = $CodexArgs
}

Log "launch cwd=$currentDir args=$($CodexArgs -join ' ')"
$proc = $null
try {
    $proc = Start-Process -FilePath $launchFile -ArgumentList $launchArgs -WorkingDirectory $currentDir -NoNewWindow -PassThru
} catch {
    Write-Error "failed to launch codex: $($_.Exception.Message)"
    exit 1
}

$preassigned = ''
if ($PreassignedShort -and $PreassignedShort -match '^[a-fA-F0-9]{8}$') {
    $preassigned = $PreassignedShort.ToLowerInvariant()
}
$provisionalShort = if ($preassigned) { $preassigned } else { New-ProvisionalCodexShort -CodexPid $proc.Id -CurrentDir $currentDir -LaunchMs $launchMs }
$provisionalSessionId = if ($PreassignedSessionId) { $PreassignedSessionId } else { "codex-provisional-$($proc.Id)" }
$provisionalEntry = Sync-CodexAssignment -Short $provisionalShort -SessionId $provisionalSessionId -CodexPid $proc.Id
$lastTitle = ''
$boundShort = ''
$boundSessionId = ''
$launchMarker = if ($LaunchToken) { "toolbar-launch:$LaunchToken" } else { '' }

try {
    while ($true) {
        try { $proc.Refresh() } catch {}

        if (-not $boundShort -and $launchMarker) {
            $tokenBound = Get-RegistryEntryForLaunchMarker -Marker $launchMarker -ExcludeShort $provisionalShort
            if ($tokenBound) {
                $boundShort = [string]$tokenBound.short
                try { $boundSessionId = [string]$tokenBound.entry.session_id } catch { $boundSessionId = '' }
                Log "observed hook token binding short=$boundShort marker=$launchMarker"
            }
        }

        if (-not $boundShort -and -not $launchMarker) {
            $candidate = Get-CodexRolloutCandidateForLaunch -CodexPid $proc.Id
            if ($candidate) {
                $boundShort = [string]$candidate.short
                $boundSessionId = [string]$candidate.session_id
                $provisionalEntry = Sync-CodexAssignment -Short $boundShort -SessionId $boundSessionId `
                                                         -CodexPid $proc.Id -ProvisionalShort $provisionalShort
                Write-SessionPidFile -SessionsDir $sessionsDir -ClaudePid $proc.Id `
                                     -SessionId $boundSessionId -Short $boundShort `
                                     -Now ([DateTimeOffset]::Now.ToUnixTimeSeconds())
                Log "bound pid=$($proc.Id) short=$boundShort path=$($candidate.path)"
            }
        }

        $entry = if ($boundShort) { Get-EntryForShort $boundShort } else { Get-EntryForShort $provisionalShort }
        if (-not $entry) { $entry = if ($boundShort) { $provisionalEntry } else { $provisionalEntry } }
        $displayShort = if ($boundShort) { $boundShort } else { $provisionalShort }
        $title = Format-CodexWindowTitle -Short $displayShort -Entry $entry -CurrentDir $currentDir -Attaching:([string]::IsNullOrEmpty($boundShort))
        if ($title -and $title -ne $lastTitle) {
            Set-TerminalTitle $title
            $lastTitle = $title
        }

        if ($proc.HasExited) { break }
        Start-Sleep -Milliseconds 750
    }
} finally {
    Remove-SessionPidFile -CodexPid $proc.Id
    if (-not $boundShort) {
        Remove-ProvisionalAssignment -Short $provisionalShort -CodexPid $proc.Id
    }
    if ($originalTitle) {
        Set-TerminalTitle $originalTitle
    }
}

exit $proc.ExitCode
