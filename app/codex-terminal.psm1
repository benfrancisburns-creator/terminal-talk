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
        return ([datetime]$Value).ToUniversalTime()
    } catch {
        return [datetime]::MinValue
    }
}

$script:TerminalTalkPaletteHex = @(
    'ff5e5e',
    'ffa726',
    'ffd93d',
    '4ade80',
    '60a5fa',
    'ee2bbd',
    'c97b50',
    'e0e0e0'
)

function _Clean-TitlePart {
    param([string]$Value)
    if (-not $Value) { return '' }
    return ($Value -replace '[\r\n\t]+', ' ' -replace '\s{2,}', ' ').Trim()
}

function Get-TerminalTalkPaletteHex {
    [CmdletBinding()]
    param([int]$Index = 0)

    $i = $Index % 24
    if ($i -lt 0) { $i += 24 }
    return $script:TerminalTalkPaletteHex[$i % 8]
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
    if (-not $label) { $label = _Clean-TitlePart $FallbackLabel }
    if (-not $label) { $label = 'Codex' }

    if ($label -match '^TT\s+\d+\b') {
        return $label
    }

    if ($slotNumber -gt 0) {
        return "TT $slotNumber ($label)"
    }

    return $label
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
    }
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

    $identity = Get-TerminalTalkIdentityText -Entry $Entry -FallbackLabel 'Codex'

    $shortText = ''
    if ($Short -and $Short -match '^[a-f0-9]{8}$') {
        $shortText = $Short.ToLowerInvariant()
    }

    $project = ''
    try { $project = Split-Path -Leaf $CurrentDir } catch {}
    if (-not $project) { $project = $CurrentDir }
    $project = _Clean-TitlePart $project

    $parts = @($identity)
    if ($Attaching) {
        if ($shortText) { $parts += $shortText }
        if ($project) { $parts += $project }
        $parts += 'attaching'
    } elseif ($shortText) {
        $parts += $shortText
        $parts += 'Codex'
    } elseif ($project) {
        $parts += $project
        $parts += 'Codex'
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
    Parse-CodexSessionMetaLine, `
    Get-CodexRolloutSessionMeta, `
    Select-CodexRolloutCandidate, `
    Format-CodexWindowTitle
