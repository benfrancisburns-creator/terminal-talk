// EX7e — audio playback surface extracted from app/renderer.js. Final
// component in the v0.4 renderer refactor.
//
// Owns:
//   - the <audio> element lifecycle (play/pause/ended/error/stalled/
//     waiting/playing/canplay/seeking/timeupdate/loadedmetadata);
//   - play/pause/back10/fwd10 button wiring;
//   - the scrubber mascot (position, walking class, Jarvis-mode swap);
//   - the scrubber rAF tick loop + spinner verb-cloud trail;
//   - scrub-direction detection (forward / backward mascot swap);
//   - stall recovery (skip to next clip if 3 s of no forward progress);
//   - device-change re-binding;
//   - Web Audio pause tone (toggle listening audible cue).
//
// Behaviour preserved byte-for-byte from the module-level code that
// used to live around lines 401-1060 of renderer.js. The ended-handler
// continuation logic (user-click forward-in-time vs priority drain vs
// playNextPending fallback) keeps every condition. Stall recovery
// still fires exactly one sweep per hang — _stallRecoveryTimer gate
// preserved.
//
// State ownership:
//   - currentPath, currentIsManual, currentIsUserClick, userScrubbing:
//     lived as renderer module globals; now instance state. Exposed
//     read-only via getCurrentPath / isIdle / isUserScrubbing for the
//     few external readers (DotStrip, deleteDot, onPriorityPlay).
//   - Shared collections (queue, playedPaths, heardPaths, pendingQueue)
//     stay in renderer.js because playNextPending also reads/mutates
//     them. The component reads them via getters and mutates them via
//     callbacks (markPlayed / markHeard / removePending).
//
// External call points exposed by this component:
//   - playPath(p, manual?, userClick?) → boolean
//   - abort() → void  (unconditional pause + clear currentPath)
//   - abortIfAutoPlayed() → previousPath | null
//   - getCurrentPath() → string | null
//   - isIdle() → boolean
//   - isUserScrubbing() → boolean
//   - playToggleTone(on) → void
//   - positionScrubberMascot() → void  (called on initial load + resize)

(function (root, factory) {
  'use strict';
  const api = factory(
    typeof module === 'object' && module.exports
      ? require('./component')
      : { Component: root.TT_COMPONENT }
  );
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TT_AUDIO_PLAYER = api.AudioPlayer;
  }
}(typeof self !== 'undefined' ? self : this, function (componentModule) {
  'use strict';

  const { Component } = componentModule;

  const MASCOT_W = 20;
  const STALL_RECOVERY_MS = 3000;

  class AudioPlayer extends Component {
    constructor(deps = {}) {
      super(deps);
      const {
        // DOM refs
        audio, playPauseBtn, playIcon, pauseIcon,
        back10Btn, fwd10Btn,
        scrubber, scrubberWrap, scrubberMascot, scrubberJarvis, timeEl,

        // Config getters (live refs; change at runtime)
        getPlaybackSpeed = () => 1.0,
        getAutoContinueAfterClick = () => true,

        // Queue state accessors
        getQueue = () => [],
        getHeardPaths = () => new Set(),

        // Queue state mutators
        markPlayed = () => {},
        markHeard = () => {},
        removePending = () => {},

        // Pure helpers
        fmt = (s) => String(Math.floor(s || 0)),
        fileUrl = (p) => p,
        isPathSessionMuted = () => false,
        isPathSessionStale = () => false,
        clipPaths,                     // { isClipFile, extractSessionShort }
        // Resolves a clip path to the session's palette key (e.g. "03")
        // or null for J-clips / neutral / unknown sessions. Used to
        // recolour the mascot per playing session. Injected from renderer
        // so audio-player stays decoupled from the live sessionAssignments
        // map.
        resolveSessionPaletteKey = () => null,
        randomVerb = () => 'walking',
        setDynamicStyle = () => {},

        // Callbacks
        onPlayStart = () => {},
        onClipEnded = () => {},
        onPlayNextPending = () => {},
        onRenderDots = () => {},

        // AudioContext factory — injectable for pause-tone tests.
        audioContextFactory = null,
      } = deps;

      this._audio = audio;
      this._playPauseBtn = playPauseBtn;
      this._playIcon = playIcon;
      this._pauseIcon = pauseIcon;
      this._back10Btn = back10Btn;
      this._fwd10Btn = fwd10Btn;
      this._scrubber = scrubber;
      this._scrubberWrap = scrubberWrap;
      this._scrubberMascot = scrubberMascot;
      this._scrubberJarvis = scrubberJarvis;
      this._timeEl = timeEl;

      this._getPlaybackSpeed = getPlaybackSpeed;
      this._getAutoContinueAfterClick = getAutoContinueAfterClick;
      this._getQueue = getQueue;
      this._getHeardPaths = getHeardPaths;
      this._markPlayed = markPlayed;
      this._markHeard = markHeard;
      this._removePending = removePending;

      this._fmt = fmt;
      this._fileUrl = fileUrl;
      this._isPathSessionMuted = isPathSessionMuted;
      this._isPathSessionStale = isPathSessionStale;
      this._clipPaths = clipPaths;
      this._resolveSessionPaletteKey = resolveSessionPaletteKey;
      this._randomVerb = randomVerb;
      this._setDynamicStyle = setDynamicStyle;

      this._onPlayStart = onPlayStart;
      this._onClipEnded = onClipEnded;
      this._onPlayNextPending = onPlayNextPending;
      this._onRenderDots = onRenderDots;
      this._audioContextFactory = audioContextFactory || (() => {
        const Ctor = (typeof window !== 'undefined')
          && (window.AudioContext || window.webkitAudioContext);
        return Ctor ? new Ctor() : null;
      });

      // Instance state (previously renderer module globals).
      this._currentPath = null;
      this._currentIsManual = false;
      this._currentIsUserClick = false;
      this._userScrubbing = false;
      // Set when a MediaSession 'pause' action auto-pauses us for an
      // audio-focus handover (e.g. Wispr Flow grabbing comms audio).
      // Cleared when the matching 'play' action arrives or the user
      // explicitly plays. Distinguishes system-initiated pauses (auto-
      // resume-worthy) from user-initiated ones (stay paused).
      this._systemAutoPaused = false;

      // Scrubber + animation internal state.
      this._scrubberRafId = null;
      this._nextVerbEmitAt = 0;
      this._spinnerWordCounter = 0;
      this._lastScrubberValue = 0;
      this._scrubDirTimer = null;
      this._stallRecoveryTimer = null;
    }

    // ---- Public API ---------------------------------------------------

    getCurrentPath() { return this._currentPath; }

    isIdle() {
      const a = this._audio;
      if (!a) return true;
      return !a.src || a.ended || (a.paused && a.currentTime === 0);
    }

    isUserScrubbing() { return this._userScrubbing; }

    // System-initiated pause — call when another app grabs the mic
    // (Wispr Flow, Windows Voice Access, VoIP, etc.) via the main-side
    // mic-watcher. Sets _systemAutoPaused so systemAutoResume() later
    // knows to pick playback back up from the exact same point.
    systemAutoPause() {
      if (!this._audio || !this._audio.src || this._audio.ended) return;
      if (this._audio.paused) return;
      this._systemAutoPaused = true;
      try { this._audio.pause(); } catch {}
    }

    // System-initiated resume — call when the external mic-grabber
    // releases. Only resumes if WE paused via systemAutoPause (flag
    // guard); a user-initiated pause in the meantime stays paused.
    systemAutoResume() {
      if (!this._systemAutoPaused) return;
      this._systemAutoPaused = false;
      if (!this._audio || !this._audio.src || !this._audio.paused || this._audio.ended) return;
      try { this._audio.play().catch(() => {}); } catch {}
    }

    playPath(p, manual = false, userClick = false) {
      const queue = this._getQueue();
      const idx = queue.findIndex((f) => f.path === p);
      if (idx < 0) return false;
      this._onPlayStart(p, { manual, userClick });  // triggers cancelAutoDelete
      this._currentPath = p;
      this._currentIsManual = manual;
      this._currentIsUserClick = userClick;
      this._audio.src = this._fileUrl(p);
      this._audio.currentTime = 0;
      this._audio.playbackRate = this._getPlaybackSpeed();
      // HB3 — heartbeat clips (H- prefix) play quieter than body /
      // tool-narration clips. They're ambient filler during silent
      // stretches, not primary content, and should fade into the
      // background rather than compete with the response audio.
      // Tool narrations (T- prefix) stay at full volume — they describe
      // real activity the user wants to hear.
      const fn = p ? p.split(/[\\/]/).pop() : '';
      const isHeartbeat = !!fn && this._clipPaths
        && typeof this._clipPaths.isHeartbeatClip === 'function'
        && this._clipPaths.isHeartbeatClip(fn);
      this._audio.volume = isHeartbeat ? 0.45 : 1.0;
      this._audio.play().catch(() => {});
      this._markPlayed(p);
      if (manual) this._markHeard(p);
      this._removePending(p);
      this._onRenderDots();
      this._updateScrubberMode();
      return true;
    }

    abort() {
      try { this._audio.pause(); } catch {}
      this._audio.src = '';
      this._currentPath = null;
      this._currentIsManual = false;
      this._currentIsUserClick = false;
    }

    abortIfAutoPlayed() {
      if (!this._currentPath || this._currentIsManual) return null;
      const was = this._currentPath;
      try { this._audio.pause(); } catch {}
      this._audio.src = '';
      this._currentPath = null;
      this._currentIsManual = false;
      return was;
    }

    // Wraps the native AudioContext to emit a two-tone cue on listening
    // start/stop. Exposed publicly so renderer can wire onListeningState
    // straight to this method.
    playToggleTone(on) {
      try {
        const ctx = this._audioContextFactory();
        if (!ctx) return;
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
        else    { play(880, 0, 0.12); play(440, 0.1, 0.16); }
        setTimeout(() => ctx.close(), 500);
      } catch {}
    }

    positionScrubberMascot() { this._positionScrubberMascot(); }

    // ---- Mount / Unmount ---------------------------------------------

    _onMount() {
      this._wireButtons();
      this._wireAudioPlayState();
      this._wireAudioEnded();
      this._wireAudioError();
      this._wireStallRecovery();
      this._wireDeviceChange();
      this._wireScrubberRafHooks();
      this._wireScrubberInput();
      this._wireWindowResize();
      // Initial position on load.
      this._positionScrubberMascot();
    }

    _onUnmount() {
      if (this._scrubberRafId !== null) {
        cancelAnimationFrame(this._scrubberRafId);
        this._scrubberRafId = null;
      }
      if (this._stallRecoveryTimer) {
        clearTimeout(this._stallRecoveryTimer);
        this._stallRecoveryTimer = null;
      }
      if (this._scrubDirTimer) {
        clearTimeout(this._scrubDirTimer);
        this._scrubDirTimer = null;
      }
    }

    // ---- Buttons ------------------------------------------------------

    _wireButtons() {
      if (this._playPauseBtn) {
        this._on(this._playPauseBtn, 'click', () => {
          if (!this._audio.src) {
            const queue = this._getQueue();
            const heard = this._getHeardPaths();
            const unheard = queue.filter((f) => !heard.has(f.path)).sort((a, b) => a.mtime - b.mtime);
            const next = unheard[0] || queue[0];
            if (next) this.playPath(next.path, true);
            return;
          }
          if (this._audio.paused) this._audio.play().catch(() => {});
          else this._audio.pause();
        });
      }
      if (this._back10Btn) {
        this._on(this._back10Btn, 'click', () => {
          this._audio.currentTime = Math.max(0, this._audio.currentTime - 10);
        });
      }
      if (this._fwd10Btn) {
        this._on(this._fwd10Btn, 'click', () => {
          if (isFinite(this._audio.duration)) {
            this._audio.currentTime = Math.min(this._audio.duration, this._audio.currentTime + 10);
          }
        });
      }
    }

    // ---- Play / pause icons ------------------------------------------

    _setPlayPauseIcons(isPlaying) {
      if (this._playIcon)  this._playIcon.classList.toggle('hidden', isPlaying);
      if (this._pauseIcon) this._pauseIcon.classList.toggle('hidden', !isPlaying);
    }

    _wireAudioPlayState() {
      this._on(this._audio, 'play',  () => this._setPlayPauseIcons(true));
      this._on(this._audio, 'pause', () => this._setPlayPauseIcons(false));
    }

    // ---- End / error / stall -----------------------------------------

    _wireAudioEnded() {
      this._on(this._audio, 'ended', () => {
        this._setPlayPauseIcons(false);
        const justPlayed = this._currentPath;
        const wasManual = this._currentIsManual;
        const wasUserClick = this._currentIsUserClick;
        this._currentPath = null;
        this._currentIsManual = false;
        this._currentIsUserClick = false;
        this._onRenderDots();
        this._updateScrubberMode();
        // Both auto-played and manually-played clips get auto-deleted
        // now — only the delay differs. Previously auto-played clips
        // accumulated indefinitely, flooding the toolbar.
        if (justPlayed) this._onClipEnded(justPlayed, { manual: wasManual });

        // v0.3.6 — user-click continuation. When a clip started by a
        // user click ends, and auto_continue_after_click is on, play
        // the next clip strictly forward in time (mtime > justPlayed's)
        // regardless of played state. Chains so the continuation keeps
        // honouring the setting for the whole run.
        //
        // Why not go through playNextPending's fallback branch? Fallback
        // filters out played clips — so after a full queue has been
        // heard once, fallback finds nothing and the continuation dies
        // on the first clip. Users then face a "click exercise" to
        // re-listen. This branch reads "forward in time" instead of
        // "any unplayed", so State C (everything already heard, click
        // one to replay) works.
        //
        // State B (interrupt during auto-play by clicking mid-queue)
        // also routes here: click #3 mid-#1 → #3 plays → ended fires
        // with wasUserClick=true → next forward is #4 → plays → … →
        // #N. Clips #1/#2 stay unplayed; the user explicitly chose to
        // start from #3.
        //
        // Priority (hey-jarvis) clips set currentIsManual=true but
        // userClick=false, so they always fall through to
        // playNextPending to preserve the existing priority-drain-then-
        // resume behaviour.
        if (wasUserClick && this._getAutoContinueAfterClick()) {
          const queue = this._getQueue();
          const justPlayedClip = queue.find((f) => f.path === justPlayed);
          if (justPlayedClip) {
            const next = queue
              .filter((f) =>
                f.mtime > justPlayedClip.mtime
                && !this._isPathSessionMuted(f.path)
                && !this._isPathSessionStale(f.path))
              .sort((a, b) => a.mtime - b.mtime)[0];
            if (next) {
              this.playPath(next.path, true, true);
              return;
            }
            // No more forward clips — chain complete, stop cleanly.
            return;
          }
        }

        // Always call playNextPending: it picks from priority → pending
        // → fallback scan of unplayed clips still sitting in queue. The
        // old gate skipped the fallback entirely when both explicit
        // queues were empty, leaving unplayed arrivals stranded after a
        // manually-started clip ended.
        this._onPlayNextPending();
      });
    }

    _wireAudioError() {
      this._on(this._audio, 'error', () => {
        this._setPlayPauseIcons(false);
        this._currentPath = null;
        this._currentIsManual = false;
        this._onRenderDots();
        this._updateScrubberMode();
        this._onPlayNextPending();
      });
    }

    _wireStallRecovery() {
      // Audit R21: the browser fires `stalled` when the media element
      // hasn't received data for a while, and `waiting` when readyState
      // drops below HAVE_FUTURE_DATA. Under normal desktop conditions
      // (local .mp3 files) these are rare — but they DO happen when the
      // clip file is being written on a slow disk, or when a USB audio
      // device is reconnecting, or when antivirus software briefly
      // blocks reads. Without these handlers the toolbar just stops
      // mid-clip with no visible recovery.
      //
      // Strategy: wait ~3 s for the stall to resolve on its own (file
      // might be mid-flush); if we're still stuck, skip to the next
      // clip so the user isn't stranded.
      const arm = () => this._armStallRecovery();
      const cancel = () => this._cancelStallRecovery();
      this._on(this._audio, 'stalled', arm);
      this._on(this._audio, 'waiting', arm);
      this._on(this._audio, 'playing', cancel);
      this._on(this._audio, 'canplay', cancel);
      this._on(this._audio, 'ended',   cancel);
    }

    _armStallRecovery() {
      if (this._stallRecoveryTimer) return;  // already armed
      this._stallRecoveryTimer = setTimeout(() => {
        this._stallRecoveryTimer = null;
        // Only act if we're still playing the same clip and haven't
        // made forward progress.
        if (this._audio.src && this._audio.paused === false && this._audio.readyState < 3) {
          const p = this._currentPath;
          try { this._audio.pause(); } catch {}
          this._audio.src = '';
          this._currentPath = null;
          this._currentIsManual = false;
          if (p) this._markPlayed(p);  // don't loop on the same broken clip
          this._onRenderDots();
          this._onPlayNextPending();
        }
      }, STALL_RECOVERY_MS);
    }

    _cancelStallRecovery() {
      if (this._stallRecoveryTimer) {
        clearTimeout(this._stallRecoveryTimer);
        this._stallRecoveryTimer = null;
      }
    }

    // ---- Device change -----------------------------------------------

    _wireDeviceChange() {
      // Audit R30: devicechange fires when the user plugs / unplugs
      // headphones, switches default audio device, starts a Bluetooth
      // session, etc. The <audio> element binds to whatever output was
      // default at play() time — so if we're mid-clip when the device
      // changes, the audio can either keep playing out of a now-hidden
      // endpoint OR go silent. Re-bind by nudging currentTime; Chromium
      // re-picks the default output on the next frame.
      try {
        if (typeof navigator !== 'undefined'
            && navigator.mediaDevices
            && typeof navigator.mediaDevices.addEventListener === 'function') {
          this._on(navigator.mediaDevices, 'devicechange', () => {
            // Nudge currentTime so Chromium re-binds to whatever the new
            // default output device is (headphone plug-in, BT session,
            // etc.). DON'T force .play() here — a device-change event
            // also fires when another app claims the microphone for
            // communications (Wispr Flow dictation, VoIP call, Windows
            // Voice Access). If Chromium's audio-focus subsystem decides
            // to pause us on that grab, a forced play() would fight the
            // pause: user hears audio bleeding over their dictation.
            if (!this._audio.src || this._audio.ended || this._audio.paused) return;
            const ct = this._audio.currentTime;
            try {
              this._audio.currentTime = Math.max(0, ct - 0.001);
            } catch {}
          });
        }
      } catch {}

      // Declare our audio category so Chromium applies the right focus
      // policy when another app claims audio (comms dictation tools, VoIP,
      // etc.). 'playback' tells Chromium we're long-form media that
      // should yield to communications audio. Newer Chromium honours
      // this by auto-pausing our <audio> on comms-focus loss and
      // auto-resuming on focus gain — exactly the push-to-talk UX.
      try {
        if (typeof navigator !== 'undefined' && navigator.audioSession) {
          navigator.audioSession.type = 'playback';
        }
      } catch {}

      // MediaSession action handlers — Chromium's audio-focus subsystem
      // surfaces via these when the OS asks the page to pause/resume
      // (hardware media keys, notification-shelf controls, communications
      // focus changes). We distinguish system-initiated pauses (remember
      // to auto-resume) from user-initiated ones (stay paused).
      try {
        if (typeof navigator !== 'undefined'
            && navigator.mediaSession
            && typeof navigator.mediaSession.setActionHandler === 'function') {
          navigator.mediaSession.setActionHandler('pause', () => {
            if (!this._audio.src || this._audio.ended || this._audio.paused) return;
            this._systemAutoPaused = true;
            try { this._audio.pause(); } catch {}
          });
          navigator.mediaSession.setActionHandler('play', () => {
            // Only auto-resume if WE paused via the system handler.
            // Don't hijack a user-intended play button from the OS shelf
            // when audio is already running or explicitly user-paused.
            if (!this._systemAutoPaused) return;
            if (!this._audio.src || !this._audio.paused) return;
            this._systemAutoPaused = false;
            try { this._audio.play().catch(() => {}); } catch {}
          });
        }
      } catch {}
    }

    // ---- Scrubber: mascot position + Jarvis mode ---------------------

    _positionScrubberMascot() {
      if (!this._scrubberMascot) return;
      const pct = Number(this._scrubber.value) / Number(this._scrubber.max || 1000);
      const rail = this._scrubber.getBoundingClientRect();
      const wrap = this._scrubberWrap.getBoundingClientRect();
      const usable = Math.max(0, rail.width - MASCOT_W);
      const xInRail = (MASCOT_W / 2) + pct * usable;
      const leftPx = (rail.left - wrap.left) + xInRail;
      this._setDynamicStyle('#scrubberMascot', `left: ${leftPx}px;`);
      // Keep the Jarvis badge on the same rail position — one of the two
      // is always hidden by the .jarvis-mode class, so positioning both
      // is cheap.
      if (this._scrubberJarvis) this._setDynamicStyle('#scrubberJarvis', `left: ${leftPx}px;`);
    }

    // The mascot is reserved for Claude Code responses. When the
    // currently-playing audio originated from a highlight-to-speak
    // trigger ("hey jarvis" or Ctrl+Shift+S) — identified by the
    // `-clip-` filename segment — swap the mascot for a plain "J" badge
    // so the mascot's visual identity stays tied to Claude-sourced
    // content. Called whenever currentPath changes.
    _updateScrubberMode() {
      if (!this._scrubberWrap) return;
      const name = this._currentPath ? this._currentPath.split(/[\\/]/).pop() : '';
      const jarvis = !!name && this._clipPaths && this._clipPaths.isClipFile(name);
      this._scrubberWrap.classList.toggle('jarvis-mode', jarvis);

      // Recolour the mascot to the session's primary palette colour
      // while its clip plays. Cleared (falls back to CSS default orange)
      // for J-clips or when nothing is playing, so the Claude-Code homage
      // colour is restored at rest.
      // Typeof guards: test fixtures use stub objects that don't
      // implement the full DOM element API; real browser elements always
      // do. Skipping silently keeps tests passing without special-casing.
      const mascot = this._scrubberMascot;
      if (mascot && typeof mascot.setAttribute === 'function') {
        const key = !jarvis && this._currentPath
          ? this._resolveSessionPaletteKey(this._currentPath)
          : null;
        if (key) {
          mascot.setAttribute('data-palette', key);
        } else if (typeof mascot.removeAttribute === 'function') {
          mascot.removeAttribute('data-palette');
        }
      }
    }

    // ---- Scrubber: rAF tick + verb cloud -----------------------------

    _syncScrubberFromAudio() {
      const a = this._audio;
      if (!this._userScrubbing && isFinite(a.duration) && a.duration > 0) {
        this._scrubber.value = Math.round((a.currentTime / a.duration) * 1000);
        if (this._timeEl) {
          this._timeEl.textContent = `${this._fmt(a.currentTime)} / ${this._fmt(a.duration)}`;
        }
      } else if (!this._userScrubbing) {
        if (this._timeEl) {
          this._timeEl.textContent = `${this._fmt(a.currentTime)} / 0:00`;
        }
      }
      this._positionScrubberMascot();
    }

    // Trail emission — every 850-1500 ms (jittered) while audio is
    // playing forward, drop a random spinner verb just behind the
    // mascot. The word is absolutely positioned inside scrubberWrap;
    // once placed, it stays put while the mascot continues walking
    // forward, so the words look like a trail he's leaving behind.
    // Auto-removed on animationend.
    _emitSpinnerVerbCloud(now) {
      if (!this._scrubberWrap || !this._scrubberMascot) return;
      if (this._audio.paused || this._audio.ended || this._userScrubbing) return;
      if (now < this._nextVerbEmitAt) return;
      const rail = this._scrubber.getBoundingClientRect();
      const wrap = this._scrubberWrap.getBoundingClientRect();
      if (wrap.width <= 0) return;
      const pct = Number(this._scrubber.value) / Number(this._scrubber.max || 1000);
      const usable = Math.max(0, rail.width - MASCOT_W);
      const mascotX = (rail.left - wrap.left) + (MASCOT_W / 2) + pct * usable;

      const word = document.createElement('span');
      word.className = 'scrubber-trail-word';
      word.textContent = this._randomVerb();
      // D2-9 — each word gets a unique id + a rule in the Constructable
      // Stylesheet; the animationend handler removes both the element
      // and the rule so the adopted sheet stays bounded.
      const wordId = 'sp-w-' + (++this._spinnerWordCounter);
      word.id = wordId;
      this._setDynamicStyle(`#${wordId}`, `left: ${mascotX}px;`);
      this._scrubberWrap.appendChild(word);
      word.addEventListener('animationend', () => {
        word.remove();
        this._setDynamicStyle(`#${wordId}`, null);
      }, { once: true });

      this._nextVerbEmitAt = now + 850 + Math.random() * 650;
    }

    _scrubberTick() {
      this._syncScrubberFromAudio();
      this._emitSpinnerVerbCloud(performance.now());
      if (!this._audio.paused && !this._audio.ended) {
        this._scrubberRafId = requestAnimationFrame(() => this._scrubberTick());
      } else {
        this._scrubberRafId = null;
      }
    }

    _startScrubberRaf() {
      if (this._scrubberRafId === null) {
        this._scrubberRafId = requestAnimationFrame(() => this._scrubberTick());
      }
    }

    _wireScrubberRafHooks() {
      // Scrubber + time-readout smooth updater. Built-in `timeupdate`
      // only fires ~4×/sec → the mascot visibly jumped in 250 ms chunks.
      // Drive it from requestAnimationFrame for buttery motion. rAF
      // auto-pauses on hidden windows (no CPU wasted when the bar isn't
      // visible).
      this._on(this._audio, 'play', () => {
        if (this._scrubberWrap) this._scrubberWrap.classList.add('walking');
        this._startScrubberRaf();
      });
      this._on(this._audio, 'playing', () => {
        if (this._scrubberWrap) this._scrubberWrap.classList.add('walking');
        this._startScrubberRaf();
      });
      this._on(this._audio, 'pause', () => {
        if (this._scrubberWrap) this._scrubberWrap.classList.remove('walking');
        this._syncScrubberFromAudio();
      });
      this._on(this._audio, 'ended', () => {
        if (this._scrubberWrap) this._scrubberWrap.classList.remove('walking');
        this._syncScrubberFromAudio();
      });
      this._on(this._audio, 'seeking', () => this._syncScrubberFromAudio());
      this._on(this._audio, 'timeupdate', () => {
        if (this._scrubberRafId === null) this._syncScrubberFromAudio();
      });
      this._on(this._audio, 'loadedmetadata', () => {
        if (this._timeEl) {
          this._timeEl.textContent = `0:00 / ${this._fmt(this._audio.duration)}`;
        }
      });
    }

    // ---- Scrubber input + direction detection ------------------------

    _clearScrubDir() {
      if (this._scrubberWrap) {
        this._scrubberWrap.classList.remove('scrubbing', 'scrubbing-forward', 'scrubbing-backward');
      }
      this._scrubDirTimer = null;
    }

    _setScrubDir(dir) {
      if (!this._scrubberWrap) return;
      this._scrubberWrap.classList.add('scrubbing');
      if (dir > 0) {
        this._scrubberWrap.classList.add('scrubbing-forward');
        this._scrubberWrap.classList.remove('scrubbing-backward');
      } else if (dir < 0) {
        this._scrubberWrap.classList.add('scrubbing-backward');
        this._scrubberWrap.classList.remove('scrubbing-forward');
      }
      if (this._scrubDirTimer) clearTimeout(this._scrubDirTimer);
      this._scrubDirTimer = setTimeout(() => this._clearScrubDir(), 160);
    }

    _wireScrubberInput() {
      if (!this._scrubber) return;
      this._on(this._scrubber, 'mousedown', () => {
        this._userScrubbing = true;
        this._lastScrubberValue = Number(this._scrubber.value);
      });
      this._on(this._scrubber, 'mouseup', () => {
        if (isFinite(this._audio.duration)) {
          this._audio.currentTime = (this._scrubber.value / 1000) * this._audio.duration;
        }
        this._userScrubbing = false;
        this._clearScrubDir();
        this._positionScrubberMascot();
      });
      this._on(this._scrubber, 'input', () => {
        const newVal = Number(this._scrubber.value);
        const dir = newVal - this._lastScrubberValue;
        if (dir !== 0) this._setScrubDir(dir);
        this._lastScrubberValue = newVal;
        if (isFinite(this._audio.duration)) {
          const t = (this._scrubber.value / 1000) * this._audio.duration;
          if (this._timeEl) {
            this._timeEl.textContent = `${this._fmt(t)} / ${this._fmt(this._audio.duration)}`;
          }
        }
        this._positionScrubberMascot();
      });
      // Keyboard arrows fire 'change' not 'input' on some Chromium
      // builds — catch both so keyboard seeking also flips the mascot
      // correctly.
      this._on(this._scrubber, 'change', () => this._positionScrubberMascot());
    }

    _wireWindowResize() {
      // Re-position on window resize (bar resizes when settings panel
      // opens).
      if (typeof window !== 'undefined') {
        this._on(window, 'resize', () => this._positionScrubberMascot());
      }
    }
  }

  return { AudioPlayer };
}));
