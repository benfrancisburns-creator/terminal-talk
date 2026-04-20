const { app, BrowserWindow, globalShortcut, ipcMain, screen, Menu, clipboard, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
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
    auto_prune_sec: 20    // delay after play before the clip disappears (3-600)
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

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      voices: { ...DEFAULTS.voices, ...(parsed.voices || {}) },
      hotkeys: { ...DEFAULTS.hotkeys, ...(parsed.hotkeys || {}) },
      playback: { ...DEFAULTS.playback, ...(parsed.playback || {}) },
      speech_includes: { ...DEFAULTS.speech_includes, ...(parsed.speech_includes || {}) },
      window: parsed.window && typeof parsed.window === 'object' ? parsed.window : null,
      openai_api_key: parsed.openai_api_key ?? null
    };
  } catch { return DEFAULTS; }
}

function saveConfig(cfg) {
  // Atomic: write to .tmp first, then rename. A crash mid-write leaves either
  // the old config or the new config intact -- never a half-written file.
  try {
    const tmp = CONFIG_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
    fs.renameSync(tmp, CONFIG_PATH);
    return true;
  } catch (e) { diag(`saveConfig fail: ${e.message}`); return false; }
}

let CFG = loadConfig();

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
      .filter(isAudioFile)
      .sort()           // ascending
      .reverse()        // descending -> newest filenames first
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

// Horizontal-only snap. Left/right-edge vertical docking was removed after
// it created unrecoverable states on multi-monitor rearrangement (bar stuck
// vertical mid-screen with no drag path back). Ctrl+Shift+A remains the
// recovery hotkey if the window ever ends up somewhere weird.
function findDockedEdge(dX, dY) {
  if (!win || win.isDestroyed()) return null;
  const { x: dispX, y: dispY, width: dispW, height: dispH } = screen.getPrimaryDisplay().workArea;
  const [x, y] = win.getPosition();
  const [, h] = win.getSize();
  const topDist = y - dispY;
  const bottomDist = (dispY + dispH) - (y + h);
  // Only horizontal snap: top or bottom. Negative overshoot = past the edge
  // and always counts; positive only counts under the threshold.
  const candidates = [];
  if (topDist < SNAP_THRESHOLD_PX) candidates.push({ name: 'top', dist: topDist });
  if (bottomDist < SNAP_THRESHOLD_PX) candidates.push({ name: 'bottom', dist: bottomDist });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].name;
  const sortKey = (d) => Math.max(0, d);
  return candidates.sort((a, b) => sortKey(a.dist) - sortKey(b.dist))[0].name;
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

// If the BAR portion of the window (top DIM_HORIZONTAL.height px, the part
// the user can click and drag) ends up off every connected display — user
// unplugged a monitor, swapped laptops, RDP session ended — re-centre on
// primary. We deliberately test only the BAR's centre, not the whole
// window, so an open settings panel overflowing the bottom of the screen
// doesn't trip the rescue (that was causing a flicker when you dragged
// the bar toward the bottom with the panel open: the panel's centre went
// off-screen and we yanked the window back mid-drag).
function clampToVisibleDisplay(x, y, w, _h) {
  const barH = DIM_HORIZONTAL.height;
  const cx = x + w / 2;
  const cy = y + barH / 2;
  const displays = screen.getAllDisplays();
  const onAnyDisplay = displays.some(d => {
    const wa = d.workArea;
    return cx >= wa.x && cx <= wa.x + wa.width &&
           cy >= wa.y && cy <= wa.y + wa.height;
  });
  if (onAnyDisplay) return { x, y };
  const primary = screen.getPrimaryDisplay().workArea;
  return {
    x: primary.x + Math.floor((primary.width - w) / 2),
    y: primary.y + 12,
  };
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
    const edge = findDockedEdge(dX, dY);
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
  let savedDock = (saved.dock === 'top' || saved.dock === 'bottom') ? saved.dock : null;
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
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
  if (CFG.openai_api_key) return CFG.openai_api_key.trim();
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
function getKeyHelper() {
  if (keyHelper && !keyHelper.killed && keyHelper.exitCode === null) return keyHelper;
  keyHelper = spawn('python', ['-u', path.join(__dirname, 'key_helper.py')], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore']
  });
  keyHelper.on('exit', () => { keyHelper = null; });
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
      const onData = (chunk) => {
        buf += chunk.toString();
        const nl = buf.indexOf('\n');
        if (nl >= 0) {
          helper.stdout.off('data', onData);
          resolve(buf.slice(0, nl));
        }
      };
      helper.stdout.on('data', onData);
      helper.stdin.write(cmd + '\n');
      setTimeout(() => { helper.stdout.off('data', onData); resolve(null); }, timeoutMs);
    } catch (e) {
      diag(`helperRequest ${cmd} fail: ${e.message}`);
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
    let liveSessions = [];
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
  setTimeout(() => { clipboard.writeText(original); }, 300);
  return { captured, original };
}

let clipboardBusy = false;
async function speakClipboard() {
  diag('speakClipboard: TRIGGERED');
  if (clipboardBusy) { diag('speakClipboard: BUSY, skipping'); return; }
  clipboardBusy = true;
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
    const paths = [];
    for (let i = 0; i < chunks.length; i++) {
      const idx = String(i + 1).padStart(2, '0');
      const edgeOut = path.join(QUEUE_DIR, `${ts}-clip-${sessionTag}-${idx}.mp3`);
      const wavOut = path.join(QUEUE_DIR, `${ts}-clip-${sessionTag}-${idx}.wav`);
      let delivered = null;
      try {
        await callEdgeTTS(chunks[i], CFG.voices.edge_clip, edgeOut);
        delivered = edgeOut;
        diag(`speakClipboard: edge-tts chunk ${idx} OK`);
      } catch (e1) {
        diag(`speakClipboard: edge-tts chunk ${idx} FAIL: ${e1.message}`);
        if (!apiKey) { diag('speakClipboard: no OpenAI key for fallback'); continue; }
        try {
          await callOpenAITTS(apiKey, chunks[i], CFG.voices.openai_clip, wavOut);
          delivered = wavOut;
          diag(`speakClipboard: OpenAI fallback chunk ${idx} OK`);
        } catch (e2) {
          diag(`speakClipboard: OpenAI fallback chunk ${idx} FAIL: ${e2.message}`);
        }
      }
      if (delivered) paths.push(delivered);
    }
    if (paths.length && win && !win.isDestroyed()) {
      if (!win.isVisible()) win.showInactive();
      setTimeout(() => {
        diag(`speakClipboard: priority-play to renderer (${paths.length})`);
        win.webContents.send('priority-play', paths);
      }, 250);
    }
  } finally {
    clipboardBusy = false;
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

// Redact secrets from any value before it reaches a log file.
function redactForLog(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const clone = { ...obj };
  if (clone.openai_api_key) clone.openai_api_key = '<redacted>';
  return clone;
}

ipcMain.handle('update-config', (_e, partial) => {
  try {
    diag(`update-config IN: ${JSON.stringify(redactForLog(partial))}`);
    const merged = {
      voices: { ...CFG.voices, ...(partial.voices || {}) },
      hotkeys: { ...CFG.hotkeys, ...(partial.hotkeys || {}) },
      playback: { ...CFG.playback, ...(partial.playback || {}) },
      speech_includes: { ...CFG.speech_includes, ...(partial.speech_includes || {}) },
      openai_api_key: partial.openai_api_key !== undefined ? partial.openai_api_key : CFG.openai_api_key
    };
    const ok = saveConfig(merged);
    CFG = merged;
    diag(`update-config OK: saved=${ok}, edge_response=${merged.voices.edge_response}`);
    return merged;
  } catch (e) { diag(`update-config fail: ${e.message}`); return null; }
});

function saveAssignments(all) {
  try {
    const tmp = COLOURS_REGISTRY + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ assignments: all }, null, 2), 'utf8');
    fs.renameSync(tmp, COLOURS_REGISTRY);
    return true;
  } catch (e) { diag(`saveAssignments fail: ${e.message}`); return false; }
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
  if (!validShort(shortId)) return false;
  const all = loadAssignments();
  if (!all[shortId]) return false;
  all[shortId].label = sanitiseLabel(label);
  return saveAssignments(all);
});

ipcMain.handle('set-session-index', (_e, shortId, newIndex) => {
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
  if (!validShort(shortId)) return false;
  const all = loadAssignments();
  if (!all[shortId]) return false;
  delete all[shortId];
  const ok = saveAssignments(all);
  if (ok) notifyQueue();
  return ok;
});

ipcMain.handle('set-session-muted', (_e, shortId, muted) => {
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
  try {
    if (typeof filePath !== 'string' || filePath.length > 4096) return false;
    if (!isPathInside(filePath, QUEUE_DIR)) return false;
    fs.unlinkSync(path.resolve(filePath));
    return true;
  } catch {}
  return false;
});
ipcMain.handle('hide-window', () => { if (win) win.hide(); });

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
    execFileSync('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psCmd], {
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
          spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true });
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
function startVoiceListener() {
  if (voiceProc) return;
  killOrphanVoiceListeners();
  try {
    voiceProc = spawn('python', ['-u', path.join(__dirname, 'wake-word-listener.py')], {
      windowsHide: true,
      detached: false,
      stdio: ['ignore', 'ignore', 'ignore']
    });
    voiceProc.on('exit', (code) => {
      voiceProc = null;
      if (code !== 0 && isListeningEnabled()) setTimeout(startVoiceListener, 5000);
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

function countFiles(dir, predicate) {
  try {
    return fs.readdirSync(dir).filter(predicate).length;
  } catch { return 0; }
}

function runWatchdogSweep() {
  const t0 = Date.now();
  const stats = { audio_removed: 0, sessions_removed: 0, errors: [] };

  const beforeAudio = countFiles(QUEUE_DIR, f => /\.(mp3|wav|partial)$/.test(f));
  try { pruneOldFiles(); } catch (e) { stats.errors.push(`pruneOldFiles: ${e.message}`); }
  const afterAudio = countFiles(QUEUE_DIR, f => /\.(mp3|wav|partial)$/.test(f));
  stats.audio_removed = Math.max(0, beforeAudio - afterAudio);

  const beforeSessions = countFiles(SESSIONS_DIR, () => true);
  try { pruneSessionsDir(); } catch (e) { stats.errors.push(`pruneSessionsDir: ${e.message}`); }
  const afterSessions = countFiles(SESSIONS_DIR, () => true);
  stats.sessions_removed = Math.max(0, beforeSessions - afterSessions);

  try { killOrphanVoiceListeners(); } catch (e) { stats.errors.push(`killOrphanVoiceListeners: ${e.message}`); }

  const ts = new Date().toISOString();
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

app.whenReady().then(() => {
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
