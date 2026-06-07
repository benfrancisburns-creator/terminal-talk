'use strict';

function createDictationHotkeyHook({
  enabled = true,
  spawn,
  pythonExe,
  scriptPath,
  accelerator,
  diag = () => {},
  onStart = () => {},
  onStop = () => {},
  restartBackoffMs = 2000,
} = {}) {
  if (!spawn) throw new Error('createDictationHotkeyHook: spawn required');
  let proc = null;
  let restartTimer = null;
  let stopped = false;
  let runId = 0;
  const clearRestart = () => {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
  };

  function start() {
    if (!enabled || !accelerator || !pythonExe || !scriptPath || proc) return;
    stopped = false;
    clearRestart();
    const myRunId = ++runId;
    let buf = '';

    try {
      const child = spawn(pythonExe, ['-u', scriptPath, '--accelerator', accelerator], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      proc = child;
      diag(`dictation-hotkey-hook starting [${accelerator}]`);

      child.stdout.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line === 'DICTATE_HOOK_READY') diag(`dictation-hotkey-hook ready [${accelerator}]`);
          else if (line === 'DICTATE_START') onStart();
          else if (line === 'DICTATE_STOP') onStop();
          else if (line) diag(`dictation-hotkey-hook: ${line}`);
        }
      });
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString('utf8').trim();
        if (text) diag(`dictation-hotkey-hook stderr: ${text.slice(0, 240)}`);
      });
      child.on('error', (e) => {
        diag(`dictation-hotkey-hook failed: ${e && e.message}`);
        if (proc === child) proc = null;
      });
      child.on('exit', (code) => {
        if (proc === child) proc = null;
        diag(`dictation-hotkey-hook exited code=${code}`);
        if (!stopped && myRunId === runId) restartTimer = setTimeout(() => {
          restartTimer = null;
          start();
        }, restartBackoffMs);
      });
    } catch (e) {
      diag(`dictation-hotkey-hook start failed: ${e && e.message}`);
      proc = null;
    }
  }

  function stop() {
    stopped = true;
    runId++;
    clearRestart();
    const child = proc;
    proc = null;
    if (child) try { child.kill(); } catch {}
  }

  return { start, stop };
}

module.exports = { createDictationHotkeyHook };
