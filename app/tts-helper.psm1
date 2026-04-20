# TTS helper module -- canonical `edge-tts + OpenAI-fallback` chain.
#
# Extracts ~90 lines of duplicated logic that used to live copy-pasted
# in hooks/speak-response.ps1 AND hooks/speak-notification.ps1, with
# subtly different retry counts and timeout-secs. Audit CC-8.
#
# Shape:
#   Resolve-OpenAiApiKey  -> string|null
#       walks env -> config.secrets.json -> config.json -> ~/.claude/.env
#   Invoke-EdgeTts        -> bool          (spawn python edge_tts_speak.py)
#   Invoke-OpenAiTts      -> bool          (POST to OpenAI speech endpoint)
#   Invoke-TtsWithFallback -> path|null    (edge-tts first, OpenAI if configured)
#
# The module is language-agnostic: both hooks dot-source it via
# Import-Module and call the same functions. Callers supply the edge-tts
# script path, voices, output base path, and optional per-call OpenAI
# instruction string.

function Resolve-OpenAiApiKey {
    <#
    .SYNOPSIS
    Resolve the OpenAI API key in priority order:
      1. $env:OPENAI_API_KEY
      2. $ttHome/config.secrets.json (D2 safeStorage sidecar -- main.js
         writes decrypted key here after unwrapping safeStorage.encrypted)
      3. $ConfigPath (legacy config.json.openai_api_key -- kept so v0.2
         installs still work until main.js migrates them)
      4. ~/.claude/.env OPENAI_API_KEY=... line
    Returns $null if none found. Never throws.

    The sidecar takes precedence over legacy config.json so once main.js
    has written the sidecar for the first time the old plaintext copy
    (if still present) becomes ignored by hooks.
    #>
    param(
        [Parameter(Mandatory = $true)] [string]$ConfigPath
    )
    if ($env:OPENAI_API_KEY) { return $env:OPENAI_API_KEY.Trim() }

    # D2 safeStorage sidecar. Same directory as ConfigPath.
    $secretsPath = Join-Path (Split-Path -Parent $ConfigPath) 'config.secrets.json'
    if (Test-Path $secretsPath) {
        try {
            $s = Get-Content $secretsPath -Raw -Encoding utf8 | ConvertFrom-Json
            if ($s.openai_api_key) { return [string]$s.openai_api_key }
        } catch {}
    }

    if (Test-Path $ConfigPath) {
        try {
            $cfg = Get-Content $ConfigPath -Raw -Encoding utf8 | ConvertFrom-Json
            if ($cfg.openai_api_key) { return [string]$cfg.openai_api_key }
        } catch {}
    }

    $claudeEnv = Join-Path $env:USERPROFILE '.claude\.env'
    if (Test-Path $claudeEnv) {
        try {
            Get-Content $claudeEnv | ForEach-Object {
                if ($_ -match '^\s*OPENAI_API_KEY\s*=\s*(.+)\s*$') {
                    $k = $Matches[1].Trim().Trim('"').Trim("'")
                    if ($k) { return $k }
                }
            }
        } catch {}
    }
    return $null
}

function Invoke-EdgeTts {
    <#
    .SYNOPSIS
    Spawn edge_tts_speak.py to synthesise `$Text` into `$OutMp3`.
    Returns $true on success (file exists + > 500 bytes), $false otherwise.
    Cleans up the output file on failure so callers can fall through to
    OpenAI without inheriting a partial mp3.
    #>
    param(
        [Parameter(Mandatory = $true)] [string]$EdgeScriptPath,
        [Parameter(Mandatory = $true)] [string]$Voice,
        [Parameter(Mandatory = $true)] [string]$Text,
        [Parameter(Mandatory = $true)] [string]$OutMp3
    )
    try {
        $Text | python $EdgeScriptPath $Voice $OutMp3 2>$null
        if ($LASTEXITCODE -eq 0 -and (Test-Path $OutMp3) -and (Get-Item $OutMp3).Length -gt 500) {
            return $true
        }
    } catch {}
    if (Test-Path $OutMp3) { Remove-Item $OutMp3 -ErrorAction SilentlyContinue }
    return $false
}

function Invoke-OpenAiTts {
    <#
    .SYNOPSIS
    POST to api.openai.com/v1/audio/speech. Writes wav to `$OutWav`.
    Returns $true on success (wav > 100 bytes), $false otherwise.
    #>
    param(
        [Parameter(Mandatory = $true)] [string]$ApiKey,
        [Parameter(Mandatory = $true)] [string]$Voice,
        [Parameter(Mandatory = $true)] [string]$Text,
        [Parameter(Mandatory = $true)] [string]$OutWav,
        [string]$Instructions = 'Speak in a calm, clear, conversational tone.',
        [int]$TimeoutSec = 60
    )
    $body = @{
        model           = 'gpt-4o-mini-tts'
        voice           = $Voice
        input           = $Text
        instructions    = $Instructions
        response_format = 'wav'
    } | ConvertTo-Json -Compress
    $bodyBytes = [Text.Encoding]::UTF8.GetBytes($body)
    try {
        Invoke-WebRequest -Uri 'https://api.openai.com/v1/audio/speech' `
            -Method Post `
            -Headers @{
                'Authorization' = "Bearer $ApiKey"
                'Content-Type'  = 'application/json; charset=utf-8'
            } `
            -Body $bodyBytes -OutFile $OutWav -UseBasicParsing -TimeoutSec $TimeoutSec
        if ((Test-Path $OutWav) -and (Get-Item $OutWav).Length -ge 100) { return $true }
    } catch {}
    return $false
}

function Invoke-TtsWithFallback {
    <#
    .SYNOPSIS
    Run the canonical edge-tts → OpenAI fallback chain. Returns the path
    to the produced audio file on success, or $null on total failure.

    `$BasePath` is the output path WITHOUT extension -- this helper adds
    `.mp3` (edge) or `.wav` (OpenAI).
    #>
    param(
        [Parameter(Mandatory = $true)] [string]$EdgeScriptPath,
        [Parameter(Mandatory = $true)] [string]$EdgeVoice,
        [Parameter(Mandatory = $true)] [string]$OpenAiVoice,
        [Parameter(Mandatory = $true)] [string]$Text,
        [Parameter(Mandatory = $true)] [string]$BasePath,
        [string]$OpenAiApiKey,
        [string]$OpenAiInstructions = 'Speak in a calm, clear, conversational tone.',
        [int]$OpenAiTimeoutSec = 60
    )
    $mp3 = "$BasePath.mp3"
    if (Invoke-EdgeTts -EdgeScriptPath $EdgeScriptPath -Voice $EdgeVoice -Text $Text -OutMp3 $mp3) {
        return $mp3
    }
    if (-not $OpenAiApiKey) { return $null }
    $wav = "$BasePath.wav"
    if (Invoke-OpenAiTts -ApiKey $OpenAiApiKey -Voice $OpenAiVoice -Text $Text `
                         -OutWav $wav -Instructions $OpenAiInstructions `
                         -TimeoutSec $OpenAiTimeoutSec) {
        return $wav
    }
    return $null
}

Export-ModuleMember -Function Resolve-OpenAiApiKey, Invoke-EdgeTts, Invoke-OpenAiTts, Invoke-TtsWithFallback
