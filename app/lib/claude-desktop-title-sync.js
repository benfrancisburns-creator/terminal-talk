'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { allocatePaletteIndex } = require('./palette-alloc');
const { colourMarkerForIndex } = require('./palette-identity');
const { ensureAutoVoice } = require('./voice-alloc');

const SHORT_RE = /^[a-f0-9]{8}$/;
const UUID_SHORT_RE = /^([a-f0-9]{8})(?:-|$)/i;
const DEFAULT_RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const CLAUDE_COLOURS = Object.freeze([
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'orange',
  'gray',
]);

function defaultLaunchIntentsPath(env = process.env) {
  const home = env.TT_HOME || path.join(os.homedir(), '.terminal-talk');
  return path.join(home, 'claude-desktop-launch-intents.json');
}

function claudeColourForIndex(index) {
  const n = Math.max(0, Math.min(23, Math.floor(Number(index) || 0)));
  return CLAUDE_COLOURS[n % 8] || 'gray';
}

function cleanTitlePart(value, maxLen = 80) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function cleanPathPart(value) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 4096);
}

function normaliseRootList(roots) {
  if (!roots) return [];
  const list = Array.isArray(roots) ? roots : [roots];
  return list.map((root) => String(root || '').trim()).filter(Boolean);
}

function normaliseComparablePath(value) {
  const clean = cleanPathPart(value);
  if (!clean) return '';
  try {
    return path.resolve(clean).replace(/[\\/]+$/, '').toLowerCase();
  } catch {
    return clean.replace(/[\\/]+$/, '').toLowerCase();
  }
}

function leafFromPath(value) {
  try {
    return cleanTitlePart(path.basename(String(value || '')).replace(/[-_]+/g, ' '), 60);
  } catch {
    return '';
  }
}

function cleanExistingClaudeTitle(currentTitle, shortId = '') {
  let title = cleanTitlePart(currentTitle, 120);
  // Strip the legacy "<emoji> TT <Colour>(/<Colour>)? <separator>?" prefix
  // (kept so existing user titles get rewritten cleanly during the
  // transition to the marker-only format below).
  title = title
    .replace(/^(?:\S+\s+)?TT\s+(?:Red|Orange|Yellow|Green|Blue|Magenta|Brown|White|Colour)(?:\s*\/\s*(?:Red|Orange|Yellow|Green|Blue|Magenta|Brown|White|Colour))?\s*(?:(?:[|·-]|Â·)\s*)?/i, '')
    .trim();
  // Strip the current "<colour/orientation marker> <separator>?" prefix.
  // The dot itself communicates the colour so we no longer need the
  // "TT Yellow" text. Markers come from palette-identity COLOUR_MARKERS:
  // 🔴🟠🟡🟢🔵🟣🟤⚪, with ◓/◐ for split palette orientation.
  title = title
    .replace(/^(?:[\u{1F534}\u{1F7E0}\u{1F7E1}\u{1F7E2}\u{1F535}\u{1F7E3}\u{1F7E4}\u{26AA}]{1,2}|[↕↔◓◐])\s*(?:(?:[|·-]|Â·)\s*)?/u, '')
    .trim();
  const short = String(shortId || '').toLowerCase();
  for (;;) {
    const before = title;
    if (short) {
      title = title
        .replace(new RegExp(`^(?:TTID\\s+)?${short}\\s*(?:[|·-]\\s*)?`, 'i'), '')
        .replace(new RegExp(`\\s*(?:[|·-]\\s*)?(?:TTID\\s+)?${short}\\b`, 'ig'), '')
        .trim();
    }
    title = title
      .replace(/^\s*(?:TTID\s+)?[a-f0-9]{1,8}\s*(?:(?:[|·-]|Â·)\s*)/i, '')
      .replace(/\s*(?:(?:[|·-]|Â·)\s*)(?:TTID\s+)?[a-f0-9]{1,8}\s*$/i, '')
      .replace(/\s+[a-f0-9]{6,8}$/i, '')
      .replace(/\bTTID\s*(?:[|·-]\s*)?/ig, '')
      .replace(/^(?:[|·-]|Â·)\s*/i, '')
      .replace(/\s*(?:[|·-]|Â·)$/i, '')
      .trim();
    if (title === before) break;
  }
  return title;
}

function isClaudeDesktopCodeEntry(shortId, entry) {
  if (!SHORT_RE.test(String(shortId || '').toLowerCase())) return false;
  if (!entry || typeof entry !== 'object') return false;
  if (!String(entry.session_id || '').trim()) return false;
  const sourceKind = String(entry.source_kind || '').toLowerCase();
  const entrypoint = String(entry.claude_code_entrypoint || '').toLowerCase();
  const adapter = String(entry.adapter || '').toLowerCase();
  return sourceKind === 'claude-desktop' && (entrypoint === 'claude-desktop' || adapter === 'hooks');
}

function shortFromCliSessionId(value) {
  const match = String(value || '').toLowerCase().match(UUID_SHORT_RE);
  return match ? match[1] : '';
}

function activityMsForSession(data, fallbackMs = 0) {
  const candidates = [data && data.lastActivityAt, data && data.createdAt, fallbackMs];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function findShortBySessionId(assignments, sessionId) {
  const needle = String(sessionId || '').toLowerCase();
  if (!needle) return '';
  for (const [shortId, entry] of Object.entries(assignments || {})) {
    if (!SHORT_RE.test(String(shortId || '').toLowerCase())) continue;
    if (String(entry && entry.session_id || '').toLowerCase() === needle) return shortId.toLowerCase();
  }
  return '';
}

function cleanLaunchIntent(raw, nowMs = Date.now()) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const token = cleanTitlePart(source.token, 80).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  const label = cleanTitlePart(source.label, 60);
  const indexRaw = Number(source.index);
  const createdAt = Number(source.createdAt);
  const expiresAt = Number(source.expiresAt);
  const projectDir = cleanPathPart(source.projectDir);
  if (!token || !projectDir) return null;
  const created = Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Number(nowMs);
  return {
    token,
    label,
    index: Number.isFinite(indexRaw) ? Math.max(0, Math.min(23, Math.floor(indexRaw))) : -1,
    projectDir,
    createdAt: created,
    expiresAt: Number.isFinite(expiresAt) && expiresAt > created ? expiresAt : created + 30 * 60 * 1000,
  };
}

function readClaudeDesktopLaunchIntents(filePath = defaultLaunchIntentsPath(), fsDep = fs, nowMs = Date.now()) {
  if (!filePath || !fsDep.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fsDep.readFileSync(filePath, 'utf8'));
    const raw = Array.isArray(parsed) ? parsed : Array.isArray(parsed && parsed.intents) ? parsed.intents : [];
    return raw
      .map((entry) => cleanLaunchIntent(entry, nowMs))
      .filter((entry) => entry && entry.expiresAt >= nowMs);
  } catch {
    return [];
  }
}

function writeClaudeDesktopLaunchIntents(filePath, intents, fsDep = fs) {
  if (!filePath) return false;
  try {
    const dir = path.dirname(filePath);
    if (!fsDep.existsSync(dir)) fsDep.mkdirSync(dir, { recursive: true });
    writeJsonAtomic(filePath, { intents: Array.isArray(intents) ? intents : [] }, fsDep);
    return true;
  } catch {
    return false;
  }
}

function addClaudeDesktopLaunchIntent(intent, opts = {}) {
  const fsDep = opts.fsDep || fs;
  const nowMs = Number(opts.nowMs) || Date.now();
  const filePath = opts.filePath || defaultLaunchIntentsPath(opts.env || process.env);
  const clean = cleanLaunchIntent(intent, nowMs);
  if (!clean) return { ok: false, filePath };
  const existing = readClaudeDesktopLaunchIntents(filePath, fsDep, nowMs)
    .filter((entry) => entry.token !== clean.token);
  existing.push(clean);
  const ok = writeClaudeDesktopLaunchIntents(filePath, existing, fsDep);
  return { ok, filePath, intent: clean };
}

function matchClaudeDesktopLaunchIntent(data, meta, intents, nowMs) {
  if (!Array.isArray(intents) || intents.length === 0) return null;
  const origin = normaliseComparablePath(data && (data.originCwd || data.cwd || data.worktreePath));
  const createdMs = activityMsForSession(data, meta && meta.mtimeMs);
  const candidates = [];
  for (const intent of intents) {
    if (!intent || intent.expiresAt < nowMs) continue;
    const project = normaliseComparablePath(intent.projectDir);
    if (!project || !origin) continue;
    const pathMatches = origin === project || origin.startsWith(`${project}${path.sep}`) || origin.startsWith(`${project}/`) || origin.startsWith(`${project}\\`);
    if (!pathMatches) continue;
    if (createdMs > 0 && createdMs < (Number(intent.createdAt) - 30000)) continue;
    candidates.push(intent);
  }
  candidates.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
  return candidates[0] || null;
}

function isRecentSessionFile(data, meta, nowMs, recentWindowMs) {
  if (data && data.isArchived === true) return false;
  if (!Number.isFinite(Number(recentWindowMs)) || Number(recentWindowMs) <= 0) return true;
  const activityMs = activityMsForSession(data, meta && meta.mtimeMs);
  return activityMs > 0 && (Number(nowMs) - activityMs) <= Number(recentWindowMs);
}

function applyClaudeDesktopSessionMetadata(entry, sessionId, data, nowSec) {
  let changed = false;
  const set = (key, value) => {
    if (value == null || value === '') return;
    if (entry[key] === value) return;
    entry[key] = value;
    changed = true;
  };
  const setBool = (key, value) => {
    if (entry[key] === value) return;
    entry[key] = value;
    changed = true;
  };

  set('session_id', sessionId);
  set('source_kind', 'claude-desktop');
  set('source_label', 'Claude Desktop');
  set('source_app', 'Claude');
  set('source_key', `claude-desktop:${sessionId}`);
  set('claude_code_entrypoint', 'claude-desktop');
  if (!entry.adapter) set('adapter', 'desktop-session-file');
  set('source_cwd', cleanPathPart(data && (data.cwd || data.worktreePath || data.originCwd)));
  setBool('pinned', true);
  if (typeof entry.muted !== 'boolean') setBool('muted', false);
  if (typeof entry.focus !== 'boolean') setBool('focus', false);
  if (!Number.isFinite(Number(entry.claude_pid))) {
    entry.claude_pid = 0;
    changed = true;
  }
  if (!entry.label || String(entry.label).trim() === '') {
    entry.label = 'Claude Desktop';
    entry.auto_label = true;
    changed = true;
  } else if (entry.label === 'Claude Desktop' && typeof entry.auto_label !== 'boolean') {
    entry.auto_label = true;
    changed = true;
  }
  if (!Number.isFinite(Number(entry.last_seen)) || Number(entry.last_seen) <= 0) {
    entry.last_seen = nowSec;
    changed = true;
  }

  const caps = entry.capabilities && typeof entry.capabilities === 'object' ? { ...entry.capabilities } : {};
  const desiredCaps = {
    auto_register: true,
    tool_events: entry.adapter === 'hooks',
    response_events: entry.adapter === 'hooks',
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

function registerClaudeDesktopCodeSessions(opts = {}) {
  const {
    assignments = {},
    files = discoverClaudeCodeSessionFiles(opts.roots || candidateClaudeRoots(process.env, opts.fsDep || fs), opts.fsDep || fs),
    nowMs = Date.now(),
    recentWindowMs = DEFAULT_RECENT_WINDOW_MS,
    diag = () => {},
  } = opts;
  const launchIntentsPath = opts.launchIntentsPath || defaultLaunchIntentsPath(process.env);
  const launchIntents = Array.isArray(opts.launchIntents)
    ? opts.launchIntents.map((entry) => cleanLaunchIntent(entry, nowMs)).filter(Boolean)
    : readClaudeDesktopLaunchIntents(launchIntentsPath, opts.fsDep || fs, nowMs);
  const consumedLaunchTokens = new Set();
  let changed = false;
  const registered = [];
  for (const [sessionId, meta] of files.entries()) {
    const data = meta && meta.data ? meta.data : {};
    if (!isRecentSessionFile(data, meta, nowMs, recentWindowMs)) continue;
    const short = findShortBySessionId(assignments, sessionId) || shortFromCliSessionId(sessionId);
    if (!SHORT_RE.test(short)) continue;

    const existing = assignments[short];
    if (existing && String(existing.session_id || '').toLowerCase() !== String(sessionId || '').toLowerCase()) {
      diag(`claude desktop session-file skipped ${sessionId}: short collision with ${short}`);
      continue;
    }

    const wasNew = !existing;
    const entry = existing || {};
    const launchIntent = matchClaudeDesktopLaunchIntent(data, meta, launchIntents, nowMs);
    if (!Number.isFinite(Number(entry.index))) {
      if (launchIntent && launchIntent.index >= 0) {
        entry.index = launchIntent.index;
        changed = true;
      } else {
        const alloc = allocatePaletteIndex(short, assignments, 24);
        if (alloc.evicted) {
          delete assignments[alloc.evicted];
          diag(`claude desktop session-file evicted ${alloc.evicted} for ${short}`);
        }
        entry.index = alloc.index;
        changed = true;
      }
    }

    const nowSec = Math.floor(activityMsForSession(data, meta && meta.mtimeMs) / 1000) || Math.floor(Number(nowMs) / 1000);
    if (applyClaudeDesktopSessionMetadata(entry, sessionId, data, nowSec)) changed = true;
    if (launchIntent) {
      if (launchIntent.index >= 0 && Number(entry.index) !== launchIntent.index) {
        entry.index = launchIntent.index;
        changed = true;
      }
      if (launchIntent.label && entry.label !== launchIntent.label) {
        entry.label = launchIntent.label;
        delete entry.auto_label;
        changed = true;
      }
      const originator = `toolbar-launch:${launchIntent.token}`;
      if (entry.source_originator !== originator) {
        entry.source_originator = originator;
        changed = true;
      }
      consumedLaunchTokens.add(launchIntent.token);
    }
    const voiceAlloc = ensureAutoVoice(entry, assignments);
    if (voiceAlloc) {
      changed = true;
      diag(`claude desktop session-file voice ${short} -> ${voiceAlloc.voice} (${voiceAlloc.reason})`);
    }
    if (wasNew) {
      assignments[short] = entry;
      changed = true;
      registered.push({
        shortId: short,
        sessionId,
        filePath: meta.filePath,
        title: cleanTitlePart(data.title, 120),
      });
      diag(`claude desktop session-file registered ${short}: ${data.title || sessionId}`);
    }
  }
  if (!opts.launchIntents && consumedLaunchTokens.size > 0) {
    const remaining = launchIntents.filter((entry) => !consumedLaunchTokens.has(entry.token) && entry.expiresAt >= nowMs);
    writeClaudeDesktopLaunchIntents(launchIntentsPath, remaining, opts.fsDep || fs);
  }
  return { changed, registered };
}

function buildClaudeDesktopSessionTitle(shortId, entry, currentTitle = '') {
  const marker = colourMarkerForIndex(entry && entry.index);
  const manualLabel = entry && entry.auto_label !== true ? cleanTitlePart(entry.label, 60) : '';
  const label = manualLabel
    || cleanTitlePart(cleanExistingClaudeTitle(currentTitle, shortId), 60)
    || leafFromPath(entry && entry.source_cwd)
    || 'Claude Desktop';
  // Marker + space + label. The dot already communicates the colour and
  // "TT" is implied — dropping that text frees most of the 120-char
  // budget for the user's label.
  const room = Math.max(20, 120 - marker.length - 1);
  const cleanLabel = cleanTitlePart(label, room);
  const title = `${marker} ${cleanLabel}`;
  return title.length > 120 ? title.slice(0, 120) : title;
}

function candidateClaudeRoots(env = process.env, fsDep = fs) {
  const roots = [];
  const push = (value) => {
    const root = String(value || '').trim();
    if (!root || roots.includes(root)) return;
    if (fsDep.existsSync(root)) roots.push(root);
  };
  if (env.CLAUDE_DESKTOP_CONFIG_DIR) push(env.CLAUDE_DESKTOP_CONFIG_DIR);
  push(path.join(os.homedir(), 'AppData', 'Local', 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude'));
  push(path.join(os.homedir(), 'AppData', 'Roaming', 'Claude'));
  return roots;
}

function discoverClaudeCodeSessionFiles(roots = candidateClaudeRoots(), fsDep = fs) {
  const out = new Map();
  const rootList = Array.isArray(roots) ? roots : [roots];
  for (const root of rootList) {
    const sessionsRoot = path.join(String(root || ''), 'claude-code-sessions');
    if (!sessionsRoot || !fsDep.existsSync(sessionsRoot)) continue;
    const walk = (dir, depth) => {
      if (depth > 4) return;
      let entries;
      try { entries = fsDep.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
          continue;
        }
        if (!entry.isFile() || !/^local_[^\\/]+\.json$/i.test(entry.name)) continue;
        let parsed;
        try { parsed = JSON.parse(fsDep.readFileSync(full, 'utf8')); } catch { continue; }
        const cliSessionId = String(parsed.cliSessionId || '').toLowerCase();
        if (!cliSessionId) continue;
        let stat = null;
        try { stat = fsDep.statSync(full); } catch {}
        const mtimeMs = stat && Number.isFinite(Number(stat.mtimeMs)) ? Number(stat.mtimeMs) : 0;
        const activityMs = activityMsForSession(parsed, mtimeMs);
        const existing = out.get(cliSessionId);
        if (!existing || activityMs >= Number(existing.activityMs || 0)) {
          out.set(cliSessionId, { filePath: full, data: parsed, mtimeMs, activityMs });
        }
      }
    };
    walk(sessionsRoot, 0);
  }
  return out;
}

function writeJsonAtomic(filePath, value, fsDep = fs) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tt-title.tmp`;
  fsDep.writeFileSync(tmp, JSON.stringify(value), 'utf8');
  fsDep.renameSync(tmp, filePath);
}

function syncClaudeDesktopGitWorktreeTitle(roots, sessionData, desiredTitle, opts = {}) {
  const fsDep = opts.fsDep || fs;
  const desired = cleanTitlePart(desiredTitle, 120);
  if (!desired) return { changed: false, files: [] };
  const data = sessionData && typeof sessionData === 'object' ? sessionData : {};
  const localSessionId = cleanTitlePart(data.sessionId, 120);
  const worktreePath = normaliseComparablePath(data.worktreePath || data.cwd);
  const currentWorktreeName = cleanTitlePart(data.worktreeName, 120);
  if (!localSessionId && !worktreePath && !currentWorktreeName) return { changed: false, files: [] };

  let changed = false;
  const touched = [];
  for (const root of normaliseRootList(roots)) {
    const filePath = path.join(root, 'git-worktrees.json');
    if (!fsDep.existsSync(filePath)) continue;
    let parsed;
    try { parsed = JSON.parse(fsDep.readFileSync(filePath, 'utf8')); } catch { continue; }
    const worktrees = parsed && parsed.worktrees && typeof parsed.worktrees === 'object'
      ? parsed.worktrees
      : null;
    if (!worktrees) continue;
    let fileChanged = false;
    for (const [key, value] of Object.entries(worktrees)) {
      if (!value || typeof value !== 'object') continue;
      const leasedBy = cleanTitlePart(value.leasedBy, 120);
      const valuePath = normaliseComparablePath(value.path);
      const valueName = cleanTitlePart(value.name, 120);
      const matches = (localSessionId && leasedBy === localSessionId)
        || (worktreePath && valuePath === worktreePath)
        || (currentWorktreeName && (key === currentWorktreeName || valueName === currentWorktreeName));
      if (!matches) continue;
      if (value.name !== desired) {
        value.name = desired;
        fileChanged = true;
      }
      if (key !== desired) {
        const existing = worktrees[desired];
        const canMoveKey = !existing
          || existing === value
          || (cleanTitlePart(existing.leasedBy, 120) === leasedBy && normaliseComparablePath(existing.path) === valuePath);
        if (canMoveKey) {
          worktrees[desired] = value;
          delete worktrees[key];
          fileChanged = true;
        }
      }
    }
    if (!fileChanged) continue;
    try {
      writeJsonAtomic(filePath, parsed, fsDep);
      changed = true;
      touched.push(filePath);
    } catch {}
  }
  return { changed, files: touched };
}

function candidateClaudeTranscriptRoots(env = process.env, fsDep = fs) {
  const roots = [];
  const push = (value) => {
    const root = String(value || '').trim();
    if (!root || roots.includes(root)) return;
    if (fsDep.existsSync(root)) roots.push(root);
  };
  if (env.CLAUDE_CONFIG_DIR) push(path.join(env.CLAUDE_CONFIG_DIR, 'projects'));
  push(path.join(os.homedir(), '.claude', 'projects'));
  return roots;
}

function findClaudeTranscriptFiles(sessionId, opts = {}) {
  const fsDep = opts.fsDep || fs;
  const roots = opts.roots || candidateClaudeTranscriptRoots(opts.env || process.env, fsDep);
  const fileName = `${String(sessionId || '').toLowerCase()}.jsonl`;
  const out = [];
  const rootList = Array.isArray(roots) ? roots : [roots];
  for (const root of rootList) {
    if (!root || !fsDep.existsSync(root)) continue;
    const walk = (dir, depth) => {
      if (depth > 3) return;
      let entries;
      try { entries = fsDep.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (entry.isFile() && entry.name.toLowerCase() === fileName) {
          out.push(full);
        }
      }
    };
    walk(root, 0);
  }
  return out;
}

function appendClaudeTranscriptTitle(sessionId, title, opts = {}) {
  const cleanSessionId = String(sessionId || '').toLowerCase();
  const cleanTitle = cleanTitlePart(title, 120);
  if (!cleanSessionId || !cleanTitle) return { changed: false, files: [] };
  const fsDep = opts.fsDep || fs;
  const files = findClaudeTranscriptFiles(cleanSessionId, opts);
  let changed = false;
  const touched = [];
  for (const filePath of files) {
    let text;
    try { text = fsDep.readFileSync(filePath, 'utf8'); } catch { continue; }
    const tail = text.slice(Math.max(0, text.length - 20000));
    if (tail.includes(`"type":"custom-title"`) && tail.includes(`"customTitle":${JSON.stringify(cleanTitle)}`)) continue;
    const line = JSON.stringify({
      type: 'custom-title',
      customTitle: cleanTitle,
      sessionId: cleanSessionId,
    });
    try {
      fsDep.appendFileSync(filePath, `${text.endsWith('\n') || text.length === 0 ? '' : '\n'}${line}\n`, 'utf8');
      changed = true;
      touched.push(filePath);
    } catch {}
  }
  return { changed, files: touched };
}

function syncClaudeDesktopSessionTitles(opts = {}) {
  const {
    assignments = {},
    roots = null,
    fsDep = fs,
    autoRegister = false,
    recentWindowMs = DEFAULT_RECENT_WINDOW_MS,
    nowMs = Date.now(),
    diag = () => {},
    launchIntents = null,
    launchIntentsPath = null,
    transcriptRoots = null,
  } = opts;
  const rootList = normaliseRootList(roots || candidateClaudeRoots(process.env, fsDep));
  const files = discoverClaudeCodeSessionFiles(rootList, fsDep);
  const registration = autoRegister
    ? registerClaudeDesktopCodeSessions({ assignments, files, nowMs, recentWindowMs, diag, fsDep, launchIntents, launchIntentsPath })
    : { changed: false, registered: [] };
  const results = [];
  let rendererTitleChanged = false;
  for (const [shortId, entry] of Object.entries(assignments || {})) {
    const short = String(shortId || '').toLowerCase();
    if (!isClaudeDesktopCodeEntry(short, entry)) continue;
    const sessionId = String(entry.session_id || '').toLowerCase();
    const meta = files.get(sessionId);
    if (!meta) continue;
    const currentTitle = String(meta.data.title || '');
    const desired = buildClaudeDesktopSessionTitle(short, entry, currentTitle);
    const desiredColour = claudeColourForIndex(entry && entry.index);
    // Track the renderer-known title separately from the disk title.
    // Claude Desktop's renderer doesn't watch the JSON file; its session
    // list is whatever its main process last wrote. So when we overwrite
    // the file, the disk and the renderer diverge, and the UIA rename
    // helper needs the renderer's value to find the row by Name. Capture
    // it the first time we see a session and update it only after a
    // successful UIA rename (the IPC handler writes
    // claude_desktop_renderer_title back on `live_synced`).
    if (!entry.claude_desktop_renderer_title) {
      entry.claude_desktop_renderer_title = currentTitle;
      rendererTitleChanged = true;
    }
    try {
      let titleUpdated = false;
      let worktreeNameUpdated = false;
      if ((meta.data.worktreePath || meta.data.worktreeName || /[\\/]\.claude[\\/]worktrees[\\/]/i.test(String(meta.data.cwd || '')))
        && meta.data.worktreeName !== desired) {
        meta.data.worktreeName = desired;
        worktreeNameUpdated = true;
      }
      if (currentTitle !== desired || meta.data.titleSource !== 'manual' || meta.data.color !== desiredColour || worktreeNameUpdated) {
        meta.data.title = desired;
        meta.data.titleSource = 'manual';
        meta.data.color = desiredColour;
        writeJsonAtomic(meta.filePath, meta.data, fsDep);
        const transcript = appendClaudeTranscriptTitle(sessionId, desired, { fsDep, roots: transcriptRoots || undefined });
        if (transcript.changed) {
          diag(`claude desktop transcript title sync set ${short}: ${desired}`);
        }
        titleUpdated = true;
        diag(`claude desktop title sync set ${short}: ${desired}`);
      }
      const worktree = syncClaudeDesktopGitWorktreeTitle(rootList, meta.data, desired, { fsDep });
      if (worktree.changed) {
        worktreeNameUpdated = true;
        diag(`claude desktop worktree title sync set ${short}: ${desired}`);
      }
      results.push({
        shortId: short,
        sessionId,
        localSessionId: String(meta.data.sessionId || ''),
        // previousTitle is the renderer-known title (what the sidebar row
        // is currently named). The disk file's title may already match
        // `desired` from an earlier watcher pass; the renderer doesn't
        // re-read the file, so its value can lag. The UIA helper uses
        // this to locate the row by Name.
        previousTitle: String(entry.claude_desktop_renderer_title || currentTitle),
        desired,
        desiredColour,
        titleUpdated,
        worktreeNameUpdated,
        status: 'persisted_pending_refresh',
        filePath: meta.filePath,
        worktreeFiles: worktree.files,
      });
    } catch (e) {
      results.push({
        shortId: short,
        sessionId,
        desired,
        status: 'sync_failed',
        error: e && e.message ? e.message : String(e),
        filePath: meta.filePath,
      });
    }
  }
  return {
    ok: true,
    results,
    assignmentsChanged: registration.changed || rendererTitleChanged,
    registered: registration.registered,
  };
}

module.exports = {
  addClaudeDesktopLaunchIntent,
  appendClaudeTranscriptTitle,
  buildClaudeDesktopSessionTitle,
  candidateClaudeRoots,
  claudeColourForIndex,
  cleanExistingClaudeTitle,
  registerClaudeDesktopCodeSessions,
  readClaudeDesktopLaunchIntents,
  syncClaudeDesktopSessionTitles,
};
