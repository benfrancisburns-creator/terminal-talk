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
// EX7e — spinnerWordCounter for scrubber verb-cloud moved inside AudioPlayer.
function setDynamicStyle(selector, cssText) {
  if (cssText) dynRules.set(selector, cssText);
  else dynRules.delete(selector);
  let text = '';
  for (const [sel, txt] of dynRules) text += `${sel} { ${txt} }\n`;
  try { dynSheet.replaceSync(text); } catch {}
}

const audio = document.getElementById('audio');
const dotsEl = document.getElementById('dots');
const tabsEl = document.getElementById('tabs');
const tabsRowEl = document.getElementById('tabsRow');
const tabScrollLeftBtn = document.getElementById('tabScrollLeft');
const tabScrollRightBtn = document.getElementById('tabScrollRight');
const playPauseBtn = document.getElementById('playPause');
const playIcon = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');
const back10Btn = document.getElementById('back10');
const fwd10Btn = document.getElementById('fwd10');
const scrubber = document.getElementById('scrubber');
const scrubberWrap = document.getElementById('scrubberWrap');
const scrubberMascot = document.getElementById('scrubberMascot');
const scrubberJarvis = document.getElementById('scrubberJarvis');

// HB1 / HB2 / HB3 — ambient narration constants + decision logic live
// in app/lib/heartbeat.js so they're independently unit-testable.
// The setInterval tick below is a thin wrapper that reads live state,
// calls decideHeartbeatAction(), and applies the returned mutation.
const randomVerb = window.TT_HEARTBEAT.pickHeartbeatVerb;
const timeEl = document.getElementById('time');
const closeBtn = document.getElementById('close');
const clearPlayedBtn = document.getElementById('clearPlayed');
const barEl = document.getElementById('bar');
const collapsedSignalEl = document.getElementById('collapsedSignal');
const urlParams = new URLSearchParams(window.location.search);
const isWindowMode = urlParams.get('windowMode') === '1';
const isCaptureMode = urlParams.get('captureMode') === '1';
const collapseDisabledForWindowMode = isWindowMode && !isCaptureMode;
const autoOpenSettingsMs = Number(urlParams.get('autoOpenSettingsMs') || 0);
const settingsScrollTarget = (urlParams.get('settingsScrollTarget') || '').toLowerCase();
const isSettingsDemoMode = isWindowMode && urlParams.get('demoSettings') === '1';
const settingsDemoVariant = (urlParams.get('demoSettingsVariant') || 'settings').toLowerCase();
function shouldAutoplayQueue() {
  return !(isSettingsDemoMode && settingsDemoVariant === 'transcript');
}
const settingsDemoUseStartFlag = urlParams.get('demoSettingsStartFlag') === '1';
const settingsDemoFallbackMs = Number(urlParams.get('demoSettingsFallbackMs') || 0);
const settingsDemoVisualDurationMs = Number(urlParams.get('demoSettingsVisualDurationMs') || 0);
if (isWindowMode) document.body.classList.add('window-mode');
if (isSettingsDemoMode) document.body.classList.add('demo-settings-mode');

// -------------------------------------------------------------------
// Collapse-on-idle behaviour (poll-based, robust to window focus changes)
// -------------------------------------------------------------------
// We deliberately avoid relying on mousemove/leave transitions because
// mousemove stops firing once the cursor leaves the Electron window
// (e.g., user switches to another app). The old timer-reset design got
// stuck in "mouse is over bar" state in that case.
//
// Design:
//   - lastActivityTs tracks the last user-facing activity
//     (mousemove over bar, click, force-expand, or fresh clips while open).
//   - A 1 s poll decides whether to collapse. Rules:
//       * Settings panel open → never collapse.
//       * Cursor currently over the bar → treat as ongoing activity.
//       * Otherwise collapse once the configured delay has elapsed since
//         the last activity.
//     Playback does NOT keep the full toolbar open. If audio starts while
//     the user is not hovering, the toolbar collapses to the session-colour
//     strip so the speaker remains glanceable without covering the terminal.
//     Fresh unplayed clips still keep heartbeat quiet, but they do NOT
//     keep the full toolbar open for the old 60 s freshness window.
//   - User interaction expands. New clips that arrive while already
//     collapsed keep the letterbox collapsed and flash its session colour.
const DEFAULT_COLLAPSE_DELAY_SEC = 3;
const MIN_COLLAPSE_DELAY_SEC = 1;
const MAX_COLLAPSE_DELAY_SEC = 120;
const COLLAPSED_ARRIVAL_SIGNAL_MS = 4200;
const POLL_INTERVAL_MS = 1000;
let collapseDelayMs = DEFAULT_COLLAPSE_DELAY_SEC * 1000;
let isCollapsed = false;
let settingsOpen = false;
let lastActivityTs = Date.now();
let cursorX = -1, cursorY = -1;
let mainCursorOverInteractive = null;
let collapsedSignalTimer = null;
let collapsedSignalPlaybackPath = null;
let settingsDemoStarted = false;
let resolveSettingsDemoStart = null;
const settingsDemoStartPromise = isSettingsDemoMode
  ? new Promise((resolve) => { resolveSettingsDemoStart = resolve; })
  : null;

function scrollSettingsTargetIntoView() {
  if (!settingsScrollTarget) return;
  const tab = settingsTabForTarget(settingsScrollTarget);
  if (tab) {
    setSettingsTab(tab);
    return;
  }
  const panel = document.getElementById('panel');
  const panelInner = document.querySelector('.panel-inner');
  const target = settingsScrollTarget === 'sessions'
    ? document.getElementById('sessionsSection')
    : null;
  if (!panel || !target) return;
  setTimeout(() => {
    try {
      target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch {
      const scrollHost = panelInner || panel;
      const panelTop = scrollHost.getBoundingClientRect().top;
      const targetTop = target.getBoundingClientRect().top;
      scrollHost.scrollTop += targetTop - panelTop;
    }
  }, 250);
}

function triggerSettingsDemoTimeline() {
  if (!isSettingsDemoMode || settingsDemoStarted) return;
  settingsDemoStarted = true;
  if (typeof resolveSettingsDemoStart === 'function') resolveSettingsDemoStart();
}

function interactiveRegion() {
  // Settings is a scrollable tool surface. Treat the whole toolbar
  // viewport as interactive while it is open so lower scrolled controls
  // cannot fall into the transparent click-through area.
  if (settingsOpen) {
    return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  }
  const rects = [];
  const bar = barEl.getBoundingClientRect();
  if (bar.width > 0 && bar.height > 0) rects.push(bar);
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function publishInteractiveRegion() {
  try {
    if (window.api && window.api.setInteractiveRegion) {
      window.api.setInteractiveRegion(interactiveRegion()).catch(() => {});
    }
  } catch {}
}

function publishInteractiveRegionSoon() {
  requestAnimationFrame(publishInteractiveRegion);
}

function paletteKeyForPath(p) {
  if (!p) return 'neutral';
  const filename = p.split(/[\\/]/).pop();
  if (!filename) return 'neutral';
  const shortId = window.TT_CLIP_PATHS.extractSessionShort(filename);
  return window.TT_CLIP_PATHS.paletteKeyForShort(shortId, sessionAssignments, PALETTE_SIZE);
}

function clearCollapsedSignal() {
  if (collapsedSignalTimer) {
    clearTimeout(collapsedSignalTimer);
    collapsedSignalTimer = null;
  }
  collapsedSignalPlaybackPath = null;
  if (barEl) barEl.classList.remove('collapsed-signal-active');
  if (collapsedSignalEl) delete collapsedSignalEl.dataset.palette;
}

function clearCollapsedPlaybackSignal(path) {
  if (!collapsedSignalPlaybackPath) return;
  if (path && collapsedSignalPlaybackPath !== path) return;
  clearCollapsedSignal();
}

function signalCollapsedClip(path, opts = {}) {
  if (!isCollapsed || !collapsedSignalEl) return;
  const holdForPlayback = !!opts.holdForPlayback;
  // Playback owns the collapsed letterbox colour. New arrivals may queue
  // behind it, but they must not repaint the flash while another clip is
  // audibly speaking; otherwise the colour implies the wrong session.
  if (!holdForPlayback && collapsedSignalPlaybackPath) return;
  if (holdForPlayback) collapsedSignalPlaybackPath = path || collapsedSignalPlaybackPath;
  collapsedSignalEl.dataset.palette = paletteKeyForPath(path);
  barEl.classList.remove('collapsed-signal-active');
  // Force a reflow so repeated clips from the same session restart the pulse.
  barEl.getBoundingClientRect();
  barEl.classList.add('collapsed-signal-active');
  if (holdForPlayback) {
    if (collapsedSignalTimer) {
      clearTimeout(collapsedSignalTimer);
      collapsedSignalTimer = null;
    }
    return;
  }
  if (collapsedSignalPlaybackPath) return;
  if (collapsedSignalTimer) clearTimeout(collapsedSignalTimer);
  collapsedSignalTimer = setTimeout(() => {
    collapsedSignalTimer = null;
    clearCollapsedSignal();
  }, COLLAPSED_ARRIVAL_SIGNAL_MS);
}

function collapseForBackgroundPlayback(path) {
  if (settingsOpen || collapseDisabledForWindowMode || isMouseOverBar()) return;
  applyCollapsed(true);
  signalCollapsedClip(path, { holdForPlayback: true });
}

function signalCollapsedCurrentPlayback() {
  const currentPath = audioPlayer && typeof audioPlayer.getCurrentPath === 'function'
    ? audioPlayer.getCurrentPath()
    : null;
  if (!currentPath || !isPlaybackActive()) return;
  signalCollapsedClip(currentPath, { holdForPlayback: true });
}

async function applyCollapsed(collapsed) {
  if (collapseDisabledForWindowMode) {
    isCollapsed = false;
    barEl.classList.remove('collapsed');
    clearCollapsedSignal();
    publishInteractiveRegionSoon();
    return;
  }
  if (collapsed === isCollapsed) return;
  isCollapsed = collapsed;
  if (collapsed) {
    barEl.classList.add('collapsed');
    signalCollapsedCurrentPlayback();
  } else {
    barEl.classList.remove('collapsed');
    clearCollapsedSignal();
  }
  publishInteractiveRegionSoon();
  // Click-through state is decided by cursor position (see mousemove
  // handler), not by collapsed state — so clicks in the transparent
  // margin outside the visible bar pass through to the app below,
  // even when the toolbar is expanded. applyCollapsed no longer
  // toggles click-through directly; updateClickthrough() does it.
  updateClickthrough();
}

// Track current click-through state so we don't IPC on every mousemove.
// Starts OFF (window receives clicks) to prevent a reload deadlock:
// if we started ON (click-through enabled = mouse events pass through),
// the window never receives mousemove, updateClickthrough() can't flip
// it OFF, and the toolbar is invisibly dead-zoned until the user uses
// a global hotkey to recover. Starting OFF guarantees the window is
// immediately interactive after load/Ctrl+R/first-show; updateClickthrough
// below flips it back ON as soon as the cursor leaves the bar.
let clickthroughOn = false;
// Push the OFF state to main synchronously on module load so main's
// cached state matches — otherwise a reload would leave main thinking
// click-through is still ON from before.
try { window.api && window.api.setClickthrough && window.api.setClickthrough(false); } catch {}
async function updateClickthrough() {
  if (isWindowMode) {
    if (clickthroughOn) {
      clickthroughOn = false;
      try { await window.api.setClickthrough(false); } catch {}
    }
    return;
  }
  if (settingsOpen) {
    if (clickthroughOn) {
      clickthroughOn = false;
      try { await window.api.setClickthrough(false); } catch {}
    }
    return;
  }
  // Click-through ON (pass clicks to app below) whenever the cursor
  // is NOT over the visible bar pixels. This is what lets the user
  // interact with other apps while the toolbar is visible — the
  // 680 x 192 window becomes effectively "only the bar rectangle
  // is mine; everything else is transparent".
  const overBar = isMouseOverBar();
  const want = !overBar;
  if (want !== clickthroughOn) {
    clickthroughOn = want;
    try { await window.api.setClickthrough(want); } catch {}
  }
}

// Queue is "active" when there's audio playing OR a clip that arrived
// RECENTLY (within ACTIVE_FRESH_MS) and hasn't been played yet. The
// freshness gate is load-bearing for two downstream consumers:
//
//   - Heartbeat timer — skips emission when the queue is active. With
//     auto-prune off (Ben's default), stale clips that the user never
//     played sit in `queue` indefinitely. Without a freshness gate
//     every clip older than today still counts as "pending", so
//     heartbeat never fires even when the system is genuinely silent
//     for minutes waiting on Claude.
//   - Toolbar idle collapse timer — same story: old un-played clips
//     shouldn't keep the toolbar permanently un-collapsed.
//
// 60 s was picked to be comfortably past the ~15 s edge-tts retry
// budget + any realistic synth-and-settle delay. A fresh clip has a
// full minute to get played before it's considered "backlog, ignore".
const ACTIVE_FRESH_MS = 60_000;
function isPlaybackActive() {
  const hasCurrentPath = !!(
    typeof audioPlayer !== 'undefined' &&
    audioPlayer &&
    audioPlayer.getCurrentPath()
  );
  if (!audio.src || audio.ended) return false;
  if (!audio.paused) return true;
  // A just-started clip can be "current" before Chromium has enough
  // media data to flip paused=false. Treat that load gap as active,
  // but don't let a stale currentPath keep the toolbar open forever.
  return hasCurrentPath && audio.readyState < 2;
}

function hasFreshUnplayedClip() {
  const freshCutoff = Date.now() - ACTIVE_FRESH_MS;
  return queue.some(f =>
    (f.mtime || 0) >= freshCutoff &&
    !playedPaths.has(f.path) &&
    !isPathSessionMuted(f.path)
  );
}

function isQueueActive() {
  return isPlaybackActive() || hasFreshUnplayedClip();
}

function isMouseOverBar() {
  // The main process polls the real screen cursor with
  // screen.getCursorScreenPoint(), which still works while the toolbar
  // is click-through. Prefer that authoritative state over renderer
  // mousemove coordinates; Electron can miss mouseleave/entry events on
  // Windows while ignoreMouseEvents is flipping, leaving cursorX/Y stale.
  if (mainCursorOverInteractive !== null) return mainCursorOverInteractive;
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

function normaliseCollapseDelaySec(value) {
  const raw = Number(value);
  return Math.max(MIN_COLLAPSE_DELAY_SEC, Math.min(MAX_COLLAPSE_DELAY_SEC, Math.floor(Number.isFinite(raw) ? raw : DEFAULT_COLLAPSE_DELAY_SEC)));
}

setInterval(() => {
  if (collapseDisabledForWindowMode) return;
  if (isCollapsed) return;
  if (settingsOpen) return;
  if (isMouseOverBar()) {
    lastActivityTs = Date.now();
    return;
  }
  if (Date.now() - lastActivityTs >= collapseDelayMs) {
    applyCollapsed(true);
  }
}, POLL_INTERVAL_MS);

// HB1 — heartbeat verb emission. When Claude Code is actively working
// (a recent hook touched a session) but the audio queue is silent
// (no playback, no pending clips), emit a single short spinner-verb
// ("Moonwalking", "Pontificating") so the listener gets audible
// confirmation the session is alive. Mirrors the mascot's visible
// word-cloud behaviour.
//
// The fire gate is stricter than collapse-on-idle because a heartbeat
// is audio output, not a cosmetic visual change. We only fire when:
//   - config enables heartbeat (user toggle in settings)
//   - audio is idle AND queue has no unplayed unmuted clips
//   - at least one registered session exists AND was touched recently
//     (session activity is our proxy for "Claude is actively working";
//     if every session has gone stale we assume the user isn't in a
//     Claude session and stay quiet)
//   - last heartbeat was > HEARTBEAT_INTERVAL_MS ago (cool-down)
//   - audio has been silent for at least HEARTBEAT_INITIAL_MS (don't
//     start heartbeating the instant a response ends)
// Heartbeat starts firing 5 s into a silent stretch (was 15 s) so
// short "just thinking" phases — Claude considering your message
// before any tool call lands — get at least one verb before the first
// tool narration kicks in. Subsequent heartbeats every 8 s (was 12 s)
// so a long silent stretch gets 2-3 verbs, not just one.
const HEARTBEAT_INITIAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 8_000;
// A session counts as "actively working" if its registry entry has
// been touched within this tight window. Originally 180 s (matched
// statusline fresh-session), but that made heartbeat fire for minutes
// after Claude had finished responding — the registry only knows
// "session is alive", not "waiting for a response". Narrowed to
// match the typical PreToolUse cadence during an active response:
// hooks fire every few seconds when Claude is actually working, so
// `last_seen` stays fresh inside this window during real work and
// ages out quickly once the turn ends.
let lastHeartbeatAt = 0;
let heartbeatSilentSince = Date.now();

// HB2 — working-sessions cache. Populated from main via
// `window.api.getWorkingSessions()` on every heartbeat tick (cheap —
// it's just a readdir on a tiny sessions directory). Returns the
// session shorts whose UserPromptSubmit hook fired but whose Stop
// hook hasn't, so a heartbeat genuinely maps to "waiting for Claude".
let workingSessionsCache = [];

// HB2 refresh: poll the working-sessions list from main on each tick.
// Async IPC so the heartbeat tick itself stays synchronous and cheap.
async function refreshWorkingSessions() {
  try {
    if (!window.api || !window.api.getWorkingSessions) return;
    const arr = await window.api.getWorkingSessions();
    workingSessionsCache = Array.isArray(arr) ? arr : [];
  } catch {
    // Leave cache as-is — stale for one tick is better than empty.
  }
}

setInterval(() => {
  // Fire the async refresh — don't await; we'll see the result on the
  // NEXT tick. One-tick lag (max 1 s) is acceptable for this coarse
  // signal and keeps the tick non-blocking.
  refreshWorkingSessions();

  try {
    const cfg = (window.TT_CONFIG_SNAPSHOT || {});
    const action = window.TT_HEARTBEAT.decideHeartbeatAction({
      now: Date.now(),
      heartbeatEnabled: cfg.heartbeat_enabled !== false,
      isQueueActive: isQueueActive(),
      // HB4 — skip when Wispr Flow / Voice Access has grabbed the mic;
      // otherwise clips pile up and burst-play when the user releases
      // their dictation hotkey.
      isSystemAutoPaused: audioPlayer && typeof audioPlayer.isSystemAutoPaused === 'function'
        ? audioPlayer.isSystemAutoPaused()
        : false,
      heartbeatSilentSince,
      lastHeartbeatAt,
      workingSessionsCache,
      sessionHeartbeatOverrides: Object.fromEntries(
        Object.entries(sessionAssignments || {})
          .filter(([, entry]) => entry && typeof entry.heartbeat_enabled === 'boolean')
          .map(([short, entry]) => [short, entry.heartbeat_enabled])
      ),
      initialMs: HEARTBEAT_INITIAL_MS,
      intervalMs: HEARTBEAT_INTERVAL_MS,
    });
    if (action.type === 'reset-silent') {
      heartbeatSilentSince = action.newSilentSince;
      return;
    }
    if (action.type !== 'emit') return;
    lastHeartbeatAt = action.newLastHeartbeatAt;
    const verb = randomVerb();
    const shortId = action.sessionShort;
    if (window.api && window.api.speakHeartbeat) {
      window.api.speakHeartbeat(verb, shortId).catch(() => {});
    }
  } catch {}
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
// Uncapped list of every audio file path on disk. main.js ships this
// alongside `files` (which is capped at MAX_FILES for dot-strip budget)
// so tab unread badges can count the real backlog past the dot cap.
// Falls back to `queue.map(f => f.path)` if main is running a pre-fix
// build that doesn't emit allPaths.
let allQueuePaths = [];
const playedPaths = new Set();
const heardPaths = new Set();
const manualPlayedPaths = new Set();
const priorityPaths = new Set();
const priorityQueue = [];
let pendingQueue = [];
const deleteTimers = new Map();
const unplayedEphemeralTimers = new Map();
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

function sessionPaletteLabel(i) {
  if (i < 8) return `${COLOUR_NAMES[i]}`;
  if (i < 16) {
    const p = i - 8;
    return `${COLOUR_NAMES[p]} / ${COLOUR_NAMES[HSPLIT_PARTNER[p]]} - top/bottom`;
  }
  const p = i - 16;
  return `${COLOUR_NAMES[p]} / ${COLOUR_NAMES[VSPLIT_PARTNER[p]]} - left/right`;
}

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
// EX7e — isClipFile wrapper removed: sole caller (updateScrubberMode)
// moved into AudioPlayer; component reads clipPaths.isClipFile directly.
const _paths = window.TT_CLIP_PATHS;
const extractSessionShort = _paths.extractSessionShort;
const isEphemeralClip = _paths.isEphemeralClip;
const isHeartbeatClip = _paths.isHeartbeatClip;

// Auto-prune toggle. true = 20 s after play, clips disappear on their own.
// false = clips stack up until user clears them (useful when walking away
// from the machine and wanting to review on return).
let autoPruneEnabled = true;

// Ephemeral clips (T- prefix, tool-call narrations) vanish immediately
// after playback — ~200 ms is enough for the audio element to finalise
// its `ended` event and for the dot to briefly flash as "played" before
// disappearing. Giving this a tiny but non-zero value also avoids a
// subtle race where the delete fires before the audio element has
// released the file handle.
const EPHEMERAL_DELETE_DELAY_MS = 200;
const UNPLAYED_EPHEMERAL_TTL_MS = 30000;

function _removeClipFromQueuesAndState(p) {
  playedPaths.delete(p);
  heardPaths.delete(p);
  manualPlayedPaths.delete(p);
  priorityPaths.delete(p);
  pendingQueue = pendingQueue.filter(x => x !== p);
  for (let i = priorityQueue.length - 1; i >= 0; i--) {
    if (priorityQueue[i] === p) priorityQueue.splice(i, 1);
  }
  queue = queue.filter(f => f.path !== p);
}

function cancelUnplayedEphemeralExpiry(p) {
  if (unplayedEphemeralTimers.has(p)) {
    clearTimeout(unplayedEphemeralTimers.get(p));
    unplayedEphemeralTimers.delete(p);
  }
}

function scheduleAutoDelete(p, _wasManual = false) {
  const ephemeral = isEphemeralClip(p);
  // Ephemeral clips bypass the autoprune-disabled toggle: even when the
  // user has disabled auto-prune to let clips stack up for review, tool
  // narrations should still vanish because their entire purpose is
  // ambient noise for the current moment, not reviewable content.
  if (!ephemeral && !autoPruneEnabled) {
    // Debug trace for the intermittent "body clips disappearing while
    // auto-prune is OFF" bug. If this line ever DOESN'T appear for a
    // body clip and the clip still vanishes, something OTHER than
    // scheduleAutoDelete is unlinking it. If it DOES appear and the
    // clip still vanishes, autoPruneEnabled has a stale read.
    try { console.log('[scheduleAutoDelete] skip (body + prune off):', p.split(/[\\/]/).pop()); } catch {}
    return;
  }
  try { console.log('[scheduleAutoDelete] schedule:', ephemeral ? 'EPHEMERAL' : 'body', 'path=' + p.split(/[\\/]/).pop(), 'autoPruneEnabled=' + autoPruneEnabled, 'autoPruneSec=' + autoPruneSec); } catch {}
  if (deleteTimers.has(p)) clearTimeout(deleteTimers.get(p));
  cancelUnplayedEphemeralExpiry(p);
  const delay = ephemeral
    ? EPHEMERAL_DELETE_DELAY_MS
    : Math.max(3, Math.min(600, autoPruneSec)) * 1000;
  const t = setTimeout(() => _attemptAutoDelete(p, ephemeral, 0), delay);
  deleteTimers.set(p, t);
}

// Retry schedule for failed auto-deletes. Files can be locked transiently
// by Windows AV scans, the player's own teardown, or a queue-watcher poll.
// Backoff = 250 ms, 1 s, 3 s, 8 s, 20 s, 60 s, 60 s, ... (capped at 60 s
// per attempt, capped at 12 attempts ≈ 5 min total). Two invariants:
//   - playedPaths/heardPaths/queue ONLY get cleaned up after a successful
//     delete (so a still-on-disk file can never re-enter auto-play).
//   - Retries continue until success — no silent abandonment of a file
//     that's still on disk.
const _AUTO_DELETE_RETRY_DELAYS_MS = [250, 1000, 3000, 8000, 20000, 60000];
const _AUTO_DELETE_MAX_ATTEMPTS = 12;
async function _attemptAutoDelete(p, ephemeral, attempt) {
  deleteTimers.delete(p);
  if (audioPlayer.getCurrentPath() === p) {
    // Currently playing — push the retry out so we don't unlink a live file.
    const t = setTimeout(() => _attemptAutoDelete(p, ephemeral, attempt), 1000);
    deleteTimers.set(p, t);
    return;
  }
  try { console.log('[scheduleAutoDelete] FIRING:', p.split(/[\\/]/).pop(), 'attempt=' + attempt, 'autoPruneEnabled=' + autoPruneEnabled); } catch {}
  let deleted = false;
  try {
    deleted = await window.api.deleteFile(p, ephemeral ? 'played-ephemeral' : 'played-auto-prune') === true;
  } catch (e) {
    try { console.warn('[scheduleAutoDelete] deleteFile failed', p.split(/[\\/]/).pop(), 'attempt=' + attempt, e && e.message); } catch {}
  }
  // Re-check after the IPC returns — user may have re-played mid-await.
  if (audioPlayer.getCurrentPath() === p) return;
  if (deleted) {
    _removeClipFromQueuesAndState(p);
    renderDots();
    return;
  }
  // Retry. Keep playedPaths populated so the file does not re-enter
  // auto-play on the next queue update.
  if (attempt + 1 >= _AUTO_DELETE_MAX_ATTEMPTS) {
    try { console.error('[scheduleAutoDelete] giving up after', attempt + 1, 'attempts:', p.split(/[\\/]/).pop()); } catch {}
    return;
  }
  const nextDelay = _AUTO_DELETE_RETRY_DELAYS_MS[Math.min(attempt, _AUTO_DELETE_RETRY_DELAYS_MS.length - 1)];
  const t = setTimeout(() => _attemptAutoDelete(p, ephemeral, attempt + 1), nextDelay);
  deleteTimers.set(p, t);
}

function scheduleUnplayedEphemeralExpiry(f) {
  const p = f && f.path;
  if (!p || !isEphemeralClip(p)) return;
  if (playedPaths.has(p) || audioPlayer.getCurrentPath() === p) return;
  if (unplayedEphemeralTimers.has(p)) return;
  const age = Date.now() - Number(f.mtime || Date.now());
  const delay = Math.max(1000, UNPLAYED_EPHEMERAL_TTL_MS - age);
  const t = setTimeout(() => {
    unplayedEphemeralTimers.delete(p);
    if (playedPaths.has(p) || audioPlayer.getCurrentPath() === p) return;
    _attemptAutoDelete(p, true, 0);
  }, delay);
  unplayedEphemeralTimers.set(p, t);
}

function scheduleUnplayedEphemeralExpiryForQueue() {
  for (const f of queue) scheduleUnplayedEphemeralExpiry(f);
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
      if (f.path !== audioPlayer.getCurrentPath() && playedPaths.has(f.path)) {
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
  cancelUnplayedEphemeralExpiry(p);
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

// Tabs — per-session filter above the dot-strip. `selectedTab` is either
// 'all' (unfiltered chronological view, default) or a session shortId.
// The top strip is scoped to live sessions plus sessions with clips still
// on disk; the full registry remains in Settings > Sessions.
let selectedTab = 'all';
let tabsExpanded = false;
const tabs = new window.TT_TABS({
  clipPaths: window.TT_CLIP_PATHS,
  staleSessionPoller,
  paletteSize: PALETTE_SIZE,
  onTabSelect: (tabId) => {
    if (selectedTab === tabId) return;
    selectedTab = tabId;
    persistTabsState();
    renderDots();
  },
  onExpandChange: (next) => {
    tabsExpanded = !!next;
    persistTabsState();
    renderDots();
  },
});
tabs.mount(tabsEl);

function updateTabScrollControls() {
  if (!tabsEl || !tabsRowEl || !tabScrollLeftBtn || !tabScrollRightBtn) return;
  const overflow = tabsEl.scrollWidth > tabsEl.clientWidth + 2;
  tabsRowEl.classList.toggle('has-overflow', overflow);
  if (!overflow) {
    tabScrollLeftBtn.disabled = true;
    tabScrollRightBtn.disabled = true;
    return;
  }
  const maxScrollLeft = Math.max(0, tabsEl.scrollWidth - tabsEl.clientWidth);
  tabScrollLeftBtn.disabled = tabsEl.scrollLeft <= 1;
  tabScrollRightBtn.disabled = tabsEl.scrollLeft >= maxScrollLeft - 1;
}

function scheduleTabScrollControlsUpdate() {
  requestAnimationFrame(updateTabScrollControls);
}

function scrollTabsBy(direction) {
  if (!tabsEl) return;
  const amount = Math.max(160, Math.floor(tabsEl.clientWidth * 0.72));
  tabsEl.scrollBy({ left: direction * amount, behavior: 'smooth' });
  setTimeout(updateTabScrollControls, 240);
}

if (tabScrollLeftBtn) tabScrollLeftBtn.addEventListener('click', () => scrollTabsBy(-1));
if (tabScrollRightBtn) tabScrollRightBtn.addEventListener('click', () => scrollTabsBy(1));
if (tabsEl) tabsEl.addEventListener('scroll', updateTabScrollControls, { passive: true });
window.addEventListener('resize', scheduleTabScrollControlsUpdate);

function persistTabsState() {
  try {
    window.api.updateConfig({ selected_tab: selectedTab, tabs_expanded: tabsExpanded });
  } catch {}
}

// Restore persisted tab state on first config load. Validated after first
// sessionAssignments sync in renderDots so a gone-stale session doesn't
// leave the user staring at an empty strip they can't escape from.
function restoreTabsState(cfg) {
  if (!cfg) return;
  if (typeof cfg.selected_tab === 'string') selectedTab = cfg.selected_tab;
  if (typeof cfg.tabs_expanded === 'boolean') tabsExpanded = cfg.tabs_expanded;
}

// EX7e — all audio-surface code (playPath, play/pause/ended/error/
// stalled/waiting/playing/canplay/seeking/timeupdate/loadedmetadata
// handlers, scrubber rAF + mascot + verb cloud, scrub direction,
// stall recovery, device-change rebinding, pause tone, play/back10/
// fwd10 button handlers) extracted into app/lib/audio-player.js.
// currentPath / currentIsManual / currentIsUserClick / userScrubbing
// that used to live as renderer module globals are now instance state
// inside the component. External readers go through getCurrentPath()
// / isIdle() / isUserScrubbing() accessors.
const audioPlayer = new window.TT_AUDIO_PLAYER({
  audio, playPauseBtn, playIcon, pauseIcon, back10Btn, fwd10Btn,
  scrubber, scrubberWrap, scrubberMascot, scrubberJarvis, timeEl,
  getPlaybackSpeed: () => currentPlaybackSpeed,
  getAutoContinueAfterClick: () => autoContinueAfterClick,
  getQueue: () => queue,
  getHeardPaths: () => heardPaths,
  markPlayed: (p) => { playedPaths.add(p); },
  markHeard: (p) => { heardPaths.add(p); },
  markManualPlayed: (p) => { manualPlayedPaths.add(p); },
  removePending: (p) => { pendingQueue = pendingQueue.filter((x) => x !== p); },
  fmt,
  fileUrl,
  isPathSessionMuted,
  isPathSessionStale,
  clipPaths: window.TT_CLIP_PATHS,
  resolveSessionPaletteKey: (p) => {
    // Mascot recolour: map a clip path to the session's palette key
    // (e.g. "03") using the current assignments. Returns null for
    // J-clips (handled separately by audio-player), neutral clips,
    // or unresolvable paths — in those cases the mascot falls back
    // to its default orange.
    if (!p) return null;
    const filename = p.split(/[\\/]/).pop();
    if (!filename || _paths.isClipFile(filename)) return null;
    const shortId = _paths.extractSessionShort(filename);
    if (!shortId) return null;
    return _paths.paletteKeyForShort(shortId, sessionAssignments, PALETTE_SIZE);
  },
  randomVerb,
  setDynamicStyle,
  onPlayStart: (p) => {
    cancelAutoDelete(p);
    if (isCollapsed) signalCollapsedClip(p, { holdForPlayback: true });
    else collapseForBackgroundPlayback(p);
    if (isSettingsDemoMode) triggerSettingsDemoTimeline();
  },
  onClipEnded: (p, { manual }) => {
    clearCollapsedPlaybackSignal(p);
    lastActivityTs = Date.now();
    scheduleAutoDelete(p, manual);
  },
  onPlaybackStop: (p) => {
    clearCollapsedPlaybackSignal(p);
  },
  onPlayNextPending: () => {
    if (shouldAutoplayQueue()) playNextPending();
  },
  onRenderDots: () => renderDots(),
});
audioPlayer.mount();

// Transcript panel — expandable section under the dot strip showing
// the text of recent audio clips with copy buttons. Sidecar text
// (.txt / .original.txt) is written by synth_turn.py + tts-helper.psm1
// next to each audio clip; here we maintain a synchronous cache that
// the panel reads on render. IPC fetch happens when the queue updates;
// missing entries show a placeholder until the fetch lands.
const transcriptSidecarCache = new Map();
const transcriptInflight = new Set();

function fetchSidecarsForRecent() {
  // Only prefetch sidecars for the clips the panel will actually show,
  // bounded by MAX_CLIPS_SHOWN (10). Keeps the IPC chatter modest even
  // when the queue grows long.
  const recent = queue.slice().sort((a, b) => (b.mtime || 0) - (a.mtime || 0)).slice(0, 10);
  for (const f of recent) {
    if (!f || !f.path) continue;
    if (transcriptSidecarCache.has(f.path)) continue;
    if (transcriptInflight.has(f.path)) continue;
    transcriptInflight.add(f.path);
    window.api.readClipSidecar(f.path).then((res) => {
      transcriptInflight.delete(f.path);
      transcriptSidecarCache.set(f.path, {
        spoken: (res && typeof res.spoken === 'string') ? res.spoken : '',
        original: (res && typeof res.original === 'string') ? res.original : '',
      });
      // Trigger a re-render now that we have content.
      if (transcriptPanel) transcriptPanel.refresh();
    }).catch(() => {
      transcriptInflight.delete(f.path);
      transcriptSidecarCache.set(f.path, { spoken: '', original: '' });
    });
  }
  // Bound the cache: drop entries for paths no longer in the queue,
  // so a long session doesn't hold every clip's text in memory forever.
  if (transcriptSidecarCache.size > 100) {
    const liveSet = new Set(queue.map((f) => f.path));
    for (const k of transcriptSidecarCache.keys()) {
      if (!liveSet.has(k)) transcriptSidecarCache.delete(k);
    }
  }
}

const transcriptPanelEl = document.getElementById('transcriptPanel'), transcriptToggleBtn = document.getElementById('transcriptToggle');
const transcriptViewToggleBtn = document.getElementById('transcriptViewToggle'), transcriptListEl = document.getElementById('transcriptList');
const transcriptCountEl = document.getElementById('transcriptCount'), dictationRecordBtn = document.getElementById('dictationRecordBtn'), dictationListEl = document.getElementById('dictationList');

let transcriptPanel = null;
if (transcriptPanelEl && transcriptToggleBtn && transcriptListEl) {
  transcriptPanel = new window.TT_TRANSCRIPT_PANEL.TranscriptPanel({
    panelEl: transcriptPanelEl,
    toggleBtn: transcriptToggleBtn,
    viewToggleBtn: transcriptViewToggleBtn,
    listEl: transcriptListEl,
    countEl: transcriptCountEl,
    getQueue: () => queue,
    getCurrentPath: () => audioPlayer.getCurrentPath(),
    getSelectedTab: () => selectedTab,
    clipPaths: window.TT_CLIP_PATHS,
    readSidecar: (audioPath) => transcriptSidecarCache.get(audioPath) || null,
    getInitialExpanded: () => false,  // wired up after first config load
    getInitialView: () => 'spoken',   // same
    setPersistedFlag: (key, value) => {
      try {
        const partial = { panels: {} };
        if (key === 'expanded') partial.panels.transcript_expanded = value;
        if (key === 'view')     partial.panels.transcript_view = value;
        window.api.updateConfig(partial);
      } catch {}
    },
    // Click-to-play: delegate to the same userPlay path the dot strip
    // uses so the existing auto-continue / manual-vs-userClick semantics
    // apply identically.
    onClickClip: (path) => userPlay(path),
  });
  transcriptPanel.mount();
}

let dictationPanel = window.TT_DICTATION_PANEL && dictationListEl
  ? window.TT_DICTATION_PANEL.createDictationPanel({
      api: window.api, recordBtn: dictationRecordBtn, listEl: dictationListEl,
      showStatus: (...args) => _showStatusToast(...args),
    })
  : null;
if (dictationPanel) dictationPanel.mount();

function renderDots() {
  // Defensive fallback: if the persisted selectedTab no longer appears in
  // the focused top strip (live session OR clip-backed session), revert to
  // All so the user is not stuck staring at an empty strip.
  if (selectedTab !== 'all') {
    const selectedIsLive = !!(sessionAssignments[selectedTab] && !staleSessionPoller.has(selectedTab));
    const selectedHasClips = [...queue.map((f) => f.path), ...allQueuePaths].some((p) => {
      if (!p) return false;
      const fname = p.split(/[\\/]/).pop();
      return window.TT_CLIP_PATHS.extractSessionShort(fname) === selectedTab;
    });
    if (!selectedIsLive && !selectedHasClips) {
      selectedTab = 'all';
      persistTabsState();
    }
  }

  // Heartbeats stay in `queue` for audio-player but must not render —
  // otherwise the strip + tab badges churn every ~8 s as each H-clip
  // plays + auto-deletes. Tab filter applied AFTER the heartbeat
  // filter so a session-specific tab also excludes them.
  const visibleNoHeartbeat = queue.filter((f) => !isHeartbeatClip(f.path.split(/[\\/]/).pop()));
  const shortId = selectedTab;
  const visibleQueue = shortId === 'all'
    ? visibleNoHeartbeat
    : visibleNoHeartbeat.filter((f) => {
        const fname = f.path.split(/[\\/]/).pop();
        return window.TT_CLIP_PATHS.extractSessionShort(fname) === shortId;
      });

  dotStrip.update({
    queue: visibleQueue,
    currentPath: audioPlayer.getCurrentPath(),
    currentIsManual: typeof audioPlayer.isCurrentManual === 'function' ? audioPlayer.isCurrentManual() : false,
    heardPaths,
    manualPlayedPaths,
    sessionAssignments,
    synthInProgress,
  });

  // Tabs see the FULL (heartbeat-filtered) queue + allPaths so per-
  // tab unread badges count clips past MAX_FILES correctly.
  const tabsQueue = visibleNoHeartbeat;
  const tabsAllPaths = allQueuePaths.filter((p) => !isHeartbeatClip(p.split(/[\\/]/).pop()));
  tabs.update({
    queue: tabsQueue,
    allPaths: tabsAllPaths,
    heardPaths,
    sessionAssignments,
    selectedTab,
    expanded: tabsExpanded,
  });
  scheduleTabScrollControlsUpdate();
  // Transcript panel: refresh in lock-step with the dot strip so the
  // current-clip highlight updates on every audio-event-driven render.
  if (transcriptPanel) transcriptPanel.refresh();
}

function playPath(p, manual = false, userClick = false) { return audioPlayer.playPath(p, manual, userClick); }
function userPlay(p) { audioPlayer.playPath(p, true, true); }

async function deleteDot(p) {
  cancelAutoDelete(p);
  if (audioPlayer.getCurrentPath() === p) {
    audioPlayer.abort();
  }
  pendingQueue = pendingQueue.filter(x => x !== p);
  playedPaths.delete(p); heardPaths.delete(p); manualPlayedPaths.delete(p);
  queue = queue.filter(f => f.path !== p);
  allQueuePaths = allQueuePaths.filter(x => x !== p);
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
    // Surface delete failures to the diagnostic log instead of swallowing
    // silently — a clear-played that quietly leaves files on disk would
    // be invisible to the user but corrupt the queue's heard/unheard state.
    window.api.deleteFile(p).catch((err) => {
      try {
        if (window.api && window.api.logRendererError) {
          window.api.logRendererError({
            type: 'unhandledrejection',
            message: `deleteFile failed for ${p}: ${err && err.message ? err.message : String(err)}`,
            stack: err && err.stack ? err.stack : '',
          });
        }
      } catch {}
    });
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
    if (e.wasHeard) heardPaths.add(e.path); if (e.wasPlayed) playedPaths.add(e.path);
    if (e.wasManualPlayed) manualPlayedPaths.add(e.path);
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

  const toDelete = queue.filter((f) => heardPaths.has(f.path) && f.path !== audioPlayer.getCurrentPath());
  if (toDelete.length === 0) return;

  const entries = toDelete.map((f) => ({
    path: f.path,
    mtime: f.mtime,
    wasHeard: heardPaths.has(f.path),
    wasPlayed: playedPaths.has(f.path),
    wasManualPlayed: manualPlayedPaths.has(f.path),
  }));
  const paths = entries.map((e) => e.path);

  // Remove from visible state immediately — user sees the UI react.
  for (const p of paths) {
    cancelAutoDelete(p);
    heardPaths.delete(p); playedPaths.delete(p); manualPlayedPaths.delete(p);
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
  allQueuePaths = (resp && Array.isArray(resp.allPaths)) ? resp.allPaths : files.map((f) => f.path);
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
    if (f.mtime < cutoff) {
      playedPaths.add(f.path);
      heardPaths.add(f.path);
      scheduleAutoDelete(f.path, true);
    }
  }
  for (const f of unplayed) {
    if (!pendingQueue.includes(f.path)) pendingQueue.push(f.path);
  }
  scheduleUnplayedEphemeralExpiryForQueue();
  renderDots();
  if (transcriptPanel) {
    fetchSidecarsForRecent();
    transcriptPanel.refresh();
  }
  // Capture-only transcript demos need the seeded clips to stay in the
  // queue so the panel can show spoken/original rows while the external
  // narration runs. Normal app boots and other demos keep autoplay.
  if (audioPlayer.isIdle() && shouldAutoplayQueue()) {
    playNextPending();
  }
}

window.api.onQueueUpdated((payload) => {
  let files = Array.isArray(payload) ? payload : (payload && payload.files) || [];
  if (payload && payload.assignments) {
    sessionAssignments = payload.assignments;
    if (document.body.classList.contains('settings-open')) renderSessionsTable();
  }
  let nextAllPaths = (payload && Array.isArray(payload.allPaths)) ? payload.allPaths : files.map((f) => f.path);
  // Filter out paths in the pending-clear undo window so soft-deleted
  // clips don't reappear when notifyQueue() rescans the on-disk queue
  // (the actual fs.unlink is deferred 10 s; the in-memory state is the
  // source of truth during that window). Without this, "Clear all
  // played" briefly removes clips, then they pop back, then disappear
  // again — Ben hit this on 2026-05-09. The soft-deleted set lives on
  // the renderer side because main has no notion of "pending undo".
  if (_pendingClear && _pendingClear.entries) {
    const pendingClearPaths = new Set(_pendingClear.entries.map((e) => e.path));
    files = files.filter((f) => !pendingClearPaths.has(f.path));
    nextAllPaths = nextAllPaths.filter((p) => !pendingClearPaths.has(p));
  }
  allQueuePaths = nextAllPaths;
  const prevPaths = new Set(queue.map(f => f.path));
  const newArrivals = files
    .filter(f => !prevPaths.has(f.path) && !playedPaths.has(f.path))
    .sort((a, b) => a.mtime - b.mtime);
  queue = files;
  // Transcript panel: kick a sidecar prefetch + refresh on every queue
  // update. fetchSidecarsForRecent only IPCs paths it hasn't fetched
  // yet, so this is cheap on subsequent calls. The async fetch's then()
  // calls refresh() once the text lands.
  if (transcriptPanel) {
    fetchSidecarsForRecent();
    transcriptPanel.refresh();
  }

  for (const f of newArrivals) {
    if (priorityPaths.has(f.path)) continue;
    // Drop muted-session arrivals outright — they never enter the queue.
    if (isClipSessionMuted(f.path.split(/[\\/]/).pop())) continue;
    if (!pendingQueue.includes(f.path)) pendingQueue.push(f.path);
    scheduleUnplayedEphemeralExpiry(f);
  }
  // New unmuted clip arrived. If the user has let the toolbar collapse
  // to the letterbox, do not expand over their work; flash the source
  // session colour instead. If the full toolbar is already open, keep
  // the old activity behaviour so it stays open while fresh clips land.
  const visibleArrivals = newArrivals.filter(f =>
    !priorityPaths.has(f.path) && !isClipSessionMuted(f.path.split(/[\\/]/).pop())
  );
  if (visibleArrivals.length > 0) {
    if (isCollapsed) signalCollapsedClip(visibleArrivals[0].path);
    else bumpActivity();
  }
  // If the user just muted the session of the currently-playing clip, stop.
  // Let the normal resume/ended flow pick up the next unmuted one.
  const cur = audioPlayer.getCurrentPath();
  if (cur && isPathSessionMuted(cur)) {
    audioPlayer.abort();
    playedPaths.delete(cur);
  }
  renderDots();

  if (audioPlayer.isIdle() && shouldAutoplayQueue()) {
    playNextPending();
  }
});

// Generic transient toast for status messages (separate from the
// undo-clear toast which has its own state machine). Auto-dismisses
// after `ms` (default 4 s). Variant 'warning' tints the border copper
// for hotkey-collision / TTS-failure surfaces.
let _statusToastEl = null;
let _statusToastTimer = null;
function _showStatusToast(text, ms = 4000, variant = 'info') {
  if (_statusToastTimer) {
    clearTimeout(_statusToastTimer);
    _statusToastTimer = null;
  }
  if (_statusToastEl) {
    try { _statusToastEl.remove(); } catch {}
    _statusToastEl = null;
  }
  const toast = document.createElement('div');
  toast.className = `tt-toast tt-status-toast tt-status-toast-${variant}`;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  const span = document.createElement('span');
  span.textContent = text;
  toast.appendChild(span);
  document.body.appendChild(toast);
  _statusToastEl = toast;
  _statusToastTimer = setTimeout(() => {
    if (_statusToastEl === toast) {
      try { toast.remove(); } catch {}
      _statusToastEl = null;
    }
    _statusToastTimer = null;
  }, ms);
}

window.api.onClipboardStatus((msg) => {
  const state = msg && msg.state;
  const prev = synthInProgress;
  synthInProgress = (state === 'synth');
  if (prev !== synthInProgress) renderDots();
  if (state === 'empty') {
    _showStatusToast('No text selected — highlight some text first, then try again.', 4000, 'warning');
  } else if (state === 'tts_failed') {
    _showStatusToast('Voice synthesis failed. Check that Edge TTS is reachable, or test your OpenAI key in Settings → OpenAI.', 6000, 'warning');
  }
});

// Hotkey-registration banner. Fires once at startup if any global
// shortcut failed to register (typically because another app — Wispr
// Flow, Voice Mode, a streaming overlay — already owns the chord).
// Without this surface the user sees their hotkey doing nothing and
// has no signal about why. Pull on first load too so a slow renderer
// catches the push that may have already fired.
function _showHotkeyBanner(failed) {
  if (!failed || !failed.length) return;
  const names = failed.map((f) => `${f.name} (${f.accel})`).join(', ');
  _showStatusToast(
    `Hotkey collision — these chords are owned by another app and won't fire: ${names}. Rebind them in Settings → Shortcuts.`,
    9000,
    'warning'
  );
}
if (window.api.onHotkeyRegistration) {
  window.api.onHotkeyRegistration((status) => _showHotkeyBanner(status && status.failed));
}
if (window.api.getHotkeyRegistration) {
  window.api.getHotkeyRegistration().then((status) => _showHotkeyBanner(status && status.failed)).catch((err) => {
    try {
      if (window.api && window.api.logRendererError) {
        window.api.logRendererError({
          type: 'unhandledrejection',
          message: `getHotkeyRegistration failed: ${err && err.message ? err.message : String(err)}`,
          stack: err && err.stack ? err.stack : '',
        });
      }
    } catch {}
  });
}

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
  const aborted = audioPlayer.abortIfAutoPlayed();
  if (aborted) playedPaths.delete(aborted);
  renderDots();
  if (audioPlayer.isIdle() && shouldAutoplayQueue()) playNextPending();
});


window.api.onListeningState((on) => audioPlayer.playToggleTone(on));

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
  // Escape-to-hide was removed: users press Escape to dismiss the
  // Snipping Tool / Screenshot tool selection (crop, copy, Escape to
  // release), and if the toolbar happens to have OS focus at that
  // moment it was being hidden unexpectedly. The × close button and
  // Ctrl+Shift+A are the intended hide paths. Space / Arrow keys
  // were already removed for similar focus-steal reasons.
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

// Phase 8 (#32): wire the gear-icon update badge via lib/update-badge.js
// (kept out-of-line to keep renderer.js under the 2725-line ceiling).
if (window.TT_UPDATE_BADGE) {
  window.TT_UPDATE_BADGE.wireUpdateBadge({ api: window.api, buttonEl: settingsBtn });
}
const settingsPanelEl = document.getElementById('panel');
const settingsPanelInnerEl = document.querySelector('.panel-inner');
const settingsTabEls = Array.from(document.querySelectorAll('[data-settings-tab]'));
const settingsPageEls = Array.from(document.querySelectorAll('[data-settings-page]'));
const sessionsTableEl = document.getElementById('sessionsTable');
const createSessionKindEl = document.getElementById('createSessionKind');
const createSessionLaunchModeEl = document.getElementById('createSessionLaunchMode');
const createSessionProjectEl = document.getElementById('createSessionProject');
const createSessionBrowseEl = document.getElementById('createSessionBrowse');
const createSessionLabelEl = document.getElementById('createSessionLabel');
const createSessionIndexEl = document.getElementById('createSessionIndex');
const createSessionBtn = document.getElementById('createSessionBtn');
const createSessionSaveDefaultBtn = document.getElementById('createSessionSaveDefault');
const createSessionStatusEl = document.getElementById('createSessionStatus');
// EX7d-2 — speedSlider, speedValueEl, voice*El, incBoxes, and
// fillVoiceSelect all moved into SettingsForm. The SettingsForm
// component queries these DOM refs internally on mount.

const INCLUDE_LABELS = [
  ['code_blocks',    'Code blocks'],
  ['inline_code',    'Inline code'],
  ['urls',           'URLs'],
  ['headings',       'Headings'],
  ['bullet_markers', 'Bullet markers'],
  ['image_alt',      'Image alt-text'],
  // TN1 — per-session override for the tool-call narration T-clips.
  // Default comes from global speech_includes.tool_calls (true).
  ['tool_calls',     'Tool-call narration']
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
  openaiVoices: OPENAI_VOICES,
  // Read the active TTS provider off the live config snapshot so the
  // per-session voice dropdown shows the right catalogue. When the
  // global "Use OpenAI as primary" toggle flips, we call renderSessionsTable()
  // which picks up the refreshed snapshot.
  getTtsProvider: () => {
    const snap = window.TT_CONFIG_SNAPSHOT || {};
    const p = (snap.playback && snap.playback.tts_provider) || 'edge';
    return String(p).toLowerCase() === 'openai' ? 'openai' : 'edge';
  },
  includeLabels: INCLUDE_LABELS,
  onSetLabel:   (shortId, label) => window.api.setSessionLabel(shortId, label),
  onSetIndex:   (shortId, idx)   => window.api.setSessionIndex(shortId, idx),
  onSetFocus:   (shortId, focus) => window.api.setSessionFocus(shortId, focus),
  onSetMuted:   (shortId, muted) => window.api.setSessionMuted(shortId, muted),
  onRemove:     (shortId)        => window.api.removeSession(shortId),
  onSetVoice:   (shortId, voice) => window.api.setSessionVoice(shortId, voice),
  onSetHeartbeat: (shortId, v)   => window.api.setSessionHeartbeat(shortId, v),
  onSetInclude: (shortId, k, v)  => window.api.setSessionInclude(shortId, k, v),
  onSyncCodexDesktopTitle: (shortId) => window.api.syncCodexDesktopTitle(shortId),
  onSyncClaudeDesktopTitle: (shortId) => window.api.syncClaudeDesktopTitle(shortId),
  onAfterMutation: () => renderDots(),
});
sessionsTable.mount(sessionsTableEl);

function renderSessionsTable() {
  sessionsTable.update({ sessionAssignments });
  refreshCreateSessionPalette();
}

const CREATE_SESSION_PERMISSION_OPTIONS = {
  codex: [
    ['default', 'Default'],
    ['dangerous', 'Dangerously bypass approvals and sandbox'],
  ],
  claude: [
    ['default', 'Default'],
    ['dangerous', 'Dangerously skip permissions'],
  ],
  'claude-desktop': [
    ['default', 'Default'],
  ],
};
let createSessionDefaults = {
  kind: 'codex',
  defaults: {},
};

function setCreateSessionStatus(text, tone = '') {
  if (!createSessionStatusEl) return;
  createSessionStatusEl.textContent = text || '';
  createSessionStatusEl.dataset.tone = tone || '';
}

function sessionAssignmentDisplayName(shortId, entry) {
  const label = entry && typeof entry.label === 'string' ? entry.label.trim() : '';
  if (label) return label;
  const sourceLabel = entry && typeof entry.source_label === 'string' ? entry.source_label.trim() : '';
  if (sourceLabel) return sourceLabel;
  return shortId;
}

function createSessionPaletteUsageMap() {
  const used = new Map();
  for (const [shortId, entry] of Object.entries(sessionAssignments || {})) {
    if (!entry || typeof entry !== 'object') continue;
    const rawIndex = Number(entry.index);
    if (!Number.isFinite(rawIndex)) continue;
    const index = Math.max(0, Math.min(PALETTE_SIZE - 1, Math.floor(rawIndex)));
    const list = used.get(index) || [];
    list.push({
      shortId,
      label: sessionAssignmentDisplayName(shortId, entry),
    });
    used.set(index, list);
  }
  return used;
}

function createSessionPaletteUsageLabel(usages) {
  if (!usages || usages.length === 0) return '';
  const names = usages.slice(0, 2).map((u) => u.label).join(', ');
  const extra = usages.length > 2 ? ` +${usages.length - 2}` : '';
  return ` (used by ${names}${extra})`;
}

function refreshCreateSessionPalette() {
  if (!createSessionIndexEl) return;
  const selected = createSessionIndexEl.value || '0';
  createSessionIndexEl.innerHTML = '';
  const used = createSessionPaletteUsageMap();
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const usages = used.get(i) || [];
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `${sessionPaletteLabel(i)}${createSessionPaletteUsageLabel(usages)}`;
    opt.dataset.palette = window.TT_CLIP_PATHS.paletteKeyForIndex(i, PALETTE_SIZE);
    if (usages.length > 0) {
      opt.className = 'create-session-colour-used';
      opt.dataset.used = 'true';
      opt.title = `Used by ${usages.map((u) => u.label).join(', ')}`;
    }
    createSessionIndexEl.appendChild(opt);
  }
  createSessionIndexEl.value = selected;
  if (!createSessionIndexEl.value) createSessionIndexEl.value = '0';
}

function populateCreateSessionLaunchModes() {
  if (!createSessionKindEl || !createSessionLaunchModeEl) return;
  const kind = normaliseCreateSessionKind(createSessionKindEl.value);
  const current = createSessionLaunchModeEl.value || 'default';
  createSessionLaunchModeEl.innerHTML = '';
  for (const [value, label] of CREATE_SESSION_PERMISSION_OPTIONS[kind]) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    createSessionLaunchModeEl.appendChild(opt);
  }
  const values = new Set(CREATE_SESSION_PERMISSION_OPTIONS[kind].map(([value]) => value));
  createSessionLaunchModeEl.value = values.has(current) ? current : 'default';
}

function updateCreateSessionPlaceholders() {
  if (!createSessionKindEl || !createSessionLabelEl) return;
  const kind = normaliseCreateSessionKind(createSessionKindEl.value);
  const sample = kind === 'claude-desktop' ? 'Claude Desktop x TT'
    : kind === 'claude' ? 'Claude x TT'
    : 'Codex x TT';
  createSessionLabelEl.placeholder = `e.g. ${sample}`;
}

function normaliseCreateSessionKind(value) {
  const clean = String(value || '').toLowerCase();
  if (clean === 'claude-desktop' || clean === 'claude-desktop-code') return 'claude-desktop';
  return clean === 'claude' ? 'claude' : 'codex';
}

function validCreateSessionLaunchMode(kind, value) {
  const options = CREATE_SESSION_PERMISSION_OPTIONS[normaliseCreateSessionKind(kind)] || [];
  return options.some(([v]) => v === value) ? value : 'default';
}

function normaliseCreateSessionDefault(kind, raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const cleanKind = normaliseCreateSessionKind(kind);
  const launchMode = validCreateSessionLaunchMode(cleanKind, String(source.launchMode || 'default').toLowerCase());
  const indexRaw = Number(source.index);
  return {
    projectDir: typeof source.projectDir === 'string' ? source.projectDir.slice(0, 4096) : '',
    label: typeof source.label === 'string' ? source.label.replace(/[\r\n\t]/g, ' ').slice(0, 60).trim() : '',
    index: Number.isFinite(indexRaw) ? Math.max(0, Math.min(23, Math.floor(indexRaw))) : 0,
    launchMode,
  };
}

function readCreateSessionDefaults(cfg) {
  const panels = cfg && cfg.panels && typeof cfg.panels === 'object' ? cfg.panels : {};
  const rawDefaults = panels.create_session_defaults && typeof panels.create_session_defaults === 'object'
    ? panels.create_session_defaults
    : {};
  createSessionDefaults = {
    kind: normaliseCreateSessionKind(panels.create_session_default_kind),
    defaults: {
      codex: normaliseCreateSessionDefault('codex', rawDefaults.codex),
      claude: normaliseCreateSessionDefault('claude', rawDefaults.claude),
      'claude-desktop': normaliseCreateSessionDefault('claude-desktop', rawDefaults['claude-desktop']),
    },
  };
}

function applyCreateSessionDefault(kind, { setKind = false } = {}) {
  if (!createSessionKindEl) return;
  const cleanKind = normaliseCreateSessionKind(kind);
  const saved = createSessionDefaults.defaults[cleanKind];
  if (setKind) createSessionKindEl.value = cleanKind;
  populateCreateSessionLaunchModes();
  updateCreateSessionPlaceholders();
  if (!saved) return;
  if (createSessionLaunchModeEl) createSessionLaunchModeEl.value = validCreateSessionLaunchMode(cleanKind, saved.launchMode);
  if (createSessionProjectEl) createSessionProjectEl.value = saved.projectDir || '';
  if (createSessionLabelEl) createSessionLabelEl.value = saved.label || '';
  if (createSessionIndexEl) createSessionIndexEl.value = String(saved.index || 0);
}

function captureCreateSessionDefault() {
  const kind = normaliseCreateSessionKind(createSessionKindEl ? createSessionKindEl.value : 'codex');
  return {
    kind,
    value: normaliseCreateSessionDefault(kind, {
      projectDir: createSessionProjectEl ? createSessionProjectEl.value.trim() : '',
      label: createSessionLabelEl ? createSessionLabelEl.value.trim() : '',
      index: createSessionIndexEl ? Number(createSessionIndexEl.value) : 0,
      launchMode: createSessionLaunchModeEl ? createSessionLaunchModeEl.value : 'default',
    }),
  };
}

function initCreateSessionForm() {
  if (!createSessionKindEl || !createSessionBtn) return;
  refreshCreateSessionPalette();
  populateCreateSessionLaunchModes();
  updateCreateSessionPlaceholders();

  createSessionKindEl.addEventListener('change', () => {
    const kind = normaliseCreateSessionKind(createSessionKindEl.value);
    applyCreateSessionDefault(kind);
    setCreateSessionStatus('');
  });

  if (createSessionBrowseEl && createSessionProjectEl) {
    createSessionBrowseEl.addEventListener('click', async () => {
      setCreateSessionStatus('Choosing...', '');
      const result = await window.api.chooseSessionProjectDir(createSessionProjectEl.value.trim());
      if (result && result.ok && result.path) {
        createSessionProjectEl.value = result.path;
        setCreateSessionStatus('');
      } else if (result && result.ok && result.canceled) {
        setCreateSessionStatus('');
      } else {
        setCreateSessionStatus((result && result.error) || 'Folder picker failed.', 'error');
      }
    });
  }

  if (createSessionSaveDefaultBtn) {
    createSessionSaveDefaultBtn.addEventListener('click', async () => {
      const { kind, value } = captureCreateSessionDefault();
      createSessionDefaults = {
        kind,
        defaults: {
          ...(createSessionDefaults.defaults || {}),
          [kind]: value,
        },
      };
      createSessionSaveDefaultBtn.disabled = true;
      setCreateSessionStatus('Saving default...', '');
      try {
        const nextCfg = await window.api.updateConfig({
          panels: {
            create_session_default_kind: kind,
            create_session_defaults: createSessionDefaults.defaults,
          },
        });
        if (nextCfg) {
          readCreateSessionDefaults(nextCfg);
          setCreateSessionStatus('Default saved.', 'ok');
        } else {
          setCreateSessionStatus('Default was not saved.', 'error');
        }
      } catch (e) {
        setCreateSessionStatus((e && e.message) || 'Default was not saved.', 'error');
      } finally {
        createSessionSaveDefaultBtn.disabled = false;
      }
    });
  }

  createSessionBtn.addEventListener('click', async () => {
    const kind = normaliseCreateSessionKind(createSessionKindEl.value);
    const payload = {
      kind,
      launchMode: createSessionLaunchModeEl ? createSessionLaunchModeEl.value : 'default',
      projectDir: createSessionProjectEl ? createSessionProjectEl.value.trim() : '',
      label: createSessionLabelEl ? createSessionLabelEl.value.trim() : '',
      index: createSessionIndexEl ? Number(createSessionIndexEl.value) : 0,
    };
    if (!payload.projectDir) {
      setCreateSessionStatus('Choose a project folder.', 'error');
      return;
    }

    createSessionBtn.disabled = true;
    if (createSessionBrowseEl) createSessionBrowseEl.disabled = true;
    if (createSessionSaveDefaultBtn) createSessionSaveDefaultBtn.disabled = true;
    setCreateSessionStatus('Opening...', '');
    try {
      const result = await window.api.launchAssistantSession(payload);
      if (result && result.ok) {
        const name = payload.kind === 'claude-desktop' ? 'Claude Desktop Code'
          : payload.kind === 'claude' ? 'Claude Code'
          : 'Codex';
        setCreateSessionStatus(`Opening ${name}.`, 'ok');
      } else {
        setCreateSessionStatus((result && result.error) || 'Session launch failed.', 'error');
      }
    } catch (e) {
      setCreateSessionStatus((e && e.message) || 'Session launch failed.', 'error');
    } finally {
      createSessionBtn.disabled = false;
      if (createSessionBrowseEl) createSessionBrowseEl.disabled = false;
      if (createSessionSaveDefaultBtn) createSessionSaveDefaultBtn.disabled = false;
    }
  });
}
initCreateSessionForm();

function settingsTabForTarget(target) {
  const clean = String(target || '').toLowerCase();
  if (clean === 'create' || clean === 'create-session' || clean === 'new-session') return 'create-session';
  if (clean === 'session' || clean === 'sessions' || clean === 'active-sessions') return 'sessions';
  if (clean === 'openai' || clean === 'openai-section') return 'openai';
  if (clean === 'shortcut' || clean === 'shortcuts') return 'shortcuts';
  if (clean === 'about') return 'about';
  if (clean === 'playback') return 'playback';
  return '';
}

function settingsTabForElement(el) {
  if (!el || typeof el.closest !== 'function') return '';
  const page = el.closest('[data-settings-page]');
  return page && page.dataset ? String(page.dataset.settingsPage || '') : '';
}

function setSettingsTab(tab, { preserveScroll = false } = {}) {
  const clean = settingsTabForTarget(tab) || 'playback';
  let found = false;
  for (const page of settingsPageEls) {
    const active = page.dataset.settingsPage === clean;
    page.classList.toggle('active', active);
    page.hidden = !active;
    found = found || active;
  }
  for (const btn of settingsTabEls) {
    const active = btn.dataset.settingsTab === clean;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    btn.tabIndex = active ? 0 : -1;
  }
  if (!found) return;
  if (!preserveScroll) {
    if (settingsPanelInnerEl) settingsPanelInnerEl.scrollTop = 0;
    if (settingsPanelEl) settingsPanelEl.scrollTop = 0;
  }
  if (clean === 'sessions') renderSessionsTable();
  if (clean === 'create-session') refreshCreateSessionPalette();
}

function ensureSettingsTabForElement(el) {
  const tab = settingsTabForElement(el);
  if (tab) setSettingsTab(tab, { preserveScroll: true });
}

function initSettingsTabs() {
  if (!settingsTabEls.length) return;
  for (const btn of settingsTabEls) {
    btn.addEventListener('click', () => setSettingsTab(btn.dataset.settingsTab || 'playback'));
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      const current = settingsTabEls.indexOf(btn);
      let next = current;
      if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = settingsTabEls.length - 1;
      else if (e.key === 'ArrowRight') next = (current + 1) % settingsTabEls.length;
      else if (e.key === 'ArrowLeft') next = (current - 1 + settingsTabEls.length) % settingsTabEls.length;
      const nextBtn = settingsTabEls[next];
      if (nextBtn) {
        setSettingsTab(nextBtn.dataset.settingsTab || 'playback');
        nextBtn.focus();
      }
    });
  }
  setSettingsTab(settingsTabForTarget(settingsScrollTarget) || 'playback');
}
initSettingsTabs();


// EX7d-2 — global settings form (speed slider / auto-prune / auto-
// continue / reload button / palette variant / global voice selects /
// speech-includes checkboxes) extracted into a SettingsForm component.
// The component owns all listener wiring (done once at mount) and
// form population (done whenever cfg changes). Renderer module state
// that callers consume elsewhere (currentPlaybackSpeed for <audio>,
// autoPruneSec for the clip delete timer, collapseDelayMs for idle
// collapse, autoContinueAfterClick for the ended handler) propagates
// back via the onChange callbacks.
const settingsForm = new window.TT_SETTINGS_FORM({
  api: window.api,
  edgeVoices: EDGE_VOICES,
  openaiVoices: OPENAI_VOICES,
  onPlaybackSpeedChange: (v) => {
    currentPlaybackSpeed = v;
    if (audio) audio.playbackRate = v;
  },
  onMasterVolumeChange: (v) => {
    if (audioPlayer && typeof audioPlayer.setMasterVolume === 'function') {
      audioPlayer.setMasterVolume(v);
    }
  },
  onCollapseDelaySecChange: (n) => { collapseDelayMs = normaliseCollapseDelaySec(n) * 1000; },
  onAutoPruneEnabledChange: (on) => setAutoPruneEnabled(on),
  onAutoPruneSecChange: (n) => { autoPruneSec = n; },
  onAutoContinueChange: (on) => { autoContinueAfterClick = on; },
  // Fired after "Use OpenAI as primary" flips so the sessions-table's
  // per-session voice dropdown repaints with the right catalogue.
  onAfterMutation: () => { renderSessionsTable(); refreshCreateSessionPalette(); },
});
settingsForm.mount();

async function loadSettings() {
  const cfg = await window.api.getConfig();
  if (!cfg) return;
  // Cache a snapshot of the live config for anyone that can't go
  // async on each read — currently the HB1 heartbeat timer, which
  // fires every 1 s and wouldn't benefit from an IPC roundtrip.
  // `update-config` is rare; the snapshot is refreshed here and on
  // the settingsForm change callbacks below.
  window.TT_CONFIG_SNAPSHOT = cfg;
  settingsForm.update({ cfg });
  readCreateSessionDefaults(cfg);
  applyCreateSessionDefault(createSessionDefaults.kind, { setKind: true });
  restoreTabsState(cfg);
  // Transcript panel: restore expand/view state from config. Stored
  // under cfg.panels.{transcript_expanded, transcript_view}.
  if (transcriptPanel && cfg && cfg.panels && typeof cfg.panels === 'object') {
    if (typeof cfg.panels.transcript_expanded === 'boolean') {
      transcriptPanel.setExpanded(cfg.panels.transcript_expanded);
    }
    if (cfg.panels.transcript_view === 'spoken' || cfg.panels.transcript_view === 'original') {
      transcriptPanel.setView(cfg.panels.transcript_view);
    }
    fetchSidecarsForRecent();
    transcriptPanel.refresh();
  }
  renderDots();
  // First-run welcome — delegated to lib/first-run-wizard.js's
  // triggerOnFirstRun helper so renderer.js stays under the file-
  // length ceiling. The helper handles platform detection (Mac shows
  // the wizard, Win/Linux falls back to a toast), persists the
  // first_run_completed flag, and is itself a no-op in demo modes.
  if (!isWindowMode && !isSettingsDemoMode && window.TT_FIRST_RUN_WIZARD) {
    window.TT_FIRST_RUN_WIZARD.triggerOnFirstRun({
      cfg, api: window.api,
      modalEl: document.getElementById('firstRunWizard'),
      showStatusToast: _showStatusToast,
    });
  }
}

async function setSettingsOpen(open) {
  document.body.classList.toggle('settings-open', open);
  settingsOpen = open;
  settingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  await window.api.setPanelOpen(open);
  publishInteractiveRegionSoon();
  if (open) {
    applyCollapsed(false);
    renderSessionsTable();
    scrollSettingsTargetIntoView();
  }
  // settingsOpen flag (set above) keeps the poll from collapsing while
  // the panel is up. When closed, the poll picks up normally.
  publishInteractiveRegionSoon();
}

settingsBtn.addEventListener('click', async () => {
  const open = !document.body.classList.contains('settings-open');
  await setSettingsOpen(open);
});

if (isWindowMode && Number.isFinite(autoOpenSettingsMs) && autoOpenSettingsMs > 0) {
  setTimeout(() => {
    if (!document.body.classList.contains('settings-open')) {
      // Capture-mode auto-open is invoked from screenshot scripts and
      // demo flows; if it fails we want to know in the log instead of
      // ending up with a blank-panel screenshot and no clue why.
      setSettingsOpen(true).catch((err) => {
        try {
          if (window.api && window.api.logRendererError) {
            window.api.logRendererError({
              type: 'unhandledrejection',
              message: `auto-open setSettingsOpen failed: ${err && err.message ? err.message : String(err)}`,
              stack: err && err.stack ? err.stack : '',
            });
          }
        } catch {}
      });
    }
  }, autoOpenSettingsMs);
}

function scrollSettingsPanelForDemo(top) {
  if (!isSettingsDemoMode) return;
  const panel = document.getElementById('panel');
  if (!panel) return;
  panel.scrollTo({ top, behavior: 'smooth' });
}

function expandFirstSessionForDemo() {
  if (!isSettingsDemoMode || !sessionsTableEl) return;
  const btn = sessionsTableEl.querySelector('.session-row .chevron');
  if (btn && btn.getAttribute('aria-expanded') !== 'true') {
    btn.click();
  }
}

if (isSettingsDemoMode) {
  function demoWait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  const demoCursor = document.createElement('div');
  demoCursor.className = 'demo-cursor';
  demoCursor.setAttribute('aria-hidden', 'true');
  document.body.appendChild(demoCursor);
  let demoCursorPos = { x: 42, y: 42 };

  function setDemoCursor(x, y) {
    const pad = 10;
    demoCursorPos = {
      x: Math.max(pad, Math.min(window.innerWidth - 36, x)),
      y: Math.max(pad, Math.min(window.innerHeight - 36, y)),
    };
    demoCursor.style.transform = `translate3d(${demoCursorPos.x}px, ${demoCursorPos.y}px, 0)`;
  }

  function elementCenter(el) {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function demoElement(selectorOrFn) {
    if (typeof selectorOrFn === 'function') return selectorOrFn();
    return document.querySelector(selectorOrFn);
  }

  function moveDemoCursorTo(point, duration = 700) {
    if (!point) return Promise.resolve();
    const start = { ...demoCursorPos };
    const startedAt = performance.now();
    return new Promise((resolve) => {
      function tick(now) {
        const t = Math.min(1, (now - startedAt) / Math.max(1, duration));
        const eased = 1 - Math.pow(1 - t, 3);
        setDemoCursor(
          start.x + (point.x - start.x) * eased,
          start.y + (point.y - start.y) * eased
        );
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      }
      requestAnimationFrame(tick);
    });
  }

  async function pointDemoCursorAt(selectorOrFn, duration = 700) {
    const el = demoElement(selectorOrFn);
    ensureSettingsTabForElement(el);
    await moveDemoCursorTo(elementCenter(el), duration);
    return el;
  }

  async function pointDemoCursorAtPart(selectorOrFn, xRatio = 0.5, yRatio = 0.5, duration = 700) {
    const el = demoElement(selectorOrFn);
    if (!el) return null;
    ensureSettingsTabForElement(el);
    const rect = el.getBoundingClientRect();
    await moveDemoCursorTo({
      x: rect.left + (rect.width * xRatio),
      y: rect.top + (rect.height * yRatio),
    }, duration);
    return el;
  }

  function flashDemoClick() {
    demoCursor.classList.add('clicking');
    setTimeout(() => demoCursor.classList.remove('clicking'), 260);
  }

  let demoSelectPopup = null;

  function closeDemoSelectPopup() {
    setDynamicStyle('#demoSelectPopover', null);
    if (demoSelectPopup && demoSelectPopup.select) {
      try { demoSelectPopup.select.blur(); } catch {}
    }
    if (demoSelectPopup && demoSelectPopup.popover) {
      demoSelectPopup.popover.remove();
    }
    document.querySelectorAll('.demo-select-active').forEach((el) => {
      el.classList.remove('demo-select-active');
    });
    demoSelectPopup = null;
  }

  function demoSelectWindow(select, desiredValue, maxRows) {
    const options = Array.from(select.options || []);
    if (options.length <= maxRows) return options;
    const currentIndex = Math.max(0, select.selectedIndex || 0);
    const desiredIndex = Math.max(0, options.findIndex((opt) => opt.value === String(desiredValue)));
    const anchor = Math.min(currentIndex, desiredIndex);
    const start = Math.max(0, Math.min(options.length - maxRows, anchor - 1));
    return options.slice(start, start + maxRows);
  }

  function openDemoSelectPopup(select, desiredValue, maxRows = 7) {
    closeDemoSelectPopup();
    if (!select) return null;
    try { select.focus({ preventScroll: true }); } catch {}
    select.classList.add('demo-select-active');

    const rect = select.getBoundingClientRect();
    const options = demoSelectWindow(select, desiredValue, maxRows);
    const rowHeight = 28;
    const popoverHeight = Math.min(options.length, maxRows) * rowHeight + 8;
    const popover = document.createElement('div');
    popover.id = 'demoSelectPopover'; popover.className = 'demo-select-popover';

    for (const opt of options) {
      const item = document.createElement('div');
      item.className = 'demo-select-option';
      if (opt.selected) item.classList.add('selected');
      if (opt.value === String(desiredValue)) item.classList.add('target');
      item.dataset.value = opt.value;
      item.textContent = opt.textContent || opt.label || opt.value;
      popover.appendChild(item);
    }

    const placement = select.dataset.demoPlacement || '';
    if (placement === 'inline') {
      const row = select.closest('.expanded-row');
      popover.classList.add('demo-select-inline');
      if (row && row.parentElement) row.insertAdjacentElement('afterend', popover);
      else document.body.appendChild(popover);
    } else {
      const belowTop = rect.bottom + 4;
      const aboveTop = rect.top - popoverHeight - 4;
      const top = placement === 'below'
        ? Math.min(belowTop, Math.max(10, window.innerHeight - popoverHeight - 10))
        : belowTop + popoverHeight <= window.innerHeight - 10
        ? belowTop
        : Math.max(10, aboveTop);
      const popupCss = `left: ${Math.max(8, rect.left)}px; width: ${Math.max(190, rect.width)}px; top: ${top}px;`;
      setDynamicStyle('#demoSelectPopover', popupCss);
      document.body.appendChild(popover);
    }
    demoSelectPopup = { popover, select };
    return popover;
  }

  function demoSelectOption(value) {
    if (!demoSelectPopup || !demoSelectPopup.popover) return null;
    return Array.from(demoSelectPopup.popover.querySelectorAll('.demo-select-option'))
      .find((el) => el.dataset.value === String(value)) || null;
  }

  async function chooseDemoSelectOption(selectorOrFn, desiredValue, options = {}) {
    const {
      maxRows = 7,
      openHold = 1200,
      afterPickHold = 700,
      placement = '',
    } = options;
    const select = await pointDemoCursorAt(selectorOrFn, 700);
    if (!select) return null;
    if (placement) select.dataset.demoPlacement = placement;
    await demoWait(140);
    flashDemoClick();
    await demoWait(120);
    openDemoSelectPopup(select, desiredValue, maxRows);
    await demoWait(openHold);
    const optionEl = demoSelectOption(desiredValue);
    if (optionEl) {
      await pointDemoCursorAt(() => optionEl, 560);
      await demoWait(140);
      flashDemoClick();
      select.value = String(desiredValue);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      demoSelectPopup.popover.querySelectorAll('.demo-select-option').forEach((el) => {
        el.classList.toggle('selected', el.dataset.value === String(desiredValue));
      });
      await demoWait(afterPickHold);
    }
    closeDemoSelectPopup();
    if (placement) delete select.dataset.demoPlacement;
    await demoWait(220);
    return select;
  }

  async function clickDemoElement(selectorOrFn, action) {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      try { document.activeElement.blur(); } catch {}
    }
    const el = await pointDemoCursorAt(selectorOrFn, 620);
    await demoWait(120);
    flashDemoClick();
    if (typeof action === 'function') {
      setTimeout(action, 110);
    } else if (el && typeof el.click === 'function') {
      setTimeout(() => el.click(), 110);
    }
    await demoWait(360);
    return el;
  }

  function firstSessionBlock() {
    return sessionsTableEl && sessionsTableEl.querySelector('.session-block');
  }

  function firstSessionRowControl(selector) {
    const block = firstSessionBlock();
    return block ? block.querySelector(selector) : null;
  }

  function _scrollDemoElementIntoView(selectorOrFn, topPadding = 80) {
    const panel = document.getElementById('panel');
    const el = demoElement(selectorOrFn);
    if (!panel || !el) return;
    ensureSettingsTabForElement(el);
    const panelRect = panel.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const top = panel.scrollTop + (elRect.top - panelRect.top) - topPadding;
    panel.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  async function waitForSettingsDemoStart() {
    if (settingsDemoUseStartFlag && window.api && typeof window.api.demoStartReady === 'function') {
      while (true) {
        try {
          if (await window.api.demoStartReady()) return;
        } catch {}
        await demoWait(50);
      }
    }
    const fallback = settingsDemoFallbackMs > 0
      ? new Promise((resolve) => setTimeout(resolve, settingsDemoFallbackMs))
      : new Promise(() => {});
    await Promise.race([settingsDemoStartPromise, fallback]);
  }

  function startSettingsDemoPlaybackChrome(startedAt) {
    if (!settingsDemoVisualDurationMs || !scrubber || !timeEl) return;
    const durationSec = settingsDemoVisualDurationMs / 1000;
    if (playIcon) playIcon.classList.add('hidden');
    if (pauseIcon) pauseIcon.classList.remove('hidden');
    if (scrubberWrap) {
      scrubberWrap.classList.remove('jarvis-mode', 'scrubbing', 'scrubbing-forward', 'scrubbing-backward');
      scrubberWrap.classList.add('walking');
    }
    const heartbeatInitialMs = window.TT_HEARTBEAT.HEARTBEAT_INITIAL_MS || 5000;
    const heartbeatIntervalMs = window.TT_HEARTBEAT.HEARTBEAT_INTERVAL_MS || 8000;
    let nextDemoHeartbeatVerbAt = startedAt + heartbeatInitialMs;
    const tick = () => {
      const now = performance.now();
      const elapsedSec = Math.min(durationSec, Math.max(0, (now - startedAt) / 1000));
      scrubber.value = String(Math.round((elapsedSec / Math.max(0.001, durationSec)) * 1000));
      timeEl.textContent = `${fmt(elapsedSec)} / ${fmt(durationSec)}`;
      if (audioPlayer && typeof audioPlayer.positionScrubberMascot === 'function') {
        audioPlayer.positionScrubberMascot();
      }
      if (
        audioPlayer &&
        typeof audioPlayer.emitDemoSpinnerVerbCloud === 'function' &&
        (window.TT_CONFIG_SNAPSHOT || {}).heartbeat_enabled !== false &&
        now >= nextDemoHeartbeatVerbAt
      ) {
        audioPlayer.emitDemoSpinnerVerbCloud(now, { intervalMs: heartbeatIntervalMs });
        do {
          nextDemoHeartbeatVerbAt += heartbeatIntervalMs;
        } while (nextDemoHeartbeatVerbAt <= now);
      }
      if (elapsedSec < durationSec) {
        requestAnimationFrame(tick);
      } else if (scrubberWrap) {
        scrubberWrap.classList.remove('walking');
      }
    };
    requestAnimationFrame(tick);
  }

  function openAiSectionRow(selector) {
    const el = document.querySelector(selector);
    return el ? el.closest('.row') || el : null;
  }

  async function ensureOpenAiSectionReadyForDemo() {
    const section = document.getElementById('openaiSection');
    if (section && typeof section.scrollIntoView === 'function') {
      section.scrollIntoView({ block: 'start' });
      await demoWait(80);
    }
  }

  async function runOpenAiDemoTimeline() {
    setDemoCursor(window.innerWidth - 90, 62);
    await waitForSettingsDemoStart();
    const startedAt = performance.now();
    startSettingsDemoPlaybackChrome(startedAt);
    async function waitUntil(ms) {
      const remaining = startedAt + ms - performance.now();
      if (remaining > 0) await demoWait(remaining);
    }

    await waitUntil(250);
    await clickDemoElement('#settingsBtn', () => setSettingsOpen(true).catch(() => {}));
    await waitUntil(1500);
    await clickDemoElement('[data-settings-tab="openai"]');
    await waitUntil(2400);
    await pointDemoCursorAt('#openaiSection header', 700);
    await waitUntil(4200);
    await ensureOpenAiSectionReadyForDemo();
    await waitUntil(6500);
    await pointDemoCursorAt('#openaiSection .panel-hint', 820);
    await waitUntil(11800);
    await pointDemoCursorAt(() => openAiSectionRow('#openaiKeyInput') || openAiSectionRow('#openaiKeyChange'), 760);
    await waitUntil(17800);
    await pointDemoCursorAt(() => openAiSectionRow('#openaiKeyStatus'), 720);
    await waitUntil(23000);
    await pointDemoCursorAt(() => openAiSectionRow('#openaiPreferToggle'), 720);
    await waitUntil(27200);
    await pointDemoCursorAt(() => openAiSectionRow('#openaiFallbackToggle'), 720);
    await waitUntil(31500);
    await clickDemoElement(() => openAiSectionRow('#openaiPreferToggle')?.querySelector('.tri-btn.on'));
    await waitUntil(36500);
    await clickDemoElement(() => openAiSectionRow('#openaiFallbackToggle')?.querySelector('.tri-btn.on'));
    await waitUntil(40500);
    await pointDemoCursorAt(() => openAiSectionRow('#openaiTestBtn'), 760);
    await waitUntil(45200);
    await clickDemoElement(() => openAiSectionRow('#openaiFallbackToggle')?.querySelector('.tri-btn.off'));
    await waitUntil(49200);
    await clickDemoElement(() => openAiSectionRow('#openaiPreferToggle')?.querySelector('.tri-btn.off'));
    await waitUntil(51200);
    await pointDemoCursorAt('#openaiSection header', 700);
  }

  async function runSessionsSyncDemoTimeline() {
    setDemoCursor(window.innerWidth - 90, 62);
    await waitForSettingsDemoStart();
    const startedAt = performance.now();
    startSettingsDemoPlaybackChrome(startedAt);
    async function waitUntil(ms) {
      const remaining = startedAt + ms - performance.now();
      if (remaining > 0) await demoWait(remaining);
    }

    await waitUntil(350);
    await pointDemoCursorAt(() => tabsEl, 700);
    await waitUntil(3000);
    await pointDemoCursorAt('#dots', 700);
    await waitUntil(6000);
    await clickDemoElement('#settingsBtn', () => setSettingsOpen(true).catch(() => {}));
    await waitUntil(7800);
    await clickDemoElement('[data-settings-tab="sessions"]');
    await waitUntil(9300);
    await pointDemoCursorAt(() => sessionsTableEl, 700);
    await waitUntil(13200);
    await pointDemoCursorAt(() => firstSessionRowControl('input[type="text"]'), 700);
    await waitUntil(17600);
    await chooseDemoSelectOption(() => firstSessionRowControl('.session-row select'), '17', {
      maxRows: 7,
      openHold: 1500,
      afterPickHold: 800,
    });
    await waitUntil(24400);
    await pointDemoCursorAt(() => firstSessionRowControl('.focus-btn'), 680);
    await waitUntil(29000);
    await pointDemoCursorAt(() => firstSessionRowControl('.mute-btn'), 680);
    await waitUntil(33400);
    await clickDemoElement(() => firstSessionRowControl('.chevron'), expandFirstSessionForDemo);
    await waitUntil(35400);
    scrollSettingsPanelForDemo(320);
    await waitUntil(37200);
    await chooseDemoSelectOption(() => firstSessionRowControl('.session-expanded select'), 'en-GB-SoniaNeural', {
      maxRows: 6,
      openHold: 2100,
      afterPickHold: 900,
      placement: 'inline',
    });
    await waitUntil(45200);
    await pointDemoCursorAt(() => firstSessionRowControl('.session-expanded .tri-grid:first-of-type'), 740);
    await waitUntil(49200);
    await clickDemoElement(() => firstSessionRowControl('.session-expanded .tri-grid:first-of-type .tri-btn.off'));
    await waitUntil(53200);
    await pointDemoCursorAt(() => firstSessionRowControl('.session-expanded .tri-grid:last-of-type'), 740);
    await waitUntil(57000);
    await clickDemoElement(() => firstSessionRowControl('.session-expanded .tri-grid:last-of-type .tri-cell:nth-child(7) .tri-btn.on'));
    await waitUntil(61000);
    await clickDemoElement('[data-settings-tab="about"]');
    await waitUntil(62600);
    await pointDemoCursorAt('.panel-section.about .panel-hint:last-of-type', 760);
  }

  async function runTranscriptDemoTimeline() {
    setDemoCursor(window.innerWidth - 90, 62);
    await waitForSettingsDemoStart();
    const startedAt = performance.now();
    startSettingsDemoPlaybackChrome(startedAt);
    async function waitUntil(ms) {
      const remaining = startedAt + ms - performance.now();
      if (remaining > 0) await demoWait(remaining);
    }

    await waitUntil(450);
    await pointDemoCursorAt('#dots', 740);
    await waitUntil(4300);
    await clickDemoElement('#transcriptToggle', () => {
      if (transcriptPanel && typeof transcriptPanel.setExpanded === 'function') {
        transcriptPanel.setExpanded(true);
      }
    });
    await waitUntil(7600);
    await pointDemoCursorAt('#transcriptList', 780);
    await waitUntil(13500);
    await pointDemoCursorAt('#transcriptViewToggle', 700);
    await waitUntil(17500);
    await clickDemoElement('#transcriptViewToggle');
    await waitUntil(22500);
    await pointDemoCursorAt(() => transcriptListEl && transcriptListEl.querySelector('.transcript-copy'), 700);
    await waitUntil(28500);
    await pointDemoCursorAt(() => tabsEl, 740);
    await waitUntil(34000);
    await clickDemoElement(() => tabsEl && tabsEl.querySelector('[role="tab"]:not([data-tab-id="all"])'));
    await waitUntil(40500);
    await clickDemoElement(() => tabsEl && tabsEl.querySelector('[data-tab-id="all"]'));
    await waitUntil(46800);
    await pointDemoCursorAt('#transcriptList', 700);
  }

  async function runSettingsDemoTimeline() {
    setDemoCursor(window.innerWidth - 90, 62);
    await waitForSettingsDemoStart();
    const startedAt = performance.now();
    startSettingsDemoPlaybackChrome(startedAt);
    async function waitUntil(ms) {
      const remaining = startedAt + ms - performance.now();
      if (remaining > 0) await demoWait(remaining);
    }

    await waitUntil(250);
    await clickDemoElement('#settingsBtn', () => setSettingsOpen(true).catch(() => {}));

    await waitUntil(1700);
    scrollSettingsPanelForDemo(0);
    await pointDemoCursorAt('#speedSlider', 780);
    await waitUntil(3300);
    await pointDemoCursorAt('#volumeSlider', 720);
    await waitUntil(4700);
    await pointDemoCursorAt('#collapseDelaySec', 720);
    await waitUntil(6200);
    await pointDemoCursorAtPart(() => document.querySelector('label[for="autoPruneToggle"]')?.closest('.row'), 0.36, 0.5, 800);
    await waitUntil(8300);
    await pointDemoCursorAt('#autoPruneSec', 720);
    await waitUntil(10100);
    await pointDemoCursorAt(() => document.querySelector('#heartbeatToggle')?.closest('.row'), 700);
    await waitUntil(11800);
    await pointDemoCursorAt(() => document.querySelector('#incToolCalls')?.closest('.row'), 700);

    await waitUntil(14000);
    await pointDemoCursorAtPart(() => document.querySelector('label[for="autoPruneToggle"]')?.closest('.row'), 0.36, 0.5, 450);
    await waitUntil(19000);
    await pointDemoCursorAt(() => document.querySelector('#heartbeatToggle')?.closest('.row'), 650);
    await waitUntil(22500);
    await pointDemoCursorAt(() => document.querySelector('#incToolCalls')?.closest('.row'), 650);

    await waitUntil(25000);
    await clickDemoElement('[data-settings-tab="openai"]');
    await waitUntil(26000);
    await ensureOpenAiSectionReadyForDemo();
    await waitUntil(27000);
    await pointDemoCursorAt(() => openAiSectionRow('#openaiPreferToggle'), 680);
    await waitUntil(30000);
    await pointDemoCursorAt(() => openAiSectionRow('#openaiFallbackToggle'), 680);
    await waitUntil(33500);
    await pointDemoCursorAt(() => openAiSectionRow('#openaiTestBtn'), 680);

    await waitUntil(36500);
    await clickDemoElement('[data-settings-tab="shortcuts"]');
    await waitUntil(38200);
    await pointDemoCursorAt('#hotkeyToggleWindow', 700);
    await waitUntil(41000);
    await clickDemoElement('#hotkeyToggleWindow');
    await waitUntil(43800);
    await pointDemoCursorAt('#hotkeyResetDefaults', 650);

    await waitUntil(47000);
    await clickDemoElement('[data-settings-tab="sessions"]');
    await waitUntil(48800);
    await pointDemoCursorAt(() => sessionsTableEl, 650);
    await waitUntil(50600);
    await pointDemoCursorAt(() => firstSessionRowControl('input[type="text"]'), 740);
    await waitUntil(52600);
    await pointDemoCursorAt(() => firstSessionRowControl('.focus-btn'), 620);
    await waitUntil(54400);
    await pointDemoCursorAt(() => firstSessionRowControl('.mute-btn'), 620);
    await waitUntil(56200);
    await chooseDemoSelectOption(() => firstSessionRowControl('.session-row select'), '1', {
      maxRows: 6,
      openHold: 1500,
      afterPickHold: 900,
    });

    await waitUntil(60000);
    await clickDemoElement(() => firstSessionRowControl('.chevron'), expandFirstSessionForDemo);
    await waitUntil(61200);
    scrollSettingsPanelForDemo(300);
    await waitUntil(62500);
    await chooseDemoSelectOption(() => firstSessionRowControl('.session-expanded select'), 'en-GB-RyanNeural', {
      maxRows: 5,
      openHold: 2300,
      afterPickHold: 950,
      placement: 'inline',
    });

    await waitUntil(67500);
    scrollSettingsPanelForDemo(350);
    await waitUntil(68600);
    await pointDemoCursorAt(() => firstSessionRowControl('.session-expanded .tri-grid:first-of-type'), 720);
    await waitUntil(70400);
    await clickDemoElement(() => firstSessionRowControl('.session-expanded .tri-grid:first-of-type .tri-btn.off'));
    await waitUntil(72400);
    await pointDemoCursorAt(() => firstSessionRowControl('.session-expanded .tri-grid:last-of-type'), 620);

    await waitUntil(74200);
    await clickDemoElement('[data-settings-tab="about"]');
    await waitUntil(75800);
    await pointDemoCursorAt('.about-wallpaper-card', 900);
  }

  const timeline = settingsDemoVariant === 'openai'
    ? runOpenAiDemoTimeline
    : settingsDemoVariant === 'sessions'
    ? runSessionsSyncDemoTimeline
    : settingsDemoVariant === 'transcript'
    ? runTranscriptDemoTimeline
    : runSettingsDemoTimeline;
  timeline().catch(() => {});
}

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
document.addEventListener('mouseleave', () => {
  cursorX = -1;
  cursorY = -1;
  updateClickthrough();
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
if (window.api.onCursorInteractiveState) {
  window.api.onCursorInteractiveState((state) => {
    mainCursorOverInteractive = !!(state && state.overInteractive);
    if (!mainCursorOverInteractive) {
      cursorX = -1;
      cursorY = -1;
    }
    if (mainCursorOverInteractive) bumpActivity();
  });
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
// Mic-watcher auto-pause / auto-resume. The mic-watcher PS sidecar in
// main.js detects when any other app (Wispr Flow, Windows Voice Access,
// VoIP, etc.) starts or stops using the microphone. We pause TTS while
// they're recording and resume from the exact same point when they let
// go — user never plays over their dictation, never misses content
// while they talk. The _systemAutoPaused flag on AudioPlayer is the
// gate for auto-resume: a user-initiated pause sets it false, so we
// don't undo it just because the mic was released.
if (window.api.onMicCapturedElsewhere) {
  // Always arm the mic-gate, even when nothing is playing. systemAutoPause
  // sets `_micCaptured = true` first, then internally guards the
  // .pause() call — so calling it during silence is safe and necessary:
  // without the flag arming, heartbeat ticks fire mid-dictation when
  // there was no in-flight clip to "save" us.
  window.api.onMicCapturedElsewhere(() => {
    audioPlayer.systemAutoPause();
  });
}
if (window.api.onMicReleased) {
  window.api.onMicReleased(() => {
    audioPlayer.systemAutoResume();
  });
}
// Voice-command dispatch — see app/lib/voice-command-dispatch.js. Completes
// the wake-word → voice-command.json → watcher → renderer chain.
if (window.api.onVoiceCommand && window.TT_VOICE_COMMAND_DISPATCH) {
  window.api.onVoiceCommand(window.TT_VOICE_COMMAND_DISPATCH.createVoiceCommandDispatch({
    audioPlayer,
    startDictation: () => window.api.startDictation?.({ paste: true, manualStop: true, source: 'voice-command' }),
    stopDictation: () => window.api.stopDictation?.('voice-command'),
    onUnknown: (a) => { try { window.api?.logRendererError?.({ at: 'voice-command-unknown', message: `unknown action: ${a}` }); } catch {} },
    onError: (_a, e) => { try { window.api?.logRendererError?.({ at: 'voice-command-dispatch', message: String((e && e.message) || e) }); } catch {} },
  }));
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
publishInteractiveRegionSoon();

// Republish once initialLoad's renderDots populates the tabs row. tabs.update
// renders on a RAF, so the first publish above measures a toolbar that's still
// missing the [All] tab — main keeps that shorter region and the transcript
// header area stays click-through until a later transition republishes.
initialLoad().then(() => publishInteractiveRegionSoon());
