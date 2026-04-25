'use strict';

// Phase 1 voice-command file-watcher — extracted from app/main.js
// 2026-04-25 (#29 lib-extraction sweep) to bring main.js under the
// 2000-line absolute ceiling.
//
// Polls `~/.terminal-talk/voice-command.json` (written by
// wake-word-listener.py after a SAPI grammar match) every 50 ms.
// On hit:
//   1. Parse JSON payload + reject malformed.
//   2. Consume (unlink) FIRST — prevents replay if downstream throws.
//   3. Reject stale timestamps (> 5 s old, leftover from crashed listener).
//   4. Reject actions outside the allowlist.
//   5. Treat 'cancel' as intentional no-op (user aborted post-wake).
//   6. Forward to renderer via `voice-command-action` IPC for dispatch.
//
// Factory pattern: caller injects `commandPath`, `allowed` set,
// `getWin`, `diag`. `fs` defaults to node:fs. `staleMs`/`pollMs`
// override the production defaults for tests.

const realFs = require('node:fs');

const DEFAULT_ALLOWED = Object.freeze([
  'play', 'pause', 'resume', 'next', 'back', 'stop', 'cancel',
]);

function createVoiceCommandWatcher({
  commandPath,
  allowed = DEFAULT_ALLOWED,
  getWin,
  diag = () => {},
  staleMs = 5000,
  pollMs = 50,
  fs = realFs,
} = {}) {
  if (!commandPath) throw new Error('createVoiceCommandWatcher: commandPath required');
  if (typeof getWin !== 'function') throw new Error('createVoiceCommandWatcher: getWin required');

  const allowedSet = allowed instanceof Set ? allowed : new Set(allowed);
  let timer = null;

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      try {
        if (!fs.existsSync(commandPath)) return;
        let payload;
        try {
          payload = JSON.parse(fs.readFileSync(commandPath, 'utf8'));
        } catch (e) {
          diag(`voice-command: parse fail: ${e.message}`);
          try { fs.unlinkSync(commandPath); } catch {}
          return;
        }
        // Consume FIRST — prevents replay if anything below throws.
        try { fs.unlinkSync(commandPath); } catch {}

        const ts = Number(payload.timestamp);
        if (!Number.isFinite(ts) || Date.now() - ts > staleMs) {
          diag(`voice-command: stale timestamp ${ts}; ignoring`);
          return;
        }
        const action = String(payload.action || '');
        if (!allowedSet.has(action)) {
          diag(`voice-command: unknown action ${JSON.stringify(action)}; ignoring`);
          return;
        }
        if (action === 'cancel') {
          diag('voice-command: cancel (no-op)');
          return;
        }
        diag(`voice-command: dispatching ${action}`);
        const win = getWin();
        if (win && !win.isDestroyed()) {
          try { win.webContents.send('voice-command-action', action); }
          catch (e) { diag(`voice-command send fail: ${e.message}`); }
        }
      } catch (e) {
        diag(`voice-command watcher tick fail: ${e.message}`);
      }
    }, pollMs);
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return { start, stop };
}

module.exports = { createVoiceCommandWatcher, DEFAULT_ALLOWED };
