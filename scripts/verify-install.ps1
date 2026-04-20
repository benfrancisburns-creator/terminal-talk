# Z2-7: Verify-install integrity check.
#
# Recomputes SHA-256 for every file listed in the installed
# `~/.terminal-talk/manifest.json` and reports any mismatches. Use cases:
#
#   - Confirm an install didn't partially corrupt during file copy.
#   - Detect hand-edits to installed files (debugging or tampering).
#   - Sanity-check an install after a machine restore / AV scan.
#
# Exit codes:
#   0  every file matches (or manifest empty)
#   1  one or more files changed / missing / added
#   2  install / manifest missing entirely -- rerun install.ps1
#
# Lane: stream-ua2-py (PowerShell by design; Ben asked for it to stay out of
# the .cjs lane).

param(
    [string]$InstallDir = (Join-Path $env:USERPROFILE '.terminal-talk')
)

$ErrorActionPreference = 'Stop'

function Write-Status($marker, $color, $msg) {
    Write-Host "$marker  " -NoNewline -ForegroundColor $color
    Write-Host $msg
}

if (-not (Test-Path $InstallDir)) {
    Write-Status '!!' Red "Install not found at $InstallDir"
    Write-Host "    Run install.ps1 from the repo root first."
    exit 2
}

$manifestPath = Join-Path $InstallDir 'manifest.json'
if (-not (Test-Path $manifestPath)) {
    Write-Status '!!' Red "No manifest.json at $manifestPath"
    Write-Host "    This install predates Z2-7; re-run install.ps1 to generate one."
    exit 2
}

try {
    $manifest = Get-Content $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
} catch {
    Write-Status '!!' Red "manifest.json is corrupt: $($_.Exception.Message)"
    exit 2
}

Write-Host "Verifying install at $InstallDir (manifest generated $($manifest.generated_at))"

$changed = @()
$missing = @()
$files = $manifest.files
# ConvertFrom-Json returns a PSCustomObject; iterate its NoteProperties.
foreach ($prop in $files.PSObject.Properties) {
    $rel = $prop.Name
    $expectedSha = [string]$prop.Value
    $fullPath = Join-Path $InstallDir $rel
    if (-not (Test-Path $fullPath)) {
        $missing += $rel
        continue
    }
    $actualSha = (Get-FileHash -Path $fullPath -Algorithm SHA256).Hash.ToLower()
    if ($actualSha -ne $expectedSha) {
        $changed += [pscustomobject]@{
            Path     = $rel
            Expected = $expectedSha
            Actual   = $actualSha
        }
    }
}

# Surface files present in install dir but missing from the manifest -- they
# might be a legitimate runtime artefact (e.g. __pycache__) or an unexpected
# addition. Only warn; don't fail on these.
$manifestRels = @($files.PSObject.Properties | ForEach-Object { $_.Name })
$installFiles = @()
$scan = @(
    (Join-Path $InstallDir 'app\*.py'),
    (Join-Path $InstallDir 'app\*.js'),
    (Join-Path $InstallDir 'app\*.ps1'),
    (Join-Path $InstallDir 'app\*.psm1'),
    (Join-Path $InstallDir 'app\lib\*.js'),
    (Join-Path $InstallDir 'hooks\*.ps1')
)
foreach ($pattern in $scan) {
    Get-ChildItem -Path $pattern -File -ErrorAction SilentlyContinue | ForEach-Object {
        $rel = $_.FullName.Substring($InstallDir.Length).TrimStart('\', '/').Replace('\', '/')
        $installFiles += $rel
    }
}
$extras = $installFiles | Where-Object { $manifestRels -notcontains $_ }

# --- Report ------------------------------------------------------------

if ($changed.Count -eq 0 -and $missing.Count -eq 0) {
    Write-Status 'OK' Green "$($manifestRels.Count) files verified clean"
} else {
    Write-Status '!!' Yellow "Integrity differences found:"
}

foreach ($rel in $missing) {
    Write-Status '-' Red "MISSING: $rel"
}
foreach ($c in $changed) {
    Write-Status '~' Yellow "CHANGED: $($c.Path)"
    Write-Host "       expected $($c.Expected)"
    Write-Host "       actual   $($c.Actual)"
}
if ($extras.Count -gt 0) {
    Write-Host ""
    Write-Status 'i' Cyan "Extras not in manifest (informational, not a failure):"
    foreach ($x in $extras) { Write-Host "    $x" }
}

if ($changed.Count -gt 0 -or $missing.Count -gt 0) { exit 1 }
exit 0
