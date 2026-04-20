// D2-3 — in-memory IPC stub that lets the kit iframe load app/renderer.js
// verbatim and exercise the real product behaviour (four-tier queue, focus,
// mute, colour assignment, auto-prune timing, collapse logic) without an
// Electron process. Replaces docs/ui-kit/*.jsx — the kit is now the real
// renderer + a shim of window.api.
//
// NOT bundled: audio playback. fileUrl(path) in renderer.js returns
// file:///<path>; clicking a dot in the kit therefore triggers an audio
// error and the renderer skips to the next clip. The dot strip still
// renders, the scrubber still animates via the tick loop, play/pause icons
// still toggle. Users who want real audio run the real app.
//
// Seeds (via URL param ?seed=<name>):
//   idle            empty queue, panel closed, no sessions
//   three-sessions  A A A — B B B — C C  run-clustered queue, playing
//   mixed-states    heard + playing + queued + J-clip
//   settings-panel  3 sessions, panel open, one row expanded
//   snapped-top     same as three-sessions but visually docked top
//
// Pass ?chrome=0 to hide the demo scaffolding (purple gradient + add-fake
// buttons). The mocks-annotated + components iframes use this.

(function () {
  'use strict';

  const URL_PARAMS  = new URLSearchParams(location.search);
  const SEED_NAME   = URL_PARAMS.get('seed') || 'three-sessions';
  const SHOW_CHROME = URL_PARAMS.get('chrome') !== '0';

  // ═══════════════════════════════════════════════════════════════════════
  // D2-3a — silent-WAV shim
  // ═══════════════════════════════════════════════════════════════════════
  // The renderer does `audio.src = fileUrl(path)` for every clip, where
  // `fileUrl` returns `file:///<path>`. In the real Electron app this
  // reaches a real MP3 on disk. In the kit demo the paths are fake, so
  // the <audio> element fires `error` and the renderer skips to next.
  //
  // This shim intercepts the `src` setter on HTMLMediaElement and swaps
  // any `file://` URL for a 200 ms silent PCM WAV data URL. The <audio>
  // element now PLAYS (silently), `audio.ended` fires normally, the
  // renderer's `ended` handler advances `playNextPending()`, which
  // triggers `scheduleAutoDelete(path, isManual)` — so the full clip
  // lifecycle (dot pulses → dot fades to heard → auto-prune removes it
  // after 20 s) is visible in the demo.
  //
  // The real Electron app never loads mock-ipc.js, so this shim only
  // exists in the kit. Product audio playback is unaffected.
  (function installSilentWavShim() {
    const SAMPLE_RATE = 8000, DUR_MS = 200;
    const SAMPLES = SAMPLE_RATE * DUR_MS / 1000;   // 1600 samples
    const DATA_BYTES = SAMPLES * 2;                 // 16-bit PCM mono
    const buf = new ArrayBuffer(44 + DATA_BYTES);
    const v = new DataView(buf);
    v.setUint32(0, 0x52494646, false);   // 'RIFF'
    v.setUint32(4, 36 + DATA_BYTES, true);
    v.setUint32(8, 0x57415645, false);   // 'WAVE'
    v.setUint32(12, 0x666d7420, false);  // 'fmt '
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);            // PCM
    v.setUint16(22, 1, true);            // mono
    v.setUint32(24, SAMPLE_RATE, true);
    v.setUint32(28, SAMPLE_RATE * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    v.setUint32(36, 0x64617461, false);  // 'data'
    v.setUint32(40, DATA_BYTES, true);
    // Samples are already zero (ArrayBuffer zero-initialised).
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const SILENT_WAV = 'data:audio/wav;base64,' + btoa(bin);

    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true,
      get: desc.get,
      set(value) {
        if (typeof value === 'string' && /^file:\/\//i.test(value)) {
          desc.set.call(this, SILENT_WAV);
        } else {
          desc.set.call(this, value);
        }
      },
    });
  })();

  // ═══════════════════════════════════════════════════════════════════════
  // State — what a real Electron main process would persist
  // ═══════════════════════════════════════════════════════════════════════
  let config = {
    voices: {
      edge_clip:       'en-GB-SoniaNeural',
      edge_response:   'en-GB-RyanNeural',
      openai_clip:     'shimmer',
      openai_response: 'onyx',
    },
    hotkeys: {
      toggle_window:    'Control+Shift+A',
      speak_clipboard:  'Control+Shift+S',
      toggle_listening: 'Control+Shift+J',
      pause_resume:     'Control+Shift+P',
      pause_only:       'Control+Shift+O',
    },
    playback: { speed: 1.25, auto_prune: true, auto_prune_sec: 20 },
    speech_includes: {
      code_blocks: false, inline_code: false, urls: false,
      headings: true, bullet_markers: false, image_alt: false,
    },
    window: null,
    openai_api_key: null,
  };

  // Queue files — the mock's "filesystem". Each has shape the renderer
  // expects from getQueue: { path, mtime } (duration is derived by the
  // audio element IRL; the kit doesn't play audio, so duration is unused).
  let queueFiles = [];

  // Session assignments — shortId → { index, label, muted, focus, voice,
  //   speech_includes, session_id, pinned, last_seen }. Matches the shape
  //   renderer.js destructures from the notify payload.
  let sessions = {};

  // Stale sessions — list of shortIds whose backing terminal has "closed".
  let staleShorts = [];

  // ═══════════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════════
  const now = () => Date.now();
  const hexShort = (i) => i.toString(16).padStart(8, '0');

  // renderer extracts a shortId from filenames matching:
  //   -<8hex>.(mp3|wav)            normal response
  //   -Q-<8hex>.(mp3|wav)           question clip
  //   -notif-<8hex>.(mp3|wav)       permission prompt
  //   -clip-<8hex>-<idx>.(mp3|wav)  highlight-to-speak clip (J-clip)
  function makePath(short, kind, idx) {
    const ts = String(now() - Math.floor(Math.random() * 60000));
    switch (kind) {
      case 'clip':  return `${ts}-clip-${short}-${String(idx || 1).padStart(2, '0')}.mp3`;
      case 'q':     return `${ts}-Q-${short}.mp3`;
      case 'notif': return `${ts}-notif-${short}.mp3`;
      default:      return `${ts}-${short}.mp3`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Seeds — each returns { queueFiles, sessions, staleShorts?, panelOpen? }
  // ═══════════════════════════════════════════════════════════════════════
  function buildSeed(name) {
    const t = now();
    if (name === 'idle') {
      return { queueFiles: [], sessions: {}, staleShorts: [], panelOpen: false };
    }
    if (name === 'three-sessions') {
      const A = 'abcd1234', B = 'a08f2b71', C = '7e5c9a04';
      const s = {};
      s[A] = { index: 0, label: 'Terminal A', session_id: A, pinned: true, last_seen: t / 1000 };
      s[B] = { index: 2, label: 'Terminal B', session_id: B, pinned: true, last_seen: t / 1000 };
      s[C] = { index: 3, label: 'Terminal C', session_id: C, pinned: true, last_seen: t / 1000 };
      return {
        sessions: s, staleShorts: [], panelOpen: false,
        queueFiles: [
          { path: makePath(A, 'resp'), mtime: t - 30000 },
          { path: makePath(A, 'resp'), mtime: t - 28000 },
          { path: makePath(A, 'resp'), mtime: t - 26000 },
          { path: makePath(B, 'resp'), mtime: t - 22000 },
          { path: makePath(B, 'resp'), mtime: t - 20000 },
          { path: makePath(B, 'resp'), mtime: t - 18000 },
          { path: makePath(C, 'resp'), mtime: t - 14000 },
          { path: makePath(C, 'resp'), mtime: t - 12000 },
        ],
      };
    }
    if (name === 'mixed-states') {
      const A = 'abcd1234', B = 'a08f2b71', C = '7e5c9a04', D = 'deadbeef';
      const s = {};
      s[A] = { index: 0, label: 'Terminal A', session_id: A, pinned: true, last_seen: t / 1000 };
      s[B] = { index: 2, label: 'Terminal B', session_id: B, pinned: true, last_seen: t / 1000 };
      s[C] = { index: 3, label: 'Terminal C', session_id: C, pinned: true, last_seen: t / 1000 };
      s[D] = { index: 4, label: 'Claude',     session_id: D, pinned: true, last_seen: t / 1000 };
      return {
        sessions: s, staleShorts: [], panelOpen: false,
        queueFiles: [
          { path: makePath(A, 'resp'), mtime: t - 30000 },
          { path: makePath(A, 'resp'), mtime: t - 28000 },
          { path: makePath(A, 'resp'), mtime: t - 26000 },
          { path: makePath(B, 'resp'), mtime: t - 22000 },
          { path: makePath(B, 'resp'), mtime: t - 20000 },
          { path: makePath(C, 'resp'), mtime: t - 14000 },
          { path: makePath(C, 'resp'), mtime: t - 12000 },
          { path: makePath(D, 'clip', 1), mtime: t - 6000 },
        ],
        // Pre-played the first two reds so they render as "heard".
        preHeard: 2,
      };
    }
    if (name === 'settings-panel') {
      const A = 'abcd1234', B = 'a08f2b71', C = '7e5c9a04';
      const s = {};
      s[A] = { index: 3,  label: 'Frontend', session_id: A, pinned: true,  last_seen: t / 1000 };
      s[B] = { index: 12, label: 'Auth API', session_id: B, pinned: false, last_seen: t / 1000 };
      s[C] = { index: 18, label: '',         session_id: C, pinned: false, last_seen: t / 1000, voice: 'en-US-AriaNeural' };
      return {
        sessions: s, staleShorts: [], panelOpen: true,
        queueFiles: [
          { path: makePath(A, 'resp'), mtime: t - 20000 },
          { path: makePath(B, 'resp'), mtime: t - 15000 },
          { path: makePath(C, 'resp'), mtime: t - 10000 },
        ],
      };
    }
    if (name === 'snapped-top') {
      const A = 'abcd1234', B = 'a08f2b71';
      const s = {};
      s[A] = { index: 0, label: '', session_id: A, pinned: true, last_seen: t / 1000 };
      s[B] = { index: 4, label: '', session_id: B, pinned: true, last_seen: t / 1000 };
      return {
        sessions: s, staleShorts: [], panelOpen: false,
        queueFiles: [
          { path: makePath(A, 'resp'), mtime: t - 30000 },
          { path: makePath(A, 'resp'), mtime: t - 28000 },
          { path: makePath(B, 'resp'), mtime: t - 22000 },
          { path: makePath(B, 'resp'), mtime: t - 20000 },
          { path: makePath(B, 'resp'), mtime: t - 18000 },
        ],
      };
    }
    // Fall-through: same as three-sessions
    return buildSeed('three-sessions');
  }

  const seed = buildSeed(SEED_NAME);
  sessions    = seed.sessions;
  queueFiles  = seed.queueFiles;
  staleShorts = seed.staleShorts || [];

  // ═══════════════════════════════════════════════════════════════════════
  // Event dispatch — eight channels mirroring preload.js subscribe helpers
  // ═══════════════════════════════════════════════════════════════════════
  const listeners = {
    'queue-updated':         [],
    'priority-play':         [],
    'clipboard-status':      [],
    'listening-state':       [],
    'force-expand':          [],
    'set-orientation':       [],
    'toggle-pause-playback': [],
    'pause-playback-only':   [],
  };
  function emit(channel, payload) {
    for (const cb of listeners[channel] || []) {
      try { cb(payload); } catch (e) { console.warn(`[mock-ipc] ${channel} listener threw:`, e); }
    }
  }
  function subscribe(channel, cb) {
    (listeners[channel] || (listeners[channel] = [])).push(cb);
    return () => {
      const arr = listeners[channel];
      const i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // window.api — 16 invoke handlers + 8 event subscribers
  // ═══════════════════════════════════════════════════════════════════════
  window.api = {
    // --- reads --------------------------------------------------------
    getQueue:          () => Promise.resolve({ files: queueFiles.slice(), assignments: { ...sessions } }),
    getConfig:         () => Promise.resolve({ ...config }),
    getStaleSessions:  () => Promise.resolve(staleShorts.slice()),

    // --- mutations ----------------------------------------------------
    updateConfig: (partial) => {
      config = { ...config, ...partial,
        voices: { ...config.voices, ...(partial.voices || {}) },
        hotkeys: { ...config.hotkeys, ...(partial.hotkeys || {}) },
        playback: { ...config.playback, ...(partial.playback || {}) },
        speech_includes: { ...config.speech_includes, ...(partial.speech_includes || {}) },
      };
      return Promise.resolve(config);
    },
    setSessionLabel: (short, label) => { if (sessions[short]) sessions[short].label = label; notifyQueue(); return Promise.resolve(true); },
    setSessionIndex: (short, index) => { if (sessions[short]) { sessions[short].index = index; sessions[short].pinned = true; } notifyQueue(); return Promise.resolve(true); },
    setSessionInclude: (short, key, value) => {
      if (!sessions[short]) return Promise.resolve(false);
      const inc = sessions[short].speech_includes || {};
      if (value === null) delete inc[key]; else inc[key] = value;
      sessions[short].speech_includes = inc;
      notifyQueue();
      return Promise.resolve(true);
    },
    setSessionVoice: (short, voiceId) => {
      if (!sessions[short]) return Promise.resolve(false);
      if (voiceId) sessions[short].voice = voiceId; else delete sessions[short].voice;
      notifyQueue();
      return Promise.resolve(true);
    },
    setSessionMuted: (short, muted) => { if (sessions[short]) sessions[short].muted = !!muted; notifyQueue(); return Promise.resolve(true); },
    setSessionFocus: (short, focus) => {
      if (!sessions[short]) return Promise.resolve(false);
      if (focus) for (const k of Object.keys(sessions)) if (k !== short) sessions[k].focus = false;
      sessions[short].focus = !!focus;
      notifyQueue();
      return Promise.resolve(true);
    },
    removeSession: (short) => { delete sessions[short]; notifyQueue(); return Promise.resolve(true); },
    deleteFile: (p) => {
      const i = queueFiles.findIndex(f => f.path === p);
      if (i >= 0) queueFiles.splice(i, 1);
      notifyQueue();
      return Promise.resolve(true);
    },

    // --- UI-only / electron-only noops -------------------------------
    hideWindow:      () => Promise.resolve(),
    setClickthrough: () => Promise.resolve(),
    setPanelOpen:    () => Promise.resolve(),
    logRendererError: (payload) => { console.warn('[renderer-error]', payload); return Promise.resolve(); },

    // --- event subscribers (return disposers per preload pattern) ----
    onQueueUpdated:        (cb) => subscribe('queue-updated',         cb),
    onPriorityPlay:        (cb) => subscribe('priority-play',         cb),
    onClipboardStatus:     (cb) => subscribe('clipboard-status',      cb),
    onListeningState:      (cb) => subscribe('listening-state',       cb),
    onForceExpand:         (cb) => subscribe('force-expand',          cb),
    onSetOrientation:      (cb) => subscribe('set-orientation',       cb),
    onTogglePausePlayback: (cb) => subscribe('toggle-pause-playback', cb),
    onPausePlaybackOnly:   (cb) => subscribe('pause-playback-only',   cb),
  };

  function notifyQueue() {
    emit('queue-updated', { files: queueFiles.slice(), assignments: { ...sessions } });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Demo chrome — "Add fake clip" / "Clear queue" / "Toggle panel" buttons
  // Hidden when ?chrome=0 (mocks-annotated and components iframes).
  // ═══════════════════════════════════════════════════════════════════════
  function mountChrome() {
    if (!SHOW_CHROME) return;
    const root = document.createElement('div');
    root.className = 'kit-demo-controls';
    root.innerHTML = `
      <button data-action="add">＋ Add fake clip</button>
      <button data-action="clear">Clear queue</button>
      <button data-action="heyj">"hey jarvis" clip</button>
      <button data-action="panel">Toggle panel</button>
      <span class="caption">Kit demo — real app/renderer.js driven by mock IPC</span>
    `;
    document.body.appendChild(root);
    root.addEventListener('click', (ev) => {
      const action = ev.target.dataset && ev.target.dataset.action;
      if (!action) return;
      const shortIds = Object.keys(sessions);
      const pick = shortIds[Math.floor(Math.random() * shortIds.length)] || 'deadbeef';
      if (action === 'add') {
        queueFiles.push({ path: makePath(pick, 'resp'), mtime: now() });
        notifyQueue();
      } else if (action === 'clear') {
        queueFiles = [];
        notifyQueue();
      } else if (action === 'heyj') {
        queueFiles.push({ path: makePath(pick, 'clip', queueFiles.length + 1), mtime: now() });
        notifyQueue();
      } else if (action === 'panel') {
        // Click the settings button the renderer already wired up.
        const s = document.getElementById('settingsBtn'); if (s) s.click();
      }
    });
  }

  // Fire initial queue notify AFTER renderer.js has installed its
  // onQueueUpdated listener. We can't call notifyQueue() inline because
  // mock-ipc.js runs BEFORE renderer.js (ordering in index.html).
  // Renderer.js calls getQueue() on boot, so the initial state lands
  // through that path — the event fire is for SUBSEQUENT updates.
  window.addEventListener('load', () => {
    mountChrome();
    // Nudge once after boot so any hydration the renderer did is re-synced
    // with our state — covers the race where renderer's initial getQueue()
    // resolved before our listeners were wired.
    setTimeout(notifyQueue, 50);

    if (seed.panelOpen) {
      const s = document.getElementById('settingsBtn');
      if (s) setTimeout(() => s.click(), 100);
    }
  });
})();
