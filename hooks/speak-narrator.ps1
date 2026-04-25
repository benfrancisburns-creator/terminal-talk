# Experimental Haiku narrator — Stop hook companion.
#
# When config.narrator.enabled is true, this hook spawns a separate
# `claude --print` invocation against Haiku 4.5 to summarise the
# just-finished turn into a short speakable line, then routes that line
# through the existing edge-tts / OpenAI TTS fallback chain to land an
# MP3 in ~/.terminal-talk/queue/. The existing queue-watcher +
# audio-player pick it up automatically — no Node-side wiring required.
#
# Filename prefix: N-<timestamp>-<sessionShort>.mp3 — distinguishes
# narrator clips from streaming sentences (no prefix), heartbeat (H-),
# and tool narration (T-). Mtime is later than every streaming sentence
# in the same turn, so the narrator clip naturally plays last.
#
# Default-off + early-exit means installing this hook is a no-op for
# users who haven't flipped narrator.enabled. Existing audio pipeline
# untouched.

$ErrorActionPreference = 'SilentlyContinue'

# Recursion guard. The narrator hook spawns `claude --print`, which is
# itself a Claude Code session that fires its own Stop hook chain —
# including this script — so without this guard each fire spawns a
# fresh fire, ad infinitum. Observed live 2026-04-25: enabling narrator
# produced 9 cascading fires + 9 timeouts in two minutes plus a flood
# of stale "closed" sessions in the toolbar. The env var is set on the
# spawned child below; PowerShell ProcessStartInfo's
# EnvironmentVariables dictionary copies parent env then applies our
# additions, and the child inherits the flag. If the flag is present,
# this is a narrator-spawned subprocess and we bail before doing any
# work — including before reading config.json — so the recursion
# can't even get past the cheap-exit gate.
if ($env:TT_NARRATOR_SUBPROCESS -eq '1') { exit 0 }

$ttHome    = Join-Path $env:USERPROFILE '.terminal-talk'
$queueDir  = Join-Path $ttHome 'queue'
$configPath = Join-Path $ttHome 'config.json'
$logFile   = Join-Path $queueDir '_narrator.log'
$edgeScript = Join-Path $ttHome 'app\edge_tts_speak.py'

try {
    if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 1048576)) {
        Move-Item -Force $logFile "$logFile.1"
    }
} catch {}

function Log($m) {
    try { "$(Get-Date -Format 'HH:mm:ss.fff') $m" | Out-File $logFile -Append -Encoding utf8 } catch {}
}

# Gate 1: feature flag. Read config.json and bail before any work if
# narrator.enabled is missing or false. This is the every-turn hot path
# while the feature is opt-in, so keep it cheap.
$enabled = $false
$model = 'claude-haiku-4-5-20251001'
if (Test-Path $configPath) {
    try {
        $cfg = Get-Content $configPath -Raw -Encoding utf8 | ConvertFrom-Json
        if ($cfg.narrator -and $cfg.narrator.enabled -eq $true) { $enabled = $true }
        if ($cfg.narrator -and $cfg.narrator.model)            { $model = [string]$cfg.narrator.model }
    } catch {}
}
if (-not $enabled) { exit 0 }

Log "===== narrator fired ====="

# Gate 2: payload + transcript. Same shape as speak-response.ps1.
$stdin = [Console]::In.ReadToEnd()
if (-not $stdin) { Log "EXIT: no stdin"; exit 0 }
try { $payload = $stdin | ConvertFrom-Json } catch { Log "EXIT: JSON parse fail"; exit 0 }
$transcript = $payload.transcript_path
if ($transcript -match '^/([a-zA-Z])/(.+)$') {
    $transcript = $Matches[1].ToUpper() + ':\' + ($Matches[2] -replace '/', '\')
}
if (-not $transcript -or -not (Test-Path $transcript)) { Log "EXIT: transcript missing: $transcript"; exit 0 }

# Stop_hook_active reuse — speak-response.ps1 doesn't gate on this, but
# Claude Code sets it when a Stop hook chain re-fires. Skipping when
# already active prevents accidental double-narration on re-runs.
if ($payload.stop_hook_active -eq $true) { Log "EXIT: stop_hook_active"; exit 0 }

$sessionId = ([IO.Path]::GetFileNameWithoutExtension($transcript))
$sessionShort = if ($sessionId -and $sessionId.Length -ge 8) { $sessionId.Substring(0, 8) } else { $sessionId }
if (-not ($sessionShort -match '^[a-f0-9]{8}$')) {
    Log "EXIT: invalid sessionShort '$sessionShort'"
    exit 0
}

# Extract the last user prompt + last assistant response from the
# transcript JSONL. Same filter shape as the Warp claude-code-warp Stop
# hook (filter past tool-result messages that share the "user" type).
$lines = Get-Content $transcript -Encoding utf8
if (-not $lines) { Log "EXIT: empty transcript"; exit 0 }

$lastQuery = $null
$lastResponse = $null
for ($i = $lines.Count - 1; $i -ge 0; $i--) {
    try { $entry = $lines[$i] | ConvertFrom-Json } catch { continue }
    if (-not $lastResponse -and $entry.type -eq 'assistant' -and $entry.message.content) {
        $texts = @()
        foreach ($item in $entry.message.content) {
            if ($item.type -eq 'text' -and $item.text) { $texts += $item.text }
        }
        if ($texts.Count -gt 0) { $lastResponse = ($texts -join "`n") }
    }
    if (-not $lastQuery -and $entry.type -eq 'user' -and $entry.message.content) {
        # User-type entries cover both human prompts and tool-result
        # messages. Real prompts are either a plain string or contain at
        # least one {type:"text"} block. Tool results are arrays of
        # {type:"tool_result"} only — skip those.
        $content = $entry.message.content
        if ($content -is [string]) {
            $lastQuery = $content
        } else {
            $texts = @()
            foreach ($item in $content) {
                if ($item.type -eq 'text' -and $item.text) { $texts += $item.text }
            }
            if ($texts.Count -gt 0) { $lastQuery = ($texts -join "`n") }
        }
    }
    if ($lastQuery -and $lastResponse) { break }
}
if (-not $lastResponse) { Log "EXIT: no assistant response found"; exit 0 }

# Cap inputs so a giant turn doesn't balloon Haiku's prompt cost. 4 KB
# of prompt + 8 KB of response is plenty for a summary; anything beyond
# that gets truncated. The narrator's job is to compress, so missing
# tail context rarely changes the summary materially.
if ($lastQuery -and $lastQuery.Length -gt 4000) {
    $lastQuery = $lastQuery.Substring(0, 4000) + '...'
}
if ($lastResponse.Length -gt 8000) {
    $lastResponse = $lastResponse.Substring(0, 8000) + '...'
}

# Narrator instructions inlined into the user message. Originally these
# went via --append-system-prompt, but multi-line strings on the Windows
# command line are a quoting nightmare AND ProcessStartInfo.ArgumentList
# (which would fix that) is .NET 5+ only — Windows PowerShell 5.1 uses
# .NET Framework. Stuffing the rules into the user message via stdin
# sidesteps both issues. Loses prompt-caching benefit but this is a
# one-shot Haiku call per turn; caching wouldn't help anyway.
$narratorInstructions = @'
You convert Claude Code terminal output into speakable English for text-to-speech.
Output the same information Claude conveyed, with no formatting:
- No backticks, code fences, headers, bullets, tables, or markdown of any kind.
- Speak file names and code identifiers naturally ("the auth router file", not "auth slash router dot ts").
- If the response is short, render it faithfully. If it is long or contains large code blocks, summarise the prose and describe what the code does rather than reading code verbatim.
- Match the tone of the original — neutral, no added personality, no "sir", no flourish.
- Never address the user by name or guess their identity.
- Maximum three sentences. Aim for one or two.
- If the assistant ended with a question, preserve that question — it is the most important thing for the user to hear.
Output ONLY the speakable text. No preamble, no explanation, no quotes around it.
'@

$userMessage = "$narratorInstructions`n`n---`n`nUser asked:`n$lastQuery`n`nAssistant responded:`n$lastResponse`n`nProduce the speakable summary now."

# Spawn claude --print with Haiku. Capture stdout + stderr separately so
# a CLI failure doesn't pollute the spoken text. Hard cap on wait time:
# narrator should finish well within 15 s for a Haiku turn; anything
# longer and we abandon to keep the audio queue moving.
#
# .Arguments (string) instead of .ArgumentList — matches existing
# scrape-footer pattern in speak-response.ps1 and works on Windows
# PowerShell 5.1 (.NET Framework, no ArgumentList).
$narratorOutput = $null
try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'claude'
    # Model is a model-id string from config — no shell metacharacters
    # plausible there, but quote it anyway for defence in depth.
    $psi.Arguments = "--print --model `"$model`""
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    # Stamp the recursion-guard env var on the child. Pairs with the
    # exit-0-at-top check at the head of this script — the spawned
    # claude --print is itself a Claude Code session that would otherwise
    # fire this same hook on its own Stop, cascading without bound.
    $psi.EnvironmentVariables["TT_NARRATOR_SUBPROCESS"] = "1"

    $proc = [System.Diagnostics.Process]::Start($psi)
    $proc.StandardInput.Write($userMessage)
    $proc.StandardInput.Close()

    if ($proc.WaitForExit(15000)) {
        $narratorOutput = $proc.StandardOutput.ReadToEnd()
        $stderrText = $proc.StandardError.ReadToEnd()
        if ($stderrText) { Log "claude stderr: $($stderrText.Substring(0, [Math]::Min(300, $stderrText.Length)))" }
        if ($proc.ExitCode -ne 0) {
            Log "EXIT: claude returned exit code $($proc.ExitCode)"
            $narratorOutput = $null
        }
    } else {
        try { $proc.Kill() } catch {}
        Log "EXIT: claude --print timed out after 15s"
    }
} catch {
    Log "EXIT: claude --print spawn fail: $($_.Exception.Message)"
}

if (-not $narratorOutput) { exit 0 }

# Strip stray quotes / leading whitespace / trailing newlines.
$narratorOutput = $narratorOutput.Trim()
$narratorOutput = $narratorOutput -replace '^["'']|["'']$', ''
$narratorOutput = $narratorOutput.Trim()
if (-not $narratorOutput) { Log "EXIT: empty narrator output after trim"; exit 0 }
if ($narratorOutput.Length -gt 1500) {
    # Hard ceiling — narrator should never produce more than ~3 sentences
    # but if Haiku ignores the system prompt, cut it off rather than
    # paying TTS cost for a runaway summary.
    $narratorOutput = $narratorOutput.Substring(0, 1500)
}
Log "narrator output ($($narratorOutput.Length) chars): $($narratorOutput.Substring(0, [Math]::Min(120, $narratorOutput.Length)))"

# Resolve voice + OpenAI key + TTS provider preference using the same
# canonical helpers speak-response.ps1 uses. Voice defaults to the
# response voice (not clip voice) — narrator is the same conversational
# register as the main response, just briefer.
Import-Module (Join-Path $ttHome 'app\tts-helper.psm1') -Force -ErrorAction SilentlyContinue

$edgeResponseVoice = 'en-GB-RyanNeural'
$openaiResponseVoice = 'onyx'
if (Test-Path $configPath) {
    try {
        $cfg2 = Get-Content $configPath -Raw -Encoding utf8 | ConvertFrom-Json
        if ($cfg2.voices.edge_response)   { $edgeResponseVoice = $cfg2.voices.edge_response }
        if ($cfg2.voices.openai_response) { $openaiResponseVoice = $cfg2.voices.openai_response }
    } catch {}
}
$openaiApiKey = Resolve-OpenAiApiKey -ConfigPath $configPath

if (-not (Test-Path $queueDir)) {
    New-Item -ItemType Directory -Path $queueDir -Force | Out-Null
}

# N- prefix marks this as a narrator clip — distinguishes it from
# streaming sentences (no prefix), heartbeat (H-), and tool narration
# (T-). Filename leads with the timestamp so the descending-lexical
# sort in queue-watcher.js sees it as the newest clip in the turn.
$timestamp = Get-Date -Format 'yyyyMMddTHHmmssfff'
$baseFile = Join-Path $queueDir ("N-$timestamp-$sessionShort")

$result = Invoke-TtsWithFallback `
    -EdgeScriptPath     $edgeScript `
    -EdgeVoice          $edgeResponseVoice `
    -OpenAiVoice        $openaiResponseVoice `
    -Text               $narratorOutput `
    -BasePath           $baseFile `
    -OpenAiApiKey       $openaiApiKey `
    -OpenAiInstructions 'Speak in a calm, brief, conversational tone. Slightly faster than the main response — this is a closing summary.' `
    -OpenAiTimeoutSec   30

if ($result) { Log "DONE: $result" } else { Log "EXIT: TTS failed for narrator output" }
exit 0
