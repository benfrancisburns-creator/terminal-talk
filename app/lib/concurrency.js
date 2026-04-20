'use strict';

/**
 * Run async `task(item, index)` for every item with at most `limit`
 * tasks in flight at once. Resolves to an Array<Result> whose indices
 * line up with the input -- NOT completion order -- so callers can
 * still reason about source position after a parallel run.
 *
 * `task` may return a value or throw. Throws become Error objects in
 * the output array; callers should filter or check instanceof Error.
 *
 * Used by speakClipboard to parallelise edge-tts synth across the
 * chunks of a big paste while still respecting a concurrency budget
 * (Microsoft Edge TTS can 429 under truly unbounded fan-out).
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit   max concurrent tasks (>= 1)
 * @param {(item: T, index: number) => Promise<R>} task
 * @returns {Promise<Array<R | Error>>} positional results
 */
async function mapLimit(items, limit, task) {
  const arr = Array.isArray(items) ? items : [];
  const cap = Math.max(1, Math.floor(Number(limit) || 1));
  const out = new Array(arr.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= arr.length) return;
      try {
        out[i] = await task(arr[i], i);
      } catch (e) {
        out[i] = e instanceof Error ? e : new Error(String(e));
      }
    }
  }

  const workers = [];
  for (let w = 0; w < Math.min(cap, arr.length); w++) workers.push(worker());
  await Promise.all(workers);
  return out;
}

module.exports = { mapLimit };
