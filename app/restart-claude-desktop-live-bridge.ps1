param(
  [int]$Port = 9223,
  [int]$WaitSeconds = 12
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}

function Get-ClaudeDesktopRootProcess {
  Get-CimInstance Win32_Process -Filter "Name = 'claude.exe'" |
    Where-Object {
      $_.ExecutablePath -like '*\WindowsApps\Claude_*__pzs8sxrjxfjjc\app\claude.exe' -and
      $_.CommandLine -notmatch '--type='
    } |
    Sort-Object ProcessId |
    Select-Object -First 1
}

function Find-ClaudeDesktopExe {
  $running = Get-ClaudeDesktopRootProcess
  if ($running -and $running.ExecutablePath -and (Test-Path -LiteralPath $running.ExecutablePath)) {
    return $running.ExecutablePath
  }
  $matches = Get-ChildItem -LiteralPath "$env:ProgramFiles\WindowsApps" -Directory -Filter 'Claude_*__pzs8sxrjxfjjc' -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending
  foreach ($dir in $matches) {
    $candidate = Join-Path $dir.FullName 'app\claude.exe'
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  throw 'Claude Desktop executable was not found.'
}

function Test-CdpPort {
  param([int]$P)
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$P/json/list" -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  } catch {
    return $false
  }
}

if ($Port -lt 1 -or $Port -gt 65535) { throw "Invalid live bridge port: $Port" }

$exe = Find-ClaudeDesktopExe
$roots = Get-CimInstance Win32_Process -Filter "Name = 'claude.exe'" |
  Where-Object {
    $_.ExecutablePath -like '*\WindowsApps\Claude_*__pzs8sxrjxfjjc\app\claude.exe' -and
    $_.CommandLine -notmatch '--type='
  }
foreach ($process in $roots) {
  try { Stop-Process -Id $process.ProcessId -Force } catch {}
}

Start-Sleep -Milliseconds 800
Start-Process -FilePath $exe -ArgumentList @("--remote-debugging-port=$Port")

$deadline = (Get-Date).AddSeconds([math]::Max(2, $WaitSeconds))
do {
  Start-Sleep -Milliseconds 500
  if (Test-CdpPort $Port) {
    Write-Host "Claude Desktop live bridge listening on 127.0.0.1:$Port."
    exit 0
  }
} while ((Get-Date) -lt $deadline)

throw "Claude Desktop restarted, but live bridge port $Port did not become available."
