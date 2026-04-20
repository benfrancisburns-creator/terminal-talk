#Requires -Version 5.1
<#
.SYNOPSIS
  Terminal Talk installer.
.DESCRIPTION
  Installs Terminal Talk to %USERPROFILE%\.terminal-talk\.
  - Checks prerequisites (Python 3.10+, Node.js 18+).
  - Installs Python packages (pinned via requirements.txt).
  - Runs npm install for Electron.
  - Copies app + hooks + config example.
  - Optionally registers Claude Code hooks in ~/.claude/settings.json.
  - Optionally adds a Startup shortcut so the toolbar auto-launches on login.
.PARAMETER Unattended
  Skip ALL interactive prompts and apply sensible defaults
  (hooks yes, statusline yes, startup no). Use for CI / automation.
.PARAMETER HooksYes
  In unattended mode, register Claude Code hooks. Default: $true.
.PARAMETER StatuslineYes
  In unattended mode, install the per-terminal statusline. Default: $true.
.PARAMETER StartupYes
  In unattended mode, add a Startup shortcut. Default: $false
  (deliberate — auto-launch is a per-user choice, not something
  unattended installs should make for you).
.NOTES
  Run from the terminal-talk/ folder (the one containing install.ps1).
  Re-running is safe: existing install dir is updated in place.
#>
param(
    [switch]$Unattended,
    [bool]$HooksYes      = $true,
    [bool]$StatuslineYes = $true,
    [bool]$StartupYes    = $false
)

$ErrorActionPreference = 'Stop'
# Prompt helper honoured by every Read-Host in this script. In attended
# mode it calls Read-Host and returns the raw input. In -Unattended
# mode it skips the prompt and returns 'Y' or 'n' based on the
# pre-set switch — so the same consent logic downstream ($resp -match
# '^[Yy]') gives the right answer without any stdin piping.
function Get-Consent {
    param(
        [Parameter(Mandatory = $true)] [string]$Prompt,
        [Parameter(Mandatory = $true)] [bool]$UnattendedDefault
    )
    if ($Unattended) {
        $shown = if ($UnattendedDefault) { 'Y (unattended)' } else { 'n (unattended)' }
        Write-Host "${Prompt}: $shown"
        return $(if ($UnattendedDefault) { 'Y' } else { 'n' })
    }
    return Read-Host $Prompt
}

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$installDir = Join-Path $env:USERPROFILE '.terminal-talk'
$appDir = Join-Path $installDir 'app'
$hooksDir = Join-Path $installDir 'hooks'
$queueDir = Join-Path $installDir 'queue'
$configPath = Join-Path $installDir 'config.json'
$startupFolder = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$vbsStartup = Join-Path $startupFolder 'terminal-talk.vbs'
$claudeSettings = Join-Path $env:USERPROFILE '.claude\settings.json'

function Write-Step($msg) { Write-Host ""; Write-Host ">> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "   OK  $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "   !!  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "   ERR $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  Terminal Talk installer" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# 1. Prerequisites
Write-Step "Checking prerequisites"
try {
    $pyVer = (& python --version 2>&1) -replace 'Python ', ''
    if ([version]$pyVer -lt [version]'3.10') { throw "Python $pyVer is too old, need 3.10+" }
    Write-Ok "Python $pyVer"
} catch {
    Write-Fail "Python 3.10+ not found. Install from https://python.org, then re-run."
    exit 1
}

try {
    $nodeVer = (& node --version 2>&1) -replace 'v', ''
    if ([version]$nodeVer -lt [version]'18.0') { throw "Node $nodeVer is too old, need 18+" }
    Write-Ok "Node $nodeVer"
} catch {
    Write-Fail "Node.js 18+ not found. Install from https://nodejs.org, then re-run."
    exit 1
}

# 2. Create install dir
Write-Step "Preparing $installDir"
New-Item -ItemType Directory -Force -Path $installDir, $queueDir | Out-Null
Write-Ok "Directories ready"

# 3. Copy files
Write-Step "Copying files"
Copy-Item -Recurse -Force (Join-Path $repoRoot 'app') $installDir
Copy-Item -Recurse -Force (Join-Path $repoRoot 'hooks') $installDir
if (-not (Test-Path $configPath)) {
    Copy-Item -Force (Join-Path $repoRoot 'config.example.json') $configPath
    Write-Ok "config.json created (from config.example.json)"
} else {
    Write-Warn2 "config.json already exists, left untouched"
}
Write-Ok "Files copied"

# 4. Python packages
#    Pinned via requirements.txt so a surprise upstream release can't break
#    install or runtime on your box. Dependabot raises weekly PRs for upgrades;
#    the harness gates them before merge.
$requirementsPath = Join-Path $repoRoot 'requirements.txt'
if (Test-Path $requirementsPath) {
    Write-Step "Installing Python packages (pinned versions from requirements.txt)"
    & python -m pip install --quiet --disable-pip-version-check -r $requirementsPath
} else {
    # Safety net for anyone running install.ps1 from an older checkout
    # without requirements.txt. Keeps the unpinned fallback working but
    # warns the user they're getting latest-wins resolution.
    Write-Warn2 "requirements.txt not found - installing unpinned (upgrade your checkout to pin)"
    & python -m pip install --quiet --disable-pip-version-check edge-tts openwakeword onnxruntime sounddevice numpy
}
if ($LASTEXITCODE -ne 0) {
    Write-Fail "pip install failed. See output above."
    exit 1
}
Write-Ok "Python packages installed"

Write-Step "Pre-downloading wake word model (hey_jarvis, ~30 MB)"
& python -c "from openwakeword.model import Model; Model(wakeword_models=['hey_jarvis'], inference_framework='onnx')" 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Ok "Wake word model cached" }
else { Write-Warn2 "Model download deferred to first use (first 'hey jarvis' may take 30-60s)" }

# 5. Node / Electron
Write-Step "Installing Electron"
Push-Location $appDir
& npm install --silent --no-audit --no-fund 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Fail "npm install failed."
    exit 1
}
Pop-Location
Write-Ok "Electron installed"

# 5b. Rename electron.exe -> terminal-talk.exe so processes are identifiable
# in Task Manager. Copy rather than rename so electron's own tooling still
# works against the original binary if it ever looks it up by name.
$electronDist = Join-Path $appDir 'node_modules\electron\dist'
$electronExe = Join-Path $electronDist 'electron.exe'
$rebrandedExe = Join-Path $electronDist 'terminal-talk.exe'
if (Test-Path $electronExe) {
    Copy-Item -Force $electronExe $rebrandedExe
    Write-Ok "Binary rebranded -> terminal-talk.exe"
} else {
    Write-Warn2 "electron.exe not found at $electronExe - rebrand skipped"
}

# 6. Claude Code hook registration (opt-in)
Write-Step "Claude Code integration"
$hookResp = Get-Consent "Register Claude Code hooks so Claude Code responses are spoken aloud? [Y/n]" $HooksYes
if ($hookResp -eq '' -or $hookResp -match '^[Yy]') {
    if (-not (Test-Path $claudeSettings)) {
        Write-Warn2 "~/.claude/settings.json not found (Claude Code not installed?). Skipping."
    } else {
        # C4: validate the existing settings.json parses BEFORE we
        # touch it. Blindly editing a corrupt file would either crash
        # the script mid-edit (leaving user with no hooks AND a broken
        # settings.json) or silently overwrite their working config.
        # On parse failure we refuse to proceed and nudge the user.
        $settingsRaw = Get-Content $claudeSettings -Raw
        try {
            $settings = $settingsRaw | ConvertFrom-Json -ErrorAction Stop
        } catch {
            Write-Fail "~/.claude/settings.json is not valid JSON:"
            Write-Host "    $($_.Exception.Message)" -ForegroundColor Red
            Write-Warn2 "Refusing to edit. Fix or delete settings.json and rerun install.ps1."
            exit 1
        }

        # Backup with timestamp, then rotate: keep the latest 5 so a
        # decade of reinstalls don't leave a graveyard of backups in
        # ~/.claude. Sorted by LastWriteTime so "oldest" is unambiguous.
        Copy-Item -Force $claudeSettings "$claudeSettings.backup-$(Get-Date -Format 'yyyyMMddHHmmss')"
        $backups = Get-ChildItem -Path (Split-Path -Parent $claudeSettings) -Filter "$(Split-Path -Leaf $claudeSettings).backup-*" -File -ErrorAction SilentlyContinue |
                   Sort-Object LastWriteTime -Descending
        if ($backups.Count -gt 5) {
            $backups | Select-Object -Skip 5 | ForEach-Object {
                try { Remove-Item -Force $_.FullName } catch {}
            }
        }

        if (-not $settings.hooks) { $settings | Add-Member -NotePropertyName hooks -NotePropertyValue (@{}) -Force }
        $respHook = Join-Path $hooksDir 'speak-response.ps1'
        $notifHook = Join-Path $hooksDir 'speak-notification.ps1'
        $toolHook = Join-Path $hooksDir 'speak-on-tool.ps1'
        $settings.hooks.Stop = @(@{
            matcher = ''
            hooks = @(@{
                type = 'command'
                command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$respHook`""
                timeout = 120
            })
        })
        $settings.hooks.Notification = @(@{
            matcher = ''
            hooks = @(@{
                type = 'command'
                command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$notifHook`""
                timeout = 60
            })
        })
        # PreToolUse hook - new in v0.2. Fires before every tool invocation to
        # synthesise the status text Claude just wrote, so audio starts playing
        # while the tool runs instead of waiting until the turn ends.
        $settings.hooks.PreToolUse = @(@{
            matcher = ''
            hooks = @(@{
                type = 'command'
                command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$toolHook`""
                timeout = 10
            })
        })
        $settings | ConvertTo-Json -Depth 20 | Set-Content $claudeSettings -Encoding utf8
        Write-Ok "Hooks registered (Stop, Notification, PreToolUse - settings.json backed up)"
    }
} else {
    Write-Warn2 "Skipped. You can still use highlight-to-speak + wake word."
}

# 6b. Statusline (per-terminal coloured emoji that matches the toolbar dot)
Write-Step "Session statusline"
$slResp = Get-Consent "Show a coloured emoji in each terminal matching its dot colour? [Y/n]" $StatuslineYes
if ($slResp -eq '' -or $slResp -match '^[Yy]') {
    if (-not (Test-Path $claudeSettings)) {
        Write-Warn2 "~/.claude/settings.json not found. Skipping."
    } else {
        $settings = Get-Content $claudeSettings -Raw | ConvertFrom-Json
        $slScript = Join-Path $appDir 'statusline.ps1'
        $slCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$slScript`""
        $settings | Add-Member -NotePropertyName statusLine -NotePropertyValue (@{
            type = 'command'
            command = $slCommand
        }) -Force
        $settings | ConvertTo-Json -Depth 20 | Set-Content $claudeSettings -Encoding utf8
        Write-Ok "Statusline registered -- restart Claude Code to see the emoji"
    }
}

# 7. Startup shortcut
Write-Step "Auto-start on login"
$startupResp = Get-Consent "Launch Terminal Talk automatically when Windows starts? [Y/n]" $StartupYes
if ($startupResp -eq '' -or $startupResp -match '^[Yy]') {
    Copy-Item -Force (Join-Path $repoRoot 'scripts\start-toolbar.vbs') $vbsStartup
    Write-Ok "Startup shortcut installed"
}

# 8. First launch
Write-Step "Installation complete"
Write-Host ""
Write-Host "Hotkeys:" -ForegroundColor Cyan
Write-Host "  Ctrl+Shift+A   show/hide toolbar"
Write-Host "  Ctrl+Shift+S   read highlighted text aloud"
Write-Host "  Ctrl+Shift+J   toggle wake-word listening on/off"
Write-Host ""
Write-Host "Say 'hey jarvis' with text highlighted to trigger speech."
Write-Host ""
$launchResp = Get-Consent "Launch Terminal Talk now? [Y/n]" $false
if ($launchResp -eq '' -or $launchResp -match '^[Yy]') {
    Start-Process wscript.exe -ArgumentList "`"$vbsStartup`"" -ErrorAction SilentlyContinue
    if (-not (Test-Path $vbsStartup)) {
        Start-Process wscript.exe -ArgumentList "`"$(Join-Path $repoRoot 'scripts\start-toolbar.vbs')`""
    }
    Write-Ok "Launched"
}

Write-Host ""
Write-Host "Config:  $configPath"
Write-Host "Logs:    $queueDir\_toolbar.log, _voice.log, _hook.log"
Write-Host "Uninstall: run uninstall.ps1 from the repo"
Write-Host ""
