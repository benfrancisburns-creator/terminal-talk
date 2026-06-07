'use strict';
// One-shot surgical patcher: copies ONLY the two registry functions
// (writeAssignments + the _sleepSyncMs helper + loadAssignments) from the
// repo's fixed main.js into the LIVE ~/.terminal-talk/app/main.js, leaving
// the rest of the (older, un-deployed-dictation) live main.js untouched.
// Run with --apply to write; otherwise dry-run (verify only).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REPO = path.join(__dirname, '..', 'app', 'main.js');
const LIVE = path.join(os.homedir(), '.terminal-talk', 'app', 'main.js');
const APPLY = process.argv.includes('--apply');

const readLF = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// Extract a brace-balanced function starting at `sig`. The registry funcs have
// only balanced braces inside strings/templates, so a simple counter is safe.
function extractFn(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) throw new Error(`signature not found: ${sig}`);
  if (src.indexOf(sig, i + 1) !== -1) throw new Error(`signature not unique: ${sig}`);
  const b = src.indexOf('{', i);
  let depth = 0, j = b;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  if (depth !== 0) throw new Error(`unbalanced braces for ${sig}`);
  return { start: i, end: j, text: src.slice(i, j) };
}

const repoSrc = readLF(REPO);
const liveSrc = readLF(LIVE);

// New versions from repo
const HELPER_SIG = '// Synchronous short sleep for the torn-read retry path below.';
const helperStart = repoSrc.indexOf(HELPER_SIG);
if (helperStart < 0) throw new Error('repo helper comment not found');
const repoLoad = extractFn(repoSrc, 'function loadAssignments() {');
const repoLoadWithHelper = repoSrc.slice(helperStart, repoLoad.end);
const repoWrite = extractFn(repoSrc, 'function writeAssignments(all, opts) {');

// Sanity: repo new versions must contain the fixes
const checks = [
  [repoWrite.text.includes('withRegistryLock(') && repoWrite.text.includes('!held'), 'repo writeAssignments has lock+skip'],
  [repoLoadWithHelper.includes('_sleepSyncMs') && /primary === null && attempt < 3/.test(repoLoadWithHelper), 'repo loadAssignments has retry'],
];
for (const [ok, label] of checks) if (!ok) throw new Error(`repo check failed: ${label}`);

// Locate the OLD functions in live (must exist, pre-edit)
const liveWrite = extractFn(liveSrc, 'function writeAssignments(all, opts) {');
const liveLoad = extractFn(liveSrc, 'function loadAssignments() {');

// Live must NOT already be patched (idempotency / safety)
if (liveSrc.includes('_sleepSyncMs') || liveWrite.text.includes('withRegistryLock(')) {
  console.log('LIVE already appears patched — nothing to do.');
  process.exit(0);
}

// Apply: replace writeAssignments first, then loadAssignments. Do them on the
// raw string by offset, highest offset first so earlier indices stay valid.
let out = liveSrc;
const repl = [
  { ...liveWrite, text: repoWrite.text, name: 'writeAssignments' },
  { start: liveLoad.start, end: liveLoad.end, text: repoLoadWithHelper, name: 'loadAssignments(+_sleepSyncMs)' },
].sort((a, b) => b.start - a.start);
for (const r of repl) {
  out = out.slice(0, r.start) + r.text + out.slice(r.end);
  console.log(`  spliced ${r.name}: ${r.end - r.start} -> ${r.text.length} chars`);
}

// Report how many lines changed (excluding the two function regions should be 0)
console.log(`live main.js: ${liveSrc.length} -> ${out.length} chars`);

if (!APPLY) {
  console.log('DRY-RUN ok (pass --apply to write). live functions found & replaceable.');
  process.exit(0);
}

// Back up then write as CRLF (match the live file convention)
const bak = LIVE + '.bak-registry-' + '20260602';
fs.copyFileSync(LIVE, bak);
fs.writeFileSync(LIVE, out.replace(/\n/g, '\r\n'), 'utf8');
console.log(`APPLIED. backup at ${bak}`);
