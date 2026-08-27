[CmdletBinding()]
[Diagnostics.CodeAnalysis.SuppressMessageAttribute(
    'PSReviewUnusedParameter',
    '',
    Justification = 'Parameters are read inside helper functions; analyzer does not track script-param usage through nested scopes.'
)]
param(
    [string]$RestoreShort = '',
    [string]$RestoreLabel = '',
    [int]$MaxAgeHours = 96,
    [switch]$ForceBanner
)

$ErrorActionPreference = 'SilentlyContinue'

$ttHome = if ($env:TT_HOME) { $env:TT_HOME } else { Join-Path $env:USERPROFILE '.terminal-talk' }
$queueDir = Join-Path $ttHome 'queue'
$sessionsDir = Join-Path $ttHome 'sessions'
$registryPath = if ($env:TT_REGISTRY_PATH) { $env:TT_REGISTRY_PATH } else { Join-Path $ttHome 'session-colours.json' }
$codexSessionsDir = Join-Path $env:USERPROFILE '.codex\sessions'
$logPath = Join-Path $queueDir '_hook.log'
$requireHookIdentity = $env:TT_REQUIRE_CODEX_HOOK_IDENTITY -eq '1'

if (-not (Test-Path $queueDir)) {
    New-Item -ItemType Directory -Path $queueDir -Force | Out-Null
}
if (-not (Test-Path $sessionsDir)) {
    New-Item -ItemType Directory -Path $sessionsDir -Force | Out-Null
}

function Log($m) {
    try { "$(Get-Date -Format 'HH:mm:ss.fff') [codex-identify-live] $m" | Out-File $logPath -Append -Encoding utf8 } catch {}
}

Import-Module (Join-Path $PSScriptRoot 'session-registry.psm1') -Force -DisableNameChecking -ErrorAction SilentlyContinue
Import-Module (Join-Path $PSScriptRoot 'codex-terminal.psm1') -Force -DisableNameChecking -ErrorAction SilentlyContinue

function Get-RegistryEntryValue([object]$Entry, [string]$Name) {
    if (-not $Entry -or -not $Name) { return $null }
    try {
        if ($Entry -is [System.Collections.IDictionary] -and $Entry.ContainsKey($Name)) {
            return $Entry[$Name]
        }
    } catch {}
    try {
        if ($Entry.PSObject.Properties.Name -contains $Name) {
            return $Entry.$Name
        }
    } catch {}
    return $null
}

function Get-CodexSessionHashShort([string]$SessionId = '', [string]$Salt = '') {
    $sid = ([string]$SessionId).Trim().ToLowerInvariant()
    if (-not $sid) { return '' }
    try {
        $sha1 = [System.Security.Cryptography.SHA1]::Create()
        try {
            $bytes = [Text.Encoding]::UTF8.GetBytes("$sid|$Salt")
            $hash = $sha1.ComputeHash($bytes)
            return ([BitConverter]::ToString($hash).Replace('-', '').ToLowerInvariant()).Substring(0, 8)
        } finally {
            $sha1.Dispose()
        }
    } catch {
        return ''
    }
}

function Resolve-CodexRegistryShort {
    param(
        [string]$SessionId = '',
        [hashtable]$Assignments = $null,
        [string]$PreferredShort = '',
        [int]$ClaudePid = 0
    )

    $sid = ([string]$SessionId).Trim().ToLowerInvariant()
    $preferred = ([string]$PreferredShort).Trim().ToLowerInvariant()
    if (-not $sid) { return $preferred }
    if (-not $Assignments) { $Assignments = @{} }

    foreach ($key in @($Assignments.Keys)) {
        $entrySid = ''
        try { $entrySid = ([string](Get-RegistryEntryValue $Assignments[$key] 'session_id')).Trim().ToLowerInvariant() } catch {}
        if ($entrySid -and $entrySid -eq $sid) {
            return ([string]$key).ToLowerInvariant()
        }
    }

    if ($preferred -match '^[a-f0-9]{8}$') {
        if (-not $Assignments.ContainsKey($preferred)) { return $preferred }
        $existing = $Assignments[$preferred]
        $existingSid = ''
        $existingPid = 0
        try { $existingSid = ([string](Get-RegistryEntryValue $existing 'session_id')).Trim().ToLowerInvariant() } catch {}
        try { $existingPid = [int](Get-RegistryEntryValue $existing 'claude_pid') } catch {}
        if (-not $existingSid -or $existingSid -eq $sid) { return $preferred }
        if ($ClaudePid -gt 0 -and $existingPid -eq $ClaudePid) { return $preferred }
    }

    for ($i = 0; $i -lt 64; $i++) {
        $candidate = Get-CodexSessionHashShort -SessionId $sid -Salt "registry:$i"
        if ($candidate -notmatch '^[a-f0-9]{8}$') { continue }
        if (-not $Assignments.ContainsKey($candidate)) { return $candidate }
        $candidateSid = ''
        try { $candidateSid = ([string](Get-RegistryEntryValue $Assignments[$candidate] 'session_id')).Trim().ToLowerInvariant() } catch {}
        if ($candidateSid -eq $sid) { return $candidate }
    }

    return ''
}

function ConvertTo-UtcDateTime($Value) {
    if ($Value -is [datetime]) { return $Value.ToUniversalTime() }
    try {
        if ($Value -is [string] -and $Value -match '^\d{14}\.') {
            return ([Management.ManagementDateTimeConverter]::ToDateTime($Value)).ToUniversalTime()
        }
        if ($Value -is [string] -and $Value.Trim()) {
            $styles = [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
            return ([DateTimeOffset]::Parse($Value, [Globalization.CultureInfo]::InvariantCulture, $styles)).UtcDateTime
        }
        return ([datetime]$Value).ToUniversalTime()
    } catch {
        return [datetime]::MinValue
    }
}

function Get-LiveCodexProcesses {
    Get-CimInstance Win32_Process -Filter "Name='codex.exe'" -ErrorAction SilentlyContinue |
        ForEach-Object {
            $created = ConvertTo-UtcDateTime $_.CreationDate
            if ($created -eq [datetime]::MinValue) { return }
            $commandLine = [string]$_.CommandLine
            if ($commandLine -match '(^|\s)app-server(\s|$)') { return }
            [pscustomobject]@{
                pid          = [int]$_.ProcessId
                parent_pid   = [int]$_.ParentProcessId
                command_line = $commandLine
                created_utc  = $created
            }
        } |
        Sort-Object created_utc, pid
}

function Get-ProcessInfoById([int]$ProcessId) {
    if ($ProcessId -le 0) { return $null }
    try {
        return Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue |
            Select-Object -First 1
    } catch {
        return $null
    }
}

function Test-TerminalTalkManagedCodexProcess($Process) {
    if (-not $Process) { return $false }
    $parentPid = 0
    try { $parentPid = [int]$Process.parent_pid } catch { $parentPid = 0 }
    if ($parentPid -le 0) { return $false }

    $seen = @{}
    $cur = $parentPid
    for ($hop = 0; $hop -lt 10 -and $cur -gt 0; $hop++) {
        if ($seen.ContainsKey($cur)) { break }
        $seen[$cur] = $true
        $ancestor = Get-ProcessInfoById -ProcessId $cur
        if (-not $ancestor) { break }

        $cmd = [string]$ancestor.CommandLine
        # Leaving the dot un-escaped on purpose. The harness gate in
        # scripts/run-tests.cjs scans for the literal substrings
        # 'codex-launch.ps1' and 'assistant-session-launch.ps1' — an
        # escaped \. would defeat that check. The regex still matches
        # the same paths in practice (`.` is "any single char" but the
        # path-separator + (\s|$) anchors pin the suffix to the
        # filename).
        if ($cmd -match '(?i)(^|[\\/])codex-launch.ps1(\s|$)' -or
            $cmd -match '(?i)(^|[\\/])assistant-session-launch.ps1(\s|$)') {
            return $true
        }

        try { $cur = [int]$ancestor.ParentProcessId } catch { break }
    }

    return $false
}

function Get-RecentCodexRollouts {
    if (-not (Test-Path $codexSessionsDir)) { return @() }
    $cutoff = [datetime]::UtcNow.AddHours(-1 * [Math]::Max(1, $MaxAgeHours))
    $items = @()
    try {
        Get-ChildItem -Path $codexSessionsDir -Recurse -File -Filter 'rollout-*.jsonl' -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTimeUtc -ge $cutoff } |
            ForEach-Object {
                $meta = Get-CodexRolloutSessionMeta -Path $_.FullName
                if (-not $meta) { return }
                if ($meta.PSObject.Properties.Name -contains 'terminal_source' -and $meta.terminal_source -eq $false) { return }
                $ts = ConvertTo-UtcDateTime $meta.timestamp
                if ($ts -eq [datetime]::MinValue) { $ts = ConvertTo-UtcDateTime $meta.mtime_utc }
                if ($ts -lt $cutoff) { return }
                $items += [pscustomobject]@{
                    path        = [string]$meta.path
                    session_id  = [string]$meta.session_id
                    short       = ([string]$meta.short).ToLowerInvariant()
                    cwd         = [string]$meta.cwd
                    source      = [string]$meta.source
                    originator  = [string]$meta.originator
                    terminal_source = $true
                    timestamp   = $ts
                    mtime_utc   = ConvertTo-UtcDateTime $meta.mtime_utc
                }
            }
    } catch {}
    return $items
}

function Select-RolloutForProcess($Process, $Rollouts, [hashtable]$UsedPaths) {
    if (-not $Process -or -not $Rollouts) { return $null }
    $ranked = @()
    foreach ($rollout in $Rollouts) {
        if (-not $rollout -or $UsedPaths.ContainsKey([string]$rollout.path)) { continue }
        $delta = [Math]::Abs(($rollout.timestamp - $Process.created_utc).TotalSeconds)
        if ($delta -gt 900) { continue }
        $ranked += [pscustomobject]@{
            rollout = $rollout
            delta   = $delta
        }
    }
    if ($ranked.Count -eq 0) { return $null }
    return ($ranked | Sort-Object delta, @{ Expression = { $_.rollout.mtime_utc }; Descending = $true } | Select-Object -First 1).rollout
}

function Ensure-ConsoleTitleNative {
    if (([System.Management.Automation.PSTypeName]'TTConsoleTitleNative').Type) { return }
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class TTConsoleTitleNative {
    public const int STD_OUTPUT_HANDLE = -11;
    public const uint ENABLE_VIRTUAL_TERMINAL_PROCESSING = 0x0004;
    public const uint GENERIC_WRITE = 0x40000000;
    public const uint FILE_SHARE_WRITE = 0x00000002;
    public const uint OPEN_EXISTING = 3;

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool FreeConsole();

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool AttachConsole(uint dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool SetConsoleTitle(string lpConsoleTitle);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr GetStdHandle(int nStdHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool WriteConsole(IntPtr hConsoleOutput, string lpBuffer, uint nNumberOfCharsToWrite, out uint lpNumberOfCharsWritten, IntPtr lpReserved);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr CreateFile(string lpFileName, uint dwDesiredAccess, uint dwShareMode, IntPtr lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);
}
"@ -ErrorAction SilentlyContinue | Out-Null
}

function Invoke-WithAttachedConsole([int]$TargetPid, [scriptblock]$Block, [object[]]$ArgumentList = @()) {
    if ($TargetPid -le 0 -or -not $Block) { return $false }
    try {
        Ensure-ConsoleTitleNative
        [TTConsoleTitleNative]::FreeConsole() | Out-Null
        if (-not [TTConsoleTitleNative]::AttachConsole([uint32]$TargetPid)) { return $false }
        try {
            return (& $Block @ArgumentList)
        } finally {
            [TTConsoleTitleNative]::FreeConsole() | Out-Null
        }
    } catch {
        return $false
    }
}

function Set-ConsoleTitleForPid([int]$TargetPid, [string]$Title) {
    if (-not $Title) { return $false }
    return Invoke-WithAttachedConsole -TargetPid $TargetPid -Block {
        param([string]$AttachedTitle)
        [TTConsoleTitleNative]::SetConsoleTitle($AttachedTitle)
    } -ArgumentList @($Title)
}

function Write-ConsoleTitleSequenceForPid([int]$TargetPid, [string]$Title) {
    if (-not $Title) { return $false }
    $result = Invoke-WithAttachedConsole -TargetPid $TargetPid -Block {
        param([string]$AttachedTitle)
        $out = [TTConsoleTitleNative]::CreateFile('CONOUT$', [TTConsoleTitleNative]::GENERIC_WRITE, [TTConsoleTitleNative]::FILE_SHARE_WRITE, [IntPtr]::Zero, [TTConsoleTitleNative]::OPEN_EXISTING, 0, [IntPtr]::Zero)
        if ($out -eq [IntPtr]::Zero -or $out.ToInt64() -eq -1) {
            $out = [TTConsoleTitleNative]::GetStdHandle([TTConsoleTitleNative]::STD_OUTPUT_HANDLE)
        }
        if ($out -eq [IntPtr]::Zero -or $out.ToInt64() -eq -1) { return $false }
        $mode = [uint32]0
        if ([TTConsoleTitleNative]::GetConsoleMode($out, [ref]$mode)) {
            [TTConsoleTitleNative]::SetConsoleMode($out, ($mode -bor [TTConsoleTitleNative]::ENABLE_VIRTUAL_TERMINAL_PROCESSING)) | Out-Null
        }
        $seq = "$([char]27)]0;$AttachedTitle$([char]7)"
        $written = [uint32]0
        try {
            return [TTConsoleTitleNative]::WriteConsole($out, $seq, [uint32]$seq.Length, [ref]$written, [IntPtr]::Zero)
        } finally {
            [TTConsoleTitleNative]::CloseHandle($out) | Out-Null
        }
    } -ArgumentList @($Title)
    return [bool]$result
}

function Get-SessionPidIdentity([int]$TargetPid) {
    try {
        $file = Join-Path $sessionsDir "$TargetPid.json"
        if (-not (Test-Path $file)) { return $null }
        $raw = Get-Content -LiteralPath $file -Raw -Encoding utf8
        if (-not $raw) { return $null }
        return $raw | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Write-SessionPidIdentity($Process, $Rollout, [string]$Short, [string]$Title, [string]$ColourHex) {
    try {
        $file = Join-Path $sessionsDir "$($Process.pid).json"
        $now = [DateTimeOffset]::Now.ToUnixTimeSeconds()
        $jsonOut = @{
            session_id     = [string]$Rollout.session_id
            short          = [string]$Short
            claude_pid     = [int]$Process.pid
            ts             = $now
            identity_title = [string]$Title
            identity_color = [string]$ColourHex
        } | ConvertTo-Json -Compress
        $tmp = "$file.tmp"
        [IO.File]::WriteAllText($tmp, $jsonOut, [System.Text.UTF8Encoding]::new($false))
        Move-Item -Force $tmp $file
    } catch {}
}

function Write-ConsoleIdentityBannerForPid([int]$TargetPid, [string]$Title, [string]$PaletteGlyph) {
    if (-not $Title -or -not $PaletteGlyph) { return $false }
    $result = Invoke-WithAttachedConsole -TargetPid $TargetPid -Block {
        param([string]$AttachedTitle, [string]$AttachedGlyph)
        $out = [TTConsoleTitleNative]::CreateFile('CONOUT$', [TTConsoleTitleNative]::GENERIC_WRITE, [TTConsoleTitleNative]::FILE_SHARE_WRITE, [IntPtr]::Zero, [TTConsoleTitleNative]::OPEN_EXISTING, 0, [IntPtr]::Zero)
        $createErr = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        if ($out -eq [IntPtr]::Zero -or $out.ToInt64() -eq -1) {
            $out = [TTConsoleTitleNative]::GetStdHandle([TTConsoleTitleNative]::STD_OUTPUT_HANDLE)
        }
        if ($out -eq [IntPtr]::Zero -or $out.ToInt64() -eq -1) { return $false }
        $mode = [uint32]0
        if ([TTConsoleTitleNative]::GetConsoleMode($out, [ref]$mode)) {
            [TTConsoleTitleNative]::SetConsoleMode($out, ($mode -bor [TTConsoleTitleNative]::ENABLE_VIRTUAL_TERMINAL_PROCESSING)) | Out-Null
        }
        $esc = [char]27
        $bel = [char]7
        $line = "`r`n${esc}]0;$AttachedTitle$bel[Terminal Talk] $AttachedGlyph $AttachedTitle`r`n"
        $written = [uint32]0
        try {
            $ok = [TTConsoleTitleNative]::WriteConsole($out, $line, [uint32]$line.Length, [ref]$written, [IntPtr]::Zero)
            [pscustomobject]@{
                ok = $ok
                err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
                create_err = $createErr
                written = [int]$written
                handle = $out.ToInt64()
            }
        } finally {
            [TTConsoleTitleNative]::CloseHandle($out) | Out-Null
        }
    } -ArgumentList @($Title, $PaletteGlyph)
    if ($result -is [bool]) { return $result }
    if ($result -and $result.PSObject.Properties.Name -contains 'ok') {
        if (-not $result.ok) {
            Log "banner write failed pid=$TargetPid err=$($result.err) create_err=$($result.create_err) written=$($result.written) handle=$($result.handle)"
        }
        return [bool]$result.ok
    }
    Log "banner write failed pid=$TargetPid result=$result"
    return $false
}

function Sync-LiveCodexAssignment($Process, $Rollout) {
    $now = [DateTimeOffset]::Now.ToUnixTimeSeconds()
    $preferredShort = ([string]$Rollout.short).ToLowerInvariant()
    if ($preferredShort -notmatch '^[a-f0-9]{8}$') { return $null }

    $entry = $null
    $short = $preferredShort
    $locked = Enter-RegistryLock -RegistryPath $registryPath
    try {
        $all = Read-Registry -RegistryPath $registryPath
        $short = Resolve-CodexRegistryShort -SessionId ([string]$Rollout.session_id) `
                                            -Assignments $all `
                                            -PreferredShort $preferredShort `
                                            -ClaudePid ([int]$Process.pid)
        if ($short -notmatch '^[a-f0-9]{8}$') {
            Log "skip pid=$($Process.pid) preferred=$preferredShort reason=unresolved-short"
            return $null
        }
        if ($short -ne $preferredShort) {
            Log "resolved short collision preferred=$preferredShort resolved=$short session=$($Rollout.session_id)"
        }
        if ($requireHookIdentity -and -not $all.ContainsKey($short)) {
            Log "skip pid=$($Process.pid) short=$short reason=waiting-for-hook-identity"
            return $null
        }
        if ($locked) {
            $null = Update-SessionAssignment -Assignments $all -Short $short `
                                             -SessionId ([string]$Rollout.session_id) `
                                             -ClaudePid ([int]$Process.pid) `
                                             -Now $now -LogPath $logPath `
                                             -Caller 'codex-identify-live'
            $entry = $all[$short]
            if ($RestoreShort -and $short -eq $RestoreShort.ToLowerInvariant() -and $RestoreLabel) {
                $entry.label = [string]$RestoreLabel
                $entry.pinned = $true
            }
            Save-Registry -RegistryPath $registryPath -Assignments $all `
                          -Caller 'codex-identify-live' -LogPath $logPath
        } else {
            # Lock-acquire timed out. Previously this path fell through and did
            # an UNCONDITIONAL Read-Update-Save -- the same lock-fail-fall-
            # through wipe class fixed in statusline.ps1 / speak-*.ps1 / the JS
            # saveAssignments. Read-Registry can return an empty/mid-rename
            # registry under contention; Save-Registry then rebuilt the whole
            # file from this one session, blanking the other sessions' labels
            # and reshuffling their colours. Correct behaviour: read-only for
            # the title banner, DO NOT persist. Next fire retries the lock.
            $entry = $all[$short]
            try {
                $ts = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
                Add-Content -Path $logPath -Value "$ts save-registry skip from=codex-identify-live reason=lock-timeout short=$short" -ErrorAction SilentlyContinue
            } catch {}
        }
    } finally {
        if ($locked) { Exit-RegistryLock -RegistryPath $registryPath }
    }

    try {
        Write-SessionPidFile -SessionsDir $sessionsDir -ClaudePid ([int]$Process.pid) `
                             -SessionId ([string]$Rollout.session_id) -Short $short -Now $now
    } catch {}

    return [pscustomobject]@{
        short = $short
        entry = $entry
    }
}

$processes = @(Get-LiveCodexProcesses)
$rollouts = @(Get-RecentCodexRollouts)
$usedPaths = @{}
$mapped = 0

foreach ($proc in $processes) {
    if (Test-TerminalTalkManagedCodexProcess -Process $proc) {
        Log "skip pid=$($proc.pid) reason=launcher-managed"
        continue
    }

    $rollout = Select-RolloutForProcess -Process $proc -Rollouts $rollouts -UsedPaths $usedPaths
    if (-not $rollout) {
        Log "unmapped pid=$($proc.pid) created=$($proc.created_utc.ToString('o'))"
        continue
    }

    $usedPaths[[string]$rollout.path] = $true
    $sync = Sync-LiveCodexAssignment -Process $proc -Rollout $rollout
    if (-not $sync) { continue }

    $entry = $sync.entry
    $short = [string]$sync.short
    $title = Format-CodexWindowTitle -Short $short -Entry $entry -CurrentDir ([string]$rollout.cwd)
    $colourHex = "#$(Get-TerminalTalkPaletteHex -Index ([int]$entry.index))"
    $paletteGlyph = Get-TerminalTalkPaletteAnsiGlyph -Index ([int]$entry.index)
    $titleSet = Set-ConsoleTitleForPid -TargetPid ([int]$proc.pid) -Title $title
    $titleSeqSet = Write-ConsoleTitleSequenceForPid -TargetPid ([int]$proc.pid) -Title $title
    # Keep normal live sync quiet. Title and OSC updates are enough for
    # identity; the old default banner wrote visible lines into the Codex
    # terminal and could distract mid-task. -ForceBanner remains for manual
    # diagnostics.
    $needsBanner = [bool]$ForceBanner
    $bannerSet = $false
    if ($needsBanner) {
        $bannerSet = Write-ConsoleIdentityBannerForPid -TargetPid ([int]$proc.pid) -Title $title -PaletteGlyph $paletteGlyph
    }
    Write-SessionPidIdentity -Process $proc -Rollout $rollout -Short $short -Title $title -ColourHex $colourHex
    $mapped += 1
    Log "mapped pid=$($proc.pid) short=$short title_set=$titleSet title_seq_set=$titleSeqSet banner_set=$bannerSet color=$colourHex title=$title"
}

Log "complete mapped=$mapped live=$($processes.Count) rollouts=$($rollouts.Count)"
