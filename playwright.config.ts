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
  // D2-11 — fail fast if the Electron binary is missing before the first
  // test times out 30 s in. Logic mirrors fixtures.ts (H4) so cross-
  // platform stays consistent with how tests actually spawn Electron.
  globalSetup: require.resolve('./tests/e2e/global-setup.ts'),
  // D2-11 — surface tests that take more than 5 s. Catches flakiness
  // creep (a test that slowly gains a race under load) before it's
  // blocking CI. Nothing today should be over ~3 s; tighten once
  // the baseline is stable across 10+ CI runs.
  reportSlowTests: { max: 5, threshold: 5_000 },
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
