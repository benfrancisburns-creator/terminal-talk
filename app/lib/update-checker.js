'use strict';

// Periodic git-fetch update notifier — Phase 8 (v0.7).
//
// Spawns `git -C <repoRoot> fetch origin <branch>` + counts commits the
// remote is ahead of HEAD. If > 0, fires `update-available` IPC with
// the count + the latest commit subject. Quietly no-ops when the
// install isn't a git checkout (DMG / Homebrew users) so the main
// process never sees a transient git error from a non-git tree.
//
// Factory pattern matching the rest of app/lib/*-watcher.js: caller
// injects `spawn`, `getWin`, `diag`, etc. so tests can replace spawn
// with a fake child-process emitter and assert on the IPC payload
// without touching git.
//
// Disable knob: `cfg.update_check_enabled` (default true). Polling
// interval: `cfg.update_check_interval_min` (default 60). Both
// readable via `getCFG()` so a config save reflects on next poll
// without a toolbar restart.

const DEFAULT_INTERVAL_MIN = 60;
const SUBJECT_MAX_LEN = 120;

function createUpdateChecker({
  enabled = true,
  repoRoot,
  branch = 'main',
  spawn,
  getWin,
  getCFG = () => ({}),
  diag = () => {},
  fetchTimeoutMs = 30000,
} = {}) {
  if (!enabled) {
    let logged = false;
    return {
      start() {
        if (logged) return;
        logged = true;
        diag('update-checker disabled by caller');
      },
      stop() {},
      checkNow: () => Promise.resolve(null),
    };
  }
  if (!repoRoot) throw new Error('createUpdateChecker: repoRoot required');
  if (typeof spawn !== 'function') throw new Error('createUpdateChecker: spawn required');
  if (typeof getWin !== 'function') throw new Error('createUpdateChecker: getWin required');

  let timer = null;
  let inFlight = false;
  let lastReportedAhead = 0;

  function spawnGit(args, opts = {}) {
    return new Promise((resolve) => {
      const proc = spawn('git', ['-C', repoRoot, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        ...opts,
      });
      let out = '';
      let err = '';
      const t = setTimeout(() => {
        try { proc.kill(); } catch {}
      }, fetchTimeoutMs);
      proc.stdout.on('data', (b) => { out += b.toString('utf8'); });
      proc.stderr.on('data', (b) => { err += b.toString('utf8'); });
      proc.on('exit', (code) => {
        clearTimeout(t);
        resolve({ code, stdout: out.trim(), stderr: err.trim() });
      });
      proc.on('error', (e) => {
        clearTimeout(t);
        resolve({ code: -1, stdout: '', stderr: String(e && e.message || e) });
      });
    });
  }

  async function checkNow() {
    if (inFlight) return null;
    inFlight = true;
    try {
      // Sanity: confirm this is a git checkout. `git rev-parse --git-dir`
      // exits non-zero when run outside a repo — that's the DMG / brew
      // install case. Return null without firing the IPC.
      const probe = await spawnGit(['rev-parse', '--git-dir']);
      if (probe.code !== 0) {
        diag(`update-checker: not a git checkout (${repoRoot}); checks disabled`);
        return null;
      }
      const fetch = await spawnGit(['fetch', 'origin', branch, '--quiet']);
      if (fetch.code !== 0) {
        diag(`update-checker: git fetch failed (rc=${fetch.code}): ${fetch.stderr.slice(0, 200)}`);
        return null;
      }
      const ahead = await spawnGit(['rev-list', '--count', `HEAD..origin/${branch}`]);
      if (ahead.code !== 0) {
        diag(`update-checker: rev-list failed (rc=${ahead.code}): ${ahead.stderr.slice(0, 200)}`);
        return null;
      }
      const count = parseInt(ahead.stdout || '0', 10);
      if (!Number.isFinite(count) || count < 0) {
        diag(`update-checker: parse-fail rev-list output: ${JSON.stringify(ahead.stdout)}`);
        return null;
      }
      if (count === 0) {
        if (lastReportedAhead !== 0) {
          // Transition: was-ahead → now-up-to-date. Fire a clear so the
          // renderer can drop the badge if the user already pulled.
          const win = getWin();
          if (win && !win.isDestroyed()) {
            try { win.webContents.send('update-available', { count: 0, subject: '' }); } catch {}
          }
        }
        lastReportedAhead = 0;
        diag('update-checker: up-to-date');
        return { count: 0, subject: '' };
      }
      // Get the most recent remote commit's subject for the badge tooltip
      // / settings panel banner. Format: 'log -1 --format=%s'.
      const subjResult = await spawnGit(['log', '-1', '--format=%s', `origin/${branch}`]);
      const subject = (subjResult.code === 0
        ? (subjResult.stdout || '').slice(0, SUBJECT_MAX_LEN)
        : '');
      const win = getWin();
      if (win && !win.isDestroyed()) {
        try { win.webContents.send('update-available', { count, subject }); } catch {}
      }
      lastReportedAhead = count;
      diag(`update-checker: ${count} commit(s) available; latest: ${subject.slice(0, 60)}`);
      return { count, subject };
    } catch (e) {
      diag(`update-checker: unexpected error: ${e && e.message}`);
      return null;
    } finally {
      inFlight = false;
    }
  }

  function intervalMs() {
    const cfg = getCFG() || {};
    const min = Number.isFinite(cfg.update_check_interval_min) && cfg.update_check_interval_min > 0
      ? cfg.update_check_interval_min
      : DEFAULT_INTERVAL_MIN;
    return min * 60 * 1000;
  }

  function isEnabledByConfig() {
    const cfg = getCFG() || {};
    return cfg.update_check_enabled !== false;  // default true
  }

  function start() {
    if (timer) return;
    if (!isEnabledByConfig()) {
      diag('update-checker: disabled via config.update_check_enabled');
      return;
    }
    diag(`update-checker: starting (interval=${intervalMs() / 60000} min, repo=${repoRoot})`);
    // First check after a short delay (15 s) so toolbar boot isn't
    // contending with all the other one-time spawns. After that, the
    // configured interval drives.
    timer = setTimeout(function tick() {
      if (!isEnabledByConfig()) {
        timer = null;
        diag('update-checker: config disabled mid-run; stopping ticks');
        return;
      }
      checkNow().finally(() => {
        timer = setTimeout(tick, intervalMs());
      });
    }, 15000);
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return { start, stop, checkNow };
}

module.exports = { createUpdateChecker };
