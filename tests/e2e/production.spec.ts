import { test, expect, type ElectronApplication } from './fixtures';
import type { Page } from '@playwright/test';
import { openSettings, clickById } from './helpers';
import * as fs from 'fs';
import * as path from 'path';

function silentWav(durationMs = 250, sampleRate = 8000): Buffer {
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

async function firstWindowState(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    return {
      bounds: win.getBounds(),
      visible: win.isVisible(),
      destroyed: win.isDestroyed(),
      alwaysOnTop: win.isAlwaysOnTop(),
    };
  });
}

async function showToolbar(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    win.setAlwaysOnTop(true, 'floating');
    win.showInactive();
  });
  await expect.poll(async () => firstWindowState(app), { timeout: 5000 }).toMatchObject({
    visible: true,
    destroyed: false,
  });
}

async function expectCollapsedSignalMatchesDot(window: Page) {
  await expect(window.locator('.dots .dot')).toHaveCount(1, { timeout: 5000 });
  const dotPalette = await window.locator('.dots .dot').first().getAttribute('data-palette');
  expect(dotPalette).toBeTruthy();
  await expect(window.locator('#collapsedSignal')).toHaveAttribute('data-palette', dotPalette!, { timeout: 5000 });
}

test.describe('Production user journey', () => {
  test('toolbar is a compact overlay, expands for settings, and collapses on idle', async ({ app, window }) => {
    await expect(window.locator('#bar')).toBeVisible();

    const start = await firstWindowState(app);
    expect(start).not.toBeNull();
    expect(start!.bounds.width).toBe(680);
    expect(start!.bounds.height).toBe(192);
    expect(start!.alwaysOnTop).toBe(true);

    const restingFit = await window.evaluate(() => {
      const bar = document.getElementById('bar')?.getBoundingClientRect();
      const transcript = document.getElementById('transcriptPanel')?.getBoundingClientRect();
      return {
        barBottom: bar ? bar.bottom : 0,
        transcriptBottom: transcript ? transcript.bottom : 0,
        innerHeight: window.innerHeight,
      };
    });
    expect(restingFit.barBottom).toBeLessThanOrEqual(restingFit.innerHeight - 4);
    expect(restingFit.transcriptBottom).toBeLessThanOrEqual(restingFit.innerHeight - 4);

    await showToolbar(app);
    await window.waitForTimeout(4_500);
    await expect(window.locator('#bar')).toHaveClass(/collapsed/, { timeout: 2500 });

    await openSettings(window);
    await expect(window.locator('#bar')).not.toHaveClass(/collapsed/);
    await expect(window.locator('#panel')).toBeVisible();

    const expanded = await firstWindowState(app);
    expect(expanded).not.toBeNull();
    expect(expanded!.bounds.width).toBe(680);
    expect(expanded!.bounds.height).toBeGreaterThanOrEqual(600);

    await clickById(window, 'settingsBtn');
    await expect(window.locator('body.settings-open')).toHaveCount(0);

    await expect.poll(async () => {
      const state = await firstWindowState(app);
      return state ? state.bounds.height : 0;
    }, { timeout: 5000 }).toBe(192);
    const closed = await firstWindowState(app);
    expect(closed).not.toBeNull();
    expect(closed!.bounds.width).toBe(680);
    expect(closed!.bounds.height).toBe(192);
  });

  test('hide button hides the toolbar without quitting the background app', async ({ app, window }) => {
    await showToolbar(app);
    await clickById(window, 'close');

    await expect.poll(async () => firstWindowState(app), { timeout: 5000 }).toMatchObject({
      visible: false,
      destroyed: false,
    });
  });

  test('collapsed toolbar stays collapsed and flashes the source session on new audio', async ({ tmpDir, app, window }) => {
    await showToolbar(app);
    await window.waitForTimeout(4_500);
    await expect(window.locator('#bar')).toHaveClass(/collapsed/, { timeout: 2500 });

    const queueDir = path.join(tmpDir, 'queue');
    const clipPath = path.join(queueDir, '20260428T120000000-aabbccdd.wav');
    fs.writeFileSync(clipPath, silentWav(2500));

    await expect(window.locator('#bar')).toHaveClass(/collapsed/, { timeout: 5000 });
    await expect(window.locator('#bar')).toHaveClass(/collapsed-signal-active/, { timeout: 5000 });
    await expectCollapsedSignalMatchesDot(window);

    const state = await firstWindowState(app);
    expect(state).not.toBeNull();
    expect(state!.bounds.height).toBe(192);
  });

  test('collapsed toolbar keeps the session glow until the active clip ends', async ({ tmpDir, app, window }) => {
    await showToolbar(app);
    await window.waitForTimeout(4_500);
    await expect(window.locator('#bar')).toHaveClass(/collapsed/, { timeout: 2500 });

    const queueDir = path.join(tmpDir, 'queue');
    const clipPath = path.join(queueDir, '20260428T120500000-aabbccdd.wav');
    fs.writeFileSync(clipPath, silentWav(7000));

    await expect(window.locator('#bar')).toHaveClass(/collapsed-signal-active/, { timeout: 5000 });
    await expectCollapsedSignalMatchesDot(window);

    await window.waitForTimeout(5_000);
    await expect.poll(async () => window.evaluate(() => {
      const audio = document.getElementById('audio') as HTMLAudioElement | null;
      return !!audio && !!audio.src && !audio.ended;
    }), { timeout: 1000 }).toBe(true);
    await expect(window.locator('#bar')).toHaveClass(/collapsed-signal-active/);

    await expect.poll(async () => window.evaluate(() => {
      const audio = document.getElementById('audio') as HTMLAudioElement | null;
      return !!audio && !!audio.src && audio.ended;
    }), { timeout: 15_000 }).toBe(true);
    await expect(window.locator('#bar')).not.toHaveClass(/collapsed-signal-active/, { timeout: 10_000 });
  });

  test('open toolbar collapses to the session-colour strip when playback starts in the background', async ({ tmpDir, app, window }) => {
    await showToolbar(app);
    await expect(window.locator('#bar')).not.toHaveClass(/collapsed/);

    const queueDir = path.join(tmpDir, 'queue');
    const clipPath = path.join(queueDir, '20260428T121500000-aabbccdd.wav');
    fs.writeFileSync(clipPath, silentWav(1800));

    await expect(window.locator('.dots .dot')).toHaveCount(1, { timeout: 5000 });
    await expect(window.locator('#bar')).toHaveClass(/collapsed/, { timeout: 5000 });
    await expect(window.locator('#bar')).toHaveClass(/collapsed-signal-active/, { timeout: 5000 });
    await expectCollapsedSignalMatchesDot(window);
    await expect.poll(async () => window.evaluate(() => {
      const audio = document.getElementById('audio') as HTMLAudioElement | null;
      return !!audio && !!audio.src && audio.ended;
    }), { timeout: 8000 }).toBe(true);
    await expect(window.locator('#bar')).toHaveClass(/collapsed/);
    await expect(window.locator('#bar')).not.toHaveClass(/collapsed-signal-active/, { timeout: 10_000 });
  });
});

test.describe('Production queue and session lifecycle', () => {
  test.use({
    seed: {
      config: {
        panels: {
          transcript_expanded: true,
          transcript_view: 'spoken',
        },
      },
    },
  });

  test('new assistant audio creates a dot, a session row, and a transcript row', async ({ tmpDir, window }) => {
    const queueDir = path.join(tmpDir, 'queue');
    const clipPath = path.join(queueDir, '20260428-clip-aabbccdd-0001.wav');
    fs.writeFileSync(clipPath, silentWav());
    fs.writeFileSync(clipPath.replace(/\.wav$/i, '.txt'), 'Terminal Talk turns Codex and Claude Code into a hands-free audio workflow.');
    fs.writeFileSync(clipPath.replace(/\.wav$/i, '.original.txt'), 'Terminal Talk turns **Codex** and **Claude Code** into a hands-free audio workflow.');

    await expect(window.locator('.dots .dot')).toHaveCount(1, { timeout: 5000 });
    await expect(window.locator('#transcriptCount')).toHaveText('1', { timeout: 5000 });
    await expect(window.locator('.transcript-body')).toContainText('hands-free audio workflow', { timeout: 5000 });

    await openSettings(window, 'sessions');
    await expect(window.locator('#sessionsTable .session-block')).toHaveCount(1, { timeout: 5000 });
    await expect(window.locator('#sessionsTable .short')).toHaveText('aabbccdd');
  });
});
