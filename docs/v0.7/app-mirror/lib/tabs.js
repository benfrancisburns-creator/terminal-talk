// Tabs component — a compact top strip for sessions that matter right now:
// live assistant sessions plus any session that still has clips on disk.
// Clicking a tab filters the dot-strip to that session's clips. Clicking
// [All] clears the filter.
//
// Unread count is derived, not stored: for each tab, count the clips in
// that session whose path is not yet in the heardPaths Set. Playback and
// the heardPaths Set are the single source of truth — no last-viewed
// timestamps, no drift possible. Five clips arrive, two play → unread
// reads as three. Bound to be correct by construction.
//
// State shape:
//   { queue, allPaths, heardPaths, sessionAssignments, selectedTab }
//     selectedTab — 'all' | <shortId>
//
// UMD-lite so the same file loads from Node (unit tests) and from the
// renderer's <script> tag. Matches app/lib/component.js + dot-strip.js.

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
    root.TT_TABS = api.Tabs;
  }
}(typeof self !== 'undefined' ? self : this, function (componentModule) {
  'use strict';

  const { Component } = componentModule;
  const DEFAULT_STALE_MS = 30 * 60 * 1000;
  const DEFAULT_MAX_LABEL_CHARS = 10;

  function truncateLabel(label, maxChars) {
    if (!label) return '';
    if (label.length <= maxChars) return label;
    return label.slice(0, Math.max(1, maxChars - 1)) + '…';
  }

  // Pure: compute unread count for a session (or 'all') from the single
  // source of truth: full on-disk path list + heardPaths. Accepts either
  // a path-string list (preferred, uncapped, comes from main.js's
  // allPaths) or a {path} object list (fallback when pre-allPaths
  // main is running). The uncapped path list is the only way the badge
  // stays accurate past MAX_FILES — otherwise deletion "refills" the
  // visible 20 and the user sees no progress.
  function unreadCount(pathsOrFiles, heardPaths, clipPaths, shortId) {
    let n = 0;
    for (const item of pathsOrFiles) {
      const p = typeof item === 'string' ? item : item && item.path;
      if (!p) continue;
      if (heardPaths.has(p)) continue;
      if (shortId === 'all') { n++; continue; }
      const fname = p.split(/[\\/]/).pop();
      const short = clipPaths.extractSessionShort(fname);
      if (short === shortId) n++;
    }
    return n;
  }

  function collectClipSessionShorts(pathsOrFiles, clipPaths) {
    const shorts = new Set();
    for (const item of pathsOrFiles || []) {
      const p = typeof item === 'string' ? item : item && item.path;
      if (!p) continue;
      const fname = p.split(/[\\/]/).pop();
      const short = clipPaths.extractSessionShort(fname);
      if (short) shorts.add(short);
    }
    return shorts;
  }

  // Pure: derive the active/stale split from sessionAssignments + now.
  // Active = last_seen within staleMs of now. Stale here means "not
  // currently live, but still relevant because at least one clip remains
  // on disk". Registry-only stale sessions stay out of the top strip and
  // remain available in Settings > Sessions.
  function partitionSessions(sessionAssignments, pathsOrFiles, clipPaths, now, staleMs) {
    const clipShorts = collectClipSessionShorts(pathsOrFiles, clipPaths);
    const active = [];
    const stale = [];

    for (const [short, entry] of Object.entries(sessionAssignments || {})) {
      const lastSeen = entry && entry.last_seen ? entry.last_seen * 1000 : 0;
      const isFresh = lastSeen && (now - lastSeen) < staleMs;
      if (isFresh) active.push(short);
    }

    const activeSet = new Set(active);
    for (const short of clipShorts) {
      if (!activeSet.has(short)) stale.push(short);
    }

    // Deterministic ordering: sort by last_seen desc (most recent first),
    // fallback to lexical on the shortId so the row is stable frame-to-frame.
    const byLastSeenDesc = (a, b) => {
      const la = (sessionAssignments[a] && sessionAssignments[a].last_seen) || 0;
      const lb = (sessionAssignments[b] && sessionAssignments[b].last_seen) || 0;
      if (lb !== la) return lb - la;
      return a.localeCompare(b);
    };
    active.sort(byLastSeenDesc);
    stale.sort(byLastSeenDesc);
    return { active, stale };
  }

  class Tabs extends Component {
    constructor(deps = {}) {
      super(deps);
      const {
        clipPaths,
        staleSessionPoller,
        paletteSize = 24,
        maxLabelChars = DEFAULT_MAX_LABEL_CHARS,
        staleCollapseMs = DEFAULT_STALE_MS,
        onTabSelect = null,
        onExpandChange = null,
        nowProvider = () => Date.now(),
      } = deps;
      this._clipPaths = clipPaths;
      this._staleSessionPoller = staleSessionPoller;
      this._paletteSize = paletteSize;
      this._maxLabelChars = maxLabelChars;
      this._staleCollapseMs = staleCollapseMs;
      this._onTabSelect = onTabSelect;
      this._onExpandChange = onExpandChange;
      this._nowProvider = nowProvider;
      this._pendingRaf = null;
      this.state = {
        queue: [],
        // Uncapped on-disk path list shipped by main.js alongside the
        // capped `files` array. Drives unread counts so badges are
        // honest past MAX_FILES. Falls back to queue paths if main
        // didn't send one (pre-2026-04-23 builds).
        allPaths: [],
        heardPaths: new Set(),
        sessionAssignments: {},
        selectedTab: 'all',
      };
    }

    _onUpdate() {
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
      if (this.root) this.root.innerHTML = '';
    }

    renderNow() { this._renderNow(); }

    _renderNow() {
      if (!this.root) return;
      const { queue, allPaths, heardPaths, sessionAssignments, selectedTab } = this.state;
      const now = this._nowProvider();
      const pathsForCount = (Array.isArray(allPaths) && allPaths.length > 0) ? allPaths : queue;
      const { active, stale } = partitionSessions(
        sessionAssignments, pathsForCount, this._clipPaths, now, this._staleCollapseMs,
      );

      // Prefer the uncapped on-disk path list for unread accounting;
      // fall back to queue (capped at MAX_FILES) when main hasn't
      // emitted allPaths. Either way, unreadCount normalises both
      // shapes so the per-tab badges stay honest.
      this.root.innerHTML = '';

      // [All N] tab — always leftmost. Count is total unread clips.
      const allCount = unreadCount(pathsForCount, heardPaths, this._clipPaths, 'all');
      this.root.appendChild(this._buildTab({
        id: 'all',
        label: 'All',
        count: allCount,
        selected: selectedTab === 'all',
        paletteKey: null,
        stale: false,
      }));

      // Active session tabs.
      for (const short of active) {
        const entry = sessionAssignments[short] || {};
        const fullLabel = entry.label && entry.label.trim() ? entry.label.trim() : short.slice(0, 6);
        this.root.appendChild(this._buildTab({
          id: short,
          label: truncateLabel(fullLabel, this._maxLabelChars),
          fullLabel,
          count: unreadCount(pathsForCount, heardPaths, this._clipPaths, short),
          selected: selectedTab === short,
          paletteKey: this._clipPaths.paletteKeyForShort(short, sessionAssignments, this._paletteSize),
          stale: false,
        }));
      }

      // Clip-backed inactive sessions stay visible so the user can filter
      // to unplayed/backlog audio without opening Settings.
      for (const short of stale) {
        const entry = sessionAssignments[short] || {};
        const fullLabel = entry.label && entry.label.trim() ? entry.label.trim() : short.slice(0, 6);
        this.root.appendChild(this._buildTab({
          id: short,
          label: truncateLabel(fullLabel, this._maxLabelChars),
          fullLabel,
          count: unreadCount(pathsForCount, heardPaths, this._clipPaths, short),
          selected: selectedTab === short,
          paletteKey: this._clipPaths.paletteKeyForShort(short, sessionAssignments, this._paletteSize),
          stale: true,
        }));
      }
    }

    _buildTab({ id, label, fullLabel, count, selected, paletteKey, stale }) {
      const tab = document.createElement('button');
      tab.className = 'tab';
      tab.type = 'button';
      tab.dataset.tabId = id;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      if (selected) tab.classList.add('selected');
      if (stale) tab.classList.add('stale');
      // NOTE: no data-palette on the tab itself — palette-classes.css uses
      // the bare `[data-palette="NN"] { background: ... }` attribute
      // selector, which would paint the whole tab in the session colour
      // and defeat the black-chip / coloured-dot design. Only the inner
      // .tab-dot carries the palette attribute.

      // Content: optional colour dot + label + optional count badge.
      if (paletteKey) {
        const dot = document.createElement('span');
        dot.className = 'tab-dot';
        dot.dataset.palette = paletteKey;
        dot.setAttribute('aria-hidden', 'true');
        tab.appendChild(dot);
      }

      const labelSpan = document.createElement('span');
      labelSpan.className = 'tab-label';
      labelSpan.textContent = label;
      tab.appendChild(labelSpan);

      if (count > 0) {
        const badge = document.createElement('span');
        badge.className = 'tab-badge';
        badge.setAttribute('aria-label', `${count} unread`);
        badge.textContent = String(count);
        tab.appendChild(badge);
      }

      const titleBase = fullLabel && fullLabel !== label ? fullLabel : label;
      tab.title = count > 0
        ? `${titleBase} — ${count} unplayed`
        : titleBase;

      tab.addEventListener('click', () => {
        if (this._onTabSelect) this._onTabSelect(id);
      });

      return tab;
    }
  }

  return { Tabs, _internals: { unreadCount, partitionSessions, truncateLabel, collectClipSessionShorts } };
}));
