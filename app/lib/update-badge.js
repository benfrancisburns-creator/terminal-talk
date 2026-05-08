'use strict';

// Phase 8 (#32) renderer-side glue for the in-app update notifier.
// Lives in lib/ so renderer.js stays under the 2725-line ceiling.
//
// Wires window.api.onUpdateAvailable → toggles `.has-update` on the
// gear-icon button + updates its title attribute. Defensive against
// missing api / button to keep the renderer resilient under demo /
// settings-window modes where the gear isn't mounted.

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.TT_UPDATE_BADGE = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function applyUpdateBadge(buttonEl, info) {
    if (!buttonEl) return;
    const count = (info && Number(info.count)) || 0;
    if (count > 0) {
      buttonEl.classList.add('has-update');
      const subj = info && info.subject ? `: ${info.subject}` : '';
      buttonEl.title = `Settings — ${count} commit${count === 1 ? '' : 's'} available${subj}`;
    } else {
      buttonEl.classList.remove('has-update');
      buttonEl.title = 'Settings';
    }
  }

  function wireUpdateBadge({ api, buttonEl }) {
    if (!api || typeof api.onUpdateAvailable !== 'function' || !buttonEl) return;
    api.onUpdateAvailable((info) => {
      try { applyUpdateBadge(buttonEl, info); } catch {}
    });
  }

  return { wireUpdateBadge, applyUpdateBadge };
}));
