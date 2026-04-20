# Copies the freshly-trained hey_tt.onnx from the repo tree into the
# live install at ~/.terminal-talk/app/models/. Run this AFTER the
# Colab training finishes and the .onnx file has been dropped into
# app/models/hey_tt.onnx in the repo.
#
# Zero-destructive: no other install file is touched. `install.ps1`
# remains the full-install entry point; this is a targeted update
# for the just-trained model.
#
# Exit 0  = copied successfully (or already identical to install copy).
# Exit 1  = repo copy missing (training didn't run or file wasn't moved into place).
# Exit 2  = install dir missing entirely (run install.ps1 first).

param(
    [string]$RepoRoot = (Split-Path -Parent (Split-Path -Parent $PSCommandPath)),
    [string]$InstallDir = (Join-Path $env:USERPROFILE '.terminal-talk')
)

$ErrorActionPreference = 'Stop'

function Write-Status($marker, $color, $msg) {
    Write-Host "$marker  " -NoNewline -ForegroundColor $color
    Write-Host $msg
}

$srcModel = Join-Path $RepoRoot 'app\models\hey_tt.onnx'
$destDir  = Join-Path $InstallDir 'app\models'
$destModel = Join-Path $destDir 'hey_tt.onnx'

if (-not (Test-Path $InstallDir)) {
    Write-Status '!!' Red "Install dir not found at $InstallDir"
    Write-Host "    Run install.ps1 from the repo root first."
    exit 2
}

if (-not (Test-Path $srcModel)) {
    Write-Status '!!' Red "Model file not found at $srcModel"
    Write-Host "    Run the Colab training notebook first (scripts/train-hey-tt/README.md)"
    Write-Host "    and drop the resulting hey_tt.onnx into app/models/ in the repo."
    exit 1
}

New-Item -ItemType Directory -Force -Path $destDir | Out-Null

$srcHash  = (Get-FileHash -Path $srcModel -Algorithm SHA256).Hash
if (Test-Path $destModel) {
    $destHash = (Get-FileHash -Path $destModel -Algorithm SHA256).Hash
    if ($srcHash -eq $destHash) {
        Write-Status 'OK' Green "Model already up-to-date (SHA match)"
        exit 0
    }
}

Copy-Item -Force $srcModel $destModel
$copiedHash = (Get-FileHash -Path $destModel -Algorithm SHA256).Hash
if ($copiedHash -ne $srcHash) {
    Write-Status '!!' Red "Copy verification failed — hashes differ after copy"
    Write-Host "    src:  $srcHash"
    Write-Host "    dest: $copiedHash"
    exit 1
}

$size = (Get-Item $destModel).Length
Write-Status 'OK' Green "Copied hey_tt.onnx ($([math]::Round($size / 1MB, 1)) MB) to $destModel"
Write-Host ""
Write-Host "Next: toggle the wake-word listener off+on (Ctrl+Shift+J twice) to reload the model,"
Write-Host "      or run install.ps1 for a full reinstall."
exit 0
