Set-StrictMode -Version 3
$ErrorActionPreference = 'SilentlyContinue'

$script:TtHome = if ($env:TT_HOME) { $env:TT_HOME } else { Join-Path $env:USERPROFILE '.terminal-talk' }
$script:AppDir = Join-Path $script:TtHome 'app'
if (-not (Test-Path (Join-Path $script:AppDir 'session-registry.psm1'))) {
    $script:AppDir = $PSScriptRoot
}
$script:QueueDir = Join-Path $script:TtHome 'queue'
$script:SessionsDir = Join-Path $script:TtHome 'sessions'
$script:RegistryPath = if ($env:TT_REGISTRY_PATH) { $env:TT_REGISTRY_PATH } else { Join-Path $script:TtHome 'session-colours.json' }
$script:LogPath = Join-Path $script:QueueDir '_hook.log'
$script:PluginCleanupDelaySeconds = 120

function Write-CodexHookLog {
    param([string]$Caller = 'codex-hook', [string]$Message = '')
    try {
        if (-not (Test-Path $script:QueueDir)) { New-Item -ItemType Directory -Path $script:QueueDir -Force | Out-Null }
        "$(Get-Date -Format 'HH:mm:ss.fff') [$Caller] $Message" | Out-File $script:LogPath -Append -Encoding utf8
    } catch {}
}

function Read-CodexHookPayload {
    try {
        $stdin = [Console]::In.ReadToEnd()
        if (-not $stdin) { return $null }
        return $stdin | ConvertFrom-Json -ErrorAction Stop
    } catch {
        Write-CodexHookLog -Caller 'codex-hook' -Message "payload parse failed: $($_.Exception.Message)"
        return $null
    }
}

function Get-CodexSessionShort {
    param([string]$SessionId = '')
    $sid = ([string]$SessionId).Trim().ToLowerInvariant()
    if ($sid.Length -ge 8 -and $sid.Substring(0, 8) -match '^[a-f0-9]{8}$') {
        return $sid.Substring(0, 8)
    }
    if (-not $sid) { return '' }
    try {
        $sha1 = [System.Security.Cryptography.SHA1]::Create()
        try {
            $bytes = [Text.Encoding]::UTF8.GetBytes($sid)
            $hash = $sha1.ComputeHash($bytes)
            return ([BitConverter]::ToString($hash).Replace('-', '').ToLowerInvariant()).Substring(0, 8)
        } finally {
            $sha1.Dispose()
        }
    } catch {
        return ''
    }
}

function Get-CodexSessionHashShort {
    param([string]$SessionId = '', [string]$Salt = '')
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
        [int]$ClaudePid = 0,
        [string]$LaunchMarker = ''
    )

    $sid = ([string]$SessionId).Trim().ToLowerInvariant()
    $preferred = ([string]$PreferredShort).Trim().ToLowerInvariant()
    if (-not $sid) { return $preferred }
    if (-not $Assignments) { $Assignments = @{} }

    foreach ($key in @($Assignments.Keys)) {
        $entry = $Assignments[$key]
        $entrySid = ''
        try { $entrySid = ([string](Get-CodexEntryValue -Entry $entry -Name 'session_id')).Trim().ToLowerInvariant() } catch {}
        if ($entrySid -and $entrySid -eq $sid) {
            return ([string]$key).ToLowerInvariant()
        }
    }

    if ($preferred -match '^[a-f0-9]{8}$') {
        if (-not $Assignments.ContainsKey($preferred)) { return $preferred }

        $existing = $Assignments[$preferred]
        $existingSid = ''
        $existingPid = 0
        $existingOriginator = ''
        try { $existingSid = ([string](Get-CodexEntryValue -Entry $existing -Name 'session_id')).Trim().ToLowerInvariant() } catch {}
        try { $existingPid = [int](Get-CodexEntryValue -Entry $existing -Name 'claude_pid') } catch {}
        try { $existingOriginator = [string](Get-CodexEntryValue -Entry $existing -Name 'source_originator') } catch {}

        if (-not $existingSid -or $existingSid -eq $sid) { return $preferred }
        if ($ClaudePid -gt 0 -and $existingPid -eq $ClaudePid) { return $preferred }
        if ($LaunchMarker -and $existingOriginator -eq $LaunchMarker) { return $preferred }
    }

    for ($i = 0; $i -lt 64; $i++) {
        $candidate = Get-CodexSessionHashShort -SessionId $sid -Salt "registry:$i"
        if ($candidate -notmatch '^[a-f0-9]{8}$') { continue }
        if (-not $Assignments.ContainsKey($candidate)) { return $candidate }
        $candidateSid = ''
        try { $candidateSid = ([string](Get-CodexEntryValue -Entry $Assignments[$candidate] -Name 'session_id')).Trim().ToLowerInvariant() } catch {}
        if ($candidateSid -eq $sid) { return $candidate }
    }

    return ''
}

function Get-CodexHookCwd {
    param($Payload)
    try {
        if ($Payload -and $Payload.cwd) { return [string]$Payload.cwd }
    } catch {}
    try { return (Get-Location).Path } catch { return '' }
}

function Get-CodexHookProcessKind {
    param(
        [int]$CodexPid = 0,
        [scriptblock]$ProcessLookup = $null
    )

    if ($CodexPid -le 0) { return 'codex-cli' }
    $lookup = if ($ProcessLookup) {
        $ProcessLookup
    } else {
        {
            param([int]$LookupPid)
            Get-CimInstance Win32_Process -Filter "ProcessId=$LookupPid" -ErrorAction SilentlyContinue |
                Select-Object -First 1 Name, ProcessId, CommandLine
        }
    }

    $proc = $null
    try { $proc = & $lookup $CodexPid } catch { $proc = $null }
    if (-not $proc) { return 'codex-cli' }

    $name = ''
    $commandLine = ''
    try { $name = ([string]$proc.Name).ToLowerInvariant() } catch {}
    try { $commandLine = [string]$proc.CommandLine } catch {}

    if ($name -eq 'codex.exe' -and $commandLine -match '(^|\s)app-server(\s|$)') {
        return 'codex-plugin'
    }
    return 'codex-cli'
}

function Test-CodexHookTerminalProcess {
    param(
        [int]$CodexPid = 0,
        [scriptblock]$ProcessLookup = $null
    )
    return ((Get-CodexHookProcessKind -CodexPid $CodexPid -ProcessLookup $ProcessLookup) -eq 'codex-cli')
}

function Resolve-CodexHookRolloutMeta {
    param($Payload, [string]$SessionId = '')

    $sid = ([string]$SessionId).Trim().ToLowerInvariant()
    if (-not $sid) { return $null }

    $candidatePaths = @()
    foreach ($name in @('transcript_path', 'transcriptPath', 'rollout_path', 'rolloutPath', 'session_path', 'sessionPath')) {
        try {
            if ($Payload -and ($Payload.PSObject.Properties.Name -contains $name) -and $Payload.$name) {
                $candidatePaths += [string]$Payload.$name
            }
        } catch {}
    }

    foreach ($path in ($candidatePaths | Where-Object { $_ } | Select-Object -Unique)) {
        try {
            if (Test-Path -LiteralPath $path) {
                $meta = Get-CodexRolloutSessionMeta -Path $path
                if ($meta -and ([string]$meta.session_id).ToLowerInvariant() -eq $sid) { return $meta }
            }
        } catch {}
    }

    $root = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME 'sessions' } else { Join-Path $env:USERPROFILE '.codex\sessions' }
    if (-not (Test-Path $root)) { return $null }

    try {
        $matches = Get-ChildItem -LiteralPath $root -Recurse -File -Filter "*$sid.jsonl" -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTimeUtc -Descending
        foreach ($file in $matches) {
            $meta = Get-CodexRolloutSessionMeta -Path $file.FullName
            if ($meta -and ([string]$meta.session_id).ToLowerInvariant() -eq $sid) { return $meta }
        }
    } catch {}

    return $null
}

function Get-CodexPluginSessionLabel {
    param([string]$CurrentDir = '')

    $project = ''
    try { if ($CurrentDir) { $project = Split-Path -Leaf $CurrentDir } } catch {}
    if (-not $project) { $project = 'background task' }
    $project = ($project -replace '[\r\n\t]+', ' ' -replace '\s{2,}', ' ').Trim()
    $label = "Claude Codex - $project"
    if ($label.Length -gt 60) { $label = $label.Substring(0, 60).Trim() }
    return $label
}

function Get-CodexEntryValue {
    param([object]$Entry = $null, [string]$Name = '')
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

function Test-CodexPluginEntry {
    param([object]$Entry = $null)
    $kind = Get-CodexEntryValue -Entry $Entry -Name 'source_kind'
    return ([string]$kind -eq 'codex-plugin')
}

function Get-CodexPluginCleanupTombstonePath {
    param([string]$Short = '')
    $shortId = ([string]$Short).Trim().ToLowerInvariant()
    if ($shortId -notmatch '^[a-f0-9]{8}$') { return '' }
    return (Join-Path $script:SessionsDir "$shortId-plugin-cleaned.flag")
}

function Test-CodexPluginMarker {
    param([string]$Short = '')
    $shortId = ([string]$Short).Trim().ToLowerInvariant()
    if ($shortId -notmatch '^[a-f0-9]{8}$') { return $false }
    try {
        return (
            (Test-Path -LiteralPath (Join-Path $script:SessionsDir "$shortId-plugin-start.json")) -or
            (Test-Path -LiteralPath (Join-Path $script:SessionsDir "$shortId-plugin-start-announced.flag"))
        )
    } catch {
        return $false
    }
}

function Set-CodexPluginCleanupTombstone {
    param([string]$Short = '', [string]$Caller = 'codex-hook')
    $path = Get-CodexPluginCleanupTombstonePath -Short $Short
    if (-not $path) { return $false }
    try {
        if (-not (Test-Path $script:SessionsDir)) { New-Item -ItemType Directory -Path $script:SessionsDir -Force | Out-Null }
        Set-Content -LiteralPath $path -Value ([DateTimeOffset]::Now.ToUnixTimeSeconds()) -Encoding utf8 -NoNewline
        Write-CodexHookLog -Caller $Caller -Message "codex-plugin cleanup tombstone set for $Short"
        return $true
    } catch {
        Write-CodexHookLog -Caller $Caller -Message "codex-plugin cleanup tombstone failed for ${Short}: $($_.Exception.Message)"
        return $false
    }
}

function Clear-CodexPluginCleanupTombstone {
    param([string]$Short = '', [string]$Caller = 'codex-hook')
    $path = Get-CodexPluginCleanupTombstonePath -Short $Short
    if (-not $path) { return $false }
    try {
        if (Test-Path -LiteralPath $path) {
            Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            Write-CodexHookLog -Caller $Caller -Message "codex-plugin cleanup tombstone cleared for $Short"
            return $true
        }
    } catch {}
    return $false
}

function Get-CodexPluginIdentityLabel {
    param([object]$Entry = $null, [string]$Fallback = 'Claude Codex')
    $label = [string](Get-CodexEntryValue -Entry $Entry -Name 'label')
    if (-not $label) { $label = [string](Get-CodexEntryValue -Entry $Entry -Name 'source_label') }
    if (-not $label) { $label = $Fallback }
    $label = ($label -replace '[\r\n\t]+', ' ' -replace '\s{2,}', ' ').Trim()
    if ($label.Length -gt 80) { $label = $label.Substring(0, 80).Trim() }
    return $label
}

function Get-CodexPluginHookScript {
    param([string]$Name = '')
    $live = Join-Path $script:TtHome "hooks\$Name"
    if (Test-Path $live) { return $live }
    $repo = Join-Path (Split-Path $script:AppDir -Parent) "hooks\$Name"
    if (Test-Path $repo) { return $repo }
    return $live
}

function Start-CodexPluginStartAnnouncement {
    param($Sync, [string]$Caller = 'codex-hook')
    if (-not $Sync -or -not $Sync.short -or -not (Test-CodexPluginEntry -Entry $Sync.entry)) { return $false }
    $short = ([string]$Sync.short).ToLowerInvariant()
    if ($short -notmatch '^[a-f0-9]{8}$') { return $false }

    try {
        if (-not (Test-Path $script:SessionsDir)) { New-Item -ItemType Directory -Path $script:SessionsDir -Force | Out-Null }
        [void](Clear-CodexPluginCleanupTombstone -Short $short -Caller $Caller)
        $marker = Join-Path $script:SessionsDir "$short-plugin-start-announced.flag"
        if (Test-Path $marker) {
            Write-CodexHookLog -Caller $Caller -Message "codex-plugin start announcement already sent for $short"
            return $false
        }
        Set-Content -LiteralPath $marker -Value ([DateTimeOffset]::Now.ToUnixTimeSeconds()) -Encoding utf8 -NoNewline
    } catch {}

    $scriptPath = Get-CodexPluginHookScript -Name 'codex-plugin-announce.ps1'
    $label = Get-CodexPluginIdentityLabel -Entry $Sync.entry
    $index = Get-CodexEntryValue -Entry $Sync.entry -Name 'index'
    $jobPath = Join-Path $script:SessionsDir "$short-plugin-start.json"
    try {
        [ordered]@{
            short      = $short
            session_id = [string]$Sync.session_id
            label      = $label
            index      = [int]$index
            source_cwd = [string]$Sync.cwd
            caller     = $Caller
        } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $jobPath -Encoding utf8
    } catch {}
    $args = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', $scriptPath,
        '-JobPath', $jobPath
    )

    try {
        Start-Process -FilePath 'powershell.exe' -ArgumentList $args -WindowStyle Hidden -WorkingDirectory $script:TtHome
        Write-CodexHookLog -Caller $Caller -Message "queued codex-plugin start announcement short=$short label='$label'"
        return $true
    } catch {
        Write-CodexHookLog -Caller $Caller -Message "codex-plugin start announcement spawn failed for ${short}: $($_.Exception.Message)"
        return $false
    }
}

function Remove-CodexPluginQueueFiles {
    param([string]$Short = '', [string]$Caller = 'codex-hook')
    $shortId = ([string]$Short).Trim().ToLowerInvariant()
    if ($shortId -notmatch '^[a-f0-9]{8}$' -or -not (Test-Path $script:QueueDir)) { return 0 }
    $rx = "-$([regex]::Escape($shortId))(?:\.original)?\.(?:mp3|wav|txt)(?:\.partial)?$"
    $purged = 0
    try {
        Get-ChildItem -LiteralPath $script:QueueDir -File -ErrorAction SilentlyContinue | ForEach-Object {
            if ($_.Name -match $rx) {
                try {
                    Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
                    $purged += 1
                } catch {}
            }
        }
    } catch {}
    if ($purged -gt 0) { Write-CodexHookLog -Caller $Caller -Message "purged $purged queue file(s) for codex-plugin $shortId" }
    return $purged
}

function Start-CodexPluginSessionCleanup {
    param($Sync, [int]$DelaySeconds = $script:PluginCleanupDelaySeconds, [string]$Caller = 'codex-hook')
    if (-not $Sync -or -not $Sync.short -or -not (Test-CodexPluginEntry -Entry $Sync.entry)) { return $false }
    $short = ([string]$Sync.short).ToLowerInvariant()
    if ($short -notmatch '^[a-f0-9]{8}$') { return $false }
    if ($DelaySeconds -lt 0) { $DelaySeconds = 0 }

    $scriptPath = Get-CodexPluginHookScript -Name 'codex-plugin-cleanup.ps1'
    $args = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', $scriptPath,
        '-Short', $short,
        '-DelaySeconds', ([string]$DelaySeconds),
        '-Caller', $Caller,
        '-PurgeQueue'
    )
    try {
        Start-Process -FilePath 'powershell.exe' -ArgumentList $args -WindowStyle Hidden -WorkingDirectory $script:TtHome
        Write-CodexHookLog -Caller $Caller -Message "scheduled codex-plugin cleanup short=$short delay=${DelaySeconds}s"
        return $true
    } catch {
        Write-CodexHookLog -Caller $Caller -Message "codex-plugin cleanup spawn failed for ${short}: $($_.Exception.Message)"
        return $false
    }
}

function Get-StableCodexPid {
    param(
        [int]$StartPid = $PID,
        [int]$MaxHops = 10,
        [scriptblock]$ProcessLookup = $null
    )
    $lookup = if ($ProcessLookup) {
        $ProcessLookup
    } else {
        {
            param([int]$LookupPid)
            Get-CimInstance Win32_Process -Filter "ProcessId=$LookupPid" -ErrorAction SilentlyContinue |
                Select-Object -First 1 Name, ProcessId, ParentProcessId
        }
    }

    $current = $StartPid
    $fallbackParent = 0
    $lastCodex = 0
    for ($i = 0; $i -lt $MaxHops -and $current -gt 0; $i++) {
        $proc = $null
        try { $proc = & $lookup $current } catch { $proc = $null }
        if (-not $proc) { break }
        $parent = 0
        try { $parent = [int]$proc.ParentProcessId } catch {}
        if ($i -eq 0) { $fallbackParent = $parent }
        $name = ''
        try { $name = ([string]$proc.Name).ToLowerInvariant() } catch {}
        if ($name -eq 'codex.exe') {
            try { $lastCodex = [int]$proc.ProcessId } catch { $lastCodex = $current }
        }
        if ($parent -le 0 -or $parent -eq $current) { break }
        $current = $parent
    }
    if ($lastCodex -gt 0) { return $lastCodex }
    return $fallbackParent
}

function Initialize-CodexConsoleTitleNative {
    if (([System.Management.Automation.PSTypeName]'TTCodexConsoleTitleNative').Type) { return }
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class TTCodexConsoleTitleNative {
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

function Invoke-WithCodexConsole {
    param([int]$TargetPid, [scriptblock]$Block, [object[]]$ArgumentList = @())
    if ($TargetPid -le 0 -or -not $Block) { return $false }
    try {
        Initialize-CodexConsoleTitleNative
        [TTCodexConsoleTitleNative]::FreeConsole() | Out-Null
        if (-not [TTCodexConsoleTitleNative]::AttachConsole([uint32]$TargetPid)) { return $false }
        try {
            return (& $Block @ArgumentList)
        } finally {
            [TTCodexConsoleTitleNative]::FreeConsole() | Out-Null
        }
    } catch {
        return $false
    }
}

function Set-CodexTerminalTitleForPid {
    param([int]$TargetPid, [string]$Title = '')
    if ($TargetPid -le 0 -or -not $Title) { return $false }
    $nativeSet = Invoke-WithCodexConsole -TargetPid $TargetPid -Block {
        param([string]$AttachedTitle)
        [TTCodexConsoleTitleNative]::SetConsoleTitle($AttachedTitle)
    } -ArgumentList @($Title)
    $oscSet = Invoke-WithCodexConsole -TargetPid $TargetPid -Block {
        param([string]$AttachedTitle)
        $out = [TTCodexConsoleTitleNative]::CreateFile('CONOUT$', [TTCodexConsoleTitleNative]::GENERIC_WRITE, [TTCodexConsoleTitleNative]::FILE_SHARE_WRITE, [IntPtr]::Zero, [TTCodexConsoleTitleNative]::OPEN_EXISTING, 0, [IntPtr]::Zero)
        if ($out -eq [IntPtr]::Zero -or $out.ToInt64() -eq -1) {
            $out = [TTCodexConsoleTitleNative]::GetStdHandle([TTCodexConsoleTitleNative]::STD_OUTPUT_HANDLE)
        }
        if ($out -eq [IntPtr]::Zero -or $out.ToInt64() -eq -1) { return $false }
        $mode = [uint32]0
        if ([TTCodexConsoleTitleNative]::GetConsoleMode($out, [ref]$mode)) {
            [TTCodexConsoleTitleNative]::SetConsoleMode($out, ($mode -bor [TTCodexConsoleTitleNative]::ENABLE_VIRTUAL_TERMINAL_PROCESSING)) | Out-Null
        }
        $seq = "$([char]27)]0;$AttachedTitle$([char]7)"
        $written = [uint32]0
        try {
            return [TTCodexConsoleTitleNative]::WriteConsole($out, $seq, [uint32]$seq.Length, [ref]$written, [IntPtr]::Zero)
        } finally {
            [TTCodexConsoleTitleNative]::CloseHandle($out) | Out-Null
        }
    } -ArgumentList @($Title)
    return ([bool]$nativeSet -or [bool]$oscSet)
}

function Set-CodexWorkingFlag {
    param([string]$Short = '', [ValidateSet('mark', 'clear')] [string]$Action = 'mark', [string]$Caller = 'codex-hook')
    if ($Short -notmatch '^[a-f0-9]{8}$') { return }
    try {
        if (-not (Test-Path $script:SessionsDir)) { New-Item -ItemType Directory -Path $script:SessionsDir -Force | Out-Null }
        $flagPath = Join-Path $script:SessionsDir "$Short-working.flag"
        if ($Action -eq 'mark') {
            Set-Content -Path $flagPath -Value ([DateTimeOffset]::Now.ToUnixTimeSeconds()) -Encoding utf8 -NoNewline
            Write-CodexHookLog -Caller $Caller -Message "working flag set for $Short"
        } elseif (Test-Path $flagPath) {
            Remove-Item -Force $flagPath -ErrorAction SilentlyContinue
            Write-CodexHookLog -Caller $Caller -Message "working flag cleared for $Short"
        }
    } catch {
        Write-CodexHookLog -Caller $Caller -Message "working flag $Action failed for ${Short}: $($_.Exception.Message)"
    }
}

function Resolve-CodexHookWorkingShort {
    param($Payload, [string]$Caller = 'codex-hook')

    if (-not $Payload) { return '' }
    $sessionId = ''
    try { $sessionId = [string]$Payload.session_id } catch {}
    $preferredShort = Get-CodexSessionShort -SessionId $sessionId
    if ($preferredShort -notmatch '^[a-f0-9]{8}$') {
        if ($sessionId) { Write-CodexHookLog -Caller $Caller -Message "working short unavailable for session '$sessionId'" }
        return ''
    }

    try {
        if (Test-Path -LiteralPath $script:RegistryPath) {
            $raw = Get-Content -LiteralPath $script:RegistryPath -Raw -ErrorAction SilentlyContinue
            if ($raw) {
                $registry = $raw | ConvertFrom-Json -ErrorAction Stop
                foreach ($prop in @($registry.PSObject.Properties)) {
                    $entrySid = ''
                    try { $entrySid = ([string]$prop.Value.session_id).Trim().ToLowerInvariant() } catch {}
                    if ($entrySid -and $entrySid -eq $sessionId.Trim().ToLowerInvariant()) {
                        $existingShort = ([string]$prop.Name).Trim().ToLowerInvariant()
                        if ($existingShort -match '^[a-f0-9]{8}$') { return $existingShort }
                    }
                }
            }
        }
    } catch {
        Write-CodexHookLog -Caller $Caller -Message "working short registry lookup failed: $($_.Exception.Message)"
    }

    return $preferredShort
}

function Remove-CodexPluginSession {
    param([string]$Short = '', [string]$Caller = 'codex-hook', [switch]$PurgeQueue)
    $shortId = ([string]$Short).Trim().ToLowerInvariant()
    if ($shortId -notmatch '^[a-f0-9]{8}$') { return $false }

    Import-Module (Join-Path $script:AppDir 'session-registry.psm1') -Force -DisableNameChecking -ErrorAction SilentlyContinue

    $removed = $false
    $shouldCleanupFiles = $false
    $locked = Enter-RegistryLock -RegistryPath $script:RegistryPath
    try {
        $assignments = Read-Registry -RegistryPath $script:RegistryPath
        if (-not $assignments.ContainsKey($shortId)) {
            $shouldCleanupFiles = $true
        } else {
            $entry = $assignments[$shortId]
            $hasMarker = Test-CodexPluginMarker -Short $shortId
            if (-not (Test-CodexPluginEntry -Entry $entry) -and -not $hasMarker) { return $false }
            $shouldCleanupFiles = $true

            if ($locked) {
                [void]$assignments.Remove($shortId)
                Save-Registry -RegistryPath $script:RegistryPath -Assignments $assignments `
                              -Caller $Caller -LogPath $script:LogPath -SkipRestoreShorts @($shortId)
                $removed = $true
                Write-CodexHookLog -Caller $Caller -Message "removed codex-plugin session $shortId from registry"
            } else {
                Write-CodexHookLog -Caller $Caller -Message "registry lock unavailable; skipped codex-plugin cleanup for $shortId"
            }
        }
    } finally {
        if ($locked) { Exit-RegistryLock -RegistryPath $script:RegistryPath }
    }

    if (-not $shouldCleanupFiles) { return $removed }
    [void](Set-CodexPluginCleanupTombstone -Short $shortId -Caller $Caller)
    try {
        Remove-Item -Force (Join-Path $script:SessionsDir "$shortId-working.flag") -ErrorAction SilentlyContinue
        Remove-Item -Force (Join-Path $script:SessionsDir "$shortId-plugin-start-announced.flag") -ErrorAction SilentlyContinue
        Remove-Item -Force (Join-Path $script:SessionsDir "$shortId-plugin-start.json") -ErrorAction SilentlyContinue
    } catch {}
    if ($PurgeQueue) { [void](Remove-CodexPluginQueueFiles -Short $shortId -Caller $Caller) }
    return $removed
}

function Sync-CodexHookSession {
    param($Payload, [string]$Caller = 'codex-hook', [switch]$UpdateTitle)

    if (-not $Payload) { return $null }
    $sessionId = ''
    try { $sessionId = [string]$Payload.session_id } catch {}
    if (-not $sessionId) {
        Write-CodexHookLog -Caller $Caller -Message 'no session_id in payload'
        return $null
    }
    $preferredShort = Get-CodexSessionShort -SessionId $sessionId
    $short = $preferredShort
    if ($preferredShort -notmatch '^[a-f0-9]{8}$') {
        Write-CodexHookLog -Caller $Caller -Message "invalid short for session '$sessionId'"
        return $null
    }

    if (-not (Test-Path $script:QueueDir)) { New-Item -ItemType Directory -Path $script:QueueDir -Force | Out-Null }
    if (-not (Test-Path $script:SessionsDir)) { New-Item -ItemType Directory -Path $script:SessionsDir -Force | Out-Null }

    Import-Module (Join-Path $script:AppDir 'session-registry.psm1') -Force -DisableNameChecking -ErrorAction SilentlyContinue
    Import-Module (Join-Path $script:AppDir 'codex-terminal.psm1') -Force -DisableNameChecking -ErrorAction SilentlyContinue

    $codexPid = 0
    try { $codexPid = if ($env:TT_FAKE_CODEX_PID) { [int]$env:TT_FAKE_CODEX_PID } else { Get-StableCodexPid } } catch {}
    $processKind = 'codex-cli'
    try { $processKind = Get-CodexHookProcessKind -CodexPid $codexPid } catch { $processKind = 'codex-cli' }
    $launchToken = ''
    $launchMarker = ''
    try {
        $launchToken = ([string]$env:TT_LAUNCH_TOKEN).Trim()
        if ($launchToken) { $launchMarker = "toolbar-launch:$launchToken" }
    } catch {}

    $rolloutMeta = $null
    try { $rolloutMeta = Resolve-CodexHookRolloutMeta -Payload $Payload -SessionId $sessionId } catch { $rolloutMeta = $null }
    try {
        if ($processKind -ne 'codex-plugin' -and $rolloutMeta -and ($rolloutMeta.PSObject.Properties.Name -contains 'terminal_source') -and $rolloutMeta.terminal_source -eq $false) {
            $source = if ($rolloutMeta.PSObject.Properties.Name -contains 'source') { [string]$rolloutMeta.source } else { '' }
            $originator = if ($rolloutMeta.PSObject.Properties.Name -contains 'originator') { [string]$rolloutMeta.originator } else { '' }
            Write-CodexHookLog -Caller $Caller -Message "skip non-terminal hook short=$short source=$source originator=$originator"
            return $null
        }
    } catch {}

    $now = [DateTimeOffset]::Now.ToUnixTimeSeconds()
    $entry = $null
    $skipRestoreShorts = @()
    $locked = Enter-RegistryLock -RegistryPath $script:RegistryPath
    try {
        $assignments = Read-Registry -RegistryPath $script:RegistryPath
        $short = Resolve-CodexRegistryShort -SessionId $sessionId -Assignments $assignments `
                                           -PreferredShort $preferredShort -ClaudePid $codexPid `
                                           -LaunchMarker $launchMarker
        if ($short -notmatch '^[a-f0-9]{8}$') {
            Write-CodexHookLog -Caller $Caller -Message "could not resolve registry short for preferred=$preferredShort session=$sessionId"
            return $null
        }
        if ($short -ne $preferredShort) {
            Write-CodexHookLog -Caller $Caller -Message "resolved short collision preferred=$preferredShort resolved=$short session=$sessionId"
        }
        if ($locked) {
            $null = Update-SessionAssignment -Assignments $assignments -Short $short `
                                             -SessionId $sessionId -ClaudePid $codexPid -Now $now `
                                             -LogPath $script:LogPath -Caller $Caller
            $entry = $assignments[$short]
            try {
                if ($launchMarker) {
                    $launchShorts = @()
                    foreach ($key in @($assignments.Keys)) {
                        if ($key -eq $short) { continue }
                        $candidate = $assignments[$key]
                        if (-not $candidate) { continue }
                        $originator = ''
                        try {
                            if ($candidate.ContainsKey('source_originator')) { $originator = [string]$candidate.source_originator }
                        } catch {}
                        if ($originator -eq $launchMarker) { $launchShorts += $key }
                    }
                    foreach ($launchShort in $launchShorts) {
                        $launchEntry = $assignments[$launchShort]
                        if (-not $launchEntry) { continue }
                        foreach ($name in @('label', 'index', 'pinned', 'muted', 'focus', 'voice', 'voice_auto', 'heartbeat_enabled', 'speech_includes', 'source_kind', 'source_label', 'source_cwd', 'source', 'source_originator')) {
                            try {
                                if ($launchEntry.ContainsKey($name)) { $entry[$name] = $launchEntry[$name] }
                            } catch {}
                        }
                        [void]$assignments.Remove($launchShort)
                        $skipRestoreShorts += $launchShort
                        Write-CodexHookLog -Caller $Caller -Message "migrated toolbar launch intent $launchShort -> $short marker=$launchMarker"
                    }
                }
            } catch {
                Write-CodexHookLog -Caller $Caller -Message "toolbar launch intent migration failed for ${short}: $($_.Exception.Message)"
            }
            if ($processKind -eq 'codex-plugin' -and $entry) {
                $sourceCwd = Get-CodexHookCwd -Payload $Payload
                try {
                    if ($rolloutMeta -and ($rolloutMeta.PSObject.Properties.Name -contains 'cwd') -and $rolloutMeta.cwd) {
                        $sourceCwd = [string]$rolloutMeta.cwd
                    }
                } catch {}
                $autoLabel = Get-CodexPluginSessionLabel -CurrentDir $sourceCwd
                $entry['source_kind'] = 'codex-plugin'
                $entry['source_label'] = $autoLabel
                if ($sourceCwd) { $entry['source_cwd'] = $sourceCwd }
                if ($rolloutMeta) {
                    if ($rolloutMeta.PSObject.Properties.Name -contains 'source') { $entry['source'] = [string]$rolloutMeta.source }
                    if ($rolloutMeta.PSObject.Properties.Name -contains 'originator') { $entry['source_originator'] = [string]$rolloutMeta.originator }
                }
                if (-not $entry.label -or ($entry.ContainsKey('auto_label') -and $entry.auto_label -eq $true)) {
                    $entry.label = $autoLabel
                    $entry['auto_label'] = $true
                }
            }
            Save-Registry -RegistryPath $script:RegistryPath -Assignments $assignments `
                          -Caller $Caller -LogPath $script:LogPath -SkipRestoreShorts $skipRestoreShorts
        } else {
            if ($assignments.ContainsKey($short)) {
                $entry = $assignments[$short]
            } else {
                $sum = 0
                foreach ($ch in $short.ToCharArray()) { $sum += [int]$ch }
                $entry = @{ index = ($sum % 24); session_id = $sessionId; claude_pid = $codexPid; label = ''; pinned = $false; muted = $false; focus = $false; last_seen = $now }
            }
            Write-CodexHookLog -Caller $Caller -Message "registry lock unavailable; skipped save for $short"
        }
    } finally {
        if ($locked) { Exit-RegistryLock -RegistryPath $script:RegistryPath }
    }

    try {
        Write-SessionPidFile -SessionsDir $script:SessionsDir -ClaudePid $codexPid -SessionId $sessionId -Short $short -Now $now
    } catch {}

    $cwd = Get-CodexHookCwd -Payload $Payload
    $title = ''
    $titleSet = $false
    if ($UpdateTitle -and $codexPid -gt 0) {
        try {
            $title = Format-CodexWindowTitle -Short $short -Entry $entry -CurrentDir $cwd
            $titleSet = Set-CodexTerminalTitleForPid -TargetPid $codexPid -Title $title
        } catch {}
    }
    Write-CodexHookLog -Caller $Caller -Message "synced short=$short pid=$codexPid title_set=$titleSet event=$($Payload.hook_event_name)"
    return [pscustomobject]@{
        short      = $short
        session_id = $sessionId
        codex_pid  = $codexPid
        entry      = $entry
        title      = $title
        title_set  = $titleSet
        cwd        = $cwd
    }
}

Export-ModuleMember -Function `
    Read-CodexHookPayload, `
    Get-CodexSessionShort, `
    Get-CodexSessionHashShort, `
    Resolve-CodexRegistryShort, `
    Get-CodexHookCwd, `
    Get-CodexHookProcessKind, `
    Test-CodexHookTerminalProcess, `
    Resolve-CodexHookRolloutMeta, `
    Get-CodexPluginSessionLabel, `
    Get-StableCodexPid, `
    Set-CodexTerminalTitleForPid, `
    Resolve-CodexHookWorkingShort, `
    Set-CodexWorkingFlag, `
    Start-CodexPluginStartAnnouncement, `
    Start-CodexPluginSessionCleanup, `
    Remove-CodexPluginSession, `
    Sync-CodexHookSession, `
    Write-CodexHookLog
