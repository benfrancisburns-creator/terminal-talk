#!/usr/bin/env node
// Captures N frames of the walking mascot scene from mascot-spin.cjs,
// converts each ANSI frame to HTML spans, and writes a self-contained
// HTML page with JS-driven looping playback. Open the file in any browser
// to see the live render. Re-run after each code change.
//
// Usage: node scripts/mascot-html-preview.cjs [frames] [outfile]

const { spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const FRAMES  = Number(process.argv[2] || 90);
const OUTFILE = process.argv[3] || '/tmp/mascot-preview.html';
const FPS     = 30;

console.error(`Capturing ${FRAMES} frames @ ${FPS}fps from mascot-spin --walk ...`);

const result = spawnSync(
  process.execPath,
  [
    path.join(__dirname, 'mascot-spin.cjs'),
    '--walk', '--frames', String(FRAMES), '--fps', String(FPS),
  ],
  { encoding: 'utf8', maxBuffer: 320 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: '1' } },
);
if (result.error) { console.error(result.error); process.exit(1); }
if (result.status !== 0) { console.error('mascot-spin exited with status', result.status); }

let stdout = result.stdout;
// Strip leading hide-cursor + clear-screen.
stdout = stdout.replace(/^\x1b\[\?25l\x1b\[2J/, '');
// Strip trailing show-cursor + reset.
stdout = stdout.replace(/\x1b\[\?25h\x1b\[0m\n?$/, '');

// Each rendered frame begins with cursor-home (\x1b[H). Split on it.
const rawFrames = stdout.split('\x1b[H').filter(s => s.length > 100);
console.error(`Captured ${rawFrames.length} frames`);

function escapeHtml(ch) {
  if (ch === '<') return '&lt;';
  if (ch === '>') return '&gt;';
  if (ch === '&') return '&amp;';
  return ch;
}

// Convert one ANSI frame to HTML spans. Coalesces consecutive cells with the
// same fg+bg into a single <span> to keep the page from exploding in size.
function ansiFrameToHtml(ansi) {
  let html = '';
  let fg = null, bg = null;
  let curStyle = '';
  let buf = '';
  let i = 0;

  function flush() {
    if (!buf) return;
    if (curStyle) html += `<span style="${curStyle}">${buf}</span>`;
    else html += buf;
    buf = '';
  }

  function styleString() {
    let s = '';
    if (fg) s += `color:rgb(${fg});`;
    if (bg) s += `background:rgb(${bg});`;
    return s;
  }

  while (i < ansi.length) {
    if (ansi[i] === '\x1b') {
      const m = /^\x1b\[([0-9;?]*)([a-zA-Z])/.exec(ansi.slice(i));
      if (!m) { i++; continue; }
      if (m[2] !== 'm') { i += m[0].length; continue; }   // skip cursor moves etc
      const codes = m[1].split(';');
      let j = 0;
      while (j < codes.length) {
        const c = codes[j];
        if (c === '' || c === '0') { fg = null; bg = null; j++; }
        else if (c === '49') { bg = null; j++; }
        else if (c === '39') { fg = null; j++; }
        else if (c === '38' && codes[j + 1] === '2') {
          fg = `${codes[j + 2]},${codes[j + 3]},${codes[j + 4]}`; j += 5;
        }
        else if (c === '48' && codes[j + 1] === '2') {
          bg = `${codes[j + 2]},${codes[j + 3]},${codes[j + 4]}`; j += 5;
        }
        else j++;
      }
      const newStyle = styleString();
      if (newStyle !== curStyle) { flush(); curStyle = newStyle; }
      i += m[0].length;
      continue;
    }
    const ch = ansi[i];
    if (ch === '\n') { flush(); html += '\n'; i++; continue; }
    buf += escapeHtml(ch);
    i++;
  }
  flush();
  return html;
}

const htmlFrames = rawFrames.map(ansiFrameToHtml);

const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Terminal Talk mascot — live preview</title>
<style>
  html, body {
    background: #0a0a14;
    margin: 0;
    padding: 18px;
    font-family: 'Cascadia Mono', 'JetBrains Mono', 'Consolas', 'Menlo', monospace;
    color: #ddd;
  }
  h2 { font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
       font-weight: 400; color: #888; margin: 0 0 12px; font-size: 14px; }
  pre {
    font-size: 13px;
    line-height: 1.0;
    letter-spacing: 0;
    margin: 0;
    color: #fff;
    white-space: pre;
    background: #04040a;
    padding: 8px 10px;
    border-radius: 4px;
    box-shadow: 0 0 0 1px #1a1a2a inset;
    display: inline-block;
  }
  .controls { margin-top: 12px; color: #888; font-family: sans-serif; font-size: 13px; display: flex; gap: 12px; align-items: center; }
  button { background: #1a1a2a; color: #fff; border: 1px solid #2a2a3a; padding: 4px 14px; cursor: pointer; border-radius: 4px; font: inherit; }
  button:hover { border-color: #4a4a5a; }
  #counter { font-family: 'Cascadia Mono', monospace; }
</style>
</head>
<body>
<h2>Mascot live preview · ${rawFrames.length} frames @ ${FPS}fps · regenerate after each change</h2>
<pre id="frame"></pre>
<div class="controls">
  <button id="toggle">Pause</button>
  <button id="step">Step</button>
  <span id="counter"></span>
</div>
<script>
const frames = ${JSON.stringify(htmlFrames)};
const fpsMs = ${Math.round(1000 / FPS)};
let i = 0;
let paused = false;
const out      = document.getElementById('frame');
const counter  = document.getElementById('counter');
const toggle   = document.getElementById('toggle');
const stepBtn  = document.getElementById('step');

function show(idx) {
  out.innerHTML = frames[idx % frames.length];
  counter.textContent = 'frame ' + (idx % frames.length).toString().padStart(3, '0') +
                        ' / ' + frames.length;
}

toggle.addEventListener('click', () => {
  paused = !paused;
  toggle.textContent = paused ? 'Play' : 'Pause';
});
stepBtn.addEventListener('click', () => {
  paused = true;
  toggle.textContent = 'Play';
  i++;
  show(i);
});

function tick() {
  if (!paused) { show(i); i++; }
  setTimeout(tick, fpsMs);
}
tick();
</script>
</body>
</html>
`;

fs.writeFileSync(OUTFILE, page);
console.error(`Wrote ${OUTFILE} (${(page.length / 1024).toFixed(0)} KB)`);
console.error(`Open it with: open ${OUTFILE}`);
