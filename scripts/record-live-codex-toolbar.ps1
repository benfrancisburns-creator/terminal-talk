#requires -Version 5.1
[CmdletBinding()]
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSReviewUnusedParameter', 'ExistingTerminalTitle', Justification = 'Used when -UseExistingTerminal is selected inside Get-CodexTerminal.')]
param(
  [int]$DurationSec = 105,
  [int]$PromptDelaySec = 12,
  [string]$OutputName = 'terminal-talk-codex-live-workflow',
  [string]$Prompt = "How can Terminal Talk enhance someone's workflow? Keep it concise and spoken-friendly for a short product demo.",
  [switch]$UseExistingTerminal,
  [string]$ExistingTerminalTitle = 'Codex',
  [switch]$ManualPrompt
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$Root = (Resolve-Path .).Path
$Electron = Join-Path $Root 'app\node_modules\electron\dist\electron.exe'
if (!(Test-Path $Electron)) { $Electron = Join-Path $Root 'app\node_modules\.bin\electron.cmd' }
$RecorderScript = Join-Path $Root 'scripts\record-desktop.cjs'
$VideoDir = Join-Path $Root 'docs\videos'
$TmpRoot = Join-Path $Root 'tmp\live-codex-toolbar-video'
$OutputWebm = Join-Path $VideoDir "$OutputName.webm"
$OutputMp4 = Join-Path $VideoDir "$OutputName.mp4"

if (!(Test-Path $Electron)) { throw "Electron not found at $Electron. Run npm install in app/ first." }
if (!(Test-Path $RecorderScript)) { throw "Recorder script not found: $RecorderScript" }
if (!(Get-Command codex -ErrorAction SilentlyContinue)) { throw "codex command not found on PATH." }

New-Item -ItemType Directory -Path $VideoDir -Force | Out-Null
New-Item -ItemType Directory -Path $TmpRoot -Force | Out-Null

Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class TTLiveVideoWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

  public static string WindowTitle(IntPtr hWnd) {
    int length = GetWindowTextLength(hWnd);
    if (length <= 0) return "";
    StringBuilder builder = new StringBuilder(length + 1);
    GetWindowText(hWnd, builder, builder.Capacity);
    return builder.ToString();
  }

  public static int WindowProcessId(IntPtr hWnd) {
    uint pid;
    GetWindowThreadProcessId(hWnd, out pid);
    return (int)pid;
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

function Join-ProcessArgs([string[]]$Values) {
  ($Values | ForEach-Object {
    if ($_ -match '[\s"]') {
      '"' + ($_ -replace '"', '\"') + '"'
    } else {
      $_
    }
  }) -join ' '
}

function Position-Window([IntPtr]$Handle, [int]$X, [int]$Y, [int]$W, [int]$H) {
  if ($Handle -eq [IntPtr]::Zero) { return }
  [TTLiveVideoWin]::ShowWindow($Handle, 9) | Out-Null
  [TTLiveVideoWin]::MoveWindow($Handle, $X, $Y, $W, $H, $true) | Out-Null
  Start-Sleep -Milliseconds 200
}

function Wait-NewWindowByTitle([string]$Title, [IntPtr[]]$ExistingHandles, [int]$TimeoutMs = 15000) {
  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline) {
    $handles = [TTLiveVideoWin]::FindWindowsByTitle($Title) | Where-Object { $ExistingHandles -notcontains $_ }
    if ($handles) { return $handles[0] }
    Start-Sleep -Milliseconds 150
  }
  return [IntPtr]::Zero
}

function Wait-NewWindowsTerminal([int[]]$ExistingIds, [IntPtr[]]$ExistingHandles, [int]$TimeoutMs = 20000) {
  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline) {
    $handles = @([TTLiveVideoWin]::FindWindowsByTitle('Terminal Talk Codex')) +
               @([TTLiveVideoWin]::FindWindowsByTitle('TT ')) |
      Where-Object { $_ -and $ExistingHandles -notcontains $_ }
    if ($handles) {
      $handle = $handles[0]
      return [pscustomobject]@{
        Id = [TTLiveVideoWin]::WindowProcessId($handle)
        MainWindowHandle = $handle
        ProcessName = 'WindowsTerminal'
      }
    }

    $candidates = Get-Process WindowsTerminal -ErrorAction SilentlyContinue |
      Where-Object {
        $_.MainWindowHandle -and
        $_.MainWindowHandle -ne [IntPtr]::Zero -and
        ($ExistingIds -notcontains $_.Id)
      } |
      Sort-Object StartTime -Descending
    if ($candidates) { return $candidates[0] }
    Start-Sleep -Milliseconds 150
  }
  return $null
}

function Find-ExistingTerminal([string]$TitleContains) {
  $patterns = @()
  if ($TitleContains) { $patterns += $TitleContains }
  $patterns += @('Terminal Talk Codex', 'Codex', 'TT ')
  $terminalMatches = @()
  foreach ($pattern in ($patterns | Select-Object -Unique)) {
    $handles = @([TTLiveVideoWin]::FindWindowsByTitle($pattern))
    foreach ($handle in $handles) {
      if ($handle -eq [IntPtr]::Zero) { continue }
      $windowPid = [TTLiveVideoWin]::WindowProcessId($handle)
      if ($windowPid -and $windowPid -ne $PID) {
        $processName = ''
        try { $processName = (Get-Process -Id $windowPid -ErrorAction Stop).ProcessName } catch {}
        $terminalMatches += [pscustomobject]@{
          Id = $windowPid
          MainWindowHandle = $handle
          ProcessName = $processName
          OwnsProcess = $false
          Title = [TTLiveVideoWin]::WindowTitle($handle)
          Priority = if ($processName -match '^(WindowsTerminal|powershell|pwsh|cmd|OpenConsole)$') { 0 } else { 1 }
        }
      }
    }
  }
  return $terminalMatches | Sort-Object Priority, Title | Select-Object -First 1
}

function Stop-TerminalTalkProcesses {
  $needles = @(
    (Join-Path $Root 'app'),
    (Join-Path $env:USERPROFILE '.terminal-talk\app')
  )
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -match '^(electron|terminal-talk)\.exe$' -and
      ($cmd = $_.CommandLine) -and
      ($needles | Where-Object { $cmd -like "*$_*" })
    } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  Start-Sleep -Milliseconds 600
}

function Restart-InstalledToolbar {
  $vbs = Join-Path $Root 'scripts\start-toolbar.vbs'
  if (Test-Path $vbs) {
    try { & cscript.exe //nologo $vbs | Out-Null } catch {}
  }
}

function Start-Toolbar([int]$X, [int]$Y, [int]$W, [int]$H) {
  $existingHandles = @([TTLiveVideoWin]::FindWindowsByTitle('Terminal Talk'))
  $old = @{
    TT_CAPTURE_MODE = $env:TT_CAPTURE_MODE
    TT_CAPTURE_X = $env:TT_CAPTURE_X
    TT_CAPTURE_Y = $env:TT_CAPTURE_Y
    TT_CAPTURE_WIDTH = $env:TT_CAPTURE_WIDTH
    TT_CAPTURE_HEIGHT = $env:TT_CAPTURE_HEIGHT
  }
  $env:TT_CAPTURE_MODE = '1'
  $env:TT_CAPTURE_X = [string]$X
  $env:TT_CAPTURE_Y = [string]$Y
  $env:TT_CAPTURE_WIDTH = [string]$W
  $env:TT_CAPTURE_HEIGHT = [string]$H
  try {
    $proc = Start-Process -FilePath $Electron -ArgumentList 'app' -WorkingDirectory $Root -PassThru
    $handle = Wait-NewWindowByTitle 'Terminal Talk' $existingHandles 20000
    if ($handle -eq [IntPtr]::Zero) { throw "Terminal Talk toolbar window was not found." }
    Position-Window $handle $X $Y $W $H
    return [pscustomobject]@{ Id = $proc.Id; MainWindowHandle = $handle; ProcessName = $proc.ProcessName }
  } finally {
    foreach ($key in $old.Keys) {
      if ($null -eq $old[$key]) { Remove-Item "Env:$key" -ErrorAction SilentlyContinue }
      else { Set-Item "Env:$key" $old[$key] }
    }
  }
}

function Start-CodexTerminal {
  $existingIds = @(Get-Process WindowsTerminal -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
  $existingHandles = @([TTLiveVideoWin]::FindWindowsByTitle('Terminal Talk Codex')) + @([TTLiveVideoWin]::FindWindowsByTitle('TT '))
  $powershellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $codexLaunch = Join-Path $Root 'app\codex-launch.ps1'
  $wt = Get-Command wt.exe -ErrorAction SilentlyContinue

  if ($wt) {
    $wtArgs = @(
      '-w', 'new',
      'new-tab',
      '--title', 'Terminal Talk Codex',
      '--startingDirectory', $Root,
      $powershellExe,
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-NoExit',
      '-File', $codexLaunch
    )
    Start-Process -FilePath $wt.Source -ArgumentList (Join-ProcessArgs $wtArgs) -WorkingDirectory $Root | Out-Null
    $terminal = Wait-NewWindowsTerminal $existingIds $existingHandles 25000
    if ($terminal) { return $terminal }
  }

  $processArgs = Join-ProcessArgs @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', $codexLaunch)
  $proc = Start-Process -FilePath $powershellExe -ArgumentList $processArgs -WorkingDirectory $Root -PassThru
  for ($i = 0; $i -lt 120; $i++) {
    try { $proc.Refresh() } catch {}
    if ($proc.MainWindowHandle -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
      return [pscustomobject]@{ Id = $proc.Id; MainWindowHandle = $proc.MainWindowHandle; ProcessName = $proc.ProcessName }
    }
    Start-Sleep -Milliseconds 150
  }
  throw "Codex terminal window was not found."
}

function Get-CodexTerminal {
  if ($UseExistingTerminal) {
    $terminal = Find-ExistingTerminal $ExistingTerminalTitle
    if (!$terminal) {
      throw "No existing terminal window found with title containing '$ExistingTerminalTitle'. Open your Codex terminal first, or pass -ExistingTerminalTitle with text from its title bar."
    }
    return $terminal
  }
  return Start-CodexTerminal
}

function Start-Recorder([string]$OutPath, [string]$StartedFlag, [int]$DurationMs) {
  Remove-Item -LiteralPath $StartedFlag -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $OutPath -Force -ErrorAction SilentlyContinue
  $stdout = [System.IO.Path]::ChangeExtension($StartedFlag, '.stdout.log')
  $stderr = [System.IO.Path]::ChangeExtension($StartedFlag, '.stderr.log')
  Remove-Item -LiteralPath $stdout -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $stderr -Force -ErrorAction SilentlyContinue
  $recorderArgs = @($RecorderScript, '--out', $OutPath, '--started', $StartedFlag, '--duration-ms', [string]$DurationMs)
  return Start-Process -FilePath $Electron -ArgumentList $recorderArgs -WorkingDirectory $Root -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
}

function Wait-RecorderStarted([string]$StartedFlag) {
  for ($i = 0; $i -lt 100; $i++) {
    if (Test-Path $StartedFlag) { return }
    Start-Sleep -Milliseconds 100
  }
  $stdout = [System.IO.Path]::ChangeExtension($StartedFlag, '.stdout.log')
  $stderr = [System.IO.Path]::ChangeExtension($StartedFlag, '.stderr.log')
  $detail = ''
  if (Test-Path $stdout) { $detail += "`nstdout:`n" + (Get-Content -Raw $stdout) }
  if (Test-Path $stderr) { $detail += "`nstderr:`n" + (Get-Content -Raw $stderr) }
  throw "Recorder did not start$detail"
}

function Wait-FileStable([string]$Path) {
  $lastLength = -1
  $stableReads = 0
  for ($i = 0; $i -lt 60; $i++) {
    if (!(Test-Path $Path)) {
      Start-Sleep -Milliseconds 250
      continue
    }
    $length = (Get-Item -LiteralPath $Path).Length
    if ($length -gt 0 -and $length -eq $lastLength) {
      $stableReads++
      if ($stableReads -ge 4) { return }
    } else {
      $stableReads = 0
      $lastLength = $length
    }
    Start-Sleep -Milliseconds 250
  }
}

function Get-FfmpegPath {
  $cmd = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  try {
    $fromPython = (& python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())" 2>$null).Trim()
    if ($fromPython -and (Test-Path $fromPython)) { return $fromPython }
  } catch {}
  return $null
}

function Get-FfprobePath([string]$FfmpegPath) {
  $cmd = Get-Command ffprobe.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  if ($FfmpegPath) {
    $candidate = Join-Path (Split-Path -Parent $FfmpegPath) 'ffprobe.exe'
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}

function Write-Mp4CompatibilityCopy([string]$WebmPath, [string]$Mp4Path) {
  $ffmpeg = Get-FfmpegPath
  if (!$ffmpeg) { throw "ffmpeg not found; cannot write MP4 compatibility copy." }
  Remove-Item -LiteralPath $Mp4Path -Force -ErrorAction SilentlyContinue
  & $ffmpeg -y -hide_banner -loglevel error -i $WebmPath -map 0:v:0 -map 0:a? -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart $Mp4Path
  if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $Mp4Path)) {
    throw "ffmpeg MP4 compatibility encode failed."
  }
}

function Test-HasAudioStream([string]$VideoPath) {
  $ffmpeg = Get-FfmpegPath
  $ffprobe = Get-FfprobePath $ffmpeg
  if (!$ffprobe) { return $null }
  $probe = & $ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 $VideoPath 2>$null
  return [bool]($probe -match 'audio')
}

function Send-Prompt([IntPtr]$WindowHandle, [string]$Text) {
  if ($WindowHandle -eq [IntPtr]::Zero) { throw "Cannot send prompt: terminal handle is empty." }
  [TTLiveVideoWin]::SetForegroundWindow($WindowHandle) | Out-Null
  Start-Sleep -Milliseconds 700
  $previousClipboard = $null
  try { $previousClipboard = Get-Clipboard -Raw -ErrorAction SilentlyContinue } catch {}
  Set-Clipboard -Value $Text
  Start-Sleep -Milliseconds 150
  $shell = New-Object -ComObject WScript.Shell
  $shell.SendKeys('^v')
  Start-Sleep -Milliseconds 250
  $shell.SendKeys('{ENTER}')
  Start-Sleep -Milliseconds 500
  if ($null -ne $previousClipboard) {
    try { Set-Clipboard -Value $previousClipboard } catch {}
  }
}

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$terminalX = $screen.X + 24
$terminalY = $screen.Y + 36
$terminalW = [int]([Math]::Floor($screen.Width * 0.50) - 38)
$terminalH = $screen.Height - 72
$toolbarX = $terminalX + $terminalW + 16
$toolbarY = $terminalY
$toolbarW = $screen.Width - ($toolbarX - $screen.X) - 24
$toolbarH = $terminalH
if ($toolbarW -lt 680) {
  $terminalW = [Math]::Max(760, $screen.Width - 760 - 88)
  $toolbarX = $terminalX + $terminalW + 16
  $toolbarW = $screen.Width - ($toolbarX - $screen.X) - 24
}

$started = Join-Path $TmpRoot 'live-codex-recorder-started.flag'
$durationMs = [Math]::Max(30, $DurationSec) * 1000
$toolbarProc = $null
$terminalProc = $null
$recorderProc = $null

Write-Host ""
Write-Host "=== LIVE CODEX + TERMINAL TALK RECORDING ==="
if ($UseExistingTerminal) {
  Write-Host "This will use your existing Codex terminal and open a real Terminal Talk toolbar."
} else {
  Write-Host "This will open a real Terminal Talk toolbar and a real Codex terminal."
}
Write-Host "Do not touch the mouse or keyboard until recording finishes."
Write-Host "Output: $OutputWebm"
Write-Host ""
Start-Sleep -Seconds 4

try {
  Stop-TerminalTalkProcesses
  $toolbarProc = Start-Toolbar $toolbarX $toolbarY $toolbarW $toolbarH
  $terminalProc = Get-CodexTerminal
  Position-Window $terminalProc.MainWindowHandle $terminalX $terminalY $terminalW $terminalH
  Position-Window $toolbarProc.MainWindowHandle $toolbarX $toolbarY $toolbarW $toolbarH
  Start-Sleep -Seconds 4

  $recorderProc = Start-Recorder $OutputWebm $started $durationMs
  Wait-RecorderStarted $started

  if ($ManualPrompt) {
    Write-Host "Recorder is running. Type this into the Codex terminal now:"
    Write-Host $Prompt
  } else {
    Start-Sleep -Seconds ([Math]::Max(0, $PromptDelaySec))
    Send-Prompt $terminalProc.MainWindowHandle $Prompt
  }

  Wait-Process -Id $recorderProc.Id -Timeout ([Math]::Ceiling($DurationSec + 30)) -ErrorAction Stop
  Wait-FileStable $OutputWebm
  if (!(Test-Path $OutputWebm)) { throw "Expected output was not written: $OutputWebm" }

  $hasAudio = Test-HasAudioStream $OutputWebm
  if ($hasAudio -eq $false) {
    throw "Recording completed without an audio stream. The desktop capture fell back to video-only."
  }

  Write-Mp4CompatibilityCopy $OutputWebm $OutputMp4
  Write-Host "OK - wrote $OutputWebm"
  Write-Host "OK - wrote $OutputMp4"
  if ($hasAudio -eq $true) { Write-Host "OK - audio stream detected" }
  else { Write-Warning "Could not verify audio stream because ffprobe was not found." }
} finally {
  if ($recorderProc) {
    try {
      $recorderProc.Refresh()
      if (!$recorderProc.HasExited) { Stop-Process -Id $recorderProc.Id -Force -ErrorAction SilentlyContinue }
    } catch {}
  }
  if ($terminalProc -and $terminalProc.Id -and $terminalProc.OwnsProcess -ne $false) {
    try { Stop-Process -Id $terminalProc.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  if ($toolbarProc -and $toolbarProc.Id) {
    try { Stop-Process -Id $toolbarProc.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  Restart-InstalledToolbar
}
