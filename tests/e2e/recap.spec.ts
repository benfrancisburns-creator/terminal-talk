import { test, expect } from './fixtures';
import * as fs from 'fs';
import * as path from 'path';

// Session recap (2026-10-05) — real-app journey: archived clips under
// queue/recap/ -> tab control -> chooser -> stage-recap IPC -> staged
// `-R-` copies in the queue -> playlist playback with replay dots.

const now = () => Math.floor(Date.now() / 1000);
const SHORT = 'beefcafe';

function silentWav(durationMs = 1200, sampleRate = 8000): Buffer {
  const sampleCount = Math.max(1, Math.floor(sampleRate * durationMs / 1000));
  const dataBytes = sampleCount * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

test.describe('Session recap', () => {
  test.use({
    seed: {
      assignments: {
        [SHORT]: { index: 0, session_id: `${SHORT}-session-id`, claude_pid: 0, label: 'Frontend', pinned: true, last_seen: now() },
      },
      // Long collapse delay: the tabs row is display:none while collapsed and
      // the chooser closes on collapse, so keep the bar open for the journey.
      config: { playback: { speed: 1.25, collapse_delay_sec: 120, auto_prune: true, auto_prune_sec: 20, recap_keep_min: 120 } },
    },
  });

  test('tab control opens the chooser, a pick stages archived clips and plays them as replay dots', async ({ tmpDir, window }) => {
    // Three "missed" clips already in the archive (as auto-prune would leave them).
    const recapDir = path.join(tmpDir, 'queue', 'recap');
    fs.mkdirSync(recapDir, { recursive: true });
    for (let i = 1; i <= 3; i++) {
      const p = path.join(recapDir, `20261005T10000000${i}-000${i}-${SHORT}.wav`);
      fs.writeFileSync(p, silentWav(1200));
      const t = (Date.now() - (60 - i) * 1000) / 1000;
      fs.utimesSync(p, t, t);
    }

    const tab = window.locator(`.tab[data-tab-id="${SHORT}"]`);
    await expect(tab).toBeAttached({ timeout: 10_000 });
    await expect(tab.locator('.tab-recap')).toHaveCount(1);
    await expect(window.locator('.tab[data-tab-id="all"] .tab-recap')).toHaveCount(1);

    // Open the chooser (programmatic click — the corner control is only
    // opaque on hover, and synthetic mouse events race the click-through driver).
    await window.evaluate((short) => {
      (document.querySelector(`.tab[data-tab-id="${short}"] .tab-recap`) as HTMLElement).click();
    }, SHORT);
    const menu = window.locator('#recapMenu');
    await expect(menu).toBeVisible({ timeout: 5000 });
    await expect(menu.locator('.recap-menu-title')).toContainText('Frontend');
    await expect(menu.locator('.recap-menu-summary')).toContainText('3 clips', { timeout: 5000 });
    await expect(menu.locator('.recap-chip')).toHaveCount(8);
    // The popover must sit inside the bar (click-through region) and not be clipped.
    const geometry = await window.evaluate(() => {
      const bar = document.getElementById('bar')!.getBoundingClientRect();
      const m = document.getElementById('recapMenu')!.getBoundingClientRect();
      return { inside: m.left >= bar.left && m.right <= bar.right && m.top >= bar.top && m.bottom <= bar.bottom, w: m.width, h: m.height };
    });
    expect(geometry.inside).toBe(true);
    expect(geometry.h).toBeGreaterThan(20);

    // Pick "Last clips 5" -> all three archived clips come back as a playlist.
    await window.evaluate(() => {
      (document.querySelector('#recapMenu .recap-chip') as HTMLElement).click();
    });
    await expect(menu).toHaveCount(0);
    await expect(window.locator('.dots .dot.recap-clip')).toHaveCount(3, { timeout: 10_000 });
    await expect(window.locator('.dots .dot.active')).toHaveCount(1, { timeout: 5000 });

    const staged = fs.readdirSync(path.join(tmpDir, 'queue')).filter((n) => /-R-/.test(n) && n.endsWith('.wav'));
    expect(staged).toHaveLength(3);
    expect(fs.readdirSync(recapDir).filter((n) => n.endsWith('.wav'))).toHaveLength(3); // originals stay archived

    // The playlist walks all three silent clips and stops; replay dots stay
    // (heard) until auto-prune, and the archive is untouched.
    await expect(window.locator('.dots .dot.active')).toHaveCount(0, { timeout: 20_000 });
    await expect(window.locator('.dots .dot.recap-clip.heard')).toHaveCount(3);
  });

  test('chooser reports nothing kept for a session without history and its chips stay disabled', async ({ window }) => {
    await window.evaluate((short) => {
      (document.querySelector(`.tab[data-tab-id="${short}"] .tab-recap`) as HTMLElement).click();
    }, SHORT);
    const menu = window.locator('#recapMenu');
    await expect(menu).toBeVisible({ timeout: 5000 });
    await expect(menu.locator('.recap-menu-summary')).toContainText('nothing kept', { timeout: 5000 });
    const enabledChips = await menu.locator('.recap-chip:not([disabled])').count();
    expect(enabledChips).toBe(0);
    // Escape closes it.
    await window.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await expect(menu).toHaveCount(0);
  });
});
