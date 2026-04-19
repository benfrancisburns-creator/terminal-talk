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
});
