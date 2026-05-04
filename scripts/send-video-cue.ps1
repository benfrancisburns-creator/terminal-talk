#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Cue,
  [string]$Title = '',
  [string[]]$FallbackTitles = @(),
  [int]$ClickX = [int]::MinValue,
  [int]$ClickY = [int]::MinValue,
  [int]$DelayAfterFocusMs = 500,
  [switch]$NoEnter
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$sender = Join-Path $PSScriptRoot 'send-video-terminal-prompt.ps1'
if (-not (Test-Path -LiteralPath $sender)) {
  throw "Prompt sender not found: $sender"
}

$cueClean = $Cue.Trim().ToUpperInvariant()
$cueMap = @{
  'CLAUDE-A' = @{ Title = 'Claude TT A'; File = 'docs/video-narration/claude-tt-a.md'; Fallback = @('Claude TT - Claude TT A', 'ClaudeTTA') }
  'CODEX-A'  = @{ Title = 'Codex TT A';  File = 'docs/video-narration/codex-tt-a.md';  Fallback = @('Codex TT - Codex TT A', 'CodexTTA') }
  'CLAUDE-B' = @{ Title = 'Claude TT B'; File = 'docs/video-narration/claude-tt-b.md'; Fallback = @('Claude TT - Claude TT B', 'ClaudeTTB') }
  'CODEX-B'  = @{ Title = 'Codex TT B';  File = 'docs/video-narration/codex-tt-b.md';  Fallback = @('Codex TT - Codex TT B', 'CodexTTB') }
}

$prefix = $null
foreach ($key in $cueMap.Keys) {
  if ($cueClean.StartsWith($key + '-', [StringComparison]::OrdinalIgnoreCase)) {
    $prefix = $key
    break
  }
}
if (-not $prefix) {
  throw "Unknown cue '$Cue'. Expected CLAUDE-A-xx, CODEX-A-xx, CLAUDE-B-xx, or CODEX-B-xx."
}

$target = $cueMap[$prefix]
$targetTitle = if ($Title) { $Title } else { [string]$target.Title }
$fallback = @([string[]]$target.Fallback) + @($FallbackTitles)
$prompt = "Read $($target.File) and output cue $cueClean only."

$useClickTarget = $ClickX -ne [int]::MinValue -and $ClickY -ne [int]::MinValue

$argsList = @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', $sender,
  '-Title', $targetTitle,
  '-Prompt', $prompt,
  '-DelayAfterFocusMs', [string]$DelayAfterFocusMs
)
if (!$useClickTarget -and $fallback.Count -gt 0) {
  $argsList += '-FallbackTitles'
  $argsList += $fallback
}
if ($useClickTarget) {
  $argsList += @('-ClickX', [string]$ClickX, '-ClickY', [string]$ClickY)
}
if ($NoEnter) { $argsList += '-NoEnter' }

Push-Location $repoRoot
try {
  & powershell.exe @argsList
} finally {
  Pop-Location
}
