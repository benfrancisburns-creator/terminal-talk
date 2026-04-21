// EX7b — component base for the renderer refactor. Provides a
// uniform lifecycle (mount -> update -> unmount) plus a teardown
// registry so event listeners, intervals, timeouts, and
// requestAnimationFrame handles can't leak across re-mounts.
//
// Shape:
//   class Foo extends Component {
//     _onMount() { this._on(this.root, 'click', () => ...); }
//     _onUpdate() { this.root.textContent = this.state.label; }
//     _onUnmount() { /* optional extra cleanup */ }
//   }
//   const foo = new Foo(deps);
//   foo.mount(rootEl);
//   foo.update({ label: 'hi' });
//   foo.unmount();   // removes all listeners + timers + DOM
//
// Services without a DOM root just omit the mount argument (or pass
// null) and use start()/stop() as aliases for mount()/unmount(). All
// the teardown helpers still work — that's the point: a StaleSessionPoller
// that registers its setInterval via this._setInterval can never leave
// an orphan timer behind.
//
// UMD-lite pattern mirrors app/lib/clip-paths.js so the same file loads
// from Node (unit tests) and from the renderer's <script> tag.

(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TT_COMPONENT = api.Component;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class Component {
    constructor(deps = {}) {
      this.deps = deps;
      this.root = null;
      this.state = null;
      this._teardown = [];
      this._mounted = false;
    }

    mount(root) {
      if (this._mounted) return this;
      this.root = root || null;
      this._mounted = true;
      if (typeof this._onMount === 'function') this._onMount();
      return this;
    }

    // Alias: reads better for components that feel like services.
    start() { return this.mount(); }

    update(state) {
      this.state = state;
      if (typeof this._onUpdate === 'function') this._onUpdate();
      return this;
    }

    unmount() {
      if (!this._mounted) return this;
      this._mounted = false;
      if (typeof this._onUnmount === 'function') {
        try { this._onUnmount(); } catch {}
      }
      // Iterate LIFO so later-registered teardowns (usually more specific)
      // run before earlier ones (broader wiring). Swallow individual
      // failures so one broken teardown doesn't strand the rest.
      while (this._teardown.length) {
        const fn = this._teardown.pop();
        try { fn(); } catch {}
      }
      this.root = null;
      return this;
    }

    stop() { return this.unmount(); }
    dispose() { return this.unmount(); }

    isMounted() { return this._mounted; }

    // Teardown-registering helpers. Use these inside _onMount or event
    // callbacks so unmount() tears everything down automatically.
    _addTeardown(fn) {
      if (typeof fn !== 'function') return fn;
      this._teardown.push(fn);
      return fn;
    }

    _on(target, event, fn, opts) {
      target.addEventListener(event, fn, opts);
      this._addTeardown(() => target.removeEventListener(event, fn, opts));
      return fn;
    }

    _setInterval(fn, ms) {
      const id = setInterval(fn, ms);
      this._addTeardown(() => clearInterval(id));
      return id;
    }

    _setTimeout(fn, ms) {
      const id = setTimeout(fn, ms);
      this._addTeardown(() => clearTimeout(id));
      return id;
    }

    _requestAnimationFrame(fn) {
      const id = requestAnimationFrame(fn);
      this._addTeardown(() => cancelAnimationFrame(id));
      return id;
    }
  }

  return { Component };
}));
