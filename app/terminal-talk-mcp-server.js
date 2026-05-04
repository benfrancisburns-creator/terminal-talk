#!/usr/bin/env node
'use strict';

const {
  listSessions,
  markWorking,
  registerSession,
  speak,
  updateSession,
} = require('./lib/terminal-talk-mcp-tools');

const PROTOCOL_VERSION = '2025-03-26';

function tool(name, description, properties, required = []) {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties,
      required,
    },
  };
}

const TOOLS = [
  tool('terminal_talk_register_session',
    'Register or reuse a Terminal Talk audio session for external desktop assistants only. Claude Code and Codex sessions should not call this manually because hooks and Desktop session-file watchers auto-register them.',
    {
      label: { type: 'string', description: 'Human-readable session label, for example "Claude Desktop".' },
      source_kind: { type: 'string', description: 'Source kind, default "claude-desktop".' },
      session_key: { type: 'string', description: 'Stable key to reuse the same Terminal Talk row across calls.' },
      project_path: { type: 'string', description: 'Optional project path or workspace root.' },
      voice: { type: 'string', description: 'Optional Edge TTS voice id.' },
      colour: { type: ['string', 'number'], description: 'Optional colour name or palette index.' },
      muted: { type: 'boolean' },
      focus: { type: 'boolean' },
    }),
  tool('terminal_talk_speak',
    'Speak text through Terminal Talk under an existing registered session.',
    {
      short_id: { type: 'string', description: 'Terminal Talk 8-character session id returned by register_session.' },
      text: { type: 'string', description: 'Text to synthesize and queue.' },
      kind: { type: 'string', enum: ['response', 'notification', 'tool', 'heartbeat'], default: 'response' },
      max_chars: { type: 'number', description: 'Optional maximum characters per audio chunk.' },
    }, ['short_id', 'text']),
  tool('terminal_talk_mark_working',
    'Mark a Terminal Talk session as working or idle for heartbeat/visual state.',
    {
      short_id: { type: 'string' },
      working: { type: 'boolean' },
      state: { type: 'string', enum: ['working', 'idle'] },
    }, ['short_id']),
  tool('terminal_talk_set_session',
    'Update Terminal Talk session label, colour, voice, mute, or focus state.',
    {
      short_id: { type: 'string' },
      label: { type: 'string' },
      colour: { type: ['string', 'number'] },
      colour_index: { type: 'number' },
      voice: { type: 'string' },
      muted: { type: 'boolean' },
      focus: { type: 'boolean' },
    }, ['short_id']),
  tool('terminal_talk_list_sessions',
    'List Terminal Talk sessions and basic state. Does not expose transcript contents.',
    {}),
];

function respond(id, result) {
  if (id === undefined) return;
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function respondError(id, code, message, data) {
  if (id === undefined) return;
  const error = { code, message };
  if (data !== undefined) error.data = data;
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error })}\n`);
}

function textResult(value) {
  return {
    content: [{
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    }],
  };
}

async function callTool(name, args) {
  if (name === 'terminal_talk_register_session') return textResult(registerSession(args || {}));
  if (name === 'terminal_talk_speak') return textResult(await speak(args || {}));
  if (name === 'terminal_talk_mark_working') return textResult(markWorking(args || {}));
  if (name === 'terminal_talk_set_session') return textResult(updateSession(args || {}));
  if (name === 'terminal_talk_list_sessions') return textResult(listSessions(args || {}));
  throw new Error(`unknown tool: ${name}`);
}

async function handleRequest(msg) {
  if (!msg || typeof msg !== 'object') return;
  const id = msg.id;
  try {
    if (msg.method === 'initialize') {
      respond(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'terminal-talk', version: '0.6.0' },
      });
      return;
    }
    if (msg.method === 'ping') {
      respond(id, {});
      return;
    }
    if (msg.method === 'tools/list') {
      respond(id, { tools: TOOLS });
      return;
    }
    if (msg.method === 'tools/call') {
      const params = msg.params || {};
      respond(id, await callTool(String(params.name || ''), params.arguments || {}));
      return;
    }
    if (msg.method && msg.method.startsWith('notifications/')) return;
    respondError(id, -32601, `method not found: ${msg.method || ''}`);
  } catch (e) {
    respondError(id, -32000, e && e.message ? e.message : String(e));
  }
}

async function handleLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    process.stderr.write(`[terminal-talk-mcp] invalid json: ${e.message}\n`);
    return;
  }
  if (Array.isArray(parsed)) {
    for (const msg of parsed) await handleRequest(msg);
    return;
  }
  await handleRequest(parsed);
}

if (process.argv.includes('--self-test')) {
  process.stdout.write(JSON.stringify({ ok: true, tools: TOOLS.map((t) => t.name) }) + '\n');
  process.exit(0);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || '';
  (async () => {
    for (const line of lines) await handleLine(line);
  })().catch((e) => {
    process.stderr.write(`[terminal-talk-mcp] ${e && e.stack ? e.stack : e}\n`);
  });
});
process.stdin.on('end', () => {
  if (!buffer.trim()) return;
  handleLine(buffer).catch((e) => {
    process.stderr.write(`[terminal-talk-mcp] ${e && e.stack ? e.stack : e}\n`);
  });
});
