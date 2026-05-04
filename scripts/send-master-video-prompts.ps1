#requires -Version 5.1
[CmdletBinding()]
param(
  [ValidateSet('all', 'claude-a', 'codex-a', 'claude-b', 'codex-b')]
  [string]$Session = 'all',
  [switch]$UseQuadrantCoordinates,
  [int]$DelayBetweenMs = 250,
  [int]$DelayAfterFocusMs = 180,
  [switch]$NoEnter
)

$ErrorActionPreference = 'Stop'

$sender = Join-Path $PSScriptRoot 'send-video-terminal-prompt.ps1'
if (-not (Test-Path -LiteralPath $sender)) {
  throw "Prompt sender not found: $sender"
}

function Build-NarrationPrompt([string]$RelativePath) {
  $root = Split-Path -Parent $PSScriptRoot
  $full = Join-Path $root $RelativePath
  $body = (Get-Content -LiteralPath $full -Raw).Trim()
  return "Output only the Terminal Talk narration below. Do not add a preface.`r`n`r`n$body"
}

$sessions = [ordered]@{
  'claude-a' = [ordered]@{
    Title = 'Claude TT A'
    Fallback = @('Claude TT - Claude TT A', 'ClaudeTTA')
    X = -528
    Y = -600
    Prompt = Build-NarrationPrompt 'docs/video-narration/master-session-scripts/claude-tt-a.md'
  }
  'codex-a' = [ordered]@{
    Title = 'Codex TT A'
    Fallback = @('Codex TT - Codex TT A', 'CodexTTA')
    X = 432
    Y = -600
    Prompt = Build-NarrationPrompt 'docs/video-narration/master-session-scripts/codex-tt-a.md'
  }
  'claude-b' = [ordered]@{
    Title = 'Claude TT B'
    Fallback = @('Claude TT - Claude TT B', 'ClaudeTTB')
    X = -528
    Y = -84
    Prompt = Build-NarrationPrompt 'docs/video-narration/master-session-scripts/claude-tt-b.md'
  }
  'codex-b' = [ordered]@{
    Title = 'Codex TT B'
    Fallback = @('Codex TT - Codex TT B', 'CodexTTB')
    X = 432
    Y = -84
    Prompt = Build-NarrationPrompt 'docs/video-narration/master-session-scripts/codex-tt-b.md'
  }
}

if ($Session -eq 'all') {
  $targets = @('claude-a', 'codex-a', 'claude-b', 'codex-b')
} else {
  $targets = @($Session)
}

foreach ($key in $targets) {
  $target = $sessions[$key]
  $argsList = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $sender,
    '-Title', [string]$target.Title,
    '-Prompt', [string]$target.Prompt,
    '-DelayAfterFocusMs', [string]$DelayAfterFocusMs
  )

  if ($UseQuadrantCoordinates) {
    $argsList += @('-ClickX', [string]$target.X, '-ClickY', [string]$target.Y)
  } else {
    $argsList += '-FallbackTitles'
    $argsList += @([string[]]$target.Fallback)
  }

  if ($NoEnter) { $argsList += '-NoEnter' }

  & powershell.exe @argsList
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to send master prompt for $key"
  }
  Start-Sleep -Milliseconds $DelayBetweenMs
}
