'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { stripForTTS } = require('./text');
const { allocatePaletteIndex } = require('./palette-alloc');
const { ensureAutoVoice, shouldAutoAssignVoice } = require('./voice-alloc');
const {
  extractCodexToolCallEvent,
  extractCodexToolOutputEvent,
  enrichCodexToolPhraseWithResult,
  narrateCodexToolCallPayload,
  naturalisePath,
  leadingToolVerb,
  summariseShellCommand,
  varyToolPhrase,
  wantsCodexToolResultContext,
} = require('./codex-tool-narration');
const { providerOrder } = require('./tts-routing');

const SUPPORTED_PHASES = new Map([
  ['commentary', 'commentary'],
  ['final', 'final'],
  ['final_answer', 'final'],
]);
const SHORT_RE = /^[a-f0-9]{8}$/;
const ROLLOUT_SESSION_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const EDGE_VOICE_RE = /^[A-Za-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z]+(?:Multilingual|Expressive)?Neural$/;
const OPENAI_VOICES = new Set(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);
const MAX_RECENT_SIGNATURES = 64;
const MAX_RECENT_TOOL_PHRASES = 32;
const TOOL_PHRASE_DEDUP_WINDOW_MS = 30000;
const TOOL_RESULT_CONTEXT_WAIT_MS = 1600;
const DEFAULT_MAX_SESSION_AGE_MS = 72 * 60 * 60 * 1000;
const DEFAULT_CHUNK_LEN = 1200;
const FINAL_CHUNK_LEN = 900;
const COMMENTARY_CHUNK_LEN = 1200;
const DEFAULT_PLUGIN_CLEANUP_DELAY_MS = 120000;
const PLUGIN_CLEANED_TOMBSTONE_MS = 30 * 60 * 1000;
const STOP_MARKER_RE = /^([a-f0-9]{8})-codex-stop\.json$/;

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
  const phase = SUPPORTED_PHASES.get(payload.phase);
  if (!phase) return null;
  const message = typeof payload.message === 'string' ? payload.message.trim() : '';
  if (!message) return null;
  return {
    timestamp: parsed.timestamp || '',
    phase,
    message,
  };
}

function extractCodexSessionMetaEvent(line) {
  if (!line || !line.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (parsed.type !== 'session_meta') return null;
  const payload = parsed.payload || {};
  const sessionId = String(payload.id || '').toLowerCase();
  if (!sessionId || sessionId.length < 8) return null;
  return {
    sessionId,
    source: String(payload.source || ''),
    originator: String(payload.originator || ''),
    cwd: String(payload.cwd || ''),
    timestamp: String(payload.timestamp || parsed.timestamp || ''),
  };
}

function isCodexTerminalSource(meta) {
  if (!meta) return true;
  const source = String(meta.source || '').toLowerCase();
  const originator = String(meta.originator || '').toLowerCase();
  const cwd = String(meta.cwd || '');
  if (source === 'cli' || originator === 'codex-tui') return true;
  if (source === 'vscode' && originator === 'codex desktop') return true;
  if (source === 'vscode' && /[\\/]Documents[\\/]Codex[\\/]\d{4}-\d{2}-\d{2}[\\/]/i.test(cwd)) return true;
  if (!source && !originator) return true;
  return false;
}

function isCodexDesktopSource(meta) {
  if (!meta) return false;
  const source = String(meta.source || '').toLowerCase();
  const originator = String(meta.originator || '').toLowerCase();
  const cwd = String(meta.cwd || '');
  if (source === 'vscode' && originator === 'codex desktop') return true;
  return source === 'vscode' && /[\\/]Documents[\\/]Codex[\\/]\d{4}-\d{2}-\d{2}[\\/]/i.test(cwd);
}

function extractCodexLineEvent(line) {
  const tool = extractCodexToolCallEvent(line);
  if (tool) return { kind: 'tool', event: tool };
  const message = extractCodexAgentMessageEvent(line);
  if (message) return { kind: 'message', event: message };
  return null;
}

function readCodexRolloutMeta(filePath, fsDep = fs) {
  try {
    const fd = fsDep.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(256 * 1024);
      const bytes = fsDep.readSync(fd, buffer, 0, buffer.length, 0);
      const firstLine = buffer.subarray(0, bytes).toString('utf8').split(/\r?\n/, 1)[0] || '';
      return extractCodexSessionMetaEvent(firstLine);
    } finally {
      fsDep.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function extractCodexWorkingStateEvent(line) {
  if (!line || !line.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const payload = parsed.payload || {};
  if (parsed.type === 'event_msg') {
    if (payload.type === 'user_message' || payload.type === 'task_started') return 'mark';
    if (payload.type === 'agent_message' && payload.phase === 'commentary') return 'mark';
    if (payload.type === 'agent_message' && (payload.phase === 'final' || payload.phase === 'final_answer')) return 'clear';
    if (payload.type === 'task_complete' || payload.type === 'turn_aborted') return 'clear';
  }
  if (parsed.type === 'response_item') {
    if (payload.type === 'message' && payload.role === 'user') return 'mark';
    if (payload.type === 'function_call' || payload.type === 'custom_tool_call' || payload.type === 'reasoning') {
      return 'mark';
    }
  }
  return null;
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

function parseEventTimestampMs(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
}

function humaniseDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins <= 0) return `${secs} second${secs === 1 ? '' : 's'}`;
  if (secs === 0) return `${mins} minute${mins === 1 ? '' : 's'}`;
  return `${mins} minute${mins === 1 ? '' : 's'} and ${secs} second${secs === 1 ? '' : 's'}`;
}

function humaniseFooterPhrase(footer) {
  const m = String(footer || '').trim().match(/^([A-ZÀ-Ž][a-zà-ž]+)\s+for\s+(?:(\d+)m\s*)?(\d+)s$/);
  if (!m) return '';
  const verb = m[1];
  const mins = Number(m[2] || 0);
  const secs = Number(m[3] || 0);
  if (mins <= 0) return `${verb} for ${secs} second${secs === 1 ? '' : 's'}.`;
  if (secs === 0) return `${verb} for ${mins} minute${mins === 1 ? '' : 's'}.`;
  return `${verb} for ${mins} minute${mins === 1 ? '' : 's'} and ${secs} second${secs === 1 ? '' : 's'}.`;
}

function splitOversizeChunk(text, maxLen) {
  const parts = [];
  let rest = String(text || '').trim();
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf(' ', maxLen);
    if (cut < Math.floor(maxLen * 0.55)) cut = maxLen;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

function chunkText(text, maxLen = DEFAULT_CHUNK_LEN) {
  const limit = Math.max(300, Math.floor(Number(maxLen) || DEFAULT_CHUNK_LEN));
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= limit) return [clean];
  const chunks = [];
  const sentences = clean.split(/(?<=[.!?])\s+/);
  let current = '';
  for (const sentence of sentences) {
    const pieces = sentence.length > limit ? splitOversizeChunk(sentence, limit) : [sentence];
    for (const piece of pieces) {
      const candidate = current ? `${current} ${piece}` : piece;
      if (candidate.length > limit && current) {
        chunks.push(current.trim());
        current = piece;
      } else {
        current = candidate;
      }
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

function writeSpokenSidecar(audioPath, spoken, diag, original = null) {
  try {
    const ext = path.extname(audioPath);
    const base = audioPath.slice(0, -ext.length);
    fs.writeFileSync(`${base}.txt`, spoken, 'utf8');
    if (original && String(original).trim()) {
      fs.writeFileSync(`${base}.original.txt`, String(original), 'utf8');
    }
  } catch (e) {
    diag(`codex-session-watcher: sidecar write fail for ${path.basename(audioPath)}: ${e.message}`);
  }
}

function createCodexSessionWatcher(opts = {}) {
  const {
    codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions'),
    queueDir = path.join(os.homedir(), '.terminal-talk', 'queue'),
    sessionsDir = path.join(os.homedir(), '.terminal-talk', 'sessions'),
    getCFG = () => ({}),
    loadAssignments = () => ({}),
    saveAssignments = null,
    apiKeyStore = null,
    callEdgeTTS,
    callOpenAITTS,
    notifyQueue = () => {},
    onAssignmentTouched = () => {},
    diag = () => {},
    pollIntervalMs = 1000,
    maxSessionAgeMs = DEFAULT_MAX_SESSION_AGE_MS,
    pluginCleanupDelayMs = DEFAULT_PLUGIN_CLEANUP_DELAY_MS,
    requireHookIdentity = process.env.TT_REQUIRE_CODEX_HOOK_IDENTITY === '1',
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
  const pluginCleanupTimers = new Map();

  function _pluginCleanedFlagPath(shortId) {
    if (!SHORT_RE.test(shortId || '') || !sessionsDir) return null;
    return path.join(sessionsDir, `${shortId}-plugin-cleaned.flag`);
  }

  function _writePluginCleanupTombstone(shortId) {
    const flagPath = _pluginCleanedFlagPath(shortId);
    if (!flagPath) return false;
    try {
      fsDep.mkdirSync(sessionsDir, { recursive: true });
      fsDep.writeFileSync(flagPath, String(Math.floor(now() / 1000)), 'utf8');
      return true;
    } catch (e) {
      diag(`codex-session-watcher: cleanup tombstone write fail ${shortId}: ${e.message}`);
      return false;
    }
  }

  function _isRecentlyCleanedPluginShort(shortId) {
    const flagPath = _pluginCleanedFlagPath(shortId);
    if (!flagPath) return false;
    let stat;
    try { stat = fsDep.statSync(flagPath); } catch { return false; }
    let stampMs = NaN;
    try {
      const raw = fsDep.readFileSync(flagPath, 'utf8').trim();
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) {
        stampMs = parsed > 1000000000000 ? parsed : parsed * 1000;
      }
    } catch {}
    const basisMs = Number.isFinite(stampMs) ? stampMs : stat.mtimeMs;
    const ageMs = now() - basisMs;
    if (ageMs <= PLUGIN_CLEANED_TOMBSTONE_MS) return true;
    try { fsDep.unlinkSync(flagPath); } catch {}
    return false;
  }

  function _applySourceMeta(entry, sourceMeta) {
    if (!entry || !sourceMeta || !isCodexDesktopSource(sourceMeta)) return false;
    let changed = false;
    const setString = (key, value, maxLen = 240) => {
      const clean = String(value || '').slice(0, maxLen);
      if (!clean || entry[key] === clean) return;
      entry[key] = clean;
      changed = true;
    };
    setString('source_kind', 'codex-desktop');
    setString('source_label', 'Codex Desktop');
    setString('source_app', 'Codex');
    setString('adapter', 'desktop-rollout');
    setString('source_cwd', sourceMeta.cwd || '', 4096);
    setString('source', sourceMeta.source || '');
    setString('source_originator', sourceMeta.originator || '');
    if (entry.pinned !== true) {
      entry.pinned = true;
      changed = true;
    }
    const caps = entry.capabilities && typeof entry.capabilities === 'object' ? { ...entry.capabilities } : {};
    const desiredCaps = {
      auto_register: true,
      tool_events: true,
      response_events: true,
      mcp_speak: false,
      manual_speak_selection: true,
    };
    for (const [key, value] of Object.entries(desiredCaps)) {
      if (caps[key] !== value) {
        caps[key] = value;
        changed = true;
      }
    }
    entry.capabilities = caps;
    return changed;
  }

  function _isLivePid(pid) {
    const n = Number(pid);
    if (!Number.isInteger(n) || n <= 0) return false;
    try {
      process.kill(n, 0);
      return true;
    } catch {
      return false;
    }
  }

  function _findToolbarLaunchClaim(assignments, nowSec, sourceMeta = null) {
    if (!assignments || isCodexDesktopSource(sourceMeta)) return null;
    const maxAgeSec = 10 * 60;
    const candidates = [];
    for (const [candidateShort, entry] of Object.entries(assignments)) {
      if (!SHORT_RE.test(candidateShort || '') || !entry || typeof entry !== 'object') continue;
      if (entry.source_kind !== 'toolbar-launch' || entry.source_label !== 'Codex') continue;
      if (!String(entry.session_id || '').startsWith('codex-provisional-')) continue;
      const lastSeen = Number(entry.last_seen) || 0;
      if (nowSec - lastSeen > maxAgeSec) continue;
      if (!_isLivePid(entry.claude_pid)) continue;
      candidates.push({ shortId: candidateShort, entry, lastSeen });
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.lastSeen - a.lastSeen);
    if (candidates.length > 1 && candidates[0].lastSeen === candidates[1].lastSeen) {
      diag(`codex-session-watcher: ambiguous toolbar-launch claim for ${candidates.map((c) => c.shortId).join(',')}`);
      return null;
    }
    return candidates[0];
  }

  function _touchAssignment(shortId, sessionId, sourceMeta = null) {
    if (!SHORT_RE.test(shortId || '') || typeof saveAssignments !== 'function') return;
    if (_isRecentlyCleanedPluginShort(shortId)) {
      diag(`codex-session-watcher: skipped recently cleaned codex-plugin ${shortId}`);
      return;
    }
    let assignments = {};
    try { assignments = loadAssignments() || {}; } catch {}
    const nowSec = Math.floor(now() / 1000);
    const fullSessionId = sessionId || shortId;
    if (assignments[shortId]) {
      assignments[shortId].last_seen = nowSec;
      assignments[shortId].session_id = fullSessionId;
      _applySourceMeta(assignments[shortId], sourceMeta);
      if (shouldAutoAssignVoice(assignments[shortId])) {
        const voiceAlloc = ensureAutoVoice(assignments[shortId], assignments);
        if (voiceAlloc) diag(`codex-session-watcher: auto voice ${shortId} -> ${voiceAlloc.voice} (${voiceAlloc.reason})`);
      }
    } else {
      const claim = _findToolbarLaunchClaim(assignments, nowSec, sourceMeta);
      if (claim) {
        const entry = {
          ...claim.entry,
          session_id: fullSessionId,
          last_seen: nowSec,
        };
        delete assignments[claim.shortId];
        assignments[shortId] = entry;
        diag(`codex-session-watcher: claimed toolbar launch ${claim.shortId} -> ${shortId}`);
      } else {
        const alloc = allocatePaletteIndex(shortId, assignments, 24);
        if (alloc.evicted) delete assignments[alloc.evicted];
        const entry = {
          index: alloc.index,
          session_id: fullSessionId,
          claude_pid: 0,
          label: '',
          pinned: false,
          muted: false,
          focus: false,
          last_seen: nowSec,
        };
        _applySourceMeta(entry, sourceMeta);
        const voiceAlloc = ensureAutoVoice(entry, assignments);
        assignments[shortId] = entry;
        diag(`codex-session-watcher: registered ${shortId} -> index ${alloc.index} (${alloc.reason}) voice=${voiceAlloc ? voiceAlloc.voice : 'none'}`);
      }
    }
    try {
      const saved = saveAssignments(assignments, 'codex-session-watcher');
      if (saved !== false) {
        try { onAssignmentTouched(shortId); } catch {}
      }
    } catch (e) {
      diag(`codex-session-watcher: assignment touch fail ${shortId}: ${e.message}`);
    }
  }

  function _isHookIdentifiedPluginSession(shortId) {
    if (!SHORT_RE.test(shortId || '')) return false;
    try {
      const assignments = loadAssignments() || {};
      const entry = assignments[shortId];
      return !!(entry && entry.source_kind === 'codex-plugin');
    } catch {
      return false;
    }
  }

  function _purgeQueueFilesForShort(shortId) {
    if (!SHORT_RE.test(shortId || '') || !queueDir) return 0;
    let purged = 0;
    const rx = new RegExp(`-${shortId}(?:\\.original)?\\.(?:mp3|wav|txt)(?:\\.partial)?$`, 'i');
    try {
      for (const name of fsDep.readdirSync(queueDir)) {
        if (!rx.test(name)) continue;
        try {
          fsDep.unlinkSync(path.join(queueDir, name));
          purged += 1;
        } catch {}
      }
    } catch {}
    if (purged > 0) diag(`codex-session-watcher: purged ${purged} plugin queue file(s) for ${shortId}`);
    return purged;
  }

  function _removePluginSession(shortId, reason) {
    if (!SHORT_RE.test(shortId || '') || typeof saveAssignments !== 'function') return false;
    let assignments = {};
    try { assignments = loadAssignments() || {}; } catch {}
    const entry = assignments[shortId];
    if (!entry || entry.source_kind !== 'codex-plugin') return false;
    delete assignments[shortId];
    let saved;
    try { saved = saveAssignments(assignments, 'codex-plugin-cleanup') !== false; } catch (e) {
      diag(`codex-session-watcher: plugin cleanup save fail ${shortId}: ${e.message}`);
      return false;
    }
    if (!saved) return false;
    _writePluginCleanupTombstone(shortId);
    _purgeQueueFilesForShort(shortId);
    try { fsDep.unlinkSync(_workingFlagPath(shortId)); } catch {}
    try { fsDep.unlinkSync(path.join(sessionsDir, `${shortId}-plugin-start-announced.flag`)); } catch {}
    try { fsDep.unlinkSync(path.join(sessionsDir, `${shortId}-plugin-start.json`)); } catch {}
    try { notifyQueue(); } catch {}
    try { onAssignmentTouched(shortId); } catch {}
    diag(`codex-session-watcher: removed finished codex-plugin session ${shortId} (${reason || 'complete'})`);
    return true;
  }

  function _schedulePluginCleanup(state, reason) {
    if (!state || state.terminalSource !== false || !SHORT_RE.test(state.shortId || '')) return;
    if (!_isHookIdentifiedPluginSession(state.shortId)) return;
    if (pluginCleanupTimers.has(state.shortId)) return;
    const delay = Number.isFinite(pluginCleanupDelayMs) && pluginCleanupDelayMs >= 0
      ? pluginCleanupDelayMs
      : DEFAULT_PLUGIN_CLEANUP_DELAY_MS;
    const handle = setTimeout(() => {
      pluginCleanupTimers.delete(state.shortId);
      _removePluginSession(state.shortId, reason);
    }, delay);
    pluginCleanupTimers.set(state.shortId, handle);
    diag(`codex-session-watcher: scheduled codex-plugin cleanup for ${state.shortId} in ${delay}ms (${reason || 'complete'})`);
  }

  function _workingFlagPath(shortId) {
    if (!SHORT_RE.test(shortId || '') || !sessionsDir) return null;
    return path.join(sessionsDir, `${shortId}-working.flag`);
  }

  function _applyWorkingState(state, action) {
    if (!action || !SHORT_RE.test(state.shortId || '')) return;
    const flagPath = _workingFlagPath(state.shortId);
    if (!flagPath) return;
    try {
      if (action === 'mark') {
        fsDep.mkdirSync(sessionsDir, { recursive: true });
        fsDep.writeFileSync(flagPath, String(Math.floor(now() / 1000)), 'utf8');
      } else if (action === 'clear' && fsDep.existsSync(flagPath)) {
        fsDep.unlinkSync(flagPath);
      }
    } catch (e) {
      diag(`codex-session-watcher: working flag ${action} fail ${state.shortId}: ${e.message}`);
    }
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

  function _findRolloutPathForSession(sessionId) {
    const sid = String(sessionId || '').toLowerCase();
    if (!sid || !codexSessionsDir || !fsDep.existsSync(codexSessionsDir)) return null;
    const candidates = _listCandidateFiles().filter((meta) => {
      const parsed = parseSessionIdFromRolloutPath(meta.path);
      return parsed && parsed.toLowerCase() === sid;
    });
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates.length ? candidates[0].path : null;
  }

  function _elapsedFromRolloutSession(sessionId, markerTimestampSec = 0) {
    const rolloutPath = _findRolloutPathForSession(sessionId);
    if (!rolloutPath) return 0;
    let raw;
    try { raw = fsDep.readFileSync(rolloutPath, 'utf8'); } catch { return 0; }
    let turnStartMs = 0;
    let turnEndMs = 0;
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let parsed;
      try { parsed = JSON.parse(line); } catch { continue; }
      const payload = parsed.payload || {};
      const tsMs = parseEventTimestampMs(parsed.timestamp || payload.timestamp);
      if (!tsMs) continue;
      if (parsed.type === 'event_msg') {
        if (payload.type === 'user_message' || payload.type === 'task_started') {
          turnStartMs = tsMs;
          turnEndMs = 0;
        } else if (
          (payload.type === 'agent_message' && (payload.phase === 'final' || payload.phase === 'final_answer'))
          || payload.type === 'task_complete'
          || payload.type === 'turn_aborted'
        ) {
          if (turnStartMs) turnEndMs = tsMs;
        }
      } else if (parsed.type === 'response_item') {
        if (payload.type === 'message' && payload.role === 'user') {
          turnStartMs = tsMs;
          turnEndMs = 0;
        } else if (
          payload.type === 'message'
          || payload.type === 'function_call'
          || payload.type === 'custom_tool_call'
          || payload.type === 'reasoning'
        ) {
          if (turnStartMs) turnEndMs = tsMs;
        }
      }
    }
    if (turnStartMs && !turnEndMs && markerTimestampSec > 0) {
      turnEndMs = Number(markerTimestampSec) * 1000;
    }
    const elapsed = turnStartMs && turnEndMs ? Math.round((turnEndMs - turnStartMs) / 1000) : 0;
    return elapsed > 0 ? elapsed : 0;
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

    const providers = providerOrder(((cfg || {}).playback) || {});
    const voices = ((cfg || {}).voices) || {};
    const customVoice = entry && typeof entry.voice === 'string' ? entry.voice : '';
    let apiKey = null;
    try {
      if (apiKeyStore && typeof apiKeyStore.get === 'function') apiKey = apiKeyStore.get();
    } catch {}

    return {
      muted: !!(entry && entry.muted),
      includes,
      providers,
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

    let lastError = null;
    for (const provider of (routing.providers || ['edge'])) {
      try {
        const out = provider === 'openai' ? await tryOpenAI() : await tryEdge();
        if (out) return out;
      } catch (e) {
        lastError = e;
        diag(`codex-session-watcher: ${provider} synth failed: ${e.message}`);
      }
    }
    if (lastError) throw lastError;
    return null;
  }

  function _isHookIdentifiedSession(shortId) {
    if (!SHORT_RE.test(shortId || '')) return false;
    try {
      const assignments = loadAssignments() || {};
      return !!assignments[shortId];
    } catch {
      return false;
    }
  }

  async function _deliverMessage(state, event, batchSeq) {
    if (!SHORT_RE.test(state.shortId || '')) return;
    _touchAssignment(state.shortId, state.sessionId, state.rolloutMeta);
    const initialRouting = _resolveRouting(state.shortId);
    if (initialRouting.muted) {
      diag(`codex-session-watcher: muted ${state.shortId}; skipping ${event.phase}`);
      return;
    }

    const spoken = stripForTTS(event.message, initialRouting.includes).trim();
    if (!spoken) return;
    const maxChunkLen = event.phase === 'final' ? FINAL_CHUNK_LEN : COMMENTARY_CHUNK_LEN;
    const chunks = chunkText(spoken, maxChunkLen);
    const turnTs = formatQueueTimestamp(event.timestamp);
    const phaseTag = event.phase === 'commentary' ? 'C' : 'F';
    let producedCount = 0;
    let failedCount = 0;

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
      let produced;
      try {
        produced = await _synthesizeChunk(chunks[i], routing, edgeOut, openaiOut);
      } catch (e) {
        failedCount += 1;
        diag(`codex-session-watcher: ${event.phase} chunk ${i + 1}/${chunks.length} failed for ${state.shortId}: ${e.message}`);
        continue;
      }
      if (!produced) continue;
      producedCount += 1;
      writeSpokenSidecar(produced, chunks[i], diag, event.message);
      try { notifyQueue(); } catch {}
    }

    diag(`codex-session-watcher: spoke ${event.phase} for ${state.shortId} (${producedCount}/${chunks.length} chunk(s), failed=${failedCount})`);
  }

  async function _deliverToolNarration(state, event, batchSeq) {
    if (!SHORT_RE.test(state.shortId || '')) return;
    _touchAssignment(state.shortId, state.sessionId, state.rolloutMeta);
    const routing = _resolveRouting(state.shortId);
    if (routing.muted) {
      diag(`codex-session-watcher: muted ${state.shortId}; skipping tool narration`);
      return;
    }
    if (routing.includes && routing.includes.tool_calls === false) return;

    const recentVerbs = Array.isArray(state.recentToolVerbs) ? state.recentToolVerbs : [];
    const variedPhrase = varyToolPhrase(event.phrase, `${event.toolName || ''}|${event.phrase || ''}`, {
      avoidVerbs: recentVerbs.slice(-3),
    });
    const spoken = stripForTTS(variedPhrase, routing.includes).trim();
    if (!spoken) return;
    const verb = leadingToolVerb(spoken);
    if (verb) {
      state.recentToolVerbs = [...recentVerbs, verb].slice(-6);
    }
    const turnTs = formatQueueTimestamp(event.timestamp);
    const seq = String(batchSeq).padStart(4, '0');
    const stem = `${turnTs}-T-${seq}-${state.shortId}`;
    const edgeOut = path.join(queueDir, `${stem}.mp3`);
    const openaiOut = path.join(queueDir, `${stem}.wav`);
    const produced = await _synthesizeChunk(spoken, routing, edgeOut, openaiOut);
    if (!produced) return;
    writeSpokenSidecar(produced, spoken, diag);
    try { notifyQueue(); } catch {}
    diag(`codex-session-watcher: spoke tool narration for ${state.shortId}: ${spoken}`);
  }

  async function _deliverStopCloser(shortId, marker) {
    if (!SHORT_RE.test(shortId || '')) return false;
    _touchAssignment(shortId, marker && marker.session_id ? String(marker.session_id) : shortId);
    const routing = _resolveRouting(shortId);
    if (routing.muted) {
      diag(`codex-session-watcher: muted ${shortId}; skipping stop closer`);
      return false;
    }
    const visibleFooter = humaniseFooterPhrase(marker && marker.footer);
    const accurateElapsed = visibleFooter ? 0 : _elapsedFromRolloutSession(
      marker && marker.session_id ? String(marker.session_id) : '',
      marker && marker.timestamp ? Number(marker.timestamp) : 0
    );
    const elapsed = accurateElapsed || Math.max(0, Math.floor(Number(marker && marker.elapsed_sec) || 0));
    const spoken = visibleFooter || (elapsed >= 1
      ? `Codex worked for ${humaniseDuration(elapsed)}.`
      : 'Codex finished.');
    const turnTs = formatQueueTimestamp(
      marker && marker.timestamp ? new Date(Number(marker.timestamp) * 1000).toISOString() : new Date().toISOString()
    );
    const stem = `${turnTs}-E-0000-${shortId}`;
    const edgeOut = path.join(queueDir, `${stem}.mp3`);
    const openaiOut = path.join(queueDir, `${stem}.wav`);
    const produced = await _synthesizeChunk(spoken, routing, edgeOut, openaiOut);
    if (!produced) return false;
    writeSpokenSidecar(produced, spoken, diag);
    try { notifyQueue(); } catch {}
    const source = visibleFooter ? 'visible footer'
      : accurateElapsed ? 'rollout elapsed'
      : elapsed >= 1 ? 'hook elapsed fallback'
      : 'no duration';
    diag(`codex-session-watcher: spoke stop closer for ${shortId}: ${spoken} (${source})`);
    return true;
  }

  function _findStateForStopMarker(shortId, marker) {
    const markerSessionId = marker && marker.session_id ? String(marker.session_id).toLowerCase() : '';
    for (const state of files.values()) {
      if (!state) continue;
      if (shortId && state.shortId === shortId) return state;
      if (markerSessionId && String(state.sessionId || '').toLowerCase() === markerSessionId) return state;
    }
    return null;
  }

  function _processStopMarkers() {
    if (!sessionsDir || !fsDep.existsSync(sessionsDir)) return;
    let names;
    try { names = fsDep.readdirSync(sessionsDir); } catch { return; }
    for (const name of names) {
      const m = name.match(STOP_MARKER_RE);
      if (!m) continue;
      const shortId = m[1];
      const markerPath = path.join(sessionsDir, name);
      let marker = null;
      try {
        marker = JSON.parse(fsDep.readFileSync(markerPath, 'utf8'));
      } catch (e) {
        diag(`codex-session-watcher: bad stop marker ${name}: ${e.message}`);
      }
      try { fsDep.unlinkSync(markerPath); } catch {}
      if (!marker) continue;
      const state = _findStateForStopMarker(shortId, marker);
      if (state && state.tail && typeof state.tail.then === 'function') {
        state.tail = state.tail
          .then(() => _deliverStopCloser(shortId, marker))
          .catch((e) => {
            diag(`codex-session-watcher: stop closer fail ${shortId}: ${e.message}`);
          });
      } else {
        _deliverStopCloser(shortId, marker).catch((e) => {
          diag(`codex-session-watcher: stop closer fail ${shortId}: ${e.message}`);
        });
      }
    }
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

  function _rememberToolPhrase(state, phrase) {
    const key = String(phrase || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!key) return false;
    const cutoff = now() - TOOL_PHRASE_DEDUP_WINDOW_MS;
    state.recentToolPhrases = (state.recentToolPhrases || []).filter((entry) => entry.at >= cutoff);
    if (state.recentToolPhrases.some((entry) => entry.key === key)) {
      diag(`codex-session-watcher: suppressed repeated tool narration for ${state.shortId}: ${phrase}`);
      return false;
    }
    state.recentToolPhrases.push({ key, at: now() });
    if (state.recentToolPhrases.length > MAX_RECENT_TOOL_PHRASES) state.recentToolPhrases.shift();
    return true;
  }

  function _ensureState(meta) {
    let state = files.get(meta.path);
    if (state) return state;
    const sessionId = parseSessionIdFromRolloutPath(meta.path);
    const shortId = sessionId ? sessionId.slice(0, 8).toLowerCase() : '';
    const rolloutMeta = readCodexRolloutMeta(meta.path, fsDep);
    const terminalSource = isCodexTerminalSource(rolloutMeta);
    const createdMs = meta.birthtimeMs || Number.POSITIVE_INFINITY;
    const existedBeforeBoot = createdMs <= bootMs;
    state = {
      sessionId,
      shortId,
      rolloutSource: rolloutMeta ? rolloutMeta.source : '',
      rolloutOriginator: rolloutMeta ? rolloutMeta.originator : '',
      rolloutMeta,
      terminalSource,
      offset: existedBeforeBoot ? meta.size : 0,
      remainder: '',
      tail: Promise.resolve(),
      nextBatchSeq: 1,
      signatures: [],
      signatureSet: new Set(),
      recentToolPhrases: [],
      recentToolVerbs: [],
      pendingToolCalls: new Map(),
    };
    if (!terminalSource) {
      diag(`codex-session-watcher: non-terminal rollout ${shortId} source=${state.rolloutSource || 'unknown'} originator=${state.rolloutOriginator || 'unknown'} waiting for hook identity`);
    }
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

  function _queueParsedEvent(state, parsed) {
    if (!parsed) return false;
    const { kind, event } = parsed;
    const signature = kind === 'tool'
      ? `tool|${event.callId || event.timestamp}|${event.toolName}|${event.phrase}`
      : `${event.timestamp}|${event.phase}|${event.message}`;
    if (!_rememberSignature(state, signature)) return false;
    if (kind === 'tool' && !_rememberToolPhrase(state, event.phrase)) return false;
    const batchSeq = state.nextBatchSeq++;
    const deliver = kind === 'tool' ? _deliverToolNarration : _deliverMessage;
    state.tail = state.tail
      .then(() => deliver(state, event, batchSeq))
      .catch((e) => {
        diag(`codex-session-watcher: delivery fail ${state.shortId || 'unknown'}: ${e.message}`);
    });
    return true;
  }

  function _queueOrHoldParsedEvent(state, parsed) {
    if (!parsed) return false;
    if (
      parsed.kind === 'tool'
      && parsed.event
      && parsed.event.callId
      && wantsCodexToolResultContext(parsed.event)
    ) {
      state.pendingToolCalls.set(parsed.event.callId, {
        parsed,
        expiresAt: now() + TOOL_RESULT_CONTEXT_WAIT_MS,
      });
      return true;
    }
    return _queueParsedEvent(state, parsed);
  }

  function _applyToolOutputContext(state, outputEvent) {
    if (!outputEvent || !outputEvent.callId || !state.pendingToolCalls) return false;
    const pending = state.pendingToolCalls.get(outputEvent.callId);
    if (!pending) return false;
    state.pendingToolCalls.delete(outputEvent.callId);
    const event = { ...pending.parsed.event };
    event.timestamp = event.timestamp || outputEvent.timestamp;
    event.phrase = enrichCodexToolPhraseWithResult(event.phrase, outputEvent.output);
    return _queueParsedEvent(state, { kind: 'tool', event });
  }

  function _flushExpiredToolContext(state, force = false) {
    if (!state.pendingToolCalls || state.pendingToolCalls.size === 0) return;
    const t = now();
    for (const [callId, pending] of Array.from(state.pendingToolCalls.entries())) {
      if (!force && pending.expiresAt > t) continue;
      state.pendingToolCalls.delete(callId);
      _queueParsedEvent(state, pending.parsed);
    }
  }

  function _processFile(meta) {
    const state = _ensureState(meta);
    if (state.terminalSource === false && !_isHookIdentifiedPluginSession(state.shortId)) return;
    if (requireHookIdentity && !_isHookIdentifiedSession(state.shortId)) {
      if (!state.waitingForHookIdentityLogged) {
        state.waitingForHookIdentityLogged = true;
        diag(`codex-session-watcher: waiting for hook identity before reading ${state.shortId || 'unknown'}`);
      }
      return;
    }
    const delta = _readDelta(meta, state);
    if (!delta) return;

    const combined = state.remainder + delta;
    const lines = combined.split(/\r?\n/);
    state.remainder = combined.endsWith('\n') ? '' : (lines.pop() || '');

    for (const line of lines) {
      const workingState = extractCodexWorkingStateEvent(line);
      if (workingState === 'mark') _touchAssignment(state.shortId, state.sessionId, state.rolloutMeta);
      _applyWorkingState(state, workingState);
      if (workingState === 'clear') _schedulePluginCleanup(state, 'rollout clear');
      _applyToolOutputContext(state, extractCodexToolOutputEvent(line));
      _queueOrHoldParsedEvent(state, extractCodexLineEvent(line));
    }

    const remainderState = extractCodexWorkingStateEvent(state.remainder);
    if (remainderState === 'mark') _touchAssignment(state.shortId, state.sessionId, state.rolloutMeta);
    _applyWorkingState(state, remainderState);
    if (remainderState === 'clear') _schedulePluginCleanup(state, 'rollout clear');
    _applyToolOutputContext(state, extractCodexToolOutputEvent(state.remainder));
    if (_queueOrHoldParsedEvent(state, extractCodexLineEvent(state.remainder))) {
      state.remainder = '';
    }
    _flushExpiredToolContext(state);
  }

  async function _poll() {
    const candidates = _listCandidateFiles();
    const livePaths = new Set(candidates.map((f) => f.path));
    for (const meta of candidates) _processFile(meta);
    _processStopMarkers();
    for (const state of files.values()) _flushExpiredToolContext(state);
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
    for (const handle of pluginCleanupTimers.values()) clearTimeout(handle);
    pluginCleanupTimers.clear();
    diag('codex-session-watcher: stopped');
  }

  return { start, stop };
}

module.exports = {
  createCodexSessionWatcher,
  extractCodexAgentMessageEvent,
  extractCodexSessionMetaEvent,
  extractCodexWorkingStateEvent,
  extractCodexToolCallEvent,
  extractCodexToolOutputEvent,
  isCodexTerminalSource,
  leadingToolVerb,
  humaniseFooterPhrase,
  humaniseDuration,
  narrateCodexToolCallPayload,
  naturalisePath,
  summariseShellCommand,
  varyToolPhrase,
  chunkText,
  parseSessionIdFromRolloutPath,
};
