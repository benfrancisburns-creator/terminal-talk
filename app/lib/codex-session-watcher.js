'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { stripForTTS } = require('./text');
const { allocatePaletteIndex } = require('./palette-alloc');

const SUPPORTED_PHASES = new Set(['commentary', 'final']);
const SHORT_RE = /^[a-f0-9]{8}$/;
const ROLLOUT_SESSION_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const EDGE_VOICE_RE = /^[A-Za-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z]+(?:Multilingual|Expressive)?Neural$/;
const OPENAI_VOICES = new Set(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);
const MAX_RECENT_SIGNATURES = 64;
const DEFAULT_MAX_SESSION_AGE_MS = 72 * 60 * 60 * 1000;
const DEFAULT_CHUNK_LEN = 3800;

function parseSessionIdFromRolloutPath(filePath) {
  const m = String(filePath || '').match(ROLLOUT_SESSION_RE);
  return m ? m[1].toLowerCase() : null;
}

function extractCodexAgentMessageEvent(line) {
  if (!line || !line.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (parsed.type !== 'event_msg') return null;
  const payload = parsed.payload || {};
  if (payload.type !== 'agent_message') return null;
  if (!SUPPORTED_PHASES.has(payload.phase)) return null;
  const message = typeof payload.message === 'string' ? payload.message.trim() : '';
  if (!message) return null;
  return {
    timestamp: parsed.timestamp || '',
    phase: payload.phase,
    message,
  };
}

function formatQueueTimestamp(isoString) {
  const d = new Date(isoString || Date.now());
  const ts = Number.isFinite(d.getTime()) ? d : new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}` +
    `T${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}` +
    `${pad(ts.getMilliseconds(), 3)}`
  );
}

function chunkText(text, maxLen = DEFAULT_CHUNK_LEN) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let current = '';
  for (const sentence of sentences) {
    if ((current + ' ' + sentence).length > maxLen && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

function writeSpokenSidecar(audioPath, spoken, diag) {
  try {
    const ext = path.extname(audioPath);
    const base = audioPath.slice(0, -ext.length);
    fs.writeFileSync(`${base}.txt`, spoken, 'utf8');
  } catch (e) {
    diag(`codex-session-watcher: sidecar write fail for ${path.basename(audioPath)}: ${e.message}`);
  }
}

function createCodexSessionWatcher(opts = {}) {
  const {
    codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions'),
    queueDir = path.join(os.homedir(), '.terminal-talk', 'queue'),
    getCFG = () => ({}),
    loadAssignments = () => ({}),
    saveAssignments = null,
    apiKeyStore = null,
    callEdgeTTS,
    callOpenAITTS,
    notifyQueue = () => {},
    diag = () => {},
    pollIntervalMs = 1000,
    maxSessionAgeMs = DEFAULT_MAX_SESSION_AGE_MS,
    now = () => Date.now(),
    fsDep = fs,
  } = opts;

  if (typeof callEdgeTTS !== 'function') {
    throw new Error('createCodexSessionWatcher: callEdgeTTS required');
  }

  const bootMs = now();
  const files = new Map();
  let armed = false;
  let timer = null;
  let polling = false;

  function _touchAssignment(shortId, sessionId) {
    if (!SHORT_RE.test(shortId || '') || typeof saveAssignments !== 'function') return;
    let assignments = {};
    try { assignments = loadAssignments() || {}; } catch {}
    const nowSec = Math.floor(now() / 1000);
    const fullSessionId = sessionId || shortId;
    if (assignments[shortId]) {
      assignments[shortId].last_seen = nowSec;
      assignments[shortId].session_id = fullSessionId;
    } else {
      const alloc = allocatePaletteIndex(shortId, assignments, 24);
      if (alloc.evicted) delete assignments[alloc.evicted];
      assignments[shortId] = {
        index: alloc.index,
        session_id: fullSessionId,
        claude_pid: 0,
        label: '',
        pinned: false,
        muted: false,
        focus: false,
        last_seen: nowSec,
      };
      diag(`codex-session-watcher: registered ${shortId} -> index ${alloc.index} (${alloc.reason})`);
    }
    try { saveAssignments(assignments, 'codex-session-watcher'); }
    catch (e) { diag(`codex-session-watcher: assignment touch fail ${shortId}: ${e.message}`); }
  }

  function _listCandidateFiles() {
    if (!codexSessionsDir || !fsDep.existsSync(codexSessionsDir)) return [];
    const out = [];
    const cutoff = now() - maxSessionAgeMs;
    const walk = (dir, depth) => {
      if (depth > 3) return;
      let entries;
      try { entries = fsDep.readdirSync(dir, { withFileTypes: true }); }
      catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
        try {
          const stat = fsDep.statSync(full);
          if (stat.mtimeMs < cutoff && !files.has(full)) continue;
          out.push({ path: full, size: stat.size, mtimeMs: stat.mtimeMs, birthtimeMs: stat.birthtimeMs || 0 });
        } catch {}
      }
    };
    walk(codexSessionsDir, 0);
    out.sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path));
    return out;
  }

  function _resolveRouting(shortId) {
    const cfg = getCFG() || {};
    let entry = null;
    try {
      const assignments = loadAssignments() || {};
      entry = assignments[shortId] || null;
    } catch {}

    const includes = { ...((cfg && cfg.speech_includes) || {}) };
    if (entry && entry.speech_includes && typeof entry.speech_includes === 'object') {
      for (const [key, value] of Object.entries(entry.speech_includes)) {
        if (typeof value === 'boolean') includes[key] = value;
      }
    }

    const provider = String((((cfg || {}).playback) || {}).tts_provider || 'edge').toLowerCase() === 'openai'
      ? 'openai'
      : 'edge';
    const voices = ((cfg || {}).voices) || {};
    const customVoice = entry && typeof entry.voice === 'string' ? entry.voice : '';
    let apiKey = null;
    try {
      if (apiKeyStore && typeof apiKeyStore.get === 'function') apiKey = apiKeyStore.get();
    } catch {}

    return {
      muted: !!(entry && entry.muted),
      includes,
      provider,
      apiKey,
      edgeVoice: EDGE_VOICE_RE.test(customVoice)
        ? customVoice
        : (voices.edge_response || 'en-GB-RyanNeural'),
      openaiVoice: OPENAI_VOICES.has(customVoice)
        ? customVoice
        : (voices.openai_response || 'onyx'),
    };
  }

  async function _synthesizeChunk(input, routing, edgeOut, openaiOut) {
    const tryEdge = async () => {
      await callEdgeTTS(input, routing.edgeVoice, edgeOut);
      return edgeOut;
    };
    const tryOpenAI = async () => {
      if (!routing.apiKey || typeof callOpenAITTS !== 'function') return null;
      await callOpenAITTS(routing.apiKey, input, routing.openaiVoice, openaiOut);
      return openaiOut;
    };

    if (routing.provider === 'openai') {
      try {
        const out = await tryOpenAI();
        if (out) return out;
      } catch (e) {
        diag(`codex-session-watcher: OpenAI fail, falling back to edge: ${e.message}`);
      }
      return tryEdge();
    }

    try {
      return await tryEdge();
    } catch (e) {
      diag(`codex-session-watcher: edge fail, falling back to OpenAI: ${e.message}`);
      const out = await tryOpenAI();
      if (out) return out;
      throw e;
    }
  }

  async function _deliverMessage(state, event, batchSeq) {
    if (!SHORT_RE.test(state.shortId || '')) return;
    _touchAssignment(state.shortId, state.sessionId);
    const initialRouting = _resolveRouting(state.shortId);
    if (initialRouting.muted) {
      diag(`codex-session-watcher: muted ${state.shortId}; skipping ${event.phase}`);
      return;
    }

    const spoken = stripForTTS(event.message, initialRouting.includes).trim();
    if (!spoken) return;
    const chunks = chunkText(spoken);
    const turnTs = formatQueueTimestamp(event.timestamp);
    const phaseTag = event.phase === 'commentary' ? 'C' : 'F';

    for (let i = 0; i < chunks.length; i++) {
      const routing = _resolveRouting(state.shortId);
      if (routing.muted) {
        diag(`codex-session-watcher: ${state.shortId} muted mid-batch; aborting remaining chunks`);
        break;
      }
      const seq = String(i + 1).padStart(4, '0');
      const batch = String(batchSeq).padStart(4, '0');
      const stem = `${turnTs}-${phaseTag}${batch}-${seq}-${state.shortId}`;
      const edgeOut = path.join(queueDir, `${stem}.mp3`);
      const openaiOut = path.join(queueDir, `${stem}.wav`);
      const produced = await _synthesizeChunk(chunks[i], routing, edgeOut, openaiOut);
      if (!produced) continue;
      writeSpokenSidecar(produced, chunks[i], diag);
      try { notifyQueue(); } catch {}
    }

    diag(`codex-session-watcher: spoke ${event.phase} for ${state.shortId} (${chunks.length} chunk(s))`);
  }

  function _rememberSignature(state, signature) {
    if (state.signatureSet.has(signature)) return false;
    state.signatureSet.add(signature);
    state.signatures.push(signature);
    if (state.signatures.length > MAX_RECENT_SIGNATURES) {
      const stale = state.signatures.shift();
      if (stale) state.signatureSet.delete(stale);
    }
    return true;
  }

  function _ensureState(meta) {
    let state = files.get(meta.path);
    if (state) return state;
    const sessionId = parseSessionIdFromRolloutPath(meta.path);
    const shortId = sessionId ? sessionId.slice(0, 8).toLowerCase() : '';
    const createdMs = meta.birthtimeMs || Number.POSITIVE_INFINITY;
    const existedBeforeBoot = createdMs <= bootMs;
    state = {
      sessionId,
      shortId,
      offset: existedBeforeBoot ? meta.size : 0,
      remainder: '',
      tail: Promise.resolve(),
      nextBatchSeq: 1,
      signatures: [],
      signatureSet: new Set(),
    };
    files.set(meta.path, state);
    return state;
  }

  function _readDelta(meta, state) {
    if (meta.size < state.offset) {
      state.offset = 0;
      state.remainder = '';
    }
    if (meta.size === state.offset) return '';
    try {
      const full = fsDep.readFileSync(meta.path);
      const data = full.subarray(state.offset, meta.size).toString('utf8');
      state.offset = meta.size;
      return data;
    } catch (e) {
      diag(`codex-session-watcher: read fail ${path.basename(meta.path)}: ${e.message}`);
      return '';
    }
  }

  function _processFile(meta) {
    const state = _ensureState(meta);
    const delta = _readDelta(meta, state);
    if (!delta) return;

    const combined = state.remainder + delta;
    const lines = combined.split(/\r?\n/);
    state.remainder = combined.endsWith('\n') ? '' : (lines.pop() || '');

    for (const line of lines) {
      const event = extractCodexAgentMessageEvent(line);
      if (!event) continue;
      const signature = `${event.timestamp}|${event.phase}|${event.message}`;
      if (!_rememberSignature(state, signature)) continue;
      const batchSeq = state.nextBatchSeq++;
      state.tail = state.tail
        .then(() => _deliverMessage(state, event, batchSeq))
        .catch((e) => {
          diag(`codex-session-watcher: delivery fail ${state.shortId || 'unknown'}: ${e.message}`);
        });
    }

    const tailEvent = extractCodexAgentMessageEvent(state.remainder);
    if (!tailEvent) return;
    const signature = `${tailEvent.timestamp}|${tailEvent.phase}|${tailEvent.message}`;
    if (!_rememberSignature(state, signature)) return;
    const batchSeq = state.nextBatchSeq++;
    state.remainder = '';
    state.tail = state.tail
      .then(() => _deliverMessage(state, tailEvent, batchSeq))
      .catch((e) => {
        diag(`codex-session-watcher: delivery fail ${state.shortId || 'unknown'}: ${e.message}`);
      });
  }

  async function _poll() {
    const candidates = _listCandidateFiles();
    const livePaths = new Set(candidates.map((f) => f.path));
    for (const meta of candidates) _processFile(meta);
    for (const tracked of Array.from(files.keys())) {
      if (!livePaths.has(tracked)) files.delete(tracked);
    }
  }

  function _schedule() {
    if (!armed) return;
    timer = setTimeout(_tick, pollIntervalMs);
  }

  async function _tick() {
    if (!armed) return;
    if (polling) {
      _schedule();
      return;
    }
    polling = true;
    try {
      await _poll();
    } catch (e) {
      diag(`codex-session-watcher: poll fail: ${e.message}`);
    } finally {
      polling = false;
      _schedule();
    }
  }

  function start() {
    if (armed) return;
    armed = true;
    diag('codex-session-watcher: started');
    _tick();
  }

  function stop() {
    armed = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    diag('codex-session-watcher: stopped');
  }

  return { start, stop };
}

module.exports = {
  createCodexSessionWatcher,
  extractCodexAgentMessageEvent,
  parseSessionIdFromRolloutPath,
};
