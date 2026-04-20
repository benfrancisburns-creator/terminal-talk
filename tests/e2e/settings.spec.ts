import { test, expect } from './fixtures';
import { openSettings, clickById } from './helpers';

test.describe('Settings panel', () => {
  test('opens and closes when ⚙ cog is clicked', async ({ window }) => {
    const panel = window.locator('#panel');
    await expect(window.locator('body.settings-open')).toHaveCount(0);

    await openSettings(window);
    await expect(window.locator('body.settings-open')).toHaveCount(1);
    await expect(panel).toBeVisible();

    // Second click closes — don't reuse openSettings (its last assertion
    // expects the panel to still be OPEN after the click).
    await clickById(window, 'settingsBtn');
    await expect(window.locator('body.settings-open')).toHaveCount(0);
  });

  test('Playback section shows speed + auto-prune controls', async ({ window }) => {
    await openSettings(window);
    await expect(window.locator('#speedSlider')).toBeVisible();
    // The checkbox itself is visually hidden (the .toggle-slider span takes
    // its place). Check that both exist and the slider is visible.
    await expect(window.locator('#autoPruneToggle')).toBeAttached();
    await expect(window.locator('.toggle-slider').first()).toBeVisible();
    await expect(window.locator('#autoPruneSec')).toBeVisible();
  });

  test('auto-prune toggle persists a change to the config', async ({ window }) => {
    await openSettings(window);
    const toggle = window.locator('#autoPruneToggle');
    await expect(toggle).toBeChecked();
    await clickById(window, 'autoPruneToggle');
    await expect(toggle).not.toBeChecked();
    await expect(window.locator('#autoPruneSec')).toBeDisabled();
  });

  test('auto-prune seconds clamps to 3-600', async ({ window }) => {
    await openSettings(window);
    const secInput = window.locator('#autoPruneSec');
    await secInput.fill('9999');
    await secInput.press('Tab');
    await expect(secInput).toHaveValue('600');

    await secInput.fill('1');
    await secInput.press('Tab');
    await expect(secInput).toHaveValue('3');
  });

  // S6 — new tests targeting gaps surfaced by the v0.4 quality-tier audit.

  test('S6: auto-continue-after-click toggle exists and is ON by default (v0.3.6)', async ({ window }) => {
    await openSettings(window);
    const toggle = window.locator('#autoContinueToggle');
    await expect(toggle).toBeAttached();
    await expect(toggle).toBeChecked();
  });

  test('S6: auto-continue-after-click toggle persists a change', async ({ window }) => {
    await openSettings(window);
    const toggle = window.locator('#autoContinueToggle');
    await clickById(window, 'autoContinueToggle');
    await expect(toggle).not.toBeChecked();
    await clickById(window, 'autoContinueToggle');
    await expect(toggle).toBeChecked();
  });

  test('S6: speed slider displays its current value via the readout', async ({ window }) => {
    await openSettings(window);
    const readout = window.locator('#speedValue');
    await expect(readout).toBeVisible();
    // Default is 1.25 per fixtures.ts seed; readout format is e.g. "1.25x".
    await expect(readout).toContainText('1.25');
  });

  test('S6: About Terminal Talk section renders with ASCII banner + shortcuts table', async ({ window }) => {
    await openSettings(window);
    // ASCII banner is wrapped in <pre class="ascii-banner"> per index.html.
    await expect(window.locator('pre.ascii-banner')).toBeVisible();
    // Shortcuts table — now wrapped in <thead>/<tbody> for a11y (v0.3.8 N5-N9 fixes).
    // Row count (5 shortcuts + 1 "hey jarvis" row = 6 kbd rows).
    const rows = window.locator('table.shortcuts tbody tr');
    await expect(rows).toHaveCount(6);
  });

  test('S6: the strict-CSP requires style-src self (no unsafe-inline)', async ({ window }) => {
    // D2-9 invariant check. Runtime CSP must lack unsafe-inline in style-src.
    // If this fails, the renderer has regressed to inline styles — fix by
    // using data-palette attributes + Constructable Stylesheet helpers.
    const csp = await window.evaluate(() => {
      const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]') as HTMLMetaElement | null;
      return meta?.content || '';
    });
    if (!/style-src\b[^;]*'self'/.test(csp)) {
      throw new Error(`CSP missing style-src 'self': ${csp}`);
    }
    if (/style-src\b[^;]*'unsafe-inline'/.test(csp)) {
      throw new Error(`CSP style-src still has 'unsafe-inline' (D2-9 regression): ${csp}`);
    }
  });
});
