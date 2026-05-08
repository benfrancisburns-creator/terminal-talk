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

// 14 days. .txt + .original.txt sidecars are kept long after the
// .mp3 they describe so the transcript-panel "show me what was
// said earlier today" feature works after the audio has been
// auto-pruned. But unbounded retention turns the queue dir into
// a long-tail of small files (1000+ observed in the field after a
// day of use). Two-week retention covers any plausible "scroll
// back through last week's sessions" use case while still letting
// the dir self-trim. Audio still uses staleMs (much shorter).
const SIDECAR_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

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
