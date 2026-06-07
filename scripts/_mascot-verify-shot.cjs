// Scratch: render docs/_mascot-verify.html (drives the REAL DotStrip + real
// CSS) to PNG. Captures console errors so a JS break in dot-strip.js shows up.
// Remove before commit.
const path = require('path');
const { chromium } = require('@playwright/test');
(async () => {
  const file = 'file:///' + path.resolve(__dirname, '..', 'docs', '_mascot-verify.html').replace(/\\/g, '/');
  const out = path.resolve(__dirname, '..', '_mascot-verify.png');
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 760, height: 1100 } });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await page.goto(file, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: out, fullPage: true });
  console.log('wrote', out);
  console.log('console errors:', errs.length ? JSON.stringify(errs, null, 2) : 'none');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
