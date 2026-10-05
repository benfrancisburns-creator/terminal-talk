$ErrorActionPreference = 'SilentlyContinue'

# PreToolUse hook -- streaming mid-response TTS.
#
# Fires before every tool invocation. Spawns synth_turn.py detached, which
# reads the transcript, extracts any NEW assistant text since last run,
# and synthesises it in parallel. This is what lets audio start playing
# while Claude is still working -- the user hears the "what I'm about to do"
# commentary while the tool runs.
#
# Exits immediately (~150 ms) so Claude Code is NOT blocked waiting for
# synthesis. The detached Python process does the heavy lifting.

$ttHome = if ($env:TT_HOME) { $env:TT_HOME } else { Join-Path $env:USERPROFILE '.terminal-talk' }
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
$registryPath = Join-Path $ttHome 'session-colours.json'
$sessionsDir = Join-Path $ttHome 'sessions'
if (-not (Test-Path $sessionsDir)) { New-Item -ItemType Directory -Path $sessionsDir -Force | Out-Null }
$now = [long][double]::Parse((Get-Date -UFormat %s))

# Shared session-registry module -- canonical Read / Touch-Or-Assign /
# Write-Atomic + per-PID stamp. Replaces ~80 lines of logic that used
# to be duplicated here AND in speak-response.ps1 AND in statusline.ps1.
Import-Module (Join-Path $ttHome 'app\session-registry.psm1') -Force -ErrorAction SilentlyContinue

# Walk up to the long-lived claude.exe pid that survives /clear. Raw
# ParentProcessId would be the per-invocation PowerShell host pid,
# which never matches across /clear and breaks PID-migration. See
# Get-StableClaudePid doc in session-registry.psm1.
$claudePid = 0
try { $claudePid = if ($env:TT_FAKE_CLAUDE_PID) { [int]$env:TT_FAKE_CLAUDE_PID } else { Get-StableClaudePid } } catch {}

# Read-Update-Save must be lock-guarded as a whole -- the Electron toolbar
# can be mid-write during the window between Read and Save, and without
# the lock this write would stomp the user's colour/label/mute change.
# Lock semantics mirror app/lib/registry-lock.js.
$locked = Enter-RegistryLock -RegistryPath $registryPath
try {
    if ($locked) {
        $assignments = Read-Registry -RegistryPath $registryPath
        # #6 G4 — branch-tag log emitted by Update-SessionAssignment.
        $null = Update-SessionAssignment -Assignments $assignments -Short $sessionShort `
                                          -SessionId $sessionId -ClaudePid $claudePid -Now $now `
                                          -LogPath $logFile -Caller 'speak-on-tool'
        # #6 G1 + G3 — writer attribution. speak-on-tool fires on PreToolUse,
        # so tagging its writes distinguishes pre-tool saves from statusline-
        # triggered saves + the two speak-response (Stop/Notification) writers.
        Save-Registry -RegistryPath $registryPath -Assignments $assignments `
                      -Caller 'speak-on-tool' -LogPath $logFile
    } else {
        # #8 — see detailed rationale in app/statusline.ps1. Lock fail
        # → skip the write. The speak-on-tool hook's other side-effects
        # (spawning the synth process below) do not depend on the
        # registry write, so this is safe.
        $ts = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
        try {
            Add-Content -Path $logFile `
                        -Value "$ts save-registry skip from=speak-on-tool reason=lock-timeout short=$sessionShort" `
                        -ErrorAction SilentlyContinue
        } catch {}
    }
} finally {
    if ($locked) { Exit-RegistryLock -RegistryPath $registryPath }
}
Write-SessionPidFile -SessionsDir $sessionsDir -ClaudePid $claudePid `
                      -SessionId $sessionId -Short $sessionShort -Now $now

# Refresh the -working.flag timestamp. mark-working.ps1 stamps the flag
# on UserPromptSubmit and speak-response.ps1 deletes it on Stop — but
# long turns (> 10 min between prompt and Stop) let the flag age past
# get-working-sessions' STALE_SEC=600 cutoff, so heartbeat stops firing
# even though Claude is still actively tool-calling. Each PreToolUse
# bumps mtime so heartbeat sees the session as fresh.
#
# CRITICAL: only touch mtime — don't rewrite content. The content is the
# turn-start epoch read by speak-response (Stop) to compute elapsedSec
# for the "Cogitated for X" footer clip. Rewriting it on each tool use
# resets the apparent turn duration to "since the last tool call" — so
# a 9-minute turn with tool calls every 10 s spoke "Cogitated for 9 s"
# instead of "Cogitated for 9 minutes". get-working-sessions in
# app/lib/ipc-handlers.js reads mtime for staleness, so this stays
# heartbeat-safe.
try {
    $flagPath = Join-Path $sessionsDir "$sessionShort-working.flag"
    $item = Get-Item -LiteralPath $flagPath -ErrorAction SilentlyContinue
    if ($item) {
        $item.LastWriteTime = Get-Date
    } else {
        # No flag yet (mark-working.ps1 missed UserPromptSubmit, e.g.
        # Claude Desktop subagent paths). Create with current epoch so
        # heartbeat works; speak-response will read this as turn-start.
        $nowSec = [DateTimeOffset]::Now.ToUnixTimeSeconds()
        Set-Content -Path $flagPath -Value $nowSec -Encoding utf8 -NoNewline
    }
} catch {}

# --- Dispatch synthesis ---
# Order (2026-07-13, mirrors posix_hooks.spawn_synth):
#   1. Toolbar-alive gate -- no player means no synthesis. Incident:
#      toolbar off, hooks kept churning python + edge-tts + MP3s nobody
#      could play, for hours, at 90-99C package temp.
#   2. Long-lived daemon over TCP loopback (synth-dispatch.psm1) --
#      skips Python cold-start per fire.
#   3. Legacy detached python spawn. A missing/old synth-dispatch.psm1
#      degrades straight to (3), so an out-of-date install never loses
#      audio.
Import-Module (Join-Path $ttHome 'app\synth-dispatch.psm1') -Force -ErrorAction SilentlyContinue
if ((Get-Command Test-ToolbarAlive -ErrorAction SilentlyContinue) -and -not (Test-ToolbarAlive)) {
    Log "toolbar not running -- skipping synth (on-tool) for $sessionShort"
    exit 0
}
if ((Get-Command Invoke-SynthDaemon -ErrorAction SilentlyContinue) -and `
    (Invoke-SynthDaemon -SessionId $sessionId -Transcript $transcript -Mode 'on-tool')) {
    Log "submitted synth via daemon (on-tool) for $sessionShort"
    exit 0
}

# --- Spawn detached synth process (fallback) ---
# Start-Process returns immediately; the Python process runs in the background.
# Claude Code is NOT blocked waiting for edge-tts.
if (-not (Test-Path $synthScript)) {
    Log "synth script missing: $synthScript"
    exit 0
}

try {
    $synthArgs = @(
        '-u',
        $synthScript,
        '--session', $sessionId,
        '--transcript', $transcript,
        '--mode', 'on-tool'
    )
    $errPath = Join-Path $queueDir "synth-spawn-$sessionShort.err"
    $proc = Start-Process -FilePath 'python' -ArgumentList $synthArgs -WindowStyle Hidden -WorkingDirectory $ttHome -RedirectStandardError $errPath -PassThru
    Start-Sleep -Milliseconds 250
    if ($proc.HasExited -and $proc.ExitCode -ne 0) {
        $err = if (Test-Path $errPath) { (Get-Content $errPath -Raw).Trim() } else { '' }
        $errSnip = $err.Substring(0, [Math]::Min(500, $err.Length))
        Log "spawned synth exited rc=$($proc.ExitCode) stderr=$errSnip"
    } else {
        Log "spawned synth for $sessionShort pid=$($proc.Id)"
    }
} catch {
    Log "spawn failed: $($_.Exception.Message)"
}
exit 0
