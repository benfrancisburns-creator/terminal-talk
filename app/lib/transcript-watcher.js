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
const { spawn: defaultSpawn } = require('node:child_process');
const { trySynthDaemon: defaultTrySynthDaemon } = require('./synth-client');

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
      // Injectable child_process.spawn for tests. Production passes the
      // real node:child_process spawn; tests substitute a fake that
      // returns a recorded-args handle without actually launching Python.
      spawnFn = defaultSpawn,
      // Hard-kill an in-flight synth child. Called from stop({killInFlight:true})
      // during app quit so streaming synth doesn't outlive the app (Lane 3
      // lifecycle audit). Default does a best-effort SIGKILL; main.js
      // injects _hardKillProc so taskkill /F /T runs on Windows.
      killProc = (proc) => { try { proc.kill('SIGKILL'); } catch {} },
      // Injectable daemon dispatch (2026-07-13). Tries the long-lived
      // synth daemon before paying a Python spawn; tests substitute a
      // recorder. Pass null to force the spawn path.
      trySynthDaemonFn = defaultTrySynthDaemon,
    } = opts;
    this._sessionsDir = path.join(ttHome, 'sessions');
    this._ttHome = ttHome;
    this._claudeProjectsDir = claudeProjectsDir;
    this._synthScript = synthScript;
    this._pythonExe = pythonExe;
    this._pollIntervalMs = pollIntervalMs;
    this._minSpawnGapMs = minSpawnGapMs;
    this._diag = diag;
    this._spawn = spawnFn;
    this._killProc = killProc;
    this._trySynthDaemon = trySynthDaemonFn;

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

  stop({ killInFlight = false } = {}) {
    this._armed = false;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    // Default: let in-flight synth processes finish cleanly (called from
    // graceful pause paths). With killInFlight=true (called from app
    // will-quit), hard-kill them so streaming synth never outlives the
    // app — Lane 3 lifecycle audit.
    if (killInFlight) {
      for (const st of this._state.values()) {
        if (st.inFlight) {
          try { this._killProc(st.inFlight); } catch {}
          st.inFlight = null;
        }
      }
    }
    this._diag(`transcript-watcher: stopped${killInFlight ? ' (killed in-flight)' : ''}`);
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
    // Daemon-first (2026-07-13): the long-lived synth daemon skips the
    // Python cold-start this watcher pays every ≤500 ms per active
    // session — the single hottest spawn site in the app. inFlight
    // holds `true` (not a proc handle) during the ≤200 ms handshake so
    // ticks can't stack; concurrent same-session daemon jobs serialise
    // via synth_turn's _SessionLock (contender exits in ms).
    if (this._trySynthDaemon) {
      st.inFlight = true;
      try {
        this._trySynthDaemon(
          { sessionId, transcriptPath: st.transcript, mode: 'on-stream', ttHome: this._ttHome },
          (ok) => {
            st.inFlight = null;
            if (!ok) this._spawnSynthProc(st, shortId, sessionId);
          },
        );
      } catch (e) {
        st.inFlight = null;
        this._diag(`transcript-watcher: daemon dispatch threw ${shortId}: ${e.message}`);
        this._spawnSynthProc(st, shortId, sessionId);
      }
      return;
    }
    this._spawnSynthProc(st, shortId, sessionId);
  }

  _spawnSynthProc(st, shortId, sessionId) {
    const args = ['-u', this._synthScript,
      '--session', sessionId,
      '--transcript', st.transcript,
      '--mode', 'on-stream'];
    let proc;
    try {
      proc = this._spawn(this._pythonExe, args, {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: false,
        env: { ...process.env, TT_HOME: this._ttHome },
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
