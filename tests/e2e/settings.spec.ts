import { test, expect } from './fixtures';
import { openSettings, clickById, switchSettingsTab } from './helpers';

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

  test('Playback section shows speed + collapse-delay + auto-prune controls', async ({ window }) => {
    await openSettings(window);
    await expect(window.locator('#speedSlider')).toBeVisible();
    await expect(window.locator('#collapseDelaySec')).toBeVisible();
    // The underlying <input type=checkbox> is visually hidden under the
    // new pill-toggle UI (2026-04-23); the visible control is the pair
    // of .tri-btn pill buttons inside the .pill-toggle wrapper. Check
    // that the hidden input is attached AND the pill pair is visible.
    await expect(window.locator('#autoPruneToggle')).toBeAttached();
    const prunePill = window.locator('#autoPruneToggle').locator('..');
    await expect(prunePill.locator('.tri-btn.on')).toBeVisible();
    await expect(prunePill.locator('.tri-btn.off')).toBeVisible();
    await expect(window.locator('#autoPruneSec')).toBeVisible();
  });

  test('settings tabs switch between section pages', async ({ window }) => {
    await openSettings(window);
    await expect(window.locator('#speedSlider')).toBeVisible();
    await expect(window.locator('#sessionsTable')).not.toBeVisible();

    await switchSettingsTab(window, 'sessions');
    await expect(window.locator('#sessionsTable')).toBeVisible();
    await expect(window.locator('#speedSlider')).not.toBeVisible();

    await switchSettingsTab(window, 'shortcuts');
    await expect(window.locator('#hotkeyToggleWindow')).toBeVisible();
    await expect(window.locator('#sessionsTable')).not.toBeVisible();
  });

  test('auto-collapse delay clamps to 1-120 seconds', async ({ window }) => {
    await openSettings(window);
    const delayInput = window.locator('#collapseDelaySec');
    await delayInput.fill('999');
    await delayInput.press('Tab');
    await expect(delayInput).toHaveValue('120');

    await delayInput.fill('0');
    await delayInput.press('Tab');
    await expect(delayInput).toHaveValue('1');
  });

  test('auto-prune toggle persists a change to the config', async ({ window }) => {
    await openSettings(window);
    const toggle = window.locator('#autoPruneToggle');
    await expect(toggle).toBeChecked();
    // Click the "Off" pill — clicking the hidden <input> directly has
    // pointer-events: none under the new pill-toggle UI.
    const prunePill = toggle.locator('..');
    await prunePill.locator('.tri-btn.off').click();
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

  test('S6: About panel renders hero artwork', async ({ window }) => {
    await openSettings(window, 'about');
    // The About panel was refactored away from the ASCII banner to an
    // SVG hero (commit 203190f); the wallpaper card wraps an <img>
    // sourced from app/assets/about-terminal-talk-hero.svg.
    await expect(window.locator('figure.about-wallpaper-card img')).toBeVisible();
  });

  test('S6b: Shortcuts panel renders 8 hotkey rows + 1 status row', async ({ window }) => {
    await openSettings(window, 'shortcuts');
    // Shortcuts moved to their own tab (`shortcutsSection`) and are now
    // hotkey-input rows instead of a <table>. 8 hotkey rows (show/hide,
    // read-selection, mic-listener, dictate-and-paste, hands-free-dictation,
    // pause/resume, pause-only, start-dictation) + 1 status row (= 9).
    const rows = window.locator('[data-settings-page="shortcuts"] .row');
    await expect(rows).toHaveCount(9);
    const hotkeyRows = window.locator('[data-settings-page="shortcuts"] .hotkey-row');
    await expect(hotkeyRows).toHaveCount(8);
  });

  test('EX5: palette-variant toggle off by default; body attr = "default"', async ({ window }) => {
    await openSettings(window);
    const toggle = window.locator('#paletteVariantToggle');
    await expect(toggle).toBeAttached();
    await expect(toggle).not.toBeChecked();
    const variant = await window.evaluate(() => document.body.dataset.paletteVariant);
    if (variant !== 'default') throw new Error(`expected body[data-palette-variant="default"], got "${variant}"`);
  });

  test('EX5: toggling palette-variant flips body attr and persists', async ({ window }) => {
    await openSettings(window);
    await clickById(window, 'paletteVariantToggle');
    const variantOn = await window.evaluate(() => document.body.dataset.paletteVariant);
    if (variantOn !== 'cb') throw new Error(`expected "cb", got "${variantOn}"`);
    // Toggle back — fast round-trip.
    await clickById(window, 'paletteVariantToggle');
    const variantOff = await window.evaluate(() => document.body.dataset.paletteVariant);
    if (variantOff !== 'default') throw new Error(`expected "default", got "${variantOff}"`);
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
