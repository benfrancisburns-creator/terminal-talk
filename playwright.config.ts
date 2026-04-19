import { defineConfig } from '@playwright/test';

/**
 * Terminal Talk — Playwright test config.
 *
 * These tests drive the real Electron toolbar end-to-end. They cover UI
 * interactions that the logic-only harness (scripts/run-tests.cjs) can't
 * touch: rendering, click handlers, IPC round-trips, timer-driven state
 * transitions, and cross-window click-through.
 *
 * Run with:   npx playwright test
 *             npx playwright test --ui       (interactive debug)
 *             npx playwright test --headed   (see the windows)
 *
 * CI runs with `retries: 2` to smooth over the occasional Windows focus
 * race; locally we want failures to surface fast so retries are 0.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,        // Electron tests share the filesystem queue dir
  workers: 1,                   // same reason — don't race each other
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
