// EX7c — extracted from app/renderer.js as part of the v0.4 renderer
// refactor. Owns the horizontal strip of dots above the audio controls:
// one coloured circle per queued clip, grouped by session into visual
// runs, with the currently-playing dot highlighted.
//
// Behaviour preserved byte-for-byte from the old renderDots +
// _renderDotsNow: oldest-left / newest-right, session run gaps, clip-vs-
// response dot shape, heard/stale/active CSS classes, data-palette wiring,
// synth-in-progress placeholder, click -> onPlay(path), right-click ->
// onDelete(path). Mute filtering reads entry.muted off the assignments
// map passed in via update().
//
// Render is rAF-debounced: multiple update() calls within the same frame
// coalesce into one DOM write, matching the original _renderDotsQueued
// latch. The pending RAF is tracked on the instance so unmount() can
// cancel it before it fires.

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
    root.TT_DOT_STRIP = api.DotStrip;
  }
}(typeof self !== 'undefined' ? self : this, function (componentModule) {
  'use strict';

  const { Component } = componentModule;

  // Miniature of the scrubber mascot, stamped inside each assistant-session
  // dot. Geometry is byte-identical to the #scrubberMascot SVG in
  // app/index.html so a dot reads as the same character; the body/ear/leg
  // rects fill from --mascot-* CSS variables that palette-classes.css sets on
  // `.dot.mascot[data-palette="NN"]`, so a dot matches its session's solid /
  // top-bottom / left-right arrangement automatically.
  //   - shape-rendering="geometricPrecision": at 14 px the four legs + smile
  //     land on a fractional pixel grid; smooth anti-aliasing keeps them from
  //     fraying ("hairy") the way crispEdges' uneven snapping does.
  //   - .dm-region rects carry the palette colour and flip to white for the
  //     manually-played state (styles.css); .dm-face rects (eyes + smile) stay
  //     dark so the character still reads when the body goes white.
  // No inline `style=` attributes — CSP style-src is 'self'. The var()-based
  // presentation `fill` attributes are not inline styles (same pattern the
  // scrubber mascot already uses under this CSP).
  const MASCOT_SVG =
    '<svg class="dot-mascot" viewBox="0 0 140 120" shape-rendering="geometricPrecision" aria-hidden="true" focusable="false">' +
    '<rect class="dm-region" x="13" y="0" width="57" height="44" fill="var(--mascot-body-top-left, currentColor)"/>' +
    '<rect class="dm-region" x="70" y="0" width="57" height="44" fill="var(--mascot-body-top-right, currentColor)"/>' +
    '<rect class="dm-region" x="13" y="44" width="57" height="44" fill="var(--mascot-body-bottom-left, var(--mascot-secondary, currentColor))"/>' +
    '<rect class="dm-region" x="70" y="44" width="57" height="44" fill="var(--mascot-body-bottom-right, var(--mascot-secondary, currentColor))"/>' +
    '<rect class="dm-region" x="0" y="36" width="13" height="8" fill="var(--mascot-ear-left-top, currentColor)"/>' +
    '<rect class="dm-region" x="0" y="44" width="13" height="18" fill="var(--mascot-ear-left-bottom, var(--mascot-secondary, currentColor))"/>' +
    '<rect class="dm-region" x="127" y="36" width="13" height="8" fill="var(--mascot-ear-right-top, currentColor)"/>' +
    '<rect class="dm-region" x="127" y="44" width="13" height="18" fill="var(--mascot-ear-right-bottom, var(--mascot-secondary, currentColor))"/>' +
    '<rect class="dm-region" x="19" y="88" width="16" height="32" fill="var(--mascot-leg-left, var(--mascot-secondary, currentColor))"/>' +
    '<rect class="dm-region" x="46" y="88" width="16" height="32" fill="var(--mascot-leg-left, var(--mascot-secondary, currentColor))"/>' +
    '<rect class="dm-region" x="79" y="88" width="16" height="32" fill="var(--mascot-leg-right, var(--mascot-secondary, currentColor))"/>' +
    '<rect class="dm-region" x="106" y="88" width="16" height="32" fill="var(--mascot-leg-right, var(--mascot-secondary, currentColor))"/>' +
    '<rect class="dm-face" x="36" y="26" width="16" height="16" fill="#1a1c22"/>' +
    '<rect class="dm-face" x="88" y="26" width="16" height="16" fill="#1a1c22"/>' +
    '<rect class="dm-face" x="44" y="58" width="8" height="6" fill="#1a1c22"/>' +
    '<rect class="dm-face" x="88" y="58" width="8" height="6" fill="#1a1c22"/>' +
    '<rect class="dm-face" x="44" y="64" width="52" height="6" fill="#1a1c22"/>' +
    '</svg>';

  class DotStrip extends Component {
    constructor(deps = {}) {
      super(deps);
      const {
        clipPaths,            // { extractSessionShort, isClipFile, paletteKeyForShort }
        staleSessionPoller,   // { has(shortId) } — for the .stale class + tooltip
        paletteSize = 24,
        maxVisibleDots = 40,
        onPlay = null,        // (path) => void
        onDelete = null,      // (path) => void
      } = deps;
      this._clipPaths = clipPaths;
      this._staleSessionPoller = staleSessionPoller;
      this._paletteSize = paletteSize;
      this._maxVisibleDots = maxVisibleDots;
      this._onPlay = onPlay;
      this._onDelete = onDelete;
      this._pendingRaf = null;
      this.state = {
        queue: [],
        currentPath: null,
        heardPaths: new Set(),
        manualPlayedPaths: new Set(),
        sessionAssignments: {},
        synthInProgress: false,
      };
    }

    _onUpdate() {
      // rAF-debounce: a burst of update() calls in the same frame produces
      // exactly one _renderNow(). The pending id is tracked here (not via
      // this._requestAnimationFrame) so repeated updates don't leak
      // teardown entries.
      if (this._pendingRaf !== null) return;
      this._pendingRaf = requestAnimationFrame(() => {
        this._pendingRaf = null;
        this._renderNow();
      });
    }

    _onUnmount() {
      if (this._pendingRaf !== null) {
        cancelAnimationFrame(this._pendingRaf);
        this._pendingRaf = null;
      }
      // Wipe the root so per-dot click/contextmenu listeners go out with
      // the DOM nodes they're attached to — no manual listener bookkeeping.
      if (this.root) this.root.innerHTML = '';
    }

    // Expose the synchronous render path so tests can drive one paint
    // without waiting on a real requestAnimationFrame.
    renderNow() { this._renderNow(); }

    _isClipSessionMuted(filename) {
      const short = this._clipPaths.extractSessionShort(filename);
      if (!short) return false;
      const entry = this.state.sessionAssignments[short];
      return !!(entry && entry.muted);
    }

    _renderNow() {
      if (!this.root) return;
      const { queue, currentPath, currentIsManual, heardPaths, manualPlayedPaths, sessionAssignments, synthInProgress } = this.state;
      this.root.innerHTML = '';

      // Muted sessions' clips are hidden entirely — no dot, no trace.
      // Order oldest-left -> newest-right so the row reads in the same
      // direction playback flows. queue is newest-first from main, so
      // slice to the visible cap then reverse.
      const unmuted = queue.filter((f) => !this._isClipSessionMuted(f.path.split(/[\\/]/).pop()));
      const visible = unmuted.slice(0, this._maxVisibleDots).slice().reverse();

      // Session run grouping: insert a small gap whenever the session
      // shortId changes between consecutive clips. Visual clusters —
      // [T1][T1] | [T2] | [T1][T1] — so the user sees at a glance which
      // terminal said what, while playback order stays strictly chronological.
      let prevShort;
      for (const f of visible) {
        const fname = f.path.split(/[\\/]/).pop();
        const thisShort = this._clipPaths.extractSessionShort(fname);
        if (prevShort !== undefined && thisShort !== prevShort) {
          const gap = document.createElement('span');
          gap.className = 'dots-run-gap';
          this.root.appendChild(gap);
        }
        prevShort = thisShort;

        this.root.appendChild(this._buildDot(f, fname, thisShort, {
          currentPath, currentIsManual, heardPaths, manualPlayedPaths, sessionAssignments,
        }));
      }

      // R6.3: placeholder dot while edge-tts is synthesising from a
      // wake-word or Ctrl+Shift+S trigger. Removed the moment a priority
      // play arrives (onPriorityPlay flips the flag) or main fires
      // state=idle in finally.
      if (synthInProgress) {
        const placeholder = document.createElement('span');
        placeholder.className = 'dot pending-synth';
        placeholder.title = 'Listening -- synth in progress';
        placeholder.setAttribute('aria-label', 'Synthesis in progress');
        this.root.appendChild(placeholder);
      }
    }

    // One physical right-click fires BOTH `mousedown` (button 2) and
    // `contextmenu`. On a busy main thread the strip RE-RENDERS between the
    // two (the first delete's renderDots() rAF fires, plus the queue-watch
    // readdir keeps the thread busy), so the trailing `contextmenu` lands on
    // a DIFFERENT dot and deletes it too — the user's "deleted 2 with one
    // click". The two events therefore share neither a path NOR a reliable
    // time gap (~250 ms observed), so neither a per-path nor a fixed-time
    // guard can pair them.
    //
    // Gate by EVENT ROLE instead: `mousedown` is the authoritative delete and
    // is NEVER suppressed, so rapid right-clicks on different dots each delete
    // (the earlier instance-wide time guard wrongly swallowed those). The
    // `contextmenu` that trails a mousedown is the redundant half of one
    // gesture and is dropped. On platforms where button-2 `mousedown` doesn't
    // fire (some mac trackpad configs / flaky Electron alwaysOnTop), no
    // suppression is armed, so `contextmenu` becomes the sole trigger and
    // still deletes exactly once.
    _deleteFromMousedown(path) {
      // Arm suppression of the paired contextmenu that follows within this
      // window. Generous (600 ms) to survive a congested main-thread
      // re-render+IPC; harmless to rapid distinct deletes because those
      // arrive as fresh `mousedown` events, which are never suppressed.
      this._suppressContextmenuUntil = Date.now() + 600;
      if (this._onDelete) this._onDelete(path);
    }

    _deleteFromContextmenu(path) {
      if (this._suppressContextmenuUntil && Date.now() < this._suppressContextmenuUntil) {
        this._suppressContextmenuUntil = 0;  // consume: only the paired contextmenu is dropped
        return;
      }
      if (this._onDelete) this._onDelete(path);
    }

    _buildDot(f, fname, short, viewState) {
      const { currentPath, currentIsManual, heardPaths, manualPlayedPaths, sessionAssignments } = viewState;
      const dot = document.createElement('button');
      dot.className = 'dot';
      dot.setAttribute('role', 'listitem');
      dot.type = 'button';
      if (f.path === currentPath) {
        dot.classList.add('active');
        // Phase 4 dot-size differential (#42): bigger inner white pulse
        // for manual ("hey jarvis" / Ctrl+Shift+S / user click on dot)
        // vs the smaller default pulse for autoplay-from-queue. Lets the
        // user tell at a glance whether the toolbar is reading something
        // they explicitly asked for vs continuing through the queue.
        dot.classList.add(currentIsManual ? 'active-manual' : 'active-auto');
      }
      if (this._clipPaths.isClipFile(fname)) {
        // Highlight-to-speak ("hey jarvis" / Ctrl+Shift+S) clips keep the
        // round "J" badge. The mascot is reserved for assistant-session
        // replies — mirrors the scrubber (mascot = assistant, J = manual read).
        dot.classList.add('clip');
        dot.textContent = 'J';
      } else {
        // Assistant-session clip: render the session mascot. Same art +
        // data-palette recolouring as the scrubber mascot, so the dot matches
        // its session exactly. Lifecycle (queued / auto-played / manually-
        // played / active) is driven by the heard / played-* / active classes
        // set below + the .dot.mascot rules in styles.css.
        dot.classList.add('mascot');
        dot.innerHTML = MASCOT_SVG;
      }
      if (heardPaths.has(f.path)) {
        dot.classList.add('heard');
        dot.classList.add(manualPlayedPaths && manualPlayedPaths.has(f.path) ? 'played-manual' : 'played-auto');
      }
      // D2-9 — data-palette drives both the non-heard background and the
      // heard ring colour via rules in app/lib/palette-classes.css.
      // Replaces the old dot.style.background / boxShadow writes so the
      // CSP style-src directive no longer needs 'unsafe-inline'.
      dot.dataset.palette = this._clipPaths.paletteKeyForShort(
        short, sessionAssignments, this._paletteSize
      );
      // Dead-terminal signal: desaturate the dot so the user can tell at
      // a glance which clips originated from a closed session. Still
      // playable; colour preserved, just dimmer.
      const isStale = !!(short && this._staleSessionPoller.has(short));
      if (isStale) dot.classList.add('stale');
      const entry = short ? sessionAssignments[short] : null;
      const label = entry && entry.label ? ` [${entry.label}]` : '';
      const staleMark = isStale ? ' (closed)' : '';
      const d = new Date(f.mtime);
      const titleText = `Created ${d.toLocaleTimeString()}${label}${staleMark} — click to play, right-click to delete`;
      dot.title = titleText;
      dot.setAttribute('aria-label', titleText);
      if (f.path === currentPath) dot.setAttribute('aria-current', 'true');
      // Per-dot listeners ride out with the DOM nodes on next render —
      // no bookkeeping needed because this.root.innerHTML = '' above
      // orphans the old buttons and GC takes their listeners with them.
      // mousedown(button=2) catches the right-click before browsers
      // derive a `click` event from it; macOS trackpad "secondary click"
      // configurations sometimes deliver the gesture as a primary click,
      // and Electron's contextmenu emission is also flakier on
      // alwaysOnTop windows. Ctrl+click also routes to delete because
      // it's the universal Mac equivalent of right-click.
      dot.addEventListener('mousedown', (e) => {
        if (e.button === 2 || (e.button === 0 && e.ctrlKey)) {
          e.preventDefault();
          e.stopPropagation();
          this._deleteFromMousedown(f.path);
        }
      });
      dot.addEventListener('click', (e) => {
        // Skip primary-click handler when it was actually a Ctrl+click —
        // the mousedown handler already routed that to delete. Guard
        // against synthetic test invocations that omit the event arg.
        if (e && e.ctrlKey) return;
        if (this._onPlay) this._onPlay(f.path);
      });
      dot.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._deleteFromContextmenu(f.path);
      });
      return dot;
    }
  }

  return { DotStrip };
}));
