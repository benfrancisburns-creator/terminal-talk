'use strict';

function createDictationController(deps = {}) {
  const {
    spawn,
    fs = require('node:fs'),
    path = require('node:path'),
    platform = process.platform,
    powershellExe = 'powershell.exe',
    pythonExe = 'python3',
    appDir,
    installDir,
    getWin = () => null,
    getConfig = () => ({}),
    getApiKey = () => null,
    diag = () => {},
    sendMicCaptured = () => {},
    sendResumePlayback = () => {},
  } = deps;

  const dictationDir = path.join(installDir, 'dictation');
  const hardTimeoutMs = 5 * 60 * 1000;
  let busy = false;
  let childProc = null;
  let releaseProc = null;
  let timer = null;
  let stopFilePath = '';

  function sendStatus(payload) {
    try {
      const win = getWin();
      if (win && !win.isDestroyed()) win.webContents.send('dictation-status', payload);
    } catch {}
  }

  function findScript(name = platform === 'win32' ? 'whisper-dictate.ps1' : 'whisper-dictate.py') {
    const candidates = [
      path.join(appDir, name),
      path.resolve(appDir, '..', 'scripts', name),
    ];
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {}
    }
    return null;
  }

  function timestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  function parseJson(stdout) {
    const lines = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.startsWith('{') || !line.endsWith('}')) continue;
      try { return JSON.parse(line); } catch {}
    }
    return null;
  }

  function firstUsefulLine(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((line) => line.replace(/\r/g, '').trim())
      .find((line) => line && !/^\d+%|\|/.test(line))
      || '';
  }

  function dictationConfig() {
    const cfg = (getConfig() || {}).dictation || {};
    const cleanupEnabled = cfg.cleanup !== false;
    const provider = String(cfg.cleanup_provider || 'local').toLowerCase() === 'openai'
      ? 'openai'
      : 'local';
    const model = String(cfg.cleanup_model || 'gpt-5.4-mini').trim() || 'gpt-5.4-mini';
    const timeout = Math.max(3, Math.min(60, Number(cfg.cleanup_timeout_sec) || 20));
    const keepAudio = cfg.keep_audio === true;
    const saveTiming = cfg.save_timing !== false;
    return {
      cleanup: cleanupEnabled ? (provider === 'openai' ? 'smart' : 'local') : 'off',
      provider,
      model,
      timeout,
      keepAudio,
      saveTiming,
    };
  }

  function finish() {
    if (releaseProc) {
      try { releaseProc.kill(); } catch {}
      releaseProc = null;
    }
    if (stopFilePath) {
      try { fs.unlinkSync(stopFilePath); } catch {}
      stopFilePath = '';
    }
    busy = false;
    childProc = null;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    sendResumePlayback();
  }

  function requestStop(reason = 'external') {
    if (!busy || !stopFilePath) return { ok: false, error: 'Dictation is not waiting for a stop signal.' };
    try {
      fs.writeFileSync(stopFilePath, reason || 'stop', 'ascii');
      diag(`dictation: stop requested reason=${reason}`);
      return { ok: true };
    } catch (e) {
      const error = e && e.message ? e.message : 'Failed to stop dictation.';
      diag(`dictation: stop request failed ${error}`);
      return { ok: false, error };
    }
  }

  function start({
    paste = false,
    source = 'hotkey',
    holdAccelerator = '',
    externalStop = false,
    maxSeconds = 0,
  } = {}) {
    diag(`dictation: requested source=${source} paste=${paste} hold=${!!holdAccelerator} externalStop=${!!externalStop}`);
    if (busy) {
      sendStatus({ state: 'busy' });
      return { ok: false, error: 'Dictation is already running.' };
    }
    const script = findScript();
    if (!script) {
      const error = 'Dictation script is missing.';
      sendStatus({ state: 'error', error });
      return { ok: false, error };
    }

    const releaseScript = platform === 'win32' && holdAccelerator ? findScript('watch-hotkey-release.ps1') : null;
    const holdMode = !!(externalStop || (holdAccelerator && releaseScript));
    if (holdAccelerator && !releaseScript) diag('dictation: release watcher missing; falling back to silence stop');

    busy = true;
    sendStatus({ state: 'recording', paste, source, externalStop: !!externalStop });
    sendMicCaptured();

    let command = powershellExe;
    const args = platform === 'win32'
      ? [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          script,
          '-Record',
          '-Json',
          paste ? '-Paste' : '-Copy',
        ]
      : [
          script,
          '--record',
          '--json',
          paste ? '--paste' : '--copy',
          '--model-dir',
          path.resolve(appDir, '..', '.codex-transcribe-cache'),
        ];
    if (platform !== 'win32') command = pythonExe;
    const cleanupCfg = dictationConfig();
    if (platform === 'win32') {
      args.push(
        '-Cleanup',
        cleanupCfg.cleanup,
        '-CleanupProvider',
        cleanupCfg.provider,
        '-CleanupModel',
        cleanupCfg.model,
        '-CleanupTimeout',
        String(cleanupCfg.timeout),
      );
      if (cleanupCfg.keepAudio) args.push('-KeepWav');
      if (cleanupCfg.saveTiming) args.push('-SaveTiming');
    } else {
      const stamp = timestamp();
      const outPath = path.join(dictationDir, `dictation-${stamp}.txt`);
      args.push(
        '--out',
        outPath,
        '--cleanup',
        cleanupCfg.cleanup,
        '--cleanup-provider',
        cleanupCfg.provider,
        '--cleanup-model',
        cleanupCfg.model,
        '--cleanup-timeout',
        String(cleanupCfg.timeout),
      );
      if (cleanupCfg.keepAudio) args.push('--keep-wav', path.join(dictationDir, `dictation-${stamp}.wav`));
      if (cleanupCfg.saveTiming) args.push('--segments-out', path.join(dictationDir, `dictation-${stamp}.segments.json`));
    }
    if (holdMode) {
      try { fs.mkdirSync(dictationDir, { recursive: true }); } catch {}
      stopFilePath = path.join(dictationDir, `dictation-stop-${Date.now()}-${process.pid}.flag`);
      try { fs.unlinkSync(stopFilePath); } catch {}
      if (platform === 'win32') args.push('-StopFile', stopFilePath, '-NoSilenceStop');
      else args.push('--stop-file', stopFilePath, '--no-silence-stop');
    }
    const boundedMaxSeconds = Math.max(0, Math.min(1200, Number(maxSeconds) || 0));
    if (boundedMaxSeconds > 0) args.push(platform === 'win32' ? '-MaxSeconds' : '--max-seconds', String(boundedMaxSeconds));

    const childEnv = { ...process.env };
    if (cleanupCfg.provider === 'openai' && cleanupCfg.cleanup !== 'off') {
      const apiKey = getApiKey();
      if (apiKey) childEnv.OPENAI_API_KEY = apiKey;
    }

    let stdout = '';
    let stderr = '';
    let sentTranscribing = false;
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
    });
    childProc = child;
    if (holdMode && !externalStop) {
      releaseProc = spawn(powershellExe, [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        releaseScript,
        '-Accelerator',
        holdAccelerator,
        '-StopFile',
        stopFilePath,
        '-TimeoutSeconds',
        String(Math.ceil(hardTimeoutMs / 1000)),
      ], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
      releaseProc.on('exit', () => { releaseProc = null; });
      releaseProc.on('error', (error) => diag(`dictation: release watcher error ${error && error.message}`));
    }
    timer = setTimeout(() => {
      diag('dictation: hard timeout, killing child');
      try { child.kill(); } catch {}
      sendStatus({ state: 'error', error: 'Dictation timed out.' });
      finish();
    }, hardTimeoutMs);

    child.stdout.on('data', (data) => { stdout += String(data); });
    child.stderr.on('data', (data) => {
      const chunk = String(data);
      stderr += chunk;
      if (!sentTranscribing && /Captured\s+\d/i.test(chunk)) {
        sentTranscribing = true;
        sendStatus({ state: 'transcribing', paste });
      }
    });
    child.on('error', (error) => {
      diag(`dictation: spawn error ${error && error.message}`);
      sendStatus({ state: 'error', error: error && error.message ? error.message : 'Dictation failed to start.' });
      finish();
    });
    child.on('exit', (code) => {
      if (!busy || childProc !== child) return;
      const parsed = parseJson(stdout);
      if (code === 0 && parsed && parsed.ok) {
        const text = String(parsed.transcript || '').trim();
        diag(`dictation: complete paste=${!!parsed.pasted} len=${text.length}`);
        sendStatus({
          state: 'done',
          text,
          path: parsed.path || '',
          audioPath: parsed.audio_path || '',
          timingPath: parsed.timing_path || '',
          pasted: !!parsed.pasted,
          enterPressed: !!parsed.enter_pressed,
          copied: parsed.copied !== false,
        });
        finish();
        return;
      }
      const errorText = firstUsefulLine(stderr) || firstUsefulLine(stdout) || `Dictation exited with code ${code}`;
      diag(`dictation: failed code=${code} error=${errorText.slice(0, 240)}`);
      sendStatus({ state: 'error', error: errorText.slice(0, 240) });
      finish();
    });

    return { ok: true };
  }

  function list(limit = 20) {
    try {
      if (!fs.existsSync(dictationDir)) return [];
      return fs.readdirSync(dictationDir)
        .filter((name) => /^dictation-\d{8}-\d{6}\.txt$/i.test(name))
        .map((name) => {
          const full = path.join(dictationDir, name);
          try {
            const stat = fs.statSync(full);
            const text = fs.readFileSync(full, 'utf8').trim();
            const stem = full.replace(/\.txt$/i, '');
            const audioPath = `${stem}.wav`;
            const timingPath = `${stem}.segments.json`;
            return {
              path: full,
              text,
              mtime: stat.mtimeMs,
              audioPath: fs.existsSync(audioPath) ? audioPath : '',
              timingPath: fs.existsSync(timingPath) ? timingPath : '',
            };
          } catch {
            return null;
          }
        })
        .filter((entry) => entry && entry.text)
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, Math.max(1, Math.min(100, Number(limit) || 20)));
    } catch (e) {
      diag(`dictation: list failed ${e && e.message}`);
      return [];
    }
  }

  function isPathInside(target, base) {
    try {
      const resolvedTarget = path.resolve(target);
      const resolvedBase = path.resolve(base);
      return resolvedTarget === resolvedBase ||
             resolvedTarget.startsWith(resolvedBase + path.sep);
    } catch { return false; }
  }

  function remove(filePath) {
    if (!filePath || !isPathInside(filePath, dictationDir)) {
      return { ok: false, error: 'Invalid dictation path.' };
    }
    try {
      const resolved = path.resolve(filePath);
      const stem = resolved.replace(/\.[^.]+$/i, '');
      const candidates = [resolved, `${stem}.wav`, `${stem}.segments.json`];
      for (const candidate of candidates) {
        if (candidate && isPathInside(candidate, dictationDir) && fs.existsSync(candidate)) {
          fs.unlinkSync(candidate);
        }
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : 'Delete failed.' };
    }
  }

  function isBusy() {
    return busy;
  }

  return { start, stop: requestStop, isBusy, list, remove, dictationDir };
}

module.exports = { createDictationController };
