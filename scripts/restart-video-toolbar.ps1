#requires -Version 5.1
[CmdletBinding()]
param(
  [string]$TtHome = '',
  [string]$AppDir = '',
  [string]$InstalledAppDir = "$env:USERPROFILE\.terminal-talk\app",
  [ValidateSet('TopRight', 'TopLeft', 'Primary', 'ByIndex')]
  [string]$Screen = 'TopRight',
  [int]$ScreenIndex = 0,
  [ValidateSet('TopLeft', 'TopRight', 'BottomLeft', 'BottomRight')]
  [string]$Anchor = 'TopRight',
  [ValidateSet('Anchored', 'SnapBottomSettings', 'ThreeColumnsRight', 'WideToolbarColumns', 'LeftStackRightHalf')]
  [string]$Layout = 'LeftStackRightHalf',
  [int]$ScreenMargin = 0,
  [int]$ToolbarWidth = 776,
  [int]$CaptureX = [int]::MinValue,
  [int]$CaptureY = [int]::MinValue,
  [int]$CaptureWidth = [int]::MinValue,
  [int]$CaptureHeight = [int]::MinValue,
  [int]$AutoOpenSettingsMs = 600,
  [switch]$NoInstallPatch,
  [switch]$NoKill,
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$TmpRoot = Join-Path $RepoRoot 'tmp'
if ([string]::IsNullOrWhiteSpace($TtHome)) {
  $TtHome = Join-Path $TmpRoot 'tt-video-home'
}
if ([string]::IsNullOrWhiteSpace($AppDir)) {
  $AppDir = Join-Path $RepoRoot 'app'
}

function Resolve-OrFullPath([string]$PathValue) {
  try {
    return (Resolve-Path -LiteralPath $PathValue -ErrorAction Stop).Path
  } catch {
    return [IO.Path]::GetFullPath($PathValue)
  }
}

function Write-Utf8NoBom([string]$PathValue, [string]$Value) {
  $encoding = [System.Text.UTF8Encoding]::new($false)
  [IO.File]::WriteAllText($PathValue, $Value, $encoding)
}

function Move-WindowForProcess([int]$ProcessId, [int]$X, [int]$Y, [int]$W, [int]$H, [int]$TimeoutMs = 8000) {
  Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class TTVideoWindowMove {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int W, int H, bool repaint);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  public static IntPtr FindWindowForPid(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      if (found != IntPtr.Zero) return true;
      if (!IsWindowVisible(hWnd)) return true;
      uint ownerPid = 0;
      GetWindowThreadProcessId(hWnd, out ownerPid);
      if (ownerPid == pid) found = hWnd;
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@ -ErrorAction SilentlyContinue | Out-Null

  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline) {
    $handle = [TTVideoWindowMove]::FindWindowForPid([uint32]$ProcessId)
    if ($handle -ne [IntPtr]::Zero) {
      [TTVideoWindowMove]::ShowWindow($handle, 9) | Out-Null
      [TTVideoWindowMove]::MoveWindow($handle, $X, $Y, $W, $H, $true) | Out-Null
      return $true
    }
    Start-Sleep -Milliseconds 150
  }
  return $false
}

function Get-TargetScreen() {
  Add-Type -AssemblyName System.Windows.Forms
  $screens = [System.Windows.Forms.Screen]::AllScreens
  switch ($Screen) {
    'Primary' { return [System.Windows.Forms.Screen]::PrimaryScreen }
    'ByIndex' {
      if ($ScreenIndex -lt 0 -or $ScreenIndex -ge $screens.Count) {
        throw "ScreenIndex $ScreenIndex is out of range. Detected $($screens.Count) screens."
      }
      return $screens[$ScreenIndex]
    }
    'TopLeft' {
      return $screens | Sort-Object { $_.Bounds.Y }, { $_.Bounds.X } | Select-Object -First 1
    }
    'TopRight' {
      return $screens | Sort-Object { $_.Bounds.Y }, { -$_.Bounds.X } | Select-Object -First 1
    }
  }
}

function Resolve-CaptureBounds() {
  $target = Get-TargetScreen
  $wa = $target.WorkingArea
  $margin = [Math]::Max(0, $ScreenMargin)
  if ($Layout -eq 'ThreeColumnsRight') {
    $colW = [Math]::Floor($wa.Width / 3)
    $rightW = $wa.Width - ($colW * 2)
    return [pscustomobject]@{
      Screen = $target.DeviceName
      X = [int]($wa.X + ($colW * 2))
      Y = [int]($wa.Y + $margin)
      W = [int]($rightW - $margin)
      H = [int]($wa.Height - ($margin * 2))
      WorkingArea = "x=$($wa.X) y=$($wa.Y) w=$($wa.Width) h=$($wa.Height)"
    }
  }
  if ($Layout -eq 'WideToolbarColumns') {
    $toolbarW = [Math]::Min($ToolbarWidth, [Math]::Max(520, $wa.Width - ($margin * 2)))
    return [pscustomobject]@{
      Screen = $target.DeviceName
      X = [int]($wa.X + $wa.Width - $toolbarW - $margin)
      Y = [int]($wa.Y + $margin)
      W = [int]$toolbarW
      H = [int]($wa.Height - ($margin * 2))
      WorkingArea = "x=$($wa.X) y=$($wa.Y) w=$($wa.Width) h=$($wa.Height)"
    }
  }
  if ($Layout -eq 'LeftStackRightHalf') {
    $leftW = [Math]::Floor($wa.Width / 2)
    $rightW = $wa.Width - $leftW
    return [pscustomobject]@{
      Screen = $target.DeviceName
      X = [int]($wa.X + $leftW + $margin)
      Y = [int]($wa.Y + $margin)
      W = [int]($rightW - ($margin * 2))
      H = [int]($wa.Height - ($margin * 2))
      WorkingArea = "x=$($wa.X) y=$($wa.Y) w=$($wa.Width) h=$($wa.Height)"
    }
  }
  if ($Layout -eq 'SnapBottomSettings') {
    $topH = [Math]::Floor($wa.Height / 2)
    return [pscustomobject]@{
      Screen = $target.DeviceName
      X = [int]($wa.X + $margin)
      Y = [int]($wa.Y + $topH)
      W = [int]($wa.Width - ($margin * 2))
      H = [int]($wa.Height - $topH - $margin)
      WorkingArea = "x=$($wa.X) y=$($wa.Y) w=$($wa.Width) h=$($wa.Height)"
    }
  }

  $requestedW = if ($CaptureWidth -eq [int]::MinValue) { 776 } else { $CaptureWidth }
  $requestedH = if ($CaptureHeight -eq [int]::MinValue) { 984 } else { $CaptureHeight }
  $w = [Math]::Min($requestedW, [Math]::Max(320, $wa.Width - ($margin * 2)))
  $h = [Math]::Min($requestedH, [Math]::Max(240, $wa.Height - ($margin * 2)))
  $x = $CaptureX
  $y = $CaptureY

  if ($x -eq [int]::MinValue) {
    $x = switch -Regex ($Anchor) {
      'Right$' { $wa.X + $wa.Width - $w - $margin; break }
      default  { $wa.X + $margin }
    }
  }
  if ($y -eq [int]::MinValue) {
    $y = switch -Regex ($Anchor) {
      '^Bottom' { $wa.Y + $wa.Height - $h - $margin; break }
      default   { $wa.Y + $margin }
    }
  }

  [pscustomobject]@{
    Screen = $target.DeviceName
    X = [int]$x
    Y = [int]$y
    W = [int]$w
    H = [int]$h
    WorkingArea = "x=$($wa.X) y=$($wa.Y) w=$($wa.Width) h=$($wa.Height)"
  }
}

$TmpRootFull = Resolve-OrFullPath $TmpRoot
$TtHomeFull = Resolve-OrFullPath $TtHome
$AppDirFull = Resolve-OrFullPath $AppDir
$InstalledAppDirFull = Resolve-OrFullPath $InstalledAppDir
$CaptureBounds = Resolve-CaptureBounds

if (-not $TtHomeFull.StartsWith($TmpRootFull, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to clean video home outside repo tmp: $TtHomeFull"
}
if (-not (Test-Path -LiteralPath $AppDirFull)) {
  throw "Terminal Talk app directory not found: $AppDirFull"
}
if (-not (Test-Path -LiteralPath $InstalledAppDirFull)) {
  throw "Installed Terminal Talk app not found: $InstalledAppDirFull"
}

if (-not $NoInstallPatch) {
  $patchedFiles = @(
    'statusline.ps1',
    'codex-identify-live.ps1',
    'codex-launch.ps1',
    'codex-wt-launch.ps1',
    'lib\codex-session-watcher.js'
  )
  foreach ($name in $patchedFiles) {
    $src = Join-Path $RepoRoot "app\$name"
    $dst = Join-Path $InstalledAppDirFull $name
    if (-not (Test-Path -LiteralPath $src)) { throw "Patch source missing: $src" }
    Copy-Item -LiteralPath $src -Destination $dst -Force
  }
}

if (-not $NoKill) {
  Get-CimInstance Win32_Process -Filter "Name='terminal-talk.exe'" -ErrorAction SilentlyContinue |
    ForEach-Object {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
  Start-Sleep -Milliseconds 700
}

if (Test-Path -LiteralPath $TtHomeFull) {
  Remove-Item -LiteralPath $TtHomeFull -Recurse -Force
}
New-Item -ItemType Directory -Path $TtHomeFull -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $TtHomeFull 'queue') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $TtHomeFull 'sessions') -Force | Out-Null
Write-Utf8NoBom -PathValue (Join-Path $TtHomeFull 'session-colours.json') -Value '{"assignments":{}}'

$realConfig = Join-Path $env:USERPROFILE '.terminal-talk\config.json'
$videoConfig = Join-Path $TtHomeFull 'config.json'
if (Test-Path -LiteralPath $realConfig) {
  Copy-Item -LiteralPath $realConfig -Destination $videoConfig -Force
}

$exe = Join-Path $InstalledAppDirFull 'node_modules\electron\dist\terminal-talk.exe'
if (-not (Test-Path -LiteralPath $exe)) {
  throw "Terminal Talk executable not found: $exe"
}

$proc = $null
if (-not $NoStart) {
  $oldTtHome = $env:TT_HOME
  $oldRegistry = $env:TT_REGISTRY_PATH
  $oldConfig = $env:TT_CONFIG_PATH
  $oldAppDir = $env:TT_APP_DIR
  $oldRequireHookIdentity = $env:TT_REQUIRE_CODEX_HOOK_IDENTITY
  $oldCaptureMode = $env:TT_CAPTURE_MODE
  $oldCaptureX = $env:TT_CAPTURE_X
  $oldCaptureY = $env:TT_CAPTURE_Y
  $oldCaptureWidth = $env:TT_CAPTURE_WIDTH
  $oldCaptureHeight = $env:TT_CAPTURE_HEIGHT
  $oldCaptureNativeWindow = $env:TT_CAPTURE_NATIVE_WINDOW
  $oldAutoOpenSettings = $env:TT_DEMO_AUTO_OPEN_SETTINGS_MS
  $oldSettingsScrollTarget = $env:TT_DEMO_SETTINGS_SCROLL_TARGET
  try {
    $env:TT_HOME = $TtHomeFull
    $env:TT_REGISTRY_PATH = Join-Path $TtHomeFull 'session-colours.json'
    $env:TT_CONFIG_PATH = $videoConfig
    $env:TT_APP_DIR = $AppDirFull
    $env:TT_REQUIRE_CODEX_HOOK_IDENTITY = '1'
    $env:TT_CAPTURE_MODE = '1'
    $env:TT_CAPTURE_X = [string]$CaptureBounds.X
    $env:TT_CAPTURE_Y = [string]$CaptureBounds.Y
    $env:TT_CAPTURE_WIDTH = [string]$CaptureBounds.W
    $env:TT_CAPTURE_HEIGHT = [string]$CaptureBounds.H
    $env:TT_CAPTURE_NATIVE_WINDOW = '0'
    $env:TT_DEMO_AUTO_OPEN_SETTINGS_MS = [string]$AutoOpenSettingsMs
    $env:TT_DEMO_SETTINGS_SCROLL_TARGET = 'sessions'
    $proc = Start-Process -FilePath $exe -ArgumentList "`"$AppDirFull`"" -WorkingDirectory $AppDirFull -PassThru
    Move-WindowForProcess -ProcessId $proc.Id -X $CaptureBounds.X -Y $CaptureBounds.Y -W $CaptureBounds.W -H $CaptureBounds.H | Out-Null
  } finally {
    $env:TT_HOME = $oldTtHome
    $env:TT_REGISTRY_PATH = $oldRegistry
    $env:TT_CONFIG_PATH = $oldConfig
    $env:TT_APP_DIR = $oldAppDir
    $env:TT_REQUIRE_CODEX_HOOK_IDENTITY = $oldRequireHookIdentity
    $env:TT_CAPTURE_MODE = $oldCaptureMode
    $env:TT_CAPTURE_X = $oldCaptureX
    $env:TT_CAPTURE_Y = $oldCaptureY
    $env:TT_CAPTURE_WIDTH = $oldCaptureWidth
    $env:TT_CAPTURE_HEIGHT = $oldCaptureHeight
    $env:TT_CAPTURE_NATIVE_WINDOW = $oldCaptureNativeWindow
    $env:TT_DEMO_AUTO_OPEN_SETTINGS_MS = $oldAutoOpenSettings
    $env:TT_DEMO_SETTINGS_SCROLL_TARGET = $oldSettingsScrollTarget
  }
}

[pscustomobject]@{
  VideoHome = $TtHomeFull
  AppDir = $AppDirFull
  InstalledAppDir = $InstalledAppDirFull
  StartedPid = if ($proc) { $proc.Id } else { $null }
  Registry = Join-Path $TtHomeFull 'session-colours.json'
  Config = $videoConfig
  CaptureScreen = $CaptureBounds.Screen
  CaptureWorkingArea = $CaptureBounds.WorkingArea
  CaptureBounds = "x=$($CaptureBounds.X) y=$($CaptureBounds.Y) w=$($CaptureBounds.W) h=$($CaptureBounds.H)"
  InstalledPatchedHooks = -not $NoInstallPatch
}
