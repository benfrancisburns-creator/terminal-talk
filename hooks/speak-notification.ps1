$ErrorActionPreference = 'SilentlyContinue'

$ttHome = Join-Path $env:USERPROFILE '.terminal-talk'
$queueDir = Join-Path $ttHome 'queue'
$edgeScript = Join-Path $ttHome 'app\edge_tts_speak.py'
$configPath = Join-Path $ttHome 'config.json'
$logFile = Join-Path $queueDir '_hook.log'

# Bound log size to keep disk use predictable.
try {
    if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 1048576)) {
        Move-Item -Force $logFile "$logFile.1"
    }
} catch {}

function Log($m) {
    try { "$(Get-Date -Format 'HH:mm:ss.fff') [notif] $m" | Out-File $logFile -Append -Encoding utf8 } catch {}
}
Log "===== notification fired ====="

$stdin = [Console]::In.ReadToEnd()
if (-not $stdin) { Log "EXIT: no stdin"; exit 0 }

try { $payload = $stdin | ConvertFrom-Json } catch { Log "EXIT: JSON parse fail"; exit 0 }
$message = $payload.message
$sessionId = $payload.session_id
$sessionShort = if ($sessionId -and $sessionId.Length -ge 8) { $sessionId.Substring(0, 8) } else { 'unknown0' }
# Reject anything that isn't 8 hex chars (path traversal defence on the filename below).
if (-not ($sessionShort -match '^[a-f0-9]{8}$')) { $sessionShort = 'unknown0' }
if (-not $message) { exit 0 }

# Only fire on permission prompts (skip "Claude is waiting" idle messages)
if ($message -notmatch 'permission') { Log "SKIP: not a permission prompt"; exit 0 }
$spoken = "Claude needs permission. $message"

# Config
$edgeVoice = 'en-GB-RyanNeural'
$openaiVoice = 'onyx'
$openaiApiKey = $null
if (Test-Path $configPath) {
    try {
        $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
        if ($cfg.voices.edge_response) { $edgeVoice = $cfg.voices.edge_response }
        if ($cfg.voices.openai_response) { $openaiVoice = $cfg.voices.openai_response }
        if ($cfg.openai_api_key) { $openaiApiKey = $cfg.openai_api_key }
    } catch {}
}
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

if (-not (Test-Path $queueDir)) {
    New-Item -ItemType Directory -Path $queueDir -Force | Out-Null
}

$timestamp = Get-Date -Format 'yyyyMMddTHHmmssfff'
$basePath = Join-Path $queueDir ($timestamp + '-notif-' + $sessionShort)
$edgeOut = "$basePath.mp3"
$wavOut = "$basePath.wav"

$delivered = $null
try {
    $spoken | python $edgeScript $edgeVoice $edgeOut 2>$null
    if ($LASTEXITCODE -eq 0 -and (Test-Path $edgeOut) -and (Get-Item $edgeOut).Length -gt 500) {
        Log "edge-tts OK: $edgeOut"
        $delivered = $edgeOut
    } else {
        Log "edge-tts FAIL exit=$LASTEXITCODE, fallback to OpenAI"
        Remove-Item $edgeOut -ErrorAction SilentlyContinue
    }
} catch {
    Log "edge-tts EXCEPTION: $($_.Exception.Message)"
}

if (-not $delivered -and $openaiApiKey) {
    $body = @{
        model = 'gpt-4o-mini-tts'
        voice = $openaiVoice
        input = $spoken
        instructions = 'Speak with a calm, alerting tone. Clear and direct, like a brief notification.'
        response_format = 'wav'
    } | ConvertTo-Json -Compress
    $bodyBytes = [Text.Encoding]::UTF8.GetBytes($body)
    try {
        Invoke-WebRequest -Uri 'https://api.openai.com/v1/audio/speech' `
            -Method Post `
            -Headers @{ 'Authorization' = "Bearer $openaiApiKey"; 'Content-Type' = 'application/json; charset=utf-8' } `
            -Body $bodyBytes -OutFile $wavOut -UseBasicParsing -TimeoutSec 30
        if ((Test-Path $wavOut) -and (Get-Item $wavOut).Length -ge 100) {
            Log "OpenAI fallback OK"
            $delivered = $wavOut
        }
    } catch {
        Log "EXIT: OpenAI fallback fail: $($_.Exception.Message)"
    }
}

if ($delivered) { Log "DONE: $delivered" } else { Log "EXIT: all TTS providers failed" }
exit 0
