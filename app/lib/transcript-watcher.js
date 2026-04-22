'use strict';

// Phase 2 — transcript streaming watcher. Closes the latency gap
// between "Claude starts producing text" and "user hears audio".
//
// Architecture:
//   - Every ~500 ms, scan ~/.terminal-talk/sessions/ for *-working.flag
//     files (written by the UserPromptSubmit hook, cleared by Stop).
//   - For each active session, find its transcript JSONL file by
//     globbing ~/.claude/projects/ for a filename starting with the
//     short ID.
//   - Spawn synth_turn.py --mode on-stream against that transcript.
//     The Python side does the char-offset-aware slicing and speaks
//     complete sentences as they appear, leaving incomplete tail
//     fragments for the next poll.
//   - Self-rate-limit per session: don't spawn while a previous synth
//     for the same session is still running. synth_turn's own
//     _SessionLock would serialise them anyway, but skipping here
//     saves the Python spawn cost.
//
// Why poll vs fs.watch: JSONL writes are frequent during streaming
// (one per token roughly) — fs.watch would fire constantly and we'd
// debounce anyway. A 500 ms poll gives the user ~2-3 sentences of
// batching per synth invocation which matches the sentence_group
// target clip length. Fs.watch would be bursty-fast-then-idle.
//
// Why glob for the transcript vs track paths explicitly: the flag
// file only stores an epoch timestamp today; adding paths to it
// would widen the hook contract for one consumer. A cached glob over
// the typically-small ~/.claude/projects/ tree (≤5 project dirs,
// each with ≤20 jsonl files) is fast and has no back-compat risk.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

class TranscriptWatcher {
  constructor(opts = {}) {
    const {
      ttHome = path.join(os.homedir(), '.terminal-talk'),
      claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects'),
      synthScript = path.join(os.homedir(), '.terminal-talk', 'app', 'synth_turn.py'),
      pythonExe = 'python',
      pollIntervalMs = 500,
      // Hard ceiling on how often we'll spawn for the same session — even
      // if the flag is set and the file is growing, don't launch a fresh
      // Python process faster than this. Mostly a belt-and-braces guard
      // against a synth_turn that hangs (lock steal triggers eventually).
      minSpawnGapMs = 400,
      diag = () => {},
    } = opts;
    this._sessionsDir = path.join(ttHome, 'sessions');
    this._claudeProjectsDir = claudeProjectsDir;
    this._synthScript = synthScript;
    this._pythonExe = pythonExe;
    this._pollIntervalMs = pollIntervalMs;
    this._minSpawnGapMs = minSpawnGapMs;
    this._diag = diag;

    // Per-session state:
    //   inFlight   — child process handle currently running for this short
    //   lastSpawn  — Date.now() of last spawn (rate-limit)
    //   transcript — cached full path to the JSONL
    this._state = new Map();
    this._pollTimer = null;
    this._armed = false;
  }

  start() {
    if (this._armed) return;
    this._armed = true;
    this._diag('transcript-watcher: started');
    const tick = () => {
      if (!this._armed) return;
      this._poll().finally(() => {
        if (this._armed) this._pollTimer = setTimeout(tick, this._pollIntervalMs);
      });
    };
    tick();
  }

  stop() {
    this._armed = false;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    // Don't kill in-flight synth processes — let them finish cleanly.
    this._diag('transcript-watcher: stopped');
  }

  async _poll() {
    let activeShorts;
    try {
      activeShorts = this._readActiveShorts();
    } catch (e) {
      this._diag(`transcript-watcher: sessions scan failed: ${e.message}`);
      return;
    }
    for (const shortId of activeShorts) {
      this._maybeSpawn(shortId);
    }
  }

  _readActiveShorts() {
    if (!fs.existsSync(this._sessionsDir)) return [];
    const out = [];
    for (const name of fs.readdirSync(this._sessionsDir)) {
      const m = /^([a-f0-9]{8})-working\.flag$/.exec(name);
      if (m) out.push(m[1]);
    }
    return out;
  }

  _maybeSpawn(shortId) {
    let st = this._state.get(shortId);
    if (!st) {
      st = { inFlight: null, lastSpawn: 0, transcript: null };
      this._state.set(shortId, st);
    }
    if (st.inFlight) return;  // still running — skip this tick
    const now = Date.now();
    if (now - st.lastSpawn < this._minSpawnGapMs) return;
    if (!st.transcript) {
      st.transcript = this._findTranscript(shortId);
      if (!st.transcript) return;  // can't find, skip — maybe found next tick
    }
    // Still valid? If Claude Code moved the file or session, the path
    // goes stale. Re-resolve lazily on ENOENT.
    if (!fs.existsSync(st.transcript)) {
      st.transcript = null;
      return;
    }
    st.lastSpawn = now;
    const sessionId = path.basename(st.transcript, '.jsonl');
    const args = ['-u', this._synthScript,
      '--session', sessionId,
      '--transcript', st.transcript,
      '--mode', 'on-stream'];
    let proc;
    try {
      proc = spawn(this._pythonExe, args, {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: false,
      });
    } catch (e) {
      this._diag(`transcript-watcher: spawn fail ${shortId}: ${e.message}`);
      return;
    }
    st.inFlight = proc;
    let errBuf = '';
    proc.stderr.on('data', (d) => { errBuf += d.toString(); });
    const cleanup = () => {
      st.inFlight = null;
      if (errBuf) this._diag(`transcript-watcher: ${shortId} stderr: ${errBuf.slice(0, 200)}`);
    };
    proc.on('exit', cleanup);
    proc.on('error', cleanup);
  }

  _findTranscript(shortId) {
    if (!fs.existsSync(this._claudeProjectsDir)) return null;
    let projectDirs;
    try {
      projectDirs = fs.readdirSync(this._claudeProjectsDir);
    } catch {
      return null;
    }
    for (const sub of projectDirs) {
      const fullSub = path.join(this._claudeProjectsDir, sub);
      let isDir = false;
      try { isDir = fs.statSync(fullSub).isDirectory(); } catch {}
      if (!isDir) continue;
      let files;
      try { files = fs.readdirSync(fullSub); } catch { continue; }
      for (const f of files) {
        if (f.startsWith(shortId) && f.endsWith('.jsonl')) {
          return path.join(fullSub, f);
        }
      }
    }
    return null;
  }
}

module.exports = { TranscriptWatcher };
