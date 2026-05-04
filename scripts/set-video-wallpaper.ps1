#requires -Version 5.1
[CmdletBinding()]
param(
  [string]$Wallpaper = ''
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($Wallpaper)) {
  $Wallpaper = Join-Path $RepoRoot 'docs\assets\wallpaper\terminal-talk-wallpaper.png'
}
$Wallpaper = (Resolve-Path -LiteralPath $Wallpaper -ErrorAction Stop).Path

Add-Type @'
using System.Runtime.InteropServices;

public static class TTWallpaper {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
}
'@

Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name WallpaperStyle -Value '10'
Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name TileWallpaper -Value '0'

$SPI_SETDESKWALLPAPER = 20
$SPIF_UPDATEINIFILE = 0x01
$SPIF_SENDCHANGE = 0x02
[TTWallpaper]::SystemParametersInfo($SPI_SETDESKWALLPAPER, 0, $Wallpaper, $SPIF_UPDATEINIFILE -bor $SPIF_SENDCHANGE) | Out-Null

[pscustomobject]@{
  Wallpaper = $Wallpaper
}
