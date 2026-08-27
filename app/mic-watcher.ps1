# Windows microphone-usage watcher.
#
# Polls the CapabilityAccessManager consent store every ~150 ms to detect
# when any OTHER app starts or stops using the microphone, and emits a
# single line on stdout when the state transitions.
#
# The per-poll scan uses the .NET Microsoft.Win32.Registry API rather than
# Get-ChildItem -Recurse + Get-ItemProperty: the cmdlet pipeline cost ~17 ms
# per scan (≈5.5% of a core at 150 ms cadence, 24/7), the .NET reads cost
# ~2 ms for the identical result. Same data, ~9x cheaper.
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
# silent retry -- never fatal.

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

# App paths to ignore -- our own wake-word listener (python.exe under the
# installed Terminal Talk tree) should not trigger pause. Match loosely
# against subkey names (which are file paths with `\` replaced by `#`).
$selfPathFragments = @(
    'terminal-talk#app',   # our installed tree
    'python#python.exe',   # generic python.exe used by the wake-word listener
    'pythoncore-*#python.exe' # Windows Store Python path used by the wake-word listener
)
$listenerPathFile = Join-Path $env:USERPROFILE '.terminal-talk\listener-python-path.txt'

function Get-ListenerPathFragment {
    try {
        if (-not (Test-Path -LiteralPath $listenerPathFile)) { return '' }
        $path = (Get-Content -LiteralPath $listenerPathFile -Raw -Encoding utf8).Trim()
        if (-not $path) { return '' }
        return ($path -replace '[\\/]', '#')
    } catch {
        return ''
    }
}

# Relative path under HKCU for the .NET registry API (no `HKCU:` provider
# prefix — that's a PowerShell-provider concept the .NET API doesn't use).
$micRootPath = 'Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone'

function Test-SelfPath {
    param([string]$KeyName, [string]$ListenerFragment)
    if ($ListenerFragment -and $KeyName -like "*$ListenerFragment*") { return $true }
    foreach ($f in $selfPathFragments) {
        if ($KeyName -like "*$f*") { return $true }
    }
    return $false
}

function Test-MicActive {
    # An app key is "actively using" the mic when Start > Stop.
    param($Key)
    $start = [long]($Key.GetValue('LastUsedTimeStart', 0))
    $stop  = [long]($Key.GetValue('LastUsedTimeStop', 0))
    return ($start -gt $stop)
}

function Get-ActiveMicUser {
    # Walk every consent subkey looking for one with Start > Stop. The
    # store has two shapes: packaged apps as direct subkeys (key name =
    # package family name) and desktop apps under a `NonPackaged`
    # container (key name = exe path with `\` replaced by `#`). We read
    # the listener fragment once per scan (not once per subkey) and use
    # the .NET registry API for cheap reads. Returns the first non-self
    # active app's key name, or $null if none.
    $listenerFragment = Get-ListenerPathFragment
    $base = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($micRootPath)
    if ($null -eq $base) { return $null }
    try {
        foreach ($name in $base.GetSubKeyNames()) {
            if ($name -eq 'NonPackaged') {
                $np = $base.OpenSubKey($name)
                if ($null -eq $np) { continue }
                try {
                    foreach ($child in $np.GetSubKeyNames()) {
                        $ck = $np.OpenSubKey($child)
                        if ($null -eq $ck) { continue }
                        try {
                            if ((Test-MicActive $ck) -and -not (Test-SelfPath -KeyName $child -ListenerFragment $listenerFragment)) {
                                return $child
                            }
                        } finally { $ck.Close() }
                    }
                } finally { $np.Close() }
            } else {
                $k = $base.OpenSubKey($name)
                if ($null -eq $k) { continue }
                try {
                    if ((Test-MicActive $k) -and -not (Test-SelfPath -KeyName $name -ListenerFragment $listenerFragment)) {
                        return $name
                    }
                } finally { $k.Close() }
            }
        }
    } finally { $base.Close() }
    return $null
}

$lastState = 'UNKNOWN'

# Emit one line immediately so the parent knows we're alive and the
# current state -- avoids a race where main misses the first transition.
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
