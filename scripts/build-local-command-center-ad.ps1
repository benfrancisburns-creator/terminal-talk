#requires -Version 5.1

$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path .).Path
$Tmp = Join-Path $Root 'tmp\local-command-center-ad'
$VideoDir = Join-Path $Root 'docs\videos'
$Bundle = Join-Path $Root 'docs\assets\ad\ai-video-upload-bundle'
$Manifest = Join-Path $Bundle 'dialogue-manifest.json'
$Renderer = Join-Path $Root 'scripts\render-local-command-center-ad.cjs'
$Electron = Join-Path $Root 'app\node_modules\electron\dist\electron.exe'
if (!(Test-Path $Electron)) { $Electron = Join-Path $Root 'app\node_modules\.bin\electron.cmd' }

$DurationMs = 54000
$DurationSec = '54'
$Visual = Join-Path $Tmp 'terminal-talk-local-command-center-visual.webm'
$Music = Join-Path $Tmp 'music.wav'
$Dialogue = Join-Path $Tmp 'dialogue.wav'
$Webm = Join-Path $VideoDir 'terminal-talk-local-command-center-ad.webm'
$Mp4 = Join-Path $VideoDir 'terminal-talk-local-command-center-ad.mp4'

if (!(Test-Path $Renderer)) { throw "Missing renderer: $Renderer" }
if (!(Test-Path $Electron)) { throw "Electron not found at $Electron. Run npm install in app/ first." }
if (!(Test-Path $Manifest)) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\build-ai-video-upload-bundle.ps1')
}
if (!(Test-Path $Manifest)) { throw "Missing dialogue manifest: $Manifest" }

New-Item -ItemType Directory -Path $Tmp, $VideoDir -Force | Out-Null

function Get-FfmpegPath {
  $cmd = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  try {
    $fromPython = (& python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())" 2>$null).Trim()
    if ($fromPython -and (Test-Path $fromPython)) { return $fromPython }
  } catch {}
  return $null
}

function Wait-FileStable([string]$Path, [int]$TimeoutSec = 110) {
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

function Convert-TimeToMs([string]$Value) {
  if ($Value -match '^(\d+):(\d+(?:\.\d+)?)$') {
    return [int]([double]$Matches[1] * 60000 + [double]$Matches[2] * 1000)
  }
  throw "Bad time value: $Value"
}

$ffmpeg = Get-FfmpegPath
if (!$ffmpeg) { throw "ffmpeg not found." }

Remove-Item -LiteralPath $Visual, $Music, $Dialogue, $Webm, $Mp4 -Force -ErrorAction SilentlyContinue

Write-Host "[local-ad] rendering procedural command center"
$renderArgs = @($Renderer, '--out', $Visual, '--duration-ms', [string]$DurationMs)
$renderProc = Start-Process -FilePath $Electron -ArgumentList $renderArgs -WorkingDirectory $Root -PassThru
Wait-FileStable $Visual 120
try { Wait-Process -Id $renderProc.Id -Timeout 5 -ErrorAction SilentlyContinue } catch {}

Write-Host "[local-ad] building dialogue track"
$items = Get-Content -Raw $Manifest | ConvertFrom-Json
$ffmpegArgs = @('-y', '-hide_banner', '-loglevel', 'error')
$filters = @()
$mixInputs = ''
$index = 0
foreach ($item in $items) {
  $audioPath = Join-Path $Bundle $item.audio
  if (!(Test-Path -LiteralPath $audioPath)) { throw "Missing dialogue audio: $audioPath" }
  $delay = Convert-TimeToMs $item.start
  $ffmpegArgs += @('-i', $audioPath)
  $filters += "[$index`:a]adelay=$delay|$delay,volume=1.15[a$index]"
  $mixInputs += "[a$index]"
  $index++
}
$dialogueFilter = ($filters -join ';') + ";${mixInputs}amix=inputs=$index`:duration=longest:normalize=0,apad,atrim=duration=$DurationSec,alimiter=limit=0.94[a]"
& $ffmpeg @ffmpegArgs -filter_complex $dialogueFilter -map '[a]' -ar 48000 -ac 2 $Dialogue
if ($LASTEXITCODE -ne 0 -or !(Test-Path $Dialogue)) { throw "dialogue mix failed" }

Write-Host "[local-ad] building music bed"
& $ffmpeg -y -hide_banner -loglevel error `
  -f lavfi -i "sine=frequency=48:duration=$DurationSec" `
  -f lavfi -i "sine=frequency=96:duration=$DurationSec" `
  -f lavfi -i "sine=frequency=192:duration=$DurationSec" `
  -f lavfi -i "anoisesrc=color=pink:amplitude=0.05:duration=$DurationSec" `
  -filter_complex "[0:a]volume=0.10,afade=t=in:st=0:d=2,afade=t=out:st=51:d=3[b0];[1:a]volume=0.052,afade=t=in:st=6:d=3,afade=t=out:st=51:d=3[b1];[2:a]volume=0.022,afade=t=in:st=18:d=3,afade=t=out:st=51:d=3[b2];[3:a]highpass=f=300,lowpass=f=2500,volume=0.045,afade=t=in:st=0:d=2,afade=t=out:st=51:d=3[n];[b0][b1][b2][n]amix=inputs=4:duration=longest:normalize=0,alimiter=limit=0.50[m]" `
  -map '[m]' -ar 48000 -ac 2 $Music
if ($LASTEXITCODE -ne 0 -or !(Test-Path $Music)) { throw "music bed failed" }

Write-Host "[local-ad] muxing webm"
& $ffmpeg -y -hide_banner -loglevel error `
  -i $Visual -i $Dialogue -i $Music `
  -filter_complex "[1:a]volume=1.0[d];[2:a]volume=0.42[m];[d][m]amix=inputs=2:duration=longest:normalize=0,apad,atrim=duration=$DurationSec,alimiter=limit=0.95[a]" `
  -map 0:v:0 -map '[a]' `
  -c:v libvpx-vp9 -crf 28 -b:v 0 -pix_fmt yuv420p `
  -c:a libopus -b:a 128k -t $DurationSec $Webm
if ($LASTEXITCODE -ne 0 -or !(Test-Path $Webm)) { throw "webm encode failed" }

Write-Host "[local-ad] writing mp4"
& $ffmpeg -y -hide_banner -loglevel error `
  -i $Webm -map 0:v:0 -map 0:a:0 `
  -c:v libx264 -preset medium -crf 22 -pix_fmt yuv420p `
  -c:a aac -b:a 192k -movflags +faststart $Mp4
if ($LASTEXITCODE -ne 0 -or !(Test-Path $Mp4)) { throw "mp4 encode failed" }

Write-Host "OK - wrote $Webm"
Write-Host "OK - wrote $Mp4"
