'use strict';

// EX6d — extracted from app/main.js as part of the v0.4 big-file
// refactor. Periodic housekeeping sweep that prunes stale audio
// files + session records and clears orphan voice listeners.
//
// Design: factory pattern with INJECTED sweep functions. The sweeps
// themselves (pruneOldFiles, pruneSessionsDir, killOrphanVoiceListeners)
// still live in main.js because they touch the rest of main's state;
// this module is just the scheduler + stats-logging orchestrator.
//
// Behaviour preserved byte-for-byte: per-sweep before/after count
// diff, interval-based rearm, one log line per sweep including
// durations + any errors.

const fs = require('node:fs');

function createWatchdog({
  intervalMs,
  logPath,
  sweeps = [],           // Array<{ name, dir, predicate, fn, statKey }>
  postSweepFns = [],     // Array<{ name, fn }>  — run after numbered sweeps, no count diff
  // #6 G6 — optional resource-metrics gatherer. Returns a flat object
  // of `key=value` pairs to append to the per-sweep log line. Caller
  // owns what to measure (RSS, queue file count, registry size, etc.).
  // Errors are swallowed so a flaky measurement never crashes the
  // watchdog itself. Returning null/empty disables the suffix.
  getResourceMetrics = null,
  now = () => Date.now(),
  readdir = (dir) => fs.readdirSync(dir),
  logWriter = (line) => { try { fs.appendFileSync(logPath, line); } catch {} },
}) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('createWatchdog: intervalMs must be a positive number');
  }
  if (!logPath) throw new Error('createWatchdog: logPath required');

  let timer = null;
  let lastSweepMs = 0;

  function countFiles(dir, predicate) {
    try {
      // Wrap predicate so filter doesn't pass it (element, index, array).
      // Sonar S7727: direct-pass predicates may intercept the unused args
      // and change behaviour. Explicit single-arg wrap is the safe shape.
      return readdir(dir).filter((f) => predicate(f)).length;
    } catch { return 0; }
  }

  function runSweep() {
    const t0 = now();
    const stats = {};
    const errors = [];

    for (const sweep of sweeps) {
      const before = countFiles(sweep.dir, sweep.predicate);
      try { sweep.fn(); } catch (e) { errors.push(`${sweep.name}: ${e.message}`); }
      const after = countFiles(sweep.dir, sweep.predicate);
      stats[sweep.statKey] = Math.max(0, before - after);
    }

    for (const p of postSweepFns) {
      try { p.fn(); } catch (e) { errors.push(`${p.name}: ${e.message}`); }
    }

    const ts = new Date(now()).toISOString();
    lastSweepMs = now();
    const statsStr = sweeps
      .map((s) => `${stats[s.statKey]} ${s.name}`)
      .join(' · ');
    // #6 G6 — append resource metrics to the sweep line so a 24h-soak
    // can be read directly off `_watchdog.log` without manual gathering.
    let metricsStr = '';
    if (typeof getResourceMetrics === 'function') {
      try {
        const m = getResourceMetrics() || {};
        const parts = [];
        for (const [k, v] of Object.entries(m)) {
          if (v === undefined || v === null) continue;
          parts.push(`${k}=${v}`);
        }
        if (parts.length > 0) metricsStr = ' · ' + parts.join(' ');
      } catch { /* swallowed — never let a measurement crash the watchdog */ }
    }
    const line = `${ts} sweep ok · pruned ${statsStr} · ${now() - t0}ms${metricsStr}` +
      (errors.length ? ` · errors: ${errors.join('; ')}` : '') + '\n';
    logWriter(line);
    return stats;
  }

  function start() {
    if (timer) clearInterval(timer);
    // Don't fire immediately — startup already ran the sweep functions.
    // Wait a full interval so we only clean loose ends that accumulate.
    timer = setInterval(runSweep, intervalMs);
    logWriter(
      `${new Date(now()).toISOString()} watchdog armed · interval ${intervalMs / 60000}min · pid ${process.pid}\n`
    );
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  return {
    start,
    stop,
    runSweep,     // exposed for test mode + the __test__/watchdog-state IPC
    getLastSweepMs: () => lastSweepMs,
    isArmed: () => timer !== null,
  };
}

module.exports = { createWatchdog };
