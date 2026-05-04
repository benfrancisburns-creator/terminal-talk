#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Codex', 'Claude')]
  [string]$Kind,
  [string]$Project = 'C:\Users\Ben\Desktop\terminal-talk',
  [string]$TtHome = '',
  [string]$CodexCommand = 'codex',
  [string]$ClaudeExe = "$env:USERPROFILE\.local\bin\claude.exe",
  [string]$Title = ''
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Project)) {
  throw "Project folder not found: $Project"
}

if (-not [string]::IsNullOrWhiteSpace($TtHome)) {
  $resolvedHome = try {
    (Resolve-Path -LiteralPath $TtHome -ErrorAction Stop).Path
  } catch {
    [IO.Path]::GetFullPath($TtHome)
  }
  New-Item -ItemType Directory -Path $resolvedHome -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $resolvedHome 'queue') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $resolvedHome 'sessions') -Force | Out-Null
  $env:TT_HOME = $resolvedHome
  $env:TT_REGISTRY_PATH = Join-Path $resolvedHome 'session-colours.json'
}

Set-Location -LiteralPath $Project

if (-not [string]::IsNullOrWhiteSpace($Title)) {
  try { $host.UI.RawUI.WindowTitle = $Title } catch {}
  try { [Console]::Title = $Title } catch {}
}

if ($Kind -eq 'Codex') {
  & $CodexCommand
  exit $LASTEXITCODE
}

if (-not (Test-Path -LiteralPath $ClaudeExe)) {
  throw "Claude executable not found: $ClaudeExe"
}

& $ClaudeExe
exit $LASTEXITCODE
