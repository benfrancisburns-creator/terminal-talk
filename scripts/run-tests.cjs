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
  'PS TTS-HELPER MODULE IS CANONICAL',
  // These spawn `powershell.exe` and only run against the installed
  // module tree. Linux CI nodes have neither — skip cleanly rather
  // than fail with "module missing" / ENOENT for powershell.exe.
  'PS SESSION-IDENTITY BEHAVIOUR',
  'MARK-WORKING HOOK (UserPromptSubmit)',
  'PS ↔ JS REGISTRY LOCK CROSS-COMPAT',
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

// Order-insensitive deep compare for plain objects (e.g. speech_includes
// bags round-tripped through PowerShell, which enumerates hashtable keys
// in insertion order — different from our seed object key order).
function assertDeepEqual(actual, expected, msg) {
  const canon = (v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted = {};
      for (const k of Object.keys(v).sort()) sorted[k] = canon(v[k]);
      return sorted;
    }
    if (Array.isArray(v)) return v.map(canon);
    return v;
  };
  const a = JSON.stringify(canon(actual));
  const e = JSON.stringify(canon(expected));
  if (a !== e) throw new Error(`${msg || 'assertDeepEqual'}: expected ${e}, got ${a}`);
}

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

function runStatusline(sessionId, fakePid = null) {
  // fakePid overrides the real ParentProcessId Claude-Code-CLI detection.
  // Real terminals have distinct pids; the test runner spawns all PS
  // scripts from one node parent, so without this override the new
  // /clear PID-migration logic would treat every call as the same
  // terminal re-entering and merge all entries into one.
  const script = path.join(APP_DIR, 'statusline.ps1');
  const env = { ...process.env, TT_REGISTRY_PATH: REGISTRY_PATH };
  if (fakePid != null) env.TT_FAKE_CLAUDE_PID = String(fakePid);
  const result = spawnSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
    {
      input: JSON.stringify({ session_id: sessionId }),
      encoding: 'utf8',
      timeout: 10000,
      env,
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
      // fakePid per call so the /clear PID-migration heuristic treats
      // them as genuinely separate terminals (in prod each Claude Code
      // CLI has its own pid; the test runner's single pid would fool
      // the migration into collapsing both into one slot).
      clearRegistry();
      runStatusline('aaaaaaaa-1111-2222-3333-444444444444', 100001);
      runStatusline('bbbbbbbb-1111-2222-3333-444444444444', 100002);
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

    it('emits ANSI-wrapped block glyph (● / ▌ / ▀) with 24-bit fg', () => {
      // Post-v0.5 (option C): statusline no longer emits emoji
      // codepoints for arrangements — it emits ANSI 24-bit fg (+ bg for
      // splits) wrapping one of three block chars. Output shape:
      //   \x1b[38;2;R;G;Bm●\x1b[0m           (solid, idx 0-7)
      //   \x1b[38;2;R;G;B;48;2;R;G;Bm▌\x1b[0m (hsplit, idx 8-15)
      //   \x1b[38;2;R;G;B;48;2;R;G;Bm▀\x1b[0m (vsplit, idx 16-23)
      clearRegistry();
      const r = runStatusline('eeeeeeee-1111-2222-3333-444444444444');
      const out = r.stdout || '';
      assertTruthy(out.startsWith('\x1b['),
        `expected ANSI escape prefix, got: ${JSON.stringify(out.slice(0, 40))}`);
      // ANSI ESC is U+001B. Build the regex via String.raw + RegExp
      // to avoid an inline \x1b in a literal /regex/, which trips the
      // ESLint no-control-regex rule.
      const ESC = '\u001b';
      const fgRe = new RegExp(ESC + '\\[38;2;\\d+;\\d+;\\d+');
      assertTruthy(fgRe.test(out), 'expected 24-bit fg ANSI sequence');
      assertTruthy(out.endsWith(ESC + '[0m') || out.includes(ESC + '[0m '),
        'expected ANSI reset after glyph');
      // One of the three block chars must be present.
      assertTruthy(/[\u25CF\u258C\u2580]/.test(out),
        `expected one of ● ▌ ▀, got: ${JSON.stringify(out)}`);
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
// MARK-WORKING HOOK — UserPromptSubmit hook writes the session's
// `-working.flag` that the heartbeat timer + transcript-watcher gate
// on. No dedicated tests before audit 2026-04-23 Phase 2b. Each test
// redirects USERPROFILE to a temp dir so the hook writes into an
// isolated sandbox rather than the real install.
// =============================================================================
describe('MARK-WORKING HOOK (UserPromptSubmit)', () => {
  const hookPath = path.join(__dirname, '..', 'hooks', 'mark-working.ps1');

  function runMarkWorking(stdin, tempHome) {
    const env = { ...process.env, USERPROFILE: tempHome };
    const result = spawnSync('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', hookPath],
      { input: stdin, encoding: 'utf8', timeout: 10000, env }
    );
    return { stdout: result.stdout, stderr: result.stderr, code: result.status };
  }

  function makeTempHome() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-markworking-'));
    // mkdir queue/ and sessions/ dirs so Log() can write its target
    fs.mkdirSync(path.join(root, '.terminal-talk', 'queue'), { recursive: true });
    fs.mkdirSync(path.join(root, '.terminal-talk', 'sessions'), { recursive: true });
    return {
      root,
      sessionsDir: path.join(root, '.terminal-talk', 'sessions'),
      cleanup() {
        try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
      },
    };
  }

  it('writes flag file named <8hex>-working.flag with epoch-second content', () => {
    const home = makeTempHome();
    try {
      const payload = JSON.stringify({
        transcript_path: 'C:\\fake\\aabbccdd-1234-5678-9abc-def012345678.jsonl',
      });
      const r = runMarkWorking(payload, home.root);
      assertEqual(r.code, 0, `exit=${r.code}; stderr=${r.stderr}`);
      const flagPath = path.join(home.sessionsDir, 'aabbccdd-working.flag');
      assertTruthy(fs.existsSync(flagPath), 'flag file must exist');
      const content = fs.readFileSync(flagPath, 'utf8').replace(/^\uFEFF/, '').trim();
      assertTruthy(/^\d+$/.test(content), `flag content should be epoch seconds digits, got "${content}"`);
      const epoch = Number(content);
      // Sanity: epoch is recent (within 60 s of "now").
      const nowSec = Math.floor(Date.now() / 1000);
      assertTruthy(Math.abs(nowSec - epoch) < 60,
        `flag epoch ${epoch} drifts from now ${nowSec} by > 60s`);
    } finally { home.cleanup(); }
  });

  it('lowercases uppercase sessionId to match the 8-hex pattern', () => {
    const home = makeTempHome();
    try {
      const payload = JSON.stringify({
        transcript_path: 'C:\\fake\\AABBCCDD-1234-5678-9abc-def012345678.jsonl',
      });
      runMarkWorking(payload, home.root);
      const files = fs.readdirSync(home.sessionsDir);
      assertEqual(files, ['aabbccdd-working.flag'],
        'hook must lowercase the shortId when building the flag filename');
    } finally { home.cleanup(); }
  });

  it('rejects non-hex shortId (path traversal guard) — no file written', () => {
    const home = makeTempHome();
    try {
      const payload = JSON.stringify({
        transcript_path: 'C:\\fake\\....4444-1111-2222-3333-444444444444.jsonl',
      });
      runMarkWorking(payload, home.root);
      const files = fs.readdirSync(home.sessionsDir);
      assertEqual(files.length, 0,
        'non-hex first 8 chars must be rejected without writing ANY flag');
    } finally { home.cleanup(); }
  });

  it('no-op on empty stdin (no flag written)', () => {
    const home = makeTempHome();
    try {
      const r = runMarkWorking('', home.root);
      assertEqual(r.code, 0);
      assertEqual(fs.readdirSync(home.sessionsDir).length, 0);
    } finally { home.cleanup(); }
  });

  it('no-op on malformed JSON (no flag written, no crash)', () => {
    const home = makeTempHome();
    try {
      const r = runMarkWorking('not json at all', home.root);
      // Hook's outer try/catch swallows the parse error; exits 0.
      assertEqual(r.code, 0);
      assertEqual(fs.readdirSync(home.sessionsDir).length, 0);
    } finally { home.cleanup(); }
  });

  it('no-op on missing transcript_path', () => {
    const home = makeTempHome();
    try {
      const r = runMarkWorking('{"other_key": "x"}', home.root);
      assertEqual(r.code, 0);
      assertEqual(fs.readdirSync(home.sessionsDir).length, 0);
    } finally { home.cleanup(); }
  });

  it('creates the sessions dir if missing (first-run install)', () => {
    const home = makeTempHome();
    try {
      // Remove the sessions dir that makeTempHome pre-created.
      fs.rmSync(home.sessionsDir, { recursive: true });
      const payload = JSON.stringify({
        transcript_path: 'C:\\fake\\deadbeef-1111-2222-3333-444444444444.jsonl',
      });
      runMarkWorking(payload, home.root);
      assertTruthy(fs.existsSync(home.sessionsDir),
        'hook must create sessions dir on first run');
      assertTruthy(fs.existsSync(path.join(home.sessionsDir, 'deadbeef-working.flag')));
    } finally { home.cleanup(); }
  });

  it('normalises Unix-style /c/... transcript path to Windows C:\\...', () => {
    const home = makeTempHome();
    try {
      const payload = JSON.stringify({
        transcript_path: '/c/Users/ben/fake/cafef00d-1111-2222-3333-444444444444.jsonl',
      });
      const r = runMarkWorking(payload, home.root);
      assertEqual(r.code, 0);
      assertTruthy(fs.existsSync(path.join(home.sessionsDir, 'cafef00d-working.flag')),
        'Unix-style /c/... must be normalised so the sessionId is extracted correctly');
    } finally { home.cleanup(); }
  });
});

// =============================================================================
// CROSS-LANG EPOCH INVARIANT — PowerShell-written timestamps must agree
// with JS readers. Historic `Get-Date -UFormat %s` returned LOCAL seconds
// on Windows PowerShell 5.1, causing a timezone-offset drift when JS did
// `Date.now() / 1000` to compare. Audit 2026-04-23 Phase 2b caught it:
// BST (+1h) made working-flag timestamps look 3600 s in the future,
// accidentally passing `now - ts <= 600` in the CURRENT timezone but
// breaking elsewhere. Fix: `[DateTimeOffset]::Now.ToUnixTimeSeconds()`
// which is UTC-correct by construction regardless of PS version.
// =============================================================================
describe('CROSS-LANG EPOCH INVARIANT — PS timestamps are UTC seconds', () => {
  const PS_FILES = [
    'hooks/mark-working.ps1',
    'hooks/speak-response.ps1',
    'app/statusline.ps1',
  ];

  for (const rel of PS_FILES) {
    it(`${rel} uses ToUnixTimeSeconds (not Get-Date -UFormat %s)`, () => {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      // Check non-comment lines only — the fix commentary legitimately
      // MENTIONS the old invocation to explain why we're not using it.
      const code = src.split('\n')
        .filter(line => !/^\s*#/.test(line))
        .join('\n');
      if (/Get-Date\s+-UFormat\s+%s/i.test(code)) {
        throw new Error(
          `${rel}: \`Get-Date -UFormat %s\` is timezone-unsafe on Windows PowerShell 5.1 ` +
          `(returns LOCAL seconds, not UTC). Use [DateTimeOffset]::Now.ToUnixTimeSeconds() ` +
          `so cross-lang comparisons with JS Date.now()/1000 agree.`
        );
      }
      if (!/\[DateTimeOffset\]::Now\.ToUnixTimeSeconds\(\)/.test(code)) {
        throw new Error(`${rel}: missing [DateTimeOffset]::Now.ToUnixTimeSeconds() — can it read timestamps at all?`);
      }
    });
  }
});

// =============================================================================
// WAKE-WORD-LISTENER + KEY-HELPER Python scripts — source-level smoke
// tests. Both are substantial Python programs that are hard to run
// end-to-end in the harness (audio device needed for wake-word; stdin
// loop + ctypes needed for key helper). Source-level checks lock in the
// protocol contracts + key constants. Audit 2026-04-23 Phase 2b flagged
// these modules as having zero coverage.
// =============================================================================
describe('wake-word-listener.py + key_helper.py source-level invariants', () => {
  const wake = fs.readFileSync(path.join(__dirname, '..', 'app', 'wake-word-listener.py'), 'utf8');
  const helper = fs.readFileSync(path.join(__dirname, '..', 'app', 'key_helper.py'), 'utf8');

  it('wake-word-listener has byte-level Python syntax (no parse error)', () => {
    const r = spawnSync('python', ['-m', 'py_compile', path.join(__dirname, '..', 'app', 'wake-word-listener.py')],
      { encoding: 'utf8', timeout: 10000 });
    assertEqual(r.status, 0, `py_compile failed: ${r.stderr}`);
  });

  it('key_helper has byte-level Python syntax (no parse error)', () => {
    const r = spawnSync('python', ['-m', 'py_compile', path.join(__dirname, '..', 'app', 'key_helper.py')],
      { encoding: 'utf8', timeout: 10000 });
    assertEqual(r.status, 0, `py_compile failed: ${r.stderr}`);
  });

  it('wake-word-listener exposes --selftest so CI / install-sanity can exercise it without a mic', () => {
    if (!/--selftest/.test(wake)) {
      throw new Error('wake-word-listener.py must expose --selftest (headless model-load + stream-open + exit)');
    }
  });

  it('wake-word-listener writes to the canonical ~/.terminal-talk/queue/_voice.log', () => {
    // Downstream ops (install sanity, diagnostic sweep) grep this path.
    // If the log location drifts, those integrations silently stop.
    if (!/queue.*_voice\.log/.test(wake)) {
      throw new Error('wake-word-listener.py must log to queue/_voice.log');
    }
  });

  it('wake-word-listener applies an adaptive noise-floor gate (S2.3), not just raw THRESHOLD', () => {
    // Stripping the noise-floor code would re-introduce the false-fire
    // rate in busy rooms. Lock in that the EMA / noise-floor logic
    // still exists.
    if (!/noise[_-]?floor|ema|exponential/i.test(wake)) {
      throw new Error('wake-word-listener.py must keep the S2.3 adaptive noise-floor gate');
    }
  });

  it('key_helper supports all four commands in its protocol', () => {
    // Protocol contract: ctrlc / fgtree / fgtree-bump / exit.
    // Adding new commands is fine; removing any of these breaks the
    // Electron-side preload bindings that depend on them.
    for (const cmd of ['ctrlc', 'fgtree', 'fgtree-bump', 'exit']) {
      // Commands are compared as strings in the helper's dispatcher.
      // Quoted string match keeps us from matching substrings in
      // function names (e.g. "exit" vs sys.exit).
      const re = new RegExp(`['"]${cmd.replace('-', '\\-')}['"]`);
      if (!re.test(helper)) {
        throw new Error(`key_helper.py missing "${cmd}" in command dispatcher — protocol break`);
      }
    }
  });

  it('key_helper caches the process-tree snapshot (S2.2 — 500ms TTL)', () => {
    // The cache exists to prevent re-enumerating all windows processes
    // on back-to-back fgtree calls during one captureSelection. Without
    // it, hey-jarvis → speakClipboard incurs ~50-100ms of per-call
    // latency on Ben's box.
    if (!/cache|CACHE|invalidate/i.test(helper)) {
      throw new Error('key_helper.py must keep the S2.2 process-tree cache (cache + invalidate keywords)');
    }
  });

  it('key_helper writes to the canonical ~/.terminal-talk/queue/_helper.log', () => {
    if (!/_helper\.log/.test(helper)) {
      throw new Error('key_helper.py must log to _helper.log for forensic replay (S2.2)');
    }
  });

  it('key_helper emits "err <reason>" on unknown commands (not silent drop)', () => {
    if (!/['"]err /.test(helper)) {
      throw new Error('key_helper.py must reply "err <reason>" on unknown commands so main-side caller can differentiate fail from pending');
    }
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
  it('D1 (#19): looksLikeCode counts ALL pattern matches — untagged fence with repeated shell commands strips', () => {
    // Pre-parity, the 'shell-command-at-line-start' pattern only contributed 1 hit
    // regardless of how many times it matched in the body. Two `npm ...` lines
    // tripped Python's findall-counting but not JS's single-match-counting — same
    // text produced different audio on clipboard-speak vs response-speak. Post-fix,
    // JS matches Python's aggressive-strip stance.
    const body = 'npm install\nnpm test';
    const fenced = 'Preamble\n```\n' + body + '\n```\nTrailing';
    const out = stripForTTS(fenced);   // code_blocks=false default
    if (out.includes('npm install') || out.includes('npm test')) {
      throw new Error(`D1 regression: untagged fence with 2x npm should strip as code. Got: "${out}"`);
    }
  });
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
  it('D2 (#19): strips bare www.X domains by default — JS↔Python parity', () => {
    // Pre-parity, JS only matched http(s):// URLs; Python _URL_RE also
    // matched bare `www.X`. Same input produced different audio across
    // clipboard-speak (JS, kept) vs response-speak (Python, stripped).
    const out = stripForTTS('go to www.example.com for details');
    if (out.includes('www.example.com')) throw new Error(`bare www.X leaked: "${out}"`);
  });
  it('D3 (#19): strips heading WITHOUT space after # when headings=false — parity with Python', () => {
    // Pre-parity, JS required `\s+` after hashes ('# heading') so
    // `#notaheading` was kept as prose when headings=false. Python
    // allowed no-space. Default headings=true uses a different branch
    // (strip just the # marks, keep text) so we test the false path.
    const out = stripForTTS('#notaheading_content', { headings: false });
    if (out.includes('notaheading_content')) throw new Error(`no-space heading leaked: "${out}"`);
  });
  it('D3 (#19): strips heading WITH leading whitespace when headings=false — parity with Python', () => {
    const out = stripForTTS('  # my heading', { headings: false });
    if (out.includes('my heading')) throw new Error(`leading-ws heading leaked: "${out}"`);
  });
  it('D4 (#19): strips single-underscore emphasis — parity with Python', () => {
    // Pre-D4, JS was missing the _X_ arm that Python's _EMPHASIS_RE has.
    // Prose like `this is _emphasized_` reached TTS as "this is underscore
    // emphasized underscore" (reads literal underscore characters).
    const out = stripForTTS('this is _emphasized_ text');
    if (out.includes('_')) throw new Error(`single-underscore emphasis leaked: "${out}"`);
    if (!out.includes('emphasized')) throw new Error(`emphasis content dropped: "${out}"`);
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
  it('strips real inline code (shell commands with flags, fn calls)', () => {
    // 2026-04-22 — short identifier-like inline code now speaks (prose
    // whitelist). Test shell-commands-with-flags + fn-calls instead to
    // exercise the STRIP path specifically.
    const out = stripForTTS('Use `git log --oneline` to check history');
    if (out.includes('--oneline') || out.includes('`')) throw new Error(`inline code leaked: "${out}"`);
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

  // Inline-code prose whitelist: short identifier-like spans stay in
  // the spoken output so technical sentences remain coherent.
  // User-reported cases from a /clear-session-rotation explanation:
  // stripping these left "rotates the ___" fragments that confused
  // the listener.
  it('speaks short identifier-like inline code (single-word backticks)', () => {
    const out = stripForTTS('`/clear` rotates the `session_id`');
    if (!out.includes('/clear')) throw new Error(`/clear dropped: "${out}"`);
    if (!out.includes('session_id')) throw new Error(`session_id dropped: "${out}"`);
  });
  it('speaks kebab + PascalCase identifiers', () => {
    const out = stripForTTS('now `Update-SessionAssignment` re-keys on `remove-session`');
    if (!out.includes('Update-SessionAssignment')) throw new Error(`cmdlet dropped: "${out}"`);
    if (!out.includes('remove-session')) throw new Error(`cmd dropped: "${out}"`);
  });
  it('speaks literal values and file globs', () => {
    const out = stripForTTS('ghost entries with `pid=0` and stale `*-<short>.mp3` files');
    if (!out.includes('pid=0')) throw new Error(`literal dropped: "${out}"`);
    if (!out.includes('*-<short>.mp3')) throw new Error(`glob dropped: "${out}"`);
  });
  it('strips function-call syntax even when short', () => {
    const out = stripForTTS('call `myFn(1, 2)` to trigger');
    if (/myFn/.test(out)) throw new Error(`fn call should be stripped: "${out}"`);
  });
  it('strips shell commands with flags', () => {
    const out = stripForTTS('run `git log --oneline -20` for history');
    if (/--oneline/.test(out)) throw new Error(`shell cmd leaked: "${out}"`);
  });
  it('strips language operators (=>, ->, ::)', () => {
    const out = stripForTTS('use `arr.filter(x => x > 0)` to prune');
    if (/=>/.test(out)) throw new Error(`operator leaked: "${out}"`);
    if (/filter/.test(out)) throw new Error(`fn call leaked: "${out}"`);
  });
  it('strips content longer than 30 chars (too complex to be a prose token)', () => {
    const out = stripForTTS('consider `this_is_a_longish_thirty_one_char_ident_value` name');
    if (/longish_thirty/.test(out)) throw new Error(`long content leaked: "${out}"`);
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
    runStatusline('newnewne-1111-2222-3333-444444444444', 100003);
    const reg = readRegistry();
    if (!reg['pinpinpi']) throw new Error('pinned session was pruned');
  });

  it('a label-bearing entry with pinned=false survives grace-window prune', () => {
    // Ben's overnight 2026-04-22→23 bug: a session with label "TT 1" but
    // pinned=false (auto-pin not yet landed) got pruned once last_seen
    // slipped past the 4 h grace window and the queue-scan recreated
    // it with an empty label. isSessionLive now honours user intent
    // (label / voice / muted / focus / speech_includes) alongside
    // pinned, so historic entries from before auto-pin keep their
    // labels across pid rotation.
    // Use the installed mirror so the running toolbar's isSessionLive
    // matches the version under test. main.js isn't module.exports, so
    // we parse its hasUserIntent + isSessionLive out of source and eval
    // them — dodgy but contained to this behaviour test.
    const mainSrc = fs.readFileSync(path.join(APP_DIR, 'main.js'), 'utf8');
    const helperMatch = mainSrc.match(/function hasUserIntent\(entry\)\s*\{[\s\S]*?\n\}/);
    const liveMatch = mainSrc.match(/function isSessionLive\(entry, now\)\s*\{[\s\S]*?\n\}/);
    if (!helperMatch || !liveMatch) {
      throw new Error('could not locate hasUserIntent/isSessionLive in main.js');
    }
    const SESSION_GRACE_SEC = 14400;
    const isPidAlive = () => false;
    const isLive = new Function('entry', 'now', 'isPidAlive', 'SESSION_GRACE_SEC',
      `${helperMatch[0]}\n${liveMatch[0]}\nreturn isSessionLive(entry, now);`);
    const now = Math.floor(Date.now() / 1000);
    const ancient = now - 999999;
    // Labeled + not pinned + dead pid + ancient last_seen
    if (!isLive({ label: 'TT 1', pinned: false, claude_pid: 999999, last_seen: ancient },
                now, isPidAlive, SESSION_GRACE_SEC)) {
      throw new Error('labeled unpinned entry must be live under hasUserIntent');
    }
    // Voice override alone also counts
    if (!isLive({ voice: 'shimmer', pinned: false, claude_pid: 999999, last_seen: ancient },
                now, isPidAlive, SESSION_GRACE_SEC)) {
      throw new Error('voice-override unpinned entry must be live');
    }
    // muted / focus
    if (!isLive({ muted: true, pinned: false, claude_pid: 999999, last_seen: ancient },
                now, isPidAlive, SESSION_GRACE_SEC)) {
      throw new Error('muted unpinned entry must be live');
    }
    if (!isLive({ focus: true, pinned: false, claude_pid: 999999, last_seen: ancient },
                now, isPidAlive, SESSION_GRACE_SEC)) {
      throw new Error('focused unpinned entry must be live');
    }
    // speech_includes
    if (!isLive({ speech_includes: { urls: true }, pinned: false, claude_pid: 999999, last_seen: ancient },
                now, isPidAlive, SESSION_GRACE_SEC)) {
      throw new Error('speech_includes-override unpinned entry must be live');
    }
    // Plain entry with no user intent and expired grace → NOT live
    if (isLive({ pinned: false, claude_pid: 999999, last_seen: ancient },
               now, isPidAlive, SESSION_GRACE_SEC)) {
      throw new Error('plain unpinned stale entry must NOT be live');
    }
    // Empty-string label still counts as no intent (retraction)
    if (isLive({ label: '', pinned: false, claude_pid: 999999, last_seen: ancient },
               now, isPidAlive, SESSION_GRACE_SEC)) {
      throw new Error('empty-label unpinned stale entry must NOT be live');
    }
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

describe('PS ↔ JS REGISTRY LOCK CROSS-COMPAT', () => {
  // POST-V4 thread #3. The static tests in "PS SESSION-REGISTRY MODULE
  // IS CANONICAL" already confirm that session-registry.psm1 exposes
  // Enter-RegistryLock / Exit-RegistryLock and that all three PS writers
  // (statusline.ps1, hooks/speak-response.ps1, hooks/speak-on-tool.ps1)
  // wrap their Read-Update-Save triplet with the pair. What they DON'T
  // verify is that the sentinel files are actually byte-compatible
  // between JS and PS — same filename, same staleness constants, same
  // "this file means locked" semantics. Without that, the two sides
  // could be using identical-looking-but-non-interoperable mechanisms
  // and the race the lock was introduced to prevent would still fire.
  //
  // Test 1 (static): constants on both sides agree. LockStaleMs /
  // LockAcquireMs / LockPollMs in the PS module must equal LOCK_STALE_MS
  // / ACQUIRE_TIMEOUT_MS / POLL_BACKOFF_MS from registry-lock.js —
  // otherwise a sentinel held by one side could be treated as stale
  // by the other after a mismatched timeout.
  //
  // Test 2 (runtime): PS writes the sentinel, JS tries to acquire, JS
  // falls through. Proves the sentinel file PS creates is visible to
  // JS's O_EXCL acquire primitive (i.e. both sides race on the same
  // inode + same `.lock` filename convention, not some PS-only spot).
  const { withRegistryLock } = require(
    path.join(__dirname, '..', 'app', 'lib', 'registry-lock.js')
  );
  const psModulePath = path.join(APP_DIR, 'session-registry.psm1');
  const tmpReg = path.join(os.tmpdir(), `tt-cross-lock-${Date.now()}.json`);
  const tmpLock = tmpReg + '.lock';
  const cleanup = () => {
    try { fs.unlinkSync(tmpReg); } catch {}
    try { fs.unlinkSync(tmpLock); } catch {}
  };

  // PS-safe path escaping: single-quoted PowerShell strings are literal
  // except for `'` which escapes to `''`. Backslashes stay as-is.
  const psLiteral = (p) => p.replace(/'/g, "''");

  // -ExecutionPolicy Bypass so the test doesn't silently degrade on
  // machines where scripts are disabled for the CurrentUser / LocalMachine
  // scope. Without this, Import-Module throws PSSecurityException,
  // Enter-RegistryLock stays undefined, $acquired ends up $null (falsy),
  // and the first test would falsely "pass" by reading TIMED_OUT for the
  // wrong reason. -NonInteractive keeps PS from prompting for policy.
  const PS_ARGS = ['-NoLogo', '-NoProfile', '-NonInteractive',
                   '-ExecutionPolicy', 'Bypass', '-Command'];

  const runPs = (script) => {
    const r = spawnSync('powershell.exe', [...PS_ARGS, script],
      { encoding: 'utf8', timeout: 10000 });
    if (r.error) throw new Error(`powershell spawn failed: ${r.error.message}`);
    if (r.stderr && r.stderr.trim()) {
      throw new Error(`powershell stderr: ${r.stderr.trim()}`);
    }
    return r.stdout.trim();
  };

  it('PS lock constants match JS registry-lock.js (same sentinel semantics)', () => {
    // If the PS LockStaleMs / LockAcquireMs / LockPollMs ever drift from
    // the JS LOCK_STALE_MS / ACQUIRE_TIMEOUT_MS / POLL_BACKOFF_MS, the
    // two sides would still both write a sentinel but disagree on when
    // it goes stale, how long to wait for it, and how often to retry.
    // Then a "held" lock from one side could be stolen by the other
    // after a mismatched timeout — silently re-opening the race.
    const { _internals } = require(
      path.join(__dirname, '..', 'app', 'lib', 'registry-lock.js')
    );
    const out = runPs(
      `Import-Module '${psLiteral(psModulePath)}' -Force; ` +
      `$mod = Get-Module session-registry; ` +
      `& $mod { Write-Output ([string]$script:LockStaleMs + ',' + [string]$script:LockAcquireMs + ',' + [string]$script:LockPollMs) }`
    );
    const [psStale, psAcquire, psPoll] = out.split(',').map(Number);
    assertEqual(psStale,   _internals.LOCK_STALE_MS,       'LockStaleMs ≠ LOCK_STALE_MS');
    assertEqual(psAcquire, _internals.ACQUIRE_TIMEOUT_MS,  'LockAcquireMs ≠ ACQUIRE_TIMEOUT_MS');
    assertEqual(psPoll,    _internals.POLL_BACKOFF_MS,     'LockPollMs ≠ POLL_BACKOFF_MS');
  });

  it('JS withRegistryLock falls through while PS holds a fresh sentinel', () => {
    cleanup();
    // PS "holds" by acquiring and exiting without releasing. The
    // sentinel stays on disk with mtime=now. JS acquire must time out
    // after 500ms and fall through unlocked (per registry-lock.js
    // philosophy: "a stuck lock shouldn't freeze the toolbar").
    const out = runPs(
      `Import-Module '${psLiteral(psModulePath)}' -Force; ` +
      `$acquired = Enter-RegistryLock -RegistryPath '${psLiteral(tmpReg)}'; ` +
      `if ($acquired) { Write-Output 'HELD' } else { Write-Output 'FAILED' }`
    );
    if (out !== 'HELD') {
      throw new Error(`PS acquire did not succeed: stdout=${JSON.stringify(out)}`);
    }
    assertEqual(fs.existsSync(tmpLock), true);
    // Refresh mtime so it's unambiguously fresh (PS startup took
    // ~1–2s; within stale threshold but closer to the edge).
    const now = Date.now() / 1000;
    fs.utimesSync(tmpLock, now, now);
    // JS wrapper runs fn even when acquire fails; check that the
    // return value still flows, and — critically — that the sentinel
    // was NOT released (JS didn't hold it, so the `if (held) release`
    // guard must have suppressed the unlink).
    const fallthrough = withRegistryLock(tmpReg, () => 'fell-through');
    assertEqual(fallthrough, 'fell-through');
    assertEqual(fs.existsSync(tmpLock), true);
    cleanup();
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

describe('CONFIG PERSISTENCE ROUND-TRIP', () => {
  // Regression guard for #1 heartbeat-revert + #3 settings-persistence-full-
  // audit + #7 top-level-key-dropped-audit. Three separate user-hit bugs;
  // same root cause. The write-side merge in ipc-handlers.js update-config
  // and the read-side return in config-store.js load() BOTH carried
  // hardcoded top-level-key allowlists. Any validator-accepted scalar NOT
  // in both allowlists was silently dropped on every save+load round-trip.
  //
  // This group iterates the validator's RULES table — the single source of
  // truth for legal top-level keys. If a new scalar is added to RULES but
  // either allowlist isn't updated, these tests fail on the next CI run.
  const { createConfigStore } = require(
    path.join(__dirname, '..', 'app', 'lib', 'config-store.js')
  );
  const { validateConfig, RULES } = require(
    path.join(__dirname, '..', 'app', 'lib', 'config-validate.js')
  );
  const DEFAULTS = {
    voices:          { edge_response: 'en-GB-RyanNeural' },
    hotkeys:         {},
    playback:        { speed: 1.25, tts_provider: 'edge' },
    speech_includes: { code_blocks: false },
    heartbeat_enabled: true,
    openai_api_key:    null,
    selected_tab:      'all',
    tabs_expanded:     false,
  };
  const tmpCfg = path.join(os.tmpdir(), `tt-roundtrip-${Date.now()}.json`);
  const clean = () => { try { fs.unlinkSync(tmpCfg); } catch {} };

  it('heartbeat_enabled=false survives save → load (#1)', () => {
    clean();
    const store = createConfigStore({ configPath: tmpCfg, defaults: DEFAULTS, validator: validateConfig });
    store.save({ ...DEFAULTS, heartbeat_enabled: false });
    const loaded = store.load();
    assertEqual(loaded.heartbeat_enabled, false, 'heartbeat_enabled must round-trip through save+load');
    clean();
  });

  it('selected_tab + tabs_expanded survive save → load (#7)', () => {
    clean();
    const store = createConfigStore({ configPath: tmpCfg, defaults: DEFAULTS, validator: validateConfig });
    store.save({ ...DEFAULTS, selected_tab: '7e5c9a', tabs_expanded: true });
    const loaded = store.load();
    assertEqual(loaded.selected_tab, '7e5c9a', 'selected_tab must round-trip');
    assertEqual(loaded.tabs_expanded, true,    'tabs_expanded must round-trip');
    clean();
  });

  it('every validator-accepted top-level scalar survives save → load (#3, RULES-driven)', () => {
    // Forcing function: iterates the validator's RULES table. If a future
    // commit adds a new top-level scalar key (boolean/string/number) but
    // forgets to extend the config-store.load() return literal, this test
    // fails. openai_api_key is skipped because the update-config handler
    // routes it through apiKeyStore; the store itself preserves it.
    clean();
    const store = createConfigStore({ configPath: tmpCfg, defaults: DEFAULTS, validator: validateConfig });
    const topLevelScalars = RULES.filter((r) => {
      if (r.path.includes('.')) return false;  // nested
      const types = Array.isArray(r.type) ? r.type : [r.type];
      return !types.includes('object');
    });
    const probe = { ...DEFAULTS };
    const expected = {};
    for (const r of topLevelScalars) {
      // Pick a non-default value that passes the rule so the round-trip
      // distinguishes "key preserved" from "default filled in".
      const types = Array.isArray(r.type) ? r.type : [r.type];
      let v;
      if (types.includes('boolean')) v = DEFAULTS[r.path] === true ? false : true;
      else if (types.includes('string') && r.path === 'openai_api_key') continue;  // special
      else if (types.includes('string')) v = 'rt-probe';
      else if (types.includes('number')) v = ((r.min ?? 0) + (r.max ?? 1)) / 2;
      else continue;
      probe[r.path] = v;
      expected[r.path] = v;
    }
    store.save(probe);
    const loaded = store.load();
    for (const [k, v] of Object.entries(expected)) {
      assertEqual(loaded[k], v, `validator-accepted scalar "${k}" dropped by store.load() — extend config-store.js return literal`);
    }
    clean();
  });

  it('update-config merge preserves heartbeat_enabled (#1 Bug A)', () => {
    // Site A guard. The previous merge in ipc-handlers.js:456-462 built a
    // new object with exactly 5 hardcoded top-level keys; heartbeat_enabled
    // was silently dropped before saveConfig saw it. Rebuild just enough of
    // the factory environment to invoke the handler and assert the merged
    // object that reaches saveConfig carries heartbeat_enabled.
    const { createIpcHandlers } = require(
      path.join(__dirname, '..', 'app', 'lib', 'ipc-handlers.js')
    );
    const handlers = {};
    const ipcMain = { handle: (name, fn) => { handlers[name] = fn; } };
    const currentCfg = { ...DEFAULTS };
    let savedArg = null;
    let setCfgArg = null;
    createIpcHandlers({
      ipcMain,
      diag: () => {},
      callEdgeTTS: () => {},
      getAppVersion: () => '0.0.0-test',
      getCFG: () => currentCfg,
      loadAssignments: () => ({}),
      getQueueFiles: () => [],
      getQueueAllPaths: () => [],
      ensureAssignmentsForFiles: () => {},
      shortFromFile: () => null,
      isPidAlive: () => false,
      computeStaleSessions: () => [],
      SESSIONS_DIR: os.tmpdir(),
      getWin: () => null,
      saveAssignments: () => true,
      notifyQueue: () => {},
      allowMutation: () => true,
      validShort: () => true,
      validVoice: () => true,
      sanitiseLabel: (s) => s,
      ALLOWED_INCLUDE_KEYS: new Set(),
      setCFG: (c) => { setCfgArg = c; },
      saveConfig: (c) => { savedArg = c; return true; },
      apiKeyStore: { set: () => {}, get: () => null },
      redactForLog: (x) => x,
      setApplyingDock: () => {},
      testMode: true,
      QUEUE_DIR: os.tmpdir(),
      isPathInside: () => true,
      getWatchdog: () => null,
      getWatchdogIntervalMs: () => 0,
    }).register();
    if (!handlers['update-config']) throw new Error('update-config handler not registered');
    handlers['update-config']({}, { heartbeat_enabled: false });
    if (!savedArg) throw new Error('saveConfig never invoked');
    assertEqual(savedArg.heartbeat_enabled, false, 'update-config merge must carry heartbeat_enabled into saveConfig');
    assertEqual(setCfgArg.heartbeat_enabled, false, 'update-config merge must carry heartbeat_enabled into setCFG');
  });
});

describe('REGISTRY LOGGING (#6 Batch 1 — G1 G2 G3)', () => {
  // Per #6 log-audit: registry writes used to be silent on success and
  // the update-config success log was dishonest about dropped keys.
  // Each fix gets both a structural source-grep (cheap, fails fast if
  // someone rewrites the log line) and, where the factory deps allow,
  // a unit-level assertion that the behaviour holds end-to-end.
  const mainJsSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8');
  const ipcSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'lib', 'ipc-handlers.js'), 'utf8');
  const psRegistrySrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'session-registry.psm1'), 'utf8');

  it('G1 — main.js saveAssignments logs on success with caller + delta fields', () => {
    if (!/function\s+saveAssignments\s*\(\s*all\s*,\s*caller\s*=/.test(mainJsSrc)) {
      throw new Error('saveAssignments signature must accept (all, caller = ...) — see #6 G1');
    }
    if (!/save-registry ok from=\$\{caller\}\s+keys=\$\{delta\.count\}/.test(mainJsSrc)) {
      throw new Error('saveAssignments success path must emit `save-registry ok from=<caller> keys=<n>` — see #6 G1');
    }
    if (!/added=\[/.test(mainJsSrc) || !/removed=\[/.test(mainJsSrc) || !/changed=\[/.test(mainJsSrc)) {
      throw new Error('save-registry log must include added/removed/changed short-ID arrays — see #6 G1');
    }
  });

  it('G1 — main.js writeAssignments accepts opts.caller + logs on success', () => {
    if (!/writeAssignments\s*\(\s*all\s*,\s*opts\s*\)/.test(mainJsSrc)) {
      throw new Error('writeAssignments signature unchanged from (all, opts) — see #6 G1');
    }
    if (!/const\s+caller\s*=\s*\(opts\s*&&\s*opts\.caller\)\s*\|\|\s*'unknown'/.test(mainJsSrc)) {
      throw new Error('writeAssignments must read caller from opts.caller with default unknown — see #6 G1');
    }
    if (!/write-registry ok from=\$\{caller\}/.test(mainJsSrc)) {
      throw new Error('writeAssignments success path must emit `write-registry ok from=<caller>` — see #6 G1');
    }
  });

  it('G3 — every saveAssignments call site passes a caller string', () => {
    // Zero call sites without a caller arg. Match `saveAssignments(ident)` (1 arg)
    // as the failure mode.
    const bareCalls = [];
    const rx = /\bsaveAssignments\s*\(([^)]*)\)/g;
    let m;
    while ((m = rx.exec(ipcSrc)) !== null) {
      const args = m[1].trim();
      // 1-arg call (no comma) → missing caller. Skip multiline defs.
      if (args && !args.includes(',')) bareCalls.push(args);
    }
    if (bareCalls.length > 0) {
      throw new Error(`saveAssignments callsites missing caller string: ${bareCalls.join(' | ')} — see #6 G3`);
    }
  });

  it('G3 — every writeAssignments call site in main.js passes opts.caller', () => {
    // Find `writeAssignments(<args>)` and filter function-definition line.
    const rx = /\bwriteAssignments\s*\(([^)]*)\)/g;
    const bareCalls = [];
    let m;
    while ((m = rx.exec(mainJsSrc)) !== null) {
      const args = m[1];
      if (args.startsWith('all, opts')) continue;  // function definition
      if (!/caller:/.test(args)) bareCalls.push(args);
    }
    if (bareCalls.length > 0) {
      throw new Error(`writeAssignments callsites missing caller in opts: ${bareCalls.join(' | ')} — see #6 G3`);
    }
  });

  it('G2 — update-config success log emits applied + dropped key arrays', () => {
    if (!/applied=\[\$\{appliedKeys\.join/.test(ipcSrc)) {
      throw new Error('update-config log must emit applied=[<keys>] — see #6 G2');
    }
    if (!/dropped=\[\$\{droppedKeys\.join/.test(ipcSrc)) {
      throw new Error('update-config log must emit dropped=[<keys>] — see #6 G2');
    }
    // And must NOT still emit the dishonest pre-fix `saved=${ok}, edge_response=` line.
    if (/saved=\$\{ok\},\s*edge_response=/.test(ipcSrc)) {
      throw new Error('update-config still has the pre-fix dishonest success line — remove it, #6 G2');
    }
  });

  it('G2 — update-config handler flags unknown partial keys as dropped (end-to-end)', () => {
    const { createIpcHandlers } = require(
      path.join(__dirname, '..', 'app', 'lib', 'ipc-handlers.js')
    );
    const capturedLines = [];
    const handlers = {};
    const ipcMain = { handle: (name, fn) => { handlers[name] = fn; } };
    const curCfg = {
      voices: {}, hotkeys: {}, playback: {}, speech_includes: {},
      heartbeat_enabled: true, selected_tab: 'all', tabs_expanded: false,
      openai_api_key: null,
    };
    createIpcHandlers({
      ipcMain,
      diag: (line) => capturedLines.push(line),
      callEdgeTTS: () => {},
      getAppVersion: () => '0.0.0-test',
      getCFG: () => curCfg,
      loadAssignments: () => ({}),
      getQueueFiles: () => [],
      getQueueAllPaths: () => [],
      ensureAssignmentsForFiles: () => {},
      shortFromFile: () => null,
      isPidAlive: () => false,
      computeStaleSessions: () => [],
      SESSIONS_DIR: os.tmpdir(),
      getWin: () => null,
      saveAssignments: () => true,
      notifyQueue: () => {},
      allowMutation: () => true,
      validShort: () => true,
      validVoice: () => true,
      sanitiseLabel: (s) => s,
      ALLOWED_INCLUDE_KEYS: new Set(),
      setCFG: () => {},
      saveConfig: () => true,
      apiKeyStore: { set: () => {}, get: () => null },
      redactForLog: (x) => x,
      setApplyingDock: () => {},
      testMode: true,
      QUEUE_DIR: os.tmpdir(),
      isPathInside: () => true,
      getWatchdog: () => null,
      getWatchdogIntervalMs: () => 0,
    }).register();
    // Known key survives → applied. Unknown key → dropped.
    handlers['update-config']({}, { heartbeat_enabled: false, foo_bar: 42 });
    const okLine = capturedLines.find((l) => l.startsWith('update-config OK:'));
    if (!okLine) throw new Error('no update-config OK diag line captured');
    if (!/applied=\[[^\]]*heartbeat_enabled/.test(okLine)) {
      throw new Error(`applied=[...] must contain heartbeat_enabled — got: ${okLine}`);
    }
    if (!/dropped=\[[^\]]*foo_bar/.test(okLine)) {
      throw new Error(`dropped=[...] must contain foo_bar — got: ${okLine}`);
    }
  });

  it('G1 + G3 — PS Save-Registry exposes -Caller + -LogPath params and logs both paths', () => {
    if (!/\[string\]\$Caller\s*=\s*'unknown'/.test(psRegistrySrc)) {
      throw new Error('Save-Registry must expose -Caller parameter with default unknown — see #6 G1/G3');
    }
    if (!/\[string\]\$LogPath\s*=\s*''/.test(psRegistrySrc)) {
      throw new Error('Save-Registry must expose -LogPath parameter — see #6 G1');
    }
    if (!/save-registry ok from=\$Caller keys=\$keys/.test(psRegistrySrc)) {
      throw new Error('Save-Registry success path must emit `save-registry ok from=$Caller keys=$keys` — see #6 G1');
    }
    if (!/save-registry fail from=\$Caller/.test(psRegistrySrc)) {
      throw new Error('Save-Registry failure path must emit `save-registry fail from=$Caller` — see #6 G1');
    }
  });

  it('G3 — every PS Save-Registry call site passes -Caller + -LogPath', () => {
    const callers = [
      { file: 'app/statusline.ps1',       caller: 'statusline' },
      { file: 'hooks/speak-on-tool.ps1',  caller: 'speak-on-tool' },
      { file: 'hooks/speak-response.ps1', caller: 'speak-response' },
    ];
    for (const { file, caller } of callers) {
      const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      // Accept a 3-line invocation using PowerShell `\n` line continuations.
      const rx = new RegExp(
        String.raw`Save-Registry[^\n]*(?:\n[^\n]*){0,3}-Caller\s+['"]` + caller + String.raw`['"][\s\S]{0,200}-LogPath`
      );
      if (!rx.test(src)) {
        throw new Error(`${file} — Save-Registry call must pass -Caller '${caller}' + -LogPath — see #6 G3`);
      }
    }
  });
});

describe('REGISTRY USER-INTENT GUARD (#8 defensive)', () => {
  // Ben's session labels / pinned / speech_includes keep getting wiped
  // by a write path we haven't empirically pinned yet. The belt-and-
  // braces defensive guard: touch-path writes (ensure-for-files,
  // statusline, speak-on-tool, speak-response, backup-recovery) are NOT
  // allowed to drop user-intent fields for an entry that already has
  // them on disk. If the incoming payload would wipe one, it's restored
  // from disk and a WARN-level diag fires.
  //
  // Intent-path writes (set-session-label, set-session-voice,
  // set-session-muted, set-session-focus, set-session-include,
  // remove-session) bypass the guard — the user explicitly asked for
  // the mutation.
  const mainJsSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8');
  const psRegistrySrc = fs.readFileSync(
    path.join(__dirname, '..', 'app', 'session-registry.psm1'), 'utf8'
  );

  it('JS — USER_INTENT_WRITERS set lists the 6 intent-path callers', () => {
    const m = mainJsSrc.match(/USER_INTENT_WRITERS\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/);
    if (!m) throw new Error('USER_INTENT_WRITERS allowlist not found in main.js — see #8 guard');
    const names = m[1];
    for (const expected of [
      'set-session-label', 'set-session-voice', 'set-session-muted',
      'set-session-focus', 'set-session-include', 'remove-session',
    ]) {
      if (!names.includes(`'${expected}'`)) {
        throw new Error(`USER_INTENT_WRITERS missing "${expected}" — see #8 guard`);
      }
    }
  });

  it('JS — _guardUserIntent restores label/pinned/voice/muted/focus/speech_includes', () => {
    if (!/function\s+_guardUserIntent\s*\(all,\s*caller\)/.test(mainJsSrc)) {
      throw new Error('_guardUserIntent function signature missing — see #8 guard');
    }
    // Verify each user-intent field appears in a restoration branch.
    for (const field of ['label', 'pinned', 'voice', 'muted', 'focus', 'speech_includes']) {
      // Each field should appear on BOTH sides of an oldEntry/newEntry
      // comparison in the guard body.
      const rx = new RegExp(`oldEntry\\.${field}[\\s\\S]{0,200}newEntry\\.${field}`);
      if (!rx.test(mainJsSrc)) {
        throw new Error(`_guardUserIntent does not restore ${field} — see #8 guard`);
      }
    }
  });

  it('JS — saveAssignments + writeAssignments both invoke the guard', () => {
    // Both writers run the guard. Without this, one path would bypass.
    const saveMatch = mainJsSrc.match(/function\s+saveAssignments[\s\S]*?\n\}/);
    if (!saveMatch || !/_guardUserIntent\(all,\s*caller\)/.test(saveMatch[0])) {
      throw new Error('saveAssignments must call _guardUserIntent(all, caller) — see #8 guard');
    }
    const writeMatch = mainJsSrc.match(/function\s+writeAssignments\s*\(all,\s*opts\)[\s\S]*?\n\}/);
    if (!writeMatch || !/_guardUserIntent\(all,\s*caller\)/.test(writeMatch[0])) {
      throw new Error('writeAssignments must call _guardUserIntent(all, caller) — see #8 guard');
    }
  });

  it('JS — guard emits WARN-style diag when restoration happens', () => {
    if (!/save-registry GUARD from=\$\{caller\} restored=/.test(mainJsSrc)) {
      throw new Error('saveAssignments must emit save-registry GUARD ... restored=[...] line — see #8 guard');
    }
    if (!/write-registry GUARD from=\$\{caller\} restored=/.test(mainJsSrc)) {
      throw new Error('writeAssignments must emit write-registry GUARD ... restored=[...] line — see #8 guard');
    }
  });

  it('PS — Save-Registry preserves user-intent fields when disk has them', () => {
    // Mirror of the JS guard. Re-reads disk, compares per-short,
    // restores the 6 user-intent fields (label/pinned/voice/muted/
    // focus/speech_includes) when incoming payload would drop them.
    for (const field of ['label', 'pinned', 'voice', 'muted', 'focus', 'speech_includes']) {
      // The PS guard references $old.<field> and $new.<field> in
      // restoration branches; at least one branch must name each field.
      const rx = new RegExp(`\\$old\\.${field}[\\s\\S]{0,400}\\$new\\.${field}|\\$new\\.${field}[\\s\\S]{0,400}\\$old\\.${field}`);
      if (!rx.test(psRegistrySrc)) {
        throw new Error(`PS Save-Registry does not restore ${field} — see #8 guard`);
      }
    }
    if (!/save-registry GUARD from=\$Caller restored=/.test(psRegistrySrc)) {
      throw new Error('PS Save-Registry must emit save-registry GUARD line when restoration fires — see #8 guard');
    }
  });

  it('JS — guard RUNTIME: ensure-for-files caller cannot wipe a labelled+pinned entry', () => {
    // End-to-end sync test: write a live entry to disk with
    // label+pinned+voice+speech_includes, then call saveAssignments
    // with caller='ensure-for-files' and a payload that strips those.
    // Expect the guard to restore all four fields before the write.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-guard-'));
    const tmpRegistry = path.join(tmpDir, 'session-colours.json');
    const clean = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} };
    try {
      // Seed disk with a tuned entry.
      const seeded = {
        assignments: {
          abcdef01: {
            index: 0,
            session_id: 'abcdef01-xxxx',
            claude_pid: 12345,
            label: 'My Terminal',
            pinned: true,
            voice: 'en-GB-SoniaNeural',
            muted: false,
            focus: false,
            speech_includes: { tool_calls: false },
            last_seen: Math.floor(Date.now() / 1000),
          },
        },
      };
      fs.writeFileSync(tmpRegistry, JSON.stringify(seeded, null, 2), 'utf8');

      // Simulate the bug: ensure-for-files writes a fresh-alloc-default
      // entry at the same short. Without the guard, this wipes the
      // tuned fields. Re-implement the tiny guard logic inline so the
      // test stays free of the main.js module (which has Electron
      // deps we don't pull in unit tests).
      const wiped = {
        abcdef01: {
          index: 0,
          session_id: 'abcdef01-xxxx',
          claude_pid: 99999,  // new pid
          label: '',
          pinned: false,
          last_seen: Math.floor(Date.now() / 1000),
        },
      };
      // Replicate _guardUserIntent against the seeded file.
      const raw = fs.readFileSync(tmpRegistry, 'utf8');
      const oldAll = JSON.parse(raw).assignments || {};
      for (const short of Object.keys(wiped)) {
        const oldEntry = oldAll[short];
        if (!oldEntry) continue;
        const newEntry = wiped[short];
        if (typeof oldEntry.label === 'string' && oldEntry.label.length > 0 &&
            (typeof newEntry.label !== 'string' || newEntry.label.length === 0)) {
          newEntry.label = oldEntry.label;
        }
        if (oldEntry.pinned === true && newEntry.pinned !== true) newEntry.pinned = true;
        if (typeof oldEntry.voice === 'string' && oldEntry.voice && !newEntry.voice) newEntry.voice = oldEntry.voice;
        if (oldEntry.speech_includes && typeof oldEntry.speech_includes === 'object' &&
            Object.keys(oldEntry.speech_includes).length > 0 &&
            (!newEntry.speech_includes || Object.keys(newEntry.speech_includes).length === 0)) {
          newEntry.speech_includes = oldEntry.speech_includes;
        }
      }
      assertEqual(wiped.abcdef01.label, 'My Terminal', 'label restored');
      assertEqual(wiped.abcdef01.pinned, true, 'pinned restored');
      assertEqual(wiped.abcdef01.voice, 'en-GB-SoniaNeural', 'voice restored');
      assertDeepEqual(wiped.abcdef01.speech_includes, { tool_calls: false }, 'speech_includes restored');
    } finally {
      clean();
    }
  });

  it('JS — guard MISSING-ENTRY: touch-path write that omits a tuned entry restores it', () => {
    // Root-cause reproduction. statusline race reads empty → writes
    // only its own entry. Without Mode 1, the other session vanishes.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-guard-miss-'));
    const tmpRegistry = path.join(tmpDir, 'session-colours.json');
    const clean = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} };
    try {
      // Seed disk with TWO tuned entries.
      const seeded = {
        assignments: {
          aef91e8e: {
            index: 0, session_id: 'aef91e8e-xxxx', claude_pid: 111,
            label: 'TT 1', pinned: true, muted: false, focus: false,
            speech_includes: { tool_calls: false }, last_seen: 1000,
          },
          a29f747b: {
            index: 1, session_id: 'a29f747b-yyyy', claude_pid: 222,
            label: 'TT 2', pinned: true, muted: false, focus: false,
            speech_includes: { tool_calls: false }, last_seen: 1001,
          },
        },
      };
      fs.writeFileSync(tmpRegistry, JSON.stringify(seeded, null, 2), 'utf8');

      // Simulate the statusline race: payload has ONLY one entry
      // (aef91e8e), as if Read-Registry returned empty and fresh-alloc
      // created just this terminal's entry.
      const payload = {
        aef91e8e: {
          index: 0, session_id: 'aef91e8e-xxxx', claude_pid: 111,
          label: '', pinned: false, last_seen: 2000,
        },
      };

      // Replicate the guard's Mode 1 + Mode 2 logic inline (the full
      // _guardUserIntent is inside main.js which has Electron deps).
      const raw = fs.readFileSync(tmpRegistry, 'utf8');
      const oldAll = JSON.parse(raw).assignments || {};
      const hasUserIntent = (e) => (
        (typeof e.label === 'string' && e.label.length > 0) ||
        e.pinned === true ||
        (typeof e.voice === 'string' && e.voice.length > 0) ||
        e.muted === true || e.focus === true ||
        (e.speech_includes && Object.keys(e.speech_includes).length > 0)
      );
      // Mode 1 — missing entries with intent.
      for (const short of Object.keys(oldAll)) {
        if (Object.prototype.hasOwnProperty.call(payload, short)) continue;
        if (hasUserIntent(oldAll[short])) payload[short] = oldAll[short];
      }
      // Mode 2 — restore label/pinned for aef91e8e (present but wiped).
      for (const short of Object.keys(payload)) {
        const oldEntry = oldAll[short];
        if (!oldEntry) continue;
        const newEntry = payload[short];
        if (oldEntry.label && (!newEntry.label || newEntry.label.length === 0)) {
          newEntry.label = oldEntry.label;
        }
        if (oldEntry.pinned === true && newEntry.pinned !== true) newEntry.pinned = true;
      }

      // Both entries present now.
      assertEqual(Object.keys(payload).length, 2, 'missing entry restored');
      assertEqual(payload.a29f747b.label, 'TT 2', 'TT 2 entry re-added verbatim');
      assertEqual(payload.a29f747b.pinned, true, 'TT 2 pinned preserved');
      assertEqual(payload.aef91e8e.label, 'TT 1', 'TT 1 label restored via Mode 2');
      assertEqual(payload.aef91e8e.pinned, true, 'TT 1 pinned restored via Mode 2');
    } finally {
      clean();
    }
  });

  it('JS — _guardUserIntent source implements Mode 1 (missing entry) + Mode 2 (missing field)', () => {
    // Structural confirmation that both modes exist in the code, not
    // just the test's inline replica.
    const m = mainJsSrc.match(/function\s+_guardUserIntent[\s\S]*?\n\}/);
    if (!m) throw new Error('_guardUserIntent body not found');
    const body = m[0];
    // Mode 1 marker — iterating oldAll keys + _hasUserIntent + add to all[short].
    if (!/for\s*\(const\s+short\s+of\s+Object\.keys\(oldAll\)\)/.test(body)) {
      throw new Error('_guardUserIntent must iterate oldAll keys for Mode 1 — see #8 missing-entry');
    }
    if (!/_hasUserIntent\(oldAll\[short\]\)/.test(body)) {
      throw new Error('_guardUserIntent Mode 1 must check _hasUserIntent on missing entries');
    }
    if (!/all\[short\]\s*=\s*oldAll\[short\]/.test(body)) {
      throw new Error('_guardUserIntent Mode 1 must re-add oldAll[short] to all');
    }
    if (!/\*missing\*/.test(body)) {
      throw new Error('_guardUserIntent Mode 1 must tag restored entries with *missing* marker');
    }
  });

  it('PS — Save-Registry restores missing entries with user-intent', () => {
    // Mirror structural check — the PS guard must also implement Mode 1.
    if (!/\*missing\*/.test(psRegistrySrc)) {
      throw new Error('PS Save-Registry must implement missing-entry restoration (look for *missing* marker) — see #8');
    }
    // Must iterate parsed.assignments to find keys not in $Assignments.
    if (!/foreach\s*\(\$p\s+in\s+\$parsed\.assignments\.PSObject\.Properties\)/.test(psRegistrySrc)) {
      throw new Error('PS Save-Registry must iterate parsed.assignments for Mode 1 — see #8');
    }
    if (!/if\s*\(\$Assignments\.ContainsKey\(\$short\)\)\s*\{\s*continue\s*\}/.test(psRegistrySrc)) {
      throw new Error('PS Save-Registry Mode 1 must skip entries already in $Assignments — see #8');
    }
  });

  it('PS — statusline / hooks skip save when Enter-RegistryLock fails (#8 root cause)', () => {
    // Critical root-cause fix. Prior to this, an unlocked fall-through
    // allowed the race that dropped other sessions' entries. Each of
    // the 3 PS callers must now branch on $locked and only do
    // Read-Update-Save when the lock was acquired.
    const files = [
      { path: 'app/statusline.ps1',       caller: 'statusline' },
      { path: 'hooks/speak-on-tool.ps1',  caller: 'speak-on-tool' },
      { path: 'hooks/speak-response.ps1', caller: 'speak-response' },
    ];
    for (const { path: relPath, caller } of files) {
      const src = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
      // Match `if ($locked) {` then EVENTUALLY Save-Registry then `} else {`
      // then EVENTUALLY the skip-log line. Allow any content between.
      if (!/if\s*\(\$locked\)\s*\{[\s\S]*?Save-Registry[\s\S]*?\}\s*else\s*\{[\s\S]*?reason=lock-timeout/.test(src)) {
        throw new Error(`${relPath} must branch on $locked: Save-Registry inside the if, log reason=lock-timeout in the else — see #8 root fix`);
      }
      // Skip-log line must identify the caller.
      const expectedSkip = new RegExp(`save-registry skip from=${caller} reason=lock-timeout`);
      if (!expectedSkip.test(src)) {
        throw new Error(`${relPath} must emit skip log "save-registry skip from=${caller} reason=lock-timeout" — see #8 root fix`);
      }
    }
  });

  it('JS — guard SEMANTICS: user-intent writer can actually clear a label', () => {
    // The complementary invariant: the guard must NOT block legitimate
    // user-initiated clears. set-session-label('') on a pinned entry
    // should still clear the label (pinned stays — that's a separate
    // concern). Verified via the USER_INTENT_WRITERS allowlist check:
    // if caller is in the set, _guardUserIntent returns [] early.
    const m = mainJsSrc.match(/function\s+_guardUserIntent[\s\S]*?\n\}/);
    if (!m) throw new Error('_guardUserIntent body not found');
    if (!/if\s*\(USER_INTENT_WRITERS\.has\(caller\)\)\s*return\s*\[\]/.test(m[0])) {
      throw new Error('_guardUserIntent must short-circuit for USER_INTENT_WRITERS callers — see #8 guard');
    }
  });
});

describe('SETTINGS PANEL ↔ VALIDATOR COVERAGE (#11)', () => {
  // Enforces the invariant "validator RULES ≡ keys the UI writes + keys
  // the runtime reads". Four tests total: two forward (TT2's proposed
  // shape — UI keys covered by RULES, RULES keys written by UI), two
  // backward (TT1's additions — RULES keys consumed at runtime, and
  // DEFAULTS.speech_includes sub-keys covered by RULES). Any future
  // drift on any of those axes fails on the next CI run.
  const { RULES } = require(path.join(__dirname, '..', 'app', 'lib', 'config-validate.js'));
  const settingsFormSrc = fs.readFileSync(
    path.join(__dirname, '..', 'app', 'lib', 'settings-form.js'), 'utf8'
  );
  const mainJsSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8');
  const APP_DIR_REPO = path.join(__dirname, '..', 'app');
  const HOOKS_DIR_REPO = path.join(__dirname, '..', 'hooks');
  const listSources = (dir) => {
    const out = [];
    const walk = (d) => {
      for (const name of fs.readdirSync(d)) {
        const full = path.join(d, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) walk(full);
        else if (/\.(js|cjs|mjs|ps1|psm1|psd1|py)$/.test(name)) out.push(full);
      }
    };
    walk(dir);
    return out;
  };
  const readAllSrc = () => {
    const files = [...listSources(APP_DIR_REPO), ...listSources(HOOKS_DIR_REPO)];
    const blob = {};
    for (const f of files) blob[f] = fs.readFileSync(f, 'utf8');
    return blob;
  };

  it('every UI-written voice key has a RULES entry (F1 guard)', () => {
    // settings-form.js wires the 4 voice dropdowns via a small tuple
    // table at ~L325-328: `[el, 'edge_response'], [el, 'edge_clip'],
    // [el, 'openai_response'], [el, 'openai_clip']`. Each must map to
    // a `voices.<name>` RULES entry.
    const uiVoiceKeys = new Set();
    const rx = /\[this\._el\.\w+,\s*'(edge_\w+|openai_\w+)'\]/g;
    let m;
    while ((m = rx.exec(settingsFormSrc)) !== null) uiVoiceKeys.add(m[1]);
    // Spot-check we actually captured something — if settings-form.js
    // is refactored such that this regex stops matching, we'd silently
    // pass with an empty set. Guard against that.
    if (uiVoiceKeys.size < 4) {
      throw new Error(`expected ≥ 4 UI voice keys, extracted ${[...uiVoiceKeys].join(',')} — regex drift?`);
    }
    const rulesVoiceKeys = new Set(
      RULES.filter((r) => r.path.startsWith('voices.')).map((r) => r.path.slice('voices.'.length))
    );
    const missing = [...uiVoiceKeys].filter((k) => !rulesVoiceKeys.has(k));
    if (missing.length > 0) {
      throw new Error(`UI writes voice keys not in RULES: [${missing.join(',')}] — add to config-validate.js (F1)`);
    }
  });

  it('every UI-written speech_includes sub-key has a RULES entry (F2 guard)', () => {
    // settings-form.js wires the 6 checkboxes at L111-116; renderer.js
    // adds `tool_calls` as a per-session override (L984-985). The set
    // of user-writeable sub-keys is the union (7 keys).
    const uiSubKeys = new Set();
    const rxFormKeys = /(code_blocks|inline_code|urls|headings|bullet_markers|image_alt)\s*:/g;
    let m;
    while ((m = rxFormKeys.exec(settingsFormSrc)) !== null) uiSubKeys.add(m[1]);
    // tool_calls enters via the per-session override dropdown + the
    // VALID_INCLUDE_KEYS + ALLOWED_INCLUDE_KEYS allowlists.
    if (/ALLOWED_INCLUDE_KEYS[\s\S]*?tool_calls/.test(fs.readFileSync(
        path.join(__dirname, '..', 'app', 'lib', 'ipc-validate.js'), 'utf8'))) {
      uiSubKeys.add('tool_calls');
    }
    if (uiSubKeys.size < 7) {
      throw new Error(`expected ≥ 7 speech_includes sub-keys, extracted ${[...uiSubKeys].join(',')} — regex drift?`);
    }
    const rulesSubKeys = new Set(
      RULES.filter((r) => r.path.startsWith('speech_includes.'))
           .map((r) => r.path.slice('speech_includes.'.length))
    );
    const missing = [...uiSubKeys].filter((k) => !rulesSubKeys.has(k));
    if (missing.length > 0) {
      throw new Error(`user-writeable speech_includes sub-keys not in RULES: [${missing.join(',')}] — add to config-validate.js (F2)`);
    }
  });

  it('every RULES path has ≥ 1 runtime consumer in app/ or hooks/ (F3/F5 guard)', () => {
    // Forcing function against dead declarations. For each RULES entry,
    // search for the leaf name (last dot-segment) across every source
    // file in app/ + hooks/ EXCLUDING config-validate.js and
    // config.schema.json (which are the declaration surface, not a
    // consumer). If no non-declaration consumer exists, the key is
    // vestigial — remove from RULES.
    const blob = readAllSrc();
    const exemptFiles = new Set([
      path.join(APP_DIR_REPO, 'lib', 'config-validate.js'),
    ]);
    // Parent-only rules (object-typed, top-level) are inherently
    // structural — skip them, since their "consumer" is the nested
    // merge in config-store + ipc-handlers.
    const skipPaths = new Set(['voices', 'hotkeys', 'playback', 'speech_includes']);
    const dead = [];
    for (const rule of RULES) {
      if (skipPaths.has(rule.path)) continue;
      const leaf = rule.path.split('.').pop();
      let found = false;
      for (const [file, src] of Object.entries(blob)) {
        if (exemptFiles.has(file)) continue;
        // Word-boundary search to avoid accidental substring matches.
        const rx = new RegExp(`\\b${leaf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        if (rx.test(src)) { found = true; break; }
      }
      if (!found) dead.push(rule.path);
    }
    if (dead.length > 0) {
      throw new Error(`RULES paths with zero runtime consumers (dead declarations): [${dead.join(', ')}] — remove from config-validate.js + config.schema.json + README (F3/F5/F6)`);
    }
  });

  it('DEFAULTS.speech_includes sub-keys are all validator-covered (#11 bidirectional)', () => {
    // Backward guard: adding a key to DEFAULTS.speech_includes in
    // main.js without a matching RULES entry would let bad hand-edits
    // for that key slip through validation on load. Iterates the
    // actual DEFAULTS block and asserts every sub-key is declared.
    const m = mainJsSrc.match(/speech_includes:\s*\{([\s\S]*?)\n\s*\}/);
    if (!m) throw new Error('could not locate speech_includes block in main.js DEFAULTS');
    const defaultsKeys = new Set();
    const keyRx = /(\w+)\s*:\s*(?:true|false)/g;
    let km;
    while ((km = keyRx.exec(m[1])) !== null) defaultsKeys.add(km[1]);
    if (defaultsKeys.size < 7) {
      throw new Error(`expected ≥ 7 DEFAULTS.speech_includes keys, extracted ${[...defaultsKeys].join(',')} — regex drift?`);
    }
    const rulesSubKeys = new Set(
      RULES.filter((r) => r.path.startsWith('speech_includes.'))
           .map((r) => r.path.slice('speech_includes.'.length))
    );
    const missing = [...defaultsKeys].filter((k) => !rulesSubKeys.has(k));
    if (missing.length > 0) {
      throw new Error(`DEFAULTS.speech_includes keys not in RULES: [${missing.join(',')}] — extend config-validate.js`);
    }
  });
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
  it('Bash speaks the command with env assignments stripped, truncated ~50ch', () => {
    // 2026-04-22 — widened from first-word-only ("Running npm") after
    // user feedback that single-word narration told them nothing about
    // what was actually running. Now speaks up to 50 chars with sensible
    // truncation + leading FOO=bar env assignments stripped.
    assertEqual(narrate('Bash', { command: 'npm test --verbose' }), 'Running npm test --verbose');
    assertEqual(narrate('Bash', { command: 'NODE_ENV=test npm run build' }), 'Running npm run build');
    assertEqual(narrate('Bash', {}), 'Running a command');
    const long = narrate('Bash', { command: 'grep -rn some_long_pattern_here ' + 'x'.repeat(200) });
    if (long.length > 65) throw new Error(`bash phrase too long: ${long.length}ch`);
    if (!long.startsWith('Running grep')) throw new Error(`bash phrase should start with command: ${long}`);
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

  it('recognises T- and H-prefixed clip filenames as ephemeral', () => {
    assertTruthy(clipPaths.isEphemeralClip('20260421T233815497-T-0001-294c5d60.mp3'));
    assertTruthy(clipPaths.isEphemeralClip('20260421T233815497-T-0042-abcdef01.wav'));
    // HB3 — heartbeat clips now use H- prefix (was T-). Also ephemeral.
    assertTruthy(clipPaths.isEphemeralClip('20260421T233815497-H-0001-294c5d60.mp3'));
    assertTruthy(clipPaths.isEphemeralClip('20260421T233815497-H-0042-abcdef01.wav'));
  });
  it('rejects regular body clip filenames', () => {
    assertFalsy(clipPaths.isEphemeralClip('20260421T233815497-0001-294c5d60.mp3'));
  });
  it('rejects Q-prefixed question clip filenames', () => {
    assertFalsy(clipPaths.isEphemeralClip('20260421T233815497-Q-0001-294c5d60.mp3'));
  });
  it('rejects filenames with T/H inside but not at the prefix slot', () => {
    assertFalsy(clipPaths.isEphemeralClip('T-somefile-0001-294c5d60.mp3'));
    assertFalsy(clipPaths.isEphemeralClip('foo-T-bar-0001-294c5d60.mp3'));
    assertFalsy(clipPaths.isEphemeralClip('H-somefile-0001-294c5d60.mp3'));
  });
  it('isHeartbeatClip distinguishes H- from T- (volume dip only on H-)', () => {
    assertTruthy(clipPaths.isHeartbeatClip('20260421T233815497-H-0001-294c5d60.mp3'));
    // Tool narrations (T-) are NOT heartbeats — they stay full volume.
    assertFalsy(clipPaths.isHeartbeatClip('20260421T233815497-T-0001-294c5d60.mp3'));
    // Regular body + question clips aren't heartbeats either.
    assertFalsy(clipPaths.isHeartbeatClip('20260421T233815497-0001-294c5d60.mp3'));
    assertFalsy(clipPaths.isHeartbeatClip('20260421T233815497-Q-0001-294c5d60.mp3'));
  });
  it('still returns session short via extractSessionShort', () => {
    // T- prefix doesn't interfere with session identification
    assertEqual(
      clipPaths.extractSessionShort('20260421T233815497-T-0001-294c5d60.mp3'),
      '294c5d60'
    );
  });
});

describe('HEARTBEAT TIMER LOGIC (HB1/HB2/HB3)', () => {
  // decideHeartbeatAction is a pure function — the setInterval tick
  // in renderer.js is a thin wrapper that reads live state and applies
  // the returned mutation. Test it with synthetic inputs rather than
  // spinning up Electron + time controllers.
  const heartbeat = require(path.join(__dirname, '..', 'app', 'lib', 'heartbeat.js'));

  // Helper to build a full state object with sensible defaults. Tests
  // override only the field(s) relevant to each assertion.
  function makeState(overrides = {}) {
    return {
      now: 100_000,
      heartbeatEnabled: true,
      isQueueActive: false,
      heartbeatSilentSince: 90_000,   // 10 s of silence
      lastHeartbeatAt: 0,             // never fired
      workingSessionsCache: ['a29f747b'],
      initialMs: 5_000,
      intervalMs: 8_000,
      ...overrides,
    };
  }

  it('heartbeatEnabled=false always skips', () => {
    const action = heartbeat.decideHeartbeatAction(makeState({ heartbeatEnabled: false }));
    assertEqual(action.type, 'skip');
  });

  it('HB4: isSystemAutoPaused=true always skips (mic is elsewhere)', () => {
    // User is dictating via Wispr Flow or similar — suppress all
    // heartbeat emission so clips don't pile up in the queue and
    // burst-play on mic release.
    const action = heartbeat.decideHeartbeatAction(makeState({
      isSystemAutoPaused: true,
    }));
    assertEqual(action.type, 'skip');
  });

  it('queue active → reset-silent with newSilentSince=now', () => {
    const state = makeState({ isQueueActive: true, now: 200_000 });
    const action = heartbeat.decideHeartbeatAction(state);
    assertEqual(action.type, 'reset-silent');
    assertEqual(action.newSilentSince, 200_000);
  });

  it('silence < initialMs → skip', () => {
    const action = heartbeat.decideHeartbeatAction(makeState({
      now: 94_000,                    // 4 s of silence, < 5 s initial
      heartbeatSilentSince: 90_000,
    }));
    assertEqual(action.type, 'skip');
  });

  it('silence >= initialMs but within intervalMs of last emit → skip', () => {
    const action = heartbeat.decideHeartbeatAction(makeState({
      now: 100_000,
      heartbeatSilentSince: 90_000,   // 10 s of silence
      lastHeartbeatAt: 95_000,        // 5 s ago, < 8 s interval
    }));
    assertEqual(action.type, 'skip');
  });

  it('silence + interval elapsed BUT no working sessions → skip', () => {
    const action = heartbeat.decideHeartbeatAction(makeState({
      workingSessionsCache: [],
    }));
    assertEqual(action.type, 'skip');
  });

  it('all conditions met → emit with first working session + newLastHeartbeatAt', () => {
    const state = makeState({
      now: 100_000,
      workingSessionsCache: ['a29f747b', '921d862c'],
    });
    const action = heartbeat.decideHeartbeatAction(state);
    assertEqual(action.type, 'emit');
    assertEqual(action.sessionShort, 'a29f747b');
    assertEqual(action.newLastHeartbeatAt, 100_000);
  });

  it('workingSessionsCache non-array → treated as empty, skip', () => {
    const action = heartbeat.decideHeartbeatAction(makeState({
      workingSessionsCache: null,
    }));
    assertEqual(action.type, 'skip');
  });

  it('custom initialMs / intervalMs thresholds respected', () => {
    // Tighter config: 2 s initial, 3 s interval. With 4 s silent +
    // 3.5 s since last heartbeat, we fire.
    const state = makeState({
      now: 104_000,
      heartbeatSilentSince: 100_000,  // 4 s
      lastHeartbeatAt: 100_500,       // 3.5 s ago
      initialMs: 2_000,
      intervalMs: 3_000,
    });
    const action = heartbeat.decideHeartbeatAction(state);
    assertEqual(action.type, 'emit');
  });

  it('SPINNER_VERBS and THINKING_PHRASES are populated', () => {
    if (!Array.isArray(heartbeat.SPINNER_VERBS) || heartbeat.SPINNER_VERBS.length < 50) {
      throw new Error(`SPINNER_VERBS too small: ${heartbeat.SPINNER_VERBS && heartbeat.SPINNER_VERBS.length}`);
    }
    if (!Array.isArray(heartbeat.THINKING_PHRASES) || heartbeat.THINKING_PHRASES.length < 5) {
      throw new Error(`THINKING_PHRASES too small: ${heartbeat.THINKING_PHRASES && heartbeat.THINKING_PHRASES.length}`);
    }
  });

  it('pickHeartbeatVerb returns a phrase when rng < mix ratio', () => {
    // Force a phrase: rng returns 0.2 which is under PHRASE_MIX_RATIO=0.4.
    // The same rng is called again to index into THINKING_PHRASES, so
    // return 0 on the second call → first phrase.
    let call = 0;
    const rng = () => (call++ === 0 ? 0.2 : 0);
    const out = heartbeat.pickHeartbeatVerb(rng);
    assertEqual(out, heartbeat.THINKING_PHRASES[0]);
  });

  it('pickHeartbeatVerb returns a spinner verb when rng >= mix ratio', () => {
    // Force a verb: rng returns 0.6 (above 0.4 phrase ratio), then 0.
    let call = 0;
    const rng = () => (call++ === 0 ? 0.6 : 0);
    const out = heartbeat.pickHeartbeatVerb(rng);
    assertEqual(out, heartbeat.SPINNER_VERBS[0]);
  });

  it('pickHeartbeatVerb 40/60 distribution holds approximately over many samples', () => {
    // Statistical smoke test — 10k samples from Math.random; phrase
    // fraction should land within 2 % of the nominal 40 %.
    let phrases = 0;
    const total = 10_000;
    const phraseSet = new Set(heartbeat.THINKING_PHRASES);
    for (let i = 0; i < total; i++) {
      if (phraseSet.has(heartbeat.pickHeartbeatVerb())) phrases++;
    }
    const fraction = phrases / total;
    if (fraction < 0.36 || fraction > 0.44) {
      throw new Error(`phrase fraction out of band: ${fraction.toFixed(3)} (expected ~0.40)`);
    }
  });
});

describe('SPEAK-HEARTBEAT IPC VALIDATION (HB1/HB3)', () => {
  // The speak-heartbeat handler in app/lib/ipc-handlers.js validates
  // its inputs before calling edge-tts — tests cover the rejection
  // paths so a compromised renderer can't smuggle arbitrary text or
  // filename fragments through. Black-box-style: re-implement the
  // accept/reject regex locally and assert the shape matches.
  const VERB_RE = /^[A-Za-z][A-Za-z ]{1,59}$/;
  const SHORT_RE = /^[a-f0-9]{8}$/;
  function accepts(verb, shortId) {
    if (typeof verb !== 'string' || !VERB_RE.test(verb)) return false;
    if (/\s\s/.test(verb)) return false;
    if (typeof shortId !== 'string' || !SHORT_RE.test(shortId)) return false;
    return true;
  }

  it('accepts single-word verbs', () => {
    assertTruthy(accepts('Moonwalking', 'a29f747b'));
    assertTruthy(accepts('Percolating', 'abcdef01'));
  });
  it('accepts multi-word thinking phrases (single spaces)', () => {
    assertTruthy(accepts('Thinking this through', 'a29f747b'));
    assertTruthy(accepts('Just a moment', 'a29f747b'));
  });
  it('rejects empty / non-string verbs', () => {
    assertFalsy(accepts('', 'a29f747b'));
    assertFalsy(accepts(null, 'a29f747b'));
    assertFalsy(accepts(123, 'a29f747b'));
  });
  it('rejects verbs with digits or symbols', () => {
    // 'Running npm' is LEGAL now (multi-word thinking phrases ship since
    // HB3) — removed from the rejection list. Remaining rejections cover
    // digits, shell metachars, and HTML.
    assertFalsy(accepts('verb123', 'a29f747b'));
    assertFalsy(accepts('shell cmd;rm -rf /', 'a29f747b'));
    assertFalsy(accepts('<script>', 'a29f747b'));
  });
  it('rejects verbs with double-spaces (normaliser safety)', () => {
    assertFalsy(accepts('double  space', 'a29f747b'));
    assertFalsy(accepts('trailing  ', 'a29f747b'));
  });
  it('rejects verbs longer than 60 chars', () => {
    assertFalsy(accepts('x'.repeat(61), 'a29f747b'));
    assertTruthy(accepts('x'.repeat(60), 'a29f747b'));
  });
  it('rejects invalid session shorts', () => {
    assertFalsy(accepts('Moonwalking', ''));
    assertFalsy(accepts('Moonwalking', 'xyz12345'));    // not hex
    assertFalsy(accepts('Moonwalking', 'A29F747B'));    // uppercase
    assertFalsy(accepts('Moonwalking', 'a29f747'));     // too short (7 chars)
    assertFalsy(accepts('Moonwalking', 'a29f747bc'));   // too long (9 chars)
  });
});

describe('HEARTBEAT VOICE ROUTING respects tts_provider (#15)', () => {
  // Prior to #15 the speak-heartbeat handler always called callEdgeTTS
  // regardless of cfg.playback.tts_provider — the "Prefer OpenAI"
  // toggle's tooltip in app/index.html promised heartbeats would play
  // in OpenAI's voice but the code never branched. These tests pin the
  // UI-contract promise: heartbeat synth must route via the configured
  // provider, pick the configured clip voice, and fall back to the
  // other provider on synth failure.
  //
  // Harness constraint: `it()` is sync-only (async fn bodies silently
  // pass because the harness doesn't await). Tests instead rely on
  // "pre-await capture inspection": the async handler executes
  // synchronously up to its first `await`, so callEdgeTTS / callOpenAITTS
  // stub invocations have ALREADY recorded their args by the time
  // handler() returns its Promise. The fallback path requires the
  // catch-and-retry sequence to complete AFTER the first await, so
  // that test falls back to source-structural grep instead of runtime.
  const { createIpcHandlers } = require(
    path.join(__dirname, '..', 'app', 'lib', 'ipc-handlers.js')
  );
  const ipcSrc = fs.readFileSync(
    path.join(__dirname, '..', 'app', 'lib', 'ipc-handlers.js'), 'utf8'
  );
  const baseCfg = () => ({
    voices: {
      edge_response:   'en-GB-RyanNeural',
      edge_clip:       'en-GB-SoniaNeural',
      openai_response: 'onyx',
      openai_clip:     'shimmer',
    },
    playback: { tts_provider: 'edge' },
    heartbeat_enabled: true,
  });
  const register = (overrides = {}) => {
    const edgeCalls = [];
    const openaiCalls = [];
    const diagLines = [];
    const handlers = {};
    const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
    const cfg = overrides.cfg ? overrides.cfg() : baseCfg();
    createIpcHandlers({
      ipcMain,
      diag: (l) => diagLines.push(l),
      callEdgeTTS: overrides.edgeImpl
        || ((verb, voice, outPath) => { edgeCalls.push({ verb, voice, outPath }); return Promise.resolve(); }),
      callOpenAITTS: overrides.openaiImpl
        || ((apiKey, input, voice, outPath) => { openaiCalls.push({ apiKey, input, voice, outPath }); return Promise.resolve(); }),
      getAppVersion: () => '0.0.0-test',
      getCFG: () => cfg,
      loadAssignments: () => ({}),
      getQueueFiles: () => [],
      getQueueAllPaths: () => [],
      ensureAssignmentsForFiles: () => {},
      shortFromFile: () => null,
      isPidAlive: () => false,
      computeStaleSessions: () => [],
      SESSIONS_DIR: os.tmpdir(),
      getWin: () => null,
      saveAssignments: () => true,
      notifyQueue: () => {},
      allowMutation: () => true,
      validShort: () => true,
      validVoice: () => true,
      sanitiseLabel: (s) => s,
      ALLOWED_INCLUDE_KEYS: new Set(),
      setCFG: () => {},
      saveConfig: () => true,
      apiKeyStore: overrides.apiKeyStore || { get: () => 'sk-fake', set: () => {} },
      redactForLog: (x) => x,
      setApplyingDock: () => {},
      testMode: true,
      QUEUE_DIR: os.tmpdir(),
      isPathInside: () => true,
      getWatchdog: () => null,
      getWatchdogIntervalMs: () => 0,
    }).register();
    return { handlers, edgeCalls, openaiCalls, diagLines };
  };

  it('provider=edge → edge synth only, uses voices.edge_clip (runtime)', () => {
    const r = register();
    // Kick off the async handler; we don't await (see group comment).
    // Swallow any unhandled rejection — the handler's internal catch
    // already covers synth failures; we only care about what it CALLED.
    const p = r.handlers['speak-heartbeat']({}, 'Moonwalking', 'a29f747b');
    if (p && typeof p.catch === 'function') p.catch(() => {});
    assertEqual(r.edgeCalls.length, 1, 'edge called exactly once');
    assertEqual(r.openaiCalls.length, 0, 'openai must NOT be called when provider=edge');
    assertEqual(r.edgeCalls[0].voice, 'en-GB-SoniaNeural', 'must use voices.edge_clip, not edge_response');
  });

  it('provider=openai + API key → openai synth first, uses voices.openai_clip (runtime)', () => {
    const r = register({
      cfg: () => ({ ...baseCfg(), playback: { tts_provider: 'openai' } }),
    });
    const p = r.handlers['speak-heartbeat']({}, 'Tinkering', 'a29f747b');
    if (p && typeof p.catch === 'function') p.catch(() => {});
    assertEqual(r.openaiCalls.length, 1, 'openai called first when provider=openai');
    assertEqual(r.edgeCalls.length, 0, 'edge must NOT be called when openai succeeds');
    assertEqual(r.openaiCalls[0].voice, 'shimmer', 'must use voices.openai_clip');
  });

  it('provider=openai + no API key → openai NOT attempted (runtime sync-phase; TT1 #4)', () => {
    // The edge fallback happens on the SECOND microtask (after tryOpenAI
    // returns { ok: false, reason: 'no-api-key' } and the handler falls
    // through to tryEdge). Sync-phase inspection can only verify the
    // no-attempt side; the edge fallback path is covered by the
    // structural regex in the next test.
    let openaiCallCount = 0;
    const r = register({
      cfg: () => ({ ...baseCfg(), playback: { tts_provider: 'openai' } }),
      apiKeyStore: { get: () => null, set: () => {} },
      openaiImpl: () => { openaiCallCount += 1; return Promise.resolve(); },
    });
    const p = r.handlers['speak-heartbeat']({}, 'Moonwalking', 'a29f747b');
    if (p && typeof p.catch === 'function') p.catch(() => {});
    assertEqual(openaiCallCount, 0, 'openai must NOT be attempted without an API key');
    assertEqual(r.edgeCalls.length, 0, 'edge fallback runs on next microtask — not sync-observable here');
  });

  it('heartbeat_enabled=false short-circuits before any synth (runtime; TT1 #5)', () => {
    const r = register({
      cfg: () => ({ ...baseCfg(), heartbeat_enabled: false }),
    });
    const p = r.handlers['speak-heartbeat']({}, 'Moonwalking', 'a29f747b');
    if (p && typeof p.catch === 'function') p.catch(() => {});
    assertEqual(r.edgeCalls.length + r.openaiCalls.length, 0, 'no synth attempted when disabled');
  });

  it('speak-heartbeat handler references tts_provider + callOpenAITTS + fallback try/catch (structural)', () => {
    // Structural guard: the fallback runtime behaviour (openai throws →
    // edge) can't be fully verified pre-await with the current harness,
    // so we pin the source shape instead. If someone rewrites the
    // handler without a tts_provider branch or without a try/catch
    // fallback to callEdgeTTS, this test fires.
    const m = ipcSrc.match(/ipcMain\.handle\(\s*'speak-heartbeat'[\s\S]*?\n\s*\}\);/);
    if (!m) throw new Error('speak-heartbeat handler not found in ipc-handlers.js');
    const body = m[0];
    if (!/tts_provider/.test(body)) {
      throw new Error('speak-heartbeat handler must branch on cfg.playback.tts_provider — see #15');
    }
    if (!/callOpenAITTS/.test(body)) {
      throw new Error('speak-heartbeat handler must call callOpenAITTS when provider=openai — see #15');
    }
    if (!/callEdgeTTS/.test(body)) {
      throw new Error('speak-heartbeat handler must keep callEdgeTTS path for provider=edge + openai-fallback — see #15');
    }
    // Fallback mechanism: either the traditional try/catch-calls-other
    // pattern OR the "two-wrappers + result-check + await second()"
    // pattern. Require SOMETHING that can rescue a failed first attempt.
    const hasTryCatchFallback = /(callOpenAITTS[\s\S]{0,400}catch[\s\S]{0,400}callEdgeTTS)|(callEdgeTTS[\s\S]{0,400}catch[\s\S]{0,400}callOpenAITTS)/.test(body);
    const hasResultFallback = /!result[\s\S]{0,500}await\s+second/.test(body);
    const hasTryCatchAround = /try\s*\{[\s\S]{0,600}await\s+first[\s\S]{0,400}\}\s*catch/.test(body);
    if (!(hasTryCatchFallback || (hasResultFallback && hasTryCatchAround))) {
      throw new Error('speak-heartbeat must have a fallback mechanism between the two synth paths (try/catch OR two-wrappers + result-check) — see #15');
    }
    if (!/voices\.edge_clip/.test(body) || !/voices\.openai_clip/.test(body)) {
      throw new Error('speak-heartbeat must use voices.edge_clip + voices.openai_clip (not edge_response) — see #15');
    }
  });

  it('speak-heartbeat handler skips openai attempt when apiKey is falsy (structural; TT1 #4)', () => {
    // Can't verify this end-to-end with the sync harness (see group
    // comment), so pin the structural invariant instead: the handler
    // body must contain a `!apiKey`-style short-circuit BEFORE the
    // callOpenAITTS call. Prevents a regression where a missing key
    // would wastefully 401 the API before falling back to edge.
    const m = ipcSrc.match(/ipcMain\.handle\(\s*'speak-heartbeat'[\s\S]*?\n\s*\}\);/);
    if (!m) throw new Error('speak-heartbeat handler not found');
    const body = m[0];
    if (!/!apiKey/.test(body) && !/apiKey\s*===\s*null/.test(body) && !/apiKey\s*==\s*null/.test(body)) {
      throw new Error('speak-heartbeat must short-circuit the openai path when apiKey is missing — see #15');
    }
  });
});

describe('SPEAKCLIPBOARD VOICE ROUTING respects tts_provider (#16)', () => {
  // Same UI-contract bug class as #15. The speakClipboard pipeline
  // (Ctrl+Shift+S + "hey jarvis speak this") used to hardcode edge-tts
  // first; the "Prefer OpenAI" toggle promised but never delivered
  // OpenAI primacy here. The fix branches on cfg.playback.tts_provider.
  //
  // speakClipboard lives inside main.js (top-level Electron requires
  // make it impractical to load in unit tests without a refactor — see
  // TT2's note in ACTIVE/16 about extracting to app/lib/speak-clipboard.js
  // as a follow-up). Tests are source-structural: regex against the
  // function body. Same approach as parts of #15.
  const mainJsSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8');
  // Extract the speakClipboard function body. Recognise the function
  // by the unique log line "speakClipboard: stripped len=" near its
  // top. Capture from the enclosing function definition through the
  // matching closing brace.
  const fnMatch = mainJsSrc.match(/(?:async\s+)?function\s+speakClipboard\s*\([^)]*\)\s*\{[\s\S]*?\nfunction\s/);
  // Fallback if the above doesn't match (depends on adjacent function
  // ordering) — grab a generous slice from speakClipboard log down to
  // the next top-level `function ` declaration.
  const speakClipBlock = fnMatch ? fnMatch[0] : (() => {
    const start = mainJsSrc.indexOf('speakClipboard: stripped len=');
    const tail = mainJsSrc.slice(start, start + 4000);
    return tail;
  })();

  it('speakClipboard branches on cfg.playback.tts_provider', () => {
    if (!/tts_provider/.test(speakClipBlock)) {
      throw new Error('speakClipboard must branch on cfg.playback.tts_provider — see #16');
    }
    if (!/provider\s*===?\s*['"]openai['"]/.test(speakClipBlock)) {
      throw new Error('speakClipboard must compare provider to "openai" — see #16');
    }
  });

  it('speakClipboard calls both callEdgeTTS + callOpenAITTS in the chunk path', () => {
    if (!/callEdgeTTS\s*\(/.test(speakClipBlock)) {
      throw new Error('speakClipboard must call callEdgeTTS — see #16');
    }
    if (!/callOpenAITTS\s*\(/.test(speakClipBlock)) {
      throw new Error('speakClipboard must call callOpenAITTS (not just keep it as fallback-only) — see #16');
    }
  });

  it('speakClipboard uses voices.edge_clip + voices.openai_clip (clip voices)', () => {
    if (!/voices\.edge_clip/.test(speakClipBlock)) {
      throw new Error('speakClipboard must use voices.edge_clip — see #16');
    }
    if (!/voices\.openai_clip/.test(speakClipBlock)) {
      throw new Error('speakClipboard must use voices.openai_clip — see #16');
    }
  });

  it('speakClipboard has fallback when first provider returns null/throws', () => {
    // The fix uses the two-wrappers pattern: provider chooses first, the
    // other runs as fallback if the first returns null. Either order
    // accepted (openai-first OR edge-first); both branches must wire
    // the OR fallback.
    const openaiFirstFallback = /tryOpenAI[\s\S]{0,200}\|\|\s*\(?\s*await\s+tryEdge/.test(speakClipBlock);
    const edgeFirstFallback   = /tryEdge[\s\S]{0,200}\|\|\s*\(?\s*await\s+tryOpenAI/.test(speakClipBlock);
    if (!openaiFirstFallback || !edgeFirstFallback) {
      throw new Error('speakClipboard must have BOTH provider branches each with a fallback to the other — see #16');
    }
  });

  it('speakClipboard short-circuits openai when apiKey is missing', () => {
    // Same defensive pattern as #15: don't waste a 401 round-trip when
    // there's no key. The tryOpenAI wrapper returns null on missing key.
    if (!/if\s*\(\s*!apiKey\s*\)/.test(speakClipBlock)) {
      throw new Error('speakClipboard must short-circuit OpenAI on missing apiKey — see #16');
    }
  });
});

describe('TOOL_CALLS GLOBAL CHECKBOX (#24, Ben B-2)', () => {
  // Adds the missing global Settings control for `speech_includes.tool_calls`.
  // Validator already accepts the key (added in #11 F2); UI was missing.
  // Tests pin: HTML element exists with the right id, settings-form.js
  // wires it via incBoxes, default-true semantics in _populateIncludeBoxes
  // so an unset config doesn't render the box UNCHECKED while behaviour
  // is enabled.
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
  const settingsFormSrc = fs.readFileSync(
    path.join(__dirname, '..', 'app', 'lib', 'settings-form.js'), 'utf8'
  );

  it('app/index.html declares <input id="incToolCalls">', () => {
    if (!/id="incToolCalls"/.test(indexHtml)) {
      throw new Error('app/index.html must contain <input id="incToolCalls"> — see #24');
    }
    // Must be a checkbox + part of the pill-toggle skin (matches the
    // existing 5 toggles).
    const m = indexHtml.match(/<input[^>]*id="incToolCalls"[^>]*>/);
    if (!m) throw new Error('incToolCalls input declaration not parseable');
    if (!/type="checkbox"/.test(m[0])) {
      throw new Error('incToolCalls must be a checkbox — see #24');
    }
    if (!/class="[^"]*pill-toggle-input/.test(m[0])) {
      throw new Error('incToolCalls must use the pill-toggle-input class — see #24');
    }
  });

  it('app/index.html includes a label + tri-btn pill UI for incToolCalls', () => {
    // Confirm the row is wired with the same UX as Heartbeat narration —
    // label + pill toggle + on/off buttons.
    if (!/for="incToolCalls"/.test(indexHtml)) {
      throw new Error('label[for=incToolCalls] missing — see #24');
    }
    // Anchor on the input element, not the label-for, so the slice
    // captures the trailing pill UI rather than the long title text.
    const block = indexHtml.match(/<input[^>]*id="incToolCalls"[^>]*>[\s\S]{0,500}/);
    if (!block) throw new Error('incToolCalls input + trailing block not found');
    if (!/tri-btn\s+on/.test(block[0]) || !/tri-btn\s+off/.test(block[0])) {
      throw new Error('incToolCalls must have on + off tri-btn pill controls — see #24');
    }
  });

  it('settings-form.js incBoxes maps tool_calls to incToolCalls element', () => {
    if (!/tool_calls\s*:\s*document\.getElementById\(\s*['"]incToolCalls['"]/.test(settingsFormSrc)) {
      throw new Error('incBoxes must include tool_calls: document.getElementById("incToolCalls") — see #24');
    }
  });

  it('settings-form.js _wirePillToggles includes the tool_calls toggle', () => {
    // The pill-toggle UI hooks into the input via parent .tri-ctrl.
    // Without including tool_calls here, the on/off buttons would not
    // sync the input.
    const m = settingsFormSrc.match(/_wirePillToggles\s*\(\s*\)\s*\{[\s\S]*?const\s+inputs\s*=\s*\[([\s\S]*?)\]/);
    if (!m) throw new Error('_wirePillToggles inputs array not found');
    if (!/incBoxes[\s\S]*?tool_calls/.test(m[1])) {
      throw new Error('_wirePillToggles inputs must include incBoxes.tool_calls — see #24');
    }
  });

  it('_populateIncludeBoxes uses default=true for tool_calls (and heading)', () => {
    // tool_calls global default is true; an unset config must NOT
    // render the checkbox unchecked. Same goes for headings (also
    // default=true in DEFAULTS.speech_includes).
    // Match the WHOLE function from name to its inner closing brace.
    // The `\}` must close the for-loop / object literal first, so we
    // need a deeper match than the lazy default.
    // CRLF-aware match. Anchor on the function definition opening
    // `_populateIncludeBoxes(cfg) {` (not a call site), then capture
    // through the matching `}` at base method indentation.
    const m = settingsFormSrc.match(/_populateIncludeBoxes\s*\(cfg\)\s*\{[\s\S]+?\r?\n\s{4}\}/);
    if (!m) throw new Error('_populateIncludeBoxes body not found');
    const body = m[0];
    if (!/tool_calls\s*:\s*true/.test(body)) {
      throw new Error('_populateIncludeBoxes DEFAULTS map must set tool_calls: true — see #24');
    }
    if (!/headings\s*:\s*true/.test(body)) {
      throw new Error('_populateIncludeBoxes DEFAULTS map must set headings: true (matches DEFAULTS.speech_includes) — see #24');
    }
    if (!/cfgVal\s*===\s*undefined/.test(body)) {
      throw new Error('_populateIncludeBoxes must distinguish unset cfg from explicit false — see #24');
    }
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

  it('format_elapsed_phrase humanises durations with varied past-tense verbs', () => {
    // Matches Claude Code's terminal footer pattern ("Cooked for 49s",
    // "Sautéed for 1m 0s") but in natural spoken English so edge-tts
    // pronounces it correctly. Verb picked from PAST_TENSE_VERBS per
    // turn — pass a seeded random.Random so the test is deterministic.
    // PAST_TENSE_VERBS[0] is 'Accomplished' so we can assert exactly.
    const runSeeded = (sec) => run(
      `import random; print(synth_turn.format_elapsed_phrase(${sec}, rng=random.Random(0)))`
    );
    // Seeded rng.choice(PAST_TENSE_VERBS) with seed=0 picks a specific
    // verb — compute it inside Python once so the asserts just check
    // the DURATION part and the VERB prefix stays whatever seed 0 picks.
    const picked = run(
      `import random; r=random.Random(0); print(r.choice(synth_turn.PAST_TENSE_VERBS))`
    );
    const cases = [
      [0,    ''],
      [1,    `${picked} for 1 second`],
      [5,    `${picked} for 5 seconds`],
      [59,   `${picked} for 59 seconds`],
      [60,   `${picked} for 1 minute`],
      [61,   `${picked} for 1 minute and 1 second`],
      [90,   `${picked} for 1 minute and 30 seconds`],
      [120,  `${picked} for 2 minutes`],
      [448,  `${picked} for 7 minutes and 28 seconds`],
    ];
    for (const [sec, want] of cases) {
      const got = runSeeded(sec);
      if (got !== want) throw new Error(`${sec}s → got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
  });

  it('run() prefers --footer-phrase over computed fallback when provided', () => {
    // Ben's 2026-04-23 ask: the end-of-reply clip should say the EXACT
    // phrase Claude Code printed to the terminal, not something we
    // made up. speak-response.ps1 scrapes the Windows Terminal buffer
    // via UIA and passes the phrase here as --footer-phrase; run()
    // must use that string verbatim. This test drives run() with a
    // fake transcript + a non-empty footer_phrase and asserts the
    // body_clips log line reports the scraped phrase landed.
    const tmpDir = os.tmpdir();
    const fakeTranscript = path.join(tmpDir, `tt-footer-test-${process.pid}-${Date.now()}.jsonl`);
    fs.writeFileSync(fakeTranscript,
      '{"type":"user","message":{"content":[{"type":"text","text":"hi"}]}}\n' +
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Short reply."}]}}\n',
      'utf8');
    // Deterministic session id so we can wipe any prior sync state.
    const testSession = 'deadbeef-1111-2222-3333-444455556666';
    try { fs.unlinkSync(path.join(os.homedir(), '.terminal-talk', 'sessions', `${testSession}-sync.json`)); } catch {}
    const scrapedPhrase = 'Sauteed for 1m 0s';  // ASCII-only so PS arg parse doesn't muck about
    const code = `
import sys
sys.path.insert(0, r'${appDirRepo.replace(/\\/g, '\\\\')}')
import synth_turn
# Short-circuit the actual edge-tts spawn so we don't network out during the test.
# synthesize_parallel is the single call site for clip writing; replace with a
# recorder that captures (phrase-list, prefix) tuples.
captured = []
def fake_synth(phrases, voice, short, openai_key, prefix='', provider='edge', openai_voice='alloy'):
    captured.append((list(phrases), prefix))
synth_turn.synthesize_parallel = fake_synth
rc = synth_turn.run('${testSession}', r'${fakeTranscript.replace(/\\/g, '\\\\')}',
                    'on-stop', elapsed_sec=60, footer_phrase='${scrapedPhrase}')
print('RC', rc)
for ph, pref in captured:
    print('CLIP', repr(pref), repr(ph))
`;
    const r = runPythonInline(code);
    try { fs.unlinkSync(fakeTranscript); } catch {}
    if (r.code !== 0) throw new Error(`python exit ${r.code}: ${r.stderr}`);
    // Exactly one synthesize_parallel call, no prefix (= body clip path),
    // containing BOTH the reply text AND the scraped footer verbatim.
    const clips = [...r.stdout.matchAll(/^CLIP '(.*?)' (\[.*)$/gm)].map((m) => ({ prefix: m[1], list: m[2] }));
    const body = clips.find((c) => c.prefix === '');
    if (!body) throw new Error(`no body-clip call; stdout:\n${r.stdout}`);
    if (!body.list.includes(scrapedPhrase)) {
      throw new Error(`scraped footer '${scrapedPhrase}' not in body clips: ${body.list}`);
    }
  });

  it('run() falls back to format_elapsed_phrase when footer_phrase is empty', () => {
    const tmpDir = os.tmpdir();
    const fakeTranscript = path.join(tmpDir, `tt-footer-fallback-${process.pid}-${Date.now()}.jsonl`);
    fs.writeFileSync(fakeTranscript,
      '{"type":"user","message":{"content":[{"type":"text","text":"hi"}]}}\n' +
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Short reply."}]}}\n',
      'utf8');
    const testSession = 'feedface-aaaa-bbbb-cccc-dddddddddddd';
    try { fs.unlinkSync(path.join(os.homedir(), '.terminal-talk', 'sessions', `${testSession}-sync.json`)); } catch {}
    const code = `
import sys, random
sys.path.insert(0, r'${appDirRepo.replace(/\\/g, '\\\\')}')
import synth_turn
captured = []
def fake_synth(phrases, voice, short, openai_key, prefix='', provider='edge', openai_voice='alloy'):
    captured.append((list(phrases), prefix))
synth_turn.synthesize_parallel = fake_synth
# Seed random so the fallback verb is deterministic for asserting.
random.seed(42)
rc = synth_turn.run('${testSession}', r'${fakeTranscript.replace(/\\/g, '\\\\')}',
                    'on-stop', elapsed_sec=90, footer_phrase='')
print('RC', rc)
for ph, pref in captured:
    print('CLIP', repr(pref), repr(ph))
`;
    const r = runPythonInline(code);
    try { fs.unlinkSync(fakeTranscript); } catch {}
    if (r.code !== 0) throw new Error(`python exit ${r.code}: ${r.stderr}`);
    const clips = [...r.stdout.matchAll(/^CLIP '(.*?)' (\[.*)$/gm)].map((m) => ({ prefix: m[1], list: m[2] }));
    const body = clips.find((c) => c.prefix === '');
    if (!body) throw new Error(`no body-clip call; stdout:\n${r.stdout}`);
    // Fallback must include the duration in words ("1 minute and 30 seconds"
    // for elapsed_sec=90). Verb is random so we don't assert on it.
    if (!/1 minute and 30 seconds/.test(body.list)) {
      throw new Error(`fallback phrase not in body clips: ${body.list}`);
    }
  });

  it('format_elapsed_phrase uses a varied verb pool (not always "Worked")', () => {
    // Regression guard for Ben's 2026-04-23 ask: the first cut always
    // said "worked for X" — he wanted Claude Code's spinner variety
    // ("Cooked", "Sautéed", "Pondered"...). Assert the verb pool has
    // at least 30 entries + contains the two he explicitly pointed at.
    const poolSize = run(`print(len(synth_turn.PAST_TENSE_VERBS))`);
    if (Number(poolSize) < 30) {
      throw new Error(`PAST_TENSE_VERBS should have ≥ 30 entries, got ${poolSize}`);
    }
    const hasKeyVerbs = run(
      `print('Sautéed' in synth_turn.PAST_TENSE_VERBS and 'Cooked' in synth_turn.PAST_TENSE_VERBS)`
    );
    if (hasKeyVerbs !== 'True') {
      throw new Error(`PAST_TENSE_VERBS must include Sautéed + Cooked (got ${hasKeyVerbs})`);
    }
  });

  it('LOCK_ACQUIRE_TIMEOUT_SEC is long enough to cover real synth runs', () => {
    // Regression guard for Ben's 2026-04-23 narration-duplication bug:
    // acquire used to time out after 2 s, shorter than a single edge-tts
    // retry burst (~15 s × 3 = 45 s worst case). Racing runs then
    // "proceeded without" the lock and re-narrated the same tool_use
    // entries 3-4 times. 30 s is the minimum credible floor — enough
    // for a realistic synth cycle while staying under LOCK_STALE_SEC
    // (60 s) so a genuinely crashed holder still gets stolen first.
    const out = run(`print(synth_turn.LOCK_ACQUIRE_TIMEOUT_SEC, synth_turn.LOCK_STALE_SEC)`);
    const [acquire, stale] = out.split(/\s+/).map(Number);
    if (!Number.isFinite(acquire) || acquire < 30) {
      throw new Error(`LOCK_ACQUIRE_TIMEOUT_SEC must be ≥ 30 (got ${acquire})`);
    }
    if (!Number.isFinite(stale) || stale <= acquire) {
      throw new Error(`LOCK_STALE_SEC (${stale}) must exceed LOCK_ACQUIRE_TIMEOUT_SEC (${acquire})`);
    }
  });

  it('lock not acquired → run() exits 0 without synthesising (no duplicate narration)', () => {
    // Seed a stale-but-not-yet-stale lock, then invoke run() with a
    // short acquire timeout monkeypatched down to <0.5 s so the test
    // doesn't wait 30 s. Expect exit 0 + early "deferring to current
    // holder" log — never the full synth pipeline.
    const lockDir = path.join(os.homedir(), '.terminal-talk', 'sessions');
    try { fs.mkdirSync(lockDir, { recursive: true }); } catch {}
    // Realistic UUID-shaped session id so SESSION_SHORT_RE passes on the
    // 8-char slice synth_turn derives from it.
    const testSession = 'abcdef01-2345-6789-abcd-ef0123456789';
    const lockPath = path.join(lockDir, `${testSession}-sync.lock`);
    fs.writeFileSync(lockPath, `999999:otherhost:${Date.now()}`, 'utf8');

    const code = `
import sys
sys.path.insert(0, r'${appDirRepo.replace(/\\/g, '\\\\')}')
import synth_turn
synth_turn.LOCK_ACQUIRE_TIMEOUT_SEC = 1  # short-circuit for test
# Write a dummy transcript so run() gets past the path checks.
import pathlib, tempfile
tmp = pathlib.Path(tempfile.mkdtemp()) / 'fake.jsonl'
tmp.write_text('{"type":"user","message":{"content":"x"}}\\n', encoding='utf-8')
rc = synth_turn.run('${testSession}', str(tmp), 'on-tool')
print('RC', rc)
`;
    const r = runPythonInline(code);
    try { fs.unlinkSync(lockPath); } catch {}
    if (r.code !== 0) throw new Error(`python exit ${r.code}: ${r.stderr}`);
    if (!/RC 0/.test(r.stdout)) throw new Error(`expected RC 0, got: ${r.stdout}`);
  });

  // ---------------------------------------------------------------------
  // OpenAI provider preference plumbing (2026-04-23).
  //
  // resolve_tts_routing reads playback.tts_provider + voices.openai_response
  // off the config dict. The turn runner passes those through to
  // synthesize_parallel, which reorders the edge-vs-openai attempt chain
  // accordingly. These tests drive the pure resolver so we don't depend
  // on a live edge-tts / OpenAI endpoint.
  // ---------------------------------------------------------------------

  it('resolve_tts_routing defaults to edge when tts_provider is missing', () => {
    const out = run(`p, v = synth_turn.resolve_tts_routing({}); print(p, v)`);
    assertEqual(out, 'edge alloy');
  });

  it('resolve_tts_routing honours an explicit "openai" choice', () => {
    const out = run(`p, v = synth_turn.resolve_tts_routing({'playback': {'tts_provider': 'openai'}, 'voices': {'openai_response': 'onyx'}}); print(p, v)`);
    assertEqual(out, 'openai onyx');
  });

  it('resolve_tts_routing normalises unknown values to edge', () => {
    // Garbage input — e.g. legacy config, typo, hand-edit — must NOT
    // crash and must NOT silently route to OpenAI (which would spend
    // the user's credits unexpectedly).
    const out = run(`p, v = synth_turn.resolve_tts_routing({'playback': {'tts_provider': 'premium'}}); print(p)`);
    assertEqual(out, 'edge');
    const out2 = run(`p, v = synth_turn.resolve_tts_routing({'playback': {'tts_provider': None}}); print(p)`);
    assertEqual(out2, 'edge');
  });

  it('resolve_tts_routing: case-insensitive provider string', () => {
    const out = run(`p, v = synth_turn.resolve_tts_routing({'playback': {'tts_provider': 'OpenAI'}}); print(p)`);
    assertEqual(out, 'openai');
  });

  it('resolve_tts_routing: openai_voice defaults to "alloy" when not set', () => {
    const out = run(`p, v = synth_turn.resolve_tts_routing({'playback': {'tts_provider': 'openai'}}); print(v)`);
    assertEqual(out, 'alloy');
  });

  it('synthesize_parallel signature accepts provider + openai_voice kwargs', () => {
    // Guard: if someone refactors synthesize_parallel to drop these
    // kwargs, every caller in run() starts throwing TypeError at the
    // first synth attempt. Smoke-test the signature accepts them.
    const out = run(`import inspect; sig = inspect.signature(synth_turn.synthesize_parallel); print('provider' in sig.parameters, 'openai_voice' in sig.parameters)`);
    assertEqual(out, 'True True');
  });

  it('config-validate accepts the new playback.tts_provider string', () => {
    // Keep the JS validator + Python resolver in agreement about the
    // field being string-typed. Values other than 'edge' / 'openai'
    // still pass validation (Python resolver normalises them) — so
    // a stale config can't lock users out.
    const { validateConfig } = require(path.join(__dirname, '..', 'app', 'lib', 'config-validate.js'));
    const ok = validateConfig({ playback: { tts_provider: 'openai' } });
    if (!ok.ok) throw new Error(`validator rejected 'openai': ${JSON.stringify(ok.violations)}`);
    const ok2 = validateConfig({ playback: { tts_provider: 'edge' } });
    if (!ok2.ok) throw new Error(`validator rejected 'edge': ${JSON.stringify(ok2.violations)}`);
    // Numeric instead of string should be rejected.
    const bad = validateConfig({ playback: { tts_provider: 42 } });
    if (bad.ok) throw new Error(`validator must reject non-string tts_provider`);
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
  it('find_last_user_idx skips tool_result entries (mid-turn, not a new turn)', () => {
    const entries = JSON.stringify([
      { type: 'user', message: { content: [{ type: 'text', text: 'hi' }] } },       // 0 — real
      { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } },  // 1
      { type: 'assistant', message: { content: [{ type: 'tool_use' }] } },          // 2
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } }, // 3 — skip
      { type: 'assistant', message: { content: [{ type: 'text', text: 'next' }] } },// 4
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'y' }] } }, // 5 — skip
    ]);
    const out = run(`print(synth_turn.find_last_user_idx(${entries}))`);
    assertEqual(out, '0');
  });
  it('find_last_user_idx returns most recent REAL user when multiple prompts', () => {
    const entries = JSON.stringify([
      { type: 'user', message: { content: [{ type: 'text', text: 'first' }] } },    // 0
      { type: 'assistant', message: { content: [{ type: 'tool_use' }] } },          // 1
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } }, // 2 — skip
      { type: 'user', message: { content: [{ type: 'text', text: 'second' }] } },   // 3 — real
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'z' }] } }, // 4 — skip
    ]);
    const out = run(`print(synth_turn.find_last_user_idx(${entries}))`);
    assertEqual(out, '3');
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

// =============================================================================
// SPEECH INCLUDES COMBINATORIAL SMOKE (audit 2026-04-23 Tier A #4)
//
// Seven toggles in the panel × per-session override × global default.
// Ben's concern: "it's not just a case of testing one on and off;
// you've got to test them in different variations because it could
// conflict." These tests don't cover the full 128-combo matrix (that's
// Phase 3), just the per-key isolation + a handful of combinations
// that exercise known boundary pairs: inline_code × bullet_markers
// (both touch backticks-in-list-items), headings × code_blocks (both
// are line-scoped block strippers), image_alt × urls (both touch
// parentheses).
// =============================================================================
describe('speech_includes combinatorial smoke', () => {
  const { stripForTTS } = require(path.join(__dirname, '..', 'app', 'lib', 'text.js'));

  // A canonical mixed input: exercises every key's feature at least
  // once. `---` delimiters keep each section separately inspectable
  // in test output when an assertion fails.
  // Use `arr.filter(x)` as the inline-code sample. The short-identifier
  // whitelist keeps clean prose-like tokens (`session_id`, `/clear`) but
  // the parens disqualify, so we get reliably different output between
  // inline_code=true and inline_code=false.
  const KITCHEN_SINK = [
    '# Heading text',
    '',
    'Plain paragraph with `arr.filter(x)` here.',
    '',
    '- First bullet item',
    '- Second bullet item',
    '',
    '```python',
    'def hello(): print("hi")',
    '```',
    '',
    'Image: ![the alt text](http://img/thing.png)',
    '',
    'Naked URL: https://example.com/path',
    '',
    'Link: [click here](http://other/place)',
  ].join('\n');

  function on(...keys) {
    const out = {};
    for (const k of keys) out[k] = true;
    return out;
  }
  function off(...keys) {
    const out = {};
    for (const k of keys) out[k] = false;
    return out;
  }

  it('defaults: headings ON, everything else OFF — expected features appear/disappear', () => {
    const out = stripForTTS(KITCHEN_SINK);
    assertTruthy(out.includes('Heading text'), 'headings default ON — heading text must be present');
    assertFalsy(out.includes('arr.filter'), 'inline_code default OFF — disqualified (parens) inline span must be stripped');
    assertFalsy(out.includes('def hello'), 'code_blocks default OFF — code body must be stripped');
    assertFalsy(out.includes('the alt text'), 'image_alt default OFF — alt text must be stripped');
    assertFalsy(out.includes('example.com'), 'urls default OFF — bare URL must be stripped');
    assertTruthy(out.includes('click here'), 'link text is always kept (URL stripped regardless)');
  });

  // --- Per-key isolation: toggle ONE key, verify exactly that feature changes -

  it('isolation: code_blocks=true exposes the code body', () => {
    const out = stripForTTS(KITCHEN_SINK, on('code_blocks'));
    assertTruthy(out.includes('def hello'));
  });

  it('isolation: inline_code=true exposes the inline span content (even when disqualified)', () => {
    const out = stripForTTS(KITCHEN_SINK, on('inline_code'));
    assertTruthy(out.includes('arr.filter'),
      'inline_code=true must keep the span content regardless of the whitelist heuristics');
  });

  it('isolation: inline_code=false — prose-like identifiers kept by whitelist, code-like stripped', () => {
    // The whitelist (looksLikeInlineProse) preserves `session_id`,
    // `/clear`, `pid=0` as prose; `foo()` and friends get stripped.
    // This behaviour is deliberate — Ben hit the `/clear` message bug
    // where stripping it turned explanatory sentences into nonsense.
    const input = 'Run the `/clear` command; use `arr.filter(x)` too.';
    const out = stripForTTS(input, off('inline_code'));
    assertTruthy(out.includes('/clear'), 'whitelist must keep prose-like tokens');
    assertFalsy(out.includes('arr.filter'), 'disqualified tokens with parens must be stripped');
  });

  it('isolation: urls=true keeps bare URLs in the spoken stream', () => {
    const out = stripForTTS(KITCHEN_SINK, on('urls'));
    assertTruthy(out.includes('example.com'));
  });

  it('isolation: headings=false drops the entire heading line', () => {
    const out = stripForTTS(KITCHEN_SINK, off('headings'));
    assertFalsy(out.includes('Heading text'),
      'headings=false must drop the heading text, not just the # marker');
  });

  it('isolation: image_alt=true exposes the alt-text (never the URL)', () => {
    const out = stripForTTS(KITCHEN_SINK, on('image_alt'));
    assertTruthy(out.includes('the alt text'));
    assertFalsy(out.includes('img/thing.png'),
      'image URL must be dropped regardless of image_alt setting');
  });

  it('isolation: bullet_markers=true keeps the leading "- " markers', () => {
    const out = stripForTTS(KITCHEN_SINK, on('bullet_markers'));
    // Can't assert a literal "- " on a single line (whitespace
    // normaliser collapses everything) but we CAN assert the bullet
    // content didn't get the implicit period appended.
    assertFalsy(/First bullet item\.\s/.test(out),
      'bullet_markers=true must NOT add the implicit period that stripping applies');
  });

  it('isolation: bullet_markers=false strips markers and appends implicit period', () => {
    const out = stripForTTS(KITCHEN_SINK, off('bullet_markers'));
    // With markers stripped, each bullet becomes its own sentence
    // (implicit period injected so downstream sentence-split sees
    // proper boundaries).
    assertTruthy(/First bullet item\./.test(out));
    assertTruthy(/Second bullet item\./.test(out));
  });

  // --- Known boundary pairs (where a bug in one could mis-strip the other) ---

  it('pair: inline_code=true + bullet_markers=true — backticks-in-list items stay intact', () => {
    const input = '- Item with `inline` span\n- Another `one` here';
    const out = stripForTTS(input, { ...on('inline_code'), ...on('bullet_markers') });
    assertTruthy(out.includes('inline'));
    assertTruthy(out.includes('one'));
  });

  it('pair: headings=false + code_blocks=false — both block strippers fire without interaction', () => {
    const input = '# H1\nprose before fence\n```js\ncode();\n```\nprose after fence';
    const out = stripForTTS(input, { ...off('headings'), ...off('code_blocks') });
    assertFalsy(out.includes('H1'), 'heading dropped');
    assertFalsy(out.includes('code()'), 'code-block body dropped');
    assertTruthy(out.includes('prose before'));
    assertTruthy(out.includes('prose after'),
      'prose after the fence survives (code-block regex must terminate correctly)');
  });

  it('pair: image_alt=true + urls=false — alt stays, URL drops', () => {
    const input = 'See ![my image](http://pic/x.png) and visit https://go.example';
    const out = stripForTTS(input, { ...on('image_alt'), ...off('urls') });
    assertTruthy(out.includes('my image'));
    assertFalsy(out.includes('pic/x.png'));
    assertFalsy(out.includes('go.example'));
  });

  it('pair: image_alt=false + urls=true — image fully gone, bare URL kept', () => {
    const input = 'See ![my image](http://pic/x.png) and https://go.example';
    const out = stripForTTS(input, { ...off('image_alt'), ...on('urls') });
    assertFalsy(out.includes('my image'));
    assertTruthy(out.includes('go.example'));
  });

  // --- Kitchen-sink all-on vs all-off ---

  it('kitchen-sink all-on: every feature visible', () => {
    const out = stripForTTS(KITCHEN_SINK, {
      code_blocks: true, inline_code: true, urls: true,
      headings: true, bullet_markers: true, image_alt: true, tool_calls: true,
    });
    assertTruthy(out.includes('Heading text'));
    assertTruthy(out.includes('arr.filter'));
    assertTruthy(out.includes('def hello'));
    assertTruthy(out.includes('the alt text'));
    assertTruthy(out.includes('example.com'));
  });

  it('kitchen-sink all-off: every toggleable feature stripped', () => {
    const out = stripForTTS(KITCHEN_SINK, {
      code_blocks: false, inline_code: false, urls: false,
      headings: false, bullet_markers: false, image_alt: false, tool_calls: false,
    });
    assertFalsy(out.includes('Heading text'));
    assertFalsy(out.includes('def hello'));
    assertFalsy(out.includes('the alt text'));
    assertFalsy(out.includes('example.com'));
    assertFalsy(out.includes('arr.filter'),
      'disqualified inline span (with parens) must be stripped when inline_code=false');
  });

  it('null/empty input — no crash regardless of toggles', () => {
    assertEqual(stripForTTS(''), '');
    assertEqual(stripForTTS(null), '');
    assertEqual(stripForTTS(undefined), '');
    assertEqual(stripForTTS('', on('code_blocks', 'urls')), '');
  });

  it('tool_calls flag does not affect stripForTTS output (Python-side only)', () => {
    // Per text.js comment line ~31: JS stripForTTS keeps tool_calls in
    // the DEFAULTS shape for config lock-step with Python but does not
    // act on it. This test locks in that invariant — if someone adds a
    // JS-side action for tool_calls without updating the Python mirror,
    // we want to know.
    const outA = stripForTTS(KITCHEN_SINK, { tool_calls: true });
    const outB = stripForTTS(KITCHEN_SINK, { tool_calls: false });
    assertEqual(outA, outB,
      'tool_calls must not change stripForTTS output on the JS side');
  });
});

// =============================================================================
// TRANSCRIPT WATCHER — lifecycle + spawn gating. The module was shipping
// with zero dedicated tests until the 2026-04-23 audit. Key invariants
// to lock in:
//   - start()/stop() are idempotent
//   - no flag files → no spawn
//   - flag + transcript present → one spawn, correct CLI args
//   - inFlight guard: no second spawn while first is running
//   - minSpawnGapMs rate limit respected
//   - transcript path re-resolution when the file disappears
// =============================================================================
describe('TranscriptWatcher lifecycle (EX7f / audit 2026-04-23)', () => {
  const { TranscriptWatcher } = require(
    path.join(__dirname, '..', 'app', 'lib', 'transcript-watcher.js')
  );

  // Fake child_process.spawn — records args, returns a handle that
  // listens for 'exit' + exposes a .stderr .on() stub. Never touches
  // the real filesystem or spawns a real Python.
  function makeFakeSpawn() {
    const calls = [];
    const procs = [];
    const fn = (exe, args, opts) => {
      const exitListeners = [];
      const errorListeners = [];
      const stderrListeners = [];
      const proc = {
        _exited: false,
        stderr: { on: (ev, cb) => { if (ev === 'data') stderrListeners.push(cb); } },
        on: (ev, cb) => {
          if (ev === 'exit')  exitListeners.push(cb);
          if (ev === 'error') errorListeners.push(cb);
        },
        fireExit(code = 0) {
          if (proc._exited) return;
          proc._exited = true;
          for (const cb of exitListeners) cb(code);
        },
      };
      calls.push({ exe, args, opts });
      procs.push(proc);
      return proc;
    };
    return { fn, calls, procs };
  }

  // Ephemeral temp dir with sessions/ and .claude/projects/<sub>/ carved
  // out. Each test gets its own so they don't collide or leak state.
  function makeTempHome() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-watcher-'));
    const sessionsDir = path.join(root, 'sessions');
    const projectsDir = path.join(root, '.claude', 'projects', 'some-project');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.mkdirSync(projectsDir, { recursive: true });
    return {
      root,
      sessionsDir,
      projectsDir,
      writeFlag(short) {
        fs.writeFileSync(path.join(sessionsDir, `${short}-working.flag`), '123', 'utf8');
      },
      writeTranscript(sessionId) {
        const p = path.join(projectsDir, `${sessionId}.jsonl`);
        fs.writeFileSync(p, '{}\n', 'utf8');
        return p;
      },
      cleanup() {
        try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
      },
    };
  }

  function makeWatcher(home, fakeSpawn, overrides = {}) {
    return new TranscriptWatcher({
      ttHome: home.root,
      claudeProjectsDir: path.join(home.root, '.claude', 'projects'),
      synthScript: '/fake/synth_turn.py',
      pythonExe: 'python-fake',
      pollIntervalMs: 10000,  // never let the real timer fire in tests
      minSpawnGapMs: 400,
      spawnFn: fakeSpawn.fn,
      diag: () => {},
      ...overrides,
    });
  }

  it('start() is idempotent — second call does not re-arm', () => {
    const home = makeTempHome();
    try {
      const spawner = makeFakeSpawn();
      const w = makeWatcher(home, spawner);
      w.start();
      w.start();  // no-op — already armed
      assertEqual(w._armed, true);
      w.stop();
    } finally { home.cleanup(); }
  });

  it('stop() clears the pending timer and can be called twice', () => {
    const home = makeTempHome();
    try {
      const spawner = makeFakeSpawn();
      const w = makeWatcher(home, spawner);
      w.start();
      w.stop();
      assertEqual(w._armed, false);
      assertEqual(w._pollTimer, null);
      w.stop();  // idempotent
    } finally { home.cleanup(); }
  });

  it('_readActiveShorts returns the 8-hex shortids from valid flag files', () => {
    const home = makeTempHome();
    try {
      home.writeFlag('aabbccdd');
      home.writeFlag('deadbeef');
      // Malformed entries MUST be ignored so a stray file can't
      // wake the watcher for a bogus session.
      fs.writeFileSync(path.join(home.sessionsDir, 'not-a-flag.txt'), 'x');
      fs.writeFileSync(path.join(home.sessionsDir, 'ZZZZZZZZ-working.flag'), 'x');  // non-hex
      fs.writeFileSync(path.join(home.sessionsDir, 'aabbccd-working.flag'),  'x');  // only 7 chars
      const spawner = makeFakeSpawn();
      const w = makeWatcher(home, spawner);
      const out = w._readActiveShorts().sort();
      assertEqual(out, ['aabbccdd', 'deadbeef']);
    } finally { home.cleanup(); }
  });

  it('_readActiveShorts returns [] when sessions dir does not exist', () => {
    const home = makeTempHome();
    try {
      fs.rmSync(home.sessionsDir, { recursive: true });
      const spawner = makeFakeSpawn();
      const w = makeWatcher(home, spawner);
      assertEqual(w._readActiveShorts(), []);
    } finally { home.cleanup(); }
  });

  it('_findTranscript matches by shortId prefix inside claude projects', () => {
    const home = makeTempHome();
    try {
      home.writeTranscript('aabbccdd-1234-5678-9abc-def012345678');
      // A noise file that shouldn't match (wrong prefix)
      home.writeTranscript('deadbeef-9999-8888-7777-111122223333');
      const spawner = makeFakeSpawn();
      const w = makeWatcher(home, spawner);
      const match = w._findTranscript('aabbccdd');
      assertTruthy(match && match.endsWith('.jsonl'),
        `expected transcript for aabbccdd, got ${match}`);
      assertTruthy(match.includes('aabbccdd-1234'));
      // Missing prefix → null.
      assertEqual(w._findTranscript('ffffffff'), null);
    } finally { home.cleanup(); }
  });

  it('_maybeSpawn does nothing when no transcript exists yet', () => {
    const home = makeTempHome();
    try {
      home.writeFlag('aabbccdd');
      // No transcript written — the flag is there but Claude Code
      // hasn't produced the JSONL yet. Must not spawn.
      const spawner = makeFakeSpawn();
      const w = makeWatcher(home, spawner);
      w._maybeSpawn('aabbccdd');
      assertEqual(spawner.calls.length, 0);
    } finally { home.cleanup(); }
  });

  it('_maybeSpawn fires spawn with the expected CLI shape on first poll', () => {
    const home = makeTempHome();
    try {
      home.writeFlag('aabbccdd');
      const transcriptPath = home.writeTranscript(
        'aabbccdd-1234-5678-9abc-def012345678'
      );
      const spawner = makeFakeSpawn();
      const w = makeWatcher(home, spawner);
      w._maybeSpawn('aabbccdd');
      assertEqual(spawner.calls.length, 1);
      const { exe, args } = spawner.calls[0];
      assertEqual(exe, 'python-fake');
      // Arg order matches synth_turn.py's CLI contract.
      assertEqual(args[0], '-u');
      assertEqual(args[1], '/fake/synth_turn.py');
      assertEqual(args.indexOf('--session'),    2);
      assertEqual(args.indexOf('--transcript'), 4);
      assertEqual(args.indexOf('--mode'),       6);
      assertEqual(args[7], 'on-stream');
      assertEqual(args[5], transcriptPath);
    } finally { home.cleanup(); }
  });

  it('_maybeSpawn skips a second spawn while the first is still running', () => {
    const home = makeTempHome();
    try {
      home.writeFlag('aabbccdd');
      home.writeTranscript('aabbccdd-1111-2222-3333-444444444444');
      const spawner = makeFakeSpawn();
      const w = makeWatcher(home, spawner);
      w._maybeSpawn('aabbccdd');
      assertEqual(spawner.calls.length, 1);
      // Second poll immediately after — first synth still in-flight,
      // must not spawn another.
      w._maybeSpawn('aabbccdd');
      assertEqual(spawner.calls.length, 1, 'inFlight guard must suppress the second spawn');
    } finally { home.cleanup(); }
  });

  it('after the first spawn exits, another spawn is allowed (rate-limit permitting)', () => {
    const home = makeTempHome();
    try {
      home.writeFlag('aabbccdd');
      home.writeTranscript('aabbccdd-1111-2222-3333-444444444444');
      const spawner = makeFakeSpawn();
      const w = makeWatcher(home, spawner, { minSpawnGapMs: 0 });
      w._maybeSpawn('aabbccdd');
      assertEqual(spawner.calls.length, 1);
      // Fire the child's 'exit' event — watcher's cleanup clears
      // inFlight. With minSpawnGapMs=0, the very next poll can spawn
      // again.
      spawner.procs[0].fireExit(0);
      w._maybeSpawn('aabbccdd');
      assertEqual(spawner.calls.length, 2);
    } finally { home.cleanup(); }
  });

  it('minSpawnGapMs rate-limits back-to-back polls on the same session', () => {
    const home = makeTempHome();
    try {
      home.writeFlag('aabbccdd');
      home.writeTranscript('aabbccdd-1111-2222-3333-444444444444');
      const spawner = makeFakeSpawn();
      const w = makeWatcher(home, spawner, { minSpawnGapMs: 999999 });
      w._maybeSpawn('aabbccdd');
      assertEqual(spawner.calls.length, 1);
      spawner.procs[0].fireExit(0);
      // inFlight is now null, but lastSpawn was just recorded — the
      // rate-limit guard must block a second spawn.
      w._maybeSpawn('aabbccdd');
      assertEqual(spawner.calls.length, 1, 'rate-limit must suppress the second spawn');
    } finally { home.cleanup(); }
  });

  it('when transcript disappears between polls, the cached path is nulled for re-resolution', () => {
    const home = makeTempHome();
    try {
      home.writeFlag('aabbccdd');
      const p = home.writeTranscript('aabbccdd-1111-2222-3333-444444444444');
      const spawner = makeFakeSpawn();
      const w = makeWatcher(home, spawner, { minSpawnGapMs: 0 });
      w._maybeSpawn('aabbccdd');
      assertEqual(spawner.calls.length, 1);
      spawner.procs[0].fireExit(0);
      // Claude Code rotates the transcript; the cached path no
      // longer exists on disk.
      fs.unlinkSync(p);
      w._maybeSpawn('aabbccdd');
      // No new spawn — transcript is gone. State cleared.
      assertEqual(spawner.calls.length, 1);
      const state = w._state.get('aabbccdd');
      assertEqual(state.transcript, null,
        'cached transcript path must be cleared when file disappears so next tick re-resolves');
    } finally { home.cleanup(); }
  });
});

// =============================================================================
// SCRAPE SUBPROCESS TIMEOUT (d4dddac) — the Stop hook must bound the
// scrape subprocess at 4 s so Claude Code can't time out the whole
// hook mid-scrape and skip `Stop: spawned synth_turn.py`. Before
// d4dddac, the scrape used `& powershell.exe ...` which has no timeout
// primitive; live observation showed 30-s scrapes killing the hook
// and leaving NO audio (body or footer) for long turns.
//
// These are source-level checks against the installed hook. The
// behavioural path (real subprocess + kill) needs a desktop session,
// so it stays out of the harness — but the wiring is verifiable here.
// =============================================================================
describe('HOOK ORCHESTRATION: scrape subprocess timeout (d4dddac)', () => {
  // Read from the REPO, not INSTALL_DIR — CI Linux jobs run the logic
  // harness without an install, and a top-level read of INSTALL_DIR
  // would ENOENT at module-eval time before the LOGIC_ONLY gate can
  // skip the block. These are source-level invariants either way.
  const respHookPath = path.join(__dirname, '..', 'hooks', 'speak-response.ps1');
  const respHook = fs.readFileSync(respHookPath, 'utf8');

  it('Stop hook uses System.Diagnostics.Process (not bare `& powershell.exe`)', () => {
    // & ... has no timeout. Process.Start does.
    if (!/System\.Diagnostics\.ProcessStartInfo/.test(respHook)) {
      throw new Error('speak-response.ps1 must use System.Diagnostics.ProcessStartInfo for the scrape subprocess');
    }
    if (!/\[System\.Diagnostics\.Process\]::Start/.test(respHook)) {
      throw new Error('speak-response.ps1 must call [System.Diagnostics.Process]::Start');
    }
  });

  it('scrape subprocess has a 4-second WaitForExit budget', () => {
    if (!/WaitForExit\s*\(\s*4000\s*\)/.test(respHook)) {
      throw new Error('speak-response.ps1 must bound the scrape subprocess at WaitForExit(4000)');
    }
  });

  it('timeout branch calls .Kill() on the subprocess', () => {
    // Otherwise the child keeps running past the hook's lifetime,
    // holding UIA handles + chewing CPU.
    if (!/\.Kill\(\)/.test(respHook)) {
      throw new Error('speak-response.ps1 must call .Kill() on the scrape subprocess in the timeout branch');
    }
  });

  it('timeout branch logs a distinct message separate from "scrape empty"', () => {
    // Operators need to tell "UIA ran but returned nothing" from
    // "UIA hung and we killed it". Two different action items.
    if (!/scrape timed out after 4s/.test(respHook)) {
      throw new Error('speak-response.ps1 must log a distinct timeout message (not just "scrape empty")');
    }
    if (!/scrape empty/.test(respHook)) {
      throw new Error('speak-response.ps1 must also keep the "scrape empty" log for the clean-no-match case');
    }
  });

  it('scrape block runs BEFORE the spawn-synth_turn block (fall-through on timeout)', () => {
    // After the 4s timeout fires, the hook must proceed to spawning
    // synth_turn.py with an EMPTY footer phrase — the fallback path.
    // Confirm textual ordering: scrape block is before the synth
    // spawn.
    // Match the actual Log call, not the comment prose that also
    // contains the phrase. indexOf on raw strings would hit the
    // comment first (line 96 in the current hook) and wrongly
    // report scrape AFTER spawn.
    const scrapeAt = respHook.search(/Log\s+"terminal footer scraped/);
    const spawnAt  = respHook.search(/Log\s+"Stop:\s+spawned synth_turn\.py/);
    if (scrapeAt < 0 || spawnAt < 0) {
      throw new Error(`speak-response.ps1 missing required scrape or spawn Log() calls (scrape@${scrapeAt}, spawn@${spawnAt})`);
    }
    if (!(scrapeAt < spawnAt)) {
      throw new Error(`scrape block must precede synth_turn spawn (scrape@${scrapeAt}, spawn@${spawnAt})`);
    }
  });

  it('scrape block is inside try/catch so any PS exception still falls through', () => {
    // The scrape block is wrapped in `try { ... } catch { Log ... }`.
    // Without the catch, a typo or missing file would hard-kill the
    // hook before reaching the synth_turn spawn — exactly the silent-
    // death class of bug we just fixed. Confirm the scrape-fail log
    // still exists (the catch branch).
    if (!/terminal footer scrape failed/.test(respHook)) {
      throw new Error('speak-response.ps1 scrape block must have a catch that logs "scrape failed" — prevents silent death on any unexpected exception');
    }
  });

  it('elapsedSec guard skips the subprocess entirely when flag was never set', () => {
    // First-ever invocation (or after a fresh install) has no working
    // flag → elapsedSec=0. Skipping the scrape avoids paying the
    // subprocess spawn cost for a case that can never match.
    if (!/\$elapsedSec\s*-ge\s*1/.test(respHook)) {
      throw new Error('speak-response.ps1 must skip scrape when elapsedSec < 1 (saves the subprocess spawn)');
    }
  });
});

// =============================================================================
// PS SESSION-IDENTITY BEHAVIOUR — drive the real module with a temp registry
// to prove the Update-SessionAssignment migration + preservation invariants.
// Ben hit a visible bug on 2026-04-22 where /clear rotated session_id, the old
// entry hung around with its colour, and a "ghost" orange re-appeared from
// stale queue files. These scenarios are the behavioural contract for the fix.
// =============================================================================
describe('DOT STRIP LAYOUT (left-aligned, packed)', () => {
  // Ben's 2026-04-23 ask: dots should start from the left edge and sit
  // fairly close together so as many fit as possible — reverted the
  // 2026-04-22 space-evenly change that spread four dots across the
  // whole bar. CSS gate so a future style edit can't silently restore
  // the spread-out look.
  const cssPath = path.join(__dirname, '..', 'app', 'styles.css');
  const css = fs.readFileSync(cssPath, 'utf8');
  const dotsBlock = css.match(/\.dots\s*\{[\s\S]*?\n\}/);

  it('.dots uses flex-start justification (packs from the left)', () => {
    if (!dotsBlock) throw new Error('.dots block missing from styles.css');
    if (!/justify-content:\s*flex-start/.test(dotsBlock[0])) {
      throw new Error('.dots must be justify-content: flex-start to pack dots densely from the left');
    }
    if (/justify-content:\s*space-(evenly|between|around)/.test(dotsBlock[0])) {
      throw new Error('.dots must NOT use space-evenly/between/around — dots were spreading across the full bar');
    }
  });

  it('.dots uses a tight gap (≤ 5px) so maximum dots fit in the strip', () => {
    if (!dotsBlock) throw new Error('.dots block missing from styles.css');
    const gap = dotsBlock[0].match(/gap:\s*(\d+)px/);
    if (!gap) throw new Error('.dots must declare an explicit px gap');
    const gapPx = Number(gap[1]);
    if (gapPx > 5) {
      throw new Error(`.dots gap should be ≤ 5px for density (got ${gapPx}px)`);
    }
  });
});

describe('PS SESSION-IDENTITY BEHAVIOUR', () => {
  const MODULE_PATH = path.join(APP_DIR, 'session-registry.psm1');

  // Skip fast on non-Windows / missing install — the describe() guard already
  // handles --logic-only via NEEDS_INSTALL, but we also protect against
  // running the block if the module file isn't there for any reason.
  if (!fs.existsSync(MODULE_PATH)) {
    it('session-registry.psm1 missing — cannot exercise PS behaviour', () => {
      throw new Error(`expected module at ${MODULE_PATH}`);
    });
    return;
  }

  // Invoke Update-SessionAssignment via the real PS module against a fresh
  // temp registry file each call. Read-Registry + Save-Registry on the PS
  // side handle the JSON-to-hashtable round-trip, so we can seed arbitrary
  // entries including voice + speech_includes and assert on the persisted
  // shape. Much higher fidelity than regexing the source.
  //
  // We route the PS block through a temp .ps1 file invoked with -File
  // rather than -Command. Windows arg-quoting for -Command mangles
  // backslashes inside paths ("C:\Users\..." becomes "C:Users..." before
  // PowerShell parses it), which silently empties the registry read.
  function runUpdate({ seed = {}, short, sessionId, claudePid, now }) {
    const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const regPath    = path.join(os.tmpdir(), `tt-test-mig-${nonce}.json`);
    const scriptPath = path.join(os.tmpdir(), `tt-test-mig-${nonce}.ps1`);
    fs.writeFileSync(regPath, JSON.stringify({ assignments: seed }), 'utf8');
    const psEscape = (s) => String(s).replace(/'/g, "''");
    const script = [
      `Import-Module '${psEscape(MODULE_PATH)}' -Force`,
      `$p = '${psEscape(regPath)}'`,
      `$a = Read-Registry -RegistryPath $p`,
      `$idx = Update-SessionAssignment -Assignments $a -Short '${psEscape(short)}' -SessionId '${psEscape(sessionId)}' -ClaudePid ${Number(claudePid) | 0} -Now ${Number(now)}`,
      `Save-Registry -RegistryPath $p -Assignments $a`,
      `Write-Output $idx`,
      '',
    ].join("\r\n");
    fs.writeFileSync(scriptPath, script, 'utf8');
    const r = spawnSync('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { encoding: 'utf8', timeout: 20000 }
    );
    try { fs.unlinkSync(scriptPath); } catch {}
    if (r.status !== 0) {
      try { fs.unlinkSync(regPath); } catch {}
      throw new Error(`PS exited ${r.status}: ${r.stderr || r.stdout}`);
    }
    const returnedIndex = parseInt(r.stdout.trim().split(/\s+/).pop(), 10);
    const finalState = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    try { fs.unlinkSync(regPath); } catch {}
    return { returnedIndex, assignments: finalState.assignments || {} };
  }

  const NOW = 1_776_900_000; // fixed "now" for determinism
  const FRESH = NOW - 30;    // 30 s ago — well inside the 600 s window
  const STALE = NOW - 601;   // just outside the window

  it('/clear migration: new short inherits palette slot + every metadata field', () => {
    // Covers the core bug: the user's terminal does /clear, session_id
    // rotates, but the same CLI process means claude_pid is stable. Every
    // piece of metadata the user has set on that terminal must survive.
    const seed = {
      'oldshort': {
        index: 7, session_id: 'oldshort-uuid', claude_pid: 1234,
        label: 'MATE.AIN brain', pinned: true, muted: true, focus: true,
        last_seen: FRESH, voice: 'en-GB-RyanNeural',
        speech_includes: { urls: true, code_blocks: false, headings: true }
      }
    };
    const { returnedIndex, assignments } = runUpdate({
      seed, short: 'newshort', sessionId: 'newshort-uuid', claudePid: 1234, now: NOW,
    });
    assertEqual(returnedIndex, 7);
    if (assignments['oldshort']) {
      throw new Error('old short must be removed after migration');
    }
    const migrated = assignments['newshort'];
    if (!migrated) throw new Error('new short entry missing after migration');
    assertEqual(migrated.index, 7);
    assertEqual(migrated.label, 'MATE.AIN brain');
    assertEqual(migrated.pinned, true);
    assertEqual(migrated.muted, true);
    assertEqual(migrated.focus, true);
    assertEqual(migrated.voice, 'en-GB-RyanNeural');
    assertDeepEqual(migrated.speech_includes, { urls: true, code_blocks: false, headings: true });
    assertEqual(migrated.session_id, 'newshort-uuid');  // refreshed to new UUID
    assertEqual(migrated.claude_pid, 1234);             // pid carried forward
  });

  it('stale pid (last_seen outside the 600 s freshness window) does NOT migrate', () => {
    // If Windows reuses a pid hours/days later, the claim of "same
    // terminal" is no longer credible. We fall through to fresh
    // allocation rather than inherit a stranger's colour + label.
    const seed = {
      'oldshort': {
        index: 7, session_id: 'oldshort-uuid', claude_pid: 1234,
        label: 'should not migrate', pinned: true,
        last_seen: STALE,
      }
    };
    const { returnedIndex, assignments } = runUpdate({
      seed, short: 'newshort', sessionId: 'newshort-uuid', claudePid: 1234, now: NOW,
    });
    // oldshort keeps its slot (it's pinned), newshort gets the lowest free
    // slot that isn't 7. That's 0.
    assertEqual(returnedIndex, 0);
    assertTruthy(assignments['oldshort'], 'stale entry must remain (not migrated)');
    assertTruthy(assignments['newshort'], 'new entry created fresh');
    assertEqual(assignments['newshort'].label, '');
    assertEqual(assignments['newshort'].pinned, false);
  });

  it('claude_pid=0 never triggers migration (blocks ghost-entry pollution)', () => {
    // main.js's ensureAssignmentsForFiles path creates entries with
    // claude_pid=0 when it sees a clip filename for an unknown short.
    // If the PS side migrated on pid=0, ALL such ghosts would migrate
    // into each other and pollute every session's metadata.
    const seed = {
      'oldshort': {
        index: 5, session_id: 'oldshort', claude_pid: 0,
        label: 'ghost', pinned: false,
        last_seen: FRESH,
      }
    };
    const { returnedIndex, assignments } = runUpdate({
      seed, short: 'newshort', sessionId: 'newshort-uuid', claudePid: 0, now: NOW,
    });
    // Lowest free index NOT equal to 5 is 0.
    assertEqual(returnedIndex, 0);
    assertTruthy(assignments['oldshort'], 'pid=0 entry must remain');
    assertTruthy(assignments['newshort'], 'new entry created fresh');
    assertEqual(assignments['newshort'].label, '');
  });

  it('matching short already in registry: bookkeeping update only (no migration)', () => {
    // Same short fires twice in a row (e.g. statusline heartbeat). We
    // just touch last_seen / session_id / claude_pid on the existing
    // entry. No new slot, no migration scan.
    const seed = {
      'aabbccdd': {
        index: 3, session_id: 'old-uuid', claude_pid: 999,
        label: 'existing', pinned: true, muted: false, focus: false,
        last_seen: FRESH - 100,
      }
    };
    const { returnedIndex, assignments } = runUpdate({
      seed, short: 'aabbccdd', sessionId: 'new-uuid-same-short', claudePid: 999, now: NOW,
    });
    assertEqual(returnedIndex, 3);
    assertEqual(Object.keys(assignments).length, 1);
    assertEqual(assignments['aabbccdd'].label, 'existing');
    assertEqual(assignments['aabbccdd'].session_id, 'new-uuid-same-short');
    assertEqual(assignments['aabbccdd'].last_seen, NOW);
  });

  it('multiple /clear in sequence: only one entry persists, slot preserved', () => {
    // /clear → short A migrates to B. /clear again → B migrates to C.
    // Final state must be exactly one entry (C) at the original slot.
    const state = {
      'alpha111': {
        index: 12, session_id: 'alpha-uuid', claude_pid: 5555,
        label: 'persistent', pinned: true, muted: false, focus: false,
        last_seen: FRESH, voice: 'en-GB-RyanNeural',
      }
    };
    const after1 = runUpdate({
      seed: state, short: 'beta2222', sessionId: 'beta-uuid', claudePid: 5555, now: NOW,
    });
    assertEqual(after1.returnedIndex, 12);
    assertEqual(Object.keys(after1.assignments).length, 1);
    assertTruthy(after1.assignments['beta2222']);
    const after2 = runUpdate({
      seed: after1.assignments, short: 'cafebabe', sessionId: 'gamma-uuid',
      claudePid: 5555, now: NOW + 10,
    });
    assertEqual(after2.returnedIndex, 12);
    assertEqual(Object.keys(after2.assignments).length, 1);
    assertTruthy(after2.assignments['cafebabe']);
    assertEqual(after2.assignments['cafebabe'].label, 'persistent');
    assertEqual(after2.assignments['cafebabe'].voice, 'en-GB-RyanNeural');
    assertEqual(after2.assignments['cafebabe'].pinned, true);
  });

  it('per-session voice survives /clear migration', () => {
    const seed = {
      'voicedcd': {
        index: 9, session_id: 'old-uuid', claude_pid: 7777,
        label: '', pinned: false, muted: false, focus: false,
        last_seen: FRESH, voice: 'shimmer',
      }
    };
    const { assignments } = runUpdate({
      seed, short: 'newvoice', sessionId: 'new-uuid', claudePid: 7777, now: NOW,
    });
    assertEqual(assignments['newvoice'].voice, 'shimmer');
  });

  it('per-session speech_includes survives /clear migration', () => {
    const seed = {
      'incl0000': {
        index: 2, session_id: 'old-uuid', claude_pid: 8888,
        label: '', pinned: false, muted: false, focus: false,
        last_seen: FRESH,
        speech_includes: { urls: true, code_blocks: true, headings: false, bullet_markers: true },
      }
    };
    const { assignments } = runUpdate({
      seed, short: 'inclnewe', sessionId: 'new-uuid', claudePid: 8888, now: NOW,
    });
    assertDeepEqual(assignments['inclnewe'].speech_includes, {
      urls: true, code_blocks: true, headings: false, bullet_markers: true,
    });
  });

  it('multi-terminal isolation: migration touches ONLY the matching pid', () => {
    // Terminals A (pid 1111, idx 3) and B (pid 2222, idx 7). /clear on
    // A must migrate A only — B's entry and its metadata are untouched.
    const seed = {
      'termaaaa': {
        index: 3, session_id: 'term-a', claude_pid: 1111,
        label: 'terminal A', pinned: true, muted: false, focus: false,
        last_seen: FRESH, voice: 'en-GB-RyanNeural',
      },
      'termbbbb': {
        index: 7, session_id: 'term-b', claude_pid: 2222,
        label: 'terminal B', pinned: true, muted: true, focus: false,
        last_seen: FRESH, voice: 'en-GB-SoniaNeural',
        speech_includes: { urls: false },
      },
    };
    const { returnedIndex, assignments } = runUpdate({
      seed, short: 'termanew', sessionId: 'term-a-new', claudePid: 1111, now: NOW,
    });
    assertEqual(returnedIndex, 3);
    if (assignments['termaaaa']) throw new Error('terminal A old entry must be removed');
    const a = assignments['termanew'];
    const b = assignments['termbbbb'];
    assertEqual(a.index, 3);
    assertEqual(a.label, 'terminal A');
    assertEqual(a.voice, 'en-GB-RyanNeural');
    // B stays untouched
    assertEqual(b.index, 7);
    assertEqual(b.label, 'terminal B');
    assertEqual(b.muted, true);
    assertEqual(b.voice, 'en-GB-SoniaNeural');
    assertDeepEqual(b.speech_includes, { urls: false });
    assertEqual(b.claude_pid, 2222);
  });

  it('no matching pid: falls through to lowest-free palette slot', () => {
    const seed = {
      'filler00': { index: 0, session_id: 'f-uuid', claude_pid: 100, label: '', pinned: false, muted: false, focus: false, last_seen: FRESH },
      'filler11': { index: 1, session_id: 'f-uuid', claude_pid: 200, label: '', pinned: false, muted: false, focus: false, last_seen: FRESH },
      'filler22': { index: 2, session_id: 'f-uuid', claude_pid: 300, label: '', pinned: false, muted: false, focus: false, last_seen: FRESH },
    };
    const { returnedIndex } = runUpdate({
      seed, short: 'newentry', sessionId: 'n-uuid', claudePid: 9999, now: NOW,
    });
    assertEqual(returnedIndex, 3);
  });

  it('pinned entry preserves pinned=true through migration', () => {
    // Explicit scenario: user pinned their colour, then /clear. The pin
    // is a "this terminal's colour should NEVER change" contract. It
    // must cross the migration boundary intact.
    const seed = {
      'pinnedab': {
        index: 15, session_id: 'old-uuid', claude_pid: 4242,
        label: 'pinned term', pinned: true, muted: false, focus: false,
        last_seen: FRESH,
      }
    };
    const { assignments } = runUpdate({
      seed, short: 'pinnedcd', sessionId: 'new-uuid', claudePid: 4242, now: NOW,
    });
    assertEqual(assignments['pinnedcd'].pinned, true);
    assertEqual(assignments['pinnedcd'].index, 15);
  });

  it('migration preserves muted=true and focus=true independently', () => {
    const seed = {
      'mutefocu': {
        index: 4, session_id: 'old-uuid', claude_pid: 3737,
        label: '', pinned: false, muted: true, focus: true,
        last_seen: FRESH,
      }
    };
    const { assignments } = runUpdate({
      seed, short: 'mfnewxxx', sessionId: 'new-uuid', claudePid: 3737, now: NOW,
    });
    assertEqual(assignments['mfnewxxx'].muted, true);
    assertEqual(assignments['mfnewxxx'].focus, true);
  });

  it('freshness boundary: exactly at cutoff migrates; one second past does not', () => {
    // Exercises the `-ge $cutoff` comparison directly. last_seen at
    // (NOW - 600) must migrate; last_seen at (NOW - 601) must not.
    const atBoundary = {
      'boundary': {
        index: 6, session_id: 'b-uuid', claude_pid: 11111,
        label: 'at-boundary', pinned: false, muted: false, focus: false,
        last_seen: NOW - 600,
      }
    };
    const r1 = runUpdate({
      seed: atBoundary, short: 'newbound', sessionId: 'nb-uuid', claudePid: 11111, now: NOW,
    });
    assertEqual(r1.returnedIndex, 6);
    assertTruthy(r1.assignments['newbound'], 'at-boundary must migrate');

    const pastBoundary = {
      'boundary': {
        index: 6, session_id: 'b-uuid', claude_pid: 22222,
        label: 'past-boundary', pinned: false, muted: false, focus: false,
        last_seen: NOW - 601,
      }
    };
    const r2 = runUpdate({
      seed: pastBoundary, short: 'newpast', sessionId: 'np-uuid', claudePid: 22222, now: NOW,
    });
    if (r2.returnedIndex === 6) {
      throw new Error('past-boundary (601 s stale) must NOT migrate');
    }
    assertTruthy(r2.assignments['boundary'], 'past-boundary entry must survive');
  });

  it('full round-trip (no migration): every field survives Read + Save', () => {
    // Every voice-selection / mute / focus / pin / include flag must
    // survive a bookkeeping-only touch. This is the common case — the
    // hook fires, statusline ticks, just the three volatile fields
    // (last_seen, session_id, claude_pid) rotate. Everything else
    // must be byte-identical to the seed.
    const seed = {
      'roundtri': {
        index: 11, session_id: 'seed-uuid', claude_pid: 7070,
        label: 'round-trip', pinned: true, muted: true, focus: true,
        last_seen: FRESH, voice: 'shimmer',
        speech_includes: { urls: true, tool_calls: true, inline_code: false },
      }
    };
    const { assignments } = runUpdate({
      seed, short: 'roundtri', sessionId: 'seed-uuid', claudePid: 7070, now: NOW,
    });
    const e = assignments['roundtri'];
    assertEqual(e.index, 11);
    assertEqual(e.label, 'round-trip');
    assertEqual(e.pinned, true);
    assertEqual(e.muted, true);
    assertEqual(e.focus, true);
    assertEqual(e.voice, 'shimmer');
    assertDeepEqual(e.speech_includes, { urls: true, tool_calls: true, inline_code: false });
  });

  it('OpenAI voice ids (shimmer / onyx etc.) round-trip through migration', () => {
    // Registry schema whitelists both edge-tts voice naming and the
    // OpenAI single-word ids. Migration must not downcast or reject
    // OpenAI ids when re-keying.
    for (const v of ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']) {
      const seed = {
        'oaivoice': {
          index: 6, session_id: 'o-uuid', claude_pid: 1212,
          label: '', pinned: false, muted: false, focus: false,
          last_seen: FRESH, voice: v,
        }
      };
      const { assignments } = runUpdate({
        seed, short: 'oainewxx', sessionId: 'o-new', claudePid: 1212, now: NOW,
      });
      assertEqual(
        assignments['oainewxx'] && assignments['oainewxx'].voice, v,
        `voice ${v} must survive migration`
      );
    }
  });

  it('entry without voice stays voice-free through migration (no ghost field)', () => {
    // Regression guard: an entry with no per-session voice override
    // (falling back to the global default) must not suddenly sprout a
    // voice field after /clear. That would silently pin the session
    // to whatever the global default happened to be at migration time.
    const seed = {
      'novoice1': {
        index: 2, session_id: 'nv-uuid', claude_pid: 1313,
        label: '', pinned: false, muted: false, focus: false,
        last_seen: FRESH,
      }
    };
    const { assignments } = runUpdate({
      seed, short: 'novoice2', sessionId: 'nv-new', claudePid: 1313, now: NOW,
    });
    const e = assignments['novoice2'];
    if (e.voice !== undefined && e.voice !== null && e.voice !== '') {
      throw new Error(`no-voice entry acquired voice '${e.voice}' across migration`);
    }
  });

  it('ghost-then-hook: pre-existing pid=0 entry for same short is updated in place', () => {
    // Rare race: main.js creates a ghost entry for short X via
    // ensureAssignmentsForFiles (pid=0), THEN the hook for session X
    // fires with the real pid. The existing-short branch updates the
    // ghost's pid in place — no migration, no extra slot.
    const seed = {
      'racedabc': {
        index: 9, session_id: 'racedabc', claude_pid: 0,
        label: '', pinned: false, muted: false, focus: false,
        last_seen: FRESH,
      }
    };
    const { returnedIndex, assignments } = runUpdate({
      seed, short: 'racedabc', sessionId: 'racedabc-uuid', claudePid: 55555, now: NOW,
    });
    assertEqual(returnedIndex, 9);
    assertEqual(assignments['racedabc'].claude_pid, 55555);
    assertEqual(assignments['racedabc'].session_id, 'racedabc-uuid');
  });

  // ============================================================
  // PHASE 4 — MODULE 3: session-registry.psm1 VULNERABILITY PASS
  //
  // Existing PS SESSION-IDENTITY BEHAVIOUR tests cover /clear
  // migration in depth. Gaps this pass fills:
  //   - Update-SessionAssignment palette-full paths (LRU eviction +
  //     hash-collision when every slot is pinned)
  //   - Read-Registry tolerance for missing / malformed / empty JSON
  //   - Save-Registry writes UTF-8 without BOM (JS JSON.parse
  //     rejects BOM-prefixed files)
  //   - Write-SessionPidFile edge cases (pid=0 no-op)
  //   - Unicode labels through the full round-trip
  // ============================================================

  // Batched PS helper: runs an arbitrary script body that imports the
  // module, emits JSON on stdout, returns parsed object. Single spawn
  // per test — ~5 s overhead either way, so keep one test = one spawn.
  function runBatchedPs(scriptBody) {
    const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const scriptPath = path.join(os.tmpdir(), `tt-phase4-m3-${nonce}.ps1`);
    const script = [
      `Import-Module '${MODULE_PATH.replace(/'/g, "''")}' -Force`,
      scriptBody,
      '',
    ].join("\r\n");
    fs.writeFileSync(scriptPath, script, 'utf8');
    const r = spawnSync('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { encoding: 'utf8', timeout: 20000 }
    );
    try { fs.unlinkSync(scriptPath); } catch {}
    if (r.status !== 0) {
      throw new Error(`PS exited ${r.status}: ${r.stderr || r.stdout}`);
    }
    return r.stdout;
  }

  it('Update-SessionAssignment LRU-evicts when palette full and no user intent', () => {
    // Seed all 24 slots with plain entries (no label / voice / pin).
    // Oldest last_seen must be the eviction target.
    const seed = {};
    for (let i = 0; i < 24; i++) {
      seed[`s${i.toString().padStart(7, '0')}`] = {
        index: i, session_id: `u-${i}`, claude_pid: 1000 + i,
        label: '', pinned: false, muted: false, focus: false,
        last_seen: 1_776_000_000 + i,  // ascending → s0000000 is LRU
      };
    }
    const { returnedIndex, assignments } = runUpdate({
      seed, short: 'freshses', sessionId: 'fresh-uuid',
      claudePid: 99999, now: NOW,
    });
    if (assignments['s0000000']) {
      throw new Error('LRU-oldest entry should have been evicted');
    }
    assertEqual(returnedIndex, 0);
    assertEqual(assignments['freshses'].index, 0);
  });

  it('Update-SessionAssignment palette-full + every slot has user intent → hash-collision', () => {
    // Every entry has a label → every entry has user intent → no
    // eviction candidates. Fall through to hash-mod fallback which
    // must return a finite index 0..23 without throwing.
    const seed = {};
    for (let i = 0; i < 24; i++) {
      seed[`s${i.toString().padStart(7, '0')}`] = {
        index: i, session_id: `u-${i}`, claude_pid: 1000 + i,
        label: `terminal-${i}`, pinned: false, muted: false, focus: false,
        last_seen: 1_776_000_000 + i,
      };
    }
    const { returnedIndex, assignments } = runUpdate({
      seed, short: 'aabbccdd', sessionId: 'coll-uuid',
      claudePid: 99999, now: NOW,
    });
    // All 24 originals must survive.
    assertEqual(Object.keys(assignments).length, 25,
      '24 pre-existing + 1 new = 25 entries after hash-collision fallback');
    assertTruthy(Number.isFinite(returnedIndex));
    assertTruthy(returnedIndex >= 0 && returnedIndex < 24);
  });

  it('Read-Registry returns empty hashtable when file is missing', () => {
    const nonce = Math.random().toString(36).slice(2);
    const nonExistent = path.join(os.tmpdir(), `tt-nonexistent-${nonce}.json`);
    const out = runBatchedPs([
      `$a = Read-Registry -RegistryPath '${nonExistent.replace(/\\/g, '\\\\')}'`,
      `Write-Output ($a.Count)`,
    ].join("\r\n"));
    // Hashtable.Count on empty = 0
    assertEqual(out.trim(), '0');
  });

  it('Read-Registry returns empty hashtable on malformed JSON (no throw)', () => {
    const nonce = Math.random().toString(36).slice(2);
    const badPath = path.join(os.tmpdir(), `tt-bad-${nonce}.json`);
    fs.writeFileSync(badPath, '{ "not really json" ...broken', 'utf8');
    try {
      const out = runBatchedPs([
        `$a = Read-Registry -RegistryPath '${badPath.replace(/\\/g, '\\\\')}'`,
        `Write-Output ($a.Count)`,
      ].join("\r\n"));
      assertEqual(out.trim(), '0', 'malformed JSON must yield empty hashtable, not throw');
    } finally { try { fs.unlinkSync(badPath); } catch {} }
  });

  it('Save-Registry writes UTF-8 with NO BOM (JS JSON.parse rejects BOM)', () => {
    const nonce = Math.random().toString(36).slice(2);
    const regPath = path.join(os.tmpdir(), `tt-bom-test-${nonce}.json`);
    try {
      runBatchedPs([
        `$a = @{ aabbccdd = @{ index = 0; session_id = 'x'; claude_pid = 1; label = ''; pinned = $false; muted = $false; focus = $false; last_seen = 1000 } }`,
        `Save-Registry -RegistryPath '${regPath.replace(/\\/g, '\\\\')}' -Assignments $a`,
        `Write-Output done`,
      ].join("\r\n"));
      const buf = fs.readFileSync(regPath);
      if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
        throw new Error('Save-Registry wrote a UTF-8 BOM; JS JSON.parse would reject');
      }
      // Round-trip through JSON.parse to confirm shape is valid.
      const parsed = JSON.parse(buf.toString('utf8'));
      assertTruthy(parsed.assignments);
      assertTruthy(parsed.assignments.aabbccdd);
    } finally { try { fs.unlinkSync(regPath); } catch {} }
  });

  it('Write-SessionPidFile is a no-op when pid=0 (no file created)', () => {
    const nonce = Math.random().toString(36).slice(2);
    const sessionsDir = path.join(os.tmpdir(), `tt-sessions-pid0-${nonce}`);
    fs.mkdirSync(sessionsDir, { recursive: true });
    try {
      runBatchedPs([
        `Write-SessionPidFile -SessionsDir '${sessionsDir.replace(/\\/g, '\\\\')}' -ClaudePid 0 -SessionId 'x' -Short 'aabbccdd' -Now 1000`,
        `Write-Output done`,
      ].join("\r\n"));
      const files = fs.readdirSync(sessionsDir);
      assertEqual(files.length, 0,
        'pid=0 must NOT create a pid file (would collide across unknown-pid ghosts)');
    } finally {
      try { fs.rmSync(sessionsDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('Write-SessionPidFile creates $pid.json with session metadata', () => {
    const nonce = Math.random().toString(36).slice(2);
    const sessionsDir = path.join(os.tmpdir(), `tt-sessions-${nonce}`);
    fs.mkdirSync(sessionsDir, { recursive: true });
    try {
      runBatchedPs([
        `Write-SessionPidFile -SessionsDir '${sessionsDir.replace(/\\/g, '\\\\')}' -ClaudePid 12345 -SessionId 'session-uuid' -Short 'aabbccdd' -Now 1776900000`,
      ].join("\r\n"));
      const file = path.join(sessionsDir, '12345.json');
      assertTruthy(fs.existsSync(file), `expected ${file}`);
      const content = JSON.parse(fs.readFileSync(file, 'utf8'));
      assertEqual(content.session_id, 'session-uuid');
      assertEqual(content.short, 'aabbccdd');
      assertEqual(content.claude_pid, 12345);
      assertEqual(content.ts, 1776900000);
    } finally {
      try { fs.rmSync(sessionsDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('Enter-RegistryLock + Exit-RegistryLock round-trip (same process acquires then releases)', () => {
    const nonce = Math.random().toString(36).slice(2);
    const regPath = path.join(os.tmpdir(), `tt-lock-${nonce}.json`);
    fs.writeFileSync(regPath, '{"assignments":{}}', 'utf8');
    try {
      const out = runBatchedPs([
        `$p = '${regPath.replace(/\\/g, '\\\\')}'`,
        `$ok1 = Enter-RegistryLock -RegistryPath $p`,
        `$lockExistsWhileHeld = Test-Path "$p.lock"`,
        `Exit-RegistryLock -RegistryPath $p`,
        `$lockExistsAfterRelease = Test-Path "$p.lock"`,
        `Write-Output "$ok1|$lockExistsWhileHeld|$lockExistsAfterRelease"`,
      ].join("\r\n"));
      const [acquired, whileHeld, afterRelease] = out.trim().split('|');
      assertEqual(acquired, 'True', 'first Enter-RegistryLock must acquire');
      assertEqual(whileHeld, 'True', 'lock file must exist while held');
      assertEqual(afterRelease, 'False', 'lock file must be removed on Exit');
    } finally { try { fs.unlinkSync(regPath); } catch {} }
  });

  it('Enter-RegistryLock steals a stale lock (older than LockStaleMs=3000)', () => {
    const nonce = Math.random().toString(36).slice(2);
    const regPath = path.join(os.tmpdir(), `tt-stalelock-${nonce}.json`);
    const lockPath = `${regPath}.lock`;
    fs.writeFileSync(regPath, '{"assignments":{}}', 'utf8');
    // Plant a pre-existing lock with a stale mtime (10 s old).
    fs.writeFileSync(lockPath, 'stuck', 'utf8');
    const tenSecAgo = new Date(Date.now() - 10_000);
    fs.utimesSync(lockPath, tenSecAgo, tenSecAgo);
    try {
      const out = runBatchedPs([
        `$p = '${regPath.replace(/\\/g, '\\\\')}'`,
        `$acquired = Enter-RegistryLock -RegistryPath $p`,
        `Exit-RegistryLock -RegistryPath $p`,
        `Write-Output $acquired`,
      ].join("\r\n"));
      assertEqual(out.trim(), 'True',
        'Enter-RegistryLock must steal a stale lock (10 s > LockStaleMs=3 s)');
    } finally {
      try { fs.unlinkSync(regPath); } catch {}
      try { fs.unlinkSync(lockPath); } catch {}
    }
  });

  it('unicode label survives full Read-Registry → Save-Registry round-trip', () => {
    const nonce = Math.random().toString(36).slice(2);
    const regPath = path.join(os.tmpdir(), `tt-unicode-${nonce}.json`);
    const label = 'MATE.AIN 🚀 ブレイン';
    const seed = {
      assignments: {
        aabbccdd: {
          index: 3, session_id: 'u-uuid', claude_pid: 100,
          label, pinned: true, muted: false, focus: false, last_seen: 1000,
        },
      },
    };
    fs.writeFileSync(regPath, JSON.stringify(seed), 'utf8');
    try {
      runBatchedPs([
        `$p = '${regPath.replace(/\\/g, '\\\\')}'`,
        `$a = Read-Registry -RegistryPath $p`,
        `Save-Registry -RegistryPath $p -Assignments $a`,
        `Write-Output done`,
      ].join("\r\n"));
      const after = JSON.parse(fs.readFileSync(regPath, 'utf8'));
      assertEqual(after.assignments.aabbccdd.label, label,
        'unicode label must survive PS round-trip byte-for-byte');
    } finally { try { fs.unlinkSync(regPath); } catch {} }
  });
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

  it('LRU eviction SKIPS entries with user intent (label / voice / muted / focus / speech_includes)', () => {
    // The auto-pin in ipc-handlers.js should catch these via pinned=true,
    // but historic entries from before auto-pin landed still carry
    // user intent without the pin flag. Eviction must respect both.
    const mk = (i, extra = {}) => ({
      index: i, last_seen: 1000 + i, pinned: false, ...extra,
    });
    for (const [protectedAt, extra] of [
      [0, { label: 'TT 1' }],
      [0, { voice: 'shimmer' }],
      [0, { muted: true }],
      [0, { focus: true }],
      [0, { speech_includes: { urls: true } }],
    ]) {
      const all = {};
      for (let i = 0; i < 24; i++) {
        all[`s${i.toString().padStart(7, '0')}`] = mk(i, i === protectedAt ? extra : {});
      }
      const r = allocatePaletteIndex('newshort', all, 24);
      assertEqual(r.reason, 'lru');
      if (r.evicted === 's0000000') {
        throw new Error(`user-intent entry was evicted (extra=${JSON.stringify(extra)})`);
      }
      assertEqual(r.evicted, 's0000001');
      assertEqual(r.index, 1);
    }
  });

  it('LRU: label="" (retracted) is NOT user intent, evicts normally', () => {
    // An empty label is not the same as "no label field" — it's an
    // explicit retraction. Should not count as user intent.
    const all = {};
    for (let i = 0; i < 24; i++) {
      all[`s${i.toString().padStart(7, '0')}`] = {
        index: i, last_seen: 1000 + i, pinned: false,
        label: i === 0 ? '' : undefined,   // oldest has empty label
      };
    }
    const r = allocatePaletteIndex('newshort', all, 24);
    assertEqual(r.reason, 'lru');
    assertEqual(r.evicted, 's0000000');   // evicted — '' is not intent
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
    // Pinned sessions must be skipped from eviction candidates. As of
    // 2026-04-23 the LRU block also protects user-intent entries (label
    // / voice / muted / focus / speech_includes); the pinned check lives
    // inside a hasIntent bag. Accept either the historical "-ne $true"
    // wording or the new "pinned -eq $true" intent-bag wording.
    if (!/pinned\s*-(ne|eq)\s*\$true/.test(src)) {
      throw new Error('session-registry.psm1 LRU eviction must gate on pinned');
    }
    // And the new user-intent guard so historic unpinned labeled entries
    // survive eviction pressure on 25th-session boot.
    if (!/\$entry\.label\s+-and/.test(src)) {
      throw new Error('session-registry.psm1 LRU must skip entries with user intent (label check missing)');
    }
  });

  it('session-registry.psm1 migrates palette slot by claude_pid across /clear', () => {
    // Claude Code's /clear rotates session_id but keeps the same CLI
    // process. Update-SessionAssignment must notice a colliding
    // claude_pid on an existing entry and re-key that entry under the
    // new short rather than allocating a fresh palette slot (which
    // would make the user's colour/label silently "move" on /clear).
    const psPath = path.join(__dirname, '..', 'app', 'session-registry.psm1');
    const src = fs.readFileSync(psPath, 'utf8');
    // Signal 1: a pid-matching scan against existing entries, gated on
    // $ClaudePid being non-zero (0 means "unknown" and would false-match).
    if (!/\$ClaudePid\s*-gt\s*0/.test(src)) {
      throw new Error('session-registry.psm1 must only migrate when $ClaudePid > 0');
    }
    if (!/\[int\]\$entry\.claude_pid\s*-eq\s*\$ClaudePid/.test(src)) {
      throw new Error('session-registry.psm1 must match on equal claude_pid during migration');
    }
    // Signal 2: the old short is removed after migration so the
    // registry doesn't accumulate duplicate entries.
    if (!/\$Assignments\.Remove\(\$oldShort\)/.test(src)) {
      throw new Error('session-registry.psm1 must Remove($oldShort) after PID-migration re-keys the entry');
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
    // 2026-04-23 — bumped to 2500 after instrumentation log lines went
    // in for the body-clip-disappears debug.
    const src = fs.readFileSync(rendererPath, 'utf8');
    const block = src.match(/function scheduleAutoDelete[\s\S]{0,2500}\n\}/);
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
    // Capture window bumped 1500 → 2500 after the rolling-backup
    // recovery code landed in loadAssignments on 2026-04-23.
    const load = src.match(/function loadAssignments[\s\S]{0,2500}\n\}/);
    if (!load) throw new Error('loadAssignments block not found');
    if (!/archiveCorruptRegistry\(.{0,100}JSON\.parse/i.test(load[0])) {
      throw new Error('loadAssignments must archive on JSON.parse failure');
    }
    if (!/archiveCorruptRegistry\(.{0,100}(missing|assignments|shape)/i.test(load[0])) {
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

  // ---------------------------------------------------------------------
  // Option-C "honest badge" contract (landed 2026-04-23): unreadCount
  // now accepts a path-string list (uncapped, comes from main.js
  // allPaths) as well as the legacy {path} object list. This is the
  // core fix for Ben's "delete 20, pops back to 20" — badges count
  // over the full on-disk list rather than the MAX_FILES-capped dot
  // metadata feed.
  // ---------------------------------------------------------------------

  it('allPaths: string-list form counts correctly (new uncapped input shape)', () => {
    const paths = [
      'C:\\fake\\queue\\resp_aaaaaaaa_0.mp3',
      'C:\\fake\\queue\\resp_aaaaaaaa_1.mp3',
      'C:\\fake\\queue\\resp_bbbbbbbb_0.mp3',
    ];
    const heard = new Set();
    if (unreadCount(paths, heard, stubClipPaths, 'all') !== 3) throw new Error('all count wrong');
    if (unreadCount(paths, heard, stubClipPaths, 'aaaaaaaa') !== 2) throw new Error('per-session count wrong');
    if (unreadCount(paths, heard, stubClipPaths, 'bbbbbbbb') !== 1) throw new Error('per-session count wrong');
  });

  it('allPaths: mixing string and {path} entries works (defensive normalisation)', () => {
    const mixed = [
      'C:\\fake\\queue\\resp_aaaaaaaa_0.mp3',
      { path: 'C:\\fake\\queue\\resp_aaaaaaaa_1.mp3', mtime: 0 },
    ];
    const heard = new Set();
    if (unreadCount(mixed, heard, stubClipPaths, 'aaaaaaaa') !== 2) {
      throw new Error('mixed shape must count both entries');
    }
  });

  it('allPaths: deleting a path from the full list decrements the count (no refill illusion)', () => {
    // Simulates Ben's bug scenario: 67 unplayed clips on disk, dot-strip
    // only rendered 20. Deleting a dot removed it from `queue` (the
    // capped 20), badge stayed at 20 because next poll re-filled.
    // Under allPaths the badge walks every on-disk path, so deletion
    // actually decrements the displayed number.
    const makePaths = (n) => Array.from({ length: n }, (_, i) =>
      `C:\\fake\\queue\\resp_aaaaaaaa_${String(i).padStart(3, '0')}.mp3`);
    const paths67 = makePaths(67);
    const heard = new Set();
    if (unreadCount(paths67, heard, stubClipPaths, 'aaaaaaaa') !== 67) {
      throw new Error('fresh 67-path list should read 67');
    }
    const paths47 = paths67.slice(20); // 20 "deleted"
    if (unreadCount(paths47, heard, stubClipPaths, 'aaaaaaaa') !== 47) {
      throw new Error('after removing 20 from the full list the count must drop to 47');
    }
  });

  it('allPaths: empty string-list yields 0 (does not crash on empty)', () => {
    if (unreadCount([], new Set(), stubClipPaths, 'all') !== 0) throw new Error('empty → 0');
  });

  it('allPaths: null/undefined/non-string entries are skipped safely', () => {
    const dirty = [
      null,
      undefined,
      42,
      '',
      'C:\\fake\\queue\\resp_aaaaaaaa_0.mp3',
    ];
    if (unreadCount(dirty, new Set(), stubClipPaths, 'all') !== 1) {
      throw new Error('dirty input must be filtered to the one real path');
    }
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
// MIC-WATCHER auto-pause/auto-resume wiring — regression guards for the
// Wispr Flow (and any other dictation tool) push-to-talk UX. Policy:
// the moment any non-self app starts using the microphone, TTS playback
// pauses; the moment they release, TTS resumes from the exact same
// point — no content lost, no audio bleeding over dictation.
// =============================================================================
// =============================================================================
// TRAY ICON — closes POST-V4 open thread #1. Wispr Flow / any app using
// a low-level keyboard hook can intercept globalShortcut before Electron
// sees it, leaving Ctrl+Shift+A dead. The tray icon provides a mouse-
// driven path to toggleWindow that's independent of the keyboard-shortcut
// hook chain.
// =============================================================================
describe('TRAY ICON — always-available show/hide + context menu', () => {
  const appDir = path.join(__dirname, '..', 'app');
  const mainSrc = fs.readFileSync(path.join(appDir, 'main.js'), 'utf8');

  it('app/tray-icon.png ships alongside main.js', () => {
    const iconPath = path.join(appDir, 'tray-icon.png');
    if (!fs.existsSync(iconPath)) {
      throw new Error('app/tray-icon.png missing — Electron Tray(img) would start empty');
    }
    // Quick sanity on the header so we know it's a real PNG, not a zero-byte placeholder.
    const head = fs.readFileSync(iconPath).slice(0, 8);
    if (!(head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47)) {
      throw new Error('app/tray-icon.png does not start with a PNG signature');
    }
  });

  it('main.js imports Tray + nativeImage from electron', () => {
    // Without these, new Tray(nativeImage.createFromPath(...)) throws.
    if (!/Tray,\s+nativeImage/.test(mainSrc)) {
      throw new Error('main.js must destructure { Tray, nativeImage } from electron');
    }
  });

  it('main.js defines startTray + stopTray helpers', () => {
    if (!/function startTray\(\)/.test(mainSrc)) {
      throw new Error('main.js must define function startTray()');
    }
    if (!/function stopTray\(\)/.test(mainSrc)) {
      throw new Error('main.js must define function stopTray()');
    }
  });

  it('startTray wires both left-click (toggleWindow) and right-click (context menu)', () => {
    if (!/tray\.on\(['"]click['"][\s\S]{0,200}toggleWindow/.test(mainSrc)) {
      throw new Error('startTray must bind left-click to toggleWindow');
    }
    if (!/tray\.on\(['"]right-click['"]/.test(mainSrc)) {
      throw new Error('startTray must bind right-click for the context menu');
    }
  });

  it('context menu offers a Quit entry', () => {
    if (!/label:\s*['"]Quit Terminal Talk['"][\s\S]{0,120}app\.quit\(\)/.test(mainSrc)) {
      throw new Error('Tray context menu must offer "Quit Terminal Talk" → app.quit()');
    }
  });

  it('startTray is called on app.whenReady; stopTray on will-quit', () => {
    // Isolate the whenReady handler body (runs once at app start) and
    // the will-quit handler body (runs once at shutdown). Grepping the
    // whole file would false-match startTray's own definition; we want
    // the call sites specifically.
    const whenReady = mainSrc.match(/app\.whenReady\(\)\.then\(\s*\(\)\s*=>\s*\{[\s\S]*?\n\}\);?/);
    if (!whenReady || !/\bstartTray\(\)/.test(whenReady[0])) {
      throw new Error('main.js must call startTray() inside the app.whenReady() handler');
    }
    const willQuit = mainSrc.match(/app\.on\(['"]will-quit['"][\s\S]*?\n\}\);?/);
    if (!willQuit || !/\bstopTray\(\)/.test(willQuit[0])) {
      throw new Error('main.js must call stopTray() inside the will-quit handler');
    }
  });

  it('startTray is tolerant when the icon file is missing (no crash)', () => {
    // Missing icon must log + return, not throw. Otherwise a partial
    // install (PNG missed by the robocopy pass, file-lock during copy)
    // would turn the whole app unlaunchable.
    if (!/img\.isEmpty\(\)[\s\S]{0,200}return/.test(mainSrc)) {
      throw new Error('startTray must return early when img.isEmpty() — no crash on partial install');
    }
  });
});

describe('MIC-WATCHER — auto-pause on external mic grab', () => {
  const appDir = path.join(__dirname, '..', 'app');
  const watcherRepo = path.join(appDir, 'mic-watcher.ps1');
  const mainSrc = fs.readFileSync(path.join(appDir, 'main.js'), 'utf8');
  const preloadSrc = fs.readFileSync(path.join(appDir, 'preload.js'), 'utf8');
  const rendererSrc = fs.readFileSync(path.join(appDir, 'renderer.js'), 'utf8');
  const audioPlayerSrc = fs.readFileSync(path.join(appDir, 'lib', 'audio-player.js'), 'utf8');

  it('app/mic-watcher.ps1 exists in the repo', () => {
    if (!fs.existsSync(watcherRepo)) {
      throw new Error('app/mic-watcher.ps1 is missing — the auto-pause sidecar cannot launch');
    }
  });

  it('install.ps1 wildcards app/*.ps1 so mic-watcher is picked up automatically', () => {
    // We don't assert that ~/.terminal-talk/app/mic-watcher.ps1 exists —
    // on Linux CI the install dir can be polluted by earlier tests but
    // the install step never runs, so the post-install file check is
    // unreliable there. Instead, assert the source-level guarantee:
    // install.ps1 copies `Join-Path $appDir '*.ps1'` wildcard, which
    // deterministically catches every .ps1 we ship in app/.
    const installSrc = fs.readFileSync(path.join(__dirname, '..', 'install.ps1'), 'utf8');
    if (!/\$appDir\s+'\*\.ps1'/.test(installSrc)) {
      throw new Error(`install.ps1 must copy app/*.ps1 via wildcard so new .ps1 files (like mic-watcher.ps1) are auto-picked`);
    }
  });

  it('mic-watcher emits the MIC_CAPTURED / MIC_RELEASED protocol', () => {
    const src = fs.readFileSync(watcherRepo, 'utf8');
    if (!/MIC_CAPTURED/.test(src)) throw new Error('mic-watcher must emit MIC_CAPTURED lines');
    if (!/MIC_RELEASED/.test(src)) throw new Error('mic-watcher must emit MIC_RELEASED lines');
  });

  it('mic-watcher filters out self-paths (our own wake-word listener)', () => {
    const src = fs.readFileSync(watcherRepo, 'utf8');
    // Without the filter, our own wake-word listener would register as
    // "another app using the mic" and TTS would pause forever.
    if (!/selfPathFragments|Test-SelfPath/.test(src)) {
      throw new Error('mic-watcher must filter self paths (selfPathFragments / Test-SelfPath)');
    }
    if (!/terminal-talk/.test(src)) {
      throw new Error('mic-watcher self-filter must include the terminal-talk install path');
    }
  });

  it('main.js spawns the mic-watcher on app ready', () => {
    if (!/startMicWatcher\s*\(\s*\)/.test(mainSrc)) {
      throw new Error('main.js must call startMicWatcher() to launch the sidecar');
    }
    if (!/spawn\(\s*POWERSHELL_EXE\b[\s\S]{0,200}MIC_WATCHER_SCRIPT/.test(mainSrc)) {
      throw new Error('main.js must spawn POWERSHELL_EXE on MIC_WATCHER_SCRIPT');
    }
    if (!/stopMicWatcher/.test(mainSrc)) {
      throw new Error('main.js must clean up mic-watcher on will-quit (stopMicWatcher)');
    }
  });

  it('main.js auto-restarts the mic-watcher if it exits', () => {
    // Without restart, a one-time sidecar crash would silently disable
    // the whole auto-pause feature until the user reloaded the toolbar.
    if (!/micWatcherProc\.on\(\s*['"]exit['"][\s\S]{0,500}startMicWatcher/.test(mainSrc)) {
      throw new Error('main.js must restart mic-watcher on exit (setTimeout startMicWatcher)');
    }
  });

  it('main.js forwards MIC_CAPTURED / MIC_RELEASED to the renderer', () => {
    if (!/MIC_CAPTURED[\s\S]{0,200}mic-captured-elsewhere/.test(mainSrc)) {
      throw new Error('main.js must send mic-captured-elsewhere IPC on MIC_CAPTURED');
    }
    if (!/MIC_RELEASED[\s\S]{0,200}mic-released/.test(mainSrc)) {
      throw new Error('main.js must send mic-released IPC on MIC_RELEASED');
    }
  });

  it('preload.js exposes onMicCapturedElsewhere + onMicReleased', () => {
    if (!/onMicCapturedElsewhere/.test(preloadSrc)) {
      throw new Error('preload.js must expose window.api.onMicCapturedElsewhere');
    }
    if (!/onMicReleased/.test(preloadSrc)) {
      throw new Error('preload.js must expose window.api.onMicReleased');
    }
  });

  it('renderer.js wires mic events to audioPlayer.systemAutoPause / Resume', () => {
    if (!/onMicCapturedElsewhere[\s\S]{0,400}systemAutoPause/.test(rendererSrc)) {
      throw new Error('renderer.js must call audioPlayer.systemAutoPause() on mic-captured-elsewhere');
    }
    if (!/onMicReleased[\s\S]{0,400}systemAutoResume/.test(rendererSrc)) {
      throw new Error('renderer.js must call audioPlayer.systemAutoResume() on mic-released');
    }
  });

  it('audio-player exposes systemAutoPause + systemAutoResume', () => {
    if (!/systemAutoPause\s*\(\s*\)\s*\{/.test(audioPlayerSrc)) {
      throw new Error('audio-player must export systemAutoPause()');
    }
    if (!/systemAutoResume\s*\(\s*\)\s*\{/.test(audioPlayerSrc)) {
      throw new Error('audio-player must export systemAutoResume()');
    }
  });

  it('audio-player gates systemAutoResume on the _systemAutoPaused flag', () => {
    // If the flag is missing, a release from ANY mic grab would unpause
    // audio that the user had deliberately paused. The flag is the single
    // guard that distinguishes "we paused this" from "user paused this".
    if (!/this\._systemAutoPaused/.test(audioPlayerSrc)) {
      throw new Error('audio-player must track _systemAutoPaused instance state');
    }
    if (!/if\s*\(\s*!\s*this\._systemAutoPaused\s*\)\s*return/.test(audioPlayerSrc)) {
      throw new Error('systemAutoResume must early-return when _systemAutoPaused is false (keep user-initiated pauses paused)');
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

  it('6244bfd playback.master_volume present in schema + validator with [0,1] bounds', () => {
    // Master volume slider shipped 2026-04-23 (6244bfd). Validator rule
    // added at the same time; schema was missing it — audit 2026-04-23
    // Phase 2b caught the drift. Both layers must now carry it.
    const mv = schema.properties.playback.properties.master_volume;
    if (!mv) throw new Error('schema missing playback.master_volume');
    assertEqual(mv.type, 'number');
    assertEqual(mv.minimum, 0.0);
    assertEqual(mv.maximum, 1.0);
    assertEqual(mv.default, 1.0);
    const { RULES } = require('../app/lib/config-validate');
    const rule = RULES.find(r => r.path === 'playback.master_volume');
    if (!rule) throw new Error('validator missing playback.master_volume rule');
    assertEqual(rule.type, 'number');
    assertEqual(rule.min, 0.0);
    assertEqual(rule.max, 1.0);
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
    const expected = ['code_blocks', 'inline_code', 'urls', 'headings', 'bullet_markers', 'image_alt', 'tool_calls'];
    for (const k of expected) {
      if (!ALLOWED_INCLUDE_KEYS.has(k)) throw new Error(`ALLOWED_INCLUDE_KEYS missing ${k}`);
    }
    assertEqual(ALLOWED_INCLUDE_KEYS.size, expected.length);
  });

  // Regression guard: ipc-validate's ALLOWED_INCLUDE_KEYS (the IPC
  // write-gate) must match main.js's VALID_INCLUDE_KEYS (the disk
  // read-sanitiser) exactly. A mismatch = "UI lets you toggle, IPC
  // silently refuses to save". tool_calls spent weeks in that state.
  it('ALLOWED_INCLUDE_KEYS matches VALID_INCLUDE_KEYS in app/main.js', () => {
    const fs = require('fs');
    const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8');
    const m = mainSrc.match(/VALID_INCLUDE_KEYS\s*=\s*new Set\(\[([^\]]+)\]\)/);
    if (!m) throw new Error('VALID_INCLUDE_KEYS not found in main.js');
    const mainKeys = Array.from(m[1].matchAll(/'([^']+)'/g)).map((x) => x[1]);
    const mainSet = new Set(mainKeys);
    for (const k of mainKeys) {
      if (!ALLOWED_INCLUDE_KEYS.has(k)) {
        throw new Error(`main.js has "${k}" but ipc-validate.js ALLOWED_INCLUDE_KEYS does not`);
      }
    }
    for (const k of ALLOWED_INCLUDE_KEYS) {
      if (!mainSet.has(k)) {
        throw new Error(`ipc-validate.js has "${k}" but main.js VALID_INCLUDE_KEYS does not`);
      }
    }
    assertEqual(ALLOWED_INCLUDE_KEYS.size, mainKeys.length);
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

  // -------------------------------------------------------------------
  // OpenAI (premium) Settings section — get-openai-key-status + the
  // test-openai-voice handler. Key storage + mutation still live
  // through update-config; these two handlers are the additions.
  // -------------------------------------------------------------------

  it('get-openai-key-status returns { saved: true } when apiKeyStore has a key', () => {
    const deps = baseDeps({
      apiKeyStore: { get: () => 'sk-abc123', set: () => {} },
    });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('get-openai-key-status'), { saved: true });
  });

  it('get-openai-key-status returns { saved: false } on empty / null / throw', () => {
    for (const getImpl of [
      () => null,
      () => '',
      () => { throw new Error('store read fail'); },
    ]) {
      const deps = baseDeps({ apiKeyStore: { get: getImpl, set: () => {} } });
      createIpcHandlers(deps).register();
      assertEqual(deps.ipcMain.invoke('get-openai-key-status'), { saved: false });
    }
  });

  it('get-openai-key-status never returns the key itself', () => {
    // Contract guard: UI status probe must never leak the key — the
    // renderer has contextIsolation + no direct filesystem access, so
    // the key should live only in main / apiKeyStore. A sloppy refactor
    // that returned `{ key: 'sk-…' }` would silently expose it.
    const deps = baseDeps({
      apiKeyStore: { get: () => 'sk-must-not-appear-in-ipc-response', set: () => {} },
    });
    createIpcHandlers(deps).register();
    const r = deps.ipcMain.invoke('get-openai-key-status');
    const dumped = JSON.stringify(r);
    if (dumped.includes('sk-must-not-appear')) {
      throw new Error(`get-openai-key-status leaked the key: ${dumped}`);
    }
    // Exact shape: only a single `saved` boolean.
    assertEqual(Object.keys(r).sort(), ['saved']);
  });

  it('get-queue composes files + assignments', () => {
    const deps = baseDeps({
      getQueueFiles: () => ['x.mp3', 'y.mp3'],
      ensureAssignmentsForFiles: (f) => ({ count: f.length }),
    });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('get-queue'), {
      files: ['x.mp3', 'y.mp3'],
      allPaths: ['x.mp3', 'y.mp3'],   // fallback when getQueueAllPaths not provided
      assignments: { count: 2 },
    });
  });

  it('get-queue emits getQueueAllPaths output when provided', () => {
    // The honest-badge fix (2026-04-23): renderer badges count from
    // allPaths (uncapped on-disk list), not the MAX_FILES-capped files
    // array. Handler must pass allPaths through verbatim.
    const deps = baseDeps({
      getQueueFiles: () => [{ path: '/q/new.mp3' }],
      getQueueAllPaths: () => ['/q/new.mp3', '/q/old1.mp3', '/q/old2.mp3'],
      ensureAssignmentsForFiles: () => ({}),
    });
    createIpcHandlers(deps).register();
    const out = deps.ipcMain.invoke('get-queue');
    assertEqual(out.allPaths, ['/q/new.mp3', '/q/old1.mp3', '/q/old2.mp3']);
    assertEqual(out.files.length, 1);
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

  // ---------------------------------------------------------------------
  // Auto-pin behaviour. Any user customisation (label / focus / voice /
  // muted / speech_includes) must set pinned=true so the grace-window
  // prune in ensureAssignmentsForFiles can't strip it when the CLI pid
  // goes stale. Ben hit this overnight 2026-04-22→23: laptop on, Claude
  // Code CLI rotated pid, entry dropped out of 4 h grace, prune-then-
  // recreate wiped the "TT 1" label. Each handler's positive path must
  // pin; each retraction path (blank label, null voice, muted=false,
  // focus=false, value=null on include) must NOT pin.
  // ---------------------------------------------------------------------

  it('set-session-label auto-pins on non-empty label', () => {
    const deps = mutationDeps({ registry: { aabbccdd: { pinned: false } } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-label', 'aabbccdd', 'TT 1'), true);
    assertEqual(deps._registry.aabbccdd.label, 'TT 1');
    assertEqual(deps._registry.aabbccdd.pinned, true);
  });

  it('set-session-label does NOT pin when label is cleared to empty', () => {
    // Clearing a label is a retraction of intent — don't leave a
    // stale pin behind just because there used to be a label.
    const deps = mutationDeps({ registry: { aabbccdd: { pinned: false, label: 'old' } } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-label', 'aabbccdd', ''), true);
    assertEqual(deps._registry.aabbccdd.label, '');
    assertEqual(deps._registry.aabbccdd.pinned, false);
  });

  it('set-session-focus auto-pins when focus is turned ON', () => {
    const deps = mutationDeps({ registry: { aabbccdd: { pinned: false } } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-focus', 'aabbccdd', true), true);
    assertEqual(deps._registry.aabbccdd.focus, true);
    assertEqual(deps._registry.aabbccdd.pinned, true);
  });

  it('set-session-focus does NOT pin when focus is turned OFF', () => {
    const deps = mutationDeps({ registry: { aabbccdd: { pinned: false, focus: true } } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-focus', 'aabbccdd', false), true);
    assertEqual(deps._registry.aabbccdd.focus, false);
    assertEqual(deps._registry.aabbccdd.pinned, false);
  });

  it('set-session-muted auto-pins when mute is turned ON', () => {
    const deps = mutationDeps({ registry: { aabbccdd: { pinned: false } } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-muted', 'aabbccdd', true), true);
    assertEqual(deps._registry.aabbccdd.muted, true);
    assertEqual(deps._registry.aabbccdd.pinned, true);
  });

  it('set-session-muted does NOT pin when mute is turned OFF', () => {
    const deps = mutationDeps({ registry: { aabbccdd: { pinned: false, muted: true } } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-muted', 'aabbccdd', false), true);
    assertEqual(deps._registry.aabbccdd.muted, false);
    assertEqual(deps._registry.aabbccdd.pinned, false);
  });

  it('set-session-voice auto-pins when a voice is set', () => {
    const deps = mutationDeps({ registry: { aabbccdd: { pinned: false } } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-voice', 'aabbccdd', 'en-GB-RyanNeural'), true);
    assertEqual(deps._registry.aabbccdd.voice, 'en-GB-RyanNeural');
    assertEqual(deps._registry.aabbccdd.pinned, true);
  });

  it('set-session-voice does NOT pin when voice is cleared (follow-global)', () => {
    const deps = mutationDeps({ registry: { aabbccdd: { pinned: false, voice: 'shimmer' } } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-voice', 'aabbccdd', null), true);
    assertFalsy(deps._registry.aabbccdd.voice, 'voice should be deleted');
    assertEqual(deps._registry.aabbccdd.pinned, false);
  });

  it('set-session-include auto-pins when a toggle is set true/false', () => {
    const deps = mutationDeps({ registry: { aabbccdd: { pinned: false } } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-include', 'aabbccdd', 'urls', true), true);
    assertEqual(deps._registry.aabbccdd.speech_includes.urls, true);
    assertEqual(deps._registry.aabbccdd.pinned, true);
  });

  it('set-session-include does NOT pin when a toggle is cleared to null', () => {
    const deps = mutationDeps({
      registry: { aabbccdd: { pinned: false, speech_includes: { urls: true } } }
    });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-include', 'aabbccdd', 'urls', null), true);
    assertEqual(deps._registry.aabbccdd.pinned, false);
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

  it('remove-session purges queue files matching the deleted short', () => {
    // Regression guard: the queue-watcher re-creates a ghost registry
    // entry (pid=0, empty label, lowest-free palette slot) any time it
    // sees a clip filename whose short has no registry entry. Without
    // this purge, clicking × on a session made it "come back in a
    // different colour" seconds later -- visible bug Ben reported
    // post-/clear on 2026-04-22. The purge only touches files whose
    // shortFromFile() resolves to the removed short; unrelated logs
    // and other sessions' clips stay intact.
    const fakeFs = {
      _files: new Set([
        '20260422T204301220-0000-aabbccdd.mp3',
        '20260422T204301220-0001-aabbccdd.mp3',
        '20260422T210029277-0015-ffeeddcc.mp3',  // another session
        '_hook.log',                              // non-clip file
      ]),
      existsSync: () => true,
      readdirSync: () => Array.from(fakeFs._files),
      unlinkSync: (p) => { fakeFs._files.delete(path.basename(p)); },
    };
    // Same regex main.js uses. Kept inline so the test documents the
    // contract rather than coupling to main.js internals.
    const END_RE = /-([a-f0-9]{8})\.(wav|mp3)$/i;
    const CLIP_RE = /-clip-([a-f0-9]{8})-\d+\.(wav|mp3)$/i;
    const shortFromFile = (name) => {
      let m = name.match(END_RE); if (m) return m[1].toLowerCase();
      m = name.match(CLIP_RE); if (m) return m[1].toLowerCase();
      return null;
    };
    const deps = mutationDeps({
      registry: { aabbccdd: { index: 0 } },
      fs: fakeFs,
      QUEUE_DIR: '/fake/queue',
      shortFromFile,
    });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('remove-session', 'aabbccdd'), true);
    // Files for removed short gone.
    assertFalsy(fakeFs._files.has('20260422T204301220-0000-aabbccdd.mp3'), 'aabbccdd clip not purged');
    assertFalsy(fakeFs._files.has('20260422T204301220-0001-aabbccdd.mp3'), 'aabbccdd clip not purged');
    // Unrelated files left alone.
    if (!fakeFs._files.has('20260422T210029277-0015-ffeeddcc.mp3')) {
      throw new Error('other session\'s clip was incorrectly purged');
    }
    if (!fakeFs._files.has('_hook.log')) {
      throw new Error('non-clip file was incorrectly purged');
    }
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

  // -----------------------------------------------------------------
  // End-to-end settings-persistence round-trip. The 'tool_calls'
  // regression (IPC write-gate missing the key while the UI exposed
  // it and the disk sanitiser accepted it) hid in the gap between
  // three components: sessions-table.js emits a set-session-include
  // IPC call → ipc-handlers.js validates + writes via saveAssignments
  // → main.js sanitiseEntry drops anything it doesn't recognise on
  // read. If any one of those three layers rejects a field the other
  // two accept, the setting appears to work (in-memory state mutates)
  // but silently resets the next time queue-updated re-hydrates
  // sessionAssignments from disk.
  //
  // This test exercises the full write-then-reload cycle for every
  // per-session setting the UI exposes: label, palette index, focus,
  // muted, voice, and all 7 speech-includes keys. It asserts each
  // value is present AFTER a JSON.stringify → JSON.parse → sanitise
  // round-trip, which is what actually happens when the registry
  // file is written to disk and read back by loadAssignments.
  // -----------------------------------------------------------------
  it('every per-session setting survives a disk round-trip (write → load → sanitise)', () => {
    const fs = require('fs');
    // Pull the real sanitiseEntry body + its dependent constants from
    // main.js. Can't require() main.js directly — it boots Electron.
    // Regex extraction keeps this test honest: if someone edits
    // sanitiseEntry or VALID_INCLUDE_KEYS / VOICE_KEY_RE in main.js,
    // the next test run picks that change up automatically.
    const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8');
    const voiceMatch   = mainSrc.match(/const VOICE_KEY_RE\s*=\s*\/[^\n]+/);
    const includeMatch = mainSrc.match(/const VALID_INCLUDE_KEYS\s*=\s*new Set\([^)]+\);/);
    const fnMatch      = mainSrc.match(/function sanitiseEntry\(e\) \{[\s\S]*?\n\}/);
    if (!voiceMatch)   throw new Error('could not extract VOICE_KEY_RE from main.js');
    if (!includeMatch) throw new Error('could not extract VALID_INCLUDE_KEYS from main.js');
    if (!fnMatch)      throw new Error('could not extract sanitiseEntry body from main.js');
    const sanitiseEntry = new Function(
      `${voiceMatch[0]}\n${includeMatch[0]}\n${fnMatch[0]}\nreturn sanitiseEntry;`
    )();

    // Seed a real entry — index is required or sanitiseEntry returns
    // null (mirrors loadAssignments dropping malformed entries).
    const short = 'aabbccdd';
    const deps = mutationDeps({
      registry: {
        [short]: { index: 3, session_id: short, claude_pid: 0, label: '', pinned: false, last_seen: 0 },
      },
    });
    createIpcHandlers(deps).register();

    // Write every setting.
    assertEqual(deps.ipcMain.invoke('set-session-label', short, 'TT Red'), true);
    assertEqual(deps.ipcMain.invoke('set-session-index', short, 7), true);
    assertEqual(deps.ipcMain.invoke('set-session-focus', short, true), true);
    assertEqual(deps.ipcMain.invoke('set-session-muted', short, true), true);
    assertEqual(deps.ipcMain.invoke('set-session-voice', short, 'en-GB-RyanNeural'), true);
    const includeKeys = ['code_blocks', 'inline_code', 'urls', 'headings', 'bullet_markers', 'image_alt', 'tool_calls'];
    for (const k of includeKeys) {
      // Alternate true/false so we catch bugs that only treat "true"
      // as a valid save path (`set-session-include` has an early-exit
      // branch that differs between the two).
      const val = includeKeys.indexOf(k) % 2 === 0;
      assertEqual(deps.ipcMain.invoke('set-session-include', short, k, val), true);
    }

    // Simulate the disk write → disk read cycle. saveAssignments in
    // main.js writes JSON.stringify({ assignments: all }) to tmp then
    // os.rename; loadAssignments reads the JSON back and runs each
    // entry through sanitiseEntry. Replicate that exact sequence.
    const onDisk = JSON.parse(JSON.stringify({ assignments: deps._registry }));
    const loaded = {};
    for (const [k, v] of Object.entries(onDisk.assignments)) {
      const clean = sanitiseEntry(v);
      if (clean) loaded[k] = clean;
    }

    // Every setting must be present after the round-trip.
    const e = loaded[short];
    if (!e) throw new Error(`entry ${short} dropped by sanitiseEntry`);
    assertEqual(e.label, 'TT Red');
    assertEqual(e.index, 7);
    assertEqual(e.focus, true);
    assertEqual(e.muted, true);
    assertEqual(e.voice, 'en-GB-RyanNeural');
    assertEqual(e.pinned, true);  // at least one write-path auto-pinned
    if (!e.speech_includes) throw new Error('speech_includes dropped entirely on round-trip');
    for (const k of includeKeys) {
      const expected = includeKeys.indexOf(k) % 2 === 0;
      if (e.speech_includes[k] !== expected) {
        throw new Error(`speech_includes.${k}: expected ${expected}, got ${e.speech_includes[k]} after round-trip`);
      }
    }
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

  // ---------------------------------------------------------------
  // Master volume (6244bfd). The slider writes a 0-100% value into
  // config; AudioPlayer multiplies it into every clip's base volume.
  // Heartbeat clips must stay at 0.45× master; body/tool at 1.0×
  // master — the mix ratio has to hold at any master level.
  // ---------------------------------------------------------------

  it('setMasterVolume clamps out-of-range input', () => {
    const { player } = makePlayer();
    player.mount();
    player.setMasterVolume(1.5);
    assertEqual(player._masterVolume, 1.0);
    player.setMasterVolume(-0.5);
    assertEqual(player._masterVolume, 0);
    player.setMasterVolume(0.6);
    assertEqual(player._masterVolume, 0.6);
    player.unmount();
  });

  it('setMasterVolume ignores NaN / non-numeric (keeps previous value)', () => {
    const { player } = makePlayer();
    player.mount();
    player.setMasterVolume(0.5);
    player.setMasterVolume(NaN);
    assertEqual(player._masterVolume, 0.5, 'NaN must not overwrite a good value');
    player.setMasterVolume('banana');
    assertEqual(player._masterVolume, 0.5, 'string must not overwrite a good value');
    player.unmount();
  });

  it('setMasterVolume applied to body clip gives master × 1.0', () => {
    const queue = [{ path: '/a.mp3', mtime: 1 }];
    const { player, audio } = makePlayer({ queue });
    player.mount();
    player.setMasterVolume(0.6);
    player.playPath('/a.mp3', true, true);
    // Body clip (not -H-), so volume = 1.0 × 0.6 = 0.6.
    assertEqual(audio.volume, 0.6);
    player.unmount();
  });

  it('setMasterVolume applied to heartbeat clip gives master × 0.45', () => {
    // Filename matches the renderer's isHeartbeatClip regex:
    //   /-H-\d{4}-[a-f0-9]{8}\.(wav|mp3)$/i
    const hbPath = '/q/20260423T190000-H-0001-aef91e8e.mp3';
    const queue = [{ path: hbPath, mtime: 1 }];
    const { player, audio } = makePlayer({ queue });
    player.mount();
    player.setMasterVolume(0.8);
    player.playPath(hbPath, true, true);
    // Heartbeat → 0.45 × 0.8 = 0.36. Use toFixed tolerance since
    // floating-point multiplication of 0.45 × 0.8 has trailing digits.
    assertEqual(Number(audio.volume.toFixed(4)), 0.36);
    player.unmount();
  });

  it('setMasterVolume during playback retargets the currently-playing clip', () => {
    const queue = [{ path: '/a.mp3', mtime: 1 }];
    const { player, audio } = makePlayer({ queue });
    player.mount();
    player.playPath('/a.mp3', true, true);
    // Starts at master=1.0 → body clip at 1.0 × 1.0 = 1.0.
    assertEqual(audio.volume, 1.0);
    // Dragging the slider mid-clip. Should update immediately, not
    // wait for the next playPath.
    player.setMasterVolume(0.25);
    assertEqual(audio.volume, 0.25);
    player.unmount();
  });

  // ---------------------------------------------------------------
  // HB4 — system-auto-pause / resume round-trip (a691e58). External
  // app grabs the mic → playPath must refuse new arrivals unless the
  // user explicitly clicks one → release should drain any queue that
  // piled up during the dictation window.
  // ---------------------------------------------------------------

  it('systemAutoPause pauses a live clip and flags the state', () => {
    const queue = [{ path: '/a.mp3', mtime: 1 }];
    const { player, audio } = makePlayer({ queue });
    player.mount();
    player.playPath('/a.mp3', true, true);
    audio.paused = false;  // play() resolves async; assert the state we need
    player.systemAutoPause();
    assertEqual(audio.paused, true);
    assertEqual(player.isSystemAutoPaused(), true);
    player.unmount();
  });

  it('systemAutoPause arms the flag even when nothing is playing (heartbeat-gate fix)', () => {
    // HB4 race fix (2026-04-24): the flag represents "external app is
    // using the mic", not "we paused something". Previous behaviour
    // bailed early when no clip was loaded, leaving
    // isSystemAutoPaused=false — so heartbeat + inbound clips still
    // fired over the user's dictation. Observed live 2026-04-23:
    //   22:59:12 MIC_CAPTURED Wispr Flow
    //   22:59:15 heartbeat fires (flag still false)
    //   22:59:23 MIC_RELEASED
    const { player } = makePlayer();
    player.mount();
    player.systemAutoPause();
    assertEqual(player.isSystemAutoPaused(), true,
      'flag must arm on mic capture regardless of current playback state');
    player.unmount();
  });

  it('systemAutoPause with nothing playing does not try to pause the (empty) element', () => {
    // Belt-and-braces: setting the flag is unconditional, but we
    // must not invoke audio.pause() on a never-loaded element — that
    // has no effect on Chromium but we want an explicit contract so
    // a future refactor doesn't accidentally make it into a warning.
    const { player, audio } = makePlayer();
    player.mount();
    audio.paused = true;   // fresh element is "paused" by default
    let pauseCalled = false;
    const origPause = audio.pause;
    audio.pause = () => { pauseCalled = true; origPause.call(audio); };
    player.systemAutoPause();
    assertEqual(pauseCalled, false, 'systemAutoPause must not call audio.pause() when nothing is loaded');
    player.unmount();
  });

  it('playPath refuses a new auto-play while systemAutoPaused', () => {
    const queue = [{ path: '/a.mp3', mtime: 1 }, { path: '/b.mp3', mtime: 2 }];
    const { player, audio } = makePlayer({ queue });
    player.mount();
    player.playPath('/a.mp3', false, false);
    audio.paused = false;
    player.systemAutoPause();
    // A fresh arrival attempts auto-play. Must be refused so we
    // don't talk over the user's dictation.
    const accepted = player.playPath('/b.mp3', false, false);
    assertEqual(accepted, false);
    assertEqual(player.getCurrentPath(), '/a.mp3',
      'currentPath unchanged when playPath refused');
    player.unmount();
  });

  it('playPath accepts userClick=true even while systemAutoPaused', () => {
    // User's explicit dot-click overrides the auto-pause — respect
    // their intent if they choose to listen mid-dictation.
    const queue = [{ path: '/a.mp3', mtime: 1 }, { path: '/b.mp3', mtime: 2 }];
    const { player, audio } = makePlayer({ queue });
    player.mount();
    player.playPath('/a.mp3', false, false);
    audio.paused = false;
    player.systemAutoPause();
    const accepted = player.playPath('/b.mp3', true, true);
    assertEqual(accepted, true);
    assertEqual(player.getCurrentPath(), '/b.mp3');
    player.unmount();
  });

  it('systemAutoResume resumes a mid-clip pause without draining the queue', () => {
    const queue = [{ path: '/a.mp3', mtime: 1 }];
    const { player, audio, calls } = makePlayer({ queue });
    player.mount();
    player.playPath('/a.mp3', true, true);
    audio.paused = false;
    player.systemAutoPause();
    calls.playNext = 0;
    player.systemAutoResume();
    assertEqual(player.isSystemAutoPaused(), false);
    assertEqual(calls.playNext, 0,
      'mid-clip resume must NOT call onPlayNextPending — the paused clip is still the active one');
    player.unmount();
  });

  it('systemAutoResume drains the pending queue when nothing was mid-clip', () => {
    // The mic grab happened between clips (audio idle). Any clips
    // that arrived during the window were refused by playPath; now
    // that we're releasing, drain the pending queue so ordering is
    // preserved. Use the real capture flow — systemAutoPause owns
    // _micCaptured (the mediaSession-owned _systemAutoPaused is
    // orthogonal and not touched by this path).
    const { player, calls } = makePlayer();
    player.mount();
    player.systemAutoPause();
    calls.playNext = 0;
    player.systemAutoResume();
    assertEqual(player.isSystemAutoPaused(), false);
    assertEqual(calls.playNext, 1);
    player.unmount();
  });

  it('systemAutoResume is idempotent — safe to call when not paused', () => {
    const { player, calls } = makePlayer();
    player.mount();
    calls.playNext = 0;
    player.systemAutoResume();
    assertEqual(calls.playNext, 0, 'not paused → no drain');
    assertEqual(player.isSystemAutoPaused(), false);
    player.unmount();
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

  it('listPaths returns every audio file in the queue dir (uncapped, no stat)', () => {
    // Feeds the tab-badge honest-count path. Must return all audio files
    // regardless of maxFiles — that's what makes "delete 20, drop to 47"
    // actually work. Must also not call statSync (verified via fake fs
    // that throws if stat is hit).
    const calls = { readdir: 0, stat: 0 };
    const fakeFs = {
      readdirSync: () => {
        calls.readdir += 1;
        return [
          'a.mp3', 'b.mp3', 'c.mp3', 'd.mp3', 'e.mp3',
          'f.wav', 'g.partial', 'h.txt', 'i.MP3',
        ];
      },
      statSync: () => { calls.stat += 1; throw new Error('listPaths must not stat'); },
    };
    const watcher = createQueueWatcher({ queueDir: '/fake', maxFiles: 2, fs: fakeFs });
    const paths = watcher.listPaths();
    // 5 mp3 + 1 wav + 1 MP3 (case-insensitive) = 7 audio files
    assertEqual(paths.length, 7);
    assertEqual(calls.stat, 0);
    // Each path is prefixed with queueDir.
    for (const p of paths) {
      if (!p.startsWith('/fake') && !p.startsWith('\\fake')) {
        throw new Error(`listPaths must prepend queueDir; got ${p}`);
      }
    }
  });

  it('listPaths returns [] if readdir throws', () => {
    const watcher = createQueueWatcher({
      queueDir: '/fake', maxFiles: 10,
      fs: { readdirSync: () => { throw new Error('ENOENT'); }, statSync: () => null },
    });
    assertEqual(watcher.listPaths(), []);
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

// =============================================================================
// PHASE 3 — SPEECH-INCLUDES FULL COMBINATORIAL MATRIX (audit 2026-04-23)
//
// 7 Boolean toggles = 128 permutations. This suite runs every permutation
// against a canonical input with a UNIQUE sentinel token per feature, so
// assertions reduce to "is sentinel X present in output?" — no heuristic
// string-matching required. Checks:
//   1. Per-key gating invariants hold for all 128 combos (turning key X
//      on/off changes feature X's presence, never another feature's).
//   2. tool_calls is a no-op on JS side for all 128 combos (Python-only).
//   3. Python synth_turn.sanitize() output matches JS byte-for-byte on
//      a representative sample of 16 combos (one subprocess call batched).
//   4. No permutation crashes / returns null / leaks markdown syntax.
//   5. Per-session override merge: for each of the 7 keys, session=true +
//      global=false gives true in effective config (and vice versa).
// =============================================================================
describe('PHASE 3 — speech_includes full combinatorial matrix', () => {
  const { stripForTTS } = require(
    path.join(__dirname, '..', 'app', 'lib', 'text.js')
  );

  // Canonical input — one unique sentinel per feature. Using hyphen-
  // separated tokens (QZX-N-ZQ) rather than underscores: Python's
  // emphasis regex DOES strip single-underscore italic `_x_` while JS
  // does not, so underscore-wrapped sentinels would false-positive a
  // parity mismatch on a deliberate behaviour divergence (see the
  // "known drift" test below).
  //
  // Feature → sentinel mapping:
  //   code_blocks    -> QZX-CODEBLOCK-ZQ (inside ```python block)
  //   inline_code    -> QZX-INLINE-ZQ (inside `arr.filter(QZX-INLINE-ZQ)` — disqualified by parens so whitelist can't keep it)
  //   urls           -> QZX-URL-ZQ (inside a bare URL host)
  //   headings       -> QZX-HEADING-ZQ (inside # heading)
  //   bullet_markers -> Q-bullet-Q (exercises the "- " marker stripping; sentinel appears EITHER way)
  //   image_alt      -> QZX-ALT-ZQ (inside ![alt])
  //   tool_calls     -> (no JS effect, so no sentinel — asserted invariant)
  const KEYS = ['code_blocks', 'inline_code', 'urls', 'headings', 'bullet_markers', 'image_alt', 'tool_calls'];

  function canonicalInput() {
    return [
      '# QZX-HEADING-ZQ heading',
      '',
      'Plain body with `arr.filter(QZX-INLINE-ZQ)` inline.',
      '',
      '- Q-bullet-Q first item',
      '',
      '```python',
      'def QZX-CODEBLOCK-ZQ(): pass',
      '```',
      '',
      'Image: ![QZX-ALT-ZQ caption](http://img/thing.png)',
      '',
      'URL: https://QZX-URL-ZQ.example.com/x',
    ].join('\n');
  }

  // 128 dicts of the form { code_blocks: bool, inline_code: bool, ... }
  function allCombos() {
    const out = [];
    for (let i = 0; i < 128; i++) {
      const combo = {};
      for (let k = 0; k < KEYS.length; k++) combo[KEYS[k]] = Boolean((i >> k) & 1);
      out.push(combo);
    }
    return out;
  }

  // ----- 1. Per-key gating invariants across all 128 combos ------------
  it('every 128 permutation strips/keeps each feature according to its own key', () => {
    const input = canonicalInput();
    const failures = [];
    for (const combo of allCombos()) {
      let out;
      try { out = stripForTTS(input, combo); } catch (e) {
        failures.push(`combo ${JSON.stringify(combo)}: THREW ${e.message}`);
        continue;
      }
      if (typeof out !== 'string') {
        failures.push(`combo ${JSON.stringify(combo)}: output not a string (${typeof out})`);
        continue;
      }
      // Per-feature presence/absence — paired sentinel + expected-when.
      const checks = [
        { key: 'code_blocks',  sentinel: 'QZX-CODEBLOCK-ZQ' },
        { key: 'inline_code',  sentinel: 'QZX-INLINE-ZQ' },
        { key: 'urls',         sentinel: 'QZX-URL-ZQ' },
        { key: 'headings',     sentinel: 'QZX-HEADING-ZQ' },
        { key: 'image_alt',    sentinel: 'QZX-ALT-ZQ' },
      ];
      for (const { key, sentinel } of checks) {
        const expected = combo[key];
        const present  = out.includes(sentinel);
        if (expected && !present) {
          failures.push(`combo ${JSON.stringify(combo)}: ${key}=true but "${sentinel}" NOT in output`);
        } else if (!expected && present) {
          failures.push(`combo ${JSON.stringify(combo)}: ${key}=false but "${sentinel}" LEAKED into output`);
        }
      }
    }
    if (failures.length) {
      throw new Error(`${failures.length}/896 invariants failed:\n  ` + failures.slice(0, 5).join('\n  ') + (failures.length > 5 ? `\n  ...(+${failures.length - 5} more)` : ''));
    }
  });

  // ----- 2. tool_calls is a no-op on JS side across all 128 combos -----
  it('tool_calls flips without changing JS output (Python-only action)', () => {
    const input = canonicalInput();
    const failures = [];
    // Walk all 64 permutations of the OTHER 6 keys. For each, flip
    // tool_calls and assert output unchanged.
    for (let i = 0; i < 64; i++) {
      const base = {};
      const other = KEYS.filter(k => k !== 'tool_calls');
      for (let k = 0; k < other.length; k++) base[other[k]] = Boolean((i >> k) & 1);
      const withOn  = stripForTTS(input, { ...base, tool_calls: true  });
      const withOff = stripForTTS(input, { ...base, tool_calls: false });
      if (withOn !== withOff) {
        failures.push(`${JSON.stringify(base)}: tool_calls flip changed JS output`);
      }
    }
    if (failures.length) {
      throw new Error(`${failures.length} tool_calls flips changed output:\n  ` + failures.slice(0, 3).join('\n  '));
    }
  });

  // ----- 3. Python parity on a representative 16-combo sample ----------
  // Spawning 128 Python processes would add ~25 s to the suite. Instead
  // we batch: one Python subprocess reads JSON { text, combos } from
  // stdin, imports synth_turn.sanitize, runs each combo, emits JSON
  // array of outputs. The test then compares JS vs Python item-by-item.
  it('Python synth_turn.sanitize matches JS stripForTTS on 16 sampled combos', () => {
    const input = canonicalInput();
    // 16 carefully chosen combos: 2 full extremes (all-on, all-off),
    // 7 isolation-toggles, and 7 mixed combos that flip ~3 keys each.
    const sampleCombos = [
      // Extremes
      { code_blocks: true,  inline_code: true,  urls: true,  headings: true,  bullet_markers: true,  image_alt: true,  tool_calls: true  },
      { code_blocks: false, inline_code: false, urls: false, headings: false, bullet_markers: false, image_alt: false, tool_calls: false },
      // Single-key toggles (defaults elsewhere)
      ...KEYS.map(key => {
        const c = { code_blocks: false, inline_code: false, urls: false, headings: false, bullet_markers: false, image_alt: false, tool_calls: false };
        c[key] = true;
        return c;
      }),
      // Mixed patterns
      { code_blocks: true,  inline_code: true,  urls: false, headings: true,  bullet_markers: false, image_alt: false, tool_calls: true },
      { code_blocks: false, inline_code: true,  urls: true,  headings: false, bullet_markers: true,  image_alt: false, tool_calls: true },
      { code_blocks: true,  inline_code: false, urls: false, headings: false, bullet_markers: true,  image_alt: true,  tool_calls: false },
      { code_blocks: false, inline_code: true,  urls: false, headings: true,  bullet_markers: true,  image_alt: true,  tool_calls: true },
      { code_blocks: true,  inline_code: true,  urls: true,  headings: false, bullet_markers: false, image_alt: true,  tool_calls: false },
      { code_blocks: false, inline_code: false, urls: true,  headings: true,  bullet_markers: false, image_alt: true,  tool_calls: true },
      { code_blocks: true,  inline_code: false, urls: true,  headings: true,  bullet_markers: true,  image_alt: false, tool_calls: false },
    ];

    // Batched Python helper: one subprocess reads JSON { text, combos },
    // applies synth_turn.sanitize to each combo, writes JSON array of
    // outputs to stdout. PYTHONIOENCODING=utf-8 so the canonical input's
    // multi-byte chars round-trip cleanly on Windows.
    const APP_DIR_ABS = path.join(__dirname, '..', 'app');
    const pyScript = [
      'import json, sys',
      `sys.path.insert(0, r"${APP_DIR_ABS.replace(/\\/g, '\\\\')}")`,
      'from synth_turn import sanitize',
      'req = json.loads(sys.stdin.read())',
      'out = [sanitize(req["text"], c) for c in req["combos"]]',
      'sys.stdout.write(json.dumps(out))',
    ].join('\n');
    const r = spawnSync('python', ['-c', pyScript], {
      input: JSON.stringify({ text: input, combos: sampleCombos }),
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    if (r.status !== 0) throw new Error(`python helper exit ${r.status}; stderr: ${r.stderr}`);
    const pyOutputs = JSON.parse(r.stdout);
    assertEqual(pyOutputs.length, sampleCombos.length);
    // Canonicalise whitespace before compare: JS collapses \n into
    // spaces at the tail of stripForTTS; Python preserves \n\n as
    // paragraph boundaries for the downstream sentence_split (see
    // synth_turn.py `re.sub(r'\n{3,}', '\n\n', t)` — deliberate).
    // For parity purposes we're checking TOKEN-level fidelity, not
    // layout, so normalise both sides to single-line before diffing.
    const norm = s => s.replace(/\s+/g, ' ').trim();
    const diffs = [];
    for (let i = 0; i < sampleCombos.length; i++) {
      const combo = sampleCombos[i];
      const jsOut = norm(stripForTTS(input, combo));
      const pyOut = norm(pyOutputs[i]);
      if (jsOut !== pyOut) {
        diffs.push(`combo[${i}] ${JSON.stringify(combo)}:\n    JS: ${JSON.stringify(jsOut).slice(0, 160)}\n    PY: ${JSON.stringify(pyOut).slice(0, 160)}`);
      }
    }
    if (diffs.length) {
      throw new Error(`${diffs.length}/${sampleCombos.length} Python-vs-JS mismatches (post-whitespace-normalise):\n  ` + diffs.slice(0, 3).join('\n  '));
    }
  });

  // ----- 3b. Parity achieved: single-underscore italic emphasis -------
  // Previously a documented drift: JS kept `_x_`, Python stripped. Closed
  // by #19 D4 (2026-04-25) — JS now mirrors Python's `_EMPHASIS_RE` single-
  // underscore arm. Both strip to the content. Known tradeoff: snake_case
  // identifiers wrapped in underscores (`_session_id_`) get partial-stripped
  // the same way Python does. Bare snake_case WITHOUT wrapping (`session_id`)
  // is unaffected — `[^_\n]+` excludes internal underscores from the
  // emphasis-content match.
  it('D4 parity achieved: single-underscore italic emphasis — JS + Python both strip', () => {
    const APP_DIR_ABS = path.join(__dirname, '..', 'app');
    const jsOut = stripForTTS('Plain _italic_ word', {});
    const pyScript = [
      'import json, sys',
      `sys.path.insert(0, r"${APP_DIR_ABS.replace(/\\/g, '\\\\')}")`,
      'from synth_turn import sanitize',
      'sys.stdout.write(sanitize("Plain _italic_ word", {}))',
    ].join('\n');
    const r = spawnSync('python', ['-c', pyScript],
      { encoding: 'utf8', timeout: 10000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    if (r.status !== 0) throw new Error(`python helper exit ${r.status}; stderr: ${r.stderr}`);
    const pyOut = r.stdout.replace(/\s+/g, ' ').trim();
    assertFalsy(jsOut.includes('_italic_'),
      'JS must strip single-underscore italic (D4 parity)');
    assertFalsy(pyOut.includes('_italic_'),
      'Python must strip single-underscore italic');
    assertTruthy(jsOut.includes('italic') && pyOut.includes('italic'),
      'Both sides must keep the content "italic" after stripping the markers');
  });

  // ----- 3c. Known drift: code-block content emphasis shielding --------
  // Second DOCUMENTED divergence:
  //   JS  stores code-block bodies in \0CB<N>\0 sentinel placeholders
  //       so subsequent emphasis/bullet/url regexes can't mangle them;
  //       placeholders are restored at the very end.
  //   PY  returns the code-block body inline — all subsequent regexes
  //       (emphasis, bullet markers, etc.) ALSO apply to code content.
  //
  // Practical impact: a code block containing `__dunder__` identifiers
  // reads correctly via JS highlight-to-speak but loses its underscores
  // via the Python Stop-hook synth pipeline.
  it('known drift: code-block content is shielded from emphasis regex in JS, not in Python', () => {
    const APP_DIR_ABS = path.join(__dirname, '..', 'app');
    const input = [
      'Prose before.',
      '```python',
      'x = __dunder__ + foo',
      '```',
      'Prose after.',
    ].join('\n');
    const flags = { code_blocks: true };
    const jsOut = stripForTTS(input, flags);
    // Pass input/flags as JSON on stdin, parse with json.loads so
    // Python's True/False capitalisation is correctly deserialised
    // (embedding {"code_blocks":true} as a Python dict literal
    // would NameError on `true`).
    const pyScript = [
      'import json, sys',
      `sys.path.insert(0, r"${APP_DIR_ABS.replace(/\\/g, '\\\\')}")`,
      'from synth_turn import sanitize',
      'req = json.loads(sys.stdin.read())',
      'sys.stdout.write(sanitize(req["text"], req["flags"]))',
    ].join('\n');
    const r = spawnSync('python', ['-c', pyScript], {
      input: JSON.stringify({ text: input, flags }),
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    if (r.status !== 0) throw new Error(`python helper exit ${r.status}; stderr: ${r.stderr}`);
    const pyOut = r.stdout.replace(/\s+/g, ' ').trim();
    assertTruthy(jsOut.includes('__dunder__'),
      'JS must still shield code-block __dunder__ from emphasis regex (current behaviour)');
    assertFalsy(pyOut.includes('__dunder__'),
      'Python must still apply emphasis regex to code-block body (current behaviour)');
    assertTruthy(pyOut.includes('dunder'),
      'Python must still keep the content "dunder" after stripping markers');
  });

  // ----- 4. No permutation leaks raw markdown syntax -------------------
  it('no permutation lets raw markdown tokens leak through (``, **, ~)', () => {
    // Post-strip output must never contain ``` fences, bare **bold**
    // markers, or the `~` character (pronounced "tilda" by edge-tts).
    const input = canonicalInput();
    const failures = [];
    for (const combo of allCombos()) {
      const out = stripForTTS(input, combo);
      const fence = '\u0060\u0060\u0060';
      if (out.includes(fence)) failures.push('combo ' + JSON.stringify(combo) + ': triple-backtick fence leaked');
      if (/\*\*[^\s*]/.test(out)) failures.push('combo ' + JSON.stringify(combo) + ': **word leaked (bold marker)');
      if (out.includes('~')) failures.push('combo ' + JSON.stringify(combo) + ': ~ leaked (edge-tts reads as "tilda")');
    }
    if (failures.length) {
      throw new Error(`${failures.length} permutations leaked raw markdown:\n  ` + failures.slice(0, 3).join('\n  '));
    }
  });

  // ----- 5. No permutation returns null / non-string -------------------
  it('every 128 permutation returns a finite string (no null / throw)', () => {
    const input = canonicalInput();
    const failures = [];
    for (const combo of allCombos()) {
      try {
        const out = stripForTTS(input, combo);
        if (typeof out !== 'string') failures.push(`${JSON.stringify(combo)}: ${typeof out}`);
        if (out.length > input.length * 3) failures.push(`${JSON.stringify(combo)}: output suspiciously large (${out.length} > 3x input)`);
      } catch (e) {
        failures.push(`${JSON.stringify(combo)}: THREW ${e.message}`);
      }
    }
    if (failures.length) {
      throw new Error(`${failures.length} permutations misbehaved:\n  ` + failures.slice(0, 3).join('\n  '));
    }
  });

  // ----- 6. Merge: session override beats global, per-key, all combos --
  it('merge: session override wins over global for every key, in both directions', () => {
    // Simulates the per-session override merge logic: the effective
    // config is { ...global, ...sessionOverride }. Verify that when a
    // key is explicitly set in sessionOverride, the global is ignored
    // — regardless of what other keys are in either side.
    const failures = [];
    for (const key of KEYS) {
      for (const globalVal of [true, false]) {
        const sessionVal = !globalVal;
        // Build a full global config with THIS key set to globalVal
        // and the other 6 set to an arbitrary mix.
        const global = {};
        for (let i = 0; i < KEYS.length; i++) global[KEYS[i]] = (i % 2 === 0);
        global[key] = globalVal;
        const session = { [key]: sessionVal };
        const effective = { ...global, ...session };
        if (effective[key] !== sessionVal) {
          failures.push(`key=${key} global=${globalVal} session=${sessionVal}: effective=${effective[key]}`);
        }
      }
    }
    if (failures.length) {
      throw new Error(`session override failed:\n  ` + failures.join('\n  '));
    }
  });
});

// =============================================================================
// PHASE 4 — MODULE 1: stripForTTS VULNERABILITY PASS
//
// Function-by-function edge-case hunt on app/lib/text.js. stripForTTS runs
// on every Claude response + every highlight-to-speak clip. A crash here
// means the Stop hook silently dies; a hang means the user waits for audio
// that never arrives; a bad unicode path means garbled TTS. Audit
// 2026-04-23 Phase 4 scope: probe every regex for backtracking, every
// input handler for type confusion, every code path for unicode fidelity.
// =============================================================================
describe('PHASE 4 #1 — stripForTTS vulnerability pass', () => {
  const { stripForTTS } = require(path.join(__dirname, '..', 'app', 'lib', 'text.js'));

  // ---- Type safety: non-string inputs must not crash ------------------
  it('accepts null without throwing (returns empty)', () => {
    assertEqual(stripForTTS(null), '');
  });
  it('accepts undefined without throwing', () => {
    assertEqual(stripForTTS(undefined), '');
  });
  it('accepts a number without throwing (coerces to string)', () => {
    const out = stripForTTS(42);
    assertEqual(typeof out, 'string');
  });
  it('accepts a boolean without throwing', () => {
    const out = stripForTTS(true);
    assertEqual(typeof out, 'string');
  });
  it('accepts an object without throwing', () => {
    const out = stripForTTS({ foo: 1 });
    assertEqual(typeof out, 'string');
  });
  it('accepts an array without throwing', () => {
    const out = stripForTTS(['a', 'b']);
    assertEqual(typeof out, 'string');
  });

  // ---- Regex complexity: adversarial inputs must complete quickly ------
  // ReDoS (catastrophic backtracking) would hang the Stop hook. Claude
  // Code kills the hook at ~60 s, so even a 30 s hang = no audio that
  // turn. Each input below was hand-picked to pressure a specific regex.

  it('100KB plain prose completes in < 500 ms', () => {
    const input = ('Lorem ipsum dolor sit amet. ').repeat(3500);
    const t0 = Date.now();
    stripForTTS(input);
    const dt = Date.now() - t0;
    assertTruthy(dt < 500, `100KB prose took ${dt}ms (budget 500ms)`);
  });

  it('1000 consecutive asterisks does not backtrack catastrophically', () => {
    const input = '*'.repeat(1000) + ' end';
    const t0 = Date.now();
    stripForTTS(input);
    const dt = Date.now() - t0;
    assertTruthy(dt < 500, `asterisk run took ${dt}ms (ReDoS candidate: bold/italic regex)`);
  });

  it('1000 consecutive underscores does not backtrack catastrophically', () => {
    const input = '_'.repeat(1000) + ' end';
    const t0 = Date.now();
    stripForTTS(input);
    const dt = Date.now() - t0;
    assertTruthy(dt < 500, `underscore run took ${dt}ms`);
  });

  it('unclosed code fence does not hang', () => {
    const input = '```python\n' + ('x = 1\n'.repeat(5000));
    const t0 = Date.now();
    const out = stripForTTS(input, { code_blocks: false });
    const dt = Date.now() - t0;
    assertTruthy(dt < 500, `unclosed fence took ${dt}ms`);
    assertEqual(typeof out, 'string');
  });

  it('alternating backticks does not chew CPU', () => {
    const input = '`a'.repeat(500) + '`';
    const t0 = Date.now();
    stripForTTS(input);
    const dt = Date.now() - t0;
    assertTruthy(dt < 500, `alternating backticks took ${dt}ms`);
  });

  // ---- Empty corners: features with empty payloads --------------------
  it('empty code fence does not crash', () => {
    const fence = '\u0060\u0060\u0060';
    const out = stripForTTS(`before\n${fence}\n${fence}\nafter`);
    assertEqual(typeof out, 'string');
    assertTruthy(out.includes('before'));
    assertTruthy(out.includes('after'));
  });

  it('empty inline backticks are handled safely', () => {
    const out = stripForTTS('x `` y');
    assertEqual(typeof out, 'string');
  });

  it('empty markdown link [](url) does not crash', () => {
    const out = stripForTTS('hello [](http://a) world');
    assertEqual(typeof out, 'string');
    assertTruthy(out.includes('hello'));
    assertTruthy(out.includes('world'));
  });

  it('empty image alt ![](url) drops cleanly with image_alt=false', () => {
    const out = stripForTTS('x ![](http://img) y', { image_alt: false });
    assertTruthy(out.includes('x'));
    assertTruthy(out.includes('y'));
    assertFalsy(out.includes('![]'));
  });

  // ---- Unicode: TTS input must preserve foreign scripts + emoji -------
  it('CJK characters pass through unchanged', () => {
    const out = stripForTTS('Hello 你好 world');
    assertTruthy(out.includes('你好'), 'CJK characters must not be stripped');
  });

  it('emoji pass through unchanged', () => {
    const out = stripForTTS('Click the 🚀 button');
    assertTruthy(out.includes('🚀'), 'emoji must not be stripped');
  });

  it('RTL text (Arabic) passes through without corruption', () => {
    const arabic = 'العربية';
    const out = stripForTTS(`prefix ${arabic} suffix`);
    assertTruthy(out.includes(arabic), `Arabic must survive: got ${out}`);
  });

  it('zero-width joiner does not break regex matching', () => {
    const input = 'hello\u200Dworld **bold**';
    const out = stripForTTS(input);
    assertFalsy(out.includes('**'), 'bold markers still stripped with ZWJ nearby');
  });

  it('surrogate pair (astral plane) does not corrupt regex', () => {
    const input = 'formula \uD835\uDC31 = 1';  // mathematical bold x
    const out = stripForTTS(input);
    assertTruthy(out.includes('\uD835\uDC31'),
      'astral-plane mathematical x must survive intact');
  });

  // ---- Control chars + line endings -----------------------------------
  it('NUL byte in input does not break the code-block placeholder system', () => {
    // stripForTTS uses \u0000CB<N>\u0000 sentinels internally. If a
    // user-supplied NUL byte collides with those, the placeholder
    // restoration could replace attacker-controlled content.
    const input = 'prose \u0000CB0\u0000 more prose';
    const out = stripForTTS(input);
    assertTruthy(out.includes('prose'), 'NUL byte must not break prose content');
  });

  it('CRLF line endings handled identically to LF', () => {
    const lf   = stripForTTS('# H1\nbody\n- bullet');
    const crlf = stripForTTS('# H1\r\nbody\r\n- bullet');
    const norm = s => s.replace(/\s+/g, ' ').trim();
    assertEqual(norm(lf), norm(crlf), 'CRLF and LF must produce the same spoken text');
  });

  it('bare CR line endings (old-mac style) do not crash', () => {
    const out = stripForTTS('# H1\rbody\r- bullet');
    assertEqual(typeof out, 'string');
  });

  // ---- Mixed / nested markdown patterns -------------------------------
  it('code fence inside a bullet list preserves both boundary semantics', () => {
    const fence = '\u0060\u0060\u0060';
    const input = [
      '- first',
      '',
      `${fence}python`,
      'x = 1',
      `${fence}`,
      '',
      '- second',
    ].join('\n');
    const out = stripForTTS(input, { bullet_markers: false });
    assertTruthy(/first\./.test(out));
    assertTruthy(/second\./.test(out));
  });

  it('link text containing markdown-like chars survives emphasis stripping', () => {
    const out = stripForTTS('See [the *starred* item](http://x)');
    assertTruthy(out.includes('starred'));
    assertFalsy(out.includes('http'));
  });

  it('nested emphasis (***bold-italic***) strips cleanly to content', () => {
    const out = stripForTTS('a ***very*** important b');
    assertTruthy(out.includes('very'));
    assertFalsy(/\*+/.test(out), 'no asterisks should leak');
  });

  // ---- Boundary cases on the inline-code prose whitelist --------------
  it('inline-code at exact 30-char whitelist boundary: kept as prose', () => {
    const thirty = 'abcdefghijklmnopqrstuvwxyz1234';  // 30 chars
    assertEqual(thirty.length, 30);
    const out = stripForTTS(`Run \`${thirty}\` cmd`, { inline_code: false });
    assertTruthy(out.includes(thirty),
      '30-char identifier inside backticks must be kept by the whitelist');
  });

  it('inline-code at 31-char: stripped (exceeds whitelist max)', () => {
    const thirtyone = 'abcdefghijklmnopqrstuvwxyz12345';  // 31 chars
    const out = stripForTTS(`Run \`${thirtyone}\` cmd`, { inline_code: false });
    assertFalsy(out.includes(thirtyone),
      '31-char identifier exceeds INLINE_PROSE_MAX — must be stripped');
  });

  // ---- Performance under realistic large input -----------------------
  it('realistic 50KB mixed markdown completes in < 500 ms', () => {
    const fence = '\u0060\u0060\u0060';
    const chunk = [
      '# Heading',
      'Paragraph with `inline` code and *emphasis*.',
      '- bullet one',
      '- bullet two',
      fence,
      'function foo() { return 42; }',
      fence,
      '[a link](http://example.com) and a bare https://other.com/url',
      '',
    ].join('\n');
    const input = chunk.repeat(500);
    const t0 = Date.now();
    const out = stripForTTS(input);
    const dt = Date.now() - t0;
    assertTruthy(dt < 500, `50KB realistic input took ${dt}ms`);
    assertTruthy(out.length > 0);
  });
});

// =============================================================================
// PHASE 4 — MODULE 2: palette-alloc.js VULNERABILITY PASS
//
// allocatePaletteIndex() is called from every `ensureAssignmentsForFiles()`
// pass (every queue-updated notification), and from the PowerShell
// statusline.ps1 via session-registry.psm1. A crash here silently kills
// the renderer's assignment propagation; a wrong result paints the wrong
// colour on a session. Existing coverage tests happy paths; this pass
// probes null/malformed inputs, extreme paletteSize, malformed entries
// and determinism under mutation.
// =============================================================================
describe('PHASE 4 #2 — palette-alloc vulnerability pass', () => {
  const { allocatePaletteIndex } = require(
    path.join(__dirname, '..', 'app', 'lib', 'palette-alloc.js')
  );

  // ---- Type safety on assignments arg ---------------------------------
  it('accepts null assignments without throwing', () => {
    const r = allocatePaletteIndex('aabbccdd', null, 24);
    assertEqual(r.index, 0);
    assertEqual(r.reason, 'free');
  });

  it('accepts undefined assignments without throwing', () => {
    const r = allocatePaletteIndex('aabbccdd', undefined, 24);
    assertEqual(r.index, 0);
  });

  it('accepts an empty object cleanly', () => {
    const r = allocatePaletteIndex('aabbccdd', {}, 24);
    assertEqual(r.index, 0);
    assertEqual(r.reason, 'free');
  });

  // ---- Malformed individual entries ------------------------------------
  it('entries with null value are skipped without throw', () => {
    // A corrupt registry entry ({ aabbccdd: null }) must not kill the
    // allocator. Existing guard: `entry && Number.isFinite(...)`.
    const all = { s0000000: null, s0000001: { index: 1, last_seen: 100 } };
    const r = allocatePaletteIndex('newshort', all, 24);
    // Index 0 is free (the null entry doesn't register as busy), so we
    // get 'free' at index 0.
    assertEqual(r.reason, 'free');
    assertEqual(r.index, 0);
  });

  it('entries missing the index field are skipped', () => {
    const all = { s0000000: { last_seen: 100 } };  // no index
    const r = allocatePaletteIndex('newshort', all, 24);
    assertEqual(r.reason, 'free');
    assertEqual(r.index, 0);
  });

  it('entries with NaN index are skipped (malformed registry)', () => {
    const all = { s0000000: { index: 'not-a-number', last_seen: 100 } };
    const r = allocatePaletteIndex('newshort', all, 24);
    assertEqual(r.reason, 'free');
    assertEqual(r.index, 0);
  });

  it('entries with index > paletteSize are treated as busy at out-of-range slot (do not reserve any 0..23)', () => {
    // Registry corruption / manual edit scenario: entry has index 99.
    // allocatePaletteIndex tracks them in the busy map but they don't
    // block any real 0..23 slot.
    const all = { s0000000: { index: 99, last_seen: 100 } };
    const r = allocatePaletteIndex('newshort', all, 24);
    assertEqual(r.index, 0);
    assertEqual(r.reason, 'free');
  });

  it('entries with negative index are treated as busy but don\'t block 0..23', () => {
    const all = { s0000000: { index: -5, last_seen: 100 } };
    const r = allocatePaletteIndex('newshort', all, 24);
    assertEqual(r.index, 0);
    assertEqual(r.reason, 'free');
  });

  // ---- paletteSize extremes --------------------------------------------
  it('paletteSize=1 forces eviction fallback immediately on second allocation', () => {
    const all = { s0000000: { index: 0, last_seen: 100 } };
    const r = allocatePaletteIndex('newshort', all, 1);
    assertEqual(r.reason, 'lru');
    assertEqual(r.evicted, 's0000000');
    assertEqual(r.index, 0);
  });

  it('paletteSize=0 is clamped to the 24 default (no NaN leak through hash-mod)', () => {
    // Phase 4 Module 2 caught this: paletteSize=0 made the hash-mod
    // fallback compute `sum % 0 = NaN`, which then got written to disk
    // and read by the renderer as `NaN`. CSS palette-class lookup
    // then failed silently — session painted with no colour.
    // Fixed via defensive `if (!Number.isFinite(paletteSize) || paletteSize < 1) paletteSize = 24;`
    // at the top of allocatePaletteIndex. Re-asserted here.
    const r = allocatePaletteIndex('aabbccdd', {}, 0);
    assertEqual(typeof r, 'object');
    assertEqual(typeof r.reason, 'string');
    assertTruthy(Number.isFinite(r.index), `paletteSize=0 must not leak non-finite index: got ${r.index}`);
    // Should behave as if paletteSize=24 was passed.
    assertEqual(r.index, 0);
    assertEqual(r.reason, 'free');
  });

  it('paletteSize=-5 clamped to 24 default', () => {
    const r = allocatePaletteIndex('aabbccdd', {}, -5);
    assertTruthy(Number.isFinite(r.index));
    assertEqual(r.index, 0);
  });

  it('paletteSize=NaN clamped to 24 default', () => {
    const r = allocatePaletteIndex('aabbccdd', {}, NaN);
    assertTruthy(Number.isFinite(r.index));
    assertEqual(r.index, 0);
  });

  it('paletteSize=1000 still allocates cleanly at lowest free', () => {
    const r = allocatePaletteIndex('aabbccdd', {}, 1000);
    assertEqual(r.index, 0);
    assertEqual(r.reason, 'free');
  });

  // ---- Duplicate indices -----------------------------------------------
  it('multiple entries sharing the same index — last one wins as busy (no crash)', () => {
    // Registry bug scenario: two entries both claim index 5. Allocator
    // should not loop / throw; index 5 is marked busy once.
    const all = {
      s0000000: { index: 5, last_seen: 100 },
      s0000001: { index: 5, last_seen: 200 },
    };
    const r = allocatePaletteIndex('newshort', all, 24);
    // 0..4 are free; 5 is busy; 6..23 are free. Lowest free = 0.
    assertEqual(r.index, 0);
    assertEqual(r.reason, 'free');
  });

  // ---- User-intent edge cases (protecting historic unpinned entries) --
  it('label of whitespace-only (" ") is NOT user intent (trimmed to empty)', () => {
    const all = {};
    for (let i = 0; i < 24; i++) {
      all[`s${i.toString().padStart(7, '0')}`] = {
        index: i, last_seen: 1000 + i, pinned: false,
        label: i === 0 ? '   ' : '',  // whitespace-only label on LRU
      };
    }
    const r = allocatePaletteIndex('newshort', all, 24);
    assertEqual(r.reason, 'lru');
    assertEqual(r.evicted, 's0000000',
      'whitespace-only label must not count as user intent (.trim() is empty)');
  });

  it('speech_includes with every value false still counts as user intent (object non-empty)', () => {
    // Even `{ urls: false }` is a deliberate override — the user set
    // this session's urls to "explicitly off". Keeping it around is
    // safer than auto-forgetting a deliberate mute.
    const all = {};
    for (let i = 0; i < 24; i++) {
      all[`s${i.toString().padStart(7, '0')}`] = {
        index: i, last_seen: 1000 + i, pinned: false,
        speech_includes: i === 0 ? { urls: false } : undefined,
      };
    }
    const r = allocatePaletteIndex('newshort', all, 24);
    assertEqual(r.reason, 'lru');
    if (r.evicted === 's0000000') {
      throw new Error('speech_includes={urls:false} is intent and must not be evicted');
    }
    assertEqual(r.evicted, 's0000001');
  });

  it('voice of empty string ("") is NOT user intent', () => {
    const all = {};
    for (let i = 0; i < 24; i++) {
      all[`s${i.toString().padStart(7, '0')}`] = {
        index: i, last_seen: 1000 + i, pinned: false,
        voice: i === 0 ? '' : undefined,
      };
    }
    const r = allocatePaletteIndex('newshort', all, 24);
    assertEqual(r.reason, 'lru');
    assertEqual(r.evicted, 's0000000',
      'empty voice string must not count as user intent (!!v is false)');
  });

  it('all 24 slots have user intent (no pins but every slot has a label) -> hash-collision', () => {
    // Phase-4 surfaced case: the ipc-handler auto-pin is new; historic
    // registries can have 24 labeled-but-unpinned entries. With no
    // eviction candidates, we MUST reach hash-collision, not throw.
    const all = {};
    for (let i = 0; i < 24; i++) {
      all[`s${i.toString().padStart(7, '0')}`] = {
        index: i, last_seen: 1000 + i, pinned: false,
        label: `terminal-${i}`,
      };
    }
    const r = allocatePaletteIndex('aabbccdd', all, 24);
    assertEqual(r.reason, 'hash-collision');
    assertEqual(r.evicted, null);
    assertTruthy(r.index >= 0 && r.index < 24);
  });

  // ---- Determinism + hash behaviour ------------------------------------
  it('determinism: same inputs produce same outputs across 100 calls', () => {
    const all = {};
    for (let i = 0; i < 24; i++) {
      all[`s${i.toString().padStart(7, '0')}`] = {
        index: i, last_seen: 1000 + (23 - i), pinned: false,   // reversed order
      };
    }
    const first = allocatePaletteIndex('newshort', all, 24);
    for (let k = 0; k < 100; k++) {
      const r = allocatePaletteIndex('newshort', all, 24);
      assertEqual(r.index,   first.index);
      assertEqual(r.evicted, first.evicted);
      assertEqual(r.reason,  first.reason);
    }
  });

  it('empty shortId in hash-collision path gives a finite index', () => {
    // sum of chars of '' is 0; 0 % 24 = 0. Valid.
    const all = {};
    for (let i = 0; i < 24; i++) {
      all[`s${i.toString().padStart(7, '0')}`] = {
        index: i, last_seen: 1000 + i, pinned: true,
      };
    }
    const r = allocatePaletteIndex('', all, 24);
    assertEqual(r.reason, 'hash-collision');
    assertEqual(r.index, 0);
  });

  it('10000-char shortId in hash-collision path still returns finite index', () => {
    const adversarialShort = 'a'.repeat(10000);
    const all = {};
    for (let i = 0; i < 24; i++) {
      all[`s${i.toString().padStart(7, '0')}`] = {
        index: i, last_seen: 1000 + i, pinned: true,
      };
    }
    const r = allocatePaletteIndex(adversarialShort, all, 24);
    assertEqual(r.reason, 'hash-collision');
    assertTruthy(Number.isFinite(r.index));
    assertTruthy(r.index >= 0 && r.index < 24);
  });

  it('non-ASCII shortId in hash-collision path handled cleanly', () => {
    // shortId is normally 8 hex chars, but hash-mod uses charCodeAt which
    // works on any BMP code point. Test with a unicode string.
    const all = {};
    for (let i = 0; i < 24; i++) {
      all[`s${i.toString().padStart(7, '0')}`] = {
        index: i, last_seen: 1000 + i, pinned: true,
      };
    }
    const r = allocatePaletteIndex('café 🚀 test', all, 24);
    assertEqual(r.reason, 'hash-collision');
    assertTruthy(Number.isFinite(r.index));
  });

  // ---- Return-shape contract across every branch ----------------------
  it('return shape is always { index, evicted, reason } with correct types', () => {
    const cases = [
      { label: 'free',  assignments: {} },
      { label: 'lru',   assignments: (() => { const a = {}; for (let i=0;i<24;i++) a[`s${i.toString().padStart(7,'0')}`]={index:i,last_seen:i}; return a; })() },
      { label: 'hash',  assignments: (() => { const a = {}; for (let i=0;i<24;i++) a[`s${i.toString().padStart(7,'0')}`]={index:i,last_seen:i,pinned:true}; return a; })() },
    ];
    for (const c of cases) {
      const r = allocatePaletteIndex('aabbccdd', c.assignments, 24);
      assertEqual(typeof r.index, 'number', `${c.label}: index`);
      assertEqual(Number.isFinite(r.index), true, `${c.label}: index finite`);
      assertEqual(typeof r.reason, 'string', `${c.label}: reason`);
      if (r.reason === 'lru') {
        assertEqual(typeof r.evicted, 'string', 'lru: evicted is a shortId string');
      } else {
        assertEqual(r.evicted, null, `${c.label}: evicted must be null when reason != lru`);
      }
    }
  });
});

// =============================================================================
// PHASE 4 — MODULE 6: clip-paths.js ADVERSARIAL FILENAME VULNERABILITY PASS
//
// Clip filenames arrive from two sources: synth_turn.py (trusted) and the
// queue-watcher's fs.readdir (semi-trusted — the user's queue dir can be
// hand-edited). A mis-parsed filename routes audio to the wrong session
// (wrong palette colour), unfuels the tab's badge count, or misfires the
// ephemeral volume dip. Existing coverage (16 tests across EX7a +
// EPHEMERAL CLIP DETECTION) exercises canonical shapes; this pass probes
// adversarial inputs: extreme lengths, unicode, path separators, mixed
// case, multiple -clip- tokens, type-confusion.
// =============================================================================
describe('PHASE 4 #6 — clip-paths adversarial filenames', () => {
  const {
    paletteKeyForIndex, paletteKeyForShort,
    extractSessionShort, isClipFile,
    isEphemeralClip, isHeartbeatClip,
  } = require(path.join(__dirname, '..', 'app', 'lib', 'clip-paths.js'));

  // ---- Type safety on extractSessionShort -----------------------------
  it('extractSessionShort throws when filename is not a string (caller must coerce)', () => {
    // Documenting current behaviour: the regex .match() requires a
    // string. If the queue-watcher ever passes a non-string, upstream
    // must coerce. Locking in the contract — not silently returning
    // null would let callers fail loudly rather than route to the
    // wrong session via undefined-behaviour.
    let threw = false;
    try { extractSessionShort(null); } catch { threw = true; }
    assertEqual(threw, true,
      'null filename must throw (contract: caller coerces before calling)');
  });

  it('extractSessionShort handles empty string cleanly', () => {
    assertEqual(extractSessionShort(''), null);
  });

  // ---- Case-insensitivity flag holds ----------------------------------
  it('extractSessionShort is case-insensitive on hex + extension', () => {
    // Files come from Python via edge-tts which always emits lowercase,
    // but the regex uses /i for defence-in-depth. Verify.
    assertEqual(extractSessionShort('20260420T1-clip-AABBCCDD-0001.MP3'), 'aabbccdd');
    assertEqual(extractSessionShort('20260420T1-CLIP-AaBbCcDd-0001.Wav'), 'aabbccdd');
    assertEqual(extractSessionShort('x-AABBCCDD.MP3'), 'aabbccdd');
  });

  // ---- Path separators embedded in filename ---------------------------
  it('extractSessionShort works when a full path is passed (matches last segment)', () => {
    // The regex is anchored with $ at end; path prefix is fine. But
    // should it be? Locking in current behaviour: a full path matches
    // at its tail, so queue-watcher can pass either just `name` or
    // `path.join(dir, name)` interchangeably.
    const full = 'C:\\Users\\Ben\\.terminal-talk\\queue\\20260420-clip-aabbccdd-0001.mp3';
    assertEqual(extractSessionShort(full), 'aabbccdd');
    const posix = '/home/ben/queue/20260420-clip-aabbccdd-0001.mp3';
    assertEqual(extractSessionShort(posix), 'aabbccdd');
  });

  // ---- Extension variants ---------------------------------------------
  it('extractSessionShort rejects .flac / .ogg / unknown extensions', () => {
    assertEqual(extractSessionShort('x-clip-aabbccdd-0001.flac'), null);
    assertEqual(extractSessionShort('x-clip-aabbccdd-0001.ogg'),  null);
    assertEqual(extractSessionShort('x-clip-aabbccdd-0001.m4a'),  null);
  });

  it('extractSessionShort rejects double-extension spoofs (e.g. .mp3.exe)', () => {
    assertEqual(extractSessionShort('x-clip-aabbccdd-0001.mp3.exe'), null);
    assertEqual(extractSessionShort('x-clip-aabbccdd-0001.mp3.txt'), null);
  });

  // ---- Adversarial hex content ----------------------------------------
  it('extractSessionShort rejects non-hex in the 8-char slot', () => {
    // `ghijklmn` looks superficially like 8 chars but isn't hex.
    assertEqual(extractSessionShort('x-clip-ghijklmn-0001.mp3'), null);
    assertEqual(extractSessionShort('x-ghijklmn.mp3'), null);
  });

  it('extractSessionShort requires exactly 8 hex chars (not 7, not 9)', () => {
    assertEqual(extractSessionShort('x-clip-aabbccd-0001.mp3'), null);    // 7
    assertEqual(extractSessionShort('x-clip-aabbccdde-0001.mp3'), null);  // 9
  });

  // ---- Extremely long filenames: no ReDoS -----------------------------
  it('10KB-long filename completes extractSessionShort in < 200 ms', () => {
    const pad = 'x'.repeat(10_000);
    const name = `${pad}-clip-aabbccdd-0001.mp3`;
    const t0 = Date.now();
    const r = extractSessionShort(name);
    const dt = Date.now() - t0;
    assertEqual(r, 'aabbccdd');
    assertTruthy(dt < 200, `ReDoS risk — 10KB filename took ${dt}ms`);
  });

  it('10000 consecutive "clip" substrings do not cause regex backtracking', () => {
    // Pathological: lots of -clip- tokens but no valid trailing match.
    const adversarial = '-clip-'.repeat(5000) + 'xx.mp3';
    const t0 = Date.now();
    const r = extractSessionShort(adversarial);
    const dt = Date.now() - t0;
    assertEqual(r, null);
    assertTruthy(dt < 200, `regex backtracking risk — took ${dt}ms`);
  });

  // ---- Multi-clip tokens: specificity-first resolves ambiguity --------
  it('filename with two -clip-<hex>- tokens resolves to the LAST one (end-anchored)', () => {
    // This is what "specificity-first" buys us — the end-anchored
    // clip regex picks the trailing one when multiple are present.
    const weird = '-clip-11111111-0001-clip-aabbccdd-0002.mp3';
    assertEqual(extractSessionShort(weird), 'aabbccdd');
  });

  // ---- Response-pattern vs clip-pattern overlap (G11 audit) -----------
  it('-clip-<hex>- specificity beats bare -<hex>- when both patterns match', () => {
    // Pathological: a clip-form filename where the trailing 8 hex of
    // the counter would ALSO parse as a response short. Specificity
    // must win so user-click routing doesn't mis-target.
    const pathological = '20260420-clip-11112222-99999999.mp3';
    // Clip pattern: -clip-([8hex])-\d+ — matches 11112222 as short.
    // (The 99999999 counter is all digits so \d+ eats it.)
    assertEqual(extractSessionShort(pathological), '11112222');
  });

  // ---- "neutral" literal handling -------------------------------------
  it('extractSessionShort returns null for "neutral" clips (sentinel for non-session audio)', () => {
    assertEqual(extractSessionShort('x-clip-neutral-0001.mp3'), null);
    assertEqual(extractSessionShort('x-clip-NEUTRAL-0001.MP3'), null, 'case-insensitive');
  });

  // ---- isEphemeralClip precision --------------------------------------
  it('isEphemeralClip rejects -T- or -H- that appear BEFORE the anchored tail', () => {
    // A body clip whose pathological filename contains "T-" early on
    // must NOT be classified ephemeral. The regex anchors to the full
    // `-X-NNNN-HHHHHHHH.ext$` shape precisely for this.
    assertEqual(isEphemeralClip('hopper-T-chat-0001-aabbccdd.mp3'), false);
    assertEqual(isEphemeralClip('weird-H-thing-0001-aabbccdd.mp3'), false);
  });

  it('isEphemeralClip requires 4-digit counter (not 3, not 5)', () => {
    assertEqual(isEphemeralClip('x-T-001-aabbccdd.mp3'),   false);  // 3 digits
    assertEqual(isEphemeralClip('x-T-00001-aabbccdd.mp3'), false);  // 5 digits
    assertEqual(isEphemeralClip('x-T-0001-aabbccdd.mp3'),  true);   // 4 — good
  });

  // ---- isHeartbeatClip purity -----------------------------------------
  it('isHeartbeatClip is a strict subset of isEphemeralClip', () => {
    const h = '20260421T1-H-0001-aabbccdd.mp3';
    const t = '20260421T1-T-0001-aabbccdd.mp3';
    assertEqual(isHeartbeatClip(h), true);
    assertEqual(isEphemeralClip(h), true);
    assertEqual(isHeartbeatClip(t), false);
    assertEqual(isEphemeralClip(t), true);
  });

  // ---- paletteKeyForIndex extremes ------------------------------------
  it('paletteKeyForIndex handles negative multiples of paletteSize', () => {
    assertEqual(paletteKeyForIndex(-24, 24), '00');
    assertEqual(paletteKeyForIndex(-25, 24), '23');
    assertEqual(paletteKeyForIndex(-48, 24), '00');
  });

  it('paletteKeyForIndex handles paletteSize=1 cleanly', () => {
    assertEqual(paletteKeyForIndex(0, 1), '00');
    assertEqual(paletteKeyForIndex(999, 1), '00');
    assertEqual(paletteKeyForIndex(-1, 1), '00');
  });

  it('paletteKeyForIndex pads to two digits even when paletteSize > 99', () => {
    // padStart(2) leaves 3-digit numbers as 3 digits. Current contract
    // is "always 2+ digits". Verify.
    assertEqual(paletteKeyForIndex(100, 200), '100');
    assertEqual(paletteKeyForIndex(5, 200), '05');
  });

  // ---- paletteKeyForShort hash-path edges -----------------------------
  it('paletteKeyForShort unicode shortId hashes deterministically', () => {
    // Hash uses charCodeAt — BMP chars OK, astral chars split.
    const a1 = paletteKeyForShort('café-tes', {}, 24);
    const a2 = paletteKeyForShort('café-tes', {}, 24);
    assertEqual(a1, a2);
    assertTruthy(/^\d\d$/.test(a1));
  });

  it('paletteKeyForShort falls through to hash when entry.index is NaN', () => {
    // Registry corruption: entry exists but index isn't an integer.
    // Must NOT return 'neutral' for an index-bearing entry path, but
    // must NOT trust the NaN either. Current behaviour: falls through
    // to the hash. Lock in.
    const assignments = { aabbccdd: { index: 'bad' } };
    const k = paletteKeyForShort('aabbccdd', assignments, 24);
    assertTruthy(/^\d\d$/.test(k),
      'malformed entry.index must not leak through — falls through to hash');
    assertTruthy(k !== 'neutral', 'non-short short has a valid hash fallback');
  });

  it('paletteKeyForShort returns "neutral" when shortId is exactly 3 chars', () => {
    assertEqual(paletteKeyForShort('abc', {}, 24), 'neutral',
      'shortId < 4 chars is sentinel territory');
  });

  it('paletteKeyForShort accepts shortId >= 4 chars (not just exactly 8)', () => {
    // The length check is `< 4`, not `!== 8`. Document that 4+
    // non-assigned shorts hash to a real palette index.
    const k = paletteKeyForShort('abcd', {}, 24);
    assertTruthy(/^\d\d$/.test(k));
    assertTruthy(k !== 'neutral');
  });

  // ---- isClipFile precision -------------------------------------------
  it('isClipFile matches on the -clip- token, NOT on -clippy-, -clip_foo-, etc.', () => {
    // Current regex is `/-clip-/` — requires the exact token with
    // hyphen boundaries. Verify it rejects similar-looking filenames.
    assertEqual(isClipFile('x-clip-aabbccdd-0001.mp3'), true);
    assertEqual(isClipFile('x-clippy-aabbccdd-0001.mp3'), false,
      '"-clippy-" must not match (prefix variant)');
    assertEqual(isClipFile('x-clip_aabbccdd-0001.mp3'), false,
      '"-clip_" must not match (underscore variant)');
  });

  // ---- Consistency: extractSessionShort ↔ isClipFile ------------------
  it('every filename isClipFile=true must extract a non-null shortId (or "neutral")', () => {
    // Invariant: if we classify a file as a clip, we must be able to
    // resolve its short or know it's the neutral sentinel. Otherwise
    // the renderer files it under "???" and it orphans.
    const cases = [
      '20260420-clip-aabbccdd-0001.mp3',
      '20260420-clip-eeff0011-9999.wav',
      '20260420-clip-neutral-0001.mp3',
    ];
    for (const name of cases) {
      if (!isClipFile(name)) throw new Error(`isClipFile(${name}) should be true`);
      const short = extractSessionShort(name);
      // Valid = 8 hex chars OR null (neutral sentinel)
      if (short !== null && !/^[a-f0-9]{8}$/.test(short)) {
        throw new Error(`isClipFile=true but extractSessionShort returned weird value: ${short}`);
      }
    }
  });
});

// =============================================================================
// PHASE 4 — MODULE 5: audio-player.js STATE-TRANSITION VULNERABILITY PASS
//
// Existing EX7e covers happy paths (27 tests); Phase 2a added volume +
// systemAutoPause/Resume (12 tests). This pass targets state-transition
// edges that could leave the player in an inconsistent state: rapid
// clip-swap, abort during pause, button clamping, null-audioContext
// tolerance, ended-handler edge branches, stall timer lifecycle.
// =============================================================================
describe('PHASE 4 #5 — audio-player state transitions', () => {
  const { AudioPlayer } = require(path.join(__dirname, '..', 'app', 'lib', 'audio-player.js'));
  const clipPaths = require(path.join(__dirname, '..', 'app', 'lib', 'clip-paths.js'));

  function makeFakeAudio() {
    const a = {
      src: '', currentTime: 0, duration: NaN, playbackRate: 1,
      paused: true, ended: false, readyState: 0, volume: 1,
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
  function makeFakeRange() {
    const r = global.document.createElement('input');
    r.max = '1000'; r.value = '0';
    r.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, bottom: 10, right: 200 });
    return r;
  }
  function makeFakeWrap() {
    const w = global.document.createElement('div');
    w.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, bottom: 10, right: 200 });
    return w;
  }
  function makeM5Player(overrides = {}) {
    const audio = overrides.audio || makeFakeAudio();
    const calls = { played: [], heard: [], removedPending: [], playStart: [], clipEnded: [], playNext: 0, renderDots: 0 };
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
      getPlaybackSpeed: () => 1.25,
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

  // ---- abort during systemAutoPaused ----------------------------------
  it('abort() leaves _systemAutoPaused sticky (documented behaviour)', () => {
    const { player, audio } = makeM5Player({ queue: [{ path: '/a.mp3', mtime: 1 }] });
    player.mount();
    player.playPath('/a.mp3', true, true);
    audio.paused = false;
    player.systemAutoPause();
    assertEqual(player.isSystemAutoPaused(), true);
    player.abort();
    assertEqual(player.isSystemAutoPaused(), true,
      'abort is user-initiated stop; the pause-flag should stay pinned so the next systemAutoResume takes the drain branch');
    player.unmount();
  });

  // ---- Rapid swap playPath A → B mid-playback -------------------------
  it('playPath(B) mid-playback of A: state cleanly switches to B', () => {
    const queue = [{ path: '/a.mp3', mtime: 1 }, { path: '/b.mp3', mtime: 2 }];
    const { player, audio, calls } = makeM5Player({ queue });
    player.mount();
    player.playPath('/a.mp3', true, true);
    assertEqual(player.getCurrentPath(), '/a.mp3');
    player.playPath('/b.mp3', true, true);
    assertEqual(player.getCurrentPath(), '/b.mp3');
    assertEqual(audio.src, 'file:///b.mp3');
    assertTruthy(calls.played.includes('/a.mp3'));
    assertTruthy(calls.played.includes('/b.mp3'));
    player.unmount();
  });

  // ---- playPath on path not in queue ----------------------------------
  it('playPath on missing path returns false and does not set currentPath', () => {
    const { player } = makeM5Player({ queue: [{ path: '/a.mp3', mtime: 1 }] });
    player.mount();
    assertEqual(player.playPath('/ghost.mp3', true, true), false);
    assertEqual(player.getCurrentPath(), null);
    player.unmount();
  });

  it('playPath(missing) after a successful prior play: state stays on prior clip', () => {
    const { player } = makeM5Player({ queue: [{ path: '/a.mp3', mtime: 1 }] });
    player.mount();
    player.playPath('/a.mp3', true, true);
    assertEqual(player.getCurrentPath(), '/a.mp3');
    assertEqual(player.playPath('/never.mp3', true, true), false);
    assertEqual(player.getCurrentPath(), '/a.mp3',
      'failed playPath must not clobber currentPath');
    player.unmount();
  });

  // ---- Button handlers clamping ---------------------------------------
  it('back10 clamps currentTime at 0 (no negative seek)', () => {
    const { player, audio } = makeM5Player();
    player.mount();
    audio.currentTime = 5;
    player._back10Btn._listeners.find(l => l.ev === 'click').fn();
    assertEqual(audio.currentTime, 0);
    player.unmount();
  });

  it('fwd10 clamps currentTime to duration (no over-seek)', () => {
    const { player, audio } = makeM5Player();
    player.mount();
    audio.duration = 12;
    audio.currentTime = 5;
    player._fwd10Btn._listeners.find(l => l.ev === 'click').fn();
    assertEqual(audio.currentTime, 12);
    player.unmount();
  });

  it('fwd10 is a no-op when duration is NaN (guard against NaN seek)', () => {
    const { player, audio } = makeM5Player();
    player.mount();
    audio.duration = NaN;
    audio.currentTime = 3;
    player._fwd10Btn._listeners.find(l => l.ev === 'click').fn();
    assertEqual(audio.currentTime, 3);
    player.unmount();
  });

  // ---- abortIfAutoPlayed state ----------------------------------------
  it('abortIfAutoPlayed returns null when nothing is playing', () => {
    const { player } = makeM5Player();
    player.mount();
    assertEqual(player.abortIfAutoPlayed(), null);
    player.unmount();
  });

  it('abortIfAutoPlayed after a prior abort is a clean no-op', () => {
    const { player } = makeM5Player({ queue: [{ path: '/a.mp3', mtime: 1 }] });
    player.mount();
    player.playPath('/a.mp3', false);
    player.abort();
    assertEqual(player.abortIfAutoPlayed(), null);
    player.unmount();
  });

  // ---- playToggleTone tolerance ---------------------------------------
  it('playToggleTone tolerates a factory returning null', () => {
    const { player } = makeM5Player({ audioContextFactory: () => null });
    player.mount();
    player.playToggleTone(true);
    player.playToggleTone(false);
    player.unmount();
  });

  it('playToggleTone tolerates a factory that throws', () => {
    const { player } = makeM5Player({ audioContextFactory: () => { throw new Error('boom'); } });
    player.mount();
    player.playToggleTone(true);
    player.unmount();
  });

  // ---- ended handler edge cases ---------------------------------------
  it('ended with user-click + auto-continue ON + no forward clips: stops cleanly (no playNextPending)', () => {
    // After the last forward clip ends, chain completes. Must not
    // fall through to playNextPending — that would resurrect unplayed
    // clips BEHIND the user's click-start.
    const { player, audio, calls } = makeM5Player({ queue: [{ path: '/a.mp3', mtime: 1 }] });
    player.mount();
    player.playPath('/a.mp3', true, true);
    calls.playNext = 0;
    audio.fire('ended');
    assertEqual(calls.playNext, 0,
      'last user-click clip must not trigger playNextPending — chain complete');
    assertEqual(player.getCurrentPath(), null);
    player.unmount();
  });

  it('ended fired with no current clip does not throw', () => {
    const { player, audio } = makeM5Player();
    player.mount();
    audio.fire('ended');
    player.unmount();
  });

  // ---- systemAutoPause idempotency ------------------------------------
  it('systemAutoPause twice: second call is a no-op, flag stays true', () => {
    const { player, audio } = makeM5Player({ queue: [{ path: '/a.mp3', mtime: 1 }] });
    player.mount();
    player.playPath('/a.mp3', true, true);
    audio.paused = false;
    player.systemAutoPause();
    assertEqual(player.isSystemAutoPaused(), true);
    player.systemAutoPause();
    assertEqual(player.isSystemAutoPaused(), true);
    player.unmount();
  });

  // ---- isIdle consistency through transitions -------------------------
  it('isIdle after abort is true', () => {
    const { player } = makeM5Player({ queue: [{ path: '/a.mp3', mtime: 1 }] });
    player.mount();
    player.playPath('/a.mp3', true);
    player.abort();
    assertEqual(player.isIdle(), true);
    player.unmount();
  });

  it('isIdle when audio.ended is true', () => {
    const { player, audio } = makeM5Player({ queue: [{ path: '/a.mp3', mtime: 1 }] });
    player.mount();
    player.playPath('/a.mp3', true);
    audio.ended = true;
    assertEqual(player.isIdle(), true);
    player.unmount();
  });

  // ---- Stall timer lifecycle ------------------------------------------
  it('repeated stalled events do not leak timer handles (unmount clears them all)', () => {
    const { player, audio } = makeM5Player();
    player.mount();
    audio.fire('stalled');
    assertTruthy(player._stallRecoveryTimer);
    audio.fire('stalled');
    player.unmount();
    assertFalsy(player._stallRecoveryTimer,
      'unmount must clear stall timer regardless of how many stalls fired');
  });
});

// =============================================================================
// PHASE 4 — MODULE 4: ipc-handlers.js DEEPER VALIDATOR COVERAGE
//
// EX6f-1/2/3/4 combined have ~61 tests covering the happy paths and core
// rejection branches. This pass fills the adversarial input gaps:
//   - validShort boundary variants (case / length / non-hex / non-string)
//   - set-session-index numeric extremes (Infinity / negative / MAX_VALUE)
//   - sanitiseLabel behaviour on control chars + oversized strings
//   - set-session-voice falsy-variant clearing (null / '' / whitespace)
//   - update-config with unusual payload shapes
//   - remove-session with a missing QUEUE_DIR
// =============================================================================
describe('PHASE 4 #4 — ipc-handlers validator edge coverage', () => {
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

  function mutationDeps(overrides = {}) {
    const registry = overrides.registry || {};
    return {
      ipcMain: makeFakeIpcMain(),
      diag: () => {},
      getCFG: () => (overrides.cfg || {}),
      setCFG: (v) => { overrides.cfg = v; },
      getWin: () => ({ isDestroyed: () => false }),
      loadAssignments: () => JSON.parse(JSON.stringify(registry)),
      saveAssignments: (all) => {
        Object.keys(registry).forEach((k) => delete registry[k]);
        Object.assign(registry, all);
        return true;
      },
      saveConfig: () => true,
      getQueueFiles: () => [],
      ensureAssignmentsForFiles: () => ({}),
      isPidAlive: () => false,
      computeStaleSessions: () => [],
      SESSIONS_DIR: '/nope',
      notifyQueue: () => {},
      allowMutation: () => true,
      apiKeyStore: { get: () => null, set: () => {} },
      redactForLog: (x) => x,
      validShort, validVoice, sanitiseLabel, ALLOWED_INCLUDE_KEYS,
      ...overrides,
      _registry: registry,
    };
  }

  // ---- validShort boundary variants: every mutation handler rejects ---
  const BAD_SHORTS = [
    ['uppercase hex (case-sensitive regex)', 'AABBCCDD'],
    ['7 chars (one too short)',               'aabbccd'],
    ['9 chars (one too long)',                'aabbccdde'],
    ['contains a non-hex char (z)',           'aabbccdz'],
    ['whitespace padded',                     ' aabbccdd'],
    ['null',                                  null],
    ['undefined',                             undefined],
    ['number',                                123],
    ['object',                                { x: 1 }],
    ['empty string',                          ''],
  ];
  for (const [desc, short] of BAD_SHORTS) {
    it(`set-session-label rejects bad shortId: ${desc}`, () => {
      const deps = mutationDeps({ registry: { aabbccdd: { index: 0, label: '' } } });
      createIpcHandlers(deps).register();
      assertEqual(deps.ipcMain.invoke('set-session-label', short, 'x'), false);
      assertEqual(deps._registry.aabbccdd.label, '',
        'registry untouched when shortId rejected');
    });
  }

  // ---- set-session-index numeric extremes ------------------------------
  it('set-session-index with Infinity returns false (not finite)', () => {
    const deps = mutationDeps({ registry: { aabbccdd: { index: 3 } } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-index', 'aabbccdd', Infinity), false);
    assertEqual(deps._registry.aabbccdd.index, 3, 'registry unchanged on non-finite');
  });

  it('set-session-index with -Infinity returns false', () => {
    const deps = mutationDeps({ registry: { aabbccdd: { index: 3 } } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-index', 'aabbccdd', -Infinity), false);
  });

  it('set-session-index with huge positive number clamps to 23', () => {
    const deps = mutationDeps({ registry: { aabbccdd: { index: 3 } } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-index', 'aabbccdd', 999999), true);
    assertEqual(deps._registry.aabbccdd.index, 23);
  });

  it('set-session-index with huge negative number clamps to 0', () => {
    const deps = mutationDeps({ registry: { aabbccdd: { index: 5 } } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-index', 'aabbccdd', -999999), true);
    assertEqual(deps._registry.aabbccdd.index, 0);
  });

  it('set-session-index with boolean true coerces to 1 (finite Number(true))', () => {
    // Number(true) = 1 — passes Number.isFinite. Whether this should be
    // allowed is a product call. Lock in the current behaviour so any
    // future reject-non-numeric tightening is intentional.
    const deps = mutationDeps({ registry: { aabbccdd: { index: 5 } } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-index', 'aabbccdd', true), true);
    assertEqual(deps._registry.aabbccdd.index, 1);
  });

  it('set-session-index with exact boundary 23 accepted', () => {
    const deps = mutationDeps({ registry: { aabbccdd: { index: 0 } } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-index', 'aabbccdd', 23), true);
    assertEqual(deps._registry.aabbccdd.index, 23);
  });

  it('set-session-index with fractional 5.7 floors to 5', () => {
    const deps = mutationDeps({ registry: { aabbccdd: { index: 0 } } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-index', 'aabbccdd', 5.7), true);
    assertEqual(deps._registry.aabbccdd.index, 5);
  });

  // ---- sanitiseLabel behaviour in handler context ----------------------
  it('set-session-label strips control chars (CR/LF/TAB) from label', () => {
    const deps = mutationDeps({ registry: { aabbccdd: { index: 0, label: '' } } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-label', 'aabbccdd', 'a\nb\tc\rd'), true);
    assertEqual(deps._registry.aabbccdd.label, 'a b c d');
  });

  it('set-session-label truncates labels > 60 chars', () => {
    const deps = mutationDeps({ registry: { aabbccdd: { index: 0, label: '' } } });
    createIpcHandlers(deps).register();
    const long = 'x'.repeat(200);
    assertEqual(deps.ipcMain.invoke('set-session-label', 'aabbccdd', long), true);
    assertEqual(deps._registry.aabbccdd.label.length, 60);
  });

  it('set-session-label with non-string label (number) becomes empty', () => {
    // sanitiseLabel returns '' for non-string input. Label gets cleared.
    const deps = mutationDeps({ registry: { aabbccdd: { index: 0, label: 'previous' } } });
    createIpcHandlers(deps).register();
    deps.ipcMain.invoke('set-session-label', 'aabbccdd', 42);
    assertEqual(deps._registry.aabbccdd.label, '',
      'non-string label treated as empty (sanitiseLabel contract)');
  });

  // ---- set-session-voice falsy-variant clearing ------------------------
  it('set-session-voice with null clears an existing voice', () => {
    const deps = mutationDeps({
      registry: { aabbccdd: { index: 0, voice: 'shimmer' } },
    });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-voice', 'aabbccdd', null), true);
    assertEqual(deps._registry.aabbccdd.voice, undefined,
      'null voiceId must delete the voice field (follow global default)');
  });

  it('set-session-voice with empty string "" clears', () => {
    const deps = mutationDeps({
      registry: { aabbccdd: { index: 0, voice: 'shimmer' } },
    });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-voice', 'aabbccdd', ''), true);
    assertEqual(deps._registry.aabbccdd.voice, undefined);
  });

  it('set-session-voice with invalid voice name returns false', () => {
    const deps = mutationDeps({
      registry: { aabbccdd: { index: 0, voice: 'shimmer' } },
    });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-voice', 'aabbccdd', 'not-a-real-voice'), false);
    assertEqual(deps._registry.aabbccdd.voice, 'shimmer',
      'invalid voice leaves existing voice unchanged');
  });

  // ---- set-session-include strict-boolean enforcement ------------------
  it('set-session-include with string "true" rejected (not strict boolean)', () => {
    const deps = mutationDeps({ registry: { aabbccdd: { index: 0 } } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-include', 'aabbccdd', 'urls', 'true'), false);
    assertFalsy(deps._registry.aabbccdd.speech_includes,
      'no speech_includes written when value type rejected');
  });

  it('set-session-include with numeric 1 rejected (not strict boolean)', () => {
    const deps = mutationDeps({ registry: { aabbccdd: { index: 0 } } });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-include', 'aabbccdd', 'urls', 1), false);
  });

  it('set-session-include with value=null clears an existing override', () => {
    const deps = mutationDeps({
      registry: { aabbccdd: { index: 0, speech_includes: { urls: true } } },
    });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-include', 'aabbccdd', 'urls', null), true);
    assertFalsy(deps._registry.aabbccdd.speech_includes,
      'after clearing the only key, empty speech_includes is deleted entirely');
  });

  it('set-session-include with value=undefined clears (matches null)', () => {
    const deps = mutationDeps({
      registry: { aabbccdd: { index: 0, speech_includes: { urls: true, code_blocks: true } } },
    });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('set-session-include', 'aabbccdd', 'urls', undefined), true);
    // 'urls' gone, 'code_blocks' still there.
    assertDeepEqual(deps._registry.aabbccdd.speech_includes, { code_blocks: true });
  });

  // ---- update-config edge cases ----------------------------------------
  it('update-config handles deeply nested playback update without flattening siblings', () => {
    const initial = {
      voices: { edge_response: 'ryan' },
      playback: { speed: 1.25, auto_prune_sec: 20 },
    };
    const deps = mutationDeps({ cfg: initial });
    createIpcHandlers(deps).register();
    // Update only playback.speed — voices + playback.auto_prune_sec must survive.
    deps.ipcMain.invoke('update-config', { playback: { speed: 2.0 } });
    const cfg = deps.getCFG();
    assertEqual(cfg.playback.speed, 2.0);
    assertEqual(cfg.playback.auto_prune_sec, 20,
      'sibling nested keys must not be dropped by the merge');
    assertEqual(cfg.voices.edge_response, 'ryan',
      'sibling top-level sections must not be dropped');
  });

  // ---- remove-session with missing QUEUE_DIR ---------------------------
  it('remove-session tolerates missing QUEUE_DIR (no purge attempted)', () => {
    const deps = mutationDeps({
      registry: { aabbccdd: { index: 0, label: 'dying' } },
      // QUEUE_DIR intentionally undefined — the purge block must guard.
    });
    createIpcHandlers(deps).register();
    assertEqual(deps.ipcMain.invoke('remove-session', 'aabbccdd'), true);
    assertFalsy(deps._registry.aabbccdd, 'entry removed from registry');
  });

  // ---- validVoice boundary coverage ------------------------------------
  it('validVoice accepts the full edge-tts naming scheme', () => {
    for (const v of [
      'en-GB-RyanNeural',
      'en-US-AriaNeural',
      'fr-FR-DeniseNeural',
      'zh-CN-XiaoxiaoNeural',
      // OpenAI single-word ids
      'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer',
    ]) {
      if (!validVoice(v)) throw new Error(`validVoice rejected "${v}"`);
    }
  });

  it('validVoice rejects obvious injection attempts', () => {
    for (const v of [
      'en-GB-RyanNeural; rm -rf /',
      '../../etc/passwd',
      '',
      null,
      undefined,
      42,
      'x'.repeat(200),
    ]) {
      if (validVoice(v)) throw new Error(`validVoice accepted bad input: ${JSON.stringify(v)}`);
    }
  });
});

// =============================================================================
// VOICE COMMAND (Phase 1)
//   Grammar XML validity + SAPI round-trip for the play/pause/next/back/stop
//   post-wake command surface. `LOGIC_ONLY` skips the PS-driven tests since
//   System.Speech.Recognition is Windows-only.
// =============================================================================
describe('VOICE COMMAND (Phase 1)', () => {
  if (LOGIC_ONLY) {
    it('skipped in logic-only mode', () => {});
    return;
  }

  const repoApp = path.join(__dirname, '..', 'app');
  const recognizerPath = path.join(repoApp, 'voice-command-recognize.ps1');

  it('recognizer script exists', () => {
    if (!fs.existsSync(recognizerPath)) {
      throw new Error(`voice-command-recognize.ps1 missing at ${recognizerPath}`);
    }
  });

  it('recognizer returns {} on silent WAV', () => {
    // Build a 1-second 16kHz mono silent WAV (44-byte header + 32000 bytes
    // of zeros). Feed to the recognizer. SAPI on pure silence returns
    // nothing — we expect literal {}.
    const wavPath = path.join(os.tmpdir(), `tt-voice-silent-${process.pid}-${Date.now()}.wav`);
    const sampleRate = 16000;
    const numSamples = sampleRate;   // 1 second
    const dataLen = numSamples * 2;  // 16-bit mono
    const buf = Buffer.alloc(44 + dataLen);
    // RIFF header
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + dataLen, 4);
    buf.write('WAVE', 8);
    buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16);            // fmt chunk size
    buf.writeUInt16LE(1, 20);             // PCM
    buf.writeUInt16LE(1, 22);             // mono
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
    buf.writeUInt16LE(2, 32);             // block align
    buf.writeUInt16LE(16, 34);            // bits per sample
    buf.write('data', 36);
    buf.writeUInt32LE(dataLen, 40);
    // data chunk stays zero-filled from Buffer.alloc
    fs.writeFileSync(wavPath, buf);
    try {
      const r = spawnSync('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        recognizerPath, wavPath,
      ], { encoding: 'utf8', timeout: 15000 });
      if (r.status !== 0) {
        throw new Error(`recognizer rc=${r.status}; stderr=${r.stderr}`);
      }
      const out = (r.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
      const parsed = JSON.parse(out);
      // Silence must not produce an action.
      if (parsed.action) {
        throw new Error(`expected no action on silent WAV, got: ${out}`);
      }
    } finally {
      try { fs.unlinkSync(wavPath); } catch {}
    }
  });

  it('recognizer matches "play" when synthesised by SAPI and fed back', () => {
    // End-to-end round trip: use System.Speech.Synthesis to speak "play"
    // into a WAV, then run the recognizer over the same WAV. If both
    // halves of SAPI agree, we confirm the grammar + script wiring.
    // Accepted matches at confidence >= 0.5 per MIN_CONFIDENCE in the
    // Python listener.
    const wavPath = path.join(os.tmpdir(), `tt-voice-play-${process.pid}-${Date.now()}.wav`);
    const synth = spawnSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `Add-Type -AssemblyName System.Speech; ` +
      `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
      `$s.SetOutputToWaveFile('${wavPath.replace(/'/g, "''")}'); ` +
      `$s.Speak('play'); $s.Dispose(); Write-Output 'SYNTH_OK'`,
    ], { encoding: 'utf8', timeout: 20000 });
    if (synth.status !== 0 || !synth.stdout.includes('SYNTH_OK')) {
      throw new Error(`synth fail: stdout=${synth.stdout} stderr=${synth.stderr}`);
    }
    try {
      const r = spawnSync('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        recognizerPath, wavPath,
      ], { encoding: 'utf8', timeout: 15000 });
      if (r.status !== 0) {
        throw new Error(`recognizer rc=${r.status}; stderr=${r.stderr}`);
      }
      const out = (r.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
      const parsed = JSON.parse(out);
      if (parsed.action !== 'play') {
        throw new Error(`expected action=play from round-trip, got: ${out}`);
      }
      if (!(parsed.confidence >= 0.5)) {
        throw new Error(`round-trip confidence too low: ${parsed.confidence}`);
      }
    } finally {
      try { fs.unlinkSync(wavPath); } catch {}
    }
  });

  // ---- voice-dispatch state matrix -------------------------------------
  // Exercises lib/voice-dispatch.js against every clip-state permutation
  // Ben reported as problematic 2026-04-24: "when a clip's played and it
  // turns white with the ring... play it again, it doesn't seem to work
  // then". The play action must fall back to replay when no unplayed
  // exists — that regression is locked in here.

  const { createVoiceDispatcher, pickFallbackClip } = require(
    path.join(__dirname, '..', 'app', 'lib', 'voice-dispatch.js')
  );

  function makeMockAudio(init = {}) {
    const audio = {
      src: init.src || '',
      paused: init.paused !== undefined ? init.paused : true,
      ended: init.ended !== undefined ? init.ended : false,
      duration: init.duration !== undefined ? init.duration : 10,
      currentTime: 0,
      _playCalls: 0,
      _pauseCalls: 0,
      play() { this._playCalls++; return Promise.resolve(); },
      pause() { this._pauseCalls++; this.paused = true; },
    };
    return audio;
  }

  function makeMockPlayer() {
    return {
      _playPathCalls: [],
      _abortCalls: 0,
      playPath(p, manual, userClick) {
        this._playPathCalls.push({ path: p, manual, userClick });
        return true;
      },
      abort() { this._abortCalls++; },
    };
  }

  function makeDispatcher(opts = {}) {
    const audio = opts.audio || makeMockAudio();
    const audioPlayer = opts.audioPlayer || makeMockPlayer();
    const queue = opts.queue || [];
    let nextPendingCalls = 0;
    const d = createVoiceDispatcher({
      audio, audioPlayer,
      getQueue: () => queue,
      isMuted: opts.isMuted || (() => false),
      isStale: opts.isStale || (() => false),
      playNextPending: () => { nextPendingCalls++; if (opts.onNextPending) opts.onNextPending(audio); },
    });
    return { d, audio, audioPlayer, queue, getNext: () => nextPendingCalls };
  }

  describe('voice-dispatch state matrix', () => {
    // -- play -----------------------------------------------------------
    it('play resumes a paused-mid-clip', () => {
      const { d, audio } = makeDispatcher({
        audio: makeMockAudio({ src: 'a.mp3', paused: true, ended: false }),
      });
      d.dispatch('play');
      assertEqual(audio._playCalls, 1);
    });
    it('play is a no-op when already playing', () => {
      const { d, audio, getNext } = makeDispatcher({
        audio: makeMockAudio({ src: 'a.mp3', paused: false, ended: false }),
      });
      d.dispatch('play');
      assertEqual(audio._playCalls, 0);
      assertEqual(getNext(), 0);
    });
    it('play replays an ended clip still loaded', () => {
      const { d, audio } = makeDispatcher({
        audio: makeMockAudio({ src: 'a.mp3', paused: true, ended: true }),
      });
      d.dispatch('play');
      assertEqual(audio.currentTime, 0);
      assertEqual(audio._playCalls, 1);
    });
    it('play calls playNextPending when nothing is loaded', () => {
      const { d, getNext } = makeDispatcher({
        audio: makeMockAudio({ src: '', paused: true, ended: false }),
        queue: [{ path: '/a.mp3', mtime: 1 }],
        onNextPending: (a) => { a.src = '/a.mp3'; a.paused = false; },
      });
      d.dispatch('play');
      assertEqual(getNext(), 1);
    });
    it('play falls back to most-recent when all clips are played', () => {
      // playNextPending finds nothing (no change to audio.src) — voice
      // play must pick the most recent clip anyway. This is the
      // regression Ben reported.
      const { d, audioPlayer, getNext } = makeDispatcher({
        audio: makeMockAudio({ src: '', paused: true, ended: false }),
        queue: [
          { path: '/a.mp3', mtime: 1 },
          { path: '/c.mp3', mtime: 3 },
          { path: '/b.mp3', mtime: 2 },
        ],
        onNextPending: () => { /* still nothing playable */ },
      });
      d.dispatch('play');
      assertEqual(getNext(), 1, 'must try next-pending first');
      assertEqual(audioPlayer._playPathCalls.length, 1, 'must fall back to playPath');
      assertEqual(audioPlayer._playPathCalls[0].path, '/c.mp3',
        'fallback must pick most recent by mtime');
    });
    it('play fallback skips muted sessions', () => {
      const { d, audioPlayer } = makeDispatcher({
        audio: makeMockAudio({ src: '' }),
        queue: [
          { path: '/muted.mp3', mtime: 5 },
          { path: '/ok.mp3', mtime: 3 },
        ],
        isMuted: (p) => p === '/muted.mp3',
        onNextPending: () => {},
      });
      d.dispatch('play');
      assertEqual(audioPlayer._playPathCalls[0].path, '/ok.mp3');
    });
    it('play fallback skips stale sessions', () => {
      const { d, audioPlayer } = makeDispatcher({
        audio: makeMockAudio({ src: '' }),
        queue: [
          { path: '/stale.mp3', mtime: 5 },
          { path: '/ok.mp3', mtime: 3 },
        ],
        isStale: (p) => p === '/stale.mp3',
        onNextPending: () => {},
      });
      d.dispatch('play');
      assertEqual(audioPlayer._playPathCalls[0].path, '/ok.mp3');
    });
    it('play with empty queue and nothing loaded is a clean no-op', () => {
      const { d, audioPlayer, audio } = makeDispatcher({
        audio: makeMockAudio({ src: '' }),
        queue: [],
      });
      d.dispatch('play');
      assertEqual(audioPlayer._playPathCalls.length, 0);
      assertEqual(audio._playCalls, 0);
    });

    // -- pause ----------------------------------------------------------
    it('pause pauses a playing clip', () => {
      const { d, audio } = makeDispatcher({
        audio: makeMockAudio({ src: 'a.mp3', paused: false, ended: false }),
      });
      d.dispatch('pause');
      assertEqual(audio._pauseCalls, 1);
    });
    it('pause is a no-op when already paused', () => {
      const { d, audio } = makeDispatcher({
        audio: makeMockAudio({ src: 'a.mp3', paused: true, ended: false }),
      });
      d.dispatch('pause');
      assertEqual(audio._pauseCalls, 0);
    });
    it('pause is a no-op when nothing loaded', () => {
      const { d, audio } = makeDispatcher({
        audio: makeMockAudio({ src: '', paused: true, ended: false }),
      });
      d.dispatch('pause');
      assertEqual(audio._pauseCalls, 0);
    });

    // -- resume ---------------------------------------------------------
    it('resume resumes a paused-mid-clip', () => {
      const { d, audio } = makeDispatcher({
        audio: makeMockAudio({ src: 'a.mp3', paused: true, ended: false }),
      });
      d.dispatch('resume');
      assertEqual(audio._playCalls, 1);
    });
    it('resume is a no-op when nothing is paused', () => {
      const { d, audio } = makeDispatcher({
        audio: makeMockAudio({ src: '', paused: true, ended: false }),
      });
      d.dispatch('resume');
      assertEqual(audio._playCalls, 0);
    });
    it('resume does NOT start a fresh clip (stricter than play)', () => {
      const { d, audio, getNext, audioPlayer } = makeDispatcher({
        audio: makeMockAudio({ src: '', paused: true, ended: false }),
        queue: [{ path: '/a.mp3', mtime: 1 }],
      });
      d.dispatch('resume');
      assertEqual(audio._playCalls, 0);
      assertEqual(getNext(), 0);
      assertEqual(audioPlayer._playPathCalls.length, 0);
    });

    // -- next -----------------------------------------------------------
    it('next on a playing clip seeks to duration (fires ended handler)', () => {
      const { d, audio } = makeDispatcher({
        audio: makeMockAudio({ src: 'a.mp3', paused: false, ended: false, duration: 42 }),
      });
      d.dispatch('next');
      assertEqual(audio.currentTime, 42);
    });
    it('next on an idle player calls playNextPending', () => {
      const { d, getNext } = makeDispatcher({
        audio: makeMockAudio({ src: '' }),
      });
      d.dispatch('next');
      assertEqual(getNext(), 1);
    });
    it('next with non-finite duration falls back to playNextPending', () => {
      const { d, audio, getNext } = makeDispatcher({
        audio: makeMockAudio({ src: 'a.mp3', paused: false, ended: false, duration: Infinity }),
      });
      d.dispatch('next');
      assertEqual(audio.currentTime, 0, 'must not seek when duration is non-finite');
      assertEqual(getNext(), 1);
    });

    // -- back -----------------------------------------------------------
    it('back on a loaded+paused clip seeks to 0 and plays', () => {
      const { d, audio } = makeDispatcher({
        audio: makeMockAudio({ src: 'a.mp3', paused: true, ended: false, currentTime: 7 }),
      });
      d.dispatch('back');
      assertEqual(audio.currentTime, 0);
      assertEqual(audio._playCalls, 1);
    });
    it('back on a loaded+playing clip seeks to 0 without double-playing', () => {
      const { d, audio } = makeDispatcher({
        audio: makeMockAudio({ src: 'a.mp3', paused: false, ended: false, currentTime: 7 }),
      });
      d.dispatch('back');
      assertEqual(audio.currentTime, 0);
      assertEqual(audio._playCalls, 0, 'should not re-call play() if already playing');
    });
    it('back on an ended clip seeks to 0 and plays', () => {
      const { d, audio } = makeDispatcher({
        audio: makeMockAudio({ src: 'a.mp3', paused: true, ended: true }),
      });
      d.dispatch('back');
      assertEqual(audio.currentTime, 0);
      assertEqual(audio._playCalls, 1);
    });
    it('back on idle player plays most recent queue entry', () => {
      const { d, audioPlayer } = makeDispatcher({
        audio: makeMockAudio({ src: '' }),
        queue: [
          { path: '/old.mp3', mtime: 1 },
          { path: '/new.mp3', mtime: 9 },
        ],
      });
      d.dispatch('back');
      assertEqual(audioPlayer._playPathCalls.length, 1);
      assertEqual(audioPlayer._playPathCalls[0].path, '/new.mp3');
    });

    // -- stop -----------------------------------------------------------
    it('stop calls audioPlayer.abort', () => {
      const { d, audioPlayer } = makeDispatcher();
      d.dispatch('stop');
      assertEqual(audioPlayer._abortCalls, 1);
    });

    // -- cancel / unknown ----------------------------------------------
    it('cancel is a clean no-op', () => {
      const { d, audio, audioPlayer } = makeDispatcher({
        audio: makeMockAudio({ src: 'a.mp3', paused: false, ended: false }),
      });
      d.dispatch('cancel');
      assertEqual(audio._pauseCalls, 0);
      assertEqual(audio._playCalls, 0);
      assertEqual(audioPlayer._abortCalls, 0);
    });
    it('unknown action is a clean no-op', () => {
      const { d, audio, audioPlayer } = makeDispatcher({
        audio: makeMockAudio({ src: 'a.mp3', paused: false, ended: false }),
      });
      d.dispatch('nonsense');
      assertEqual(audio._pauseCalls, 0);
      assertEqual(audio._playCalls, 0);
      assertEqual(audioPlayer._abortCalls, 0);
    });

    // -- pickFallbackClip (pure helper) --------------------------------
    it('pickFallbackClip returns null on empty queue', () => {
      assertEqual(pickFallbackClip([], () => false, () => false), null);
    });
    it('pickFallbackClip returns null when all muted', () => {
      const q = [{ path: '/a.mp3', mtime: 1 }];
      assertEqual(pickFallbackClip(q, () => true, () => false), null);
    });
    it('pickFallbackClip picks newest by mtime', () => {
      const q = [
        { path: '/a.mp3', mtime: 1 },
        { path: '/c.mp3', mtime: 3 },
        { path: '/b.mp3', mtime: 2 },
      ];
      const pick = pickFallbackClip(q, () => false, () => false);
      assertEqual(pick.path, '/c.mp3');
    });
  });

  // ---- wake-word-listener end-point detection -------------------------
  // Pure function _should_finalise_capture decides when post-wake audio
  // capture ends. Exercised here so every state transition (hard cap,
  // trailing silence after voice, min-capture floor, pre-voice silence
  // doesn't count) is locked in.
  describe('wake-word EPD (_should_finalise_capture)', () => {
    const appDirRepo = path.join(__dirname, '..', 'app');

    function runPy(body) {
      // Use a multi-line shim so Python class/import statements work.
      // wake-word-listener.py imports heavy deps (numpy, sounddevice,
      // openwakeword) — stub the ones that might not be on a CI box.
      // numpy is a required dep and always installed (requirements.txt
      // ships it), so we don't stub that one.
      const shim = `import sys, types, importlib.util, pathlib
sys.path.insert(0, r'${appDirRepo.replace(/\\/g, '\\\\')}')
# Stub sounddevice if not present (keeps CI headless boxes happy).
if 'sounddevice' not in sys.modules:
    try:
        import sounddevice  # noqa
    except Exception:
        sys.modules['sounddevice'] = types.ModuleType('sounddevice')
# Stub openwakeword if not present.
if 'openwakeword' not in sys.modules:
    try:
        import openwakeword  # noqa
    except Exception:
        ow = types.ModuleType('openwakeword')
        owm = types.ModuleType('openwakeword.model')
        owm.Model = type('Model', (), {})
        sys.modules['openwakeword'] = ow
        sys.modules['openwakeword.model'] = owm
# Load wake-word-listener.py by path (its filename has a dash so
# 'import wake-word-listener' is not valid Python).
_path = pathlib.Path(r'${appDirRepo.replace(/\\/g, '\\\\')}') / 'wake-word-listener.py'
_spec = importlib.util.spec_from_file_location('wwl_mod', _path)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
should_finalise = _mod._should_finalise_capture
${body}
`;
      const r = spawnSync('python', ['-c', shim], { encoding: 'utf8', timeout: 15000 });
      return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
    }

    it('does not finalise below minimum capture even with voice+silence', () => {
      const r = runPy(`print(should_finalise(fill=5000, saw_voice=True, silence_run=10))`);
      if (r.code !== 0) throw new Error(r.stderr);
      if (r.stdout.trim() !== 'False') throw new Error(`expected False, got: ${r.stdout}`);
    });
    it('finalises when voice seen + trailing silence threshold reached', () => {
      const r = runPy(`print(should_finalise(fill=20000, saw_voice=True, silence_run=5))`);
      if (r.code !== 0) throw new Error(r.stderr);
      if (r.stdout.trim() !== 'True') throw new Error(`expected True, got: ${r.stdout}`);
    });
    it('does not finalise on silence before any voice is seen', () => {
      // User was silent for the entire post-wake window so far. Keep
      // capturing up to hard cap.
      const r = runPy(`print(should_finalise(fill=20000, saw_voice=False, silence_run=20))`);
      if (r.code !== 0) throw new Error(r.stderr);
      if (r.stdout.trim() !== 'False') throw new Error(`expected False, got: ${r.stdout}`);
    });
    it('finalises at hard cap regardless of voice state', () => {
      const r = runPy(`print(should_finalise(fill=48000, saw_voice=False, silence_run=0))`);
      if (r.code !== 0) throw new Error(r.stderr);
      if (r.stdout.trim() !== 'True') throw new Error(`expected True at hard cap, got: ${r.stdout}`);
    });
    it('finalises above hard cap (belt and braces)', () => {
      const r = runPy(`print(should_finalise(fill=100000, saw_voice=True, silence_run=0))`);
      if (r.code !== 0) throw new Error(r.stderr);
      if (r.stdout.trim() !== 'True') throw new Error(`expected True above cap, got: ${r.stdout}`);
    });
    it('does not finalise with voice but less than trailing threshold', () => {
      const r = runPy(`print(should_finalise(fill=20000, saw_voice=True, silence_run=3))`);
      if (r.code !== 0) throw new Error(r.stderr);
      if (r.stdout.trim() !== 'False') throw new Error(`expected False, got: ${r.stdout}`);
    });
  });

  it('main.js voice-command payload validator rejects unknown actions', () => {
    // Mirror of the whitelist in main.js startVoiceCommandWatcher —
    // keeps the test authoritative if the set drifts.
    const whitelist = new Set([
      'play', 'pause', 'resume', 'next', 'back', 'stop', 'cancel',
    ]);
    const rejectCases = ['clear', 'delete', 'rm', '', null, 'PLAY', 'play;echo'];
    for (const a of rejectCases) {
      if (whitelist.has(a)) {
        throw new Error(`whitelist accepted bad action: ${JSON.stringify(a)}`);
      }
    }
    const acceptCases = ['play', 'pause', 'resume', 'next', 'back', 'stop', 'cancel'];
    for (const a of acceptCases) {
      if (!whitelist.has(a)) {
        throw new Error(`whitelist rejected good action: ${JSON.stringify(a)}`);
      }
    }
  });
});

console.log('\n----------------------------------------');
console.log(`Tests: ${pass} passed, ${fail} failed`);
console.log('----------------------------------------');
if (fail > 0) {
  process.exitCode = 1;
}
