#!/usr/bin/env node
// GitHub Pages publishes from /docs — anything at repo-root /app/ isn't
// served. The kit demo's `../../app/index.html` fetch resolved on a
// local http-server (repo root as web root) but 404'd on Pages.
//
// Fix: mirror the six product files the kit consumes into
// docs/app-mirror/. This script is the single source of the mirror;
// `--check` mode fails CI if the mirror drifts from app/, so a product
// change can't silently break the online kit demo.
//
// Usage:
//   node scripts/sync-app-mirror.cjs          # write mirror
//   node scripts/sync-app-mirror.cjs --check  # assert in-sync, exit 1 if not

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app');
const DST = path.join(ROOT, 'docs', 'app-mirror');

const FILES = [
  'index.html',
  'renderer.js',
  'styles.css',
  'lib/tokens-window.js',
  'lib/voices-window.js',
  'lib/palette-classes.css',
  // Renderer-consumable libs (UMD-lite — loaded by <script> in the
  // product and by kit-bootstrap.js in the kit). Missing any of these
  // from the mirror would strand renderer.js at a ReferenceError when
  // the kit tries to boot.
  'lib/clip-paths.js',
  'lib/component.js',
  'lib/stale-session-poller.js',
  'lib/dot-strip.js',
  'lib/sessions-table.js',
  'lib/settings-form.js',
];

const check = process.argv.includes('--check');

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

const drift = [];
for (const rel of FILES) {
  const srcPath = path.join(SRC, rel);
  const dstPath = path.join(DST, rel);
  if (!fs.existsSync(srcPath)) {
    console.error(`[sync-app-mirror] source missing: app/${rel}`);
    process.exit(2);
  }
  const srcContent = read(srcPath);
  let dstContent = null;
  try { dstContent = read(dstPath); } catch {}
  if (srcContent !== dstContent) {
    if (check) {
      drift.push(rel);
    } else {
      ensureDir(dstPath);
      fs.writeFileSync(dstPath, srcContent, 'utf8');
      console.log(`[sync-app-mirror] wrote docs/app-mirror/${rel}`);
    }
  }
}

if (check) {
  if (drift.length) {
    console.error('[sync-app-mirror] docs/app-mirror/ is stale — run `node scripts/sync-app-mirror.cjs` to refresh:');
    for (const f of drift) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('[sync-app-mirror] in sync (6 files)');
}
