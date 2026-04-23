$ErrorActionPreference = 'SilentlyContinue'

$ttHome = Join-Path $env:USERPROFILE '.terminal-talk'
$queueDir = Join-Path $ttHome 'queue'
$edgeScript = Join-Path $ttHome 'app\edge_tts_speak.py'
$configPath = Join-Path $ttHome 'config.json'
$logFile = Join-Path $queueDir '_hook.log'

# Rotate log past 1 MB so the file never grows unbounded.
try {
    if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 1048576)) {
        Move-Item -Force $logFile "$logFile.1"
    }
} catch {}

function Log($m) {
    try { "$(Get-Date -Format 'HH:mm:ss.fff') $m" | Out-File $logFile -Append -Encoding utf8 } catch {}
}
Log "===== hook fired ====="

$stdin = [Console]::In.ReadToEnd()
if (-not $stdin) { Log "EXIT: no stdin"; exit 0 }

try { $payload = $stdin | ConvertFrom-Json } catch { Log "EXIT: JSON parse fail"; exit 0 }
$transcript = $payload.transcript_path
if ($transcript -match '^/([a-zA-Z])/(.+)$') {
    $transcript = $Matches[1].ToUpper() + ':\' + ($Matches[2] -replace '/', '\')
}
if (-not $transcript -or -not (Test-Path $transcript)) { Log "EXIT: transcript missing: $transcript"; exit 0 }

# --- Register/refresh this session's colour assignment + per-PID session file ---
# The Stop hook is the sole writer of ~/.terminal-talk/session-colours.json, so
# every Claude Code turn guarantees the registry knows about this session.
$sessionId = ([IO.Path]::GetFileNameWithoutExtension($transcript))
$sessionShort = if ($sessionId -and $sessionId.Length -ge 8) { $sessionId.Substring(0, 8) } else { $sessionId }
# Hard-validate sessionShort against [a-f0-9]{8} so a tampered transcript path
# can never escape $queueDir via .. or / when the filename is constructed below.
if (-not ($sessionShort -match '^[a-f0-9]{8}$')) {
    Log "EXIT: invalid sessionShort '$sessionShort' (refusing to write)"
    exit 0
}

# HB2: clear the working flag as early as possible in the Stop hook.
# The heartbeat timer gates on the presence of this flag, so clearing
# it here stops verb emission the instant the response starts playing
# (before audio synth has time to finish). If any of the heavier work
# below fails, the flag still gets cleared — matching the user's
# mental model of "Claude finished, stop saying 'Percolating'".
#
# Also capture turn elapsed seconds: flag content = epoch seconds at
# UserPromptSubmit (set by mark-working.ps1). synth_turn.py reads this
# via --elapsed-sec and appends a "worked for X" clip to the end of
# the response audio.
$workingFlag = Join-Path $ttHome "sessions\$sessionShort-working.flag"
$elapsedSec = 0
try {
    if (Test-Path $workingFlag) {
        try {
            $startSec = [long](Get-Content $workingFlag -Raw -Encoding utf8).Trim()
            $nowSec = [long][double]::Parse((Get-Date -UFormat %s))
            if ($startSec -gt 0 -and $nowSec -ge $startSec) {
                $elapsedSec = [int]($nowSec - $startSec)
            }
        } catch {}
        Remove-Item -Force $workingFlag -ErrorAction SilentlyContinue
        Log "cleared working flag for $sessionShort (elapsed ${elapsedSec}s)"
    }
} catch {}

# Scrape Claude Code's actual terminal footer ("Cooked for 49s" /
# "Sautéed for 1m 0s"). That phrase is render-only — never persisted
# to jsonl or hook payload — so UIA on the Windows Terminal buffer is
# the only path. Guarded: we only accept the scrape if its duration
# is within 3 s of our own measured elapsedSec, so a stale scrollback
# footer from a prior turn can't leak into this turn's audio. Empty
# return means "fall back to synth_turn's own computed phrase".
#
# Why a sub-process: Claude Code invokes this hook as
# `powershell.exe -File ...` which defaults to MTA apartment. UIA's
# RootElement requires STA — in MTA it silently terminates the
# process with no catchable exception. Observed live 2026-04-23:
# hook died between "cleared working flag" and any scrape log line.
# The wrapper script launches a fresh PS with explicit -STA so UIA
# runs in its required apartment; we read the phrase off stdout.
$footerPhrase = ''
try {
    $scrapeHelper = Join-Path $ttHome 'app\scrape-footer.ps1'
    if ($elapsedSec -ge 1 -and (Test-Path $scrapeHelper)) {
        $registryPathForScrape = Join-Path $ttHome 'session-colours.json'
        # Parent-side hard timeout on the subprocess. Observed live
        # 2026-04-23: the scrape-footer.ps1 subprocess occasionally
        # takes 20-30 s — assembly cold-start + UIA window enumeration
        # + the in-helper polling loop stack up well past the 2 s
        # MaxWaitMs that only guards the polling. Claude Code's Stop-
        # hook timeout then kills the entire hook BEFORE it reaches
        # the `Stop: spawned synth_turn.py` line, so NO audio (body
        # OR footer) gets spoken for that turn. Using
        # System.Diagnostics.Process directly gives us a proper
        # WaitForExit(ms) with a .Kill() escape hatch; `& ...` in
        # PowerShell has no way to enforce a timeout. 4 s is the
        # budget: ~1 s cold-start + ~1 s assembly + the 2 s poll
        # window — anything slower gets killed and we fall back to
        # synth_turn.py's own computed phrase.
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName  = 'powershell.exe'
        $psi.Arguments = "-STA -NoProfile -ExecutionPolicy Bypass -File `"$scrapeHelper`" " +
                         "-SessionShort `"$sessionShort`" " +
                         "-RegistryPath `"$registryPathForScrape`" " +
                         "-ExpectedSec $elapsedSec"
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError  = $true
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow  = $true
        $scrapeProc = [System.Diagnostics.Process]::Start($psi)
        $out = $null
        $scrapeTimedOut = $false
        if ($scrapeProc.WaitForExit(4000)) {
            $out = $scrapeProc.StandardOutput.ReadToEnd()
        } else {
            try { $scrapeProc.Kill() } catch {}
            $scrapeTimedOut = $true
        }
        if ($out) { $footerPhrase = [string]($out -split "`n" | Select-Object -First 1).Trim() }
        if     ($footerPhrase)    { Log "terminal footer scraped: '$footerPhrase'" }
        elseif ($scrapeTimedOut)  { Log "terminal footer scrape timed out after 4s (fallback to computed phrase)" }
        else                      { Log "terminal footer scrape empty (fallback to computed phrase)" }
    }
} catch {
    Log "terminal footer scrape failed: $($_.Exception.Message)"
}

$claudePid = 0
try { $claudePid = [int](Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId } catch {}

if ($sessionShort -and $sessionShort.Length -eq 8) {
    $registryPath = Join-Path $ttHome 'session-colours.json'
    $sessionsDir = Join-Path $ttHome 'sessions'
    if (-not (Test-Path $sessionsDir)) { New-Item -ItemType Directory -Path $sessionsDir -Force | Out-Null }
    $now = [long][double]::Parse((Get-Date -UFormat %s))

    # Shared session-registry module -- canonical Read / Touch-Or-Assign /
    # Write-Atomic + per-PID stamp. Replaces ~80 lines of duplication that
    # used to live here AND in speak-on-tool.ps1 AND in statusline.ps1.
    Import-Module (Join-Path $ttHome 'app\session-registry.psm1') -Force -ErrorAction SilentlyContinue

    # Read-Update-Save must be lock-guarded -- toolbar can be mid-write
    # and would otherwise be stomped. See app/lib/registry-lock.js for
    # the JS-side counterpart this mirrors.
    $locked = Enter-RegistryLock -RegistryPath $registryPath
    try {
        $assignments = Read-Registry -RegistryPath $registryPath
        $null = Update-SessionAssignment -Assignments $assignments -Short $sessionShort `
                                          -SessionId $sessionId -ClaudePid $claudePid -Now $now
        Save-Registry -RegistryPath $registryPath -Assignments $assignments
    } finally {
        if ($locked) { Exit-RegistryLock -RegistryPath $registryPath }
    }
    Write-SessionPidFile -SessionsDir $sessionsDir -ClaudePid $claudePid `
                          -SessionId $sessionId -Short $sessionShort -Now $now
}

# Config defaults + overrides
$edgeClipVoice = 'en-GB-SoniaNeural'
$edgeResponseVoice = 'en-GB-RyanNeural'
$openaiClipVoice = 'shimmer'
$openaiResponseVoice = 'onyx'
$openaiApiKey = $null

$inc = @{
    code_blocks = $false
    inline_code = $false
    urls = $false
    headings = $true
    bullet_markers = $false
    image_alt = $false
}

if (Test-Path $configPath) {
    try {
        $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
        if ($cfg.voices.edge_clip) { $edgeClipVoice = $cfg.voices.edge_clip }
        if ($cfg.voices.edge_response) { $edgeResponseVoice = $cfg.voices.edge_response }
        if ($cfg.voices.openai_clip) { $openaiClipVoice = $cfg.voices.openai_clip }
        if ($cfg.voices.openai_response) { $openaiResponseVoice = $cfg.voices.openai_response }
        # D2: OpenAI key used to live under $cfg.openai_api_key here. It's
        # now read via Resolve-OpenAiApiKey below, which walks
        # env -> config.secrets.json (safeStorage sidecar)
        # -> config.json legacy -> ~/.claude/.env. Nothing to read here.
        if ($cfg.speech_includes) {
            foreach ($p in $cfg.speech_includes.PSObject.Properties) {
                if ($inc.ContainsKey($p.Name) -and $p.Value -is [bool]) { $inc[$p.Name] = $p.Value }
            }
        }
    } catch { Log "config read fail: $($_.Exception.Message)" }
}

# Per-session overrides from registry beat the global defaults.
$registryPath2 = Join-Path $ttHome 'session-colours.json'
if ((Test-Path $registryPath2) -and $sessionShort) {
    try {
        $reg = Get-Content $registryPath2 -Raw -Encoding utf8 | ConvertFrom-Json
        $entry = $reg.assignments.$sessionShort
        if ($entry) {
            if ($entry.speech_includes) {
                foreach ($p in $entry.speech_includes.PSObject.Properties) {
                    if ($inc.ContainsKey($p.Name) -and $p.Value -is [bool]) { $inc[$p.Name] = $p.Value }
                }
            }
            if ($entry.voice) {
                $edgeResponseVoice = [string]$entry.voice
            }
        }
    } catch {}
}
Log "voices: edge_response=$edgeResponseVoice; includes: code=$($inc.code_blocks) urls=$($inc.urls) bullets=$($inc.bullet_markers)"

# Canonical edge-tts + OpenAI fallback chain -- see app/tts-helper.psm1.
# Previously the Invoke-TTS function + the openai-key resolution block
# were both duplicated across speak-response.ps1 and speak-notification.ps1
# with subtly different retry counts + timeouts (audit CC-8). Both hooks
# now share the module.
Import-Module (Join-Path $ttHome 'app\tts-helper.psm1') -Force -ErrorAction SilentlyContinue
# Resolve-OpenAiApiKey walks env → config.json → ~/.claude/.env. If the
# config.json already set $openaiApiKey (above), keep that; otherwise
# fall back to the canonical resolver.
if (-not $openaiApiKey) { $openaiApiKey = Resolve-OpenAiApiKey -ConfigPath $configPath }

function Invoke-TTS($text, $edgeVoice, $openAiVoice, $openAiInstructions, $basePath) {
    $result = Invoke-TtsWithFallback `
        -EdgeScriptPath      $edgeScript `
        -EdgeVoice           $edgeVoice `
        -OpenAiVoice         $openAiVoice `
        -Text                $text `
        -BasePath            $basePath `
        -OpenAiApiKey        $openaiApiKey `
        -OpenAiInstructions  $openAiInstructions `
        -OpenAiTimeoutSec    60
    if ($result) { Log "TTS OK: $result" }
    else         { Log "TTS FAIL: no provider produced audio" }
    return $result
}

# --- Streaming path (primary since v0.2): spawn synth_turn.py detached.
# Gives parallel sentence synthesis, rolling in-order release, and
# coordinates via sync state with the PreToolUse hook so nothing is
# spoken twice. Falls through to the legacy inline path below if the
# script is missing (so an out-of-date install never loses audio).
$synthScript = Join-Path $ttHome 'app\synth_turn.py'
if (Test-Path $synthScript) {
    try {
        $spawnArgs = @(
            '-u',
            $synthScript,
            '--session', $sessionId,
            '--transcript', $transcript,
            '--mode', 'on-stop',
            '--elapsed-sec', [string]$elapsedSec
        )
        if ($footerPhrase) {
            $spawnArgs += '--footer-phrase'
            $spawnArgs += $footerPhrase
        }
        Start-Process -FilePath 'python' -ArgumentList $spawnArgs -WindowStyle Hidden -WorkingDirectory $ttHome
        Log "Stop: spawned synth_turn.py (streaming)"
        exit 0
    } catch {
        Log "Stop: streaming spawn failed, falling through to legacy: $($_.Exception.Message)"
    }
} else {
    Log "Stop: synth_turn.py missing, using legacy path"
}

# --- Legacy inline fallback (pre-streaming behaviour) ---
$lines = Get-Content $transcript
if (-not $lines) { exit 0 }
$text = $null
for ($i = $lines.Count - 1; $i -ge 0; $i--) {
    try { $entry = $lines[$i] | ConvertFrom-Json } catch { continue }
    if ($entry.type -ne 'assistant') { continue }
    $content = $entry.message.content
    if (-not $content) { continue }
    $texts = @()
    foreach ($item in $content) {
        if ($item.type -eq 'text' -and $item.text) { $texts += $item.text }
    }
    if ($texts.Count -gt 0) { $text = ($texts -join "`n"); break }
}
if (-not $text) { Log "EXIT: no text"; exit 0 }

$clean = $text

# Code blocks: three-way decision per fenced block. See app/lib/text.js
# for the full rationale. Short version: stripping 100% of fenced
# content silently drops prose-in-fences (handoff messages, quoted log
# excerpts, LLM copy-paste blocks). Language-tagged fences are always
# stripped; un-tagged fences get a syntax-heuristic check — only strip
# if the body has real code signals.
$codeSignals = @(
    '\b(def|function|fn|class)\s+\w+\s*[({:<]'
    '(?m)^\s*(import|from|require|using|package)\s+[\w.]'
    '(?m)^\s*(if|else|elif|for|while|try|except|catch|with|switch)\s*\('
    '(?m)^\s*(if|elif|else|for|while|try|except|with|def|class)\b[^.!?\n]{0,120}:\s*$'
    '(?m)^\s*[#$>]\s+\S'
    '(?m)^\s*(npm|yarn|git|pip|apt|sudo|rm|mkdir|cd|ls|cp|mv|cat|echo|curl|python|python3|node|docker|kubectl|taskkill|chmod|ssh|scp|make|cmake)\s+[-\w/]'
    '\b(Get|Set|New|Remove|Test|Invoke|Start|Stop|Write|Read|Import|Export|Add)-[A-Z]\w+\s'
    '(?m)^\s*[\{\[]\s*$'
    '(?m)^\s*"[\w.-]+":\s*(null|true|false|-?\d|"|\{|\[)'
    '=>\s*[\w(\{\[]'
    '->\s*\w'
    '::\s*\w'
    ';\s*\n'
)

function Test-LooksLikeCode($body) {
    if (-not $body -or -not $body.Trim()) { return $false }
    $hits = 0
    foreach ($pat in $codeSignals) {
        if ([regex]::IsMatch($body, $pat)) {
            $hits++
            if ($hits -ge 2) { return $true }
        }
    }
    return $false
}

$codeBlocks = New-Object System.Collections.ArrayList
$clean = [regex]::Replace($clean, '(?s)```(\w*)\r?\n?(.*?)```', {
    param($m)
    $lang = $m.Groups[1].Value.Trim()
    $body = $m.Groups[2].Value
    if ($inc.code_blocks) {
        $i = $codeBlocks.Add(' ' + $body + ' ')
        return "`0CB${i}`0"
    }
    if ($lang -or (Test-LooksLikeCode $body)) {
        return ' '
    }
    # Un-tagged, no code signals — speak the body as prose.
    return $body
})
if ($inc.inline_code) {
    # GFM-balanced inline code. See app/lib/text.js for rationale.
    $clean = [regex]::Replace($clean, '(`+)([^\n]+?)\1', '$2')
} else {
    # Preserve:
    #   (1) keyboard shortcuts (`Ctrl+R`)
    #   (2) short identifier-like inline code (`session_id`, `/clear`,
    #       `main.js`, `pid=0`) — prose content, not code syntax.
    # Strip real code (parens, operators, shell commands with flags).
    $clean = [regex]::Replace($clean, '(`+)([^\n]+?)\1', {
        param($m)
        $content = $m.Groups[2].Value
        if ($content -match '^\s*`?\s*(Ctrl|Cmd|Shift|Alt|Win|Super|Meta|Control|Command|Option|Windows)\s*\+') {
            return $content
        }
        $t = $content.Trim()
        if ($t.Length -eq 0 -or $t.Length -gt 30) { return ' ' }
        if ($t -match "`n") { return ' ' }
        if ($t -match '[(){}]|=>|->(?![a-z])|::|;\s*\S|\s--?\w') { return ' ' }
        return $content
    })
}
# Safety net: strip any surviving backticks.
$clean = $clean -replace '`', ''
if (-not $inc.image_alt) {
    $clean = [regex]::Replace($clean, '!\[[^\]]*\]\([^)]+\)', ' ')
} else {
    $clean = [regex]::Replace($clean, '!\[([^\]]*)\]\([^)]+\)', '$1')
}
$clean = [regex]::Replace($clean, '\[([^\]]+)\]\([^)]+\)', '$1')
if (-not $inc.urls) { $clean = [regex]::Replace($clean, 'https?://\S+', ' ') }
if (-not $inc.headings) {
    $clean = [regex]::Replace($clean, '(?m)^#+\s+.*$', ' ')
} else {
    $clean = [regex]::Replace($clean, '(?m)^#+\s*', '')
}
# Triple *** / ___ before double — see app/lib/text.js for full rationale.
# Without this, ***bold-italic*** strips to *bold-italic* and TTS reads
# the stray asterisks aloud. `\n` exclusion on every arm prevents a
# leftover single `*` pairing across newlines with an unrelated stray.
$clean = $clean -replace '\*\*\*([^*\n]+)\*\*\*', '$1'
$clean = $clean -replace '___([^_\n]+)___', '$1'
$clean = $clean -replace '\*\*([^*\n]+)\*\*', '$1'
$clean = $clean -replace '__([^_]+)__', '$1'
$clean = $clean -replace '\*([^*\n]+)\*', '$1'
if (-not $inc.bullet_markers) {
    $clean = [regex]::Replace($clean, '(?m)^\s*[\u25cf\u23bf\u25b6\u25b8\u25ba\u25cb\u00b7\u25e6\u25aa\u25a0\u25a1\u25ab]\s*', '')
    # Strip "- " / "* " / "+ " / "N. " markers AND add implicit period so
    # each bullet reads as its own sentence. Without this each multi-line
    # bullet list flattens to one run-on sentence downstream.
    $clean = [regex]::Replace($clean, '(?m)^[ \t]*([-*+]|\d+\.)[ \t]+(.+?)[ \t]*$', {
        param($m)
        $content = $m.Groups[2].Value.TrimEnd()
        if (-not $content) { return '' }
        if ($content -match '[.!?:;]$') { $content } else { $content + '.' }
    })
}
# Keyboard modifiers: cover all common modifiers in one sweep so
# `Ctrl+Shift+A` reads as "control shift A", not "control Shift+A".
# See app/lib/text.js for full rationale.
$clean = [regex]::Replace(
    $clean,
    '\b(Ctrl|Control|Cmd|Command|Shift|Alt|Option|Win|Windows|Super|Meta)\+',
    {
        param($m)
        $modMap = @{
            'ctrl'='control'; 'control'='control'
            'cmd'='command'; 'command'='command'
            'shift'='shift'; 'alt'='alt'; 'option'='option'
            'win'='windows'; 'windows'='windows'
            'super'='super'; 'meta'='meta'
        }
        $modMap[$m.Groups[1].Value.ToLower()] + ' '
    },
    'IgnoreCase'
)
# Tilde — edge-tts pronounces as "tilda" which is universally wrong.
# Drop the character; see app/lib/text.js for full rationale.
$clean = $clean -replace '~', ''
# Restore preserved code blocks.
if ($codeBlocks.Count -gt 0) {
    $clean = [regex]::Replace($clean, "`0CB(\d+)`0", { param($m) $codeBlocks[[int]$m.Groups[1].Value] })
}
$clean = [regex]::Replace($clean, '\s+', ' ').Trim()
if (-not $clean) { exit 0 }
if ($clean.Length -gt 4000) { $clean = $clean.Substring(0, 4000) }

if (-not (Test-Path $queueDir)) {
    New-Item -ItemType Directory -Path $queueDir -Force | Out-Null
}

$sessionId = ([IO.Path]::GetFileNameWithoutExtension($transcript))
$sessionShort = if ($sessionId.Length -ge 8) { $sessionId.Substring(0, 8) } else { $sessionId }
$timestamp = Get-Date -Format 'yyyyMMddTHHmmssfff'

# Questions-first extraction removed 2026-04-22 — extracting every
# `?`-ending sentence and playing it before the body caused three
# problems in practice: (1) order mismatch with the terminal, (2)
# false positives from `?` inside inline code, (3) duplication of
# questions in both Q-clip and body-clip form. Audio tracks terminal
# order 1:1 now. This fallback path (non-streaming Stop) rarely runs
# — synth_turn.py is the primary — but keeping parity across mirrors.

# Main response clip
$baseFile = Join-Path $queueDir ($timestamp + '-' + $sessionShort)
$out = Invoke-TTS -text $clean -edgeVoice $edgeResponseVoice -openAiVoice $openaiResponseVoice `
    -openAiInstructions 'Speak in a calm, clear, conversational tone. Natural pacing, slight warmth.' `
    -basePath $baseFile
if ($out) { Log "DONE: $out" } else { Log "EXIT: all TTS providers failed" }
exit 0
