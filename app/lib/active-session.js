'use strict';

// Active-session detection — extracted from app/main.js (2026-10-05) to
// bring main.js back under the 2725-line file-length ceiling.
//
// Detect which assistant session owns the currently-focused terminal, if
// any. Returns the 8-char session short, or null if no match (e.g. Chrome /
// PDF viewer in front). Used to colour-code highlight-to-speak clips with
// a matching J label. Four tiers, most-specific first:
//   1. foreground process tree contains a known live session PID
//   2. exactly one live session exists -> must be that one
//   3. several live sessions -> the most recently touched sessions/ file
//   4. no sessions/ files -> most recent registry entry by last_seen
//
// Factory-injected deps keep the module Electron-free: the caller passes
// the sessions dir, fs/path, the PID liveness probe, the registry loader,
// the key-helper foreground-tree query and the diag logger.

const realFs = require('node:fs');
const realPath = require('node:path');

function createActiveSessionDetector({
  sessionsDir,
  fs = realFs,
  path = realPath,
  isPidAlive,
  loadAssignments,
  getForegroundTree,
  diag = () => {},
} = {}) {
  if (!sessionsDir) throw new Error('createActiveSessionDetector: sessionsDir required');
  if (typeof isPidAlive !== 'function') throw new Error('createActiveSessionDetector: isPidAlive required');
  if (typeof loadAssignments !== 'function') throw new Error('createActiveSessionDetector: loadAssignments required');
  if (typeof getForegroundTree !== 'function') throw new Error('createActiveSessionDetector: getForegroundTree required');

  async function detectActiveSession() {
    try {
      const fg = await getForegroundTree();
      const fgCandidates = new Set();
      if (fg && Array.isArray(fg.descendants)) {
        for (const p of fg.descendants) fgCandidates.add(p);
        if (fg.fg_pid) fgCandidates.add(fg.fg_pid);
      }
      diag(`detectActiveSession: fg_pid=${fg && fg.fg_pid} descendants=${fgCandidates.size}`);

      // Gather live sessions from the sessions/ dir (pruning dead PIDs).
      const liveSessions = [];
      if (fs.existsSync(sessionsDir)) {
        for (const f of fs.readdirSync(sessionsDir)) {
          if (!f.endsWith('.json')) continue;
          const pid = parseInt(f.replace('.json', ''), 10);
          if (!pid) continue;
          const full = path.join(sessionsDir, f);
          if (!isPidAlive(pid)) { try { fs.unlinkSync(full); } catch {} continue; }
          try {
            const data = JSON.parse(fs.readFileSync(full, 'utf8'));
            const stat = fs.statSync(full);
            if (data.short) liveSessions.push({ pid, short: data.short, mtime: stat.mtimeMs });
          } catch {}
        }
      }

      // Tier 1: foreground process tree contains a known session PID.
      const fgMatches = liveSessions.filter(s => fgCandidates.has(s.pid));
      if (fgMatches.length > 0) {
        fgMatches.sort((a, b) => b.mtime - a.mtime);
        diag(`detectActiveSession: fg match -> ${fgMatches[0].short}`);
        return fgMatches[0].short;
      }

      // Tier 2: only one live assistant session exists -- must be that one.
      if (liveSessions.length === 1) {
        diag(`detectActiveSession: single-session fallback -> ${liveSessions[0].short}`);
        return liveSessions[0].short;
      }

      // Tier 3: most recently interacted session (highest mtime). Covers Windows
      // Terminal multi-tab cases where PID tree can't distinguish tabs.
      if (liveSessions.length > 1) {
        liveSessions.sort((a, b) => b.mtime - a.mtime);
        diag(`detectActiveSession: most-recent fallback -> ${liveSessions[0].short}`);
        return liveSessions[0].short;
      }

      // Tier 4: no sessions/ files but registry has entries -- fall back to the most recent.
      const all = loadAssignments();
      const byRecent = Object.entries(all)
        .filter(([, e]) => e && e.last_seen)
        .sort((a, b) => b[1].last_seen - a[1].last_seen);
      if (byRecent.length > 0) {
        diag(`detectActiveSession: registry-recency fallback -> ${byRecent[0][0]}`);
        return byRecent[0][0];
      }

      diag('detectActiveSession: no live sessions found');
      return null;
    } catch (e) {
      diag(`detectActiveSession fail: ${e.message}`);
      return null;
    }
  }

  return { detectActiveSession };
}

module.exports = { createActiveSessionDetector };
