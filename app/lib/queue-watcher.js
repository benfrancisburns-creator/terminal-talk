'use strict';

// EX6c — extracted from app/main.js as part of the v0.4 big-file
// refactor. Pure filename-filtering + stat-budget reader for the
// queue directory.
//
// Design: factory-based so tests can inject a fake readdirSync /
// statSync and the module stays Electron-free.
//
// Behaviour preserved byte-for-byte from the original main.js
// implementation: two-phase sort (lexical first to bound stat
// syscalls, then mtime after statting) keeps getQueueFiles O(STAT_BUDGET)
// regardless of how many stale MP3s pile up in the dir.

const fs = require('node:fs');
const path = require('node:path');

const AUDIO_OR_PARTIAL_RE = /\.(mp3|wav|partial)$/i;

function isAudioFile(name) {
  const lower = name.toLowerCase();
  return (lower.endsWith('.wav') || lower.endsWith('.mp3')) && !lower.endsWith('.partial');
}

function createQueueWatcher({ queueDir, maxFiles, fs: fsDep = fs }) {
  if (!queueDir) throw new Error('createQueueWatcher: queueDir required');
  if (!Number.isInteger(maxFiles) || maxFiles < 1) {
    throw new Error('createQueueWatcher: maxFiles must be a positive integer');
  }
  const STAT_BUDGET = maxFiles * 2;

  function list() {
    try {
      // Queue filenames lead with a zero-padded timestamp (synth_turn
      // + main agree on that shape), so a descending lexical sort is
      // effectively a descending mtime sort. Stat only the newest
      // 2× maxFiles candidates so we don't pay syscall cost for
      // hundreds of lingering files after days of use — but keep
      // enough slack that a file touched out-of-band still has a
      // chance of ranking in.
      const names = fsDep.readdirSync(queueDir)
        .filter((f) => isAudioFile(f))
        // Explicit localeCompare so Sonar's S2871 gate passes. Our
        // filenames lead with a zero-padded ISO-ish timestamp, so
        // locale-aware compare gives the same ordering as the default
        // lexical sort would — just safer for future non-ASCII names.
        .sort((a, b) => b.localeCompare(a))  // descending -> newest first
        .slice(0, STAT_BUDGET);
      return names
        .map((f) => {
          const full = path.join(queueDir, f);
          try {
            const stat = fsDep.statSync(full);
            return { name: f, path: full, mtime: stat.mtimeMs, size: stat.size };
          } catch { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, maxFiles);
    } catch { return []; }
  }

  return { list };
}

module.exports = { createQueueWatcher, isAudioFile, AUDIO_OR_PARTIAL_RE };
