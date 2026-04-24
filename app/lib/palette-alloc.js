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
  // Defensive clamp — paletteSize is 24 in every production call site,
  // but a bad caller (test harness, future refactor, corrupted config)
  // passing 0 or negative would make the hash-mod fallback `x % 0 = NaN`
  // and the renderer would read `index: NaN`, painting nothing and
  // breaking the palette class CSS lookup. Audit 2026-04-23 Phase 4
  // Module 2 caught this via a paletteSize=0 probe.
  const size = (!Number.isFinite(paletteSize) || paletteSize < 1) ? 24 : paletteSize;
  const entries = Object.entries(assignments || {});
  const busy = new Map();  // index -> shortId
  for (const [short, entry] of entries) {
    if (entry && Number.isFinite(Number(entry.index))) {
      busy.set(Number(entry.index), short);
    }
  }

  // 1. Lowest free index wins.
  for (let i = 0; i < size; i++) {
    if (!busy.has(i)) return { index: i, evicted: null, reason: 'free' };
  }

  // 2. All slots busy -> LRU eviction among entries with NO user intent.
  //    An entry is protected from eviction if pinned OR has a label /
  //    voice / muted / focus / speech_includes override — any of those
  //    signals "I configured this, don't throw it away for a fresh
  //    session." Eviction order within the candidate pool is
  //    last_seen ascending, then shortId ascending (stable tiebreak).
  const hasUserIntent = (e) => (
    (e.label && String(e.label).trim().length > 0) ||
    !!e.voice ||
    e.muted === true ||
    e.focus === true ||
    (e.speech_includes && Object.keys(e.speech_includes).length > 0)
  );
  const candidates = entries
    .filter(([, e]) => e && e.pinned !== true && !hasUserIntent(e))
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
    index: sum % size,
    evicted: null,
    reason: 'hash-collision'
  };
}

module.exports = { allocatePaletteIndex };
