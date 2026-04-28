#!/usr/bin/env node
/*
 * Renders the full Terminal Talk wallpaper, including mascot and
 * speech bubble, from scripts/wallpaper.html.
 *
 * Output:
 *   - docs/assets/wallpaper/terminal-talk-wallpaper.png
 *
 * Run: `node scripts/render-wallpaper.cjs`
 * Requires: @playwright/test (already in devDeps).
 */

'use strict';

const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(__dirname, 'wallpaper.html');
const OUT_PNG = path.join(
  ROOT,
  'docs',
  'assets',
  'wallpaper',
  'terminal-talk-wallpaper.png',
);

async function main() {
  let chromium;
  try {
    ({ chromium } = require('@playwright/test'));
  } catch {
    console.error('Playwright not installed. Run: npm install');
    process.exit(2);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  await page.goto('file://' + HTML.replace(/\\/g, '/'));
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  await page.screenshot({
    path: OUT_PNG,
    fullPage: false,
    omitBackground: false,
  });

  console.log('[render] wrote', OUT_PNG);
  await browser.close();
}

main().catch((error) => {
  console.error('[render] fatal:', error);
  process.exit(1);
});
