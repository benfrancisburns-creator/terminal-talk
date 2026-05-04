param(
  [Parameter(Mandatory = $true)] [string]$CurrentTitle,
  [Parameter(Mandatory = $true)] [string]$NewTitle,
  [int]$WaitForMenuMs = 1500,
  [int]$WaitForEditMs = 1500,
  [int]$WaitForCommitMs = 2000
)

# Live Claude Desktop sidebar rename via Microsoft UI Automation.
#
# Drives the same path a sighted user would take: find the sidebar row by
# its current title, expand its "More options" menu, invoke "Rename", set
# the value via UIA ValuePattern, commit with Enter. No pixel coordinates
# and no SendKeys text injection — the only SendKeys call is the {ENTER}
# to commit, sent immediately after Edit.SetFocus + ValuePattern.SetValue
# so the focus race window is sub-100 ms.
#
# Output: a single JSON object on stdout. ok=true on success, ok=false on
# failure with `error` populated. Exit code mirrors success.

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}

function Emit-Result($ok, $extras = @{}) {
  $obj = [ordered]@{ ok = [bool]$ok }
  foreach ($k in $extras.Keys) { $obj[$k] = $extras[$k] }
  $json = ($obj | ConvertTo-Json -Compress)
  Write-Output $json
  if ($ok) { exit 0 } else { exit 1 }
}

try {
  Add-Type -AssemblyName UIAutomationClient | Out-Null
  Add-Type -AssemblyName UIAutomationTypes | Out-Null
  Add-Type -AssemblyName System.Windows.Forms | Out-Null
} catch {
  Emit-Result $false @{ error = "UI Automation assemblies unavailable: $($_.Exception.Message)" }
}

$auto = [System.Windows.Automation.AutomationElement]
$expandPatternId = [System.Windows.Automation.ExpandCollapsePattern]::Pattern
$invokePatternId = [System.Windows.Automation.InvokePattern]::Pattern
$valuePatternId = [System.Windows.Automation.ValuePattern]::Pattern
$scrollItemPatternId = [System.Windows.Automation.ScrollItemPattern]::Pattern

# --- locate Claude Desktop main window ---
$claudeProcs = @(Get-Process -Name Claude -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -and $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle } |
  Sort-Object StartTime -Descending)
if (-not $claudeProcs) {
  Emit-Result $false @{ error = "Claude Desktop is not running with a visible window." }
}
$root = $auto::FromHandle($claudeProcs[0].MainWindowHandle)
if (-not $root) {
  Emit-Result $false @{ error = "Could not bind to the Claude Desktop window." }
}

# --- find the row's More-options Button by Name ---
# Sidebar rows expose the More-options trigger as a Button named
# "More options for <title>". Match by Button + exact Name; if no exact
# match, try a couple of common Terminal Talk-style prefix variants.
function Find-MoreButton($wantedTitle) {
  $name = "More options for $wantedTitle"
  $cond = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty, $name)),
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Button))
  )
  return $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
}

$btn = Find-MoreButton $CurrentTitle
if (-not $btn) {
  # Dump candidate row names so the caller / log shows what's actually in
  # the sidebar — invaluable for diagnosing disk/renderer drift.
  $allMore = @($root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Button))))
  $candidates = @($allMore | ForEach-Object { [string]$_.Current.Name } |
    Where-Object { $_ -like 'More options for *' } |
    ForEach-Object { $_ -replace '^More options for ', '' })
  Emit-Result $false @{
    error = "Could not find a sidebar row titled '$CurrentTitle'. Make sure the row is visible in the Recents list."
    currentTitle = $CurrentTitle
    candidates = $candidates
  }
}

# Scroll into view if offscreen — defensive, harmless if already visible.
$scroll = $null
if ($btn.TryGetCurrentPattern($scrollItemPatternId, [ref]$scroll)) {
  try { $scroll.ScrollIntoView() } catch {}
}

if ($btn.Current.IsOffscreen) {
  Emit-Result $false @{ error = "Sidebar row '$CurrentTitle' is offscreen even after scroll." }
}

# --- expand the menu ---
$expand = $null
if (-not $btn.TryGetCurrentPattern($expandPatternId, [ref]$expand)) {
  Emit-Result $false @{ error = "More-options Button does not expose ExpandCollapsePattern." }
}
if ($expand.Current.ExpandCollapseState -ne [System.Windows.Automation.ExpandCollapseState]::Expanded) {
  try { $expand.Expand() } catch {
    Emit-Result $false @{ error = "Failed to expand More-options menu: $($_.Exception.Message)" }
  }
}

# --- wait for the popup Menu ---
$menuCond = New-Object System.Windows.Automation.AndCondition(
  (New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty, "More options for $CurrentTitle")),
  (New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Menu))
)
$deadline = [DateTime]::UtcNow.AddMilliseconds([math]::Max(100, $WaitForMenuMs))
$menu = $null
do {
  $menu = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $menuCond)
  if ($menu) { break }
  Start-Sleep -Milliseconds 50
} while ([DateTime]::UtcNow -lt $deadline)
if (-not $menu) {
  # Best-effort cleanup: collapse the trigger so the row doesn't stay stuck open.
  try { $expand.Collapse() } catch {}
  Emit-Result $false @{ error = "More-options popup did not appear within ${WaitForMenuMs}ms." }
}

# --- find Rename menu item ---
$miCond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::MenuItem)
$items = @($menu.FindAll([System.Windows.Automation.TreeScope]::Descendants, $miCond))
$rename = $items | Where-Object { $_.Current.Name -like 'Rename*' } | Select-Object -First 1
if (-not $rename) {
  try { $expand.Collapse() } catch {}
  Emit-Result $false @{ error = "Rename menu item not found in the popup." }
}

$invoke = $null
if (-not $rename.TryGetCurrentPattern($invokePatternId, [ref]$invoke)) {
  try { $expand.Collapse() } catch {}
  Emit-Result $false @{ error = "Rename MenuItem does not expose InvokePattern." }
}
try { $invoke.Invoke() } catch {
  Emit-Result $false @{ error = "Failed to invoke Rename: $($_.Exception.Message)" }
}

# --- wait for the rename Edit control ---
$editCond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Edit)
$deadline = [DateTime]::UtcNow.AddMilliseconds([math]::Max(100, $WaitForEditMs))
$edit = $null
do {
  $edits = @($root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCond))
  # Prefer an Edit whose current value matches the title — this is the
  # rename input pre-populated by Claude Desktop.
  $edit = $edits | Where-Object {
    $vp = $null
    $_.TryGetCurrentPattern($valuePatternId, [ref]$vp) | Out-Null
    $vp -and $vp.Current.Value -eq $CurrentTitle
  } | Select-Object -First 1
  if (-not $edit -and $edits.Count -gt 0) { $edit = $edits[0] }
  if ($edit) { break }
  Start-Sleep -Milliseconds 50
} while ([DateTime]::UtcNow -lt $deadline)
if (-not $edit) {
  Emit-Result $false @{ error = "Rename edit control did not appear within ${WaitForEditMs}ms." }
}

# --- set value + commit ---
$valuePattern = $null
if (-not $edit.TryGetCurrentPattern($valuePatternId, [ref]$valuePattern)) {
  Emit-Result $false @{ error = "Rename edit control has no ValuePattern." }
}
if ($valuePattern.Current.IsReadOnly) {
  Emit-Result $false @{ error = "Rename edit control is read-only." }
}

try { $edit.SetFocus() } catch {}
try { $valuePattern.SetValue($NewTitle) } catch {
  Emit-Result $false @{ error = "Failed to set new title: $($_.Exception.Message)" }
}
# Tight burst — Enter goes to whichever control has keyboard focus, and
# the Edit just got SetFocus + SetValue, so it's the active one. Adding a
# sleep here would only widen the window for focus theft.
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')

# --- confirm: edit control disappears AND a Button matching the new
# title appears in the sidebar.
$deadline = [DateTime]::UtcNow.AddMilliseconds([math]::Max(100, $WaitForCommitMs))
$confirmed = $false
do {
  Start-Sleep -Milliseconds 100
  $allButtons = @()
  try {
    $allButtons = @($root.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Button))))
  } catch {}
  $hit = $allButtons | Where-Object {
    $n = [string]$_.Current.Name
    $n -eq $NewTitle -or $n.EndsWith(" $NewTitle") -or $n -like "*$NewTitle"
  } | Select-Object -First 1
  if ($hit) { $confirmed = $true; break }
} while ([DateTime]::UtcNow -lt $deadline)

if (-not $confirmed) {
  Emit-Result $false @{
    error = "Rename did not appear in the sidebar within ${WaitForCommitMs}ms. The Edit may not have committed."
    newTitle = $NewTitle
  }
}

Emit-Result $true @{
  applied = $NewTitle
  previous = $CurrentTitle
}
