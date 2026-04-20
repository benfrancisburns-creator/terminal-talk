#Requires -Version 5.1
<#
.SYNOPSIS
  Terminal Talk uninstaller. Reverses install.ps1.
.DESCRIPTION
  - Stops running Electron toolbar + Python listener processes.
  - Removes the Startup shortcut.
  - Removes Stop, Notification and PreToolUse hooks from ~/.claude/settings.json (backup kept).
  - Optionally deletes %USERPROFILE%\.terminal-talk\ (preserves config.json if requested).
#>

$ErrorActionPreference = 'SilentlyContinue'
$installDir = Join-Path $env:USERPROFILE '.terminal-talk'
$startupFolder = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$vbsStartup = Join-Path $startupFolder 'terminal-talk.vbs'
$claudeSettings = Join-Path $env:USERPROFILE '.claude\settings.json'

function Write-Step($msg) { Write-Host ""; Write-Host ">> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "   OK  $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "   !!  $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  Terminal Talk uninstaller" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# 1. Stop processes
Write-Step "Stopping processes"
Get-Process -Name electron -ErrorAction SilentlyContinue | ForEach-Object {
    $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine
    if ($cmdLine -match [regex]::Escape($installDir)) {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
}
Get-Process -Name python -ErrorAction SilentlyContinue | ForEach-Object {
    $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine
    if ($cmdLine -match [regex]::Escape($installDir)) {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
}
Write-Ok "Processes stopped"

# 2. Startup shortcut
Write-Step "Removing Startup shortcut"
if (Test-Path $vbsStartup) {
    Remove-Item $vbsStartup -Force
    Write-Ok "Removed $vbsStartup"
} else {
    Write-Warn2 "Startup shortcut not found (already gone)"
}

# 3. Claude Code hooks
Write-Step "Removing Claude Code hooks"
if (Test-Path $claudeSettings) {
    Copy-Item -Force $claudeSettings "$claudeSettings.backup-$(Get-Date -Format 'yyyyMMddHHmmss')"
    $settings = Get-Content $claudeSettings -Raw | ConvertFrom-Json
    $changed = $false
    if ($settings.hooks) {
        if ($settings.hooks.Stop) {
            $keep = @($settings.hooks.Stop | Where-Object {
                ($_.hooks | ForEach-Object { $_.command }) -notmatch 'terminal-talk'
            })
            if ($keep.Count -eq 0) { $settings.hooks.PSObject.Properties.Remove('Stop') }
            else { $settings.hooks.Stop = $keep }
            $changed = $true
        }
        if ($settings.hooks.Notification) {
            $keep = @($settings.hooks.Notification | Where-Object {
                ($_.hooks | ForEach-Object { $_.command }) -notmatch 'terminal-talk'
            })
            if ($keep.Count -eq 0) { $settings.hooks.PSObject.Properties.Remove('Notification') }
            else { $settings.hooks.Notification = $keep }
            $changed = $true
        }
        if ($settings.hooks.PreToolUse) {
            $keep = @($settings.hooks.PreToolUse | Where-Object {
                ($_.hooks | ForEach-Object { $_.command }) -notmatch 'terminal-talk'
            })
            if ($keep.Count -eq 0) { $settings.hooks.PSObject.Properties.Remove('PreToolUse') }
            else { $settings.hooks.PreToolUse = $keep }
            $changed = $true
        }
    }
    if ($settings.statusLine -and $settings.statusLine.command -match 'terminal-talk') {
        $settings.PSObject.Properties.Remove('statusLine')
        $changed = $true
    }
    if ($changed) {
        $settings | ConvertTo-Json -Depth 20 | Set-Content $claudeSettings -Encoding utf8
        Write-Ok "Hooks + statusline removed (settings.json backed up)"
    } else {
        Write-Warn2 "No Terminal Talk entries found in settings.json"
    }
} else {
    Write-Warn2 "~/.claude/settings.json not found"
}

# 4. Install dir
Write-Step "Install directory"
if (Test-Path $installDir) {
    $resp = Read-Host "Delete $installDir (config.json, logs, queue, session colours)? [y/N]"
    if ($resp -match '^[Yy]') {
        # Z2-8: partial-failure guard. Remove-Item -Recurse -Force throws
        # on any file currently held open by a Terminal Talk process --
        # electron.exe / terminal-talk.exe / python.exe can leave dangling
        # handles during a hot-kill. Sweep by install-path first (wider
        # net than name alone), sleep briefly for the OS to release
        # handles, then Wait-Process on the rebranded binaries with a 5 s
        # ceiling. Matches the audit §22 recipe.
        Get-Process -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -and ($_.Path -like "$installDir\*") } |
            Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
        Get-Process -Name 'terminal-talk','electron' -ErrorAction SilentlyContinue |
            Wait-Process -Timeout 5 -ErrorAction SilentlyContinue
        Remove-Item -Recurse -Force $installDir -ErrorAction SilentlyContinue
        # Leftover report. Remove-Item suppresses failures via the
        # -ErrorAction above; if files remain locked they'll surface
        # here so the user can see what's still held.
        if (Test-Path $installDir) {
            $leftovers = Get-ChildItem $installDir -Recurse -Force -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty FullName
            if ($leftovers) {
                Write-Warn2 "Install directory still has $($leftovers.Count) leftover item(s):"
                foreach ($item in $leftovers) { Write-Host "    $item" }
            } else {
                Write-Warn2 "Install directory is empty but couldn't be removed -- retry manually."
            }
        } else {
            Write-Ok "Install directory deleted"
        }
    } else {
        Write-Warn2 "Install directory kept at $installDir"
    }
}

Write-Host ""
Write-Host "Uninstall complete." -ForegroundColor Cyan
Write-Host ""
