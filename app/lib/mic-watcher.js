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
// Factory pattern: caller injects `scriptPath`, `powershellExe`,
// `spawn` (from child_process), `getWin`, `diag`. Test harness can
// substitute a fake spawn that returns a mock process.

function createMicWatcher({
  scriptPath,
  powershellExe,
  spawn,
  getWin,
  diag = () => {},
  restartBackoffMs = 2000,
} = {}) {
  if (!scriptPath) throw new Error('createMicWatcher: scriptPath required');
  if (!powershellExe) throw new Error('createMicWatcher: powershellExe required');
  if (typeof spawn !== 'function') throw new Error('createMicWatcher: spawn required');
  if (typeof getWin !== 'function') throw new Error('createMicWatcher: getWin required');

  let proc = null;

  function start() {
    if (proc) return;
    try {
      proc = spawn(powershellExe, [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
      ], {
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
              diag(`mic-watcher: ${line}`);
              win.webContents.send('mic-captured-elsewhere');
            } else if (line.startsWith('MIC_RELEASED')) {
              diag(`mic-watcher: ${line}`);
              win.webContents.send('mic-released');
            } else {
              diag(`mic-watcher(?): ${line}`);  // unexpected protocol line
            }
          } catch {}
        }
      });
      proc.on('exit', (code) => {
        proc = null;
        diag(`mic-watcher exited code=${code}`);
        // Restart unless the app is shutting down.
        setTimeout(() => {
          const win = getWin();
          if (!win || win.isDestroyed()) return;
          start();
        }, restartBackoffMs);
      });
      diag('mic-watcher started');
    } catch (e) {
      diag(`mic-watcher failed to start: ${e && e.message}`);
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
