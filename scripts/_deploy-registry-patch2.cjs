'use strict';
// Second surgical patch: deploy the atomic-read-modify-write fix into the LIVE
// main.js. Replaces the FIX-B writeAssignments with the repo's
// [_writeAssignmentsLocked + thin writeAssignments + _loadRegistryConsistent]
// block, and the old ensureAssignmentsForFiles with the lock-holding version.
// --apply to write; otherwise dry-run.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REPO = path.join(__dirname, '..', 'app', 'main.js');
const LIVE = path.join(os.homedir(), '.terminal-talk', 'app', 'main.js');
const APPLY = process.argv.includes('--apply');
const readLF = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

function span(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) throw new Error(`signature not found: ${sig}`);
  if (src.indexOf(sig, i + 1) !== -1) throw new Error(`signature not unique: ${sig}`);
  const b = src.indexOf('{', i);
  let d = 0, j = b;
  for (; j < src.length; j++) { const c = src[j]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) { j++; break; } } }
  if (d !== 0) throw new Error(`unbalanced braces for ${sig}`);
  return { start: i, end: j };
}

const repo = readLF(REPO);
const live0 = readLF(LIVE);

// Repo: contiguous block _writeAssignmentsLocked .. end of _loadRegistryConsistent
const repoLockedStart = span(repo, 'function _writeAssignmentsLocked(all, opts) {').start;
const repoConsistentEnd = span(repo, 'function _loadRegistryConsistent() {').end;
const repoWriteBlock = repo.slice(repoLockedStart, repoConsistentEnd);
const repoEnsure = (() => { const e = span(repo, 'function ensureAssignmentsForFiles(files) {'); return repo.slice(e.start, e.end); })();

// Sanity
if (!repoWriteBlock.includes('_writeAssignmentsLocked') || !repoWriteBlock.includes('_loadRegistryConsistent') || !/function writeAssignments\(all, opts\)/.test(repoWriteBlock)) {
  throw new Error('repo write block missing expected functions');
}
if (!repoEnsure.includes('withRegistryLock') || !repoEnsure.includes('_loadRegistryConsistent') || !repoEnsure.includes('_writeAssignmentsLocked')) {
  throw new Error('repo ensureAssignmentsForFiles is not the atomic version');
}

if (live0.includes('_writeAssignmentsLocked') || live0.includes('_loadRegistryConsistent')) {
  console.log('LIVE already has the atomic fix — nothing to do.');
  process.exit(0);
}
if (!live0.includes('_sleepSyncMs') || !/write-registry skip from=\$\{caller\}/.test(live0)) {
  throw new Error('LIVE main.js is missing the earlier FIX-B/D patch — unexpected base; aborting');
}

let live = live0;
// 1) Replace the live (FIX-B) writeAssignments with the repo 3-function block.
const lw = span(live, 'function writeAssignments(all, opts) {');
live = live.slice(0, lw.start) + repoWriteBlock + live.slice(lw.end);
console.log(`  replaced writeAssignments -> _writeAssignmentsLocked+writeAssignments+_loadRegistryConsistent (${lw.end - lw.start} -> ${repoWriteBlock.length} chars)`);
// 2) Replace the live (old) ensureAssignmentsForFiles with the atomic version.
const le = span(live, 'function ensureAssignmentsForFiles(files) {');
live = live.slice(0, le.start) + repoEnsure + live.slice(le.end);
console.log(`  replaced ensureAssignmentsForFiles (${le.end - le.start} -> ${repoEnsure.length} chars)`);

console.log(`live main.js: ${live0.length} -> ${live.length} chars`);

if (!APPLY) { console.log('DRY-RUN ok (pass --apply).'); process.exit(0); }

const bak = LIVE + '.bak-atomic-20260602';
fs.copyFileSync(LIVE, bak);
fs.writeFileSync(LIVE, live.replace(/\n/g, '\r\n'), 'utf8');
console.log(`APPLIED. backup at ${bak}`);
