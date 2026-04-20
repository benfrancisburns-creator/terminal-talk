'use strict';

/**
 * Palette allocator — picks a palette index for a new session.
 *
 * Strategy (in order):
 *   1. Lowest free index in 0..paletteSize-1.
 *   2. If none free: LRU eviction — drop the non-pinned entry with
 *      the oldest `last_seen` and hand the new session that slot.
 *      The caller is responsible for deleting the evicted entry from
 *      its registry (we return its shortId so the caller can do so).
 *   3. If every slot is pinned (user pinned all 24 colours — rare),
 *      fall back to hash-mod so the new session still gets a colour,
 *      accepting that this means a visual collision with one of the
 *      pinned entries.
 *
 * Pure / side-effect-free so the unit tests can drive every branch.
 *
 * @param {string} newShort  8-char session shortId requesting a slot
 * @param {Record<string, any>} assignments  existing registry
 * @param {number} paletteSize  default 24
 * @returns {{
 *   index: number,
 *   evicted: string|null,  // shortId caller should delete, or null
 *   reason: 'free'|'lru'|'hash-collision'
 * }}
 */
function allocatePaletteIndex(newShort, assignments, paletteSize = 24) {
  const entries = Object.entries(assignments || {});
  const busy = new Map();  // index -> shortId
  for (const [short, entry] of entries) {
    if (entry && Number.isFinite(Number(entry.index))) {
      busy.set(Number(entry.index), short);
    }
  }

  // 1. Lowest free index wins.
  for (let i = 0; i < paletteSize; i++) {
    if (!busy.has(i)) return { index: i, evicted: null, reason: 'free' };
  }

  // 2. All slots busy -> LRU eviction among non-pinned entries.
  //    Order by last_seen ascending, then shortId ascending as a
  //    deterministic tiebreak (so tests are stable).
  const candidates = entries
    .filter(([, e]) => e && e.pinned !== true)
    .sort((a, b) => {
      const aLast = Number(a[1].last_seen) || 0;
      const bLast = Number(b[1].last_seen) || 0;
      if (aLast !== bLast) return aLast - bLast;
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });

  if (candidates.length > 0) {
    const [evictedShort, evictedEntry] = candidates[0];
    return {
      index: Number(evictedEntry.index),
      evicted: evictedShort,
      reason: 'lru'
    };
  }

  // 3. Every slot is pinned. Hash-mod fallback — guaranteed collision,
  //    but the alternative is "refuse to show this session at all".
  let sum = 0;
  for (const ch of String(newShort || '')) sum += ch.charCodeAt(0);
  return {
    index: sum % paletteSize,
    evicted: null,
    reason: 'hash-collision'
  };
}

module.exports = { allocatePaletteIndex };
