$ErrorActionPreference = 'SilentlyContinue'

# PreToolUse hook — streaming mid-response TTS.
#
# Fires before every tool invocation. Spawns synth_turn.py detached, which
# reads the transcript, extracts any NEW assistant text since last run,
# and synthesises it in parallel. This is what lets audio start playing
# while Claude is still working — the user hears the "what I'm about to do"
# commentary while the tool runs.
#
# Exits immediately (~150 ms) so Claude Code is NOT blocked waiting for
# synthesis. The detached Python process does the heavy lifting.

$ttHome = Join-Path $env:USERPROFILE '.terminal-talk'
$queueDir = Join-Path $ttHome 'queue'
$synthScript = Join-Path $ttHome 'app\synth_turn.py'
$logFile = Join-Path $queueDir '_hook.log'

try {
    if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 1048576)) {
        Move-Item -Force $logFile "$logFile.1"
    }
} catch {}

function Log($m) {
    try { "$(Get-Date -Format 'HH:mm:ss.fff') [on-tool] $m" | Out-File $logFile -Append -Encoding utf8 } catch {}
}
Log "===== fired ====="

$stdin = [Console]::In.ReadToEnd()
if (-not $stdin) { Log "EXIT: no stdin"; exit 0 }

try { $payload = $stdin | ConvertFrom-Json } catch { Log "EXIT: JSON parse fail"; exit 0 }
$transcript = $payload.transcript_path
$sessionIdFromPayload = $payload.session_id
if ($transcript -match '^/([a-zA-Z])/(.+)$') {
    $transcript = $Matches[1].ToUpper() + ':\' + ($Matches[2] -replace '/', '\')
}
if (-not $transcript -or -not (Test-Path $transcript)) { Log "EXIT: transcript missing: $transcript"; exit 0 }

# Session id: prefer payload.session_id (authoritative), fallback to transcript filename.
$sessionId = if ($sessionIdFromPayload) { [string]$sessionIdFromPayload } else { [IO.Path]::GetFileNameWithoutExtension($transcript) }
$sessionShort = if ($sessionId -and $sessionId.Length -ge 8) { $sessionId.Substring(0, 8).ToLower() } else { $sessionId }
if (-not ($sessionShort -match '^[a-f0-9]{8}$')) {
    Log "EXIT: invalid sessionShort '$sessionShort'"
    exit 0
}

# --- Session registry refresh (parallels speak-response.ps1 lines 31-137) ---
# Keeping this in PreToolUse means the toolbar learns about a session as soon
# as it starts using tools, not only when the first Stop hook fires.
$claudePid = 0
try { $claudePid = [int](Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId } catch {}

$registryPath = Join-Path $ttHome 'session-colours.json'
$sessionsDir = Join-Path $ttHome 'sessions'
if (-not (Test-Path $sessionsDir)) { New-Item -ItemType Directory -Path $sessionsDir -Force | Out-Null }
$now = [long][double]::Parse((Get-Date -UFormat %s))
$graceSec = 300
$paletteSize = 24  # matches app/renderer.js PALETTE_SIZE

$assignments = @{}
if (Test-Path $registryPath) {
    try {
        $parsed = Get-Content $registryPath -Raw -Encoding utf8 | ConvertFrom-Json
        if ($parsed.assignments) {
            foreach ($p in $parsed.assignments.PSObject.Properties) {
                $entry = @{
                    index = [int]$p.Value.index
                    session_id = [string]$p.Value.session_id
                    claude_pid = if ($p.Value.claude_pid) { [int]$p.Value.claude_pid } else { 0 }
                    label = if ($p.Value.label) { [string]$p.Value.label } else { '' }
                    pinned = if ($p.Value.pinned) { [bool]$p.Value.pinned } else { $false }
                    muted = ($p.Value.PSObject.Properties.Name -contains 'muted') -and ($p.Value.muted -eq $true)
                    last_seen = [long]$p.Value.last_seen
                }
                if ($p.Value.PSObject.Properties.Name -contains 'voice' -and $p.Value.voice) {
                    $entry['voice'] = [string]$p.Value.voice
                }
                if ($p.Value.PSObject.Properties.Name -contains 'speech_includes' -and $p.Value.speech_includes) {
                    $inc2 = @{}
                    foreach ($ip in $p.Value.speech_includes.PSObject.Properties) {
                        if ($ip.Value -is [bool]) { $inc2[$ip.Name] = [bool]$ip.Value }
                    }
                    $entry['speech_includes'] = $inc2
                }
                $assignments[$p.Name] = $entry
            }
        }
    } catch {}
}

# Touch current session to survive the prune pass.
if ($assignments.ContainsKey($sessionShort)) {
    $assignments[$sessionShort].last_seen = $now
    $assignments[$sessionShort].claude_pid = $claudePid
    $assignments[$sessionShort].session_id = $sessionId
}

# Prune: alive PID, fresh last_seen, or pinned keeps the slot.
$busy = @{}
foreach ($key in @($assignments.Keys)) {
    $entry = $assignments[$key]
    $alive = try { [bool](Get-Process -Id $entry.claude_pid -ErrorAction SilentlyContinue) } catch { $false }
    $fresh = ($now - $entry.last_seen) -lt $graceSec
    if ($alive -or $fresh -or $entry.pinned) { $busy[[int]$entry.index] = $true }
    else { $assignments.Remove($key) }
}

# Assign new session if not already present.
if (-not $assignments.ContainsKey($sessionShort)) {
    $idx = $null
    for ($i = 0; $i -lt $paletteSize; $i++) {
        if (-not $busy.ContainsKey($i)) { $idx = $i; break }
    }
    if ($null -eq $idx) {
        $sum = 0
        foreach ($ch in $sessionShort.ToCharArray()) { $sum += [int]$ch }
        $idx = $sum % $paletteSize
    }
    $assignments[$sessionShort] = @{
        index = [int]$idx
        session_id = $sessionId
        claude_pid = $claudePid
        label = ''
        pinned = $false
        last_seen = $now
    }
}

try {
    $tmp = "$registryPath.tmp"
    $jsonOut = (@{ assignments = $assignments } | ConvertTo-Json -Depth 5)
    [IO.File]::WriteAllText($tmp, $jsonOut, [System.Text.UTF8Encoding]::new($false))
    Move-Item -Force $tmp $registryPath
} catch { Log "registry write fail: $($_.Exception.Message)" }

# Per-PID session file so hey-jarvis can map foreground window → session.
if ($claudePid) {
    $sessionFile = Join-Path $sessionsDir "$claudePid.json"
    $jsonOut = @{ session_id = $sessionId; short = $sessionShort; claude_pid = $claudePid; ts = $now } | ConvertTo-Json -Compress
    $tmp = "$sessionFile.tmp"
    [IO.File]::WriteAllText($tmp, $jsonOut, [System.Text.UTF8Encoding]::new($false))
    Move-Item -Force $tmp $sessionFile
}

# --- Spawn detached synth process ---
# Start-Process returns immediately; the Python process runs in the background.
# Claude Code is NOT blocked waiting for edge-tts.
if (-not (Test-Path $synthScript)) {
    Log "synth script missing: $synthScript"
    exit 0
}

try {
    $args = @(
        '-u',
        $synthScript,
        '--session', $sessionId,
        '--transcript', $transcript,
        '--mode', 'on-tool'
    )
    Start-Process -FilePath 'python' -ArgumentList $args -WindowStyle Hidden -WorkingDirectory $ttHome
    Log "spawned synth for $sessionShort"
} catch {
    Log "spawn failed: $($_.Exception.Message)"
}
exit 0
