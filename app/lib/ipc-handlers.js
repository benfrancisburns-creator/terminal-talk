'use strict';

const { createDedupe } = require('./renderer-error-dedupe');

// EX6f — extracted from app/main.js as part of the v0.4 big-file
// refactor. Consolidates the ipcMain.handle() registrations from
// main.js into a single factory the orchestrator calls once.
//
// Design: all Electron and main-process state is injected via deps.
// Live module-scope refs (win, CFG, isApplyingDock) arrive as
// getters/setters because they're reassigned after boot. Pure
// helpers (loadAssignments, notifyQueue, diag) come through by
// reference.
//
// Growing shape: each commit in the EX6f series migrates one group
// of handlers into this factory (read-only -> session-edit
// mutations -> panel/clickthrough -> delete/hide/test). Handler
// behaviour is preserved byte-for-byte from the main.js originals.

function createIpcHandlers(deps) {
  const {
    ipcMain,
    // Read-side deps (EX6f-1)
    diag,
    // Heartbeat (HB1): main-side edge-tts spawner. Injected so the
    // handler can synthesise a spinner verb to an ephemeral T-prefixed
    // clip without duplicating the callEdgeTTS promise plumbing.
    callEdgeTTS,
    getCFG,
    loadAssignments,
    getQueueFiles,
    ensureAssignmentsForFiles,
    isPidAlive,
    computeStaleSessions,
    SESSIONS_DIR,
    rendererErrorDedupe = createDedupe(),
    fs = require('node:fs'),
    path = require('node:path'),
    // Session-edit deps (EX6f-2)
    getWin,
    saveAssignments,
    notifyQueue,
    allowMutation,
    validShort,
    validVoice,
    sanitiseLabel,
    ALLOWED_INCLUDE_KEYS,
    // Panel / config-mutation deps (EX6f-3)
    setCFG,
    saveConfig,
    apiKeyStore,
    redactForLog,
    setApplyingDock,
    testMode = !!process.env.TT_TEST_MODE,
    // File + test-only deps (EX6f-4)
    QUEUE_DIR,
    isPathInside,
    getWatchdog,
    getWatchdogIntervalMs,
    // UX latch (post-v0.4): clicking × on the toolbar hides-and-remembers
    // so passive arrivals don't undo the user's explicit hide.
    setUserHidden = () => {},
  } = deps;

  const WIN_COLLAPSED = { width: 680, height: 114 };
  const WIN_EXPANDED = { width: 680, height: 618 };

  function register() {
    // S1.2 — renderer-side error sink with dedupe so repeated throws
    // in renderer.js don't flood the diag log. The main process has
    // its own unhandledRejection / uncaughtException handlers; this
    // covers the renderer side via window.onerror +
    // window.onunhandledrejection wired in renderer.js.
    ipcMain.handle('log-renderer-error', (_e, payload) => {
      try {
        if (!payload || typeof payload !== 'object') return;
        const type = String(payload.type || 'error').slice(0, 32);
        const message = String(payload.message || '').slice(0, 500);
        const stack = String(payload.stack || '').slice(0, 2000);
        const source = String(payload.source || '').slice(0, 300);
        if (!rendererErrorDedupe.accept(stack || message, Date.now())) return;
        diag(`[renderer-${type}] ${message}${source ? ` @ ${source}` : ''}${stack ? `\n${stack}` : ''}`);
      } catch {}
    });

    ipcMain.handle('get-queue', () => {
      const files = getQueueFiles();
      return { files, assignments: ensureAssignmentsForFiles(files) };
    });

    ipcMain.handle('get-assignments', () => loadAssignments());

    // Stale-session detection: returns shortIds whose backing terminal
    // is gone. Renderer polls every 10 s and greys out the row + its
    // dots. We do NOT prune the registry here — pruning is still gated
    // by the 4-hour grace in ensureAssignmentsForFiles so the user can
    // reopen a terminal and get the same swatch back. Visual signal only.
    ipcMain.handle('get-stale-sessions', () => {
      try {
        const assignments = loadAssignments();
        const liveShorts = new Set();
        const livePids = new Set();
        if (fs.existsSync(SESSIONS_DIR)) {
          for (const f of fs.readdirSync(SESSIONS_DIR)) {
            if (!f.endsWith('.json')) continue;
            const pid = parseInt(f.replace('.json', ''), 10);
            if (!pid || !isPidAlive(pid)) continue;
            livePids.add(pid);
            try {
              let raw = fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8');
              if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
              const data = JSON.parse(raw);
              if (data && typeof data.short === 'string') {
                liveShorts.add(data.short.toLowerCase());
              }
            } catch {}
          }
        }
        return computeStaleSessions(
          assignments, liveShorts, livePids,
          Math.floor(Date.now() / 1000),
          10
        );
      } catch (e) {
        diag(`get-stale-sessions fail: ${e.message}`);
        return [];
      }
    });

    // Live-ref getter: CFG is reassigned by update-config, so we can't
    // close over the initial value.
    ipcMain.handle('get-config', () => getCFG());

    // EX6f-2 — session-edit mutation handlers. All follow the same
    // shape: rate-limit gate -> validate shortId -> load registry ->
    // mutate entry -> persist. set-session-focus / remove-session /
    // set-session-muted additionally notify the renderer so other
    // open views stay in sync.
    ipcMain.handle('set-session-label', (_e, shortId, label) => {
      if (!allowMutation('set-session-label')) return null;
      if (!validShort(shortId)) return false;
      const all = loadAssignments();
      if (!all[shortId]) return false;
      all[shortId].label = sanitiseLabel(label);
      return saveAssignments(all);
    });

    ipcMain.handle('set-session-index', (_e, shortId, newIndex) => {
      if (!allowMutation('set-session-index')) return null;
      if (!validShort(shortId)) return false;
      const all = loadAssignments();
      if (!all[shortId]) return false;
      const n = Number(newIndex);
      if (!Number.isFinite(n)) return false;
      // Palette is 24 arrangements (0-23). Previously clamped to 31 (a leftover
      // from when the palette was 32 wide) — that let set-session-index accept
      // an invalid idx that sanitiseEntry would later reject, causing a
      // silent mismatch between the UI state and persisted registry.
      all[shortId].index = Math.max(0, Math.min(23, Math.floor(n)));
      all[shortId].pinned = true;
      return saveAssignments(all);
    });

    // Exclusive focus flag — only one session can be focus at a time.
    // Setting focus on a session clears it on all others. Focus-mode
    // playback: when this session has unplayed clips, they jump ahead
    // of other sessions' clips in the playback queue (but never
    // interrupt the currently-playing clip).
    ipcMain.handle('set-session-focus', (_e, shortId, focus) => {
      if (!allowMutation('set-session-focus')) return null;
      if (!validShort(shortId)) return false;
      if (typeof focus !== 'boolean') return false;
      const all = loadAssignments();
      if (!all[shortId]) return false;
      if (focus) {
        for (const key of Object.keys(all)) {
          if (key !== shortId && all[key].focus) all[key].focus = false;
        }
      }
      all[shortId].focus = focus;
      const ok = saveAssignments(all);
      const win = getWin();
      if (ok && win && !win.isDestroyed()) notifyQueue();
      return ok;
    });

    // Explicit remove: user clicked × on a Sessions row. We drop the
    // assignment from the registry; if the terminal is still alive the
    // session will get re-registered on its next hook fire.
    ipcMain.handle('remove-session', (_e, shortId) => {
      if (!allowMutation('remove-session')) return null;
      if (!validShort(shortId)) return false;
      const all = loadAssignments();
      if (!all[shortId]) return false;
      delete all[shortId];
      const ok = saveAssignments(all);
      if (ok) notifyQueue();
      return ok;
    });

    ipcMain.handle('set-session-muted', (_e, shortId, muted) => {
      if (!allowMutation('set-session-muted')) return null;
      if (!validShort(shortId)) return false;
      if (typeof muted !== 'boolean') return false;
      const all = loadAssignments();
      if (!all[shortId]) return false;
      all[shortId].muted = muted;
      const ok = saveAssignments(all);
      const win = getWin();
      if (ok && win && !win.isDestroyed()) notifyQueue();
      return ok;
    });

    // Per-session voice override. voiceId=null/empty clears (follow global).
    ipcMain.handle('set-session-voice', (_e, shortId, voiceId) => {
      if (!allowMutation('set-session-voice')) return null;
      if (!validShort(shortId)) return false;
      const all = loadAssignments();
      if (!all[shortId]) return false;
      if (!voiceId) {
        if (all[shortId].voice) delete all[shortId].voice;
      } else {
        if (!validVoice(voiceId)) return false;
        all[shortId].voice = voiceId;
      }
      return saveAssignments(all);
    });

    // Per-session speech-includes override. value=true forces on,
    // false forces off, null/undefined clears (follow global default).
    ipcMain.handle('set-session-include', (_e, shortId, key, value) => {
      if (!allowMutation('set-session-include')) return null;
      if (!validShort(shortId)) return false;
      if (!ALLOWED_INCLUDE_KEYS.has(key)) return false;
      if (value !== true && value !== false && value !== null && value !== undefined) return false;
      const all = loadAssignments();
      if (!all[shortId]) return false;
      if (!all[shortId].speech_includes) all[shortId].speech_includes = {};
      if (value === null || value === undefined) {
        delete all[shortId].speech_includes[key];
      } else {
        all[shortId].speech_includes[key] = value;
      }
      if (Object.keys(all[shortId].speech_includes).length === 0) {
        delete all[shortId].speech_includes;
      }
      return saveAssignments(all);
    });

    // EX6f-3 — panel + config-mutation handlers.

    // EX3 — Settings panel "Reload toolbar" button fires this; hits the
    // same reload() as the Ctrl+R keyboard shortcut. No-op if the
    // window has been destroyed mid-quit.
    ipcMain.handle('reload-renderer', () => {
      const win = getWin();
      if (win && !win.isDestroyed()) win.webContents.reload();
    });

    // Config mutation — merges shallow sub-objects and routes
    // openai_api_key through the encrypted key store so config.json
    // never persists the plaintext secret.
    ipcMain.handle('update-config', (_e, partial) => {
      if (!allowMutation('update-config')) return null;
      try {
        diag(`update-config IN: ${JSON.stringify(redactForLog(partial))}`);
        if (partial.openai_api_key !== undefined) {
          apiKeyStore.set(partial.openai_api_key);
        }
        const cur = getCFG();
        const merged = {
          voices: { ...cur.voices, ...(partial.voices || {}) },
          hotkeys: { ...cur.hotkeys, ...(partial.hotkeys || {}) },
          playback: { ...cur.playback, ...(partial.playback || {}) },
          speech_includes: { ...cur.speech_includes, ...(partial.speech_includes || {}) },
          openai_api_key: null,
        };
        const ok = saveConfig(merged);
        setCFG(merged);
        diag(`update-config OK: saved=${ok}, edge_response=${merged.voices.edge_response}`);
        return merged;
      } catch (e) { diag(`update-config fail: ${e.message}`); return null; }
    });

    // When the toolbar collapses to its slim idle state, the window area
    // below the visible strip is transparent but still covered by the
    // BrowserWindow. forward:true lets the renderer keep receiving
    // mousemove events (so it can re-expand on hover) while clicks pass
    // through to whatever's below.
    //
    // In TT_TEST_MODE we deliberately no-op this. Playwright's synthetic
    // mouse events arrive faster than the mousemove->IPC->setIgnoreMouseEvents
    // round-trip can settle, so the test's click can race with
    // click-through being on and get passed through to nothing. Keeping
    // the window fully interactive in tests gives deterministic clicks
    // without changing any other logic under test.
    ipcMain.handle('set-clickthrough', (_e, on) => {
      const win = getWin();
      if (!win || win.isDestroyed()) return false;
      if (testMode) return true;
      win.setIgnoreMouseEvents(!!on, { forward: true });
      return true;
    });

    ipcMain.handle('set-panel-open', (_e, open) => {
      const win = getWin();
      if (!win || win.isDestroyed()) return false;
      const dim = open ? WIN_EXPANDED : WIN_COLLAPSED;
      // If the bar is docked to the bottom edge, keep its bottom edge
      // pinned while the panel opens/closes — otherwise opening the
      // panel would push it off the bottom (panel grows downward from
      // the bar's y). setBounds with adjusted y makes it grow upward.
      const cfg = getCFG();
      const dock = cfg.window && cfg.window.dock;
      if (dock === 'bottom') {
        const [curX, curY] = win.getPosition();
        const [, curH] = win.getSize();
        const newY = curY + (curH - dim.height);
        setApplyingDock(true);
        win.setBounds({ x: curX, y: newY, width: dim.width, height: dim.height });
        setTimeout(() => { setApplyingDock(false); }, 300);
      } else {
        win.setSize(dim.width, dim.height, true);
      }
      return true;
    });

    // EX6f-4 — file + window + test-only handlers.

    // Rate-limited + path-traversal-guarded delete. Both checks matter:
    // a compromised renderer can forge file paths; isPathInside uses
    // path.resolve to block ..-segment escapes that startsWith alone
    // would let through.
    ipcMain.handle('delete-file', (_e, filePath) => {
      if (!allowMutation('delete-file')) return null;
      try {
        if (typeof filePath !== 'string' || filePath.length > 4096) return false;
        if (!isPathInside(filePath, QUEUE_DIR)) return false;
        fs.unlinkSync(path.resolve(filePath));
        return true;
      } catch {}
      return false;
    });

    // HB2 — list session shorts currently marked "working" via the
    // per-session flag files written by the UserPromptSubmit hook and
    // cleared by the Stop hook. Heartbeat timer uses this instead of
    // the old `last_seen` proxy (which stayed fresh for minutes after
    // a response ended, making heartbeat fire when the user was idle).
    // Flag files are named `<sessionShort>-working.flag` in SESSIONS_DIR.
    // Stale flags (older than 10 min — user killed Claude Code
    // mid-response) are filtered here so callers never see them.
    ipcMain.handle('get-working-sessions', () => {
      try {
        if (!SESSIONS_DIR || !fs.existsSync(SESSIONS_DIR)) return [];
        const now = Math.floor(Date.now() / 1000);
        const STALE_SEC = 600;
        const out = [];
        for (const name of fs.readdirSync(SESSIONS_DIR)) {
          const m = /^([a-f0-9]{8})-working\.flag$/.exec(name);
          if (!m) continue;
          const full = path.join(SESSIONS_DIR, name);
          try {
            const content = fs.readFileSync(full, 'utf8').trim();
            const ts = Number(content) || 0;
            if (ts && now - ts <= STALE_SEC) {
              out.push(m[1]);
            }
          } catch {}
        }
        return out;
      } catch { return []; }
    });

    // HB1 — heartbeat verb. Renderer fires this when it detects
    // Claude Code is actively working but the queue has been silent
    // for a while (no playback, no pending clips). Emits one short
    // ephemeral clip (T- prefix, auto-deletes on play-end) so the
    // listener gets audible confirmation the session is alive, matching
    // the mascot's visible spinner-word behaviour.
    //
    // Security: both arguments validated strictly — verb must be pure
    // letters (cross-references the SPINNER_VERBS whitelist in
    // renderer.js without importing it here), session-short must match
    // the canonical 8-hex pattern. A compromised renderer can't pipe
    // shell metachars through the edge-tts stdin path.
    let heartbeatInFlight = false;
    ipcMain.handle('speak-heartbeat', async (_e, verb, sessionShort) => {
      if (heartbeatInFlight) return false;
      if (typeof verb !== 'string' || !/^[A-Za-z]{2,30}$/.test(verb)) return false;
      if (typeof sessionShort !== 'string' || !/^[a-f0-9]{8}$/.test(sessionShort)) return false;
      if (typeof callEdgeTTS !== 'function') return false;
      const cfg = getCFG();
      if (cfg && cfg.heartbeat_enabled === false) return false;
      heartbeatInFlight = true;
      try {
        const voice = (cfg && cfg.voices && cfg.voices.edge_response) || 'en-GB-RyanNeural';
        const d = new Date();
        const pad = (n, w = 2) => String(n).padStart(w, '0');
        const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${pad(d.getMilliseconds(), 3)}`;
        const filename = `${ts}-T-0001-${sessionShort}.mp3`;
        const outPath = path.join(QUEUE_DIR, filename);
        await callEdgeTTS(verb, voice, outPath);
        diag(`heartbeat: "${verb}" → ${filename}`);
        if (typeof notifyQueue === 'function') notifyQueue();
        return true;
      } catch (e) {
        diag(`heartbeat: FAIL ${e && e.message ? e.message : e}`);
        return false;
      } finally {
        heartbeatInFlight = false;
      }
    });

    ipcMain.handle('hide-window', () => {
      const win = getWin();
      if (win) {
        // Sticky latch: clicking × is an explicit hide, same as Ctrl+Shift+A.
        // Passive clip arrivals won't auto-resurface until the user shows
        // the toolbar again (Ctrl+Shift+A, hey-jarvis, or a fresh launch).
        setUserHidden(true);
        win.hide();
      }
    });

    // S4.1 — test-only inspection IPC. Exposes internal state the E2E
    // harness can assert against instead of grepping main.js source.
    // Guarded by testMode so production builds don't leak internal
    // state to a compromised renderer. Watchdog is the first of many;
    // nav-guard and CSP probes can follow the same pattern.
    if (testMode && typeof getWatchdog === 'function') {
      ipcMain.handle('__test__/watchdog-state', () => {
        const wd = getWatchdog();
        const last = wd.getLastSweepMs();
        return {
          armed: wd.isArmed(),
          lastSweepMs: last,
          lastSweepAgeMs: last === 0 ? null : Date.now() - last,
          intervalMs: getWatchdogIntervalMs(),
        };
      });
    }
  }

  return { register };
}

module.exports = { createIpcHandlers };
