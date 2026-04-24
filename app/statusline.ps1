# Terminal Talk statusline for Claude Code.
# Reads session context JSON from stdin, emits an emoji circle derived from a
# hash of the session ID. The Terminal Talk renderer uses the SAME hash to
# colour the queue dot, so your terminal's statusline emoji matches the dot.

$ErrorActionPreference = 'SilentlyContinue'
# Force UTF-8 stdout so the emoji survives Windows' default ANSI codepage.
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

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
$sessionsDirEarly = Join-Path $env:USERPROFILE '.terminal-talk\sessions'
if (-not (Test-Path $sessionsDirEarly)) {
    New-Item -ItemType Directory -Path $sessionsDirEarly -Force | Out-Null
}
$registryPathEarly = if ($env:TT_REGISTRY_PATH) {
    $env:TT_REGISTRY_PATH
} else {
    Join-Path $env:USERPROFILE '.terminal-talk\session-colours.json'
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
$sessionsDir = Join-Path $env:USERPROFILE '.terminal-talk\sessions'
if (-not (Test-Path $sessionsDir)) { New-Item -ItemType Directory -Path $sessionsDir -Force | Out-Null }
try {
    $myPid = $PID
    $claudePid = if ($env:TT_FAKE_CLAUDE_PID) { [int]$env:TT_FAKE_CLAUDE_PID } else {
        [int](Get-CimInstance Win32_Process -Filter "ProcessId=$myPid").ParentProcessId
    }
    $nowSec = [DateTimeOffset]::Now.ToUnixTimeSeconds()
    Write-SessionPidFile -SessionsDir $sessionsDir -ClaudePid $claudePid -SessionId $sessionId -Short $short -Now $nowSec
} catch {}

# Fallback hash if all palette slots are in use.
$sum = 0
foreach ($ch in $short.ToCharArray()) { $sum += [int]$ch }

# Palette hex (matches BASE_COLOURS in app/lib/tokens.json exactly —
# red / orange / yellow / green / blue / magenta / brown / white).
# Output uses ANSI 24-bit colour for exact parity with the toolbar
# dots (`palette-classes.css`), so a session's statusline glyph looks
# the same colour as its dot instead of drifting via emoji-font variance.
$paletteHex = @('ff5e5e', 'ffa726', 'ffd93d', '4ade80', '60a5fa', 'ee2bbd', 'c97b50', 'e0e0e0')

# 24 arrangement slots: 0-7 solid / 8-15 hsplit / 16-23 vsplit.
# Must stay in lock-step with arrangementForIndex() in app/renderer.js.
# Same partner tables as renderer.js -- complementary pairings for splits.
$hsplitPartner = @(3, 4, 5, 0, 1, 2, 7, 6)
$vsplitPartner = @(4, 5, 6, 7, 0, 1, 2, 3)

function _HexToRgb([string]$hex) {
    "$([Convert]::ToInt32($hex.Substring(0,2),16));$([Convert]::ToInt32($hex.Substring(2,2),16));$([Convert]::ToInt32($hex.Substring(4,2),16))"
}

# Emit an ANSI-coloured glyph for the palette slot. Post-v0.5 (option C):
#   - Solid (0-7):   ● with 24-bit fg = palette[idx]
#   - Hsplit (8-15): ▌ with fg = primary, bg = secondary (left-half primary,
#                    right-half secondary — one char wide, zero rendering gap)
#   - Vsplit (16-23): ▀ with fg = primary, bg = secondary (upper half primary,
#                     lower half secondary — also one char wide)
# Replaces the legacy two-emoji concat for splits which rendered as two
# glyphs in the terminal and couldn't convey the pairing visually.
function Get-StatuslineGlyph($idx) {
    $i = $idx % 24
    if ($i -lt 0) { $i += 24 }
    $ESC = [char]27
    if ($i -lt 8) {
        $rgb = _HexToRgb $paletteHex[$i]
        return "${ESC}[38;2;${rgb}m●${ESC}[0m"
    } elseif ($i -lt 16) {
        $p = $i - 8
        $s = $hsplitPartner[$p]
        $fg = _HexToRgb $paletteHex[$p]
        $bg = _HexToRgb $paletteHex[$s]
        return "${ESC}[38;2;${fg};48;2;${bg}m▌${ESC}[0m"
    } else {
        $p = $i - 16
        $s = $vsplitPartner[$p]
        $fg = _HexToRgb $paletteHex[$p]
        $bg = _HexToRgb $paletteHex[$s]
        return "${ESC}[38;2;${fg};48;2;${bg}m▀${ESC}[0m"
    }
}

# --- Stateful colour registry ---
# ~/.terminal-talk/session-colours.json maps session_short -> { index, claude_pid, label, ... }.
# On first-call for a session we pick the lowest index NOT currently in use by
# another LIVE session. Entries are freed only when their claude_pid is dead
# (terminal closed), so a long-idle session keeps its colour.
$registryPath = if ($env:TT_REGISTRY_PATH) { $env:TT_REGISTRY_PATH } else { Join-Path $env:USERPROFILE '.terminal-talk\session-colours.json' }
$now = [DateTimeOffset]::Now.ToUnixTimeSeconds()

# Parent PID of this statusline script = Claude Code CLI process.
# TT_FAKE_CLAUDE_PID is a test-only knob so the run-tests.cjs harness
# can drive multiple spawnSync invocations with distinct logical pids
# (they'd otherwise share the test runner's pid and trigger the /clear
# PID-migration path in Update-SessionAssignment). Never set in prod.
$claudePid = 0
try {
    $claudePid = if ($env:TT_FAKE_CLAUDE_PID) { [int]$env:TT_FAKE_CLAUDE_PID } else {
        [int](Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
    }
} catch {}

function Test-ProcessAlive($p) {
    if (-not $p -or $p -le 0) { return $false }
    try { return [bool](Get-Process -Id $p -ErrorAction SilentlyContinue) } catch { return $false }
}

# Read, touch/assign, write back -- all via the shared module so statusline
# and the two Stop/PreToolUse hooks are guaranteed to use identical logic.
# The Read-Update-Save triplet must be lock-guarded as a whole -- the
# Electron toolbar can be mid-write during the window between Read and
# Save, and saving stale state stomps the user's Settings change. Lock
# semantics mirror app/lib/registry-lock.js (3 s stale, 500 ms acquire
# timeout, 15 ms poll backoff).
$locked = Enter-RegistryLock -RegistryPath $registryPath
try {
    $assignments = Read-Registry -RegistryPath $registryPath
    $idx = Update-SessionAssignment -Assignments $assignments -Short $short `
                                     -SessionId $sessionId -ClaudePid $claudePid -Now $now
    # #6 G1 + G3 — attribute every save + log to _hook.log so wipe-class
    # bugs (#8) have a writer-by-writer trail. Log path mirrors the
    # convention used by the hook scripts.
    $registryLogPath = Join-Path $env:USERPROFILE '.terminal-talk\queue\_hook.log'
    Save-Registry -RegistryPath $registryPath -Assignments $assignments `
                  -Caller 'statusline' -LogPath $registryLogPath
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
