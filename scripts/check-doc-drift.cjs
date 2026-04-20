#!/usr/bin/env node
/*
 * Doc-drift guard — fails CI if stale phrases reappear in the
 * documentation OR in code comments (v0.4 EX9 extension).
 *
 * Two rule categories:
 *
 *   DOC_RULES — scanned across .md/.html/.js/.css/.txt under docs/,
 *               README files, CHANGELOG, wallpaper.html. Catches
 *               documentation claims that no longer match the code
 *               (e.g. "toolbar is 680×64" when it's 680×114).
 *
 *   CODE_COMMENT_RULES — scanned across .js/.cjs/.py/.ps1/.psm1
 *               under app/, hooks/, scripts/. Catches source-code
 *               comments that make false claims about the behaviour
 *               of OTHER parts of the codebase. Example: v0.3.0
 *               assessment N4 flagged app/session-registry.psm1
 *               docstring claiming "main.js has no auto-prune
 *               policy" when main.js DOES auto-prune past
 *               SESSION_GRACE_SEC=14400 (4h). That N4 cost nothing
 *               today but would mislead a future contributor into
 *               removing correct logic based on the false premise.
 *
 * Each rule is:
 *
 *   { pattern: RegExp,  description: string,  skip?: string[] }
 *
 * `skip` is a list of filepath substrings — if a match occurs in one of
 * these files the hit is allowed (useful for CHANGELOG entries that
 * document the REMOVAL of a behaviour, or for test files that
 * deliberately reference the stale text).
 *
 * Run on every push/PR via .github/workflows/test.yml so a doc-sync
 * regression can't land without being seen.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const DOC_RULES = [
  {
    // Only catches the architecture-diagram label "AutoHotkey / ps" (or
    // "AutoHotkey/PowerShell") — NOT general prose mentions, since
    // AutoHotkey is a legit user-space workaround for Wispr Flow etc.
    pattern: /AutoHotkey\s*\/\s*(ps|PowerShell|pwsh)/i,
    description: 'key helper is Python ctypes keybd_event, not AutoHotkey. Audit R3.1.',
    skip: []
  },
  {
    pattern: /%APPDATA%\/queue/i,
    description: 'queue dir lives at ~/.terminal-talk/queue, not %APPDATA%. Audit R3.1.',
    skip: []
  },
  {
    pattern: /HEY\s*TT/,
    description: 'wake phrase is HEY JARVIS, not HEY TT. Audit R3.7.',
    skip: ['CHANGELOG.md']
  },
  {
    pattern: /680\s*[×x]\s*64\b/,
    description: 'toolbar window is 680 × 114 (two-row letterbox), not 680 × 64. Audit R3.8.',
    skip: ['CHANGELOG.md']
  },
  {
    pattern: /three[-\s]tier (fallback|pickup)/i,
    description: 'playNextPending has FOUR tiers (priority, focus, pending, fallback). Audit R3.3/R3.4.',
    skip: []
  },
  {
    pattern: /within 50\s*px of an edge/i,
    description: 'snap threshold is 20 px, not 50. Audit R3.3.',
    skip: []
  },
  {
    pattern: /vertical layout.*(56|dock)|left\s*\/\s*right.*vertical dock/i,
    description: 'vertical left/right dock was pulled in pre-release; horizontal-only now. Audit R3.3.',
    skip: ['CHANGELOG.md']
  },
  {
    pattern: /v0\.2.*(Mac|Linux)|(Mac|Linux).*v0\.2/,
    description: 'Mac/Linux ports are on the roadmap with no ETA, not "v0.2". Audit R3.6.',
    skip: ['CHANGELOG.md', 'DESIGN-AUDIT.md']     // audit doc IS v0.2; not a port claim
  },
  {
    pattern: /~180 lines/,
    description: 'sentence_split.py is ~250 lines, not ~180. Audit R3.4.',
    skip: []
  }
];

// v0.4 EX9 — code-comment invariants. These patterns exist ONLY in
// source-code comments (not prose docs), and each represents a false
// claim a future contributor might rely on to make a wrong change.
// Caught by N4 retrospectively; this class should be caught up-front
// going forward.
const CODE_COMMENT_RULES = [
  {
    // v0.3.0 assessment N4 — session-registry.psm1 claimed main.js
    // had a "no auto-prune" policy. It DOES auto-prune non-pinned
    // sessions past SESSION_GRACE_SEC=14400 (4h). The fix landed in
    // v0.3.8 — this rule prevents the stale wording from coming back.
    pattern: /main\.js['s ]*(no[- ]auto[- ]prune|never prune|doesn['’]t prune)/i,
    description: 'main.js.ensureAssignmentsForFiles DOES auto-prune non-pinned sessions past 4h grace. Audit N4 / v0.3.0 assessment.',
    skip: []
  },
  {
    // Palette size has been 24 since v0.2.0 (8 solid + 8 hsplit + 8
    // vsplit arrangements). Early comments said 32; pre-D2 kit still
    // had 31. Any comment claiming 31 or 32 is out-of-date.
    pattern: /(PALETTE_SIZE|palette)\s*(=|is|:)\s*3[12]\b/i,
    description: 'PALETTE_SIZE is 24 (8 solid + 8 hsplit + 8 vsplit). Not 31 or 32.',
    skip: []
  },
  {
    // Grace window is 4h = 14400s = SESSION_GRACE_SEC. Occasionally
    // stale comments mention "2h" (early draft) or "1 hour" (user
    // doc hand-off draft).
    pattern: /grace.*(1\s*hour|2\s*hour|2h grace|7200|3600)/i,
    description: 'SESSION_GRACE_SEC is 14400s (4 hours), not 1h/2h/3600/7200.',
    skip: []
  },
  {
    // Queue dir is ~/.terminal-talk/queue (since v0.1). Early docs
    // referenced clips/ before the rename.
    pattern: /(~|%USERPROFILE%|\$env:USERPROFILE)[^a-z]*\.terminal-talk[\\/]+clips\b/i,
    description: 'queue dir is ~/.terminal-talk/queue, not .../clips.',
    skip: []
  },
  {
    // v0.3.0 auto_continue_after_click default is ON. A comment
    // claiming OFF would mislead anyone reading the toggle logic.
    pattern: /auto_continue_after_click\s*(default|defaults to|is)\s*(off|false|disabled)/i,
    description: 'playback.auto_continue_after_click defaults to TRUE (v0.3.6). Source: app/main.js DEFAULTS.',
    skip: []
  }
];

const DOC_TARGETS = [
  'README.md',
  'CHANGELOG.md',
  'docs/README.md',
  'docs/DESIGN-AUDIT.md',
  'docs/LAUNCH.md',
  'docs/index.html',
  'docs/design-system',
  'docs/ui-kit',
  'scripts/wallpaper.html'
];

// Code files scanned for CODE_COMMENT_RULES. Deliberately NOT scanning
// test files (scripts/run-tests.cjs etc.) because they quote stale
// phrases in their assertion messages — that's by design.
const CODE_TARGETS = [
  'app',
  'hooks',
  'scripts'
];

function walkMatching(p, out, extRegex) {
  const stat = fs.statSync(p);
  if (stat.isFile()) {
    if (extRegex.test(p)) out.push(p);
    return;
  }
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(p)) walkMatching(path.join(p, child), out, extRegex);
  }
}

function gather(targets, extRegex) {
  const files = [];
  for (const rel of targets) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    walkMatching(abs, files, extRegex);
  }
  return files;
}

// Docs = prose files (skip scripts/run-tests.cjs which happens to live
// under scripts/ but has no drift surface; it's the test harness).
const docFiles = gather(DOC_TARGETS, /\.(md|html|js|css|txt)$/i);

// Code = source files. Exclude the test harness (quotes stale phrases
// as test fixtures), generated files, and dependencies.
const codeFiles = gather(CODE_TARGETS, /\.(js|cjs|mjs|py|ps1|psm1)$/i)
  .filter((f) => {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    return !rel.endsWith('scripts/run-tests.cjs')
      && !rel.endsWith('scripts/check-doc-drift.cjs')  // don't scan self — rule definitions contain the stale phrases as patterns
      && !rel.endsWith('scripts/fetch-sonar-findings.cjs')  // quotes issue messages verbatim
      && !rel.includes('tokens-window.js')
      && !rel.includes('voices-window.js')
      && !rel.includes('app-mirror');
  });

let failures = 0;

function scan(files, rules, label) {
  for (const rule of rules) {
    for (const file of files) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      if (rule.skip && rule.skip.some((s) => rel.includes(s))) continue;
      const src = fs.readFileSync(file, 'utf8');
      const lines = src.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (rule.pattern.test(lines[i])) {
          console.error(`✗ [${label}] ${rel}:${i + 1}  ${rule.description}`);
          console.error(`    > ${lines[i].trim().slice(0, 160)}`);
          failures++;
        }
      }
    }
  }
}

scan(docFiles, DOC_RULES, 'doc');
scan(codeFiles, CODE_COMMENT_RULES, 'code-comment');

if (failures > 0) {
  console.error(`\n${failures} doc-drift issue(s) found. Fix them or, if intentional, add the file to a rule's skip list.`);
  process.exit(1);
}
console.log(
  `doc-drift check: OK ` +
  `(${DOC_RULES.length} doc rules across ${docFiles.length} files, ` +
  `${CODE_COMMENT_RULES.length} code-comment rules across ${codeFiles.length} files)`
);
