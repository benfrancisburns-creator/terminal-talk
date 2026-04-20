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
if (Test-Path $configPath) {
    try {
        $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
        if ($cfg.voices.edge_response) { $edgeVoice = $cfg.voices.edge_response }
        if ($cfg.voices.openai_response) { $openaiVoice = $cfg.voices.openai_response }
    } catch {}
}

# Shared TTS helper -- Resolve-OpenAiApiKey + Invoke-TtsWithFallback.
# Same canonical chain used by speak-response.ps1 (audit CC-8).
Import-Module (Join-Path $env:USERPROFILE '.terminal-talk\app\tts-helper.psm1') -Force -ErrorAction SilentlyContinue
$openaiApiKey = Resolve-OpenAiApiKey -ConfigPath $configPath

if (-not (Test-Path $queueDir)) {
    New-Item -ItemType Directory -Path $queueDir -Force | Out-Null
}

$timestamp = Get-Date -Format 'yyyyMMddTHHmmssfff'
$basePath  = Join-Path $queueDir ($timestamp + '-notif-' + $sessionShort)

# Canonical edge-tts + OpenAI fallback chain, 30 s timeout (notifications
# are short so the 60 s default is overkill).
$delivered = Invoke-TtsWithFallback `
    -EdgeScriptPath      $edgeScript `
    -EdgeVoice           $edgeVoice `
    -OpenAiVoice         $openaiVoice `
    -Text                $spoken `
    -BasePath            $basePath `
    -OpenAiApiKey        $openaiApiKey `
    -OpenAiInstructions  'Speak with a calm, alerting tone. Clear and direct, like a brief notification.' `
    -OpenAiTimeoutSec    30

if ($delivered) { Log "DONE: $delivered" } else { Log "EXIT: all TTS providers failed" }
exit 0
