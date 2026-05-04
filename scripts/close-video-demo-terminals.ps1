#requires -Version 5.1
[CmdletBinding()]
param(
  [string[]]$Titles = @('CodexTTDemo', 'ClaudeTTDemo'),
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class TTCloseDemoWindows {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  public const uint WM_CLOSE = 0x0010;

  public static string Title(IntPtr hWnd) {
    int len = GetWindowTextLength(hWnd);
    if (len <= 0) return "";
    StringBuilder sb = new StringBuilder(len + 1);
    GetWindowText(hWnd, sb, sb.Capacity);
    return sb.ToString();
  }
}
'@

$matches = New-Object System.Collections.Generic.List[object]
[TTCloseDemoWindows]::EnumWindows({
  param($hWnd, $lParam)
  if (-not [TTCloseDemoWindows]::IsWindowVisible($hWnd)) { return $true }
  $title = [TTCloseDemoWindows]::Title($hWnd)
  foreach ($needle in $Titles) {
    if (-not [string]::IsNullOrWhiteSpace($needle) -and $title -like "*$needle*") {
      $matches.Add([pscustomobject]@{ Handle = $hWnd; Title = $title }) | Out-Null
      break
    }
  }
  return $true
}, [IntPtr]::Zero) | Out-Null

foreach ($match in $matches) {
  if (-not $DryRun) {
    [TTCloseDemoWindows]::PostMessage($match.Handle, [TTCloseDemoWindows]::WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  }
}

$matches | Select-Object Title
