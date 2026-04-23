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
    // About panel: `app.getVersion()`-equivalent getter. Injected so
    // the factory doesn't need to import electron directly.
    getAppVersion,
    getCFG,
    loadAssignments,
    getQueueFiles,
    getQueueAllPaths,
    ensureAssignmentsForFiles,
    shortFromFile,
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

    // Two lists, one poll:
    //   files    — newest N (MAX_FILES) with stat metadata, drives the
    //              dot-strip which caps its own render at MAX_VISIBLE_DOTS.
    //   allPaths — every audio file in the queue dir (readdir only, no
    //              stat cost), drives the tab-badge unread count so
    //              "TT 1 67" stays honest past the dot-strip budget.
    // Deleting a clip now shrinks both lists by one, so the badge
    // actually decrements instead of the "delete 20, back to 20" loop.
    ipcMain.handle('get-queue', () => {
      const files = getQueueFiles();
      const allPaths = typeof getQueueAllPaths === 'function'
        ? getQueueAllPaths()
        : files.map((f) => typeof f === 'string' ? f : (f && f.path));
      return { files, allPaths, assignments: ensureAssignmentsForFiles(files) };
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
    // Auto-pin rationale (applies to every mutation handler below):
    // any explicit user touch on a session row is a "I care about this
    // session" signal — the grace-window prune in
    // ensureAssignmentsForFiles would otherwise strip labels / voice /
    // include flags the moment the terminal's pid went stale past 4 h.
    // Ben hit this overnight 2026-04-22→23: laptop stayed on, CLI pid
    // rotated, entry fell outside 4 h grace, prune-then-recreate
    // wiped the "TT 1" label he'd set. Pinning on ANY customisation
    // makes entries survive pid rotation, sleep/wake, and CLI restart
    // — user intent is persistent by default.
    ipcMain.handle('set-session-label', (_e, shortId, label) => {
      if (!allowMutation('set-session-label')) return null;
      if (!validShort(shortId)) return false;
      const all = loadAssignments();
      if (!all[shortId]) return false;
      const clean = sanitiseLabel(label);
      all[shortId].label = clean;
      // Only pin when the label has actual content — clearing a label
      // back to '' is a retraction of intent, not a new one.
      if (clean) all[shortId].pinned = true;
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
      if (focus) all[shortId].pinned = true;
      const ok = saveAssignments(all);
      const win = getWin();
      if (ok && win && !win.isDestroyed()) notifyQueue();
      return ok;
    });

    // Explicit remove: user clicked × on a Sessions row. We drop the
    // assignment from the registry AND purge any queue files still
    // tagged with that short. Without the purge, the queue-watcher's
    // next tick calls ensureAssignmentsForFiles, which re-creates a
    // ghost entry (pid=0, empty label) at the lowest free palette
    // slot -- the user sees "I deleted it and it came back in a
    // different colour." Matching files is done via shortFromFile so
    // only genuine clip filenames are touched; arbitrary files in the
    // queue dir (logs etc.) are left alone.
    //
    // If the terminal is still live, its next hook fire will re-register
    // the short via Update-SessionAssignment -- PID migration (see
    // session-registry.psm1) will then re-inherit any other entry that
    // shares this claude_pid, so the user's colour/label survive.
    ipcMain.handle('remove-session', (_e, shortId) => {
      if (!allowMutation('remove-session')) return null;
      if (!validShort(shortId)) return false;
      const all = loadAssignments();
      if (!all[shortId]) return false;
      delete all[shortId];
      const ok = saveAssignments(all);
      if (ok) {
        try {
          if (typeof shortFromFile === 'function' && QUEUE_DIR && fs.existsSync(QUEUE_DIR)) {
            let purged = 0;
            for (const name of fs.readdirSync(QUEUE_DIR)) {
              if (shortFromFile(name) !== shortId) continue;
              try {
                fs.unlinkSync(path.join(QUEUE_DIR, name));
                purged += 1;
              } catch (e) {
                diag(`remove-session: unlink ${name} failed: ${e.message}`);
              }
            }
            if (purged > 0) diag(`remove-session: purged ${purged} queue files for ${shortId}`);
          }
        } catch (e) {
          diag(`remove-session: queue purge failed: ${e.message}`);
        }
        notifyQueue();
      }
      return ok;
    });

    ipcMain.handle('set-session-muted', (_e, shortId, muted) => {
      if (!allowMutation('set-session-muted')) return null;
      if (!validShort(shortId)) return false;
      if (typeof muted !== 'boolean') return false;
      const all = loadAssignments();
      if (!all[shortId]) return false;
      all[shortId].muted = muted;
      if (muted) all[shortId].pinned = true;
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
        all[shortId].pinned = true;
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
        all[shortId].pinned = true;
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
      if (!win || win.isDestroyed()) return;
      // Defensive reload-deadlock fix (2026-04-23): Chromium's
      // setIgnoreMouseEvents flag lives on the BrowserWindow, not on
      // the renderer content, so webContents.reload() does NOT reset
      // it. If click-through was ON at reload time (cursor off the
      // bar), the window stays dead-zoned through the reload; the new
      // renderer's module-load setClickthrough(false) races main's
      // handler registration and can land before main is ready to
      // receive it. Net effect: toolbar visible but unclickable
      // until something external nudges updateClickthrough() — a
      // new queue clip, a global-hotkey show, an explicit mousemove
      // over the bar edge. Forcing mouse events ON main-side BEFORE
      // the reload guarantees the new renderer starts from a known
      // interactive state regardless of what the pre-reload state
      // was. Renderer's own updateClickthrough() takes over as soon
      // as the first mousemove fires.
      try { win.setIgnoreMouseEvents(false); } catch {}
      win.webContents.reload();
    });

    // Settings panel "OpenAI (premium)" status probe. Returns whether
    // a key is currently saved in the apiKeyStore WITHOUT returning
    // the key itself — renderer uses this to drive the "● Key set" /
    // "○ Not set" status dot and to grey out the "Prefer OpenAI"
    // toggle when no key exists. Cheap: one filesystem existence
    // check + maybe one decrypt, never an IPC roundtrip per render.
    ipcMain.handle('get-openai-key-status', () => {
      try {
        const k = apiKeyStore.get();
        return { saved: typeof k === 'string' && k.length > 0 };
      } catch { return { saved: false }; }
    });

    // Settings panel "Test voice" button. Synthesises a short known
    // phrase through the currently-preferred provider (reading
    // playback.tts_provider off live config) and writes it into the
    // queue like any other response clip. Ben hears immediately
    // whether his key works + which voice + which provider fired.
    // Idempotent/re-runnable: each press produces one fresh clip.
    //
    // Uses the same edge_tts_speak.py + openai_tts.py wrappers
    // synth_turn.py uses, not a new code path — keeps "test" honest.
    ipcMain.handle('test-openai-voice', async () => {
      if (!allowMutation('test-openai-voice')) return null;
      try {
        const cfg = getCFG() || {};
        const voices = cfg.voices || {};
        const playback = cfg.playback || {};
        const provider = String(playback.tts_provider || 'edge').toLowerCase();
        const edgeVoice = voices.edge_response || 'en-GB-RyanNeural';
        const openaiVoice = voices.openai_response || 'alloy';
        const key = apiKeyStore.get();
        if (provider === 'openai' && !key) {
          return { ok: false, provider: 'openai', error: 'Prefer OpenAI is on but no API key is saved.' };
        }

        // Fire the edge helper — which is what synth_turn.py does
        // under the hood anyway. For the OpenAI path we invoke the
        // Python wrapper the same way synth_turn does.
        const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
        const shortOut = 'test0000';  // valid 8-hex so queue file-name validator passes
        const phrase = 'Terminal Talk test, one two three.';
        const extFor = (prov) => prov === 'openai' ? 'mp3' : 'mp3';
        const outPath = path.join(QUEUE_DIR, `${ts}-0000-${shortOut}.${extFor(provider)}`);

        const { spawn } = require('node:child_process');
        const ok = await new Promise((resolve) => {
          let proc;
          if (provider === 'openai') {
            const script = path.join(path.dirname(QUEUE_DIR), 'app', 'openai_tts.py');
            if (!fs.existsSync(script)) { resolve({ ok: false, err: 'openai_tts.py missing from install' }); return; }
            proc = spawn('python', [script, key, openaiVoice, outPath],
              { stdio: ['pipe', 'ignore', 'pipe'] });
          } else {
            const script = path.join(path.dirname(QUEUE_DIR), 'app', 'edge_tts_speak.py');
            if (!fs.existsSync(script)) { resolve({ ok: false, err: 'edge_tts_speak.py missing from install' }); return; }
            proc = spawn('python', [script, edgeVoice, outPath],
              { stdio: ['pipe', 'ignore', 'pipe'] });
          }
          let stderr = '';
          proc.stderr.on('data', (d) => { stderr += d.toString(); });
          proc.on('error', (e) => resolve({ ok: false, err: e.message }));
          proc.on('close', (code) => {
            const size = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
            if (code === 0 && size > 500) resolve({ ok: true });
            else resolve({ ok: false, err: `exit ${code}, size ${size}, stderr: ${stderr.slice(0, 200)}` });
          });
          proc.stdin.end(phrase, 'utf-8');
        });

        if (ok.ok) {
          notifyQueue();
          diag(`test-openai-voice OK: provider=${provider} voice=${provider === 'openai' ? openaiVoice : edgeVoice}`);
          return { ok: true, provider, voice: provider === 'openai' ? openaiVoice : edgeVoice };
        }
        diag(`test-openai-voice FAIL: ${ok.err}`);
        return { ok: false, provider, error: ok.err };
      } catch (e) {
        diag(`test-openai-voice crash: ${e.message}`);
        return { ok: false, error: e.message };
      }
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

    // About panel version query. Returns whatever `app.getVersion()`
    // returns on the main side — which reads package.json's `version`
    // field. The IPC wraps a getter so the ipc-handlers factory stays
    // pure and testable without having to spin up an Electron context.
    ipcMain.handle('get-version', () => {
      if (typeof getAppVersion === 'function') {
        try { return String(getAppVersion() || ''); } catch { return ''; }
      }
      return '';
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
      // Accept single verbs ("Moonwalking") or short multi-word phrases
      // ("Thinking this through"). Letters and single-spaces only —
      // still strict enough that a compromised renderer can't pipe
      // shell metachars or SSML through the edge-tts stdin.
      if (typeof verb !== 'string' || !/^[A-Za-z][A-Za-z ]{1,59}$/.test(verb)) return false;
      if (/\s\s/.test(verb)) return false;  // no double-spaces
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
        // HB3 — heartbeat clips use H- prefix (not T-). Renderer's
        // isHeartbeatClip() matches /-H-/ strictly; if these stay under
        // -T- they're mis-classified as tool-narration clips and play
        // at 100 % volume instead of 45 %. The original HB3 commit
        // described this change but the edit didn't persist (file-
        // modification race); re-applying explicitly.
        const filename = `${ts}-H-0001-${sessionShort}.mp3`;
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
