'use strict';

/**
 * Exponential backoff with jitter + cap.
 *
 * Returns the delay in ms for retry attempt `count` (1-based).
 *   count = 1 -> base ± jitter
 *   count = 2 -> base*2 ± jitter
 *   ...capped at `maxMs`.
 *
 * Kept side-effect-free EXCEPT for reading rng() so callers can
 * inject a deterministic rng in tests. Defaults to Math.random.
 *
 * @param {number} count        retry attempt index, 1-based
 * @param {number} baseMs       first-attempt base delay
 * @param {number} maxMs        hard cap
 * @param {number} jitterMs     max random bonus in ms (default 500)
 * @param {() => number} rng    unit-interval rng (default Math.random)
 * @returns {number} delay in ms
 */
function exponentialBackoff(count, baseMs, maxMs, jitterMs = 500, rng = Math.random) {
  const n = Math.max(0, Number(count) | 0);
  const exponent = n > 0 ? n - 1 : 0;
  const raw = baseMs * Math.pow(2, exponent);
  const capped = Math.min(raw, maxMs);
  const jitter = Math.floor((rng() || 0) * jitterMs);
  return capped + jitter;
}

module.exports = { exponentialBackoff };
