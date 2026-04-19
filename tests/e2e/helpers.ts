import { Page, expect } from '@playwright/test';

/**
 * Opens the settings panel and waits for the window to finish resizing
 * + the panel content to become visible. Fire-and-forget click isn't
 * enough because main.js resizes the BrowserWindow synchronously but
 * Chromium's layout reflow takes a beat to catch up.
 */
export async function openSettings(window: Page): Promise<void> {
  // Use .evaluate() instead of .click() — Playwright's synthetic mouse
  // events race with our Electron mousemove→IPC click-through pipeline
  // even with TT_TEST_MODE on. Calling the button's click() via the page
  // context fires the same handler with no mouse race.
  await window.evaluate(() => {
    (document.getElementById('settingsBtn') as HTMLElement)?.click();
  });
  await expect(window.locator('body.settings-open')).toHaveCount(1, { timeout: 5000 });
  await expect(window.locator('#panel')).toBeVisible({ timeout: 2000 });
  // Wait a frame so the BrowserWindow resize + Chromium reflow settle
  // before the test starts interacting with panel contents.
  await window.waitForFunction(() => document.getElementById('sessionsTable') !== null);
}

/** Programmatically click any element by id — bypasses mouse races. */
export async function clickById(window: Page, id: string): Promise<void> {
  await window.evaluate((elId) => {
    const el = document.getElementById(elId) as HTMLElement | null;
    if (el) el.click();
  }, id);
}

/** Programmatically click an element by CSS selector. */
export async function clickByCss(window: Page, selector: string): Promise<void> {
  await window.evaluate((s) => {
    const el = document.querySelector(s) as HTMLElement | null;
    if (el) el.click();
  }, selector);
}
