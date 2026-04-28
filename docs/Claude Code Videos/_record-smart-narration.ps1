#requires -Version 5.1
# Record a single demo scene showing today's smart-tool-narration upgrades.
# Re-uses tmp/record-terminal-talk-stage.cjs (the stage-render Electron app
# Codex wrote) and the same toolbar-drop-clip pattern, but stages a fresh
# scene aimed at the Phase 3 v2 / pipe-tail / table-summary work.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$Root         = (Resolve-Path .).Path
$VideoDir     = Join-Path $Root 'docs\Claude Code Videos'
$SpecPath     = Join-Path $VideoDir '_smart-narration.spec.json'
$OutPath      = Join-Path $VideoDir 'smart-tool-narration.webm'
$ClipDir      = Join-Path $VideoDir '_clips'

$Screen       = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$StageW       = [Math]::Min(1280, $Screen.Width  - 80)
$StageH       = [Math]::Min(720,  $Screen.Height - 80)
$StageX       = $Screen.X + [Math]::Max(0, [Math]::Floor(($Screen.Width  - $StageW) / 2))
$StageY       = $Screen.Y + [Math]::Max(0, [Math]::Floor(($Screen.Height - $StageH) / 2))
$ToolbarW     = 680
$ToolbarX     = $StageX + [Math]::Floor(($StageW - $ToolbarW) / 2)
$ToolbarY     = $StageY + 34

$SessionA     = 'cc1de001'
$SessionB     = 'cc2de002'

$LocalElectron    = Join-Path $Root 'app\node_modules\.bin\electron.cmd'
# In the dev tree the binary is still electron.exe (the install step
# renames it to terminal-talk.exe under ~/.terminal-talk/). Match both
# so we can stop a stray local recorder process AND the user's
# currently-installed toolbar before recording starts (otherwise the
# installed toolbar's clips/dots would leak into the capture).
$LocalElectronExe   = Join-Path $Root 'app\node_modules\electron\dist\electron.exe'
$ElectronProcNames  = @('electron', 'terminal-talk')

# --- P/Invoke for smooth cursor movement (mirrors Codex's helper) -----------
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class CCMouse {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
}
'@

function Move-CursorSmooth([int]$x, [int]$y, [int]$ms = 650) {
  $start = New-Object CCMouse+POINT
  [CCMouse]::GetCursorPos([ref]$start) | Out-Null
  $steps = [Math]::Max(8, [Math]::Floor($ms / 16))
  for ($i = 1; $i -le $steps; $i++) {
    $t  = $i / $steps
    $ease = 0.5 - ([Math]::Cos($t * [Math]::PI) / 2)
    [CCMouse]::SetCursorPos(
      [int]($start.X + (($x - $start.X) * $ease)),
      [int]($start.Y + (($y - $start.Y) * $ease))
    ) | Out-Null
    Start-Sleep -Milliseconds 16
  }
}

function Stop-AllToolbars {
  # Kill BOTH the locally-launched electron.exe (the demo toolbar this
  # script is about to launch — defensive in case a previous run left
  # one behind) AND the installed terminal-talk.exe (the user's normal
  # toolbar — we restart it from the install at the end).
  foreach ($name in $ElectronProcNames) {
    Get-Process -Name $name -ErrorAction SilentlyContinue |
      Stop-Process -Force -ErrorAction SilentlyContinue
  }
}

function Restart-InstalledToolbar {
  # Bring the user's normal toolbar back after recording. Mirrors what
  # the .terminal-talk install does on login.
  $vbs = Join-Path $Root 'scripts\start-toolbar.vbs'
  if (Test-Path $vbs) {
    & cscript.exe //nologo $vbs | Out-Null
  }
}

function Stamp { Get-Date -Format 'yyyyMMddTHHmmssfff' }

function New-DemoHome {
  $demoHome = Join-Path $Root ("tmp\cc-video-smart-" + (Get-Date -Format 'yyyyMMddHHmmssfff'))
  New-Item -ItemType Directory -Path (Join-Path $demoHome 'queue')    -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $demoHome 'sessions') -Force | Out-Null

  $config = [ordered]@{
    voices = [ordered]@{
      edge_clip     = 'en-GB-RyanNeural'
      edge_response = 'en-GB-RyanNeural'
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
        index = 4; label = 'Audit run';   session_id = $SessionB; claude_pid = 0
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
    'tmp\record-terminal-talk-stage.cjs',
    '--spec',     $SpecPath,
    '--out',      $OutPath,
    '--stage',    'tmp\cc-stage.html',
    '--wallpaper','docs\assets\wallpaper\terminal-talk-wallpaper.png',
    '--x',        [string]$StageX,
    '--y',        [string]$StageY,
    '--width',    [string]$StageW,
    '--height',   [string]$StageH,
    '--duration-ms', '36000'
  )
  return Start-Process -FilePath $LocalElectron `
                       -ArgumentList $args `
                       -WorkingDirectory $Root -PassThru
}

# ---------------------------------------------------------------------------
# Run the scene
# ---------------------------------------------------------------------------
try {
  $demoHome = New-DemoHome
  Start-Toolbar $demoHome
  $rec = Start-Recorder

  # Drop each clip ~150ms before its corresponding state transition so the
  # spoken phrase lands together with the on-screen highlight.
  Start-Sleep -Milliseconds 2200
  Drop-Clip $demoHome (Join-Path $ClipDir '01-reading.mp3') $SessionA 1 'Reading audio-player.js'
  Move-CursorSmooth ($ToolbarX + 235) ($ToolbarY + 92) 800

  Start-Sleep -Milliseconds 4400
  Drop-Clip $demoHome (Join-Path $ClipDir '02-grep.mp3')   $SessionA 2 'Searching for system auto pause - found 14 matches'
  Move-CursorSmooth ($ToolbarX + 320) ($ToolbarY + 92) 700

  Start-Sleep -Milliseconds 5300
  Drop-Clip $demoHome (Join-Path $ClipDir '03-edit.mp3')   $SessionA 3 'Edit to handle mic captured in audio-player.js, around line 670'
  Move-CursorSmooth ($ToolbarX + 410) ($ToolbarY + 92) 700

  Start-Sleep -Milliseconds 5800
  Drop-Clip $demoHome (Join-Path $ClipDir '04-tests.mp3')  $SessionB 1 'Running the tests, then counting matches'
  Move-CursorSmooth ($ToolbarX + 500) ($ToolbarY + 92) 700

  Start-Sleep -Milliseconds 5900
  Drop-Clip $demoHome (Join-Path $ClipDir '05-table.mp3')  $SessionA 4 'Table with 3 rows. Columns: file, line, today, with Phase 3 v2.'
  Move-CursorSmooth ($ToolbarX + 590) ($ToolbarY + 92) 700

  Wait-Process -Id $rec.Id -Timeout 60
  $rec.Refresh()
  if ($rec.ExitCode -ne 0 -and $null -ne $rec.ExitCode) {
    throw "recorder exit $($rec.ExitCode)"
  }
  Write-Host "OK — wrote $OutPath"
} finally {
  Stop-AllToolbars
  Start-Sleep -Milliseconds 500
  Restart-InstalledToolbar
}
