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
    $claudePid = [int](Get-CimInstance Win32_Process -Filter "ProcessId=$myPid").ParentProcessId
    $nowSec = [long][double]::Parse((Get-Date -UFormat %s))
    Write-SessionPidFile -SessionsDir $sessionsDir -ClaudePid $claudePid -SessionId $sessionId -Short $short -Now $nowSec
} catch {}

# Fallback hash if all palette slots are in use.
$sum = 0
foreach ($ch in $short.ToCharArray()) { $sum += [int]$ch }

# Emoji code points: red, orange, yellow, green, blue, purple, brown, white.
$codepoints = @(0x1F534, 0x1F7E0, 0x1F7E1, 0x1F7E2, 0x1F535, 0x1F7E3, 0x1F7E4, 0x26AA)
# 24 arrangement slots: 0-7 solid / 8-15 hsplit / 16-23 vsplit.
# Must stay in lock-step with arrangementForIndex() in app/renderer.js.
$paletteSize = 24
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
$now = [long][double]::Parse((Get-Date -UFormat %s))

# Parent PID of this statusline script = Claude Code CLI process.
$claudePid = 0
try {
    $claudePid = [int](Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
} catch {}

function Test-ProcessAlive($p) {
    if (-not $p -or $p -le 0) { return $false }
    try { return [bool](Get-Process -Id $p -ErrorAction SilentlyContinue) } catch { return $false }
}

# Read, touch/assign, write back -- all via the shared module so statusline
# and the two Stop/PreToolUse hooks are guaranteed to use identical logic.
$assignments = Read-Registry -RegistryPath $registryPath
$idx = Update-SessionAssignment -Assignments $assignments -Short $short `
                                 -SessionId $sessionId -ClaudePid $claudePid -Now $now
Save-Registry -RegistryPath $registryPath -Assignments $assignments

$emoji = Get-EmojiForIndex $idx
$label = $assignments[$short].label
# Prefixes give users an at-a-glance signal of state:
#   🔇 muted   ⭐ focus (its clips play first)
# Both can appear -- muted + focus means "still focused but silenced",
# which is an unusual combo but valid.
$mutedPrefix = if ($assignments[$short].muted) { [char]::ConvertFromUtf32(0x1F507) + ' ' } else { '' }
$focusPrefix = if ($assignments[$short].focus) { [char]::ConvertFromUtf32(0x2B50) + ' ' } else { '' }
$prefix = "$focusPrefix$mutedPrefix"
if ($label) { Write-Host "$prefix$emoji $label" } else { Write-Host "$prefix$emoji" }
