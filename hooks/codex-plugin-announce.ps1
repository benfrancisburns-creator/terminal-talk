param(
    [string]$JobPath = '',
    [string]$Short = '',
    [string]$SessionId = '',
    [string]$Label = '',
    [string]$SourceCwd = '',
    [int]$Index = 0,
    [string]$Caller = 'codex-plugin-announce'
)

$ErrorActionPreference = 'SilentlyContinue'

$ttHome = if ($env:TT_HOME) { $env:TT_HOME } else { Join-Path $env:USERPROFILE '.terminal-talk' }
$queueDir = Join-Path $ttHome 'queue'
$configPath = Join-Path $ttHome 'config.json'
$edgeScript = Join-Path $ttHome 'app\edge_tts_speak.py'
$ttsHelper = Join-Path $ttHome 'app\tts-helper.psm1'
$logFile = Join-Path $queueDir '_hook.log'

function Log($m) {
    try {
        if (-not (Test-Path $queueDir)) { New-Item -ItemType Directory -Path $queueDir -Force | Out-Null }
        "$(Get-Date -Format 'HH:mm:ss.fff') [codex-plugin-announce] $m" | Out-File $logFile -Append -Encoding utf8
    } catch {}
}

if ($JobPath -and (Test-Path -LiteralPath $JobPath)) {
    try {
        $job = Get-Content -LiteralPath $JobPath -Raw -Encoding utf8 | ConvertFrom-Json
        if ($job.short) { $Short = [string]$job.short }
        if ($job.session_id) { $SessionId = [string]$job.session_id }
        if ($job.label) { $Label = [string]$job.label }
        if ($job.source_cwd) { $SourceCwd = [string]$job.source_cwd }
        if ($null -ne $job.index) { $Index = [int]$job.index }
        if ($job.caller) { $Caller = [string]$job.caller }
    } catch {}
}

$shortId = ([string]$Short).Trim().ToLowerInvariant()
if ($shortId -notmatch '^[a-f0-9]{8}$') { Log "EXIT: invalid short '$Short'"; exit 0 }

$cleanLabel = ([string]$Label -replace '[\r\n\t]+', ' ' -replace '\s{2,}', ' ').Trim()
if (-not $cleanLabel) { $cleanLabel = 'Claude Codex' }
if ($cleanLabel.Length -gt 80) { $cleanLabel = $cleanLabel.Substring(0, 80).Trim() }

$colourNames = @('red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta')
$colour = $colourNames[((($Index % 8) + 8) % 8)]
$project = ''
try { if ($SourceCwd) { $project = Split-Path -Leaf $SourceCwd } } catch {}
$project = ([string]$project -replace '[\r\n\t]+', ' ' -replace '\s{2,}', ' ').Trim()

$spoken = "Claude Code has started a Codex session"
if ($project) { $spoken += " for $project" }
$spoken += ". It will appear as $cleanLabel with the $colour marker. Session ID $shortId."

$edgeVoice = 'en-GB-RyanNeural'
$openaiVoice = 'onyx'
$provider = 'edge'
$fallbackProvider = 'edge'
if (Test-Path $configPath) {
    try {
        $cfg = Get-Content $configPath -Raw -Encoding utf8 | ConvertFrom-Json
        if ($cfg.voices.edge_response) { $edgeVoice = [string]$cfg.voices.edge_response }
        if ($cfg.voices.openai_response) { $openaiVoice = [string]$cfg.voices.openai_response }
        if ($cfg.playback.tts_provider) { $provider = [string]$cfg.playback.tts_provider }
        if ($cfg.playback.tts_fallback_provider) { $fallbackProvider = [string]$cfg.playback.tts_fallback_provider }
    } catch {}
}

Import-Module $ttsHelper -Force -ErrorAction SilentlyContinue
$openaiApiKey = Resolve-OpenAiApiKey -ConfigPath $configPath

try {
    if (-not (Test-Path $queueDir)) { New-Item -ItemType Directory -Path $queueDir -Force | Out-Null }
    $timestamp = Get-Date -Format 'yyyyMMddTHHmmssfff'
    $basePath = Join-Path $queueDir ($timestamp + '-plugin-start-' + $shortId)
    $delivered = Invoke-TtsWithFallback `
        -EdgeScriptPath $edgeScript `
        -EdgeVoice $edgeVoice `
        -OpenAiVoice $openaiVoice `
        -Text $spoken `
        -BasePath $basePath `
        -OpenAiApiKey $openaiApiKey `
        -OpenAiInstructions 'Speak as a concise session identity notification.' `
        -OpenAiTimeoutSec 30 `
        -Provider $provider `
        -FallbackProvider $fallbackProvider
    if ($delivered) {
        Log "DONE: short=$shortId file=$delivered caller=$Caller"
    } else {
        Log "EXIT: all TTS providers failed short=$shortId"
    }
} catch {
    Log "EXIT: failed short=${shortId}: $($_.Exception.Message)"
}

exit 0
