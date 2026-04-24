# Terminal-scrape module.
#
# Scrape Claude Code's "Cooked for 49s" / "Sautéed for 1m 0s" footer
# directly off the Windows Terminal buffer using UI Automation. The
# footer is a render-only artefact — Claude Code never writes it to
# the jsonl transcript, to ~/.claude state, or to hook payload JSON.
# The only place it actually lives is on-screen pixels, and UIA's
# TextPattern is the sanctioned way to read those.
#
# Usage (from hooks/speak-response.ps1):
#
#     Import-Module (Join-Path $ttHome 'app\terminal-scrape.psm1') -Force
#     $footer = Get-TerminalFooter -SessionShort $sessionShort `
#                                  -RegistryPath $registryPath `
#                                  -ExpectedSec $elapsedSec
#     # Empty string when nothing trustworthy was scraped.
#
# The function:
#   1. Reads palette index + label for SessionShort from the colour
#      registry. Computes the exact emoji sequence statusline.ps1 emits.
#   2. Enumerates every WindowsTerminal.exe window via UIA, inspects
#      the TermControl in each, and finds the one whose buffer text
#      contains our session's statusline signature (emoji + label).
#   3. Finds the LAST "<Verb> for Xm Ys" match in that buffer.
#   4. Freshness guard: parses the scraped duration and rejects if
#      it differs from ExpectedSec by more than ±3 s. Without this
#      guard a stale footer from the PREVIOUS turn (still visible in
#      scrollback) would leak into this turn's audio.
#   5. Returns the scraped string on match, empty on any failure.
#      Caller falls back to a computed phrase.

Add-Type -AssemblyName UIAutomationClient -ErrorAction SilentlyContinue
Add-Type -AssemblyName UIAutomationTypes  -ErrorAction SilentlyContinue

# Statusline glyph tables. Post-v0.5 (option C), statusline.ps1 emits
# ANSI-coloured block chars instead of emoji codepoints — ● for solids,
# ▌ for horizontal splits (left-half fg, right-half bg), ▀ for vertical
# splits (upper-half fg, lower-half bg). UIA's `DocumentRange.GetText`
# strips ANSI and returns just the rendered glyph, so the signature we
# match against the terminal buffer is the plain char + the session's
# label. Scrape-by-emoji worked well for unlabelled sessions before
# (8 distinct emoji codepoints); option C trades that for visual
# consistency + exact palette colour match to the toolbar. Without a
# label, the scrape can't uniquely locate an unlabelled session —
# acceptable since footer-clip fallback is the "computed phrase".
function _Get-StatuslineGlyph([int]$idx) {
    $i = $idx % 24
    if ($i -lt 0) { $i += 24 }
    if ($i -lt 8)  { return ([char]0x25CF).ToString() }  # ● BLACK CIRCLE
    if ($i -lt 16) { return ([char]0x258C).ToString() }  # ▌ LEFT HALF BLOCK
    return ([char]0x2580).ToString()                      # ▀ UPPER HALF BLOCK
}

function _Get-Signature([string]$RegistryPath, [string]$Short) {
    if (-not (Test-Path $RegistryPath)) { return $null }
    try {
        $reg = Get-Content $RegistryPath -Raw -Encoding utf8 | ConvertFrom-Json
        $entry = $reg.assignments.$Short
        if (-not $entry) { return $null }
        $idx = [int]$entry.index
        $label = if ($entry.label) { [string]$entry.label } else { '' }
        $glyph = _Get-StatuslineGlyph $idx
        if ($label) { return "$glyph $label" } else { return $glyph }
    } catch { return $null }
}

function _ParseFooterSeconds([string]$footer) {
    # 'Worked for 49s' -> 49 ; 'Sautéed for 1m 0s' -> 60.
    $m = [regex]::Match($footer, '^[^\s]+\s+for\s+(?:(\d+)m\s*)?(\d+)s\s*$')
    if (-not $m.Success) { return -1 }
    $mins = if ($m.Groups[1].Success) { [int]$m.Groups[1].Value } else { 0 }
    $secs = [int]$m.Groups[2].Value
    return $mins * 60 + $secs
}

function _Try-ScrapeOnce([string]$Signature, [int]$ExpectedSec, [int]$ToleranceSec) {
    # \p{L} matches any Unicode letter class, so accented verbs
    # ("Sautéed", "Philosophised") match without us baking a Latin
    # range literal into the regex. Important because PowerShell
    # reads this file as Windows-1252 when there's no BOM, which
    # mangles UTF-8 bytes mid-regex and throws "[x-y] range in
    # reverse order". ASCII + \p{L} avoids that class of bug entirely.
    $footerRegex = [regex]'(?m)([A-Z]\p{L}+) for (?:\d+m\s?)?\d+s\b'

    try {
        $root = [System.Windows.Automation.AutomationElement]::RootElement
        $cond = New-Object System.Windows.Automation.PropertyCondition `
            ([System.Windows.Automation.AutomationElement]::ClassNameProperty), 'CASCADIA_HOSTING_WINDOW_CLASS'
        $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
    } catch { return '' }

    foreach ($w in $windows) {
        try {
            $termCond = New-Object System.Windows.Automation.PropertyCondition `
                ([System.Windows.Automation.AutomationElement]::ClassNameProperty), 'TermControl'
            $terms = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $termCond)
        } catch { continue }

        foreach ($tc in $terms) {
            try {
                $tp = $tc.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
                $text = $tp.DocumentRange.GetText(-1)
            } catch { continue }
            if (-not $text) { continue }
            if (-not $text.Contains($Signature)) { continue }

            # Named $footerMatches (not $matches) — PowerShell's $matches is
            # an automatic variable populated by -match / -replace; shadowing
            # it is flagged by PSScriptAnalyzer and can surprise future
            # readers who expect -match results nearby.
            $footerMatches = $footerRegex.Matches($text)
            if ($footerMatches.Count -eq 0) { continue }

            # Walk matches newest-first (textual order = oldest-first
            # in a terminal buffer). Return the first one whose parsed
            # duration is within ToleranceSec of ExpectedSec.
            for ($i = $footerMatches.Count - 1; $i -ge 0; $i--) {
                $phrase = $footerMatches[$i].Value
                $scrapedSec = _ParseFooterSeconds $phrase
                if ($scrapedSec -lt 0) { continue }
                $diff = [Math]::Abs($scrapedSec - $ExpectedSec)
                if ($diff -le $ToleranceSec) { return $phrase }
            }
        }
    }
    return ''
}

function Get-TerminalFooter {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string]$SessionShort,
        [Parameter(Mandatory = $true)] [string]$RegistryPath,
        [Parameter(Mandatory = $true)] [int]$ExpectedSec,
        # Freshness tolerance: scraped duration must be within this
        # many seconds of ExpectedSec or we reject as stale. 3 s covers
        # the brief window between Claude Code printing the footer and
        # the Stop hook firing; wider would risk accepting a near-miss
        # from a prior short turn.
        [int]$ToleranceSec = 3,
        # Claude Code renders the footer AFTER the Stop hook fires
        # (the hook is part of its "end of turn" pipeline; the footer
        # is the last thing printed to the user-visible TTY). If we
        # scrape once and immediately give up, the fresh match
        # usually isn't there yet — fallback runs, user hears
        # "Vibed for 24 minutes..." instead of the terminal's
        # "Brewed for 24m 56s". Poll up to $MaxWaitMs waiting for the
        # footer to appear. Observed live 2026-04-23: delay is under
        # 500 ms most turns, never over ~1.5 s in testing.
        [int]$MaxWaitMs = 2000,
        [int]$PollIntervalMs = 250
    )

    if ($ExpectedSec -lt 1) { return '' }

    $signature = _Get-Signature -RegistryPath $RegistryPath -Short $SessionShort
    if (-not $signature) { return '' }

    $deadline = [Environment]::TickCount64 + $MaxWaitMs
    do {
        $phrase = _Try-ScrapeOnce -Signature $signature `
                                  -ExpectedSec $ExpectedSec `
                                  -ToleranceSec $ToleranceSec
        if ($phrase) { return $phrase }
        $remaining = $deadline - [Environment]::TickCount64
        if ($remaining -le 0) { break }
        $sleepMs = [Math]::Min($PollIntervalMs, [int]$remaining)
        Start-Sleep -Milliseconds $sleepMs
    } while ([Environment]::TickCount64 -lt $deadline)

    return ''
}

Export-ModuleMember -Function Get-TerminalFooter
