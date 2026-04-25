'use strict';

// OpenAI 401 auto-unset watcher — extracted from app/main.js 2026-04-25
// (#29 lib-extraction sweep) to bring main.js under the 2000-line cap.
//
// When a real (non-test) TTS call returns HTTP 401, synth_turn.py drops
// `~/.terminal-talk/sessions/openai-invalid.flag`. This watcher polls the
// flag every 3 s; on hit it:
//
//   1. Consumes the flag FIRST (#21 K-1 race fix — narrows the window
//      where a concurrent user-save could be wiped by post-save clear).
//   2. Clears the encrypted key + plaintext sidecar via apiKeyStore.
//   3. Demotes `playback.tts_provider` to `edge` so next turn doesn't
//      re-trigger.
//   4. Notifies the renderer so the Settings panel can auto-expand and
//      reveal the input row.
//
// Factory pattern: caller injects `flagPath`, `apiKeyStore`, `getCFG`,
// `setCFG` (or pass the live CFG ref for in-place mutation),
// `saveConfig`, `getWin`, and `diag`. `fs` defaults to node:fs.

const realFs = require('node:fs');

function createOpenaiInvalidWatcher({
  flagPath,
  apiKeyStore,
  getCFG,          // getter so reassignments to main's CFG are seen here
  saveConfig,
  getWin,
  diag = () => {},
  intervalMs = 3000,
  fs = realFs,
} = {}) {
  if (!flagPath) throw new Error('createOpenaiInvalidWatcher: flagPath required');
  if (!apiKeyStore) throw new Error('createOpenaiInvalidWatcher: apiKeyStore required');
  if (typeof getCFG !== 'function') throw new Error('createOpenaiInvalidWatcher: getCFG required');
  if (typeof saveConfig !== 'function') throw new Error('createOpenaiInvalidWatcher: saveConfig required');
  if (typeof getWin !== 'function') throw new Error('createOpenaiInvalidWatcher: getWin required');

  let timer = null;

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      try {
        if (!fs.existsSync(flagPath)) return;
        diag('openai-invalid.flag detected — clearing key + demoting provider to edge');
        // K-1 (#21): consume flag FIRST.
        try { fs.unlinkSync(flagPath); } catch {}
        // Step 2: wipe the key.
        try { apiKeyStore.set(''); } catch (e) { diag(`apiKeyStore.set('') fail: ${e.message}`); }
        // Step 3: demote provider. Always read fresh — `getCFG()` returns
        // the live ref so a reassignment in main (loadConfig() reload)
        // is reflected here.
        const cfg = getCFG();
        cfg.playback = cfg.playback || {};
        cfg.playback.tts_provider = 'edge';
        try { saveConfig(cfg); } catch (e) { diag(`saveConfig after auto-unset fail: ${e.message}`); }
        // Step 4: notify renderer.
        try {
          const win = getWin();
          if (win && !win.isDestroyed()) {
            win.webContents.send('openai-key-invalid');
          }
        } catch (e) { diag(`notify renderer of openai-key-invalid fail: ${e.message}`); }
      } catch (e) {
        diag(`openai-invalid watcher tick fail: ${e.message}`);
      }
    }, intervalMs);
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return { start, stop };
}

module.exports = { createOpenaiInvalidWatcher };
