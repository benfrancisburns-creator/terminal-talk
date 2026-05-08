'use strict';

// Mic-usage watcher process manager — extracted from app/main.js
// 2026-04-25 (#29 lib-extraction sweep) to bring main.js under the
// 2000-line absolute ceiling.
//
// Spawns app/mic-watcher.ps1 as a long-running child + parses its
// `MIC_CAPTURED <key>` / `MIC_RELEASED` stdout lines, forwarding the
// transitions to the renderer so TTS playback can auto-pause while
// the user dictates to Wispr Flow / Voice Access / VoIP.
//
// Self-restarts on exit (cheap 2 s backoff) unless the main window
// is destroyed.
//
// Factory pattern: caller injects `executable`, `args`, `spawn`,
// `getWin`, `diag`. Test harness can substitute a fake spawn that
// returns a mock process. Generic across platforms — Windows passes
// powershell.exe + a -File invocation; macOS passes python + a -u
// invocation.

function createMicWatcher({
  enabled = true,
  executable,
  args,
  spawn,
  getWin,
  diag = () => {},
  restartBackoffMs = 2000,
  label = 'mic-watcher',
} = {}) {
  if (!enabled) {
    let logged = false;
    return {
      start() {
        if (logged) return;
        logged = true;
        diag(`${label} disabled on this platform`);
      },
      stop() {},
    };
  }
  if (!executable) throw new Error('createMicWatcher: executable required');
  if (!Array.isArray(args)) throw new Error('createMicWatcher: args (array) required');
  if (typeof spawn !== 'function') throw new Error('createMicWatcher: spawn required');
  if (typeof getWin !== 'function') throw new Error('createMicWatcher: getWin required');

  let proc = null;

  function start() {
    if (proc) return;
    try {
      proc = spawn(executable, args, {
        windowsHide: true,
        detached: false,
        stdio: ['ignore', 'pipe', 'ignore']
      });
      let buf = '';
      proc.stdout.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          const win = getWin();
          if (!line || !win || win.isDestroyed()) continue;
          try {
            if (line.startsWith('MIC_CAPTURED')) {
              diag(`${label}: ${line}`);
              win.webContents.send('mic-captured-elsewhere');
            } else if (line.startsWith('MIC_RELEASED')) {
              diag(`${label}: ${line}`);
              win.webContents.send('mic-released');
            } else {
              diag(`${label}(?): ${line}`);  // unexpected protocol line
            }
          } catch {}
        }
      });
      proc.on('exit', (code) => {
        proc = null;
        diag(`${label} exited code=${code}`);
        // Restart unless the app is shutting down.
        setTimeout(() => {
          const win = getWin();
          if (!win || win.isDestroyed()) return;
          start();
        }, restartBackoffMs);
      });
      diag(`${label} started`);
    } catch (e) {
      diag(`${label} failed to start: ${e && e.message}`);
      proc = null;
    }
  }

  function stop() {
    if (!proc) return;
    try { proc.kill(); } catch {}
    proc = null;
  }

  return { start, stop };
}

module.exports = { createMicWatcher };
