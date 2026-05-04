'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { allocatePaletteIndex } = require('./palette-alloc');
const { stripForTTS } = require('./text');

const SHORT_RE = /^[a-f0-9]{8}$/;
const EDGE_VOICE_RE = /^[A-Za-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z]+(?:Multilingual|Expressive)?Neural$/;
const PALETTE_NAMES = Object.freeze({
  red: 0,
  orange: 1,
  yellow: 2,
  green: 3,
  blue: 4,
  magenta: 5,
  brown: 6,
  white: 7,
});

const DEFAULT_CONFIG = Object.freeze({
  voices: {
    edge_response: 'en-GB-RyanNeural',
    edge_clip: 'en-GB-RyanNeural',
  },
  speech_includes: {
    code_blocks: false,
    inline_code: false,
    urls: false,
    headings: true,
    bullet_markers: false,
    image_alt: false,
    tool_calls: true,
  },
});

function defaultTtHome(platform = process.platform, env = process.env) {
  if (env.TT_HOME) return env.TT_HOME;
  if (env.TT_INSTALL_DIR) return env.TT_INSTALL_DIR;
  if (platform === 'linux') {
    return path.join(env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'terminal-talk');
  }
  return path.join(os.homedir(), '.terminal-talk');
}

function configPathFor(ttHome, platform = process.platform, env = process.env) {
  if (env.TT_CONFIG_PATH) return env.TT_CONFIG_PATH;
  if (platform === 'linux' && !env.TT_HOME && !env.TT_INSTALL_DIR) {
    return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'terminal-talk', 'config.json');
  }
  return path.join(ttHome, 'config.json');
}

function readJson(filePath, fallback, fsDep = fs) {
  try {
    return JSON.parse(fsDep.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value, fsDep = fs) {
  const dir = path.dirname(filePath);
  fsDep.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fsDep.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fsDep.renameSync(tmp, filePath);
}

function loadConfig(ttHome, fsDep = fs, env = process.env) {
  const cfg = readJson(configPathFor(ttHome, process.platform, env), {}, fsDep);
  return {
    ...DEFAULT_CONFIG,
    ...cfg,
    voices: { ...DEFAULT_CONFIG.voices, ...(cfg.voices || {}) },
    speech_includes: { ...DEFAULT_CONFIG.speech_includes, ...(cfg.speech_includes || {}) },
  };
}

function loadRegistry(registryPath, fsDep = fs) {
  const data = readJson(registryPath, { assignments: {} }, fsDep);
  return data && typeof data === 'object' && data.assignments && typeof data.assignments === 'object'
    ? data
    : { assignments: {} };
}

function cleanLabel(value, fallback = 'Claude Desktop') {
  const label = String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 60);
  return label || fallback;
}

function cleanPath(value) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 4096);
}

function cleanSourceKind(value) {
  const source = String(value || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return source || 'claude-desktop';
}

function colourIndexFromInput(value) {
  if (Number.isFinite(Number(value))) {
    return Math.max(0, Math.min(23, Math.floor(Number(value))));
  }
  const key = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PALETTE_NAMES, key) ? PALETTE_NAMES[key] : null;
}

function newShortId(assignments) {
  for (let i = 0; i < 20; i++) {
    const short = crypto.randomBytes(4).toString('hex');
    if (!assignments[short]) return short;
  }
  throw new Error('unable to allocate session id');
}

function sessionKeyFromArgs(args) {
  const sourceKind = cleanSourceKind(args.source_kind || args.sourceKind || 'claude-desktop');
  const label = cleanLabel(args.label, sourceKind === 'claude-desktop' ? 'Claude Desktop' : 'Desktop Assistant');
  return String(args.session_key || args.sessionKey || `${sourceKind}:${label}`).slice(0, 180);
}

function findBySessionKey(assignments, sourceKey) {
  for (const [shortId, entry] of Object.entries(assignments || {})) {
    if (entry && entry.source_key === sourceKey && SHORT_RE.test(shortId)) return shortId;
  }
  return '';
}

function publicEntry(shortId, entry) {
  return {
    short_id: shortId,
    label: entry.label || '',
    colour_index: Number(entry.index) || 0,
    voice: entry.voice || '',
    muted: entry.muted === true,
    focus: entry.focus === true,
    source_kind: entry.source_kind || '',
    source_label: entry.source_label || '',
    adapter: entry.adapter || '',
  };
}

function registerSession(args = {}, deps = {}) {
  const fsDep = deps.fsDep || fs;
  const ttHome = deps.ttHome || defaultTtHome(process.platform, deps.env || process.env);
  const registryPath = deps.registryPath || path.join(ttHome, 'session-colours.json');
  const registry = loadRegistry(registryPath, fsDep);
  const assignments = registry.assignments;
  const nowSec = Math.floor((deps.now ? deps.now() : Date.now()) / 1000);
  const sourceKind = cleanSourceKind(args.source_kind || args.sourceKind || 'claude-desktop');
  const label = cleanLabel(args.label, sourceKind === 'claude-desktop' ? 'Claude Desktop' : 'Desktop Assistant');
  const sourceKey = sessionKeyFromArgs({ ...args, source_kind: sourceKind, label });
  const requestedShort = SHORT_RE.test(String(args.short_id || args.shortId || '').toLowerCase())
    ? String(args.short_id || args.shortId).toLowerCase()
    : '';
  const existingShort = requestedShort || findBySessionKey(assignments, sourceKey);
  const shortId = existingShort || newShortId(assignments);
  const existing = assignments[shortId] || {};
  const requestedColour = colourIndexFromInput(args.colour_index ?? args.color_index ?? args.colour ?? args.color);
  const hasExistingIndex = Number.isFinite(Number(existing.index));
  const alloc = requestedColour == null && !hasExistingIndex
    ? allocatePaletteIndex(shortId, assignments, 24)
    : { index: requestedColour == null ? Number(existing.index || 0) : requestedColour, evicted: null };
  if (alloc.evicted) delete assignments[alloc.evicted];

  const voice = typeof args.voice === 'string' && args.voice.trim()
    ? args.voice.trim().slice(0, 80)
    : (existing.voice || '');
  assignments[shortId] = {
    ...existing,
    index: alloc.index,
    session_id: existing.session_id || `mcp-${shortId}`,
    claude_pid: Number(existing.claude_pid) || 0,
    label,
    pinned: args.pinned === false ? false : true,
    muted: args.muted === true ? true : existing.muted === true,
    focus: args.focus === true ? true : existing.focus === true,
    last_seen: nowSec,
    source_kind: sourceKind,
    source_label: cleanLabel(args.source_label || args.sourceLabel, sourceKind === 'claude-desktop' ? 'Claude Desktop' : 'Desktop Assistant'),
    source_app: cleanLabel(args.source_app || args.sourceApp, sourceKind === 'claude-desktop' ? 'Claude' : 'Desktop Assistant'),
    source_key: sourceKey,
    source_cwd: cleanPath(args.project_path || args.projectPath || args.cwd || existing.source_cwd || ''),
    adapter: 'mcp',
    capabilities: {
      auto_register: true,
      tool_events: false,
      response_events: false,
      mcp_speak: true,
      manual_speak_selection: false,
    },
  };
  if (voice) assignments[shortId].voice = voice;
  writeJsonAtomic(registryPath, registry, fsDep);
  return {
    ok: true,
    short_id: shortId,
    session: publicEntry(shortId, assignments[shortId]),
    reused: !!existingShort,
  };
}

function resolveSession(shortId, deps = {}) {
  const fsDep = deps.fsDep || fs;
  const ttHome = deps.ttHome || defaultTtHome(process.platform, deps.env || process.env);
  const registryPath = deps.registryPath || path.join(ttHome, 'session-colours.json');
  const registry = loadRegistry(registryPath, fsDep);
  const short = String(shortId || '').toLowerCase();
  if (!SHORT_RE.test(short)) throw new Error('short_id must be 8 hex characters');
  const entry = registry.assignments[short];
  if (!entry) throw new Error(`unknown Terminal Talk session: ${short}`);
  return { shortId: short, entry, registry, registryPath, ttHome };
}

function updateSession(args = {}, deps = {}) {
  const { shortId, entry, registry, registryPath } = resolveSession(args.short_id || args.shortId, deps);
  const colour = colourIndexFromInput(args.colour_index ?? args.color_index ?? args.colour ?? args.color);
  if (args.label != null) entry.label = cleanLabel(args.label, entry.label || 'Desktop Assistant');
  if (colour != null) entry.index = colour;
  if (args.voice != null) {
    const voice = String(args.voice || '').trim().slice(0, 80);
    if (voice) entry.voice = voice;
    else delete entry.voice;
    entry.voice_auto = false;
  }
  if (typeof args.muted === 'boolean') entry.muted = args.muted;
  if (typeof args.focus === 'boolean') entry.focus = args.focus;
  entry.last_seen = Math.floor((deps.now ? deps.now() : Date.now()) / 1000);
  writeJsonAtomic(registryPath, registry, deps.fsDep || fs);
  return { ok: true, session: publicEntry(shortId, entry) };
}

function formatQueueTimestamp(date = new Date()) {
  const d = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}` +
    `${pad(d.getMilliseconds(), 3)}`
  );
}

function chunkText(text, maxLen = 1000) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];
  const out = [];
  let rest = clean;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf(' ', maxLen);
    if (cut < Math.floor(maxLen * 0.5)) cut = maxLen;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

function synthesizeEdge(text, voice, outPath, deps = {}) {
  const appDir = deps.appDir || path.join(defaultTtHome(), 'app');
  const script = deps.edgeScriptPath || path.join(appDir, 'edge_tts_speak.py');
  const pythonExe = deps.pythonExe || process.env.TT_PYTHON_EXE || 'python';
  const spawnFn = deps.spawnFn || spawn;
  return new Promise((resolve, reject) => {
    const child = spawnFn(pythonExe, [script, voice, outPath], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error('edge-tts timeout'));
    }, 45000);
    if (child.stderr) child.stderr.on('data', (buf) => { err += String(buf); });
    child.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      try {
        const stat = fs.statSync(outPath);
        if (code === 0 && stat.size > 500) {
          resolve(outPath);
          return;
        }
      } catch {}
      reject(new Error(`edge-tts failed${err ? `: ${err.slice(0, 160)}` : ''}`));
    });
    child.stdin.end(text);
  });
}

function queueStem(kind, timestamp, batch, seq, shortId) {
  const k = String(kind || 'response').toLowerCase();
  if (k === 'tool') return `${timestamp}-T-${String(batch).padStart(4, '0')}-${shortId}`;
  if (k === 'heartbeat') return `${timestamp}-H-${String(batch).padStart(4, '0')}-${shortId}`;
  return `${timestamp}-M${String(batch).padStart(4, '0')}-${String(seq).padStart(4, '0')}-${shortId}`;
}

async function speak(args = {}, deps = {}) {
  const { shortId, entry, ttHome } = resolveSession(args.short_id || args.shortId, deps);
  if (entry.muted === true) return { ok: true, short_id: shortId, skipped: 'muted', clips: [] };
  const text = String(args.text || '').trim();
  if (!text) throw new Error('text is required');
  const cfg = loadConfig(ttHome, deps.fsDep || fs, deps.env || process.env);
  const includes = { ...(cfg.speech_includes || {}) };
  if (entry.speech_includes && typeof entry.speech_includes === 'object') {
    for (const [key, value] of Object.entries(entry.speech_includes)) {
      if (typeof value === 'boolean') includes[key] = value;
    }
  }
  const spoken = stripForTTS(text, includes).trim();
  if (!spoken) return { ok: true, short_id: shortId, skipped: 'empty_after_strip', clips: [] };
  const chunks = chunkText(spoken, Number(args.max_chars || args.maxChars) || 1000);
  const queueDir = deps.queueDir || path.join(ttHome, 'queue');
  (deps.fsDep || fs).mkdirSync(queueDir, { recursive: true });
  const appDir = deps.appDir || path.join(ttHome, 'app');
  const voice = EDGE_VOICE_RE.test(String(entry.voice || ''))
    ? entry.voice
    : (cfg.voices && cfg.voices.edge_response) || DEFAULT_CONFIG.voices.edge_response;
  const timestamp = formatQueueTimestamp(new Date(deps.now ? deps.now() : Date.now()));
  const clips = [];
  for (let i = 0; i < chunks.length; i++) {
    const stem = queueStem(args.kind || 'response', timestamp, i + 1, i + 1, shortId);
    const outPath = path.join(queueDir, `${stem}.mp3`);
    await synthesizeEdge(chunks[i], voice, outPath, { ...deps, appDir });
    const base = outPath.slice(0, -4);
    (deps.fsDep || fs).writeFileSync(`${base}.txt`, chunks[i], 'utf8');
    if (text !== chunks[i]) (deps.fsDep || fs).writeFileSync(`${base}.original.txt`, text, 'utf8');
    clips.push({ path: outPath, text: chunks[i] });
  }
  return { ok: true, short_id: shortId, clip_count: clips.length, clips };
}

function markWorking(args = {}, deps = {}) {
  const { shortId, entry, ttHome, registry, registryPath } = resolveSession(args.short_id || args.shortId, deps);
  const fsDep = deps.fsDep || fs;
  const sessionsDir = deps.sessionsDir || path.join(ttHome, 'sessions');
  fsDep.mkdirSync(sessionsDir, { recursive: true });
  const flag = path.join(sessionsDir, `${shortId}-working.flag`);
  const working = args.working !== false && args.state !== false && String(args.state || 'working') !== 'idle';
  if (working) fsDep.writeFileSync(flag, String(Math.floor((deps.now ? deps.now() : Date.now()) / 1000)), 'utf8');
  else {
    try { fsDep.unlinkSync(flag); } catch {}
  }
  entry.last_seen = Math.floor((deps.now ? deps.now() : Date.now()) / 1000);
  writeJsonAtomic(registryPath, registry, fsDep);
  return { ok: true, short_id: shortId, working };
}

function listSessions(_args = {}, deps = {}) {
  const fsDep = deps.fsDep || fs;
  const ttHome = deps.ttHome || defaultTtHome(process.platform, deps.env || process.env);
  const registryPath = deps.registryPath || path.join(ttHome, 'session-colours.json');
  const registry = loadRegistry(registryPath, fsDep);
  const sessions = Object.entries(registry.assignments || {})
    .filter(([shortId]) => SHORT_RE.test(shortId))
    .map(([shortId, entry]) => publicEntry(shortId, entry || {}));
  return { ok: true, sessions };
}

module.exports = {
  listSessions,
  markWorking,
  registerSession,
  sessionKeyFromArgs,
  speak,
  updateSession,
};
