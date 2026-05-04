#requires -Version 5.1
param(
  [int]$DurationMs = 46000
)

$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path .).Path
$Tmp = Join-Path $Root 'tmp\user-hero'
$VideoDir = Join-Path $Root 'docs\videos'
$Renderer = Join-Path $Root 'scripts\render-marketing-ad.cjs'
$Background = Join-Path $Root 'docs\assets\ad\terminal-talk-command-center.png'
$Electron = Join-Path $Root 'app\node_modules\electron\dist\electron.exe'
if (!(Test-Path $Electron)) { $Electron = Join-Path $Root 'app\node_modules\.bin\electron.cmd' }

$VisualRaw = Join-Path $Tmp 'terminal-talk-user-hero-visual.webm'
$Webm = Join-Path $VideoDir 'terminal-talk-user-hero.webm'
$Mp4 = Join-Path $VideoDir 'terminal-talk-user-hero.mp4'
$Stage = Join-Path $Tmp 'stage.html'

if (!(Test-Path $Renderer)) { throw "Missing renderer: $Renderer" }
if (!(Test-Path $Background)) { throw "Missing background plate: $Background" }
if (!(Test-Path $Electron)) { throw "Electron not found at $Electron. Run npm install in app/ first." }

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

function Wait-FileStable([string]$Path, [int]$TimeoutSec = 100) {
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

$ffmpeg = Get-FfmpegPath
if (!$ffmpeg) { throw "ffmpeg not found." }

Remove-Item -LiteralPath $VisualRaw, $Webm, $Mp4 -Force -ErrorAction SilentlyContinue

Write-Host "[hero] rendering refreshed feature hero"
$renderArgs = @(
  $Renderer,
  '--out', $VisualRaw,
  '--page', $Stage,
  '--duration-ms', [string]$DurationMs,
  '--background', $Background
)
$renderProc = Start-Process -FilePath $Electron -ArgumentList $renderArgs -WorkingDirectory $Root -PassThru
Wait-FileStable $VisualRaw 120
try { Wait-Process -Id $renderProc.Id -Timeout 5 -ErrorAction SilentlyContinue } catch {}
if (!(Test-Path $VisualRaw)) { throw "hero visual render failed" }

$durationSec = ([double]($DurationMs / 1000.0)).ToString('0.###', [System.Globalization.CultureInfo]::InvariantCulture)
Write-Host "[hero] compressing webm"
& $ffmpeg -y -hide_banner -loglevel error `
  -i $VisualRaw -map 0:v:0 -an `
  -c:v libvpx-vp9 -crf 28 -b:v 0 -pix_fmt yuv420p `
  -t $durationSec $Webm
if ($LASTEXITCODE -ne 0 -or !(Test-Path $Webm)) { throw "hero webm encode failed" }

Write-Host "[hero] writing mp4 compatibility copy"
& $ffmpeg -y -hide_banner -loglevel error `
  -i $Webm -map 0:v:0 -an `
  -c:v libx264 -preset medium -crf 22 -pix_fmt yuv420p `
  -movflags +faststart $Mp4
if ($LASTEXITCODE -ne 0 -or !(Test-Path $Mp4)) { throw "hero mp4 encode failed" }

Write-Host "OK - wrote $Webm"
Write-Host "OK - wrote $Mp4"
