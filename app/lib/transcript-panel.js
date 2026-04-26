/* global self, window, document */
// Transcript panel — expandable section under the dot strip that shows
// the text of recent audio clips with copy support.
//
// Why: when the audio plays a chunk that the user wants to respond to,
// they currently have to scroll the terminal to find the source text.
// This panel keeps the spoken text visible and copyable next to the
// audio, so the workflow is "hear it -> copy the bit -> reply".
//
// Phase 1 (this module): show last 10 clips, current clip visually
// distinguished, copy-all-text button per clip, spoken/original view
// toggle. No per-word karaoke highlight (that needs word-timing data
// the TTS engines don't currently expose — deferred to Phase 2).
//
// Sidecars: synth_turn.py and tts-helper.psm1 write a `.txt` (post-
// strip-for-tts spoken text) and optionally `.original.txt` (pre-strip
// markdown source) alongside each audio clip. This module reads those
// sidecars on demand — no separate in-memory state to keep in sync.
//
// UMD-lite pattern matches the other lib/* modules so the same file
// loads from Node unit tests and from the renderer's <script> tag.

(function (root, factory) {
  'use strict';
  const api = factory(
    typeof module === 'object' && module.exports
      ? require('./component')
      : { Component: root.TT_COMPONENT },
  );
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TT_TRANSCRIPT_PANEL = api;
  }
}(typeof self !== 'undefined' ? self : this, function (componentModule) {
  'use strict';

  const { Component } = componentModule;

  // Cap for the last-N-clips view. Bounded so a long session doesn't
  // drag the renderer with hundreds of DOM nodes (each clip shows the
  // full sentence — typically 20-200 chars but occasional 1k+ for
  // narrator summaries).
  const MAX_CLIPS_SHOWN = 10;

  class TranscriptPanel extends Component {
    constructor(deps = {}) {
      super(deps);
      const {
        // DOM refs
        panelEl,        // wrapper element
        toggleBtn,      // expand/collapse trigger
        viewToggleBtn,  // spoken/original toggle
        listEl,         // <ul> or <div> that holds clip rows
        countEl,        // small badge with current clip count

        // Data sources
        getQueue = () => [],          // [{ path, mtime, ... }] from queueWatcher
        getCurrentPath = () => null,  // path string of clip currently playing
        getHeardPaths = () => new Set(),

        // File-system reader (injectable for tests)
        readSidecar = () => null,

        // Persistence: expand/collapse + view-mode survive reloads.
        // Defaults are read at mount; on user toggle the new value is
        // pushed via setPersistedFlag (host writes to config.json).
        getInitialExpanded = () => false,
        getInitialView = () => 'spoken',
        setPersistedFlag = () => {},

        // Clipboard write (injectable for tests).
        writeClipboard = (text) => {
          if (typeof navigator !== 'undefined' && navigator.clipboard) {
            try { return navigator.clipboard.writeText(text); } catch {}
          }
          return null;
        },

        // Optional: when the user clicks a clip's body, play it.
        onClickClip = () => {},
      } = deps;

      this._panelEl = panelEl;
      this._toggleBtn = toggleBtn;
      this._viewToggleBtn = viewToggleBtn;
      this._listEl = listEl;
      this._countEl = countEl;

      this._getQueue = getQueue;
      this._getCurrentPath = getCurrentPath;
      this._getHeardPaths = getHeardPaths;
      this._readSidecar = readSidecar;
      this._writeClipboard = writeClipboard;
      this._onClickClip = onClickClip;
      this._setPersistedFlag = setPersistedFlag;

      // Persisted UI state.
      this._expanded = !!getInitialExpanded();
      this._view = (getInitialView() === 'original') ? 'original' : 'spoken';

      // Cached sidecar text per audio path so we don't re-read the
      // filesystem on every render. Cleared lazily when the queue
      // shrinks to a path no longer present.
      this._sidecarCache = new Map();
    }

    // ---- Public API ---------------------------------------------------

    // Re-render with current queue/playing-path state. Cheap to call
    // on every queue-change event — the work is bounded by
    // MAX_CLIPS_SHOWN.
    refresh() {
      this.update({});
      return this;
    }

    isExpanded() { return this._expanded; }
    getView() { return this._view; }

    setExpanded(expanded) {
      const next = !!expanded;
      if (next === this._expanded) return;
      this._expanded = next;
      this._applyExpanded();
      this._setPersistedFlag('expanded', next);
    }

    setView(view) {
      const next = view === 'original' ? 'original' : 'spoken';
      if (next === this._view) return;
      this._view = next;
      this._applyViewLabel();
      this._setPersistedFlag('view', next);
      this.refresh();
    }

    // ---- Lifecycle ----------------------------------------------------

    _onMount() {
      this._applyExpanded();
      this._applyViewLabel();
      if (this._toggleBtn) {
        this._on(this._toggleBtn, 'click', () => this.setExpanded(!this._expanded));
      }
      if (this._viewToggleBtn) {
        this._on(this._viewToggleBtn, 'click', () => {
          this.setView(this._view === 'spoken' ? 'original' : 'spoken');
        });
      }
      this.refresh();
    }

    _onUpdate() {
      // Only render the list when the panel is expanded — when collapsed
      // we just keep the count badge fresh.
      const recent = this._recentClips();
      if (this._countEl) {
        this._countEl.textContent = recent.length > 0 ? String(recent.length) : '';
      }
      if (!this._expanded || !this._listEl) return;
      this._renderList(recent);
    }

    // ---- Internals ----------------------------------------------------

    _applyExpanded() {
      if (!this._panelEl) return;
      this._panelEl.classList.toggle('expanded', this._expanded);
      this._panelEl.setAttribute('aria-expanded', this._expanded ? 'true' : 'false');
      if (this._toggleBtn) {
        this._toggleBtn.setAttribute('aria-pressed', this._expanded ? 'true' : 'false');
      }
      // First-render trigger when transitioning from collapsed -> expanded:
      // the list might be stale if refresh() was a no-op while collapsed.
      if (this._expanded) this.refresh();
    }

    _applyViewLabel() {
      if (!this._viewToggleBtn) return;
      this._viewToggleBtn.textContent = this._view === 'spoken' ? 'Spoken' : 'Original';
      this._viewToggleBtn.setAttribute('aria-label', `View mode: ${this._view}`);
    }

    _recentClips() {
      const all = this._getQueue() || [];
      // newest first by mtime; cap at MAX_CLIPS_SHOWN.
      return all
        .slice()
        .sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
        .slice(0, MAX_CLIPS_SHOWN);
    }

    _readSidecarText(audioPath) {
      if (!audioPath) return { spoken: '', original: '' };
      const cached = this._sidecarCache.get(audioPath);
      if (cached) return cached;
      // Resolver returns { spoken, original } or null. Treat null as
      // "no sidecar" (older clips from before this feature shipped).
      const result = this._readSidecar(audioPath) || { spoken: '', original: '' };
      const safe = {
        spoken: typeof result.spoken === 'string' ? result.spoken : '',
        original: typeof result.original === 'string' ? result.original : '',
      };
      this._sidecarCache.set(audioPath, safe);
      return safe;
    }

    _renderList(clips) {
      if (!this._listEl) return;
      // Remove DOM nodes that no longer correspond to a queue entry.
      // Cheap rebuild — the list is always small (≤ MAX_CLIPS_SHOWN).
      this._listEl.innerHTML = '';
      const currentPath = this._getCurrentPath();

      for (const clip of clips) {
        const row = document.createElement('div');
        row.className = 'transcript-row';
        if (clip.path === currentPath) row.classList.add('current');

        const sidecar = this._readSidecarText(clip.path);
        const text = this._view === 'original' && sidecar.original
          ? sidecar.original
          : sidecar.spoken;

        // No sidecar means an older clip predating the feature (or a
        // T-/H- ephemeral that we skip persisting). Show a faded
        // placeholder rather than blank — the user knows the clip is
        // there in the dot strip.
        const body = document.createElement('div');
        body.className = 'transcript-body';
        if (text) {
          body.textContent = text;
        } else {
          body.classList.add('empty');
          body.textContent = '(no transcript available for this clip)';
        }
        // Click body to play the clip via host callback. Browser-native
        // text selection still works because we don't preventDefault.
        if (this._onClickClip) {
          body.addEventListener('click', (e) => {
            // Don't eat clicks that are part of a text selection drag.
            const sel = (typeof window !== 'undefined' && window.getSelection)
              ? window.getSelection()
              : null;
            if (sel && sel.toString().length > 0) return;
            this._onClickClip(clip.path, e);
          });
        }
        row.appendChild(body);

        // Copy-all button, per row.
        const copyBtn = document.createElement('button');
        copyBtn.className = 'transcript-copy';
        copyBtn.type = 'button';
        copyBtn.textContent = 'Copy';
        copyBtn.setAttribute('aria-label', 'Copy clip text to clipboard');
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!text) return;
          this._writeClipboard(text);
          copyBtn.textContent = 'Copied';
          // Reset label after a brief flash. Don't tear-down-register
          // this — if the panel is unmounted before the timeout fires,
          // the row is gone too.
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
        });
        row.appendChild(copyBtn);

        this._listEl.appendChild(row);
      }
    }
  }

  return { TranscriptPanel, MAX_CLIPS_SHOWN };
}));
