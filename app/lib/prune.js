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
