# Session-registry PowerShell module.
#
# Canonical source for the ~80-line session-assignment dance that used to
# live in THREE separate files (statusline.ps1, hooks/speak-response.ps1,
# hooks/speak-on-tool.ps1), each with a "MUST stay in lock-step" comment
# and an ever-present risk of drift. Extracted per audit CC-4.
#
# The JS writer lives at app/main.js (ensureAssignmentsForFiles +
# sanitiseEntry + saveAssignments) and MUST use the identical entry
# schema and assignment algorithm. The shape is:
#
#   { assignments: { <short8>: {
#       index:      int 0..23,           # palette slot
#       session_id: string,              # full Claude Code session uuid
#       claude_pid: int,                 # parent Claude Code PID (0 if unknown)
#       label:      string,              # user-editable, default ''
#       pinned:     bool,                # true = never reassign
#       muted:      bool,                # skip synthesis entirely
#       focus:      bool,                # priority playback (exclusive)
#       last_seen:  long (epoch seconds),
#       voice?:     string,              # optional per-session voice
#       speech_includes?: { <flag>: bool }  # optional per-session overrides
#   } } }
#
# Palette size matches app/renderer.js PALETTE_SIZE (24).

Set-Variable -Scope Script -Name PaletteSize -Value 24 -Option ReadOnly -Force

# Lock semantics mirror app/lib/registry-lock.js exactly so JS + PS writers
# serialise against the same .lock file. Without this, the PS statusline /
# speak-* hooks can read a pre-change registry into memory while the JS
# toolbar is mid-write, then `Save-Registry` stomps the toolbar's change.
# Visible symptom: colour / label / mute changes in Settings don't stick.
Set-Variable -Scope Script -Name LockStaleMs       -Value 3000 -Option ReadOnly -Force
Set-Variable -Scope Script -Name LockAcquireMs     -Value 500  -Option ReadOnly -Force
Set-Variable -Scope Script -Name LockPollMs        -Value 15   -Option ReadOnly -Force

function Enter-RegistryLock {
    <#
    .SYNOPSIS
    Atomic-create a `<RegistryPath>.lock` file using CreateNew + no sharing
    (O_EXCL equivalent). Returns $true on acquisition, $false if the lock
    is held by another process and couldn't be claimed within the timeout.

    A lock file older than $script:LockStaleMs is considered abandoned
    (crashed holder that never released) and stolen. If the acquire loop
    times out we return $false; callers fall through unlocked rather than
    freezing the statusline. This matches the JS wrapper in
    app/lib/registry-lock.js line-for-line.
    #>
    param([Parameter(Mandatory = $true)] [string]$RegistryPath)
    $lockPath = "$RegistryPath.lock"
    $start = [Environment]::TickCount64
    while (([Environment]::TickCount64 - $start) -lt $script:LockAcquireMs) {
        try {
            $fs = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try {
                $bytes = [Text.Encoding]::UTF8.GetBytes([string]$PID)
                $fs.Write($bytes, 0, $bytes.Length)
            } finally {
                $fs.Close()
            }
            return $true
        } catch [IO.IOException] {
            try {
                $st = Get-Item $lockPath -Force -ErrorAction Stop
                $ageMs = ([DateTime]::UtcNow - $st.LastWriteTimeUtc).TotalMilliseconds
                if ($ageMs -gt $script:LockStaleMs) {
                    Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
                    continue
                }
            } catch {
                # Stat may race with the other holder releasing -- fall through
                # and retry rather than spin-panicking.
            }
            Start-Sleep -Milliseconds $script:LockPollMs
        }
    }
    return $false
}

function Exit-RegistryLock {
    <#
    .SYNOPSIS
    Delete the `<RegistryPath>.lock` sentinel. Idempotent -- a missing file
    is a no-op (acquire may have timed out and we're releasing a lock we
    never held). Never throws.
    #>
    param([Parameter(Mandatory = $true)] [string]$RegistryPath)
    $lockPath = "$RegistryPath.lock"
    Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
}

function Read-Registry {
    <#
    .SYNOPSIS
    Read the session registry from disk and return a normalised hashtable
    of { short8 -> entry-hashtable }. Returns an empty hashtable if the
    file doesn't exist or is malformed -- never throws.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$RegistryPath
    )

    $assignments = @{}
    if (-not (Test-Path $RegistryPath)) { return $assignments }

    try {
        $raw = Get-Content $RegistryPath -Raw -Encoding utf8
        if (-not $raw) { return $assignments }
        $parsed = $raw | ConvertFrom-Json
        if (-not $parsed.assignments) { return $assignments }

        foreach ($p in $parsed.assignments.PSObject.Properties) {
            $v = $p.Value
            $entry = @{
                index      = [int]$v.index
                session_id = [string]$v.session_id
                claude_pid = if ($v.claude_pid) { [int]$v.claude_pid } else { 0 }
                label      = if ($v.label) { [string]$v.label } else { '' }
                pinned     = if ($v.pinned) { [bool]$v.pinned } else { $false }
                muted      = ($v.PSObject.Properties.Name -contains 'muted') -and ($v.muted -eq $true)
                focus      = ($v.PSObject.Properties.Name -contains 'focus') -and ($v.focus -eq $true)
                last_seen  = [long]$v.last_seen
            }
            # Preserve per-session voice + speech_includes overrides through
            # every read/write cycle -- the Electron UI writes these too.
            if ($v.PSObject.Properties.Name -contains 'voice' -and $v.voice) {
                $entry['voice'] = [string]$v.voice
            }
            if ($v.PSObject.Properties.Name -contains 'speech_includes' -and $v.speech_includes) {
                $inc = @{}
                foreach ($ip in $v.speech_includes.PSObject.Properties) {
                    if ($ip.Value -is [bool]) { $inc[$ip.Name] = [bool]$ip.Value }
                }
                $entry['speech_includes'] = $inc
            }
            $assignments[$p.Name] = $entry
        }
    } catch {
        # Corrupt registry file: treat as empty. main.js has the same
        # tolerance. The next write will overwrite it with clean JSON.
    }
    return $assignments
}

function Update-SessionAssignment {
    <#
    .SYNOPSIS
    Ensure `$Short` has a slot in `$Assignments`. If it already exists,
    touch the bookkeeping (last_seen / session_id / claude_pid). If not,
    pick the lowest free index (0..23) and create the entry with
    default fields. Returns the resolved index.

    This function never prunes. Slot freeing is done by main.js's
    ensureAssignmentsForFiles, which applies the following rules via
    isSessionLive():
      - pinned=true sessions are NEVER pruned (user opt-in retention)
      - PID still alive -> keep
      - last_seen within SESSION_GRACE_SEC (14400s = 4h) -> keep
      - otherwise -> remove

    The settings panel's x button is the user-driven path to the same
    outcome. Call sites here just touch bookkeeping; they rely on
    main.js being authoritative for lifetime decisions.
    #>
    param(
        [Parameter(Mandatory = $true)] [hashtable]$Assignments,
        [Parameter(Mandatory = $true)] [string]$Short,
        [Parameter(Mandatory = $true)] [string]$SessionId,
        [Parameter(Mandatory = $true)] [int]$ClaudePid,
        [Parameter(Mandatory = $true)] [long]$Now
    )

    if ($Assignments.ContainsKey($Short)) {
        $Assignments[$Short].last_seen  = $Now
        $Assignments[$Short].session_id = $SessionId
        $Assignments[$Short].claude_pid = $ClaudePid
        return [int]$Assignments[$Short].index
    }

    $busy = @{}
    foreach ($key in @($Assignments.Keys)) {
        $busy[[int]$Assignments[$key].index] = $true
    }

    $idx = $null
    for ($i = 0; $i -lt $script:PaletteSize; $i++) {
        if (-not $busy.ContainsKey($i)) { $idx = $i; break }
    }

    # Palette full -- LRU eviction among non-pinned entries. Matches the
    # allocatePaletteIndex() helper in app/lib/palette-alloc.js so the
    # statusline and the Electron UI always agree on the slot table.
    if ($null -eq $idx) {
        $candidates = @()
        foreach ($key in @($Assignments.Keys)) {
            $entry = $Assignments[$key]
            if ($entry.pinned -ne $true) {
                $candidates += [pscustomobject]@{
                    Short = $key
                    LastSeen = [long]([int]$entry.last_seen)
                    Index = [int]$entry.index
                }
            }
        }
        if ($candidates.Count -gt 0) {
            $lru = $candidates | Sort-Object LastSeen, Short | Select-Object -First 1
            $idx = $lru.Index
            [void]$Assignments.Remove($lru.Short)
        } else {
            # Every slot is pinned -- hash-mod collision is unavoidable.
            $sum = 0
            foreach ($ch in $Short.ToCharArray()) { $sum += [int]$ch }
            $idx = $sum % $script:PaletteSize
        }
    }

    $Assignments[$Short] = @{
        index      = [int]$idx
        session_id = $SessionId
        claude_pid = $ClaudePid
        label      = ''
        pinned     = $false
        muted      = $false
        focus      = $false
        last_seen  = $Now
    }
    return [int]$idx
}

function Save-Registry {
    <#
    .SYNOPSIS
    Atomic registry write: serialise to `.tmp`, then rename over the real
    path. UTF-8 NO-BOM so JSON.parse() in app/main.js accepts the file.
    Silent on failure (registry write is best-effort; next invocation
    will retry from whatever persisted).
    #>
    param(
        [Parameter(Mandatory = $true)] [string]$RegistryPath,
        [Parameter(Mandatory = $true)] [hashtable]$Assignments
    )
    try {
        $tmp = "$RegistryPath.tmp"
        $jsonOut = (@{ assignments = $Assignments } | ConvertTo-Json -Depth 5)
        [IO.File]::WriteAllText($tmp, $jsonOut, [System.Text.UTF8Encoding]::new($false))
        Move-Item -Force $tmp $RegistryPath
    } catch {
        # Best-effort. Next write will retry.
    }
}

function Write-SessionPidFile {
    <#
    .SYNOPSIS
    Stamp a per-PID session file at `$SessionsDir/$Pid.json` so the
    "hey jarvis" / Ctrl+Shift+S flow can map foreground-window PID back
    to its session's colour/short. No-op if pid is 0 (unknown).
    #>
    param(
        [Parameter(Mandatory = $true)] [string]$SessionsDir,
        [Parameter(Mandatory = $true)] [int]$ClaudePid,
        [Parameter(Mandatory = $true)] [string]$SessionId,
        [Parameter(Mandatory = $true)] [string]$Short,
        [Parameter(Mandatory = $true)] [long]$Now
    )
    if (-not $ClaudePid) { return }
    try {
        $sessionFile = Join-Path $SessionsDir "$ClaudePid.json"
        $jsonOut = @{
            session_id = $SessionId
            short      = $Short
            claude_pid = $ClaudePid
            ts         = $Now
        } | ConvertTo-Json -Compress
        $tmp = "$sessionFile.tmp"
        [IO.File]::WriteAllText($tmp, $jsonOut, [System.Text.UTF8Encoding]::new($false))
        Move-Item -Force $tmp $sessionFile
    } catch {
        # Best-effort.
    }
}

Export-ModuleMember -Function Read-Registry, Update-SessionAssignment, Save-Registry, Write-SessionPidFile, Enter-RegistryLock, Exit-RegistryLock
