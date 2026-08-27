'use strict';

// Disk pruning helpers — extracted from app/main.js 2026-04-26 to bring
// the file back under the 2000-line absolute ceiling (file-length parking
// lot from #29). Two separate sweeps:
//   - pruneOldFiles: removes audio clips older than staleMs and orphan
//     `.partial` writes older than 60 s from the queue dir.
//   - pruneSessionsDir: removes `<pid>.json` session files for PIDs that
//     are no longer alive (claude-code instances that exited cleanly).
//
// Factory injects every dependency so the prune logic is unit-testable
// against a tmp dir without spawning Electron or touching real PIDs.

const realFs = require('node:fs');
const realPath = require('node:path');

// 1 day. .txt + .original.txt sidecars are kept after the .mp3 they
// describe so the transcript-panel "show me what was said earlier" feature
// works once the audio has been auto-pruned. Retention was 14 days, which
// (with one sidecar per ephemeral tool-narration clip) let the queue dir
// balloon to 50k+ small files — slow readdirSync on every queue-watch fire.
// Ben's call (2026-06-02): a single day of scroll-back is plenty; anything
// older is dead weight. Keeps the hot dir to ~1 day of files so scans stay
// fast. Audio still uses staleMs (much shorter).
const SIDECAR_MAX_AGE_MS = 1 * 24 * 60 * 60 * 1000;

// 1 day. `<clip>.played.json` tombstones are written on every auto-prune /
// ephemeral delete (app/lib/ipc-handlers.js) and read ONLY by the offline
// synth-audit dev tool. They had NO prune rule and grew without bound (98k+
// in the field). Matched to the sidecar window above so the whole queue dir
// self-trims to ~1 day. synth-audit will simply report on the last day of
// turns instead of the last week — acceptable for a dev-only tool Ben
// doesn't run in normal use.
const PLAYED_MARKER_MAX_AGE_MS = 1 * 24 * 60 * 60 * 1000;

function createPruner({
  queueDir,
  sessionsDir,
  staleMs,
  isAudioFile,
  isPidAlive,
  fs = realFs,
  path = realPath,
} = {}) {
  if (!queueDir) throw new Error('createPruner: queueDir required');
  if (!sessionsDir) throw new Error('createPruner: sessionsDir required');
  if (typeof staleMs !== 'number' || staleMs <= 0) throw new Error('createPruner: staleMs must be positive number');
  if (typeof isAudioFile !== 'function') throw new Error('createPruner: isAudioFile required');
  if (typeof isPidAlive !== 'function') throw new Error('createPruner: isPidAlive required');

  function pruneOldFiles() {
    try {
      const now = Date.now();
      for (const f of fs.readdirSync(queueDir)) {
        const full = path.join(queueDir, f);
        if (isAudioFile(f)) {
          try {
            const stat = fs.statSync(full);
            if (now - stat.mtimeMs > staleMs) fs.unlinkSync(full);
          } catch {}
          continue;
        }
        // Transcript-panel sidecars: .txt (spoken text) and
        // .original.txt (pre-strip markdown source). Persist far
        // longer than audio (audio plays once and is gone; sidecars
        // are the lasting record), but not forever. Two-week
        // retention is the threshold below; older sidecars get
        // swept here. Skips _hook.log / _toolbar.log / _voice.log
        // / _watchdog.log — those start with underscore and the
        // suffix check below excludes them via the .txt-only test.
        if ((f.endsWith('.txt') || f.endsWith('.original.txt')) && !f.startsWith('_')) {
          try {
            const stat = fs.statSync(full);
            if (now - stat.mtimeMs > SIDECAR_MAX_AGE_MS) fs.unlinkSync(full);
          } catch {}
          continue;
        }
        // `<clip>.played.json` auto-prune tombstones. Read only by the
        // offline synth-audit tool over a 7-day window (see the constant
        // above). Previously had NO prune rule, so they grew without
        // bound and were the single largest contributor to queue-dir
        // bloat. Sweep anything past the consumer's window.
        if (f.endsWith('.played.json')) {
          try {
            const stat = fs.statSync(full);
            if (now - stat.mtimeMs > PLAYED_MARKER_MAX_AGE_MS) fs.unlinkSync(full);
          } catch {}
          continue;
        }
        // Synth spawn-error markers (`synth-spawn-<hash>.err`, written by
        // the synth path when a TTS subprocess fails). Debug breadcrumbs
        // only — nothing reads them at runtime. They had NO prune rule and
        // grew without bound (100+ in the field). Sweep past the same
        // one-day window as the other breadcrumb files. Skips _*.log etc.
        if (f.endsWith('.err') && !f.startsWith('_')) {
          try {
            const stat = fs.statSync(full);
            if (now - stat.mtimeMs > SIDECAR_MAX_AGE_MS) fs.unlinkSync(full);
          } catch {}
          continue;
        }
        if (f.endsWith('.partial')) {
          try {
            const stat = fs.statSync(full);
            if (now - stat.mtimeMs > 60_000) fs.unlinkSync(full);
          } catch {}
        }
      }
      // Codex synth-temp orphan cleanup. The Codex watcher writes
      // chunks to `<queue>/.tmp_synth/*.partial` during synthesis;
      // if the renderer dies mid-synth those orphan partials
      // accumulate. Sweep them out (>60s old) and remove the dir
      // if empty.
      const synthTmpDir = path.join(queueDir, '.tmp_synth');
      if (fs.existsSync(synthTmpDir)) {
        for (const f of fs.readdirSync(synthTmpDir)) {
          if (!f.endsWith('.partial')) continue;
          const full = path.join(synthTmpDir, f);
          try {
            const stat = fs.statSync(full);
            if (now - stat.mtimeMs > 60_000) fs.unlinkSync(full);
          } catch {}
        }
        try {
          if (fs.readdirSync(synthTmpDir).length === 0) fs.rmdirSync(synthTmpDir);
        } catch {}
      }
    } catch {}
  }

  function pruneSessionsDir() {
    try {
      if (!fs.existsSync(sessionsDir)) return;
      for (const f of fs.readdirSync(sessionsDir)) {
        if (!f.endsWith('.json')) continue;
        const pid = parseInt(f.replace('.json', ''), 10);
        if (!pid || !isPidAlive(pid)) {
          try { fs.unlinkSync(path.join(sessionsDir, f)); } catch {}
        }
      }
    } catch {}
  }

  return { pruneOldFiles, pruneSessionsDir };
}

module.exports = { createPruner };
