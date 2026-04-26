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

    $slot = 'TT --'
    if ($Entry -and $Entry.PSObject.Properties.Name -contains 'index') {
        try {
            $slot = ('TT {0:00}' -f ([int]$Entry.index + 1))
        } catch {}
    }

    $label = ''
    if ($Entry -and $Entry.PSObject.Properties.Name -contains 'label' -and $Entry.label) {
        $label = [string]$Entry.label
    }
    $label = ($label -replace '[\r\n\t]+', ' ').Trim()
    if (-not $label) { $label = 'Codex' }

    $shortText = ''
    if ($Short -and $Short -match '^[a-f0-9]{8}$') {
        $shortText = $Short.ToLowerInvariant()
    }

    $project = ''
    try { $project = Split-Path -Leaf $CurrentDir } catch {}
    if (-not $project) { $project = $CurrentDir }
    $project = ($project -replace '[\r\n\t]+', ' ').Trim()

    $parts = @($slot, $label)
    if ($Attaching) {
        if ($project) { $parts += $project }
        $parts += 'attaching'
    } elseif ($shortText) {
        $parts += $shortText
    } elseif ($project) {
        $parts += $project
    }

    $title = (($parts | Where-Object { $_ -and $_.ToString().Trim().Length -gt 0 }) -join ' | ')
    if ($title.Length -gt 120) {
        $title = $title.Substring(0, 120)
    }
    return $title
}

Export-ModuleMember -Function `
    New-ProvisionalCodexShort, `
    Parse-CodexSessionMetaLine, `
    Get-CodexRolloutSessionMeta, `
    Select-CodexRolloutCandidate, `
    Format-CodexWindowTitle
