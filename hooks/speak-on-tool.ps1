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

# Shared session-registry module -- canonical Read / Touch-Or-Assign /
# Write-Atomic + per-PID stamp. Replaces ~80 lines of logic that used
# to be duplicated here AND in speak-response.ps1 AND in statusline.ps1.
Import-Module (Join-Path $ttHome 'app\session-registry.psm1') -Force -ErrorAction SilentlyContinue

# Read-Update-Save must be lock-guarded as a whole -- the Electron toolbar
# can be mid-write during the window between Read and Save, and without
# the lock this write would stomp the user's colour/label/mute change.
# Lock semantics mirror app/lib/registry-lock.js.
$locked = Enter-RegistryLock -RegistryPath $registryPath
try {
    $assignments = Read-Registry -RegistryPath $registryPath
    $null = Update-SessionAssignment -Assignments $assignments -Short $sessionShort `
                                      -SessionId $sessionId -ClaudePid $claudePid -Now $now
    # #6 G1 + G3 — writer attribution. speak-on-tool fires on PreToolUse,
    # so tagging its writes distinguishes pre-tool saves from statusline-
    # triggered saves + the two speak-response (Stop/Notification) writers.
    Save-Registry -RegistryPath $registryPath -Assignments $assignments `
                  -Caller 'speak-on-tool' -LogPath $logFile
} finally {
    if ($locked) { Exit-RegistryLock -RegistryPath $registryPath }
}
Write-SessionPidFile -SessionsDir $sessionsDir -ClaudePid $claudePid `
                      -SessionId $sessionId -Short $sessionShort -Now $now

# --- Spawn detached synth process ---
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
    Start-Process -FilePath 'python' -ArgumentList $synthArgs -WindowStyle Hidden -WorkingDirectory $ttHome
    Log "spawned synth for $sessionShort"
} catch {
    Log "spawn failed: $($_.Exception.Message)"
}
exit 0
