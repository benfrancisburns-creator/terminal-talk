# synth-dispatch.psm1 -- Windows-side synth dispatch: toolbar liveness
# gate + long-lived daemon client. Shared by hooks/speak-on-tool.ps1 and
# hooks/speak-response.ps1 (mirrors posix_hooks.py:spawn_synth's
# socket-first-then-Popen shape on POSIX).
#
# Why the gate exists (2026-07-13 incident): with the toolbar closed,
# hooks kept spawning python + edge-tts and writing MP3s nobody could
# ever play -- thousands of queue files and a 90-99C CPU for 10+ min.
# No player => no synthesis. The toolbar exe is the renamed Electron
# binary `terminal-talk.exe` (see terminal-talk.vbs), so liveness is a
# plain process-name check.
#
# Why the daemon client exists: `Start-Process python synth_turn.py`
# pays Python cold-start + module imports on EVERY hook fire. The
# daemon (app/synth_daemon.py) imports once and listens on a TCP
# loopback port advertised in TT_HOME/synth-port.json with a per-boot
# token. Fire-and-forget: we send one JSON line and disconnect; the
# daemon owns the work after that (do NOT wait for the response --
# synth can take tens of seconds and hook timeouts are short).

$script:TtHome = if ($env:TT_HOME) { $env:TT_HOME } else { Join-Path $env:USERPROFILE '.terminal-talk' }

function Test-ToolbarAlive {
    <#
    .SYNOPSIS
    True when the Terminal Talk toolbar (terminal-talk.exe) is running.
    TT_FORCE_TOOLBAR_ALIVE=1 short-circuits for tests / headless use.
    #>
    [CmdletBinding()]
    param()
    if ($env:TT_FORCE_TOOLBAR_ALIVE -eq '1') { return $true }
    return [bool](Get-Process -Name 'terminal-talk' -ErrorAction SilentlyContinue)
}

function Invoke-SynthDaemon {
    <#
    .SYNOPSIS
    Submit a synth job to the long-lived daemon. Returns $true when the
    request line was written (daemon owns the job), $false when the
    daemon is unavailable -- caller falls back to the Popen path.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$SessionId,
        [Parameter(Mandatory)][string]$Transcript,
        [Parameter(Mandatory)][string]$Mode,
        [int]$ElapsedSec = 0,
        [string]$FooterPhrase = ''
    )
    $portFile = Join-Path $script:TtHome 'synth-port.json'
    if (-not (Test-Path $portFile)) { return $false }
    $client = $null
    try {
        $ep = Get-Content $portFile -Raw -Encoding utf8 | ConvertFrom-Json
        $port = [int]$ep.port
        if ($port -lt 1 -or $port -gt 65535 -or -not $ep.token) { return $false }
        $client = New-Object System.Net.Sockets.TcpClient
        # 200 ms connect budget -- same as posix_hooks. A live daemon
        # accepts instantly; anything slower means down/stale port file,
        # and the caller's fallback keeps audio working.
        $async = $client.BeginConnect('127.0.0.1', $port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(200)) { return $false }
        $client.EndConnect($async)
        $req = @{
            session_id      = $SessionId
            transcript_path = $Transcript
            mode            = $Mode
            elapsed_sec     = $ElapsedSec
            footer_phrase   = $FooterPhrase
            token           = [string]$ep.token
        } | ConvertTo-Json -Compress
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($req + "`n")
        $stream = $client.GetStream()
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush()
        return $true
    } catch {
        return $false
    } finally {
        if ($client) { try { $client.Close() } catch {} }
    }
}

Export-ModuleMember -Function Test-ToolbarAlive, Invoke-SynthDaemon
