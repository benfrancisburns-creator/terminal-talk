const audio = document.getElementById('audio');
const dotsEl = document.getElementById('dots');
const playPauseBtn = document.getElementById('playPause');
const playIcon = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');
const back10Btn = document.getElementById('back10');
const fwd10Btn = document.getElementById('fwd10');
const scrubber = document.getElementById('scrubber');
const timeEl = document.getElementById('time');
const closeBtn = document.getElementById('close');
const clearPlayedBtn = document.getElementById('clearPlayed');
const barEl = document.getElementById('bar');

// -------------------------------------------------------------------
// Collapse-on-idle behaviour
// -------------------------------------------------------------------
// When the user isn't touching the toolbar and no clip is arriving, the
// bar shrinks to a slim 8px strip and the window becomes click-through
// (clicks pass to whatever's underneath). It expands back on hover, on a
// new clip arrival, or on any user interaction. 4 seconds of no
// interaction → auto-collapse.
// 15 s idle delay — long enough that short lulls between streaming clips
// don't cause flicker, short enough that the bar stays out of the way
// during genuinely quiet periods.
const COLLAPSE_DELAY_MS = 15000;
const COLLAPSE_RECHECK_MS = 3000;  // poll interval when something's still active
let isCollapsed = false;
let collapseTimer = null;
let settingsOpen = false;  // don't collapse while the settings panel is open

async function applyCollapsed(collapsed) {
  if (collapsed === isCollapsed) return;
  isCollapsed = collapsed;
  if (collapsed) {
    barEl.classList.add('collapsed');
    // Give clicks access to apps below; forward: true preserves mousemove
    // so the renderer can still detect hover and re-expand.
    try { await window.api.setClickthrough(true); } catch {}
  } else {
    barEl.classList.remove('collapsed');
    try { await window.api.setClickthrough(false); } catch {}
  }
}

function isQueueActive() {
  // Still something playing out loud?
  const audioBusy = audio.src && !audio.paused && !audio.ended && audio.readyState >= 2;
  if (audioBusy) return true;
  // Unplayed, unmuted clips sitting in the queue?
  return queue.some(f => !playedPaths.has(f.path) && !isPathSessionMuted(f.path));
}

function scheduleCollapse(delay = COLLAPSE_DELAY_MS) {
  cancelCollapse();
  if (settingsOpen) return;  // user is actively configuring, stay put
  collapseTimer = setTimeout(() => {
    // When the timer fires, re-check whether anything's still happening.
    // If audio is playing or unplayed clips remain, defer — don't
    // collapse mid-flow. Ben's flicker bug was the old 4 s timer firing
    // between streaming clip arrivals. Now we poll every 3 s until the
    // queue is genuinely drained, then honour the original idle delay.
    if (isQueueActive()) {
      scheduleCollapse(COLLAPSE_RECHECK_MS);
      return;
    }
    applyCollapsed(true);
  }, delay);
}
function cancelCollapse() {
  if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null; }
}
function bumpActivity() {
  applyCollapsed(false);
  scheduleCollapse();
}

let queue = [];
let currentPath = null;
let currentIsManual = false;
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
const MAX_VISIBLE_DOTS = 40;            // hard cap to keep DOM light; overflow scrolls horizontally

// Base 8 colours. Same order statusline.ps1 uses for its 8 emojis.
// Brown is a richer copper (was muddy beige #a08060) so it reads clearly in splits.
const BASE_COLOURS = [
  '#ff5e5e', // 0 red
  '#ffa726', // 1 orange (warmer/yellower so it reads clearly next to red)
  '#ffd93d', // 2 yellow
  '#4ade80', // 3 green
  '#60a5fa', // 4 blue
  '#c084fc', // 5 purple
  '#c97b50', // 6 brown (copper -- distinct from orange)
  '#e0e0e0'  // 7 white
];
const PALETTE_SIZE = 24;
const NEUTRAL_COLOUR = '#8a8a8a';

// Split partners chosen by max hue distance so the two halves never blur.
// hsplit pairs (top, bottom):  red/green, orange/blue, yellow/purple, brown/white (+ reverses)
const HSPLIT_PARTNER = [3, 4, 5, 0, 1, 2, 7, 6];
// vsplit pairs (left, right):  red/blue, orange/purple, yellow/brown, green/white (+ reverses)
const VSPLIT_PARTNER = [4, 5, 6, 7, 0, 1, 2, 3];

// Assignments registry (session_short -> { index }) provided by main via IPC.
let sessionAssignments = {};

// Helpers that read muted state off the current sessionAssignments cache.
// Kept here (not inside renderDots / playNextPending) so every call site
// uses the exact same rule.
function isClipSessionMuted(filename) {
  const short = extractSessionShort(filename);
  if (!short) return false;  // neutral (hey-jarvis) clips never muted
  const entry = sessionAssignments[short];
  return !!(entry && entry.muted);
}
function isPathSessionMuted(p) {
  const name = p.split(/[\\/]/).pop();
  return isClipSessionMuted(name);
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
  // Response / question / notif: ends with -<8hex>.ext
  let m = filename.match(/-([a-f0-9]{8})\.(wav|mp3)$/i);
  if (m) return m[1].toLowerCase();
  // Highlight clip: -clip-<8hex|neutral>-<idx>.ext
  m = filename.match(/-clip-([a-f0-9]{8}|neutral)-\d+\.(wav|mp3)$/i);
  if (m) return m[1].toLowerCase() === 'neutral' ? null : m[1].toLowerCase();
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

function renderDots() {
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
    if (f.path === currentPath) dot.classList.add('active');
    const name = f.path.split(/[\\/]/).pop();
    const short = extractSessionShort(name);
    const arr = arrangementForShort(short);
    const bg = arr ? backgroundForArrangement(arr) : NEUTRAL_COLOUR;
    const ringColour = arr ? primaryColourForArrangement(arr) : NEUTRAL_COLOUR;
    if (isClipFile(name)) {
      dot.classList.add('clip');
      dot.textContent = 'J';
    }
    if (heardPaths.has(f.path)) {
      dot.classList.add('heard');
      // White fill + session-colour ring so origin is still visible during the 90s countdown.
      dot.style.boxShadow = `0 0 0 2px ${ringColour}`;
    } else {
      dot.style.background = bg;
    }
    const entry = short ? sessionAssignments[short] : null;
    const label = entry && entry.label ? ` [${entry.label}]` : '';
    const d = new Date(f.mtime);
    dot.title = `Created ${d.toLocaleTimeString()}${label} — click to play, right-click to delete`;
    dot.addEventListener('click', () => userPlay(f.path));
    dot.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      deleteDot(f.path);
    });
    dotsEl.appendChild(dot);
  });
}

function playPath(p, manual = false) {
  const idx = queue.findIndex(f => f.path === p);
  if (idx < 0) return false;
  cancelAutoDelete(p);
  currentPath = p;
  currentIsManual = manual;
  audio.src = fileUrl(p);
  audio.currentTime = 0;
  audio.playbackRate = currentPlaybackSpeed;
  audio.play().catch(() => {});
  playedPaths.add(p);
  if (manual) heardPaths.add(p);
  pendingQueue = pendingQueue.filter(x => x !== p);
  renderDots();
  return true;
}

function userPlay(p) {
  playPath(p, true);
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
  //    of mute state; the user explicitly asked for it.
  while (priorityQueue.length > 0) {
    const next = priorityQueue.shift();
    if (queue.find(f => f.path === next)) {
      playPath(next, true);
      return;
    }
  }
  // 2. Explicit pending queue — clips queued in arrival order.
  //    Skip muted-session clips; drop the whole file (don't re-queue).
  while (pendingQueue.length > 0) {
    const next = pendingQueue.shift();
    if (isPathSessionMuted(next)) continue;
    if (queue.find(f => f.path === next)) {
      playPath(next);
      return;
    }
  }
  // 3. Fallback: any unplayed, unmuted clip still sitting in the queue.
  //    Covers every edge case where pendingQueue got out of sync — pause
  //    then resume, clip arriving during a race, manual deletes reshaping
  //    state, unmute flipping a session back on. Oldest first.
  const candidate = queue
    .filter(f => !playedPaths.has(f.path) && !isPathSessionMuted(f.path))
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
  for (const f of files) {
    if (f.mtime < cutoff) {
      playedPaths.add(f.path);
    } else if (!pendingQueue.includes(f.path)) {
      pendingQueue.push(f.path);
    }
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
  // New unmuted clip arrived → pop the toolbar out so the user sees the
  // dot, then start the 4s auto-collapse timer.
  const hasVisibleArrival = newArrivals.some(f =>
    !priorityPaths.has(f.path) && !isClipSessionMuted(f.path.split(/[\\/]/).pop())
  );
  if (hasVisibleArrival) {
    applyCollapsed(false);
    scheduleCollapse();
  }
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

window.api.onPriorityPlay((paths) => {
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

audio.addEventListener('play', () => {
  playIcon.style.display = 'none';
  pauseIcon.style.display = '';
});
audio.addEventListener('pause', () => {
  playIcon.style.display = '';
  pauseIcon.style.display = 'none';
});
audio.addEventListener('ended', () => {
  playIcon.style.display = '';
  pauseIcon.style.display = 'none';
  const justPlayed = currentPath;
  const wasManual = currentIsManual;
  currentPath = null;
  currentIsManual = false;
  renderDots();
  // Both auto-played and manually-played clips get auto-deleted now — only
  // the delay differs (30 s auto vs 90 s manual). Previously auto-played
  // clips accumulated indefinitely, flooding the toolbar.
  if (justPlayed) scheduleAutoDelete(justPlayed, wasManual);
  // Always call playNextPending: it picks from priority → pending → fallback
  // scan of unplayed clips still sitting in queue. The old gate skipped the
  // fallback entirely when both explicit queues were empty, leaving unplayed
  // arrivals stranded after a manually-started clip ended.
  playNextPending();
});

audio.addEventListener('error', () => {
  playIcon.style.display = '';
  pauseIcon.style.display = 'none';
  currentPath = null;
  currentIsManual = false;
  renderDots();
  playNextPending();
});

audio.addEventListener('timeupdate', () => {
  if (userScrubbing) return;
  if (isFinite(audio.duration) && audio.duration > 0) {
    scrubber.value = Math.round((audio.currentTime / audio.duration) * 1000);
    timeEl.textContent = `${fmt(audio.currentTime)} / ${fmt(audio.duration)}`;
  } else {
    timeEl.textContent = `${fmt(audio.currentTime)} / 0:00`;
  }
});
audio.addEventListener('loadedmetadata', () => {
  timeEl.textContent = `0:00 / ${fmt(audio.duration)}`;
});

scrubber.addEventListener('mousedown', () => { userScrubbing = true; });
scrubber.addEventListener('mouseup', () => {
  if (isFinite(audio.duration)) {
    audio.currentTime = (scrubber.value / 1000) * audio.duration;
  }
  userScrubbing = false;
});
scrubber.addEventListener('input', () => {
  if (isFinite(audio.duration)) {
    const t = (scrubber.value / 1000) * audio.duration;
    timeEl.textContent = `${fmt(t)} / ${fmt(audio.duration)}`;
  }
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
  if (e.key === 'Escape') window.api.hideWindow();
  if (e.key === ' ') { e.preventDefault(); playPauseBtn.click(); }
  if (e.key === 'ArrowLeft') back10Btn.click();
  if (e.key === 'ArrowRight') fwd10Btn.click();
});

// ============================================================================
// Settings panel -- expanded view below the toolbar letterbox.
// ============================================================================

let currentPlaybackSpeed = 1.25; // updated from config on load

// Edge TTS English voices, verified live against `edge_tts.list_voices()`.
// To regenerate this list: see scripts/refresh-voice-list.cjs (TBD) or run
// `python -m edge_tts --list-voices` and filter Locale=en-*.
const EDGE_VOICES = [
  // United Kingdom (5)
  { id: 'en-GB-RyanNeural',     label: 'Ryan (UK, male)' },
  { id: 'en-GB-SoniaNeural',    label: 'Sonia (UK, female)' },
  { id: 'en-GB-LibbyNeural',    label: 'Libby (UK, female)' },
  { id: 'en-GB-ThomasNeural',   label: 'Thomas (UK, male)' },
  { id: 'en-GB-MaisieNeural',   label: 'Maisie (UK, child)' },
  // United States (17)
  { id: 'en-US-AriaNeural',          label: 'Aria (US, female)' },
  { id: 'en-US-JennyNeural',         label: 'Jenny (US, female)' },
  { id: 'en-US-GuyNeural',           label: 'Guy (US, male)' },
  { id: 'en-US-AndrewNeural',        label: 'Andrew (US, male)' },
  { id: 'en-US-AndrewMultilingualNeural', label: 'Andrew (US, male, multilingual)' },
  { id: 'en-US-EmmaNeural',          label: 'Emma (US, female)' },
  { id: 'en-US-EmmaMultilingualNeural',   label: 'Emma (US, female, multilingual)' },
  { id: 'en-US-AvaNeural',           label: 'Ava (US, female)' },
  { id: 'en-US-AvaMultilingualNeural',    label: 'Ava (US, female, multilingual)' },
  { id: 'en-US-BrianNeural',         label: 'Brian (US, male)' },
  { id: 'en-US-BrianMultilingualNeural',  label: 'Brian (US, male, multilingual)' },
  { id: 'en-US-ChristopherNeural',   label: 'Christopher (US, male)' },
  { id: 'en-US-EricNeural',          label: 'Eric (US, male)' },
  { id: 'en-US-MichelleNeural',      label: 'Michelle (US, female)' },
  { id: 'en-US-RogerNeural',         label: 'Roger (US, male)' },
  { id: 'en-US-SteffanNeural',       label: 'Steffan (US, male)' },
  { id: 'en-US-AnaNeural',           label: 'Ana (US, child)' },
  // Australia (2)
  { id: 'en-AU-NatashaNeural',  label: 'Natasha (AU, female)' },
  { id: 'en-AU-WilliamMultilingualNeural', label: 'William (AU, male, multilingual)' },
  // Canada (2)
  { id: 'en-CA-ClaraNeural',    label: 'Clara (CA, female)' },
  { id: 'en-CA-LiamNeural',     label: 'Liam (CA, male)' },
  // Ireland (2)
  { id: 'en-IE-EmilyNeural',    label: 'Emily (IE, female)' },
  { id: 'en-IE-ConnorNeural',   label: 'Connor (IE, male)' },
  // India (3)
  { id: 'en-IN-NeerjaNeural',           label: 'Neerja (IN, female)' },
  { id: 'en-IN-NeerjaExpressiveNeural', label: 'Neerja (IN, female, expressive)' },
  { id: 'en-IN-PrabhatNeural',          label: 'Prabhat (IN, male)' },
  // New Zealand (2)
  { id: 'en-NZ-MollyNeural',    label: 'Molly (NZ, female)' },
  { id: 'en-NZ-MitchellNeural', label: 'Mitchell (NZ, male)' },
  // South Africa (2)
  { id: 'en-ZA-LeahNeural',     label: 'Leah (ZA, female)' },
  { id: 'en-ZA-LukeNeural',     label: 'Luke (ZA, male)' },
  // Hong Kong (2)
  { id: 'en-HK-YanNeural',      label: 'Yan (HK, female)' },
  { id: 'en-HK-SamNeural',      label: 'Sam (HK, male)' },
  // Singapore (2)
  { id: 'en-SG-LunaNeural',     label: 'Luna (SG, female)' },
  { id: 'en-SG-WayneNeural',    label: 'Wayne (SG, male)' },
  // Philippines (2)
  { id: 'en-PH-RosaNeural',     label: 'Rosa (PH, female)' },
  { id: 'en-PH-JamesNeural',    label: 'James (PH, male)' },
  // Nigeria (2)
  { id: 'en-NG-EzinneNeural',   label: 'Ezinne (NG, female)' },
  { id: 'en-NG-AbeoNeural',     label: 'Abeo (NG, male)' },
  // Kenya (2)
  { id: 'en-KE-AsiliaNeural',   label: 'Asilia (KE, female)' },
  { id: 'en-KE-ChilembaNeural', label: 'Chilemba (KE, male)' },
  // Tanzania (2)
  { id: 'en-TZ-ImaniNeural',    label: 'Imani (TZ, female)' },
  { id: 'en-TZ-ElimuNeural',    label: 'Elimu (TZ, male)' }
];
const OPENAI_VOICES = [
  { id: 'alloy',   label: 'Alloy' },
  { id: 'echo',    label: 'Echo' },
  { id: 'fable',   label: 'Fable' },
  { id: 'onyx',    label: 'Onyx' },
  { id: 'nova',    label: 'Nova' },
  { id: 'shimmer', label: 'Shimmer' }
];

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

const COLOUR_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Brown', 'White'];
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

function renderSessionsTable() {
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

  // Top row: chevron, swatch, short, label, colour
  const row = document.createElement('div');
  row.className = 'session-row';

  const chevron = document.createElement('button');
  chevron.className = 'chevron icon-btn';
  chevron.innerHTML = expandedSessions.has(shortId)
    ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>'
    : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg>';
  chevron.title = 'Per-session settings';
  row.appendChild(chevron);

  const swatch = document.createElement('div');
  swatch.className = 'swatch';
  swatch.style.background = backgroundForArrangement(arrangementForIndex(entry.index || 0));
  row.appendChild(swatch);

  const shortEl = document.createElement('div');
  shortEl.className = 'short';
  shortEl.textContent = shortId;
  row.appendChild(shortEl);

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.placeholder = 'Label (e.g. "Tax module")';
  labelInput.value = entry.label || '';
  labelInput.addEventListener('change', () => {
    window.api.setSessionLabel(shortId, labelInput.value.trim());
  });
  row.appendChild(labelInput);

  const select = document.createElement('select');
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = arrangementLabel(i);
    if (i === (entry.index || 0)) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', async () => {
    const newIdx = Number(select.value);
    await window.api.setSessionIndex(shortId, newIdx);
    sessionAssignments[shortId].index = newIdx;
    sessionAssignments[shortId].pinned = true;
    renderSessionsTable();
  });
  row.appendChild(select);

  // Mute toggle. Always visible in the top row so users can one-click mute
  // background terminals. Uses 🔇 / 🔊 to make the state obvious at a glance;
  // the row also gets a muted class for a subtle fade.
  const muteBtn = document.createElement('button');
  muteBtn.className = 'mute-btn' + (entry.muted ? ' muted' : '');
  muteBtn.textContent = entry.muted ? '\uD83D\uDD07' : '\uD83D\uDD0A';  // 🔇 / 🔊
  muteBtn.title = entry.muted ? 'Unmute this session' : 'Mute this session (no audio, no synthesis)';
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

  // Remove session button. Sessions no longer auto-prune on inactivity;
  // this is the only way to drop one short of reinstalling.
  const removeBtn = document.createElement('button');
  removeBtn.className = 'session-remove';
  removeBtn.textContent = '\u00D7';  // ×
  removeBtn.title = 'Remove this session (colour slot freed)';
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
  await window.api.setPanelOpen(open);
  if (open) {
    cancelCollapse();
    applyCollapsed(false);
    renderSessionsTable();
  } else {
    scheduleCollapse();
  }
});

// -------------------------------------------------------------------
// Hover + interaction triggers for collapse/expand
// -------------------------------------------------------------------
// Click-through mode routes mousemove to document regardless of visible
// content, but per-element mouseenter/mouseleave don't fire reliably.
// Track "over bar" as a flag and only act on transitions — critical:
// cancelling the collapse timer on EVERY mousemove (the previous
// behaviour) meant the bar stayed open forever when the cursor was
// idle anywhere over it. Now only mouseenter cancels, only mouseleave
// (re)schedules.
let mouseOverBar = false;
document.addEventListener('mousemove', (e) => {
  const rect = barEl.getBoundingClientRect();
  const overBar = e.clientX >= rect.left && e.clientX <= rect.right &&
                  e.clientY >= rect.top && e.clientY <= rect.bottom + 4;
  if (overBar && !mouseOverBar) {
    if (isCollapsed) applyCollapsed(false);
    cancelCollapse();
    mouseOverBar = true;
  } else if (!overBar && mouseOverBar) {
    mouseOverBar = false;
    if (!isCollapsed && !settingsOpen) scheduleCollapse();
  }
});
// Any click/keypress = user actively engaging → cancel pending collapse
// and reset the inactivity timer.
barEl.addEventListener('click', bumpActivity);
window.addEventListener('keydown', bumpActivity);
// When main toggles visibility via the global hotkey, guarantee we're
// expanded so the user can actually see and interact with the bar.
if (window.api.onForceExpand) {
  window.api.onForceExpand(() => {
    applyCollapsed(false);
    cancelCollapse();
  });
}
// Orientation changes: main sends { kind: 'horizontal'|'vertical', edge }.
// We toggle CSS classes on body so styles can restyle the bar top row,
// dot row, and collapsed strip appropriately without runtime JS layout.
if (window.api.onSetOrientation) {
  window.api.onSetOrientation(({ kind, edge }) => {
    document.body.classList.toggle('vertical', kind === 'vertical');
    document.body.classList.remove('dock-left', 'dock-right', 'dock-top', 'dock-bottom');
    if (edge) document.body.classList.add(`dock-${edge}`);
    renderDots();  // re-render so dot order reflects the new orientation
  });
}

// Don't auto-collapse on startup — user needs to see the toolbar first.
// The collapse cycle starts on the first mouseleave or new-clip arrival.
loadSettings();

initialLoad();
