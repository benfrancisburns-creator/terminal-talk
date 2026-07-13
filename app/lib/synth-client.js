'use strict';

// Daemon-first synth dispatch for in-app callers (transcript-watcher).
// Mirrors posix_hooks.py:_try_synth_daemon and app/synth-dispatch.psm1:
// fire-and-forget one JSON line, then disconnect — the daemon owns the
// work. Caller falls back to its Popen path when the callback gets
// false, so a down daemon never loses audio.
//
// Transport matches app/synth_daemon.py: Unix socket on POSIX,
// token-authenticated TCP loopback (synth-port.json) on Windows.

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

// Same 200 ms budget as the Python + PowerShell clients: a live daemon
// accepts instantly; anything slower is down/stale and the fallback
// keeps audio working.
const CONNECT_TIMEOUT_MS = 200;

function defaultTtHome() {
  return process.env.TT_HOME || process.env.TT_INSTALL_DIR
    || path.join(os.homedir(), '.terminal-talk');
}

// cb(ok:boolean) — called exactly once. ok=true means the request line
// was handed to the daemon (job accepted); false means "use fallback".
function trySynthDaemon({ sessionId, transcriptPath, mode, elapsedSec = 0, footerPhrase = '', ttHome = defaultTtHome() }, cb) {
  let done = false;
  const finish = (ok) => { if (!done) { done = true; cb(ok); } };
  try {
    const req = {
      session_id: String(sessionId),
      transcript_path: String(transcriptPath),
      mode: String(mode),
      elapsed_sec: elapsedSec | 0,
      footer_phrase: footerPhrase || '',
    };
    let sock;
    if (process.platform === 'win32') {
      const portFile = path.join(ttHome, 'synth-port.json');
      if (!fs.existsSync(portFile)) return finish(false);
      let ep;
      try { ep = JSON.parse(fs.readFileSync(portFile, 'utf8')); } catch { return finish(false); }
      const port = ep && (ep.port | 0);
      if (!port || port < 1 || port > 65535 || !ep.token) return finish(false);
      req.token = String(ep.token);
      sock = net.connect({ host: '127.0.0.1', port });
    } else {
      const sockPath = path.join(ttHome, 'synth.sock');
      if (!fs.existsSync(sockPath)) return finish(false);
      sock = net.connect(sockPath);
    }
    const timer = setTimeout(() => {
      try { sock.destroy(); } catch { /* already gone */ }
      finish(false);
    }, CONNECT_TIMEOUT_MS);
    sock.on('connect', () => {
      clearTimeout(timer);
      try {
        // end() = write + FIN. The daemon reads up to the newline and
        // processes regardless of our disconnect; we never wait for the
        // response (synth can take tens of seconds).
        sock.end(JSON.stringify(req) + '\n');
        finish(true);
      } catch {
        try { sock.destroy(); } catch { /* already gone */ }
        finish(false);
      }
    });
    sock.on('error', () => { clearTimeout(timer); finish(false); });
  } catch {
    finish(false);
  }
}

module.exports = { trySynthDaemon, CONNECT_TIMEOUT_MS };
