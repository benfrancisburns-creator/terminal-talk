const { app, BrowserWindow, globalShortcut, ipcMain, screen, Menu, clipboard, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Force dark theme so native controls (select dropdowns, scrollbars) render dark.
try { nativeTheme.themeSource = 'dark'; } catch {}

const INSTALL_DIR = path.join(os.homedir(), '.terminal-talk');
const QUEUE_DIR = path.join(INSTALL_DIR, 'queue');
const CONFIG_PATH = path.join(INSTALL_DIR, 'config.json');
const LISTENING_STATE_FILE = path.join(INSTALL_DIR, 'listening.state');
const DIAG_LOG = path.join(QUEUE_DIR, '_toolbar.log');

const DEFAULTS = {
  voices: {
    edge_clip: 'en-GB-SoniaNeural',
    edge_response: 'en-GB-RyanNeural',
    openai_clip: 'shimmer',
    openai_response: 'onyx'
  },
  hotkeys: {
    toggle_window: 'Control+Shift+A',
    speak_clipboard: 'Control+Shift+S',
    toggle_listening: 'Control+Shift+J'
  },
  playback: {
    speed: 1.25
  },
  speech_includes: {
    code_blocks: false,
    inline_code: false,
    urls: false,
    headings: true,
    bullet_markers: false,
    image_alt: false
  },
  openai_api_key: null
};

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      voices: { ...DEFAULTS.voices, ...(parsed.voices || {}) },
      hotkeys: { ...DEFAULTS.hotkeys, ...(parsed.hotkeys || {}) },
      playback: { ...DEFAULTS.playback, ...(parsed.playback || {}) },
      speech_includes: { ...DEFAULTS.speech_includes, ...(parsed.speech_includes || {}) },
      openai_api_key: parsed.openai_api_key ?? null
    };
  } catch { return DEFAULTS; }
}

function saveConfig(cfg) {
  // Atomic: write to .tmp first, then rename. A crash mid-write leaves either
  // the old config or the new config intact -- never a half-written file.
  try {
    const tmp = CONFIG_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
    fs.renameSync(tmp, CONFIG_PATH);
    return true;
  } catch (e) { diag(`saveConfig fail: ${e.message}`); return false; }
}

let CFG = loadConfig();

const MAX_FILES = 20;
const STALE_MS = 60 * 60 * 1000;

if (!fs.existsSync(QUEUE_DIR)) fs.mkdirSync(QUEUE_DIR, { recursive: true });

// 1 MB cap, single rotated backup -> bounded disk use forever.
const LOG_MAX_BYTES = 1024 * 1024;
function rotateLogIfNeeded(filePath) {
  try {
    const st = fs.statSync(filePath);
    if (st.size > LOG_MAX_BYTES) {
      const bak = filePath + '.1';
      try { fs.unlinkSync(bak); } catch {}
      try { fs.renameSync(filePath, bak); } catch {}
    }
  } catch {}
}
function diag(msg) {
  try {
    rotateLogIfNeeded(DIAG_LOG);
    fs.appendFileSync(DIAG_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
}

let win = null;
let watcher = null;
let watchDebounce = null;

function isAudioFile(name) {
  const lower = name.toLowerCase();
  return (lower.endsWith('.wav') || lower.endsWith('.mp3')) && !lower.endsWith('.partial');
}

function getQueueFiles() {
  try {
    return fs.readdirSync(QUEUE_DIR)
      .filter(isAudioFile)
      .map(f => {
        const full = path.join(QUEUE_DIR, f);
        const stat = fs.statSync(full);
        return { name: f, path: full, mtime: stat.mtimeMs, size: stat.size };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, MAX_FILES);
  } catch { return []; }
}

function pruneOldFiles() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(QUEUE_DIR)) {
      const full = path.join(QUEUE_DIR, f);
      // Audio files older than 1 h get pruned.
      if (isAudioFile(f)) {
        try {
          const stat = fs.statSync(full);
          if (now - stat.mtimeMs > STALE_MS) fs.unlinkSync(full);
        } catch {}
        continue;
      }
      // Stale `.partial` orphans (crashed mid-write) -- always safe to remove if older than a minute.
      if (f.endsWith('.partial')) {
        try {
          const stat = fs.statSync(full);
          if (now - stat.mtimeMs > 60_000) fs.unlinkSync(full);
        } catch {}
      }
    }
  } catch {}
}

function pruneSessionsDir() {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) return;
    for (const f of fs.readdirSync(SESSIONS_DIR)) {
      if (!f.endsWith('.json')) continue;
      const pid = parseInt(f.replace('.json', ''), 10);
      if (!pid || !isPidAlive(pid)) {
        try { fs.unlinkSync(path.join(SESSIONS_DIR, f)); } catch {}
      }
    }
  } catch {}
}

function createWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const winWidth = 680;
  const winHeight = 56;
  win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: Math.floor((width - winWidth) / 2),
    y: 12,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    show: false,
    focusable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });
  win.setAlwaysOnTop(true, 'floating');
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('closed', () => { win = null; });
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else { win.show(); win.focus(); }
}

function notifyQueue() {
  if (win && !win.isDestroyed()) {
    const files = getQueueFiles();
    const assignments = ensureAssignmentsForFiles(files);
    win.webContents.send('queue-updated', { files, assignments });
    if (files.length > 0 && !win.isVisible()) win.showInactive();
  }
}

function startWatcher() {
  try {
    watcher = fs.watch(QUEUE_DIR, () => {
      if (watchDebounce) clearTimeout(watchDebounce);
      watchDebounce = setTimeout(notifyQueue, 150);
    });
  } catch {
    setTimeout(startWatcher, 1000);
  }
}

function loadApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
  if (CFG.openai_api_key) return CFG.openai_api_key.trim();
  try {
    const claudeEnv = path.join(os.homedir(), '.claude', '.env');
    const content = fs.readFileSync(claudeEnv, 'utf8');
    const m = content.match(/OPENAI_API_KEY\s*=\s*(.+)/);
    return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : null;
  } catch { return null; }
}

function stripForTTS(text) {
  let t = text;
  const inc = CFG.speech_includes || DEFAULTS.speech_includes;

  // Code blocks: when included, keep content only (drop fences + language tag).
  const codeBlocks = [];
  if (inc.code_blocks) {
    t = t.replace(/```(?:\w+)?\r?\n?([\s\S]*?)```/g, (_m, body) => {
      codeBlocks.push(' ' + body + ' ');
      return `\u0000CB${codeBlocks.length - 1}\u0000`;
    });
  } else {
    t = t.replace(/```[\s\S]*?```/g, ' ');
  }
  if (inc.inline_code) {
    t = t.replace(/`([^`]+)`/g, '$1');
  } else {
    t = t.replace(/`[^`]+`/g, ' ');
  }
  if (!inc.image_alt) t = t.replace(/!\[[^\]]*\]\([^)]+\)/g, ' ');
  else                t = t.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  // Link TEXT always kept, URL always dropped from [text](url)
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  if (!inc.urls) t = t.replace(/https?:\/\/\S+/g, ' ');
  if (!inc.headings) t = t.replace(/^#+\s+.*$/gm, ' ');
  else               t = t.replace(/^#+\s*/gm, '');

  // Markdown emphasis marks always stripped; text survives.
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  t = t.replace(/__([^_]+)__/g, '$1');
  t = t.replace(/\*([^*\n]+)\*/g, '$1');

  if (!inc.bullet_markers) {
    t = t.replace(/^\s*[●⎿▶▸►○·◦▪■□▫]\s*/gm, '');
    t = t.replace(/^\s*[-*+]\s+/gm, '');
    t = t.replace(/^\s*\d+\.\s+/gm, '');
  }

  // Always drop shell prompts, quote prefixes, and tool-use noise.
  t = t.replace(/^\s*\$\s.*$/gm, '');
  t = t.replace(/^\s*>\s+.*$/gm, '');
  t = t.replace(/Ran \d+ .{0,40}hooks?.*/gi, '');

  // Say keyboard modifiers naturally.
  t = t.replace(/Ctrl\+/g, 'control ');
  t = t.replace(/Cmd\+/g, 'command ');

  // Restore preserved code blocks if any.
  if (codeBlocks.length > 0) {
    t = t.replace(/\u0000CB(\d+)\u0000/g, (_, i) => codeBlocks[+i]);
  }

  return t.replace(/\s+/g, ' ').trim();
}

function chunkText(text, maxLen = 3800) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let cur = '';
  for (const s of sentences) {
    if ((cur + ' ' + s).length > maxLen && cur) { chunks.push(cur.trim()); cur = s; }
    else { cur = cur ? cur + ' ' + s : s; }
  }
  if (cur) chunks.push(cur.trim());
  return chunks;
}

const EDGE_SCRIPT = path.join(__dirname, 'edge_tts_speak.py');

function callEdgeTTS(input, voice, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python', [EDGE_SCRIPT, voice, outPath], {
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe']
    });
    let err = '';
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve(outPath);
      else reject(new Error(`edge-tts exit ${code}: ${err.trim().slice(0, 200)}`));
    });
    proc.stdin.end(input, 'utf8');
  });
}

function callOpenAITTS(apiKey, input, voice, outPath) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice,
      input,
      instructions: 'Speak clearly and naturally at a moderate pace. Do not read punctuation aloud.',
      response_format: 'wav'
    });
    const req = https.request({
      hostname: 'api.openai.com',
      port: 443,
      path: '/v1/audio/speech',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body, 'utf8')
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        let errData = '';
        res.on('data', d => errData += d);
        res.on('end', () => reject(new Error(`TTS ${res.statusCode}: ${errData}`)));
        return;
      }
      const tmpPath = outPath + '.partial';
      const stream = fs.createWriteStream(tmpPath);
      res.pipe(stream);
      stream.on('finish', () => { fs.renameSync(tmpPath, outPath); resolve(outPath); });
      stream.on('error', reject);
    });
    req.on('error', reject);
    req.write(body, 'utf8');
    req.end();
  });
}

let keyHelper = null;
function getKeyHelper() {
  if (keyHelper && !keyHelper.killed && keyHelper.exitCode === null) return keyHelper;
  keyHelper = spawn('python', ['-u', path.join(__dirname, 'key_helper.py')], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore']
  });
  keyHelper.on('exit', () => { keyHelper = null; });
  diag('keyHelper started');
  return keyHelper;
}

// Serialize requests so ctrlc/fgtree responses can't interleave on stdout.
let helperChain = Promise.resolve();
function helperRequest(cmd, timeoutMs = 500) {
  const task = () => new Promise((resolve) => {
    try {
      const helper = getKeyHelper();
      let buf = '';
      const onData = (chunk) => {
        buf += chunk.toString();
        const nl = buf.indexOf('\n');
        if (nl >= 0) {
          helper.stdout.off('data', onData);
          resolve(buf.slice(0, nl));
        }
      };
      helper.stdout.on('data', onData);
      helper.stdin.write(cmd + '\n');
      setTimeout(() => { helper.stdout.off('data', onData); resolve(null); }, timeoutMs);
    } catch (e) {
      diag(`helperRequest ${cmd} fail: ${e.message}`);
      resolve(null);
    }
  });
  helperChain = helperChain.then(task, task);
  return helperChain;
}

async function sendCtrlC() { await helperRequest('ctrlc', 200); }

async function getForegroundTree() {
  const line = await helperRequest('fgtree', 500);
  if (!line) return null;
  try { return JSON.parse(line); } catch { return null; }
}

// Detect which Claude Code session owns the currently-focused terminal, if any.
// Returns the 8-char session short, or null if no match (e.g. Chrome/PDF).
// Used to colour-code highlight-to-speak clips with a matching J label.
const SESSIONS_DIR = path.join(INSTALL_DIR, 'sessions');
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
    let liveSessions = [];
    if (fs.existsSync(SESSIONS_DIR)) {
      for (const f of fs.readdirSync(SESSIONS_DIR)) {
        if (!f.endsWith('.json')) continue;
        const pid = parseInt(f.replace('.json', ''), 10);
        if (!pid) continue;
        const full = path.join(SESSIONS_DIR, f);
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

    // Tier 2: only one live Claude Code session exists -- must be that one.
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

async function captureSelection() {
  const original = clipboard.readText();
  const marker = '___TT_CLIP_MARKER___' + Date.now();
  clipboard.writeText(marker);
  diag(`captureSelection: marker written (original len=${original.length})`);
  await sendCtrlC();
  let captured = '';
  const start = Date.now();
  const deadline = start + 3000;
  let polls = 0;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 20));
    polls++;
    const after = clipboard.readText();
    if (after && after !== marker) { captured = after; break; }
  }
  diag(`captureSelection: polls=${polls} elapsed=${Date.now()-start}ms captured.len=${captured.length}`);
  setTimeout(() => { clipboard.writeText(original); }, 300);
  return { captured, original };
}

let clipboardBusy = false;
async function speakClipboard() {
  diag('speakClipboard: TRIGGERED');
  if (clipboardBusy) { diag('speakClipboard: BUSY, skipping'); return; }
  clipboardBusy = true;
  try {
    const { captured } = await captureSelection();
    if (!captured || !captured.trim()) { diag('speakClipboard: EMPTY capture, exit'); return; }
    const text = stripForTTS(captured);
    diag(`speakClipboard: stripped len=${text.length} preview="${text.slice(0,80)}"`);
    if (!text) { diag('speakClipboard: EMPTY after strip, exit'); return; }
    // Reload config so changes from the settings panel apply without restart.
    CFG = loadConfig();
    const apiKey = loadApiKey();
    const chunks = chunkText(text, 3800);
    const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').substring(0, 17);
    const activeSession = await detectActiveSession();
    const sessionTag = activeSession || 'neutral';
    diag(`speakClipboard: session tag = ${sessionTag}, edge voice = ${CFG.voices.edge_clip}`);
    const paths = [];
    for (let i = 0; i < chunks.length; i++) {
      const idx = String(i + 1).padStart(2, '0');
      const edgeOut = path.join(QUEUE_DIR, `${ts}-clip-${sessionTag}-${idx}.mp3`);
      const wavOut = path.join(QUEUE_DIR, `${ts}-clip-${sessionTag}-${idx}.wav`);
      let delivered = null;
      try {
        await callEdgeTTS(chunks[i], CFG.voices.edge_clip, edgeOut);
        delivered = edgeOut;
        diag(`speakClipboard: edge-tts chunk ${idx} OK`);
      } catch (e1) {
        diag(`speakClipboard: edge-tts chunk ${idx} FAIL: ${e1.message}`);
        if (!apiKey) { diag('speakClipboard: no OpenAI key for fallback'); continue; }
        try {
          await callOpenAITTS(apiKey, chunks[i], CFG.voices.openai_clip, wavOut);
          delivered = wavOut;
          diag(`speakClipboard: OpenAI fallback chunk ${idx} OK`);
        } catch (e2) {
          diag(`speakClipboard: OpenAI fallback chunk ${idx} FAIL: ${e2.message}`);
        }
      }
      if (delivered) paths.push(delivered);
    }
    if (paths.length && win && !win.isDestroyed()) {
      if (!win.isVisible()) win.showInactive();
      setTimeout(() => {
        diag(`speakClipboard: priority-play to renderer (${paths.length})`);
        win.webContents.send('priority-play', paths);
      }, 250);
    }
  } finally {
    clipboardBusy = false;
  }
}

const COLOURS_REGISTRY = path.join(INSTALL_DIR, 'session-colours.json');
const SHORT_KEY_RE = /^[a-f0-9]{8}$/;
const VOICE_KEY_RE = /^[A-Za-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z]+(?:Multilingual|Expressive)?Neural$|^(alloy|echo|fable|onyx|nova|shimmer)$/;
const VALID_INCLUDE_KEYS = new Set(['code_blocks','inline_code','urls','headings','bullet_markers','image_alt']);

// Validate + sanitise one registry entry. Returns null if malformed enough to drop.
function sanitiseEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const idx = Number(e.index);
  if (!Number.isFinite(idx) || idx < 0 || idx > 23) return null;
  const out = {
    index: Math.floor(idx),
    session_id: typeof e.session_id === 'string' ? e.session_id.slice(0, 80) : '',
    claude_pid: Number.isFinite(Number(e.claude_pid)) ? Number(e.claude_pid) : 0,
    label: typeof e.label === 'string' ? e.label.slice(0, 60) : '',
    pinned: e.pinned === true,
    muted: e.muted === true,
    last_seen: Number.isFinite(Number(e.last_seen)) ? Number(e.last_seen) : 0
  };
  if (typeof e.voice === 'string' && e.voice.length <= 80 && VOICE_KEY_RE.test(e.voice)) {
    out.voice = e.voice;
  }
  if (e.speech_includes && typeof e.speech_includes === 'object') {
    const inc = {};
    for (const k of Object.keys(e.speech_includes)) {
      if (VALID_INCLUDE_KEYS.has(k) && typeof e.speech_includes[k] === 'boolean') {
        inc[k] = e.speech_includes[k];
      }
    }
    if (Object.keys(inc).length > 0) out.speech_includes = inc;
  }
  return out;
}

function loadAssignments() {
  try {
    let raw = fs.readFileSync(COLOURS_REGISTRY, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.assignments || typeof parsed.assignments !== 'object') return {};
    const clean = {};
    for (const [k, v] of Object.entries(parsed.assignments)) {
      if (!SHORT_KEY_RE.test(k)) continue;
      const e = sanitiseEntry(v);
      if (e) clean[k] = e;
    }
    return clean;
  } catch { return {}; }
}

function writeAssignments(all) {
  try {
    const tmp = COLOURS_REGISTRY + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ assignments: all }, null, 2), 'utf8');
    fs.renameSync(tmp, COLOURS_REGISTRY);
    return true;
  } catch (e) { diag(`writeAssignments fail: ${e.message}`); return false; }
}

function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

const SHORT_END_RE = /-([a-f0-9]{8})\.(wav|mp3)$/i;
const SHORT_CLIP_RE = /-clip-([a-f0-9]{8})-\d+\.(wav|mp3)$/i;

function shortFromFile(name) {
  let m = name.match(SHORT_END_RE);
  if (m) return m[1].toLowerCase();
  m = name.match(SHORT_CLIP_RE);
  if (m) return m[1].toLowerCase();
  return null;
}

// If a queue file references a session short that has no colour assignment yet
// (because its statusline hasn't fired), assign the lowest free index here.
// Whichever writer (this or the statusline) wins, both agree on the outcome.
// MUST stay in lock-step with the prune logic in app/statusline.ps1 + speak-response.ps1.
// Session is considered LIVE if pinned OR PID alive OR last_seen within grace.
const SESSION_GRACE_SEC = 14400; // 4 hours
function isSessionLive(entry, now) {
  if (entry.pinned) return true;
  if (entry.claude_pid && isPidAlive(entry.claude_pid)) return true;
  if (entry.last_seen && (now - entry.last_seen) < SESSION_GRACE_SEC) return true;
  return false;
}

function ensureAssignmentsForFiles(files) {
  const all = loadAssignments();
  let changed = false;
  const now = Math.floor(Date.now() / 1000);

  // Prune ONLY truly dead sessions (PID gone AND grace expired AND not pinned).
  for (const k of Object.keys(all)) {
    if (!isSessionLive(all[k], now)) {
      delete all[k];
      changed = true;
    }
  }

  const busy = new Set(Object.values(all).map(e => e.index));
  for (const f of files) {
    const short = shortFromFile(path.basename(f.path));
    if (!short || all[short]) continue;
    let idx = 0;
    while (busy.has(idx) && idx < 24) idx++;
    if (idx >= 24) {
      let sum = 0;
      for (const ch of short) sum += ch.charCodeAt(0);
      idx = sum % 24;
    }
    all[short] = {
      index: idx,
      session_id: short,
      claude_pid: 0,
      label: '',
      pinned: false,
      last_seen: now
    };
    busy.add(idx);
    changed = true;
    diag(`ensureAssignments: new session ${short} -> index ${idx}`);
  }

  if (changed) writeAssignments(all);
  return all;
}

ipcMain.handle('get-queue', () => {
  const files = getQueueFiles();
  return { files, assignments: ensureAssignmentsForFiles(files) };
});
ipcMain.handle('get-assignments', () => loadAssignments());
ipcMain.handle('get-config', () => CFG);

// Redact secrets from any value before it reaches a log file.
function redactForLog(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const clone = { ...obj };
  if (clone.openai_api_key) clone.openai_api_key = '<redacted>';
  return clone;
}

ipcMain.handle('update-config', (_e, partial) => {
  try {
    diag(`update-config IN: ${JSON.stringify(redactForLog(partial))}`);
    const merged = {
      voices: { ...CFG.voices, ...(partial.voices || {}) },
      hotkeys: { ...CFG.hotkeys, ...(partial.hotkeys || {}) },
      playback: { ...CFG.playback, ...(partial.playback || {}) },
      speech_includes: { ...CFG.speech_includes, ...(partial.speech_includes || {}) },
      openai_api_key: partial.openai_api_key !== undefined ? partial.openai_api_key : CFG.openai_api_key
    };
    const ok = saveConfig(merged);
    CFG = merged;
    diag(`update-config OK: saved=${ok}, edge_response=${merged.voices.edge_response}`);
    return merged;
  } catch (e) { diag(`update-config fail: ${e.message}`); return null; }
});

function saveAssignments(all) {
  try {
    const tmp = COLOURS_REGISTRY + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ assignments: all }, null, 2), 'utf8');
    fs.renameSync(tmp, COLOURS_REGISTRY);
    return true;
  } catch (e) { diag(`saveAssignments fail: ${e.message}`); return false; }
}

// --- Input validation helpers (defend against malformed IPC + corrupt registry) ---
const SHORT_RE = /^[a-f0-9]{8}$/;
const VOICE_RE = /^[A-Za-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z]+(?:Multilingual|Expressive)?Neural$|^(alloy|echo|fable|onyx|nova|shimmer)$/;
const ALLOWED_INCLUDE_KEYS = new Set(['code_blocks','inline_code','urls','headings','bullet_markers','image_alt']);
const MAX_LABEL_LEN = 60;

function validShort(s) { return typeof s === 'string' && SHORT_RE.test(s); }
function validVoice(s) { return typeof s === 'string' && s.length <= 80 && VOICE_RE.test(s); }
function sanitiseLabel(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\r\n\t]/g, ' ').slice(0, MAX_LABEL_LEN).trim();
}

ipcMain.handle('set-session-label', (_e, shortId, label) => {
  if (!validShort(shortId)) return false;
  const all = loadAssignments();
  if (!all[shortId]) return false;
  all[shortId].label = sanitiseLabel(label);
  return saveAssignments(all);
});

ipcMain.handle('set-session-index', (_e, shortId, newIndex) => {
  if (!validShort(shortId)) return false;
  const all = loadAssignments();
  if (!all[shortId]) return false;
  const n = Number(newIndex);
  if (!Number.isFinite(n)) return false;
  all[shortId].index = Math.max(0, Math.min(31, Math.floor(n)));
  all[shortId].pinned = true;
  return saveAssignments(all);
});

// Per-session mute toggle. Muted sessions' clips are filtered from the
// playback queue AND their synth_turn.py invocations skip synthesis entirely
// (see synth_turn.run()). Truly "cut the wire" — no edge-tts calls, no
// queued audio, no CPU on muted background terminals.
ipcMain.handle('set-session-muted', (_e, shortId, muted) => {
  if (!validShort(shortId)) return false;
  if (typeof muted !== 'boolean') return false;
  const all = loadAssignments();
  if (!all[shortId]) return false;
  all[shortId].muted = muted;
  const ok = saveAssignments(all);
  // Broadcast so any open settings panel reflects the change instantly.
  if (ok && win && !win.isDestroyed()) {
    notifyQueue();
  }
  return ok;
});

// Per-session voice override. voiceId=null/empty clears (follow global).
ipcMain.handle('set-session-voice', (_e, shortId, voiceId) => {
  if (!validShort(shortId)) return false;
  const all = loadAssignments();
  if (!all[shortId]) return false;
  if (!voiceId) {
    if (all[shortId].voice) delete all[shortId].voice;
  } else {
    if (!validVoice(voiceId)) return false;
    all[shortId].voice = voiceId;
  }
  return saveAssignments(all);
});

// Per-session speech-includes overrides. value true=force on, false=force off,
// null=clear (follow global default).
ipcMain.handle('set-session-include', (_e, shortId, key, value) => {
  if (!validShort(shortId)) return false;
  if (!ALLOWED_INCLUDE_KEYS.has(key)) return false;
  if (value !== true && value !== false && value !== null && value !== undefined) return false;
  const all = loadAssignments();
  if (!all[shortId]) return false;
  if (!all[shortId].speech_includes) all[shortId].speech_includes = {};
  if (value === null || value === undefined) {
    delete all[shortId].speech_includes[key];
  } else {
    all[shortId].speech_includes[key] = value;
  }
  if (Object.keys(all[shortId].speech_includes).length === 0) {
    delete all[shortId].speech_includes;
  }
  return saveAssignments(all);
});

const WIN_COLLAPSED = { width: 680, height: 56 };
const WIN_EXPANDED = { width: 680, height: 560 };
ipcMain.handle('set-panel-open', (_e, open) => {
  if (!win || win.isDestroyed()) return false;
  const dim = open ? WIN_EXPANDED : WIN_COLLAPSED;
  win.setSize(dim.width, dim.height, true);
  return true;
});
// Verifies a path resolves to a location strictly inside `base`. Defends against
// `..`-segment path traversal (`startsWith` alone is bypassable).
function isPathInside(target, base) {
  try {
    const resolvedTarget = path.resolve(target);
    const resolvedBase = path.resolve(base);
    return resolvedTarget === resolvedBase ||
           resolvedTarget.startsWith(resolvedBase + path.sep);
  } catch { return false; }
}

ipcMain.handle('delete-file', (_e, filePath) => {
  try {
    if (typeof filePath !== 'string' || filePath.length > 4096) return false;
    if (!isPathInside(filePath, QUEUE_DIR)) return false;
    fs.unlinkSync(path.resolve(filePath));
    return true;
  } catch {}
  return false;
});
ipcMain.handle('hide-window', () => { if (win) win.hide(); });

let voiceProc = null;
function isListeningEnabled() {
  try { return fs.readFileSync(LISTENING_STATE_FILE, 'utf8').trim() !== 'off'; }
  catch { return true; }
}
function setListeningState(on) {
  try { fs.writeFileSync(LISTENING_STATE_FILE, on ? 'on' : 'off'); } catch {}
}
// Military-grade safety net: sweep any orphan wake-word listeners.
// Matches only python.exe processes whose command line contains our script
// path, so nothing unrelated gets killed. Runs on start, before every spawn,
// and after every stop (belt-and-braces).
function killOrphanVoiceListeners() {
  if (process.platform !== 'win32') return;
  try {
    const { execFileSync } = require('child_process');
    const psCmd = "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -like '*wake-word-listener*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
    execFileSync('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psCmd], {
      windowsHide: true, timeout: 5000, stdio: 'ignore'
    });
    diag('orphan voice listeners swept');
  } catch (e) {
    diag(`orphan sweep failed: ${e.message}`);
  }
}
function stopVoiceListener() {
  if (voiceProc) {
    try { voiceProc.removeAllListeners('exit'); } catch {}
    const pid = voiceProc.pid;
    voiceProc = null;
    if (pid) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true });
        } else {
          process.kill(pid, 'SIGKILL');
        }
      } catch {}
    }
    diag(`voice listener stopped (pid ${pid})`);
  }
  // Belt-and-braces: Python listener also polls _listening.state and closes
  // its InputStream when off, but sweep orphans regardless.
  killOrphanVoiceListeners();
}
function startVoiceListener() {
  if (voiceProc) return;
  killOrphanVoiceListeners();
  try {
    voiceProc = spawn('python', ['-u', path.join(__dirname, 'wake-word-listener.py')], {
      windowsHide: true,
      detached: false,
      stdio: ['ignore', 'ignore', 'ignore']
    });
    voiceProc.on('exit', (code) => {
      voiceProc = null;
      if (code !== 0 && isListeningEnabled()) setTimeout(startVoiceListener, 5000);
    });
    diag('voice listener started');
  } catch {}
}
function toggleListening() {
  const now = isListeningEnabled();
  setListeningState(!now);
  if (now) { stopVoiceListener(); diag('listening TOGGLED OFF'); }
  else { startVoiceListener(); diag('listening TOGGLED ON'); }
  if (win && !win.isDestroyed()) win.webContents.send('listening-state', !now);
}

app.whenReady().then(() => {
  killOrphanVoiceListeners();
  pruneOldFiles();
  pruneSessionsDir();
  createWindow();
  startWatcher();

  const menu = Menu.buildFromTemplate([{
    label: 'Audio',
    submenu: [
      { label: 'Toggle', accelerator: CFG.hotkeys.toggle_window, click: toggleWindow },
      { label: 'Quit', accelerator: 'Control+Q', click: () => app.quit() }
    ]
  }]);
  Menu.setApplicationMenu(menu);

  globalShortcut.register(CFG.hotkeys.toggle_window, toggleWindow);
  globalShortcut.register(CFG.hotkeys.speak_clipboard, speakClipboard);
  globalShortcut.register(CFG.hotkeys.toggle_listening, toggleListening);
  if (isListeningEnabled()) startVoiceListener();
  else diag('listening DISABLED at startup');
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (watcher) watcher.close();
  if (voiceProc) { try { voiceProc.kill(); } catch {} }
  if (keyHelper) { try { keyHelper.kill(); } catch {} }
});

app.on('window-all-closed', (e) => { e.preventDefault(); });
