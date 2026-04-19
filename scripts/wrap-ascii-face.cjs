#!/usr/bin/env node
/**
 * One-off transform: wrap runs of █ inside each letter-colored ASCII
 * span with <span class="face">...</span>. The outer letter span then
 * takes the darker "shadow" color (applied to ╔╗╚╝═║ bevel chars),
 * giving the ANSI-Shadow art a real cast-shadow look where each
 * letter's shadow is a darker shade of its face color.
 *
 * Idempotent: skips spans that already contain face inner-spans.
 */
const fs = require('fs');

const LETTER_CLASSES = ['t','e','r','m','i','n','a','l','tlk-t','tlk-a','tlk-l','tlk-k'];
const CLASS_ALT = LETTER_CLASSES.map(c => c.replace('-', '\\-')).join('|');

// Only the main pre.ascii blocks in these files use per-letter spans
// with ASCII content — this regex is tight enough to avoid collateral
// damage on unrelated spans.
const SPAN_RE = new RegExp(
  `<span class="(${CLASS_ALT})">([^<]*)<\\/span>`,
  'g'
);

for (const file of process.argv.slice(2)) {
  let html = fs.readFileSync(file, 'utf8');
  let changed = 0;
  html = html.replace(SPAN_RE, (match, cls, content) => {
    if (content.includes('class="face"')) return match; // already transformed
    if (!/█/.test(content)) return match; // nothing to wrap
    const wrapped = content.replace(/(█+)/g, '<span class="face">$1</span>');
    changed++;
    return `<span class="${cls}">${wrapped}</span>`;
  });
  fs.writeFileSync(file, html);
  console.log(`${file}: wrapped ${changed} letter-span(s)`);
}
