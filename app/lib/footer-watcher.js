'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Footer-audio watcher.
//
// Watches `<sessionsDir>/<short>-working.flag` for deletions. A deletion
// = a Stop hook just fired for that session. After a short delay we
// spawn the UIA scrape via PowerShell to read Claude Code's
// "Worked for Xm Ys" footer line off the Windows Terminal buffer, then
// synthesize an audio clip with the matching natural-English phrase
// and drop it in the queue.
//
// Why this lives in the main app and not the Stop hook:
//
//   The Stop hook process inherits stdio + COM apartment context from
//   Claude Code's CLI parent. UIA AutomationElement.RootElement hangs
//   indefinitely in that context — observed live across inline,
//   subprocess, ShellExecute-detached subprocess, STA, MTA. Same UIA
//   call succeeds when spawned from Terminal Talk's main app process,
//   which has none of that inheritance. So the hook stays simple
//   (clear flag, spawn synth_turn for body audio) and the footer
//   audio is generated out-of-band here.
//
// Latency: we wait ~SCRAPE_DELAY_MS after the flag deletion so Claude
// Code has time to finish printing the footer line. The footer audio
// plays after the body audio because edge-tts mtime is later.

const FLAG_RE = /^([a-f0-9]{8})-working\.flag$/;
const FOOTER_PARSE_RE = /^\s*([A-Za-zÀ-ſ]+)\s+for\s+(?:(\d+)m\s*)?(\d+)s\s*$/;
const SCRAPE_DELAY_MS = 4000;
const SCRAPE_TIMEOUT_MS = 8000;

function humaniseFooterPhrase(footer) {
  if (!footer) return '';
  const m = String(footer).trim().match(FOOTER_PARSE_RE);
  if (!m) return '';
  const verb = m[1];
  const mins = m[2] ? Number(m[2]) : 0;
  const secs = Number(m[3]);
  if (mins === 0) {
    return `${verb} for ${secs} second${secs === 1 ? '' : 's'}`;
  }
  if (secs === 0) {
    return `${verb} for ${mins} minute${mins === 1 ? '' : 's'}`;
  }
  return `${verb} for ${mins} minute${mins === 1 ? '' : 's'} and ${secs} second${secs === 1 ? '' : 's'}`;
}

function timestampFilename() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getMilliseconds(), 3)}`;
}

function createFooterWatcher(opts = {}) {
  const {
    enabled = true,
    sessionsDir,
    queueDir,
    appDir,
    registryPath,
    callEdgeTTS,
    getCFG = () => ({}),
    loadAssignments = () => ({}),
    diag = () => {},
    notifyQueue = () => {},
    scrapeDelayMs = SCRAPE_DELAY_MS,
    scrapeTimeoutMs = SCRAPE_TIMEOUT_MS,
    fsDep = fs,
    spawnDep = spawn,
    nowFn = () => Date.now(),
  } = opts;

  // Mirror the mic-watcher pattern: when the footer-scrape capability
  // is unavailable on this platform (no Windows Terminal UIA host),
  // return a no-op start/stop pair so the caller doesn't have to
  // platform-branch its lifecycle. Without this, the flag-deletion
  // watcher would still run and ENOENT-spam the diag log every ~500 ms
  // attempting to spawn powershell.exe.
  if (!enabled) {
    let logged = false;
    return {
      start() {
        if (logged) return;
        logged = true;
        diag('footer-watcher disabled on this platform');
      },
      stop() {},
    };
  }

  if (!sessionsDir || !queueDir || !appDir || !registryPath) {
    throw new Error('createFooterWatcher: sessionsDir, queueDir, appDir, registryPath are required');
  }

  let watcher = null;
  // Per-session debounce so a flag-write-then-delete doesn't double-
  // schedule. Map<sessionShort, { timer, lastFiredAt }>.
  const pending = new Map();
  // Per-session de-dupe of the last footer we spoke; if the same string
  // shows up again (e.g. user re-runs and Claude Code re-prints the
  // exact same duration) we still allow it because the queue file
  // has a unique timestamp, but we DO suppress within a 30 s window
  // to avoid the same audio firing twice for the same Stop event.
  const recentlySpoken = new Map();
  const RECENT_WINDOW_MS = 30000;

  function _scrape(sessionShort) {
    return new Promise((resolve) => {
      const ps = process.env.SystemRoot
        ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        : 'powershell.exe';
      const script = path.join(appDir, 'scrape-footer.ps1');
      if (!fsDep.existsSync(script)) {
        resolve('');
        return;
      }
      const child = spawnDep(ps, [
        // -STA: UIA AutomationElement.RootElement requires the
        // single-threaded apartment. Without this flag the scrape
        // returns empty silently.
        '-STA',
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', script,
        '-SessionShort', sessionShort,
        '-RegistryPath', registryPath,
      ], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill(); } catch {}
        diag(`footer-watcher: scrape ${sessionShort} timed out after ${scrapeTimeoutMs}ms`);
        resolve('');
      }, scrapeTimeoutMs);
      child.stdout.on('data', (d) => { out += String(d); });
      child.on('error', (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        diag(`footer-watcher: scrape ${sessionShort} spawn error: ${e && e.message}`);
        resolve('');
      });
      child.on('exit', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const phrase = String(out).split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
        resolve(phrase);
      });
    });
  }

  async function _generate(sessionShort, phrase) {
    if (!phrase) {
      diag(`footer-watcher: ${sessionShort} no footer match in terminal`);
      return;
    }
    const recent = recentlySpoken.get(sessionShort);
    if (recent && recent.phrase === phrase && (nowFn() - recent.at) < RECENT_WINDOW_MS) {
      diag(`footer-watcher: ${sessionShort} de-duped duplicate '${phrase}' within ${RECENT_WINDOW_MS}ms`);
      return;
    }
    const spoken = humaniseFooterPhrase(phrase);
    if (!spoken) {
      diag(`footer-watcher: ${sessionShort} could not humanise '${phrase}'`);
      return;
    }
    if (typeof callEdgeTTS !== 'function') {
      diag(`footer-watcher: ${sessionShort} callEdgeTTS missing — cannot synth '${spoken}'`);
      return;
    }
    const cfg = getCFG() || {};
    const voices = cfg.voices || {};
    let edgeVoice = voices.edge_response || voices.edge_clip || 'en-GB-RyanNeural';
    try {
      const entry = (loadAssignments() || {})[sessionShort];
      if (entry && typeof entry.voice === 'string' && entry.voice) {
        edgeVoice = entry.voice;
      }
    } catch {}
    const filename = `${timestampFilename()}-9999-${sessionShort}.mp3`;
    const outPath = path.join(queueDir, filename);
    try {
      await callEdgeTTS(spoken, edgeVoice, outPath);
      // Sidecar txt for the transcript panel.
      try { fsDep.writeFileSync(outPath.replace(/\.mp3$/, '.txt'), spoken, 'utf8'); } catch {}
      diag(`footer-watcher: ${sessionShort} synth ok '${spoken}' → ${filename}`);
      recentlySpoken.set(sessionShort, { phrase, at: nowFn() });
      notifyQueue();
    } catch (e) {
      diag(`footer-watcher: ${sessionShort} synth FAIL: ${e && e.message ? e.message : e}`);
    }
  }

  // Wait for a NEW footer to appear in the terminal buffer.
  // Claude Code prints its footer line some time AFTER the Stop hook
  // fires (usually < 5 s, occasionally up to 15 s for tool-heavy
  // turns). The buffer already has the PREVIOUS turn's footer in
  // scrollback, so a single scrape would grab that. Approach: snapshot
  // the current "last footer" immediately, then poll until the value
  // changes (= Claude Code just printed a new one for THIS turn).
  async function _scrapeForNewFooter(sessionShort, baseline, deadline) {
    while (Date.now() < deadline) {
      const phrase = await _scrape(sessionShort);
      if (phrase && phrase !== baseline) return phrase;
      await new Promise((r) => {
        const t = setTimeout(r, 500);
        if (typeof t.unref === 'function') t.unref();
      });
    }
    return '';
  }

  function _onFlagDeleted(sessionShort) {
    const existing = pending.get(sessionShort);
    if (existing) clearTimeout(existing.timer);
    // Tiny debounce so a fast flag-create-then-delete doesn't
    // double-fire. Then snapshot baseline and poll for change.
    const timer = setTimeout(async () => {
      pending.delete(sessionShort);
      try {
        const baseline = await _scrape(sessionShort);
        diag(`footer-watcher: ${sessionShort} baseline footer='${baseline || '(none)'}'`);
        // 30 s deadline. Most turns print the footer within 5–10 s of
        // the Stop hook firing, but tool-heavy stops can drag past 12 s.
        // Better to wait a little longer and catch the real footer than
        // give up early and have no audio.
        const deadline = Date.now() + Math.max(scrapeDelayMs, 30000);
        const phrase = await _scrapeForNewFooter(sessionShort, baseline, deadline);
        if (!phrase) {
          diag(`footer-watcher: ${sessionShort} no new footer within ${deadline - Date.now() + 12000}ms (Claude Code may not have printed one yet)`);
          return;
        }
        await _generate(sessionShort, phrase);
      } catch (e) {
        diag(`footer-watcher: ${sessionShort} pipeline error: ${e && e.message ? e.message : e}`);
      }
    }, 200);
    if (typeof timer.unref === 'function') timer.unref();
    pending.set(sessionShort, { timer });
  }

  function start() {
    if (watcher) return;
    if (!fsDep.existsSync(sessionsDir)) {
      try { fsDep.mkdirSync(sessionsDir, { recursive: true }); } catch {}
    }
    try {
      watcher = fsDep.watch(sessionsDir, (eventType, filename) => {
        if (!filename) return;
        const m = FLAG_RE.exec(String(filename));
        if (!m) return;
        const sessionShort = m[1].toLowerCase();
        const full = path.join(sessionsDir, filename);
        // 'rename' event fires for both create + delete on Windows.
        // We only care about delete (Stop hook just cleared the flag).
        if (fsDep.existsSync(full)) return;
        diag(`footer-watcher: ${sessionShort} flag deleted, scheduling scrape in ${scrapeDelayMs}ms`);
        _onFlagDeleted(sessionShort);
      });
      watcher.on('error', (e) => diag(`footer-watcher error: ${e && e.message}`));
      diag(`footer-watcher: started (sessionsDir=${sessionsDir})`);
    } catch (e) {
      diag(`footer-watcher: failed to start: ${e && e.message}`);
    }
  }

  function stop() {
    if (watcher) { try { watcher.close(); } catch {} watcher = null; }
    for (const { timer } of pending.values()) { try { clearTimeout(timer); } catch {} }
    pending.clear();
  }

  return { start, stop, _scrape, _generate, _onFlagDeleted };
}

module.exports = { createFooterWatcher };
