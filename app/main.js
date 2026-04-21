const { app, BrowserWindow, globalShortcut, ipcMain, screen, Menu, clipboard, nativeTheme, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Force dark theme so native controls (select dropdowns, scrollbars) render dark.
try { nativeTheme.themeSource = 'dark'; } catch {}

// INSTALL_DIR points at the live install by default. In e2e tests we set
// TT_INSTALL_DIR (or reuse a tmp dir) so tests don't touch real state.
const INSTALL_DIR = process.env.TT_INSTALL_DIR || path.join(os.homedir(), '.terminal-talk');
const QUEUE_DIR = path.join(INSTALL_DIR, 'queue');
const CONFIG_PATH = path.join(INSTALL_DIR, 'config.json');
const LISTENING_STATE_FILE = path.join(INSTALL_DIR, 'listening.state');
const DIAG_LOG = path.join(QUEUE_DIR, '_toolbar.log');

// EX1 — resolve absolute paths for Windows system binaries to defuse
// the Sonar S4036 ("PATH may contain writeable dirs") hotspot. taskkill
// lives in System32; powershell 5.x in a versioned subfolder. Using
// SystemRoot env instead of hardcoding C:\Windows covers corporate
// installs that relocate the Windows directory. On non-Windows
// platforms these constants are unused — stopVoiceListener's POSIX
// branch calls process.kill() directly.
const SYSTEM32 = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'System32')
  : 'C:\\Windows\\System32';
const TASKKILL_EXE = path.join(SYSTEM32, 'taskkill.exe');
const POWERSHELL_EXE = path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');

const DEFAULTS = {
  voices: {
    edge_clip: 'en-GB-SoniaNeural',
    edge_response: 'en-GB-RyanNeural',
    openai_clip: 'shimmer',
    openai_response: 'onyx'
  },
  hotkeys: {
    toggle_window: 'Control+Shift+A',
    speak_clipboard: 'Control+Shift+S',
    toggle_listening: 'Control+Shift+J',
    // Toggle: pause if playing, resume if paused. Use for manual control.
    pause_resume: 'Control+Shift+P',
    // Pause-only: pauses the current clip if it's playing; NEVER resumes.
    // Safer for dictation-tool chains — if your dictation hotkey triggers
    // this and nothing was playing (or it was already paused), nothing
    // unexpected happens. Bind via PowerToys / AutoHotkey / Wispr Flow
    // macro so pressing your dictation trigger stops TTS gracefully.
    pause_only: 'Control+Shift+O'
  },
  playback: {
    speed: 1.25,
    auto_prune: true,     // master toggle — off means clips stack until cleared
    auto_prune_sec: 20,   // delay after play before the clip disappears (3-600)
    // v0.3.6 — when ON (default), clicking a dot plays that clip then
    // auto-continues through the remaining clips in mtime order,
    // regardless of played state. Fixes the "click exercise" where a
    // user re-listening to a fully-played queue had to click every
    // clip individually. OFF preserves the pre-0.3.6 single-clip
    // behaviour for users who want that control.
    auto_continue_after_click: true,
    // EX5 / H3 Option 2 — colour-blind-friendly palette. 'default' uses
    // the v0.3.9 palette (purple→magenta already applied for deutan
    // on slot 5). 'cb' switches to Paul Tol's "muted" palette — proven
    // distinguishable under deutan / protan / tritan. Users opt in
    // via Settings > Playback > Colour-blind friendly palette.
    palette_variant: 'default'
  },
  speech_includes: {
    code_blocks: false,
    inline_code: false,
    urls: false,
    headings: true,
    bullet_markers: false,
    image_alt: false
  },
  openai_api_key: null
};

// S3.3 — on-load config validator. Before S3.3 a malformed config.json
// would either throw in parse (caught, fall back to DEFAULTS) or succeed
// parse with garbage values (silent misbehaviour). Now we JSON-parse
// first, then validate against a rules table, then either merge with
// DEFAULTS or archive-and-fall-back.
//
// EX6a — load + save extracted to app/lib/config-store.js. main.js
// creates one store at boot and uses store.load() / store.save() at
// the old call sites. Behaviour byte-for-byte preserved; the
// extraction makes the logic unit-testable without Electron.
const { validateConfig } = require('./lib/config-validate');
const { createConfigStore } = require('./lib/config-store');
const _configStore = createConfigStore({
  configPath: CONFIG_PATH,
  defaults: DEFAULTS,
  validator: validateConfig,
  logger: (msg) => diag(msg),
});
const loadConfig = _configStore.load;
const saveConfig = _configStore.save;

// D2 — safeStorage-backed key store. Replaces the inline openai_api_key
// in config.json. Kept as a module so the unit harness can exercise the
// load/save/clear paths with a fake safeStorage without pulling Electron
// into the test runner. See app/lib/api-key-store.js for the full
// rationale on why we maintain both an encrypted .enc file (backup
// protection) and a plaintext .secret sidecar (PS-hook access path).
const { createApiKeyStore } = require('./lib/api-key-store');
const apiKeyStore = createApiKeyStore({
  dir: INSTALL_DIR,
  safeStorage,
  logger: diag,
});

let CFG = loadConfig();
// First-boot migration: old installs have openai_api_key plaintext in
// config.json. Copy it into the encrypted store once, then blank the
// field so subsequent saves don't write it back.
{
  const migrated = apiKeyStore.migrateFromConfig(CFG);
  if (migrated !== CFG) {
    CFG = migrated;
    saveConfig(CFG);
  }
}

// Cap on the number of clips returned to the renderer by getQueueFiles.
// Chosen to match the dot-strip's MAX_VISIBLE_DOTS = 40-ish budget while
// leaving headroom for the session-run-gap spacers: the renderer slices
// the newest 40 dots off the top anyway, so returning more here just
// pays syscall cost for nothing.
//
// Why 20 and not 40? Empirically the user cares about the recent past
// -- older clips have already been played AND auto-pruned, OR the user
// disabled auto-prune and is reviewing on purpose (in which case the
// older clips are in the filesystem but the UI fits one horizon on the
// strip regardless). Audit R33/R34: see docs/DESIGN-AUDIT.md §11 for
// the rationale. If you bump this, also raise MAX_VISIBLE_DOTS in
// renderer.js to match or the dots just get truncated client-side.
const MAX_FILES = 20;
const STALE_MS = 60 * 60 * 1000;

if (!fs.existsSync(QUEUE_DIR)) fs.mkdirSync(QUEUE_DIR, { recursive: true });

// 1 MB cap, single rotated backup -> bounded disk use forever.
const LOG_MAX_BYTES = 1024 * 1024;
function rotateLogIfNeeded(filePath) {
  try {
    const st = fs.statSync(filePath);
    if (st.size > LOG_MAX_BYTES) {
      const bak = filePath + '.1';
      try { fs.unlinkSync(bak); } catch {}
      try { fs.renameSync(filePath, bak); } catch {}
    }
  } catch {}
}
function diag(msg) {
  try {
    rotateLogIfNeeded(DIAG_LOG);
    fs.appendFileSync(DIAG_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
}

// Process-level safety nets. Electron's main process has no DevTools in
// production, so any async throw that escapes a try/catch would be lost
// to the ether. These handlers ensure every unexpected error makes it to
// _toolbar.log with a stack trace — diagnosable after the fact.
// Audit R35.
process.on('unhandledRejection', (reason) => {
  try {
    const msg = reason && reason.stack ? reason.stack : String(reason);
    diag(`unhandledRejection: ${msg}`);
  } catch {}
});
process.on('uncaughtException', (err) => {
  try {
    const msg = err && err.stack ? err.stack : String(err);
    diag(`uncaughtException: ${msg}`);
  } catch {}
});

let win = null;
let watcher = null;
let watchDebounce = null;

// Canonical audio-file matcher. `isAudioFile` is the "file is ready to play"
// test (excludes .partial); `AUDIO_OR_PARTIAL_RE` is the "file counts toward
// our on-disk footprint" test (used by the watchdog for before/after counts
// so an in-flight .partial still contributes). Full-review §7 caught the old
// implementation drifting between the two — one site used
// /\.(mp3|wav|partial)$/i, the other walked the lowercase suffix manually.
// Both now route through these constants.
const AUDIO_OR_PARTIAL_RE = /\.(mp3|wav|partial)$/i;
function isAudioFile(name) {
  const lower = name.toLowerCase();
  return (lower.endsWith('.wav') || lower.endsWith('.mp3')) && !lower.endsWith('.partial');
}

function getQueueFiles() {
  try {
    // Queue filenames lead with a zero-padded timestamp (synth_turn + main
    // agree on that shape), so a descending lexical sort is effectively a
    // descending mtime sort. Stat only the newest 2× MAX_FILES candidates
    // so we don't pay syscall cost for hundreds of lingering files when
    // a user has been running TT for days -- but keep enough slack that
    // a file touched out-of-band still has a chance of ranking in.
    const STAT_BUDGET = MAX_FILES * 2;
    const names = fs.readdirSync(QUEUE_DIR)
      .filter((f) => isAudioFile(f))
      // Explicit localeCompare so Sonar's S2871 gate passes. Our
      // filenames lead with a zero-padded ISO-ish timestamp, so
      // locale-aware compare gives the same ordering as the default
      // lexical sort would — just safer for future non-ASCII names.
      .sort((a, b) => b.localeCompare(a))  // descending -> newest first
      .slice(0, STAT_BUDGET);
    return names
      .map(f => {
        const full = path.join(QUEUE_DIR, f);
        try {
          const stat = fs.statSync(full);
          return { name: f, path: full, mtime: stat.mtimeMs, size: stat.size };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, MAX_FILES);
  } catch { return []; }
}

function pruneOldFiles() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(QUEUE_DIR)) {
      const full = path.join(QUEUE_DIR, f);
      // Audio files older than 1 h get pruned.
      if (isAudioFile(f)) {
        try {
          const stat = fs.statSync(full);
          if (now - stat.mtimeMs > STALE_MS) fs.unlinkSync(full);
        } catch {}
        continue;
      }
      // Stale `.partial` orphans (crashed mid-write) -- always safe to remove if older than a minute.
      if (f.endsWith('.partial')) {
        try {
          const stat = fs.statSync(full);
          if (now - stat.mtimeMs > 60_000) fs.unlinkSync(full);
        } catch {}
      }
    }
  } catch {}
}

function pruneSessionsDir() {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) return;
    for (const f of fs.readdirSync(SESSIONS_DIR)) {
      if (!f.endsWith('.json')) continue;
      const pid = parseInt(f.replace('.json', ''), 10);
      if (!pid || !isPidAlive(pid)) {
        try { fs.unlinkSync(path.join(SESSIONS_DIR, f)); } catch {}
      }
    }
  } catch {}
}

// Edge snapping: within this many pixels of a screen edge, on move-end we
// snap to that edge. Pick a threshold big enough to forgive imprecise drags
// but not so big it triggers when the user wants to park the bar near an
// edge without snapping.
const SNAP_THRESHOLD_PX = 50;

function saveWindowPosition() {
  if (!win || win.isDestroyed()) return;
  try {
    const [x, y] = win.getPosition();
    CFG.window = { ...(CFG.window || {}), x, y };
    saveConfig(CFG);
  } catch (e) { diag(`saveWindowPosition fail: ${e.message}`); }
}

// Window dimensions for each orientation. Horizontal stays the 680×114
// letterbox we've always shipped. Vertical is a 56 px wide column that's
// as tall as the workArea minus margins — fits all controls stacked plus
// room for dots running downward.
const DIM_HORIZONTAL = { width: 680, height: 114 };

// Drag-intent tracking. Without this, snapping from a diagonal drag to a
// corner picks whichever of (horizontal-edge | vertical-edge) happens to
// be closer, which is usually wrong — the user clearly meant the one
// they travelled TOWARDS, not the one that happens to be nearer after
// they let go. Ben hit this: dragged the 680 px horizontal bar to the
// right, but since it was also near the top, it snapped back to top
// horizontal instead of going vertical on the right.
let dragStart = null;          // { x, y } captured on first move event of a drag
let isApplyingDock = false;    // suppresses our own setBounds from re-triggering snap
// Share the settle-timer handle between onMove (which sets it) and
// applyDock (which must clear it before calling setBounds so the move
// events setBounds emits don't run a stale snapAfterDrag).
const moveSettleTimerRef = { current: null };

// EX6b — pure-geometry helpers extracted to app/lib/window-dock.js.
// main.js supplies the Electron-side state (win position + workArea +
// display list) and lets the pure fn decide the snap/rescue answer.
// Destructured (not namespace) import so Knip can trace every symbol
// we actually reach for.
const {
  findDockedEdge: _findDockedEdgeFromLib,
  clampToVisibleDisplay: _clampToVisibleDisplayFromLib,
} = require('./lib/window-dock');

// Horizontal-only snap. Left/right-edge vertical docking was removed after
// it created unrecoverable states on multi-monitor rearrangement (bar stuck
// vertical mid-screen with no drag path back). Ctrl+Shift+A remains the
// recovery hotkey if the window ever ends up somewhere weird.
function findDockedEdge() {
  if (!win || win.isDestroyed()) return null;
  const workArea = screen.getPrimaryDisplay().workArea;
  const [, y] = win.getPosition();
  const [, h] = win.getSize();
  return _findDockedEdgeFromLib(workArea, y, h, SNAP_THRESHOLD_PX);
}

function applyDock(edge) {
  if (!win || win.isDestroyed()) return;
  if (edge !== 'top' && edge !== 'bottom') return;  // horizontal-only
  const work = screen.getPrimaryDisplay().workArea;
  // Preserve the current height (collapsed 114 vs expanded ~618 when the
  // settings panel is open) so bottom-snapping with the panel visible
  // doesn't force it shut. Bottom anchor uses the current height so the
  // bar sits flush at the bottom with the panel tucked above it.
  const [, currentHeight] = win.getSize();
  const h = Math.max(currentHeight, DIM_HORIZONTAL.height);
  const bounds = {
    x: work.x + Math.floor((work.width - DIM_HORIZONTAL.width) / 2),
    y: edge === 'top' ? work.y : work.y + work.height - h,
    width: DIM_HORIZONTAL.width,
    height: h,
  };
  // Suppress snap-from-our-own-move during the setBounds call + tear down
  // any pending settle timer and clear drag state explicitly. The
  // move/moved events setBounds emits must not re-enter snapAfterDrag.
  // 500 ms lockout chosen empirically — Windows occasionally emits late
  // move events from the OS drag gesture well after the user released.
  isApplyingDock = true;
  dragStart = null;
  if (moveSettleTimerRef.current) {
    clearTimeout(moveSettleTimerRef.current);
    moveSettleTimerRef.current = null;
  }
  win.setBounds(bounds);
  setTimeout(() => { isApplyingDock = false; }, 500);

  CFG.window = { ...(CFG.window || {}), x: bounds.x, y: bounds.y, dock: edge };
  saveConfig(CFG);
  try { win.webContents.send('set-orientation', { kind: 'horizontal', edge }); } catch {}
  diag(`dock: ${edge} -> ${JSON.stringify(bounds)}`);
}

// EX6b — thin wrapper around app/lib/window-dock.js::clampToVisibleDisplay.
// Responsibilities:
//   - pull the live display list + primary display from the Electron
//     `screen` API (main.js has electron access; lib code doesn't).
//   - pass the bar-height invariant (DIM_HORIZONTAL.height) so the
//     rescue tests only the BAR's centre, not a panel-expanded tall
//     window. See rationale in lib/window-dock.js::clampToVisibleDisplay
//     docstring.
function clampToVisibleDisplay(x, y, w, _h) {
  return _clampToVisibleDisplayFromLib(
    x, y, w, DIM_HORIZONTAL.height,
    screen.getAllDisplays(),
    screen.getPrimaryDisplay(),
  );
}

function snapAfterDrag() {
  if (!win || win.isDestroyed()) return;
  const start = dragStart;
  dragStart = null;
  const [curX, curY] = win.getPosition();
  const [curW, curH] = win.getSize();
  // Micro-drags (e.g., user briefly grabbed the bar but didn't actually move
  // it) shouldn't trigger a re-dock — would be disorienting.
  if (start) {
    const dX = Math.abs(curX - start.x);
    const dY = Math.abs(curY - start.y);
    if (dX + dY < 8) {
      saveWindowPosition();
      return;
    }
    const edge = findDockedEdge();
    if (edge) { applyDock(edge); return; }
  } else {
    const edge = findDockedEdge();
    if (edge) { applyDock(edge); return; }
  }
  // No snap — but if the user threw the bar off every display, rescue it.
  const rescued = clampToVisibleDisplay(curX, curY, curW, curH);
  if (rescued.x !== curX || rescued.y !== curY) {
    isApplyingDock = true;
    win.setBounds({ x: rescued.x, y: rescued.y, width: curW, height: curH });
    setTimeout(() => { isApplyingDock = false; }, 500);
    diag(`off-screen rescue: moved to ${rescued.x},${rescued.y}`);
  }
  saveWindowPosition();
}

function createWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const winWidth = 680;
  const winHeight = 114;  // 36 controls + 4 gap + 44 dot row + 14 padding + 12 margin + halo breathing
  // Restore last-saved position + dock orientation if present and still
  // on-screen. Falls back to centered top.
  const saved = CFG.window || {};
  // Only 'top' and 'bottom' are still valid docks (horizontal-only).
  // Any legacy 'left' / 'right' / null gets normalised to null so the bar
  // starts free-floating and the sizes are always horizontal.
  const savedDock = (saved.dock === 'top' || saved.dock === 'bottom') ? saved.dock : null;
  if (saved.dock && !savedDock) {
    // User is coming back with a now-invalid dock (left/right from an old
    // build). Wipe the stale position too so we don't land at the edge.
    CFG.window = { ...CFG.window, x: null, y: null, dock: null };
    saveConfig(CFG);
  }
  const startW = winWidth;
  const startH = winHeight;
  let startX = typeof saved.x === 'number' ? saved.x : Math.floor((width - startW) / 2);
  let startY = typeof saved.y === 'number' ? saved.y : 12;
  // Clamp to a visible display — handles users who unplugged the monitor
  // the bar was last on (bar would otherwise spawn off-screen).
  const clamped = clampToVisibleDisplay(startX, startY, startW, startH);
  startX = clamped.x;
  startY = clamped.y;
  win = new BrowserWindow({
    width: startW,
    height: startH,
    x: startX,
    y: startY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    show: false,
    focusable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });
  win.setAlwaysOnTop(true, 'floating');
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('closed', () => { win = null; });

  // EX3 — Ctrl+R reloads the renderer (window-scoped, not global).
  // Browser convention + cheap recovery path if the toolbar gets into
  // a weird visual state (stuck overlay, stale dots post-devicechange,
  // orphan session rows). Uses before-input-event so we can intercept
  // without adding a global shortcut that would conflict with user
  // bindings. Shift+Ctrl+R reserved for hard-reload (ignore cache).
  win.webContents.on('before-input-event', (ev, input) => {
    if (input.type !== 'keyDown') return;
    if (!input.control || input.alt || input.meta) return;
    if (input.key !== 'r' && input.key !== 'R') return;
    ev.preventDefault();
    if (input.shift) win.webContents.reloadIgnoringCache();
    else win.webContents.reload();
  });

  // ===========================================================================
  // Navigation + new-window guards (Electron security checklist items 12 + 13).
  // The toolbar renderer is fully local: the only legitimate navigation is to
  // our own app/index.html. Anything else — a malicious link, an XSS-injected
  // form submit, a ctrl-clicked <a href> that somehow slipped through — gets
  // denied here. External URLs that the user deliberately wants to open are
  // funnelled through shell.openExternal (OS default browser), which has no
  // access to the renderer's IPC surface.
  // ===========================================================================
  const APP_FILE_URL = 'file://' + path.join(__dirname, 'index.html').replace(/\\/g, '/');
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== APP_FILE_URL && !url.startsWith('file://' + __dirname.replace(/\\/g, '/'))) {
      event.preventDefault();
      diag(`blocked will-navigate to ${url}`);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Refuse to open a child BrowserWindow for anything. If we ever want
    // to surface an outbound link (docs, OpenAI dashboard, etc.) we'll
    // route it through shell.openExternal explicitly.
    diag(`blocked setWindowOpenHandler for ${url}`);
    return { action: 'deny' };
  });
  win.webContents.on('will-attach-webview', (event) => {
    // We don't use <webview> at all — refuse attachment outright.
    event.preventDefault();
    diag('blocked will-attach-webview');
  });

  // Send initial orientation so renderer applies the right CSS on first
  // paint. Always horizontal now — vertical mode was removed.
  win.webContents.on('did-finish-load', () => {
    try { win.webContents.send('set-orientation', { kind: 'horizontal', edge: savedDock || 'top' }); } catch {}
  });

  // Drag detection — belt and braces because Electron's `moved` event is
  // unreliable on Windows (issue #34741): it doesn't fire when the user
  // drags to a screen edge (Aero Snap intercepts). We combine four
  // signals so at least one fires whatever path the OS takes:
  //   1. will-move    — earliest possible signal a drag is starting.
  //                     Captures dragStart here BEFORE `move` fires.
  //   2. move         — continuous during drag; resets the settle timer.
  //   3. moved        — sometimes fires at end; best path when it does.
  //   4. position poll — 100 ms poll while dragging: if position is
  //                     stable for 3 consecutive reads (300 ms), treat
  //                     as drag-end and fire snap. Covers the Aero
  //                     intercept case where no final event arrives.
  let isDragging = false;
  let lastPolledPos = [0, 0];
  let stableReadCount = 0;
  let pollInterval = null;

  function startPollingForDragEnd() {
    if (pollInterval) return;
    stableReadCount = 0;
    lastPolledPos = win.getPosition();
    pollInterval = setInterval(() => {
      if (isApplyingDock) return;
      const [x, y] = win.getPosition();
      if (x === lastPolledPos[0] && y === lastPolledPos[1]) {
        stableReadCount++;
        if (stableReadCount >= 3) {  // 300 ms stable = drag ended
          stopPollingForDragEnd();
          fireSnapIfDragging();
        }
      } else {
        stableReadCount = 0;
        lastPolledPos = [x, y];
      }
    }, 100);
  }
  function stopPollingForDragEnd() {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  }
  function fireSnapIfDragging() {
    if (!isDragging) return;
    isDragging = false;
    if (moveSettleTimerRef.current) {
      clearTimeout(moveSettleTimerRef.current);
      moveSettleTimerRef.current = null;
    }
    snapAfterDrag();
  }

  win.on('will-move', () => {
    if (isApplyingDock) return;
    if (!isDragging) {
      isDragging = true;
      const [sx, sy] = win.getPosition();
      dragStart = { x: sx, y: sy };
      startPollingForDragEnd();
    }
  });
  const onMove = () => {
    if (isApplyingDock) { dragStart = null; return; }
    if (!isDragging) {
      isDragging = true;
      const [sx, sy] = win.getPosition();
      dragStart = { x: sx, y: sy };
      startPollingForDragEnd();
    }
    if (moveSettleTimerRef.current) clearTimeout(moveSettleTimerRef.current);
    moveSettleTimerRef.current = setTimeout(() => fireSnapIfDragging(), 500);
  };
  win.on('move', onMove);
  win.on('moved', () => {
    if (isApplyingDock) return;
    stopPollingForDragEnd();
    fireSnapIfDragging();
  });
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else {
    // showInactive + no .focus() — the toolbar appears but doesn't steal
    // keyboard focus from whatever app the user is using. Arrow keys /
    // scroll / typing continue to go to the user's real work. They can
    // click the toolbar to interact with it.
    win.showInactive();
    try { win.webContents.send('force-expand'); } catch {}
  }
}

function notifyQueue() {
  if (win && !win.isDestroyed()) {
    const files = getQueueFiles();
    const assignments = ensureAssignmentsForFiles(files);
    win.webContents.send('queue-updated', { files, assignments });
    if (files.length > 0 && !win.isVisible()) win.showInactive();
  }
}

function startWatcher() {
  try {
    if (watcher) { try { watcher.close(); } catch {} watcher = null; }
    watcher = fs.watch(QUEUE_DIR, () => {
      if (watchDebounce) clearTimeout(watchDebounce);
      watchDebounce = setTimeout(notifyQueue, 150);
    });
    // Self-healing: the initial try/catch only covers construction errors.
    // A successfully-started watcher can still silently die on transient
    // ENOSPC, permission change, drive eject, or (rarely) a native handle
    // leak. Without these two handlers, clip detection would stop forever
    // with no log trace. Audit R27.
    watcher.on('error', (err) => {
      diag(`watcher error: ${err && err.message}`);
      try { watcher.close(); } catch {}
      watcher = null;
      setTimeout(startWatcher, 1000);
    });
    watcher.on('close', () => {
      watcher = null;
      setTimeout(startWatcher, 1000);
    });
  } catch {
    setTimeout(startWatcher, 1000);
  }
}

function loadApiKey() {
  // D2 — safeStorage-backed store is the primary. Env + ~/.claude/.env
  // remain as fallbacks so CI and power-users with pre-existing setups
  // keep working without any migration.
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
  const stored = apiKeyStore.get();
  if (stored) return stored.trim();
  try {
    const claudeEnv = path.join(os.homedir(), '.claude', '.env');
    const content = fs.readFileSync(claudeEnv, 'utf8');
    const m = content.match(/OPENAI_API_KEY\s*=\s*(.+)/);
    return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : null;
  } catch { return null; }
}

// Canonical stripForTTS lives in app/lib/text.js — this file just wraps
// it so the existing single call site at L~800 can stay `stripForTTS(text)`
// without knowing about the library's explicit-flags signature.
const { stripForTTS: _stripForTTS } = require('./lib/text');
function stripForTTS(text) {
  return _stripForTTS(text, CFG.speech_includes || DEFAULTS.speech_includes);
}

const { computeStaleSessions } = require('./lib/session-stale');
const { allocatePaletteIndex } = require('./lib/palette-alloc');
const { withRegistryLock } = require('./lib/registry-lock');
const { exponentialBackoff } = require('./lib/backoff');
const { mapLimit } = require('./lib/concurrency');

function chunkText(text, maxLen = 3800) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let cur = '';
  for (const s of sentences) {
    if ((cur + ' ' + s).length > maxLen && cur) { chunks.push(cur.trim()); cur = s; }
    else { cur = cur ? cur + ' ' + s : s; }
  }
  if (cur) chunks.push(cur.trim());
  return chunks;
}

const EDGE_SCRIPT = path.join(__dirname, 'edge_tts_speak.py');

// 45 s hard timeout on the Python subprocess — edge-tts can hang indefinitely
// on a stuck WebSocket / DNS wedge. Without this the Promise never resolves
// and the Python process lives forever, accumulating over hours of use
// (30-50 MB + open FDs per wedged call). Responsiveness audit R17.
const EDGE_TTS_HARD_TIMEOUT_MS = 45_000;

function callEdgeTTS(input, voice, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python', [EDGE_SCRIPT, voice, outPath], {
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe']
    });
    let err = '';
    let settled = false;
    const killTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill('SIGKILL'); } catch {}
      diag(`edge-tts hard-timeout after ${EDGE_TTS_HARD_TIMEOUT_MS}ms — killed zombie spawn`);
      reject(new Error(`edge-tts timeout after ${EDGE_TTS_HARD_TIMEOUT_MS / 1000}s`));
    }, EDGE_TTS_HARD_TIMEOUT_MS);
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      reject(e);
    });
    proc.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      if (code === 0) resolve(outPath);
      else reject(new Error(`edge-tts exit ${code}: ${err.trim().slice(0, 200)}`));
    });
    proc.stdin.end(input, 'utf8');
  });
}

function callOpenAITTS(apiKey, input, voice, outPath) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice,
      input,
      instructions: 'Speak clearly and naturally at a moderate pace. Do not read punctuation aloud.',
      response_format: 'wav'
    });
    const req = https.request({
      hostname: 'api.openai.com',
      port: 443,
      path: '/v1/audio/speech',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body, 'utf8')
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        let errData = '';
        res.on('data', d => errData += d);
        res.on('end', () => reject(new Error(`TTS ${res.statusCode}: ${errData}`)));
        return;
      }
      const tmpPath = outPath + '.partial';
      const stream = fs.createWriteStream(tmpPath);
      res.pipe(stream);
      stream.on('finish', () => { fs.renameSync(tmpPath, outPath); resolve(outPath); });
      stream.on('error', reject);
    });
    req.on('error', reject);
    req.write(body, 'utf8');
    req.end();
  });
}

let keyHelper = null;
// Z2-5 — parent-side health signal without touching key_helper.py (that's
// Terminal-2's lane). `helperConsecutiveFailures` tracks timeouts; every
// helperRequest increments on null-reply and resets on success. If the
// counter crosses HELPER_RESPAWN_THRESHOLD, we kill the current helper and
// let getKeyHelper spawn a fresh one on the next request. Catches hangs
// that the existing per-call timeout silently absorbs.
let helperConsecutiveFailures = 0;
const HELPER_RESPAWN_THRESHOLD = 3;
function getKeyHelper() {
  if (keyHelper && !keyHelper.killed && keyHelper.exitCode === null) return keyHelper;
  keyHelper = spawn('python', ['-u', path.join(__dirname, 'key_helper.py')], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore']
  });
  keyHelper.on('exit', () => { keyHelper = null; });
  helperConsecutiveFailures = 0;
  diag('keyHelper started');
  return keyHelper;
}

// Serialize requests so ctrlc/fgtree responses can't interleave on stdout.
let helperChain = Promise.resolve();
function helperRequest(cmd, timeoutMs = 500) {
  const task = () => new Promise((resolve) => {
    try {
      const helper = getKeyHelper();
      let buf = '';
      // Both success and timeout must clean up the listener AND cancel
      // the other path's timer, else a late response from a previous
      // request can resolve the CURRENT one with stale data. Audit R26.
      let timer = null;
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timer) { clearTimeout(timer); timer = null; }
        helper.stdout.off('data', onData);
        if (value === null) {
          helperConsecutiveFailures++;
          if (helperConsecutiveFailures >= HELPER_RESPAWN_THRESHOLD && keyHelper) {
            diag(`keyHelper respawning: ${helperConsecutiveFailures} consecutive failures`);
            try { keyHelper.kill(); } catch {}
            // getKeyHelper will spawn a fresh one on next invocation
          }
        } else {
          helperConsecutiveFailures = 0;
        }
        resolve(value);
      };
      const onData = (chunk) => {
        buf += chunk.toString();
        const nl = buf.indexOf('\n');
        if (nl >= 0) finish(buf.slice(0, nl));
      };
      helper.stdout.on('data', onData);
      helper.stdin.write(cmd + '\n');
      timer = setTimeout(() => finish(null), timeoutMs);
    } catch (e) {
      diag(`helperRequest ${cmd} fail: ${e.message}`);
      helperConsecutiveFailures++;
      resolve(null);
    }
  });
  helperChain = helperChain.then(task, task);
  return helperChain;
}

async function sendCtrlC() { await helperRequest('ctrlc', 200); }

async function getForegroundTree() {
  const line = await helperRequest('fgtree', 500);
  if (!line) return null;
  try { return JSON.parse(line); } catch { return null; }
}

// Detect which Claude Code session owns the currently-focused terminal, if any.
// Returns the 8-char session short, or null if no match (e.g. Chrome/PDF).
// Used to colour-code highlight-to-speak clips with a matching J label.
const SESSIONS_DIR = path.join(INSTALL_DIR, 'sessions');
async function detectActiveSession() {
  try {
    const fg = await getForegroundTree();
    const fgCandidates = new Set();
    if (fg && Array.isArray(fg.descendants)) {
      for (const p of fg.descendants) fgCandidates.add(p);
      if (fg.fg_pid) fgCandidates.add(fg.fg_pid);
    }
    diag(`detectActiveSession: fg_pid=${fg && fg.fg_pid} descendants=${fgCandidates.size}`);

    // Gather live sessions from the sessions/ dir (pruning dead PIDs).
    const liveSessions = [];
    if (fs.existsSync(SESSIONS_DIR)) {
      for (const f of fs.readdirSync(SESSIONS_DIR)) {
        if (!f.endsWith('.json')) continue;
        const pid = parseInt(f.replace('.json', ''), 10);
        if (!pid) continue;
        const full = path.join(SESSIONS_DIR, f);
        if (!isPidAlive(pid)) { try { fs.unlinkSync(full); } catch {} continue; }
        try {
          const data = JSON.parse(fs.readFileSync(full, 'utf8'));
          const stat = fs.statSync(full);
          if (data.short) liveSessions.push({ pid, short: data.short, mtime: stat.mtimeMs });
        } catch {}
      }
    }

    // Tier 1: foreground process tree contains a known session PID.
    const fgMatches = liveSessions.filter(s => fgCandidates.has(s.pid));
    if (fgMatches.length > 0) {
      fgMatches.sort((a, b) => b.mtime - a.mtime);
      diag(`detectActiveSession: fg match -> ${fgMatches[0].short}`);
      return fgMatches[0].short;
    }

    // Tier 2: only one live Claude Code session exists -- must be that one.
    if (liveSessions.length === 1) {
      diag(`detectActiveSession: single-session fallback -> ${liveSessions[0].short}`);
      return liveSessions[0].short;
    }

    // Tier 3: most recently interacted session (highest mtime). Covers Windows
    // Terminal multi-tab cases where PID tree can't distinguish tabs.
    if (liveSessions.length > 1) {
      liveSessions.sort((a, b) => b.mtime - a.mtime);
      diag(`detectActiveSession: most-recent fallback -> ${liveSessions[0].short}`);
      return liveSessions[0].short;
    }

    // Tier 4: no sessions/ files but registry has entries -- fall back to the most recent.
    const all = loadAssignments();
    const byRecent = Object.entries(all)
      .filter(([, e]) => e && e.last_seen)
      .sort((a, b) => b[1].last_seen - a[1].last_seen);
    if (byRecent.length > 0) {
      diag(`detectActiveSession: registry-recency fallback -> ${byRecent[0][0]}`);
      return byRecent[0][0];
    }

    diag('detectActiveSession: no live sessions found');
    return null;
  } catch (e) {
    diag(`detectActiveSession fail: ${e.message}`);
    return null;
  }
}

async function captureSelection() {
  const original = clipboard.readText();
  const marker = '___TT_CLIP_MARKER___' + Date.now();
  clipboard.writeText(marker);
  diag(`captureSelection: marker written (original len=${original.length})`);
  await sendCtrlC();
  let captured = '';
  const start = Date.now();
  const deadline = start + 3000;
  let polls = 0;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 20));
    polls++;
    const after = clipboard.readText();
    if (after && after !== marker) { captured = after; break; }
  }
  diag(`captureSelection: polls=${polls} elapsed=${Date.now()-start}ms captured.len=${captured.length}`);
  // Restore the user's pre-capture clipboard after a short grace, BUT
  // only if the clipboard still holds the text we captured. If the user
  // pressed Ctrl+C on something else in the 300 ms gap, their new copy
  // is on the board and we must not clobber it. Audit R11.
  setTimeout(() => {
    try {
      const now = clipboard.readText();
      if (now === captured) {
        clipboard.writeText(original);
      } else {
        diag('captureSelection: clipboard changed mid-gap -- skipping restore');
      }
    } catch (e) {
      diag(`captureSelection restore fail: ${e && e.message}`);
    }
  }, 300);
  return { captured, original };
}

let clipboardBusy = false;
let clipboardBusyTimer = null;
// Hard ceiling on how long speakClipboard can stay busy before we force-
// clear the flag. If the try-block throws in a way that the finally
// somehow misses (ctypes crash, unhandled native error, kill -9 of a
// spawned child), clipboardBusy=true would wedge the feature forever:
// every subsequent hey-jarvis / Ctrl+Shift+S trigger would be swallowed
// with "BUSY, skipping" and the user would have to restart TT.
//
// 60 s is longer than any legitimate clipboard synth (longest observed
// in testing: ~18 s for a 15 k-char paste across 4 chunks parallelised)
// but short enough that the user only waits a minute before the feature
// heals itself. Audit R10.
const CLIPBOARD_BUSY_HARD_TIMEOUT_MS = 60_000;
// Broadcast clipboard synth state to the renderer so it can show a
// pulsing placeholder dot for the 2-5s gap between wake-word detection
// and the first synth file landing in the queue. Without this the user
// thinks TT didn't hear them. Paired with the onClipboardStatus bridge
// in preload.js.
function sendClipboardStatus(state) {
  try {
    if (win && !win.isDestroyed()) {
      win.webContents.send('clipboard-status', { state });
    }
  } catch {}
}

function clearClipboardBusy() {
  clipboardBusy = false;
  if (clipboardBusyTimer) { clearTimeout(clipboardBusyTimer); clipboardBusyTimer = null; }
  sendClipboardStatus('idle');
}

async function speakClipboard() {
  diag('speakClipboard: TRIGGERED');
  if (clipboardBusy) { diag('speakClipboard: BUSY, skipping'); return; }
  clipboardBusy = true;
  clipboardBusyTimer = setTimeout(() => {
    diag(`speakClipboard: hard-timeout after ${CLIPBOARD_BUSY_HARD_TIMEOUT_MS}ms -- clearing busy flag`);
    clearClipboardBusy();
  }, CLIPBOARD_BUSY_HARD_TIMEOUT_MS);
  sendClipboardStatus('synth');
  try {
    const { captured } = await captureSelection();
    if (!captured || !captured.trim()) { diag('speakClipboard: EMPTY capture, exit'); return; }
    const text = stripForTTS(captured);
    diag(`speakClipboard: stripped len=${text.length} preview="${text.slice(0,80)}"`);
    if (!text) { diag('speakClipboard: EMPTY after strip, exit'); return; }
    // Reload config so changes from the settings panel apply without restart.
    CFG = loadConfig();
    const apiKey = loadApiKey();
    const chunks = chunkText(text, 3800);
    const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').substring(0, 17);
    const activeSession = await detectActiveSession();
    const sessionTag = activeSession || 'neutral';
    diag(`speakClipboard: session tag = ${sessionTag}, edge voice = ${CFG.voices.edge_clip}`);
    // Synthesise chunks in parallel (bounded) so a 10-chunk clipboard
    // paste doesn't serialise 10 × edge-tts round-trips. The MS Edge TTS
    // service is happy with a handful of concurrent requests; beyond ~6
    // it starts emitting 429s, so cap at 4. Output paths are returned
    // positionally (source order) so priority-play still fires in the
    // order the user highlighted the text.
    const CLIP_CONCURRENCY = 4;
    const positional = await mapLimit(chunks, CLIP_CONCURRENCY, async (chunk, i) => {
      const idx = String(i + 1).padStart(2, '0');
      const edgeOut = path.join(QUEUE_DIR, `${ts}-clip-${sessionTag}-${idx}.mp3`);
      const wavOut = path.join(QUEUE_DIR, `${ts}-clip-${sessionTag}-${idx}.wav`);
      try {
        await callEdgeTTS(chunk, CFG.voices.edge_clip, edgeOut);
        diag(`speakClipboard: edge-tts chunk ${idx} OK`);
        return edgeOut;
      } catch (e1) {
        diag(`speakClipboard: edge-tts chunk ${idx} FAIL: ${e1.message}`);
        if (!apiKey) { diag(`speakClipboard: no OpenAI key for fallback chunk ${idx}`); return null; }
        try {
          await callOpenAITTS(apiKey, chunk, CFG.voices.openai_clip, wavOut);
          diag(`speakClipboard: OpenAI fallback chunk ${idx} OK`);
          return wavOut;
        } catch (e2) {
          diag(`speakClipboard: OpenAI fallback chunk ${idx} FAIL: ${e2.message}`);
          return null;
        }
      }
    });
    const paths = positional.filter(p => p && !(p instanceof Error));
    if (paths.length && win && !win.isDestroyed()) {
      if (!win.isVisible()) win.showInactive();
      setTimeout(() => {
        diag(`speakClipboard: priority-play to renderer (${paths.length})`);
        win.webContents.send('priority-play', paths);
      }, 250);
    }
  } finally {
    clearClipboardBusy();
  }
}

const COLOURS_REGISTRY = path.join(INSTALL_DIR, 'session-colours.json');
const SHORT_KEY_RE = /^[a-f0-9]{8}$/;
const VOICE_KEY_RE = /^[A-Za-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z]+(?:Multilingual|Expressive)?Neural$|^(alloy|echo|fable|onyx|nova|shimmer)$/;
const VALID_INCLUDE_KEYS = new Set(['code_blocks','inline_code','urls','headings','bullet_markers','image_alt']);

// Validate + sanitise one registry entry. Returns null if malformed enough to drop.
function sanitiseEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const idx = Number(e.index);
  if (!Number.isFinite(idx) || idx < 0 || idx > 23) return null;
  const out = {
    index: Math.floor(idx),
    session_id: typeof e.session_id === 'string' ? e.session_id.slice(0, 80) : '',
    claude_pid: Number.isFinite(Number(e.claude_pid)) ? Number(e.claude_pid) : 0,
    label: typeof e.label === 'string' ? e.label.slice(0, 60) : '',
    pinned: e.pinned === true,
    muted: e.muted === true,
    focus: e.focus === true,
    last_seen: Number.isFinite(Number(e.last_seen)) ? Number(e.last_seen) : 0
  };
  if (typeof e.voice === 'string' && e.voice.length <= 80 && VOICE_KEY_RE.test(e.voice)) {
    out.voice = e.voice;
  }
  if (e.speech_includes && typeof e.speech_includes === 'object') {
    const inc = {};
    for (const k of Object.keys(e.speech_includes)) {
      if (VALID_INCLUDE_KEYS.has(k) && typeof e.speech_includes[k] === 'boolean') {
        inc[k] = e.speech_includes[k];
      }
    }
    if (Object.keys(inc).length > 0) out.speech_includes = inc;
  }
  return out;
}

// Archive a registry file we couldn't read. Keeps forensic data for the
// user ("why did my colours reset?") and prevents silent loss when the
// fresh {} overwrites whatever the old content was.
function archiveCorruptRegistry(reason) {
  try {
    if (!fs.existsSync(COLOURS_REGISTRY)) return;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = `${COLOURS_REGISTRY}.corrupt-${ts}.json`;
    fs.copyFileSync(COLOURS_REGISTRY, dest);
    diag(`registry corrupt (${reason}) -- archived to ${path.basename(dest)}`);
  } catch (e) {
    diag(`archiveCorruptRegistry failed: ${e && e.message}`);
  }
}

function loadAssignments() {
  let raw;
  try {
    if (!fs.existsSync(COLOURS_REGISTRY)) return {};
    raw = fs.readFileSync(COLOURS_REGISTRY, 'utf8');
  } catch (e) {
    diag(`loadAssignments read failed: ${e && e.message}`);
    return {};
  }
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    archiveCorruptRegistry(`JSON.parse: ${e && e.message}`);
    return {};
  }
  if (!parsed || !parsed.assignments || typeof parsed.assignments !== 'object') {
    archiveCorruptRegistry('missing or non-object assignments field');
    return {};
  }
  const clean = {};
  for (const [k, v] of Object.entries(parsed.assignments)) {
    if (!SHORT_KEY_RE.test(k)) continue;
    const e = sanitiseEntry(v);
    if (e) clean[k] = e;
  }
  return clean;
}

function writeAssignments(all) {
  try {
    const tmp = COLOURS_REGISTRY + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ assignments: all }, null, 2), 'utf8');
    fs.renameSync(tmp, COLOURS_REGISTRY);
    return true;
  } catch (e) { diag(`writeAssignments fail: ${e.message}`); return false; }
}

function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

const SHORT_END_RE = /-([a-f0-9]{8})\.(wav|mp3)$/i;
const SHORT_CLIP_RE = /-clip-([a-f0-9]{8})-\d+\.(wav|mp3)$/i;

function shortFromFile(name) {
  let m = name.match(SHORT_END_RE);
  if (m) return m[1].toLowerCase();
  m = name.match(SHORT_CLIP_RE);
  if (m) return m[1].toLowerCase();
  return null;
}

// If a queue file references a session short that has no colour assignment yet
// (because its statusline hasn't fired), assign the lowest free index here.
// Whichever writer (this or the statusline) wins, both agree on the outcome.
// MUST stay in lock-step with the prune logic in app/statusline.ps1 + speak-response.ps1.
// Session is considered LIVE if pinned OR PID alive OR last_seen within grace.
const SESSION_GRACE_SEC = 14400; // 4 hours
function isSessionLive(entry, now) {
  if (entry.pinned) return true;
  if (entry.claude_pid && isPidAlive(entry.claude_pid)) return true;
  if (entry.last_seen && (now - entry.last_seen) < SESSION_GRACE_SEC) return true;
  return false;
}

function ensureAssignmentsForFiles(files) {
  const all = loadAssignments();
  let changed = false;
  const now = Math.floor(Date.now() / 1000);

  // Prune ONLY truly dead sessions (PID gone AND grace expired AND not pinned).
  for (const k of Object.keys(all)) {
    if (!isSessionLive(all[k], now)) {
      delete all[k];
      changed = true;
    }
  }

  for (const f of files) {
    const short = shortFromFile(path.basename(f.path));
    if (!short || all[short]) continue;
    const alloc = allocatePaletteIndex(short, all, 24);
    if (alloc.evicted) {
      diag(`ensureAssignments: LRU eviction -- ${alloc.evicted} -> freed index ${alloc.index}`);
      delete all[alloc.evicted];
    } else if (alloc.reason === 'hash-collision') {
      diag(`ensureAssignments: ALL 24 slots pinned -- hash-collision fallback for ${short} -> index ${alloc.index}`);
    }
    all[short] = {
      index: alloc.index,
      session_id: short,
      claude_pid: 0,
      label: '',
      pinned: false,
      last_seen: now
    };
    changed = true;
    diag(`ensureAssignments: new session ${short} -> index ${alloc.index} (${alloc.reason})`);
  }

  if (changed) writeAssignments(all);
  return all;
}

// S1.2 — renderer-side error sink. The main process has R35 handlers for
// unhandledRejection / uncaughtException; the renderer had none, so any
// throw in renderer.js silently killed the UI with zero diagnostics.
// preload exposes api.logRendererError; renderer.js wires window.onerror
// and window.onunhandledrejection to call it. The dedupe helper lives in
// app/lib/renderer-error-dedupe.js so the unit harness can exercise it.
const { createDedupe } = require('./lib/renderer-error-dedupe');
const rendererErrorDedupe = createDedupe();
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

// Stale-session detection: returns shortIds whose backing terminal is
// gone. The renderer polls this every 10 s and greys out the row + its
// dots. We do NOT prune the registry here — pruning is still gated by
// the 4-hour grace in ensureAssignmentsForFiles so the user can reopen
// a terminal and get the same swatch back. This is a visual signal only.
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

ipcMain.handle('get-config', () => CFG);

// EX3 — Settings-panel "Reload toolbar" button fires this; hits the
// same reload() as the Ctrl+R keyboard shortcut in before-input-event
// at window creation. No-op if the window has been destroyed in the
// meantime (e.g. mid-quit).
ipcMain.handle('reload-renderer', () => {
  if (win && !win.isDestroyed()) win.webContents.reload();
});

// Redact secrets from any value before it reaches a log file.
// S3.2 — redaction is now keyed off a deny-set + a regex, not a single
// property check. Any future key whose name says "secret / key / token /
// password" is stripped from log output, plus the explicit deny list.
// If you add a new sensitive top-level config key, adding it here is a
// one-line patch; forgetting it means the regex still catches it by name.
const REDACT_KEYS = new Set([
  'openai_api_key',
  'claude_api_key',
  'anthropic_api_key',
  'supabase_service_key',
]);
const REDACT_KEY_RE = /(api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|client[_-]?secret)$/i;
function redactForLog(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const clone = Array.isArray(obj) ? obj.map(redactForLog) : { ...obj };
  if (Array.isArray(clone)) return clone;
  for (const k of Object.keys(clone)) {
    if (clone[k] && typeof clone[k] === 'object' && !Array.isArray(clone[k])) {
      clone[k] = redactForLog(clone[k]);
    } else if (REDACT_KEYS.has(k) || REDACT_KEY_RE.test(k)) {
      if (clone[k]) clone[k] = '<redacted>';
    }
  }
  return clone;
}

// S3.1 — mutating IPC handlers share a token-bucket rate limiter so a
// compromised renderer can't thrash config.json at thousands of writes
// per second. Single bucket per handler name; 20/sec with burst 30.
// Over-limit calls return null + log once per second per handler.
const { createRateLimit } = require('./lib/rate-limit');
const ipcRateLimit = createRateLimit();
const ipcRateLimitLogDedupe = new Map();  // handlerName → lastLoggedMs
function allowMutation(name) {
  if (ipcRateLimit.allow(name)) return true;
  const t = Date.now();
  const prev = ipcRateLimitLogDedupe.get(name) || 0;
  if ((t - prev) >= 1000) {
    ipcRateLimitLogDedupe.set(name, t);
    diag(`ipc rate-limit: rejected ${name}`);
  }
  return false;
}

ipcMain.handle('update-config', (_e, partial) => {
  if (!allowMutation('update-config')) return null;
  try {
    diag(`update-config IN: ${JSON.stringify(redactForLog(partial))}`);
    // D2 — openai_api_key no longer lives in config.json. Route writes
    // through apiKeyStore so the encrypted .enc + .secret sidecar stay
    // authoritative; config.json.openai_api_key is always null on disk.
    if (partial.openai_api_key !== undefined) {
      apiKeyStore.set(partial.openai_api_key);
    }
    const merged = {
      voices: { ...CFG.voices, ...(partial.voices || {}) },
      hotkeys: { ...CFG.hotkeys, ...(partial.hotkeys || {}) },
      playback: { ...CFG.playback, ...(partial.playback || {}) },
      speech_includes: { ...CFG.speech_includes, ...(partial.speech_includes || {}) },
      openai_api_key: null,
    };
    const ok = saveConfig(merged);
    CFG = merged;
    diag(`update-config OK: saved=${ok}, edge_response=${merged.voices.edge_response}`);
    return merged;
  } catch (e) { diag(`update-config fail: ${e.message}`); return null; }
});

function saveAssignments(all) {
  return withRegistryLock(COLOURS_REGISTRY, () => {
    try {
      const tmp = COLOURS_REGISTRY + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ assignments: all }, null, 2), 'utf8');
      fs.renameSync(tmp, COLOURS_REGISTRY);
      return true;
    } catch (e) { diag(`saveAssignments fail: ${e.message}`); return false; }
  });
}

// --- Input validation helpers (defend against malformed IPC + corrupt registry) ---
const SHORT_RE = /^[a-f0-9]{8}$/;
const VOICE_RE = /^[A-Za-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z]+(?:Multilingual|Expressive)?Neural$|^(alloy|echo|fable|onyx|nova|shimmer)$/;
const ALLOWED_INCLUDE_KEYS = new Set(['code_blocks','inline_code','urls','headings','bullet_markers','image_alt']);
const MAX_LABEL_LEN = 60;

function validShort(s) { return typeof s === 'string' && SHORT_RE.test(s); }
function validVoice(s) { return typeof s === 'string' && s.length <= 80 && VOICE_RE.test(s); }
function sanitiseLabel(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\r\n\t]/g, ' ').slice(0, MAX_LABEL_LEN).trim();
}

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
  // Palette is 24 arrangements (0–23). Previously clamped to 31 (a leftover
  // from when the palette was 32 wide) — that let set-session-index accept
  // an invalid idx that sanitiseEntry would later reject, causing a
  // silent mismatch between the UI state and persisted registry.
  all[shortId].index = Math.max(0, Math.min(23, Math.floor(n)));
  all[shortId].pinned = true;
  return saveAssignments(all);
});

// Per-session mute toggle. Muted sessions' clips are filtered from the
// playback queue AND their synth_turn.py invocations skip synthesis entirely
// (see synth_turn.run()). Truly "cut the wire" — no edge-tts calls, no
// queued audio, no CPU on muted background terminals.
// When the toolbar collapses to its slim idle state, the window area below
// the visible strip is transparent but still covered by the BrowserWindow.
// forward:true lets the renderer keep receiving mousemove events (so it can
// re-expand on hover) while clicks pass through to whatever's below.
//
// In TT_TEST_MODE (e2e tests) we deliberately no-op this. Playwright's
// synthetic mouse events arrive faster than the mousemove→IPC→setIgnoreMouseEvents
// round-trip can settle, so the test's click can race with click-through
// being on and get passed through to nothing. Keeping the window fully
// interactive in tests gives deterministic clicks without changing any
// other logic under test.
ipcMain.handle('set-clickthrough', (_e, on) => {
  if (!win || win.isDestroyed()) return false;
  if (process.env.TT_TEST_MODE) return true;
  win.setIgnoreMouseEvents(!!on, { forward: true });
  return true;
});

// Exclusive focus flag — only one session can be focus at a time.
// Setting focus on a session clears it on all others. Focus-mode
// playback: when this session has unplayed clips, they jump ahead of
// other sessions' clips in the playback queue (but never interrupt
// the currently-playing clip).
ipcMain.handle('set-session-focus', (_e, shortId, focus) => {
  if (!allowMutation('set-session-focus')) return null;
  if (!validShort(shortId)) return false;
  if (typeof focus !== 'boolean') return false;
  const all = loadAssignments();
  if (!all[shortId]) return false;
  if (focus) {
    // Exclusive: clear focus on all other sessions first
    for (const key of Object.keys(all)) {
      if (key !== shortId && all[key].focus) all[key].focus = false;
    }
  }
  all[shortId].focus = focus;
  const ok = saveAssignments(all);
  if (ok && win && !win.isDestroyed()) notifyQueue();
  return ok;
});

// Explicit remove: user clicked the × on a Sessions table row. We drop
// the assignment from the registry; if the terminal is still alive the
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
  // Broadcast so any open settings panel reflects the change instantly.
  if (ok && win && !win.isDestroyed()) {
    notifyQueue();
  }
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

// Per-session speech-includes overrides. value true=force on, false=force off,
// null=clear (follow global default).
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

const WIN_COLLAPSED = { width: 680, height: 114 };
const WIN_EXPANDED = { width: 680, height: 618 };
ipcMain.handle('set-panel-open', (_e, open) => {
  if (!win || win.isDestroyed()) return false;
  const dim = open ? WIN_EXPANDED : WIN_COLLAPSED;
  // If the bar is docked to the bottom edge, keep its bottom edge pinned
  // while the panel opens/closes — otherwise opening the panel would push
  // the panel off the bottom of the screen (panel grows downward from the
  // bar's y). Use setBounds with an adjusted y so the panel visually
  // grows upward from a bottom-docked bar.
  const dock = CFG.window && CFG.window.dock;
  if (dock === 'bottom') {
    const [curX, curY] = win.getPosition();
    const [, curH] = win.getSize();
    const newY = curY + (curH - dim.height);
    isApplyingDock = true;
    win.setBounds({ x: curX, y: newY, width: dim.width, height: dim.height });
    setTimeout(() => { isApplyingDock = false; }, 300);
  } else {
    win.setSize(dim.width, dim.height, true);
  }
  return true;
});
// Verifies a path resolves to a location strictly inside `base`. Defends against
// `..`-segment path traversal (`startsWith` alone is bypassable).
function isPathInside(target, base) {
  try {
    const resolvedTarget = path.resolve(target);
    const resolvedBase = path.resolve(base);
    return resolvedTarget === resolvedBase ||
           resolvedTarget.startsWith(resolvedBase + path.sep);
  } catch { return false; }
}

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
ipcMain.handle('hide-window', () => { if (win) win.hide(); });

// S4.1 — test-only inspection IPC. Exposes internal state the E2E harness
// can assert against instead of grepping main.js source. Guarded by
// TT_TEST_MODE so production builds don't leak internal state to a
// compromised renderer. Watchdog is the first of many; nav-guard and
// CSP probes can follow the same pattern in a future commit.
if (process.env.TT_TEST_MODE === '1') {
  ipcMain.handle('__test__/watchdog-state', () => ({
    armed: watchdogTimer !== null,
    lastSweepMs: watchdogLastSweepMs,
    lastSweepAgeMs: watchdogLastSweepMs === 0 ? null : Date.now() - watchdogLastSweepMs,
    intervalMs: WATCHDOG_INTERVAL_MS,
  }));
}

let voiceProc = null;
function isListeningEnabled() {
  try { return fs.readFileSync(LISTENING_STATE_FILE, 'utf8').trim() !== 'off'; }
  catch { return true; }
}
function setListeningState(on) {
  try { fs.writeFileSync(LISTENING_STATE_FILE, on ? 'on' : 'off'); } catch {}
}
// Military-grade safety net: sweep any orphan wake-word listeners.
// Matches only python.exe processes whose command line contains our script
// path, so nothing unrelated gets killed. Runs on start, before every spawn,
// and after every stop (belt-and-braces).
function killOrphanVoiceListeners() {
  if (process.platform !== 'win32') return;
  try {
    const { execFileSync } = require('child_process');
    const psCmd = "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -like '*wake-word-listener*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
    execFileSync(POWERSHELL_EXE, ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psCmd], {
      windowsHide: true, timeout: 5000, stdio: 'ignore'
    });
    diag('orphan voice listeners swept');
  } catch (e) {
    diag(`orphan sweep failed: ${e.message}`);
  }
}
function stopVoiceListener() {
  if (voiceProc) {
    try { voiceProc.removeAllListeners('exit'); } catch {}
    const pid = voiceProc.pid;
    voiceProc = null;
    if (pid) {
      try {
        if (process.platform === 'win32') {
          spawn(TASKKILL_EXE, ['/F', '/T', '/PID', String(pid)], { windowsHide: true });
        } else {
          process.kill(pid, 'SIGKILL');
        }
      } catch {}
    }
    diag(`voice listener stopped (pid ${pid})`);
  }
  // Belt-and-braces: Python listener also polls _listening.state and closes
  // its InputStream when off, but sweep orphans regardless.
  killOrphanVoiceListeners();
}
// Exponential backoff for the wake-word listener respawn. A broken
// install (missing edge-tts, corrupt model file, microphone permission
// denied) used to respawn every 5 s forever -- loud in the diag log
// and wasteful. Now: 5s, 10s, 20s, 40s, ... capped at 5 min, with a
// bit of jitter so N installs don't march in lock-step. The counter
// resets once a spawn has survived 30 s, so a transient driver blip
// doesn't permanently slow the respawn cadence.
let voiceRetryCount = 0;
const VOICE_BACKOFF_BASE_MS = 5000;
const VOICE_BACKOFF_MAX_MS = 5 * 60 * 1000;
const VOICE_STABLE_RESET_MS = 30_000;
let voiceStableResetTimer = null;

function computeVoiceBackoffMs(count) {
  return exponentialBackoff(count, VOICE_BACKOFF_BASE_MS, VOICE_BACKOFF_MAX_MS, 500);
}

function startVoiceListener() {
  if (voiceProc) return;
  killOrphanVoiceListeners();
  try {
    voiceProc = spawn('python', ['-u', path.join(__dirname, 'wake-word-listener.py')], {
      windowsHide: true,
      detached: false,
      stdio: ['ignore', 'ignore', 'ignore']
    });
    // Reset backoff once the child has been alive for STABLE_RESET_MS;
    // cancelled below if the process dies early.
    if (voiceStableResetTimer) { clearTimeout(voiceStableResetTimer); voiceStableResetTimer = null; }
    voiceStableResetTimer = setTimeout(() => {
      if (voiceRetryCount !== 0) {
        diag(`voice listener stable -- backoff reset (was attempt ${voiceRetryCount})`);
        voiceRetryCount = 0;
      }
      voiceStableResetTimer = null;
    }, VOICE_STABLE_RESET_MS);
    voiceProc.on('exit', (code) => {
      voiceProc = null;
      if (voiceStableResetTimer) { clearTimeout(voiceStableResetTimer); voiceStableResetTimer = null; }
      if (code !== 0 && isListeningEnabled()) {
        voiceRetryCount += 1;
        const delay = computeVoiceBackoffMs(voiceRetryCount);
        diag(`voice listener exited code=${code} -- retry #${voiceRetryCount} in ${delay}ms`);
        setTimeout(startVoiceListener, delay);
      }
    });
    diag('voice listener started');
  } catch {}
}
function toggleListening() {
  const now = isListeningEnabled();
  setListeningState(!now);
  if (now) { stopVoiceListener(); diag('listening TOGGLED OFF'); }
  else { startVoiceListener(); diag('listening TOGGLED ON'); }
  if (win && !win.isDestroyed()) win.webContents.send('listening-state', !now);
}

// ===========================================================================
// Single-instance lock — stops the "5 terminal-talk.exe in Task Manager"
// problem cold. If another Terminal Talk is already running (from a crashed
// launch, an auto-start + manual launch collision, etc.), hand the window
// over to it and exit this process immediately. The existing instance's
// `second-instance` handler surfaces its window so the user sees something
// happen instead of silent no-op.
//
// Skipped in TT_TEST_MODE: Playwright launches a fresh Electron per test and
// they'd all collide with the user's running dev instance otherwise.
// ===========================================================================
if (!process.env.TT_TEST_MODE) {
  const gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    // Another instance owns the lock. Exit without touching the UI.
    app.quit();
    process.exit(0);
  }
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      try { win.showInactive(); } catch {}
    }
  });
}

// ===========================================================================
// Periodic self-sweep watchdog — runs every 30 minutes while the app is up.
// Re-uses the same cleanup helpers that already run on startup, so there's
// only one source of truth for "what clean looks like":
//   • pruneOldFiles()          — audio files > 1h and .partial orphans > 60s
//   • pruneSessionsDir()       — removes session PID files for dead PIDs
//   • killOrphanVoiceListeners() — kills any python wake-word-listener that
//                                  lost its parent (belt-and-braces: the
//                                  listener also tears down its InputStream
//                                  when `_listening.state = off`)
// Each sweep writes a single line to queue/_watchdog.log so you can see
// that it's doing its job even when the UI shows nothing happened.
// ===========================================================================
const WATCHDOG_INTERVAL_MS = 30 * 60 * 1000;  // 30 minutes
const WATCHDOG_LOG = path.join(QUEUE_DIR, '_watchdog.log');
let watchdogTimer = null;
let watchdogLastSweepMs = 0;

function countFiles(dir, predicate) {
  try {
    // Wrap predicate so filter doesn't pass it (element, index, array).
    // Sonar S7727: direct-pass predicates may intercept the unused args
    // and change behaviour. Explicit single-arg wrap is the safe shape.
    return fs.readdirSync(dir).filter((f) => predicate(f)).length;
  } catch { return 0; }
}

function runWatchdogSweep() {
  const t0 = Date.now();
  const stats = { audio_removed: 0, sessions_removed: 0, errors: [] };

  const beforeAudio = countFiles(QUEUE_DIR, f => AUDIO_OR_PARTIAL_RE.test(f));
  try { pruneOldFiles(); } catch (e) { stats.errors.push(`pruneOldFiles: ${e.message}`); }
  const afterAudio = countFiles(QUEUE_DIR, f => AUDIO_OR_PARTIAL_RE.test(f));
  stats.audio_removed = Math.max(0, beforeAudio - afterAudio);

  const beforeSessions = countFiles(SESSIONS_DIR, () => true);
  try { pruneSessionsDir(); } catch (e) { stats.errors.push(`pruneSessionsDir: ${e.message}`); }
  const afterSessions = countFiles(SESSIONS_DIR, () => true);
  stats.sessions_removed = Math.max(0, beforeSessions - afterSessions);

  try { killOrphanVoiceListeners(); } catch (e) { stats.errors.push(`killOrphanVoiceListeners: ${e.message}`); }

  const ts = new Date().toISOString();
  watchdogLastSweepMs = Date.now();
  const line = `${ts} sweep ok · pruned ${stats.audio_removed} audio · ${stats.sessions_removed} session files · ${Date.now() - t0}ms` +
    (stats.errors.length ? ` · errors: ${stats.errors.join('; ')}` : '') + '\n';
  try { fs.appendFileSync(WATCHDOG_LOG, line); } catch {}
}

function startWatchdog() {
  if (watchdogTimer) clearInterval(watchdogTimer);
  // Don't fire immediately — startup already ran the sweep functions. Wait
  // a full interval so we only clean loose ends that accumulate over time.
  watchdogTimer = setInterval(runWatchdogSweep, WATCHDOG_INTERVAL_MS);
  // Write a start line so you know the watchdog actually armed.
  try {
    fs.appendFileSync(WATCHDOG_LOG,
      `${new Date().toISOString()} watchdog armed · interval ${WATCHDOG_INTERVAL_MS / 60000}min · pid ${process.pid}\n`);
  } catch {}
}

function stopWatchdog() {
  if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
}

// Z2-4 — boot-time SHA-256 of spawned Python helpers. Forensic only —
// we don't block on mismatch because the install itself is trusted and
// a corrupt script would fail at runtime with its own exception. But
// if someone ever reports a weird behaviour, grepping _toolbar.log for
// "[integrity]" tells us exactly which bytes were on disk at boot.
function logIntegrity() {
  const files = ['key_helper.py', 'synth_turn.py', 'wake-word-listener.py', 'edge_tts_speak.py', 'sentence_split.py'];
  for (const name of files) {
    try {
      const full = path.join(__dirname, name);
      const bytes = fs.readFileSync(full);
      const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
      diag(`[integrity] ${name} sha256:${hash} size=${bytes.length}`);
    } catch (e) {
      diag(`[integrity] ${name} read-failed: ${e.message}`);
    }
  }
}

app.whenReady().then(() => {
  logIntegrity();
  killOrphanVoiceListeners();
  pruneOldFiles();
  pruneSessionsDir();
  createWindow();
  startWatcher();
  startWatchdog();

  const menu = Menu.buildFromTemplate([{
    label: 'Audio',
    submenu: [
      { label: 'Toggle', accelerator: CFG.hotkeys.toggle_window, click: toggleWindow },
      { label: 'Quit', accelerator: 'Control+Q', click: () => app.quit() }
    ]
  }]);
  Menu.setApplicationMenu(menu);

  globalShortcut.register(CFG.hotkeys.toggle_window, toggleWindow);
  globalShortcut.register(CFG.hotkeys.speak_clipboard, speakClipboard);
  globalShortcut.register(CFG.hotkeys.toggle_listening, toggleListening);
  if (CFG.hotkeys.pause_resume) {
    globalShortcut.register(CFG.hotkeys.pause_resume, () => {
      if (win && !win.isDestroyed()) {
        try { win.webContents.send('toggle-pause-playback'); } catch {}
      }
    });
  }
  if (CFG.hotkeys.pause_only) {
    globalShortcut.register(CFG.hotkeys.pause_only, () => {
      if (win && !win.isDestroyed()) {
        try { win.webContents.send('pause-playback-only'); } catch {}
      }
    });
  }
  if (isListeningEnabled()) startVoiceListener();
  else diag('listening DISABLED at startup');
});

app.on('will-quit', () => {
  stopWatchdog();
  globalShortcut.unregisterAll();
  if (watcher) watcher.close();
  if (voiceProc) { try { voiceProc.kill(); } catch {} }
  if (keyHelper) { try { keyHelper.kill(); } catch {} }
});

app.on('window-all-closed', (e) => { e.preventDefault(); });
