#!/usr/bin/env node
/*
 * Renders the composite hero's background layer + measures where the
 * original mascot and speech bubble sit inside the 1280×800 canvas.
 *
 * Why both in one script: the composite hero SVG (docs/assets/
 * terminal-talk-hero.svg) needs (a) a background PNG that matches
 * the wallpaper layout exactly but has the mascot + cloud hidden,
 * and (b) the exact x/y/width/height of those hidden elements so
 * the animated SVG overlay can be positioned on top.
 *
 * Outputs:
 *   - docs/assets/wallpaper/terminal-talk-wallpaper-bg.png
 *   - scripts/hero-bounds.json  (mascot + cloud bounding boxes)
 *
 * Run: `node scripts/render-hero-background.cjs`
 * Requires: @playwright/test (already in devDeps).
 */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const ROOT    = path.join(__dirname, '..');
const BG_HTML = path.join(__dirname, 'wallpaper-bg.html');
const FG_HTML = path.join(__dirname, 'wallpaper.html');
const OUT_PNG = path.join(ROOT, 'docs', 'assets', 'wallpaper',
                          'terminal-talk-wallpaper-bg.png');
const OUT_JPG = path.join(ROOT, 'docs', 'assets', 'wallpaper',
                          'terminal-talk-wallpaper-bg.jpg');
const OUT_JSON = path.join(__dirname, 'hero-bounds.json');

async function main() {
  let chromium;
  try { ({ chromium } = require('@playwright/test')); }
  catch {
    console.error('Playwright not installed. Run: npm install');
    process.exit(2);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  // 1. Measure mascot + cloud bounding boxes on the ORIGINAL wallpaper.
  await page.goto('file://' + FG_HTML.replace(/\\/g, '/'));
  await page.waitForLoadState('networkidle');
  const fgBounds = await page.evaluate(() => {
    /* eslint-disable no-undef -- runs inside the Playwright page, not Node. */
    const mascot = document.querySelector('.mascot-svg');
    const cloud  = document.querySelector('.cloud-svg');
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return { mascot: rect(mascot), cloud: rect(cloud) };
  });
  console.log('[bounds] mascot:', fgBounds.mascot);
  console.log('[bounds] cloud: ', fgBounds.cloud);

  // 2. Render the BACKGROUND-only variant (mascot-pair hidden).
  await page.goto('file://' + BG_HTML.replace(/\\/g, '/'));
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);  // fonts settle
  await page.screenshot({ path: OUT_PNG, fullPage: false, omitBackground: false });
  console.log('[render] wrote', OUT_PNG);

  // Also emit a JPEG — much smaller, fine for a gradient background +
  // ASCII wordmark, and small enough to base64-embed inside the
  // composite hero SVG without bloating the README.
  await page.screenshot({ path: OUT_JPG, type: 'jpeg', quality: 88, fullPage: false });
  console.log('[render] wrote', OUT_JPG);

  fs.writeFileSync(OUT_JSON, JSON.stringify(fgBounds, null, 2) + '\n');
  console.log('[render] wrote', OUT_JSON);

  await browser.close();
}

main().catch((e) => {
  console.error('[render] fatal:', e);
  process.exit(1);
});
