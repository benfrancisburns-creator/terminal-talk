#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
const failures = [];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function json(rel) {
  return JSON.parse(read(rel));
}

function test(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    fail += 1;
    const message = err && err.message ? err.message : String(err);
    failures.push({ name, message });
    console.log(`  fail ${name}\n      ${message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function assertIncludes(haystack, needle, label = needle) {
  assert(String(haystack).includes(needle), `missing ${label}`);
}

function assertNotIncludes(haystack, needle, label = needle) {
  assert(!String(haystack).includes(needle), `unexpected ${label}`);
}

function section(title) {
  console.log(`\n${title}`);
}

section('macOS packaging contract');

test('Electron mac plist declares every macOS privacy prompt Terminal Talk uses', () => {
  const pkg = json('app/package.json');
  const info = pkg.build && pkg.build.mac && pkg.build.mac.extendInfo;
  assert(info && typeof info === 'object', 'build.mac.extendInfo missing');
  for (const key of [
    'NSMicrophoneUsageDescription',
    'NSAppleEventsUsageDescription',
    'NSSpeechRecognitionUsageDescription',
  ]) {
    assert(typeof info[key] === 'string' && info[key].length > 40, `${key} missing or too short`);
  }
  assert(/on-device Speech Recognition/i.test(info.NSSpeechRecognitionUsageDescription),
    'speech permission text should explain on-device recognition');
  assert(/Dictation/i.test(info.NSAppleEventsUsageDescription),
    'Apple Events permission text should mention the start-dictation automation path');
});

test('mac helper Python files are included in asarUnpack for direct execution', () => {
  const pkg = json('app/package.json');
  const unpack = pkg.build && pkg.build.asarUnpack;
  assert(Array.isArray(unpack), 'build.asarUnpack must be an array');
  for (const rel of [
    '**/posix_hooks.py',
    '**/wake-word-listener.py',
    '**/wake_word_config.py',
    '**/key_helper.py',
    '**/mic_watcher_mac.py',
    '**/voice_command_recognize_mac.py',
    '**/statusline.py',
    '**/claude_footer_scrape.py',
  ]) {
    assert(unpack.includes(rel), `asarUnpack missing ${rel}`);
  }
});

test('mac dependency manifests are shipped as extra resources', () => {
  const pkg = json('app/package.json');
  const resources = pkg.build && pkg.build.extraResources;
  assert(Array.isArray(resources), 'build.extraResources must be an array');
  const froms = resources.map((r) => r && r.from).filter(Boolean);
  for (const rel of [
    '../requirements.txt',
    '../requirements-wakeword.txt',
    '../requirements-mac.txt',
  ]) {
    assert(froms.includes(rel), `extraResources missing ${rel}`);
  }
});

test('requirements-mac.txt covers Quartz, AppKit/Foundation, Speech, CoreAudio, and psutil', () => {
  const req = read('requirements-mac.txt');
  for (const needle of [
    'pyobjc-framework-Quartz',
    'pyobjc-framework-Cocoa',
    'pyobjc-framework-Speech',
    'pyobjc-framework-CoreAudio',
    'psutil',
  ]) {
    assertIncludes(req, needle);
  }
});

section('macOS platform behavior');

test('platform contract enables mac features and disables Windows-only automation', () => {
  const { createPlatform } = require(path.join(ROOT, 'app', 'lib', 'platform.js'));
  const p = createPlatform({
    platform: 'darwin',
    homedir: '/Users/ben',
    env: {},
    path: path.posix,
  });
  assert(p.isMac === true, 'isMac should be true');
  assert(p.installDir === '/Users/ben/.terminal-talk', `unexpected installDir ${p.installDir}`);
  assert(p.pythonExe === 'python3', `unexpected pythonExe ${p.pythonExe}`);
  assert(p.hookShell === 'posix', `unexpected hookShell ${p.hookShell}`);
  assert(p.supportsMacMicWatcher === true, 'mac mic watcher should be enabled');
  assert(p.supportsWindowsMicWatcher === false, 'Windows mic watcher should be disabled');
  assert(p.supportsCodexRolloutWatcher === true, 'Codex rollout watcher should be platform-neutral');
  assert(p.supportsCodexIdentitySync === false, 'Windows Terminal title identity sync is Windows-only');
  assert(p.supportsWindowsTerminalTabColor === false, 'Windows Terminal tab colour is Windows-only');
  assert(p.supportsWindowsFooterWatcher === false, 'Windows UIA footer watcher is Windows-only');
  assert(p.supportsPosixFooterClip === true, 'POSIX footer clips should be enabled');
  assert(p.supportsMacTerminalFooterScrape === true, 'Terminal.app/iTerm2 footer scraping should be enabled on macOS');
  assert(p.supportsFooterScrape === false, 'legacy main-process footer watcher flag stays Windows-only');
});

test('toolbar session launcher has an osascript Terminal.app path for macOS', () => {
  const src = read('app/lib/codex-launch.js');
  assertIncludes(src, "process.platform === 'darwin'", 'darwin branch');
  assertIncludes(src, "spawn('osascript'", 'osascript launcher');
  assertIncludes(src, 'tell application "Terminal"', 'Terminal.app AppleScript');
  assertIncludes(src, 'reserveToolbarLaunchIdentity', 'mac launcher pre-reserves toolbar identity');
  assertIncludes(src, 'TT_LAUNCH_TOKEN', 'mac launcher exports launch-token migration hint');
  assertIncludes(src, 'TT_LAUNCH_LABEL', 'mac launcher exports launch label');
  assertIncludes(src, 'TT_LAUNCH_INDEX', 'mac launcher exports launch palette index');
  assertIncludes(src, 'formatTerminalTalkLaunchTitle', 'mac launcher formats Terminal Talk identity title');
  assertIncludes(src, 'colourMarkerForIndex(index)', 'mac launcher includes the palette marker in the terminal title');
  assertIncludes(src, 'macTitleRefreshCommand', 'mac launcher refreshes terminal title from the registry while the assistant runs');
  assertIncludes(src, 'source_originator', 'mac title refresh follows the migrated toolbar launch identity');
  assertIncludes(src, 'registryLabel', 'mac launcher keeps the registry label separate from the visible terminal title');
  assert(!/tui\.status_line/.test(src), 'mac Codex launch path must not inject a raw Codex session id into the TUI status line');
  assert(!/tui\.terminal_title/.test(src), 'mac Codex launch path must leave Terminal Talk in charge of terminal titles');
  assertIncludes(src, "process.platform !== 'win32'", 'non-Windows guard');
  assertIncludes(src, 'assistant-wt-launch.ps1', 'Windows Terminal bridge remains isolated to win32 branch');
});

test('POSIX hooks migrate mac toolbar launch identity onto the real session', () => {
  const src = read('app/posix_hooks.py');
  assertIncludes(src, 'def migrate_by_launch_token', 'launch-token migration helper');
  assertIncludes(src, "toolbar-launch:", 'toolbar launch marker');
  assertIncludes(src, 'TT_LAUNCH_TOKEN', 'reads launch token env');
  assertIncludes(src, 'apply_toolbar_launch_intent', 'applies launch label/index/pin');
  assertIncludes(src, "assistant_label='Claude Code'", 'Claude hooks stamp toolbar launch source label');
  assertIncludes(src, "assistant_label='Codex'", 'Codex hooks stamp toolbar launch source label');
});

section('macOS helper contracts');

test('key helper uses Quartz Cmd+C and NSWorkspace without Screen Recording', () => {
  const src = read('app/key_helper.py');
  assertIncludes(src, 'IS_MAC');
  assertIncludes(src, 'Quartz.CGEventCreateKeyboardEvent');
  assertIncludes(src, 'Quartz.kCGEventFlagMaskCommand');
  assertIncludes(src, 'NSWorkspace.sharedWorkspace');
  assert(!/CGWindowListCopyWindowInfo\s*\(/.test(src), 'must not call the Screen Recording window-list API');
});

test('mic watcher uses CoreAudio process input state and excludes Terminal Talk itself', () => {
  const src = read('app/mic_watcher_mac.py');
  for (const needle of [
    'kAudioHardwarePropertyProcessObjectList',
    'kAudioProcessPropertyIsRunningInput',
    'kAudioProcessPropertyPID',
    'wake-word-listener.py',
    'MIC_CAPTURED',
    'MIC_RELEASED',
  ]) {
    assertIncludes(src, needle);
  }
});

test('mac voice command recognizer stays local and mirrors the Windows action grammar', () => {
  const src = read('app/voice_command_recognize_mac.py');
  for (const needle of [
    'SFSpeechRecognizer',
    'setRequiresOnDeviceRecognition_(True)',
    'PHRASE_TO_ACTION',
    "'play': 'play'",
    "'pause': 'pause'",
    "'resume': 'resume'",
    "'skip': 'next'",
    "'previous': 'back'",
    "'stop talking': 'stop'",
    'MIN_CONFIDENCE = 0.8',
  ]) {
    assertIncludes(src, needle);
  }
});

test('wake-word listener dispatches to the mac Speech recognizer under sys.executable', () => {
  const src = read('app/wake-word-listener.py');
  for (const needle of [
    "IS_MAC = sys.platform == 'darwin'",
    "_MAC_RECOGNIZER_SCRIPT",
    '[sys.executable, str(_MAC_RECOGNIZER_SCRIPT), str(wav_path)]',
    'Quartz.kCGEventFlagMaskControl',
    'Quartz.kCGEventFlagMaskShift',
  ]) {
    assertIncludes(src, needle);
  }
});

section('POSIX hooks and installer');

test('all macOS/POSIX hook wrappers delegate to the shared runner', () => {
  const runner = read('hooks/_posix-hook-runner.sh');
  for (const needle of ['TT_HOME', 'TT_APP_DIR', 'TT_PYTHON_EXE', 'posix_hooks.py', 'terminal-talk.env']) {
    assertIncludes(runner, needle);
  }
  for (const hook of [
    'mark-working.sh',
    'speak-on-tool.sh',
    'speak-response.sh',
    'speak-notification.sh',
    'codex-session-start.sh',
    'codex-mark-working.sh',
    'codex-on-tool.sh',
    'codex-post-tool.sh',
    'codex-stop.sh',
  ]) {
    const src = read(path.join('hooks', hook));
    assert(/^#!\/usr\/bin\/env sh/.test(src), `${hook} must be POSIX sh`);
    assertIncludes(src, '_posix-hook-runner.sh', `${hook} runner delegation`);
  }
});

test('POSIX hook implementation covers Claude, Codex, daemon synth, and plugin cleanup', () => {
  const src = read('app/posix_hooks.py');
  for (const needle of [
    'def handle_claude_mark',
    'def handle_claude_tool',
    'def handle_claude_stop',
    'def handle_codex',
    'def spawn_synth',
    'SYNTH_DAEMON_SOCKET',
    'def remove_plugin_session',
    'def schedule_plugin_cleanup',
    'def write_codex_stop_marker',
    'codex-post-tool',
    'codex-stop',
  ]) {
    assertIncludes(src, needle);
  }
});

test('Codex stop closer uses rollout timestamps before hook elapsed fallback', () => {
  const src = read('app/lib/codex-session-watcher.js');
  const scraper = read('app/claude_footer_scrape.py');
  assertIncludes(scraper, 'def scrape_codex_footer_for_pid');
  assertIncludes(scraper, '_CODEX_FOOTER_LINE_RE');
  for (const needle of [
    'humaniseFooterPhrase',
    'function _elapsedFromRolloutSession',
    'payload.type === \'user_message\'',
    'payload.phase === \'final\'',
    'payload.type === \'task_complete\'',
    'const visibleFooter = humaniseFooterPhrase',
    'accurateElapsed = visibleFooter ? 0 : _elapsedFromRolloutSession',
    'Codex worked for',
    'Codex finished.',
    'visible footer',
    'rollout elapsed',
    'hook elapsed fallback',
    'no duration',
  ]) {
    assertIncludes(src, needle);
  }
});

test('install.sh enables current Codex hooks feature and does not write deprecated codex_hooks', () => {
  const src = read('install.sh');
  assertIncludes(src, "set_key(lines, 'features', 'hooks', 'true')", 'features.hooks writer');
  assertIncludes(src, "line.split('=', 1)[0].strip() != 'codex_hooks'", 'deprecated flag cleanup');
  assertNotIncludes(src, "set_key(lines, 'features', 'codex_hooks'", 'deprecated codex_hooks writer');
  for (const hook of [
    'codex-session-start.sh',
    'codex-mark-working.sh',
    'codex-on-tool.sh',
    'codex-post-tool.sh',
    'codex-stop.sh',
  ]) {
    assertIncludes(src, hook);
  }
});

test('tt-doctor gives mac users Codex hook-review context', () => {
  const src = read('scripts/tt-doctor.sh');
  for (const needle of [
    'codex-post-tool.sh',
    'codex-stop.sh',
    'open /hooks and approve the Terminal Talk commands',
    'Codex hooks feature enabled',
    'deprecated Codex hook flag present',
    'start with: bash $TT_HOME/start-toolbar.sh',
  ]) {
    assertIncludes(src, needle);
  }
});

section('macOS smoke checks');

test('tt-doctor shell syntax is valid', () => {
  const r = spawnSync('bash', ['-n', path.join(ROOT, 'scripts', 'tt-doctor.sh')], {
    encoding: 'utf8',
    timeout: 10000,
  });
  assert(r.status === 0, r.stderr || r.stdout || `bash -n exited ${r.status}`);
});

test('tt-doctor can complete on macOS with --no-net when run locally', () => {
  if (process.platform !== 'darwin') {
    console.log('      skipped: not running on darwin');
    return;
  }
  const r = spawnSync('bash', [path.join(ROOT, 'scripts', 'tt-doctor.sh'), '--no-net'], {
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, TERM: 'dumb' },
  });
  assert(r.status === 0 || r.status === 1, `unexpected exit ${r.status}: ${r.stderr || r.stdout}`);
  assertIncludes(r.stdout, 'Summary');
  assert(/passed.*warning.*failures/i.test(r.stdout), 'summary tally missing');
});

console.log('\n----------------------------------------');
console.log(`macOS tests: ${pass} passed, ${fail} failed`);
console.log('----------------------------------------');

if (fail > 0) {
  for (const failure of failures) {
    console.error(`- ${failure.name}: ${failure.message}`);
  }
  process.exitCode = 1;
}
