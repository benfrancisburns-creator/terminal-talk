# Apartment-safe wrapper around Get-TerminalFooter.
#
# Claude Code invokes hook scripts with `powershell.exe -File ...` which
# defaults to MTA apartment. UIA's AutomationElement.RootElement requires
# STA and *silently terminates the process* under MTA — no catchable
# exception, no exit code, nothing in the log except whatever was
# written before the UIA call. Observed live 2026-04-23: hook died
# mid-scrape between the "cleared working flag" and "terminal footer
# scraped" log lines.
#
# speak-response.ps1 spawns this helper with explicit -STA (see the
# `powershell.exe -STA -File ...` invocation) and reads the single-line
# result off stdout. Stdout is the phrase or an empty string; all other
# output goes through the hook log to keep stdout clean for parsing.
#
# Args: SessionShort (8 hex) / RegistryPath / ExpectedSec [/ ToleranceSec]

param(
    [Parameter(Mandatory = $true)] [string]$SessionShort,
    [Parameter(Mandatory = $true)] [string]$RegistryPath,
    [Parameter(Mandatory = $true)] [int]$ExpectedSec,
    [int]$ToleranceSec = 3,
    # Polling window inside the scrape (after cold-start). Bumped from
    # 2000 → 3000 ms 2026-04-26: telemetry showed the footer
    # occasionally takes 1.5+ s to appear after the Stop hook fires
    # because Claude Code prints it AFTER the hook chain completes.
    # 3 s gives genuinely robust headroom while still staying under
    # the parent's 6 s subprocess timeout.
    [int]$MaxWaitMs = 3000,
    # Tighter poll interval (250 → 150 ms) so we catch the footer's
    # appearance window faster. Cheap — just more `if` checks against
    # already-loaded buffer text.
    [int]$PollIntervalMs = 150,
    # Optional: when set, append per-stage timing data to this log
    # path so we can see WHERE the cold-start cost actually goes.
    # Caller (speak-response.ps1) supplies this for diagnostic runs.
    [string]$TimingLog = ''
)

$ErrorActionPreference = 'Stop'

# Stopwatch wrapper that writes per-stage durations to TimingLog. No-op
# when TimingLog is empty so production runs pay zero cost. Designed
# for cumulative breakdowns: each call records "stage took N ms" since
# the last stage marker, so we see the actual cold-start composition
# (assembly load vs UIA init vs window enum vs polling).
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$lastMs = 0L
function _LogStage([string]$stage) {
    if (-not $TimingLog) { return }
    $now = $stopwatch.ElapsedMilliseconds
    $delta = $now - $script:lastMs
    $script:lastMs = $now
    try {
        "$(Get-Date -Format 'HH:mm:ss.fff') [scrape-footer] $stage took ${delta}ms (total ${now}ms)" |
            Out-File $TimingLog -Append -Encoding utf8
    } catch {}
}

try {
    _LogStage 'subprocess started'
    $modulePath = Join-Path $PSScriptRoot 'terminal-scrape.psm1'
    Import-Module $modulePath -Force -ErrorAction Stop
    _LogStage 'module imported (UIA assemblies loaded)'
    $phrase = Get-TerminalFooter `
        -SessionShort   $SessionShort `
        -RegistryPath   $RegistryPath `
        -ExpectedSec    $ExpectedSec `
        -ToleranceSec   $ToleranceSec `
        -MaxWaitMs      $MaxWaitMs `
        -PollIntervalMs $PollIntervalMs
    $resultLabel = if ([string]::IsNullOrEmpty($phrase)) { 'EMPTY' } else { 'MATCH' }
    _LogStage "Get-TerminalFooter returned phrase=$resultLabel"
    # Write-Output so the phrase is the ONLY thing on stdout.
    if ($phrase) { Write-Output $phrase }
    exit 0
} catch {
    # Anything we can still recover from goes to stderr; stdout stays
    # empty so the parent treats the scrape as "no match, fall back".
    [Console]::Error.WriteLine("scrape helper error: $($_.Exception.Message)")
    exit 1
}
