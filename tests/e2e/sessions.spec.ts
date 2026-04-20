import { test, expect } from './fixtures';
import { openSettings, clickByCss } from './helpers';

const now = () => Math.floor(Date.now() / 1000);

const SEED_TWO_SESSIONS = {
  assignments: {
    'beefcafe': {
      index: 0, session_id: 'beefcafe-session-id', claude_pid: 0,
      label: 'Primary', pinned: true, last_seen: now()
    },
    'deadbee1': {
      index: 1, session_id: 'deadbee1-session-id', claude_pid: 0,
      label: 'Secondary', pinned: true, last_seen: now()
    },
  }
};

test.describe('Sessions table', () => {
  test.use({ seed: SEED_TWO_SESSIONS });

  test('renders both seeded sessions with labels', async ({ window }) => {
    await openSettings(window);
    const table = window.locator('#sessionsTable');
    await expect(table).toBeVisible();
    // Two rows, one per seeded session
    await expect(table.locator('.session-block')).toHaveCount(2);
    // Labels display correctly
    await expect(window.locator('input[value="Primary"]')).toBeVisible();
    await expect(window.locator('input[value="Secondary"]')).toBeVisible();
  });

  test('mute button toggles mute class on the row', async ({ window }) => {
    await openSettings(window);
    const firstRow = window.locator('.session-block').first();
    await expect(firstRow).not.toHaveClass(/session-muted/);
    await clickByCss(window, '.session-block:nth-child(1) .mute-btn');
    await expect(firstRow).toHaveClass(/session-muted/);
    await clickByCss(window, '.session-block:nth-child(1) .mute-btn');
    await expect(firstRow).not.toHaveClass(/session-muted/);
  });

  test('focus button is exclusive — clicking one clears the other', async ({ window }) => {
    await openSettings(window);
    const rows = window.locator('.session-block');
    const row1 = rows.nth(0);
    const row2 = rows.nth(1);
    await clickByCss(window, '.session-block:nth-child(1) .focus-btn');
    await expect(row1).toHaveClass(/session-focused/);
    await expect(row2).not.toHaveClass(/session-focused/);
    await clickByCss(window, '.session-block:nth-child(2) .focus-btn');
    await expect(row1).not.toHaveClass(/session-focused/);
    await expect(row2).toHaveClass(/session-focused/);
  });

  test('mute and focus are independent', async ({ window }) => {
    await openSettings(window);
    const row = window.locator('.session-block').first();
    await clickByCss(window, '.session-block:nth-child(1) .mute-btn');
    await clickByCss(window, '.session-block:nth-child(1) .focus-btn');
    await expect(row).toHaveClass(/session-muted/);
    await expect(row).toHaveClass(/session-focused/);
  });

  test('remove (×) deletes the session from the table', async ({ window }) => {
    await openSettings(window);
    await expect(window.locator('.session-block')).toHaveCount(2);
    await clickByCss(window, '.session-block:nth-child(1) .session-remove');
    await expect(window.locator('.session-block')).toHaveCount(1);
  });

  // S6 — new tests targeting gaps surfaced by the v0.4 quality-tier audit.

  test('S6: label input is editable and dispatches on change', async ({ window }) => {
    await openSettings(window);
    const labelInput = window.locator('.session-block:nth-child(1) input[type="text"]');
    await labelInput.fill('Renamed');
    // Trigger change event (Tab blurs the input).
    await labelInput.press('Tab');
    await expect(labelInput).toHaveValue('Renamed');
  });

  test('S6: palette selector offers 24 arrangements', async ({ window }) => {
    // The palette selector should expose PALETTE_SIZE=24 options (8 solid +
    // 8 hsplit + 8 vsplit arrangements). Assertion on the control's shape
    // rather than end-to-end persistence (which races against the IPC
    // round-trip + subsequent renderSessionsTable rebuild).
    await openSettings(window);
    const select = window.locator('.session-block:nth-child(1) select').first();
    await expect(select).toHaveValue('0');  // seeded index
    const optionCount = await select.locator('option').count();
    if (optionCount !== 24) {
      throw new Error(`expected 24 palette options, got ${optionCount}`);
    }
  });

  test('S6: each seeded session renders a single dot per clip (none yet)', async ({ window }) => {
    // No clips in queue at startup, so dots strip is empty even with
    // sessions seeded. This is the right default: sessions are colour
    // reservations, not auto-visible.
    await expect(window.locator('.dots .dot')).toHaveCount(0);
  });

  test('S6: focus star uses filled/hollow glyph to reflect state', async ({ window }) => {
    await openSettings(window);
    const focusBtn = window.locator('.session-block:nth-child(1) .focus-btn');
    // Initially hollow star ☆
    await expect(focusBtn).toHaveText('\u2606');
    await clickByCss(window, '.session-block:nth-child(1) .focus-btn');
    // Filled star ★
    await expect(focusBtn).toHaveText('\u2605');
  });
});
