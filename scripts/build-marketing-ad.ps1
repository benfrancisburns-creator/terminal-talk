#requires -Version 5.1
param(
  [int]$DurationMs = 46000
)

$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path .).Path
$Tmp = Join-Path $Root 'tmp\marketing-ad'
$VideoDir = Join-Path $Root 'docs\videos'
$AssetDir = Join-Path $Root 'docs\assets\ad'
$Background = Join-Path $AssetDir 'terminal-talk-command-center.png'
$Renderer = Join-Path $Root 'scripts\render-marketing-ad.cjs'
$EdgeScript = Join-Path $Root 'app\edge_tts_speak.py'
$Electron = Join-Path $Root 'app\node_modules\electron\dist\electron.exe'
if (!(Test-Path $Electron)) { $Electron = Join-Path $Root 'app\node_modules\.bin\electron.cmd' }

$VisualRaw = Join-Path $Tmp 'terminal-talk-command-center-ad-visual.webm'
$Narration = Join-Path $Tmp 'narration.mp3'
$NarrationWav = Join-Path $Tmp 'narration.wav'
$Music = Join-Path $Tmp 'music.wav'
$Webm = Join-Path $VideoDir 'terminal-talk-command-center-ad.webm'
$Mp4 = Join-Path $VideoDir 'terminal-talk-command-center-ad.mp4'

if (!(Test-Path $Background)) { throw "Missing background plate: $Background" }
if (!(Test-Path $Renderer)) { throw "Missing renderer: $Renderer" }
if (!(Test-Path $Electron)) { throw "Electron not found at $Electron. Run npm install in app/ first." }

New-Item -ItemType Directory -Path $Tmp, $VideoDir -Force | Out-Null

$copy = @'
Terminal Talk turns every busy terminal into a calm command center.
Claude Code hooks and Codex rollout logs feed one spoken queue, with native session identity layered on top.
Colours, labels, tabs, transcripts, auto voices, and heartbeat overrides keep each terminal readable by sight and by ear.
Use Hey Jarvis for priority clips, then let auto collapse and auto prune keep the toolbar quiet.
Settings cover shortcuts, playback, OpenAI primary and fallback routing, sessions, and speech rules.
Keep building while Terminal Talk watches Claude Code and Codex.
'@

function Get-FfmpegPath {
  $cmd = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  try {
    $fromPython = (& python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())" 2>$null).Trim()
    if ($fromPython -and (Test-Path $fromPython)) { return $fromPython }
  } catch {}
  return $null
}

function Wait-FileStable([string]$Path, [int]$TimeoutSec = 90) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $lastLength = -1
  $stableReads = 0
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $Path) {
      $length = (Get-Item -LiteralPath $Path).Length
      if ($length -gt 0 -and $length -eq $lastLength) {
        $stableReads++
        if ($stableReads -ge 3) { return }
      } else {
        $stableReads = 0
        $lastLength = $length
      }
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Timed out waiting for stable file: $Path"
}

function New-LocalNarration([string]$Path) {
  Add-Type -AssemblyName System.Speech
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $voice = $synth.GetInstalledVoices() |
    Where-Object { $_.VoiceInfo.Culture.Name -eq 'en-GB' } |
    Select-Object -First 1
  if ($voice) { $synth.SelectVoice($voice.VoiceInfo.Name) }
  $synth.Rate = 0
  $synth.Volume = 100
  $synth.SetOutputToWaveFile($Path)
  $synth.Speak($copy)
  $synth.Dispose()
}

$ffmpeg = Get-FfmpegPath
if (!$ffmpeg) { throw "ffmpeg not found." }

Remove-Item -LiteralPath $VisualRaw, $Narration, $NarrationWav, $Music, $Webm, $Mp4 -Force -ErrorAction SilentlyContinue

Write-Host "[ad] synthesising narration"
$edgeOk = $false
if (Test-Path $EdgeScript) {
  try {
    $copy | python $EdgeScript 'en-GB-RyanNeural' $Narration 2>$null
    $edgeOk = ($LASTEXITCODE -eq 0 -and (Test-Path $Narration) -and (Get-Item $Narration).Length -gt 500)
  } catch {
    $edgeOk = $false
  }
}
if (!$edgeOk) {
  Write-Host "[ad] edge TTS unavailable; falling back to local Windows voice"
  New-LocalNarration $NarrationWav
}

Write-Host "[ad] rendering visual canvas"
$renderArgs = @(
  $Renderer,
  '--out', $VisualRaw,
  '--duration-ms', [string]$DurationMs,
  '--background', $Background
)
$renderProc = Start-Process -FilePath $Electron -ArgumentList $renderArgs -WorkingDirectory $Root -PassThru
Wait-FileStable $VisualRaw 100
try {
  Wait-Process -Id $renderProc.Id -Timeout 5 -ErrorAction SilentlyContinue
} catch {}
if (!(Test-Path $VisualRaw)) { throw "visual render failed" }

$durationSec = ([double]($DurationMs / 1000.0)).ToString('0.###', [System.Globalization.CultureInfo]::InvariantCulture)
Write-Host "[ad] building music bed"
& $ffmpeg -y -hide_banner -loglevel error `
  -f lavfi -i "sine=frequency=55:duration=$durationSec" `
  -f lavfi -i "sine=frequency=110:duration=$durationSec" `
  -f lavfi -i "sine=frequency=220:duration=$durationSec" `
  -f lavfi -i "anoisesrc=color=pink:amplitude=0.05:duration=$durationSec" `
  -filter_complex "[0:a]volume=0.12,afade=t=in:st=0:d=2,afade=t=out:st=43.5:d=2.5[b0];[1:a]volume=0.055,afade=t=in:st=4:d=3,afade=t=out:st=43.5:d=2.5[b1];[2:a]volume=0.026,afade=t=in:st=14:d=3,afade=t=out:st=43.5:d=2.5[b2];[3:a]highpass=f=320,lowpass=f=2600,volume=0.055,afade=t=in:st=0:d=2,afade=t=out:st=43.5:d=2.5[n];[b0][b1][b2][n]amix=inputs=4:duration=longest:normalize=0,alimiter=limit=0.55[m]" `
  -map "[m]" -ar 48000 -ac 2 $Music
if ($LASTEXITCODE -ne 0 -or !(Test-Path $Music)) { throw "music bed failed" }

$narrationInput = if ($edgeOk) { $Narration } else { $NarrationWav }
Write-Host "[ad] muxing webm"
& $ffmpeg -y -hide_banner -loglevel error `
  -i $VisualRaw -i $narrationInput -i $Music `
  -filter_complex "[1:a]adelay=650|650,volume=1.15[narr];[2:a]volume=0.55[music];[narr][music]amix=inputs=2:duration=longest:normalize=0,apad,atrim=duration=$durationSec,alimiter=limit=0.95[a]" `
  -map 0:v:0 -map "[a]" `
  -c:v libvpx-vp9 -crf 28 -b:v 0 -pix_fmt yuv420p `
  -c:a libopus -b:a 128k -t $durationSec $Webm
if ($LASTEXITCODE -ne 0 -or !(Test-Path $Webm)) { throw "webm encode failed" }

Write-Host "[ad] writing mp4 compatibility copy"
& $ffmpeg -y -hide_banner -loglevel error `
  -i $Webm -map 0:v:0 -map 0:a:0 `
  -c:v libx264 -preset medium -crf 22 -pix_fmt yuv420p `
  -c:a aac -b:a 192k -movflags +faststart $Mp4
if ($LASTEXITCODE -ne 0 -or !(Test-Path $Mp4)) { throw "mp4 encode failed" }

Write-Host "OK - wrote $Webm"
Write-Host "OK - wrote $Mp4"
