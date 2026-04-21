// EX7d-1 — extracted from app/renderer.js as part of the v0.4
// renderer refactor. Owns the per-session rows in the Settings panel:
// label / palette / focus-star / mute-toggle / remove-×, plus the
// expandable per-session voice + tri-state speech-includes grid.
//
// Behaviour preserved byte-for-byte from the old renderSessionsTable
// + renderSessionRow pair, including:
//   - Focus-bail: skip the paint if an input/select inside the table
//     currently has focus (don't yank the caret or snap a dropdown).
//   - Run-order sort by entry.index (stable colour-arrangement).
//   - Sessions empty state ("No active Claude Code sessions…").
//   - aria-row / aria-pressed / aria-expanded wiring for screen readers.
//   - Expanded-session latch survives re-renders (internal state).
//
// State model:
//   mount(root)           — attaches to the sessions-table element
//   update({ sessionAssignments }) — schedules a re-render
//   Per-action callbacks (onSetLabel, onSetIndex, onSetFocus,
//   onSetMuted, onRemove, onSetVoice, onSetInclude) arrive via deps
//   so the component can be exercised from unit tests without an
//   Electron IPC bridge.
//
// After a mutation (index / mute / remove / speech-include) the
// component re-renders itself and calls deps.onAfterMutation() so
// renderer.js can re-paint the dot strip. Focus / voice / label
// updates don't need the dot repaint, matching the old code.

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
    root.TT_SESSIONS_TABLE = api.SessionsTable;
  }
}(typeof self !== 'undefined' ? self : this, function (componentModule) {
  'use strict';

  const { Component } = componentModule;

  class SessionsTable extends Component {
    constructor(deps = {}) {
      super(deps);
      const {
        clipPaths,           // { paletteKeyForIndex }
        staleSessionPoller,  // { has(shortId) }
        paletteSize = 24,
        colourNames = [],
        hsplitPartner = [],
        vsplitPartner = [],
        edgeVoices = [],
        includeLabels = [],
        // Per-action IPC callbacks (all return a boolean-ish promise).
        onSetLabel = async () => {},
        onSetIndex = async () => {},
        onSetFocus = async () => {},
        onSetMuted = async () => {},
        onRemove = async () => {},
        onSetVoice = async () => {},
        onSetInclude = async () => {},
        onAfterMutation = () => {},
      } = deps;
      this._clipPaths = clipPaths;
      this._staleSessionPoller = staleSessionPoller;
      this._paletteSize = paletteSize;
      this._colourNames = colourNames;
      this._hsplitPartner = hsplitPartner;
      this._vsplitPartner = vsplitPartner;
      this._edgeVoices = edgeVoices;
      this._includeLabels = includeLabels;
      this._onSetLabel = onSetLabel;
      this._onSetIndex = onSetIndex;
      this._onSetFocus = onSetFocus;
      this._onSetMuted = onSetMuted;
      this._onRemove = onRemove;
      this._onSetVoice = onSetVoice;
      this._onSetInclude = onSetInclude;
      this._onAfterMutation = onAfterMutation;
      this._expanded = new Set();
      this._paletteOptionsFragment = null;
      this.state = { sessionAssignments: {} };
    }

    _onUpdate() { this._renderNow(); }

    _onUnmount() {
      if (this.root) this.root.innerHTML = '';
    }

    // Public sync path for tests.
    renderNow() { this._renderNow(); }

    // Exposed so renderer.js can mutate its cache and re-sync the view
    // after IPC fires notifyQueue(); matches the old renderSessionsTable()
    // calls that were interleaved with sessionAssignments mutations.
    rerender() { this._renderNow(); }

    _arrangementLabel(i) {
      if (i < 8) return `${this._colourNames[i]}`;
      if (i < 16) {
        const p = i - 8;
        return `${this._colourNames[p]} / ${this._colourNames[this._hsplitPartner[p]]} — top/bottom`;
      }
      const p = i - 16;
      return `${this._colourNames[p]} / ${this._colourNames[this._vsplitPartner[p]]} — left/right`;
    }

    // Cached <option> template for the per-session palette selector.
    // The palette is immutable at runtime (paletteSize arrangements)
    // and the label text for each index is pure, so build the option
    // list once and clone it into every rerender — avoids paletteSize
    // createElement + appendChild calls per row every time a queue
    // event fires. Audit Z11.
    _paletteOptionsClone() {
      if (!this._paletteOptionsFragment) {
        this._paletteOptionsFragment = document.createDocumentFragment();
        for (let i = 0; i < this._paletteSize; i++) {
          const opt = document.createElement('option');
          opt.value = String(i);
          opt.textContent = this._arrangementLabel(i);
          this._paletteOptionsFragment.appendChild(opt);
        }
      }
      return this._paletteOptionsFragment.cloneNode(true);
    }

    _renderNow() {
      if (!this.root) return;
      // Guard against yanking focus out from under the user. If any
      // control inside the table currently has keyboard / dropdown focus,
      // a full innerHTML clear would destroy it mid-interaction —
      // typing loses its caret, an open <select> snaps shut. A
      // background queue-updated can land at any moment; skip the paint
      // and defer to the next one. Audit Z11.
      const focused = document.activeElement;
      if (focused && this.root.contains(focused)
          && (focused.tagName === 'INPUT' || focused.tagName === 'SELECT')) {
        return;
      }

      this.root.innerHTML = '';
      const entries = Object.entries(this.state.sessionAssignments || {});
      if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'sessions-empty';
        empty.textContent = 'No active Claude Code sessions. Open a Claude Code terminal to see one here.';
        this.root.appendChild(empty);
        return;
      }
      entries.sort((a, b) => (a[1].index || 0) - (b[1].index || 0));
      for (const [shortId, entry] of entries) {
        this.root.appendChild(this._renderRow(shortId, entry));
      }
    }

    _renderRow(shortId, entry) {
      const wrap = document.createElement('div');
      wrap.className = 'session-block';
      wrap.setAttribute('role', 'row');
      if (this._staleSessionPoller.has(shortId)) {
        wrap.classList.add('stale');
        wrap.title = 'Terminal closed — colour preserved in case you reopen it';
      }

      const row = document.createElement('div');
      row.className = 'session-row';

      const chevron = this._buildChevron(shortId);
      row.appendChild(chevron);
      row.appendChild(this._buildSwatch(shortId, entry));
      row.appendChild(this._buildShortEl(shortId));
      row.appendChild(this._buildLabelInput(shortId, entry));
      row.appendChild(this._buildIndexSelect(shortId, entry));
      row.appendChild(this._buildFocusBtn(shortId, entry));
      row.appendChild(this._buildMuteBtn(shortId, entry));
      if (entry.muted) wrap.classList.add('session-muted');
      if (entry.focus) wrap.classList.add('session-focused');
      row.appendChild(this._buildRemoveBtn(shortId));
      wrap.appendChild(row);

      if (this._expanded.has(shortId)) {
        wrap.appendChild(this._buildExpanded(shortId, entry));
      }

      chevron.addEventListener('click', () => {
        if (this._expanded.has(shortId)) this._expanded.delete(shortId);
        else this._expanded.add(shortId);
        this._renderNow();
      });

      return wrap;
    }

    _buildChevron(shortId) {
      const chevron = document.createElement('button');
      chevron.type = 'button';
      chevron.className = 'chevron icon-btn';
      const expanded = this._expanded.has(shortId);
      chevron.innerHTML = expanded
        ? '<svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>'
        : '<svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg>';
      chevron.title = 'Per-session settings';
      chevron.setAttribute('aria-label', expanded ? 'Collapse session settings' : 'Expand session settings');
      chevron.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      return chevron;
    }

    _buildSwatch(shortId, entry) {
      const swatch = document.createElement('div');
      swatch.className = 'swatch';
      swatch.setAttribute('role', 'img');
      swatch.setAttribute('aria-label', `Colour swatch for session ${shortId}`);
      swatch.dataset.palette = this._clipPaths.paletteKeyForIndex(entry.index || 0, this._paletteSize);
      return swatch;
    }

    _buildShortEl(shortId) {
      const el = document.createElement('div');
      el.className = 'short';
      el.textContent = shortId;
      return el;
    }

    _buildLabelInput(shortId, entry) {
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.placeholder = 'Label (e.g. "Tax module")';
      // Set BOTH the attribute and the property. The attribute is what
      // HTML selectors like input[value="Primary"] match against
      // (Playwright tests rely on it); the property is what the input
      // actually displays. Keep in sync at construction time.
      const labelValue = entry.label || '';
      labelInput.value = labelValue;
      labelInput.setAttribute('value', labelValue);
      labelInput.addEventListener('change', () => {
        this._onSetLabel(shortId, labelInput.value.trim());
      });
      return labelInput;
    }

    _buildIndexSelect(shortId, entry) {
      const select = document.createElement('select');
      select.appendChild(this._paletteOptionsClone());
      select.value = String(entry.index || 0);
      select.addEventListener('change', async () => {
        const newIdx = Number(select.value);
        await this._onSetIndex(shortId, newIdx);
        const assignments = this.state.sessionAssignments;
        if (assignments[shortId]) {
          assignments[shortId].index = newIdx;
          assignments[shortId].pinned = true;
        }
        this._renderNow();
        // Any currently-queued clips from this session should recolour
        // to the new arrangement. Previously only the session row
        // rerendered; the dots stayed the old colour until the next
        // unrelated queue event.
        this._onAfterMutation();
      });
      return select;
    }

    _buildFocusBtn(shortId, entry) {
      const focusBtn = document.createElement('button');
      focusBtn.type = 'button';
      focusBtn.className = 'focus-btn' + (entry.focus ? ' focused' : '');
      focusBtn.textContent = entry.focus ? '★' : '☆';  // star/outline
      focusBtn.title = entry.focus
        ? 'Unfocus this session (its clips lose priority)'
        : 'Focus this session — its clips play before other sessions\' clips';
      focusBtn.setAttribute('aria-label', focusBtn.title);
      focusBtn.setAttribute('aria-pressed', entry.focus ? 'true' : 'false');
      focusBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        // main.js updates the registry and fires notifyQueue()
        // synchronously after save, which delivers authoritative
        // assignments back to us via the queue-updated listener. Any
        // local mutation here would just be a second source of truth —
        // and a subtly wrong one, since entry was captured at render
        // time and may be stale if the user clicked twice in quick
        // succession.
        await this._onSetFocus(shortId, !entry.focus);
      });
      return focusBtn;
    }

    _buildMuteBtn(shortId, entry) {
      const muteBtn = document.createElement('button');
      muteBtn.type = 'button';
      muteBtn.className = 'mute-btn' + (entry.muted ? ' muted' : '');
      muteBtn.textContent = entry.muted ? '🔇' : '🔊';  // mute/speaker
      muteBtn.title = entry.muted ? 'Unmute this session' : 'Mute this session (no audio, no synthesis)';
      muteBtn.setAttribute('aria-label', muteBtn.title);
      muteBtn.setAttribute('aria-pressed', entry.muted ? 'true' : 'false');
      muteBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const next = !entry.muted;
        const ok = await this._onSetMuted(shortId, next);
        if (ok) {
          const assignments = this.state.sessionAssignments;
          if (assignments[shortId]) assignments[shortId].muted = next;
          this._renderNow();
          this._onAfterMutation();
        }
      });
      return muteBtn;
    }

    _buildRemoveBtn(shortId) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'session-remove';
      removeBtn.textContent = '×';  // ×
      removeBtn.title = 'Remove this session (colour slot freed)';
      removeBtn.setAttribute('aria-label', `Remove session ${shortId} — colour slot freed`);
      removeBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const ok = await this._onRemove(shortId);
        if (ok) {
          const assignments = this.state.sessionAssignments;
          if (assignments) delete assignments[shortId];
          this._renderNow();
          this._onAfterMutation();
        }
      });
      return removeBtn;
    }

    _buildExpanded(shortId, entry) {
      const expanded = document.createElement('div');
      expanded.className = 'session-expanded';
      expanded.appendChild(this._buildVoiceRow(shortId, entry));
      expanded.appendChild(this._buildIncludesHeader());
      expanded.appendChild(this._buildIncludesGrid(shortId, entry));
      return expanded;
    }

    _buildVoiceRow(shortId, entry) {
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
      for (const v of this._edgeVoices) {
        const o = document.createElement('option');
        o.value = v.id;
        o.textContent = v.label;
        if (entry.voice === v.id) o.selected = true;
        voiceSel.appendChild(o);
      }
      voiceSel.addEventListener('change', async () => {
        const v = voiceSel.value || null;
        await this._onSetVoice(shortId, v);
        const assignments = this.state.sessionAssignments;
        if (assignments[shortId]) {
          if (v) assignments[shortId].voice = v;
          else delete assignments[shortId].voice;
        }
      });
      voiceRow.appendChild(voiceSel);
      return voiceRow;
    }

    _buildIncludesHeader() {
      const incHeader = document.createElement('div');
      incHeader.className = 'expanded-subheader';
      incHeader.textContent = 'Speech includes (overrides for this session)';
      return incHeader;
    }

    _buildIncludesGrid(shortId, entry) {
      const incGrid = document.createElement('div');
      incGrid.className = 'tri-grid';
      const sessionInc = entry.speech_includes || {};
      for (const [key, label] of this._includeLabels) {
        incGrid.appendChild(this._buildIncludesCell(shortId, key, label, sessionInc));
      }
      return incGrid;
    }

    _buildIncludesCell(shortId, key, label, sessionInc) {
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
        { val: false, label: 'Off',    cls: 'off' },
      ];
      const current = key in sessionInc ? sessionInc[key] : null;
      for (const s of states) {
        const btn = document.createElement('button');
        btn.className = `tri-btn ${s.cls}` + (current === s.val ? ' active' : '');
        btn.textContent = s.label;
        btn.addEventListener('click', async () => {
          await this._onSetInclude(shortId, key, s.val);
          const assignments = this.state.sessionAssignments;
          if (!assignments[shortId].speech_includes) assignments[shortId].speech_includes = {};
          if (s.val === null) delete assignments[shortId].speech_includes[key];
          else assignments[shortId].speech_includes[key] = s.val;
          this._renderNow();
        });
        ctrl.appendChild(btn);
      }
      cell.appendChild(ctrl);
      return cell;
    }
  }

  return { SessionsTable };
}));
