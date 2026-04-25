$ErrorActionPreference = 'SilentlyContinue'

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
    # Two-flag split (audit 2026-04-25 — "moonwalking for 19 seconds"
    # bug). mark-working writes BOTH flags on submit:
    #
    #   <short>-start.flag    The IMMUTABLE submit timestamp. Written
    #                          once per turn here; never touched by any
    #                          other hook. speak-response reads this
    #                          for elapsed-time calculation.
    #
    #   <short>-working.flag  The keep-fresh signal. Written here on
    #                          submit, REFRESHED by speak-on-tool on
    #                          every PreToolUse so heartbeat stays alive
    #                          for long turns (>10 min) where a single
    #                          submit timestamp would age past
    #                          STALE_SEC=600. Toolbar gates heartbeat
    #                          emission on presence + freshness of this
    #                          flag.
    #
    # Pre-fix, both flags were the same file — speak-on-tool's refresh
    # clobbered the submit timestamp, so a 79-second turn whose last
    # tool fired 19s before Stop produced "Moonwalking for 19 seconds"
    # instead of "Moonwalking for 1 minute and 19 seconds".
    #
    # UTC-correct epoch seconds. `Get-Date -UFormat %s` returns LOCAL
    # time on PS 5.1 — caught via 3600 s drift in BST audit 2026-04-23.
    $nowSec = [DateTimeOffset]::Now.ToUnixTimeSeconds()
    $startFlag   = Join-Path $sessionsDir "$sessionShort-start.flag"
    $workingFlag = Join-Path $sessionsDir "$sessionShort-working.flag"
    Set-Content -Path $startFlag   -Value $nowSec -Encoding utf8 -NoNewline
    Set-Content -Path $workingFlag -Value $nowSec -Encoding utf8 -NoNewline
    Log "flags set for $sessionShort (start + working)"
} catch {
    Log "EXIT: $($_.Exception.Message)"
}

exit 0
