#!/usr/bin/env node
// S7.2 of the v0.4 quality tier — file-length gate.
//
// What this does
// --------------
// 1. Walks app/, scripts/, hooks/, tests/e2e/ for source files.
// 2. Counts lines per file.
// 3. Compares each file against two thresholds:
//    - The absolute ceiling (DEFAULT_CEILING). If ANY file crosses it,
//      CI fails outright.
//    - A per-file baseline recorded in file-length-baseline.json. If a
//      file that's under the ceiling GROWS beyond its baseline, CI
//      fails. This is the ratchet: each file can shrink or stay flat,
//      but cannot grow past its recorded baseline without a deliberate
//      bump to the baseline file in the same PR.
//
// Why both
// --------
// The ULTRAPLAN's design: start lenient so main.js + renderer.js +
// run-tests.cjs all pass initially. Shrink the ceiling over quarters
// as the big-file refactor progresses. Meanwhile, the per-file
// baseline prevents silent growth of ANY file, including the small
// lib modules we want to stay small.
//
// Usage
// -----
//   node scripts/check-file-length.cjs           # check only
//   node scripts/check-file-length.cjs --update  # refresh baseline
//
// Output: prints any violations; exits non-zero if any.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_FILE = path.join(ROOT, 'file-length-baseline.json');

// Absolute ceiling. EX8 ratcheted from 3500 -> 2000 post-EX6
// (main.js ~1757) + EX7a (renderer.js shrinking). run-tests.cjs
// legitimately exceeds the ceiling — it's the test harness and
// stays big by design; listed in baseline.exclusions to bypass the
// absolute check while its baseline-growth ratchet still applies.
const DEFAULT_CEILING = 2000;

// Walk these dirs, skip these.
const INCLUDE_DIRS = ['app', 'scripts', 'hooks', 'tests/e2e', 'docs/ui-kit'];
const INCLUDE_EXT = new Set(['.js', '.cjs', '.mjs', '.ts', '.py', '.ps1', '.psm1']);
const EXCLUDE_SUBSTRINGS = [
  'node_modules',
  'app-mirror',   // docs/app-mirror is a generated copy of app/
  'tokens-window.js',
  'voices-window.js',
  'tokens.mjs',
  '.tmp-',
  'coverage',
  'playwright-report',
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (EXCLUDE_SUBSTRINGS.some(s => full.includes(s))) continue;
    if (entry.isDirectory()) { walk(full, out); continue; }
    if (!INCLUDE_EXT.has(path.extname(entry.name))) continue;
    out.push(full);
  }
  return out;
}

function countLines(file) {
  const src = fs.readFileSync(file, 'utf8');
  // Match wc -l semantics: count \n characters. A file ending with a
  // newline has N lines; a file without trailing newline has N lines
  // too (wc counts the final incomplete line).
  let n = 0;
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) n++;
  if (src.length > 0 && src.charCodeAt(src.length - 1) !== 10) n++;
  return n;
}

function gatherSizes() {
  const files = [];
  for (const d of INCLUDE_DIRS) {
    walk(path.join(ROOT, d), files);
  }
  const sizes = {};
  for (const full of files) {
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    sizes[rel] = countLines(full);
  }
  return sizes;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    return { ceiling: DEFAULT_CEILING, exclusions: [], files: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
    // Forward-compat with old baselines that lack an exclusions key.
    if (!Array.isArray(parsed.exclusions)) parsed.exclusions = [];
    return parsed;
  } catch (e) {
    console.error(`[check-file-length] baseline file is invalid JSON: ${e.message}`);
    process.exit(2);
  }
}

function writeBaseline(data) {
  // Sort by descending size so the biggest files appear first — lets
  // reviewers see at a glance whether the refactor dial moved.
  const sorted = Object.fromEntries(
    Object.entries(data.files).sort((a, b) => b[1] - a[1])
  );
  const out = {
    ceiling: data.ceiling,
    exclusions: data.exclusions || [],
    files: sorted,
  };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');
}

function main() {
  const update = process.argv.includes('--update');
  const sizes = gatherSizes();
  const baseline = loadBaseline();
  const ceiling = baseline.ceiling || DEFAULT_CEILING;
  const exclusions = new Set(baseline.exclusions || []);

  if (update) {
    writeBaseline({ ceiling, exclusions: baseline.exclusions, files: sizes });
    console.log(`[check-file-length] baseline updated: ${Object.keys(sizes).length} files tracked, ${exclusions.size} excluded from ceiling`);
    return;
  }

  const violations = [];
  for (const [file, lines] of Object.entries(sizes)) {
    // Excluded files skip the absolute ceiling check but STILL get
    // their baseline enforced — catches silent growth even in files
    // we've agreed are "big by design".
    const isExcluded = exclusions.has(file);
    if (!isExcluded && lines > ceiling) {
      violations.push({ file, lines, limit: ceiling, kind: 'ceiling' });
      continue;
    }
    const prev = baseline.files[file];
    if (prev !== undefined && lines > prev) {
      violations.push({ file, lines, limit: prev, kind: 'baseline' });
    }
  }

  if (violations.length === 0) {
    console.log(`[check-file-length] OK — ${Object.keys(sizes).length} files under ceiling ${ceiling}, none grew past baseline.`);
    return;
  }

  console.error(`[check-file-length] ${violations.length} violation(s):`);
  for (const v of violations) {
    if (v.kind === 'ceiling') {
      console.error(`  ✗ ${v.file}: ${v.lines} lines > absolute ceiling ${v.limit}`);
      console.error(`    Refactor: extract logic to app/lib/ modules or split by concern.`);
    } else {
      console.error(`  ✗ ${v.file}: ${v.lines} lines > baseline ${v.limit}`);
      console.error(`    Either trim the file or, if the growth is genuinely needed,`);
      console.error(`    bump the baseline in the SAME commit via:`);
      console.error(`        node scripts/check-file-length.cjs --update`);
    }
  }
  process.exit(1);
}

main();
