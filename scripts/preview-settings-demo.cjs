#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('@playwright/test');

const root = path.resolve(__dirname, '..');
const appDir = path.join(root, 'app');
const electronBin = path.join(
  appDir,
  'node_modules',
  'electron',
  'dist',
  process.platform === 'win32' ? 'electron.exe' :
    process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' :
      'electron'
);
const outDir = path.join(root, 'tmp', 'settings-demo-preview');

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function seedHome() {
  const dir = fs.mkdtempSync(path.join(root, 'tmp', 'settings-preview-home-'));
  fs.mkdirSync(path.join(dir, 'queue'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'listening.state'), 'off', 'ascii');

  writeJson(path.join(dir, 'config.json'), {
    voices: {
      edge_clip: 'en-GB-SoniaNeural',
      edge_response: 'en-GB-RyanNeural',
      openai_clip: 'shimmer',
      openai_response: 'onyx',
    },
    hotkeys: {
      toggle_window: 'Control+Shift+A',
      speak_clipboard: 'Control+Shift+S',
      toggle_listening: 'Control+Shift+J',
      pause_resume: 'Control+Shift+P',
      pause_only: 'Control+Shift+O',
    },
    playback: {
      speed: 1.05,
      auto_prune: false,
      auto_prune_sec: 28,
      auto_continue_after_click: true,
      palette_variant: 'default',
      tts_provider: 'edge',
      tts_fallback_provider: 'edge',
      master_volume: 1,
    },
    speech_includes: {
      code_blocks: false,
      inline_code: false,
      urls: false,
      headings: true,
      bullet_markers: true,
      image_alt: false,
      tool_calls: true,
    },
    heartbeat_enabled: true,
    selected_tab: 'all',
    tabs_expanded: true,
    openai_api_key: null,
    window: { x: 80, y: 80, dock: null },
    panels: { transcript_expanded: false, transcript_view: 'spoken' },
  });

  const now = Math.floor(Date.now() / 1000);
  writeJson(path.join(dir, 'session-colours.json'), {
    assignments: {
      c0dec0de: {
        index: 0,
        label: 'Codex demo',
        session_id: 'c0dec0de-session',
        claude_pid: 0,
        pinned: true,
        muted: false,
        focus: true,
        last_seen: now,
        speech_includes: { tool_calls: true },
      },
      deadbeef: {
        index: 4,
        label: 'Claude docs',
        session_id: 'deadbeef-session',
        claude_pid: 0,
        pinned: true,
        muted: false,
        focus: false,
        last_seen: now,
      },
      feedc0de: {
        index: 16,
        label: 'Audit run',
        session_id: 'feedc0de-session',
        claude_pid: 0,
        pinned: true,
        muted: false,
        focus: false,
        last_seen: now,
      },
    },
  });
  return dir;
}

async function main() {
  if (!fs.existsSync(electronBin)) {
    throw new Error(`Electron binary not found at ${electronBin}`);
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const home = seedHome();
  const app = await electron.launch({
    executablePath: electronBin,
    args: [appDir],
    env: {
      ...process.env,
      TT_INSTALL_DIR: home,
      TT_TEST_MODE: '1',
      TT_CAPTURE_MODE: '1',
      TT_CAPTURE_X: '80',
      TT_CAPTURE_Y: '80',
      TT_CAPTURE_WIDTH: '900',
      TT_CAPTURE_HEIGHT: '900',
      TT_DEMO_SETTINGS_MODE: '1',
      TT_DEMO_SETTINGS_START_FALLBACK_MS: '1000',
      TT_DEMO_SETTINGS_VISUAL_DURATION_MS: '66000',
    },
    timeout: 20_000,
  });

  try {
    const page = await app.firstWindow({ timeout: 10_000 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('#bar', { state: 'visible', timeout: 5_000 });

    const frames = [
      ['01-gear-open', 1_800],
      ['02-speed-volume', 4_300],
      ['03-auto-prune', 6_400],
      ['04-auto-prune-detail', 12_300],
      ['05-heartbeat', 16_800],
      ['06-toolcalls-before-scroll', 21_300],
      ['07-sessions-start', 26_300],
      ['08-session-label', 28_200],
      ['09-session-focus', 30_700],
      ['10-session-mute', 32_600],
      ['11-colour-list-open', 35_800],
      ['12-voice-list-open', 42_000],
      ['13-include-hold-early', 51_000],
      ['14-include-hold-late', 57_500],
      ['15-about-ascii-ending', 62_200],
    ];

    const started = Date.now();
    const demoStartOffsetMs = 1_000;
    for (const [name, ms] of frames) {
      const wait = ms + demoStartOffsetMs - (Date.now() - started);
      if (wait > 0) await page.waitForTimeout(wait);
      const file = path.join(outDir, `${name}.png`);
      await page.screenshot({ path: file, fullPage: false, omitBackground: false });
      console.log(`${name} ${file}`);
    }
  } finally {
    await app.close().catch(() => {});
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
