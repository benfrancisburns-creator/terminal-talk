#requires -Version 5.1
# Visible-screen recording (Codex-style) with the REAL Terminal Talk
# toolbar. Stage HTML on the left half is narrative commentary; the
# toolbar sits on the right half and gets driven by scripted cursor
# moves + dropped audio clips. Captures the whole primary display, so
# the user must leave the screen alone for the recording's duration.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$Root         = (Resolve-Path .).Path
$VideoDir     = Join-Path $Root 'docs\Claude Code Videos'
# Same args-with-spaces gotcha applies to the spec/out/clip paths.
# Stage them in tmp/ for the recorder; the OutPath is the final move target.
$SpecSrc      = Join-Path $VideoDir '_smart-narration-with-toolbar.spec.json'
$ClipSrc      = Join-Path $VideoDir '_clips'
$SpecPath     = Join-Path $Root 'tmp\cc-smart-narration.spec.json'
$ClipDir      = Join-Path $Root 'tmp\cc-clips'
$OutTmp       = Join-Path $Root 'tmp\cc-smart-toolbar-out.webm'
$OutPath      = Join-Path $VideoDir 'smart-tool-narration-with-toolbar.webm'
Copy-Item -LiteralPath $SpecSrc -Destination $SpecPath -Force
if (Test-Path $ClipDir) { Remove-Item -Recurse -Force $ClipDir }
Copy-Item -LiteralPath $ClipSrc -Destination $ClipDir -Recurse -Force
$StageScriptSrc = Join-Path $VideoDir '_record-stage.cjs'
# Copy into tmp/ at runtime — Start-Process -ArgumentList doesn't quote
# elements containing spaces, so a path like 'Claude Code Videos\…cjs'
# gets split into three args and the recorder dies before loading.
$StageScript  = Join-Path $Root 'tmp\cc-record-stage.cjs'
Copy-Item -LiteralPath $StageScriptSrc -Destination $StageScript -Force
$StageHtml    = Join-Path $Root 'tmp\cc-toolbar-stage.html'
$Wallpaper    = Join-Path $Root 'docs\assets\wallpaper\terminal-talk-wallpaper.png'

$Screen       = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$StageW       = [Math]::Min(1280, $Screen.Width  - 80)
$StageH       = [Math]::Min(720,  $Screen.Height - 80)
$StageX       = $Screen.X + [Math]::Max(0, [Math]::Floor(($Screen.Width  - $StageW) / 2))
$StageY       = $Screen.Y + [Math]::Max(0, [Math]::Floor(($Screen.Height - $StageH) / 2))

# Toolbar sits in the RIGHT half of the stage — left half is narrative.
$ToolbarW     = 660
$ToolbarX     = $StageX + $StageW - $ToolbarW - 60
$ToolbarY     = $StageY + 90

$SessionA     = 'cc1de001'
$SessionB     = 'cc2de002'

$LocalElectron = Join-Path $Root 'app\node_modules\.bin\electron.cmd'

# --- P/Invoke for cursor + clicks (mirrors Codex's helper) ----------------
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class TBMouse {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);
}
'@

function Move-CursorSmooth([int]$x, [int]$y, [int]$ms = 650) {
  $start = New-Object TBMouse+POINT
  [TBMouse]::GetCursorPos([ref]$start) | Out-Null
  $steps = [Math]::Max(8, [Math]::Floor($ms / 16))
  for ($i = 1; $i -le $steps; $i++) {
    $t = $i / $steps
    $ease = 0.5 - ([Math]::Cos($t * [Math]::PI) / 2)
    [TBMouse]::SetCursorPos(
      [int]($start.X + (($x - $start.X) * $ease)),
      [int]($start.Y + (($y - $start.Y) * $ease))
    ) | Out-Null
    Start-Sleep -Milliseconds 16
  }
}
function Click-At([int]$x, [int]$y) {
  Move-CursorSmooth $x $y 520
  Start-Sleep -Milliseconds 140
  [TBMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)  # left down
  Start-Sleep -Milliseconds 70
  [TBMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)  # left up
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
  $demoHome = Join-Path $Root ("tmp\cc-toolbar-" + (Get-Date -Format 'yyyyMMddHHmmssfff'))
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
      speed                       = 1.05
      auto_prune                  = $true
      auto_prune_sec              = 28
      auto_continue_after_click   = $true
      palette_variant             = 'default'
      tts_provider                = 'edge'
      master_volume               = 1
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
      $SessionB = [ordered]@{
        index = 4; label = 'Audit run'; session_id = $SessionB; claude_pid = 0
        pinned = $true; last_seen = $now
      }
    }
  }
  $registry | ConvertTo-Json -Depth 8 |
    Set-Content -Path (Join-Path $demoHome 'session-colours.json') -Encoding utf8

  return $demoHome
}

function Drop-Clip([string]$DemoRoot, [string]$Source, [string]$Short, [int]$Index, [string]$Spoken) {
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
  Start-Sleep -Milliseconds 600
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
    '--duration-ms', '56000'
  )
  return Start-Process -FilePath $LocalElectron `
                       -ArgumentList $args `
                       -WorkingDirectory $Root -PassThru
}

# --- Cursor anchor coordinates within the toolbar (Codex-derived) ---------
# Toolbar settings panel (when open) lays out roughly like:
#   playback section ~ y +166 .. +220
#   on/off toggles right edge ~ x +540
#   tool-call narration toggle ~ y +334
#   transcript chevron above the dotstrip ~ y +112 (above main toolbar)
$DotStrip      = @{ X = $ToolbarX + 320; Y = $ToolbarY + 92  }
$Gear          = @{ X = $ToolbarX + 616; Y = $ToolbarY + 30  }
$ToolCallToggle= @{ X = $ToolbarX + 540; Y = $ToolbarY + 378 }
$TranscriptBtn = @{ X = $ToolbarX + 35;  Y = $ToolbarY + 110 }
$Restart       = @{ X = $ToolbarX + 320; Y = $ToolbarY + 92  }

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== RECORDING IN 5s — please don't touch the mouse/keyboard ==="
Write-Host "Duration: ~58 seconds. Output: $OutPath"
Write-Host ""
Start-Sleep -Seconds 5

try {
  $demoHome = New-DemoHome
  Start-Toolbar $demoHome
  $rec = Start-Recorder

  # Park cursor on the dot strip — the listener's eye lands there as the
  # first dot lights up.
  Move-CursorSmooth $DotStrip.X $DotStrip.Y 600

  # ---- t=2..7s: intro clip ------------------------------------------------
  Start-Sleep -Milliseconds 1900
  Drop-Clip $demoHome (Join-Path $ClipDir 'w-01-intro.mp3') $SessionA 1 'Terminal Talk speaks every tool call as Claude works.'

  # ---- t=4..10s: Reading clip + cursor stays on dot strip -----------------
  Start-Sleep -Milliseconds 2200
  Drop-Clip $demoHome (Join-Path $ClipDir 'w-02-reading.mp3') $SessionA 2 'Reading audio-player.js'
  Move-CursorSmooth ($DotStrip.X + 30) ($DotStrip.Y) 700

  # ---- t=11..18s: Grep clip + cursor moves toward gear --------------------
  Start-Sleep -Milliseconds 4900
  Drop-Clip $demoHome (Join-Path $ClipDir 'w-03-grep.mp3') $SessionA 3 'Searching for system auto pause - found 14 matches'
  Move-CursorSmooth ($DotStrip.X + 60) ($DotStrip.Y) 700

  # ---- t=19..27s: Edit clip + click GEAR to open settings -----------------
  Start-Sleep -Milliseconds 6800
  Drop-Clip $demoHome (Join-Path $ClipDir 'w-04-edit.mp3') $SessionA 4 'Edit to handle mic captured.'
  Click-At $Gear.X $Gear.Y
  Start-Sleep -Milliseconds 1500   # settings panel grows

  # ---- t=28..36s: Bash clip + cursor parks on tool-call toggle ------------
  Start-Sleep -Milliseconds 1500
  Drop-Clip $demoHome (Join-Path $ClipDir 'w-05-bash.mp3') $SessionA 5 'Running the tests, then counting matches.'
  Move-CursorSmooth $ToolCallToggle.X $ToolCallToggle.Y 900

  # ---- t=37..46s: Table clip + cursor stays parked ------------------------
  Start-Sleep -Milliseconds 7000
  Drop-Clip $demoHome (Join-Path $ClipDir 'w-06-table.mp3') $SessionB 1 'Table with 3 rows. Columns: file, line, today, with Phase 3 v2.'

  # ---- t=47..52s: Toggle reassurance --------------------------------------
  Start-Sleep -Milliseconds 8000
  Drop-Clip $demoHome (Join-Path $ClipDir 'w-07-toggle.mp3') $SessionA 6 'Tool-call narration is on. Toggle it from settings any time.'
  Move-CursorSmooth ($ToolCallToggle.X - 80) ($ToolCallToggle.Y) 600

  # ---- t=53..56s: closer ---------------------------------------------------
  Start-Sleep -Milliseconds 4000
  Drop-Clip $demoHome (Join-Path $ClipDir 'w-08-end.mp3') $SessionA 7 'Less staring. More listening. More flow.'
  Move-CursorSmooth $DotStrip.X $DotStrip.Y 700

  Wait-Process -Id $rec.Id -Timeout 80
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
