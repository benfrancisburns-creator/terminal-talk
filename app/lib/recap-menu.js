// Session recap chooser (2026-10-05) — the compact "Catch up" popover a
// tab's recap control opens. Lets the user replay the last N clips or the
// last M minutes of a session (or of every session from [All]) without
// sending a new prompt.
//
// Why a popover inside #bar: the bar is `position: relative; overflow:
// hidden` and the click-through region main.js honours is the bar rect, so
// anything rendered outside it would be clipped and unclickable. The menu
// is absolutely positioned under the tab that opened it, laid over the dot
// strip, and clamped to the bar width. Continuous px values go through the
// renderer's Constructable-Stylesheet helper (setDynamicStyle) — the CSP
// has no 'unsafe-inline' for styles.
//
// No text inputs: the toolbar deliberately never takes keyboard focus away
// from the user's terminal, so the choices are preset chips. Esc / outside
// click / bar collapse close it.
//
// UMD-lite like the other app/lib/*.js components: Node unit tests
// require() it, index.html loads it via <script> before renderer.js.

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
    root.TT_RECAP_MENU = api;
  }
}(typeof self !== 'undefined' ? self : this, function (componentModule) {
  'use strict';

  const { Component } = componentModule;

  const MENU_ID = 'recapMenu';
  const CLIP_PRESETS = [5, 10, 20, 'all'];
  const MINUTE_PRESETS = [2, 5, 10, 30];
  const EDGE_PAD = 8;

  function fmtClock(sec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  class RecapMenu extends Component {
    constructor(deps = {}) {
      super(deps);
      const {
        containerEl,                 // #bar — the menu is appended here
        setDynamicStyle = () => {},  // renderer's adopted-stylesheet writer
        onPick = () => {},           // ({ short, mode, value }) => void
        onClose = () => {},
        fmtDuration = fmtClock,
      } = deps;
      this._containerEl = containerEl;
      this._setDynamicStyle = setDynamicStyle;
      this._onPick = onPick;
      this._onClose = onClose;
      this._fmtDuration = fmtDuration;
      this._el = null;
      this._anchorEl = null;
      // Anchor geometry captured at open(): the tabs row rebuilds its chips
      // on every queue update, so the anchor element may be detached by
      // the time the summary arrives. Positioning from the stored rect
      // keeps the popover where the user clicked.
      this._anchorBox = null;
      this._short = null;
      this._openToken = 0;
      this._docMousedown = null;
      this._docKeydown = null;
    }

    isOpen() { return !!this._el; }
    currentShort() { return this._short; }

    // open({ short, label, anchorEl, summary }) — `summary` is the
    // get-recap-summary result or a Promise of it (the chooser renders a
    // "counting…" state until it lands, so the click feels instant).
    open({ short, label, anchorEl, summary } = {}) {
      if (!this._containerEl || typeof document === 'undefined') return false;
      // Toggle: clicking the same tab's control again closes the menu.
      if (this._el && this._short === short) { this.close(); return false; }
      this.close();
      this._short = short;
      this._anchorEl = anchorEl || null;
      this._anchorBox = this._measureAnchor(anchorEl);
      const token = ++this._openToken;

      const el = document.createElement('div');
      el.id = MENU_ID;
      el.className = 'recap-menu';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', `Catch up on ${label || short}`);
      this._el = el;
      this._render({ label: label || short, summary: null, loading: true });
      this._containerEl.appendChild(el);
      this._position();
      this._wireDismiss();

      Promise.resolve(summary)
        .then((s) => {
          if (token !== this._openToken || this._el !== el) return;
          this._render({ label: label || short, summary: s || null, loading: false });
          this._position();
        })
        .catch(() => {
          if (token !== this._openToken || this._el !== el) return;
          this._render({ label: label || short, summary: null, loading: false });
          this._position();
        });
      return true;
    }

    close() {
      this._unwireDismiss();
      if (this._el) {
        try { this._el.remove(); } catch {}
        this._setDynamicStyle(`#${MENU_ID}`, null);
      }
      const wasOpen = !!this._el;
      this._el = null;
      this._anchorEl = null;
      this._anchorBox = null;
      this._short = null;
      if (wasOpen) { try { this._onClose(); } catch {} }
    }

    _onUnmount() { this.close(); }

    // ---- rendering ----------------------------------------------------

    _render({ label, summary, loading }) {
      const el = this._el;
      if (!el) return;
      el.innerHTML = '';
      const count = summary && Number.isFinite(summary.count) ? summary.count : 0;
      const totalSec = summary && Number.isFinite(summary.totalSec) ? summary.totalSec : 0;
      const enabled = !summary || summary.enabled !== false;
      const maxClips = summary && Number.isFinite(summary.maxClips) && summary.maxClips > 0 ? summary.maxClips : 40;

      const head = document.createElement('div');
      head.className = 'recap-menu-head';
      const title = document.createElement('span');
      title.className = 'recap-menu-title';
      title.textContent = `Catch up · ${label}`;
      head.appendChild(title);
      const sum = document.createElement('span');
      sum.className = 'recap-menu-summary';
      if (loading) sum.textContent = 'counting…';
      else if (!enabled) sum.textContent = 'recap history is off (Settings › Playback)';
      else if (count === 0) sum.textContent = 'nothing kept yet';
      else sum.textContent = `${count} clip${count === 1 ? '' : 's'} · ≈ ${this._fmtDuration(totalSec)} kept`;
      head.appendChild(sum);
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'recap-menu-close';
      close.setAttribute('aria-label', 'Close catch-up chooser');
      close.textContent = '×';
      close.addEventListener('click', (ev) => { ev.stopPropagation(); this.close(); });
      head.appendChild(close);
      el.appendChild(head);

      const rows = document.createElement('div');
      rows.className = 'recap-menu-rows';
      const canPick = !loading && enabled && count > 0;

      rows.appendChild(this._buildRow('Last clips', CLIP_PRESETS.map((n) => ({
        label: n === 'all' ? 'All' : String(n),
        title: n === 'all'
          ? `Replay every kept clip (up to ${Math.min(count || maxClips, maxClips)})`
          : `Replay the last ${n} clip${n === 1 ? '' : 's'}`,
        disabled: !canPick || (n !== 'all' && count < 1),
        pick: { short: this._short, mode: 'count', value: n === 'all' ? maxClips : n },
      }))));
      rows.appendChild(this._buildRow('Last minutes', MINUTE_PRESETS.map((n) => ({
        label: String(n),
        title: `Replay the last ${n} minute${n === 1 ? '' : 's'} of audio`,
        disabled: !canPick,
        pick: { short: this._short, mode: 'minutes', value: n },
      }))));
      el.appendChild(rows);
    }

    _buildRow(labelText, chips) {
      const row = document.createElement('div');
      row.className = 'recap-menu-row';
      const label = document.createElement('span');
      label.className = 'recap-menu-label';
      label.textContent = labelText;
      row.appendChild(label);
      for (const chip of chips) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'recap-chip';
        btn.textContent = chip.label;
        btn.title = chip.title;
        btn.disabled = !!chip.disabled;
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (btn.disabled) return;
          const pick = chip.pick;
          this.close();
          try { this._onPick(pick); } catch {}
        });
        row.appendChild(btn);
      }
      return row;
    }

    // Anchor geometry relative to the bar, captured once at open().
    _measureAnchor(anchorEl) {
      const container = this._containerEl;
      if (!anchorEl || typeof anchorEl.getBoundingClientRect !== 'function') return null;
      const barRect = container && typeof container.getBoundingClientRect === 'function'
        ? container.getBoundingClientRect() : { left: 0, top: 0, width: 680 };
      const a = anchorEl.getBoundingClientRect();
      return {
        left: a.left - barRect.left,
        bottom: a.bottom - barRect.top,
        barWidth: barRect.width || 680,
      };
    }

    // Anchor under the tab, clamp inside the bar. Measured after the menu
    // is in the DOM so its own width is known.
    _position() {
      const el = this._el;
      if (!el || typeof el.getBoundingClientRect !== 'function') return;
      const box = this._anchorBox;
      const menuRect = el.getBoundingClientRect();
      const menuW = menuRect.width || 320;
      const barWidth = box ? box.barWidth : 680;
      let left = box ? box.left : EDGE_PAD;
      const maxLeft = Math.max(EDGE_PAD, barWidth - menuW - EDGE_PAD);
      left = Math.max(EDGE_PAD, Math.min(maxLeft, left));
      const top = box ? box.bottom + 4 : 44;
      this._setDynamicStyle(`#${MENU_ID}`, `left: ${Math.round(left)}px; top: ${Math.round(top)}px;`);
    }

    // ---- dismissal ----------------------------------------------------

    _wireDismiss() {
      if (typeof document === 'undefined') return;
      this._docMousedown = (ev) => {
        const t = ev && ev.target;
        if (!this._el || !t) return;
        if (this._el.contains && this._el.contains(t)) return;
        // Clicks on any tab's recap control are handled by that control
        // (same tab toggles, another tab re-anchors) — don't close first.
        if (t.closest && t.closest('.tab-recap')) return;
        this.close();
      };
      this._docKeydown = (ev) => {
        if (ev && ev.key === 'Escape') this.close();
      };
      document.addEventListener('mousedown', this._docMousedown, true);
      document.addEventListener('keydown', this._docKeydown, true);
    }

    _unwireDismiss() {
      if (typeof document === 'undefined') return;
      if (this._docMousedown) document.removeEventListener('mousedown', this._docMousedown, true);
      if (this._docKeydown) document.removeEventListener('keydown', this._docKeydown, true);
      this._docMousedown = null;
      this._docKeydown = null;
    }
  }

  return { RecapMenu, CLIP_PRESETS, MINUTE_PRESETS, fmtClock };
}));
