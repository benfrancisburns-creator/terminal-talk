param(
    [Parameter(Mandatory = $true)] [string]$SessionShort,
    [Parameter(Mandatory = $true)] [string]$RegistryPath
)

# Read Claude Code's "Worked for X" footer from a Windows Terminal pane
# via UI Automation. Emits the matched footer string on stdout (or
# nothing on no-match). Spawned by Terminal Talk's main app process —
# NOT from a Claude Code Stop hook. UIA hangs in the hook process tree
# (inherited stdio/COM context), but works fine when spawned from the
# Terminal Talk app, which is what made this approach finally land.
#
# The flat structure (no Import-Module) is deliberate: the same code
# inside a module hung at first call. Keeping everything inline avoids
# whatever module-load context-switch causes the hang.

$ErrorActionPreference = 'SilentlyContinue'

try {
    Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
    Add-Type -AssemblyName UIAutomationTypes  -ErrorAction Stop
} catch {
    exit 0
}

# Per-session signature = the statusline glyph + label, exactly as
# Terminal Talk's statusline.ps1 emits it into Windows Terminal.
function _Get-StatuslineGlyph([int]$idx) {
    $i = $idx % 24
    if ($i -lt 0) { $i += 24 }
    if ($i -lt 8)  { return ([char]0x25CF).ToString() }  # ●
    if ($i -lt 16) { return ([char]0x258C).ToString() }  # ▌
    return ([char]0x2580).ToString()                      # ▀
}

$signature = $null
try {
    if (Test-Path -LiteralPath $RegistryPath) {
        $reg = Get-Content -Raw -LiteralPath $RegistryPath -Encoding utf8 | ConvertFrom-Json
        $entry = $reg.assignments.$SessionShort
        if ($entry) {
            $idx = [int]$entry.index
            $label = if ($entry.label) { [string]$entry.label } else { '' }
            $glyph = _Get-StatuslineGlyph $idx
            $signature = if ($label) { "$glyph $label" } else { $glyph }
        }
    }
} catch {}

if (-not $signature) { exit 0 }

# Match just the verb-and-duration. Lookahead `(?=\s*$)` requires the
# duration to be the last non-whitespace content on the line, but the
# match itself is just `<Verb> for Xm Ys` — no leading bullet, no
# trailing terminal-width padding. Claude Code's footer line is
# `✻ Brewed for 10m 28s` followed by spaces; we only want the middle.
$footerRegex = [regex]'(?m)([A-Z]\p{L}+) for (?:\d+m\s?)?\d+s(?=\s*$)'

try {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ClassNameProperty,
        'CASCADIA_HOSTING_WINDOW_CLASS')
    $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
} catch { exit 0 }

$termCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ClassNameProperty,
    'TermControl')

foreach ($w in $windows) {
    try { $terms = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $termCond) }
    catch { continue }
    foreach ($tc in $terms) {
        try {
            $tp = $tc.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
            $text = $tp.DocumentRange.GetText(-1)
        } catch { continue }
        if (-not $text -or -not $text.Contains($signature)) { continue }
        $matches = $footerRegex.Matches($text)
        if ($matches.Count -eq 0) { continue }
        # Last match in the buffer = most recent footer = THIS turn.
        $last = $matches[$matches.Count - 1].Value
        Write-Output $last
        exit 0
    }
}
exit 0
