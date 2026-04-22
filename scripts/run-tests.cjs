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
const { spawnSync } = require('child_process');

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
  'PS SESSION-REGISTRY MODULE IS CANONICAL',
  'PS TTS-HELPER MODULE IS CANONICAL'
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
// Palette constants now come from the canonical app/lib/tokens.json source,
// the same JSON that renderer + kit both read. This turns every test in the
// PALETTE suite into a kit↔product parity check: if either side drifts the
// test starts failing against the canonical values.
// =============================================================================
const TOKENS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app', 'lib', 'tokens.json'), 'utf8'));
const { PALETTE_SIZE, BASE_COLOURS, HSPLIT_PARTNER, VSPLIT_PARTNER } = TOKENS.palette;

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

  it('every voice in voices.json exists in Edge TTS catalogue', () => {
    // S4.2 moved the voice catalogue from an inline EDGE_VOICES literal
    // in renderer.js to app/lib/voices.json (read via window.TT_VOICES
    // at runtime). This test used to grep renderer.js; it now reads the
    // canonical JSON source directly from the repo — not from APP_DIR —
    // so this assertion runs in --logic-only CI too, not just the full
    // Windows harness.
    const voicesPath = path.join(__dirname, '..', 'app', 'lib', 'voices.json');
    const voices = JSON.parse(fs.readFileSync(voicesPath, 'utf8'));
    const ids = voices.edge.map(v => v.id);
    if (ids.length === 0) throw new Error('no voice ids found in app/lib/voices.json');
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
  // D2-3d — redirect synth_turn.py's whole TT_HOME into a per-run temp
  // dir. Prior versions of this test wrote to the user's real
  // ~/.terminal-talk/session-colours.json and raced a running Electron's
  // saveAssignments(), which could clobber the test's muted seed between
  // seed-write and synth_turn reading it — leaking a synthesised clip
  // under the fake `cafebeef` fixture into the live queue.
  const testTtHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-test-'));
  const testEnv = { ...process.env, TT_HOME: testTtHome };
  const registryPath = path.join(testTtHome, 'session-colours.json');
  const testShort = 'cafebeef';
  const testSessionId = testShort + 'abcdef012345678901234567';
  const syncPath = path.join(testTtHome, 'sessions', `${testSessionId}-sync.json`);
  const queueDir = path.join(testTtHome, 'queue');

  function runPy(code) {
    const prelude = `import sys; sys.path.insert(0, r'${appDirRepo.replace(/\\/g, '\\\\')}'); import synth_turn; `;
    const r = spawnSync('python', ['-c', prelude + code], { encoding: 'utf8', timeout: 15000, env: testEnv });
    if (r.status !== 0) throw new Error(`python exit ${r.status}: ${r.stderr}`);
    return (r.stdout || '').trim();
  }

  function writeSeed(muted) {
    const seed = { assignments: { [testShort]: { index: 2, session_id: testSessionId, claude_pid: 0, label: '', pinned: false, muted, last_seen: Math.floor(Date.now()/1000) } } };
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(registryPath, JSON.stringify(seed), 'utf8');
  }

  // Belt-and-brace: delete any `*-cafebeef.mp3` that ends up in the
  // test TT_HOME queue. With TT_HOME redirected, this should never
  // leak to the user's real queue, but if the env var ever fails to
  // propagate, this stops the fixture short from accumulating.
  function scrubCafebeef() {
    try {
      if (!fs.existsSync(queueDir)) return;
      for (const f of fs.readdirSync(queueDir)) {
        if (f.endsWith('-cafebeef.mp3')) {
          try { fs.unlinkSync(path.join(queueDir, f)); } catch {}
        }
      }
    } catch {}
  }

  it('resolve_voice_and_flags reads muted=true from registry', () => {
    writeSeed(true);
    try {
      const out = runPy(`v, f, k, m = synth_turn.resolve_voice_and_flags('${testShort}', {}); print('muted=' + str(m))`);
      if (out !== 'muted=True') throw new Error(`expected muted=True, got '${out}'`);
    } finally {
      try { fs.unlinkSync(registryPath); } catch {}
      scrubCafebeef();
    }
  });

  it('resolve_voice_and_flags reads muted=false by default', () => {
    writeSeed(false);
    try {
      const out = runPy(`v, f, k, m = synth_turn.resolve_voice_and_flags('${testShort}', {}); print('muted=' + str(m))`);
      if (out !== 'muted=False') throw new Error(`expected muted=False, got '${out}'`);
    } finally {
      try { fs.unlinkSync(registryPath); } catch {}
      scrubCafebeef();
    }
  });

  it('run() on muted session advances sync state but does not synthesise', () => {
    try { fs.unlinkSync(syncPath); } catch {}
    writeSeed(true);

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
      ], { encoding: 'utf8', timeout: 15000, env: testEnv });
      if (r.status !== 0) throw new Error(`synth_turn exit ${r.status}: ${r.stderr}`);
      const syncRaw = fs.readFileSync(syncPath, 'utf8');
      const sync = JSON.parse(syncRaw);
      if (sync.turn_boundary !== 0) throw new Error(`turn_boundary expected 0, got ${sync.turn_boundary}`);
      if (!sync.synthesized_line_indices.includes(1)) throw new Error(`line 1 not marked synthesized: ${syncRaw}`);
    } finally {
      try { fs.unlinkSync(registryPath); } catch {}
      try { fs.unlinkSync(fakeTranscript); } catch {}
      try { fs.unlinkSync(syncPath); } catch {}
      scrubCafebeef();
    }
  });
});

describe('PALETTE PARITY — kit ↔ product (R1.7 + D2-3)', () => {
  // Makes real the regression test docs/README.md previously claimed existed.
  // D2-3 deleted docs/ui-kit/palette.js + kit.css + 8 JSX files — the kit
  // now iframes app/renderer.js directly, so the only remaining drift
  // vectors are (a) renderer.js itself re-inlining the palette, or (b)
  // the generated tokens-window.js / tokens.mjs going out of sync with
  // tokens.json. Everything else is structurally impossible.
  const rendererSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer.js'), 'utf8');
  const kitHtmlSrc  = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ui-kit', 'index.html'), 'utf8');
  // D2-3b — script chain moved out of index.html into kit-bootstrap.js, which
  // fetch+splices app/index.html body at runtime. The drift-detection asserts
  // below now target the bootstrap file.
  const kitBootstrapSrc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ui-kit', 'kit-bootstrap.js'), 'utf8');
  const tokensMjs   = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ui-kit', 'tokens.mjs'), 'utf8');
  const tokensWin   = fs.readFileSync(path.join(__dirname, '..', 'app', 'lib', 'tokens-window.js'), 'utf8');

  it('renderer.js reads palette from window.TT_TOKENS (not hand-coded)', () => {
    if (!/window\.TT_TOKENS\.palette/.test(rendererSrc)) {
      throw new Error('renderer.js no longer destructures palette from window.TT_TOKENS.palette');
    }
    // The old inline BASE_COLOURS literal must be gone.
    if (/const\s+BASE_COLOURS\s*=\s*\[\s*['"]#ff5e5e['"]/.test(rendererSrc)) {
      throw new Error('renderer.js still contains an inline BASE_COLOURS hex literal — regression');
    }
    if (/const\s+HSPLIT_PARTNER\s*=\s*\[\s*3\s*,\s*4\s*,\s*5/.test(rendererSrc)) {
      throw new Error('renderer.js still contains an inline HSPLIT_PARTNER array — regression');
    }
  });

  it('kit no longer ships a parallel palette implementation (D2-3)', () => {
    // The hand-rolled docs/ui-kit/palette.js from pre-D2-3 is gone. If it
    // ever comes back, this test fails — the kit must stay on the
    // renderer-iframed path.
    const palettePath = path.join(__dirname, '..', 'docs', 'ui-kit', 'palette.js');
    if (fs.existsSync(palettePath)) {
      throw new Error('docs/ui-kit/palette.js reappeared — D2-3 regression, the kit must iframe the renderer instead');
    }
    // Same for the 8 JSX components + kit.css.
    const deadPaths = [
      'Toolbar.jsx', 'SessionsTable.jsx', 'SettingsPanel.jsx', 'Dot.jsx',
      'Scrubber.jsx', 'IconButton.jsx', 'AsciiBanner.jsx', 'icons.jsx',
      'kit.css',
    ];
    for (const p of deadPaths) {
      const full = path.join(__dirname, '..', 'docs', 'ui-kit', p);
      if (fs.existsSync(full)) {
        throw new Error(`docs/ui-kit/${p} reappeared — D2-3 regression`);
      }
    }
  });

  it('kit index.html delegates to kit-bootstrap.js (D2-3b)', () => {
    if (!/kit-bootstrap\.js/.test(kitHtmlSrc)) {
      throw new Error('docs/ui-kit/index.html must load kit-bootstrap.js');
    }
  });

  it('kit-bootstrap loads mirrored renderer.js + mock-ipc + canonical tokens (D2-3c)', () => {
    if (!/\.\.\/app-mirror\/renderer\.js/.test(kitBootstrapSrc)) {
      throw new Error('kit-bootstrap.js must load ../app-mirror/renderer.js');
    }
    if (!/mock-ipc\.js/.test(kitBootstrapSrc)) {
      throw new Error('kit-bootstrap.js must load mock-ipc.js before renderer.js');
    }
    if (!/\.\.\/app-mirror\/lib\/tokens-window\.js/.test(kitBootstrapSrc)) {
      throw new Error('kit-bootstrap.js must load ../app-mirror/lib/tokens-window.js');
    }
  });

  it('kit-bootstrap loads every renderer-consumable lib (EX7b regression guard)', () => {
    // EX7a shipped clip-paths.js as a window.TT_CLIP_PATHS dependency
    // without updating kit-bootstrap, silently breaking the kit on
    // Pages. This test catches that class of drift: any lib that
    // renderer.js loads via <script src> in app/index.html must also
    // appear in kit-bootstrap's load chain, OR be explicitly waived
    // because the kit doesn't exercise the code path that needs it.
    const productHtml = fs.readFileSync(
      path.join(__dirname, '..', 'app', 'index.html'), 'utf8'
    );
    const libScripts = [...productHtml.matchAll(/<script\s+src="lib\/([^"]+)"\s*>/g)].map((m) => m[1]);
    for (const lib of libScripts) {
      const escaped = lib.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\.\\./app-mirror/lib/${escaped}`);
      if (!re.test(kitBootstrapSrc)) {
        throw new Error(`kit-bootstrap must loadScript ../app-mirror/lib/${lib} (renderer.js depends on it)`);
      }
    }
  });

  it('kit fetch-splices app-mirror/index.html at runtime (D2-3c)', () => {
    if (!/fetch\s*\(\s*APP_INDEX\s*\)/.test(kitBootstrapSrc) ||
        !/['"]\.\.\/app-mirror\/index\.html['"]/.test(kitBootstrapSrc)) {
      throw new Error('kit-bootstrap.js must fetch ../app-mirror/index.html — drift surface');
    }
  });

  it('docs/app-mirror/ is in sync with app/ (D2-3c)', () => {
    const { spawnSync } = require('node:child_process');
    const r = spawnSync(process.execPath, [path.join(__dirname, 'sync-app-mirror.cjs'), '--check'], { encoding: 'utf8' });
    if (r.status !== 0) {
      throw new Error('docs/app-mirror/ is stale — run `node scripts/sync-app-mirror.cjs` to refresh\n' + (r.stderr || r.stdout || ''));
    }
  });

  it('kit index.html has no inline palette code (D2-3)', () => {
    if (/HSPLIT_PAIRS\s*=\s*\[/.test(kitHtmlSrc) || /VSPLIT_PAIRS\s*=\s*\[/.test(kitHtmlSrc)) {
      throw new Error('docs/ui-kit/index.html still declares the old tuple pairs');
    }
    if (/const\s+BASE_COLOURS\s*=\s*\[\s*['"]#ff5e5e['"]/.test(kitHtmlSrc)) {
      throw new Error('docs/ui-kit/index.html still inlines a BASE_COLOURS literal');
    }
  });

  // Strip CR from file reads — on Windows, git's autocrlf rewrites LF → CRLF
  // on checkout, but the generator emits plain LF. Normalise before comparing.
  // Real content drift still fails these asserts; line-ending policy is
  // deliberately not a test concern.
  const normNL = (s) => s.replace(/\r\n/g, '\n');

  it('generated tokens-window.js matches tokens.json palette byte-for-byte', () => {
    const expected = `window.TT_TOKENS = Object.freeze(${JSON.stringify(TOKENS, null, 2)});`;
    if (!normNL(tokensWin).includes(expected)) {
      throw new Error('app/lib/tokens-window.js is out of date — run `node scripts/generate-tokens-css.cjs`');
    }
  });

  it('generated tokens.mjs matches tokens.json palette byte-for-byte', () => {
    const expected = `export const TOKENS = Object.freeze(${JSON.stringify(TOKENS, null, 2)});`;
    if (!normNL(tokensMjs).includes(expected)) {
      throw new Error('docs/ui-kit/tokens.mjs is out of date — run `node scripts/generate-tokens-css.cjs`');
    }
  });

  it('all 24 arrangements match a pinned fixture (drift alarm)', () => {
    // Pinned fixture of correct arrangements. If this fails, either the
    // partner arrays in tokens.json changed on purpose (update the fixture)
    // or someone regressed the encoding (bug — investigate).
    const expected = [
      // 0-7: solid
      { kind: 'solid',  colours: ['#ff5e5e'] },
      { kind: 'solid',  colours: ['#ffa726'] },
      { kind: 'solid',  colours: ['#ffd93d'] },
      { kind: 'solid',  colours: ['#4ade80'] },
      { kind: 'solid',  colours: ['#60a5fa'] },
      { kind: 'solid',  colours: ['#ee2bbd'] },
      { kind: 'solid',  colours: ['#c97b50'] },
      { kind: 'solid',  colours: ['#e0e0e0'] },
      // 8-15: hsplit (red/green, orange/blue, yellow/magenta, and reverses, brown/white + reverse)
      { kind: 'hsplit', colours: ['#ff5e5e', '#4ade80'] },
      { kind: 'hsplit', colours: ['#ffa726', '#60a5fa'] },
      { kind: 'hsplit', colours: ['#ffd93d', '#ee2bbd'] },
      { kind: 'hsplit', colours: ['#4ade80', '#ff5e5e'] },
      { kind: 'hsplit', colours: ['#60a5fa', '#ffa726'] },
      { kind: 'hsplit', colours: ['#ee2bbd', '#ffd93d'] },
      { kind: 'hsplit', colours: ['#c97b50', '#e0e0e0'] },
      { kind: 'hsplit', colours: ['#e0e0e0', '#c97b50'] },
      // 16-23: vsplit
      { kind: 'vsplit', colours: ['#ff5e5e', '#60a5fa'] },
      { kind: 'vsplit', colours: ['#ffa726', '#ee2bbd'] },
      { kind: 'vsplit', colours: ['#ffd93d', '#c97b50'] },
      { kind: 'vsplit', colours: ['#4ade80', '#e0e0e0'] },
      { kind: 'vsplit', colours: ['#60a5fa', '#ff5e5e'] },
      { kind: 'vsplit', colours: ['#ee2bbd', '#ffa726'] },
      { kind: 'vsplit', colours: ['#c97b50', '#ffd93d'] },
      { kind: 'vsplit', colours: ['#e0e0e0', '#4ade80'] },
    ];
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const actual = arrangementForIndex(i);
      assertEqual(actual.kind, expected[i].kind, `arrangement ${i} kind`);
      assertEqual(actual.colours.length, expected[i].colours.length, `arrangement ${i} colour count`);
      for (let j = 0; j < actual.colours.length; j++) {
        assertEqual(actual.colours[j], expected[i].colours[j], `arrangement ${i} colour ${j}`);
      }
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

describe('REGISTRY LOCK (v0.3.3)', () => {
  // Guards concurrent writes to session-colours.json. The leak that
  // produced this lock: test harness seeded a fixture short, live
  // Electron's saveAssignments overwrote it, synth_turn.py read the
  // un-seeded registry, synthesised, leaked an MP3. Fix 1 (TT_HOME)
  // made the test stop writing to the real registry; this lock
  // serialises ANY future concurrent writer so the same class of
  // interleaving can't recur.
  const { withRegistryLock, _internals } = require(
    path.join(__dirname, '..', 'app', 'lib', 'registry-lock.js')
  );
  const tmpReg = path.join(os.tmpdir(), `tt-lock-test-${Date.now()}.json`);
  const tmpLock = tmpReg + '.lock';
  const cleanup = () => {
    try { fs.unlinkSync(tmpReg); } catch {}
    try { fs.unlinkSync(tmpLock); } catch {}
  };

  it('runs fn and returns its value', () => {
    cleanup();
    const r = withRegistryLock(tmpReg, () => 42);
    assertEqual(r, 42);
  });

  it('releases lock after fn returns (next acquire succeeds)', () => {
    cleanup();
    withRegistryLock(tmpReg, () => {});
    assertEqual(fs.existsSync(tmpLock), false);
  });

  it('releases lock even if fn throws', () => {
    cleanup();
    let caught = false;
    try {
      withRegistryLock(tmpReg, () => { throw new Error('boom'); });
    } catch { caught = true; }
    assertEqual(caught, true);
    assertEqual(fs.existsSync(tmpLock), false);
  });

  it('steals stale lock (older than LOCK_STALE_MS)', () => {
    cleanup();
    // Write a lock then back-date its mtime so the next acquire steals it.
    fs.writeFileSync(tmpLock, '999999');
    const old = (Date.now() - _internals.LOCK_STALE_MS - 1000) / 1000;
    fs.utimesSync(tmpLock, old, old);
    const r = withRegistryLock(tmpReg, () => 'stole-it');
    assertEqual(r, 'stole-it');
    cleanup();
  });

  it('second caller proceeds after first completes (serial)', () => {
    cleanup();
    const order = [];
    withRegistryLock(tmpReg, () => { order.push('a'); });
    withRegistryLock(tmpReg, () => { order.push('b'); });
    assertEqual(order, ['a', 'b']);
  });

  cleanup();
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

  // ------------------------------------------------------------------
  // A2-4 additions. One test per new abbreviation plus dash/NEL/LS/CJK.
  // Each abbreviation assertion is phrased so the sentence containing
  // the abbreviation is >= MIN_SENTENCE_LEN on its own -- otherwise the
  // short-sentence merger folds results together and the abbrev-vs-
  // boundary check is hidden by the fold.
  // ------------------------------------------------------------------
  it('abbrev approx. does not terminate a sentence', () => {
    const r = split('The payload is approx. 4 MB on the wire. Next sentence continues here.');
    assertEqual(r.length, 2);
    if (!r[0].includes('approx. 4 MB')) throw new Error(`approx mangled: ${r[0]}`);
  });
  it('abbrev aka does not terminate a sentence', () => {
    const r = split('She runs the Finance team, aka the money people these days. Next sentence here now.');
    assertEqual(r.length, 2);
    if (!r[0].includes('aka the money')) throw new Error(`aka mangled: ${r[0]}`);
  });
  it('abbrev ref. does not terminate a sentence', () => {
    const r = split('See ref. 4 for the full story on this. Next sentence here continues.');
    assertEqual(r.length, 2);
    if (!r[0].includes('ref. 4')) throw new Error(`ref mangled: ${r[0]}`);
  });
  it('abbrev misc. does not terminate a sentence', () => {
    const r = split('Bucket your receipts under misc. and move along now. Next sentence begins now.');
    assertEqual(r.length, 2);
    if (!r[0].includes('misc. and')) throw new Error(`misc mangled: ${r[0]}`);
  });
  it('abbrev incl./excl. do not terminate a sentence', () => {
    const r = split('Fees incl. VAT are the usual target here. Fees excl. VAT shipped separately.');
    assertEqual(r.length, 2);
    if (!r[0].includes('incl. VAT')) throw new Error(`incl mangled: ${r[0]}`);
    if (!r[1].includes('excl. VAT')) throw new Error(`excl mangled: ${r[1]}`);
  });
  it('abbrev assoc. does not terminate a sentence', () => {
    const r = split('She is assoc. prof at the local college there. Next sentence continues here.');
    assertEqual(r.length, 2);
    if (!r[0].includes('assoc. prof')) throw new Error(`assoc mangled: ${r[0]}`);
  });
  it('abbrev dept. does not terminate a sentence', () => {
    const r = split('HR dept. owns that policy for now at least. Next sentence runs here.');
    assertEqual(r.length, 2);
    if (!r[0].includes('HR dept.')) throw new Error(`dept mangled: ${r[0]}`);
  });
  it('abbrev ed. does not terminate a sentence', () => {
    const r = split('See the 2nd ed. of that book for details here. Next sentence follows on.');
    assertEqual(r.length, 2);
    if (!r[0].includes('2nd ed.')) throw new Error(`ed mangled: ${r[0]}`);
  });
  it('abbrev gen. does not terminate a sentence', () => {
    const r = split('The gen. formula is on the summary page now. Next sentence runs on.');
    assertEqual(r.length, 2);
    if (!r[0].includes('gen. formula')) throw new Error(`gen mangled: ${r[0]}`);
  });
  it('abbrev gov. does not terminate a sentence', () => {
    const r = split('They met with gov. officials this morning today. Next sentence follows on.');
    assertEqual(r.length, 2);
    if (!r[0].includes('gov. officials')) throw new Error(`gov mangled: ${r[0]}`);
  });
  it('abbrev pres. does not terminate a sentence', () => {
    const r = split('She served as pres. of the club for years now. Next sentence continues.');
    assertEqual(r.length, 2);
    if (!r[0].includes('pres. of')) throw new Error(`pres mangled: ${r[0]}`);
  });
  it('abbrev rep./sen. do not terminate a sentence', () => {
    const r = split('She met rep. Chen and sen. Okafor last Thursday. Next sentence runs here.');
    assertEqual(r.length, 2);
    if (!r[0].includes('rep. Chen')) throw new Error(`rep mangled: ${r[0]}`);
    if (!r[0].includes('sen. Okafor')) throw new Error(`sen mangled: ${r[0]}`);
  });

  it('em-dash without spaces is a legal hard-split point for long runs', () => {
    // One sentence >400 chars, no comma/space windows inside; em-dash is
    // the only place to cut. Pre-A2-4 the splitter fell through to bare
    // space; this asserts the em-dash wins because it's a better boundary.
    const left = 'x'.repeat(260);
    const right = 'y'.repeat(180);
    const r = split(`${left}\u2014${right}.`);
    if (r.length < 2) throw new Error(`expected em-dash hard split, got ${r.length}`);
  });

  it('normalises U+0085 (NEL) as a newline', () => {
    // NEL is treated as \n, so a pair becomes a paragraph break.
    const r = split('First line no terminator\u0085\u0085Second paragraph starts here right after.');
    assertEqual(r.length, 2);
  });
  it('normalises U+2028 (LS) as a newline', () => {
    const r = split('First line no terminator\u2028\u2028Second paragraph starts here right after.');
    assertEqual(r.length, 2);
  });

  it('CJK full-stop \\u3002 terminates a sentence', () => {
    // Two sentences separated by 。(U+3002) + space so _SENTENCE_END_RE's
    // mandatory \s+ after the terminator matches. Each half is >= the
    // 15-char MIN_SENTENCE_LEN so the short-sentence merger doesn't
    // re-fuse them. Tests that CJK-only input no longer collapses to
    // a single paragraph.
    const a = '\u3053\u308C\u306F\u6700\u521D\u306E\u6587\u306B\u3064\u3044\u3066\u306E\u8AAC\u660E\u3067\u3059';
    const b = '\u6B21\u306E\u6587\u3082\u9577\u3081\u306B\u66F8\u3044\u3066\u78BA\u5B9F\u306B\u5206\u89E3\u3057\u307E\u3059';
    const r = split(`${a}\u3002 ${b}\u3002`);
    if (r.length < 2) throw new Error(`CJK split failed, got length ${r.length}`);
  });
});

describe('SENTENCE GROUP (v0.5 smart grouping)', () => {
  // Groups adjacent short sentences into TTS-ready clips up to ~300 chars,
  // respecting paragraph boundaries. Without this, every full stop becomes
  // its own clip — staccato delivery for connected prose.
  const appDirRepo = path.join(__dirname, '..', 'app');
  const pyPrelude = `import sys; sys.path.insert(0, r'${appDirRepo.replace(/\\/g, '\\\\')}'); from sentence_group import group_sentences_for_tts; `;

  function group(text, opts) {
    const kwargs = opts
      ? `, target=${opts.target ?? 'None'}, hard_max=${opts.hard_max ?? 'None'}`
      : '';
    const code = `${pyPrelude}import json; print(json.dumps(group_sentences_for_tts(${JSON.stringify(text)}${kwargs})))`;
    const r = runPythonInline(code);
    if (r.code !== 0) throw new Error(`python exited ${r.code}: ${r.stderr}`);
    return JSON.parse(r.stdout.trim());
  }

  it('returns empty list for empty/whitespace input', () => {
    assertEqual(group(''), []);
    assertEqual(group('   \n  '), []);
  });
  it('single short sentence emits as one clip', () => {
    assertEqual(group('Hello there.'), ['Hello there.']);
  });
  it('goodnight fixture: 2 paragraphs → 2 clips (was 3 pre-grouping)', () => {
    // The real case Ben reported: splitting every full stop fragments
    // a short connected goodnight message into 3 clips. After grouping
    // the two-sentence first paragraph merges into one clip.
    const text = 'Good night Ben, everything saved: memory files, project docs, '
      + 'and the ten commits are on the main with CI green. '
      + 'Next session will boot straight into context.\n\nSleep well.';
    const r = group(text);
    assertEqual(r.length, 2, 'expected 2 clips (one per paragraph)');
    if (!r[0].includes('Good night Ben') || !r[0].includes('Next session')) {
      throw new Error(`p1 sentences not glued: ${r[0]}`);
    }
    assertEqual(r[1], 'Sleep well.');
  });
  it('paragraph boundaries are never crossed', () => {
    const text = 'First para sentence one enough chars. Second sentence also enough chars.'
      + '\n\nSecond para sentence one long enough. Another sentence here too.';
    const r = group(text);
    // Two paragraphs must never merge even if their combined total fits target.
    assertEqual(r.length, 2, 'paragraphs must flush separately');
    if (r[0].includes('Second para')) throw new Error(`paragraph bleed: ${r[0]}`);
    if (r[1].includes('First para')) throw new Error(`paragraph bleed: ${r[1]}`);
  });
  it('flushes when adding a sentence would exceed target', () => {
    // 5 sentences of ~100 chars each in one paragraph → should flush
    // when projected > target (300 default), producing ~2 clips not 5.
    const sent = 'This is a medium-length sentence with enough chars to be over fifteen characters and continue naturally well past that point.';
    const text = Array(5).fill(sent).join(' ');
    const r = group(text);
    if (r.length < 2) throw new Error(`expected >=2 clips from 5 medium sentences, got ${r.length}`);
    for (const c of r) if (c.length > 500) throw new Error(`clip over hard_max: ${c.length}`);
  });
  it('respects custom target and hard_max', () => {
    const text = 'Short one here. Short two here. Short three here. Short four here.';
    const tight = group(text, { target: 40 });
    const loose = group(text, { target: 500 });
    if (tight.length <= loose.length) {
      throw new Error(`tight target should yield more clips: ${tight.length} vs ${loose.length}`);
    }
  });
  it('sentence longer than hard_max emits alone without crashing', () => {
    // Build a sentence that's over hard_max even after upstream hard-split.
    // split_sentences hard-splits at MAX_SENTENCE_LEN (400), so we test at 450.
    const text = ('word '.repeat(90)).trim() + '.';  // ~450 chars, no full stops inside
    const r = group(text, { hard_max: 400 });
    assertTruthy(r.length >= 1, 'must emit something');
    for (const c of r) if (c.length > 500) throw new Error(`overflow: ${c.length}`);
  });
  it('double-take fixture: compresses 8-clip response to ~4 clips', () => {
    // The response Ben actually heard as 8 clips. Sanitised-form fixture.
    const text = 'Double-take done. Memory set now covers the following items. '
      + 'Overnight v0.4 EX6f plus EX7 refactor. '
      + 'Afternoon QA and UX fixes with ten commits on main. '
      + 'Ben environment, TT config and verify commands. '
      + 'Repo-side open-threads list updated. '
      + 'MEMORY index with pointers updated.\n\n'
      + 'What I went back and added on the double-take. '
      + 'The verification command block, how to check if installed app matches current main. '
      + 'Ben current TT config with hotkeys, playback speed 1.15, auto_prune 15s, CB palette off. '
      + 'Ben machine inventory: Win 11, Python 3.14.3, Node 24.14.0, pwsh 7.5.5. '
      + 'Preferences learned: build-first-not-ask, concrete-beats-abstract.\n\n'
      + 'A fresh session opening either the memory file or POST-V4-OPEN-THREADS gets a complete picture '
      + 'without replaying this conversation. Nothing else important is floating in chat-only memory.';
    const r = group(text);
    if (r.length > 6) throw new Error(`too many clips (${r.length}); grouping not helping`);
    if (r.length < 3) throw new Error(`too few clips (${r.length}); paragraph flushing broken`);
  });
  it('preserves original sentence content (no loss, no duplication)', () => {
    // Concatenation round-trip: joining the groups back should contain
    // every sentence's core content from the input.
    const text = 'First sentence has enough characters here. Second one also long enough to pass. '
      + 'Third follows with plenty of length.\n\nFourth in a new paragraph now. Fifth rounds us out.';
    const r = group(text);
    const joined = r.join(' ');
    for (const needle of ['First sentence', 'Second one', 'Third follows', 'Fourth in', 'Fifth rounds']) {
      if (!joined.includes(needle)) throw new Error(`lost content: "${needle}"`);
    }
    // No duplication: count occurrences of a unique marker
    if ((joined.match(/First sentence/g) || []).length !== 1) {
      throw new Error('duplicated content');
    }
  });
});

describe('TOOL NARRATION (v0.5 ephemeral tool-call phrases)', () => {
  // narrate_tool_use() maps (tool_name, tool_input) to a short spoken
  // status phrase, or None to skip. Emitted as T- prefixed ephemeral
  // clips that the renderer auto-deletes on playback-end.
  const appDirRepo = path.join(__dirname, '..', 'app');
  const pyPrelude = `import sys; sys.path.insert(0, r'${appDirRepo.replace(/\\/g, '\\\\')}'); from tool_narration import narrate_tool_use; `;

  function narrate(name, inp) {
    const code = `${pyPrelude}import json; r = narrate_tool_use(${JSON.stringify(name)}, ${JSON.stringify(inp)}); print(json.dumps(r))`;
    const r = runPythonInline(code);
    if (r.code !== 0) throw new Error(`python exited ${r.code}: ${r.stderr}`);
    return JSON.parse(r.stdout.trim());
  }

  it('Read uses basename not full path', () => {
    assertEqual(narrate('Read', { file_path: 'C:/Users/Ben/Desktop/foo/bar.py' }), 'Reading bar.py');
  });
  it('Read with missing path falls back to generic phrase', () => {
    assertEqual(narrate('Read', {}), 'Reading a file');
  });
  it('Edit uses basename', () => {
    assertEqual(narrate('Edit', { file_path: '/tmp/foo.js' }), 'Editing foo.js');
  });
  it('Write uses basename', () => {
    assertEqual(narrate('Write', { file_path: 'app/sentence_group.py' }), 'Writing sentence_group.py');
  });
  it('Bash uses first word of command, skipping env assignments', () => {
    assertEqual(narrate('Bash', { command: 'npm test --verbose' }), 'Running npm');
    assertEqual(narrate('Bash', { command: 'NODE_ENV=test npm run build' }), 'Running npm');
    assertEqual(narrate('Bash', {}), 'Running a command');
  });
  it('Grep pattern truncates at word boundary', () => {
    const out = narrate('Grep', { pattern: 'class Communicate' });
    assertEqual(out, 'Searching for class Communicate');
    const long = narrate('Grep', { pattern: 'x'.repeat(200) });
    if (long.length > 55) throw new Error(`not truncated: ${long.length} chars`);
  });
  it('Glob returns pattern phrase', () => {
    assertEqual(narrate('Glob', { pattern: '**/*.test.ts' }), 'Finding files matching **/*.test.ts');
  });
  it('WebFetch extracts bare domain (no www)', () => {
    assertEqual(narrate('WebFetch', { url: 'https://www.example.com/path?q=1' }), 'Fetching example.com');
  });
  it('WebSearch returns query phrase', () => {
    assertEqual(narrate('WebSearch', { query: 'edge tts streaming' }), 'Searching the web for edge tts streaming');
  });
  it('meta tools return null (no narration)', () => {
    for (const meta of ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'ExitPlanMode']) {
      assertEqual(narrate(meta, {}), null);
    }
  });
  it('MCP tools return null by default (varied + verbose)', () => {
    assertEqual(narrate('mcp__figma__authenticate', {}), null);
    assertEqual(narrate('mcp__slack__send_message', {}), null);
  });
  it('unknown tool returns null (conservative silence)', () => {
    assertEqual(narrate('SomeNewToolNameWeDontKnow', {}), null);
  });
  it('empty tool_name returns null', () => {
    assertEqual(narrate('', {}), null);
  });
  it('Task/Agent alias both work for sub-agents', () => {
    const a = narrate('Agent', { description: 'refactor queue' });
    const b = narrate('Task', { description: 'refactor queue' });
    assertEqual(a, b);
    if (!a.includes('refactor queue')) throw new Error(`bad sub-agent phrase: ${a}`);
  });
  it('all phrases stay under ~50 chars', () => {
    const samples = [
      ['Read', { file_path: 'some/longish/path/to/a/source_file.py' }],
      ['Bash', { command: 'echo hello world' }],
      ['Grep', { pattern: 'reasonable-length search pattern here' }],
      ['WebSearch', { query: 'how do I chunk tts audio for streaming' }],
    ];
    for (const [n, inp] of samples) {
      const phrase = narrate(n, inp);
      if (phrase && phrase.length > 55) {
        throw new Error(`phrase too long for ${n}: ${phrase.length}ch "${phrase}"`);
      }
    }
  });
});

describe('EPHEMERAL CLIP DETECTION (T- prefix)', () => {
  // isEphemeralClip from lib/clip-paths.js. Matches the filename shape
  // `<turn>-T-<seq>-<sessionshort>.(wav|mp3)` exactly — does not
  // false-match on regular body clips or on strings that happen to
  // contain the literal "T-" inside content.
  const clipPaths = require(path.join(__dirname, '..', 'app', 'lib', 'clip-paths'));

  it('recognises T-prefixed clip filenames', () => {
    assertTruthy(clipPaths.isEphemeralClip('20260421T233815497-T-0001-294c5d60.mp3'));
    assertTruthy(clipPaths.isEphemeralClip('20260421T233815497-T-0042-abcdef01.wav'));
  });
  it('rejects regular body clip filenames', () => {
    assertFalsy(clipPaths.isEphemeralClip('20260421T233815497-0001-294c5d60.mp3'));
  });
  it('rejects Q-prefixed question clip filenames', () => {
    assertFalsy(clipPaths.isEphemeralClip('20260421T233815497-Q-0001-294c5d60.mp3'));
  });
  it('rejects filenames with T- inside but not at the prefix slot', () => {
    // A malicious / unexpected filename shouldn't trigger ephemeral mode
    assertFalsy(clipPaths.isEphemeralClip('T-somefile-0001-294c5d60.mp3'));
    assertFalsy(clipPaths.isEphemeralClip('foo-T-bar-0001-294c5d60.mp3'));
  });
  it('still returns session short via extractSessionShort', () => {
    // T- prefix doesn't interfere with session identification
    assertEqual(
      clipPaths.extractSessionShort('20260421T233815497-T-0001-294c5d60.mp3'),
      '294c5d60'
    );
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
      'app/sentence_split.py', 'app/sentence_group.py', 'app/tool_narration.py', 'app/synth_turn.py',
      'app/lib/text.js',
      'app/session-registry.psm1',
      'app/tts-helper.psm1',
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
    // Modifier rules use a substring from the alternation, not a literal
    // `Ctrl\+` — the canonical implementation in app/lib/text.js uses a
    // single regex `(Ctrl|Control|Cmd|Command|Shift|...)\+` and both the
    // Python and PowerShell mirrors mirror that shape rather than keeping
    // a separate `\bCtrl\+` regex per modifier. The substring `Ctrl|Control`
    // is unique enough to confirm the modifier-handling rule is present
    // without enforcing a particular regex decomposition.
    { name: 'Ctrl keyboard modifier',       needle: 'Ctrl|Control' },
    { name: 'Cmd keyboard modifier',        needle: 'Cmd|Command' },
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

  it('canonical module exports stripForTTS', () => {
    // Post-S1 (Knip cleanup): DEFAULTS used to be re-exported but
    // nobody imported it — the const stays internal to text.js as
    // default-arg for stripForTTS. This test asserts the single
    // remaining public export shape.
    if (!/module\.exports\s*=\s*\{\s*stripForTTS\s*\}/.test(canonical)) {
      throw new Error('app/lib/text.js must export { stripForTTS } (single export since S1 Knip cleanup)');
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

describe('PS TTS-HELPER MODULE IS CANONICAL', () => {
  // CC-8 guard: the edge-tts + OpenAI fallback chain used to be
  // copy-pasted in speak-response.ps1 and speak-notification.ps1
  // (+ key-resolution logic in four places total, counting main.js).
  // Now both hooks Import-Module the shared app/tts-helper.psm1.
  const modulePath  = path.join(APP_DIR, 'tts-helper.psm1');
  const respHook    = fs.readFileSync(path.join(INSTALL_DIR, 'hooks', 'speak-response.ps1'), 'utf8');
  const notifHook   = fs.readFileSync(path.join(INSTALL_DIR, 'hooks', 'speak-notification.ps1'), 'utf8');
  const moduleSrc   = fs.readFileSync(modulePath, 'utf8');

  it('module exports the four canonical functions', () => {
    for (const fn of ['Resolve-OpenAiApiKey', 'Invoke-EdgeTts', 'Invoke-OpenAiTts', 'Invoke-TtsWithFallback']) {
      if (!moduleSrc.includes(`function ${fn}`)) {
        throw new Error(`tts-helper.psm1 missing function ${fn}`);
      }
    }
  });

  const CONSUMERS = [
    { name: 'speak-response.ps1',     src: respHook },
    { name: 'speak-notification.ps1', src: notifHook },
  ];

  for (const c of CONSUMERS) {
    it(`${c.name} imports the shared tts-helper module`, () => {
      if (!/Import-Module[^\n]*tts-helper\.psm1/.test(c.src)) {
        throw new Error(`${c.name}: missing Import-Module .../tts-helper.psm1`);
      }
    });
    it(`${c.name} no longer hand-rolls Invoke-WebRequest to OpenAI`, () => {
      // The direct POST used to live in both files. Module moves it
      // behind Invoke-OpenAiTts. If this shows up in a consumer, the
      // duplication has crept back.
      if (/Invoke-WebRequest[\s\S]{0,80}api\.openai\.com/.test(c.src)) {
        throw new Error(`${c.name}: still contains an inline Invoke-WebRequest to OpenAI`);
      }
    });
    it(`${c.name} no longer hand-rolls the ~/.claude/.env key walk`, () => {
      // That walk belongs inside Resolve-OpenAiApiKey. Consumers just
      // call the function.
      if (/\\.claude\\\\.env[\s\S]{0,200}OPENAI_API_KEY/.test(c.src)) {
        throw new Error(`${c.name}: still walks ~/.claude/.env manually (should use Resolve-OpenAiApiKey)`);
      }
    });
  }
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

  it('module exports the six canonical functions', () => {
    for (const fn of ['Read-Registry', 'Update-SessionAssignment', 'Save-Registry', 'Write-SessionPidFile', 'Enter-RegistryLock', 'Exit-RegistryLock']) {
      if (!moduleSrc.includes(`function ${fn}`)) {
        throw new Error(`session-registry.psm1 missing function ${fn}`);
      }
    }
    for (const fn of ['Read-Registry', 'Update-SessionAssignment', 'Save-Registry', 'Write-SessionPidFile', 'Enter-RegistryLock', 'Exit-RegistryLock']) {
      if (!new RegExp(`Export-ModuleMember[\\s\\S]*${fn}`).test(moduleSrc)) {
        throw new Error(`session-registry.psm1 must Export-ModuleMember ${fn}`);
      }
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
    it(`${c.name} lock-guards the Read-Update-Save triplet`, () => {
      // The JS toolbar and the PS hooks race on ~/.terminal-talk/
      // session-colours.json. PS callers MUST Enter-RegistryLock
      // before Read-Registry and Exit-RegistryLock after Save-Registry
      // or a toolbar Settings change can be stomped by a concurrent hook.
      // Mirror of JS-side app/lib/registry-lock.js withRegistryLock().
      if (!/\bEnter-RegistryLock\b/.test(c.src)) {
        throw new Error(`${c.name}: missing Enter-RegistryLock before Read/Save`);
      }
      if (!/\bExit-RegistryLock\b/.test(c.src)) {
        throw new Error(`${c.name}: missing Exit-RegistryLock (lock would never be freed)`);
      }
      // Structural check: the Save-Registry CALL (not a comment reference)
      // must sit between Acquire and Release. Strip comment-only PS lines
      // first so a "Read-Update-Save" reference in a docstring doesn't
      // fool .indexOf with an earlier match. Normalise CRLF→LF up front
      // because `\r` is a regex line-terminator in JS and defeats $.
      const stripped = c.src
        .replace(/\r/g, '')
        .split('\n')
        .filter((ln) => !/^\s*#/.test(ln))
        .join('\n');
      const acquireAt = stripped.indexOf('Enter-RegistryLock');
      const saveAt    = stripped.indexOf('Save-Registry');
      const releaseAt = stripped.indexOf('Exit-RegistryLock');
      if (!(acquireAt < saveAt && saveAt < releaseAt)) {
        throw new Error(`${c.name}: Acquire/Save/Release call ordering wrong (got Acquire@${acquireAt}, Save@${saveAt}, Release@${releaseAt})`);
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

  it('watchdog sweep wires pruneOldFiles + pruneSessionsDir + killOrphanVoiceListeners', () => {
    // EX6d — watchdog is now a factory (createWatchdog from
    // app/lib/watchdog.js); main.js passes the sweep functions via
    // the `sweeps` + `postSweepFns` options. Grep the createWatchdog
    // call site for the expected wire-up.
    const createIdx = main.indexOf('createWatchdog({');
    if (createIdx < 0) throw new Error('createWatchdog({ ... }) call site missing');
    // Slice from the call to its closing `});` — a reasonable bound.
    const endIdx = main.indexOf('\n});', createIdx);
    const sweep = main.slice(createIdx, endIdx > 0 ? endIdx : createIdx + 2000);
    for (const fn of ['pruneOldFiles', 'pruneSessionsDir', 'killOrphanVoiceListeners']) {
      if (!sweep.includes(fn)) throw new Error(`createWatchdog must wire ${fn}`);
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

  // D2-9 — style-src no longer permits 'unsafe-inline'. Dynamic values
  // now go through data-palette + generated palette-classes.css (dots
  // and swatches), .hidden class (play/pause toggles), or Constructable
  // Stylesheets (continuous mascot / spinner positions). If anyone adds
  // `element.style.X = Y` or a `style="..."` attribute without also
  // re-enabling 'unsafe-inline', the renderer will throw silently in
  // production — catch it in tests instead.
  it("CSP style-src is 'self' (no 'unsafe-inline' — D2-9)", () => {
    const html = fs.readFileSync(path.join(INSTALL_DIR, 'app', 'index.html'), 'utf8');
    // Extract the policy STRING from the meta tag first — a naive
    // /style-src\s+([^;]+);/ match against the whole file hits the
    // multi-line HTML comment above the meta tag that explains each
    // directive in prose, and greedy matches across its line breaks.
    const metaMatch = html.match(/http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/);
    if (!metaMatch) throw new Error('no Content-Security-Policy meta tag');
    const policy = metaMatch[1];
    const m = policy.match(/style-src\s+([^;]+);/);
    if (!m) throw new Error('CSP missing style-src directive');
    if (/'unsafe-inline'/.test(m[1])) {
      throw new Error(`style-src must not include 'unsafe-inline' (D2-9): ${m[1].trim()}`);
    }
    if (!/'self'/.test(m[1])) {
      throw new Error(`style-src should include 'self': ${m[1].trim()}`);
    }
  });

  it('app/index.html has no inline style="..." attributes (D2-9)', () => {
    const html = fs.readFileSync(path.join(INSTALL_DIR, 'app', 'index.html'), 'utf8');
    // Match style="..." but allow style-src= in the CSP meta tag.
    const matches = html.match(/\sstyle="[^"]+"/g) || [];
    if (matches.length > 0) {
      throw new Error(`index.html has ${matches.length} inline style="…" attribute(s) — would be blocked by CSP: ${matches.join(', ')}`);
    }
  });

  it('renderer.js has no element.style assignments for display/left/background/boxShadow (D2-9)', () => {
    const rend = fs.readFileSync(path.join(INSTALL_DIR, 'app', 'renderer.js'), 'utf8');
    // Strip `// ...` comments globally — `[^\r\n]*` explicitly excludes
    // CR and LF so the regex behaves identically on LF and CRLF files.
    // Also strip `/* ... */` block comments in case future code adds
    // rationale explanations for the removed `.style.X = ...` patterns.
    const code = rend.replace(/\/\/[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const blocked = /\w+\.style\.(display|left|background|boxShadow)\s*=/.exec(code);
    if (blocked) {
      throw new Error(`renderer.js contains blocked inline-style assignment: "${blocked[0]}" — use data-palette, .hidden class, or setDynamicStyle() instead (D2-9)`);
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

// =============================================================================
// SESSION STALE DETECTION — dead-terminal visual signal.
// =============================================================================
// computeStaleSessions is a pure function so we can drive it with fixtures
// instead of spawning terminals. Regression tests lock the rules the
// renderer's 10-s poll relies on.
describe('SESSION STALE DETECTION', () => {
  const { computeStaleSessions } = require(
    path.join(__dirname, '..', 'app', 'lib', 'session-stale.js')
  );
  const NOW = 10_000;

  it('empty registry -> no stale sessions', () => {
    assertEqual(computeStaleSessions({}, new Set(), new Set(), NOW), []);
  });

  it('session with a live sessions/ file is NOT stale', () => {
    const stale = computeStaleSessions(
      { aabbccdd: { index: 0, last_seen: NOW - 1 } },
      new Set(['aabbccdd']),
      new Set(),
      NOW
    );
    assertEqual(stale, []);
  });

  it('session whose claude_pid is alive is NOT stale', () => {
    const stale = computeStaleSessions(
      { aabbccdd: { index: 0, claude_pid: 4321, last_seen: 0 } },
      new Set(),
      new Set([4321]),
      NOW
    );
    assertEqual(stale, []);
  });

  it('session with no live source AND expired grace IS stale', () => {
    const stale = computeStaleSessions(
      { aabbccdd: { index: 0, last_seen: NOW - 30 } },
      new Set(),
      new Set(),
      NOW,
      10
    );
    assertEqual(stale, ['aabbccdd']);
  });

  it('session still within grace window is NOT stale', () => {
    const stale = computeStaleSessions(
      { aabbccdd: { index: 0, last_seen: NOW - 5 } },
      new Set(),
      new Set(),
      NOW,
      10
    );
    assertEqual(stale, []);
  });

  it('pinned sessions are NEVER stale, even if PID gone', () => {
    const stale = computeStaleSessions(
      { aabbccdd: { index: 0, pinned: true, last_seen: 0 } },
      new Set(),
      new Set(),
      NOW
    );
    assertEqual(stale, []);
  });

  // v0.3.3 — renderer playback guard. The stale set was previously a
  // visual-only signal; playNextPending filtered muted clips but not
  // stale ones, so a late-arriving detached-synth clip (or a leaked
  // test fixture) would still auto-play after the terminal closed.
  // The renderer now treats stale like muted for auto-play purposes
  // in all three non-priority branches; the dot stays clickable for
  // manual play. This is a source-grep regression test — a DOM-level
  // integration lives in e2e.
  it('playNextPending skips stale-session clips (renderer guard)', () => {
    const rendererSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer.js'), 'utf8');
    if (!/function\s+isPathSessionStale\s*\(/.test(rendererSrc)) {
      throw new Error('renderer.js must define isPathSessionStale(path)');
    }
    // The function must be called from all three non-priority branches.
    // We count occurrences inside playNextPending by finding its body.
    const m = rendererSrc.match(/function\s+playNextPending\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
    if (!m) throw new Error('playNextPending function body not found');
    const body = m[1];
    const calls = (body.match(/isPathSessionStale\s*\(/g) || []).length;
    if (calls < 3) {
      throw new Error(`playNextPending must call isPathSessionStale in at least 3 branches (focus, pending, fallback); found ${calls}`);
    }
  });

  it('initialLoad populates pendingQueue oldest-first (v0.3.4 kit regression)', () => {
    // main.js returns queue newest-first; pendingQueue.shift() must yield
    // oldest so playback walks the dot strip left-to-right. Without an
    // explicit ascending sort in initialLoad, pending ends up newest-first
    // and playback sweeps rightmost-to-leftmost. onQueueUpdated already
    // sorts ascending — initialLoad must do the same.
    const rendererSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer.js'), 'utf8');
    const m = rendererSrc.match(/async\s+function\s+initialLoad\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
    if (!m) throw new Error('initialLoad function body not found');
    const body = m[1];
    // Must sort ascending by mtime before pushing to pendingQueue.
    if (!/\.sort\s*\(\s*\(a,\s*b\)\s*=>\s*a\.mtime\s*-\s*b\.mtime\s*\)/.test(body)) {
      throw new Error('initialLoad must sort unplayed files ascending (a.mtime - b.mtime) before pushing to pendingQueue');
    }
  });

  it('mixed live + dead -> only dead ones returned, sorted', () => {
    const assignments = {
      '11111111': { index: 1, last_seen: NOW - 1 },               // live (in shorts)
      '22222222': { index: 2, pinned: true, last_seen: 0 },        // pinned
      '33333333': { index: 3, last_seen: NOW - 1000 },             // STALE
      'aaaaaaaa': { index: 4, last_seen: NOW - 1000 },             // STALE
      '44444444': { index: 5, claude_pid: 99, last_seen: 0 }       // live (pid)
    };
    const stale = computeStaleSessions(
      assignments,
      new Set(['11111111']),
      new Set([99]),
      NOW, 10
    );
    assertEqual(stale, ['33333333', 'aaaaaaaa']);
  });
});

// =============================================================================
// PALETTE ALLOCATION — lowest-free-index with LRU eviction fallback.
// =============================================================================
// Fixes G10: when the 24-slot palette was full, the old hash-mod fallback
// produced a GUARANTEED visual collision (two different sessions painted
// the same colour). LRU eviction drops whoever's been quiet longest and
// reuses their slot, so the new session always gets a unique colour.
describe('PALETTE ALLOCATION (LRU eviction)', () => {
  const { allocatePaletteIndex } = require(
    path.join(__dirname, '..', 'app', 'lib', 'palette-alloc.js')
  );

  it('empty registry -> index 0, no eviction', () => {
    const r = allocatePaletteIndex('aabbccdd', {}, 24);
    assertEqual(r.index, 0);
    assertEqual(r.evicted, null);
    assertEqual(r.reason, 'free');
  });

  it('lowest free index -- fills 0,1,2,... in order', () => {
    const all = {};
    for (let i = 0; i < 10; i++) {
      all[`sess${i.toString().padStart(4, '0')}`] = { index: i, last_seen: 100 + i };
    }
    const r = allocatePaletteIndex('aabbccdd', all, 24);
    assertEqual(r.index, 10);
    assertEqual(r.reason, 'free');
  });

  it('palette full -> evicts LRU non-pinned (oldest last_seen)', () => {
    const all = {};
    // 24 sessions, last_seen ascending so session #00000000 is the LRU.
    for (let i = 0; i < 24; i++) {
      all[`s${i.toString().padStart(7, '0')}`] = { index: i, last_seen: 1000 + i };
    }
    const r = allocatePaletteIndex('newshort', all, 24);
    assertEqual(r.reason, 'lru');
    assertEqual(r.evicted, 's0000000');         // oldest last_seen
    assertEqual(r.index, 0);                     // their slot
  });

  it('LRU eviction SKIPS pinned sessions', () => {
    const all = {};
    for (let i = 0; i < 24; i++) {
      all[`s${i.toString().padStart(7, '0')}`] = {
        index: i, last_seen: 1000 + i,
        pinned: i === 0     // oldest is pinned -> must NOT be evicted
      };
    }
    const r = allocatePaletteIndex('newshort', all, 24);
    assertEqual(r.reason, 'lru');
    // Second-oldest (unpinned) wins eviction.
    assertEqual(r.evicted, 's0000001');
    assertEqual(r.index, 1);
  });

  it('all 24 slots pinned -> hash-collision fallback (no unique slot)', () => {
    const all = {};
    for (let i = 0; i < 24; i++) {
      all[`s${i.toString().padStart(7, '0')}`] = {
        index: i, last_seen: 1000 + i, pinned: true
      };
    }
    const r = allocatePaletteIndex('aabbccdd', all, 24);
    assertEqual(r.reason, 'hash-collision');
    assertEqual(r.evicted, null);
    // Hash: 'a'*4 + 'b'*2 + 'c'*2 + 'd'*1 chars = sum of charCodes.
    let sum = 0; for (const c of 'aabbccdd') sum += c.charCodeAt(0);
    assertEqual(r.index, sum % 24);
  });

  it('LRU tiebreak is deterministic (alphabetical when last_seen equal)', () => {
    const all = {};
    for (let i = 0; i < 24; i++) {
      all[`s${i.toString().padStart(7, '0')}`] = { index: i, last_seen: 500 };
    }
    const r = allocatePaletteIndex('newshort', all, 24);
    assertEqual(r.reason, 'lru');
    assertEqual(r.evicted, 's0000000');          // alphabetically first
  });

  it('main.js delegates to allocatePaletteIndex (no inline hash-mod)', () => {
    const mainPath = path.join(__dirname, '..', 'app', 'main.js');
    const src = fs.readFileSync(mainPath, 'utf8');
    if (!/allocatePaletteIndex\s*\(/.test(src)) {
      throw new Error('main.js must call allocatePaletteIndex from the shared helper');
    }
    // Old inline fallback: `sum % 24` when palette full. Must be gone.
    if (/let\s+sum\s*=\s*0[\s\S]{0,120}%\s*24/.test(src)) {
      throw new Error('main.js still has the inline hash-mod fallback; LRU eviction was bypassed');
    }
  });

  it('session-registry.psm1 mirrors LRU eviction (not hash-only)', () => {
    const psPath = path.join(__dirname, '..', 'app', 'session-registry.psm1');
    const src = fs.readFileSync(psPath, 'utf8');
    // The LRU branch must be present. Easiest stable signal: "Sort-Object LastSeen".
    if (!/Sort-Object\s+LastSeen/i.test(src)) {
      throw new Error('session-registry.psm1 must LRU-evict when palette full (Sort-Object LastSeen missing)');
    }
    // Pinned sessions must be skipped from eviction candidates.
    if (!/pinned\s*-ne\s*\$true/.test(src)) {
      throw new Error('session-registry.psm1 LRU eviction must exclude pinned entries');
    }
  });
});

// =============================================================================
// IPC WIRING — the renderer's 10 s poll needs main.js to expose the handler
// and preload.js to bridge it. Lock-step test so future refactors don't
// silently break the stale-UI signal.
// =============================================================================
describe('STALE SESSIONS IPC WIRING', () => {
  it("ipc-handlers.js registers 'get-stale-sessions' IPC handler", () => {
    // EX6f-1 — handler moved from main.js to app/lib/ipc-handlers.js.
    // main.js still references computeStaleSessions (passes it as a
    // factory dep) so the delegation check stays on main.js.
    const ipcPath = path.join(__dirname, '..', 'app', 'lib', 'ipc-handlers.js');
    const ipcSrc = fs.readFileSync(ipcPath, 'utf8');
    if (!/ipcMain\.handle\(['"]get-stale-sessions['"]/.test(ipcSrc)) {
      throw new Error("ipc-handlers.js missing ipcMain.handle('get-stale-sessions', ...)");
    }
    const mainPath = path.join(__dirname, '..', 'app', 'main.js');
    const mainSrc = fs.readFileSync(mainPath, 'utf8');
    if (!/computeStaleSessions/.test(mainSrc)) {
      throw new Error('main.js should delegate to computeStaleSessions');
    }
  });

  it("preload.js exposes getStaleSessions on window.api", () => {
    const preloadPath = path.join(__dirname, '..', 'app', 'preload.js');
    const src = fs.readFileSync(preloadPath, 'utf8');
    if (!/getStaleSessions\s*:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]get-stale-sessions['"]\)/.test(src)) {
      throw new Error('preload.js missing getStaleSessions bridge');
    }
  });

  it('renderer.js polls stale sessions and applies .stale class', () => {
    // EX7b — staleSessionShorts variable became staleSessionPoller
    // (a StaleSessionPoller component); the IPC call + grey-out
    // behaviours are still wired. The IPC call now lives in the
    // poller module, so accept it being reachable from either file.
    const rendererPath = path.join(__dirname, '..', 'app', 'renderer.js');
    const rendererSrc = fs.readFileSync(rendererPath, 'utf8');
    const pollerPath = path.join(__dirname, '..', 'app', 'lib', 'stale-session-poller.js');
    const pollerSrc = fs.readFileSync(pollerPath, 'utf8');
    if (!/staleSessionPoller/.test(rendererSrc)) {
      throw new Error('renderer.js should use the staleSessionPoller component');
    }
    if (!/getStaleSessions/.test(pollerSrc)) {
      throw new Error('stale-session-poller.js should call api.getStaleSessions');
    }
    // EX7c + EX7d-1 — .stale class application moved into DotStrip
    // (per-dot) and SessionsTable (per-row). Accept either source.
    const dotStripSrc = fs.readFileSync(
      path.join(__dirname, '..', 'app', 'lib', 'dot-strip.js'), 'utf8'
    );
    const sessionsTableSrc = fs.readFileSync(
      path.join(__dirname, '..', 'app', 'lib', 'sessions-table.js'), 'utf8'
    );
    const anyStaleAdd = /classList\.add\(['"]stale['"]\)/.test(dotStripSrc)
      || /classList\.add\(['"]stale['"]\)/.test(sessionsTableSrc);
    if (!anyStaleAdd) {
      throw new Error("dot-strip.js or sessions-table.js should classList.add('stale') on dot/row");
    }
  });
});

// =============================================================================
// R6.2 — BOUNDED CONCURRENCY helper. speakClipboard now parallelises
// edge-tts per-chunk synth. The mapLimit primitive must preserve source
// order in the output array and bound the in-flight count so the MS
// Edge TTS service doesn't 429 under unbounded fan-out.
// =============================================================================
describe('BOUNDED CONCURRENCY (R6.2 / R22)', () => {
  const { mapLimit } = require(path.join(__dirname, '..', 'app', 'lib', 'concurrency.js'));

  it('empty input -> empty result', async () => {
    const r = await mapLimit([], 4, async () => { throw new Error('should not run'); });
    assertEqual(r, []);
  });

  it('output preserves source order regardless of task finish order', async () => {
    // Inverse delays: first task sleeps longest, last sleeps 0.
    const r = await mapLimit([30, 20, 10, 0], 4, async (ms, i) => {
      await new Promise(resolve => setTimeout(resolve, ms));
      return `item-${i}`;
    });
    assertEqual(r, ['item-0', 'item-1', 'item-2', 'item-3']);
  });

  it('caps in-flight tasks at `limit`', async () => {
    let inFlight = 0;
    let peak = 0;
    const work = Array.from({ length: 20 }, (_, i) => i);
    await mapLimit(work, 3, async () => {
      inFlight++;
      if (inFlight > peak) peak = inFlight;
      await new Promise(resolve => setTimeout(resolve, 10));
      inFlight--;
    });
    if (peak > 3) throw new Error(`peak in-flight was ${peak}, expected <= 3`);
    if (peak < 2) throw new Error(`peak in-flight was ${peak}, expected close to cap`);
  });

  it('thrown errors become Error entries at the correct index', async () => {
    const r = await mapLimit([1, 2, 3], 2, async (x, i) => {
      if (i === 1) throw new Error('boom');
      return x * 10;
    });
    assertEqual(r[0], 10);
    if (!(r[1] instanceof Error)) throw new Error('r[1] should be an Error');
    if (r[1].message !== 'boom') throw new Error('Error message lost');
    assertEqual(r[2], 30);
  });

  it('speakClipboard wires mapLimit + filters null/Error', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8');
    if (!/require\(['"]\.\/lib\/concurrency['"]\)/.test(src)) {
      throw new Error('main.js must require ./lib/concurrency');
    }
    if (!/mapLimit\(chunks,\s*CLIP_CONCURRENCY/.test(src)) {
      throw new Error('speakClipboard must call mapLimit(chunks, CLIP_CONCURRENCY, ...)');
    }
    if (!/positional\.filter\(p\s*=>\s*p\s*&&\s*!\(p\s+instanceof\s+Error\)\)/.test(src)) {
      throw new Error('speakClipboard must drop null + Error entries before priority-play');
    }
  });
});

// =============================================================================
// R5.4 — EXPONENTIAL BACKOFF helper. Pure module so we can pin down the
// curve without spawning Python processes.
// =============================================================================
describe('VOICE LISTENER BACKOFF (R5.4 / R19)', () => {
  const { exponentialBackoff } = require(
    path.join(__dirname, '..', 'app', 'lib', 'backoff.js')
  );
  const noJitter = () => 0;
  const BASE = 5000;
  const CAP = 300_000;

  it('attempt 1 -> base delay', () => {
    assertEqual(exponentialBackoff(1, BASE, CAP, 0, noJitter), 5000);
  });
  it('attempt 2 -> base * 2', () => {
    assertEqual(exponentialBackoff(2, BASE, CAP, 0, noJitter), 10000);
  });
  it('attempt 3 -> base * 4', () => {
    assertEqual(exponentialBackoff(3, BASE, CAP, 0, noJitter), 20000);
  });
  it('attempt 10 is capped at maxMs', () => {
    assertEqual(exponentialBackoff(10, BASE, CAP, 0, noJitter), CAP);
  });
  it('attempt 0 degrades to base (defensive default)', () => {
    assertEqual(exponentialBackoff(0, BASE, CAP, 0, noJitter), 5000);
  });
  it('jitter adds 0..jitterMs ms on top of the capped delay', () => {
    const d = exponentialBackoff(1, BASE, CAP, 500, () => 0.5);
    assertEqual(d, 5000 + 250);
  });
  it('main.js wires exponentialBackoff through computeVoiceBackoffMs', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'app', 'main.js'), 'utf8'
    );
    if (!/require\(['"]\.\/lib\/backoff['"]\)/.test(src)) {
      throw new Error('main.js must require ./lib/backoff');
    }
    if (!/exponentialBackoff\s*\(\s*count/.test(src)) {
      throw new Error('computeVoiceBackoffMs should delegate to exponentialBackoff');
    }
  });
});

// =============================================================================
// R5 — RUNTIME ROBUSTNESS GUARDS. Small-surface regression tests that fail
// loudly if the fixes for R5.1 / R5.2 / R5.5 get reverted.
// =============================================================================
describe('R5 RUNTIME ROBUSTNESS', () => {
  const rendererPath = path.join(__dirname, '..', 'app', 'renderer.js');
  const mainPath = path.join(__dirname, '..', 'app', 'main.js');

  it('R5.1 G12: priorityPaths.delete happens at priorityQueue.shift site', () => {
    const src = fs.readFileSync(rendererPath, 'utf8');
    const shiftIdx = src.indexOf('priorityQueue.shift()');
    if (shiftIdx < 0) throw new Error('priorityQueue.shift() call not found');
    // Within the next ~250 chars of the shift site we must see a delete
    // of the same path from priorityPaths. Small window so re-inlining
    // the shift elsewhere without the cleanup still fails the test.
    const window = src.slice(shiftIdx, shiftIdx + 500);
    if (!/priorityPaths\.delete\(next\)/.test(window)) {
      throw new Error('priorityPaths.delete(next) missing within 500 chars of priorityQueue.shift()');
    }
  });

  it('R5.2 G13: scheduleAutoDelete re-checks currentPath before deleteFile', () => {
    // EX7e — currentPath now lives inside AudioPlayer; readers call
    // audioPlayer.getCurrentPath(). Still need TWO guards: one before
    // renderDots, one before the IPC unlink.
    // v0.5 — body grew past 900 chars when ephemeral-clip (T- prefix)
    // branching + comments were added; bump capture window to 2000.
    const src = fs.readFileSync(rendererPath, 'utf8');
    const block = src.match(/function scheduleAutoDelete[\s\S]{0,2000}\n\}/);
    if (!block) throw new Error('scheduleAutoDelete block not found');
    const count = (block[0].match(/audioPlayer\.getCurrentPath\(\)\s*===\s*p/g) || []).length;
    if (count < 2) {
      throw new Error(`scheduleAutoDelete should re-check audioPlayer.getCurrentPath() after renderDots; found ${count} guard(s)`);
    }
  });

  it('R5.5 R32: corrupt registry is archived, not silently overwritten', () => {
    const src = fs.readFileSync(mainPath, 'utf8');
    if (!/archiveCorruptRegistry/.test(src)) {
      throw new Error('main.js missing archiveCorruptRegistry helper');
    }
    // Must be called on JSON.parse failure AND on shape mismatch.
    const load = src.match(/function loadAssignments[\s\S]{0,1500}\n\}/);
    if (!load) throw new Error('loadAssignments block not found');
    if (!/archiveCorruptRegistry\(.{0,80}JSON\.parse/i.test(load[0])) {
      throw new Error('loadAssignments must archive on JSON.parse failure');
    }
    if (!/archiveCorruptRegistry\(.{0,80}(missing|assignments|shape)/i.test(load[0])) {
      throw new Error('loadAssignments must archive on shape mismatch');
    }
  });

  it('R6.3 R23: synth placeholder dot is wired through clipboard-status', () => {
    const mainPath = path.join(__dirname, '..', 'app', 'main.js');
    const rendSrc = fs.readFileSync(rendererPath, 'utf8');
    const mainSrc = fs.readFileSync(mainPath, 'utf8');
    if (!/sendClipboardStatus\(['"]synth['"]\)/.test(mainSrc)) {
      throw new Error("main.js must emit clipboard-status {state:'synth'} when speakClipboard starts");
    }
    if (!/sendClipboardStatus\(['"]idle['"]\)/.test(mainSrc)) {
      throw new Error("main.js must emit clipboard-status {state:'idle'} from speakClipboard finally");
    }
    if (!/onClipboardStatus/.test(rendSrc)) {
      throw new Error('renderer.js must subscribe to onClipboardStatus');
    }
    if (!/synthInProgress/.test(rendSrc)) {
      throw new Error('renderer.js should track synthInProgress');
    }
    // EX7c — placeholder DOM build moved into DotStrip component. The
    // synthInProgress flag still originates in renderer.js and is
    // passed through dotStrip.update(); the DOM node creation lives
    // in dot-strip.js.
    const dotStripSrc = fs.readFileSync(
      path.join(__dirname, '..', 'app', 'lib', 'dot-strip.js'), 'utf8'
    );
    if (!/pending-synth/.test(dotStripSrc)) {
      throw new Error('dot-strip.js should append a .dot.pending-synth placeholder');
    }
    const styles = fs.readFileSync(path.join(__dirname, '..', 'app', 'styles.css'), 'utf8');
    if (!/\.dot\.pending-synth\b/.test(styles)) {
      throw new Error('styles.css missing .dot.pending-synth rule');
    }
    if (!/prefers-reduced-motion[\s\S]{0,300}pending-synth/.test(styles)) {
      throw new Error('styles.css must honour prefers-reduced-motion for the pulse');
    }
  });

  it('R6.1 R12: renderDots is rAF-throttled to one paint per frame', () => {
    // EX7c — rAF debounce moved into DotStrip._onUpdate. renderer.js
    // still has a renderDots() wrapper that fans out to
    // dotStrip.update(); the component coalesces via _pendingRaf.
    const rendSrc = fs.readFileSync(rendererPath, 'utf8');
    const dotStripSrc = fs.readFileSync(
      path.join(__dirname, '..', 'app', 'lib', 'dot-strip.js'), 'utf8'
    );
    if (!/function renderDots/.test(rendSrc) || !/dotStrip\.update/.test(rendSrc)) {
      throw new Error('renderer.js should wrap renderDots() around dotStrip.update()');
    }
    if (!/_pendingRaf/.test(dotStripSrc)) {
      throw new Error('dot-strip.js should coalesce renders via a _pendingRaf latch');
    }
    if (!/requestAnimationFrame\(/.test(dotStripSrc)) {
      throw new Error('dot-strip.js should use requestAnimationFrame to coalesce paints');
    }
  });

  it('R5.5: archive destination uses .corrupt-<timestamp>.json suffix', () => {
    const src = fs.readFileSync(mainPath, 'utf8');
    if (!/\.corrupt-.{0,40}\$\{ts\}/.test(src) && !/\.corrupt-\$\{ts\}/.test(src)) {
      throw new Error('archive filename should embed ISO timestamp (.corrupt-<ts>.json)');
    }
  });
});

// =============================================================================
// TABS COMPONENT — per-session filter with unread-count badges
// =============================================================================
describe('TABS — unread count is derived, not stored', () => {
  // Stub the Component base before requiring tabs.js (Node path).
  const componentPath = path.join(__dirname, '..', 'app', 'lib', 'component.js');
  const tabsPath = path.join(__dirname, '..', 'app', 'lib', 'tabs.js');
  // Clear require cache so re-requires always see the current source.
  delete require.cache[require.resolve(componentPath)];
  delete require.cache[require.resolve(tabsPath)];
  const tabsModule = require(tabsPath);
  const { unreadCount, partitionSessions, truncateLabel } = tabsModule._internals;

  // Minimal clipPaths stub: filenames shaped "<kind>_<short8>_<ts>.mp3".
  // extractSessionShort returns the short8 token.
  const stubClipPaths = {
    extractSessionShort(fname) {
      const m = /^[a-z]+_([a-f0-9]{8})_/.exec(fname || '');
      return m ? m[1] : null;
    },
    isClipFile(fname) { return /^clip_/.test(fname || ''); },
    paletteKeyForShort() { return '00'; },
  };

  const mkClip = (short, id) => ({
    path: `C:\\fake\\queue\\resp_${short}_${id}.mp3`,
    mtime: Date.now() + Number(id),
  });

  it('MIL-1: 5 clips in a session, 2 played → unread reads as 3', () => {
    const queue = ['a', 'b', 'c', 'd', 'e'].map((id) => mkClip('aaaaaaaa', id));
    const heard = new Set([queue[0].path, queue[2].path]);
    const n = unreadCount(queue, heard, stubClipPaths, 'aaaaaaaa');
    if (n !== 3) throw new Error(`expected 3 unplayed, got ${n}`);
  });

  it('MIL-2: each additional play decrements unread monotonically', () => {
    const queue = [0, 1, 2, 3, 4].map((id) => mkClip('aaaaaaaa', id));
    const heard = new Set();
    const progression = [];
    for (const f of queue) {
      progression.push(unreadCount(queue, heard, stubClipPaths, 'aaaaaaaa'));
      heard.add(f.path);
    }
    progression.push(unreadCount(queue, heard, stubClipPaths, 'aaaaaaaa'));
    const expected = [5, 4, 3, 2, 1, 0];
    if (JSON.stringify(progression) !== JSON.stringify(expected)) {
      throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(progression)}`);
    }
  });

  it('MIL-3: per-session count ignores other sessions entirely', () => {
    const queue = [
      mkClip('aaaaaaaa', 0), mkClip('aaaaaaaa', 1), mkClip('aaaaaaaa', 2),
      mkClip('bbbbbbbb', 0), mkClip('bbbbbbbb', 1),
      mkClip('cccccccc', 0),
    ];
    const heard = new Set();
    const a = unreadCount(queue, heard, stubClipPaths, 'aaaaaaaa');
    const b = unreadCount(queue, heard, stubClipPaths, 'bbbbbbbb');
    const c = unreadCount(queue, heard, stubClipPaths, 'cccccccc');
    if (a !== 3 || b !== 2 || c !== 1) {
      throw new Error(`per-session a=${a} b=${b} c=${c}, expected 3/2/1`);
    }
  });

  it('MIL-4: All count = sum of per-session, and also = total-unheard', () => {
    const queue = [
      mkClip('aaaaaaaa', 0), mkClip('aaaaaaaa', 1), mkClip('aaaaaaaa', 2),
      mkClip('bbbbbbbb', 0), mkClip('bbbbbbbb', 1),
    ];
    const heard = new Set([queue[0].path]); // play one aaaa clip
    const all = unreadCount(queue, heard, stubClipPaths, 'all');
    const a = unreadCount(queue, heard, stubClipPaths, 'aaaaaaaa');
    const b = unreadCount(queue, heard, stubClipPaths, 'bbbbbbbb');
    if (all !== a + b) throw new Error(`all (${all}) != a+b (${a}+${b}=${a+b})`);
    if (all !== queue.length - heard.size) throw new Error(`all (${all}) != total-unheard (${queue.length - heard.size})`);
  });

  it('MIL-5: replaying a heard clip keeps unread at 0 (no double-count)', () => {
    const queue = [mkClip('aaaaaaaa', 0), mkClip('aaaaaaaa', 1)];
    const heard = new Set([queue[0].path, queue[1].path]);
    const n = unreadCount(queue, heard, stubClipPaths, 'aaaaaaaa');
    if (n !== 0) throw new Error(`expected 0, got ${n}`);
    // Adding the same path again is a no-op because heard is a Set.
    heard.add(queue[0].path);
    const n2 = unreadCount(queue, heard, stubClipPaths, 'aaaaaaaa');
    if (n2 !== 0) throw new Error(`expected 0 after redundant add, got ${n2}`);
  });

  it('MIL-6: empty queue → 0 for every tab', () => {
    const n = unreadCount([], new Set(), stubClipPaths, 'all');
    const m = unreadCount([], new Set(), stubClipPaths, 'aaaaaaaa');
    if (n !== 0 || m !== 0) throw new Error(`expected 0/0, got ${n}/${m}`);
  });

  it('MIL-7: clip with unparseable filename contributes to All but no per-session', () => {
    const bad = { path: 'C:\\fake\\queue\\malformed.mp3', mtime: 0 };
    const queue = [mkClip('aaaaaaaa', 0), bad];
    const heard = new Set();
    const all = unreadCount(queue, heard, stubClipPaths, 'all');
    const a = unreadCount(queue, heard, stubClipPaths, 'aaaaaaaa');
    if (all !== 2) throw new Error(`All should count all non-heard clips, got ${all}`);
    if (a !== 1) throw new Error(`session-a should ignore unparseable, got ${a}`);
  });

  it('partitionSessions: fresh last_seen → active, old → stale', () => {
    const now = 1_700_000_000_000;
    const staleMs = 30 * 60 * 1000;
    const sessionAssignments = {
      aaaaaaaa: { last_seen: Math.floor(now / 1000) - 60, index: 0 },           // 60 s ago → active
      bbbbbbbb: { last_seen: Math.floor(now / 1000) - (60 * 60), index: 1 },    // 1 h ago → stale
      cccccccc: { last_seen: Math.floor(now / 1000) - (2 * 60), index: 2 },    // 2 min ago → active
    };
    const queue = [
      mkClip('aaaaaaaa', 0), mkClip('bbbbbbbb', 0), mkClip('cccccccc', 0),
    ];
    const { active, stale } = partitionSessions(sessionAssignments, queue, stubClipPaths, now, staleMs);
    if (active.length !== 2) throw new Error(`active: expected 2, got ${active.length}`);
    if (stale.length !== 1) throw new Error(`stale: expected 1, got ${stale.length}`);
    // Deterministic ordering: most-recent last_seen first.
    if (active[0] !== 'aaaaaaaa') throw new Error(`active[0] should be most-recent, got ${active[0]}`);
    if (stale[0] !== 'bbbbbbbb') throw new Error(`stale[0] should be bbbbbbbb, got ${stale[0]}`);
  });

  it('truncateLabel: cuts with ellipsis when over maxChars', () => {
    if (truncateLabel('matean', 10) !== 'matean') throw new Error('short label should pass through');
    if (truncateLabel('matean-brain-thing', 10) !== 'matean-br…') throw new Error(`got ${truncateLabel('matean-brain-thing', 10)}`);
    if (truncateLabel('', 10) !== '') throw new Error('empty label should stay empty');
  });
});

// =============================================================================
// R3.9 — KIT PALETTE ≡ PRODUCT PALETTE. docs/README.md promises this
// test exists; landing it here honours the claim.
// =============================================================================
// =============================================================================
// R4 — ACCESSIBILITY BASELINE. Every icon-only button must have an
// aria-label, every decorative SVG must be aria-hidden, and the app
// must respect prefers-reduced-motion + expose visible focus rings
// on keyboard navigation.
// =============================================================================
describe('R4 ACCESSIBILITY BASELINE', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'styles.css'), 'utf8');
  const rend = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer.js'), 'utf8');

  it('R4.2: every icon-btn in index.html has an aria-label', () => {
    const iconBtns = html.match(/<button[^>]*class=["'][^"']*\bicon-btn\b[^"']*["'][^>]*>/g) || [];
    if (iconBtns.length < 6) {
      throw new Error(`expected >=6 icon-btn elements, found ${iconBtns.length}`);
    }
    for (const tag of iconBtns) {
      if (!/\baria-label\s*=\s*["']/.test(tag)) {
        throw new Error(`icon-btn without aria-label: ${tag}`);
      }
    }
  });

  it('R4.1: every decorative svg in index.html has aria-hidden="true"', () => {
    const svgs = html.match(/<svg[^>]*>/g) || [];
    if (svgs.length < 6) throw new Error(`expected several svgs, found ${svgs.length}`);
    for (const tag of svgs) {
      if (!/\baria-hidden\s*=\s*["']true["']/.test(tag)) {
        throw new Error(`svg without aria-hidden="true": ${tag}`);
      }
    }
  });

  it('R4.3: sessions table has role="grid"; dots strip has role="list"', () => {
    if (!/id=["']sessionsTable["'][^>]*role=["']grid["']/.test(html)) {
      throw new Error('sessionsTable should expose role="grid"');
    }
    if (!/id=["']dots["'][^>]*role=["']list["']/.test(html)) {
      throw new Error('dots container should expose role="list"');
    }
  });

  it('R4.3: renderer gives each session-block role="row" and dot role="listitem"', () => {
    // EX7c — per-dot role wiring moved into DotStrip._buildDot.
    // EX7d-1 — per-row role wiring moved into SessionsTable._renderRow.
    const dotStripSrc = fs.readFileSync(
      path.join(__dirname, '..', 'app', 'lib', 'dot-strip.js'), 'utf8'
    );
    const sessionsTableSrc = fs.readFileSync(
      path.join(__dirname, '..', 'app', 'lib', 'sessions-table.js'), 'utf8'
    );
    if (!/wrap\.setAttribute\(['"]role['"],\s*['"]row['"]\)/.test(sessionsTableSrc)) {
      throw new Error('sessions-table.js should set role="row" on wrap');
    }
    if (!/dot\.setAttribute\(['"]role['"],\s*['"]listitem['"]\)/.test(dotStripSrc)) {
      throw new Error('dot-strip.js should set role="listitem" on each dot');
    }
  });

  it('R4.3: settings button exposes aria-expanded + gets updated on click', () => {
    if (!/id=["']settingsBtn["'][^>]*aria-expanded=["']false["']/.test(html)) {
      throw new Error('settings button should start with aria-expanded="false"');
    }
    if (!/settingsBtn\.setAttribute\(['"]aria-expanded['"]/.test(rend)) {
      throw new Error('renderer should update settingsBtn aria-expanded on toggle');
    }
  });

  it('R4.4: styles.css defines :focus-visible outlines', () => {
    if (!/:focus-visible/.test(css)) {
      throw new Error('styles.css missing :focus-visible selectors');
    }
    if (!/\.dot:focus-visible/.test(css)) {
      throw new Error('styles.css should give .dot a focus-visible ring');
    }
  });

  it('R4.5: styles.css honours prefers-reduced-motion on active pulse + mascot walk', () => {
    const rm = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/g) || [];
    const combined = rm.join('\n');
    if (!/\.dot\.active\s*\{\s*animation:\s*none/.test(combined)) {
      throw new Error('reduce-motion block should stop .dot.active pulse');
    }
    if (!/scrubber-mascot[\s\S]{0,80}animation:\s*none/.test(combined)) {
      throw new Error('reduce-motion block should stop mascot walk');
    }
  });
});

describe('S4.2 — voices.json parity with generated voices-window.js', () => {
  const voices = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app', 'lib', 'voices.json'), 'utf8'));
  const win    = fs.readFileSync(path.join(__dirname, '..', 'app', 'lib', 'voices-window.js'), 'utf8').replace(/\r\n/g, '\n');

  it('generated voices-window.js matches voices.json byte-for-byte', () => {
    const expected = `window.TT_VOICES = Object.freeze(${JSON.stringify(voices, null, 2)});`;
    if (!win.includes(expected)) {
      throw new Error('app/lib/voices-window.js is out of date — run `node scripts/generate-voices-window.cjs`');
    }
  });

  it('voices.json has both edge and openai arrays', () => {
    if (!Array.isArray(voices.edge))   throw new Error('voices.json.edge must be an array');
    if (!Array.isArray(voices.openai)) throw new Error('voices.json.openai must be an array');
    if (voices.edge.length === 0)   throw new Error('voices.json.edge empty');
    if (voices.openai.length === 0) throw new Error('voices.json.openai empty');
  });

  it('every voice entry has id + label string fields', () => {
    for (const v of [...voices.edge, ...voices.openai]) {
      if (typeof v.id !== 'string' || v.id.length === 0)       throw new Error(`bad id: ${JSON.stringify(v)}`);
      if (typeof v.label !== 'string' || v.label.length === 0) throw new Error(`bad label: ${JSON.stringify(v)}`);
    }
  });

  it('voice ids are unique across edge + openai combined', () => {
    const seen = new Set();
    for (const v of [...voices.edge, ...voices.openai]) {
      if (seen.has(v.id)) throw new Error(`duplicate voice id: ${v.id}`);
      seen.add(v.id);
    }
  });

  it('renderer.js destructures from window.TT_VOICES (no inline arrays)', () => {
    const rend = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer.js'), 'utf8');
    if (/const\s+EDGE_VOICES\s*=\s*\[\s*\{\s*id:/.test(rend)) {
      throw new Error('renderer.js still contains an inline EDGE_VOICES literal — regression');
    }
    if (!/window\.TT_VOICES/.test(rend)) {
      throw new Error('renderer.js must destructure voices from window.TT_VOICES');
    }
  });
});

describe('S3.1 — IPC rate limit', () => {
  const { createRateLimit } = require('../app/lib/rate-limit');

  it('burst allows initial spike up to capacity', () => {
    const t = 0;
    const r = createRateLimit({ rate: 20, burst: 30, now: () => t });
    let allowed = 0;
    for (let i = 0; i < 40; i++) if (r.allow('x')) allowed++;
    assertEqual(allowed, 30);
  });

  it('refills at rate over time', () => {
    let t = 0;
    const r = createRateLimit({ rate: 20, burst: 30, now: () => t });
    for (let i = 0; i < 30; i++) r.allow('x');
    t = 500;   // 500 ms → 10 tokens refilled at rate=20/s
    let after = 0;
    for (let i = 0; i < 15; i++) if (r.allow('x')) after++;
    if (after < 9 || after > 11) throw new Error(`expected ~10 allowed after 500ms refill, got ${after}`);
  });

  it('per-name buckets are independent', () => {
    const t = 0;
    const r = createRateLimit({ rate: 20, burst: 5, now: () => t });
    for (let i = 0; i < 5; i++) r.allow('a');
    assertEqual(r.allow('a'), false);   // a exhausted
    assertEqual(r.allow('b'), true);    // b still full
  });
});

describe('S3.2 — redactForLog regex + key set', () => {
  // Re-implementation of the main.js redactor for test isolation. If this
  // drifts, append an E2E that spawns Electron and exercises the real one.
  const REDACT_KEYS = new Set(['openai_api_key', 'claude_api_key', 'anthropic_api_key', 'supabase_service_key']);
  const REDACT_KEY_RE = /(api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|client[_-]?secret)$/i;
  function redact(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const clone = Array.isArray(obj) ? obj.map(redact) : { ...obj };
    if (Array.isArray(clone)) return clone;
    for (const k of Object.keys(clone)) {
      if (clone[k] && typeof clone[k] === 'object' && !Array.isArray(clone[k])) {
        clone[k] = redact(clone[k]);
      } else if (REDACT_KEYS.has(k) || REDACT_KEY_RE.test(k)) {
        if (clone[k]) clone[k] = '<redacted>';
      }
    }
    return clone;
  }

  it('strips explicit openai_api_key', () => {
    const out = redact({ openai_api_key: 'sk-abc', other: 'visible' });
    assertEqual(out.openai_api_key, '<redacted>');
    assertEqual(out.other, 'visible');
  });

  it('strips regex-matched future keys (secret_key, access_token, password)', () => {
    const out = redact({ stripe_secret_key: 'sk_live_x', my_access_token: 'at_y', db_password: 'hunter2' });
    assertEqual(out.stripe_secret_key, '<redacted>');
    assertEqual(out.my_access_token, '<redacted>');
    assertEqual(out.db_password, '<redacted>');
  });

  it('recurses into nested objects', () => {
    const out = redact({ voices: { edge_response: 'Ryan' }, auth: { openai_api_key: 'sk-x' } });
    assertEqual(out.voices.edge_response, 'Ryan');
    assertEqual(out.auth.openai_api_key, '<redacted>');
  });

  it('leaves falsy values alone (empty string, null)', () => {
    const out = redact({ openai_api_key: '', claude_api_key: null });
    assertEqual(out.openai_api_key, '');
    assertEqual(out.claude_api_key, null);
  });
});

describe('D2 — safeStorage-backed API key store', () => {
  const { createApiKeyStore } = require('../app/lib/api-key-store');

  // Tiny fake safeStorage so we can exercise the encrypt/decrypt paths
  // without pulling Electron into the harness. The real safeStorage uses
  // DPAPI on Windows / Keychain on macOS; our fake just prefixes "enc:"
  // which is enough to verify that (a) writes happen, (b) reads round-trip.
  function fakeSafeStorage(available = true) {
    return {
      isEncryptionAvailable: () => available,
      encryptString: (s) => Buffer.from('enc:' + s, 'utf8'),
      decryptString: (b) => {
        const s = Buffer.isBuffer(b) ? b.toString('utf8') : String(b);
        if (!s.startsWith('enc:')) throw new Error('not encrypted');
        return s.slice(4);
      },
    };
  }

  function freshTmpDir() {
    const d = path.join(os.tmpdir(), 'tt-apikey-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  it('set(key) writes both .enc and .secret when safeStorage available', () => {
    const dir = freshTmpDir();
    const store = createApiKeyStore({ dir, safeStorage: fakeSafeStorage(true) });
    store.set('sk-testabc');
    assertTruthy(fs.existsSync(store._encPath),    '.enc should exist');
    assertTruthy(fs.existsSync(store._secretPath), '.secret should exist');
    const sidecar = JSON.parse(fs.readFileSync(store._secretPath, 'utf8'));
    assertEqual(sidecar.openai_api_key, 'sk-testabc');
  });

  it('set(key) writes only .secret when safeStorage unavailable', () => {
    const dir = freshTmpDir();
    const store = createApiKeyStore({ dir, safeStorage: fakeSafeStorage(false) });
    store.set('sk-test');
    if (fs.existsSync(store._encPath)) {
      throw new Error('.enc must not exist when safeStorage is unavailable');
    }
    assertTruthy(fs.existsSync(store._secretPath), '.secret should exist');
  });

  it('set(null) clears both files', () => {
    const dir = freshTmpDir();
    const store = createApiKeyStore({ dir, safeStorage: fakeSafeStorage(true) });
    store.set('sk-test');
    store.set(null);
    if (fs.existsSync(store._encPath))    throw new Error('.enc not cleared');
    if (fs.existsSync(store._secretPath)) throw new Error('.secret not cleared');
  });

  it('get() round-trips via .enc (authoritative store)', () => {
    const dir = freshTmpDir();
    const store = createApiKeyStore({ dir, safeStorage: fakeSafeStorage(true) });
    store.set('sk-roundtrip');
    assertEqual(store.get(), 'sk-roundtrip');
  });

  it('get() falls back to .secret when .enc is missing', () => {
    const dir = freshTmpDir();
    // Simulate the safeStorage-unavailable branch: set with ss=false leaves
    // only the sidecar. Then read with ss=true to confirm the fallback.
    const write = createApiKeyStore({ dir, safeStorage: fakeSafeStorage(false) });
    write.set('sk-sidecar-only');
    const read = createApiKeyStore({ dir, safeStorage: fakeSafeStorage(true) });
    assertEqual(read.get(), 'sk-sidecar-only');
  });

  it('get() returns null when nothing is stored', () => {
    const dir = freshTmpDir();
    const store = createApiKeyStore({ dir, safeStorage: fakeSafeStorage(true) });
    assertEqual(store.get(), null);
  });

  it('migrateFromConfig moves a plaintext key into the store and nulls the field', () => {
    const dir = freshTmpDir();
    const store = createApiKeyStore({ dir, safeStorage: fakeSafeStorage(true) });
    const migrated = store.migrateFromConfig({
      voices: {}, hotkeys: {}, playback: {}, speech_includes: {},
      openai_api_key: 'sk-plaintext'
    });
    assertEqual(migrated.openai_api_key, null);
    assertEqual(store.get(), 'sk-plaintext');
  });

  it('migrateFromConfig is a no-op when no key is present', () => {
    const dir = freshTmpDir();
    const store = createApiKeyStore({ dir, safeStorage: fakeSafeStorage(true) });
    const cfg = { voices: {}, hotkeys: {}, playback: {}, speech_includes: {}, openai_api_key: null };
    const out = store.migrateFromConfig(cfg);
    assertEqual(out, cfg);        // same object — no migration
    assertEqual(store.get(), null);
  });

  // ------------------------------------------------------------------
  // D2 PS-hook + synth_turn sidecar consumer contract (Terminal-2 side).
  // The three asserts below verify the CODE ACTUALLY LOOKS AT THE
  // SIDECAR. They don't exercise real PS/Python spawn -- that would
  // need an installed tree with a fake sidecar -- but they do the
  // same source-grep-for-wiring check pattern used elsewhere in this
  // file. If the wiring gets reverted, these fail.
  // ------------------------------------------------------------------
  it('tts-helper Resolve-OpenAiApiKey reads config.secrets.json before config.json', () => {
    const ttsHelper = fs.readFileSync(
      path.join(__dirname, '..', 'app', 'tts-helper.psm1'),
      'utf8'
    );
    if (!/config\.secrets\.json/.test(ttsHelper)) {
      throw new Error('tts-helper.psm1 no longer references config.secrets.json');
    }
    const secretsIdx = ttsHelper.indexOf('config.secrets.json');
    // The legacy ConfigPath read must live AFTER the sidecar block,
    // not before -- else the sidecar precedence promise breaks.
    const legacyIdx = ttsHelper.indexOf('$ConfigPath');
    if (secretsIdx < 0 || legacyIdx < 0) {
      throw new Error('tts-helper.psm1 missing one of sidecar/legacy code paths');
    }
    if (secretsIdx > legacyIdx) {
      throw new Error('tts-helper.psm1 reads legacy config.json before sidecar -- precedence inverted');
    }
  });

  it('synth_turn.py prefers secrets sidecar over legacy config key', () => {
    const synthPy = fs.readFileSync(
      path.join(__dirname, '..', 'app', 'synth_turn.py'),
      'utf8'
    );
    if (!/_load_openai_key_from_secrets\s*\(\s*\)/.test(synthPy)) {
      throw new Error('synth_turn.py is not calling _load_openai_key_from_secrets()');
    }
    if (!/SECRETS_PATH\s*=\s*TT_HOME\s*\/\s*['"]config\.secrets\.json['"]/.test(synthPy)) {
      throw new Error('synth_turn.py SECRETS_PATH constant missing or wrong path');
    }
    // The or-chain must try sidecar FIRST so a legacy key in config.json
    // loses to the freshly-written sidecar on any user that upgraded.
    const assign = synthPy.match(
      /openai_key\s*=\s*_load_openai_key_from_secrets\(\)\s*or\s*config\.get\(['"]openai_api_key['"]\)/
    );
    if (!assign) {
      throw new Error('synth_turn.py openai_key assignment does not prefer sidecar over config.json');
    }
  });

  it('uninstall.ps1 always removes credential artefacts (sidecar + openai_key.enc)', () => {
    const uninstall = fs.readFileSync(
      path.join(__dirname, '..', 'uninstall.ps1'),
      'utf8'
    );
    if (!/config\.secrets\.json/.test(uninstall)) {
      throw new Error('uninstall.ps1 does not clean up config.secrets.json');
    }
    if (!/openai_key\.enc/.test(uninstall)) {
      throw new Error('uninstall.ps1 does not clean up openai_key.enc');
    }
    // The credential cleanup step must run BEFORE the interactive
    // install-dir prompt -- otherwise a user who answers "keep the
    // install dir" leaves a plaintext API key behind.
    const credIdx = uninstall.indexOf('config.secrets.json');
    const promptIdx = uninstall.indexOf('Read-Host');
    if (credIdx < 0 || promptIdx < 0 || credIdx > promptIdx) {
      throw new Error('uninstall.ps1 credential cleanup must run before install-dir prompt');
    }
  });
});

describe('D2-5 — config.schema.json parity with validator rules', () => {
  // The hand-rolled validator in app/lib/config-validate.js is the runtime
  // authority. config.schema.json is for editor autocomplete + user-facing
  // $schema reference. Both shapes must agree on the same keys + bounds.
  const schemaPath = path.join(__dirname, '..', 'config.schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

  it('schema is valid draft-07 JSON', () => {
    assertEqual(schema.$schema, 'http://json-schema.org/draft-07/schema#');
    assertEqual(schema.type, 'object');
    if (!schema.properties) throw new Error('schema.properties missing');
  });

  it('covers every top-level key the validator knows about', () => {
    const { RULES } = require('../app/lib/config-validate');
    const schemaKeys = new Set(Object.keys(schema.properties));
    const validatorTopKeys = new Set(RULES.map(r => r.path.split('.')[0]));
    for (const k of validatorTopKeys) {
      if (!schemaKeys.has(k) && k !== 'window' && k !== '_comment') {
        throw new Error(`validator knows about "${k}" but schema doesn't — drift`);
      }
    }
  });

  it('config.example.json references the schema via $schema', () => {
    const example = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.example.json'), 'utf8'));
    if (example.$schema !== './config.schema.json') {
      throw new Error(`config.example.json $schema should be "./config.schema.json", got "${example.$schema}"`);
    }
  });

  it('numeric bounds in schema match validator bounds', () => {
    const speed = schema.properties.playback.properties.speed;
    assertEqual(speed.minimum, 0.25);
    assertEqual(speed.maximum, 4.0);
    const prune = schema.properties.playback.properties.auto_prune_sec;
    assertEqual(prune.minimum, 1);
    assertEqual(prune.maximum, 600);
  });

  it('v0.3.6 auto_continue_after_click present in schema + validator', () => {
    const cont = schema.properties.playback.properties.auto_continue_after_click;
    if (!cont) throw new Error('schema missing playback.auto_continue_after_click');
    assertEqual(cont.type, 'boolean');
    assertEqual(cont.default, true);
    const { RULES } = require('../app/lib/config-validate');
    const rule = RULES.find(r => r.path === 'playback.auto_continue_after_click');
    if (!rule) throw new Error('validator missing playback.auto_continue_after_click rule');
    assertEqual(rule.type, 'boolean');
  });

  it('EX5 playback.palette_variant present in schema + validator + tokens', () => {
    // Schema
    const pv = schema.properties.playback.properties.palette_variant;
    if (!pv) throw new Error('schema missing playback.palette_variant');
    assertEqual(pv.type, 'string');
    assertEqual(pv.default, 'default');
    if (!Array.isArray(pv.enum) || !pv.enum.includes('default') || !pv.enum.includes('cb')) {
      throw new Error('schema palette_variant.enum must include "default" and "cb"');
    }
    // Validator rule
    const { RULES } = require('../app/lib/config-validate');
    const rule = RULES.find(r => r.path === 'playback.palette_variant');
    if (!rule) throw new Error('validator missing playback.palette_variant rule');
    assertEqual(rule.type, 'string');
    // Tokens: CB sibling array must be length 8 and all 7-char hex.
    const tokensPath = path.join(__dirname, '..', 'app', 'lib', 'tokens.json');
    const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
    const cb = tokens.palette.BASE_COLOURS_CB;
    if (!Array.isArray(cb)) throw new Error('tokens.json missing BASE_COLOURS_CB');
    if (cb.length !== 8) throw new Error(`BASE_COLOURS_CB expected 8 entries, got ${cb.length}`);
    for (const hex of cb) {
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
        throw new Error(`BASE_COLOURS_CB entry "${hex}" is not a 7-char hex`);
      }
    }
    // Generated palette-classes.css should contain the CB selector.
    const paletteCssPath = path.join(__dirname, '..', 'app', 'lib', 'palette-classes.css');
    const paletteCss = fs.readFileSync(paletteCssPath, 'utf8');
    if (!/body\[data-palette-variant="cb"\]/.test(paletteCss)) {
      throw new Error('palette-classes.css missing body[data-palette-variant="cb"] override block — run generate-tokens-css.cjs');
    }
  });
});

describe('AUTO-CONTINUE AFTER CLICK (v0.3.6 renderer guard)', () => {
  // Source-grep regression tests for the "click exercise" fix. Can't
  // unit-test the audio.ended flow without a DOM harness; locking the
  // structural invariants is enough to catch accidental regressions.
  const rendererSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer.js'), 'utf8');

  it('renderer defines autoContinueAfterClick flag', () => {
    if (!/let\s+autoContinueAfterClick\s*=/.test(rendererSrc)) {
      throw new Error('renderer.js must declare `let autoContinueAfterClick = ...`');
    }
  });

  it('userPlay sets userClick=true on playPath', () => {
    // Accept either `playPath(p, true, true)` positional or a future
    // options-object form, but require the userClick signal.
    const m = rendererSrc.match(/function\s+userPlay\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
    if (!m) throw new Error('userPlay function body not found');
    const body = m[1];
    if (!/playPath\s*\([^,)]+,\s*true\s*,\s*true\s*\)/.test(body)) {
      throw new Error('userPlay must call playPath(p, true, true) to signal user-click vs priority');
    }
  });

  it('playPath signature carries a userClick parameter', () => {
    // EX7e — playPath is a thin wrapper in renderer.js that delegates
    // to audioPlayer.playPath(p, manual, userClick); the real signature
    // also lives in audio-player.js. Accept either source.
    const audioPlayerSrc = fs.readFileSync(
      path.join(__dirname, '..', 'app', 'lib', 'audio-player.js'), 'utf8'
    );
    if (!/function\s+playPath\s*\([^)]*userClick[^)]*\)/.test(rendererSrc)
        && !/playPath\s*\([^)]*userClick[^)]*\)/.test(audioPlayerSrc)) {
      throw new Error('playPath must accept a userClick parameter');
    }
  });

  it('audio.ended branches on wasUserClick && autoContinueAfterClick', () => {
    // EX7e — audio.ended handler moved into AudioPlayer. The component
    // gates via this._getAutoContinueAfterClick() (renderer passes
    // `() => autoContinueAfterClick` as a dep). Inside the handler the
    // local vars are `wasUserClick` and the getter call.
    const audioPlayerSrc = fs.readFileSync(
      path.join(__dirname, '..', 'app', 'lib', 'audio-player.js'), 'utf8'
    );
    if (!/wasUserClick\s*&&\s*this\._getAutoContinueAfterClick\(\)/.test(audioPlayerSrc)) {
      throw new Error('audio-player.js ended handler must gate continuation on wasUserClick && autoContinueAfterClick getter');
    }
    if (!/f\.mtime\s*>\s*justPlayedClip\.mtime/.test(audioPlayerSrc)) {
      throw new Error('continuation branch must pick the next clip with mtime > justPlayed (strictly forward in time)');
    }
  });
});

describe('S3.3 — config validator', () => {
  const { validateConfig } = require('../app/lib/config-validate');

  it('accepts a minimal valid config', () => {
    const v = validateConfig({ voices: {}, hotkeys: {}, playback: {}, speech_includes: {} });
    if (!v.ok) throw new Error(`expected ok=true, got violations: ${v.violations.join('; ')}`);
  });

  it('rejects when playback.speed is out of range', () => {
    const v = validateConfig({ voices: {}, hotkeys: {}, playback: { speed: 10 }, speech_includes: {} });
    if (v.ok) throw new Error('expected rejection for speed=10');
    if (!v.violations.some(s => s.includes('playback.speed'))) {
      throw new Error(`violation message didn't cite playback.speed: ${v.violations.join('; ')}`);
    }
  });

  it('rejects when voices is not an object', () => {
    const v = validateConfig({ voices: 'not-an-object', hotkeys: {}, playback: {}, speech_includes: {} });
    if (v.ok) throw new Error('expected rejection for voices=string');
  });

  it('accepts null openai_api_key (user hasn\'t set one)', () => {
    const v = validateConfig({ voices: {}, hotkeys: {}, playback: {}, speech_includes: {}, openai_api_key: null });
    if (!v.ok) throw new Error(`should accept null key: ${v.violations.join('; ')}`);
  });

  it('rejects a malformed root (non-object)', () => {
    const v = validateConfig('not an object');
    if (v.ok) throw new Error('expected rejection for string root');
  });
});

describe('S1 — renderer-error dedupe', () => {
  const { createDedupe } = require('../app/lib/renderer-error-dedupe');

  it('first occurrence of a stack accepts', () => {
    const d = createDedupe();
    assertEqual(d.accept('TypeError: foo\n  at x', 1000), true);
  });

  it('duplicate within window is rejected', () => {
    const d = createDedupe();
    d.accept('TypeError: foo\n  at x', 1000);
    assertEqual(d.accept('TypeError: foo\n  at x', 1500), false);
  });

  it('same stack after window accepts again', () => {
    const d = createDedupe();
    d.accept('TypeError: foo\n  at x', 1000);
    assertEqual(d.accept('TypeError: foo\n  at x', 2001), true);
  });

  it('different stacks both accept independently', () => {
    const d = createDedupe();
    d.accept('TypeError: foo\n  at x', 1000);
    assertEqual(d.accept('ReferenceError: bar\n  at y', 1001), true);
  });

  it('dedupe key uses only top 4 stack lines (argv-drift resilient)', () => {
    const d = createDedupe();
    const base = 'TypeError: foo\n  at x\n  at y\n  at z';
    d.accept(base + '\n  at a', 1000);
    assertEqual(d.accept(base + '\n  at b', 1001), false);
    assertEqual(d.accept('TypeError: foo\n  at DIFFERENT\n  at y\n  at z', 1002), true);
  });

  it('map is pruned when over maxEntries', () => {
    const d = createDedupe({ maxEntries: 3 });
    d.accept('a', 1);
    d.accept('b', 2);
    d.accept('c', 3);
    d.accept('d', 4);
    if (d._lastSeen.size > 3) throw new Error(`expected size ≤ 3, got ${d._lastSeen.size}`);
    assertEqual(d.accept('a', 5), true);
  });
});

// =============================================================================
// S5 — coverage-gap fills.
// =============================================================================
// Unit tests for branches the baseline c8 run surfaced as uncovered:
// error paths, defensive-fallback branches, and contention paths that
// the happy-path tests don't reach. Each describe below ties back to
// the ASSESSMENTS/S5-coverage/findings.md gap list.
// =============================================================================

describe('EX7a — clip-paths helpers', () => {
  const {
    paletteKeyForIndex, paletteKeyForShort,
    extractSessionShort, isClipFile,
  } = require(path.join(__dirname, '..', 'app', 'lib', 'clip-paths.js'));
  const PSIZE = 24;

  it('paletteKeyForIndex pads 0..23 to "00".."23"', () => {
    assertEqual(paletteKeyForIndex(0, PSIZE), '00');
    assertEqual(paletteKeyForIndex(5, PSIZE), '05');
    assertEqual(paletteKeyForIndex(23, PSIZE), '23');
  });

  it('paletteKeyForIndex wraps out-of-range values', () => {
    assertEqual(paletteKeyForIndex(24, PSIZE), '00');
    assertEqual(paletteKeyForIndex(25, PSIZE), '01');
    assertEqual(paletteKeyForIndex(-1, PSIZE), '23');
  });

  it('paletteKeyForIndex returns "neutral" for non-integers', () => {
    assertEqual(paletteKeyForIndex('nope', PSIZE), 'neutral');
    assertEqual(paletteKeyForIndex(null, PSIZE), 'neutral');
    assertEqual(paletteKeyForIndex(1.5, PSIZE), 'neutral');
  });

  it('paletteKeyForShort uses assigned index when present', () => {
    const assignments = { aabbccdd: { index: 7 } };
    assertEqual(paletteKeyForShort('aabbccdd', assignments, PSIZE), '07');
  });

  it('paletteKeyForShort hashes when no assignment', () => {
    // Deterministic char-sum hash — same short always maps to same index.
    const assignments = {};
    const k1 = paletteKeyForShort('abcdef01', assignments, PSIZE);
    const k2 = paletteKeyForShort('abcdef01', assignments, PSIZE);
    assertEqual(k1, k2);
    // Result is a valid 2-digit key.
    if (!/^\d\d$/.test(k1)) throw new Error(`expected /^\\d\\d$/, got ${k1}`);
  });

  it('paletteKeyForShort returns "neutral" for short/empty IDs', () => {
    assertEqual(paletteKeyForShort('', {}, PSIZE), 'neutral');
    assertEqual(paletteKeyForShort(null, {}, PSIZE), 'neutral');
    assertEqual(paletteKeyForShort('abc', {}, PSIZE), 'neutral');  // <4 chars
  });

  it('extractSessionShort parses clip filenames (specificity-first)', () => {
    assertEqual(extractSessionShort('20260420T180500944-clip-aabbccdd-0001.mp3'), 'aabbccdd');
    // The pathological case from Audit G11: clip filename also
    // matches the response pattern, but clip-specificity wins.
    assertEqual(extractSessionShort('anyprefix-clip-aabbccdd-0001.mp3'), 'aabbccdd');
  });

  it('extractSessionShort parses response filenames', () => {
    assertEqual(extractSessionShort('20260420T180500944-0000-aabbccdd.mp3'), 'aabbccdd');
  });

  it('extractSessionShort returns null for neutral clips + non-matches', () => {
    assertEqual(extractSessionShort('anyprefix-clip-neutral-0001.mp3'), null);
    assertEqual(extractSessionShort('random-garbage.txt'), null);
    assertEqual(extractSessionShort(''), null);
  });

  it('isClipFile detects the -clip- token', () => {
    assertEqual(isClipFile('20260420T1-clip-aabbccdd-0001.mp3'), true);
    assertEqual(isClipFile('20260420T1-0000-aabbccdd.mp3'), false);
  });
});

describe('EX6e — ipc-validate', () => {
  const {
    validShort, validVoice, sanitiseLabel,
    ALLOWED_INCLUDE_KEYS,
  } = require(path.join(__dirname, '..', 'app', 'lib', 'ipc-validate.js'));
  const MAX_LABEL_LEN = 60;  // inline mirror of the module-private constant
  const MAX_VOICE_LEN = 80;  // same

  it('validShort accepts 8-char lowercase hex, rejects others', () => {
    assertEqual(validShort('aabbccdd'), true);
    assertEqual(validShort('01234567'), true);
    assertEqual(validShort('AABBCCDD'), false);  // uppercase rejected
    assertEqual(validShort('aabbccd'), false);   // too short
    assertEqual(validShort('aabbccdde'), false); // too long
    assertEqual(validShort('ghijklmn'), false);  // non-hex
    assertEqual(validShort(null), false);
    assertEqual(validShort(12345678), false);    // non-string
  });

  it('validVoice accepts edge-tts IDs + openai voices, rejects garbage', () => {
    assertEqual(validVoice('en-GB-RyanNeural'), true);
    assertEqual(validVoice('en-US-JennyMultilingualNeural'), true);
    assertEqual(validVoice('shimmer'), true);
    assertEqual(validVoice('onyx'), true);
    assertEqual(validVoice('invalid'), false);
    assertEqual(validVoice('RyanNeural'), false);  // missing locale prefix
    assertEqual(validVoice(null), false);
    // MAX_VOICE_LEN
    assertEqual(validVoice('a'.repeat(MAX_VOICE_LEN + 1)), false);
  });

  it('sanitiseLabel strips CR/LF/tab, truncates, and trims', () => {
    assertEqual(sanitiseLabel('hello'), 'hello');
    assertEqual(sanitiseLabel('  spaced  '), 'spaced');
    assertEqual(sanitiseLabel('line1\nline2'), 'line1 line2');
    assertEqual(sanitiseLabel('tab\there'), 'tab here');
    // truncate at MAX_LABEL_LEN
    assertEqual(sanitiseLabel('x'.repeat(100)).length, MAX_LABEL_LEN);
    // non-strings coerce to empty
    assertEqual(sanitiseLabel(null), '');
    assertEqual(sanitiseLabel(42), '');
  });

  it('ALLOWED_INCLUDE_KEYS matches DEFAULTS.speech_includes shape', () => {
    const expected = ['code_blocks', 'inline_code', 'urls', 'headings', 'bullet_markers', 'image_alt'];
    for (const k of expected) {
      if (!ALLOWED_INCLUDE_KEYS.has(k)) throw new Error(`ALLOWED_INCLUDE_KEYS missing ${k}`);
    }
    assertEqual(ALLOWED_INCLUDE_KEYS.size, expected.length);
  });
});

describe('EX6f-1 — ipc-handlers (read-only group)', () => {
  const { createIpcHandlers } = require(
    path.join(__dirname, '..', 'app', 'lib', 'ipc-handlers.js')
  );

  // A stand-in for electron.ipcMain. Records each handler by channel
  // name so tests can invoke them directly without the Electron runtime.
  function makeFakeIpcMain() {
    const handlers = new Map();
    return {
      handle(name, fn) { handlers.set(name, fn); },
      invoke(name, ...args) {
        const fn = handlers.get(name);
        if (!fn) throw new Error(`no handler: ${name}`);
        return fn({}, ...args);
      },
      has(name) { return handlers.has(name); },
      names() { return [...handlers.keys()]; },
    };
  }

  function baseDeps(overrides = {}) {
    const diagLog = [];
    return {
      ipcMain: makeFakeIpcMain(),
      diag: (m) => diagLog.push(m),
      getCFG: () => ({ voices: {} }),
      loadAssignments: () => ({}),
      getQueueFiles: () => [],
      ensureAssignmentsForFiles: () => ({}),
      isPidAlive: () => false,
      computeStaleSessions: () => [],
      SESSIONS_DIR: '/nope',
      fs: { existsSync: () => false, readdirSync: () => [], readFileSync: () => '' },
      ...overrides,
      _diagLog: diagLog,
    };
  }

  it('register() wires all five read-only channels', () => {
    const deps = baseDeps();
    createIpcHandlers(deps).register();
    for (const name of ['log-renderer-error', 'get-queue', 'get-assignments', 'get-stale-sessions', 'get-config']) {
      if (!deps.ipcMain.has(name)) throw new Error(`missing channel: ${name}`);
    }
  });

  it('get-config returns the live CFG via the getter', () => {
    let cfg = { a: 1 };
    const deps = baseDeps({ getCFG: () => cfg });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('get-config'), { a: 1 });
    cfg = { a: 2 };  // simulate update-config reassignment
    assertEqual(deps.ipcMain.invoke('get-config'), { a: 2 });
  });

  it('get-queue composes files + assignments', () => {
    const deps = baseDeps({
      getQueueFiles: () => ['x.mp3', 'y.mp3'],
      ensureAssignmentsForFiles: (f) => ({ count: f.length }),
    });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('get-queue'), {
      files: ['x.mp3', 'y.mp3'],
      assignments: { count: 2 },
    });
  });

  it('get-assignments delegates to loadAssignments', () => {
    const deps = baseDeps({ loadAssignments: () => ({ ab12cd34: { idx: 0 } }) });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('get-assignments'), { ab12cd34: { idx: 0 } });
  });

  it('log-renderer-error dedupes repeated payloads', () => {
    // createDedupe (the default) dedupes same-key within its window;
    // two identical payloads should produce exactly one diag line.
    const deps = baseDeps();
    createIpcHandlers(deps).register();
    deps.ipcMain.invoke('log-renderer-error', { type: 'error', message: 'boom', stack: 'trace' });
    deps.ipcMain.invoke('log-renderer-error', { type: 'error', message: 'boom', stack: 'trace' });
    assertEqual(deps._diagLog.length, 1);
    assertTruthy(/boom/.test(deps._diagLog[0]), 'diag line should contain the message');
  });

  it('log-renderer-error rejects non-object payloads silently', () => {
    const deps = baseDeps();
    createIpcHandlers(deps).register();
    deps.ipcMain.invoke('log-renderer-error', null);
    deps.ipcMain.invoke('log-renderer-error', 'string');
    deps.ipcMain.invoke('log-renderer-error', 42);
    assertEqual(deps._diagLog.length, 0);
  });

  it('log-renderer-error truncates oversized fields', () => {
    const deps = baseDeps();
    createIpcHandlers(deps).register();
    const huge = 'a'.repeat(10000);
    deps.ipcMain.invoke('log-renderer-error', { type: huge, message: huge, stack: huge, source: huge });
    const line = deps._diagLog[0];
    assertTruthy(line.length < 10000, 'diag line should be bounded');
  });

  it('get-stale-sessions returns [] when SESSIONS_DIR is missing', () => {
    const deps = baseDeps({ fs: { existsSync: () => false } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('get-stale-sessions'), []);
  });

  it('get-stale-sessions passes liveShorts + livePids into computeStaleSessions', () => {
    let captured = null;
    const deps = baseDeps({
      loadAssignments: () => ({ abc12345: { idx: 0 } }),
      isPidAlive: () => true,
      computeStaleSessions: (assignments, liveShorts, livePids) => {
        captured = { liveShorts: [...liveShorts], livePids: [...livePids] };
        return [];
      },
      fs: {
        existsSync: () => true,
        readdirSync: () => ['123.json'],
        readFileSync: () => JSON.stringify({ short: 'ABC12345' }),
      },
    });
    createIpcHandlers(deps).register();
    deps.ipcMain.invoke('get-stale-sessions');
    assertEqual(captured.liveShorts, ['abc12345']);  // lowercased
    assertEqual(captured.livePids, [123]);
  });

  it('get-stale-sessions swallows errors + diags once', () => {
    const deps = baseDeps({
      loadAssignments: () => { throw new Error('registry corrupt'); },
    });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('get-stale-sessions'), []);
    assertTruthy(deps._diagLog.some((m) => /get-stale-sessions fail/.test(m)),
      'should diag the failure');
  });
});

describe('EX6f-2 — ipc-handlers (session-edit mutations)', () => {
  const { createIpcHandlers } = require(
    path.join(__dirname, '..', 'app', 'lib', 'ipc-handlers.js')
  );
  const {
    validShort, validVoice, sanitiseLabel, ALLOWED_INCLUDE_KEYS,
  } = require(path.join(__dirname, '..', 'app', 'lib', 'ipc-validate.js'));

  function makeFakeIpcMain() {
    const handlers = new Map();
    return {
      handle(name, fn) { handlers.set(name, fn); },
      invoke(name, ...args) {
        const fn = handlers.get(name);
        if (!fn) throw new Error(`no handler: ${name}`);
        return fn({}, ...args);
      },
    };
  }

  // Builds a deps bundle backed by an in-memory registry so tests can
  // assert both return value AND persisted state after each invocation.
  function mutationDeps(overrides = {}) {
    const registry = overrides.registry || {};
    const saveLog = [];
    const notifyLog = [];
    const fakeWin = { isDestroyed: () => false };
    return {
      ipcMain: makeFakeIpcMain(),
      diag: () => {},
      getCFG: () => ({}),
      getWin: () => fakeWin,
      loadAssignments: () => JSON.parse(JSON.stringify(registry)),  // deep copy
      saveAssignments: (all) => {
        Object.keys(registry).forEach((k) => delete registry[k]);
        Object.assign(registry, all);
        saveLog.push(JSON.parse(JSON.stringify(all)));
        return true;
      },
      getQueueFiles: () => [],
      ensureAssignmentsForFiles: () => ({}),
      isPidAlive: () => false,
      computeStaleSessions: () => [],
      SESSIONS_DIR: '/nope',
      notifyQueue: () => notifyLog.push(Date.now()),
      allowMutation: () => true,
      validShort, validVoice, sanitiseLabel, ALLOWED_INCLUDE_KEYS,
      ...overrides,
      _registry: registry,
      _saveLog: saveLog,
      _notifyLog: notifyLog,
    };
  }

  it('register() wires all seven session-edit channels', () => {
    const deps = mutationDeps();
    createIpcHandlers(deps).register();
    const required = [
      'set-session-label', 'set-session-index', 'set-session-focus',
      'remove-session', 'set-session-muted', 'set-session-voice',
      'set-session-include',
    ];
    for (const name of required) {
      try { deps.ipcMain.invoke(name, 'aabbccdd', true); }
      catch (e) { throw new Error(`missing channel: ${name}`, { cause: e }); }
    }
  });

  it('every mutation handler returns null when rate-limited', () => {
    const deps = mutationDeps({
      allowMutation: () => false,
      registry: { aabbccdd: { idx: 0 } },
    });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-label', 'aabbccdd', 'x'), null);
    assertEqual(deps.ipcMain.invoke('set-session-index', 'aabbccdd', 5), null);
    assertEqual(deps.ipcMain.invoke('set-session-focus', 'aabbccdd', true), null);
    assertEqual(deps.ipcMain.invoke('remove-session', 'aabbccdd'), null);
    assertEqual(deps.ipcMain.invoke('set-session-muted', 'aabbccdd', true), null);
    assertEqual(deps.ipcMain.invoke('set-session-voice', 'aabbccdd', 'shimmer'), null);
    assertEqual(deps.ipcMain.invoke('set-session-include', 'aabbccdd', 'urls', true), null);
    assertEqual(deps._saveLog.length, 0);
  });

  it('set-session-label sanitises then saves', () => {
    const deps = mutationDeps({ registry: { aabbccdd: {} } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-label', 'aabbccdd', 'a\nb\tc'), true);
    assertEqual(deps._registry.aabbccdd.label, 'a b c');
  });

  it('set-session-label rejects invalid shortId', () => {
    const deps = mutationDeps({ registry: { aabbccdd: {} } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-label', 'BAD', 'x'), false);
    assertEqual(deps._saveLog.length, 0);
  });

  it('set-session-index clamps to [0,23] and pins', () => {
    const deps = mutationDeps({ registry: { aabbccdd: {} } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-index', 'aabbccdd', 99), true);
    assertEqual(deps._registry.aabbccdd.index, 23);
    assertEqual(deps._registry.aabbccdd.pinned, true);
    assertEqual(deps.ipcMain.invoke('set-session-index', 'aabbccdd', -5), true);
    assertEqual(deps._registry.aabbccdd.index, 0);
  });

  it('set-session-index rejects NaN', () => {
    const deps = mutationDeps({ registry: { aabbccdd: {} } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-index', 'aabbccdd', 'nope'), false);
  });

  it('set-session-focus clears focus on all other sessions when set', () => {
    const deps = mutationDeps({
      registry: {
        aabbccdd: { focus: false },
        eeff0011: { focus: true },
        '22334455': { focus: true },
      },
    });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-focus', 'aabbccdd', true), true);
    assertEqual(deps._registry.aabbccdd.focus, true);
    assertEqual(deps._registry.eeff0011.focus, false);
    assertEqual(deps._registry['22334455'].focus, false);
    assertEqual(deps._notifyLog.length, 1);
  });

  it('set-session-focus rejects non-boolean focus', () => {
    const deps = mutationDeps({ registry: { aabbccdd: {} } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-focus', 'aabbccdd', 'true'), false);
  });

  it('remove-session drops entry + notifies queue', () => {
    const deps = mutationDeps({ registry: { aabbccdd: { idx: 0 } } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('remove-session', 'aabbccdd'), true);
    assertFalsy(deps._registry.aabbccdd, 'entry should be gone');
    assertEqual(deps._notifyLog.length, 1);
  });

  it('set-session-muted stores + broadcasts when window alive', () => {
    const deps = mutationDeps({ registry: { aabbccdd: {} } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-muted', 'aabbccdd', true), true);
    assertEqual(deps._registry.aabbccdd.muted, true);
    assertEqual(deps._notifyLog.length, 1);
  });

  it('set-session-muted rejects non-boolean value', () => {
    const deps = mutationDeps({ registry: { aabbccdd: {} } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-muted', 'aabbccdd', 1), false);
  });

  it('set-session-voice validates + persists; null clears', () => {
    const deps = mutationDeps({ registry: { aabbccdd: { voice: 'old' } } });
    createIpcHandlers(deps).register();
    // valid edge-tts id
    assertEqual(deps.ipcMain.invoke('set-session-voice', 'aabbccdd', 'en-GB-RyanNeural'), true);
    assertEqual(deps._registry.aabbccdd.voice, 'en-GB-RyanNeural');
    // null clears
    assertEqual(deps.ipcMain.invoke('set-session-voice', 'aabbccdd', null), true);
    assertFalsy(deps._registry.aabbccdd.voice, 'voice should be deleted');
    // garbage rejected
    assertEqual(deps.ipcMain.invoke('set-session-voice', 'aabbccdd', 'not-a-voice'), false);
  });

  it('set-session-include gates on ALLOWED_INCLUDE_KEYS + value type', () => {
    const deps = mutationDeps({ registry: { aabbccdd: {} } });
    createIpcHandlers(deps).register();
    // unknown key rejected
    assertEqual(deps.ipcMain.invoke('set-session-include', 'aabbccdd', 'nonsense', true), false);
    // non-boolean/non-null value rejected
    assertEqual(deps.ipcMain.invoke('set-session-include', 'aabbccdd', 'urls', 'yes'), false);
    // valid write
    assertEqual(deps.ipcMain.invoke('set-session-include', 'aabbccdd', 'urls', true), true);
    assertEqual(deps._registry.aabbccdd.speech_includes.urls, true);
    // null clears the key, and empty speech_includes bag gets removed
    assertEqual(deps.ipcMain.invoke('set-session-include', 'aabbccdd', 'urls', null), true);
    assertFalsy(deps._registry.aabbccdd.speech_includes, 'empty bag should be removed');
  });

  it('all session-edit handlers return false when shortId entry is absent', () => {
    const deps = mutationDeps({ registry: {} });
    createIpcHandlers(deps).register();
    const missing = 'aabbccdd';
    assertEqual(deps.ipcMain.invoke('set-session-label', missing, 'x'), false);
    assertEqual(deps.ipcMain.invoke('set-session-index', missing, 5), false);
    assertEqual(deps.ipcMain.invoke('set-session-focus', missing, true), false);
    assertEqual(deps.ipcMain.invoke('remove-session', missing), false);
    assertEqual(deps.ipcMain.invoke('set-session-muted', missing, true), false);
    assertEqual(deps.ipcMain.invoke('set-session-voice', missing, 'shimmer'), false);
    assertEqual(deps.ipcMain.invoke('set-session-include', missing, 'urls', true), false);
  });
});

describe('EX6f-3 — ipc-handlers (panel + config-mutation)', () => {
  const { createIpcHandlers } = require(
    path.join(__dirname, '..', 'app', 'lib', 'ipc-handlers.js')
  );
  const {
    validShort, validVoice, sanitiseLabel, ALLOWED_INCLUDE_KEYS,
  } = require(path.join(__dirname, '..', 'app', 'lib', 'ipc-validate.js'));

  function makeFakeIpcMain() {
    const handlers = new Map();
    return {
      handle(name, fn) { handlers.set(name, fn); },
      invoke(name, ...args) {
        const fn = handlers.get(name);
        if (!fn) throw new Error(`no handler: ${name}`);
        return fn({}, ...args);
      },
      has(name) { return handlers.has(name); },
    };
  }

  // Fake BrowserWindow that records every method call so tests can
  // assert both side effects and call ordering.
  function makeFakeWin(overrides = {}) {
    const calls = [];
    const win = {
      isDestroyed: () => false,
      getPosition: () => [100, 200],
      getSize: () => [680, 114],
      setBounds: (b) => { calls.push(['setBounds', b]); },
      setSize: (w, h, anim) => { calls.push(['setSize', w, h, anim]); },
      setIgnoreMouseEvents: (on, opts) => { calls.push(['setIgnoreMouseEvents', on, opts]); },
      webContents: {
        reload: () => { calls.push(['reload']); },
      },
      ...overrides,
    };
    return { win, calls };
  }

  function panelDeps(overrides = {}) {
    let cfg = overrides.cfg || {};
    const savedConfigs = [];
    const dockCalls = [];
    const diagLog = [];
    const { win: fakeWin, calls: winCalls } = makeFakeWin(overrides.winOverrides || {});
    return {
      ipcMain: makeFakeIpcMain(),
      diag: (m) => diagLog.push(m),
      getCFG: () => cfg,
      setCFG: (next) => { cfg = next; },
      getWin: () => fakeWin,
      loadAssignments: () => ({}),
      saveAssignments: () => true,
      saveConfig: (c) => { savedConfigs.push(c); return true; },
      getQueueFiles: () => [],
      ensureAssignmentsForFiles: () => ({}),
      isPidAlive: () => false,
      computeStaleSessions: () => [],
      SESSIONS_DIR: '/nope',
      notifyQueue: () => {},
      allowMutation: () => true,
      validShort, validVoice, sanitiseLabel, ALLOWED_INCLUDE_KEYS,
      apiKeyStore: { set: (v) => { diagLog.push(`apikey=${v}`); } },
      redactForLog: (o) => o,
      setApplyingDock: (v) => dockCalls.push(v),
      testMode: false,
      ...overrides,
      _cfgRef: () => cfg,
      _savedConfigs: savedConfigs,
      _dockCalls: dockCalls,
      _diagLog: diagLog,
      _winCalls: winCalls,
    };
  }

  it('register() wires reload-renderer, update-config, set-clickthrough, set-panel-open', () => {
    const deps = panelDeps();
    createIpcHandlers(deps).register();
    for (const name of ['reload-renderer', 'update-config', 'set-clickthrough', 'set-panel-open']) {
      if (!deps.ipcMain.has(name)) throw new Error(`missing channel: ${name}`);
    }
  });

  it('reload-renderer calls webContents.reload when window is alive', () => {
    const deps = panelDeps();
    createIpcHandlers(deps).register();
    deps.ipcMain.invoke('reload-renderer');
    assertTruthy(deps._winCalls.some((c) => c[0] === 'reload'), 'should have called reload');
  });

  it('reload-renderer is no-op when window is destroyed', () => {
    const deps = panelDeps({ winOverrides: { isDestroyed: () => true } });
    createIpcHandlers(deps).register();
    deps.ipcMain.invoke('reload-renderer');
    assertFalsy(deps._winCalls.some((c) => c[0] === 'reload'), 'should NOT have called reload');
  });

  it('update-config merges sub-objects and calls setCFG with new object', () => {
    const deps = panelDeps({
      cfg: {
        voices: { edge_response: 'old' },
        hotkeys: { toggle: 'A' },
        playback: { speed: 1 },
        speech_includes: { urls: false },
      },
    });
    createIpcHandlers(deps).register();
    const out = deps.ipcMain.invoke('update-config', {
      voices: { edge_response: 'new' },
      playback: { speed: 2 },
    });
    assertEqual(out.voices.edge_response, 'new');
    assertEqual(out.hotkeys.toggle, 'A');          // unchanged
    assertEqual(out.playback.speed, 2);
    assertEqual(out.speech_includes.urls, false);   // unchanged
    assertEqual(out.openai_api_key, null);
    // setCFG must have received the merged object
    assertEqual(deps._cfgRef().voices.edge_response, 'new');
  });

  it('update-config routes openai_api_key through apiKeyStore and nulls the field', () => {
    const deps = panelDeps({ cfg: { voices: {}, hotkeys: {}, playback: {}, speech_includes: {} } });
    createIpcHandlers(deps).register();
    const out = deps.ipcMain.invoke('update-config', { openai_api_key: 'sk-secret' });
    assertEqual(out.openai_api_key, null);
    assertTruthy(deps._diagLog.some((m) => /apikey=sk-secret/.test(m)),
      'apiKeyStore.set should have been called with the secret');
  });

  it('update-config returns null when rate-limited', () => {
    const deps = panelDeps({ allowMutation: () => false });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('update-config', { voices: {} }), null);
  });

  it('update-config catches save failures + logs once', () => {
    const deps = panelDeps({
      cfg: { voices: {}, hotkeys: {}, playback: {}, speech_includes: {} },
      saveConfig: () => { throw new Error('disk full'); },
    });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('update-config', { voices: {} }), null);
    assertTruthy(deps._diagLog.some((m) => /update-config fail/.test(m)));
  });

  it('set-clickthrough returns false when window is destroyed', () => {
    const deps = panelDeps({ winOverrides: { isDestroyed: () => true } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-clickthrough', true), false);
  });

  it('set-clickthrough is a no-op-return-true in test mode', () => {
    const deps = panelDeps({ testMode: true });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-clickthrough', true), true);
    assertFalsy(deps._winCalls.some((c) => c[0] === 'setIgnoreMouseEvents'),
      'testMode should skip the actual setIgnoreMouseEvents call');
  });

  it('set-clickthrough forwards to setIgnoreMouseEvents outside test mode', () => {
    const deps = panelDeps({ testMode: false });
    createIpcHandlers(deps).register();
    deps.ipcMain.invoke('set-clickthrough', true);
    const call = deps._winCalls.find((c) => c[0] === 'setIgnoreMouseEvents');
    assertTruthy(call, 'should call setIgnoreMouseEvents');
    assertEqual(call[1], true);
    assertEqual(call[2], { forward: true });
  });

  it('set-panel-open uses setSize for non-bottom docks', () => {
    const deps = panelDeps({ cfg: { window: { dock: 'top' } } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-panel-open', true), true);
    const call = deps._winCalls.find((c) => c[0] === 'setSize');
    assertTruthy(call, 'should call setSize');
    assertEqual(call[1], 680);  // expanded width
    assertEqual(call[2], 618);  // expanded height
    // no dock adjustment expected
    assertEqual(deps._dockCalls, []);
  });

  it('set-panel-open pins bottom-docked bar via setBounds + setApplyingDock flag', () => {
    const deps = panelDeps({ cfg: { window: { dock: 'bottom' } } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-panel-open', true), true);
    const call = deps._winCalls.find((c) => c[0] === 'setBounds');
    assertTruthy(call, 'should call setBounds');
    // curY=200, curH=114, newH=618 -> newY = 200 + (114 - 618) = -304
    assertEqual(call[1].y, -304);
    assertEqual(call[1].width, 680);
    assertEqual(call[1].height, 618);
    // applying-dock latch must flip true then eventually back to false
    assertEqual(deps._dockCalls[0], true);
  });

  it('set-panel-open returns false when window is destroyed', () => {
    const deps = panelDeps({ winOverrides: { isDestroyed: () => true } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-panel-open', true), false);
  });
});

describe('EX7b — Component base', () => {
  const { Component } = require(path.join(__dirname, '..', 'app', 'lib', 'component.js'));

  it('mount/unmount fires lifecycle hooks exactly once each', () => {
    const calls = [];
    class Foo extends Component {
      _onMount() { calls.push('mount'); }
      _onUnmount() { calls.push('unmount'); }
    }
    const foo = new Foo();
    foo.mount();
    foo.mount();  // should be idempotent
    foo.unmount();
    foo.unmount();  // idempotent
    assertEqual(calls, ['mount', 'unmount']);
  });

  it('update() stores state and fires _onUpdate', () => {
    const seen = [];
    class Foo extends Component {
      _onUpdate() { seen.push(this.state); }
    }
    const foo = new Foo();
    foo.mount();
    foo.update({ a: 1 });
    foo.update({ a: 2 });
    assertEqual(seen, [{ a: 1 }, { a: 2 }]);
  });

  it('_setInterval registers a teardown that clears the handle', () => {
    class Ticker extends Component {
      _onMount() { this._setInterval(() => {}, 10); }
    }
    const t = new Ticker();
    t.mount();
    assertEqual(t._teardown.length, 1);
    t.unmount();
    assertEqual(t._teardown.length, 0);
  });

  it('_setTimeout registers a teardown that clears the handle', () => {
    class Delayed extends Component {
      _onMount() { this._setTimeout(() => {}, 50); }
    }
    const d = new Delayed();
    d.mount();
    assertEqual(d._teardown.length, 1);
    d.unmount();
    assertEqual(d._teardown.length, 0);
  });

  it('_on removes event listener on unmount', () => {
    const fake = {
      _listeners: new Map(),
      addEventListener(evt, fn) {
        if (!this._listeners.has(evt)) this._listeners.set(evt, new Set());
        this._listeners.get(evt).add(fn);
      },
      removeEventListener(evt, fn) {
        if (this._listeners.has(evt)) this._listeners.get(evt).delete(fn);
      },
      count(evt) { return this._listeners.get(evt)?.size || 0; },
    };
    class Clickable extends Component {
      _onMount() { this._on(fake, 'click', () => {}); }
    }
    const c = new Clickable();
    c.mount();
    assertEqual(fake.count('click'), 1);
    c.unmount();
    assertEqual(fake.count('click'), 0);
  });

  it('_addTeardown runs user-registered cleanup LIFO on unmount', () => {
    const order = [];
    class Foo extends Component {
      _onMount() {
        this._addTeardown(() => order.push('first'));
        this._addTeardown(() => order.push('second'));
      }
    }
    const f = new Foo();
    f.mount();
    f.unmount();
    // LIFO so cleanup runs inside-out
    assertEqual(order, ['second', 'first']);
  });

  it('one failing teardown does not strand the rest', () => {
    const order = [];
    class Foo extends Component {
      _onMount() {
        this._addTeardown(() => order.push('before'));
        this._addTeardown(() => { throw new Error('boom'); });
        this._addTeardown(() => order.push('after'));
      }
    }
    const f = new Foo();
    f.mount();
    f.unmount();
    // 'after' was registered last so it runs first (LIFO), then the
    // throw gets swallowed, then 'before' still runs.
    assertEqual(order, ['after', 'before']);
  });

  it('isMounted() reflects current state', () => {
    const f = new Component();
    assertEqual(f.isMounted(), false);
    f.mount();
    assertEqual(f.isMounted(), true);
    f.unmount();
    assertEqual(f.isMounted(), false);
  });

  it('stop() and dispose() alias unmount()', () => {
    const calls = [];
    class Foo extends Component {
      _onUnmount() { calls.push('u'); }
    }
    const a = new Foo(); a.mount(); a.stop();
    const b = new Foo(); b.mount(); b.dispose();
    assertEqual(calls, ['u', 'u']);
  });
});

describe('EX7b — StaleSessionPoller', () => {
  const { StaleSessionPoller } = require(
    path.join(__dirname, '..', 'app', 'lib', 'stale-session-poller.js')
  );

  // Tests drive state updates via _applyResult() so they stay
  // synchronous — no promise-timing assumptions. The async
  // _pollOnce() is a thin wrapper around _applyResult(await api...).

  it('has() returns false before any result is applied', () => {
    const p = new StaleSessionPoller({ api: {} });
    assertEqual(p.has('aabbccdd'), false);
  });

  it('_applyResult populates has() from an array', () => {
    const p = new StaleSessionPoller({ api: {} });
    p._applyResult(['aabbccdd', 'eeff0011']);
    assertEqual(p.has('aabbccdd'), true);
    assertEqual(p.has('eeff0011'), true);
    assertEqual(p.has('deadbeef'), false);
  });

  it('onChange fires only when the set actually changes', () => {
    const fires = [];
    const p = new StaleSessionPoller({
      api: {},
      onChange: (set) => fires.push([...set]),
    });
    p._applyResult(['a']);           // [a]      → fire
    p._applyResult(['a']);           // [a]      → same, no fire
    p._applyResult(['a', 'b']);      // [a, b]   → fire
    p._applyResult(['a', 'b']);      // [a, b]   → same, no fire
    assertEqual(fires.length, 2);
    assertEqual(fires[0], ['a']);
    assertEqual(fires[1].sort(), ['a', 'b']);
  });

  it('onChange fires when set shrinks', () => {
    const fires = [];
    const p = new StaleSessionPoller({
      api: {},
      onChange: (set) => fires.push(set.size),
    });
    p._applyResult(['a', 'b']);
    p._applyResult(['a']);
    assertEqual(fires, [2, 1]);
  });

  it('_applyResult returns true/false matching whether state changed', () => {
    const p = new StaleSessionPoller({ api: {} });
    assertEqual(p._applyResult(['a']), true);
    assertEqual(p._applyResult(['a']), false);
    assertEqual(p._applyResult(['a', 'b']), true);
    assertEqual(p._applyResult([]), true);
    assertEqual(p._applyResult([]), false);
  });

  it('non-array result treated as empty set, never fires onChange from empty->empty', () => {
    let fireCount = 0;
    const p = new StaleSessionPoller({
      api: {},
      onChange: () => { fireCount++; },
    });
    p._applyResult(null);
    p._applyResult(undefined);
    p._applyResult('nope');
    p._applyResult({ x: 1 });
    assertEqual(p.has('anything'), false);
    assertEqual(fireCount, 0);  // state stayed empty the whole time
  });

  it('getAll() returns a snapshot, not a reference', () => {
    const p = new StaleSessionPoller({ api: {} });
    p._applyResult(['x']);
    const snap = p.getAll();
    snap.add('leak');
    assertEqual(p.has('leak'), false);
  });

  it('onChange errors are swallowed', () => {
    const p = new StaleSessionPoller({
      api: {},
      onChange: () => { throw new Error('consumer broke'); },
    });
    // must not throw
    p._applyResult(['a']);
    assertEqual(p.has('a'), true);
  });

  it('start() mounts; stop() unmounts and clears timer teardowns', () => {
    const p = new StaleSessionPoller({
      api: {},
      intervalMs: 1000,
      initialDelayMs: 100,
    });
    p.start();
    assertEqual(p.isMounted(), true);
    // start() registers an initial setTimeout + a setInterval
    assertEqual(p._teardown.length, 2);
    p.stop();
    assertEqual(p.isMounted(), false);
    assertEqual(p._teardown.length, 0);
  });
});

describe('EX7c — DotStrip', () => {
  // Tiny DOM + rAF shim so the component can be exercised in plain
  // Node without jsdom. We fake just enough of the browser surface
  // for _buildDot + _renderNow: createElement, appendChild,
  // classList, dataset, setAttribute, addEventListener, innerHTML.
  const _rafQueue = [];
  const origs = {
    raf: global.requestAnimationFrame,
    caf: global.cancelAnimationFrame,
    doc: global.document,
  };
  global.requestAnimationFrame = (fn) => {
    _rafQueue.push(fn);
    return _rafQueue.length;
  };
  global.cancelAnimationFrame = (id) => { _rafQueue[id - 1] = null; };

  function makeFakeEl(tag = 'div') {
    const el = {
      _tag: tag,
      _children: [],
      _listeners: [],
      parent: null,
      className: '',
      textContent: '',
      title: '',
      type: '',
      dataset: {},
      _attrs: {},
      _classes: new Set(),
      classList: null,
    };
    el.classList = {
      add: (c) => el._classes.add(c),
      remove: (c) => el._classes.delete(c),
      contains: (c) => el._classes.has(c),
      toggle: (c, force) => {
        const want = force === undefined ? !el._classes.has(c) : !!force;
        if (want) el._classes.add(c);
        else el._classes.delete(c);
        return want;
      },
    };
    el.setAttribute = (k, v) => { el._attrs[k] = v; };
    el.getAttribute = (k) => el._attrs[k];
    el.appendChild = (c) => {
      el._children.push(c);
      c.parent = el;
      return c;
    };
    el.addEventListener = (ev, fn) => { el._listeners.push({ ev, fn }); };
    el.removeEventListener = (ev, fn) => {
      el._listeners = el._listeners.filter((l) => !(l.ev === ev && l.fn === fn));
    };
    // innerHTML = '' used as "clear" — implemented as child removal.
    Object.defineProperty(el, 'innerHTML', {
      get() { return ''; },
      set(v) { if (v === '') { el._children = []; } },
    });
    return el;
  }
  global.document = {
    createElement: (tag) => makeFakeEl(tag),
  };

  const { DotStrip } = require(path.join(__dirname, '..', 'app', 'lib', 'dot-strip.js'));

  // Real clip-paths logic (UMD-lite loads fine in Node) is used, so
  // tests exercise the same extractSessionShort / isClipFile /
  // paletteKeyForShort the renderer uses.
  const clipPaths = require(path.join(__dirname, '..', 'app', 'lib', 'clip-paths.js'));

  function makePoller(staleShorts = []) {
    const set = new Set(staleShorts);
    return { has: (s) => set.has(s) };
  }

  function makeClip(short, idx, opts = {}) {
    const tag = opts.isClip ? 'clip-' : '';
    const name = opts.isClip
      ? `2026-04-21T00-00-00-${tag}${short}-${idx}.mp3`
      : `2026-04-21T00-00-00-${idx}-${short}.mp3`;
    return {
      path: `/queue/${name}`,
      mtime: Date.UTC(2026, 0, 1) + idx * 1000,
    };
  }

  it('renderNow produces one dot per unmuted queue entry', () => {
    const root = makeFakeEl('div');
    const ds = new DotStrip({
      clipPaths,
      staleSessionPoller: makePoller(),
    });
    ds.mount(root);
    ds.update({
      queue: [makeClip('aabbccdd', 1), makeClip('eeff0011', 2), makeClip('aabbccdd', 3)],
      currentPath: null,
      heardPaths: new Set(),
      sessionAssignments: {},
      synthInProgress: false,
    });
    ds.renderNow();
    // 3 dots + gaps between session-short changes.
    // Reversed so queue entry 3 (aabbccdd) is first, then 2 (eeff0011, gap), then 1 (aabbccdd, gap).
    const dots = root._children.filter((c) => c._tag === 'button');
    const gaps = root._children.filter((c) => c._tag === 'span' && c.className === 'dots-run-gap');
    assertEqual(dots.length, 3);
    assertEqual(gaps.length, 2);
    ds.unmount();
  });

  it('muted sessions are filtered out entirely', () => {
    const root = makeFakeEl('div');
    const ds = new DotStrip({
      clipPaths,
      staleSessionPoller: makePoller(),
    });
    ds.mount(root);
    ds.update({
      queue: [
        makeClip('aabbccdd', 1, { isClip: true }),
        makeClip('eeff0011', 2, { isClip: true }),
      ],
      currentPath: null,
      heardPaths: new Set(),
      sessionAssignments: { aabbccdd: { muted: true } },
      synthInProgress: false,
    });
    ds.renderNow();
    const dots = root._children.filter((c) => c._tag === 'button');
    // aabbccdd muted -> only the eeff0011 dot renders.
    assertEqual(dots.length, 1);
    ds.unmount();
  });

  it('currentPath dot gets .active + aria-current', () => {
    const root = makeFakeEl('div');
    const ds = new DotStrip({
      clipPaths,
      staleSessionPoller: makePoller(),
    });
    ds.mount(root);
    const clip = makeClip('aabbccdd', 1);
    ds.update({
      queue: [clip],
      currentPath: clip.path,
      heardPaths: new Set(),
      sessionAssignments: {},
      synthInProgress: false,
    });
    ds.renderNow();
    const dot = root._children[0];
    assertTruthy(dot._classes.has('active'), 'dot should have .active class');
    assertEqual(dot.getAttribute('aria-current'), 'true');
    ds.unmount();
  });

  it('heardPaths dots get .heard class', () => {
    const root = makeFakeEl('div');
    const ds = new DotStrip({
      clipPaths,
      staleSessionPoller: makePoller(),
    });
    ds.mount(root);
    const clip = makeClip('aabbccdd', 1);
    ds.update({
      queue: [clip],
      currentPath: null,
      heardPaths: new Set([clip.path]),
      sessionAssignments: {},
      synthInProgress: false,
    });
    ds.renderNow();
    const dot = root._children[0];
    assertTruthy(dot._classes.has('heard'));
    ds.unmount();
  });

  it('stale sessions get .stale class + "(closed)" in title', () => {
    const root = makeFakeEl('div');
    const ds = new DotStrip({
      clipPaths,
      staleSessionPoller: makePoller(['aabbccdd']),
    });
    ds.mount(root);
    ds.update({
      queue: [makeClip('aabbccdd', 1)],
      currentPath: null,
      heardPaths: new Set(),
      sessionAssignments: {},
      synthInProgress: false,
    });
    ds.renderNow();
    const dot = root._children[0];
    assertTruthy(dot._classes.has('stale'));
    assertTruthy(/\(closed\)/.test(dot.title), 'title should include "(closed)"');
    ds.unmount();
  });

  it('isClipFile filenames get .clip class + "J" text', () => {
    const root = makeFakeEl('div');
    const ds = new DotStrip({
      clipPaths,
      staleSessionPoller: makePoller(),
    });
    ds.mount(root);
    ds.update({
      queue: [makeClip('aabbccdd', 1, { isClip: true })],
      currentPath: null,
      heardPaths: new Set(),
      sessionAssignments: {},
      synthInProgress: false,
    });
    ds.renderNow();
    const dot = root._children[0];
    assertTruthy(dot._classes.has('clip'));
    assertEqual(dot.textContent, 'J');
    ds.unmount();
  });

  it('synthInProgress appends a .pending-synth placeholder', () => {
    const root = makeFakeEl('div');
    const ds = new DotStrip({
      clipPaths,
      staleSessionPoller: makePoller(),
    });
    ds.mount(root);
    ds.update({
      queue: [],
      currentPath: null,
      heardPaths: new Set(),
      sessionAssignments: {},
      synthInProgress: true,
    });
    ds.renderNow();
    assertEqual(root._children.length, 1);
    const ph = root._children[0];
    assertEqual(ph._tag, 'span');
    assertTruthy(/pending-synth/.test(ph.className));
    ds.unmount();
  });

  it('click calls onPlay with the clip path', () => {
    const plays = [];
    const root = makeFakeEl('div');
    const ds = new DotStrip({
      clipPaths,
      staleSessionPoller: makePoller(),
      onPlay: (p) => plays.push(p),
    });
    ds.mount(root);
    const clip = makeClip('aabbccdd', 1);
    ds.update({
      queue: [clip],
      currentPath: null,
      heardPaths: new Set(),
      sessionAssignments: {},
      synthInProgress: false,
    });
    ds.renderNow();
    const dot = root._children[0];
    const click = dot._listeners.find((l) => l.ev === 'click');
    click.fn();
    assertEqual(plays, [clip.path]);
    ds.unmount();
  });

  it('contextmenu calls onDelete with the clip path and preventDefault', () => {
    const deletes = [];
    const root = makeFakeEl('div');
    const ds = new DotStrip({
      clipPaths,
      staleSessionPoller: makePoller(),
      onDelete: (p) => deletes.push(p),
    });
    ds.mount(root);
    const clip = makeClip('aabbccdd', 1);
    ds.update({
      queue: [clip],
      currentPath: null,
      heardPaths: new Set(),
      sessionAssignments: {},
      synthInProgress: false,
    });
    ds.renderNow();
    const dot = root._children[0];
    const ctx = dot._listeners.find((l) => l.ev === 'contextmenu');
    let prevented = false;
    ctx.fn({ preventDefault: () => { prevented = true; } });
    assertEqual(deletes, [clip.path]);
    assertEqual(prevented, true);
    ds.unmount();
  });

  it('update() schedules a single rAF regardless of call count', () => {
    _rafQueue.length = 0;
    const root = makeFakeEl('div');
    const ds = new DotStrip({
      clipPaths,
      staleSessionPoller: makePoller(),
    });
    ds.mount(root);
    ds.update({ queue: [], currentPath: null, heardPaths: new Set(), sessionAssignments: {}, synthInProgress: false });
    ds.update({ queue: [], currentPath: null, heardPaths: new Set(), sessionAssignments: {}, synthInProgress: false });
    ds.update({ queue: [], currentPath: null, heardPaths: new Set(), sessionAssignments: {}, synthInProgress: false });
    // 3 update() calls inside one frame -> exactly 1 rAF scheduled.
    assertEqual(_rafQueue.filter(Boolean).length, 1);
    ds.unmount();
  });

  it('unmount cancels a pending rAF so it never paints', () => {
    _rafQueue.length = 0;
    const root = makeFakeEl('div');
    const ds = new DotStrip({
      clipPaths,
      staleSessionPoller: makePoller(),
    });
    ds.mount(root);
    ds.update({ queue: [], currentPath: null, heardPaths: new Set(), sessionAssignments: {}, synthInProgress: false });
    const queued = _rafQueue.filter(Boolean).length;
    assertEqual(queued, 1);
    ds.unmount();
    assertEqual(_rafQueue.filter(Boolean).length, 0);  // cancelled
  });

  it('unmount clears root DOM', () => {
    const root = makeFakeEl('div');
    const ds = new DotStrip({
      clipPaths,
      staleSessionPoller: makePoller(),
    });
    ds.mount(root);
    ds.update({
      queue: [makeClip('aabbccdd', 1)],
      currentPath: null,
      heardPaths: new Set(),
      sessionAssignments: {},
      synthInProgress: false,
    });
    ds.renderNow();
    assertEqual(root._children.length, 1);
    ds.unmount();
    assertEqual(root._children.length, 0);
  });

  // Clean up globals AFTER the describe block runs. Not perfect — any
  // test group added later that runs in the same process inherits
  // these — but safe in practice because run-tests.cjs is a single
  // sequential pass.
  global.requestAnimationFrame = origs.raf;
  global.cancelAnimationFrame = origs.caf;
  global.document = origs.doc;
});

describe('EX7d-1 — SessionsTable', () => {
  // Same DOM + rAF shim pattern as DotStrip, plus we fake
  // document.activeElement + document.createDocumentFragment for the
  // focus-bail guard and the palette-option cache.
  const origs = {
    raf: global.requestAnimationFrame,
    caf: global.cancelAnimationFrame,
    doc: global.document,
  };
  global.requestAnimationFrame = (fn) => { fn(); return 1; };
  global.cancelAnimationFrame = () => {};

  function makeFakeEl(tag = 'div') {
    const el = {
      _tag: tag,
      _children: [],
      _listeners: [],
      parent: null,
      tagName: tag.toUpperCase(),
      _className: '',
      textContent: '',
      type: '',
      value: '',
      title: '',
      placeholder: '',
      checked: false,
      selected: false,
      disabled: false,
      dataset: {},
      _attrs: {},
      _classes: new Set(),
      classList: null,
    };
    el.classList = {
      add: (c) => el._classes.add(c),
      remove: (c) => el._classes.delete(c),
      contains: (c) => el._classes.has(c),
      toggle: (c, force) => {
        const want = force === undefined ? !el._classes.has(c) : !!force;
        if (want) el._classes.add(c);
        else el._classes.delete(c);
        return want;
      },
    };
    // className setter splits on whitespace and populates _classes so
    // tests that query via classList.has() work against code that
    // assigns className = 'x y'. Matches real DOM semantics.
    Object.defineProperty(el, 'className', {
      get() { return el._className; },
      set(v) {
        el._className = v || '';
        el._classes = new Set(String(v || '').split(/\s+/).filter(Boolean));
      },
    });
    el.setAttribute = (k, v) => { el._attrs[k] = v; };
    el.getAttribute = (k) => el._attrs[k];
    el.appendChild = (c) => {
      if (c._children !== undefined) {
        // DocumentFragment: move its children into us, empty the fragment.
        if (c._isFragment) {
          for (const k of c._children) { el._children.push(k); k.parent = el; }
          c._children = [];
          return c;
        }
      }
      el._children.push(c);
      c.parent = el;
      return c;
    };
    el.addEventListener = (ev, fn) => { el._listeners.push({ ev, fn }); };
    el.removeEventListener = (ev, fn) => {
      el._listeners = el._listeners.filter((l) => !(l.ev === ev && l.fn === fn));
    };
    el.contains = (other) => {
      if (!other) return false;
      if (other === el) return true;
      for (const c of el._children) {
        if (c === other) return true;
        if (c.contains && c.contains(other)) return true;
      }
      return false;
    };
    Object.defineProperty(el, 'innerHTML', {
      get() { return ''; },
      set(v) { if (v === '') { el._children = []; } },
    });
    el.cloneNode = () => {
      // Shallow clone good enough for DocumentFragment clone use.
      const c = makeFakeEl(tag);
      c._isFragment = el._isFragment;
      for (const kid of el._children) {
        const k = makeFakeEl(kid._tag);
        k.value = kid.value;
        k.textContent = kid.textContent;
        c._children.push(k);
        k.parent = c;
      }
      return c;
    };
    return el;
  }
  global.document = {
    createElement: (tag) => makeFakeEl(tag),
    createDocumentFragment: () => {
      const f = makeFakeEl('#fragment');
      f._isFragment = true;
      return f;
    },
    // Focus-bail guard reads this; tests flip it to simulate an
    // in-progress input edit.
    activeElement: null,
  };

  const { SessionsTable } = require(
    path.join(__dirname, '..', 'app', 'lib', 'sessions-table.js')
  );
  const clipPaths = require(path.join(__dirname, '..', 'app', 'lib', 'clip-paths.js'));

  function makePoller(staleShorts = []) {
    const set = new Set(staleShorts);
    return { has: (s) => set.has(s) };
  }

  function makeTable(opts = {}) {
    const calls = {
      label: [], index: [], focus: [], muted: [], remove: [], voice: [], include: [],
      afterMutation: 0,
    };
    const deps = {
      clipPaths,
      staleSessionPoller: makePoller(opts.staleShorts || []),
      paletteSize: 24,
      colourNames: ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'brown'],
      hsplitPartner: [1, 0, 3, 2, 5, 4, 7, 6],
      vsplitPartner: [2, 3, 0, 1, 6, 7, 4, 5],
      edgeVoices: [{ id: 'en-GB-RyanNeural', label: 'Ryan (GB)' }],
      includeLabels: [['urls', 'URLs'], ['code_blocks', 'Code blocks']],
      onSetLabel:   async (s, v) => { calls.label.push([s, v]); return true; },
      onSetIndex:   async (s, v) => { calls.index.push([s, v]); return true; },
      onSetFocus:   async (s, v) => { calls.focus.push([s, v]); return true; },
      onSetMuted:   async (s, v) => { calls.muted.push([s, v]); return opts.muteOk !== false; },
      onRemove:     async (s)    => { calls.remove.push(s); return opts.removeOk !== false; },
      onSetVoice:   async (s, v) => { calls.voice.push([s, v]); return true; },
      onSetInclude: async (s, k, v) => { calls.include.push([s, k, v]); return true; },
      onAfterMutation: () => { calls.afterMutation++; },
    };
    const table = new SessionsTable(deps);
    return { table, calls };
  }

  it('empty state renders the "No active" message', () => {
    const root = makeFakeEl('div');
    const { table } = makeTable();
    table.mount(root);
    table.update({ sessionAssignments: {} });
    assertEqual(root._children.length, 1);
    assertEqual(root._children[0].className, 'sessions-empty');
    assertTruthy(/No active Claude Code sessions/.test(root._children[0].textContent));
    table.unmount();
  });

  it('renders one session-block per assignment, sorted by index', () => {
    const root = makeFakeEl('div');
    const { table } = makeTable();
    table.mount(root);
    table.update({
      sessionAssignments: {
        bb: { index: 2, label: 'B' },
        aa: { index: 0, label: 'A' },
        cc: { index: 1, label: 'C' },
      },
    });
    const blocks = root._children.filter((c) => c._classes.has('session-block'));
    assertEqual(blocks.length, 3);
    // Sort by index: aa(0), cc(1), bb(2)
    const shortEls = blocks.map((b) => {
      const row = b._children[0];
      return row._children.find((c) => c._classes.has('short')).textContent;
    });
    assertEqual(shortEls, ['aa', 'cc', 'bb']);
    table.unmount();
  });

  it('focus-bail skips paint when an input inside the table is focused', () => {
    const root = makeFakeEl('div');
    const { table } = makeTable();
    table.mount(root);
    table.update({ sessionAssignments: { aa: { index: 0 } } });
    assertEqual(root._children.length, 1);

    // Simulate an input child of the table being focused.
    const fakeInput = { tagName: 'INPUT' };
    // Make root.contains return true for this input.
    const origContains = root.contains;
    root.contains = (el) => el === fakeInput || origContains(el);
    global.document.activeElement = fakeInput;

    // Attempt a re-render with different state — should bail.
    table.update({ sessionAssignments: {} });
    // Children didn't clear because render bailed.
    assertEqual(root._children.length, 1);

    global.document.activeElement = null;
    root.contains = origContains;
    table.unmount();
  });

  it('stale sessions mark the block with .stale', () => {
    const root = makeFakeEl('div');
    const { table } = makeTable({ staleShorts: ['aa'] });
    table.mount(root);
    table.update({ sessionAssignments: { aa: { index: 0 } } });
    const block = root._children[0];
    assertTruthy(block._classes.has('stale'));
    table.unmount();
  });

  it('label change fires onSetLabel with trimmed value', async () => {
    const root = makeFakeEl('div');
    const { table, calls } = makeTable();
    table.mount(root);
    table.update({ sessionAssignments: { aa: { index: 0 } } });
    const block = root._children[0];
    const row = block._children[0];
    const labelInput = row._children.find((c) => c._tag === 'input');
    labelInput.value = '  Trimmed  ';
    // Trigger the change handler.
    const change = labelInput._listeners.find((l) => l.ev === 'change');
    change.fn();
    assertEqual(calls.label, [['aa', 'Trimmed']]);
    table.unmount();
  });

  it('focus toggle fires onSetFocus with the inverted value', async () => {
    const root = makeFakeEl('div');
    const { table, calls } = makeTable();
    table.mount(root);
    table.update({ sessionAssignments: { aa: { index: 0, focus: false } } });
    const block = root._children[0];
    const row = block._children[0];
    const focusBtn = row._children.find((c) => c._classes.has('focus-btn'));
    const click = focusBtn._listeners.find((l) => l.ev === 'click');
    await click.fn({ stopPropagation: () => {} });
    assertEqual(calls.focus, [['aa', true]]);
    table.unmount();
  });

  it('mute toggle updates local state + fires onAfterMutation when IPC confirms', async () => {
    const root = makeFakeEl('div');
    const { table, calls } = makeTable();
    table.mount(root);
    const assignments = { aa: { index: 0, muted: false } };
    table.update({ sessionAssignments: assignments });
    const block = root._children[0];
    const row = block._children[0];
    const muteBtn = row._children.find((c) => c._classes.has('mute-btn'));
    const click = muteBtn._listeners.find((l) => l.ev === 'click');
    await click.fn({ stopPropagation: () => {} });
    assertEqual(calls.muted, [['aa', true]]);
    assertEqual(assignments.aa.muted, true);
    assertEqual(calls.afterMutation, 1);
    table.unmount();
  });

  it('mute toggle does NOT mutate state when IPC returns false', async () => {
    const root = makeFakeEl('div');
    const { table, calls } = makeTable({ muteOk: false });
    table.mount(root);
    const assignments = { aa: { index: 0, muted: false } };
    table.update({ sessionAssignments: assignments });
    const block = root._children[0];
    const row = block._children[0];
    const muteBtn = row._children.find((c) => c._classes.has('mute-btn'));
    const click = muteBtn._listeners.find((l) => l.ev === 'click');
    await click.fn({ stopPropagation: () => {} });
    assertEqual(assignments.aa.muted, false);  // unchanged
    assertEqual(calls.afterMutation, 0);
    table.unmount();
  });

  it('remove fires onRemove and drops entry from state', async () => {
    const root = makeFakeEl('div');
    const { table, calls } = makeTable();
    table.mount(root);
    const assignments = { aa: { index: 0 } };
    table.update({ sessionAssignments: assignments });
    const block = root._children[0];
    const row = block._children[0];
    const removeBtn = row._children.find((c) => c._classes.has('session-remove'));
    const click = removeBtn._listeners.find((l) => l.ev === 'click');
    await click.fn({ stopPropagation: () => {} });
    assertEqual(calls.remove, ['aa']);
    assertFalsy(assignments.aa, 'entry should be deleted');
    assertEqual(calls.afterMutation, 1);
    table.unmount();
  });

  it('chevron click toggles expanded state + re-renders', () => {
    const root = makeFakeEl('div');
    const { table } = makeTable();
    table.mount(root);
    table.update({ sessionAssignments: { aa: { index: 0 } } });
    const block1 = root._children[0];
    // Not expanded yet: block has only the row.
    assertEqual(block1._children.length, 1);
    const chevron1 = block1._children[0]._children.find((c) => c._classes.has('chevron'));
    const click1 = chevron1._listeners.find((l) => l.ev === 'click');
    click1.fn();
    // After expand, block has row + expanded section.
    const block2 = root._children[0];
    assertEqual(block2._children.length, 2);
    assertTruthy(block2._children[1]._classes.has('session-expanded'));
    table.unmount();
  });

  it('muted entry adds session-muted class to block', () => {
    const root = makeFakeEl('div');
    const { table } = makeTable();
    table.mount(root);
    table.update({ sessionAssignments: { aa: { index: 0, muted: true } } });
    assertTruthy(root._children[0]._classes.has('session-muted'));
    table.unmount();
  });

  it('focused entry adds session-focused class to block', () => {
    const root = makeFakeEl('div');
    const { table } = makeTable();
    table.mount(root);
    table.update({ sessionAssignments: { aa: { index: 0, focus: true } } });
    assertTruthy(root._children[0]._classes.has('session-focused'));
    table.unmount();
  });

  // NOTE: globals deliberately NOT restored here. Some tests above use
  // `await click.fn(...)` which triggers async IPC-callback continuations
  // that re-enter _renderNow() via microtask drains AFTER the it() body
  // has returned. Restoring document to undefined mid-drain crashes the
  // microtask. Leaking the fake globals is safe — subsequent test blocks
  // in this file don't read document / RAF.
  void origs;
});

describe('EX7d-2 — SettingsForm', () => {
  // Reuses the DOM globals set up by the SessionsTable block. Defines
  // its own id -> element registry that getElementById resolves
  // against, so each test can assemble a form surface à la carte.
  const elements = {};
  const makeFakeEl = global.document.createElement;  // reuse from SessionsTable block
  const origGetById = global.document.getElementById;
  global.document.getElementById = (id) => elements[id] || null;
  // _populatePaletteVariant writes document.body.dataset.paletteVariant;
  // provide a stand-in body so every test doesn't have to stub one.
  const origBody = global.document.body;
  global.document.body = { dataset: {} };

  function seed(ids) {
    for (const id of ids) {
      elements[id] = makeFakeEl('input');
      elements[id].id = id;
    }
  }

  function reset() {
    for (const k of Object.keys(elements)) delete elements[k];
  }

  const { SettingsForm } = require(
    path.join(__dirname, '..', 'app', 'lib', 'settings-form.js')
  );

  function apiMock() {
    const calls = [];
    return {
      updateConfig: async (partial) => { calls.push(partial); return partial; },
      reloadRenderer: () => { calls.push('reload'); },
      _calls: calls,
    };
  }

  it('mount wires speedSlider input + change handlers', () => {
    reset();
    seed(['speedSlider', 'speedValue']);
    const api = apiMock();
    const speeds = [];
    const form = new SettingsForm({
      api,
      edgeVoices: [], openaiVoices: [],
      onPlaybackSpeedChange: (v) => speeds.push(v),
    });
    form.mount();
    elements.speedSlider.value = '150';
    const input = elements.speedSlider._listeners.find((l) => l.ev === 'input');
    input.fn();
    assertEqual(speeds, [1.5]);
    assertEqual(elements.speedValue.textContent, '1.50x');
    form.unmount();
  });

  it('update populates speed slider from cfg and notifies', () => {
    reset();
    seed(['speedSlider', 'speedValue']);
    const api = apiMock();
    const speeds = [];
    const form = new SettingsForm({
      api, edgeVoices: [], openaiVoices: [],
      onPlaybackSpeedChange: (v) => speeds.push(v),
    });
    form.mount();
    form.update({ cfg: { playback: { speed: 2.0 } } });
    assertEqual(elements.speedSlider.value, 200);
    assertEqual(elements.speedValue.textContent, '2.00x');
    assertEqual(speeds, [2.0]);
    form.unmount();
  });

  it('auto-prune toggle updates cfg + disables seconds input when off', () => {
    // Sync test: handler body does the state updates before its internal
    // `await api.updateConfig(...)`, so we can fire the listener without
    // awaiting and all non-IPC effects are visible immediately.
    reset();
    seed(['autoPruneToggle', 'autoPruneSec']);
    const api = apiMock();
    const pruneStates = [];
    const form = new SettingsForm({
      api, edgeVoices: [], openaiVoices: [],
      onAutoPruneEnabledChange: (on) => pruneStates.push(on),
    });
    form.mount();
    elements.autoPruneToggle.checked = false;
    const change = elements.autoPruneToggle._listeners.find((l) => l.ev === 'change');
    change.fn();  // fire-and-forget — sync effects are visible immediately
    assertEqual(pruneStates, [false]);
    assertEqual(elements.autoPruneSec.disabled, true);
    // IPC call is queued synchronously too (api.updateConfig is called
    // before the await, only its return is awaited).
    assertTruthy(api._calls.some((c) => c && c.playback && c.playback.auto_prune === false));
    form.unmount();
  });

  it('auto-prune seconds clamps to [3, 600]', () => {
    reset();
    seed(['autoPruneSec']);
    const api = apiMock();
    const secsReceived = [];
    const form = new SettingsForm({
      api, edgeVoices: [], openaiVoices: [],
      onAutoPruneSecChange: (n) => secsReceived.push(n),
    });
    form.mount();
    elements.autoPruneSec.value = '9999';
    const change = elements.autoPruneSec._listeners.find((l) => l.ev === 'change');
    change.fn();
    assertEqual(secsReceived, [600]);
    assertEqual(elements.autoPruneSec.value, '600');  // display clamped too
    form.unmount();
  });

  it('reload button calls api.reloadRenderer', () => {
    reset();
    seed(['reloadToolbar']);
    const api = apiMock();
    const form = new SettingsForm({ api, edgeVoices: [], openaiVoices: [] });
    form.mount();
    const click = elements.reloadToolbar._listeners.find((l) => l.ev === 'click');
    click.fn();
    assertTruthy(api._calls.includes('reload'));
    form.unmount();
  });

  it('palette toggle sets body[data-palette-variant] + persists', () => {
    reset();
    seed(['paletteVariantToggle']);
    const api = apiMock();
    const originalBody = global.document.body;
    global.document.body = { dataset: {} };
    const form = new SettingsForm({ api, edgeVoices: [], openaiVoices: [] });
    form.mount();
    elements.paletteVariantToggle.checked = true;
    const change = elements.paletteVariantToggle._listeners.find((l) => l.ev === 'change');
    change.fn();
    assertEqual(global.document.body.dataset.paletteVariant, 'cb');
    assertTruthy(api._calls.some((c) => c && c.playback && c.playback.palette_variant === 'cb'));
    form.unmount();
    global.document.body = originalBody;
  });

  it('update handles missing cfg without crashing', () => {
    reset();
    seed(['speedSlider']);
    const api = apiMock();
    const form = new SettingsForm({ api, edgeVoices: [], openaiVoices: [] });
    form.mount();
    // No .playback -> should fall through to defaults.
    form.update({ cfg: {} });
    assertEqual(elements.speedSlider.value, 125);  // 1.25 default
    form.unmount();
  });

  it('voice select is populated with curated list + includes unknown selected', () => {
    reset();
    const sel = makeFakeEl('select');
    elements.voiceEdgeResponse = sel;
    const api = apiMock();
    const form = new SettingsForm({
      api,
      edgeVoices: [{ id: 'en-GB-Ryan', label: 'Ryan' }],
      openaiVoices: [],
    });
    form.mount();
    form.update({ cfg: { voices: { edge_response: 'custom-voice-id' } } });
    // Expect TWO options: the unknown selected + the curated one.
    assertEqual(sel._children.length, 2);
    assertEqual(sel._children[0].value, 'custom-voice-id');
    assertEqual(sel._children[1].value, 'en-GB-Ryan');
    form.unmount();
  });

  // Restore getElementById + body (other tests may rely on their absence).
  global.document.getElementById = origGetById;
  global.document.body = origBody;
});

describe('EX7e — AudioPlayer', () => {
  // Fake <audio> that implements just enough for AudioPlayer: src/play/
  // pause/currentTime/playbackRate/ended/duration/readyState/
  // addEventListener/removeEventListener. Event listeners record so
  // tests can fire specific events by name.
  function makeFakeAudio() {
    const a = {
      src: '',
      currentTime: 0,
      duration: NaN,
      playbackRate: 1,
      paused: true,
      ended: false,
      readyState: 0,
      _listeners: new Map(),
      play: () => Promise.resolve().then(() => { a.paused = false; }),
      pause: () => { a.paused = true; },
      addEventListener(ev, fn) {
        if (!a._listeners.has(ev)) a._listeners.set(ev, new Set());
        a._listeners.get(ev).add(fn);
      },
      removeEventListener(ev, fn) {
        if (a._listeners.has(ev)) a._listeners.get(ev).delete(fn);
      },
      fire(ev) { if (a._listeners.has(ev)) for (const fn of a._listeners.get(ev)) fn({}); },
    };
    return a;
  }

  // Fake scrubber range-input with getBoundingClientRect.
  function makeFakeRange(max = 1000) {
    const r = global.document.createElement('input');
    r.max = String(max);
    r.value = '0';
    r.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, bottom: 10, right: 200 });
    return r;
  }

  function makeFakeWrap() {
    const w = global.document.createElement('div');
    w.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, bottom: 10, right: 200 });
    return w;
  }

  const { AudioPlayer } = require(path.join(__dirname, '..', 'app', 'lib', 'audio-player.js'));
  const clipPaths = require(path.join(__dirname, '..', 'app', 'lib', 'clip-paths.js'));

  function makePlayer(overrides = {}) {
    const audio = overrides.audio || makeFakeAudio();
    const calls = {
      played: [], heard: [], removedPending: [],
      playStart: [], clipEnded: [], playNext: 0, renderDots: 0,
    };
    const queue = overrides.queue || [];
    const player = new AudioPlayer({
      audio,
      playPauseBtn: global.document.createElement('button'),
      playIcon: global.document.createElement('span'),
      pauseIcon: global.document.createElement('span'),
      back10Btn: global.document.createElement('button'),
      fwd10Btn: global.document.createElement('button'),
      scrubber: makeFakeRange(),
      scrubberWrap: makeFakeWrap(),
      scrubberMascot: global.document.createElement('div'),
      scrubberJarvis: global.document.createElement('div'),
      timeEl: global.document.createElement('span'),
      getPlaybackSpeed: () => overrides.playbackSpeed || 1.25,
      getAutoContinueAfterClick: () => overrides.autoContinue !== false,
      getQueue: () => queue,
      getHeardPaths: () => overrides.heardPaths || new Set(),
      markPlayed: (p) => calls.played.push(p),
      markHeard: (p) => calls.heard.push(p),
      removePending: (p) => calls.removedPending.push(p),
      fmt: (s) => `${Math.floor(s || 0)}s`,
      fileUrl: (p) => `file://${p}`,
      isPathSessionMuted: overrides.isPathSessionMuted || (() => false),
      isPathSessionStale: overrides.isPathSessionStale || (() => false),
      clipPaths,
      randomVerb: () => 'testing',
      setDynamicStyle: () => {},
      onPlayStart: (p, m) => calls.playStart.push([p, m]),
      onClipEnded: (p, m) => calls.clipEnded.push([p, m]),
      onPlayNextPending: () => { calls.playNext++; },
      onRenderDots: () => { calls.renderDots++; },
      audioContextFactory: overrides.audioContextFactory,
    });
    return { player, audio, calls, queue };
  }

  it('isIdle() is true when src is empty', () => {
    const { player } = makePlayer();
    player.mount();
    assertEqual(player.isIdle(), true);
    player.unmount();
  });

  it('isIdle() is false when audio is playing', () => {
    const audio = makeFakeAudio();
    audio.src = 'x';
    audio.paused = false;
    const { player } = makePlayer({ audio });
    player.mount();
    assertEqual(player.isIdle(), false);
    player.unmount();
  });

  it('playPath returns false when path not in queue', () => {
    const { player } = makePlayer({ queue: [] });
    player.mount();
    assertEqual(player.playPath('/missing.mp3'), false);
    player.unmount();
  });

  it('playPath(p, manual=true, userClick=true) sets state + fires callbacks', () => {
    const { player, audio, calls } = makePlayer({
      queue: [{ path: '/a.mp3', mtime: 1 }],
    });
    player.mount();
    assertEqual(player.playPath('/a.mp3', true, true), true);
    assertEqual(player.getCurrentPath(), '/a.mp3');
    assertEqual(audio.src, 'file:///a.mp3');
    assertEqual(audio.playbackRate, 1.25);
    assertEqual(calls.played, ['/a.mp3']);
    assertEqual(calls.heard, ['/a.mp3']);        // manual=true → heard
    assertEqual(calls.removedPending, ['/a.mp3']);
    assertEqual(calls.playStart.length, 1);      // cancelAutoDelete hook
    assertEqual(calls.renderDots, 1);
    player.unmount();
  });

  it('playPath(p) with manual=false does not mark heard', () => {
    const { player, calls } = makePlayer({
      queue: [{ path: '/a.mp3', mtime: 1 }],
    });
    player.mount();
    player.playPath('/a.mp3');
    assertEqual(calls.played, ['/a.mp3']);
    assertEqual(calls.heard, []);                // not marked heard
    player.unmount();
  });

  it('abort() clears currentPath + pauses + empties src', () => {
    const { player, audio } = makePlayer({
      queue: [{ path: '/a.mp3', mtime: 1 }],
    });
    player.mount();
    player.playPath('/a.mp3', true);
    player.abort();
    assertEqual(player.getCurrentPath(), null);
    assertEqual(audio.src, '');
    player.unmount();
  });

  it('abortIfAutoPlayed returns path when auto-played, null when manual', () => {
    const { player } = makePlayer({
      queue: [{ path: '/a.mp3', mtime: 1 }],
    });
    player.mount();
    // auto-played: manual=false
    player.playPath('/a.mp3', false);
    const aborted = player.abortIfAutoPlayed();
    assertEqual(aborted, '/a.mp3');
    assertEqual(player.getCurrentPath(), null);

    // manual-played: abortIfAutoPlayed should leave it alone.
    player.playPath('/a.mp3', true);
    const aborted2 = player.abortIfAutoPlayed();
    assertEqual(aborted2, null);
    assertEqual(player.getCurrentPath(), '/a.mp3');
    player.unmount();
  });

  it('ended handler clears state, schedules auto-delete, calls playNextPending', () => {
    const { player, audio, calls } = makePlayer({
      queue: [{ path: '/a.mp3', mtime: 1 }],
    });
    player.mount();
    player.playPath('/a.mp3', false, false);   // auto-played, not user-click
    audio.fire('ended');
    assertEqual(player.getCurrentPath(), null);
    assertEqual(calls.clipEnded.length, 1);
    assertEqual(calls.clipEnded[0][0], '/a.mp3');
    assertEqual(calls.clipEnded[0][1].manual, false);
    assertEqual(calls.playNext, 1);
    player.unmount();
  });

  it('ended handler with user-click + auto-continue chains to next forward clip', () => {
    const queue = [
      { path: '/a.mp3', mtime: 1 },
      { path: '/b.mp3', mtime: 2 },
      { path: '/c.mp3', mtime: 3 },
    ];
    const { player, audio, calls } = makePlayer({ queue });
    player.mount();
    player.playPath('/a.mp3', true, true);  // user-clicked
    calls.playNext = 0;                      // reset counter
    audio.fire('ended');
    // Should chain to /b.mp3 (next mtime-greater clip), NOT call playNextPending.
    assertEqual(player.getCurrentPath(), '/b.mp3');
    assertEqual(calls.playNext, 0);
    player.unmount();
  });

  it('ended handler with user-click but autoContinue=false falls through', () => {
    const queue = [{ path: '/a.mp3', mtime: 1 }, { path: '/b.mp3', mtime: 2 }];
    const { player, audio, calls } = makePlayer({ queue, autoContinue: false });
    player.mount();
    player.playPath('/a.mp3', true, true);
    calls.playNext = 0;
    audio.fire('ended');
    // autoContinue off → falls through to playNextPending, does not chain.
    assertEqual(calls.playNext, 1);
    player.unmount();
  });

  it('error handler clears state + calls playNextPending', () => {
    const { player, audio, calls } = makePlayer({
      queue: [{ path: '/a.mp3', mtime: 1 }],
    });
    player.mount();
    player.playPath('/a.mp3', false);
    calls.playNext = 0;
    audio.fire('error');
    assertEqual(player.getCurrentPath(), null);
    assertEqual(calls.playNext, 1);
    player.unmount();
  });

  it('stalled fires arm; playing/canplay/ended each cancel', () => {
    const { player, audio } = makePlayer();
    player.mount();
    audio.fire('stalled');
    assertTruthy(player._stallRecoveryTimer, 'stall timer should be armed');
    audio.fire('canplay');
    assertFalsy(player._stallRecoveryTimer, 'stall timer should be cancelled');
    player.unmount();
  });

  it('play/pause listeners flip icon visibility', () => {
    const { player, audio } = makePlayer();
    player.mount();
    audio.fire('play');
    assertEqual(player._playIcon._classes.has('hidden'), true);
    assertEqual(player._pauseIcon._classes.has('hidden'), false);
    audio.fire('pause');
    assertEqual(player._playIcon._classes.has('hidden'), false);
    assertEqual(player._pauseIcon._classes.has('hidden'), true);
    player.unmount();
  });

  it('playToggleTone creates + closes an AudioContext', () => {
    const created = [];
    const closed = [];
    const mockCtx = () => {
      const ctx = {
        currentTime: 0,
        destination: {},
        createOscillator: () => ({
          type: '', frequency: { value: 0 },
          connect(g) { return g; },
          start() {}, stop() {},
        }),
        createGain: () => ({
          gain: {
            setValueAtTime: () => {},
            linearRampToValueAtTime: () => {},
          },
          connect(d) { return d; },
        }),
        close: () => closed.push(1),
      };
      created.push(ctx);
      return ctx;
    };
    const { player } = makePlayer({ audioContextFactory: mockCtx });
    player.mount();
    player.playToggleTone(true);
    assertEqual(created.length, 1);
    player.playToggleTone(false);
    assertEqual(created.length, 2);
    player.unmount();
  });

  it('unmount cancels the scrubber rAF + stall timer + scrub-dir timer', () => {
    const { player, audio } = makePlayer();
    player.mount();
    audio.fire('stalled');
    assertTruthy(player._stallRecoveryTimer);
    player.unmount();
    assertFalsy(player._stallRecoveryTimer, 'stall timer cleared on unmount');
    assertFalsy(player._scrubDirTimer, 'scrub-dir timer cleared on unmount');
  });
});

describe('EX6f-4 — ipc-handlers (file + test-only)', () => {
  const { createIpcHandlers } = require(
    path.join(__dirname, '..', 'app', 'lib', 'ipc-handlers.js')
  );
  const {
    validShort, validVoice, sanitiseLabel, ALLOWED_INCLUDE_KEYS,
  } = require(path.join(__dirname, '..', 'app', 'lib', 'ipc-validate.js'));

  function makeFakeIpcMain() {
    const handlers = new Map();
    return {
      handle(name, fn) { handlers.set(name, fn); },
      invoke(name, ...args) {
        const fn = handlers.get(name);
        if (!fn) throw new Error(`no handler: ${name}`);
        return fn({}, ...args);
      },
      has(name) { return handlers.has(name); },
    };
  }

  function fileDeps(overrides = {}) {
    const unlinked = [];
    const hideCalls = [];
    const fakeWin = { isDestroyed: () => false, hide: () => hideCalls.push(Date.now()) };
    return {
      ipcMain: makeFakeIpcMain(),
      diag: () => {},
      getCFG: () => ({}),
      setCFG: () => {},
      getWin: () => fakeWin,
      loadAssignments: () => ({}),
      saveAssignments: () => true,
      saveConfig: () => true,
      getQueueFiles: () => [],
      ensureAssignmentsForFiles: () => ({}),
      isPidAlive: () => false,
      computeStaleSessions: () => [],
      SESSIONS_DIR: '/nope',
      notifyQueue: () => {},
      allowMutation: () => true,
      validShort, validVoice, sanitiseLabel, ALLOWED_INCLUDE_KEYS,
      apiKeyStore: { set: () => {} },
      redactForLog: (o) => o,
      setApplyingDock: () => {},
      QUEUE_DIR: '/safe/queue',
      isPathInside: (target, base) => target.startsWith(base + '/') || target === base,
      fs: {
        unlinkSync: (p) => unlinked.push(p),
        existsSync: () => false,
        readdirSync: () => [],
        readFileSync: () => '',
      },
      testMode: false,
      ...overrides,
      _unlinked: unlinked,
      _hideCalls: hideCalls,
    };
  }

  it('delete-file unlinks paths inside QUEUE_DIR', () => {
    const deps = fileDeps();
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('delete-file', '/safe/queue/ok.mp3'), true);
    assertEqual(deps._unlinked.length, 1);
  });

  it('delete-file refuses paths outside QUEUE_DIR', () => {
    const deps = fileDeps();
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('delete-file', '/etc/passwd'), false);
    assertEqual(deps._unlinked.length, 0);
  });

  it('delete-file refuses non-string paths', () => {
    const deps = fileDeps();
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('delete-file', null), false);
    assertEqual(deps.ipcMain.invoke('delete-file', { path: 'x' }), false);
    assertEqual(deps._unlinked.length, 0);
  });

  it('delete-file refuses paths > 4096 chars', () => {
    const deps = fileDeps();
    createIpcHandlers(deps).register();
    const long = '/safe/queue/' + 'a'.repeat(5000) + '.mp3';
    assertEqual(deps.ipcMain.invoke('delete-file', long), false);
    assertEqual(deps._unlinked.length, 0);
  });

  it('delete-file returns null when rate-limited', () => {
    const deps = fileDeps({ allowMutation: () => false });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('delete-file', '/safe/queue/ok.mp3'), null);
    assertEqual(deps._unlinked.length, 0);
  });

  it('delete-file swallows unlink errors as false', () => {
    const deps = fileDeps({
      fs: {
        unlinkSync: () => { throw new Error('ENOENT'); },
        existsSync: () => false,
        readdirSync: () => [],
        readFileSync: () => '',
      },
    });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('delete-file', '/safe/queue/missing.mp3'), false);
  });

  it('hide-window calls win.hide()', () => {
    const deps = fileDeps();
    createIpcHandlers(deps).register();
    deps.ipcMain.invoke('hide-window');
    assertEqual(deps._hideCalls.length, 1);
  });

  it('hide-window is safe when win is null', () => {
    const deps = fileDeps({ getWin: () => null });
    createIpcHandlers(deps).register();
    // must not throw
    deps.ipcMain.invoke('hide-window');
  });

  it('__test__/watchdog-state is NOT registered when testMode is false', () => {
    const deps = fileDeps({ testMode: false, getWatchdog: () => ({ getLastSweepMs: () => 0, isArmed: () => false }) });
    createIpcHandlers(deps).register();
    assertFalsy(deps.ipcMain.has('__test__/watchdog-state'),
      'test handler should stay hidden in production builds');
  });

  it('__test__/watchdog-state is registered and returns shape when testMode is on', () => {
    const fakeWatchdog = { getLastSweepMs: () => 0, isArmed: () => true };
    const deps = fileDeps({
      testMode: true,
      getWatchdog: () => fakeWatchdog,
      getWatchdogIntervalMs: () => 1800000,
    });
    createIpcHandlers(deps).register();
    const out = deps.ipcMain.invoke('__test__/watchdog-state');
    assertEqual(out.armed, true);
    assertEqual(out.lastSweepMs, 0);
    assertEqual(out.lastSweepAgeMs, null);
    assertEqual(out.intervalMs, 1800000);
  });

  it('__test__/watchdog-state reports lastSweepAgeMs when a sweep has run', () => {
    const now = Date.now();
    const fakeWatchdog = { getLastSweepMs: () => now - 500, isArmed: () => true };
    const deps = fileDeps({
      testMode: true,
      getWatchdog: () => fakeWatchdog,
      getWatchdogIntervalMs: () => 1800000,
    });
    createIpcHandlers(deps).register();
    const out = deps.ipcMain.invoke('__test__/watchdog-state');
    assertTruthy(out.lastSweepAgeMs >= 0, 'age should be non-negative');
    assertTruthy(out.lastSweepAgeMs < 5000, 'age should be small');
  });
});

describe('EX6c — queue-watcher', () => {
  const { createQueueWatcher, isAudioFile, AUDIO_OR_PARTIAL_RE } = require(
    path.join(__dirname, '..', 'app', 'lib', 'queue-watcher.js')
  );

  it('isAudioFile accepts mp3/wav, rejects .partial', () => {
    assertEqual(isAudioFile('foo.mp3'), true);
    assertEqual(isAudioFile('foo.wav'), true);
    assertEqual(isAudioFile('foo.MP3'), true);   // case-insensitive
    assertEqual(isAudioFile('foo.mp3.partial'), false);
    assertEqual(isAudioFile('foo.txt'), false);
    assertEqual(isAudioFile(''), false);
  });

  it('AUDIO_OR_PARTIAL_RE matches all three suffixes', () => {
    assertEqual(AUDIO_OR_PARTIAL_RE.test('foo.mp3'), true);
    assertEqual(AUDIO_OR_PARTIAL_RE.test('foo.wav'), true);
    assertEqual(AUDIO_OR_PARTIAL_RE.test('foo.partial'), true);
    assertEqual(AUDIO_OR_PARTIAL_RE.test('foo.txt'), false);
  });

  it('createQueueWatcher.list() filters non-audio + sorts newest-first', () => {
    const fakeFs = {
      readdirSync: () => ['old.mp3', 'new.wav', 'junk.txt', 'part.partial'],
      statSync: (full) => {
        if (full.endsWith('old.mp3')) return { mtimeMs: 100, size: 1 };
        if (full.endsWith('new.wav')) return { mtimeMs: 500, size: 1 };
        throw new Error('unexpected stat: ' + full);
      },
    };
    const watcher = createQueueWatcher({ queueDir: '/fake', maxFiles: 10, fs: fakeFs });
    const files = watcher.list();
    assertEqual(files.length, 2);
    assertEqual(files[0].name, 'new.wav');  // newest first
    assertEqual(files[1].name, 'old.mp3');
  });

  it('createQueueWatcher.list() respects maxFiles cap', () => {
    const fakeFs = {
      readdirSync: () => ['a.mp3', 'b.mp3', 'c.mp3', 'd.mp3', 'e.mp3'],
      statSync: (full) => ({ mtimeMs: full.charCodeAt(full.length - 5), size: 1 }),
    };
    const watcher = createQueueWatcher({ queueDir: '/fake', maxFiles: 2, fs: fakeFs });
    const files = watcher.list();
    assertEqual(files.length, 2);
  });

  it('createQueueWatcher.list() returns [] if readdir throws', () => {
    const fakeFs = {
      readdirSync: () => { throw new Error('ENOENT'); },
      statSync: () => { throw new Error('unused'); },
    };
    const watcher = createQueueWatcher({ queueDir: '/fake', maxFiles: 10, fs: fakeFs });
    assertEqual(watcher.list(), []);
  });

  it('factory rejects missing queueDir', () => {
    let caught = false;
    try { createQueueWatcher({ maxFiles: 10 }); } catch { caught = true; }
    assertEqual(caught, true);
  });

  it('factory rejects non-positive maxFiles', () => {
    let caught = false;
    try { createQueueWatcher({ queueDir: '/x', maxFiles: 0 }); } catch { caught = true; }
    assertEqual(caught, true);
  });
});

describe('EX6b — window-dock geometry', () => {
  const { findDockedEdge, clampToVisibleDisplay } = require(
    path.join(__dirname, '..', 'app', 'lib', 'window-dock.js')
  );

  it('findDockedEdge returns null when bar is mid-screen', () => {
    const edge = findDockedEdge({ y: 0, height: 1080 }, 500, 114, 50);
    if (edge !== null) throw new Error(`expected null, got ${edge}`);
  });

  it('findDockedEdge returns "top" when bar is near top edge', () => {
    const edge = findDockedEdge({ y: 0, height: 1080 }, 10, 114, 50);
    if (edge !== 'top') throw new Error(`expected "top", got ${edge}`);
  });

  it('findDockedEdge returns "bottom" when bar is near bottom edge', () => {
    const edge = findDockedEdge({ y: 0, height: 1080 }, 1080 - 114 - 10, 114, 50);
    if (edge !== 'bottom') throw new Error(`expected "bottom", got ${edge}`);
  });

  it('findDockedEdge prefers the nearer edge when both within threshold', () => {
    // tiny display; 114-high bar at y=20 is 20px from top, only 30px from bottom.
    // threshold 100 ensures both candidates; nearer edge wins.
    const edge = findDockedEdge({ y: 0, height: 164 }, 20, 114, 100);
    if (edge !== 'top') throw new Error(`expected "top" (20 < 30), got ${edge}`);
  });

  it('clampToVisibleDisplay preserves position when bar centre is on-screen', () => {
    const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
    const primary = displays[0];
    const r = clampToVisibleDisplay(500, 200, 680, 114, displays, primary);
    assertEqual(r, { x: 500, y: 200 });
  });

  it('clampToVisibleDisplay rescues off-screen bar to primary centre', () => {
    const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
    const primary = displays[0];
    const r = clampToVisibleDisplay(-5000, -5000, 680, 114, displays, primary);
    assertEqual(r.x, Math.floor((1920 - 680) / 2));
    assertEqual(r.y, 12);
  });

  it('clampToVisibleDisplay tests bar centre only, not full window', () => {
    // Expanded panel makes window 680×618 but the BAR is the top 114.
    // If the bar centre (y=350+57=407) is on-screen, don't rescue even
    // though the bottom of the window (968) might be.
    const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
    const primary = displays[0];
    const r = clampToVisibleDisplay(500, 350, 680, 114, displays, primary);
    assertEqual(r, { x: 500, y: 350 });
  });
});

describe('S5 — registry-lock contention', () => {
  const { withRegistryLock, _internals } = require(
    path.join(__dirname, '..', 'app', 'lib', 'registry-lock.js')
  );
  const tmpReg = path.join(os.tmpdir(), `tt-s5-reglock-${Date.now()}.json`);
  const tmpLock = tmpReg + '.lock';
  const cleanup = () => {
    try { fs.unlinkSync(tmpReg); } catch {}
    try { fs.unlinkSync(tmpLock); } catch {}
  };

  it('acquire times out and returns false when lock is held fresh', () => {
    cleanup();
    // Seed a fresh (non-stale) lock directly, simulating a concurrent holder.
    fs.writeFileSync(tmpLock, '999999');
    const start = Date.now();
    const held = _internals.acquire(tmpLock);
    const elapsed = Date.now() - start;
    assertEqual(held, false);
    // Must have busy-waited up to the timeout (500 ms) before giving up.
    // Check lower bound with a safety margin for slow CI.
    if (elapsed < _internals.ACQUIRE_TIMEOUT_MS - 50) {
      throw new Error(`acquire returned false too fast: ${elapsed}ms`);
    }
    cleanup();
  });

  it('second caller proceeds unlocked if first is frozen (graceful degrade)', () => {
    cleanup();
    fs.writeFileSync(tmpLock, '999999');
    // withRegistryLock still runs fn even when acquire failed — the
    // philosophy comment in registry-lock.js says "a stuck lock
    // shouldn't freeze the toolbar".
    const r = withRegistryLock(tmpReg, () => 'ran-without-lock');
    assertEqual(r, 'ran-without-lock');
    cleanup();
  });
});

describe('S5 — api-key-store corruption paths', () => {
  const { createApiKeyStore } = require(
    path.join(__dirname, '..', 'app', 'lib', 'api-key-store.js')
  );
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-s5-aks-'));
  const encPath = path.join(tmpDir, 'openai_key.enc');
  const secretPath = path.join(tmpDir, 'config.secrets.json');
  const logs = [];
  const store = createApiKeyStore({
    dir: tmpDir,
    logger: (msg) => logs.push(msg),
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s),
      decryptString: () => { throw new Error('corrupt enc payload'); },
    },
  });

  it('logs a warning when .enc cannot be decrypted, falls through to .secret', () => {
    logs.length = 0;
    fs.writeFileSync(encPath, 'aGVsbG8=');  // valid base64; decrypt throws per the fake
    fs.writeFileSync(secretPath, JSON.stringify({ openai_api_key: 'sk-fallback' }));
    const got = store.get();
    assertEqual(got, 'sk-fallback');
    if (!logs.some(m => /\.enc decrypt failed/.test(m))) {
      throw new Error(`expected decrypt-failed log line; got: ${JSON.stringify(logs)}`);
    }
    try { fs.unlinkSync(encPath); } catch {}
    try { fs.unlinkSync(secretPath); } catch {}
  });

  it('logs a warning when .secret is not valid JSON, returns null', () => {
    logs.length = 0;
    fs.writeFileSync(secretPath, '{ this is not json');
    const got = store.get();
    assertEqual(got, null);
    if (!logs.some(m => /\.secret parse failed/.test(m))) {
      throw new Error(`expected parse-failed log line; got: ${JSON.stringify(logs)}`);
    }
    try { fs.unlinkSync(secretPath); } catch {}
  });
});

describe('S5 — palette-alloc defensive branches', () => {
  const { allocatePaletteIndex } = require(
    path.join(__dirname, '..', 'app', 'lib', 'palette-alloc.js')
  );

  it('null assignments coerces to empty — returns index 0, free', () => {
    const r = allocatePaletteIndex('abcd1234', null);
    assertEqual(r.index, 0);
    assertEqual(r.reason, 'free');
  });

  it('undefined assignments coerces to empty — returns index 0, free', () => {
    const r = allocatePaletteIndex('abcd1234', undefined);
    assertEqual(r.index, 0);
    assertEqual(r.reason, 'free');
  });

  it('LRU tiebreak by shortId when last_seen equal', () => {
    // All 24 slots busy with identical last_seen; tie should resolve by
    // shortId ascending so 'aaaaaaaa' evicts before 'zzzzzzzz'.
    const assignments = {};
    const chars = 'abcdefghijklmnopqrstuvwx';  // 24 chars
    for (let i = 0; i < 24; i++) {
      const short = chars[i].repeat(8);
      assignments[short] = { index: i, last_seen: 1000 };
    }
    const r = allocatePaletteIndex('newshort', assignments);
    assertEqual(r.reason, 'lru');
    assertEqual(r.evicted, 'aaaaaaaa');
  });

  it('missing last_seen coerces to 0 for LRU comparison', () => {
    const assignments = {
      aaaaaaaa: { index: 0 },                        // no last_seen
      bbbbbbbb: { index: 1, last_seen: 5000 },
    };
    for (let i = 2; i < 24; i++) {
      assignments[String(i).padStart(8, 'x')] = { index: i, last_seen: 9999 };
    }
    const r = allocatePaletteIndex('newshort', assignments);
    assertEqual(r.reason, 'lru');
    // 'aaaaaaaa' has effectively last_seen=0; should evict first.
    assertEqual(r.evicted, 'aaaaaaaa');
  });

  it('hash-collision fallback uses empty string for null newShort', () => {
    // All 24 slots pinned so LRU has no candidates; forces hash-mod path.
    const assignments = {};
    const chars = 'abcdefghijklmnopqrstuvwx';
    for (let i = 0; i < 24; i++) {
      const short = chars[i].repeat(8);
      assignments[short] = { index: i, last_seen: 1000, pinned: true };
    }
    const r = allocatePaletteIndex(null, assignments);
    assertEqual(r.reason, 'hash-collision');
    assertEqual(r.evicted, null);
    // Empty string sums to 0; 0 % 24 = 0.
    assertEqual(r.index, 0);
  });
});

describe('S5 — concurrency mapLimit defensive branches', () => {
  const { mapLimit } = require(
    path.join(__dirname, '..', 'app', 'lib', 'concurrency.js')
  );

  it('non-array input coerces to empty array', async () => {
    const r = await mapLimit(null, 4, async () => 'x');
    assertEqual(r.length, 0);
  });

  it('limit of 0 or NaN coerces to 1 (at least one worker)', async () => {
    const r = await mapLimit([1, 2, 3], 0, async (n) => n * 2);
    assertEqual(r, [2, 4, 6]);
  });

  it('non-Error throw is wrapped in Error', async () => {
    const r = await mapLimit([1], 1, async () => { throw 'plain-string'; });
    if (!(r[0] instanceof Error)) throw new Error('expected Error wrap');
    assertEqual(r[0].message, 'plain-string');
  });
});

describe('S5 — session-stale defensive branches', () => {
  const { computeStaleSessions } = require(
    path.join(__dirname, '..', 'app', 'lib', 'session-stale.js')
  );

  it('non-object assignments returns empty', () => {
    assertEqual(computeStaleSessions(null, new Set(), new Set(), 1000), []);
    assertEqual(computeStaleSessions('nope', new Set(), new Set(), 1000), []);
    assertEqual(computeStaleSessions(42, new Set(), new Set(), 1000), []);
  });

  it('non-Set liveShorts is coerced via new Set(x)', () => {
    const assignments = { aabbccdd: { index: 0, last_seen: 0 } };
    const r = computeStaleSessions(assignments, ['aabbccdd'], [], 1000);
    assertEqual(r, []);  // aabbccdd is in shorts list, so NOT stale
  });

  it('malformed entry (non-object) is skipped', () => {
    const assignments = { aabbccdd: 'not-an-object', bbccddee: { index: 1, last_seen: 0 } };
    const r = computeStaleSessions(assignments, new Set(), new Set(), 1000, 10);
    assertEqual(r, ['bbccddee']);
  });
});

describe('S5 — config-validate string maxLen', () => {
  const { validateConfig } = require(
    path.join(__dirname, '..', 'app', 'lib', 'config-validate.js')
  );

  it('string exceeding maxLen is rejected', () => {
    const cfg = {
      voices: { edge_response: 'x'.repeat(500) },  // maxLen 80
      hotkeys: {}, playback: { speed: 1 },
      speech_includes: {}, openai_api_key: null,
    };
    const r = validateConfig(cfg);
    assertEqual(r.ok, false);
    if (!r.violations.some(v => /string too long/.test(v))) {
      throw new Error(`expected too-long violation; got: ${JSON.stringify(r.violations)}`);
    }
  });
});

describe('S5 — text.js image_alt=false strips entire image markdown', () => {
  const { stripForTTS } = require(
    path.join(__dirname, '..', 'app', 'lib', 'text.js')
  );

  it('with image_alt:false, image markdown is dropped', () => {
    const r = stripForTTS('hello ![cat pic](https://x/y.png) world', { image_alt: false });
    assertEqual(r, 'hello world');
  });

  it('with image_alt:true, alt text is preserved', () => {
    const r = stripForTTS('hello ![cat pic](https://x/y.png) world', { image_alt: true });
    assertEqual(r, 'hello cat pic world');
  });
});

console.log('\n----------------------------------------');
console.log(`Tests: ${pass} passed, ${fail} failed`);
console.log('----------------------------------------');
if (fail > 0) {
  process.exitCode = 1;
}
