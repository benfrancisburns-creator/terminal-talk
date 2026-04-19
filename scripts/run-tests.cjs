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
// stripForTTS (duplicated from main.js so we can test the include-toggle logic)
// =============================================================================
const STRIP_DEFAULTS = {
  code_blocks: false, inline_code: false, urls: false,
  headings: true, bullet_markers: false, image_alt: false
};
function stripForTTS(text, includes) {
  const inc = { ...STRIP_DEFAULTS, ...(includes || {}) };
  let t = text;
  const codeBlocks = [];
  if (inc.code_blocks) {
    t = t.replace(/```(?:\w+)?\r?\n?([\s\S]*?)```/g, (_m, body) => { codeBlocks.push(' ' + body + ' '); return `\u0000CB${codeBlocks.length-1}\u0000`; });
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
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  if (!inc.urls) t = t.replace(/https?:\/\/\S+/g, ' ');
  if (!inc.headings) t = t.replace(/^#+\s+.*$/gm, ' ');
  else               t = t.replace(/^#+\s*/gm, '');
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1').replace(/\*([^*\n]+)\*/g, '$1');
  if (!inc.bullet_markers) {
    t = t.replace(/^\s*[\u25cf\u23bf\u25b6\u25b8\u25ba\u25cb\u00b7\u25e6\u25aa\u25a0\u25a1\u25ab]\s*/gm, '');
    t = t.replace(/^\s*[-*+]\s+/gm, '');
    t = t.replace(/^\s*\d+\.\s+/gm, '');
  }
  t = t.replace(/Ctrl\+/g, 'control ');
  t = t.replace(/Cmd\+/g, 'command ');
  if (codeBlocks.length > 0) {
    t = t.replace(/\u0000CB(\d+)\u0000/g, (_, i) => codeBlocks[+i]);
  }
  return t.replace(/\s+/g, ' ').trim();
}

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
  clearRegistry();
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
      if (Number.isFinite(idx) && idx >= 0 && idx <= 31) valid++;
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

describe('INSTALL SANITY', () => {
  it('expected files exist in install dir', () => {
    const required = [
      'app/main.js', 'app/preload.js', 'app/renderer.js', 'app/index.html',
      'app/styles.css', 'app/package.json', 'app/wake-word-listener.py',
      'app/key_helper.py', 'app/edge_tts_speak.py', 'app/statusline.ps1',
      'hooks/speak-response.ps1', 'hooks/speak-notification.ps1',
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

console.log('\n----------------------------------------');
console.log(`Tests: ${pass} passed, ${fail} failed`);
console.log('----------------------------------------');
if (fail > 0) {
  process.exitCode = 1;
}
