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

# Palette tables mirror app/statusline.ps1 + app/lib/tokens.json.
# If either moves, these three constants must move with them.
Set-Variable -Scope Script -Name PaletteCodepoints -Option ReadOnly -Force -Value @(
    0x1F534, 0x1F7E0, 0x1F7E1, 0x1F7E2, 0x1F535, 0x1F7E3, 0x1F7E4, 0x26AA
)
Set-Variable -Scope Script -Name HsplitPartner -Option ReadOnly -Force -Value @(3,4,5,0,1,2,7,6)
Set-Variable -Scope Script -Name VsplitPartner -Option ReadOnly -Force -Value @(4,5,6,7,0,1,2,3)

function _Get-Emoji([int]$idx) {
    $i = $idx % 24
    if ($i -lt 0) { $i += 24 }
    if ($i -lt 8) {
        return [char]::ConvertFromUtf32($script:PaletteCodepoints[$i])
    } elseif ($i -lt 16) {
        $p = $i - 8
        $s = $script:HsplitPartner[$p]
        return [char]::ConvertFromUtf32($script:PaletteCodepoints[$p]) + [char]::ConvertFromUtf32($script:PaletteCodepoints[$s])
    } else {
        $p = $i - 16
        $s = $script:VsplitPartner[$p]
        return [char]::ConvertFromUtf32($script:PaletteCodepoints[$p]) + [char]::ConvertFromUtf32($script:PaletteCodepoints[$s])
    }
}

function _Get-Signature([string]$RegistryPath, [string]$Short) {
    if (-not (Test-Path $RegistryPath)) { return $null }
    try {
        $reg = Get-Content $RegistryPath -Raw -Encoding utf8 | ConvertFrom-Json
        $entry = $reg.assignments.$Short
        if (-not $entry) { return $null }
        $idx = [int]$entry.index
        $label = if ($entry.label) { [string]$entry.label } else { '' }
        $emoji = _Get-Emoji $idx
        if ($label) { return "$emoji $label" } else { return $emoji }
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

function Get-TerminalFooter {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string]$SessionShort,
        [Parameter(Mandatory = $true)] [string]$RegistryPath,
        [Parameter(Mandatory = $true)] [int]$ExpectedSec,
        # Freshness tolerance: scraped duration must be within this many
        # seconds of ExpectedSec or we reject as stale. 3 s covers the
        # brief window between Claude Code printing the footer and the
        # Stop hook firing; wider would risk accepting a near-miss from
        # a prior short turn.
        [int]$ToleranceSec = 3
    )

    if ($ExpectedSec -lt 1) { return '' }

    $signature = _Get-Signature -RegistryPath $RegistryPath -Short $SessionShort
    if (-not $signature) { return '' }

    try {
        $root = [System.Windows.Automation.AutomationElement]::RootElement
        $cond = New-Object System.Windows.Automation.PropertyCondition `
            ([System.Windows.Automation.AutomationElement]::ClassNameProperty), 'CASCADIA_HOSTING_WINDOW_CLASS'
        $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
    } catch { return '' }

    # \p{L} matches any Unicode letter class, so accented verbs
    # ("Sautéed", "Philosophised") still match without us baking a
    # Latin-range literal into the regex. Important because this file
    # sometimes gets read by PowerShell as Windows-1252, which mangles
    # literal UTF-8 bytes mid-regex and throws "[x-y] range in reverse
    # order". ASCII + \p{L} avoids that class of bug entirely.
    $footerRegex = [regex]'(?m)([A-Z]\p{L}+) for (?:\d+m\s?)?\d+s\b'

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
            if (-not $text.Contains($signature)) { continue }

            $matches = $footerRegex.Matches($text)
            if ($matches.Count -eq 0) { continue }

            # Walk matches newest-first (they're in textual order,
            # which for a terminal buffer is oldest-first) and return
            # the first one that passes the freshness guard.
            for ($i = $matches.Count - 1; $i -ge 0; $i--) {
                $phrase = $matches[$i].Value
                $scrapedSec = _ParseFooterSeconds $phrase
                if ($scrapedSec -lt 0) { continue }
                $diff = [Math]::Abs($scrapedSec - $ExpectedSec)
                if ($diff -le $ToleranceSec) {
                    return $phrase
                }
            }
        }
    }

    return ''
}

Export-ModuleMember -Function Get-TerminalFooter
