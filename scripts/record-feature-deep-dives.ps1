#requires -Version 5.1
param(
  [ValidateSet('openai', 'sessions', 'transcript', 'all')]
  [string]$Video = 'all',
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
$TmpRoot = Join-Path $Root 'tmp\feature-deep-dive-videos'
$AudioDir = Join-Path $TmpRoot 'audio'
$Wallpaper = Join-Path $Root 'docs\assets\wallpaper\terminal-talk-wallpaper.png'

if (!(Test-Path $Electron)) { throw "Electron not found at $Electron. Run npm install in app/ first." }
if (!(Test-Path $RecorderScript)) { throw "Recorder script not found: $RecorderScript" }
if (!(Test-Path $StageScript)) { throw "Demo stage script not found: $StageScript" }
if (!(Test-Path $BackdropScript)) { throw "Demo backdrop script not found: $BackdropScript" }

New-Item -ItemType Directory -Path $VideoDir -Force | Out-Null
New-Item -ItemType Directory -Path $TmpRoot -Force | Out-Null
New-Item -ItemType Directory -Path $AudioDir -Force | Out-Null

Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class TTFeatureVideoWin {
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
  [TTFeatureVideoWin]::ShowWindow($Handle, 9) | Out-Null
  [TTFeatureVideoWin]::MoveWindow($Handle, $X, $Y, $W, $H, $true) | Out-Null
  Start-Sleep -Milliseconds 140
  [TTFeatureVideoWin]::SetForegroundWindow($Handle) | Out-Null
}

function Wait-NewWindowByTitle([string]$Title, [IntPtr[]]$ExistingHandles, [int]$TimeoutMs = 12000) {
  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline) {
    $handles = [TTFeatureVideoWin]::FindWindowsByTitle($Title) |
      Where-Object { $ExistingHandles -notcontains $_ }
    if ($handles) { return $handles[0] }
    Start-Sleep -Milliseconds 100
  }
  return [IntPtr]::Zero
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

function Stamp {
  Get-Date -Format 'yyyyMMddTHHmmssfff'
}

function Write-Utf8NoBom([string]$Path, [string]$Value) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Value, $encoding)
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

function Get-FeatureSpec([string]$Name) {
  switch ($Name) {
    'openai' {
      return [pscustomobject]@{
        DurationMs = 52000
        Basename = "terminal-talk-openai-api-key$OutputSuffix"
        Title = 'OpenAI API key and provider routing'
        Narration = @'
Terminal Talk is free by default through Microsoft Edge text to speech, but the OpenAI section lets you add premium voices when you want them. The key is not shown again after saving. It is stored outside config dot json, with Electron safe storage and a same user sidecar for the speech helpers. The status row tells you whether a key is saved. Use OpenAI as primary flips the routing for response bodies, tool narration, and heartbeat clips. Edge stays wired as the fallback; when the toggle is off, Edge is primary and OpenAI becomes the fallback. The Test button drops a short voice sample into the normal queue, so you can confirm the provider and voice without waiting for a real assistant reply.
'@
      }
    }
    'sessions' {
      return [pscustomobject]@{
        DurationMs = 66000
        Basename = "terminal-talk-session-sync-controls$OutputSuffix"
        Title = 'Session sync and per-session controls'
        Narration = @'
Terminal Talk keeps Claude Code and Codex sessions in one colour registry. Tabs and dots show which session produced each clip, while labels make real project names readable instead of raw ids. The same identity is reused by Claude statusline data and by Terminal Talk Codex, where the Windows Terminal tab can carry the matching title and colour. In the Sessions panel you can rename a session, change its palette slot, focus it so its clips play first, or mute it so no audio is synthesized for that terminal. Expanding a session adds a dedicated voice override and speech include controls, so one terminal can read code blocks or tool calls differently from another.
'@
      }
    }
    'transcript' {
      return [pscustomobject]@{
        DurationMs = 54000
        Basename = "terminal-talk-transcript-spoken-original$OutputSuffix"
        Title = 'Transcript, copy, and spoken/original views'
        Narration = @'
The transcript panel turns Terminal Talk from a pure audio queue into something you can review. Every generated clip gets a sidecar with the spoken text, and where possible the original markdown source as well. Open the panel to see the recent clips, copy the wording, and switch between Spoken and Original. Spoken is exactly what the text to speech engine heard after markdown cleanup. Original keeps the source phrasing, useful when code fences, tables, links, or bullet formatting matter. Session tabs filter the transcript and dot strip together, so four busy terminals can stay readable without losing the global All view.
'@
      }
    }
  }
}

function New-DemoHome([string]$Name, [int]$ToolbarX, [int]$ToolbarY) {
  $demoHome = Join-Path $TmpRoot ("home-$Name-" + (Get-Date -Format 'yyyyMMddHHmmssfff'))
  New-Item -ItemType Directory -Path (Join-Path $demoHome 'queue') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $demoHome 'sessions') -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $demoHome 'listening.state') -Value 'off' -Encoding ascii

  $provider = if ($Name -eq 'openai') { 'edge' } else { 'edge' }
  $panels = if ($Name -eq 'transcript') {
    [ordered]@{ transcript_expanded = $false; transcript_view = 'spoken' }
  } else {
    [ordered]@{ transcript_expanded = $false; transcript_view = 'spoken' }
  }
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
      tts_provider              = $provider
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
    panels = $panels
  }
  Write-Utf8NoBom -Path (Join-Path $demoHome 'config.json') -Value ($config | ConvertTo-Json -Depth 8)

  if ($Name -eq 'openai') {
    Write-Utf8NoBom -Path (Join-Path $demoHome 'config.secrets.json') -Value (
      @{ openai_api_key = 'sk-demo-hidden-for-video-only' } | ConvertTo-Json -Depth 3
    )
  }

  $now = [DateTimeOffset]::Now.ToUnixTimeSeconds()
  $registry = [ordered]@{
    assignments = [ordered]@{
      aa11bb22 = [ordered]@{
        index = 0; label = 'Claude frontend'; session_id = 'aa11bb22-session'; claude_pid = 0
        pinned = $true; muted = $false; focus = $true; last_seen = $now
        voice = 'en-GB-RyanNeural'
        speech_includes = [ordered]@{ tool_calls = $true; code_blocks = $false }
      }
      cc33dd44 = [ordered]@{
        index = 9; label = 'Codex review'; session_id = 'cc33dd44-session'; claude_pid = 0
        pinned = $true; muted = $false; focus = $false; last_seen = $now - 8
        speech_includes = [ordered]@{ urls = $false; headings = $true }
      }
      ee55ff66 = [ordered]@{
        index = 18; label = 'Docs audit'; session_id = 'ee55ff66-session'; claude_pid = 0
        pinned = $true; muted = $false; focus = $false; last_seen = $now - 16
      }
    }
  }
  Write-Utf8NoBom -Path (Join-Path $demoHome 'session-colours.json') -Value ($registry | ConvertTo-Json -Depth 8)

  if ($Name -eq 'transcript') {
    Seed-TranscriptQueue $demoHome
  }

  return $demoHome
}

function Drop-DemoClip([string]$DemoHome, [string]$Short, [int]$Index, [string]$Spoken, [string]$Original = '') {
  $queue = Join-Path $DemoHome 'queue'
  $source = Join-Path $Root 'tmp\video-audio\overview-1.mp3'
  if (!(Test-Path -LiteralPath $source)) {
    $source = Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE '.terminal-talk\queue') -Filter '*.mp3' -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1 -ExpandProperty FullName
  }
  if (!$source -or !(Test-Path -LiteralPath $source)) { return }
  $name = "$(Stamp)-D$('{0:d4}' -f $Index)-$Short.mp3"
  $target = Join-Path $queue $name
  Copy-Item -LiteralPath $source -Destination "$target.partial" -Force
  Move-Item -LiteralPath "$target.partial" -Destination $target -Force
  (Get-Item -LiteralPath $target).LastWriteTime = Get-Date
  Write-Utf8NoBom -Path ([System.IO.Path]::ChangeExtension($target, '.txt')) -Value $Spoken
  if ($Original) {
    $base = $target.Substring(0, $target.Length - [System.IO.Path]::GetExtension($target).Length)
    Write-Utf8NoBom -Path "$base.original.txt" -Value $Original
  }
}

function Seed-TranscriptQueue([string]$DemoHome) {
  Drop-DemoClip $DemoHome 'aa11bb22' 1 `
    'Table with 3 rows. Columns: package, risk, next action.' `
    '| package | risk | next action |`n| renderer | medium | verify transcript panel |'
  Start-Sleep -Milliseconds 20
  Drop-DemoClip $DemoHome 'cc33dd44' 2 `
    'Codex review found two failing assertions and one missing fixture.' `
    'Codex review found `2` failing assertions and one missing fixture.'
  Start-Sleep -Milliseconds 20
  Drop-DemoClip $DemoHome 'ee55ff66' 3 `
    'Reading docs README and checking install notes.' `
    'Reading `docs/README.md` and checking install notes.'
  Start-Sleep -Milliseconds 20
  Drop-DemoClip $DemoHome 'aa11bb22' 4 `
    'Tool call narration is enabled for this session.' `
    'Tool call narration is enabled for this session.'
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

function Start-DemoTerminal([string]$Name, [string]$FlagPath, [int]$X, [int]$Y, [int]$W, [int]$H) {
  $title = "Terminal Talk $Name deep dive"
  $existingHandles = @([TTFeatureVideoWin]::FindWindowsByTitle($title))
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
  $handle = Wait-NewWindowByTitle $title $existingHandles 16000
  if ($handle -eq [IntPtr]::Zero) { throw "Demo terminal window not found." }
  Position-Window $handle $X $Y $W $H
  $windowPid = [TTFeatureVideoWin]::WindowProcessId($handle)
  return [pscustomobject]@{ Id = $windowPid; ProcessId = $proc.Id; MainWindowHandle = $handle; ProcessName = 'DemoStage' }
}

function Start-Toolbar([string]$DemoHome, [string]$Variant, [string]$FlagPath, [int]$X, [int]$Y, [int]$W, [int]$H, [int]$DurationMs) {
  $existingHandles = @([TTFeatureVideoWin]::FindWindowsByTitle('Terminal Talk'))
  $old = @{
    TT_INSTALL_DIR = $env:TT_INSTALL_DIR
    TT_TEST_MODE = $env:TT_TEST_MODE
    TT_CAPTURE_MODE = $env:TT_CAPTURE_MODE
    TT_CAPTURE_X = $env:TT_CAPTURE_X
    TT_CAPTURE_Y = $env:TT_CAPTURE_Y
    TT_CAPTURE_WIDTH = $env:TT_CAPTURE_WIDTH
    TT_CAPTURE_HEIGHT = $env:TT_CAPTURE_HEIGHT
    TT_DEMO_SETTINGS_MODE = $env:TT_DEMO_SETTINGS_MODE
    TT_DEMO_SETTINGS_VARIANT = $env:TT_DEMO_SETTINGS_VARIANT
    TT_DEMO_START_FLAG = $env:TT_DEMO_START_FLAG
    TT_DEMO_SETTINGS_VISUAL_DURATION_MS = $env:TT_DEMO_SETTINGS_VISUAL_DURATION_MS
  }
  $env:TT_INSTALL_DIR = $DemoHome
  $env:TT_TEST_MODE = '1'
  $env:TT_CAPTURE_MODE = '1'
  $env:TT_CAPTURE_X = [string]$X
  $env:TT_CAPTURE_Y = [string]$Y
  $env:TT_CAPTURE_WIDTH = [string]$W
  $env:TT_CAPTURE_HEIGHT = [string]$H
  $env:TT_DEMO_SETTINGS_MODE = '1'
  $env:TT_DEMO_SETTINGS_VARIANT = $Variant
  $env:TT_DEMO_START_FLAG = $FlagPath
  $env:TT_DEMO_SETTINGS_VISUAL_DURATION_MS = [string]$DurationMs
  try {
    $proc = Start-Process -FilePath $Electron -ArgumentList 'app' -WorkingDirectory $Root -PassThru
    $handle = Wait-NewWindowByTitle 'Terminal Talk' $existingHandles 18000
    if ($handle -eq [IntPtr]::Zero) { throw "Terminal Talk toolbar window not found." }
    Position-Window $handle $X $Y $W $H
    return [pscustomobject]@{ Id = $proc.Id; MainWindowHandle = $handle; ProcessName = $proc.ProcessName }
  } finally {
    foreach ($key in $old.Keys) {
      if ($null -eq $old[$key]) { Remove-Item "Env:$key" -ErrorAction SilentlyContinue }
      else { Set-Item "Env:$key" $old[$key] }
    }
  }
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
  for ($i = 0; $i -lt 50; $i++) {
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

function Ensure-Narration([string]$Name, [string]$Text) {
  $out = Join-Path $AudioDir "$Name-narration.mp3"
  if ((Test-Path $out) -and (Get-Item -LiteralPath $out).Length -gt 1000) { return $out }
  $tmpText = Join-Path $AudioDir "$Name-narration.txt"
  Write-Utf8NoBom -Path $tmpText -Value $Text.Trim()
  Get-Content -Raw -LiteralPath $tmpText | python (Join-Path $Root 'app\edge_tts_speak.py') 'en-GB-RyanNeural' $out
  if ($LASTEXITCODE -ne 0 -or !(Test-Path $out)) { throw "Narration synthesis failed for $Name" }
  return $out
}

function Polish-Video([string]$Path, [int]$DurationMs) {
  $ffmpeg = Get-FfmpegPath
  if (!$ffmpeg) { throw "ffmpeg not found." }
  $raw = Join-Path $TmpRoot ([System.IO.Path]::GetFileNameWithoutExtension($Path) + '-raw.webm')
  $tmp = Join-Path $TmpRoot ([System.IO.Path]::GetFileNameWithoutExtension($Path) + '-polished.webm')
  Remove-Item -LiteralPath $raw,$tmp -Force -ErrorAction SilentlyContinue
  Move-Item -LiteralPath $Path -Destination $raw -Force
  $fadeStart = [Math]::Max(1, ($DurationMs / 1000.0) - 2.5)
  $filter = "crop=1920:1080:0:24,scale=1280:720,setsar=1,fade=t=out:st=$fadeStart`:d=2.5"
  & $ffmpeg -y -hide_banner -loglevel error -i $raw -vf $filter -map 0:v:0 -an -c:v libvpx-vp9 -crf 31 -b:v 0 -pix_fmt yuv420p $tmp
  if ($LASTEXITCODE -ne 0 -or !(Test-Path $tmp)) {
    Move-Item -LiteralPath $raw -Destination $Path -Force
    throw "ffmpeg polish step failed"
  }
  Move-Item -LiteralPath $tmp -Destination $Path -Force
  Remove-Item -LiteralPath $raw -Force -ErrorAction SilentlyContinue
}

function Mux-Narration([string]$VideoPath, [string]$AudioPath, [int]$DurationMs) {
  $ffmpeg = Get-FfmpegPath
  if (!$ffmpeg) { throw "ffmpeg not found." }
  $raw = Join-Path $TmpRoot ([System.IO.Path]::GetFileNameWithoutExtension($VideoPath) + '-visual.webm')
  $tmp = Join-Path $TmpRoot ([System.IO.Path]::GetFileNameWithoutExtension($VideoPath) + '-muxed.webm')
  Remove-Item -LiteralPath $raw,$tmp -Force -ErrorAction SilentlyContinue
  Move-Item -LiteralPath $VideoPath -Destination $raw -Force
  $durationSec = ([double]($DurationMs / 1000.0)).ToString('0.###', [System.Globalization.CultureInfo]::InvariantCulture)
  & $ffmpeg -y -hide_banner -loglevel error -i $raw -i $AudioPath -filter_complex "[1:a]apad,atrim=duration=$durationSec,volume=5dB,alimiter=limit=0.95[a]" -map 0:v:0 -map "[a]" -c:v copy -c:a libopus -b:a 128k -disposition:a:0 default -t $durationSec $tmp
  if ($LASTEXITCODE -ne 0 -or !(Test-Path $tmp)) {
    Move-Item -LiteralPath $raw -Destination $VideoPath -Force
    throw "ffmpeg audio mux failed"
  }
  Move-Item -LiteralPath $tmp -Destination $VideoPath -Force
  Remove-Item -LiteralPath $raw -Force -ErrorAction SilentlyContinue
}

function Write-Mp4CompatibilityCopy([string]$WebmPath, [string]$Mp4Path) {
  $ffmpeg = Get-FfmpegPath
  if (!$ffmpeg) { throw "ffmpeg not found." }
  Remove-Item -LiteralPath $Mp4Path -Force -ErrorAction SilentlyContinue
  & $ffmpeg -y -hide_banner -loglevel error -i $WebmPath -map 0:v:0 -map 0:a:0 -c:v libx264 -preset medium -crf 24 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart $Mp4Path
  if ($LASTEXITCODE -ne 0 -or !(Test-Path $Mp4Path)) { throw "MP4 compatibility encode failed" }
}

function Record-Feature([string]$Name) {
  $spec = Get-FeatureSpec $Name
  $screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $terminalX = $screen.X + 24
  $terminalY = $screen.Y + 36
  $terminalW = [int]([Math]::Floor($screen.Width * 0.44) - 40)
  $terminalH = $screen.Height - 72
  $toolbarX = $screen.X + [int]([Math]::Floor($screen.Width * 0.46)) - 18
  $toolbarY = $screen.Y + 36
  $toolbarW = $screen.Width - ($toolbarX - $screen.X) - 36
  $toolbarH = $screen.Height - 72
  $flag = Join-Path $TmpRoot "$Name-go.flag"
  $started = Join-Path $TmpRoot "$Name-recorder-started.flag"
  $webm = Join-Path $VideoDir "$($spec.Basename).webm"
  $mp4 = Join-Path $VideoDir "$($spec.Basename).mp4"
  $raw = Join-Path $TmpRoot "$($spec.Basename)-raw.webm"
  Remove-Item -LiteralPath $flag -Force -ErrorAction SilentlyContinue

  Write-Host ""
  Write-Host "=== $($spec.Title) ==="
  Write-Host "Output: $webm"

  $narration = Ensure-Narration $Name $spec.Narration
  $demoHome = New-DemoHome $Name $toolbarX $toolbarY
  $backdropProc = $null
  $terminalProc = $null
  $toolbarProc = $null
  $recorderProc = $null
  try {
    $backdropProc = Start-Backdrop $screen.X $screen.Y $screen.Width $screen.Height
    Start-Sleep -Milliseconds 700
    $terminalProc = Start-DemoTerminal $Name $flag $terminalX $terminalY $terminalW $terminalH
    $toolbarProc = Start-Toolbar $demoHome $Name $flag $toolbarX $toolbarY $toolbarW $toolbarH $spec.DurationMs
    Position-Window $terminalProc.MainWindowHandle $terminalX $terminalY $terminalW $terminalH
    Position-Window $toolbarProc.MainWindowHandle $toolbarX $toolbarY $toolbarW $toolbarH
    Start-Sleep -Seconds 4
    $recorderProc = Start-Recorder $raw $started $spec.DurationMs
    Wait-RecorderStarted $started
    Set-Content -LiteralPath $flag -Value 'go' -Encoding ascii
    Wait-Process -Id $recorderProc.Id -Timeout ([Math]::Ceiling($spec.DurationMs / 1000) + 30)
    if (!(Test-Path $raw)) { throw "Expected raw output was not written: $raw" }
    Wait-FileStable $raw
    Move-Item -LiteralPath $raw -Destination $webm -Force
    Polish-Video $webm $spec.DurationMs
    Mux-Narration $webm $narration $spec.DurationMs
    Write-Mp4CompatibilityCopy $webm $mp4
    Write-Host "OK - wrote $webm"
    Write-Host "OK - wrote $mp4"
  } finally {
    if ($recorderProc) {
      try { $recorderProc.Refresh(); if (!$recorderProc.HasExited) { Stop-Process -Id $recorderProc.Id -Force -ErrorAction SilentlyContinue } } catch {}
    }
    if ($terminalProc) { try { Stop-Process -Id $terminalProc.Id -Force -ErrorAction SilentlyContinue } catch {} }
    if ($toolbarProc) { try { Stop-Process -Id $toolbarProc.Id -Force -ErrorAction SilentlyContinue } catch {} }
    if ($backdropProc) { try { Stop-Process -Id $backdropProc.Id -Force -ErrorAction SilentlyContinue } catch {} }
  }
}

$runs = if ($Video -eq 'all') { @('openai', 'sessions', 'transcript') } else { @($Video) }

Write-Host ""
Write-Host "=== FEATURE DEEP-DIVE VIDEO RECORDING IN 5s ==="
Write-Host "The script will use the real toolbar in capture mode. Do not use the mouse or keyboard until it finishes."
Write-Host ""
Start-Sleep -Seconds 5

Stop-TerminalTalkProcesses
try {
  foreach ($run in $runs) {
    Record-Feature $run
    Start-Sleep -Seconds 2
  }
} finally {
  Stop-TerminalTalkProcesses
  Restart-InstalledToolbar
}
