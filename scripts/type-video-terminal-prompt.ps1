#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Codex', 'Claude')]
  [string]$Target,
  [Parameter(Mandatory = $true)]
  [string]$Prompt,
  [ValidateSet('TopRight', 'TopLeft', 'Primary', 'ByIndex')]
  [string]$Screen = 'TopRight',
  [int]$ScreenIndex = 0,
  [int]$RightRailWidth = 776,
  [int]$Margin = 24,
  [ValidateSet('Rails', 'SnapTopTerminals', 'ThreeColumns', 'WideToolbarColumns', 'LeftStackRightHalf')]
  [string]$Layout = 'LeftStackRightHalf',
  [int]$ToolbarWidth = 776,
  [int]$ClickX = [int]::MinValue,
  [int]$ClickY = [int]::MinValue,
  [int]$CharDelayMs = 18,
  [int]$InitialDelayMs = 350,
  [switch]$CtrlAFirst,
  [switch]$TabAfter,
  [switch]$NoEnter
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class TTTypeInput {
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public InputUnion U;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion {
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public MOUSEINPUT mi;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);

  public const uint INPUT_MOUSE = 0;
  public const uint INPUT_KEYBOARD = 1;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const uint KEYEVENTF_UNICODE = 0x0004;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;

  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    INPUT down = new INPUT();
    down.type = INPUT_MOUSE;
    down.U.mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
    INPUT up = new INPUT();
    up.type = INPUT_MOUSE;
    up.U.mi.dwFlags = MOUSEEVENTF_LEFTUP;
    SendInput(2, new INPUT[] { down, up }, Marshal.SizeOf(typeof(INPUT)));
  }

  public static void TypeChar(char ch) {
    INPUT down = new INPUT();
    down.type = INPUT_KEYBOARD;
    down.U.ki.wScan = ch;
    down.U.ki.dwFlags = KEYEVENTF_UNICODE;
    INPUT up = down;
    up.U.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
    SendInput(2, new INPUT[] { down, up }, Marshal.SizeOf(typeof(INPUT)));
  }

  public static void PressEnter() {
    PressVirtualKey(0x0D);
  }

  public static void PressTab() {
    PressVirtualKey(0x09);
  }

  public static void PressCtrlA() {
    INPUT ctrlDown = new INPUT();
    ctrlDown.type = INPUT_KEYBOARD;
    ctrlDown.U.ki.wVk = 0x11;
    INPUT aDown = new INPUT();
    aDown.type = INPUT_KEYBOARD;
    aDown.U.ki.wVk = 0x41;
    INPUT aUp = aDown;
    aUp.U.ki.dwFlags = KEYEVENTF_KEYUP;
    INPUT ctrlUp = ctrlDown;
    ctrlUp.U.ki.dwFlags = KEYEVENTF_KEYUP;
    SendInput(4, new INPUT[] { ctrlDown, aDown, aUp, ctrlUp }, Marshal.SizeOf(typeof(INPUT)));
  }

  public static void PressVirtualKey(ushort vk) {
    INPUT down = new INPUT();
    down.type = INPUT_KEYBOARD;
    down.U.ki.wVk = vk;
    INPUT up = down;
    up.U.ki.dwFlags = KEYEVENTF_KEYUP;
    SendInput(2, new INPUT[] { down, up }, Marshal.SizeOf(typeof(INPUT)));
  }
}
'@

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
    'TopLeft' { return $screens | Sort-Object { $_.Bounds.Y }, { $_.Bounds.X } | Select-Object -First 1 }
    'TopRight' { return $screens | Sort-Object { $_.Bounds.Y }, { -$_.Bounds.X } | Select-Object -First 1 }
  }
}

if ($ClickX -eq [int]::MinValue -or $ClickY -eq [int]::MinValue) {
  $targetScreen = Get-TargetScreen
  $wa = $targetScreen.WorkingArea
  if ($Layout -eq 'WideToolbarColumns') {
    $toolbarW = [Math]::Min($ToolbarWidth, [Math]::Max(520, $wa.Width))
    $termTotalW = $wa.Width - $toolbarW
    $termW = [Math]::Floor($termTotalW / 2)
    $termH = $wa.Height
    $codexX = $wa.X
    $claudeX = $wa.X + $termW
    $topY = $wa.Y
  } elseif ($Layout -eq 'LeftStackRightHalf') {
    $termW = [Math]::Floor($wa.Width / 2)
    $topH = [Math]::Floor($wa.Height / 2)
    $termH = if ($Target -eq 'Codex') { $topH } else { $wa.Height - $topH }
    $codexX = $wa.X
    $claudeX = $wa.X
    $topY = if ($Target -eq 'Codex') { $wa.Y } else { $wa.Y + $topH }
  } elseif ($Layout -eq 'ThreeColumns') {
    $termW = [Math]::Floor($wa.Width / 3)
    $termH = $wa.Height
    $codexX = $wa.X
    $claudeX = $wa.X + $termW
    $topY = $wa.Y
  } elseif ($Layout -eq 'SnapTopTerminals') {
    $termW = [Math]::Floor($wa.Width / 2)
    $termH = [Math]::Floor($wa.Height / 2)
    $codexX = $wa.X
    $claudeX = $wa.X + $termW
    $topY = $wa.Y
  } else {
    $railW = if (($wa.Width - $RightRailWidth) -ge 900) { $RightRailWidth } else { [Math]::Floor($wa.Width * 0.34) }
    $usableLeftW = $wa.Width - $railW - ($Margin * 3)
    $termW = [Math]::Floor(($usableLeftW - $Margin) / 2)
    $termH = [Math]::Min([Math]::Floor($wa.Height * 0.72), $wa.Height - ($Margin * 2))
    $codexX = $wa.X + $Margin
    $claudeX = $codexX + $termW + $Margin
    $topY = $wa.Y + $Margin
  }
  $ClickX = if ($Target -eq 'Codex') { $codexX + 40 } else { $claudeX + 40 }
  $ClickY = $topY + $termH - 42
}

[TTTypeInput]::Click($ClickX, $ClickY)
Start-Sleep -Milliseconds $InitialDelayMs
if ($CtrlAFirst) {
  [TTTypeInput]::PressCtrlA()
  Start-Sleep -Milliseconds 120
}
foreach ($ch in $Prompt.ToCharArray()) {
  [TTTypeInput]::TypeChar($ch)
  if ($CharDelayMs -gt 0) { Start-Sleep -Milliseconds $CharDelayMs }
}
if (-not $NoEnter) {
  Start-Sleep -Milliseconds 160
  [TTTypeInput]::PressEnter()
}
if ($TabAfter) {
  Start-Sleep -Milliseconds 160
  [TTTypeInput]::PressTab()
}

[pscustomobject]@{
  Target = $Target
  ClickX = $ClickX
  ClickY = $ClickY
  Typed = $Prompt
  Enter = -not $NoEnter
  TabAfter = [bool]$TabAfter
}
