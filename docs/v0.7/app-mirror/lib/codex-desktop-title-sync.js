'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SOURCE_KINDS = Object.freeze([
  'cli',
  'vscode',
  'exec',
  'appServer',
  'subAgent',
  'subAgentReview',
  'subAgentCompact',
  'subAgentThreadSpawn',
  'subAgentOther',
  'unknown',
]);

const COLOUR_NAMES = Object.freeze([
  'Red',
  'Orange',
  'Yellow',
  'Green',
  'Blue',
  'Magenta',
  'Brown',
  'White',
]);

const COLOUR_MARKERS = Object.freeze([
  '🔴',
  '🟠',
  '🟡',
  '🟢',
  '🔵',
  '🟣',
  '🟤',
  '⚪',
]);

function colourNameForIndex(index) {
  const n = Math.max(0, Math.min(23, Math.floor(Number(index) || 0)));
  return COLOUR_NAMES[n % 8] || 'Colour';
}

function colourMarkerForIndex(index) {
  const n = Math.max(0, Math.min(23, Math.floor(Number(index) || 0)));
  return COLOUR_MARKERS[n % 8] || '●';
}

function isCodexDesktopEntry(shortId, entry) {
  if (!shortId || !entry || typeof entry !== 'object') return false;
  const sourceKind = String(entry.source_kind || '').toLowerCase();
  const source = String(entry.source || '').toLowerCase();
  const originator = String(entry.source_originator || '').toLowerCase();
  const cwd = String(entry.source_cwd || '');
  if (sourceKind === 'codex-desktop') return true;
  if (source === 'vscode' && originator === 'codex desktop') return true;
  return source === 'vscode' && /[\\/]Documents[\\/]Codex[\\/]\d{4}-\d{2}-\d{2}[\\/]/i.test(cwd);
}

function cleanTitlePart(value, maxLen = 80) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function leafFromPath(value) {
  try {
    const leaf = path.basename(String(value || ''));
    return cleanTitlePart(leaf.replace(/[-_]+/g, ' '), 60);
  } catch {
    return '';
  }
}

function cleanExistingThreadName(currentName, shortId = '') {
  let name = String(currentName || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  name = name
    .replace(/^(?:\S+\s+)?TT\s+(?:Red|Orange|Yellow|Green|Blue|Magenta|Brown|White|Colour)\s*(?:(?:[|·-]|Â·)\s*)?/i, '')
    .trim();
  const short = String(shortId || '').toLowerCase();
  for (;;) {
    const before = name;
    if (short) {
      name = name
        .replace(new RegExp(`^(?:TTID\\s+)?${short}\\s*(?:(?:[|·-]|Â·)\\s*)?`, 'i'), '')
        .replace(new RegExp(`\\s*(?:(?:[|·-]|Â·)\\s*)?(?:TTID\\s+)?${short}\\b`, 'ig'), '')
        .trim();
    }
    name = name
      .replace(/^\s*(?:TTID\s+)?[a-f0-9]{1,8}\s*(?:(?:[|·-]|Â·)\s*)/i, '')
      .replace(/\s*(?:(?:[|·-]|Â·)\s*)(?:TTID\s+)?[a-f0-9]{1,8}\s*$/i, '')
      .replace(/\bTTID\s*(?:[|·-]\s*)?/ig, '')
      .replace(/^(?:[|·-]|Â·)\s*/i, '')
      .replace(/\s*(?:[|·-]|Â·)$/i, '')
      .trim();
    if (name === before) break;
  }
  return name;
}

function buildThreadName(shortId, entry, currentName = '') {
  const colour = colourNameForIndex(entry && entry.index);
  const marker = colourMarkerForIndex(entry && entry.index);
  const label = cleanTitlePart(entry && entry.label, 60)
    || cleanTitlePart(cleanExistingThreadName(currentName, shortId), 60)
    || leafFromPath(entry && entry.source_cwd)
    || `Session ${Math.max(1, Math.floor(Number(entry && entry.index) || 0) + 1)}`;
  const identity = `${marker} TT ${colour}`;
  const room = Math.max(20, 120 - identity.length - 3);
  const cleanLabel = cleanTitlePart(label, room);
  const title = `${identity} · ${cleanLabel}`;
  return title.length > 120 ? title.slice(0, 120) : title;
}

function parseRolloutMeta(firstLine) {
  if (!firstLine || typeof firstLine !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(firstLine);
  } catch {
    return null;
  }
  if (!parsed || parsed.type !== 'session_meta' || !parsed.payload) return null;
  const payload = parsed.payload;
  const id = String(payload.id || '').toLowerCase();
  if (!id || id.length < 8) return null;
  return {
    id,
    source: String(payload.source || ''),
    originator: String(payload.originator || ''),
    cwd: String(payload.cwd || ''),
  };
}

function readFirstLine(filePath, fsDep = fs) {
  try {
    const fd = fsDep.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(256 * 1024);
      const bytes = fsDep.readSync(fd, buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytes).toString('utf8').split(/\r?\n/, 1)[0] || '';
    } finally {
      fsDep.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function isCodexDesktopMeta(meta) {
  if (!meta) return false;
  const source = String(meta.source || '').toLowerCase();
  const originator = String(meta.originator || '').toLowerCase();
  const cwd = String(meta.cwd || '');
  if (source === 'vscode' && originator === 'codex desktop') return true;
  return source === 'vscode' && /[\\/]Documents[\\/]Codex[\\/]\d{4}-\d{2}-\d{2}[\\/]/i.test(cwd);
}

function discoverCodexDesktopRollouts(codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions'), fsDep = fs) {
  const out = new Map();
  if (!codexSessionsDir || !fsDep.existsSync(codexSessionsDir)) return out;
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try { entries = fsDep.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !/^rollout-.*\.jsonl$/i.test(entry.name)) continue;
      const meta = parseRolloutMeta(readFirstLine(full, fsDep));
      if (isCodexDesktopMeta(meta)) out.set(meta.id, meta);
    }
  };
  walk(codexSessionsDir, 0);
  return out;
}

function findCodexBinary(env = process.env, fsDep = fs) {
  if (env.CODEX_EXE && fsDep.existsSync(env.CODEX_EXE)) return { command: env.CODEX_EXE, argsPrefix: [], shell: false };

  const appData = env.APPDATA || '';
  if (appData) {
    const candidate = path.join(
      appData,
      'npm',
      'node_modules',
      '@openai',
      'codex',
      'node_modules',
      '@openai',
      'codex-win32-x64',
      'vendor',
      'x86_64-pc-windows-msvc',
      'codex',
      'codex.exe',
    );
    if (fsDep.existsSync(candidate)) return { command: candidate, argsPrefix: [], shell: false };
  }

  return { command: process.platform === 'win32' ? 'cmd.exe' : 'codex', argsPrefix: process.platform === 'win32' ? ['/d', '/s', '/c', 'codex'] : [], shell: false };
}

class CodexJsonRpcClient {
  constructor({ command, argsPrefix = [], spawnFn = spawn, diag = () => {}, timeoutMs = 12000 }) {
    this.nextId = 1;
    this.buffer = '';
    this.pending = new Map();
    this.diag = diag;
    this.timeoutMs = timeoutMs;
    this.child = spawnFn(command, [...argsPrefix, 'app-server', '--listen', 'stdio://', '--analytics-default-enabled'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child.stdout.on('data', (chunk) => this.onStdout(chunk));
    this.child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8').trim();
      if (text) diag(`codex desktop title sync stderr: ${text.slice(0, 500)}`);
    });
    this.child.once('exit', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.resolve({ error: { message: 'codex app-server exited' } });
      }
      this.pending.clear();
    });
  }

  onStdout(chunk) {
    this.buffer += chunk.toString('utf8');
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        pending.resolve(message.result || message.error || message);
      }
    }
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const payload = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
    try {
      this.child.stdin.write(payload);
    } catch (e) {
      return Promise.resolve({ error: { message: e.message } });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve({ error: { message: `${method} timed out` } });
        }
      }, this.timeoutMs);
      this.pending.set(id, { resolve, timer });
    });
  }

  notify(method, params = {}) {
    try {
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    } catch {}
  }

  stop() {
    try { this.child.kill(); } catch {}
  }
}

async function syncCodexDesktopThreadNames(opts = {}) {
  const {
    assignments = {},
    codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions'),
    env = process.env,
    fsDep = fs,
    spawnFn = spawn,
    diag = () => {},
  } = opts;
  const desktopRollouts = discoverCodexDesktopRollouts(codexSessionsDir, fsDep);
  const entries = Object.entries(assignments || {})
    .filter(([shortId, entry]) => {
      if (!/^[a-f0-9]{8}$/i.test(shortId)) return false;
      const threadId = String(entry && entry.session_id || '').toLowerCase();
      return isCodexDesktopEntry(shortId, entry) || desktopRollouts.has(threadId);
    });
  if (entries.length === 0) return { attempted: 0, updated: 0 };

  const binary = findCodexBinary(env, fsDep);
  const client = new CodexJsonRpcClient({ ...binary, spawnFn, diag });
  let updated = 0;
  const results = [];
  try {
    const init = await client.send('initialize', {
      clientInfo: { name: 'terminal-talk-codex-desktop-title-sync', version: '0.0.1' },
      capabilities: { experimentalApi: true },
    });
    if (init && init.error) {
      diag(`codex desktop title sync initialize failed: ${init.error.message || JSON.stringify(init.error)}`);
      return { attempted: entries.length, updated: 0 };
    }
    client.notify('initialized');

    const list = await client.send('thread/list', {
      limit: 100,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      sourceKinds: SOURCE_KINDS,
      useStateDbOnly: false,
    });
    const threads = Array.isArray(list && list.data) ? list.data : [];
    const byId = new Map(threads.map((thread) => [String(thread.id || '').toLowerCase(), thread]));

    for (const [shortId, entry] of entries) {
      const threadId = String(entry.session_id || '').toLowerCase();
      if (!threadId || threadId.length < 8) continue;
      const current = byId.get(threadId);
      const currentName = current && typeof current.name === 'string' ? current.name : '';
      const rolloutMeta = desktopRollouts.get(threadId);
      const titleEntry = {
        ...entry,
        source_cwd: entry.source_cwd || (rolloutMeta && rolloutMeta.cwd) || '',
      };
      const desired = buildThreadName(shortId, titleEntry, currentName);
      if (!desired) continue;
      if (desired === currentName) {
        results.push({
          shortId,
          threadId,
          desired,
          currentName,
          status: 'persisted_pending_refresh',
          sourceMeta: rolloutMeta || null,
          updated: false,
        });
        continue;
      }
      const res = await client.send('thread/name/set', { threadId, name: desired });
      if (res && res.error) {
        diag(`codex desktop title sync set failed ${shortId}: ${res.error.message || JSON.stringify(res.error)}`);
        results.push({
          shortId,
          threadId,
        desired,
        currentName,
        status: 'sync_failed',
        error: res.error.message || JSON.stringify(res.error),
        sourceMeta: rolloutMeta || null,
        updated: false,
      });
      continue;
      }
      updated += 1;
      results.push({
        shortId,
        threadId,
        desired,
        currentName,
        status: 'persisted_pending_refresh',
        sourceMeta: rolloutMeta || null,
        updated: true,
      });
      diag(`codex desktop title sync set ${shortId}: ${desired}`);
    }
  } finally {
    client.stop();
  }
  return { attempted: entries.length, updated, results };
}

module.exports = {
  buildThreadName,
  cleanExistingThreadName,
  colourMarkerForIndex,
  colourNameForIndex,
  discoverCodexDesktopRollouts,
  findCodexBinary,
  isCodexDesktopEntry,
  isCodexDesktopMeta,
  parseRolloutMeta,
  syncCodexDesktopThreadNames,
};
