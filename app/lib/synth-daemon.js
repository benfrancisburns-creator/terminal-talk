'use strict';

// Phase 11 (#35) lifecycle manager for app/synth_daemon.py — the
// long-lived synth dispatcher that lets hook/watcher dispatchers go
// over a socket instead of paying the Python cold-start tax on
// every hook fire.
//
// Cross-platform since 2026-07-13: Unix domain socket on POSIX,
// token-authenticated TCP loopback (TT_HOME/synth-port.json) on
// Windows. Clients: posix_hooks.py (POSIX hooks), synth-dispatch.psm1
// (Windows hooks), lib/synth-client.js (in-app transcript watcher).
//
// Watchdog pattern: spawn the daemon at toolbar boot; on unexpected
// exit, restart after a 2 s backoff. Hard-kill on app quit (on
// Windows that skips the daemon's signal handler — clients treat a
// connect-refused port file as daemon-down and boot atomically
// overwrites it). Every client falls back to per-hook Popen if the
// socket isn't available, so a daemon-down period degrades gracefully —
// audio still gets generated, just at the old per-spawn cost.
//
// Factory pattern matching the rest of app/lib/*-watcher.js: caller
// injects spawn / pythonExe / appDir / getWin / diag.

function createSynthDaemon({
  enabled = true,
  pythonExe,
  appDir,
  spawn,
  getWin,
  diag = () => {},
  restartBackoffMs = 2000,
} = {}) {
  if (!enabled) {
    let logged = false;
    return {
      start() {
        if (logged) return;
        logged = true;
        diag('synth-daemon disabled (POSIX-only feature)');
      },
      stop() {},
      getPid: () => null,
    };
  }
  if (!pythonExe) throw new Error('createSynthDaemon: pythonExe required');
  if (!appDir) throw new Error('createSynthDaemon: appDir required');
  if (typeof spawn !== 'function') throw new Error('createSynthDaemon: spawn required');
  if (typeof getWin !== 'function') throw new Error('createSynthDaemon: getWin required');

  let proc = null;
  let stopping = false;
  const path = require('node:path');
  const scriptPath = path.join(appDir, 'synth_daemon.py');

  function start() {
    if (proc || stopping) return;
    try {
      proc = spawn(pythonExe, ['-u', scriptPath], {
        windowsHide: true,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      proc.stdout.on('data', (b) => {
        const s = b.toString('utf8').trim();
        if (s) diag(`synth-daemon: ${s}`);
      });
      proc.stderr.on('data', (b) => {
        const s = b.toString('utf8').trim();
        if (s) diag(`synth-daemon stderr: ${s}`);
      });
      proc.on('exit', (code, signal) => {
        const dead = proc;
        proc = null;
        diag(`synth-daemon exited code=${code} signal=${signal}`);
        if (stopping) return;
        // Watchdog respawn — but only if the toolbar is still alive.
        // If main is shutting down (will-quit cleared the win), don't
        // respawn into the void.
        setTimeout(() => {
          const win = getWin();
          if (!win || win.isDestroyed()) return;
          if (proc) return;  // someone else (test, manual) restarted in the gap
          if (dead && dead.pid && proc !== dead) start();
          else start();
        }, restartBackoffMs);
      });
      proc.on('error', (e) => {
        diag(`synth-daemon spawn error: ${e && e.message}`);
      });
      diag(`synth-daemon started (pid=${proc.pid})`);
    } catch (e) {
      diag(`synth-daemon failed to start: ${e && e.message}`);
      proc = null;
    }
  }

  function stop() {
    stopping = true;
    if (!proc) return;
    try { proc.kill('SIGTERM'); } catch {}
    // Give it a beat to clean up the socket file before we hard-kill;
    // the daemon's signal handler unlinks SOCKET_PATH on SIGTERM.
    setTimeout(() => {
      if (proc) {
        try { proc.kill('SIGKILL'); } catch {}
      }
    }, 1500);
    proc = null;
  }

  function getPid() { return proc && proc.pid ? proc.pid : null; }

  return { start, stop, getPid };
}

module.exports = { createSynthDaemon };
