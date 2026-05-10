#!/usr/bin/env node
// Probes frames at fixed intervals from mascot-spin and counts ANSI cells that
// changed between successive pairs. Reports per-region flicker rates so the
// user can identify which areas are oversaturated with per-frame noise.
//
// Usage: node scripts/mascot-flicker-report.cjs [out.txt]

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUTFILE = process.argv[2] || '/tmp/flicker-report.txt';
const FPS = 30;
const NUM_FRAMES = 60;                     // 2 seconds of frames
const INTERVAL_MS = Math.round(1000 / FPS);

function probe(t) {
  const res = spawnSync(process.execPath,
    [path.join(__dirname, 'mascot-spin.cjs'), '--walk', '--probe', '--time', String(t)],
    { encoding: 'utf8', maxBuffer: 1e7 });
  return res.stdout;
}

function parseCells(ansi) {
  // Returns flat array of "fg|bg" strings per cell — one entry per half-cell pair.
  const lines = ansi.split('\n').filter(l => l.length);
  let fg = null, bg = null;
  const grid = [];
  for (const line of lines) {
    const cells = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] === '\x1b') {
        const m = /^\x1b\[([0-9;?]*)([a-zA-Z])/.exec(line.slice(i));
        if (m) {
          if (m[2] === 'm') {
            const codes = m[1].split(';');
            let j = 0;
            while (j < codes.length) {
              const c = codes[j];
              if (c === '' || c === '0') { fg=null; bg=null; j++; }
              else if (c === '49') { bg=null; j++; }
              else if (c === '38' && codes[j+1] === '2') { fg=`${codes[j+2]},${codes[j+3]},${codes[j+4]}`; j+=5; }
              else if (c === '48' && codes[j+1] === '2') { bg=`${codes[j+2]},${codes[j+3]},${codes[j+4]}`; j+=5; }
              else j++;
            }
          }
          i += m[0].length;
          continue;
        }
      }
      cells.push(`${fg||'-'}|${bg||'-'}`);
      i++;
    }
    grid.push(cells);
  }
  return grid;
}

function regionOf(row, col, totalRows, totalCols) {
  // Split canvas into 9 regions: top-left, top-mid, top-right, mid-left, ...
  const r = row < totalRows / 3 ? 'T' : row < totalRows * 2/3 ? 'M' : 'B';
  const c = col < totalCols / 3 ? 'L' : col < totalCols * 2/3 ? 'C' : 'R';
  return r + c;
}

console.error(`Probing ${NUM_FRAMES} frames @ ${FPS}fps ...`);
const frames = [];
for (let i = 0; i < NUM_FRAMES; i++) {
  const t = i * INTERVAL_MS;
  frames.push(parseCells(probe(t)));
  if ((i + 1) % 15 === 0) console.error(`  frame ${i+1}/${NUM_FRAMES}`);
}

const numRows = frames[0].length;
const numCols = Math.max(...frames[0].map(r => r.length));
console.error(`Grid: ${numRows} char-rows × ${numCols} cols`);

// Compare consecutive pairs.
const totalChanges = new Map();           // region → sum of changes across all transitions
const cellChanges = Array.from({length:numRows}, () => Array(numCols).fill(0));
let totalCellsChanged = 0;
let totalTransitions = NUM_FRAMES - 1;

for (let f = 1; f < NUM_FRAMES; f++) {
  const a = frames[f-1], b = frames[f];
  for (let row = 0; row < numRows; row++) {
    const ra = a[row] || [], rb = b[row] || [];
    const cols = Math.max(ra.length, rb.length);
    for (let col = 0; col < cols; col++) {
      const ca = ra[col] || '-|-';
      const cb = rb[col] || '-|-';
      if (ca !== cb) {
        cellChanges[row][col]++;
        totalCellsChanged++;
        const reg = regionOf(row, col, numRows, numCols);
        totalChanges.set(reg, (totalChanges.get(reg) || 0) + 1);
      }
    }
  }
}

const totalCells = numRows * numCols;
const avgChangesPerFrame = totalCellsChanged / totalTransitions;
const avgChangesPercent = (avgChangesPerFrame / totalCells * 100).toFixed(1);

let report = '';
report += `=== Mascot flicker report ===\n`;
report += `Frames probed: ${NUM_FRAMES} @ ${FPS}fps (${(NUM_FRAMES * INTERVAL_MS / 1000).toFixed(1)}s)\n`;
report += `Grid: ${numRows} char-rows × ${numCols} cols (${totalCells} cells)\n`;
report += `Avg cells changed per frame: ${avgChangesPerFrame.toFixed(0)} / ${totalCells} (${avgChangesPercent}%)\n\n`;

report += `Per-region change rate (% of region cells changed per frame on avg):\n`;
const regionOrder = ['TL','TC','TR','ML','MC','MR','BL','BC','BR'];
for (const reg of regionOrder) {
  const changes = totalChanges.get(reg) || 0;
  const cellsInRegion = Math.ceil(numRows / 3) * Math.ceil(numCols / 3);
  const avgPerFrame = changes / totalTransitions;
  const pct = (avgPerFrame / cellsInRegion * 100).toFixed(1);
  report += `  ${reg}: ${avgPerFrame.toFixed(0).padStart(4)} cells/frame (${pct.padStart(5)}%)\n`;
}

// Top 30 hottest cells (changed most often)
const flat = [];
for (let row = 0; row < numRows; row++) {
  for (let col = 0; col < numCols; col++) {
    if (cellChanges[row][col] > 0) {
      flat.push({ row, col, n: cellChanges[row][col] });
    }
  }
}
flat.sort((a, b) => b.n - a.n);
report += `\nTop 30 hottest cells (changed across ${totalTransitions} frame transitions):\n`;
for (let i = 0; i < Math.min(30, flat.length); i++) {
  const c = flat[i];
  report += `  r${String(c.row).padStart(2)} c${String(c.col).padStart(3)}: ${c.n}/${totalTransitions} (${(c.n/totalTransitions*100).toFixed(0)}%)\n`;
}

fs.writeFileSync(OUTFILE, report);
console.error(`Wrote ${OUTFILE}`);
console.log(report);
