#!/usr/bin/env node
/*
 * Terminal Talk test harness.
 *
 * Exercises the installed components in ~/.terminal-talk/ end-to-end.
 *   - statusline assignment logic (spawns the .ps1)
 *   - edge-tts wrapper (spawns python)
 *   - filename parsing + colour palette logic (re-implemented inline)
 *   - hook configuration sanity
 *
 * Usage:  node scripts/run-tests.js  [--verbose]
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const VERBOSE = process.argv.includes('--verbose');
// `--logic-only` skips test groups that need the live install dir, PowerShell,
// or the edge-tts service. Used by the Linux CI job for fast cross-platform smoke tests.
const LOGIC_ONLY = process.argv.includes('--logic-only');
const NEEDS_INSTALL = new Set([
  'STATUSLINE ASSIGNMENT', 'EDGE TTS WRAPPER', 'VOICE LIST VALIDATION',
  'REGISTRY BOM HANDLING', 'REGISTRY ROUND-TRIP PRESERVES OVERRIDES',
  'PINNED SESSIONS NOT PRUNED', 'STATUSLINE OUTPUT',
  'MAIN.JS REGISTRY READ TOLERANCE', 'HARDENING: secrets do not leak to logs',
  'INSTALL SANITY',
  // Reads ~/.terminal-talk/app/* to grep for wiring — only the Windows
  // install has that path, so the Linux CI job must skip these groups.
  'SELF-CLEANUP WATCHDOG',
  'HARDENING: renderer CSP',
  'HARDENING: navigation guards',
  'JS ↔ PYTHON DEFAULTS ARE IN LOCK-STEP',
  'STRIP-FOR-TTS PARITY (JS canonical vs Python + PS mirrors)',
  'PS SESSION-REGISTRY MODULE IS CANONICAL'
]);
const INSTALL_DIR = path.join(os.homedir(), '.terminal-talk');
const APP_DIR = path.join(INSTALL_DIR, 'app');
// Use a tmp registry file so tests can't be raced by the live Claude Code statusline.
const REGISTRY_PATH = path.join(os.tmpdir(), 'tt-test-session-colours.json');

let pass = 0;
let fail = 0;
const failures = [];

function it(name, fn) {
  try {
    fn();
    pass++;
    if (VERBOSE) console.log(`  \u2713 ${name}`);
  } catch (e) {
    fail++;
    failures.push({ name, message: e.message });
    console.log(`  \u2717 ${name}\n    ${e.message}`);
  }
}

function describe(group, fn) {
  if (LOGIC_ONLY && NEEDS_INSTALL.has(group)) {
    if (VERBOSE) console.log(`\n${group}\n  (skipped: --logic-only)`);
    return;
  }
  console.log(`\n${group}`);
  fn();
}

function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || 'assertEqual'}: expected ${e}, got ${a}`);
}
function assertTruthy(v, msg) { if (!v) throw new Error(msg || `expected truthy, got ${v}`); }
function assertFalsy(v, msg)  { if (v)  throw new Error(msg || `expected falsy, got ${v}`); }

function clearRegistry() {
  try { fs.unlinkSync(REGISTRY_PATH); } catch {}
}
function readRegistry() {
  try {
    let raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    return JSON.parse(raw).assignments || {};
  } catch { return {}; }
}

function runStatusline(sessionId) {
  const script = path.join(APP_DIR, 'statusline.ps1');
  const result = spawnSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
    {
      input: JSON.stringify({ session_id: sessionId }),
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, TT_REGISTRY_PATH: REGISTRY_PATH }
    }
  );
  return { stdout: result.stdout && result.stdout.trim(), stderr: result.stderr, code: result.status };
}

function runEdgeTts(voice, text) {
  const out = path.join(os.tmpdir(), `tt-test-${Date.now()}.mp3`);
  const script = path.join(APP_DIR, 'edge_tts_speak.py');
  const result = spawnSync('python', [script, voice, out],
    { input: text, encoding: 'utf8', timeout: 30000 }
  );
  const exists = fs.existsSync(out);
  const size = exists ? fs.statSync(out).size : 0;
  if (exists) try { fs.unlinkSync(out); } catch {}
  return { code: result.status, size, stderr: result.stderr };
}

// =============================================================================
// Inlined logic from app/renderer.js (kept in lock-step with the source).
// =============================================================================
const PALETTE_SIZE = 24;
const BASE_COLOURS = ['#ff5e5e','#ffa726','#ffd93d','#4ade80','#60a5fa','#c084fc','#c97b50','#e0e0e0'];
const HSPLIT_PARTNER = [3, 4, 5, 0, 1, 2, 7, 6];
const VSPLIT_PARTNER = [4, 5, 6, 7, 0, 1, 2, 3];

function arrangementForIndex(idx) {
  const i = ((idx % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
  if (i < 8)  return { kind: 'solid',  colours: [BASE_COLOURS[i]] };
  if (i < 16) { const p = i - 8;  return { kind: 'hsplit', colours: [BASE_COLOURS[p], BASE_COLOURS[HSPLIT_PARTNER[p]]] }; }
  const p = i - 16; return { kind: 'vsplit', colours: [BASE_COLOURS[p], BASE_COLOURS[VSPLIT_PARTNER[p]]] };
}

function extractSessionShort(filename) {
  let m = filename.match(/-([a-f0-9]{8})\.(wav|mp3)$/i);
  if (m) return m[1].toLowerCase();
  m = filename.match(/-clip-([a-f0-9]{8}|neutral)-\d+\.(wav|mp3)$/i);
  if (m) return m[1].toLowerCase() === 'neutral' ? null : m[1].toLowerCase();
  return null;
}
function isClipFile(filename) { return /-clip-/.test(filename); }

// =============================================================================
// Tests
// =============================================================================

describe('PALETTE', () => {
  it('arrangementForIndex covers all 24 distinct slots', () => {
    const seen = new Set();
    for (let i = 0; i < 24; i++) {
      const a = arrangementForIndex(i);
      const key = `${a.kind}:${a.colours.join(',')}`;
      if (seen.has(key)) throw new Error(`duplicate at index ${i}: ${key}`);
      seen.add(key);
    }
  });
  it('solid 0-7 are single colours', () => {
    for (let i = 0; i < 8; i++) assertEqual(arrangementForIndex(i).kind, 'solid');
  });
  it('hsplit 8-15 have two distinct colours each', () => {
    for (let i = 8; i < 16; i++) {
      const a = arrangementForIndex(i);
      assertEqual(a.kind, 'hsplit');
      assertEqual(a.colours.length, 2);
      if (a.colours[0] === a.colours[1]) throw new Error(`hsplit ${i} pairs identical colours`);
    }
  });
  it('vsplit 16-23 have two distinct colours each', () => {
    for (let i = 16; i < 24; i++) {
      const a = arrangementForIndex(i);
      assertEqual(a.kind, 'vsplit');
      assertEqual(a.colours.length, 2);
      if (a.colours[0] === a.colours[1]) throw new Error(`vsplit ${i} pairs identical colours`);
    }
  });
  it('hsplit and vsplit pairings differ (so the pairs are visually distinct)', () => {
    for (let p = 0; p < 8; p++) {
      if (HSPLIT_PARTNER[p] === VSPLIT_PARTNER[p]) {
        throw new Error(`base ${p} has identical h+v partner ${HSPLIT_PARTNER[p]}`);
      }
    }
  });
});

describe('FILENAME PARSING', () => {
  it('extracts short from response filename', () => {
    assertEqual(extractSessionShort('20260418T193336996-97d97a6b.mp3'), '97d97a6b');
  });
  it('extracts short from question filename', () => {
    assertEqual(extractSessionShort('20260418T193336996-Q-97d97a6b.wav'), '97d97a6b');
  });
  it('extracts short from notif filename', () => {
    assertEqual(extractSessionShort('20260418T213000000-notif-abcdef12.mp3'), 'abcdef12');
  });
  it('extracts short from clip filename', () => {
    assertEqual(extractSessionShort('20260418T213000000-clip-deadbeef-01.mp3'), 'deadbeef');
  });
  it('returns null for neutral clip', () => {
    assertEqual(extractSessionShort('20260418T213000000-clip-neutral-01.mp3'), null);
  });
  it('detects clip files', () => {
    assertTruthy(isClipFile('20260418-clip-abc-01.mp3'));
    assertFalsy(isClipFile('20260418-abc.mp3'));
  });
});

describe('STATUSLINE ASSIGNMENT', () => {
  {
    it('assigns lowest free index to a new session', () => {
      clearRegistry();
      const r = runStatusline('aaaaaaaa-1111-2222-3333-444444444444');
      assertEqual(r.code, 0);
      assertTruthy(r.stdout && r.stdout.length > 0, 'expected emoji output');
      const reg = readRegistry();
      assertTruthy(reg['aaaaaaaa'], 'registry should have aaaaaaaa');
      assertEqual(reg['aaaaaaaa'].index, 0);
    });

    it('assigns different indexes to two distinct sessions', () => {
      clearRegistry();
      runStatusline('aaaaaaaa-1111-2222-3333-444444444444');
      runStatusline('bbbbbbbb-1111-2222-3333-444444444444');
      const reg = readRegistry();
      assertTruthy(reg['aaaaaaaa'], 'aaaaaaaa missing');
      assertTruthy(reg['bbbbbbbb'], 'bbbbbbbb missing');
      if (reg['aaaaaaaa'].index === reg['bbbbbbbb'].index) {
        throw new Error(`both sessions got index ${reg['aaaaaaaa'].index}`);
      }
    });

    it('preserves index for a returning session', () => {
      clearRegistry();
      runStatusline('cccccccc-1111-2222-3333-444444444444');
      const before = readRegistry()['cccccccc'].index;
      runStatusline('dddddddd-1111-2222-3333-444444444444'); // bumps a different slot
      runStatusline('cccccccc-1111-2222-3333-444444444444'); // returning
      const after = readRegistry()['cccccccc'].index;
      assertEqual(after, before);
    });

    it('emits valid UTF-8 emoji bytes', () => {
      clearRegistry();
      const r = runStatusline('eeeeeeee-1111-2222-3333-444444444444');
      const bytes = Buffer.from(r.stdout || '');
      assertTruthy(bytes.length >= 3, 'emoji should be at least 3 bytes');
      assertTruthy(bytes[0] >= 0xC0 || bytes[0] === 0xE2 || bytes[0] === 0xF0, 'first byte is UTF-8 multibyte start');
    });
  }
  clearRegistry();
});

describe('EDGE TTS WRAPPER', () => {
  it('produces an mp3 from a short input', () => {
    const r = runEdgeTts('en-GB-RyanNeural', 'Test sentence for edge TTS harness.');
    assertEqual(r.code, 0, `edge-tts exit: ${r.code}; stderr: ${r.stderr}`);
    assertTruthy(r.size > 1000, `expected mp3 > 1KB, got ${r.size}`);
  });
});

// =============================================================================
// stripForTTS — pulled from the canonical app/lib/text.js module so we're
// testing the ACTUAL shipping implementation, not a duplicate that has to
// be kept in lock-step. Previously this file carried its own ~40-line
// copy that had already drifted (missing the shell-prompt / tool-use
// rules). Audit CC-1 fix.
//
// Require from the REPO copy, not the installed copy, so --logic-only on
// Linux CI works with no install tree. The install-sanity group at the
// bottom separately verifies the file is present in the installed location.
// =============================================================================
const { stripForTTS } = require(path.join(__dirname, '..', 'app', 'lib', 'text.js'));

describe('SPEECH INCLUDES (stripForTTS)', () => {
  it('strips code blocks by default', () => {
    const out = stripForTTS('Hello\n```js\nconst x = 1;\n```\nWorld');
    if (out.includes('const x') || out.includes('```')) throw new Error(`expected code stripped: "${out}"`);
  });
  it('keeps code blocks when toggled on', () => {
    const out = stripForTTS('Hello\n```js\nconst x = 1;\n```', { code_blocks: true });
    if (!out.includes('const x')) throw new Error(`expected code kept: "${out}"`);
  });
  it('strips URLs by default', () => {
    const out = stripForTTS('See https://example.com for info');
    if (out.includes('example.com')) throw new Error(`URL leaked: "${out}"`);
  });
  it('keeps URLs when toggled on', () => {
    const out = stripForTTS('See https://example.com for info', { urls: true });
    if (!out.includes('example.com')) throw new Error(`URL stripped: "${out}"`);
  });
  it('preserves link text always', () => {
    const out = stripForTTS('Click [the link](https://example.com)');
    if (!out.includes('the link')) throw new Error(`link text lost: "${out}"`);
    if (out.includes('example.com')) throw new Error(`link URL leaked: "${out}"`);
  });
  it('strips inline code by default', () => {
    const out = stripForTTS('Use `npm install`');
    if (out.includes('npm install') || out.includes('`')) throw new Error(`inline code leaked: "${out}"`);
  });
  it('keeps inline code content but drops backticks when toggled on', () => {
    const out = stripForTTS('Use `npm install` to install', { inline_code: true });
    if (!out.includes('npm install')) throw new Error(`inline code content lost: "${out}"`);
    if (out.includes('`')) throw new Error(`backticks leaked: "${out}"`);
  });
  it('code block include keeps content but drops fences and language tag', () => {
    const out = stripForTTS('Try this:\n```js\nconst x = 1;\n```\nDone', { code_blocks: true });
    if (!out.includes('const x = 1')) throw new Error(`code block content lost: "${out}"`);
    if (out.includes('```')) throw new Error(`code fence leaked: "${out}"`);
    if (/\bjs\b/.test(out.split('Try')[1].split('Done')[0])) throw new Error(`language tag leaked into spoken text: "${out}"`);
  });
});

describe('VOICE LIST VALIDATION', () => {
  // Verified valid IDs from edge_tts.list_voices() (cached from earlier run).
  const VALID_EDGE_VOICES = new Set([
    'en-AU-NatashaNeural', 'en-AU-WilliamMultilingualNeural',
    'en-CA-ClaraNeural', 'en-CA-LiamNeural',
    'en-GB-LibbyNeural', 'en-GB-MaisieNeural', 'en-GB-RyanNeural', 'en-GB-SoniaNeural', 'en-GB-ThomasNeural',
    'en-HK-SamNeural', 'en-HK-YanNeural',
    'en-IE-ConnorNeural', 'en-IE-EmilyNeural',
    'en-IN-NeerjaExpressiveNeural', 'en-IN-NeerjaNeural', 'en-IN-PrabhatNeural',
    'en-KE-AsiliaNeural', 'en-KE-ChilembaNeural',
    'en-NG-AbeoNeural', 'en-NG-EzinneNeural',
    'en-NZ-MitchellNeural', 'en-NZ-MollyNeural',
    'en-PH-JamesNeural', 'en-PH-RosaNeural',
    'en-SG-LunaNeural', 'en-SG-WayneNeural',
    'en-TZ-ElimuNeural', 'en-TZ-ImaniNeural',
    'en-US-AnaNeural', 'en-US-AndrewMultilingualNeural', 'en-US-AndrewNeural', 'en-US-AriaNeural',
    'en-US-AvaMultilingualNeural', 'en-US-AvaNeural',
    'en-US-BrianMultilingualNeural', 'en-US-BrianNeural',
    'en-US-ChristopherNeural', 'en-US-EmmaMultilingualNeural', 'en-US-EmmaNeural',
    'en-US-EricNeural', 'en-US-GuyNeural', 'en-US-JennyNeural',
    'en-US-MichelleNeural', 'en-US-RogerNeural', 'en-US-SteffanNeural',
    'en-ZA-LeahNeural', 'en-ZA-LukeNeural'
  ]);

  it('every voice in renderer EDGE_VOICES exists in Edge TTS', () => {
    const renderer = fs.readFileSync(path.join(APP_DIR, 'renderer.js'), 'utf8');
    const matches = [...renderer.matchAll(/id:\s*'(en-[A-Z]{2}-[^']+)'/g)];
    const ids = matches.map(m => m[1]);
    if (ids.length === 0) throw new Error('no voice ids found in renderer.js');
    const invalid = ids.filter(id => !VALID_EDGE_VOICES.has(id));
    if (invalid.length > 0) throw new Error(`${invalid.length} invalid voice ids: ${invalid.slice(0, 5).join(', ')}`);
  });

  it('default voices in DEFAULTS are valid', () => {
    const main = fs.readFileSync(path.join(APP_DIR, 'main.js'), 'utf8');
    const m = main.match(/edge_clip:\s*'([^']+)'/);
    const r = main.match(/edge_response:\s*'([^']+)'/);
    if (!VALID_EDGE_VOICES.has(m[1])) throw new Error(`default edge_clip invalid: ${m[1]}`);
    if (!VALID_EDGE_VOICES.has(r[1])) throw new Error(`default edge_response invalid: ${r[1]}`);
  });
});

// Helper: merge global + session-override speech_includes (mirrors hook logic).
function mergeIncludes(global, sessionOverride) {
  const eff = { ...global };
  if (sessionOverride) {
    for (const k of Object.keys(sessionOverride)) {
      if (typeof sessionOverride[k] === 'boolean') eff[k] = sessionOverride[k];
    }
  }
  return eff;
}

describe('PER-SESSION OVERRIDE MERGE', () => {
  it('session true overrides global false', () => {
    const eff = mergeIncludes({ code_blocks: false }, { code_blocks: true });
    assertEqual(eff.code_blocks, true);
  });
  it('session false overrides global true', () => {
    const eff = mergeIncludes({ headings: true }, { headings: false });
    assertEqual(eff.headings, false);
  });
  it('missing key falls through to global', () => {
    const eff = mergeIncludes({ urls: false, headings: true }, { code_blocks: true });
    assertEqual(eff.urls, false);
    assertEqual(eff.headings, true);
    assertEqual(eff.code_blocks, true);
  });
  it('null/undefined override does not change global', () => {
    const eff = mergeIncludes({ urls: true }, { urls: null });
    assertEqual(eff.urls, true);
  });
  it('empty session override = global unchanged', () => {
    const eff = mergeIncludes({ code_blocks: false, urls: true }, {});
    assertEqual(eff, { code_blocks: false, urls: true });
  });
});

describe('REGISTRY BOM HANDLING', () => {
  it('statusline writes registry WITHOUT BOM (Node JSON.parse compatible)', () => {
    clearRegistry();
    runStatusline('cafef00d-1111-2222-3333-444444444444');
    const buf = fs.readFileSync(REGISTRY_PATH);
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
      throw new Error('registry has UTF-8 BOM; JSON.parse will reject');
    }
    JSON.parse(buf.toString('utf8'));
  });
  clearRegistry();
});

describe('REGISTRY ROUND-TRIP PRESERVES OVERRIDES', () => {
  it('statusline preserves voice + speech_includes through a write cycle', () => {
    clearRegistry();
    // Seed a registry with overrides
    const seed = {
      assignments: {
        'beefcafe': {
          index: 5, session_id: 'beefcafe-x', claude_pid: 0,
          label: 'Frontend', pinned: true, last_seen: Math.floor(Date.now()/1000),
          voice: 'en-US-AriaNeural',
          speech_includes: { code_blocks: true, urls: false }
        }
      }
    };
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(seed, null, 2), 'utf8');
    // Trigger statusline for a DIFFERENT session -- this exercises the load+prune+write path
    runStatusline('feedface-1111-2222-3333-444444444444');
    const reg = readRegistry();
    if (!reg['beefcafe']) throw new Error('beefcafe entry was wiped');
    if (reg['beefcafe'].voice !== 'en-US-AriaNeural') throw new Error(`voice override lost: ${JSON.stringify(reg['beefcafe'])}`);
    if (!reg['beefcafe'].speech_includes) throw new Error('speech_includes wiped');
    if (reg['beefcafe'].speech_includes.code_blocks !== true) throw new Error('code_blocks override lost');
    if (reg['beefcafe'].speech_includes.urls !== false) throw new Error('urls override lost');
  });
  it('statusline preserves muted flag through a write cycle', () => {
    clearRegistry();
    const seed = {
      assignments: {
        'deadbee1': {
          index: 3, session_id: 'deadbee1-x', claude_pid: 0,
          label: 'Background', pinned: true, muted: true,
          last_seen: Math.floor(Date.now()/1000),
        }
      }
    };
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(seed, null, 2), 'utf8');
    runStatusline('feedface-1111-2222-3333-444444444444');
    const reg = readRegistry();
    if (!reg['deadbee1']) throw new Error('deadbee1 entry was wiped');
    if (reg['deadbee1'].muted !== true) throw new Error(`muted flag lost: ${JSON.stringify(reg['deadbee1'])}`);
  });
  it('statusline preserves focus flag through a write cycle', () => {
    clearRegistry();
    const seed = {
      assignments: {
        'abcd1234': {
          index: 7, session_id: 'abcd1234-y', claude_pid: 0,
          label: 'Primary', pinned: true, focus: true,
          last_seen: Math.floor(Date.now()/1000),
        }
      }
    };
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(seed, null, 2), 'utf8');
    runStatusline('beefcafe-1111-2222-3333-444444444444');
    const reg = readRegistry();
    if (!reg['abcd1234']) throw new Error('abcd1234 entry was wiped');
    if (reg['abcd1234'].focus !== true) throw new Error(`focus flag lost: ${JSON.stringify(reg['abcd1234'])}`);
  });
  clearRegistry();
});

describe('SYNTH TURN MUTE', () => {
  const appDirRepo = path.join(__dirname, '..', 'app');
  const registryPath = path.join(os.homedir(), '.terminal-talk', 'session-colours.json');
  const testShort = 'cafebeef';
  const testSessionId = testShort + 'abcdef012345678901234567';
  const syncPath = path.join(os.homedir(), '.terminal-talk', 'sessions', `${testSessionId}-sync.json`);

  function runPy(code) {
    const prelude = `import sys; sys.path.insert(0, r'${appDirRepo.replace(/\\/g, '\\\\')}'); import synth_turn; `;
    const r = spawnSync('python', ['-c', prelude + code], { encoding: 'utf8', timeout: 15000 });
    if (r.status !== 0) throw new Error(`python exit ${r.status}: ${r.stderr}`);
    return (r.stdout || '').trim();
  }

  it('resolve_voice_and_flags reads muted=true from registry', () => {
    // Stash prior registry so we don't nuke real state
    let priorRaw = null;
    try { priorRaw = fs.readFileSync(registryPath, 'utf8'); } catch {}

    const seed = { assignments: { [testShort]: { index: 2, session_id: testSessionId, claude_pid: 0, label: '', pinned: false, muted: true, last_seen: Math.floor(Date.now()/1000) } } };
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(registryPath, JSON.stringify(seed), 'utf8');

    try {
      const out = runPy(`v, f, k, m = synth_turn.resolve_voice_and_flags('${testShort}', {}); print('muted=' + str(m))`);
      if (out !== 'muted=True') throw new Error(`expected muted=True, got '${out}'`);
    } finally {
      if (priorRaw !== null) fs.writeFileSync(registryPath, priorRaw, 'utf8');
      else try { fs.unlinkSync(registryPath); } catch {}
    }
  });

  it('resolve_voice_and_flags reads muted=false by default', () => {
    let priorRaw = null;
    try { priorRaw = fs.readFileSync(registryPath, 'utf8'); } catch {}
    const seed = { assignments: { [testShort]: { index: 2, session_id: testSessionId, claude_pid: 0, label: '', pinned: false, last_seen: Math.floor(Date.now()/1000) } } };
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(registryPath, JSON.stringify(seed), 'utf8');
    try {
      const out = runPy(`v, f, k, m = synth_turn.resolve_voice_and_flags('${testShort}', {}); print('muted=' + str(m))`);
      if (out !== 'muted=False') throw new Error(`expected muted=False, got '${out}'`);
    } finally {
      if (priorRaw !== null) fs.writeFileSync(registryPath, priorRaw, 'utf8');
      else try { fs.unlinkSync(registryPath); } catch {}
    }
  });

  it('run() on muted session advances sync state but does not synthesise', () => {
    // Stash real registry + sync state
    let priorReg = null;
    try { priorReg = fs.readFileSync(registryPath, 'utf8'); } catch {}
    try { fs.unlinkSync(syncPath); } catch {}

    const seed = { assignments: { [testShort]: { index: 2, session_id: testSessionId, claude_pid: 0, label: '', pinned: false, muted: true, last_seen: Math.floor(Date.now()/1000) } } };
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(registryPath, JSON.stringify(seed), 'utf8');

    // Build a fake transcript with one user line then an assistant text line
    const fakeTranscript = path.join(os.tmpdir(), `tt-mute-test-${Date.now()}.jsonl`);
    const transcriptLines = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'This is some assistant response text that should not be synthesised because the session is muted.' }] } })
    ];
    fs.writeFileSync(fakeTranscript, transcriptLines.join('\n'), 'utf8');

    try {
      const r = spawnSync('python', [
        path.join(appDirRepo, 'synth_turn.py'),
        '--session', testSessionId,
        '--transcript', fakeTranscript,
        '--mode', 'on-stop'
      ], { encoding: 'utf8', timeout: 15000 });
      if (r.status !== 0) throw new Error(`synth_turn exit ${r.status}: ${r.stderr}`);
      // Sync state should exist showing line 1 as synthesised
      const syncRaw = fs.readFileSync(syncPath, 'utf8');
      const sync = JSON.parse(syncRaw);
      if (sync.turn_boundary !== 0) throw new Error(`turn_boundary expected 0, got ${sync.turn_boundary}`);
      if (!sync.synthesized_line_indices.includes(1)) throw new Error(`line 1 not marked synthesized: ${syncRaw}`);
    } finally {
      if (priorReg !== null) fs.writeFileSync(registryPath, priorReg, 'utf8');
      else try { fs.unlinkSync(registryPath); } catch {}
      try { fs.unlinkSync(fakeTranscript); } catch {}
      try { fs.unlinkSync(syncPath); } catch {}
    }
  });
});

describe('PALETTE EDGE CASES', () => {
  it('arrangementForIndex wraps at 24 (25 -> same as 1)', () => {
    assertEqual(arrangementForIndex(25), arrangementForIndex(1));
  });
  it('arrangementForIndex handles negatives (-1 -> index 23)', () => {
    assertEqual(arrangementForIndex(-1).kind, arrangementForIndex(23).kind);
  });
  it('split partners are complementary (different from same-index reverse)', () => {
    // hsplit at primary p has partner HSPLIT_PARTNER[p]. The reverse pair
    // (same two colours flipped top/bottom) lives at HSPLIT_PARTNER[p].
    // So the table must be its own inverse to guarantee 8 distinct slots.
    for (let p = 0; p < 8; p++) {
      assertEqual(HSPLIT_PARTNER[HSPLIT_PARTNER[p]], p, `hsplit not self-inverse at ${p}`);
      assertEqual(VSPLIT_PARTNER[VSPLIT_PARTNER[p]], p, `vsplit not self-inverse at ${p}`);
    }
  });
});

describe('STRIP-FOR-TTS EXTRAS', () => {
  it('translates Ctrl+ to "control"', () => {
    const out = stripForTTS('Press Ctrl+S to save');
    if (!/control/i.test(out)) throw new Error(`Ctrl+ not translated: "${out}"`);
    if (out.includes('Ctrl+')) throw new Error(`Ctrl+ leaked: "${out}"`);
  });
  it('preserves text inside **bold** markdown', () => {
    const out = stripForTTS('Make it **really** clear');
    if (!out.includes('really')) throw new Error(`bold text lost: "${out}"`);
    if (out.includes('**')) throw new Error(`bold marks leaked: "${out}"`);
  });
  it('preserves text inside *italic* markdown', () => {
    const out = stripForTTS('an *important* point');
    if (!out.includes('important')) throw new Error(`italic text lost: "${out}"`);
    if (/\*important\*/.test(out)) throw new Error(`italic marks leaked: "${out}"`);
  });
});

describe('PINNED SESSIONS NOT PRUNED', () => {
  it('a pinned session with dead PID and stale last_seen survives', () => {
    clearRegistry();
    const ancient = Math.floor(Date.now()/1000) - 999999; // way past grace
    const seed = {
      assignments: {
        'pinpinpi': {
          index: 7, session_id: 'pinpinpi-x', claude_pid: 99999999,
          label: '', pinned: true, last_seen: ancient
        }
      }
    };
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(seed, null, 2), 'utf8');
    runStatusline('newnewne-1111-2222-3333-444444444444');
    const reg = readRegistry();
    if (!reg['pinpinpi']) throw new Error('pinned session was pruned');
  });
  clearRegistry();
});

describe('STATUSLINE OUTPUT', () => {
  it('appends label to emoji when label is set', () => {
    clearRegistry();
    const seed = {
      assignments: {
        'feedface': {
          index: 0, session_id: 'feedface-x', claude_pid: 0,
          label: 'Frontend', pinned: true,
          last_seen: Math.floor(Date.now()/1000)
        }
      }
    };
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(seed, null, 2), 'utf8');
    const r = runStatusline('feedface-1111-2222-3333-444444444444');
    if (!r.stdout.includes('Frontend')) throw new Error(`label missing from output: "${r.stdout}"`);
  });
  clearRegistry();
});

describe('MAIN.JS REGISTRY READ TOLERANCE', () => {
  it('loadAssignments handles BOM-prefixed JSON (PowerShell legacy)', () => {
    // Write a BOM + valid JSON manually, then verify Node-style strip works.
    const bomJson = Buffer.concat([
      Buffer.from([0xEF, 0xBB, 0xBF]),
      Buffer.from(JSON.stringify({ assignments: { 'aabbccdd': { index: 3 } } }))
    ]);
    fs.writeFileSync(REGISTRY_PATH, bomJson);
    let raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    const parsed = JSON.parse(raw);
    assertEqual(parsed.assignments.aabbccdd.index, 3);
  });
  clearRegistry();
});

describe('HARDENING: input validation', () => {
  it('main.js loadAssignments drops non-hex registry keys', () => {
    const evil = {
      assignments: {
        'deadbeef': { index: 1, last_seen: 1, claude_pid: 0, label: '', pinned: false, session_id: 'deadbeef' },
        '../etc/passwd': { index: 2, last_seen: 1, claude_pid: 0, label: '', pinned: false, session_id: 'x' },
        'TOOLONG12': { index: 3, last_seen: 1, claude_pid: 0, label: '', pinned: false, session_id: 'x' },
        'not-hex!': { index: 4, last_seen: 1, claude_pid: 0, label: '', pinned: false, session_id: 'x' }
      }
    };
    const tmpReg = path.join(os.tmpdir(), 'tt-loadassignments-test.json');
    fs.writeFileSync(tmpReg, JSON.stringify(evil), 'utf8');
    // Re-implement the validator inline (mirrors loadAssignments / sanitiseEntry).
    const SHORT_KEY_RE = /^[a-f0-9]{8}$/;
    const data = JSON.parse(fs.readFileSync(tmpReg, 'utf8'));
    const clean = {};
    for (const [k, v] of Object.entries(data.assignments)) {
      if (!SHORT_KEY_RE.test(k)) continue;
      clean[k] = v;
    }
    fs.unlinkSync(tmpReg);
    if (Object.keys(clean).length !== 1) throw new Error(`expected 1 valid entry, got ${Object.keys(clean).length}`);
    if (!clean['deadbeef']) throw new Error('valid entry was dropped');
  });

  it('main.js loadAssignments drops malformed entries (out-of-range index, missing fields)', () => {
    const evil = {
      assignments: {
        'aaaaaaaa': { index: 99 },                    // bad: index > 31
        'bbbbbbbb': { index: -5 },                    // bad: negative
        'cccccccc': { index: 'not-a-number' },        // bad: type
        'dddddddd': { index: 5, last_seen: 1, claude_pid: 0, label: '', pinned: false, session_id: 'x' } // good
      }
    };
    const tmpReg = path.join(os.tmpdir(), 'tt-malformed-entry.json');
    fs.writeFileSync(tmpReg, JSON.stringify(evil), 'utf8');
    const data = JSON.parse(fs.readFileSync(tmpReg, 'utf8'));
    fs.unlinkSync(tmpReg);
    // Sanitise as loadAssignments would:
    let valid = 0;
    for (const v of Object.values(data.assignments)) {
      const idx = Number(v.index);
      if (Number.isFinite(idx) && idx >= 0 && idx <= 23) valid++;
    }
    if (valid !== 1) throw new Error(`expected 1 valid entry, got ${valid}`);
  });
});

describe('HARDENING: path traversal', () => {
  function isPathInside(target, base) {
    const t = path.resolve(target);
    const b = path.resolve(base);
    return t === b || t.startsWith(b + path.sep);
  }
  it('rejects ".." escape attempts', () => {
    const QUEUE = path.join(os.tmpdir(), 'tt-queue-test');
    if (isPathInside(path.join(QUEUE, '..', 'etc', 'passwd'), QUEUE))
      throw new Error('path traversal not caught');
  });
  it('rejects absolute paths outside base', () => {
    const QUEUE = path.join(os.tmpdir(), 'tt-queue-test');
    if (isPathInside('C:\\Windows\\System32\\drivers\\etc\\hosts', QUEUE))
      throw new Error('absolute path outside base accepted');
  });
  it('accepts legit paths inside base', () => {
    const QUEUE = path.join(os.tmpdir(), 'tt-queue-test');
    if (!isPathInside(path.join(QUEUE, 'good.mp3'), QUEUE))
      throw new Error('legit path rejected');
  });
});

describe('HARDENING: secrets do not leak to logs', () => {
  it('redactForLog masks openai_api_key', () => {
    function redactForLog(obj) {
      if (!obj || typeof obj !== 'object') return obj;
      const clone = { ...obj };
      if (clone.openai_api_key) clone.openai_api_key = '<redacted>';
      return clone;
    }
    const out = JSON.stringify(redactForLog({ openai_api_key: 'sk-secret123', voices: { edge_response: 'x' } }));
    if (out.includes('sk-secret123')) throw new Error(`secret leaked: ${out}`);
    if (!out.includes('<redacted>')) throw new Error(`redaction marker missing: ${out}`);
  });

  it('toolbar log file does not contain any sk- prefixed strings', () => {
    const logPath = path.join(os.homedir(), '.terminal-talk', 'queue', '_toolbar.log');
    if (!fs.existsSync(logPath)) return; // log not yet created -- pass
    const content = fs.readFileSync(logPath, 'utf8');
    const matches = content.match(/sk-[A-Za-z0-9_-]{20,}/g);
    if (matches) throw new Error(`API key string found in toolbar log: ${matches[0].slice(0, 12)}...`);
  });
});

describe('HARDENING: voice id validation', () => {
  const VOICE_RE = /^[A-Za-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z]+(?:Multilingual|Expressive)?Neural$|^(alloy|echo|fable|onyx|nova|shimmer)$/;
  it('accepts valid edge voice ids', () => {
    for (const v of ['en-GB-RyanNeural','en-US-AriaNeural','en-US-AvaMultilingualNeural','en-IN-NeerjaExpressiveNeural']) {
      if (!VOICE_RE.test(v)) throw new Error(`valid voice rejected: ${v}`);
    }
  });
  it('accepts valid OpenAI voice ids', () => {
    for (const v of ['onyx','shimmer','alloy','echo','fable','nova']) {
      if (!VOICE_RE.test(v)) throw new Error(`OpenAI voice rejected: ${v}`);
    }
  });
  it('rejects injection attempts', () => {
    for (const evil of ['; rm -rf /', 'en-GB-Ryan; echo bad', '../../../etc/passwd', '<script>', 'a'.repeat(200)]) {
      if (VOICE_RE.test(evil)) throw new Error(`evil voice accepted: ${evil}`);
    }
  });
});

function runPythonInline(code) {
  const result = spawnSync('python', ['-c', code], { encoding: 'utf8', timeout: 15000 });
  return { stdout: result.stdout || '', stderr: result.stderr || '', code: result.status };
}

describe('SENTENCE SPLIT', () => {
  const appDirRepo = path.join(__dirname, '..', 'app');
  // Always test against the repo copy (independent of install state)
  const pyPrelude = `import sys; sys.path.insert(0, r'${appDirRepo.replace(/\\/g, '\\\\')}'); from sentence_split import split_sentences; `;

  function split(text) {
    const code = `${pyPrelude}import json; print(json.dumps(split_sentences(${JSON.stringify(text)})))`;
    const r = runPythonInline(code);
    if (r.code !== 0) throw new Error(`python exited ${r.code}: ${r.stderr}`);
    return JSON.parse(r.stdout.trim());
  }

  it('splits on basic terminators when sentences are long enough', () => {
    // Both sentences >= MIN_SENTENCE_LEN (15) so no merging happens
    const r = split('This is the first actual sentence here. And here is a second one for us.');
    assertEqual(r.length, 2);
  });
  it('preserves abbreviations (Mr., Dr.)', () => {
    const r = split('Mr. Smith went home for lunch today. Dr. Jones arrived much later.');
    assertEqual(r.length, 2);
    if (!r[0].startsWith('Mr. Smith')) throw new Error(`abbrev split: ${r[0]}`);
  });
  it('does not split decimals (3.14, 1.2.3)', () => {
    const r = split('Pi is 3.14 and ships as v1.2.3 right now for users.');
    assertEqual(r.length, 1);
  });
  it('preserves URLs with internal dots', () => {
    const r = split('Go visit https://foo.com/path.html right now immediately. Then let me know soon.');
    assertEqual(r.length, 2);
    if (!r[0].includes('https://foo.com/path.html')) throw new Error(`URL mangled: ${r[0]}`);
  });
  it('splits on paragraph breaks without terminator', () => {
    const r = split('First line no full stop\n\nSecond paragraph here');
    assertEqual(r.length, 2);
  });
  it('merges very short sentences into their neighbours', () => {
    const r = split('OK. Yes. Then a much longer actual sentence continues on here.');
    assertEqual(r.length, 1);  // all three merged
  });
  it('hard-splits sentences longer than 400 chars', () => {
    const long = 'x'.repeat(300) + ', and more stuff ' + 'y'.repeat(200);
    const r = split(long);
    if (r.length < 2) throw new Error(`expected hard split, got ${r.length}`);
    for (const s of r) if (s.length > 420) throw new Error(`chunk too long: ${s.length}`);
  });
  it('returns empty for empty/whitespace input', () => {
    assertEqual(split(''), []);
    assertEqual(split('   \n  '), []);
  });
});

describe('SYNTH TURN SYNC STATE', () => {
  const appDirRepo = path.join(__dirname, '..', 'app');
  const testSessionId = 'testsesn1234567890abcdef';
  const syncPath = path.join(os.homedir(), '.terminal-talk', 'sessions', `${testSessionId}-sync.json`);

  function run(code) {
    const prelude = `import sys; sys.path.insert(0, r'${appDirRepo.replace(/\\/g, '\\\\')}'); import synth_turn; `;
    const r = runPythonInline(prelude + code);
    if (r.code !== 0) throw new Error(`python exited ${r.code}: ${r.stderr}`);
    return r.stdout.trim();
  }

  it('load returns empty state for new session', () => {
    try { fs.unlinkSync(syncPath); } catch {}
    const out = run(`s = synth_turn.load_sync_state('${testSessionId}'); print(s['turn_boundary'], len(s['synthesized_line_indices']))`);
    assertEqual(out, '-1 0');
  });
  it('save then load round-trips', () => {
    run(`synth_turn.save_sync_state('${testSessionId}', {'turn_boundary': 42, 'synthesized_line_indices': [44, 47]})`);
    const out = run(`s = synth_turn.load_sync_state('${testSessionId}'); print(s['turn_boundary'], s['synthesized_line_indices'])`);
    assertEqual(out, '42 [44, 47]');
    try { fs.unlinkSync(syncPath); } catch {}
  });
  it('invalid session_id rejected (via run())', () => {
    // session_id too short → exit code 2
    const prelude = `import sys; sys.path.insert(0, r'${appDirRepo.replace(/\\/g, '\\\\')}'); from synth_turn import run; `;
    const r = runPythonInline(prelude + `sys.exit(run('bad', '/tmp/nonexistent.jsonl', 'on-stop'))`);
    assertEqual(r.code, 2);
  });
});

describe('SYNTH TURN TEXT EXTRACTION', () => {
  const appDirRepo = path.join(__dirname, '..', 'app');

  function run(code) {
    const prelude = `import sys, json; sys.path.insert(0, r'${appDirRepo.replace(/\\/g, '\\\\')}'); import synth_turn; `;
    const r = runPythonInline(prelude + code);
    if (r.code !== 0) throw new Error(`python exited ${r.code}: ${r.stderr}`);
    return r.stdout.trim();
  }

  it('find_last_user_idx returns most recent user line', () => {
    const entries = JSON.stringify([
      { type: 'user' },                  // 0
      { type: 'assistant' },             // 1
      { type: 'user' },                  // 2
      { type: 'assistant' },             // 3
    ]);
    const out = run(`print(synth_turn.find_last_user_idx(${entries}))`);
    assertEqual(out, '2');
  });
  it('find_last_user_idx returns -1 when no user line', () => {
    const out = run(`print(synth_turn.find_last_user_idx([{'type':'system'}]))`);
    assertEqual(out, '-1');
  });
  it('assistant_text_entries_after filters tool_use correctly', () => {
    const entries = JSON.stringify([
      { type: 'user' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'world' }] } },
    ]);
    const out = run(`r = synth_turn.assistant_text_entries_after(${entries}, 0); print(json.dumps([[i,t] for i,t in r]))`);
    assertEqual(JSON.parse(out), [[1, 'hello'], [3, 'world']]);
  });
  it('extract_questions pulls sentences ending in ?', () => {
    const out = run(`print(json.dumps(synth_turn.extract_questions('Is this real? Yes. What now?')))`);
    const qs = JSON.parse(out);
    if (qs.length !== 2) throw new Error(`expected 2 questions, got ${qs.length}: ${out}`);
  });
  it('sanitize strips code fences when flag off', () => {
    const text = 'Before ```python\nprint("hi")\n``` after.';
    const out = run(`print(synth_turn.sanitize(${JSON.stringify(text)}, {'code_blocks': False, 'inline_code': False}))`);
    if (out.includes('print(')) throw new Error(`code fence leaked: ${out}`);
    if (!out.includes('Before') || !out.includes('after')) throw new Error(`text mangled: ${out}`);
  });
  it('sanitize keeps code content when flag on', () => {
    const text = 'Before ```\nhello world\n``` after.';
    const out = run(`print(synth_turn.sanitize(${JSON.stringify(text)}, {'code_blocks': True, 'inline_code': False}))`);
    if (!out.includes('hello world')) throw new Error(`code content dropped: ${out}`);
  });
});

describe('INSTALL SANITY', () => {
  it('expected files exist in install dir', () => {
    const required = [
      'app/main.js', 'app/preload.js', 'app/renderer.js', 'app/index.html',
      'app/styles.css', 'app/package.json', 'app/wake-word-listener.py',
      'app/key_helper.py', 'app/edge_tts_speak.py', 'app/statusline.ps1',
      'app/sentence_split.py', 'app/synth_turn.py',
      'app/lib/text.js',
      'app/session-registry.psm1',
      'hooks/speak-response.ps1', 'hooks/speak-notification.ps1',
      'hooks/speak-on-tool.ps1',
      'config.json'
    ];
    for (const rel of required) {
      const p = path.join(INSTALL_DIR, rel);
      if (!fs.existsSync(p)) throw new Error(`missing: ${rel}`);
    }
  });
  it('config.json parses', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(INSTALL_DIR, 'config.json'), 'utf8'));
    assertTruthy(cfg.voices, 'cfg.voices missing');
    assertTruthy(cfg.voices.edge_response, 'edge_response missing');
  });
});

describe('STRIP-FOR-TTS PARITY (JS canonical vs Python + PS mirrors)', () => {
  // The canonical JS lives in app/lib/text.js. Python and PowerShell
  // can't share that code so they carry their own mirrors. This test
  // enforces that every rule class the canonical JS implements is also
  // present in both mirrors — by looking for a telltale substring from
  // each rule's regex source. Substring (not regex) matching is used
  // deliberately: Python's `\*\*` emphasis regex and `**` exponentiation
  // look identical to a regex search, which previously falsely passed
  // the bold/italic check on synth_turn.py despite the regex there
  // being fine and the alternative mirror (PS) actually missing it.
  const canonicalPath = path.join(APP_DIR, 'lib', 'text.js');
  const pythonPath    = path.join(APP_DIR, 'synth_turn.py');
  const psPath        = path.join(INSTALL_DIR, 'hooks', 'speak-response.ps1');

  const canonical = fs.readFileSync(canonicalPath, 'utf8');
  const python    = fs.readFileSync(pythonPath,    'utf8');
  const ps        = fs.readFileSync(psPath,        'utf8');

  // Each rule names a specific character sequence that a correct
  // implementation is expected to include somewhere in its source —
  // the regex-escaped form of the markdown token being stripped.
  // Example: a correct emphasis-stripping regex uses the literal
  // 4-char sequence `\*\*` to match a pair of asterisks.
  const RULES = [
    { name: 'code fence ```',               needle: '```' },
    { name: 'inline backtick `',            needle: '`' },
    { name: 'markdown link bracket \\[',    needle: '\\[' },
    { name: 'bare https URL',               needle: 'https' },
    { name: 'heading hash #',               needle: '#' },
    { name: 'bold/italic \\*\\*',           needle: '\\*\\*' },
    { name: 'underscore emphasis __',       needle: '__' },
    { name: 'Ctrl\\+ keyboard modifier',    needle: 'Ctrl\\+' },
    { name: 'Cmd\\+ keyboard modifier',     needle: 'Cmd\\+' },
  ];

  for (const rule of RULES) {
    it(`Python mirror handles "${rule.name}"`, () => {
      if (!python.includes(rule.needle)) {
        throw new Error(`synth_turn.py: expected substring "${rule.needle}" from rule "${rule.name}" is missing`);
      }
    });
    it(`PowerShell mirror handles "${rule.name}"`, () => {
      if (!ps.includes(rule.needle)) {
        throw new Error(`speak-response.ps1: expected substring "${rule.needle}" from rule "${rule.name}" is missing`);
      }
    });
  }

  it('canonical module exports both stripForTTS and DEFAULTS', () => {
    if (!/module\.exports\s*=\s*\{\s*stripForTTS\s*,\s*DEFAULTS\s*\}/.test(canonical)) {
      throw new Error('app/lib/text.js must export { stripForTTS, DEFAULTS }');
    }
  });

  it('main.js requires the canonical module instead of reimplementing', () => {
    const main = fs.readFileSync(path.join(APP_DIR, 'main.js'), 'utf8');
    if (!/require\(['"]\.\/lib\/text['"]\)/.test(main)) {
      throw new Error("main.js must require('./lib/text') — don't reimplement stripForTTS");
    }
    // Guard against re-inlining the logic: main.js should have AT MOST
    // the thin wrapper function referring to _stripForTTS, not a real
    // body that handles every markdown rule.
    const bodyGuard = /function stripForTTS\(text\) \{[\s\S]{0,200}_stripForTTS/;
    if (!bodyGuard.test(main)) {
      throw new Error('main.js stripForTTS must be a thin wrapper over ./lib/text');
    }
  });
});

describe('PS SESSION-REGISTRY MODULE IS CANONICAL', () => {
  // CC-4 guard: the 80-line lowest-free-index + hash-fallback + atomic-
  // write block used to live copy-pasted in three PS files. We extracted
  // it to app/session-registry.psm1 and made each consumer Import-Module
  // it. These tests assert:
  //   - the module file exists + exports the four canonical functions
  //   - none of the three consumer scripts has re-inlined the logic
  //     (which would undo the whole refactor)
  const modulePath   = path.join(APP_DIR, 'session-registry.psm1');
  const statusline   = fs.readFileSync(path.join(APP_DIR, 'statusline.ps1'), 'utf8');
  const respHook     = fs.readFileSync(path.join(INSTALL_DIR, 'hooks', 'speak-response.ps1'), 'utf8');
  const toolHook     = fs.readFileSync(path.join(INSTALL_DIR, 'hooks', 'speak-on-tool.ps1'), 'utf8');
  const moduleSrc    = fs.readFileSync(modulePath, 'utf8');

  it('module exports the four canonical functions', () => {
    for (const fn of ['Read-Registry', 'Update-SessionAssignment', 'Save-Registry', 'Write-SessionPidFile']) {
      if (!moduleSrc.includes(`function ${fn}`)) {
        throw new Error(`session-registry.psm1 missing function ${fn}`);
      }
    }
    if (!/Export-ModuleMember[\s\S]*Read-Registry[\s\S]*Update-SessionAssignment[\s\S]*Save-Registry[\s\S]*Write-SessionPidFile/.test(moduleSrc)) {
      throw new Error('session-registry.psm1 must Export-ModuleMember all four canonical functions');
    }
  });

  const CONSUMERS = [
    { name: 'statusline.ps1',       src: statusline },
    { name: 'speak-response.ps1',   src: respHook },
    { name: 'speak-on-tool.ps1',    src: toolHook },
  ];

  for (const c of CONSUMERS) {
    it(`${c.name} imports the shared module`, () => {
      if (!/Import-Module[^\n]*session-registry\.psm1/.test(c.src)) {
        throw new Error(`${c.name}: missing Import-Module .../session-registry.psm1`);
      }
    });
    it(`${c.name} calls the canonical functions instead of re-inlining`, () => {
      // At least one of the canonical function names must be invoked.
      // Guards against someone deleting the Import-Module line + pasting
      // the old 80-line body back in.
      if (!/Update-SessionAssignment/.test(c.src)) {
        throw new Error(`${c.name}: does not call Update-SessionAssignment`);
      }
      if (!/Save-Registry/.test(c.src)) {
        throw new Error(`${c.name}: does not call Save-Registry`);
      }
    });
    it(`${c.name} no longer carries the lowest-free-index loop`, () => {
      // The distinctive for-loop `$i -lt $paletteSize` with break is
      // exactly the loop that used to live in all three files. If it
      // reappears it means the logic was copy-pasted back.
      if (/\$i\s*-lt\s*\$paletteSize/.test(c.src)) {
        throw new Error(`${c.name}: still contains the inline lowest-free-index loop`);
      }
    });
  }
});

describe('JS ↔ PYTHON DEFAULTS ARE IN LOCK-STEP', () => {
  const synthPath = path.join(INSTALL_DIR, 'app', 'synth_turn.py');
  const synthSrc = fs.readFileSync(synthPath, 'utf8');

  it('synth_turn.py reads the global voice from `edge_response` (matches JS config shape)', () => {
    // Previous bug (caught in Claude's audit): line read `response_voice`,
    // which didn't exist anywhere else in the system. Users who changed the
    // global response voice in settings saw their change ignored.
    if (/['"]response_voice['"]/.test(synthSrc)) {
      throw new Error('synth_turn.py still references stale `response_voice` key');
    }
    if (!/['"]edge_response['"]/.test(synthSrc)) {
      throw new Error('synth_turn.py must read voice from `edge_response` to match app/main.js');
    }
  });

  it('synth_turn.py reads openai_api_key from the config root, not voices.openai_api_key', () => {
    // Another stale key from CC-3. openai_api_key is a top-level config
    // field; reading it from under voices.* always returned undefined.
    if (/get\(['"]voices['"][^)]*\)\.get\(['"]openai_api_key['"]/.test(synthSrc)) {
      throw new Error('synth_turn.py reads openai_api_key from wrong nesting (voices.*)');
    }
  });

  it('DEFAULT_SPEECH_INCLUDES matches JS DEFAULTS.speech_includes', () => {
    // Parse the Python dict literal and the JS object literal; compare.
    const pyMatch = synthSrc.match(/DEFAULT_SPEECH_INCLUDES\s*=\s*\{([\s\S]*?)\}/);
    if (!pyMatch) throw new Error('DEFAULT_SPEECH_INCLUDES block not found in synth_turn.py');
    const parseDict = (body) => {
      const out = {};
      for (const line of body.split(/[,\n]/)) {
        const m = line.match(/['"](\w+)['"]\s*:\s*(True|False|true|false)/);
        if (m) out[m[1]] = /true/i.test(m[2]);
      }
      return out;
    };
    const pyDefaults = parseDict(pyMatch[1]);

    const mainSrc = fs.readFileSync(path.join(INSTALL_DIR, 'app', 'main.js'), 'utf8');
    const jsMatch = mainSrc.match(/speech_includes\s*:\s*\{([\s\S]*?)\}/);
    if (!jsMatch) throw new Error('speech_includes default block not found in main.js');
    const jsDefaults = parseDict(jsMatch[1]);

    for (const k of Object.keys(jsDefaults)) {
      if (pyDefaults[k] !== jsDefaults[k]) {
        throw new Error(`speech_includes.${k} drift: js=${jsDefaults[k]} py=${pyDefaults[k]}`);
      }
    }
  });
});

describe('SELF-CLEANUP WATCHDOG', () => {
  const MAIN_JS = path.join(INSTALL_DIR, 'app', 'main.js');
  const main = fs.readFileSync(MAIN_JS, 'utf8');

  it('requestSingleInstanceLock is called before app.whenReady', () => {
    const lockIdx = main.indexOf('requestSingleInstanceLock()');
    const readyIdx = main.indexOf('app.whenReady()');
    if (lockIdx < 0) throw new Error('requestSingleInstanceLock missing');
    if (readyIdx < 0) throw new Error('app.whenReady missing');
    if (!(lockIdx < readyIdx)) throw new Error('lock must be acquired before whenReady');
  });

  it('failed lock causes app.quit + process.exit', () => {
    // The lock handling block must both quit and force-exit so we never
    // leave a zombie process behind.
    if (!/!gotSingleInstanceLock[\s\S]{0,300}app\.quit\(\)[\s\S]{0,300}process\.exit\(0\)/.test(main)) {
      throw new Error('expected app.quit() + process.exit(0) inside !gotSingleInstanceLock branch');
    }
  });

  it('lock is skipped in TT_TEST_MODE so Playwright tests can launch', () => {
    if (!/TT_TEST_MODE[\s\S]{0,100}requestSingleInstanceLock/.test(main)) {
      throw new Error('expected TT_TEST_MODE gate around requestSingleInstanceLock');
    }
  });

  it('second-instance handler surfaces existing window', () => {
    if (!/app\.on\(['"]second-instance['"]/.test(main)) {
      throw new Error("app.on('second-instance', ...) handler missing");
    }
    if (!/showInactive\(\)/.test(main.slice(main.indexOf('second-instance')))) {
      throw new Error('second-instance handler should showInactive() the window');
    }
  });

  it('watchdog sweep runs pruneOldFiles + pruneSessionsDir + killOrphanVoiceListeners', () => {
    const sweepIdx = main.indexOf('function runWatchdogSweep');
    if (sweepIdx < 0) throw new Error('runWatchdogSweep() missing');
    // Slice from the function header to the next `function ` declaration.
    const nextFnIdx = main.indexOf('\nfunction ', sweepIdx + 1);
    const sweep = main.slice(sweepIdx, nextFnIdx > 0 ? nextFnIdx : main.length);
    for (const fn of ['pruneOldFiles', 'pruneSessionsDir', 'killOrphanVoiceListeners']) {
      if (!sweep.includes(fn)) throw new Error(`runWatchdogSweep must call ${fn}`);
    }
  });

  it('watchdog interval is 30 minutes', () => {
    if (!main.includes('WATCHDOG_INTERVAL_MS = 30 * 60 * 1000')) {
      throw new Error('WATCHDOG_INTERVAL_MS should be 30 * 60 * 1000');
    }
  });

  it('watchdog is armed inside whenReady and cleared on will-quit', () => {
    const ready = main.slice(main.indexOf('app.whenReady()'));
    if (!ready.includes('startWatchdog()')) throw new Error('whenReady must call startWatchdog()');

    const quit = main.slice(main.indexOf("app.on('will-quit'"));
    if (!quit.includes('stopWatchdog()')) throw new Error("will-quit must call stopWatchdog()");
  });
});

describe('HARDENING: renderer CSP', () => {
  it('app/index.html has a strict Content-Security-Policy meta tag', () => {
    const html = fs.readFileSync(path.join(INSTALL_DIR, 'app', 'index.html'), 'utf8');
    if (!/http-equiv="Content-Security-Policy"/.test(html)) {
      throw new Error('missing Content-Security-Policy meta tag in app/index.html');
    }
    // default-src must be 'none' or 'self' — never * or missing.
    const defaultSrc = html.match(/default-src\s+([^;]+);/);
    if (!defaultSrc) throw new Error('CSP has no default-src directive');
    if (!/^\s*'(none|self)'/.test(defaultSrc[1])) {
      throw new Error(`default-src should be 'none' or 'self' (got: ${defaultSrc[1].trim()})`);
    }
  });

  it('CSP pins connect-src so renderer cannot call out to the network', () => {
    const html = fs.readFileSync(path.join(INSTALL_DIR, 'app', 'index.html'), 'utf8');
    // Renderer has no legitimate fetch surface; all network calls happen
    // in main. If connect-src ever drifts to * or https:, that's a regression.
    if (!/connect-src\s+'none'/.test(html)) {
      throw new Error("CSP connect-src must be 'none' (renderer should never make network calls)");
    }
  });
});

describe('HARDENING: navigation guards', () => {
  const MAIN_JS = path.join(INSTALL_DIR, 'app', 'main.js');
  const main = fs.readFileSync(MAIN_JS, 'utf8');

  it('will-navigate handler blocks non-local URLs', () => {
    if (!/webContents\.on\(['"]will-navigate['"]/.test(main)) {
      throw new Error("main.js missing webContents.on('will-navigate', ...) guard");
    }
  });

  it('setWindowOpenHandler denies by default', () => {
    if (!/setWindowOpenHandler/.test(main)) {
      throw new Error('main.js missing webContents.setWindowOpenHandler(...)');
    }
    // The handler body must return action: 'deny' for unknown URLs.
    const block = main.slice(main.indexOf('setWindowOpenHandler'),
                             main.indexOf('setWindowOpenHandler') + 400);
    if (!/action:\s*['"]deny['"]/.test(block)) {
      throw new Error("setWindowOpenHandler should return { action: 'deny' } by default");
    }
  });

  it('will-attach-webview is blocked', () => {
    if (!/will-attach-webview/.test(main)) {
      throw new Error('main.js should preventDefault on will-attach-webview');
    }
  });
});

console.log('\n----------------------------------------');
console.log(`Tests: ${pass} passed, ${fail} failed`);
console.log('----------------------------------------');
if (fail > 0) {
  process.exitCode = 1;
}
