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
      const { queue, currentPath, heardPaths, sessionAssignments, synthInProgress } = this.state;
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
          currentPath, heardPaths, sessionAssignments,
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

    _buildDot(f, fname, short, viewState) {
      const { currentPath, heardPaths, sessionAssignments } = viewState;
      const dot = document.createElement('button');
      dot.className = 'dot';
      dot.setAttribute('role', 'listitem');
      dot.type = 'button';
      if (f.path === currentPath) dot.classList.add('active');
      if (this._clipPaths.isClipFile(fname)) {
        dot.classList.add('clip');
        dot.textContent = 'J';
      }
      if (heardPaths.has(f.path)) dot.classList.add('heard');
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
      dot.addEventListener('click', () => { if (this._onPlay) this._onPlay(f.path); });
      dot.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (this._onDelete) this._onDelete(f.path);
      });
      return dot;
    }
  }

  return { DotStrip };
}));
