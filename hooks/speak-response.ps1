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
$claudePid = 0
try { $claudePid = [int](Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId } catch {}

if ($sessionShort -and $sessionShort.Length -eq 8) {
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
                    # Preserve per-session voice + speech_includes overrides exactly as stored.
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

    # Touch current session first so it survives the prune pass.
    if ($assignments.ContainsKey($sessionShort)) {
        $assignments[$sessionShort].last_seen = $now
        $assignments[$sessionShort].claude_pid = $claudePid
        $assignments[$sessionShort].session_id = $sessionId
    }

    # All existing sessions keep their slot — permanent until the user
    # removes them via the Sessions table. Ben's request: "keep it hard
    # coded there until we want to drop it ourselves".
    $busy = @{}
    foreach ($key in @($assignments.Keys)) {
        $busy[[int]$assignments[$key].index] = $true
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
    } catch {}

    # Also stamp the per-PID sessions file so hey-jarvis can map foreground -> session.
    if ($claudePid) {
        $sessionFile = Join-Path $sessionsDir "$claudePid.json"
        $jsonOut = @{ session_id = $sessionId; short = $sessionShort; claude_pid = $claudePid; ts = $now } | ConvertTo-Json -Compress
        $tmp = "$sessionFile.tmp"
        [IO.File]::WriteAllText($tmp, $jsonOut, [System.Text.UTF8Encoding]::new($false))
        Move-Item -Force $tmp $sessionFile
    }
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
        if ($cfg.openai_api_key) { $openaiApiKey = $cfg.openai_api_key }
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
if (-not $openaiApiKey -and $env:OPENAI_API_KEY) { $openaiApiKey = $env:OPENAI_API_KEY }
if (-not $openaiApiKey) {
    $claudeEnv = Join-Path $env:USERPROFILE '.claude\.env'
    if (Test-Path $claudeEnv) {
        Get-Content $claudeEnv | ForEach-Object {
            if ($_ -match '^\s*OPENAI_API_KEY\s*=\s*(.+)\s*$') {
                $openaiApiKey = $Matches[1].Trim().Trim('"').Trim("'")
            }
        }
    }
}

function Invoke-TTS($text, $edgeVoice, $openAiVoice, $openAiInstructions, $basePath) {
    # Try edge-tts first (free)
    $edgeOut = "$basePath.mp3"
    try {
        $text | python $edgeScript $edgeVoice $edgeOut 2>$null
        if ($LASTEXITCODE -eq 0 -and (Test-Path $edgeOut) -and (Get-Item $edgeOut).Length -gt 500) {
            Log "edge-tts OK: $edgeOut"
            return $edgeOut
        } else {
            Log "edge-tts FAIL exit=$LASTEXITCODE, falling back to OpenAI"
            Remove-Item $edgeOut -ErrorAction SilentlyContinue
        }
    } catch {
        Log "edge-tts EXCEPTION: $($_.Exception.Message)"
    }

    # Fallback: OpenAI
    if (-not $openaiApiKey) { Log "no OpenAI key, giving up"; return $null }
    $wavOut = "$basePath.wav"
    $body = @{
        model = 'gpt-4o-mini-tts'
        voice = $openAiVoice
        input = $text
        instructions = $openAiInstructions
        response_format = 'wav'
    } | ConvertTo-Json -Compress
    $bodyBytes = [Text.Encoding]::UTF8.GetBytes($body)
    try {
        Invoke-WebRequest -Uri 'https://api.openai.com/v1/audio/speech' `
            -Method Post `
            -Headers @{ 'Authorization' = "Bearer $openaiApiKey"; 'Content-Type' = 'application/json; charset=utf-8' } `
            -Body $bodyBytes -OutFile $wavOut -UseBasicParsing -TimeoutSec 60
        if ((Test-Path $wavOut) -and (Get-Item $wavOut).Length -ge 100) {
            Log "OpenAI fallback OK: $wavOut"
            return $wavOut
        }
    } catch {
        Log "OpenAI fallback FAIL: $($_.Exception.Message)"
    }
    return $null
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
    # Keep content, drop the surrounding backticks.
    $clean = [regex]::Replace($clean, '`([^`]+)`', '$1')
} else {
    $clean = [regex]::Replace($clean, '`[^`]+`', ' ')
}
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
$clean = $clean -replace '\*\*([^*]+)\*\*', '$1'
$clean = $clean -replace '__([^_]+)__', '$1'
$clean = $clean -replace '\*([^*\n]+)\*', '$1'
if (-not $inc.bullet_markers) {
    $clean = [regex]::Replace($clean, '(?m)^\s*[\u25cf\u23bf\u25b6\u25b8\u25ba\u25cb\u00b7\u25e6\u25aa\u25a0\u25a1\u25ab]\s*', '')
    $clean = [regex]::Replace($clean, '(?m)^\s*[-*+]\s+', '')
    $clean = [regex]::Replace($clean, '(?m)^\s*\d+\.\s+', '')
}
$clean = $clean -replace 'Ctrl\+', 'control '
$clean = $clean -replace 'Cmd\+', 'command '
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
