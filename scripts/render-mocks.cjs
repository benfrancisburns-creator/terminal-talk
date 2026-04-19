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
const { writeFileSync, readFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const SRC = path.join(REPO, 'docs', 'design-system', 'mocks-annotated.html');
const OUT_DIR = path.join(REPO, 'docs', 'screenshots');
const TMP_DIR = path.join(REPO, '.tmp-mocks');

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(TMP_DIR, { recursive: true });

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// Four mocks in order: [slug, window height tuned to section]
const SHOTS = [
  { n: 1, slug: 'idle',             height: 720 },
  { n: 2, slug: 'three-sessions',   height: 640 },
  { n: 3, slug: 'mixed-states',     height: 1020 },
  { n: 4, slug: 'settings-panel',   height: 1400 },
  { n: 5, slug: 'snapped-top',      height: 720 },
  { n: 6, slug: 'docked-right',     height: 860 },
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
