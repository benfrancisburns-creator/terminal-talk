param(
    [string]$AudioPath,
    [switch]$Record,
    [switch]$Copy,
    [switch]$Paste,
    [switch]$Install,
    [switch]$Warmup,
    [switch]$KeepWav,
    [switch]$SaveTiming,
    [switch]$Json,
    [string]$StopFile,
    [switch]$NoSilenceStop,
    [ValidateSet('off','local','smart')]
    [string]$Cleanup = 'local',
    [ValidateSet('local','openai')]
    [string]$CleanupProvider = 'local',
    [string]$CleanupModel = 'gpt-5.4-mini',
    [int]$CleanupTimeout = 20,
    [string]$Model = 'base.en',
    [int]$MaxSeconds = 180,
    [int]$SilenceMs = 900,
    [double]$StartThreshold = 0.006
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$pythonScript = Join-Path $PSScriptRoot 'whisper-dictate.py'
$pkgDir = Join-Path $repoRoot '.codex-transcribe-pkgs'
$modelDir = Join-Path $repoRoot '.codex-transcribe-cache'
$dictationDir = Join-Path $env:USERPROFILE '.terminal-talk\dictation'

function Invoke-Python {
    param([string[]]$PythonArgs)
    $env:PYTHONPATH = $pkgDir
    & python @PythonArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Python transcription failed with exit code $LASTEXITCODE."
    }
}

if ($Install) {
    New-Item -ItemType Directory -Path $pkgDir -Force | Out-Null
    python -m pip install --upgrade --target $pkgDir openai-whisper
    if ($LASTEXITCODE -ne 0) { throw 'Failed to install openai-whisper.' }
}

if ($Warmup) {
    $warmupWav = Join-Path $dictationDir 'warmup.wav'
    New-Item -ItemType Directory -Path $dictationDir -Force | Out-Null
    @'
from pathlib import Path
import wave
path = Path.home() / ".terminal-talk" / "dictation" / "warmup.wav"
path.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(path), "wb") as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(16000)
    wav.writeframes(b"\0\0" * 16000)
'@ | python -
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create warmup WAV.' }
    Invoke-Python -PythonArgs @($pythonScript, '--file', $warmupWav, '--model', $Model, '--model-dir', $modelDir) | Out-Null
    Write-Host "Whisper model '$Model' is ready."
    return
}

if (-not $Record -and -not $AudioPath) {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = 'Choose audio to transcribe'
    $dialog.Filter = 'Audio files (*.wav;*.mp3;*.m4a;*.mp4)|*.wav;*.mp3;*.m4a;*.mp4|All files (*.*)|*.*'
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        return
    }
    $AudioPath = $dialog.FileName
}

New-Item -ItemType Directory -Path $dictationDir -Force | Out-Null
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outPath = Join-Path $dictationDir "dictation-$timestamp.txt"
$wavPath = $null
$timingPath = $null

$pyArgs = @(
    $pythonScript,
    '--model', $Model,
    '--model-dir', $modelDir,
    '--out', $outPath,
    '--cleanup', $Cleanup,
    '--cleanup-provider', $CleanupProvider,
    '--cleanup-model', $CleanupModel,
    '--cleanup-timeout', [string]$CleanupTimeout
)
if ($Copy -or $Paste) { $pyArgs += '--copy' }

if ($Record) {
    $pyArgs += @(
        '--record',
        '--max-seconds', [string]$MaxSeconds,
        '--silence-ms', [string]$SilenceMs,
        '--start-threshold', [string]$StartThreshold
    )
    if ($KeepWav) {
        $wavPath = Join-Path $dictationDir "dictation-$timestamp.wav"
        $pyArgs += @('--keep-wav', $wavPath)
    }
    if ($SaveTiming) {
        $timingPath = Join-Path $dictationDir "dictation-$timestamp.segments.json"
        $pyArgs += @('--segments-out', $timingPath)
    }
    if ($StopFile) { $pyArgs += @('--stop-file', $StopFile) }
    if ($NoSilenceStop) { $pyArgs += '--no-silence-stop' }
} else {
    $resolvedAudioPath = (Resolve-Path -LiteralPath $AudioPath).Path
    $pyArgs += @('--file', $resolvedAudioPath)
    $sidecar = [System.IO.Path]::ChangeExtension($resolvedAudioPath, '.transcript.txt')
    $pyArgs[($pyArgs.IndexOf('--out') + 1)] = $sidecar
    $outPath = $sidecar
    if ($SaveTiming) {
        $timingPath = [System.IO.Path]::ChangeExtension($resolvedAudioPath, '.segments.json')
        $pyArgs += @('--segments-out', $timingPath)
    }
}

$transcript = (Invoke-Python -PythonArgs $pyArgs) -join "`n"
$pressEnter = $false
$enterPattern = '(?is)\s*(?:press\s+enter|send\s+it|submit\s+that)[\.\!\?]*\s*$'
$stopPattern = '(?is)\s*(?:hey\s+jarvis\s+)?(?:dictation\s+stop|stop\s+dictation|finish\s+dictation)[\.\!\?]*\s*$'
if ($transcript -match $enterPattern) {
    $pressEnter = $true
    $transcript = ($transcript -replace $enterPattern, '').Trim()
}
$transcript = ($transcript -replace $stopPattern, '').Trim()
if ($outPath) {
    Set-Content -LiteralPath $outPath -Value ($transcript + [Environment]::NewLine) -Encoding UTF8
}

Set-Clipboard -Value $transcript

if ($Paste) {
    Add-Type -AssemblyName System.Windows.Forms
    Start-Sleep -Milliseconds 150
    if ($transcript) {
        [System.Windows.Forms.SendKeys]::SendWait('^v')
    }
    if ($pressEnter) {
        Start-Sleep -Milliseconds 80
        [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    }
}

if ($Json) {
    [ordered]@{
        ok = $true
        transcript = $transcript
        path = [string]$outPath
        audio_path = [string]$wavPath
        timing_path = [string]$timingPath
        pasted = [bool]$Paste
        enter_pressed = [bool]$pressEnter
        copied = $true
    } | ConvertTo-Json -Compress
} else {
    Write-Host ''
    Write-Host $transcript
    Write-Host ''
    Write-Host "Transcript written to: $outPath"
    Write-Host 'Transcript copied to clipboard.'
}
