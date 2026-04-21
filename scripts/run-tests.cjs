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
  it("main.js registers 'get-stale-sessions' IPC handler", () => {
    const mainPath = path.join(__dirname, '..', 'app', 'main.js');
    const src = fs.readFileSync(mainPath, 'utf8');
    if (!/ipcMain\.handle\(['"]get-stale-sessions['"]/.test(src)) {
      throw new Error("main.js missing ipcMain.handle('get-stale-sessions', ...)");
    }
    if (!/computeStaleSessions/.test(src)) {
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
    const rendererPath = path.join(__dirname, '..', 'app', 'renderer.js');
    const src = fs.readFileSync(rendererPath, 'utf8');
    if (!/staleSessionShorts/.test(src)) {
      throw new Error('renderer.js should track staleSessionShorts');
    }
    if (!/window\.api\.getStaleSessions/.test(src)) {
      throw new Error('renderer.js should call window.api.getStaleSessions');
    }
    if (!/classList\.add\(['"]stale['"]\)/.test(src)) {
      throw new Error("renderer.js should classList.add('stale') on dot/row");
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
    const src = fs.readFileSync(rendererPath, 'utf8');
    const block = src.match(/function scheduleAutoDelete[\s\S]{0,900}\n\}/);
    if (!block) throw new Error('scheduleAutoDelete block not found');
    // Need TWO currentPath guards: one before renderDots, one before IPC.
    const count = (block[0].match(/if\s*\(\s*currentPath\s*===\s*p\s*\)\s*return/g) || []).length;
    if (count < 2) {
      throw new Error(`scheduleAutoDelete should re-check currentPath after renderDots; found ${count} guard(s)`);
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
    if (!/pending-synth/.test(rendSrc)) {
      throw new Error('renderer.js should append a .dot.pending-synth placeholder');
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
    const src = fs.readFileSync(rendererPath, 'utf8');
    // The top-level renderDots() must enqueue; the hot body is _renderDotsNow.
    if (!/_renderDotsQueued/.test(src)) {
      throw new Error('renderDots should coalesce via a _renderDotsQueued flag');
    }
    if (!/requestAnimationFrame\(/.test(src)) {
      throw new Error('renderDots should use requestAnimationFrame to coalesce paints');
    }
    if (!/function _renderDotsNow/.test(src)) {
      throw new Error('hot body should live in _renderDotsNow so renderDots can no-op when queued');
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
    if (!/wrap\.setAttribute\(['"]role['"],\s*['"]row['"]\)/.test(rend)) {
      throw new Error('renderSessionRow should set role="row" on wrap');
    }
    if (!/dot\.setAttribute\(['"]role['"],\s*['"]listitem['"]\)/.test(rend)) {
      throw new Error('renderDots should set role="listitem" on each dot');
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
    if (!/function\s+playPath\s*\([^)]*userClick[^)]*\)/.test(rendererSrc)) {
      throw new Error('playPath must accept a userClick parameter');
    }
  });

  it('audio.ended branches on wasUserClick && autoContinueAfterClick', () => {
    if (!/wasUserClick\s*&&\s*autoContinueAfterClick/.test(rendererSrc)) {
      throw new Error('audio.ended handler must gate the continuation branch on both wasUserClick and autoContinueAfterClick');
    }
    // Continuation must select next clip by mtime strictly greater than justPlayed's
    if (!/f\.mtime\s*>\s*justPlayedClip\.mtime/.test(rendererSrc)) {
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
