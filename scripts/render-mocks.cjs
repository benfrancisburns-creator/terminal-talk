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

// Four mocks in order: [slug, window height tuned to section]
const SHOTS = [
  { n: 1, slug: 'idle',             height: 720 },
  { n: 2, slug: 'three-sessions',   height: 640 },
  { n: 3, slug: 'mixed-states',     height: 1160 },
  { n: 4, slug: 'settings-panel',   height: 1400 },
  { n: 5, slug: 'snapped-top',      height: 720 },
];

const src = readFileSync(SRC, 'utf8');

for (const shot of SHOTS) {
  // Inject CSS to show only the Nth <section> and strip page padding,
  // so a short screenshot captures just that shot + its annotations.
  const css = `
    body { padding: 24px 40px !important; }
    .page-title { display: none; }
    .grid { gap: 0 !important; }
    .grid > section:not(:nth-of-type(${shot.n})) { display: none !important; }
  `;
  const patched = src.replace('</style>', `${css}</style>`);
  const tmpHtml = path.join(TMP_DIR, `shot-${shot.n}.html`);
  writeFileSync(tmpHtml, patched);

  const outPng = path.join(OUT_DIR, `toolbar-${shot.slug}.png`);
  const res = spawnSync(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
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
