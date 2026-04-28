#requires -Version 5.1
param(
  [ValidateSet('assistant', 'heyjarvis', 'settings', 'all')]
  [string]$Video = 'assistant',
  [string]$OutputSuffix = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

if ($OutputSuffix -and $OutputSuffix -notmatch '^[A-Za-z0-9_-]+$') {
  throw "OutputSuffix may only contain letters, numbers, underscores, and hyphens."
}

$Root = (Resolve-Path .).Path
$Electron = Join-Path $Root 'app\node_modules\electron\dist\electron.exe'
if (!(Test-Path $Electron)) { $Electron = Join-Path $Root 'app\node_modules\.bin\electron.cmd' }
$RecorderScript = Join-Path $Root 'scripts\record-desktop.cjs'
$StageScript = Join-Path $Root 'scripts\demo-terminal-stage.cjs'
$BackdropScript = Join-Path $Root 'scripts\demo-backdrop.cjs'
$VideoDir = Join-Path $Root 'docs\videos'
$TmpRoot = Join-Path $Root 'tmp\real-toolbar-video'
$AudioDir = Join-Path $Root 'tmp\video-audio'
$ClaudeClipDir = Join-Path $Root 'docs\Claude Code Videos\_clips'
$Wallpaper = Join-Path $Root 'docs\assets\wallpaper\terminal-talk-wallpaper.png'

if (!(Test-Path $Electron)) { throw "Electron not found at $Electron. Run npm install in app/ first." }
if (!(Test-Path $RecorderScript)) { throw "Recorder script not found: $RecorderScript" }
if (!(Test-Path $StageScript)) { throw "Demo stage script not found: $StageScript" }
if (!(Test-Path $BackdropScript)) { throw "Demo backdrop script not found: $BackdropScript" }

New-Item -ItemType Directory -Path $VideoDir -Force | Out-Null
New-Item -ItemType Directory -Path $TmpRoot -Force | Out-Null

Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class TTVideoWin {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);
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

function Move-CursorSmooth([int]$x, [int]$y, [int]$ms = 700) {
  $start = New-Object TTVideoWin+POINT
  [TTVideoWin]::GetCursorPos([ref]$start) | Out-Null
  $steps = [Math]::Max(10, [Math]::Floor($ms / 16))
  for ($i = 1; $i -le $steps; $i++) {
    $t = $i / $steps
    $ease = 1 - [Math]::Pow(1 - $t, 3)
    [TTVideoWin]::SetCursorPos(
      [int]($start.X + (($x - $start.X) * $ease)),
      [int]($start.Y + (($y - $start.Y) * $ease))
    ) | Out-Null
    Start-Sleep -Milliseconds 16
  }
}

function Click-At([int]$x, [int]$y) {
  Move-CursorSmooth $x $y 520
  Start-Sleep -Milliseconds 140
  [TTVideoWin]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 70
  [TTVideoWin]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}

function Wait-MainWindow($Process) {
  for ($i = 0; $i -lt 80; $i++) {
    try { $Process.Refresh() } catch {}
    if ($Process.MainWindowHandle -and $Process.MainWindowHandle -ne [IntPtr]::Zero) {
      return $Process.MainWindowHandle
    }
    Start-Sleep -Milliseconds 100
  }
  return [IntPtr]::Zero
}

function Wait-NewWindowsTerminal([int[]]$ExistingIds, [IntPtr[]]$ExistingHandles, [string]$Title, [int]$TimeoutMs = 10000) {
  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline) {
    $handles = [TTVideoWin]::FindWindowsByTitle($Title) |
      Where-Object { $ExistingHandles -notcontains $_ }
    if ($handles) {
      $handle = $handles[0]
      $windowPid = [TTVideoWin]::WindowProcessId($handle)
      return [pscustomobject]@{ Id = $windowPid; MainWindowHandle = $handle; ProcessName = 'WindowsTerminal' }
    }

    $candidates = Get-Process WindowsTerminal -ErrorAction SilentlyContinue |
      Where-Object {
        $_.MainWindowHandle -and
        $_.MainWindowHandle -ne [IntPtr]::Zero -and
        ($ExistingIds -notcontains $_.Id)
      } |
      Sort-Object StartTime -Descending
    if ($candidates) {
      return $candidates[0]
    }
    Start-Sleep -Milliseconds 100
  }
  return $null
}

function Position-Window([IntPtr]$Handle, [int]$X, [int]$Y, [int]$W, [int]$H) {
  if ($Handle -eq [IntPtr]::Zero) { return }
  [TTVideoWin]::ShowWindow($Handle, 9) | Out-Null
  [TTVideoWin]::MoveWindow($Handle, $X, $Y, $W, $H, $true) | Out-Null
  Start-Sleep -Milliseconds 120
  [TTVideoWin]::SetForegroundWindow($Handle) | Out-Null
}

function Wait-NewWindowByTitle([string]$Title, [IntPtr[]]$ExistingHandles, [int]$TimeoutMs = 10000) {
  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline) {
    $handles = [TTVideoWin]::FindWindowsByTitle($Title) |
      Where-Object { $ExistingHandles -notcontains $_ }
    if ($handles) { return $handles[0] }
    Start-Sleep -Milliseconds 100
  }
  return [IntPtr]::Zero
}

function Stop-WindowsByTitle([string]$Title) {
  $handles = @([TTVideoWin]::FindWindowsByTitle($Title))
  foreach ($handle in $handles) {
    if ($handle -eq [IntPtr]::Zero) { continue }
    $windowPid = [TTVideoWin]::WindowProcessId($handle)
    if ($windowPid -and $windowPid -ne $PID) {
      try { Stop-Process -Id $windowPid -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
  if ($handles.Count -gt 0) {
    Start-Sleep -Milliseconds 500
  }
}

function Join-ProcessArgs([string[]]$Values) {
  ($Values | ForEach-Object {
    if ($_ -match '[\s"]') {
      '"' + ($_ -replace '"', '\"') + '"'
    } else {
      $_
    }
  }) -join ' '
}

function Stamp {
  Get-Date -Format 'yyyyMMddTHHmmssfff'
}

function Stop-TerminalTalkProcesses {
  $needles = @(
    (Join-Path $Root 'app').Replace('\', '\\'),
    (Join-Path $env:USERPROFILE '.terminal-talk\app').Replace('\', '\\')
  )
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -match '^(electron|terminal-talk)\.exe$' -and
      ($cmd = $_.CommandLine) -and
      ($needles | Where-Object { $cmd -like "*$($_.Replace('\\', '\'))*" })
    } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Restart-InstalledToolbar {
  $vbs = Join-Path $Root 'scripts\start-toolbar.vbs'
  if (Test-Path $vbs) {
    try { & cscript.exe //nologo $vbs | Out-Null } catch {}
  }
}

function New-DemoHome([int]$ToolbarX, [int]$ToolbarY) {
  $demoHome = Join-Path $TmpRoot ("home-" + (Get-Date -Format 'yyyyMMddHHmmssfff'))
  New-Item -ItemType Directory -Path (Join-Path $demoHome 'queue') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $demoHome 'sessions') -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $demoHome 'listening.state') -Value 'off' -Encoding ascii

  $config = [ordered]@{
    voices = [ordered]@{
      edge_clip       = 'en-GB-SoniaNeural'
      edge_response   = 'en-GB-RyanNeural'
      openai_clip     = 'shimmer'
      openai_response = 'onyx'
    }
    hotkeys = [ordered]@{
      toggle_window    = 'Control+Shift+A'
      speak_clipboard  = 'Control+Shift+S'
      toggle_listening = 'Control+Shift+J'
      pause_resume     = 'Control+Shift+P'
      pause_only       = 'Control+Shift+O'
    }
    playback = [ordered]@{
      speed                     = 1.05
      auto_prune                = $false
      auto_prune_sec            = 28
      auto_continue_after_click = $true
      palette_variant           = 'default'
      tts_provider              = 'edge'
      master_volume             = 1
    }
    speech_includes = [ordered]@{
      code_blocks    = $false
      inline_code    = $false
      urls           = $false
      headings       = $true
      bullet_markers = $true
      image_alt      = $false
      tool_calls     = $true
    }
    heartbeat_enabled = $true
    selected_tab = 'all'
    tabs_expanded = $true
    openai_api_key = $null
    window = [ordered]@{ x = $ToolbarX; y = $ToolbarY; dock = $null }
    panels = [ordered]@{ transcript_expanded = $false; transcript_view = 'spoken' }
  }
  $config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $demoHome 'config.json') -Encoding utf8

  $now = [DateTimeOffset]::Now.ToUnixTimeSeconds()
  $registry = [ordered]@{
    assignments = [ordered]@{
      c0dec0de = [ordered]@{
        index = 0; label = 'Codex demo'; session_id = 'c0dec0de-session'; claude_pid = 0
        pinned = $true; muted = $false; focus = $true; last_seen = $now
        speech_includes = [ordered]@{ tool_calls = $true }
      }
      deadbeef = [ordered]@{
        index = 4; label = 'Claude docs'; session_id = 'deadbeef-session'; claude_pid = 0
        pinned = $true; muted = $false; focus = $false; last_seen = $now
      }
      feedc0de = [ordered]@{
        index = 16; label = 'Audit run'; session_id = 'feedc0de-session'; claude_pid = 0
        pinned = $true; muted = $false; focus = $false; last_seen = $now
      }
    }
  }
  $registry | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $demoHome 'session-colours.json') -Encoding utf8
  return $demoHome
}

function Drop-BodyClip([string]$DemoHome, [string]$Source, [string]$Short, [int]$Index, [string]$Spoken, [string]$Original = '') {
  $queue = Join-Path $DemoHome 'queue'
  $name = "$(Stamp)-D$('{0:d4}' -f $Index)-$Short.mp3"
  $target = Join-Path $queue $name
  Copy-Item -LiteralPath $Source -Destination "$target.partial" -Force
  Move-Item -LiteralPath "$target.partial" -Destination $target -Force
  Set-Content -LiteralPath ([System.IO.Path]::ChangeExtension($target, '.txt')) -Value $Spoken -Encoding utf8
  if ($Original) {
    $base = $target.Substring(0, $target.Length - [System.IO.Path]::GetExtension($target).Length)
    Set-Content -LiteralPath "$base.original.txt" -Value $Original -Encoding utf8
  }
}

function Drop-JClip([string]$DemoHome, [string]$Source, [string]$Short, [int]$Index, [string]$Spoken, [string]$Original = '') {
  $queue = Join-Path $DemoHome 'queue'
  $name = "$(Stamp)-clip-$Short-$('{0:d2}' -f $Index).mp3"
  $target = Join-Path $queue $name
  Copy-Item -LiteralPath $Source -Destination "$target.partial" -Force
  Move-Item -LiteralPath "$target.partial" -Destination $target -Force
  Set-Content -LiteralPath ([System.IO.Path]::ChangeExtension($target, '.txt')) -Value $Spoken -Encoding utf8
  if ($Original) {
    $base = $target.Substring(0, $target.Length - [System.IO.Path]::GetExtension($target).Length)
    Set-Content -LiteralPath "$base.original.txt" -Value $Original -Encoding utf8
  }
}

function Start-DemoTerminal([string]$Name, [string]$FlagPath, [int]$X, [int]$Y, [int]$W, [int]$H, [int]$HoldSeconds) {
  $title = "Terminal Talk $Name demo"
  Stop-WindowsByTitle $title
  $existingTitleHandles = @([TTVideoWin]::FindWindowsByTitle($title))
  $pagePath = Join-Path $TmpRoot "$Name-stage.html"
  $arguments = Join-ProcessArgs @(
    $StageScript,
    '--name', $Name,
    '--title', $title,
    '--flag', $FlagPath,
    '--x', [string]$X,
    '--y', [string]$Y,
    '--width', [string]$W,
    '--height', [string]$H,
    '--page', $pagePath
  )
  $proc = Start-Process -FilePath $Electron -ArgumentList $arguments -WorkingDirectory $Root -PassThru
  $handle = Wait-NewWindowByTitle $title $existingTitleHandles 20000
  if ($handle -eq [IntPtr]::Zero) {
    return $null
  }
  Position-Window $handle $X $Y $W $H
  $windowPid = [TTVideoWin]::WindowProcessId($handle)
  return [pscustomobject]@{ Id = $windowPid; ProcessId = $proc.Id; MainWindowHandle = $handle; ProcessName = 'DemoStage'; OwnsProcess = $true }
}

function Start-Toolbar([string]$DemoHome, [int]$X, [int]$Y, [int]$W, [int]$H, [int]$AutoOpenSettingsMs = 0, [bool]$DemoSettingsMode = $false, [string]$DemoStartFlag = '', [int]$DemoSettingsFallbackMs = 0, [int]$DemoSettingsVisualDurationMs = 0) {
  $existingHandles = @([TTVideoWin]::FindWindowsByTitle('Terminal Talk'))
  $old = @{
    TT_INSTALL_DIR = $env:TT_INSTALL_DIR
    TT_TEST_MODE = $env:TT_TEST_MODE
    TT_CAPTURE_MODE = $env:TT_CAPTURE_MODE
    TT_CAPTURE_X = $env:TT_CAPTURE_X
    TT_CAPTURE_Y = $env:TT_CAPTURE_Y
    TT_CAPTURE_WIDTH = $env:TT_CAPTURE_WIDTH
    TT_CAPTURE_HEIGHT = $env:TT_CAPTURE_HEIGHT
    TT_DEMO_AUTO_OPEN_SETTINGS_MS = $env:TT_DEMO_AUTO_OPEN_SETTINGS_MS
    TT_DEMO_SETTINGS_MODE = $env:TT_DEMO_SETTINGS_MODE
    TT_DEMO_START_FLAG = $env:TT_DEMO_START_FLAG
    TT_DEMO_SETTINGS_START_FALLBACK_MS = $env:TT_DEMO_SETTINGS_START_FALLBACK_MS
    TT_DEMO_SETTINGS_VISUAL_DURATION_MS = $env:TT_DEMO_SETTINGS_VISUAL_DURATION_MS
  }
  $env:TT_INSTALL_DIR = $DemoHome
  $env:TT_TEST_MODE = '1'
  $env:TT_CAPTURE_MODE = '1'
  $env:TT_CAPTURE_X = [string]$X
  $env:TT_CAPTURE_Y = [string]$Y
  $env:TT_CAPTURE_WIDTH = [string]$W
  $env:TT_CAPTURE_HEIGHT = [string]$H
  if ($AutoOpenSettingsMs -gt 0) {
    $env:TT_DEMO_AUTO_OPEN_SETTINGS_MS = [string]$AutoOpenSettingsMs
  } else {
    Remove-Item Env:TT_DEMO_AUTO_OPEN_SETTINGS_MS -ErrorAction SilentlyContinue
  }
  if ($DemoSettingsMode) {
    $env:TT_DEMO_SETTINGS_MODE = '1'
  } else {
    Remove-Item Env:TT_DEMO_SETTINGS_MODE -ErrorAction SilentlyContinue
  }
  if ($DemoStartFlag) {
    $env:TT_DEMO_START_FLAG = $DemoStartFlag
  } else {
    Remove-Item Env:TT_DEMO_START_FLAG -ErrorAction SilentlyContinue
  }
  if ($DemoSettingsFallbackMs -gt 0) {
    $env:TT_DEMO_SETTINGS_START_FALLBACK_MS = [string]$DemoSettingsFallbackMs
  } else {
    Remove-Item Env:TT_DEMO_SETTINGS_START_FALLBACK_MS -ErrorAction SilentlyContinue
  }
  if ($DemoSettingsVisualDurationMs -gt 0) {
    $env:TT_DEMO_SETTINGS_VISUAL_DURATION_MS = [string]$DemoSettingsVisualDurationMs
  } else {
    Remove-Item Env:TT_DEMO_SETTINGS_VISUAL_DURATION_MS -ErrorAction SilentlyContinue
  }
  try {
    $proc = Start-Process -FilePath $Electron -ArgumentList 'app' -WorkingDirectory $Root -PassThru
    $handle = Wait-NewWindowByTitle 'Terminal Talk' $existingHandles 15000
    if ($handle -ne [IntPtr]::Zero) {
      Position-Window $handle $X $Y $W $H
    }
    return [pscustomobject]@{ Id = $proc.Id; MainWindowHandle = $handle; ProcessName = $proc.ProcessName }
  } finally {
    foreach ($key in $old.Keys) {
      if ($null -eq $old[$key]) { Remove-Item "Env:$key" -ErrorAction SilentlyContinue }
      else { Set-Item "Env:$key" $old[$key] }
    }
  }
}

function Start-Backdrop([int]$X, [int]$Y, [int]$W, [int]$H) {
  $pagePath = Join-Path $TmpRoot 'backdrop.html'
  $arguments = Join-ProcessArgs @(
    $BackdropScript,
    '--x', [string]$X,
    '--y', [string]$Y,
    '--width', [string]$W,
    '--height', [string]$H,
    '--image', $Wallpaper,
    '--page', $pagePath
  )
  return Start-Process -FilePath $Electron -ArgumentList $arguments -WorkingDirectory $Root -PassThru
}

function Start-Recorder([string]$OutPath, [string]$StartedFlag, [int]$DurationMs) {
  Remove-Item -LiteralPath $StartedFlag -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $OutPath -Force -ErrorAction SilentlyContinue
  $stdout = [System.IO.Path]::ChangeExtension($StartedFlag, '.stdout.log')
  $stderr = [System.IO.Path]::ChangeExtension($StartedFlag, '.stderr.log')
  Remove-Item -LiteralPath $stdout -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $stderr -Force -ErrorAction SilentlyContinue
  $args = @(
    $RecorderScript,
    '--out', $OutPath,
    '--started', $StartedFlag,
    '--duration-ms', [string]$DurationMs
  )
  return Start-Process -FilePath $Electron -ArgumentList $args -WorkingDirectory $Root -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
}

function Wait-RecorderStarted([string]$StartedFlag) {
  for ($i = 0; $i -lt 80; $i++) {
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

function Common-Setup([string]$Name, [int]$DurationMs) {
  $screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $terminalX = $screen.X + 24
  $terminalY = $screen.Y + 36
  if ($Name -eq 'settings') {
    $terminalW = [int]([Math]::Floor($screen.Width * 0.44) - 40)
    $toolbarX = $screen.X + [int]([Math]::Floor($screen.Width * 0.46)) - 18
  } else {
    $terminalW = [int]([Math]::Floor($screen.Width * 0.49) - 40)
    $toolbarX = $screen.X + [int]([Math]::Floor($screen.Width * 0.51))
  }
  $terminalH = $screen.Height - 72
  $toolbarY = $screen.Y + 36
  $toolbarW = $screen.Width - ($toolbarX - $screen.X) - 36
  $toolbarH = $screen.Height - 72
  $flag = Join-Path $TmpRoot "$Name-go.flag"
  $started = Join-Path $TmpRoot "$Name-recorder-started.flag"
  $settingsBase = "terminal-talk-settings-sessions$OutputSuffix"
  $out = switch ($Name) {
    'assistant' { Join-Path $VideoDir 'terminal-talk-overview.webm' }
    'heyjarvis' { Join-Path $VideoDir 'terminal-talk-queue-jarvis.webm' }
    default { Join-Path $VideoDir "$settingsBase.webm" }
  }
  Remove-Item -LiteralPath $flag -Force -ErrorAction SilentlyContinue

  $demoHome = New-DemoHome $toolbarX $toolbarY
  $backdropProc = Start-Backdrop $screen.X $screen.Y $screen.Width $screen.Height
  Start-Sleep -Milliseconds 700
  $terminalProc = Start-DemoTerminal $Name $flag $terminalX $terminalY $terminalW $terminalH ([Math]::Ceiling($DurationMs / 1000) + 8)
  $autoOpenSettingsMs = 0
  $demoSettingsMode = $Name -eq 'settings'
  $demoStartFlag = if ($demoSettingsMode) { $flag } else { '' }
  $demoVisualDurationMs = if ($demoSettingsMode) { $DurationMs } else { 0 }
  $toolbarProc = Start-Toolbar $demoHome $toolbarX $toolbarY $toolbarW $toolbarH $autoOpenSettingsMs $demoSettingsMode $demoStartFlag 0 $demoVisualDurationMs
  if (!$terminalProc -or $terminalProc.MainWindowHandle -eq [IntPtr]::Zero) {
    throw "Demo terminal window was not found; refusing to record the wrong screen."
  }
  if (!$toolbarProc -or $toolbarProc.MainWindowHandle -eq [IntPtr]::Zero) {
    throw "Terminal Talk toolbar window was not found; refusing to record cursor-only footage."
  }
  Position-Window $terminalProc.MainWindowHandle $terminalX $terminalY $terminalW $terminalH
  Position-Window $toolbarProc.MainWindowHandle $toolbarX $toolbarY $toolbarW $toolbarH
  if ($Name -eq 'settings') {
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    [TTVideoWin]::SetCursorPos($bounds.X, $bounds.Y) | Out-Null
  }
  Start-Sleep -Seconds 4
  $recorderProc = Start-Recorder $out $started $DurationMs
  Wait-RecorderStarted $started
  $recorderStartedAt = Get-Date
  Set-Content -LiteralPath $flag -Value 'go' -Encoding ascii

  $uiX = $toolbarX + 8
  $uiY = $toolbarY + 74
  return [pscustomobject]@{
    DemoHome = $demoHome
    Out = $out
    TerminalProc = $terminalProc
    ToolbarProc = $toolbarProc
    BackdropProc = $backdropProc
    RecorderProc = $recorderProc
    RecorderStartedAt = $recorderStartedAt
    DurationMs = $DurationMs
    UiX = $uiX
    UiY = $uiY
    ToolbarX = $toolbarX
    ToolbarY = $toolbarY
    ToolbarW = $toolbarW
    ToolbarH = $toolbarH
    TerminalX = $terminalX
    TerminalY = $terminalY
    TerminalW = $terminalW
    TerminalH = $terminalH
  }
}

function Finish-Run($ctx, [int]$TimeoutSec) {
  if ($ctx.RecorderStartedAt -and $ctx.DurationMs) {
    $targetEnd = $ctx.RecorderStartedAt.AddMilliseconds($ctx.DurationMs + 2500)
    while ((Get-Date) -lt $targetEnd) {
      Start-Sleep -Milliseconds 250
    }
  }
  try {
    Wait-Process -Id $ctx.RecorderProc.Id -Timeout $TimeoutSec -ErrorAction Stop
  } catch {
    if (!(Test-Path $ctx.Out)) { throw }
  }
  try {
    $ctx.RecorderProc.Refresh()
    if ($ctx.RecorderProc.ExitCode -ne 0 -and $null -ne $ctx.RecorderProc.ExitCode) {
      throw "Recorder exited $($ctx.RecorderProc.ExitCode)"
    }
  } catch [System.InvalidOperationException] {
    if (!(Test-Path $ctx.Out)) { throw }
  }
  if (!(Test-Path $ctx.Out)) { throw "Expected output was not written: $($ctx.Out)" }
  Wait-FileStable $ctx.Out
  Polish-Video $ctx.Out $ctx.DurationMs
  Write-Host "OK - wrote $($ctx.Out)"
}

function Wait-FileStable([string]$Path) {
  $lastLength = -1
  $stableReads = 0
  for ($i = 0; $i -lt 40; $i++) {
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

function Polish-Video([string]$Path, [int]$DurationMs) {
  $ffmpeg = Get-FfmpegPath
  if (!$ffmpeg) {
    Write-Warning "ffmpeg not found; leaving raw desktop recording unpolished."
    return
  }
  $raw = Join-Path $TmpRoot ([System.IO.Path]::GetFileNameWithoutExtension($Path) + '-raw.webm')
  $tmp = Join-Path $TmpRoot ([System.IO.Path]::GetFileNameWithoutExtension($Path) + '-polished.webm')
  Remove-Item -LiteralPath $raw -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  Move-Item -LiteralPath $Path -Destination $raw -Force
  $fadeStart = [Math]::Max(1, ($DurationMs / 1000.0) - 2.5)
  $filter = "crop=1920:1080:0:24,scale=1280:720,setsar=1,fade=t=out:st=$fadeStart`:d=2.5"
  & $ffmpeg -y -hide_banner -loglevel error -i $raw -vf $filter -map 0:v:0 -map 0:a? -c:v libvpx-vp9 -crf 31 -b:v 0 -pix_fmt yuv420p -c:a libopus -b:a 96k $tmp
  if ($LASTEXITCODE -ne 0 -or !(Test-Path $tmp)) {
    Move-Item -LiteralPath $raw -Destination $Path -Force
    throw "ffmpeg polish step failed"
  }
  Move-Item -LiteralPath $tmp -Destination $Path -Force
  Remove-Item -LiteralPath $raw -Force -ErrorAction SilentlyContinue
}

function Build-SettingsNarrationTrack([int]$DurationMs) {
  $ffmpeg = Get-FfmpegPath
  if (!$ffmpeg) { throw "ffmpeg not found; cannot build settings narration track." }
  $sources = @(
    @{ File = 'settings-open.mp3'; Delay = 0 },
    @{ File = 'settings-2.mp3'; Delay = 11000 },
    @{ File = 'settings-3.mp3'; Delay = 26000 },
    @{ File = 'settings-4.mp3'; Delay = 38000 },
    @{ File = 'settings-5-short.mp3'; Delay = 50000 }
  )
  $out = Join-Path $TmpRoot 'settings-narration.wav'
  Remove-Item -LiteralPath $out -Force -ErrorAction SilentlyContinue

  $args = @('-y', '-hide_banner', '-loglevel', 'error')
  foreach ($src in $sources) {
    $path = Join-Path $AudioDir $src.File
    if (!(Test-Path -LiteralPath $path)) { throw "Missing narration source: $path" }
    $args += @('-i', $path)
  }

  $filters = @()
  $mixInputs = ''
  for ($i = 0; $i -lt $sources.Count; $i++) {
    $delay = [int]$sources[$i].Delay
    $filters += "[$i`:a]adelay=$delay|$delay[a$i]"
    $mixInputs += "[a$i]"
  }
  $durationSec = ([double]($DurationMs / 1000.0)).ToString('0.###', [System.Globalization.CultureInfo]::InvariantCulture)
  $filter = ($filters -join ';') + ";${mixInputs}amix=inputs=$($sources.Count):duration=longest:normalize=0,apad,atrim=duration=$durationSec,volume=6dB,alimiter=limit=0.95,asetpts=N/SR/TB[a]"

  & $ffmpeg @args -filter_complex $filter -map '[a]' -ar 48000 -ac 2 $out
  if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $out)) {
    throw "ffmpeg narration build failed"
  }
  return $out
}

function Mux-ExternalAudio([string]$Path, [string]$AudioPath, [int]$DurationMs) {
  $ffmpeg = Get-FfmpegPath
  if (!$ffmpeg) { throw "ffmpeg not found; cannot mux narration track." }
  if (!(Test-Path -LiteralPath $Path)) { throw "Video missing before mux: $Path" }
  if (!(Test-Path -LiteralPath $AudioPath)) { throw "Audio missing before mux: $AudioPath" }
  $raw = Join-Path $TmpRoot ([System.IO.Path]::GetFileNameWithoutExtension($Path) + '-visual-only.webm')
  $tmp = Join-Path $TmpRoot ([System.IO.Path]::GetFileNameWithoutExtension($Path) + '-with-audio.webm')
  Remove-Item -LiteralPath $raw -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  Move-Item -LiteralPath $Path -Destination $raw -Force
  $durationSec = ([double]($DurationMs / 1000.0)).ToString('0.###', [System.Globalization.CultureInfo]::InvariantCulture)
  & $ffmpeg -y -hide_banner -loglevel error -i $raw -i $AudioPath -map 0:v:0 -map 1:a:0 -c:v copy -c:a libopus -b:a 128k -disposition:a:0 default -t $durationSec $tmp
  if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $tmp)) {
    Move-Item -LiteralPath $raw -Destination $Path -Force
    throw "ffmpeg audio mux failed"
  }
  Move-Item -LiteralPath $tmp -Destination $Path -Force
  Remove-Item -LiteralPath $raw -Force -ErrorAction SilentlyContinue
}

function Write-Mp4CompatibilityCopy([string]$WebmPath, [string]$Mp4Path) {
  $ffmpeg = Get-FfmpegPath
  if (!$ffmpeg) { throw "ffmpeg not found; cannot write MP4 compatibility copy." }
  if (!(Test-Path -LiteralPath $WebmPath)) { throw "WebM missing before MP4 encode: $WebmPath" }
  Remove-Item -LiteralPath $Mp4Path -Force -ErrorAction SilentlyContinue
  & $ffmpeg -y -hide_banner -loglevel error -i $WebmPath -map 0:v:0 -map 0:a:0 -c:v libx264 -preset medium -crf 24 -pix_fmt yuv420p -c:a aac -b:a 192k -disposition:a:0 default -movflags +faststart $Mp4Path
  if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $Mp4Path)) {
    throw "ffmpeg MP4 compatibility encode failed"
  }
}

function Record-Assistant {
  $ctx = Common-Setup 'assistant' 44000
  $dotStrip = @{ X = $ctx.UiX + 180; Y = $ctx.UiY + 118 }
  $tabs = @{ X = $ctx.UiX + 210; Y = $ctx.UiY + 82 }
  $transcript = @{ X = $ctx.UiX + 90; Y = $ctx.UiY + 150 }
  try {
    Move-CursorSmooth ($ctx.TerminalX + 260) ($ctx.TerminalY + 110) 800
    Start-Sleep -Milliseconds 1500
    Drop-BodyClip $ctx.DemoHome (Join-Path $AudioDir 'overview-1.mp3') 'c0dec0de' 1 'Terminal Talk watches assistant output and turns it into a spoken queue.'
    Start-Sleep -Milliseconds 6500
    Move-CursorSmooth $dotStrip.X $dotStrip.Y 900
    Drop-BodyClip $ctx.DemoHome (Join-Path $AudioDir 'overview-2.mp3') 'deadbeef' 2 'Each terminal keeps its own colour, tab, transcript, and optional voice.'
    Start-Sleep -Milliseconds 7000
    Move-CursorSmooth $tabs.X $tabs.Y 800
    Drop-BodyClip $ctx.DemoHome (Join-Path $AudioDir 'overview-3.mp3') 'c0dec0de' 3 'The toolbar stays out of your way while the audio keeps you in the loop.'
    Start-Sleep -Milliseconds 7600
    Click-At $transcript.X $transcript.Y
    Start-Sleep -Milliseconds 9000
    Move-CursorSmooth $dotStrip.X $dotStrip.Y 700
    Finish-Run $ctx 70
  } finally {
    if ($ctx.TerminalProc -and $ctx.TerminalProc.OwnsProcess) {
      try { Stop-Process -Id $ctx.TerminalProc.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
    try { Stop-Process -Id $ctx.ToolbarProc.Id -Force -ErrorAction SilentlyContinue } catch {}
    try { Stop-Process -Id $ctx.BackdropProc.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
}

function Record-HeyJarvis {
  $ctx = Common-Setup 'heyjarvis' 38000
  $leftText = @{ X = $ctx.TerminalX + 110; Y = $ctx.TerminalY + 150 }
  $dotStrip = @{ X = $ctx.UiX + 170; Y = $ctx.UiY + 118 }
  $transcript = @{ X = $ctx.UiX + 90; Y = $ctx.UiY + 150 }
  try {
    Move-CursorSmooth $leftText.X $leftText.Y 800
    Start-Sleep -Milliseconds 1300
    Drop-BodyClip $ctx.DemoHome (Join-Path $ClaudeClipDir 'hj-01-intro.mp3') 'c0dec0de' 1 'You can have Terminal Talk read any text aloud, in any application.'
    Start-Sleep -Milliseconds 4300
    Move-CursorSmooth ($leftText.X + 360) ($leftText.Y + 42) 1400
    Drop-BodyClip $ctx.DemoHome (Join-Path $ClaudeClipDir 'hj-03-trigger.mp3') 'c0dec0de' 2 'Then say hey jarvis, or press Control Shift S.'
    Start-Sleep -Milliseconds 3300
    Move-CursorSmooth $dotStrip.X $dotStrip.Y 900
    Drop-JClip $ctx.DemoHome (Join-Path $ClaudeClipDir 'hj-04-content.mp3') 'c0dec0de' 1 'The Hub schema migration is approved. Apply it during the maintenance window on Friday at 8 PM.' 'The Hub schema migration is approved. Apply it during the maintenance window on Friday at 8 PM.'
    Start-Sleep -Milliseconds 8000
    Drop-BodyClip $ctx.DemoHome (Join-Path $ClaudeClipDir 'hj-05-priority.mp3') 'c0dec0de' 3 'Hey jarvis clips jump the queue. They play before any pending body audio.'
    Start-Sleep -Milliseconds 5000
    Click-At $transcript.X $transcript.Y
    Start-Sleep -Milliseconds 800
    Drop-BodyClip $ctx.DemoHome (Join-Path $ClaudeClipDir 'hj-06-transcript.mp3') 'c0dec0de' 4 'Every clip lands in the transcript panel with a copy button.'
    Start-Sleep -Milliseconds 6200
    Drop-BodyClip $ctx.DemoHome (Join-Path $ClaudeClipDir 'hj-07-end.mp3') 'c0dec0de' 5 'Hands-free reading, anywhere on Windows.'
    Finish-Run $ctx 65
  } finally {
    if ($ctx.TerminalProc -and $ctx.TerminalProc.OwnsProcess) {
      try { Stop-Process -Id $ctx.TerminalProc.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
    try { Stop-Process -Id $ctx.ToolbarProc.Id -Force -ErrorAction SilentlyContinue } catch {}
    try { Stop-Process -Id $ctx.BackdropProc.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
}

function Record-Settings {
  $durationMs = 66000
  $narration = Build-SettingsNarrationTrack $durationMs
  $ctx = Common-Setup 'settings' $durationMs
  try {
    Finish-Run $ctx 95
    Mux-ExternalAudio $ctx.Out $narration $durationMs
    Write-Host "OK - muxed narration into $($ctx.Out)"
    $mp4Out = Join-Path $VideoDir "terminal-talk-settings-sessions$OutputSuffix.mp4"
    Write-Mp4CompatibilityCopy $ctx.Out $mp4Out
    Write-Host "OK - wrote $mp4Out"
  } finally {
    if ($ctx.TerminalProc -and $ctx.TerminalProc.OwnsProcess) {
      try { Stop-Process -Id $ctx.TerminalProc.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
    try { Stop-Process -Id $ctx.ToolbarProc.Id -Force -ErrorAction SilentlyContinue } catch {}
    try { Stop-Process -Id $ctx.BackdropProc.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
}

$runs = if ($Video -eq 'all') { @('assistant', 'heyjarvis', 'settings') } else { @($Video) }

Write-Host ""
Write-Host "=== REAL TOOLBAR VIDEO RECORDING IN 5s ==="
Write-Host "Do not touch the mouse or keyboard until the script finishes."
Write-Host ""
Start-Sleep -Seconds 5

Stop-TerminalTalkProcesses

try {
  foreach ($run in $runs) {
    switch ($run) {
      'assistant' { Record-Assistant }
      'heyjarvis' { Record-HeyJarvis }
      'settings' { Record-Settings }
    }
    Start-Sleep -Seconds 2
  }
} finally {
  Stop-TerminalTalkProcesses
  Restart-InstalledToolbar
}
