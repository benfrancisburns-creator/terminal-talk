param(
  [string]$SessionId = '',
  [switch]$DryRun,
  [int]$UiDelayMs = 350,
  [int]$WaitForRegistrySeconds = 8,
  [switch]$TrustActiveWindow,
  [switch]$NoRestoreClipboard
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}

$registryPath = if ($env:TT_REGISTRY_PATH) {
  $env:TT_REGISTRY_PATH
} else {
  Join-Path $env:USERPROFILE '.terminal-talk\session-colours.json'
}

$colourNames = @(
  'Red',
  'Orange',
  'Yellow',
  'Green',
  'Blue',
  'Magenta',
  'Brown',
  'White'
)

$colourMarkers = @(
  [char]::ConvertFromUtf32(0x1F534),
  [char]::ConvertFromUtf32(0x1F7E0),
  [char]::ConvertFromUtf32(0x1F7E1),
  [char]::ConvertFromUtf32(0x1F7E2),
  [char]::ConvertFromUtf32(0x1F535),
  [char]::ConvertFromUtf32(0x1F7E3),
  [char]::ConvertFromUtf32(0x1F7E4),
  [char]::ConvertFromUtf32(0x26AA)
)

$hsplitPartner = @(3, 4, 5, 0, 1, 2, 7, 6)
$vsplitPartner = @(4, 5, 6, 7, 0, 1, 2, 3)

function Read-Registry {
  if (!(Test-Path -LiteralPath $registryPath)) {
    throw "Terminal Talk registry not found: $registryPath"
  }
  $raw = [System.IO.File]::ReadAllText($registryPath, [System.Text.Encoding]::UTF8)
  if (!$raw.Trim()) { throw "Terminal Talk registry is empty: $registryPath" }
  return $raw | ConvertFrom-Json
}

function Clean-TitlePart {
  param(
    [AllowNull()][object]$Value,
    [int]$MaxLen = 80
  )
  $text = [string]$Value
  $text = $text -replace '[\r\n\t]+', ' '
  $text = $text -replace '\s{2,}', ' '
  $text = $text.Trim()
  if ($text.Length -gt $MaxLen) { return $text.Substring(0, $MaxLen) }
  return $text
}

function Get-ColourName {
  param([AllowNull()][object]$Index)
  $n = 0
  try { $n = [int][math]::Floor([double]$Index) } catch { $n = 0 }
  if ($n -lt 0) { $n = 0 }
  if ($n -gt 23) { $n = 23 }
  if ($n -lt 8) { return $colourNames[$n] }
  $primary = if ($n -lt 16) { $n - 8 } else { $n - 16 }
  $secondary = if ($n -lt 16) { $hsplitPartner[$primary] } else { $vsplitPartner[$primary] }
  return "$($colourNames[$primary]) / $($colourNames[$secondary])"
}

function Get-ColourMarker {
  param([AllowNull()][object]$Index)
  $n = 0
  try { $n = [int][math]::Floor([double]$Index) } catch { $n = 0 }
  if ($n -lt 0) { $n = 0 }
  if ($n -gt 23) { $n = 23 }
  if ($n -lt 8) { return $colourMarkers[$n] }
  $primary = if ($n -lt 16) { $n - 8 } else { $n - 16 }
  $secondary = if ($n -lt 16) { $hsplitPartner[$primary] } else { $vsplitPartner[$primary] }
  return "$($colourMarkers[$primary])$($colourMarkers[$secondary])"
}

function Build-Title {
  param(
    [string]$ShortId,
    [object]$Entry
  )
  $colour = Get-ColourName $Entry.index
  $marker = Get-ColourMarker $Entry.index
  $label = Clean-TitlePart $Entry.label 60
  if ($label) {
    $identity = "$marker TT $colour"
    $room = [math]::Max(20, 120 - $identity.Length - 3)
    $cleanLabel = Clean-TitlePart $label $room
    $title = "$identity $([char]0x00B7) $cleanLabel"
    if ($title.Length -gt 120) { return $title.Substring(0, 120) }
    return $title
  }

  $persisted = Clean-TitlePart $Entry.codex_desktop_title 120
  if ($persisted) { return $persisted }

  $identity = "$marker TT $colour"
  $label = Clean-TitlePart $Entry.source_window_title 60
  if (!$label) { $label = "Session $([int]$Entry.index + 1)" }
  $room = [math]::Max(20, 120 - $identity.Length - 3)
  $cleanLabel = Clean-TitlePart $label $room
  $title = "$identity $([char]0x00B7) $cleanLabel"
  if ($title.Length -gt 120) { return $title.Substring(0, 120) }
  return $title
}

function Normalize-SessionId {
  param([AllowNull()][object]$Value)
  $text = ([string]$Value).Trim()
  if (!$text) { return '' }

  $uuid = [regex]::Match($text, '(?i)[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}')
  if ($uuid.Success) { return $uuid.Value.ToLowerInvariant() }

  $short = [regex]::Match($text, '(?i)\b[a-f0-9]{8}\b')
  if ($short.Success) { return $short.Value.ToLowerInvariant() }

  return ''
}

function Resolve-RegistryEntry {
  param(
    [string]$Needle
  )
  $normalized = Normalize-SessionId $Needle
  if (!$normalized) { return $null }
  $short = if ($normalized.Length -ge 8) { $normalized.Substring(0, 8) } else { $normalized }

  $deadline = (Get-Date).AddSeconds([math]::Max(0, $WaitForRegistrySeconds))
  do {
    $registry = Read-Registry
    $assignments = $registry.assignments
    if ($assignments) {
      foreach ($prop in $assignments.PSObject.Properties) {
        $key = ([string]$prop.Name).ToLowerInvariant()
        $entry = $prop.Value
        $entrySession = Normalize-SessionId $entry.session_id
        $sourceKind = ([string]$entry.source_kind).ToLowerInvariant()
        $looksDesktop = $sourceKind -eq 'codex-desktop' -or ([string]$entry.source_label) -eq 'Codex Desktop'
        $keyMatches = $key -eq $short
        $sessionMatches = $entrySession -and ($entrySession -eq $normalized -or $entrySession.Substring(0, 8) -eq $short)
        if (($keyMatches -or $sessionMatches) -and $looksDesktop) {
          return [pscustomobject]@{
            ShortId = $key
            Entry = $entry
            Title = Build-Title $key $entry
          }
        }
      }
    }
    if ((Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
  } while ((Get-Date) -lt $deadline)

  return $null
}

function List-CodexDesktopEntries {
  $registry = Read-Registry
  $assignments = $registry.assignments
  if (!$assignments) { return @() }
  $rows = @()
  foreach ($prop in $assignments.PSObject.Properties) {
    $entry = $prop.Value
    $sourceKind = ([string]$entry.source_kind).ToLowerInvariant()
    if ($sourceKind -ne 'codex-desktop' -and ([string]$entry.source_label) -ne 'Codex Desktop') { continue }
    $rows += [pscustomobject]@{
      ShortId = $prop.Name
      Title = Build-Title $prop.Name $entry
      Status = [string]$entry.codex_desktop_title_status
      LastSeen = [string]$entry.last_seen
    }
  }
  return $rows
}

function Get-CodexDesktopWindow {
  $candidates = Get-Process -Name Codex -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -and $_.MainWindowHandle -ne [IntPtr]::Zero } |
    Sort-Object StartTime -Descending
  foreach ($candidate in $candidates) {
    return $candidate
  }
  return $null
}

function Ensure-UiTypes {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class TTCodexDesktopTitleSyncWin {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@
}

function Focus-CodexDesktopWindow {
  Ensure-UiTypes
  $window = Get-CodexDesktopWindow
  if (!$window) {
    throw "No Codex Desktop window is open."
  }

  [TTCodexDesktopTitleSyncWin]::ShowWindowAsync($window.MainWindowHandle, 9) | Out-Null
  Start-Sleep -Milliseconds 100
  [TTCodexDesktopTitleSyncWin]::SetForegroundWindow($window.MainWindowHandle) | Out-Null
  try {
    $shell = New-Object -ComObject WScript.Shell
    $shell.AppActivate([int]$window.Id) | Out-Null
  } catch {}
  Start-Sleep -Milliseconds $UiDelayMs
  return $window
}

function Invoke-CodexShortcut {
  param([string]$Keys)
  [System.Windows.Forms.SendKeys]::SendWait($Keys)
  Start-Sleep -Milliseconds $UiDelayMs
}

if ($DryRun -and !$SessionId) {
  $rows = List-CodexDesktopEntries
  if (!$rows.Count) {
    Write-Host "No Codex Desktop registry rows found in $registryPath"
    exit 0
  }
  $rows | Sort-Object LastSeen -Descending | Format-Table -AutoSize
  exit 0
}

$originalClipboard = $null
$hadClipboard = $false
try {
  $originalClipboard = Get-Clipboard -Raw -ErrorAction Stop
  $hadClipboard = $true
} catch {
  $hadClipboard = $false
}

try {
  $activeSessionId = Normalize-SessionId $SessionId

  if (!$activeSessionId) {
    if ($DryRun) {
      throw "Dry run needs -SessionId, or run -DryRun without -SessionId to list Codex Desktop rows."
    }

    Focus-CodexDesktopWindow | Out-Null
    Invoke-CodexShortcut '^%c'
    $activeSessionId = Normalize-SessionId (Get-Clipboard -Raw -ErrorAction Stop)
    if (!$activeSessionId) {
      throw "Codex Desktop did not copy a session id. Open the target chat and try again."
    }
  } elseif (!$DryRun -and !$TrustActiveWindow) {
    Focus-CodexDesktopWindow | Out-Null
    Invoke-CodexShortcut '^%c'
    $copiedSessionId = Normalize-SessionId (Get-Clipboard -Raw -ErrorAction Stop)
    if (!$copiedSessionId) {
      throw "Codex Desktop did not copy a session id. Open the target chat and try again."
    }
    $requestedShort = $activeSessionId.Substring(0, 8)
    $copiedShort = $copiedSessionId.Substring(0, 8)
    if ($requestedShort -ne $copiedShort) {
      throw "The open Codex Desktop chat is $copiedShort, not $requestedShort. Open the matching chat before syncing."
    }
  }

  $resolved = Resolve-RegistryEntry $activeSessionId
  if (!$resolved) {
    throw "No Codex Desktop Terminal Talk registry row matched session id '$activeSessionId'."
  }

  if ($DryRun) {
    Write-Host "Would rename Codex Desktop session $($resolved.ShortId) to:"
    Write-Host $resolved.Title
    exit 0
  }

  Focus-CodexDesktopWindow | Out-Null
  Set-Clipboard -Value $resolved.Title
  Invoke-CodexShortcut '^%r'
  Invoke-CodexShortcut '^a'
  Invoke-CodexShortcut '^v'
  Invoke-CodexShortcut '{ENTER}'

  Write-Host "Renamed active Codex Desktop chat to: $($resolved.Title)"
} finally {
  if (!$NoRestoreClipboard) {
    try {
      if ($hadClipboard) {
        Set-Clipboard -Value $originalClipboard
      } else {
        Set-Clipboard -Value ''
      }
    } catch {}
  }
}
