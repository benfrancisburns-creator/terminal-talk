const path = require('path');
const { chromium } = require('@playwright/test');
(async () => {
  const file = 'file:///' + path.resolve(__dirname, '..', 'docs', '_tabs-verify.html').replace(/\\/g, '/');
  const out = path.resolve(__dirname, '..', '_tabs-verify.png');
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 3, viewport: { width: 720, height: 360 } });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await page.goto(file, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  await page.screenshot({ path: out, fullPage: true });
  console.log('wrote', out, 'errors:', errs.length ? JSON.stringify(errs) : 'none');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
