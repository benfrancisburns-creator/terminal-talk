#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SOURCE_KINDS = [
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
];

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) continue;
  const eq = arg.indexOf('=');
  if (eq >= 0) {
    args.set(arg.slice(2, eq), arg.slice(eq + 1));
  } else {
    args.set(arg.slice(2), process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : 'true');
  }
}

const seconds = Number.parseInt(args.get('seconds') || '180', 10);
const pollMs = Number.parseInt(args.get('poll-ms') || '5000', 10);
const limit = Number.parseInt(args.get('limit') || '30', 10);
const includeExisting = args.get('include-existing') === 'true';

function findCodexBinary() {
  if (process.env.CODEX_EXE && fs.existsSync(process.env.CODEX_EXE)) return process.env.CODEX_EXE;

  const appData = process.env.APPDATA;
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
    if (fs.existsSync(candidate)) return candidate;
  }

  return 'codex';
}

function sourceValue(source) {
  return typeof source === 'string' ? source : JSON.stringify(source);
}

function scrubThread(thread) {
  return {
    id: thread.id,
    source: sourceValue(thread.source),
    cwd: thread.cwd,
    status: thread.status && thread.status.type,
    name: thread.name || thread.title || null,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    path: thread.path,
  };
}

class JsonRpcClient {
  constructor(command, commandArgs) {
    this.nextId = 1;
    this.buffer = '';
    this.pending = new Map();
    this.child = spawn(command, commandArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: command === 'codex',
    });

    this.child.stdout.on('data', (chunk) => this.onStdout(chunk));
    this.child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8').trim();
      if (text) console.log(`[stderr] ${text}`);
    });
    this.child.on('exit', (code, signal) => {
      console.log(`[exit] code=${code} signal=${signal || ''}`);
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
        console.log(`[raw] ${line}`);
        continue;
      }

      if (message.id && this.pending.has(message.id)) {
        const resolve = this.pending.get(message.id);
        this.pending.delete(message.id);
        resolve(message.result || message.error || message);
        continue;
      }

      if (message.method) {
        const method = String(message.method);
        if (method.includes('thread') || method.includes('turn') || method.includes('item')) {
          console.log(`[notification] ${JSON.stringify({ method, params: message.params })}`);
        }
      }
    }
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((resolve) => this.pending.set(id, resolve));
  }

  notify(method, params = {}) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  stop() {
    this.child.kill();
  }
}

async function main() {
  const codex = findCodexBinary();
  console.log(`[codex] ${codex}`);

  const client = new JsonRpcClient(codex, ['app-server', '--listen', 'stdio://', '--analytics-default-enabled']);
  const seen = new Map();

  const init = await client.send('initialize', {
    clientInfo: { name: 'terminal-talk-codex-app-server-watch', version: '0.0.1' },
    capabilities: { experimentalApi: true },
  });
  client.notify('initialized');

  console.log(`[init] ${JSON.stringify({
    codexHome: init.codexHome,
    platformFamily: init.platformFamily,
    platformOs: init.platformOs,
  })}`);

  async function listThreads() {
    const response = await client.send('thread/list', {
      limit,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      sourceKinds: SOURCE_KINDS,
      useStateDbOnly: false,
    });
    return Array.isArray(response.data) ? response.data : [];
  }

  function remember(thread) {
    const key = thread.id || thread.path;
    const signature = JSON.stringify(scrubThread(thread));
    seen.set(key, signature);
  }

  function report(prefix, thread) {
    console.log(`${prefix} ${JSON.stringify(scrubThread(thread))}`);
  }

  const baseline = await listThreads();
  for (const thread of baseline) {
    remember(thread);
    if (includeExisting) report('[existing]', thread);
  }

  const appServerCount = baseline.filter((thread) => sourceValue(thread.source) === 'appServer').length;
  console.log(`[baseline] ${baseline.length} known threads; ${appServerCount} source=appServer. Watching for ${seconds}s.`);

  async function poll() {
    const threads = await listThreads();
    let changes = 0;
    for (const thread of threads) {
      const key = thread.id || thread.path;
      const signature = JSON.stringify(scrubThread(thread));
      if (!seen.has(key)) {
        seen.set(key, signature);
        changes += 1;
        report('[new]', thread);
      } else if (seen.get(key) !== signature) {
        seen.set(key, signature);
        changes += 1;
        report('[updated]', thread);
      }
    }
    if (changes === 0) console.log('[poll] no metadata changes');
  }

  await poll();
  const timer = setInterval(() => {
    poll().catch((error) => console.log(`[poll-error] ${error.message || error}`));
  }, pollMs);

  setTimeout(() => {
    clearInterval(timer);
    client.stop();
  }, seconds * 1000);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
