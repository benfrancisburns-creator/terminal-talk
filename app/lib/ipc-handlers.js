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
  }

  return { register };
}

module.exports = { createIpcHandlers };
