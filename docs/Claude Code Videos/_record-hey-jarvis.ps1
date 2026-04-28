#requires -Version 5.1
# Hey-Jarvis demo (visible-screen, Codex pattern). Stage HTML on the
# left half shows a fake terminal with the message that gets "selected";
# real Terminal Talk toolbar on the right; cursor is scripted to park
# on the control being explained BEFORE the narration explains it
# (per docs/CLAUDE_CODE_SETTINGS_GUIDE.md visual rules).
#
# v2 polish over the first attempt:
#   - fullscreen recorder (no Windows taskbar in frame)
#   - mascot-free wallpaper (terminal-talk-wallpaper-bg.jpg)
#   - cursor parks on each target before its narration fires
#   - shorter beats (38s vs 58s)
#   - body-vs-J-clip distinction so the dot strip shows a BLUE J-pip
#     when the highlighted text gets read

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$Root         = (Resolve-Path .).Path
$VideoDir     = Join-Path $Root 'docs\Claude Code Videos'
$SpecSrc      = Join-Path $VideoDir '_hey-jarvis.spec.json'
$OutPath      = Join-Path $VideoDir 'hey-jarvis-demo.webm'
$ClipSrc      = Join-Path $VideoDir '_clips'
$StageSrc     = Join-Path $VideoDir '_record-stage.cjs'

# Stage args route through tmp/ to dodge PS's Start-Process arg-quoting
# bug (paths with spaces in -ArgumentList get split into multiple args).
$SpecPath     = Join-Path $Root 'tmp\hj-spec.json'
$ClipDir      = Join-Path $Root 'tmp\hj-clips'
$StageScript  = Join-Path $Root 'tmp\hj-record-stage.cjs'
$StageHtml    = Join-Path $Root 'tmp\hj-stage.html'
$OutTmp       = Join-Path $Root 'tmp\hj-out.webm'
$Wallpaper    = Join-Path $Root 'docs\assets\wallpaper\terminal-talk-wallpaper-bg.jpg'

Copy-Item -LiteralPath $SpecSrc  -Destination $SpecPath    -Force
Copy-Item -LiteralPath $StageSrc -Destination $StageScript -Force
if (Test-Path $ClipDir) { Remove-Item -Recurse -Force $ClipDir }
Copy-Item -LiteralPath $ClipSrc -Destination $ClipDir -Recurse -Force

# Recorder is fullscreen; the stage CSS handles the layout.
$Screen   = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$StageW   = $Screen.Width
$StageH   = $Screen.Height
$StageX   = 0
$StageY   = 0

# Toolbar position — tucked into the right third of the stage. The
# settings panel grows downward when opened so leave headroom.
$ToolbarW = 660
$ToolbarX = $Screen.X + $Screen.Width - $ToolbarW - 80
$ToolbarY = $Screen.Y + 80

$SessionA = 'cc1de001'

$LocalElectron = Join-Path $Root 'app\node_modules\.bin\electron.cmd'

# --- P/Invoke for cursor + clicks -----------------------------------------
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class HJMouse {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);
}
'@

function Move-CursorSmooth([int]$x, [int]$y, [int]$ms = 700) {
  $start = New-Object HJMouse+POINT
  [HJMouse]::GetCursorPos([ref]$start) | Out-Null
  $steps = [Math]::Max(10, [Math]::Floor($ms / 16))
  for ($i = 1; $i -le $steps; $i++) {
    $t = $i / $steps
    # Cubic ease-out — settles softly on the target instead of cosine
    # which feels too symmetrical (the cursor visibly slows into place).
    $ease = 1 - [Math]::Pow(1 - $t, 3)
    [HJMouse]::SetCursorPos(
      [int]($start.X + (($x - $start.X) * $ease)),
      [int]($start.Y + (($y - $start.Y) * $ease))
    ) | Out-Null
    Start-Sleep -Milliseconds 16
  }
}
function Click-At([int]$x, [int]$y) {
  Move-CursorSmooth $x $y 600
  Start-Sleep -Milliseconds 180
  [HJMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [HJMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}

function Stop-AllToolbars {
  foreach ($name in @('electron','terminal-talk')) {
    Get-Process -Name $name -ErrorAction SilentlyContinue |
      Stop-Process -Force -ErrorAction SilentlyContinue
  }
}
function Restart-InstalledToolbar {
  $vbs = Join-Path $Root 'scripts\start-toolbar.vbs'
  if (Test-Path $vbs) { & cscript.exe //nologo $vbs | Out-Null }
}
function Stamp { Get-Date -Format 'yyyyMMddTHHmmssfff' }

function New-DemoHome {
  $demoHome = Join-Path $Root ("tmp\hj-home-" + (Get-Date -Format 'yyyyMMddHHmmssfff'))
  New-Item -ItemType Directory -Path (Join-Path $demoHome 'queue')    -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $demoHome 'sessions') -Force | Out-Null
  $config = [ordered]@{
    voices = [ordered]@{
      edge_clip       = 'en-GB-RyanNeural'
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
      auto_prune                = $true
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
    selected_tab      = 'all'
    tabs_expanded     = $true
    openai_api_key    = $null
    window            = [ordered]@{ x = $ToolbarX; y = $ToolbarY; dock = $null }
    panels            = [ordered]@{ transcript_expanded = $false; transcript_view = 'spoken' }
  }
  $config | ConvertTo-Json -Depth 8 |
    Set-Content -Path (Join-Path $demoHome 'config.json') -Encoding utf8

  $now = [DateTimeOffset]::Now.ToUnixTimeSeconds()
  $registry = [ordered]@{
    assignments = [ordered]@{
      $SessionA = [ordered]@{
        index = 0; label = 'Claude Code'; session_id = $SessionA; claude_pid = 0
        pinned = $true; last_seen = $now; focus = $true
        speech_includes = [ordered]@{ tool_calls = $true }
      }
    }
  }
  $registry | ConvertTo-Json -Depth 8 |
    Set-Content -Path (Join-Path $demoHome 'session-colours.json') -Encoding utf8
  return $demoHome
}

function Drop-Body([string]$DemoRoot, [string]$Source, [string]$Short, [string]$Spoken) {
  # Body clip — no `-clip-` in filename; toolbar renders as
  # session-coloured dot.
  $queue   = Join-Path $DemoRoot 'queue'
  $name    = "$(Stamp)-$Short.mp3"
  $target  = Join-Path $queue $name
  $partial = "$target.partial"
  Copy-Item -LiteralPath $Source -Destination $partial -Force
  Move-Item -LiteralPath $partial -Destination $target -Force
  Set-Content -LiteralPath ([System.IO.Path]::ChangeExtension($target, '.txt')) `
              -Value $Spoken -Encoding utf8
}
function Drop-JClip([string]$DemoRoot, [string]$Source, [string]$Short, [int]$Index, [string]$Spoken) {
  # J-clip — `{ts}-clip-{short}-{idx}.mp3` matches main.js SHORT_CLIP_RE.
  # Toolbar renders as a BLUE pip and plays at top priority.
  $queue   = Join-Path $DemoRoot 'queue'
  $name    = "$(Stamp)-clip-$Short-$('{0:d2}' -f $Index).mp3"
  $target  = Join-Path $queue $name
  $partial = "$target.partial"
  Copy-Item -LiteralPath $Source -Destination $partial -Force
  Move-Item -LiteralPath $partial -Destination $target -Force
  Set-Content -LiteralPath ([System.IO.Path]::ChangeExtension($target, '.txt')) `
              -Value $Spoken -Encoding utf8
}

function Start-Toolbar([string]$DemoRoot) {
  $env:TT_TEST_MODE   = '1'
  $env:TT_INSTALL_DIR = $DemoRoot
  Stop-AllToolbars
  Start-Sleep -Milliseconds 700
  Start-Process -FilePath $LocalElectron -ArgumentList 'app' -WorkingDirectory $Root | Out-Null
  Start-Sleep -Seconds 3
}

function Start-Recorder {
  $args = @(
    $StageScript,
    '--spec',     $SpecPath,
    '--out',      $OutTmp,
    '--stage',    $StageHtml,
    '--wallpaper',$Wallpaper,
    '--x',        [string]$StageX,
    '--y',        [string]$StageY,
    '--width',    [string]$StageW,
    '--height',   [string]$StageH,
    '--duration-ms', '38000'
  )
  return Start-Process -FilePath $LocalElectron `
                       -ArgumentList $args `
                       -WorkingDirectory $Root -PassThru
}

# --- Toolbar anchor coordinates (relative to ToolbarX/Y) ------------------
$DotStrip      = @{ X = $ToolbarX + 320; Y = $ToolbarY + 92  }
$Gear          = @{ X = $ToolbarX + 616; Y = $ToolbarY + 30  }
$TranscriptBtn = @{ X = $ToolbarX + 80;  Y = $ToolbarY + 130 }

# Mid-stage anchor points (left-half terminal card)
$LeftCenter    = @{ X = [int]($Screen.Width * 0.22); Y = [int]($Screen.Height * 0.42) }
$LeftSelStart  = @{ X = [int]($Screen.Width * 0.10); Y = [int]($Screen.Height * 0.40) }
$LeftSelEnd    = @{ X = [int]($Screen.Width * 0.34); Y = [int]($Screen.Height * 0.46) }

# --------------------------------------------------------------------------
# Run
# --------------------------------------------------------------------------
Write-Host ""
Write-Host "=== HEY-JARVIS RECORDING IN 5s — leave the screen alone ==="
Write-Host "Duration: ~40 seconds. Output: $OutPath"
Write-Host ""
Start-Sleep -Seconds 5

try {
  $demoHome = New-DemoHome
  Start-Toolbar $demoHome
  $rec = Start-Recorder

  # ---- t=0..3s: cursor parks on the left card, near the prose --------
  Move-CursorSmooth $LeftCenter.X $LeftCenter.Y 900
  Start-Sleep -Milliseconds 1000
  Drop-Body $demoHome (Join-Path $ClipDir 'hj-01-intro.mp3') $SessionA `
            'You can have Terminal Talk read any text aloud, in any application.'

  # ---- t=4..7s: cursor swipes across the text being highlighted ------
  Start-Sleep -Milliseconds 3500
  Move-CursorSmooth $LeftSelStart.X $LeftSelStart.Y 700
  Drop-Body $demoHome (Join-Path $ClipDir 'hj-02-highlight.mp3') $SessionA `
            'Just highlight the text you want to hear.'
  Start-Sleep -Milliseconds 800
  Move-CursorSmooth $LeftSelEnd.X $LeftSelEnd.Y 1300

  # ---- t=11..14s: cursor moves to toolbar dot strip BEFORE trigger ---
  Start-Sleep -Milliseconds 800
  Move-CursorSmooth $DotStrip.X $DotStrip.Y 900
  Drop-Body $demoHome (Join-Path $ClipDir 'hj-03-trigger.mp3') $SessionA `
            'Then say hey jarvis, or press Control Shift S.'

  # ---- t=14..21s: J-CLIP appears in the dot strip + plays the content
  Start-Sleep -Milliseconds 2700
  Drop-JClip $demoHome (Join-Path $ClipDir 'hj-04-content.mp3') $SessionA 1 `
             'The Hub schema migration is approved. Apply it during the maintenance window on Friday at 8 PM.'

  # ---- t=22..28s: cursor parks on the dot strip while priority lands -
  Start-Sleep -Milliseconds 7700
  Drop-Body $demoHome (Join-Path $ClipDir 'hj-05-priority.mp3') $SessionA `
            'Hey jarvis clips jump the queue. They play before any pending body audio.'

  # ---- t=28..33s: cursor moves to TRANSCRIPT button BEFORE narration -
  Start-Sleep -Milliseconds 5500
  Move-CursorSmooth $TranscriptBtn.X $TranscriptBtn.Y 800
  Click-At $TranscriptBtn.X $TranscriptBtn.Y       # expand panel
  Start-Sleep -Milliseconds 400
  Drop-Body $demoHome (Join-Path $ClipDir 'hj-06-transcript.mp3') $SessionA `
            'Every clip lands in the transcript panel with a copy button.'

  # ---- t=34..38s: cursor parks back on the dot strip for closer ------
  Start-Sleep -Milliseconds 4500
  Move-CursorSmooth $DotStrip.X $DotStrip.Y 900
  Drop-Body $demoHome (Join-Path $ClipDir 'hj-07-end.mp3') $SessionA `
            'Hands-free reading, anywhere on Windows.'

  Wait-Process -Id $rec.Id -Timeout 60
  $rec.Refresh()
  if ($rec.ExitCode -ne 0 -and $null -ne $rec.ExitCode) {
    throw "recorder exit $($rec.ExitCode)"
  }
  if (Test-Path $OutTmp) {
    Move-Item -LiteralPath $OutTmp -Destination $OutPath -Force
  }
  Write-Host "OK — wrote $OutPath"
}
finally {
  Stop-AllToolbars
  Start-Sleep -Milliseconds 500
  Restart-InstalledToolbar
}
