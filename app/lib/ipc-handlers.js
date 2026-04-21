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
  } = deps;

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
  }

  return { register };
}

module.exports = { createIpcHandlers };
