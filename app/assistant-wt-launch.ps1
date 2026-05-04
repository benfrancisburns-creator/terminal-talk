[CmdletBinding()]
param(
    [string]$ProjectDir = '',
    [string]$LauncherScript = '',
    [string]$WindowTitle = '',
    [string]$TabColor = '',
    [string]$WindowPosition = '',
    [string]$WindowSize = '',
    [string]$WindowBounds = '',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Resolve-Value([string]$ExplicitValue, [string]$EnvName, [string]$Fallback) {
    if (-not [string]::IsNullOrWhiteSpace($ExplicitValue)) { return $ExplicitValue }
    $envValue = [Environment]::GetEnvironmentVariable($EnvName)
    if (-not [string]::IsNullOrWhiteSpace($envValue)) { return $envValue }
    return $Fallback
}

function Resolve-WindowsTerminal {
    $local = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\wt.exe'
    if (Test-Path -LiteralPath $local) { return $local }

    $cmd = Get-Command wt.exe -ErrorAction Stop
    if ($cmd.Source) { return $cmd.Source }
    if ($cmd.Path) { return $cmd.Path }
    return 'wt.exe'
}

function Resolve-InnerPowerShell {
    $pwsh = 'C:\Program Files\PowerShell\7\pwsh.exe'
    if (Test-Path -LiteralPath $pwsh) { return $pwsh }

    $systemPowerShell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
    if (Test-Path -LiteralPath $systemPowerShell) { return $systemPowerShell }

    return 'powershell.exe'
}

function Format-Args([string[]]$Values) {
    ($Values | ForEach-Object {
        if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
    }) -join ' '
}

function Write-BridgeLog([string]$Message) {
    try {
        $ttHome = if ($env:TT_HOME) { $env:TT_HOME } else { Join-Path $env:USERPROFILE '.terminal-talk' }
        $queue = Join-Path $ttHome 'queue'
        if (-not (Test-Path -LiteralPath $queue)) {
            New-Item -ItemType Directory -Path $queue -Force | Out-Null
        }
        $line = '[{0}] assistant-wt-launch {1}' -f (Get-Date).ToString('s'), $Message
        Add-Content -LiteralPath (Join-Path $queue '_toolbar.log') -Value $line -Encoding UTF8
    } catch {
        # Best-effort diagnostics only; never block session launch on logging.
    }
}

function Move-LaunchedTerminalWindow([string]$Title, [string]$Bounds) {
    if (-not $Title -or -not $Bounds) { return $false }
    if ($Bounds -notmatch '^(-?\d+),(-?\d+),(\d+),(\d+)$') { return $false }
    $x = [int]$Matches[1]
    $y = [int]$Matches[2]
    $width = [int]$Matches[3]
    $height = [int]$Matches[4]
    if ($width -le 0 -or $height -le 0) { return $false }

    if (-not ([System.Management.Automation.PSTypeName]'TTLaunchWindowPlacement').Type) {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class TTLaunchWindowPlacement {
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

    public static bool MoveFirstMatchingWindow(string titlePart, int x, int y, int width, int height) {
        if (String.IsNullOrWhiteSpace(titlePart)) return false;
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
            if (found != IntPtr.Zero) return true;
            if (!IsWindowVisible(hWnd)) return true;
            int length = GetWindowTextLength(hWnd);
            if (length <= 0) return true;
            StringBuilder builder = new StringBuilder(length + 1);
            GetWindowText(hWnd, builder, builder.Capacity);
            string title = builder.ToString();
            if (title.IndexOf(titlePart, StringComparison.OrdinalIgnoreCase) >= 0) {
                found = hWnd;
            }
            return true;
        }, IntPtr.Zero);
        if (found == IntPtr.Zero) return false;
        ShowWindow(found, 9);
        return MoveWindow(found, x, y, width, height, true);
    }
}
"@ -ErrorAction Stop | Out-Null
    }

    for ($i = 0; $i -lt 40; $i++) {
        try {
            if ([TTLaunchWindowPlacement]::MoveFirstMatchingWindow($Title, $x, $y, $width, $height)) {
                Write-BridgeLog "moved window '$Title' to $Bounds"
                return $true
            }
        } catch {}
        Start-Sleep -Milliseconds 250
    }
    Write-BridgeLog "move window failed title='$Title' bounds=$Bounds"
    return $false
}

$ProjectDir = Resolve-Value $ProjectDir 'TT_CREATE_SESSION_PROJECT_DIR' (Get-Location).Path
$LauncherScript = Resolve-Value $LauncherScript 'TT_CREATE_SESSION_LAUNCHER' (Join-Path $PSScriptRoot 'assistant-session-launch.ps1')
$WindowTitle = Resolve-Value $WindowTitle 'TT_CREATE_SESSION_WT_TITLE' 'TerminalTalkSession'
$TabColor = Resolve-Value $TabColor 'TT_CREATE_SESSION_TAB_COLOR' '#ff5e5e'
$WindowPosition = Resolve-Value $WindowPosition 'TT_CREATE_SESSION_WINDOW_POS' ''
$WindowSize = Resolve-Value $WindowSize 'TT_CREATE_SESSION_WINDOW_SIZE' ''
$WindowBounds = Resolve-Value $WindowBounds 'TT_CREATE_SESSION_WINDOW_BOUNDS' ''

$ProjectDir = (Resolve-Path -LiteralPath $ProjectDir).Path
if (-not (Test-Path -LiteralPath $ProjectDir -PathType Container)) {
    throw "Project folder does not exist: $ProjectDir"
}
if (-not (Test-Path -LiteralPath $LauncherScript -PathType Leaf)) {
    throw "Session launcher script is missing: $LauncherScript"
}

$safeTitle = ($WindowTitle -replace '\s+', '')
if ([string]::IsNullOrWhiteSpace($safeTitle)) { $safeTitle = 'TerminalTalkSession' }
if ($safeTitle.Length -gt 48) { $safeTitle = $safeTitle.Substring(0, 48) }

if ($TabColor -notmatch '^#[0-9a-fA-F]{6}$') {
    $TabColor = '#ff5e5e'
}
if ($WindowPosition -and $WindowPosition -notmatch '^-?\d+,-?\d+$') {
    $WindowPosition = ''
}
if ($WindowSize -and $WindowSize -notmatch '^\d+,\d+$') {
    $WindowSize = ''
}
if ($WindowBounds -and $WindowBounds -notmatch '^-?\d+,-?\d+,\d+,\d+$') {
    $WindowBounds = ''
}

$wt = Resolve-WindowsTerminal
$pwsh = Resolve-InnerPowerShell
$args = @('-w', 'new')
if ($WindowPosition) {
    $args += @('--pos', $WindowPosition)
}
if ($WindowSize) {
    $args += @('--size', $WindowSize)
}
$args += @(
    'nt',
    '--title', $safeTitle,
    '--tabColor', $TabColor,
    '-d', $ProjectDir,
    $pwsh,
    '-NoExit',
    '-File', $LauncherScript
)

Write-BridgeLog ("wt.exe {0}" -f (Format-Args $args))
Write-Output ("assistant-wt-launch wt.exe {0}" -f (Format-Args $args))
if ($DryRun) {
    [pscustomobject]@{
        wt = $wt
        innerPowerShell = $pwsh
        projectDir = $ProjectDir
        launcherScript = $LauncherScript
        title = $safeTitle
        tabColor = $TabColor
        position = $WindowPosition
        size = $WindowSize
        bounds = $WindowBounds
        args = $args
    } | ConvertTo-Json -Compress
    return
}

& $wt @args | Out-Null
if ($WindowBounds) {
    [void](Move-LaunchedTerminalWindow -Title $safeTitle -Bounds $WindowBounds)
}
