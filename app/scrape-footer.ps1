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
    [int]$MaxWaitMs = 2000,
    [int]$PollIntervalMs = 250
)

$ErrorActionPreference = 'Stop'
try {
    $modulePath = Join-Path $PSScriptRoot 'terminal-scrape.psm1'
    Import-Module $modulePath -Force -ErrorAction Stop
    $phrase = Get-TerminalFooter `
        -SessionShort   $SessionShort `
        -RegistryPath   $RegistryPath `
        -ExpectedSec    $ExpectedSec `
        -ToleranceSec   $ToleranceSec `
        -MaxWaitMs      $MaxWaitMs `
        -PollIntervalMs $PollIntervalMs
    # Write-Output so the phrase is the ONLY thing on stdout.
    if ($phrase) { Write-Output $phrase }
    exit 0
} catch {
    # Anything we can still recover from goes to stderr; stdout stays
    # empty so the parent treats the scrape as "no match, fall back".
    [Console]::Error.WriteLine("scrape helper error: $($_.Exception.Message)")
    exit 1
}
