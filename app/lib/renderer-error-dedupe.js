// Rate-limit renderer-error reports by stack-hash to keep one exception
// loop from flooding _toolbar.log. Stateful; kept in its own module so the
// unit harness can exercise it without pulling main.js's Electron deps.
//
// Dedupe key = first 4 lines of the stack (enough to identify the throw
// site, short enough that variant argv/this don't cause drift). If the
// same stack fires twice within RENDERER_ERROR_DEDUPE_MS we drop the
// duplicate; the Map is pruned at 128 entries by evicting the oldest so
// permanently-novel stacks can't grow it unbounded.

const RENDERER_ERROR_DEDUPE_MS = 1000;
const MAX_ENTRIES = 128;

function createDedupe({ windowMs = RENDERER_ERROR_DEDUPE_MS, maxEntries = MAX_ENTRIES } = {}) {
  const lastSeen = new Map();

  function accept(stackOrMessage, now) {
    const key = String(stackOrMessage || '').split('\n').slice(0, 4).join('|');
    const prev = lastSeen.get(key);
    if (prev !== undefined && (now - prev) < windowMs) return false;
    lastSeen.set(key, now);
    if (lastSeen.size > maxEntries) {
      let oldestKey = null, oldestAt = Infinity;
      for (const [k, v] of lastSeen) {
        if (v < oldestAt) { oldestAt = v; oldestKey = k; }
      }
      if (oldestKey !== null) lastSeen.delete(oldestKey);
    }
    return true;
  }

  return { accept, _lastSeen: lastSeen };
}

module.exports = { createDedupe };
