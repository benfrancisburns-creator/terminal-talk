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

# Window (seconds) during which a non-zero claude_pid on an existing
# entry is considered fresh enough to re-key for /clear migration.
# 600 s covers any realistic gap between consecutive hook fires on
# one terminal; anything older suggests Windows pid reuse, not the
# same live terminal, so we fall through to fresh palette allocation.
Set-Variable -Scope Script -Name PidMigrateWindowSec -Value 600 -Option ReadOnly -Force

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
        [Parameter(Mandatory = $true)] [long]$Now,
        # #6 G4 — when -LogPath + -Caller are provided, emit one
        # `update-session <short> -> <branch> index=<idx> pid=<pid>`
        # line per call so PID-migration / fresh-alloc / lru-evict
        # paths are diagnosable from logs alone. Branches:
        #   existing-hit  — short already in registry, bookkeeping only
        #   pid-migration — re-keyed from old short via PID match
        #   fresh-alloc   — lowest free palette slot taken
        #   lru-evict     — evicted a no-intent entry to free a slot
        #   hash-collision — palette full of intent-bearing entries
        # Optional so existing test call sites + un-instrumented
        # callers stay back-compat.
        [string]$LogPath = '',
        [string]$Caller = 'unknown'
    )

    function _LogBranch($branch, $idx) {
        if (-not $LogPath) { return }
        $ts = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
        $line = "$ts update-session $Short -> $branch index=$idx pid=$ClaudePid from=$Caller"
        try { Add-Content -Path $LogPath -Value $line -ErrorAction SilentlyContinue } catch {}
    }

    if ($Assignments.ContainsKey($Short)) {
        $Assignments[$Short].last_seen  = $Now
        $Assignments[$Short].session_id = $SessionId
        $Assignments[$Short].claude_pid = $ClaudePid
        $idx0 = [int]$Assignments[$Short].index
        _LogBranch 'existing-hit' $idx0
        return $idx0
    }

    # PID-identity migration. Claude Code's /clear rotates session_id but
    # keeps the same CLI process, so the same terminal walks in here with
    # a brand-new short. Without this migration we allocate a fresh
    # palette slot -- the user sees their colour "change" and their label
    # vanish, even though the terminal is the same. If an existing entry
    # has this claude_pid we re-key it under the new short, preserving
    # index / label / pinned / muted / focus / voice / speech_includes.
    #
    # Guards against false migration:
    #   1. Only match on non-zero pids: 0 means "unknown" and would
    #      collide across ghost entries created by main.js's queue-
    #      scanner fallback.
    #   2. Require freshness -- the matched entry's last_seen must be
    #      within $PidMigrateWindowSec. Without this, Windows reusing a
    #      pid hours later (rare but possible) would let a brand-new
    #      terminal inherit a long-dead session's colour and label.
    if ($ClaudePid -gt 0) {
        $cutoff = $Now - $script:PidMigrateWindowSec
        $oldShort = $null
        foreach ($key in @($Assignments.Keys)) {
            $entry = $Assignments[$key]
            if ([int]$entry.claude_pid -eq $ClaudePid -and [long]$entry.last_seen -ge $cutoff) {
                $oldShort = $key
                break
            }
        }
        if ($oldShort) {
            $migrated = $Assignments[$oldShort]
            $migrated.session_id = $SessionId
            $migrated.claude_pid = $ClaudePid
            $migrated.last_seen  = $Now
            $Assignments[$Short] = $migrated
            [void]$Assignments.Remove($oldShort)
            $idxM = [int]$migrated.index
            _LogBranch "pid-migration<-$oldShort" $idxM
            return $idxM
        }
    }

    $busy = @{}
    foreach ($key in @($Assignments.Keys)) {
        $busy[[int]$Assignments[$key].index] = $true
    }

    $idx = $null
    for ($i = 0; $i -lt $script:PaletteSize; $i++) {
        if (-not $busy.ContainsKey($i)) { $idx = $i; break }
    }

    # Palette full -- LRU eviction among entries with no user intent.
    # An entry is protected from eviction if pinned OR if it carries
    # any user customisation (label / voice / muted / focus /
    # speech_includes). Matches allocatePaletteIndex() + hasUserIntent()
    # in app/lib/palette-alloc.js so statusline + Electron UI always
    # agree on the candidate pool.
    $branchTag = 'fresh-alloc'
    if ($null -eq $idx) {
        $candidates = @()
        foreach ($key in @($Assignments.Keys)) {
            $entry = $Assignments[$key]
            $hasIntent = $false
            if ($entry.pinned -eq $true) { $hasIntent = $true }
            elseif ($entry.label -and ([string]$entry.label).Trim().Length -gt 0) { $hasIntent = $true }
            elseif ($entry.voice) { $hasIntent = $true }
            elseif ($entry.muted -eq $true) { $hasIntent = $true }
            elseif ($entry.focus -eq $true) { $hasIntent = $true }
            elseif ($entry.speech_includes -and $entry.speech_includes.Count -gt 0) { $hasIntent = $true }
            if (-not $hasIntent) {
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
            $branchTag = "lru-evict<-$($lru.Short)"
        } else {
            # Every slot is pinned -- hash-mod collision is unavoidable.
            $sum = 0
            foreach ($ch in $Short.ToCharArray()) { $sum += [int]$ch }
            $idx = $sum % $script:PaletteSize
            $branchTag = 'hash-collision'
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
    _LogBranch $branchTag ([int]$idx)
    return [int]$idx
}

function Save-Registry {
    <#
    .SYNOPSIS
    Atomic registry write: serialise to `.tmp`, then rename over the real
    path. UTF-8 NO-BOM so JSON.parse() in app/main.js accepts the file.
    Silent on failure (registry write is best-effort; next invocation
    will retry from whatever persisted).

    #6 G1 + G3 — when -LogPath is provided, appends one success/failure
    line per write so the JS-side and PS-side writers share the same
    attribution format. `Caller` identifies which hook/statusline
    invoked the save (required for diagnosing #8 wipes — five different
    writers touch session-colours.json).
    #>
    param(
        [Parameter(Mandatory = $true)] [string]$RegistryPath,
        [Parameter(Mandatory = $true)] [hashtable]$Assignments,
        [string]$Caller = 'unknown',
        [string]$LogPath = ''
    )
    $keys = 0
    try { $keys = $Assignments.Keys.Count } catch { $keys = 0 }
    # #8 defensive guard — PS callers (statusline, speak-on-tool,
    # speak-response) are all touch-paths that bump last_seen /
    # claude_pid / session_id but must never wipe user-intent fields.
    # Two restoration modes:
    #   1. MISSING ENTRY — disk has an entry with user-intent that's
    #      absent from the payload. Belt-and-braces catch for the
    #      lock-fail-race where a stale Read-Registry returned an empty
    #      hashtable; Save-Registry would otherwise persist only the
    #      firing terminal's own session, dropping the others.
    #   2. MISSING FIELD — entry exists in both, but payload has fewer
    #      user-intent fields (label / pinned / voice / muted / focus /
    #      speech_includes). Restore the disk value.
    # Mirrors the JS-side _guardUserIntent in main.js.
    $restored = @()
    if (Test-Path $RegistryPath) {
        try {
            $raw = Get-Content $RegistryPath -Raw -Encoding utf8
            if ($raw) {
                $parsed = $raw | ConvertFrom-Json
                if ($parsed.assignments) {
                    # PID-migration exclusion. Update-SessionAssignment re-keys
                    # entries on /clear; payload's new short inherits old's pid.
                    # Don't restore old short if its pid lives at a different
                    # key in the payload — that's migration, not a wipe.
                    $payloadPids = @{}
                    foreach ($pkey in @($Assignments.Keys)) {
                        $pent = $Assignments[$pkey]
                        if ($pent -and $pent.claude_pid -and [int]$pent.claude_pid -gt 0) {
                            $payloadPids[[int]$pent.claude_pid] = $pkey
                        }
                    }
                    # Missing-entry restoration.
                    foreach ($p in $parsed.assignments.PSObject.Properties) {
                        $short = $p.Name
                        if ($Assignments.ContainsKey($short)) { continue }
                        $old = $p.Value
                        $hasIntent = $false
                        if ($old.label -and ([string]$old.label).Length -gt 0) { $hasIntent = $true }
                        elseif ($old.pinned -eq $true) { $hasIntent = $true }
                        elseif ($old.voice) { $hasIntent = $true }
                        elseif ($old.muted -eq $true) { $hasIntent = $true }
                        elseif ($old.focus -eq $true) { $hasIntent = $true }
                        elseif ($old.PSObject.Properties.Name -contains 'speech_includes' -and $old.speech_includes) { $hasIntent = $true }
                        if (-not $hasIntent) { continue }
                        # Skip if pid lives at a different short in the payload.
                        if ($old.claude_pid -and [int]$old.claude_pid -gt 0 -and $payloadPids.ContainsKey([int]$old.claude_pid)) {
                            continue
                        }
                        $rebuilt = @{
                            index      = [int]$old.index
                            session_id = [string]$old.session_id
                            claude_pid = if ($old.claude_pid) { [int]$old.claude_pid } else { 0 }
                            label      = if ($old.label) { [string]$old.label } else { '' }
                            pinned     = if ($old.pinned) { [bool]$old.pinned } else { $false }
                            muted      = ($old.PSObject.Properties.Name -contains 'muted') -and ($old.muted -eq $true)
                            focus      = ($old.PSObject.Properties.Name -contains 'focus') -and ($old.focus -eq $true)
                            last_seen  = [long]$old.last_seen
                        }
                        if ($old.PSObject.Properties.Name -contains 'voice' -and $old.voice) {
                            $rebuilt['voice'] = [string]$old.voice
                        }
                        if ($old.PSObject.Properties.Name -contains 'speech_includes' -and $old.speech_includes) {
                            $inc = @{}
                            foreach ($ip in $old.speech_includes.PSObject.Properties) {
                                if ($ip.Value -is [bool]) { $inc[$ip.Name] = [bool]$ip.Value }
                            }
                            if ($inc.Count -gt 0) { $rebuilt['speech_includes'] = $inc }
                        }
                        $Assignments[$short] = $rebuilt
                        $restored += "${short}:*missing*"
                    }
                    # Per-field restoration on entries now present in both
                    # (either originally or via missing-entry restoration above).
                    foreach ($p in $parsed.assignments.PSObject.Properties) {
                        $short = $p.Name
                        if (-not $Assignments.ContainsKey($short)) { continue }
                        $old = $p.Value
                        $new = $Assignments[$short]
                        if (-not $new) { continue }
                        if ($old.label -and ([string]$old.label).Length -gt 0 -and (-not $new.label -or ([string]$new.label).Length -eq 0)) {
                            $new.label = [string]$old.label
                            $restored += "${short}:label"
                        }
                        if ($old.pinned -eq $true -and $new.pinned -ne $true) {
                            $new.pinned = $true
                            $restored += "${short}:pinned"
                        }
                        if ($old.voice -and -not $new.voice) {
                            $new.voice = [string]$old.voice
                            $restored += "${short}:voice"
                        }
                        if ($old.muted -eq $true -and $new.muted -ne $true) {
                            $new.muted = $true
                            $restored += "${short}:muted"
                        }
                        if ($old.focus -eq $true -and $new.focus -ne $true) {
                            $new.focus = $true
                            $restored += "${short}:focus"
                        }
                        if ($old.PSObject.Properties.Name -contains 'speech_includes' -and $old.speech_includes -and (-not $new.speech_includes -or $new.speech_includes.Count -eq 0)) {
                            $inc = @{}
                            foreach ($ip in $old.speech_includes.PSObject.Properties) {
                                if ($ip.Value -is [bool]) { $inc[$ip.Name] = [bool]$ip.Value }
                            }
                            if ($inc.Count -gt 0) {
                                $new['speech_includes'] = $inc
                                $restored += "${short}:speech_includes"
                            }
                        }
                    }
                }
            }
        } catch {
            # Best-effort — corrupt/locked file falls through to write.
        }
    }
    try {
        $tmp = "$RegistryPath.tmp"
        $jsonOut = (@{ assignments = $Assignments } | ConvertTo-Json -Depth 5)
        [IO.File]::WriteAllText($tmp, $jsonOut, [System.Text.UTF8Encoding]::new($false))
        Move-Item -Force $tmp $RegistryPath
        if ($LogPath) {
            $ts = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
            if ($restored.Count -gt 0) {
                $restoredList = $restored -join ','
                $guardLine = "$ts save-registry GUARD from=$Caller restored=[$restoredList]"
                try { Add-Content -Path $LogPath -Value $guardLine -ErrorAction SilentlyContinue } catch {}
            }
            $line = "$ts save-registry ok from=$Caller keys=$keys"
            try { Add-Content -Path $LogPath -Value $line -ErrorAction SilentlyContinue } catch {}
        }
    } catch {
        if ($LogPath) {
            $ts = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
            $err = $_.Exception.Message -replace "[\r\n]+"," "
            $line = "$ts save-registry fail from=$Caller err=$err"
            try { Add-Content -Path $LogPath -Value $line -ErrorAction SilentlyContinue } catch {}
        }
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
