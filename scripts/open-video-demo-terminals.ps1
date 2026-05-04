#requires -Version 5.1
[CmdletBinding()]
param(
  [string]$Project = 'C:\Users\Ben\Desktop\terminal-talk',
  [string]$CodexCommand = 'codex',
  [string]$ClaudeExe = "$env:USERPROFILE\.local\bin\claude.exe",
  [string]$TtHome = '',
  [string]$CodexTitle = 'CodexTTDemo',
  [string]$ClaudeTitle = 'ClaudeTTDemo',
  [string[]]$CodexFallbackTitles = @('Codex', 'TT '),
  [string[]]$ClaudeFallbackTitles = @('Claude Code', 'Claude'),
  [int]$DelaySeconds = 3,
  [ValidateSet('TopRight', 'TopLeft', 'Primary', 'ByIndex')]
  [string]$Screen = 'TopRight',
  [int]$ScreenIndex = 0,
  [int]$RightRailWidth = 776,
  [int]$Margin = 24,
  [ValidateSet('Rails', 'SnapTopTerminals', 'ThreeColumns', 'WideToolbarColumns', 'LeftStackRightHalf')]
  [string]$Layout = 'LeftStackRightHalf',
  [int]$ToolbarWidth = 776,
  [string]$ToolbarTitle = 'Terminal Talk',
  [switch]$Arrange,
  [switch]$ArrangeOnly,
  [switch]$MoveToolbar,
  [switch]$ToolbarOnly,
  [switch]$CodexOnly,
  [switch]$ClaudeOnly,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$Wt = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\wt.exe'
$Pwsh = 'C:\Program Files\PowerShell\7\pwsh.exe'

if (!(Test-Path $Project)) { throw "Project folder not found: $Project" }
if (!(Test-Path $Wt)) { throw "Windows Terminal not found: $Wt" }
if (!(Test-Path $Pwsh)) { throw "PowerShell 7 not found: $Pwsh" }
if (!$CodexOnly -and !(Test-Path $ClaudeExe)) { throw "Claude executable not found: $ClaudeExe" }
if ($ArrangeOnly -or $ToolbarOnly) { $Arrange = $true }
if (!$ArrangeOnly -and ($CodexTitle -match '\s' -or $ClaudeTitle -match '\s')) {
  throw 'Use no-space titles here. Spaced titles can be parsed as the command by wt.exe.'
}

if ($Arrange) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class TTDemoWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);

  public static string WindowTitle(IntPtr hWnd) {
    int length = GetWindowTextLength(hWnd);
    if (length <= 0) return "";
    StringBuilder builder = new StringBuilder(length + 1);
    GetWindowText(hWnd, builder, builder.Capacity);
    return builder.ToString();
  }

  public static IntPtr[] FindWindowsByTitle(string contains) {
    List<IntPtr> handles = new List<IntPtr>();
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      if (!IsWindowVisible(hWnd)) return true;
      string title = WindowTitle(hWnd);
      if (!String.IsNullOrWhiteSpace(title) && title.IndexOf(contains, StringComparison.OrdinalIgnoreCase) >= 0) {
        handles.Add(hWnd);
      }
      return true;
    }, IntPtr.Zero);
    return handles.ToArray();
  }
}
'@
}

function Format-Args([string[]]$Values) {
  ($Values | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
  }) -join ' '
}

$SessionLauncher = Join-Path $PSScriptRoot 'start-video-terminal-session.ps1'
if (!(Test-Path $SessionLauncher)) { throw "Session launcher not found: $SessionLauncher" }

function Open-WtTab([string]$Title, [ValidateSet('Codex', 'Claude')] [string]$Kind) {
  $wtArgs = @(
    '-w', 'new',
    'nt',
    '--title', $Title,
    '-d', $Project,
    $Pwsh,
    '-NoExit',
    '-File', $SessionLauncher,
    '-Kind', $Kind,
    '-Project', $Project,
    '-TtHome', $TtHome,
    '-CodexCommand', $CodexCommand,
    '-ClaudeExe', $ClaudeExe,
    '-Title', $Title
  )

  Write-Host "wt.exe $(Format-Args $wtArgs)"
  if (!$DryRun) {
    & $Wt @wtArgs | Out-Null
  }
}

function Get-WindowHandlesByTitle([string[]]$Titles) {
  $handles = @()
  if (!$Arrange) { return $handles }
  foreach ($title in $Titles) {
    if ([string]::IsNullOrWhiteSpace($title)) { continue }
    $handles += @([TTDemoWin]::FindWindowsByTitle($title))
  }
  $handles | Select-Object -Unique
}

function Get-TargetScreen() {
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

function Wait-WindowByTitle([string[]]$Titles, [IntPtr[]]$ExcludeHandles = @(), [int]$TimeoutMs = 12000) {
  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline) {
    foreach ($title in $Titles) {
      if ([string]::IsNullOrWhiteSpace($title)) { continue }
      $handles = [TTDemoWin]::FindWindowsByTitle($title) | Where-Object { $ExcludeHandles -notcontains $_ }
      if ($handles -and $handles.Count -gt 0) { return $handles[0] }
    }
    Start-Sleep -Milliseconds 150
  }
  return [IntPtr]::Zero
}

function Move-DemoWindow([string]$Title, [string[]]$FallbackTitles, [IntPtr[]]$ExcludeHandles = @(), [int]$X, [int]$Y, [int]$W, [int]$H) {
  $patterns = @($Title) + @($FallbackTitles)
  if ($DryRun) {
    Write-Host "Move '$($patterns -join '|')' -> x=$X y=$Y w=$W h=$H"
    return
  }
  $handle = Wait-WindowByTitle -Titles $patterns -ExcludeHandles $ExcludeHandles
  if ($handle -eq [IntPtr]::Zero) {
    Write-Warning "Could not find a visible window containing any title: $($patterns -join ', ')"
    return
  }
  Write-Host "Move '$($patterns -join '|')' -> x=$X y=$Y w=$W h=$H"
  [TTDemoWin]::ShowWindow($handle, 9) | Out-Null
  [TTDemoWin]::MoveWindow($handle, $X, $Y, $W, $H, $true) | Out-Null
}

function Arrange-DemoWindows() {
  $target = Get-TargetScreen
  $wa = $target.WorkingArea
  if ($Layout -eq 'ThreeColumns') {
    $colW = [Math]::Floor($wa.Width / 3)
    $rightW = $wa.Width - ($colW * 2)
    $codexX = $wa.X
    $claudeX = $wa.X + $colW
    $toolbarX = $wa.X + ($colW * 2)
    $topY = $wa.Y
    $h = $wa.Height

    Write-Host "Target screen: $($target.DeviceName) bounds=$($target.Bounds.X),$($target.Bounds.Y),$($target.Bounds.Width),$($target.Bounds.Height) working=$($wa.X),$($wa.Y),$($wa.Width),$($wa.Height)"
    Write-Host "Three-column layout: Codex x=$codexX y=$topY w=$colW h=$h; Claude x=$claudeX y=$topY w=$colW h=$h; Terminal Talk x=$toolbarX y=$topY w=$rightW h=$h"

    if (!$ToolbarOnly -and !$ClaudeOnly) {
      Move-DemoWindow -Title $CodexTitle -FallbackTitles $CodexFallbackTitles -ExcludeHandles $script:ExistingCodexHandles -X $codexX -Y $topY -W $colW -H $h
    }
    if (!$ToolbarOnly -and !$CodexOnly) {
      Move-DemoWindow -Title $ClaudeTitle -FallbackTitles $ClaudeFallbackTitles -ExcludeHandles $script:ExistingClaudeHandles -X $claudeX -Y $topY -W $colW -H $h
    }
    if ($MoveToolbar) {
      Move-DemoWindow -Title $ToolbarTitle -FallbackTitles @('Terminal Talk') -ExcludeHandles @() -X $toolbarX -Y $topY -W $rightW -H $h
    }
    return
  }

  if ($Layout -eq 'WideToolbarColumns') {
    $toolbarW = [Math]::Min($ToolbarWidth, [Math]::Max(520, $wa.Width))
    $termTotalW = $wa.Width - $toolbarW
    $termW = [Math]::Floor($termTotalW / 2)
    $claudeW = $termTotalW - $termW
    $codexX = $wa.X
    $claudeX = $wa.X + $termW
    $toolbarX = $wa.X + $termTotalW
    $topY = $wa.Y
    $h = $wa.Height

    Write-Host "Target screen: $($target.DeviceName) bounds=$($target.Bounds.X),$($target.Bounds.Y),$($target.Bounds.Width),$($target.Bounds.Height) working=$($wa.X),$($wa.Y),$($wa.Width),$($wa.Height)"
    Write-Host "Wide-toolbar layout: Codex x=$codexX y=$topY w=$termW h=$h; Claude x=$claudeX y=$topY w=$claudeW h=$h; Terminal Talk x=$toolbarX y=$topY w=$toolbarW h=$h"

    if (!$ToolbarOnly -and !$ClaudeOnly) {
      Move-DemoWindow -Title $CodexTitle -FallbackTitles $CodexFallbackTitles -ExcludeHandles $script:ExistingCodexHandles -X $codexX -Y $topY -W $termW -H $h
    }
    if (!$ToolbarOnly -and !$CodexOnly) {
      Move-DemoWindow -Title $ClaudeTitle -FallbackTitles $ClaudeFallbackTitles -ExcludeHandles $script:ExistingClaudeHandles -X $claudeX -Y $topY -W $claudeW -H $h
    }
    if ($MoveToolbar) {
      Move-DemoWindow -Title $ToolbarTitle -FallbackTitles @('Terminal Talk') -ExcludeHandles @() -X $toolbarX -Y $topY -W $toolbarW -H $h
    }
    return
  }

  if ($Layout -eq 'LeftStackRightHalf') {
    $leftW = [Math]::Floor($wa.Width / 2)
    $rightW = $wa.Width - $leftW
    $topH = [Math]::Floor($wa.Height / 2)
    $bottomH = $wa.Height - $topH
    $leftX = $wa.X
    $rightX = $wa.X + $leftW
    $topY = $wa.Y
    $bottomY = $wa.Y + $topH

    Write-Host "Target screen: $($target.DeviceName) bounds=$($target.Bounds.X),$($target.Bounds.Y),$($target.Bounds.Width),$($target.Bounds.Height) working=$($wa.X),$($wa.Y),$($wa.Width),$($wa.Height)"
    Write-Host "Left-stack/right-half layout: Codex x=$leftX y=$topY w=$leftW h=$topH; Claude x=$leftX y=$bottomY w=$leftW h=$bottomH; Terminal Talk x=$rightX y=$topY w=$rightW h=$($wa.Height)"

    if (!$ToolbarOnly -and !$ClaudeOnly) {
      Move-DemoWindow -Title $CodexTitle -FallbackTitles $CodexFallbackTitles -ExcludeHandles $script:ExistingCodexHandles -X $leftX -Y $topY -W $leftW -H $topH
    }
    if (!$ToolbarOnly -and !$CodexOnly) {
      Move-DemoWindow -Title $ClaudeTitle -FallbackTitles $ClaudeFallbackTitles -ExcludeHandles $script:ExistingClaudeHandles -X $leftX -Y $bottomY -W $leftW -H $bottomH
    }
    if ($MoveToolbar) {
      Move-DemoWindow -Title $ToolbarTitle -FallbackTitles @('Terminal Talk') -ExcludeHandles @() -X $rightX -Y $topY -W $rightW -H $wa.Height
    }
    return
  }

  if ($Layout -eq 'SnapTopTerminals') {
    $topH = [Math]::Floor($wa.Height / 2)
    $termW = [Math]::Floor($wa.Width / 2)
    $codexX = $wa.X
    $claudeX = $wa.X + $termW
    $topY = $wa.Y
    $claudeW = $wa.Width - $termW

    Write-Host "Target screen: $($target.DeviceName) bounds=$($target.Bounds.X),$($target.Bounds.Y),$($target.Bounds.Width),$($target.Bounds.Height) working=$($wa.X),$($wa.Y),$($wa.Width),$($wa.Height)"
    Write-Host "Snap layout: Codex top-left x=$codexX y=$topY w=$termW h=$topH; Claude top-right x=$claudeX y=$topY w=$claudeW h=$topH; Terminal Talk bottom x=$($wa.X) y=$($wa.Y + $topH) w=$($wa.Width) h=$($wa.Height - $topH)"

    if (!$ToolbarOnly -and !$ClaudeOnly) {
      Move-DemoWindow -Title $CodexTitle -FallbackTitles $CodexFallbackTitles -ExcludeHandles $script:ExistingCodexHandles -X $codexX -Y $topY -W $termW -H $topH
    }
    if (!$ToolbarOnly -and !$CodexOnly) {
      Move-DemoWindow -Title $ClaudeTitle -FallbackTitles $ClaudeFallbackTitles -ExcludeHandles $script:ExistingClaudeHandles -X $claudeX -Y $topY -W $claudeW -H $topH
    }
    if ($MoveToolbar) {
      Move-DemoWindow -Title $ToolbarTitle -FallbackTitles @('Terminal Talk') -ExcludeHandles @() -X $wa.X -Y ($wa.Y + $topH) -W $wa.Width -H ($wa.Height - $topH)
    }
    return
  }

  $railW = if (($wa.Width - $RightRailWidth) -ge 900) {
    $RightRailWidth
  } else {
    [Math]::Floor($wa.Width * 0.34)
  }
  $usableLeftW = $wa.Width - $railW - ($Margin * 3)
  $termW = [Math]::Floor(($usableLeftW - $Margin) / 2)
  $termH = [Math]::Min([Math]::Floor($wa.Height * 0.72), $wa.Height - ($Margin * 2))
  $codexX = $wa.X + $Margin
  $claudeX = $codexX + $termW + $Margin
  $topY = $wa.Y + $Margin
  $railX = $wa.X + $wa.Width - $railW - $Margin
  $railH = $wa.Height - ($Margin * 2)

  Write-Host "Target screen: $($target.DeviceName) bounds=$($target.Bounds.X),$($target.Bounds.Y),$($target.Bounds.Width),$($target.Bounds.Height) working=$($wa.X),$($wa.Y),$($wa.Width),$($wa.Height)"
  Write-Host "Reserve right rail for Terminal Talk/settings: x=$railX y=$topY w=$railW h=$railH"

  if (!$ToolbarOnly -and !$ClaudeOnly) {
    Move-DemoWindow -Title $CodexTitle -FallbackTitles $CodexFallbackTitles -ExcludeHandles $script:ExistingCodexHandles -X $codexX -Y $topY -W $termW -H $termH
  }
  if (!$ToolbarOnly -and !$CodexOnly) {
    Move-DemoWindow -Title $ClaudeTitle -FallbackTitles $ClaudeFallbackTitles -ExcludeHandles $script:ExistingClaudeHandles -X $claudeX -Y $topY -W $termW -H $termH
  }
  if ($MoveToolbar) {
    Move-DemoWindow -Title $ToolbarTitle -FallbackTitles @('Terminal Talk') -ExcludeHandles @() -X $railX -Y $topY -W 680 -H 192
  }
}

$script:ExistingCodexHandles = @()
$script:ExistingClaudeHandles = @()
if ($Arrange -and !$ArrangeOnly -and !$ToolbarOnly) {
  $script:ExistingCodexHandles = @(Get-WindowHandlesByTitle (@($CodexTitle) + @($CodexFallbackTitles)))
  $script:ExistingClaudeHandles = @(Get-WindowHandlesByTitle (@($ClaudeTitle) + @($ClaudeFallbackTitles)))
}

if (!$ArrangeOnly -and !$ToolbarOnly -and !$ClaudeOnly) {
  Open-WtTab -Title $CodexTitle -Kind Codex
}

if (!$ArrangeOnly -and !$ToolbarOnly -and !$CodexOnly) {
  if (!$DryRun) { Start-Sleep -Seconds $DelaySeconds }
  Open-WtTab -Title $ClaudeTitle -Kind Claude
}

if ($Arrange) {
  if (!$DryRun) { Start-Sleep -Seconds 2 }
  Arrange-DemoWindows
}

if (!$DryRun -and !$ArrangeOnly -and !$ToolbarOnly) {
  Start-Sleep -Seconds 2
  Get-Process codex, claude -ErrorAction SilentlyContinue |
    Sort-Object StartTime -Descending |
    Select-Object -First 6 Id, ProcessName, StartTime, Path
}
