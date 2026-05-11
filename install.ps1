#Requires -Version 5.1
<#
.SYNOPSIS
  Terminal Talk installer.
.DESCRIPTION
  Installs Terminal Talk to %USERPROFILE%\.terminal-talk\.
  - Checks prerequisites (Python 3.10+, Node.js 18+).
  - Installs Python packages (pinned via requirements.txt).
  - Installs Electron runtime dependencies.
  - Copies app + hooks + config example.
  - Optionally registers Claude Code hooks in ~/.claude/settings.json.
  - Optionally registers Codex CLI lifecycle hooks in ~/.codex/hooks.json.
  - Adds Start Menu / optional Desktop shortcuts for the toolbar and can add a Startup shortcut for login auto-launch.
.PARAMETER Unattended
  Skip ALL interactive prompts and apply sensible defaults
  (Claude hooks yes, statusline yes, Codex hooks no, desktop shortcut yes, startup no). Use for CI / automation.
.PARAMETER HooksYes
  In unattended mode, register Claude Code hooks. Default: $true.
.PARAMETER StatuslineYes
  In unattended mode, install the per-terminal statusline. Default: $true.
.PARAMETER CodexHooksYes
  In unattended mode, register OpenAI Codex CLI hooks and let Terminal Talk own
  the Codex terminal title. Default: $false because Codex hook configuration is
  user-level and affects unrelated Codex sessions.
.PARAMETER StartupYes
  In unattended mode, add a Startup shortcut. Default: $false
  (deliberate -- auto-launch is a per-user choice, not something
  unattended installs should make for you).
.PARAMETER DesktopShortcutYes
  In unattended mode, add a Desktop shortcut. Default: $true.
.NOTES
  Run from the terminal-talk/ folder (the one containing install.ps1).
  Re-running is safe: existing install dir is updated in place.
#>
[CmdletBinding()]
[Diagnostics.CodeAnalysis.SuppressMessageAttribute(
    'PSReviewUnusedParameter',
    'Unattended',
    Justification = 'Referenced inside Get-Consent function; analyzer does not track script-param usage through nested function bodies.'
)]
param(
    [switch]$Unattended,
    [bool]$HooksYes      = $true,
    [bool]$StatuslineYes = $true,
    [bool]$CodexHooksYes = $false,
    [bool]$StartupYes    = $false,
    [bool]$DesktopShortcutYes = $true
)

$ErrorActionPreference = 'Stop'
# Prompt helper honoured by every Read-Host in this script. In attended
# mode it calls Read-Host and returns the raw input. In -Unattended
# mode it skips the prompt and returns 'Y' or 'n' based on the
# pre-set switch -- so the same consent logic downstream ($resp -match
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
$programsFolder = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$vbsStartup = Join-Path $startupFolder 'terminal-talk.vbs'
$launcherVbs = Join-Path $installDir 'terminal-talk.vbs'
$startMenuShortcut = Join-Path $programsFolder 'Terminal Talk.lnk'
$desktopDir = [Environment]::GetFolderPath('DesktopDirectory')
$desktopShortcut = Join-Path $desktopDir 'Terminal Talk.lnk'
$legacyCodexShortcut = Join-Path $programsFolder 'Terminal Talk Codex.lnk'
$legacyDesktopCodexShortcut = Join-Path $desktopDir 'Terminal Talk Codex.lnk'
$claudeSettings = Join-Path $env:USERPROFILE '.claude\settings.json'
$codexHome = Join-Path $env:USERPROFILE '.codex'
$codexConfig = Join-Path $codexHome 'config.toml'
$codexHooksJson = Join-Path $codexHome 'hooks.json'

function Write-Step($msg) { Write-Host ""; Write-Host ">> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "   OK  $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "   !!  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "   ERR $msg" -ForegroundColor Red }

function New-Shortcut {
    param(
        [Parameter(Mandatory = $true)] [string]$Path,
        [Parameter(Mandatory = $true)] [string]$TargetPath,
        [string]$Arguments = '',
        [string]$WorkingDirectory = '',
        [string]$IconLocation = '',
        [string]$Description = ''
    )
    $parent = Split-Path -Parent $Path
    if ($parent -and -not (Test-Path $parent)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    $shortcut.TargetPath = $TargetPath
    if ($Arguments) { $shortcut.Arguments = $Arguments }
    if ($WorkingDirectory) { $shortcut.WorkingDirectory = $WorkingDirectory }
    if ($IconLocation) { $shortcut.IconLocation = $IconLocation }
    if ($Description) { $shortcut.Description = $Description }
    $shortcut.Save()
}

function Set-TomlSectionKey {
    param(
        [string[]]$Lines,
        [Parameter(Mandatory = $true)] [string]$Section,
        [Parameter(Mandatory = $true)] [string]$Key,
        [Parameter(Mandatory = $true)] [string]$Value
    )
    $sectionRe = "^\s*\[$([regex]::Escape($Section))\]\s*$"
    $subsectionRe = "^\s*\[$([regex]::Escape($Section))\."
    $keyRe = "^\s*$([regex]::Escape($Key))\s*="
    $start = -1
    for ($i = 0; $i -lt $Lines.Count; $i++) {
        if ($Lines[$i] -match $sectionRe) { $start = $i; break }
    }
    if ($start -lt 0) {
        $insert = $Lines.Count
        for ($i = 0; $i -lt $Lines.Count; $i++) {
            if ($Lines[$i] -match $subsectionRe) { $insert = $i; break }
        }
        $before = if ($insert -gt 0) { @($Lines[0..($insert - 1)]) } else { @() }
        $after = if ($insert -lt $Lines.Count) { @($Lines[$insert..($Lines.Count - 1)]) } else { @() }
        return @($before + @('', "[$Section]", "$Key = $Value") + $after)
    }
    $end = $Lines.Count
    for ($i = $start + 1; $i -lt $Lines.Count; $i++) {
        if ($Lines[$i] -match '^\s*\[[^\]]+\]\s*$') { $end = $i; break }
    }
    for ($i = $start + 1; $i -lt $end; $i++) {
        if ($Lines[$i] -match $keyRe) {
            $Lines[$i] = "$Key = $Value"
            return $Lines
        }
    }
    $before = @($Lines[0..($end - 1)])
    $after = if ($end -lt $Lines.Count) { @($Lines[$end..($Lines.Count - 1)]) } else { @() }
    return @($before + @("$Key = $Value") + $after)
}

function Update-CodexConfigToml {
    param([Parameter(Mandatory = $true)] [string]$Path)
    $parent = Split-Path -Parent $Path
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    $lines = if (Test-Path $Path) { @(Get-Content $Path -Encoding utf8) } else { @() }
    $lines = @($lines | Where-Object { $_ -notmatch '^\s*codex_hooks\s*=' })
    $lines = Set-TomlSectionKey -Lines $lines -Section 'features' -Key 'hooks' -Value 'true'
    $lines = Set-TomlSectionKey -Lines $lines -Section 'tui' -Key 'terminal_title' -Value '[]'
    Set-Content -Path $Path -Value $lines -Encoding utf8
}

function Set-CodexHookGroup {
    param(
        [Parameter(Mandatory = $true)] $HooksRoot,
        [Parameter(Mandatory = $true)] [string]$Event,
        [string]$Matcher = '',
        [Parameter(Mandatory = $true)] [string]$ScriptPath,
        [int]$Timeout = 10
    )
    if (-not $HooksRoot.hooks) {
        $HooksRoot | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{}) -Force
    }
    $existing = @()
    if ($HooksRoot.hooks.PSObject.Properties.Name -contains $Event) {
        $existing = @($HooksRoot.hooks.$Event) | Where-Object {
            $json = $_ | ConvertTo-Json -Depth 20 -Compress
            $json -notmatch 'terminal-talk.*hooks.*codex-'
        }
    }
    $command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""
    $group = [pscustomobject]@{
        matcher = $Matcher
        hooks = @([pscustomobject]@{
            type = 'command'
            command = $command
            timeout = $Timeout
        })
    }
    $HooksRoot.hooks | Add-Member -NotePropertyName $Event -NotePropertyValue @($existing + $group) -Force
}

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
Copy-Item -Force (Join-Path $repoRoot 'scripts\start-toolbar.vbs') $launcherVbs
if (-not (Test-Path $configPath)) {
    Copy-Item -Force (Join-Path $repoRoot 'config.example.json') $configPath
    Write-Ok "config.json created (from config.example.json)"
} else {
    Write-Warn2 "config.json already exists, left untouched"
}
Write-Ok "Files copied"

# Z2-7: after the copy loop, stamp ~/.terminal-talk/manifest.json with a
# SHA-256 of every runtime source file so a future `verify-install.ps1`
# run can detect hand-edits, corrupted updates, or partial-failure
# states. The manifest is rewritten on every install; it's a snapshot
# of "what this version of Terminal Talk shipped", not a diff ledger.
Write-Step "Writing integrity manifest"
$manifest = [ordered]@{
    generated_at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    install_dir  = $installDir
    files        = [ordered]@{}
}
$patterns = @(
    (Join-Path $appDir '*.py'),
    (Join-Path $appDir '*.js'),
    (Join-Path $appDir '*.ps1'),
    (Join-Path $appDir '*.psm1'),
    (Join-Path $appDir 'lib\*.js'),
    (Join-Path $hooksDir '*.ps1')
)
# Hashing helper — direct .NET SHA256 instead of Get-FileHash. Observed
# on Windows PowerShell 5.1 (Ben, 2026-04-21): `Get-FileHash` invoked
# inside this ForEach-Object pipeline intermittently fails with "the
# term 'Get-FileHash' is not recognized" — runspace module-autoload
# race. Works fine under pwsh 7+. System.Security.Cryptography.SHA256
# is available on every Windows PS version since 2.0, no autoload.
# Files are < 50 KB so ReadAllBytes is fine — no stream needed.
function Get-Sha256Hex([string]$path) {
    $bytes = [IO.File]::ReadAllBytes($path)
    $hashBytes = [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
    return [BitConverter]::ToString($hashBytes).Replace('-', '').ToLower()
}
$manifestCount = 0
foreach ($pattern in $patterns) {
    Get-ChildItem -Path $pattern -File -ErrorAction SilentlyContinue | ForEach-Object {
        $rel = $_.FullName.Substring($installDir.Length).TrimStart('\', '/').Replace('\', '/')
        $sha = Get-Sha256Hex $_.FullName
        $manifest.files[$rel] = $sha
        $manifestCount++
    }
}
$manifestPath = Join-Path $installDir 'manifest.json'
$manifestJson = $manifest | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText($manifestPath, $manifestJson, [System.Text.UTF8Encoding]::new($false))
Write-Ok "Manifest: $manifestCount files SHA-256'd -> manifest.json"

# D2 safeStorage sidecar hardening.
# `config.secrets.json` is created lazily by main.js (Electron) the first
# time the user sets an OpenAI key. It contains plaintext so the same-
# user PS hooks + synth_turn.py can read it without re-implementing
# safeStorage's DPAPI ceremony. We need two guarantees:
#   1. The INSTALL DIR ACL is tight -- SYSTEM + current user only.
#   2. If the sidecar exists (user upgraded with key already set, or
#      a previous run wrote it), its inheritance matches.
# The install dir itself lives under $env:USERPROFILE which is already
# ACL'd to the current user, so this is belt-and-braces. `icacls
# /inheritance:r /grant <user>:(R,W)` removes any accidentally broader
# inheritance without trying to be clever about existing ACLs.
Write-Step "Tightening sidecar ACL"
$secretsPath = Join-Path $installDir 'config.secrets.json'
if (Test-Path $secretsPath) {
    try {
        & icacls $secretsPath /inheritance:r /grant "$($env:USERNAME):(R,W)" 2>&1 | Out-Null
        Write-Ok "Sidecar ACL: $env:USERNAME R,W only"
    } catch {
        Write-Warn2 "icacls on config.secrets.json failed (non-fatal): $($_.Exception.Message)"
    }
} else {
    Write-Ok "Sidecar absent (created lazily by main.js on first key-set)"
}

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
& npm install --omit=dev --silent --no-audit --no-fund 2>&1 | Out-Null
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
        $workHook = Join-Path $hooksDir 'mark-working.ps1'
        $settings.hooks.Stop = @(@{
            matcher = ''
            hooks = @(@{
                type = 'command'
                # -STA so UIA works inline. Without it speak-response.ps1
                # can't scrape Claude Code's "Cooked for X" footer
                # (RootElement silently hangs in MTA). The other hooks
                # don't use UIA so they keep the default apartment.
                command = "powershell.exe -STA -NoProfile -ExecutionPolicy Bypass -File `"$respHook`""
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
        # HB2 — UserPromptSubmit hook. Writes a per-session working flag
        # when you submit a prompt; the Stop hook clears it when Claude
        # finishes. Heartbeat-verb emission gates on the flag so the
        # "Percolating / Moonwalking" verbs only speak while a response
        # is genuinely in flight.
        $settings.hooks.UserPromptSubmit = @(@{
            matcher = ''
            hooks = @(@{
                type = 'command'
                command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$workHook`""
                timeout = 10
            })
        })
        $settings | ConvertTo-Json -Depth 20 | Set-Content $claudeSettings -Encoding utf8
        Write-Ok "Hooks registered (Stop, Notification, PreToolUse, UserPromptSubmit - settings.json backed up)"
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

# 6c. Codex CLI native hooks and title ownership
Write-Step "Codex CLI integration"
$codexResp = Get-Consent "Register global OpenAI Codex CLI hooks and Terminal Talk tab titles? This affects every Codex session using ~/.codex. [y/N]" $CodexHooksYes
if ($codexResp -match '^[Yy]') {
    if (-not (Test-Path $codexHome)) { New-Item -ItemType Directory -Force -Path $codexHome | Out-Null }
    if (Test-Path $codexConfig) {
        Copy-Item -Force $codexConfig "$codexConfig.backup-$(Get-Date -Format 'yyyyMMddHHmmss')"
    }
    if (Test-Path $codexHooksJson) {
        Copy-Item -Force $codexHooksJson "$codexHooksJson.backup-$(Get-Date -Format 'yyyyMMddHHmmss')"
    }
    Update-CodexConfigToml -Path $codexConfig

    $codexHookRoot = [pscustomobject]@{ hooks = [pscustomobject]@{} }
    if (Test-Path $codexHooksJson) {
        try {
            $rawCodexHooks = Get-Content $codexHooksJson -Raw -Encoding utf8
            if ($rawCodexHooks) { $codexHookRoot = $rawCodexHooks | ConvertFrom-Json -ErrorAction Stop }
            if (-not $codexHookRoot.hooks) {
                $codexHookRoot | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{}) -Force
            }
        } catch {
            Write-Fail "~/.codex/hooks.json is not valid JSON:"
            Write-Host "    $($_.Exception.Message)" -ForegroundColor Red
            Write-Warn2 "Refusing to edit Codex hooks. Fix or delete hooks.json and rerun install.ps1."
            exit 1
        }
    }

    Set-CodexHookGroup -HooksRoot $codexHookRoot -Event 'SessionStart' -ScriptPath (Join-Path $hooksDir 'codex-session-start.ps1') -Timeout 10
    Set-CodexHookGroup -HooksRoot $codexHookRoot -Event 'UserPromptSubmit' -ScriptPath (Join-Path $hooksDir 'codex-mark-working.ps1') -Timeout 10
    Set-CodexHookGroup -HooksRoot $codexHookRoot -Event 'PreToolUse' -Matcher '' -ScriptPath (Join-Path $hooksDir 'codex-on-tool.ps1') -Timeout 10
    Set-CodexHookGroup -HooksRoot $codexHookRoot -Event 'PostToolUse' -Matcher '' -ScriptPath (Join-Path $hooksDir 'codex-post-tool.ps1') -Timeout 10
    Set-CodexHookGroup -HooksRoot $codexHookRoot -Event 'Stop' -ScriptPath (Join-Path $hooksDir 'codex-stop.ps1') -Timeout 10
    $codexHookRoot | ConvertTo-Json -Depth 20 | Set-Content $codexHooksJson -Encoding utf8
    Write-Ok "Codex hooks registered (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop)"
    Write-Ok "Codex terminal_title emptied so Terminal Talk owns the tab title"
} else {
    Write-Warn2 "Skipped global Codex hooks. Codex rollout watching, Terminal Talk-launched Codex registration, and Codex Desktop title sync remain available."
}

# 7. Windows shortcuts
Write-Step "Windows shortcuts"
$terminalTalkExe = Join-Path $appDir 'node_modules\electron\dist\terminal-talk.exe'
$wscriptExe = Join-Path $env:SystemRoot 'System32\wscript.exe'
New-Shortcut -Path $startMenuShortcut `
             -TargetPath $wscriptExe `
             -Arguments "`"$launcherVbs`"" `
             -WorkingDirectory $installDir `
             -IconLocation $terminalTalkExe `
             -Description 'Launch Terminal Talk'
Write-Ok "Start Menu shortcut installed"

foreach ($legacyShortcut in @($legacyCodexShortcut, $legacyDesktopCodexShortcut)) {
    if (Test-Path $legacyShortcut) {
        Remove-Item -Force $legacyShortcut -ErrorAction SilentlyContinue
        Write-Ok "Removed legacy Codex launcher shortcut: $legacyShortcut"
    }
}

$desktopResp = Get-Consent "Create a Desktop shortcut for Terminal Talk? [Y/n]" $DesktopShortcutYes
if ($desktopResp -eq '' -or $desktopResp -match '^[Yy]') {
    New-Shortcut -Path $desktopShortcut `
                 -TargetPath $wscriptExe `
                 -Arguments "`"$launcherVbs`"" `
                 -WorkingDirectory $installDir `
                 -IconLocation $terminalTalkExe `
                 -Description 'Launch Terminal Talk'
    Write-Ok "Desktop shortcut installed"
}

# 8. Startup shortcut
Write-Step "Auto-start on login"
$startupResp = Get-Consent "Launch Terminal Talk automatically when Windows starts? [Y/n]" $StartupYes
if ($startupResp -eq '' -or $startupResp -match '^[Yy]') {
    Copy-Item -Force $launcherVbs $vbsStartup
    Write-Ok "Startup shortcut installed"
}

# 9. First launch
Write-Step "Installation complete"
Write-Host ""
Write-Host "Hotkeys:" -ForegroundColor Cyan
Write-Host "  Ctrl+Shift+A   show/hide toolbar"
Write-Host "  Ctrl+Shift+S   read highlighted text aloud"
Write-Host "  Ctrl+Shift+J   toggle wake-word listening on/off"
Write-Host ""
Write-Host "Claude Code:" -ForegroundColor Cyan
Write-Host "  Hooks already registered into ~/.claude/settings.json"
Write-Host "  (Stop, Notification, PreToolUse, UserPromptSubmit). Just"
Write-Host "  start a Claude Code terminal -- the toolbar narrates"
Write-Host "  responses + tool calls automatically."
Write-Host ""
Write-Host "Codex CLI:" -ForegroundColor Cyan
Write-Host "  Open a normal terminal in any project folder and run codex."
Write-Host "  Native Codex hooks sync identity, working state and tab titles;"
Write-Host "  the rollout watcher remains fallback."
Write-Host ""
Write-Host "Highlight any text + say 'hey jarvis' (or press Ctrl+Shift+S) to read it aloud."
Write-Host ""
$launchResp = Get-Consent "Launch Terminal Talk now? [Y/n]" $false
if ($launchResp -eq '' -or $launchResp -match '^[Yy]') {
    Start-Process wscript.exe -ArgumentList "`"$launcherVbs`"" -ErrorAction SilentlyContinue
    if (-not (Test-Path $launcherVbs)) {
        Start-Process wscript.exe -ArgumentList "`"$(Join-Path $repoRoot 'scripts\start-toolbar.vbs')`""
    }
    Write-Ok "Launched"
}

Write-Host ""
Write-Host "Config:  $configPath"
Write-Host "Logs:    $queueDir\_toolbar.log, _voice.log, _hook.log"
Write-Host "Uninstall: run uninstall.ps1 from the repo"
Write-Host ""
