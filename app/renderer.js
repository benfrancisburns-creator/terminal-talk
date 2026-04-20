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

// Poll dead-session state every 10 s. The user's complaint was that
// closing a terminal didn't visibly update the UI — this ensures the
// row greys out within 10 s of the PID going away. Cheap IPC; no
// renders if nothing changed.
async function pollStaleSessions() {
  try {
    const stale = await window.api.getStaleSessions();
    const next = new Set(Array.isArray(stale) ? stale : []);
    let changed = next.size !== staleSessionShorts.size;
    if (!changed) {
      for (const s of next) if (!staleSessionShorts.has(s)) { changed = true; break; }
    }
    if (changed) {
      staleSessionShorts = next;
      if (document.body.classList.contains('settings-open')) renderSessionsTable();
      renderDots();
    }
  } catch {}
}
setInterval(pollStaleSessions, 10_000);
// Run once on boot so first paint isn't stuck at "all alive".
setTimeout(pollStaleSessions, 500);

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
let priorityQueue = [];
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
  BASE_COLOURS,
  PALETTE_SIZE,
  NEUTRAL_COLOUR,
  HSPLIT_PARTNER,
  VSPLIT_PARTNER,
  COLOUR_NAMES,
} = window.TT_TOKENS.palette;

// Assignments registry (session_short -> { index }) provided by main via IPC.
let sessionAssignments = {};

// Shortlist of sessions whose backing terminal has closed. Populated by a
// 10 s poll of main's get-stale-sessions IPC. Used ONLY to grey out the
// session row and its dots — the registry itself isn't touched, so the
// user's colour pick is preserved if the terminal reopens.
let staleSessionShorts = new Set();

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
// (staleSessionShorts set by the 10 s get-stale-sessions poll) should
// not auto-play. The dot is still clickable so the user can hear it
// manually; auto-play just skips closed-session clips the same way it
// skips muted ones. Prevents phantom audio from detached late-arriving
// synth jobs or leaked test fixtures.
function isPathSessionStale(p) {
  const short = extractSessionShort(p.split(/[\\/]/).pop());
  return !!(short && staleSessionShorts.has(short));
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
//   0-7   solid    one colour
//   8-15  hsplit   top/bottom two-colour split
//   16-23 vsplit   left/right two-colour split
//   24-31 quad     four-quadrant pattern
// Offsets (4/3/2) chosen so no two indices render identically.
function arrangementForIndex(idx) {
  const i = ((idx % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
  if (i < 8) return { kind: 'solid', colours: [BASE_COLOURS[i]] };
  if (i < 16) {
    const p = i - 8;
    return { kind: 'hsplit', colours: [BASE_COLOURS[p], BASE_COLOURS[HSPLIT_PARTNER[p]]] };
  }
  const p = i - 16;
  return { kind: 'vsplit', colours: [BASE_COLOURS[p], BASE_COLOURS[VSPLIT_PARTNER[p]]] };
}

function backgroundForArrangement(arr) {
  if (!arr) return NEUTRAL_COLOUR;
  const c = arr.colours;
  switch (arr.kind) {
    case 'solid':  return c[0];
    case 'hsplit': return `linear-gradient(to bottom, ${c[0]} 50%, ${c[1]} 50%)`;
    case 'vsplit': return `linear-gradient(to right,  ${c[0]} 50%, ${c[1]} 50%)`;
    default: return c[0];
  }
}

// Primary colour = first colour in the arrangement; used for active/heard rings.
function primaryColourForArrangement(arr) {
  return arr && arr.colours ? arr.colours[0] : NEUTRAL_COLOUR;
}

// D2-9 — palette key (`'00'` .. `'23'` or `'neutral'`) for CSS attribute
// selector. Generated rules in app/lib/palette-classes.css match on
// [data-palette="<key>"] so the renderer can style dots + swatches
// without setting `element.style.background` (which would require
// `'unsafe-inline'` in the CSP style-src directive).
function paletteKeyForIndex(idx) {
  if (!Number.isInteger(idx)) return 'neutral';
  const i = ((idx % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
  return String(i).padStart(2, '0');
}
function paletteKeyForShort(shortId) {
  if (!shortId || shortId.length < 4) return 'neutral';
  const entry = sessionAssignments[shortId];
  if (entry && Number.isInteger(entry.index)) return paletteKeyForIndex(entry.index);
  let sum = 0;
  for (let i = 0; i < shortId.length; i++) sum += shortId.charCodeAt(i);
  return paletteKeyForIndex(sum);
}

function arrangementForShort(shortId) {
  if (!shortId || shortId.length < 4) return null;
  const entry = sessionAssignments[shortId];
  if (entry && Number.isInteger(entry.index)) {
    return arrangementForIndex(entry.index);
  }
  let sum = 0;
  for (let i = 0; i < shortId.length; i++) sum += shortId.charCodeAt(i);
  return arrangementForIndex(sum);
}

// Back-compat: callers that still want a single colour string get the primary.
function sessionColourFromShort(shortId) {
  if (!shortId || shortId.length < 4) return NEUTRAL_COLOUR;
  return primaryColourForArrangement(arrangementForShort(shortId));
}

function extractSessionShort(filename) {
  // Try the MORE SPECIFIC clip pattern first. A pathological filename
  // like `deadbeef-clip-12345678.mp3` matches both patterns; the clip
  // pattern's intended parse is `deadbeef`, but the response pattern
  // would return `12345678`. Specificity-first ordering avoids this
  // ambiguity even though the canonical filenames today never collide.
  // Audit G11.
  let m = filename.match(/-clip-([a-f0-9]{8}|neutral)-\d+\.(wav|mp3)$/i);
  if (m) return m[1].toLowerCase() === 'neutral' ? null : m[1].toLowerCase();
  // Response / question / notif: ends with -<8hex>.ext
  m = filename.match(/-([a-f0-9]{8})\.(wav|mp3)$/i);
  if (m) return m[1].toLowerCase();
  return null;
}

function isClipFile(filename) {
  return /-clip-/.test(filename);
}

function dotColour(filePath) {
  const name = filePath.split(/[\\/]/).pop();
  return sessionColourFromShort(extractSessionShort(name));
}

// Auto-prune toggle. true = 20 s after play, clips disappear on their own.
// false = clips stack up until user clears them (useful when walking away
// from the machine and wanting to review on return).
let autoPruneEnabled = true;

function scheduleAutoDelete(p, wasManual = false) {
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
    for (const [p, t] of deleteTimers) { clearTimeout(t); }
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
let _renderDotsQueued = false;
function renderDots() {
  if (_renderDotsQueued) return;
  _renderDotsQueued = true;
  requestAnimationFrame(() => {
    _renderDotsQueued = false;
    _renderDotsNow();
  });
}
// Synchronous paint is exposed for the single call site that needs
// immediate result (the Playwright harness and the next-clip scheduling
// loop, which reads fresh DOM layout right after renderDots()). Prefer
// renderDots() everywhere else.
function renderDotsNow() { _renderDotsQueued = false; _renderDotsNow(); }
function _renderDotsNow() {
  dotsEl.innerHTML = '';
  // Muted sessions' clips are hidden entirely — no dot, no trace. "Cut the
  // wire" per Ben: the user should not be aware a background muted terminal
  // is even producing audio.
  //
  // Order: oldest-left → newest-right so the row reads left-to-right in the
  // same direction playback flows. queue comes in from main.js sorted newest
  // first, so reverse and then take the freshest MAX_VISIBLE_DOTS.
  const unmuted = queue.filter(f => {
    const name = f.path.split(/[\\/]/).pop();
    return !isClipSessionMuted(name);
  });
  // Keep the N newest, then reverse so oldest is leftmost in the displayed row.
  const visible = unmuted.slice(0, MAX_VISIBLE_DOTS).slice().reverse();
  // Session run grouping: insert a small gap whenever the session shortId
  // changes between consecutive clips. Renders as visual clusters —
  // [T1][T1][T1] | [T2] | [T1][T1] — so the user can see at a glance which
  // terminal said what, while playback order stays strictly chronological
  // (oldest first) so real-time urgency isn't lost behind a chatty session.
  let prevShort = undefined;
  visible.forEach((f) => {
    const fname = f.path.split(/[\\/]/).pop();
    const thisShort = extractSessionShort(fname);
    if (prevShort !== undefined && thisShort !== prevShort) {
      const gap = document.createElement('span');
      gap.className = 'dots-run-gap';
      dotsEl.appendChild(gap);
    }
    prevShort = thisShort;
    const dot = document.createElement('button');
    dot.className = 'dot';
    dot.setAttribute('role', 'listitem');
    dot.type = 'button';
    if (f.path === currentPath) dot.classList.add('active');
    const name = f.path.split(/[\\/]/).pop();
    const short = extractSessionShort(name);
    if (isClipFile(name)) {
      dot.classList.add('clip');
      dot.textContent = 'J';
    }
    if (heardPaths.has(f.path)) dot.classList.add('heard');
    // D2-9 — data-palette attribute drives both the non-heard background
    // and the heard ring colour via rules in app/lib/palette-classes.css.
    // Replaces the previous `dot.style.background = ...` /
    // `dot.style.boxShadow = ...` writes so the CSP style-src directive
    // no longer needs 'unsafe-inline'.
    dot.dataset.palette = paletteKeyForShort(short);
    // Dead-terminal signal: desaturate the dot so the user can tell at a
    // glance which clips originated from a closed session. The clip is
    // still playable and the colour is preserved — just dimmer.
    if (short && staleSessionShorts.has(short)) {
      dot.classList.add('stale');
    }
    const entry = short ? sessionAssignments[short] : null;
    const label = entry && entry.label ? ` [${entry.label}]` : '';
    const d = new Date(f.mtime);
    const staleMark = (short && staleSessionShorts.has(short)) ? ' (closed)' : '';
    const titleText = `Created ${d.toLocaleTimeString()}${label}${staleMark} — click to play, right-click to delete`;
    dot.title = titleText;
    dot.setAttribute('aria-label', titleText);
    if (f.path === currentPath) dot.setAttribute('aria-current', 'true');
    dot.addEventListener('click', () => userPlay(f.path));
    dot.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      deleteDot(f.path);
    });
    dotsEl.appendChild(dot);
  });
  // R6.3: placeholder dot while edge-tts is synthesising from a wake-word
  // or Ctrl+Shift+S trigger. Removed the moment a priority-play arrives
  // (onPriorityPlay flips the flag) or main fires state=idle in finally.
  if (synthInProgress) {
    const placeholder = document.createElement('span');
    placeholder.className = 'dot pending-synth';
    placeholder.title = 'Listening -- synth in progress';
    placeholder.setAttribute('aria-label', 'Synthesis in progress');
    dotsEl.appendChild(placeholder);
  }
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

async function clearAllPlayed() {
  const toDelete = queue.filter(f => heardPaths.has(f.path) && f.path !== currentPath).map(f => f.path);
  for (const p of toDelete) {
    cancelAutoDelete(p);
    heardPaths.delete(p);
    playedPaths.delete(p);
    try { await window.api.deleteFile(p); } catch {}
  }
  queue = queue.filter(f => !toDelete.includes(f.path));
  renderDots();
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
function armStallRecovery(reason) {
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
const speedSlider = document.getElementById('speedSlider');
const speedValueEl = document.getElementById('speedValue');
const sessionsTableEl = document.getElementById('sessionsTable');
const voiceEdgeResponseEl = document.getElementById('voiceEdgeResponse');
const voiceEdgeClipEl = document.getElementById('voiceEdgeClip');
const voiceOpenaiResponseEl = document.getElementById('voiceOpenaiResponse');
const voiceOpenaiClipEl = document.getElementById('voiceOpenaiClip');
const incBoxes = {
  code_blocks: document.getElementById('incCode'),
  inline_code: document.getElementById('incInlineCode'),
  urls: document.getElementById('incUrls'),
  headings: document.getElementById('incHeadings'),
  bullet_markers: document.getElementById('incBullets'),
  image_alt: document.getElementById('incImages')
};

function fillVoiceSelect(el, list, selected) {
  el.innerHTML = '';
  // Include the selected value even if not in the curated list.
  const pool = list.slice();
  if (selected && !pool.find(v => v.id === selected)) pool.unshift({ id: selected, label: selected });
  for (const v of pool) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.label;
    if (v.id === selected) opt.selected = true;
    el.appendChild(opt);
  }
}

// COLOUR_NAMES is supplied by window.TT_TOKENS.palette (destructured at the top of this file).
function arrangementLabel(i) {
  if (i < 8) return `${COLOUR_NAMES[i]}`;
  if (i < 16) {
    const p = i - 8;
    return `${COLOUR_NAMES[p]} / ${COLOUR_NAMES[HSPLIT_PARTNER[p]]} — top/bottom`;
  }
  const p = i - 16;
  return `${COLOUR_NAMES[p]} / ${COLOUR_NAMES[VSPLIT_PARTNER[p]]} — left/right`;
}

// Tracks which session rows the user has expanded (open across re-renders).
const expandedSessions = new Set();

const INCLUDE_LABELS = [
  ['code_blocks',    'Code blocks'],
  ['inline_code',    'Inline code'],
  ['urls',           'URLs'],
  ['headings',       'Headings'],
  ['bullet_markers', 'Bullet markers'],
  ['image_alt',      'Image alt-text']
];

// Cached <option> template for the per-session palette selector. The
// palette is immutable at runtime (24 arrangements) and the label text
// for each index is pure, so we can build the option list once and
// clone it into every rerender instead of doing 24 createElement +
// appendChild calls per row every time a queue event fires. Audit Z11.
let _paletteOptionsFragment = null;
function paletteOptionsClone() {
  if (!_paletteOptionsFragment) {
    _paletteOptionsFragment = document.createDocumentFragment();
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = arrangementLabel(i);
      _paletteOptionsFragment.appendChild(opt);
    }
  }
  return _paletteOptionsFragment.cloneNode(true);
}

function renderSessionsTable() {
  // Guard against yanking focus out from under the user. If any control
  // inside the sessions table currently has keyboard / dropdown focus,
  // a full innerHTML clear here would destroy it mid-interaction:
  //   - typing in the label input would suddenly lose its caret,
  //   - the palette <select> dropdown would snap shut before the user
  //     picked an option.
  // A background queue-updated event can land at any moment, so we
  // simply skip the paint and defer to the next one. Nothing depends
  // on immediacy here: the next event (or explicit re-render after a
  // user action) will repaint. Audit Z11.
  //
  // D2-10 closure note. This focus-bail pattern is the intentional
  // alternative to full keyed-reconciliation (morphdom-lite) against
  // a 10-row table. The remaining rebuild-cost state that reconciliation
  // would preserve (scroll position, active-dot pulse phase) isn't
  // user-actionable at this scale; the bail covers every interactive
  // case (focus + caret + in-progress label + open dropdown). Full
  // morphdom remains a v0.4+ option if the state-loss surface grows.
  const focused = document.activeElement;
  if (focused && sessionsTableEl.contains(focused)
      && (focused.tagName === 'INPUT' || focused.tagName === 'SELECT')) {
    return;
  }
  sessionsTableEl.innerHTML = '';
  const entries = Object.entries(sessionAssignments);
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sessions-empty';
    empty.textContent = 'No active Claude Code sessions. Open a Claude Code terminal to see one here.';
    sessionsTableEl.appendChild(empty);
    return;
  }
  entries.sort((a, b) => (a[1].index || 0) - (b[1].index || 0));
  for (const [shortId, entry] of entries) {
    sessionsTableEl.appendChild(renderSessionRow(shortId, entry));
  }
}

function renderSessionRow(shortId, entry) {
  const wrap = document.createElement('div');
  wrap.className = 'session-block';
  wrap.setAttribute('role', 'row');
  if (staleSessionShorts.has(shortId)) {
    wrap.classList.add('stale');
    wrap.title = 'Terminal closed — colour preserved in case you reopen it';
  }

  // Top row: chevron, swatch, short, label, colour
  const row = document.createElement('div');
  row.className = 'session-row';

  const chevron = document.createElement('button');
  chevron.type = 'button';
  chevron.className = 'chevron icon-btn';
  const expanded = expandedSessions.has(shortId);
  chevron.innerHTML = expanded
    ? '<svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>'
    : '<svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg>';
  chevron.title = 'Per-session settings';
  chevron.setAttribute('aria-label', expanded ? 'Collapse session settings' : 'Expand session settings');
  chevron.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  row.appendChild(chevron);

  const swatch = document.createElement('div');
  swatch.className = 'swatch';
  swatch.setAttribute('role', 'img');
  swatch.setAttribute('aria-label', `Colour swatch for session ${shortId}`);
  swatch.dataset.palette = paletteKeyForIndex(entry.index || 0);
  row.appendChild(swatch);

  const shortEl = document.createElement('div');
  shortEl.className = 'short';
  shortEl.textContent = shortId;
  row.appendChild(shortEl);

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.placeholder = 'Label (e.g. "Tax module")';
  // Set BOTH the attribute and the property. The attribute is what HTML
  // selectors like input[value="Primary"] match against (Playwright tests
  // rely on it); the property is what the input actually displays. Keep
  // them in sync at construction time.
  const labelValue = entry.label || '';
  labelInput.value = labelValue;
  labelInput.setAttribute('value', labelValue);
  labelInput.addEventListener('change', () => {
    window.api.setSessionLabel(shortId, labelInput.value.trim());
  });
  row.appendChild(labelInput);

  const select = document.createElement('select');
  select.appendChild(paletteOptionsClone());
  select.value = String(entry.index || 0);
  select.addEventListener('change', async () => {
    const newIdx = Number(select.value);
    await window.api.setSessionIndex(shortId, newIdx);
    sessionAssignments[shortId].index = newIdx;
    sessionAssignments[shortId].pinned = true;
    renderSessionsTable();
    // Also repaint the dot strip — any currently-queued clips from this
    // session should recolour to the new arrangement. Previously only
    // the session row rerendered; the dots stayed the old colour until
    // the next unrelated queue event. Matches the focus/mute handlers.
    renderDots();
  });
  row.appendChild(select);

  // Focus toggle. Star button — clicking marks this session as priority;
  // its unplayed clips jump ahead of other sessions' clips in the playback
  // queue (but never interrupt a currently-playing clip). Main.js enforces
  // exclusivity: only one session can be focused at a time, so clicking
  // here clears focus on every other row.
  const focusBtn = document.createElement('button');
  focusBtn.type = 'button';
  focusBtn.className = 'focus-btn' + (entry.focus ? ' focused' : '');
  focusBtn.textContent = entry.focus ? '\u2605' : '\u2606';  // ★ / ☆
  focusBtn.title = entry.focus
    ? 'Unfocus this session (its clips lose priority)'
    : 'Focus this session — its clips play before other sessions\' clips';
  focusBtn.setAttribute('aria-label', focusBtn.title);
  focusBtn.setAttribute('aria-pressed', entry.focus ? 'true' : 'false');
  focusBtn.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    // main.js updates the registry and fires notifyQueue() synchronously
    // after save, which delivers authoritative assignments back to us via
    // the queue-updated listener. Any local mutation here would just be a
    // second source of truth -- and a subtly wrong one, since `entry` was
    // captured at render time and may be stale if the user clicked twice
    // in quick succession.
    await window.api.setSessionFocus(shortId, !entry.focus);
  });
  row.appendChild(focusBtn);

  // Mute toggle. Always visible in the top row so users can one-click mute
  // background terminals. Uses 🔇 / 🔊 to make the state obvious at a glance;
  // the row also gets a muted class for a subtle fade.
  const muteBtn = document.createElement('button');
  muteBtn.type = 'button';
  muteBtn.className = 'mute-btn' + (entry.muted ? ' muted' : '');
  muteBtn.textContent = entry.muted ? '\uD83D\uDD07' : '\uD83D\uDD0A';  // 🔇 / 🔊
  muteBtn.title = entry.muted ? 'Unmute this session' : 'Mute this session (no audio, no synthesis)';
  muteBtn.setAttribute('aria-label', muteBtn.title);
  muteBtn.setAttribute('aria-pressed', entry.muted ? 'true' : 'false');
  muteBtn.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const next = !entry.muted;
    const ok = await window.api.setSessionMuted(shortId, next);
    if (ok) {
      sessionAssignments[shortId].muted = next;
      renderSessionsTable();
      renderDots();
    }
  });
  row.appendChild(muteBtn);

  if (entry.muted) wrap.classList.add('session-muted');
  if (entry.focus) wrap.classList.add('session-focused');

  // Remove session button. Sessions no longer auto-prune on inactivity;
  // this is the only way to drop one short of reinstalling.
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'session-remove';
  removeBtn.textContent = '\u00D7';  // ×
  removeBtn.title = 'Remove this session (colour slot freed)';
  removeBtn.setAttribute('aria-label', `Remove session ${shortId} — colour slot freed`);
  removeBtn.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const ok = await window.api.removeSession(shortId);
    if (ok) {
      delete sessionAssignments[shortId];
      renderSessionsTable();
      renderDots();
    }
  });
  row.appendChild(removeBtn);

  wrap.appendChild(row);

  // Expanded section: per-session voice + tri-state speech includes
  if (expandedSessions.has(shortId)) {
    const expanded = document.createElement('div');
    expanded.className = 'session-expanded';

    // Voice override
    const voiceRow = document.createElement('div');
    voiceRow.className = 'expanded-row';
    const voiceLabel = document.createElement('label');
    voiceLabel.textContent = 'Voice for this session';
    voiceRow.appendChild(voiceLabel);
    const voiceSel = document.createElement('select');
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '— follow global default —';
    voiceSel.appendChild(defaultOpt);
    for (const v of EDGE_VOICES) {
      const o = document.createElement('option');
      o.value = v.id;
      o.textContent = v.label;
      if (entry.voice === v.id) o.selected = true;
      voiceSel.appendChild(o);
    }
    voiceSel.addEventListener('change', async () => {
      const v = voiceSel.value || null;
      await window.api.setSessionVoice(shortId, v);
      if (v) sessionAssignments[shortId].voice = v;
      else delete sessionAssignments[shortId].voice;
    });
    voiceRow.appendChild(voiceSel);
    expanded.appendChild(voiceRow);

    // Speech includes per-session toggles (tri-state: default / on / off)
    const incHeader = document.createElement('div');
    incHeader.className = 'expanded-subheader';
    incHeader.textContent = 'Speech includes (overrides for this session)';
    expanded.appendChild(incHeader);

    const incGrid = document.createElement('div');
    incGrid.className = 'tri-grid';
    const sessionInc = entry.speech_includes || {};
    for (const [key, label] of INCLUDE_LABELS) {
      const cell = document.createElement('div');
      cell.className = 'tri-cell';
      const labEl = document.createElement('span');
      labEl.className = 'tri-label';
      labEl.textContent = label;
      cell.appendChild(labEl);

      const ctrl = document.createElement('div');
      ctrl.className = 'tri-ctrl';
      const states = [
        { val: null, label: 'Default', cls: 'def' },
        { val: true, label: 'On',      cls: 'on' },
        { val: false, label: 'Off',    cls: 'off' }
      ];
      const current = key in sessionInc ? sessionInc[key] : null;
      for (const s of states) {
        const btn = document.createElement('button');
        btn.className = `tri-btn ${s.cls}` + (current === s.val ? ' active' : '');
        btn.textContent = s.label;
        btn.addEventListener('click', async () => {
          await window.api.setSessionInclude(shortId, key, s.val);
          if (!sessionAssignments[shortId].speech_includes) sessionAssignments[shortId].speech_includes = {};
          if (s.val === null) delete sessionAssignments[shortId].speech_includes[key];
          else                sessionAssignments[shortId].speech_includes[key] = s.val;
          renderSessionsTable();
        });
        ctrl.appendChild(btn);
      }
      cell.appendChild(ctrl);
      incGrid.appendChild(cell);
    }
    expanded.appendChild(incGrid);
    wrap.appendChild(expanded);
  }

  chevron.addEventListener('click', () => {
    if (expandedSessions.has(shortId)) expandedSessions.delete(shortId);
    else expandedSessions.add(shortId);
    renderSessionsTable();
  });

  return wrap;
}

async function loadSettings() {
  const cfg = await window.api.getConfig();
  if (!cfg) return;
  currentPlaybackSpeed = (cfg.playback && cfg.playback.speed) || 1.25;
  speedSlider.value = Math.round(currentPlaybackSpeed * 100);
  speedValueEl.textContent = `${currentPlaybackSpeed.toFixed(2)}x`;

  const pruneToggle = document.getElementById('autoPruneToggle');
  const pruneSecInput = document.getElementById('autoPruneSec');
  const pruneInitial = cfg.playback && cfg.playback.auto_prune !== false;
  const pruneSecInitial = Math.max(3, Math.min(600, Number(cfg.playback && cfg.playback.auto_prune_sec) || 20));
  autoPruneSec = pruneSecInitial;
  setAutoPruneEnabled(pruneInitial);
  if (pruneToggle) {
    pruneToggle.checked = pruneInitial;
    pruneToggle.addEventListener('change', async () => {
      const on = pruneToggle.checked;
      setAutoPruneEnabled(on);
      if (pruneSecInput) pruneSecInput.disabled = !on;
      await window.api.updateConfig({ playback: { auto_prune: on } });
    });
  }
  if (pruneSecInput) {
    pruneSecInput.value = String(pruneSecInitial);
    pruneSecInput.disabled = !pruneInitial;
    pruneSecInput.addEventListener('change', async () => {
      const n = Math.max(3, Math.min(600, Math.floor(Number(pruneSecInput.value) || 20)));
      pruneSecInput.value = String(n);  // clamp display too
      autoPruneSec = n;
      await window.api.updateConfig({ playback: { auto_prune_sec: n } });
    });
  }

  // v0.3.6 — auto_continue_after_click toggle.
  const continueToggle = document.getElementById('autoContinueToggle');
  const continueInitial = cfg.playback && cfg.playback.auto_continue_after_click !== false;
  autoContinueAfterClick = continueInitial;
  if (continueToggle) {
    continueToggle.checked = continueInitial;
    continueToggle.addEventListener('change', async () => {
      autoContinueAfterClick = continueToggle.checked;
      await window.api.updateConfig({ playback: { auto_continue_after_click: autoContinueAfterClick } });
    });
  }

  // Global voice / include selects were removed in favour of per-session controls.
  // Guard so the renderer doesn't crash when the elements are absent.
  if (voiceEdgeResponseEl) fillVoiceSelect(voiceEdgeResponseEl, EDGE_VOICES, cfg.voices.edge_response);
  if (voiceEdgeClipEl)     fillVoiceSelect(voiceEdgeClipEl, EDGE_VOICES, cfg.voices.edge_clip);
  if (voiceOpenaiResponseEl) fillVoiceSelect(voiceOpenaiResponseEl, OPENAI_VOICES, cfg.voices.openai_response);
  if (voiceOpenaiClipEl)   fillVoiceSelect(voiceOpenaiClipEl, OPENAI_VOICES, cfg.voices.openai_clip);

  const inc = cfg.speech_includes || {};
  for (const [key, el] of Object.entries(incBoxes)) {
    if (el) el.checked = !!inc[key];
  }
}

speedSlider.addEventListener('input', () => {
  const v = Math.max(0.5, Math.min(2.5, Number(speedSlider.value) / 100));
  currentPlaybackSpeed = v;
  speedValueEl.textContent = `${v.toFixed(2)}x`;
  if (audio) audio.playbackRate = v;
});
speedSlider.addEventListener('change', async () => {
  const v = Math.max(0.5, Math.min(2.5, Number(speedSlider.value) / 100));
  await window.api.updateConfig({ playback: { speed: v } });
});

function wireVoiceSelect(el, key) {
  if (!el) return;
  el.addEventListener('change', async () => {
    await window.api.updateConfig({ voices: { [key]: el.value } });
  });
}
wireVoiceSelect(voiceEdgeResponseEl, 'edge_response');
wireVoiceSelect(voiceEdgeClipEl, 'edge_clip');
wireVoiceSelect(voiceOpenaiResponseEl, 'openai_response');
wireVoiceSelect(voiceOpenaiClipEl, 'openai_clip');

for (const [key, el] of Object.entries(incBoxes)) {
  if (!el) continue;
  el.addEventListener('change', async () => {
    await window.api.updateConfig({ speech_includes: { [key]: el.checked } });
  });
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
