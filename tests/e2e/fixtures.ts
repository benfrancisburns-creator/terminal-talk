import { _electron as electron, test as base, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Shared Electron launch / teardown for all e2e tests.
 *
 * Each test gets a fresh Electron instance pointed at the repo's app/
 * directory, with TT_INSTALL_DIR set to a per-test temp dir so nothing
 * touches the user's real ~/.terminal-talk state.
 *
 * Tests that want pre-seeded registry entries use test.use({ seed: ... })
 * to set assignments / config BEFORE the Electron process starts.
 */

const APP_DIR = path.resolve(__dirname, '..', '..', 'app');
// Cross-platform electron binary path — Windows today, Mac/Linux future.
// Audit H4: hardcoded electron.exe blocks any future port.
const ELECTRON_BIN = path.join(
  APP_DIR, 'node_modules', 'electron', 'dist',
  process.platform === 'win32' ? 'electron.exe' :
  process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' :
  'electron'
);

export type Seed = {
  assignments?: Record<string, any>;
  config?: Record<string, any>;
};

type Fixtures = {
  seed: Seed;
  tmpDir: string;
  app: ElectronApplication;
  window: Page;
};

export const test = base.extend<Fixtures>({
  seed: [{} as Seed, { option: true }],

  tmpDir: async ({ seed }, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-e2e-'));
    fs.mkdirSync(path.join(dir, 'queue'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
    const cfg = {
      voices: { edge_response: 'en-GB-RyanNeural' },
      playback: { speed: 1.25, auto_prune: true, auto_prune_sec: 20 },
      hotkeys: {
        toggle_window: 'Control+Shift+A',
        speak_clipboard: 'Control+Shift+S',
        toggle_listening: 'Control+Shift+J',
        pause_resume: 'Control+Shift+P',
        pause_only: 'Control+Shift+O',
      },
      ...(seed.config || {}),
    };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2));
    if (seed.assignments) {
      fs.writeFileSync(
        path.join(dir, 'session-colours.json'),
        JSON.stringify({ assignments: seed.assignments }, null, 2)
      );
    }
    await use(dir);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  },

  app: async ({ tmpDir }, use) => {
    if (!fs.existsSync(ELECTRON_BIN)) {
      throw new Error(
        `Electron binary not found at ${ELECTRON_BIN}. Run "cd app && npm install" first.`
      );
    }
    const app = await electron.launch({
      executablePath: ELECTRON_BIN,
      args: [APP_DIR],
      env: {
        ...process.env,
        TT_INSTALL_DIR: tmpDir,
        TT_TEST_MODE: '1',
      },
      timeout: 20_000,
    });
    await use(app);
    await app.close().catch(() => {});
  },

  window: async ({ app }, use) => {
    const win = await app.firstWindow({ timeout: 10_000 });
    await win.waitForLoadState('domcontentloaded');
    await use(win);
  },
});

export { expect } from '@playwright/test';
