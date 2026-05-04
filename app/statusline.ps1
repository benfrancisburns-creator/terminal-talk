# Terminal Talk statusline for Claude Code.
# Reads session context JSON from stdin, emits an ANSI-coloured glyph derived from a
# hash of the session ID. The Terminal Talk renderer uses the SAME hash to
# colour the queue dot, so your terminal's statusline glyph matches the dot.

$ErrorActionPreference = 'SilentlyContinue'
# Force UTF-8 stdout so the emoji survives Windows' default ANSI codepage.
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$ttHome = if ($env:TT_HOME) { $env:TT_HOME } else { Join-Path $env:USERPROFILE '.terminal-talk' }

$stdin = [Console]::In.ReadToEnd()
if (-not $stdin) { Write-Host ""; exit 0 }
try { $payload = $stdin | ConvertFrom-Json } catch { Write-Host ""; exit 0 }
$sessionId = $payload.session_id
if (-not $sessionId) { Write-Host ""; exit 0 }

# First 8 hex chars -- same slice the hook uses in filenames.
$short = $sessionId.Substring(0, [Math]::Min(8, $sessionId.Length))

# Z2-6: 100 ms file-level debounce.
# Claude Code can fire the statusline many times in quick succession while
# a single prompt is being typed. Every fire previously did a full
# Read-Registry -> Update-SessionAssignment -> Save-Registry cycle on a
# JSON file that can be hundreds of entries long. If two consecutive fires
# land inside 100 ms AND the registry file hasn't been touched between
# them (same mtime + length), we emit the last output verbatim and skip
# the whole cycle. PID-file and last_seen heartbeats miss one update every
# ~100 ms of rapid fire -- irrelevant because the next non-cached
# invocation catches up inside the same debounce window.
$sessionsDirEarly = Join-Path $ttHome 'sessions'
if (-not (Test-Path $sessionsDirEarly)) {
    New-Item -ItemType Directory -Path $sessionsDirEarly -Force | Out-Null
}
$registryPathEarly = if ($env:TT_REGISTRY_PATH) {
    $env:TT_REGISTRY_PATH
} else {
    Join-Path $ttHome 'session-colours.json'
}
$cachePath = Join-Path $sessionsDirEarly "$short.statusline-cache"
$regMtimeTicks = 0
$regLength = 0
if (Test-Path $registryPathEarly) {
    try {
        $regInfo = Get-Item $registryPathEarly -ErrorAction Stop
        $regMtimeTicks = $regInfo.LastWriteTimeUtc.Ticks
        $regLength = $regInfo.Length
    } catch {}
}
$nowTicks = (Get-Date).Ticks
# 100 ms = 1_000_000 ticks (1 tick = 100 ns).
$debounceTicks = 1000000
if (Test-Path $cachePath) {
    try {
        $cache = Get-Content $cachePath -Raw -Encoding utf8 | ConvertFrom-Json
        if ($cache.registry_mtime_ticks -eq $regMtimeTicks `
            -and $cache.registry_length -eq $regLength `
            -and ($nowTicks - [long]$cache.emitted_ticks) -lt $debounceTicks) {
            Write-Host $cache.output
            exit 0
        }
    } catch {}
}

# Load the shared session-registry module (Read-Registry /
# Touch-Or-Assign-Session / Write-Registry-Atomic / Write-SessionPidFile).
# Lives alongside this script in the installed `app/` directory.
Import-Module (Join-Path $PSScriptRoot 'session-registry.psm1') -Force -ErrorAction SilentlyContinue

# Track this session's Claude Code PID so hey-jarvis can map the foreground
# terminal back to a session. The statusline's parent = Claude Code CLI process.
$sessionsDir = Join-Path $ttHome 'sessions'
if (-not (Test-Path $sessionsDir)) { New-Item -ItemType Directory -Path $sessionsDir -Force | Out-Null }
try {
    # Walk up to the OUTERMOST claude.exe / node.exe ancestor — Claude Code
    # invokes statusLine via a worker child whose pid rotates per call, so
    # raw ParentProcessId is ephemeral and never matches across /clear.
    # Get-StableClaudePid finds the long-lived CLI pid that DOES survive,
    # which is what Update-SessionAssignment needs for PID-migration.
    $claudePid = if ($env:TT_FAKE_CLAUDE_PID) { [int]$env:TT_FAKE_CLAUDE_PID } else { Get-StableClaudePid }
    $nowSec = [DateTimeOffset]::Now.ToUnixTimeSeconds()
    Write-SessionPidFile -SessionsDir $sessionsDir -ClaudePid $claudePid -SessionId $sessionId -Short $short -Now $nowSec
} catch {}

# Fallback hash if all palette slots are in use.
$sum = 0
foreach ($ch in $short.ToCharArray()) { $sum += [int]$ch }

# Palette source of truth is app/lib/tokens.json. The renderer, generated
# palette CSS, settings swatches, and this Claude Code statusline all read the
# same BASE_COLOURS + split partner tables so statusline identity cannot drift
# from the toolbar.
function Read-PaletteTokens {
    $fallback = @{
        PaletteSize   = 24
        BaseColours   = @('ff5e5e', 'ffa726', 'ffd93d', '4ade80', '60a5fa', 'ee2bbd', 'c97b50', 'e0e0e0')
        HsplitPartner = @(3, 4, 5, 0, 1, 2, 7, 6)
        VsplitPartner = @(4, 5, 6, 7, 0, 1, 2, 3)
    }
    try {
        $tokensPath = Join-Path $PSScriptRoot 'lib\tokens.json'
        if (-not (Test-Path $tokensPath)) { return $fallback }
        $tokens = Get-Content -Path $tokensPath -Raw -Encoding utf8 | ConvertFrom-Json
        $palette = $tokens.palette
        $base = @($palette.BASE_COLOURS | ForEach-Object { ([string]$_).Trim().TrimStart('#') })
        $hsplit = @($palette.HSPLIT_PARTNER | ForEach-Object { [int]$_ })
        $vsplit = @($palette.VSPLIT_PARTNER | ForEach-Object { [int]$_ })
        $size = [int]$palette.PALETTE_SIZE
        if ($base.Count -lt 8 -or $hsplit.Count -lt 8 -or $vsplit.Count -lt 8 -or $size -lt 24) {
            return $fallback
        }
        return @{
            PaletteSize   = $size
            BaseColours   = $base
            HsplitPartner = $hsplit
            VsplitPartner = $vsplit
        }
    } catch {
        return $fallback
    }
}

$paletteTokens = Read-PaletteTokens
$paletteSize = [int]$paletteTokens.PaletteSize
$paletteHex = @($paletteTokens.BaseColours)
$hsplitPartner = @($paletteTokens.HsplitPartner)
$vsplitPartner = @($paletteTokens.VsplitPartner)

function _HexToRgb([string]$hex) {
    $h = ([string]$hex).Trim().TrimStart('#')
    if ($h -notmatch '^[a-fA-F0-9]{6}$') { $h = '8a8a8a' }
    "$([Convert]::ToInt32($h.Substring(0,2),16));$([Convert]::ToInt32($h.Substring(2,2),16));$([Convert]::ToInt32($h.Substring(4,2),16))"
}

# Emit an ANSI-coloured glyph for the palette slot. Post-v0.5 (option C):
#   - Solid (0-7):   ● with 24-bit fg = palette[idx]
#   - Hsplit (8-15): ▀ with fg = primary, bg = secondary (upper half primary,
#                    lower half secondary — top/bottom, matching CSS)
#   - Vsplit (16-23): ▌ with fg = primary, bg = secondary (left-half primary,
#                     right-half secondary — left/right, matching CSS)
# Replaces the legacy two-emoji concat for splits which rendered as two
# glyphs in the terminal and couldn't convey the pairing visually.
function Get-StatuslineGlyph($idx) {
    $i = $idx % $paletteSize
    if ($i -lt 0) { $i += $paletteSize }
    $ESC = [char]27
    if ($i -lt 8) {
        $rgb = _HexToRgb $paletteHex[$i]
        return "${ESC}[38;2;${rgb}m●${ESC}[0m"
    } elseif ($i -lt 16) {
        $p = $i - 8
        $s = $hsplitPartner[$p]
        $fg = _HexToRgb $paletteHex[$p]
        $bg = _HexToRgb $paletteHex[$s]
        return "${ESC}[38;2;${fg};48;2;${bg}m▀${ESC}[0m"
    } else {
        $p = $i - 16
        $s = $vsplitPartner[$p]
        $fg = _HexToRgb $paletteHex[$p]
        $bg = _HexToRgb $paletteHex[$s]
        return "${ESC}[38;2;${fg};48;2;${bg}m▌${ESC}[0m"
    }
}

# --- Stateful colour registry ---
# ~/.terminal-talk/session-colours.json maps session_short -> { index, claude_pid, label, ... }.
# On first-call for a session we pick the lowest index NOT currently in use by
# another LIVE session. Entries are freed only when their claude_pid is dead
# (terminal closed), so a long-idle session keeps its colour.
$registryPath = if ($env:TT_REGISTRY_PATH) { $env:TT_REGISTRY_PATH } else { Join-Path $ttHome 'session-colours.json' }
$now = [DateTimeOffset]::Now.ToUnixTimeSeconds()

# Parent PID of this statusline script = Claude Code CLI process.
# TT_FAKE_CLAUDE_PID is a test-only knob so the run-tests.cjs harness
# can drive multiple spawnSync invocations with distinct logical pids
# (they'd otherwise share the test runner's pid and trigger the /clear
# PID-migration path in Update-SessionAssignment). Never set in prod.
$claudePid = 0
try {
    # Same outermost-CLI walk as the Write-SessionPidFile block above —
    # see Get-StableClaudePid in session-registry.psm1 for why the raw
    # ParentProcessId is unstable for statusLine invocations.
    $claudePid = if ($env:TT_FAKE_CLAUDE_PID) { [int]$env:TT_FAKE_CLAUDE_PID } else { Get-StableClaudePid }
} catch {}

function Test-ProcessAlive($p) {
    if (-not $p -or $p -le 0) { return $false }
    try { return [bool](Get-Process -Id $p -ErrorAction SilentlyContinue) } catch { return $false }
}

function Sanitise-LaunchLabel([string]$Value) {
    if (-not $Value) { return '' }
    $clean = ($Value -replace '[\r\n\t]', ' ').Trim()
    if ($clean.Length -gt 60) { return $clean.Substring(0, 60) }
    return $clean
}

function Clamp-LaunchIndex([string]$Value) {
    $n = -1
    if (-not [int]::TryParse($Value, [ref]$n)) { return -1 }
    if ($n -lt 0) { return -1 }
    if ($n -gt 23) { return 23 }
    return $n
}

function Apply-ToolbarLaunchIntent([hashtable]$Assignments, [string]$Short) {
    if (-not $Assignments -or -not $Assignments.ContainsKey($Short)) { return }
    $label = Sanitise-LaunchLabel $env:TT_LAUNCH_LABEL
    $index = Clamp-LaunchIndex $env:TT_LAUNCH_INDEX
    if (-not $label -and $index -lt 0) { return }

    $entry = $Assignments[$Short]
    $marker = ''
    if ($env:TT_LAUNCH_TOKEN) { $marker = "toolbar-launch:$($env:TT_LAUNCH_TOKEN)" }
    if ($marker -and $entry.ContainsKey('source_originator') -and $entry.source_originator -eq $marker) { return }

    if ($label) {
        $entry.label = $label
        if ($entry.ContainsKey('auto_label')) { [void]$entry.Remove('auto_label') }
    }
    if ($index -ge 0) {
        $entry.index = [int]$index
    }
    $entry.pinned = $true
    $entry.source_kind = 'toolbar-launch'
    $entry.source_label = 'Claude Code'
    if ($marker) { $entry.source_originator = $marker }
}

# Read, touch/assign, write back -- all via the shared module so statusline
# and the two Stop/PreToolUse hooks are guaranteed to use identical logic.
# The Read-Update-Save triplet must be lock-guarded as a whole -- the
# Electron toolbar can be mid-write during the window between Read and
# Save, and saving stale state stomps the user's Settings change. Lock
# semantics mirror app/lib/registry-lock.js (3 s stale, 500 ms acquire
# timeout, 15 ms poll backoff).
$locked = Enter-RegistryLock -RegistryPath $registryPath
$registryLogPath = Join-Path $ttHome 'queue\_hook.log'
try {
    if ($locked) {
        # Lock held — safe to do the full Read-Update-Save triplet.
        $assignments = Read-Registry -RegistryPath $registryPath
        # #6 G4 — pass -LogPath + -Caller so Update-SessionAssignment
        # emits its branch tag (existing-hit / pid-migration / fresh-
        # alloc / lru-evict / hash-collision). Makes #8-class identity-
        # migration bugs diagnosable from logs alone.
        $idx = Update-SessionAssignment -Assignments $assignments -Short $short `
                                         -SessionId $sessionId -ClaudePid $claudePid -Now $now `
                                         -LogPath $registryLogPath -Caller 'statusline'
        Apply-ToolbarLaunchIntent -Assignments $assignments -Short $short
        # #6 G1 + G3 — attribute every save + log to _hook.log so wipe-class
        # bugs (#8) have a writer-by-writer trail.
        Save-Registry -RegistryPath $registryPath -Assignments $assignments `
                      -Caller 'statusline' -LogPath $registryLogPath
    } else {
        # #8 — lock acquisition timed out (another writer held it longer
        # than LockAcquireMs = 500ms). Prior to this fix we fell through
        # and did an UNLOCKED Read-Update-Save. Read-Registry can read
        # the file mid-rename and come back empty; Save-Registry then
        # writes ONLY this terminal's entry, wiping the other terminal's
        # labels / pinned / overrides. Empirical evidence: _hook.log
        # showed repeated `save-registry ok from=statusline keys=1`
        # lines where there should be 2, correlating with the wipe.
        #
        # Correct behaviour: read WITHOUT writing so we still have
        # accurate data for the glyph/label display, then skip the
        # save. Next statusline fire will retry the lock.
        $assignments = Read-Registry -RegistryPath $registryPath
        if ($assignments.ContainsKey($short)) {
            $idx = [int]$assignments[$short].index
        } else {
            # No existing entry + no lock to allocate safely. Pick a
            # stable hash-based index for display only; do NOT persist.
            $sum = 0
            foreach ($ch in $short.ToCharArray()) { $sum += [int]$ch }
            $idx = $sum % 24
        }
        $ts = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
        try {
            Add-Content -Path $registryLogPath `
                        -Value "$ts save-registry skip from=statusline reason=lock-timeout short=$short" `
                        -ErrorAction SilentlyContinue
        } catch {}
    }
} finally {
    if ($locked) { Exit-RegistryLock -RegistryPath $registryPath }
}

$emoji = Get-StatuslineGlyph $idx
$label = $assignments[$short].label
# Prefixes give users an at-a-glance signal of state:
#   🔇 muted   ⭐ focus (its clips play first)
# Both can appear -- muted + focus means "still focused but silenced",
# which is an unusual combo but valid.
$mutedPrefix = if ($assignments[$short].muted) { [char]::ConvertFromUtf32(0x1F507) + ' ' } else { '' }
$focusPrefix = if ($assignments[$short].focus) { [char]::ConvertFromUtf32(0x2B50) + ' ' } else { '' }
$prefix = "$focusPrefix$mutedPrefix"
$output = if ($label) { "$prefix$emoji $label" } else { "$prefix$emoji" }
Write-Host $output

# Z2-6: persist the cache so the next invocation inside the 100 ms debounce
# window can skip this whole pipeline. Update mtime+length AFTER Save-Registry
# because the registry file we just wrote is the one the cache guard tests.
try {
    $regMtimeTicksAfter = 0
    $regLengthAfter = 0
    if (Test-Path $registryPathEarly) {
        $info = Get-Item $registryPathEarly -ErrorAction Stop
        $regMtimeTicksAfter = $info.LastWriteTimeUtc.Ticks
        $regLengthAfter = $info.Length
    }
    $cacheObj = [ordered]@{
        registry_mtime_ticks = $regMtimeTicksAfter
        registry_length = $regLengthAfter
        emitted_ticks = (Get-Date).Ticks
        output = $output
    }
    $cacheJson = $cacheObj | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($cachePath, $cacheJson, [System.Text.UTF8Encoding]::new($false))
} catch {}
