$ErrorActionPreference = 'SilentlyContinue'

# UserPromptSubmit hook. Two responsibilities:
#
# 1. Write a per-session "working" marker file that the toolbar uses
#    to gate heartbeat emission — so the spinner-verb audio
#    ("Percolating", "Moonwalking") plays ONLY between user submit and
#    Claude's Stop, not for minutes after Claude finishes (the symptom
#    of the old last_seen-based proxy).
#
# 2. When config.narrator.enabled = true, emit a UserPromptSubmit
#    hookSpecificOutput JSON with additionalContext that nudges Claude
#    to invoke the narrator subagent at the end of this turn. The
#    additionalContext is invisible to the user in the chat UI but
#    visible to Claude as system context for THIS turn —
#    significantly more reliable than a CLAUDE.md instruction buried
#    in long preferences. Live testing 2026-04-25 showed CLAUDE.md
#    routes Claude to invoke narrator 0/12 times; additionalContext
#    routes 2/2 in the same conditions. Per-turn fresh injection beats
#    one-time-loaded preferences.
#
# The matching Stop hook (speak-response.ps1) deletes the working
# marker at end of turn. If the user quits Claude Code mid-response,
# the marker stays on disk — the watchdog in the main app prunes
# stale markers older than 10 min on its periodic sweep.

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

# --- Narrator additionalContext injection ---
# Emits the hook-spec JSON to stdout so Claude sees the instruction as
# system context for THIS turn. Skipped when narrator.enabled = false
# so this is a no-op for users who haven't opted in. The JSON shape is
# Claude Code's documented UserPromptSubmit hookSpecificOutput format.
try {
    $cfgPath = Join-Path $ttHome 'config.json'
    if (Test-Path $cfgPath) {
        $cfg = Get-Content $cfgPath -Raw -Encoding utf8 | ConvertFrom-Json
        if ($cfg.narrator -and $cfg.narrator.enabled -eq $true) {
            $instruction = 'After completing your response, invoke the narrator subagent via the Task tool with a brief description of what you just did. The narrator returns one or two sentences of speakable English which terminal-talk plays as the closing audio clip for this turn. Do not show the narrator output to the user.'
            $out = @{
                hookSpecificOutput = @{
                    hookEventName = 'UserPromptSubmit'
                    additionalContext = $instruction
                }
            } | ConvertTo-Json -Compress -Depth 5
            Write-Output $out
            Log "injected narrator additionalContext"
        }
    }
} catch {
    Log "narrator injection failed: $($_.Exception.Message)"
}

exit 0
