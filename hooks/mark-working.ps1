$ErrorActionPreference = 'SilentlyContinue'

# Narrator-subprocess guard. The narrator hook spawns `claude --print`
# as a separate Claude Code session that fires this same hook chain;
# without this guard the subprocess's UserPromptSubmit would write a
# working flag, TranscriptWatcher would see it, and the subprocess's
# streaming sentences would land in the queue as duplicate audio.
# Pairs with the env-var stamp in speak-narrator.ps1 (the spawning side).
if ($env:TT_NARRATOR_SUBPROCESS -eq '1') { exit 0 }

# UserPromptSubmit hook. Fires when the user submits a prompt in
# Claude Code, before Claude starts generating. Writes a per-session
# "working" marker file that the toolbar uses to gate heartbeat
# emission — so the spinner-verb audio ("Percolating", "Moonwalking")
# plays ONLY between user submit and Claude's Stop, not for minutes
# after Claude finishes (the symptom of the old last_seen-based
# proxy).
#
# The matching Stop hook (speak-response.ps1) deletes the marker at
# end of turn. If the user quits Claude Code mid-response, the marker
# stays on disk — the watchdog in the main app prunes stale markers
# older than 10 min on its periodic sweep.

$ttHome = Join-Path $env:USERPROFILE '.terminal-talk'
$sessionsDir = Join-Path $ttHome 'sessions'
$logFile = Join-Path $ttHome 'queue\_hook.log'

function Log($m) {
    try { "$(Get-Date -Format 'HH:mm:ss.fff') [mark-working] $m" | Out-File $logFile -Append -Encoding utf8 } catch {}
}

try {
    $stdin = [Console]::In.ReadToEnd()
    if (-not $stdin) { exit 0 }
    $payload = $stdin | ConvertFrom-Json
    $transcript = $payload.transcript_path
    if (-not $transcript) { exit 0 }
    # Windows path normalisation (/c/... -> C:\...)
    if ($transcript -match '^/([a-zA-Z])/(.+)$') {
        $transcript = $Matches[1].ToUpper() + ':\' + ($Matches[2] -replace '/', '\')
    }

    $sessionId = [IO.Path]::GetFileNameWithoutExtension($transcript)
    if (-not $sessionId -or $sessionId.Length -lt 8) { exit 0 }
    $sessionShort = $sessionId.Substring(0, 8).ToLower()
    # Hard-validate: only 8 hex chars get to touch the filesystem.
    if (-not ($sessionShort -match '^[a-f0-9]{8}$')) { exit 0 }

    if (-not (Test-Path $sessionsDir)) {
        New-Item -ItemType Directory -Path $sessionsDir -Force | Out-Null
    }
    $flagPath = Join-Path $sessionsDir "$sessionShort-working.flag"
    # Content is the epoch seconds of when the user submitted — gives
    # the toolbar (and watchdog) a way to prune stale markers without
    # guessing from mtime alone.
    # UTC-correct epoch seconds. `Get-Date -UFormat %s` returns LOCAL
    # time on Windows PowerShell 5.1, which puts this flag's timestamp
    # hours ahead or behind what the JS reader (Date.now()/1000, UTC)
    # expects. Audit 2026-04-23 Phase 2b caught this via a 3600 s drift
    # in BST. ToUnixTimeSeconds() is UTC by definition — fixes it once,
    # for every PS version.
    $nowSec = [DateTimeOffset]::Now.ToUnixTimeSeconds()
    Set-Content -Path $flagPath -Value $nowSec -Encoding utf8 -NoNewline
    Log "flag set for $sessionShort"
} catch {
    Log "EXIT: $($_.Exception.Message)"
}

exit 0
