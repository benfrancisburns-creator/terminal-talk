#!/usr/bin/env node
/**
 * Render each annotated mock from docs/design-system/mocks-annotated.html
 * as its own cropped PNG so the README can embed them inline.
 *
 * Approach: spawn Chrome headless to open the mocks page, then use JS
 * eval via --run-all-compositor-stages-before-draw to measure each
 * <section>'s bounding box. Pass those boxes to subsequent screenshot
 * calls via --window-size and CSS transform in a wrapper HTML.
 *
 * Simpler fallback used here: ask Chrome to print one section at a time
 * by injecting URL hash + CSS that hides non-target sections. Each shot
 * gets a small wrapper HTML with :target styling.
 */
const { spawnSync } = require('node:child_process');
const { writeFileSync, readFileSync, mkdirSync, existsSync } = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const SRC = path.join(REPO, 'docs', 'design-system', 'mocks-annotated.html');
const OUT_DIR = path.join(REPO, 'docs', 'screenshots');
const TMP_DIR = path.join(REPO, '.tmp-mocks');

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(TMP_DIR, { recursive: true });

// Chrome headless path. Old implementation hardcoded the Windows path, so
// this script couldn't run on a Mac or Linux dev box. Now we:
//   1. honour $CHROME_PATH if set (explicit user override)
//   2. probe known install locations per platform
//   3. fall back to `which chrome`/`where chrome` via the shell
// Throws a clear error if none work so a broken path fails loudly instead
// of feeding garbage into spawnSync.
function resolveChromePath() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const candidates = process.platform === 'win32' ? [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ] : [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  // Last resort: ask the shell.
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  for (const binary of ['google-chrome', 'chrome', 'chromium', 'msedge']) {
    const res = spawnSync(cmd, [binary], { encoding: 'utf8' });
    if (res.status === 0) {
      const found = (res.stdout || '').split(/\r?\n/).map(s => s.trim()).find(Boolean);
      if (found && existsSync(found)) return found;
    }
  }
  throw new Error(
    'Could not locate Chrome / Chromium. Set the CHROME_PATH env var to the ' +
    'full path of a Chromium-family binary (chrome, chromium, or msedge).'
  );
}
const CHROME = resolveChromePath();
process.stdout.write(`[render-mocks] using browser: ${CHROME}\n`);

// Five mocks in order: [slug, window height tuned to section].
// Heights include ~40 px of bottom breathing room so the last
// annotation's descender doesn't kiss the frame — previous values
// were tuned once and went stale as annotation copy grew (shot 03's
// "Click / Right-click" + "Clear all" rows and shot 05's "Unsnapping"
// trailing line were both getting clipped).
const SHOTS = [
  { n: 1, slug: 'idle',             height: 780 },
  { n: 2, slug: 'three-sessions',   height: 700 },
  { n: 3, slug: 'mixed-states',     height: 1450 },
  { n: 4, slug: 'settings-panel',   height: 1450 },
  { n: 5, slug: 'snapped-top',      height: 900 },
];

const src = readFileSync(SRC, 'utf8');

// S5 mocks-annotated uses relative iframe srcs (../ui-kit/index.html?seed=...).
// When we write the patched HTML to a tmp dir OUTSIDE docs/design-system/,
// the relative path resolves to a non-existent location and the iframes
// render as broken-image placeholders. Fix: rewrite each relative iframe
// src to an absolute file:// URL pointing at the real kit. Also strip
// loading="lazy" — the lazy-loader keeps the iframe empty until it's in
// the viewport, which never happens for off-screen shots in a headless
// capture that hides non-target sections.
const UI_KIT_URL = 'file:///' + path.join(REPO, 'docs', 'ui-kit', 'index.html').replace(/\\/g, '/');
function absolutiseIframes(html) {
  return html
    .replace(/src="\.\.\/ui-kit\/index\.html/g, `src="${UI_KIT_URL}`)
    .replace(/\s+loading="lazy"/g, '');
}

for (const shot of SHOTS) {
  // Inject CSS to show only the Nth <section> and strip page padding,
  // so a short screenshot captures just that shot + its annotations.
  // Also: give the iframe a moment to load before capture — Chrome
  // headless's --virtual-time-budget lets any JS (including the kit's
  // React + Babel standalone pipeline) settle first.
  const css = `
    body { padding: 24px 40px !important; }
    .page-title { display: none; }
    .grid { gap: 0 !important; }
    .grid > section:not(:nth-of-type(${shot.n})) { display: none !important; }
  `;
  const patched = absolutiseIframes(src).replace('</style>', `${css}</style>`);
  const tmpHtml = path.join(TMP_DIR, `shot-${shot.n}.html`);
  writeFileSync(tmpHtml, patched);

  const outPng = path.join(OUT_DIR, `toolbar-${shot.slug}.png`);
  const res = spawnSync(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--allow-file-access-from-files',  // file:// iframe loading file:// kit
    '--virtual-time-budget=8000',      // React + Babel-standalone JSX pipeline settle time
    `--window-size=1400,${shot.height}`,
    `--screenshot=${outPng}`,
    `file:///${tmpHtml.replace(/\\/g, '/')}`,
  ], { encoding: 'utf8' });
  if (res.status !== 0) {
    process.stderr.write(`[${shot.slug}] FAILED\n${res.stderr}\n`);
    process.exit(1);
  }
  process.stdout.write(`[${shot.slug}] ${outPng}\n`);
}
