# Windows microphone-usage watcher.
#
# Polls the CapabilityAccessManager consent store every ~150 ms to detect
# when any OTHER app starts or stops using the microphone, and emits a
# single line on stdout when the state transitions.
#
# Rationale: Terminal Talk needs to pause TTS playback when a dictation
# tool (Wispr Flow, Windows Voice Access, Windows Speech Recognition,
# VoIP app, etc.) starts recording, and resume when it stops. Chromium's
# built-in audio-focus subsystem doesn't fire for all of these tools in
# Electron, so we detect the mic grab at the OS registry layer instead.
#
# Registry shape:
#   HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\
#   ConsentStore\microphone\[NonPackaged\]<app-key>
#     LastUsedTimeStart  QWORD (FILETIME)
#     LastUsedTimeStop   QWORD (FILETIME)
#   App is "actively using" the mic when Start > Stop.
#
# Protocol (stdout, line-buffered):
#   MIC_CAPTURED <key>
#   MIC_RELEASED
#   (one line per state transition; initial state also emitted at start.)
#
# Parent (main.js) spawns us as a detached child, reads stdout, and fans
# events to the renderer. If we crash or get terminated, main.js restarts
# us. The loop guards against transient registry read failures with a
# silent retry — never fatal.

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

# App paths to ignore — our own wake-word listener (python.exe under the
# installed Terminal Talk tree) should not trigger pause. Match loosely
# against subkey names (which are file paths with `\` replaced by `#`).
$selfPathFragments = @(
    'terminal-talk#app',   # our installed tree
    'python#python.exe'    # generic python.exe used by the wake-word listener
)

$root = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone'

function Test-SelfPath {
    param([string]$KeyName)
    foreach ($f in $selfPathFragments) {
        if ($KeyName -like "*$f*") { return $true }
    }
    return $false
}

function Get-ActiveMicUser {
    # Walk every subkey looking for the one with Start > Stop. Returns
    # the first match's relative path (human-readable), or $null if no
    # non-self app is currently using the mic.
    try {
        $subkeys = Get-ChildItem -Path $root -Recurse -ErrorAction SilentlyContinue
    } catch { return $null }

    foreach ($sk in $subkeys) {
        $start = 0
        $stop  = 0
        try {
            $props = Get-ItemProperty -Path $sk.PSPath -ErrorAction Stop
            if ($null -ne $props.LastUsedTimeStart) { $start = [long]$props.LastUsedTimeStart }
            if ($null -ne $props.LastUsedTimeStop)  { $stop  = [long]$props.LastUsedTimeStop }
        } catch { continue }

        if ($start -le $stop) { continue }
        if (Test-SelfPath -KeyName $sk.PSChildName) { continue }
        return $sk.PSChildName
    }
    return $null
}

$lastState = 'UNKNOWN'

# Emit one line immediately so the parent knows we're alive and the
# current state — avoids a race where main misses the first transition.
$current = Get-ActiveMicUser
if ($current) { Write-Output "MIC_CAPTURED $current"; $lastState = 'CAPTURED' }
else          { Write-Output 'MIC_RELEASED';          $lastState = 'RELEASED' }
[Console]::Out.Flush()

while ($true) {
    Start-Sleep -Milliseconds 150
    $current = Get-ActiveMicUser
    $state = if ($current) { 'CAPTURED' } else { 'RELEASED' }
    if ($state -ne $lastState) {
        if ($state -eq 'CAPTURED') { Write-Output "MIC_CAPTURED $current" }
        else                        { Write-Output 'MIC_RELEASED' }
        [Console]::Out.Flush()
        $lastState = $state
    }
}
