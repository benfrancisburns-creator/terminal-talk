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

# Track this session's Claude Code PID so hey-jarvis can map the foreground
# terminal back to a session. The statusline's parent = Claude Code CLI process.
try {
    $sessionsDir = Join-Path $env:USERPROFILE '.terminal-talk\sessions'
    if (-not (Test-Path $sessionsDir)) { New-Item -ItemType Directory -Path $sessionsDir -Force | Out-Null }
    $myPid = $PID
    $claudePid = (Get-CimInstance Win32_Process -Filter "ProcessId=$myPid").ParentProcessId
    if ($claudePid) {
        $sessionFile = Join-Path $sessionsDir "$claudePid.json"
        $jsonOut = @{ session_id = $sessionId; short = $short; claude_pid = $claudePid; ts = [int][double]::Parse((Get-Date -UFormat %s)) } | ConvertTo-Json -Compress
        $tmp = "$sessionFile.tmp"
        [IO.File]::WriteAllText($tmp, $jsonOut, [System.Text.UTF8Encoding]::new($false))
        Move-Item -Force $tmp $sessionFile
    }
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

$assignments = @{}
if (Test-Path $registryPath) {
    try {
        $raw = Get-Content $registryPath -Raw -Encoding utf8
        if ($raw) {
            $parsed = $raw | ConvertFrom-Json
            if ($parsed.assignments) {
                foreach ($p in $parsed.assignments.PSObject.Properties) {
                    $entry = @{
                        index      = [int]$p.Value.index
                        session_id = [string]$p.Value.session_id
                        claude_pid = if ($p.Value.claude_pid) { [int]$p.Value.claude_pid } else { 0 }
                        label      = if ($p.Value.label) { [string]$p.Value.label } else { '' }
                        pinned     = if ($p.Value.pinned) { [bool]$p.Value.pinned } else { $false }
                        last_seen  = [long]$p.Value.last_seen
                    }
                    # Preserve per-session overrides through every read/write cycle.
                    if ($p.Value.PSObject.Properties.Name -contains 'voice' -and $p.Value.voice) {
                        $entry['voice'] = [string]$p.Value.voice
                    }
                    if ($p.Value.PSObject.Properties.Name -contains 'speech_includes' -and $p.Value.speech_includes) {
                        $inc = @{}
                        foreach ($ip in $p.Value.speech_includes.PSObject.Properties) {
                            if ($ip.Value -is [bool]) { $inc[$ip.Name] = [bool]$ip.Value }
                        }
                        $entry['speech_includes'] = $inc
                    }
                    $assignments[$p.Name] = $entry
                }
            }
        }
    } catch {}
}

# Long grace so idle terminals don't lose their colour. Slots recycle only
# when the terminal actually closes (PID dies) AND the entry hasn't been
# touched in 4 hours.
$graceSec = 14400
$idx = $null

# Step 1: if this session's entry already exists, touch it FIRST so it survives
# the prune pass below even when its previous claude_pid has since died.
if ($assignments.ContainsKey($short)) {
    $assignments[$short].last_seen = $now
    $assignments[$short].session_id = $sessionId
    $assignments[$short].claude_pid = $claudePid
    $idx = $assignments[$short].index
}

# Step 2: prune stale entries. Session is LIVE if claude_pid is alive, OR
# last_seen is within the grace window (covers the period between PID updates).
$busy = @{}
foreach ($key in @($assignments.Keys)) {
    $entry = $assignments[$key]
    $alive = Test-ProcessAlive $entry.claude_pid
    $fresh = ($now - $entry.last_seen) -lt $graceSec
    if ($alive -or $fresh -or $entry.pinned) {
        $busy[[int]$entry.index] = $true
    } else {
        $assignments.Remove($key)
    }
}

# Step 3: if this session is new, assign the lowest free index.
if ($null -eq $idx) {
    for ($i = 0; $i -lt $paletteSize; $i++) {
        if (-not $busy.ContainsKey($i)) { $idx = $i; break }
    }
    if ($null -eq $idx) { $idx = $sum % $paletteSize }
    $assignments[$short] = @{
        index      = [int]$idx
        session_id = $sessionId
        claude_pid = $claudePid
        label      = ''
        pinned     = $false
        last_seen  = $now
    }
}

# Save registry atomically. Use UTF-8 NO BOM so JSON.parse in main.js works.
try {
    $tmp = "$registryPath.tmp"
    $jsonOut = (@{ assignments = $assignments } | ConvertTo-Json -Depth 5)
    [IO.File]::WriteAllText($tmp, $jsonOut, [System.Text.UTF8Encoding]::new($false))
    Move-Item -Force $tmp $registryPath
} catch {}

$emoji = Get-EmojiForIndex $idx
$label = $assignments[$short].label
if ($label) { Write-Host "$emoji $label" } else { Write-Host $emoji }
