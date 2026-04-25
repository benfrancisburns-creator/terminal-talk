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
function isQueueActive() {
  const audioBusy = audio.src && !audio.paused && !audio.ended && audio.readyState >= 2;
  if (audioBusy) return true;
  const freshCutoff = Date.now() - ACTIVE_FRESH_MS;
  return queue.some(f =>
    (f.mtime || 0) >= freshCutoff &&
    !playedPaths.has(f.path) &&
    !isPathSessionMuted(f.path)
  );
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
const priorityPaths = new Set();
const priorityQueue = [];
let pendingQueue = [];
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
// EX7e — isClipFile wrapper removed: sole caller (updateScrubberMode)
// moved into AudioPlayer; component reads clipPaths.isClipFile directly.
const _paths = window.TT_CLIP_PATHS;
const extractSessionShort = _paths.extractSessionShort;
const isEphemeralClip = _paths.isEphemeralClip;

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
  const delay = ephemeral
    ? EPHEMERAL_DELETE_DELAY_MS
    : Math.max(3, Math.min(600, autoPruneSec)) * 1000;
  const t = setTimeout(async () => {
    deleteTimers.delete(p);
    if (audioPlayer.getCurrentPath() === p) return;
    try { console.log('[scheduleAutoDelete] FIRING:', p.split(/[\\/]/).pop(), 'autoPruneEnabled=' + autoPruneEnabled); } catch {}
    playedPaths.delete(p);
    heardPaths.delete(p);
    queue = queue.filter(f => f.path !== p);
    renderDots();
    // Race defence: between the sync checks above and the IPC returning,
    // the user could have re-played the clip (priority re-queue, manual
    // click landing on a queue-updated event). Re-verify the path really
    // isn't the current one before the file is unlinked on disk.
    if (audioPlayer.getCurrentPath() === p) return;
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
// `tabsExpanded` controls the [▾ N idle] overflow disclosure. Both persist
// via writeConfig so the toolbar remembers across restarts; on load we
// defensively fall back to 'all' if the previously-selected session no
// longer exists in the registry.
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
  onPlayStart: (p) => cancelAutoDelete(p),
  onClipEnded: (p, { manual }) => scheduleAutoDelete(p, manual),
  onPlayNextPending: () => playNextPending(),
  onRenderDots: () => renderDots(),
});
audioPlayer.mount();

function renderDots() {
  // Defensive fallback: if the persisted selectedTab points at a short
  // that no longer appears in either queue or sessionAssignments, revert
  // to 'all' so the user isn't stuck staring at an empty strip.
  if (selectedTab !== 'all' && !sessionAssignments[selectedTab]) {
    const stillQueued = queue.some((f) => {
      const fname = f.path.split(/[\\/]/).pop();
      return window.TT_CLIP_PATHS.extractSessionShort(fname) === selectedTab;
    });
    if (!stillQueued) {
      selectedTab = 'all';
      persistTabsState();
    }
  }

  // Tab filter: 'all' passes the queue through; a session shortId keeps
  // only clips that belong to that session. The underlying `queue` array
  // stays the single source of truth — DotStrip gets a filtered view,
  // playback order + heardPaths tracking continue globally.
  const shortId = selectedTab;
  const visibleQueue = shortId === 'all'
    ? queue
    : queue.filter((f) => {
        const fname = f.path.split(/[\\/]/).pop();
        return window.TT_CLIP_PATHS.extractSessionShort(fname) === shortId;
      });

  dotStrip.update({
    queue: visibleQueue,
    currentPath: audioPlayer.getCurrentPath(),
    heardPaths,
    sessionAssignments,
    synthInProgress,
  });

  // Tabs always see the FULL queue (so per-tab unread counts stay
  // accurate even while a non-All tab is selected). allQueuePaths
  // carries every on-disk audio path (uncapped) so the badge count
  // reflects the real backlog past MAX_FILES — deleting a clip
  // actually decrements the number you see instead of the old
  // "delete 20, next 20 slide in, badge stays at 20" loop.
  tabs.update({
    queue,
    allPaths: allQueuePaths,
    heardPaths,
    sessionAssignments,
    selectedTab,
    expanded: tabsExpanded,
  });
}

function playPath(p, manual = false, userClick = false) {
  return audioPlayer.playPath(p, manual, userClick);
}

function userPlay(p) {
  audioPlayer.playPath(p, true, true);
}

async function deleteDot(p) {
  cancelAutoDelete(p);
  if (audioPlayer.getCurrentPath() === p) {
    audioPlayer.abort();
  }
  pendingQueue = pendingQueue.filter(x => x !== p);
  playedPaths.delete(p);
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

  const toDelete = queue.filter((f) => heardPaths.has(f.path) && f.path !== audioPlayer.getCurrentPath());
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
    if (f.mtime < cutoff) playedPaths.add(f.path);
  }
  for (const f of unplayed) {
    if (!pendingQueue.includes(f.path)) pendingQueue.push(f.path);
  }
  renderDots();
  if (audioPlayer.isIdle()) {
    playNextPending();
  }
}

window.api.onQueueUpdated((payload) => {
  const files = Array.isArray(payload) ? payload : (payload && payload.files) || [];
  if (payload && payload.assignments) {
    sessionAssignments = payload.assignments;
    if (document.body.classList.contains('settings-open')) renderSessionsTable();
  }
  allQueuePaths = (payload && Array.isArray(payload.allPaths)) ? payload.allPaths : files.map((f) => f.path);
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
  const cur = audioPlayer.getCurrentPath();
  if (cur && isPathSessionMuted(cur)) {
    audioPlayer.abort();
    playedPaths.delete(cur);
  }
  renderDots();

  if (audioPlayer.isIdle()) {
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
  const aborted = audioPlayer.abortIfAutoPlayed();
  if (aborted) playedPaths.delete(aborted);
  renderDots();
  if (audioPlayer.isIdle()) playNextPending();
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
  onMasterVolumeChange: (v) => {
    if (audioPlayer && typeof audioPlayer.setMasterVolume === 'function') {
      audioPlayer.setMasterVolume(v);
    }
  },
  onAutoPruneEnabledChange: (on) => setAutoPruneEnabled(on),
  onAutoPruneSecChange: (n) => { autoPruneSec = n; },
  onAutoContinueChange: (on) => { autoContinueAfterClick = on; },
  // Fired after "Use OpenAI as primary" flips so the sessions-table's
  // per-session voice dropdown repaints with the right catalogue.
  onAfterMutation: () => { renderSessionsTable(); },
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
  restoreTabsState(cfg);
  renderDots();
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
    // #25 — re-evaluate per-panel-open lifecycle decisions (OpenAI
    // section auto-collapse defaults, etc.).
    if (settingsForm && typeof settingsForm.onPanelOpen === 'function') {
      settingsForm.onPanelOpen();
    }
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
// Mic-watcher auto-pause / auto-resume. The mic-watcher PS sidecar in
// main.js detects when any other app (Wispr Flow, Windows Voice Access,
// VoIP, etc.) starts or stops using the microphone. We pause TTS while
// they're recording and resume from the exact same point when they let
// go — user never plays over their dictation, never misses content
// while they talk. The _systemAutoPaused flag on AudioPlayer is the
// gate for auto-resume: a user-initiated pause sets it false, so we
// don't undo it just because the mic was released.
if (window.api.onMicCapturedElsewhere) {
  window.api.onMicCapturedElsewhere(() => {
    if (!audio.src || audio.ended || audio.paused) return;
    audioPlayer.systemAutoPause();
  });
}
if (window.api.onMicReleased) {
  window.api.onMicReleased(() => {
    audioPlayer.systemAutoResume();
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
