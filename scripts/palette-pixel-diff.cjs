#!/usr/bin/env node
// D3 — Palette pixel-diff regression rig (scaffold, log-only).
//
// Captures a PNG of each of the 24 palette arrangements from the kit
// and compares against a baseline folder. Fails if any arrangement
// drifts by more than `TOLERANCE_RATIO` of its pixels.
//
// First run on a fresh machine: baselines don't exist yet — pass
//   --update  to capture fresh baselines instead of comparing.
//
// This is deliberately standalone (not a Playwright project) so it
// can run with just Chrome + Node, the same minimum render-mocks.cjs
// requires. Future work can promote it into playwright.config.ts
// as a dedicated `chromium` project if multi-browser coverage
// becomes valuable.
//
// Exit codes:
//   0  all arrangements match baselines within tolerance
//   1  one or more arrangements drifted
//   2  baseline folder is missing or empty (run with --update first)
//   3  Chrome not found / capture failed

const fs   = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const zlib = require('node:zlib');

const REPO       = path.resolve(__dirname, '..');
const KIT        = path.join(REPO, 'docs', 'ui-kit', 'index.html');
const BASELINE   = path.join(REPO, 'tests', 'baselines', 'palette');
const OUT_DIR    = path.join(REPO, '.tmp-pixel-diff');
const TOLERANCE  = 0.02;   // 2% of pixels may differ (font rendering, subpixel)
const UPDATE     = process.argv.includes('--update');

fs.mkdirSync(OUT_DIR, { recursive: true });
if (UPDATE) fs.mkdirSync(BASELINE, { recursive: true });

function resolveChrome() {
  // Lifted from scripts/render-mocks.cjs's resolveChromePath()
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const cands = process.platform === 'win32' ? [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ] : [
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  for (const p of cands) if (p && fs.existsSync(p)) return p;
  return null;
}
const CHROME = resolveChrome();
if (!CHROME) { console.error('palette-pixel-diff: Chrome not found'); process.exit(3); }

// Minimal PNG chunk-walking pixel-compare. Avoids pulling in pngjs/pixelmatch
// just to scaffold — enough for "did anything change at all" signal. Future
// versions can swap in pixelmatch with structural similarity for tolerance.
function decodePngRaw(pngBytes) {
  // IDAT walk → inflate → drop filter bytes. Works for 8-bit RGB/RGBA.
  if (pngBytes.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('not a PNG');
  let idx = 8;
  const chunks = [];
  let width = 0, height = 0, colorType = 0;
  while (idx < pngBytes.length) {
    const len = pngBytes.readUInt32BE(idx); idx += 4;
    const type = pngBytes.slice(idx, idx + 4).toString('ascii'); idx += 4;
    const data = pngBytes.slice(idx, idx + len); idx += len;
    idx += 4; // CRC
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') {
      chunks.push(data);
    } else if (type === 'IEND') break;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!bytesPerPixel) throw new Error(`unsupported colorType ${colorType}`);
  const rowLen = width * bytesPerPixel + 1;   // +1 filter byte per row
  const pixels = Buffer.alloc(width * height * bytesPerPixel);
  for (let y = 0; y < height; y++) {
    raw.copy(pixels, y * width * bytesPerPixel, y * rowLen + 1, (y + 1) * rowLen);
  }
  return { width, height, pixels, bytesPerPixel };
}
function pixelDiffRatio(a, b) {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let differing = 0;
  const len = a.pixels.length;
  for (let i = 0; i < len; i++) if (a.pixels[i] !== b.pixels[i]) differing++;
  return differing / len;
}

const ARRANGEMENTS = 24;
let failures = 0, drifted = 0;

for (let i = 0; i < ARRANGEMENTS; i++) {
  const key = String(i).padStart(2, '0');
  // The kit's 'settings-panel' seed shows a sessions table; we abuse the
  // 'three-sessions' seed since its dot strip is visible AND we can pass
  // ?focus=NN to tweak which arrangement sits in slot 0.
  const url = `file:///${KIT.replace(/\\/g, '/')}?seed=three-sessions&chrome=0&diff=${key}`;
  const out = path.join(OUT_DIR, `palette-${key}.png`);
  const res = spawnSync(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--virtual-time-budget=6000',
    '--window-size=720,240',
    `--screenshot=${out}`,
    url,
  ], { encoding: 'utf8' });
  if (res.status !== 0 || !fs.existsSync(out)) {
    console.error(`palette-${key}: capture failed (exit ${res.status})`);
    failures++;
    continue;
  }

  const baselinePath = path.join(BASELINE, `palette-${key}.png`);
  if (UPDATE) {
    fs.copyFileSync(out, baselinePath);
    console.log(`palette-${key}: baseline captured`);
    continue;
  }
  if (!fs.existsSync(baselinePath)) {
    console.error(`palette-${key}: no baseline — run with --update first`);
    process.exit(2);
  }
  const current = decodePngRaw(fs.readFileSync(out));
  const ref     = decodePngRaw(fs.readFileSync(baselinePath));
  const ratio   = pixelDiffRatio(current, ref);
  if (ratio > TOLERANCE) {
    console.error(`palette-${key}: DRIFT (${(ratio * 100).toFixed(2)}% > ${(TOLERANCE * 100).toFixed(0)}%)`);
    drifted++;
  } else {
    console.log(`palette-${key}: OK (${(ratio * 100).toFixed(3)}%)`);
  }
}

if (failures > 0) { console.error(`\n${failures} capture failure(s)`); process.exit(3); }
if (drifted  > 0) { console.error(`\n${drifted} arrangement(s) drifted beyond tolerance`); process.exit(1); }
console.log(`\npalette-pixel-diff: OK (${ARRANGEMENTS} arrangements within ${(TOLERANCE * 100).toFixed(0)}% tolerance)`);
