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
$workingFlag = Join-Path $ttHome "sessions\$sessionShort-working.flag"
try {
    if (Test-Path $workingFlag) {
        Remove-Item -Force $workingFlag -ErrorAction SilentlyContinue
        Log "cleared working flag for $sessionShort"
    }
} catch {}

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
            '--mode', 'on-stop'
        )
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

# Code blocks: when included, keep CONTENT only (drop fence markers + language tag).
$codeBlocks = New-Object System.Collections.ArrayList
if ($inc.code_blocks) {
    $clean = [regex]::Replace($clean, '(?s)```(?:\w+)?\r?\n?(.*?)```', {
        param($m)
        $i = $codeBlocks.Add(' ' + $m.Groups[1].Value + ' ')
        "`0CB${i}`0"
    })
} else {
    $clean = [regex]::Replace($clean, '(?s)```.*?```', ' ')
}
if ($inc.inline_code) {
    # GFM-balanced inline code. See app/lib/text.js for rationale.
    $clean = [regex]::Replace($clean, '(`+)([^\n]+?)\1', '$2')
} else {
    # Preserve keyboard shortcuts (`Ctrl+R`) even when inline_code=false —
    # they're UI instructions, not code noise. Optional leading `?` in
    # the shortcut regex tolerates GFM double-backtick wrapping.
    $clean = [regex]::Replace($clean, '(`+)([^\n]+?)\1', {
        param($m)
        $content = $m.Groups[2].Value
        if ($content -match '^\s*`?\s*(Ctrl|Cmd|Shift|Alt|Win|Super|Meta|Control|Command|Option|Windows)\s*\+') { $content } else { ' ' }
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

# Priority clip: questions extracted from response (plays before main body)
$questionMatches = [regex]::Matches($clean, '[^.!?\n]{5,}\?')
$questions = @()
foreach ($m in $questionMatches) {
    $q = $m.Value.Trim()
    if ($q.Length -gt 5 -and $q -match '\w') { $questions += $q }
}
if ($questions.Count -gt 0) {
    $qText = 'Question. ' + ($questions -join ' ')
    if ($qText.Length -gt 1500) { $qText = $qText.Substring(0, 1500) }
    $qBase = Join-Path $queueDir ($timestamp + '-Q-' + $sessionShort)
    $qOut = Invoke-TTS -text $qText -edgeVoice $edgeClipVoice -openAiVoice $openaiClipVoice `
        -openAiInstructions 'Speak with warm attentiveness, as if asking a friend. Natural pace.' `
        -basePath $qBase
    if ($qOut) { Log "QUESTION clip saved: $qOut" }
}

# Main response clip
$baseFile = Join-Path $queueDir ($timestamp + '-' + $sessionShort)
$out = Invoke-TTS -text $clean -edgeVoice $edgeResponseVoice -openAiVoice $openaiResponseVoice `
    -openAiInstructions 'Speak in a calm, clear, conversational tone. Natural pacing, slight warmth.' `
    -basePath $baseFile
if ($out) { Log "DONE: $out" } else { Log "EXIT: all TTS providers failed" }
exit 0
