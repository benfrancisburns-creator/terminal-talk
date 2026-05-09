// EX7b — first concrete component extracted from app/renderer.js
// during the v0.4 renderer refactor. Polls main's get-stale-sessions
// IPC every intervalMs, compares the result to the previous set, and
// fires onChange only when the set actually changes.
//
// Purpose: closing a terminal didn't visibly update the UI — this
// ensures the row greys out within intervalMs of the PID going away.
// Cheap IPC; no renders if nothing changed.
//
// Owns the staleSessionShorts Set that used to live as renderer.js
// module state. Consumers read via has(shortId) / getAll() instead
// of touching the Set directly.
//
// UMD-lite + extends the Component base so start()/stop() guarantee
// setInterval and setTimeout handles are cleared on teardown. This
// was a latent leak: re-initialising the renderer (EX3 reload-renderer)
// would orphan the previous interval if it hadn't been explicitly
// cleared.

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
    root.TT_STALE_SESSION_POLLER = api.StaleSessionPoller;
  }
}(typeof self !== 'undefined' ? self : this, function (componentModule) {
  'use strict';

  const { Component } = componentModule;

  class StaleSessionPoller extends Component {
    constructor(deps = {}) {
      super(deps);
      const {
        api,
        intervalMs = 10_000,
        initialDelayMs = 500,
        onChange = null,
      } = deps;
      this._api = api;
      this._intervalMs = intervalMs;
      this._initialDelayMs = initialDelayMs;
      this._onChange = onChange;
      this._stale = new Set();
    }

    _onMount() {
      // Run once on boot so first paint isn't stuck at "all alive", then
      // settle into the regular interval. Both timers are registered
      // through the Component helpers so unmount() clears them together.
      this._setTimeout(() => this._pollOnce(), this._initialDelayMs);
      this._setInterval(() => this._pollOnce(), this._intervalMs);
    }

    has(shortId) {
      return this._stale.has(shortId);
    }

    // Returns a snapshot, not a reference, so consumers can't mutate
    // the poller's internal state accidentally.
    getAll() {
      return new Set(this._stale);
    }

    // Split out so tests can drive state updates synchronously without
    // waiting on the IPC promise.
    _applyResult(raw) {
      const next = new Set(Array.isArray(raw) ? raw : []);
      let changed = next.size !== this._stale.size;
      if (!changed) {
        for (const s of next) if (!this._stale.has(s)) { changed = true; break; }
      }
      if (!changed) return false;
      this._stale = next;
      if (typeof this._onChange === 'function') {
        try { this._onChange(this.getAll()); } catch {}
      }
      return true;
    }

    async _pollOnce() {
      try {
        this._applyResult(await this._api.getStaleSessions());
      } catch {}
    }
  }

  return { StaleSessionPoller };
}));
