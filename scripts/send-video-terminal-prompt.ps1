#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Title,
  [Parameter(Mandatory = $true)]
  [string]$Prompt,
  [string[]]$FallbackTitles = @(),
  [int]$ClickX = [int]::MinValue,
  [int]$ClickY = [int]::MinValue,
  [int]$DelayAfterFocusMs = 500,
  [switch]$NoEnter
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

Add-Type @'
using System;
using System.Runtime.InteropServices;

public class TTPromptMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
}
'@

Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class TTPromptWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);

  public static string WindowTitle(IntPtr hWnd) {
    int length = GetWindowTextLength(hWnd);
    if (length <= 0) return "";
    StringBuilder builder = new StringBuilder(length + 1);
    GetWindowText(hWnd, builder, builder.Capacity);
    return builder.ToString();
  }

  public static IntPtr FindWindowByTitle(string[] patterns) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      if (found != IntPtr.Zero) return true;
      if (!IsWindowVisible(hWnd)) return true;
      string title = WindowTitle(hWnd);
      if (String.IsNullOrWhiteSpace(title)) return true;
      foreach (string pattern in patterns) {
        if (!String.IsNullOrWhiteSpace(pattern) && title.IndexOf(pattern, StringComparison.OrdinalIgnoreCase) >= 0) {
          found = hWnd;
          return true;
        }
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@

$patterns = @($Title) + @($FallbackTitles)
$useClickTarget = $ClickX -ne [int]::MinValue -and $ClickY -ne [int]::MinValue
$handle = [IntPtr]::Zero
if (-not $useClickTarget) {
  $handle = [TTPromptWin]::FindWindowByTitle($patterns)
  if ($handle -eq [IntPtr]::Zero) {
    throw "Could not find a visible window matching: $($patterns -join ', ')"
  }
}

$previousClipboard = $null
$hadClipboard = $false
try {
  $previousClipboard = Get-Clipboard -Raw -ErrorAction Stop
  $hadClipboard = $true
} catch {}

try {
  Set-Clipboard -Value $Prompt
  if ($useClickTarget) {
    [TTPromptMouse]::SetCursorPos($ClickX, $ClickY) | Out-Null
    Start-Sleep -Milliseconds 100
    [TTPromptMouse]::mouse_event([TTPromptMouse]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
    [TTPromptMouse]::mouse_event([TTPromptMouse]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
  } else {
    [TTPromptWin]::ShowWindow($handle, 9) | Out-Null
    [TTPromptWin]::SetForegroundWindow($handle) | Out-Null
  }
  Start-Sleep -Milliseconds $DelayAfterFocusMs
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  if (!$NoEnter) {
    Start-Sleep -Milliseconds 100
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  }
  if ($useClickTarget) {
    Write-Host "Sent prompt at x=${ClickX} y=${ClickY}: $Prompt"
  } else {
    Write-Host "Sent prompt to '$Title': $Prompt"
  }
} finally {
  Start-Sleep -Milliseconds 250
  if ($hadClipboard) {
    Set-Clipboard -Value $previousClipboard
  }
}
