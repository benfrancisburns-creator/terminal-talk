param(
    [Parameter(Mandatory = $true)][string]$Accelerator,
    [Parameter(Mandatory = $true)][string]$StopFile,
    [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'

Add-Type @'
using System.Runtime.InteropServices;
public static class TerminalTalkKeyState {
    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);
}
'@

$vk = @{
    'CONTROL' = 0x11; 'CTRL' = 0x11; 'SHIFT' = 0x10; 'ALT' = 0x12
    'OPTION' = 0x12; 'SPACE' = 0x20; 'TAB' = 0x09; 'ENTER' = 0x0D
    'RETURN' = 0x0D; 'ESC' = 0x1B; 'ESCAPE' = 0x1B; 'BACKSPACE' = 0x08
    'DELETE' = 0x2E; 'INSERT' = 0x2D; 'HOME' = 0x24; 'END' = 0x23
    'PAGEUP' = 0x21; 'PAGEDOWN' = 0x22; 'UP' = 0x26; 'DOWN' = 0x28
    'LEFT' = 0x25; 'RIGHT' = 0x27
}
foreach ($c in [char[]]'ABCDEFGHIJKLMNOPQRSTUVWXYZ') { $vk[[string]$c] = [int][char]$c }
for ($i = 0; $i -le 9; $i++) { $vk[[string]$i] = 0x30 + $i }
for ($i = 1; $i -le 24; $i++) { $vk["F$i"] = 0x6F + $i }

function Convert-Part([string]$Part) {
    $key = ($Part -replace '\s+', '').ToUpperInvariant()
    if ($key -eq 'COMMANDORCONTROL' -or $key -eq 'CMDORCTRL') { $key = 'CONTROL' }
    if (-not $vk.ContainsKey($key)) { throw "Unsupported hotkey part: $Part" }
    return [int]$vk[$key]
}

$keys = @($Accelerator -split '\+' | Where-Object { $_.Trim() } | ForEach-Object { Convert-Part $_ })
if ($keys.Count -eq 0) { throw 'No keys parsed from accelerator.' }

function Test-AllDown {
    foreach ($key in $keys) {
        if (([TerminalTalkKeyState]::GetAsyncKeyState($key) -band 0x8000) -eq 0) {
            return $false
        }
    }
    return $true
}

$started = Get-Date
$deadline = $started.AddSeconds($TimeoutSeconds)
$seenDown = $false
while ((Get-Date) -lt $deadline) {
    if (Test-AllDown) {
        $seenDown = $true
    } elseif ($seenDown -or ((Get-Date) - $started).TotalMilliseconds -ge 750) {
        break
    }
    Start-Sleep -Milliseconds 20
}

New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($StopFile)) -Force | Out-Null
Set-Content -LiteralPath $StopFile -Value 'stop' -Encoding ASCII
