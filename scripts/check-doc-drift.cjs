#!/usr/bin/env node
/*
 * Doc-drift guard — fails CI if stale phrases reappear in the
 * documentation. Each rule is:
 *
 *   { pattern: RegExp,  description: string,  skip?: string[] }
 *
 * `skip` is a list of filepath substrings — if a match occurs in one of
 * these files the hit is allowed (useful for CHANGELOG entries that
 * document the REMOVAL of a behaviour).
 *
 * Run on every push/PR via .github/workflows/test.yml so a doc-sync
 * regression can't land without being seen.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const RULES = [
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
    // Post-hey_tt (feat/hey-tt): wake phrase is HEY TT. Flag stale
    // HEY JARVIS references so any new doc that copy-pastes from old
    // material gets caught. Archived v0.2 docs legitimately say HEY
    // JARVIS (correct for that version) so docs/v0.2/ is skipped;
    // CHANGELOG documents the rename and is also skipped.
    pattern: /HEY\s*JARVIS/,
    description: 'wake phrase is HEY TT since feat/hey-tt, not HEY JARVIS. See docs/architecture/wake-word-training.md.',
    skip: ['CHANGELOG.md', 'docs/v0.2/']
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

const TARGETS = [
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

function walk(p, out) {
  const stat = fs.statSync(p);
  if (stat.isFile()) {
    if (/\.(md|html|js|css|txt)$/i.test(p)) out.push(p);
    return;
  }
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(p)) walk(path.join(p, child), out);
  }
}

const files = [];
for (const rel of TARGETS) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  walk(abs, files);
}

let failures = 0;
for (const rule of RULES) {
  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (rule.skip && rule.skip.some(s => rel.includes(s))) continue;
    const src = fs.readFileSync(file, 'utf8');
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (rule.pattern.test(lines[i])) {
        console.error(`✗ ${rel}:${i + 1}  ${rule.description}`);
        console.error(`    > ${lines[i].trim().slice(0, 160)}`);
        failures++;
      }
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} doc-drift issue(s) found. Fix them or, if intentional, add the file to a rule's skip list.`);
  process.exit(1);
}
console.log(`doc-drift check: OK (${RULES.length} rules across ${files.length} files)`);
