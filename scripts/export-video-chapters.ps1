#requires -Version 5.1
[CmdletBinding()]
param(
  [string]$Manifest = 'docs/video-narration/master-demo-chapters.json',
  [string]$Source = '',
  [string]$OutputDir = '',
  [string[]]$Chapter = @(),
  [ValidateSet('mp4', 'webm', 'both')]
  [string]$Format = 'both',
  [switch]$FastCopy
)

$ErrorActionPreference = 'Stop'

function Get-FfmpegPath {
  $cmd = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  try {
    $fromPython = (& python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())" 2>$null).Trim()
    if ($fromPython -and (Test-Path -LiteralPath $fromPython)) { return $fromPython }
  } catch {}
  throw 'ffmpeg not found. Install ffmpeg or ensure imageio_ffmpeg is available to Python.'
}

function Resolve-RepoPath([string]$PathValue) {
  if ([string]::IsNullOrWhiteSpace($PathValue)) { return '' }
  if ([System.IO.Path]::IsPathRooted($PathValue)) { return $PathValue }
  return Join-Path (Resolve-Path .) $PathValue
}

function Convert-TimeToSeconds([string]$Value) {
  if ($Value -notmatch '^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$') {
    throw "Invalid timestamp '$Value'. Use HH:MM:SS or HH:MM:SS.mmm."
  }
  $ms = if ($Matches[4]) { [int]($Matches[4].PadRight(3, '0').Substring(0, 3)) } else { 0 }
  return ([int]$Matches[1] * 3600) + ([int]$Matches[2] * 60) + [int]$Matches[3] + ($ms / 1000.0)
}

function Get-DurationSeconds($Chapter) {
  $start = Convert-TimeToSeconds ([string]$Chapter.start)
  $end = Convert-TimeToSeconds ([string]$Chapter.end)
  if ($end -le $start) { throw "Chapter '$($Chapter.id)' end must be after start." }
  return $end - $start
}

function New-SafeName([string]$Value) {
  $clean = ($Value -replace '[^A-Za-z0-9_-]+', '-').Trim('-')
  if (!$clean) { return 'chapter' }
  return $clean.ToLowerInvariant()
}

if (!(Test-Path -LiteralPath $Manifest)) { throw "Manifest not found: $Manifest" }
$manifestJson = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
$sourcePath = Resolve-RepoPath $(if ($Source) { $Source } else { [string]$manifestJson.source })
if (!(Test-Path -LiteralPath $sourcePath)) { throw "Source video not found: $sourcePath" }

$outRoot = Resolve-RepoPath $(if ($OutputDir) { $OutputDir } else { [string]$manifestJson.outputDir })
if (!$outRoot) { $outRoot = Join-Path (Resolve-Path .) 'docs/videos/chapters' }
New-Item -ItemType Directory -Path $outRoot -Force | Out-Null

$chapters = @($manifestJson.chapters)
if ($Chapter.Count -gt 0) {
  $wanted = @{}
  foreach ($id in $Chapter) { $wanted[$id] = $true }
  $chapters = $chapters | Where-Object { $wanted.ContainsKey([string]$_.id) }
}
if ($chapters.Count -eq 0) { throw 'No chapters selected.' }

$ffmpeg = Get-FfmpegPath

foreach ($ch in $chapters) {
  $id = New-SafeName ([string]$ch.id)
  $start = [string]$ch.start
  $duration = Get-DurationSeconds $ch
  $durationText = $duration.ToString('0.###', [System.Globalization.CultureInfo]::InvariantCulture)

  if ($Format -in @('mp4', 'both')) {
    $mp4 = Join-Path $outRoot "$id.mp4"
    if ($FastCopy) {
      & $ffmpeg -y -hide_banner -loglevel error -ss $start -i $sourcePath -t $durationText -map 0:v:0 -map 0:a? -c copy -movflags +faststart $mp4
    } else {
      & $ffmpeg -y -hide_banner -loglevel error -ss $start -i $sourcePath -t $durationText -map 0:v:0 -map 0:a? -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart $mp4
    }
    if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $mp4)) { throw "Failed to export MP4 chapter: $id" }
    Write-Host "OK - wrote $mp4"
  }

  if ($Format -in @('webm', 'both')) {
    $webm = Join-Path $outRoot "$id.webm"
    & $ffmpeg -y -hide_banner -loglevel error -ss $start -i $sourcePath -t $durationText -map 0:v:0 -map 0:a? -c:v libvpx-vp9 -deadline good -cpu-used 4 -crf 36 -b:v 0 -pix_fmt yuv420p -c:a libopus -b:a 128k $webm
    if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $webm)) { throw "Failed to export WebM chapter: $id" }
    Write-Host "OK - wrote $webm"
  }
}
