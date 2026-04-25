# Stop hook companion — speakable closing-summary clip.
#
# Architecture (v2 — Task-tool-driven, replaces v1 subprocess approach):
# Main Claude is instructed (via the user's CLAUDE.md) to invoke the
# `narrator` subagent at the end of each substantive turn. The subagent
# runs in-session via Claude Code's Task tool — no new CLI process, no
# new hook chain, no recursion possible. Its return value lands in the
# transcript JSONL as a tool_result. This hook reads that tool_result,
# extracts the speakable text, and synthesises an S-prefix audio clip
# through the existing edge-tts / OpenAI fallback chain.
#
# When narrator.enabled=false (default), the hook exits 0 immediately
# and existing behaviour is byte-for-byte unchanged. When enabled but
# the user hasn't added the CLAUDE.md instruction (or main Claude
# skipped the agent call this turn), the hook finds no narrator
# tool_use, logs that, and exits cleanly. Worst case: no S-clip; the
# regular streaming sentences still play.
#
# Filename: S-<timestamp>-<sessionShort>.{wav|mp3} — the S- prefix
# distinguishes Summary clips from streaming sentences (no prefix),
# heartbeat (H-), tool narration (T-), Jarvis highlight (J-).

$ErrorActionPreference = 'SilentlyContinue'

$ttHome     = Join-Path $env:USERPROFILE '.terminal-talk'
$queueDir   = Join-Path $ttHome 'queue'
$configPath = Join-Path $ttHome 'config.json'
$logFile    = Join-Path $queueDir '_narrator.log'
$edgeScript = Join-Path $ttHome 'app\edge_tts_speak.py'

try {
    if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 1048576)) {
        Move-Item -Force $logFile "$logFile.1"
    }
} catch {}

function Log($m) {
    try { "$(Get-Date -Format 'HH:mm:ss.fff') $m" | Out-File $logFile -Append -Encoding utf8 } catch {}
}

# Gate 1: feature flag. The narrator subagent itself is harmless when
# unused (just sits in ~/.claude/agents/), but we want zero TTS work
# when the feature's off.
$enabled = $false
if (Test-Path $configPath) {
    try {
        $cfg = Get-Content $configPath -Raw -Encoding utf8 | ConvertFrom-Json
        if ($cfg.narrator -and $cfg.narrator.enabled -eq $true) { $enabled = $true }
    } catch {}
}
if (-not $enabled) { exit 0 }

Log "===== narrator fired ====="

# Gate 2: payload. Same shape as speak-response.ps1.
$stdin = [Console]::In.ReadToEnd()
if (-not $stdin) { Log "EXIT: no stdin"; exit 0 }
try { $payload = $stdin | ConvertFrom-Json } catch { Log "EXIT: JSON parse fail"; exit 0 }
if ($payload.stop_hook_active -eq $true) { Log "EXIT: stop_hook_active"; exit 0 }

$transcript = $payload.transcript_path
if ($transcript -match '^/([a-zA-Z])/(.+)$') {
    $transcript = $Matches[1].ToUpper() + ':\' + ($Matches[2] -replace '/', '\')
}
if (-not $transcript -or -not (Test-Path $transcript)) { Log "EXIT: transcript missing: $transcript"; exit 0 }

$sessionId = ([IO.Path]::GetFileNameWithoutExtension($transcript))
$sessionShort = if ($sessionId -and $sessionId.Length -ge 8) { $sessionId.Substring(0, 8) } else { $sessionId }
if (-not ($sessionShort -match '^[a-f0-9]{8}$')) {
    Log "EXIT: invalid sessionShort '$sessionShort'"
    exit 0
}

# Walk the transcript jsonl from the END backward looking for the
# most recent Task tool_use whose input identifies the narrator agent.
# Claude Code's evolving SDK has used both `subagent_type` and `agent`
# as the field name for which subagent to dispatch — we accept either
# so the hook stays compatible across versions. Once we find the
# tool_use, we look for the matching tool_result by tool_use_id.
#
# Stop hook fires before transcript is fully flushed in some races;
# small sleep gives the writer a moment to land the final frame.
Start-Sleep -Milliseconds 300

$lines = Get-Content $transcript -Encoding utf8
if (-not $lines) { Log "EXIT: empty transcript"; exit 0 }

$narratorToolUseId = $null
$narratorOutput = $null

# First pass (reverse): find the most recent narrator Task tool_use
# and remember its id. We scan from the tail because narrator is
# expected to be the last (or near-last) action of the turn.
for ($i = $lines.Count - 1; $i -ge 0; $i--) {
    try { $entry = $lines[$i] | ConvertFrom-Json } catch { continue }
    if ($entry.type -ne 'assistant') { continue }
    $content = $entry.message.content
    if (-not $content) { continue }
    foreach ($item in $content) {
        if ($item.type -ne 'tool_use') { continue }
        # Claude Code CLI writes the subagent-dispatch tool as `Agent`;
        # some older docs / models call it `Task`. Accept either — the
        # input.subagent_type check below is what filters to narrator.
        if ($item.name -ne 'Agent' -and $item.name -ne 'Task') { continue }
        $agentField = $null
        if ($item.input.subagent_type) { $agentField = [string]$item.input.subagent_type }
        elseif ($item.input.agent)     { $agentField = [string]$item.input.agent }
        if ($agentField -eq 'narrator') {
            $narratorToolUseId = [string]$item.id
            break
        }
    }
    if ($narratorToolUseId) { break }
}

if (-not $narratorToolUseId) {
    Log "EXIT: no narrator Task tool_use found in transcript (CLAUDE.md instruction not applied or agent not invoked this turn)"
    exit 0
}
Log "found narrator tool_use_id: $narratorToolUseId"

# Second pass (forward): find the tool_result that matches the id.
# Tool results are user-type messages with content[].tool_use_id == id.
# Content can be a plain string or an array of content blocks; handle
# both shapes.
foreach ($line in $lines) {
    try { $entry = $line | ConvertFrom-Json } catch { continue }
    if ($entry.type -ne 'user') { continue }
    $content = $entry.message.content
    if (-not $content -or $content -is [string]) { continue }
    foreach ($item in $content) {
        if ($item.type -ne 'tool_result') { continue }
        if ([string]$item.tool_use_id -ne $narratorToolUseId) { continue }
        $resultContent = $item.content
        if ($resultContent -is [string]) {
            $narratorOutput = $resultContent
        } else {
            $texts = @()
            foreach ($block in $resultContent) {
                if ($block.type -eq 'text' -and $block.text) { $texts += [string]$block.text }
            }
            if ($texts.Count -gt 0) { $narratorOutput = ($texts -join "`n") }
        }
        if ($narratorOutput) { break }
    }
    if ($narratorOutput) { break }
}

if (-not $narratorOutput) {
    Log "EXIT: narrator tool_use found but no matching tool_result yet (race) — skipping this turn"
    exit 0
}

# Strip the Agent-tool framework wrapper. Claude Code's Agent tool
# appends metadata to the subagent's actual output:
#   <narrator's speakable text>
#   agentId: <hash> (use SendMessage with to: '<hash>' to continue ...)
#   <usage>total_tokens: NNNN
#   tool_uses: N
#   duration_ms: NNN</usage>
# We only want the speakable text; the metadata is for tooling, not
# audio. Strip from the first `\nagentId:` or `\n<usage>` onward.
$narratorOutput = ($narratorOutput -split "`n(?:agentId:|<usage>)", 2)[0]
$narratorOutput = $narratorOutput.Trim()

# The agent prompt explicitly says "output empty string for trivial
# turns" — respect that signal and skip TTS. No clip is the right
# answer for "yes" / "done" / one-word acknowledgements.
if (-not $narratorOutput) {
    Log "EXIT: narrator returned empty output (turn was trivial — by design)"
    exit 0
}
# Hard ceiling. Subagent should produce at most 2-3 sentences but if
# it ignores the system prompt, cut rather than pay TTS cost for a
# runaway summary.
if ($narratorOutput.Length -gt 1500) {
    $narratorOutput = $narratorOutput.Substring(0, 1500)
}
Log "narrator output ($($narratorOutput.Length) chars): $($narratorOutput.Substring(0, [Math]::Min(120, $narratorOutput.Length)))"

# Resolve voice + OpenAI key using the canonical helpers. Voice
# defaults match speak-response.ps1; OpenAI is forced as the primary
# provider so the summary clip is audibly distinct from the streaming
# sentences (Ryan via edge) — falls back to edge if no key is
# configured.
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

# S- prefix marks this as a Summary clip. Filename leads with the
# timestamp so the descending-mtime sort in queue-watcher.js plays it
# last in the turn (after the streaming sentences synthesised by
# synth_turn.py).
$timestamp = Get-Date -Format 'yyyyMMddTHHmmssfff'
$baseFile = Join-Path $queueDir ("S-$timestamp-$sessionShort")

$result = Invoke-TtsWithFallback `
    -EdgeScriptPath     $edgeScript `
    -EdgeVoice          $edgeResponseVoice `
    -OpenAiVoice        $openaiResponseVoice `
    -Text               $narratorOutput `
    -BasePath           $baseFile `
    -OpenAiApiKey       $openaiApiKey `
    -OpenAiInstructions 'Speak in a calm, brief, conversational tone. Slightly faster than the main response — this is a closing summary.' `
    -OpenAiTimeoutSec   30 `
    -Provider           'openai'

if ($result) { Log "DONE: $result" } else { Log "EXIT: TTS failed for narrator output" }
exit 0
