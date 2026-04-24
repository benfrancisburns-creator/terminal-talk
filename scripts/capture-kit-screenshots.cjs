#!/usr/bin/env node
/*
 * Automated screenshot capture for docs/screenshots/ and the hero GIF.
 *
 * Loads docs/ui-kit/ via a local HTTP server (the kit bootstrap
 * fetches sibling app-mirror files, which file:// URLs can't resolve),
 * navigates to each ?seed=... page with Playwright/Chromium, waits for
 * the toolbar to finish mounting, screenshots the .bar region, and
 * writes the PNG into docs/screenshots/ with the canonical filename
 * the README expects.
 *
 * Why the kit instead of the live Electron app: the kit inherits every
 * product change automatically via docs/app-mirror/, so screenshots
 * can never drift. The kit is pixel-identical to the shipping toolbar
 * since it IS the shipping renderer.js + styles.css + index.html,
 * just driven by mock IPC instead of Electron.
 *
 * Run: `node scripts/capture-kit-screenshots.cjs` from repo root.
 * Requires Chromium: `npx playwright install chromium` (one-time).
 */

'use strict';

const fs   = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const DOCS_DIR = path.join(__dirname, '..', 'docs');
const OUT_DIR  = path.join(DOCS_DIR, 'screenshots');

// seed → filename. Order = shoot order. Single URL per line = trivially
// maintainable; add a new seed + filename here and re-run.
const SHOTS = [
  { seed: 'idle',                             file: 'toolbar-idle.png' },
  { seed: 'three-sessions',                   file: 'toolbar-three-sessions.png' },
  { seed: 'mixed-states',                     file: 'toolbar-mixed-states.png' },
  { seed: 'settings-panel',                   file: 'toolbar-settings-panel.png' },
  { seed: 'snapped-top',                      file: 'toolbar-snapped-top.png' },
  { seed: 'tabs-active',                      file: 'toolbar-tabs-with-sessions.png' },
  { seed: 'settings-panel-openai-unset',      file: 'toolbar-openai-section-unset.png' },
  { seed: 'settings-panel-openai-saved',      file: 'toolbar-openai-section-saved.png' },
  { seed: 'settings-panel-sessions-expanded', file: 'toolbar-sessions-panel-expanded.png' },
  { seed: 'heartbeat',                        file: 'toolbar-heartbeat.png' },
];

// Minimal static-file server over docs/. Stays in-process; we start
// it, shoot all seeds, and tear it down.
function serveDocs() {
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.mjs':  'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.woff2': 'font/woff2',
  };
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      // Strip querystring.
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      // Default index.html on dir requests.
      let rel = urlPath === '/' ? '/ui-kit/index.html'
              : urlPath.endsWith('/') ? urlPath + 'index.html'
              : urlPath;
      const full = path.join(DOCS_DIR, rel);
      // Prevent escape out of DOCS_DIR.
      if (!full.startsWith(DOCS_DIR)) {
        res.writeHead(403); res.end('forbidden'); return;
      }
      fs.readFile(full, (err, body) => {
        if (err) {
          res.writeHead(404); res.end('not found'); return;
        }
        res.writeHead(200, { 'Content-Type': mime[path.extname(full)] || 'application/octet-stream' });
        res.end(body);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function capture() {
  let chromium;
  try {
    // @playwright/test re-exports chromium via its fixtures, but the
    // direct import for a standalone script is `playwright` or the
    // `@playwright/test` `chromium` namespace. Use the stable one.
    ({ chromium } = require('@playwright/test'));
  } catch (e) {
    console.error('Playwright not installed. Run: npm install');
    process.exit(2);
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const server = await serveDocs();
  const port = server.address().port;
  console.log(`[capture] local server on http://127.0.0.1:${port}/`);

  const browser = await chromium.launch();
  // Viewport matches the toolbar's intended show width with a little
  // margin for the absolute-positioned panel when it opens. Height
  // grows for the panel-open seeds; Playwright's `fullPage` option
  // renders just the content's bounding box.
  const page = await browser.newPage({
    viewport: { width: 720, height: 800 },
    deviceScaleFactor: 2,   // 2× retina so screenshots look crisp on GitHub
  });

  let ok = 0, fail = 0;
  for (const { seed, file } of SHOTS) {
    const url = `http://127.0.0.1:${port}/ui-kit/?seed=${seed}&chrome=0`;
    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      // The kit bootstrap fetches + mounts the renderer in an async
      // chain; wait for the .bar element to be visible and then give
      // layout a beat to settle (fonts, palette classes, scrubber
      // mascot rAF).
      await page.waitForSelector('#bar', { state: 'visible', timeout: 5000 });
      await page.waitForTimeout(800);
      // Screenshot the bar wrapper (covers both collapsed + panel-open
      // states without capturing the purple kit-chrome background).
      const bar = page.locator('#bar');
      const box = await bar.boundingBox();
      if (!box) throw new Error('#bar has no bounding box');
      // Pad 10px around so the bar's glow shadow isn't clipped.
      await page.screenshot({
        path: path.join(OUT_DIR, file),
        clip: {
          x: Math.max(0, box.x - 10),
          y: Math.max(0, box.y - 10),
          width: box.width + 20,
          height: box.height + 20,
        },
      });
      console.log(`  ✓ ${file.padEnd(40)} ← seed=${seed}`);
      ok++;
    } catch (e) {
      console.error(`  ✗ ${file}  (seed=${seed}): ${e.message}`);
      fail++;
    }
  }

  await browser.close();
  server.close();

  console.log(`\n[capture] ${ok}/${SHOTS.length} screenshots written to ${OUT_DIR}`);
  if (fail > 0) process.exit(1);
}

capture().catch((e) => {
  console.error('[capture] fatal:', e);
  process.exit(1);
});
