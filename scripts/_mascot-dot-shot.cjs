// Scratch: render docs/mascot-dot-prototype.html to PNGs for visual review.
// Remove before commit.
const path = require('path');
const { chromium } = require('@playwright/test');

(async () => {
  const file = 'file:///' + path.resolve(__dirname, '..', 'docs', 'mascot-dot-prototype.html').replace(/\\/g, '/');
  const out = path.resolve(__dirname, '..');
  for (const dsf of [2, 1]) {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: dsf, viewport: { width: 980, height: 1400 } });
    await page.goto(file, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);
    const target = path.join(out, `_mascot-dots-${dsf}x.png`);
    await page.screenshot({ path: target, fullPage: true });
    console.log('wrote', target);
    if (dsf === 2) {
      const bars = await page.$$('.bar');
      // order: A-mix, A-zoom, B-mix, B-zoom, C-mix, C-zoom
      const map = { 0: 'size14', 1: 'size16', 2: 'size20', 3: 'crispzoom', 4: 'sysA', 5: 'sysB', 6: 'sysC' };
      for (const [i, name] of Object.entries(map)) {
        if (!bars[i]) continue;
        const t = path.join(out, `_mascot-${name}.png`);
        await bars[i].screenshot({ path: t });
        console.log('wrote', t);
      }
    }
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
