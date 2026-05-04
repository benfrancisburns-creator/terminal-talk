Set-StrictMode -Version 3
$ErrorActionPreference = 'SilentlyContinue'

function _Normalize-PathCase {
    param([string]$Path)
    if (-not $Path) { return '' }
    try {
        return ([IO.Path]::GetFullPath($Path)).TrimEnd('\').ToLowerInvariant()
    } catch {
        return $Path.TrimEnd('\').ToLowerInvariant()
    }
}

function _To-UtcDateTime {
    param($Value)
    if ($Value -is [datetime]) {
        return $Value.ToUniversalTime()
    }
    try {
        if ($Value -is [string] -and $Value.Trim()) {
            $styles = [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
            return ([DateTimeOffset]::Parse($Value, [Globalization.CultureInfo]::InvariantCulture, $styles)).UtcDateTime
        }
        return ([datetime]$Value).ToUniversalTime()
    } catch {
        return [datetime]::MinValue
    }
}

function Read-TerminalTalkPaletteTokens {
    $fallback = @{
        PaletteSize   = 24
        BaseColours   = @('ff5e5e', 'ffa726', 'ffd93d', '4ade80', '60a5fa', 'ee2bbd', 'c97b50', 'e0e0e0')
        HsplitPartner = @(3, 4, 5, 0, 1, 2, 7, 6)
        VsplitPartner = @(4, 5, 6, 7, 0, 1, 2, 3)
    }
    try {
        $tokensPath = Join-Path $PSScriptRoot 'lib\tokens.json'
        if (-not (Test-Path $tokensPath)) { return $fallback }
        $tokens = Get-Content -Path $tokensPath -Raw -Encoding utf8 | ConvertFrom-Json
        $palette = $tokens.palette
        $base = @($palette.BASE_COLOURS | ForEach-Object { ([string]$_).Trim().TrimStart('#') })
        $hsplit = @($palette.HSPLIT_PARTNER | ForEach-Object { [int]$_ })
        $vsplit = @($palette.VSPLIT_PARTNER | ForEach-Object { [int]$_ })
        $size = [int]$palette.PALETTE_SIZE
        if ($base.Count -lt 8 -or $hsplit.Count -lt 8 -or $vsplit.Count -lt 8 -or $size -lt 24) {
            return $fallback
        }
        return @{
            PaletteSize   = $size
            BaseColours   = $base
            HsplitPartner = $hsplit
            VsplitPartner = $vsplit
        }
    } catch {
        return $fallback
    }
}

$script:TerminalTalkPaletteTokens = Read-TerminalTalkPaletteTokens
$script:TerminalTalkPaletteSize = [int]$script:TerminalTalkPaletteTokens.PaletteSize
$script:TerminalTalkPaletteHex = @($script:TerminalTalkPaletteTokens.BaseColours)

$script:TerminalTalkPaletteEmojiCodepoints = @(
    0x1F534,
    0x1F7E0,
    0x1F7E1,
    0x1F7E2,
    0x1F535,
    0x1F7E3,
    0x1F7E4,
    0x26AA
)

$script:TerminalTalkHsplitPartner = @($script:TerminalTalkPaletteTokens.HsplitPartner)
$script:TerminalTalkVsplitPartner = @($script:TerminalTalkPaletteTokens.VsplitPartner)

function _HexToRgbText {
    param([string]$Hex)
    $h = ([string]$Hex).Trim().TrimStart('#')
    if ($h -notmatch '^[a-fA-F0-9]{6}$') { return '255;255;255' }
    return "$([Convert]::ToInt32($h.Substring(0, 2), 16));$([Convert]::ToInt32($h.Substring(2, 2), 16));$([Convert]::ToInt32($h.Substring(4, 2), 16))"
}

function _Normalise-PaletteIndex {
    param([int]$Index = 0)
    $size = if ($script:TerminalTalkPaletteSize -gt 0) { $script:TerminalTalkPaletteSize } else { 24 }
    $i = $Index % $size
    if ($i -lt 0) { $i += $size }
    return $i
}

function _EmojiFromCodePoint {
    param([int]$CodePoint)
    try {
        return [char]::ConvertFromUtf32($CodePoint)
    } catch {
        return [string][char]0x25CF
    }
}

function _PaletteTitleEmoji {
    param([int]$Index = 0)
    $i = $Index % 8
    if ($i -lt 0) { $i += 8 }
    return _EmojiFromCodePoint $script:TerminalTalkPaletteEmojiCodepoints[$i]
}

function _Clean-TitlePart {
    param([string]$Value)
    if (-not $Value) { return '' }
    return ($Value -replace '[\r\n\t]+', ' ' -replace '\s{2,}', ' ').Trim()
}

function Get-TerminalTalkPaletteHex {
    [CmdletBinding()]
    param([int]$Index = 0)

    $i = _Normalise-PaletteIndex $Index
    return $script:TerminalTalkPaletteHex[$i % 8]
}

function Get-TerminalTalkTitleMarker {
    [CmdletBinding()]
    param([int]$Index = 0)

    $i = _Normalise-PaletteIndex $Index
    $primary = _PaletteTitleEmoji ($i % 8)
    if ($i -lt 8) { return $primary }
    if ($i -lt 16) {
        $partner = _PaletteTitleEmoji $script:TerminalTalkHsplitPartner[$i - 8]
        return "$primary$([char]0x2580)$partner"
    }
    $vpartner = _PaletteTitleEmoji $script:TerminalTalkVsplitPartner[$i - 16]
    return "$primary$([char]0x258C)$vpartner"
}

function Get-TerminalTalkPaletteAnsiGlyph {
    [CmdletBinding()]
    param([int]$Index = 0)

    $i = _Normalise-PaletteIndex $Index
    $ESC = [char]27
    if ($i -lt 8) {
        $rgb = _HexToRgbText $script:TerminalTalkPaletteHex[$i]
        return "${ESC}[38;2;${rgb}m$([char]0x25CF)${ESC}[0m"
    }
    if ($i -lt 16) {
        $p = $i - 8
        $s = $script:TerminalTalkHsplitPartner[$p]
        $fg = _HexToRgbText $script:TerminalTalkPaletteHex[$p]
        $bg = _HexToRgbText $script:TerminalTalkPaletteHex[$s]
        return "${ESC}[38;2;${fg};48;2;${bg}m$([char]0x2580)${ESC}[0m"
    }
    $vp = $i - 16
    $vs = $script:TerminalTalkVsplitPartner[$vp]
    $vfg = _HexToRgbText $script:TerminalTalkPaletteHex[$vp]
    $vbg = _HexToRgbText $script:TerminalTalkPaletteHex[$vs]
    return "${ESC}[38;2;${vfg};48;2;${vbg}m$([char]0x258C)${ESC}[0m"
}

function _Get-EntryValue {
    param(
        [object]$Entry = $null,
        [string]$Name = ''
    )

    if (-not $Entry -or -not $Name) { return $null }
    if ($Entry -is [System.Collections.IDictionary]) {
        if ($Entry.Contains($Name)) { return $Entry[$Name] }
        return $null
    }
    if ($Entry.PSObject.Properties.Name -contains $Name) {
        return $Entry.$Name
    }
    return $null
}

function Get-TerminalTalkIdentityText {
    [CmdletBinding()]
    param(
        [object]$Entry = $null,
        [string]$FallbackLabel = 'Codex'
    )

    $slotNumber = 0
    $index = _Get-EntryValue -Entry $Entry -Name 'index'
    if ($null -ne $index) {
        try { $slotNumber = [int]$index + 1 } catch { $slotNumber = 0 }
    }

    $label = ''
    $entryLabel = _Get-EntryValue -Entry $Entry -Name 'label'
    if ($entryLabel) {
        $label = _Clean-TitlePart ([string]$entryLabel)
    }

    if ($label -match '^TT\s+\d+\s*\((.+)\)$') {
        $parsedLabel = _Clean-TitlePart $Matches[1]
        if ($parsedLabel) { return $parsedLabel }
    }

    if ($label -match '^TT\s+\d+\b') {
        return "Session $($Matches[0] -replace '[^\d]+', '')"
    }

    if ($label) { return $label }
    if ($slotNumber -gt 0) { return "Session $slotNumber" }

    $fallback = _Clean-TitlePart $FallbackLabel
    if ($fallback) { return $fallback }
    return 'Codex'
}

function New-ProvisionalCodexShort {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [int]$CodexPid,
        [Parameter(Mandatory = $true)] [string]$CurrentDir,
        [long]$LaunchMs = 0
    )

    if ($LaunchMs -le 0) {
        $LaunchMs = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    }
    $seed = "codex|$CodexPid|$LaunchMs|$CurrentDir"
    $sha1 = [System.Security.Cryptography.SHA1]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($seed)
        $hash = $sha1.ComputeHash($bytes)
        return ([BitConverter]::ToString($hash).Replace('-', '').ToLowerInvariant()).Substring(0, 8)
    } finally {
        $sha1.Dispose()
    }
}

function Parse-CodexSessionMetaLine {
    [CmdletBinding()]
    param([string]$Line)

    if (-not $Line) { return $null }
    try {
        $parsed = $Line | ConvertFrom-Json -ErrorAction Stop
    } catch {
        return $null
    }
    if (-not $parsed -or $parsed.type -ne 'session_meta' -or -not $parsed.payload) {
        return $null
    }

    $sessionId = [string]$parsed.payload.id
    if (-not $sessionId -or $sessionId.Length -lt 8) { return $null }
    $short = $sessionId.Substring(0, 8).ToLowerInvariant()
    if ($short -notmatch '^[a-f0-9]{8}$') { return $null }

    return [pscustomobject]@{
        session_id = $sessionId.ToLowerInvariant()
        short      = $short
        cwd        = if ($parsed.payload.cwd) { [string]$parsed.payload.cwd } else { '' }
        timestamp  = if ($parsed.payload.timestamp) { [string]$parsed.payload.timestamp } else { '' }
        source     = if ($parsed.payload.source) { [string]$parsed.payload.source } else { '' }
        originator = if ($parsed.payload.originator) { [string]$parsed.payload.originator } else { '' }
    }
}

function Test-CodexTerminalRolloutMeta {
    [CmdletBinding()]
    param([object]$Meta = $null)

    if (-not $Meta) { return $true }
    $source = ''
    $originator = ''
    try { $source = ([string]$Meta.source).ToLowerInvariant() } catch {}
    try { $originator = ([string]$Meta.originator).ToLowerInvariant() } catch {}
    if ($source -eq 'cli' -or $originator -eq 'codex-tui') { return $true }
    if (-not $source -and -not $originator) { return $true }
    return $false
}

function Get-CodexRolloutSessionMeta {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] [string]$Path)

    if (-not (Test-Path $Path)) { return $null }
    try {
        $line = Get-Content -LiteralPath $Path -Encoding utf8 -TotalCount 1
    } catch {
        return $null
    }
    $meta = Parse-CodexSessionMetaLine -Line $line
    if (-not $meta) { return $null }

    try {
        $item = Get-Item -LiteralPath $Path -ErrorAction Stop
    } catch {
        return $null
    }

    return [pscustomobject]@{
        path       = $Path
        session_id = $meta.session_id
        short      = $meta.short
        cwd        = $meta.cwd
        timestamp  = $meta.timestamp
        source     = $meta.source
        originator = $meta.originator
        terminal_source = (Test-CodexTerminalRolloutMeta -Meta $meta)
        mtime_utc  = $item.LastWriteTimeUtc
    }
}

function Select-CodexRolloutCandidate {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [object[]]$Candidates,
        [Parameter(Mandatory = $true)] [string]$TargetCwd,
        [Parameter(Mandatory = $true)] [datetime]$LaunchStartUtc
    )

    if (-not $Candidates -or $Candidates.Count -eq 0) { return $null }

    $normTarget = _Normalize-PathCase $TargetCwd
    $cutoff = $LaunchStartUtc.ToUniversalTime().AddSeconds(-5)
    $filtered = @()

    foreach ($cand in $Candidates) {
        if (-not $cand) { continue }
        if ($cand.PSObject.Properties.Name -contains 'terminal_source' -and $cand.terminal_source -eq $false) { continue }
        $candShort = [string]$cand.short
        if ($candShort -notmatch '^[a-f0-9]{8}$') { continue }

        $candCwd = _Normalize-PathCase ([string]$cand.cwd)
        if ($normTarget -and $candCwd -and $candCwd -ne $normTarget) { continue }

        $mtime = _To-UtcDateTime $cand.mtime_utc
        if ($mtime -lt $cutoff) { continue }

        $filtered += [pscustomobject]@{
            path       = [string]$cand.path
            session_id = [string]$cand.session_id
            short      = $candShort.ToLowerInvariant()
            cwd        = [string]$cand.cwd
            timestamp  = _To-UtcDateTime $cand.timestamp
            source     = if ($cand.PSObject.Properties.Name -contains 'source') { [string]$cand.source } else { '' }
            originator = if ($cand.PSObject.Properties.Name -contains 'originator') { [string]$cand.originator } else { '' }
            terminal_source = $true
            mtime_utc  = $mtime
        }
    }

    if ($filtered.Count -eq 0) { return $null }

    return $filtered |
        Sort-Object `
            @{ Expression = 'mtime_utc'; Descending = $true }, `
            @{ Expression = 'timestamp'; Descending = $true }, `
            @{ Expression = 'path'; Descending = $false } |
        Select-Object -First 1
}

function Format-CodexWindowTitle {
    [CmdletBinding()]
    param(
        [string]$Short = '',
        [object]$Entry = $null,
        [string]$CurrentDir = '',
        [switch]$Attaching
    )

    $identity = Get-TerminalTalkIdentityText -Entry $Entry -FallbackLabel $(if ($Short) { "Codex $Short" } else { 'Codex' })

    $project = ''
    try { $project = Split-Path -Leaf $CurrentDir } catch {}
    if (-not $project) { $project = $CurrentDir }
    $project = _Clean-TitlePart $project

    $marker = ''
    $entryIndex = _Get-EntryValue -Entry $Entry -Name 'index'
    if ($null -ne $entryIndex) {
        try { $marker = Get-TerminalTalkTitleMarker -Index ([int]$entryIndex) } catch {}
    }

    $parts = @()
    if ($marker -and $identity) {
        $parts += "$marker $identity"
    } elseif ($marker) {
        $parts += $marker
    } else {
        $parts += $identity
    }
    if ($Attaching) {
        if ($project) { $parts += $project }
        $parts += 'attaching'
    }

    $title = (($parts | Where-Object { $_ -and $_.ToString().Trim().Length -gt 0 }) -join ' | ')
    if ($title.Length -gt 120) {
        $title = $title.Substring(0, 120)
    }
    return $title
}

Export-ModuleMember -Function `
    New-ProvisionalCodexShort, `
    Get-TerminalTalkIdentityText, `
    Get-TerminalTalkPaletteHex, `
    Get-TerminalTalkTitleMarker, `
    Get-TerminalTalkPaletteAnsiGlyph, `
    Parse-CodexSessionMetaLine, `
    Get-CodexRolloutSessionMeta, `
    Test-CodexTerminalRolloutMeta, `
    Select-CodexRolloutCandidate, `
    Format-CodexWindowTitle
