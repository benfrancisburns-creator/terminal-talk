'use strict';

/**
 * Pure stale-session detection.
 *
 * Given the session-colours registry and the set of "currently live"
 * shortIds (derived from sessions/ JSON files whose PIDs are still
 * alive), return the list of shortIds whose backing terminal is gone.
 *
 * Rules:
 *   - Pinned sessions are NEVER stale — user explicitly asked to keep
 *     that swatch, even if the terminal is closed.
 *   - A session is stale if NO live source vouches for it:
 *       * its short is NOT in `liveShorts` (no live sessions/ file),
 *       * AND its claude_pid (if set) is not in `livePids`.
 *   - `graceSec` lets a just-exited terminal re-register (e.g. during
 *     a reload) before the row greys out. Default 10 s.
 *
 * Kept side-effect-free so the unit tests can drive it without
 * electron / fs / process.kill.
 *
 * @param {Record<string, any>} assignments  session-colours registry
 * @param {Set<string>}         liveShorts   shortIds currently live
 * @param {Set<number>}         livePids     PIDs currently alive
 * @param {number}              nowSec       Math.floor(Date.now()/1000)
 * @param {number}              graceSec     seconds since last_seen that
 *                                           still count as "alive"
 * @returns {string[]} sorted list of stale shortIds
 */
function computeStaleSessions(assignments, liveShorts, livePids, nowSec, graceSec = 10) {
  const stale = [];
  if (!assignments || typeof assignments !== 'object') return stale;
  const shorts = liveShorts instanceof Set ? liveShorts : new Set(liveShorts || []);
  const pids = livePids instanceof Set ? livePids : new Set(livePids || []);

  for (const [short, entry] of Object.entries(assignments)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.pinned) continue;
    if (shorts.has(short)) continue;
    if (entry.claude_pid && pids.has(entry.claude_pid)) continue;
    if (entry.last_seen && (nowSec - entry.last_seen) < graceSec) continue;
    stale.push(short);
  }
  return stale.sort((a, b) => a.localeCompare(b));
}

module.exports = { computeStaleSessions };
