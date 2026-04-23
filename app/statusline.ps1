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

# Emoji code points: red, orange, yellow, green, blue, purple, brown, white.
$codepoints = @(0x1F534, 0x1F7E0, 0x1F7E1, 0x1F7E2, 0x1F535, 0x1F7E3, 0x1F7E4, 0x26AA)
# 24 arrangement slots: 0-7 solid / 8-15 hsplit / 16-23 vsplit.
# Must stay in lock-step with arrangementForIndex() in app/renderer.js.
# Same partner tables as renderer.js -- complementary pairings for split arrangements.
$hsplitPartner = @(3, 4, 5, 0, 1, 2, 7, 6)
$vsplitPartner = @(4, 5, 6, 7, 0, 1, 2, 3)

function Get-EmojiForIndex($idx) {
    $i = $idx % 24
    if ($i -lt 0) { $i += 24 }
    if ($i -lt 8) {
        return [char]::ConvertFromUtf32($codepoints[$i])
    } elseif ($i -lt 16) {
        $p = $i - 8
        $s = $hsplitPartner[$p]
        return [char]::ConvertFromUtf32($codepoints[$p]) + [char]::ConvertFromUtf32($codepoints[$s])
    } else {
        $p = $i - 16
        $s = $vsplitPartner[$p]
        return [char]::ConvertFromUtf32($codepoints[$p]) + [char]::ConvertFromUtf32($codepoints[$s])
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
    Save-Registry -RegistryPath $registryPath -Assignments $assignments
} finally {
    if ($locked) { Exit-RegistryLock -RegistryPath $registryPath }
}

$emoji = Get-EmojiForIndex $idx
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
