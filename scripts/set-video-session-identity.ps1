#requires -Version 5.1
[CmdletBinding()]
param(
  [string]$RegistryPath = "$env:USERPROFILE\.terminal-talk\session-colours.json",
  [int]$ClaudePid,
  [string]$Short,
  [string]$Label,
  [int]$Index = -1,
  [string]$Voice,
  [bool]$Pinned = $true,
  [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'

if (!$ClaudePid -and !$Short) {
  throw 'Pass either -ClaudePid or -Short.'
}

function Read-Registry {
  if (!(Test-Path -LiteralPath $RegistryPath)) {
    return [pscustomobject]@{ assignments = [pscustomobject]@{} }
  }
  $json = Get-Content -LiteralPath $RegistryPath -Raw | ConvertFrom-Json
  if (!$json.assignments) {
    $json | Add-Member -MemberType NoteProperty -Name assignments -Value ([pscustomobject]@{})
  }
  return $json
}

function Find-Assignment($json) {
  foreach ($prop in $json.assignments.PSObject.Properties) {
    if ($Short -and $prop.Name -ieq $Short) { return $prop }
    if ($ClaudePid -and [int]$prop.Value.claude_pid -eq $ClaudePid) { return $prop }
  }
  return $null
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$target = $null
$json = $null
while ((Get-Date) -lt $deadline) {
  $json = Read-Registry
  $target = Find-Assignment $json
  if ($target) { break }
  Start-Sleep -Milliseconds 500
}

if (!$target) {
  $id = if ($ClaudePid) { "pid=$ClaudePid" } else { "short=$Short" }
  throw "No Terminal Talk session found for $id after $TimeoutSeconds seconds."
}

if ($Label) { $target.Value.label = $Label }
if ($Index -ge 0) { $target.Value.index = $Index }
if ($Voice) {
  $target.Value.voice = $Voice
  $target.Value.voice_auto = $false
}
$target.Value.pinned = $Pinned

$tmp = "$RegistryPath.tmp"
$json | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $tmp -Encoding UTF8
Move-Item -LiteralPath $tmp -Destination $RegistryPath -Force

[pscustomobject]@{
  Short = $target.Name
  Pid = $target.Value.claude_pid
  Label = $target.Value.label
  Index = $target.Value.index
  Voice = $target.Value.voice
  Pinned = $target.Value.pinned
}
