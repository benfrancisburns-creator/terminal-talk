/**
 * Runs once before the whole Playwright suite. Purpose: verify the Electron
 * binary exists at the expected path so failures surface as a crisp "binary
 * missing" message instead of a cryptic timeout 30 s into the first test.
 *
 * Wired from playwright.config.ts via `globalSetup: './global-setup.ts'`.
 * Matches the cross-platform logic in fixtures.ts (H4) so any future port
 * keeps working.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export default async function globalSetup(): Promise<void> {
  const APP_DIR = resolve(__dirname, '..', '..', 'app');
  const binaryName =
    process.platform === 'win32'  ? 'electron.exe' :
    process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' :
    'electron';
  const binary = join(APP_DIR, 'node_modules', 'electron', 'dist', binaryName);

  if (!existsSync(binary)) {
    throw new Error(
      `Electron binary not found at ${binary}.\n` +
      `  Run \`npm install --prefix app\` from the repo root to install it.\n` +
      `  (Skipping this check and letting the first test time out produces an ` +
      `opaque failure 30 s later.)`
    );
  }
}
