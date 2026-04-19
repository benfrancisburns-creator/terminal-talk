import { test, expect } from './fixtures';

/**
 * Smoke tests — if these fail, the Electron app isn't even launching
 * correctly and no other test will work. Keep them minimal and fast.
 */

test('toolbar launches and renders the bar element', async ({ window }) => {
  const bar = window.locator('#bar');
  await expect(bar).toBeAttached();
  await expect(bar).toBeVisible();
});

test('both rows render — top (controls) and bottom (dots)', async ({ window }) => {
  await expect(window.locator('.bar-top')).toBeVisible();
  await expect(window.locator('.dots-row')).toBeAttached();
});

test('all control buttons are present in the top row', async ({ window }) => {
  await expect(window.locator('#back10')).toBeVisible();
  await expect(window.locator('#playPause')).toBeVisible();
  await expect(window.locator('#fwd10')).toBeVisible();
  await expect(window.locator('#scrubber')).toBeVisible();
  await expect(window.locator('#time')).toBeVisible();
  await expect(window.locator('#clearPlayed')).toBeVisible();
  await expect(window.locator('#settingsBtn')).toBeVisible();
  await expect(window.locator('#close')).toBeVisible();
});

test('dots strip starts empty', async ({ window }) => {
  const dots = window.locator('.dots .dot');
  await expect(dots).toHaveCount(0);
});
