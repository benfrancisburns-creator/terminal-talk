// S1.3 — renderer-side error capture. Anything thrown inside a handler,
// any promise that rejects without a .catch, now makes it to main via
// api.logRendererError (preload exposes it) and ends up in _toolbar.log.
// Main dedupes on the top-4 stack lines with a 1 s window so an exception
// loop can't flood the log. Wired before anything else so an error during
// module-top-level init still reports.
window.addEventListener('error', (e) => {
  try {
    if (window.api && window.api.logRendererError) {
      window.api.logRendererError({
        type: 'error',
        message: e.message || String(e.error || ''),
        stack:   e.error && e.error.stack ? e.error.stack : '',
        source:  e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : '',
      });
    }
  } catch {}
});
window.addEventListener('unhandledrejection', (e) => {
  try {
    if (window.api && window.api.logRendererError) {
      const reason = e.reason;
      window.api.logRendererError({
        type: 'unhandledrejection',
        message: reason && reason.message ? reason.message : String(reason),
        stack:   reason && reason.stack   ? reason.stack   : '',
      });
    }
  } catch {}
});

// D2-9 — Constructable Stylesheet for values too continuous to pre-render
// into CSS classes (mascot px position, spinner cloud px position). Rules
// are inserted into an adopted sheet rather than inline style attributes,
// so the CSP style-src directive can drop 'unsafe-inline' entirely.
// Palette-based backgrounds (dots / swatches) use data-palette attribute
// + app/lib/palette-classes.css; only the strictly continuous cases live
// here.
const dynSheet = new CSSStyleSheet();
document.adoptedStyleSheets = [...document.adoptedStyleSheets, dynSheet];
const dynRules = new Map();
let spinnerWordCounter = 0;
function setDynamicStyle(selector, cssText) {
  if (cssText) dynRules.set(selector, cssText);
  else dynRules.delete(selector);
  let text = '';
  for (const [sel, txt] of dynRules) text += `${sel} { ${txt} }\n`;
  try { dynSheet.replaceSync(text); } catch {}
}

const audio = document.getElementById('audio');
const dotsEl = document.getElementById('dots');
const playPauseBtn = document.getElementById('playPause');
const playIcon = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');
const back10Btn = document.getElementById('back10');
const fwd10Btn = document.getElementById('fwd10');
const scrubber = document.getElementById('scrubber');
const scrubberWrap = document.getElementById('scrubberWrap');
const scrubberMascot = document.getElementById('scrubberMascot');
const scrubberJarvis = document.getElementById('scrubberJarvis');

// Claude Code's real tengu_spinner_words list (90 entries, sourced from
// levindixon/tengu_spinner_words). Shown as a trail of vocabulary behind
// the walking mascot — picked at random per emit so you never know
// which one will pop out next. "Moonwalking" is in there; so is
// "Flibbertigibbeting".
const SPINNER_VERBS = [
  'Accomplishing','Actioning','Actualizing','Baking','Booping','Brewing',
  'Calculating','Cerebrating','Channelling','Churning','Clauding','Coalescing',
  'Cogitating','Combobulating','Computing','Concocting','Conjuring','Considering',
  'Contemplating','Cooking','Crafting','Creating','Crunching','Deciphering',
  'Deliberating','Determining','Discombobulating','Divining','Doing','Effecting',
  'Elucidating','Enchanting','Envisioning','Finagling','Flibbertigibbeting',
  'Forging','Forming','Frolicking','Generating','Germinating','Hatching','Herding',
  'Honking','Hustling','Ideating','Imagining','Incubating','Inferring','Jiving',
  'Manifesting','Marinating','Meandering','Moonwalking','Moseying','Mulling',
  'Mustering','Musing','Noodling','Percolating','Perusing','Philosophising',
  'Pontificating','Pondering','Processing','Puttering','Puzzling','Reticulating',
  'Ruminating','Scheming','Schlepping','Shimmying','Shucking','Simmering',
  'Smooshing','Spelunking','Spinning','Stewing','Sussing','Synthesizing','Thinking',
  'Tinkering','Transmuting','Unfurling','Unravelling','Vibing','Wandering',
  'Whirring','Wibbling','Wizarding','Working','Wrangling'
];
function randomVerb() {
  return SPINNER_VERBS[Math.floor(Math.random() * SPINNER_VERBS.length)];
}
const timeEl = document.getElementById('time');
const closeBtn = document.getElementById('close');
const clearPlayedBtn = document.getElementById('clearPlayed');
const barEl = document.getElementById('bar');

// -------------------------------------------------------------------
// Collapse-on-idle behaviour (poll-based, robust to window focus changes)
// -------------------------------------------------------------------
// We deliberately avoid relying on mousemove/leave transitions because
// mousemove stops firing once the cursor leaves the Electron window
// (e.g., user switches to another app). The old timer-reset design got
// stuck in "mouse is over bar" state in that case.
//
// Design:
//   - lastActivityTs tracks the last time something interesting happened
//     (mousemove over bar, click, keydown, new clip arrival).
//   - A 1 s poll decides whether to collapse. Rules:
//       * Settings panel open → never collapse.
//       * Audio still playing or unplayed clips waiting → never collapse.
//       * Cursor currently over the bar → treat as ongoing activity.
//       * Otherwise collapse once COLLAPSE_DELAY_MS has elapsed since
//         the last activity.
//   - Any of { new clip, click, keydown, mousemove over bar, force-expand }
//     calls bumpActivity() which resets the timer and re-expands.
const COLLAPSE_DELAY_MS = 15000;
const POLL_INTERVAL_MS = 1000;
let isCollapsed = false;
let settingsOpen = false;
let lastActivityTs = Date.now();
let cursorX = -1, cursorY = -1;

async function applyCollapsed(collapsed) {
  if (collapsed === isCollapsed) return;
  isCollapsed = collapsed;
  if (collapsed) {
    barEl.classList.add('collapsed');
  } else {
    barEl.classList.remove('collapsed');
  }
  // Click-through state is decided by cursor position (see mousemove
  // handler), not by collapsed state — so clicks in the transparent
  // margin outside the visible bar pass through to the app below,
  // even when the toolbar is expanded. applyCollapsed no longer
  // toggles click-through directly; updateClickthrough() does it.
  updateClickthrough();
}

// Track current click-through state so we don't IPC on every mousemove.
let clickthroughOn = true;
async function updateClickthrough() {
  // Click-through ON (pass clicks to app below) whenever the cursor
  // is NOT over the visible bar pixels. This is what lets the user
  // interact with other apps while the toolbar is visible — the
  // 680 × 114 window becomes effectively "only the bar rectangle
  // is mine; everything else is transparent".
  const overBar = isMouseOverBar();
  const want = !overBar;
  if (want !== clickthroughOn) {
    clickthroughOn = want;
    try { await window.api.setClickthrough(want); } catch {}
  }
}

function isQueueActive() {
  const audioBusy = audio.src && !audio.paused && !audio.ended && audio.readyState >= 2;
  if (audioBusy) return true;
  return queue.some(f => !playedPaths.has(f.path) && !isPathSessionMuted(f.path));
}

function isMouseOverBar() {
  if (cursorX < 0) return false;
  const r = barEl.getBoundingClientRect();
  const overBar = cursorX >= r.left && cursorX <= r.right &&
                  cursorY >= r.top  && cursorY <= r.bottom + 4;
  if (overBar) return true;
  // When the settings panel is expanded, the panel element also needs to
  // accept clicks — otherwise the dynamic click-through passes clicks
  // through the panel area (user can't click any setting). Treat the
  // panel as part of the interactive surface when it's open.
  if (settingsOpen) {
    const panel = document.getElementById('panel');
    if (panel) {
      const p = panel.getBoundingClientRect();
      if (p.width > 0 && p.height > 0 &&
          cursorX >= p.left && cursorX <= p.right &&
          cursorY >= p.top  && cursorY <= p.bottom) return true;
    }
  }
  return false;
}

function bumpActivity() {
  lastActivityTs = Date.now();
  if (isCollapsed) applyCollapsed(false);
}

setInterval(() => {
  if (isCollapsed) return;
  if (settingsOpen) return;
  if (isQueueActive()) return;
  if (isMouseOverBar()) {
    lastActivityTs = Date.now();
    return;
  }
  if (Date.now() - lastActivityTs >= COLLAPSE_DELAY_MS) {
    applyCollapsed(true);
  }
}, POLL_INTERVAL_MS);

// EX7b — stale-session polling extracted into a component. Greys out
// session rows and their dots within 10 s of a terminal's PID going
// away. Component-owned setInterval + setTimeout can't orphan across
// a renderer reload (EX3 Ctrl+R) — unmount() tears them down.
const staleSessionPoller = new window.TT_STALE_SESSION_POLLER({
  api: window.api,
  intervalMs: 10_000,
  initialDelayMs: 500,
  onChange: () => {
    if (document.body.classList.contains('settings-open')) renderSessionsTable();
    renderDots();
  },
});
staleSessionPoller.start();

let queue = [];
let currentPath = null;
let currentIsManual = false;
// v0.3.6 — currentIsManual was overloaded to mean both "priority
// (hey-jarvis) clip" and "user clicked a dot". Only the latter should
// trigger auto-continue-after-click, so track it separately. Set only
// by userPlay(); reset on ended/error/next play.
let currentIsUserClick = false;
const playedPaths = new Set();
const heardPaths = new Set();
const priorityPaths = new Set();
const priorityQueue = [];
let pendingQueue = [];
let userScrubbing = false;
const deleteTimers = new Map();
const STALE_MS = 5 * 60 * 1000;
// Auto-prune delay is user-configurable via the Playback settings panel.
// The value is a single seconds count that applies to both manual and
// auto plays — keeping one number avoids the "which timer did that use?"
// confusion. Clamped 3-600 s on the input side.
let autoPruneSec = 20;
// v0.3.6 — mirrors CFG.playback.auto_continue_after_click. Default ON.
// See audio.addEventListener('ended') for the behaviour this gates.
let autoContinueAfterClick = true;
const MAX_VISIBLE_DOTS = 40;            // hard cap to keep DOM light; overflow scrolls horizontally

// Palette comes from app/lib/tokens.json via the generated tokens-window.js
// script (loaded in index.html before this file). Same order statusline.ps1
// uses for its 8 emojis. Brown is a richer copper so splits read clearly.
const {
  PALETTE_SIZE,
  HSPLIT_PARTNER,
  VSPLIT_PARTNER,
  COLOUR_NAMES,
} = window.TT_TOKENS.palette;

// Assignments registry (session_short -> { index }) provided by main via IPC.
let sessionAssignments = {};

// True while speakClipboard() is synthesising between wake-word detection
// and first real clip arriving. Drives a placeholder pulsing dot so the
// user gets visual confirmation TT heard them -- otherwise the 2-5 s
// synth window feels like "did it fire?".
let synthInProgress = false;

// Helpers that read muted / focus state off the current sessionAssignments
// cache. Kept here (not inside renderDots / playNextPending) so every
// call site uses the exact same rule.
function isClipSessionMuted(filename) {
  const short = extractSessionShort(filename);
  if (!short) return false;
  const entry = sessionAssignments[short];
  return !!(entry && entry.muted);
}
function isPathSessionMuted(p) {
  const name = p.split(/[\\/]/).pop();
  return isClipSessionMuted(name);
}
// S1 follow-up — a clip from a session whose terminal is closed
// (staleSessionPoller populated by the 10 s get-stale-sessions poll) should
// not auto-play. The dot is still clickable so the user can hear it
// manually; auto-play just skips closed-session clips the same way it
// skips muted ones. Prevents phantom audio from detached late-arriving
// synth jobs or leaked test fixtures.
function isPathSessionStale(p) {
  const short = extractSessionShort(p.split(/[\\/]/).pop());
  return !!(short && staleSessionPoller.has(short));
}
// Returns the shortId of the focused session if any, else null.
// Only one session can be focused at a time (main.js enforces exclusivity).
function findFocusedSessionShort() {
  for (const [short, entry] of Object.entries(sessionAssignments)) {
    if (entry && entry.focus) return short;
  }
  return null;
}

// Index 0..31 -> one of 4 arrangement kinds:
// EX7a — extracted to app/lib/clip-paths.js. Loaded via
// <script src> in index.html before this file; attaches to
// window.TT_CLIP_PATHS. Thin wrappers here preserve the call-site
// signature so every existing renderer call stays unchanged.
// EX7c — paletteKeyForShort wrapper removed: its sole caller moved
// into the DotStrip component.
// EX7d-1 — paletteKeyForIndex wrapper removed: its sole caller moved
// into the SessionsTable component. Both components now receive
// clipPaths + the palette size via deps rather than closing over a
// renderer-module global.
const _paths = window.TT_CLIP_PATHS;
const extractSessionShort = _paths.extractSessionShort;
const isClipFile = _paths.isClipFile;

// Auto-prune toggle. true = 20 s after play, clips disappear on their own.
// false = clips stack up until user clears them (useful when walking away
// from the machine and wanting to review on return).
let autoPruneEnabled = true;

function scheduleAutoDelete(p, _wasManual = false) {
  if (!autoPruneEnabled) return;  // respect the user's toggle
  if (deleteTimers.has(p)) clearTimeout(deleteTimers.get(p));
  const delay = Math.max(3, Math.min(600, autoPruneSec)) * 1000;
  const t = setTimeout(async () => {
    deleteTimers.delete(p);
    if (currentPath === p) return;
    playedPaths.delete(p);
    heardPaths.delete(p);
    queue = queue.filter(f => f.path !== p);
    renderDots();
    // Race defence: between the sync checks above and the IPC returning,
    // the user could have re-played the clip (priority re-queue, manual
    // click landing on a queue-updated event). Re-verify the path really
    // isn't the current one before the file is unlinked on disk.
    if (currentPath === p) return;
    try { await window.api.deleteFile(p); } catch {}
  }, delay);
  deleteTimers.set(p, t);
}

function setAutoPruneEnabled(on) {
  autoPruneEnabled = !!on;
  if (!autoPruneEnabled) {
    // Cancel all pending deletes so clips already ticking down stay put.
    for (const [, t] of deleteTimers) { clearTimeout(t); }
    deleteTimers.clear();
  } else {
    // Schedule deletes for any already-played clips (not currently playing).
    for (const f of queue) {
      if (f.path !== currentPath && playedPaths.has(f.path)) {
        scheduleAutoDelete(f.path, heardPaths.has(f.path));
      }
    }
  }
}

function cancelAutoDelete(p) {
  if (deleteTimers.has(p)) {
    clearTimeout(deleteTimers.get(p));
    deleteTimers.delete(p);
  }
}

function fmt(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function fileUrl(p) {
  return 'file:///' + p.replace(/\\/g, '/');
}

function isAudioIdle() {
  return !audio.src || audio.ended || (audio.paused && audio.currentTime === 0);
}

// renderDots is called from ~15 sites -- queue-updated events, every
// play/delete/mute/focus/index change, manual click, priority shift,
// stale-session poll. A heavy paste can fan those calls out to >100
// in a single tick, each of which rebuilds the dots DOM node from
// scratch. requestAnimationFrame coalesces to a single render per
// frame so the work matches the display refresh rate, not the event
// rate. Visible effect on 150-clip pastes: dot strip updates smoothly
// instead of flickering.
// EX7c — dot-strip rendering extracted into a DotStrip component. The
// component owns the rAF-debounce, the mute-filter, the run-gap
// clustering, and per-dot event wiring. renderDots() stays as a thin
// state-collecting wrapper so existing call sites (there are many) keep
// working without change.
const dotStrip = new window.TT_DOT_STRIP({
  clipPaths: window.TT_CLIP_PATHS,
  staleSessionPoller,
  paletteSize: PALETTE_SIZE,
  maxVisibleDots: MAX_VISIBLE_DOTS,
  onPlay: (path) => userPlay(path),
  onDelete: (path) => deleteDot(path),
});
dotStrip.mount(dotsEl);

function renderDots() {
  dotStrip.update({
    queue,
    currentPath,
    heardPaths,
    sessionAssignments,
    synthInProgress,
  });
}

function playPath(p, manual = false, userClick = false) {
  const idx = queue.findIndex(f => f.path === p);
  if (idx < 0) return false;
  cancelAutoDelete(p);
  currentPath = p;
  currentIsManual = manual;
  currentIsUserClick = userClick;
  audio.src = fileUrl(p);
  audio.currentTime = 0;
  audio.playbackRate = currentPlaybackSpeed;
  audio.play().catch(() => {});
  playedPaths.add(p);
  if (manual) heardPaths.add(p);
  pendingQueue = pendingQueue.filter(x => x !== p);
  renderDots();
  updateScrubberMode();
  return true;
}

function userPlay(p) {
  playPath(p, true, true);
}

async function deleteDot(p) {
  cancelAutoDelete(p);
  if (currentPath === p) {
    audio.pause();
    audio.src = '';
    currentPath = null;
  }
  pendingQueue = pendingQueue.filter(x => x !== p);
  playedPaths.delete(p);
  queue = queue.filter(f => f.path !== p);
  renderDots();
  await window.api.deleteFile(p);
}

// EX4 — undo-clear state. clearAllPlayed now soft-deletes: the clips
// disappear from the visible queue immediately but their actual
// fs.unlink is deferred 10 s, giving users an Undo window. Once the
// window elapses, the queued paths really get deleted. Clicking
// Undo cancels the timer and restores the removed entries to the
// queue + heardPaths + playedPaths.
const UNDO_CLEAR_WINDOW_MS = 10_000;
let _pendingClear = null;  // { entries, timer, toastEl }

function _finaliseClear() {
  if (!_pendingClear) return;
  const paths = _pendingClear.entries.map((e) => e.path);
  _pendingClear = null;
  for (const p of paths) {
    window.api.deleteFile(p).catch(() => {});
  }
}

function _removeToast() {
  if (_pendingClear && _pendingClear.toastEl) {
    try { _pendingClear.toastEl.remove(); } catch {}
    _pendingClear.toastEl = null;
  }
}

function _undoClear() {
  if (!_pendingClear) return;
  clearTimeout(_pendingClear.timer);
  _removeToast();
  // Restore state: re-insert entries into queue at their original
  // mtime order (existing queue already ordered by main.js; we'll
  // merge + the renderer's dot layout handles sort).
  const restored = _pendingClear.entries;
  _pendingClear = null;
  for (const e of restored) {
    queue.push({ path: e.path, mtime: e.mtime });
    if (e.wasHeard) heardPaths.add(e.path);
    if (e.wasPlayed) playedPaths.add(e.path);
  }
  renderDots();
}

function _showClearToast(count) {
  const toast = document.createElement('div');
  toast.className = 'tt-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.innerHTML = `<span>${count} clip${count === 1 ? '' : 's'} cleared</span>`;
  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'tt-toast-undo';
  undoBtn.textContent = 'Undo';
  undoBtn.addEventListener('click', _undoClear);
  toast.appendChild(undoBtn);
  document.body.appendChild(toast);
  return toast;
}

async function clearAllPlayed() {
  // If a prior clear is still pending, finalise it immediately before
  // opening a new undo window. Otherwise two in-flight clears would
  // race on the deleteFile calls.
  if (_pendingClear) {
    clearTimeout(_pendingClear.timer);
    _removeToast();
    _finaliseClear();
  }

  const toDelete = queue.filter((f) => heardPaths.has(f.path) && f.path !== currentPath);
  if (toDelete.length === 0) return;

  const entries = toDelete.map((f) => ({
    path: f.path,
    mtime: f.mtime,
    wasHeard: heardPaths.has(f.path),
    wasPlayed: playedPaths.has(f.path),
  }));
  const paths = entries.map((e) => e.path);

  // Remove from visible state immediately — user sees the UI react.
  for (const p of paths) {
    cancelAutoDelete(p);
    heardPaths.delete(p);
    playedPaths.delete(p);
  }
  queue = queue.filter((f) => !paths.includes(f.path));
  renderDots();

  const toastEl = _showClearToast(paths.length);
  const timer = setTimeout(() => {
    _removeToast();
    _finaliseClear();
  }, UNDO_CLEAR_WINDOW_MS);
  _pendingClear = { entries, timer, toastEl };
}

function playNextPending() {
  // 1. Priority (hey-jarvis highlight-to-speak) — always plays regardless
  //    of mute or focus; the user explicitly asked for it.
  while (priorityQueue.length > 0) {
    const next = priorityQueue.shift();
    // Keep priorityPaths in lock-step with priorityQueue: once a path
    // leaves the queue (plays or is dropped because its file is gone),
    // it is no longer "priority" and must not block its own re-queue
    // or leak into the filter at renderDots time.
    priorityPaths.delete(next);
    if (queue.find(f => f.path === next)) {
      playPath(next, true);
      return;
    }
  }
  // 2. Focus-session preference — if a session is marked focus and has
  //    unplayed, unmuted, non-stale clips, play the OLDEST of those
  //    before any other session's clips. Doesn't interrupt currently-
  //    playing clip, just tips the next-to-play decision.
  const focusShort = findFocusedSessionShort();
  if (focusShort) {
    const focusClip = queue
      .filter(f => {
        if (playedPaths.has(f.path)) return false;
        if (isPathSessionMuted(f.path)) return false;
        if (isPathSessionStale(f.path)) return false;
        const short = extractSessionShort(f.path.split(/[\\/]/).pop());
        return short === focusShort;
      })
      .sort((a, b) => a.mtime - b.mtime)[0];
    if (focusClip) {
      pendingQueue = pendingQueue.filter(p => p !== focusClip.path);
      playPath(focusClip.path);
      return;
    }
  }
  // 3. Explicit pending queue — clips queued in arrival order.
  //    Skip muted- and stale-session clips; drop the whole file
  //    (don't re-queue).
  while (pendingQueue.length > 0) {
    const next = pendingQueue.shift();
    if (isPathSessionMuted(next)) continue;
    if (isPathSessionStale(next)) continue;
    if (queue.find(f => f.path === next)) {
      playPath(next);
      return;
    }
  }
  // 4. Fallback: any unplayed, unmuted, non-stale clip still in the
  //    queue. Covers edge cases where pendingQueue drifted. Oldest first.
  const candidate = queue
    .filter(f => !playedPaths.has(f.path) && !isPathSessionMuted(f.path) && !isPathSessionStale(f.path))
    .sort((a, b) => a.mtime - b.mtime)[0];
  if (candidate) {
    playPath(candidate);
  }
}

async function initialLoad() {
  const resp = await window.api.getQueue();
  const files = Array.isArray(resp) ? resp : (resp && resp.files) || [];
  sessionAssignments = (resp && resp.assignments) || {};
  const cutoff = Date.now() - STALE_MS;
  queue = files;
  // main.js returns newest-first (getQueueFiles sorts `b.mtime - a.mtime`).
  // pendingQueue must hold clips in ARRIVAL order (oldest first) so
  // pendingQueue.shift() yields the oldest-unplayed clip and playback
  // walks the dot strip left-to-right. onQueueUpdated already sorts
  // newArrivals ascending before push; initialLoad used to skip that
  // sort, producing newest-first pending — playback started on the
  // newest clip and swept rightmost-to-leftmost until the pending
  // buffer drained. Visible on a preloaded queue (kit demo, or toolbar
  // boot with 4+ unplayed clips).
  const unplayed = files
    .filter(f => f.mtime >= cutoff)
    .sort((a, b) => a.mtime - b.mtime);
  for (const f of files) {
    if (f.mtime < cutoff) playedPaths.add(f.path);
  }
  for (const f of unplayed) {
    if (!pendingQueue.includes(f.path)) pendingQueue.push(f.path);
  }
  renderDots();
  if (isAudioIdle()) {
    playNextPending();
  }
}

window.api.onQueueUpdated((payload) => {
  const files = Array.isArray(payload) ? payload : (payload && payload.files) || [];
  if (payload && payload.assignments) {
    sessionAssignments = payload.assignments;
    if (document.body.classList.contains('settings-open')) renderSessionsTable();
  }
  const prevPaths = new Set(queue.map(f => f.path));
  const newArrivals = files
    .filter(f => !prevPaths.has(f.path) && !playedPaths.has(f.path))
    .sort((a, b) => a.mtime - b.mtime);
  queue = files;

  for (const f of newArrivals) {
    if (priorityPaths.has(f.path)) continue;
    // Drop muted-session arrivals outright — they never enter the queue.
    if (isClipSessionMuted(f.path.split(/[\\/]/).pop())) continue;
    if (!pendingQueue.includes(f.path)) pendingQueue.push(f.path);
  }
  // New unmuted clip arrived → treat as activity (expands if collapsed,
  // resets the idle countdown).
  const hasVisibleArrival = newArrivals.some(f =>
    !priorityPaths.has(f.path) && !isClipSessionMuted(f.path.split(/[\\/]/).pop())
  );
  if (hasVisibleArrival) bumpActivity();
  // If the user just muted the session of the currently-playing clip, stop.
  // Let the normal resume/ended flow pick up the next unmuted one.
  if (currentPath && isPathSessionMuted(currentPath)) {
    audio.pause();
    audio.src = '';
    const wasPlaying = currentPath;
    currentPath = null;
    currentIsManual = false;
    playedPaths.delete(wasPlaying);
  }
  renderDots();

  if (isAudioIdle()) {
    playNextPending();
  }
});

window.api.onClipboardStatus((msg) => {
  const state = msg && msg.state;
  const prev = synthInProgress;
  synthInProgress = (state === 'synth');
  if (prev !== synthInProgress) renderDots();
});

window.api.onPriorityPlay((paths) => {
  // Real clip landed -- retire the placeholder even if main hasn't
  // yet sent state=idle (races between the two IPC channels).
  if (paths && paths.length) synthInProgress = false;
  for (const p of paths) {
    priorityPaths.add(p);
    playedPaths.delete(p);
    pendingQueue = pendingQueue.filter(x => x !== p);
    if (!priorityQueue.includes(p)) priorityQueue.push(p);
  }
  if (currentPath && !currentIsManual) {
    audio.pause();
    audio.src = '';
    const wasPlaying = currentPath;
    currentPath = null;
    currentIsManual = false;
    playedPaths.delete(wasPlaying);
  }
  renderDots();
  if (isAudioIdle()) playNextPending();
});

playPauseBtn.addEventListener('click', () => {
  if (!audio.src) {
    const unheard = queue.filter(f => !heardPaths.has(f.path)).sort((a, b) => a.mtime - b.mtime);
    const next = unheard[0] || queue[0];
    if (next) playPath(next.path, true);
    return;
  }
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
});

back10Btn.addEventListener('click', () => {
  audio.currentTime = Math.max(0, audio.currentTime - 10);
});

fwd10Btn.addEventListener('click', () => {
  if (isFinite(audio.duration)) {
    audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
  }
});

// D2-9 — `.hidden` class toggle replaces the inline `style.display = 'none'`
// writes so the CSP style-src directive doesn't need 'unsafe-inline'.
function setPlayPauseIcons(isPlaying) {
  playIcon.classList.toggle('hidden', isPlaying);
  pauseIcon.classList.toggle('hidden', !isPlaying);
}
audio.addEventListener('play',  () => setPlayPauseIcons(true));
audio.addEventListener('pause', () => setPlayPauseIcons(false));
audio.addEventListener('ended', () => {
  setPlayPauseIcons(false);
  const justPlayed = currentPath;
  const wasManual = currentIsManual;
  const wasUserClick = currentIsUserClick;
  currentPath = null;
  currentIsManual = false;
  currentIsUserClick = false;
  renderDots();
  updateScrubberMode();
  // Both auto-played and manually-played clips get auto-deleted now — only
  // the delay differs (30 s auto vs 90 s manual). Previously auto-played
  // clips accumulated indefinitely, flooding the toolbar.
  if (justPlayed) scheduleAutoDelete(justPlayed, wasManual);

  // v0.3.6 — user-click continuation. When a clip started by a user
  // click ends, and the `auto_continue_after_click` setting is on
  // (default), play the next clip strictly forward in time (mtime >
  // justPlayed's) regardless of played state. Chains with userClick=true
  // so the continuation keeps honouring the setting for the whole run.
  //
  // Why not go through playNextPending's fallback branch? Fallback
  // filters out played clips — so after a full queue has been heard
  // once, fallback finds nothing and the continuation dies on the
  // first clip. Users then face a "click exercise" to re-listen.
  // This branch reads "forward in time" instead of "any unplayed",
  // so State C (everything already heard, click one to replay) works.
  //
  // State B (interrupt during auto-play by clicking mid-queue) also
  // routes here: click #3 mid-#1 → #3 plays → ended fires with
  // wasUserClick=true → next forward is #4 → plays → ...→ #N. Clips
  // #1/#2 stay unplayed; the user explicitly chose to start from #3.
  // Cleaner than the pre-v0.3.6 1→3→2→4 reshuffle.
  //
  // Priority (hey-jarvis) clips set currentIsManual=true but
  // userClick=false, so they always fall through to playNextPending
  // to preserve the existing priority-drain-then-resume behaviour.
  if (wasUserClick && autoContinueAfterClick) {
    const justPlayedClip = queue.find(f => f.path === justPlayed);
    if (justPlayedClip) {
      const next = queue
        .filter(f =>
          f.mtime > justPlayedClip.mtime &&
          !isPathSessionMuted(f.path) &&
          !isPathSessionStale(f.path)
        )
        .sort((a, b) => a.mtime - b.mtime)[0];
      if (next) {
        playPath(next.path, true, true);
        return;
      }
      // No more forward clips — chain complete, stop cleanly.
      return;
    }
  }

  // Always call playNextPending: it picks from priority → pending → fallback
  // scan of unplayed clips still sitting in queue. The old gate skipped the
  // fallback entirely when both explicit queues were empty, leaving unplayed
  // arrivals stranded after a manually-started clip ended.
  playNextPending();
});

audio.addEventListener('error', () => {
  setPlayPauseIcons(false);
  currentPath = null;
  currentIsManual = false;
  renderDots();
  updateScrubberMode();
  playNextPending();
});

// Audit R21: the browser fires `stalled` when the media element hasn't
// received data for a while, and `waiting` when readyState drops below
// HAVE_FUTURE_DATA. Under normal desktop conditions (local .mp3 files)
// these are rare -- but they DO happen when the clip file is being
// written on a slow disk, or when a USB audio device is reconnecting,
// or when antivirus software briefly blocks reads. Without these
// handlers the toolbar just stops mid-clip with no visible recovery.
//
// Strategy: wait ~3s for stall to resolve on its own (file might be
// mid-flush); if we're still stuck, skip to the next clip so the user
// isn't stranded.
let _stallRecoveryTimer = null;
function armStallRecovery(_reason) {
  if (_stallRecoveryTimer) return;  // already armed; one recovery per hang
  _stallRecoveryTimer = setTimeout(() => {
    _stallRecoveryTimer = null;
    // Only act if we're still playing the same clip and haven't made
    // forward progress (currentTime hasn't advanced since we armed).
    if (audio.src && audio.paused === false && audio.readyState < 3) {
      const p = currentPath;
      try { audio.pause(); } catch {}
      audio.src = '';
      currentPath = null;
      currentIsManual = false;
      if (p) playedPaths.add(p);      // don't loop on the same broken clip
      renderDots();
      playNextPending();
    }
  }, 3000);
}
function cancelStallRecovery() {
  if (_stallRecoveryTimer) { clearTimeout(_stallRecoveryTimer); _stallRecoveryTimer = null; }
}
audio.addEventListener('stalled', () => armStallRecovery('stalled'));
audio.addEventListener('waiting', () => armStallRecovery('waiting'));
audio.addEventListener('playing', cancelStallRecovery);
audio.addEventListener('canplay', cancelStallRecovery);
audio.addEventListener('ended', cancelStallRecovery);

// Audit R30: devicechange fires when the user plugs / unplugs headphones,
// switches default audio device, starts a Bluetooth session, etc. The
// <audio> element binds to whatever output was default at play() time --
// so if we're mid-clip when the device changes, the audio can either keep
// playing out of a now-hidden endpoint OR go silent. Re-bind by nudging
// currentTime; Chromium re-picks the default output on the next frame.
try {
  if (navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === 'function') {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      if (!audio.src || audio.ended) return;
      const wasPaused = audio.paused;
      const ct = audio.currentTime;
      try {
        audio.currentTime = Math.max(0, ct - 0.001);
        if (!wasPaused) audio.play().catch(() => {});
      } catch {}
    });
  }
} catch {}

// Scrubber mascot positioning + state. The native <input type="range">
// thumb is transparent; the visible mascot is an <svg> overlay we
// position by setting its .style.left based on scrubber.value. Native
// slider thumbs are positioned so their CENTRE travels from
// (rail_left + thumb_half_width) to (rail_right - thumb_half_width), so
// we match that math or the mascot drifts off the rail at the ends.
const MASCOT_W = 20;
function positionScrubberMascot() {
  if (!scrubberMascot) return;
  const pct = Number(scrubber.value) / Number(scrubber.max || 1000);
  const rail = scrubber.getBoundingClientRect();
  const wrap = scrubberWrap.getBoundingClientRect();
  const usable = Math.max(0, rail.width - MASCOT_W);
  const xInRail = (MASCOT_W / 2) + pct * usable;
  const leftPx = (rail.left - wrap.left) + xInRail;
  setDynamicStyle('#scrubberMascot', `left: ${leftPx}px;`);
  // Keep the Jarvis badge on the same rail position -- one of the two is
  // always hidden by the .jarvis-mode class, so positioning both is cheap.
  if (scrubberJarvis) setDynamicStyle('#scrubberJarvis', `left: ${leftPx}px;`);
}

// The mascot is intentionally reserved for Claude Code responses. When the
// currently-playing audio originated from a highlight-to-speak trigger
// ("hey jarvis" or Ctrl+Shift+S) -- identified by the `-clip-` filename
// segment -- swap the mascot for a plain "J" badge so the mascot's visual
// identity stays tied to Claude-sourced content. Called whenever currentPath
// changes (playPath, onPriorityPlay, clip-end, error).
function updateScrubberMode() {
  if (!scrubberWrap) return;
  const name = currentPath ? currentPath.split(/[\\/]/).pop() : '';
  const jarvis = !!name && isClipFile(name);
  scrubberWrap.classList.toggle('jarvis-mode', jarvis);
}

// Scrubber + time-readout smooth updater. Built-in `timeupdate` only
// fires ~4×/sec → the mascot visibly jumped in 250ms chunks. Drive it
// from requestAnimationFrame for buttery motion. rAF auto-pauses on
// hidden windows (no CPU wasted when the bar isn't visible).
let scrubberRafId = null;
function syncScrubberFromAudio() {
  if (!userScrubbing && isFinite(audio.duration) && audio.duration > 0) {
    scrubber.value = Math.round((audio.currentTime / audio.duration) * 1000);
    timeEl.textContent = `${fmt(audio.currentTime)} / ${fmt(audio.duration)}`;
  } else if (!userScrubbing) {
    timeEl.textContent = `${fmt(audio.currentTime)} / 0:00`;
  }
  positionScrubberMascot();
}
// Trail emission — every 850–1500 ms (jittered) while audio is playing
// forward, drop a random spinner verb just behind the mascot. The word
// is absolutely positioned inside scrubberWrap; once placed, it stays
// put while the mascot continues walking forward, so the words look like
// a trail he's leaving behind. Auto-removed on animationend.
let nextVerbEmitAt = 0;
function emitSpinnerVerbCloud(now) {
  if (!scrubberWrap || !scrubberMascot) return;
  if (audio.paused || audio.ended || userScrubbing) return;
  if (now < nextVerbEmitAt) return;
  // Compute mascot's current x relative to the wrap (same math as
  // positionScrubberMascot) so the cloud spawns directly above his head.
  const rail = scrubber.getBoundingClientRect();
  const wrap = scrubberWrap.getBoundingClientRect();
  if (wrap.width <= 0) return;
  const pct = Number(scrubber.value) / Number(scrubber.max || 1000);
  const usable = Math.max(0, rail.width - MASCOT_W);
  const mascotX = (rail.left - wrap.left) + (MASCOT_W / 2) + pct * usable;

  const word = document.createElement('span');
  word.className = 'scrubber-trail-word';
  word.textContent = randomVerb();
  // Anchor the cloud's x at the mascot's centre. The CSS animation's
  // translate(-50%, …) centres the text on that point, then drifts it
  // upward with a gentle left-right sway so it reads as a thought-
  // cloud floating off his head, not a speech bubble pinned behind him.
  // D2-9 — each word gets a unique id + a rule in the Constructable
  // Stylesheet; the animationend handler removes both the element and
  // the rule so the adopted sheet stays bounded.
  const wordId = 'sp-w-' + (++spinnerWordCounter);
  word.id = wordId;
  setDynamicStyle(`#${wordId}`, `left: ${mascotX}px;`);
  scrubberWrap.appendChild(word);
  word.addEventListener('animationend', () => {
    word.remove();
    setDynamicStyle(`#${wordId}`, null);
  }, { once: true });

  nextVerbEmitAt = now + 850 + Math.random() * 650;
}

function scrubberTick() {
  syncScrubberFromAudio();
  emitSpinnerVerbCloud(performance.now());
  if (!audio.paused && !audio.ended) {
    scrubberRafId = requestAnimationFrame(scrubberTick);
  } else {
    scrubberRafId = null;
  }
}
function startScrubberRaf() {
  if (scrubberRafId === null) scrubberRafId = requestAnimationFrame(scrubberTick);
}
audio.addEventListener('play', () => {
  scrubberWrap && scrubberWrap.classList.add('walking');
  startScrubberRaf();
});
audio.addEventListener('playing', () => {
  scrubberWrap && scrubberWrap.classList.add('walking');
  startScrubberRaf();
});
audio.addEventListener('pause', () => {
  scrubberWrap && scrubberWrap.classList.remove('walking');
  syncScrubberFromAudio();
});
audio.addEventListener('ended', () => {
  scrubberWrap && scrubberWrap.classList.remove('walking');
  syncScrubberFromAudio();
});
audio.addEventListener('seeking', syncScrubberFromAudio);
audio.addEventListener('timeupdate', () => {
  if (scrubberRafId === null) syncScrubberFromAudio();
});
audio.addEventListener('loadedmetadata', () => {
  timeEl.textContent = `0:00 / ${fmt(audio.duration)}`;
});
// Re-position on window resize (bar resizes when settings panel opens).
window.addEventListener('resize', positionScrubberMascot);
// Initial position on load.
positionScrubberMascot();

// ----- Drag-direction detection ------------------------------------------
// While userScrubbing, track whether .value is increasing or decreasing.
// Set .scrubbing-forward / .scrubbing-backward on the wrap so CSS can
// sweep the legs left/right (and 180°-flip the whole mascot when going
// backward, smile → frown = angry). Classes clear on mouseup or after a
// 160 ms idle with no further input, so he doesn't get stuck frowning.
let lastScrubberValue = 0;
let scrubDirTimer = null;
function clearScrubDir() {
  scrubberWrap && scrubberWrap.classList.remove('scrubbing', 'scrubbing-forward', 'scrubbing-backward');
  scrubDirTimer = null;
}
function setScrubDir(dir) {
  if (!scrubberWrap) return;
  scrubberWrap.classList.add('scrubbing');
  if (dir > 0) {
    scrubberWrap.classList.add('scrubbing-forward');
    scrubberWrap.classList.remove('scrubbing-backward');
  } else if (dir < 0) {
    scrubberWrap.classList.add('scrubbing-backward');
    scrubberWrap.classList.remove('scrubbing-forward');
  }
  if (scrubDirTimer) clearTimeout(scrubDirTimer);
  scrubDirTimer = setTimeout(clearScrubDir, 160);
}

scrubber.addEventListener('mousedown', () => {
  userScrubbing = true;
  lastScrubberValue = Number(scrubber.value);
});
scrubber.addEventListener('mouseup', () => {
  if (isFinite(audio.duration)) {
    audio.currentTime = (scrubber.value / 1000) * audio.duration;
  }
  userScrubbing = false;
  clearScrubDir();
  positionScrubberMascot();
});
scrubber.addEventListener('input', () => {
  const newVal = Number(scrubber.value);
  const dir = newVal - lastScrubberValue;
  if (dir !== 0) setScrubDir(dir);
  lastScrubberValue = newVal;
  if (isFinite(audio.duration)) {
    const t = (scrubber.value / 1000) * audio.duration;
    timeEl.textContent = `${fmt(t)} / ${fmt(audio.duration)}`;
  }
  positionScrubberMascot();
});
// Keyboard arrows fire 'change' not 'input' on some Chromium builds —
// catch both so keyboard seeking also flips the mascot correctly.
scrubber.addEventListener('change', () => {
  positionScrubberMascot();
});

function playToggleTone(on) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const play = (freq, start, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + start + 0.01);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + start + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration);
    };
    if (on) { play(660, 0, 0.12); play(880, 0.1, 0.14); }
    else { play(880, 0, 0.12); play(440, 0.1, 0.16); }
    setTimeout(() => ctx.close(), 500);
  } catch {}
}
window.api.onListeningState((on) => playToggleTone(on));

closeBtn.addEventListener('click', () => window.api.hideWindow());
clearPlayedBtn.addEventListener('click', () => clearAllPlayed());

document.addEventListener('contextmenu', (e) => {
  if (!e.target.classList || !e.target.classList.contains('dot')) {
    e.preventDefault();
  }
});

document.addEventListener('keydown', (e) => {
  // Don't hijack keys when the user is typing in an input/select (session labels, etc.)
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  // Belt-and-braces: only respond when the toolbar window is truly focused
  // by the OS. Without this, a click on the bar can leave Windows thinking
  // the toolbar still has focus even after you've moved on to another app,
  // and a Space/Arrow you typed into the terminal would get caught here.
  if (!document.hasFocus()) return;
  // Escape hides the window — safe to keep because you'd never press Escape
  // mid-sentence while typing. Space and Arrow keys were removed: too easy
  // to fire accidentally while typing in another app that the toolbar had
  // most-recent focus on. Use the on-screen Play button or configure
  // Ctrl+Shift+P / Ctrl+Shift+O as global pause hotkeys in config.json.
  if (e.key === 'Escape') window.api.hideWindow();
});

// ============================================================================
// Settings panel -- expanded view below the toolbar letterbox.
// ============================================================================

let currentPlaybackSpeed = 1.25; // updated from config on load

// Edge + OpenAI voice catalogues come from app/lib/voices.json via the
// generated voices-window.js (loaded in index.html before this file).
// The R1.7-style parity test in run-tests.cjs asserts the generated JS
// matches the JSON byte-for-byte. scripts/verify-voices.cjs is the
// escape hatch for "did Microsoft add/remove a voice" — runs weekly in
// CI against `python -m edge_tts --list-voices`.
const { edge: EDGE_VOICES, openai: OPENAI_VOICES } = window.TT_VOICES;

const settingsBtn = document.getElementById('settingsBtn');
const sessionsTableEl = document.getElementById('sessionsTable');
// EX7d-2 — speedSlider, speedValueEl, voice*El, incBoxes, and
// fillVoiceSelect all moved into SettingsForm. The SettingsForm
// component queries these DOM refs internally on mount.

const INCLUDE_LABELS = [
  ['code_blocks',    'Code blocks'],
  ['inline_code',    'Inline code'],
  ['urls',           'URLs'],
  ['headings',       'Headings'],
  ['bullet_markers', 'Bullet markers'],
  ['image_alt',      'Image alt-text']
];

// EX7d-1 — sessions table (per-session rows with label/palette/focus/
// mute/remove + expandable voice + tri-state includes) extracted into
// a SessionsTable component. The component owns expandedSessions,
// paletteOptionsClone caching, arrangementLabel text, and the
// focus-bail guard. renderer.js keeps a renderSessionsTable() wrapper
// so existing call sites that repaint after local state mutation keep
// working.
const sessionsTable = new window.TT_SESSIONS_TABLE({
  clipPaths: window.TT_CLIP_PATHS,
  staleSessionPoller,
  paletteSize: PALETTE_SIZE,
  colourNames: COLOUR_NAMES,
  hsplitPartner: HSPLIT_PARTNER,
  vsplitPartner: VSPLIT_PARTNER,
  edgeVoices: EDGE_VOICES,
  includeLabels: INCLUDE_LABELS,
  onSetLabel:   (shortId, label) => window.api.setSessionLabel(shortId, label),
  onSetIndex:   (shortId, idx)   => window.api.setSessionIndex(shortId, idx),
  onSetFocus:   (shortId, focus) => window.api.setSessionFocus(shortId, focus),
  onSetMuted:   (shortId, muted) => window.api.setSessionMuted(shortId, muted),
  onRemove:     (shortId)        => window.api.removeSession(shortId),
  onSetVoice:   (shortId, voice) => window.api.setSessionVoice(shortId, voice),
  onSetInclude: (shortId, k, v)  => window.api.setSessionInclude(shortId, k, v),
  onAfterMutation: () => renderDots(),
});
sessionsTable.mount(sessionsTableEl);

function renderSessionsTable() {
  sessionsTable.update({ sessionAssignments });
}


// EX7d-2 — global settings form (speed slider / auto-prune / auto-
// continue / reload button / palette variant / global voice selects /
// speech-includes checkboxes) extracted into a SettingsForm component.
// The component owns all listener wiring (done once at mount) and
// form population (done whenever cfg changes). Renderer module state
// that callers consume elsewhere (currentPlaybackSpeed for <audio>,
// autoPruneSec for the clip delete timer, autoContinueAfterClick for
// the ended handler) propagates back via the onChange callbacks.
const settingsForm = new window.TT_SETTINGS_FORM({
  api: window.api,
  edgeVoices: EDGE_VOICES,
  openaiVoices: OPENAI_VOICES,
  onPlaybackSpeedChange: (v) => {
    currentPlaybackSpeed = v;
    if (audio) audio.playbackRate = v;
  },
  onAutoPruneEnabledChange: (on) => setAutoPruneEnabled(on),
  onAutoPruneSecChange: (n) => { autoPruneSec = n; },
  onAutoContinueChange: (on) => { autoContinueAfterClick = on; },
});
settingsForm.mount();

async function loadSettings() {
  const cfg = await window.api.getConfig();
  if (!cfg) return;
  settingsForm.update({ cfg });
}

settingsBtn.addEventListener('click', async () => {
  const open = !document.body.classList.contains('settings-open');
  document.body.classList.toggle('settings-open', open);
  settingsOpen = open;
  settingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  await window.api.setPanelOpen(open);
  if (open) {
    applyCollapsed(false);
    renderSessionsTable();
  }
  // settingsOpen flag (set above) keeps the poll from collapsing while
  // the panel is up. When closed, the poll picks up normally.
});

// -------------------------------------------------------------------
// Hover + interaction triggers for collapse/expand
// -------------------------------------------------------------------
// mousemove: update cursor position, toggle click-through on the fly
// so clicks in the transparent margin / outside the visible bar pass
// through to apps below. Expansion + activity bump also happen here
// when the cursor is actually over the bar.
document.addEventListener('mousemove', (e) => {
  cursorX = e.clientX;
  cursorY = e.clientY;
  updateClickthrough();
  if (isMouseOverBar()) bumpActivity();
});
// Click on the toolbar = user actively engaging → reset inactivity timer.
// NB: we deliberately do NOT listen for keydown at the window level.
// The toolbar is a floating widget; when it gets focus, any window-level
// keydown listener swallows keystrokes that the user intended for their
// actual app (arrow keys / scrolling / typing in Claude Code). Settings
// panel inputs have their own focus/change handlers — they don't need
// the window-level listener.
barEl.addEventListener('click', bumpActivity);
// When main toggles visibility via the global hotkey, guarantee we're
// expanded so the user can actually see and interact with the bar.
if (window.api.onForceExpand) {
  window.api.onForceExpand(() => { bumpActivity(); });
}
// Ctrl+Shift+P — toggle pause/resume (manual control).
if (window.api.onTogglePausePlayback) {
  window.api.onTogglePausePlayback(() => {
    if (!audio.src || audio.ended) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
    bumpActivity();
  });
}
// Ctrl+Shift+O — pause-only (safe for dictation chains: NEVER resumes).
// Firing this when nothing is playing, or when already paused, is a no-op.
// That means an AutoHotkey / PowerToys chain from Ctrl+Win can fire it
// every time Wispr Flow activates without ever accidentally starting
// playback that the user had paused deliberately.
if (window.api.onPausePlaybackOnly) {
  window.api.onPausePlaybackOnly(() => {
    if (!audio.src || audio.ended || audio.paused) return;
    audio.pause();
    bumpActivity();
  });
}
// Dock-edge class. Main.js sends { kind: 'horizontal', edge: 'top'|'bottom' }
// after a snap — vertical mode was removed so we just track which horizontal
// edge we're glued to (for the dock-bottom rule in styles.css that flattens
// the bottom corners). Kept the IPC for forward-compat with future dock
// variants; `kind` is ignored.
if (window.api.onSetOrientation) {
  window.api.onSetOrientation(({ edge }) => {
    document.body.classList.remove('dock-top', 'dock-bottom');
    if (edge === 'top' || edge === 'bottom') document.body.classList.add(`dock-${edge}`);
  });
}

// Don't auto-collapse on startup — user needs to see the toolbar first.
// The collapse cycle starts on the first mouseleave or new-clip arrival.
loadSettings();

initialLoad();
