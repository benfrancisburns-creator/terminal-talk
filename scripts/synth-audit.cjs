#!/usr/bin/env node
'use strict';

// Synth audit — per-turn shrinkage + content-loss survey.
//
// Reads the queue dir + the .original.txt sidecars (which contain the
// pre-sanitiser markdown source for every clip in a turn) and the .txt
// sidecars (which contain the spoken slice). Groups by turn-timestamp,
// computes shrinkage ratio, surfaces content patterns dropped between
// the markdown and the spoken text:
//
//   * backticked spans missing from spoken    (inline-code stripping)
//   * markdown table cells missing             (table summariser flaws)
//   * list-markers (numbered / bullet) missing (list-marker stripping)
//   * URLs missing                             (URL flag stripping)
//   * bolded spans missing                     (emphasis pairing bugs)
//
// Used as a one-shot diagnostic by `npm run synth-audit` AND as an
// ongoing watcher (--watch mode polls the queue dir every 30 s).
//
// Exit code is always 0; the value is in the report. Failures /
// missing files are logged and skipped — never block.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const QUEUE_DIR = process.env.TT_QUEUE_DIR
  || path.join(os.homedir(), '.terminal-talk', 'queue');

const TURN_RE = /^(\d{8}T\d{6}\d{3})-(?:[A-Z]-)?(\d{4})-([a-f0-9]{8})\.(?:original\.)?txt$/;

function loadTurns(maxAgeSec = 86400) {
  const turns = new Map();
  const now = Date.now() / 1000;
  let entries;
  try {
    entries = fs.readdirSync(QUEUE_DIR);
  } catch {
    return turns;
  }
  for (const name of entries) {
    if (name.startsWith('_')) continue;
    const m = name.match(TURN_RE);
    if (!m) continue;
    const full = path.join(QUEUE_DIR, name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (now - stat.mtimeMs / 1000 > maxAgeSec) continue;
    const turnId = m[1];
    const isOrig = name.endsWith('.original.txt');
    let entry = turns.get(turnId);
    if (!entry) {
      entry = { id: turnId, orig: '', clips: [], lastMtime: 0 };
      turns.set(turnId, entry);
    }
    let text;
    try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
    if (isOrig) {
      // All clips in a turn share the same .original.txt content; the
      // first one we find is good enough.
      if (!entry.orig) entry.orig = text;
    } else {
      entry.clips.push(text);
    }
    entry.lastMtime = Math.max(entry.lastMtime, stat.mtimeMs);
  }
  return turns;
}

function findMissing(spans, spokenLowerBlob) {
  // Underscores are KEPT in the bare form because the synth pipeline's
  // _table_cell_summary substitutes `[*_~|]+` → space, so `node_modules`
  // becomes `node modules` in spoken text. Pre-2026-05-09 the watcher
  // stripped underscores from `bare` too, leaving `nodemodules` which
  // never matched the spoken `node modules` — false-positive in the
  // largest-volume class. Now we check both forms: literal underscored
  // and underscores-as-spaces.
  const missing = [];
  const seen = new Set();
  for (const raw of spans) {
    const bare = raw.replace(/[`*~|]+/g, '').trim();
    if (bare.length < 3 || seen.has(bare)) continue;
    seen.add(bare);
    const lower = bare.toLowerCase();
    const spaced = lower.replace(/_/g, ' ');
    if (!spokenLowerBlob.includes(lower) && !spokenLowerBlob.includes(spaced)) {
      missing.push(bare);
    }
  }
  return missing;
}

// Block D2 (#44): semantic category — what dominates the original
// content. Lets the report split retention by content type so we can
// see if (e.g.) table-heavy turns improved post-Block-A while prose-
// heavy stayed flat. Categories are mutually exclusive — pick the
// one with the highest character share (with a 'prose' tiebreaker).
function classifyContent(orig) {
  const total = orig.length || 1;
  let codeChars = 0;
  let tableChars = 0;
  let listChars = 0;
  for (const line of orig.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('|') && t.endsWith('|')) tableChars += line.length + 1;
    else if (/^[ \t]*(?:\d+\.|[-*+])[ \t]+/.test(line)) listChars += line.length + 1;
  }
  // Code blocks (```...```) — count the inner body lines.
  const fenceRE = /```[a-zA-Z]*\n([\s\S]*?)```/g;
  let m;
  while ((m = fenceRE.exec(orig))) codeChars += m[1].length;
  const proseChars = total - tableChars - listChars - codeChars;
  const buckets = [
    ['table', tableChars],
    ['list', listChars],
    ['code', codeChars],
    ['prose', proseChars],
  ];
  buckets.sort((a, b) => b[1] - a[1]);
  return buckets[0][0];  // dominant category
}

// Block D3 (#44): rough English speaking-rate estimate. edge-tts at
// default voice + speed=1.0 outputs ~14 chars/sec including pauses.
// Multiply by playback_speed in cfg if you want to model 1.25× etc.,
// but the JSONL stays speed-agnostic so ratios across turns compare.
function estimateSpokenSec(spokenChars, charsPerSec = 14) {
  return Number((spokenChars / charsPerSec).toFixed(1));
}

function auditTurn(entry) {
  if (!entry.orig || entry.clips.length === 0) return null;
  const orig = entry.orig;
  const spokenBlob = entry.clips.join(' ').toLowerCase();
  const spokenChars = entry.clips.reduce((n, s) => n + s.length, 0);
  const ratio = spokenChars / orig.length;

  // Pattern extractors.
  const backtickSpans = [...orig.matchAll(/`([^`\n]+?)`/g)].map((m) => m[1]);
  const boldSpans = [...orig.matchAll(/\*\*([^*\n]+?)\*\*/g)].map((m) => m[1]);
  const urlSpans = [...orig.matchAll(/https?:\/\/[^\s)]+/gi)].map((m) => m[0]);
  const tableCells = [];
  for (const line of orig.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|') || !t.endsWith('|')) continue;
    if (/^\|[\s:|-]+\|$/.test(t)) continue;  // separator row
    for (const cell of t.slice(1, -1).split('|')) {
      const c = cell.replace(/[`*_~]+/g, '').trim();
      if (c.length >= 4) tableCells.push(c);
    }
  }
  const listMarkers = [];
  for (const line of orig.split('\n')) {
    const m = line.match(/^[ \t]*(?:\d+\.|[-*+])[ \t]+(.+)$/);
    if (m) {
      const c = m[1].replace(/[`*_~]+/g, '').trim();
      if (c.length >= 4) listMarkers.push(c);
    }
  }

  return {
    turn: entry.id,
    mtime: new Date(entry.lastMtime).toISOString(),
    clip_count: entry.clips.length,
    orig_chars: orig.length,
    spoken_chars: spokenChars,
    shrinkage_ratio: Number(ratio.toFixed(3)),
    category: classifyContent(orig),
    est_spoken_sec: estimateSpokenSec(spokenChars),
    missing_backtick: findMissing(backtickSpans, spokenBlob).slice(0, 5),
    missing_bold: findMissing(boldSpans, spokenBlob).slice(0, 5),
    missing_url: findMissing(urlSpans, spokenBlob).slice(0, 3),
    missing_table_cell: findMissing(tableCells, spokenBlob).slice(0, 5),
    missing_list_marker: findMissing(listMarkers, spokenBlob).slice(0, 5),
  };
}

function summarise(reports) {
  const ranked = reports.filter((r) => r.shrinkage_ratio < 1)
    .sort((a, b) => a.shrinkage_ratio - b.shrinkage_ratio);
  const totalDropped = {
    backtick: 0, bold: 0, url: 0, table_cell: 0, list_marker: 0,
  };
  for (const r of reports) {
    totalDropped.backtick += r.missing_backtick.length;
    totalDropped.bold += r.missing_bold.length;
    totalDropped.url += r.missing_url.length;
    totalDropped.table_cell += r.missing_table_cell.length;
    totalDropped.list_marker += r.missing_list_marker.length;
  }
  // Block D2: per-category retention. Compares whether (e.g.) Block A's
  // table fixes moved table-heavy retention while leaving prose-heavy
  // alone. Calculated from total-orig / total-spoken char ratios per
  // bucket so a single tiny prose turn doesn't skew prose-heavy.
  const catBuckets = {};
  for (const r of reports) {
    const cat = r.category || 'prose';
    if (!catBuckets[cat]) catBuckets[cat] = { count: 0, orig: 0, spoken: 0, est_sec: 0 };
    catBuckets[cat].count += 1;
    catBuckets[cat].orig += r.orig_chars;
    catBuckets[cat].spoken += r.spoken_chars;
    catBuckets[cat].est_sec += r.est_spoken_sec || 0;
  }
  const byCategory = {};
  for (const cat of Object.keys(catBuckets)) {
    const b = catBuckets[cat];
    byCategory[cat] = {
      count: b.count,
      retention: Number((b.spoken / Math.max(1, b.orig)).toFixed(3)),
      total_est_sec: Number(b.est_sec.toFixed(1)),
    };
  }
  return { ranked, totalDropped, byCategory, count: reports.length };
}

function fmtPct(n) {
  return `${(n * 100).toFixed(0)}%`;
}

function renderText(reports, summary, mostShrunkLimit = 10) {
  const lines = [];
  lines.push(`synth-audit · ${summary.count} turns analysed`);
  lines.push('');
  lines.push('Aggregate dropped-pattern counts (samples surfaced per turn ≤ 5):');
  lines.push(`  backticked spans:   ${summary.totalDropped.backtick}`);
  lines.push(`  bolded spans:       ${summary.totalDropped.bold}`);
  lines.push(`  URLs:               ${summary.totalDropped.url}`);
  lines.push(`  table cells:        ${summary.totalDropped.table_cell}`);
  lines.push(`  list markers:       ${summary.totalDropped.list_marker}`);
  lines.push('');
  // Block D2: per-category retention so we can see if one bucket
  // (table-heavy / list-heavy / prose-heavy / code-heavy) is moving
  // while another stays flat — useful for measuring Block A's effect
  // on the next audit pass.
  if (summary.byCategory && Object.keys(summary.byCategory).length) {
    lines.push('Retention by content category:');
    const cats = Object.entries(summary.byCategory).sort((a, b) => b[1].count - a[1].count);
    for (const [cat, b] of cats) {
      lines.push(`  ${cat.padEnd(7)} ${String(b.count).padStart(4)} turns  retention=${fmtPct(b.retention).padStart(4)}  est_audio=${b.total_est_sec.toFixed(0).padStart(5)} s`);
    }
    lines.push('');
  }
  lines.push(`Most-shrunk turns (worst content / size ratio):`);
  for (const r of summary.ranked.slice(0, mostShrunkLimit)) {
    lines.push(`  ${r.turn}  ratio=${fmtPct(r.shrinkage_ratio)}  orig=${r.orig_chars}c spoken=${r.spoken_chars}c clips=${r.clip_count}`);
    if (r.missing_backtick.length) {
      lines.push(`    missing backticks: ${r.missing_backtick.join(', ')}`);
    }
    if (r.missing_bold.length) {
      lines.push(`    missing bolds:     ${r.missing_bold.join(', ')}`);
    }
    if (r.missing_table_cell.length) {
      lines.push(`    missing cells:     ${r.missing_table_cell.join(', ')}`);
    }
  }
  return lines.join('\n');
}

function writeJsonl(reports, filePath) {
  const lines = reports.map((r) => JSON.stringify(r));
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

function appendJsonlRecords(reports, filePath, seenIds) {
  const fresh = reports.filter((r) => !seenIds.has(r.turn));
  if (fresh.length === 0) return 0;
  const lines = fresh.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.appendFileSync(filePath, lines, 'utf8');
  for (const r of fresh) seenIds.add(r.turn);
  return fresh.length;
}

function loadSeenTurnIds(filePath) {
  const seen = new Set();
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); } catch { return seen; }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && obj.turn) seen.add(obj.turn);
    } catch { /* skip malformed lines */ }
  }
  return seen;
}

async function runWatch(filePath, intervalSec = 30) {
  const seen = loadSeenTurnIds(filePath);
  process.stderr.write(`synth-audit watch: appending to ${filePath} (${seen.size} already-seen turns), polling every ${intervalSec}s\n`);
  const tick = () => {
    const turns = loadTurns(86400 * 7);
    const reports = [];
    for (const entry of turns.values()) {
      const r = auditTurn(entry);
      if (r) reports.push(r);
    }
    const wrote = appendJsonlRecords(reports, filePath, seen);
    if (wrote > 0) {
      process.stderr.write(`+${wrote} new turn(s) (${seen.size} total)\n`);
    }
  };
  tick();
  setInterval(tick, intervalSec * 1000);
}

function main(argv) {
  const args = new Set(argv.slice(2));
  const jsonl = [...argv].find((a) => a.startsWith('--jsonl='));
  const watchArg = [...argv].find((a) => a === '--watch' || a.startsWith('--watch='));
  if (watchArg) {
    if (!jsonl) {
      process.stderr.write('--watch requires --jsonl=<path>\n');
      process.exit(2);
    }
    const filePath = jsonl.split('=')[1];
    const intervalSec = watchArg.includes('=') ? Number(watchArg.split('=')[1]) : 30;
    runWatch(filePath, intervalSec);
    return;
  }
  const turns = loadTurns(86400 * 7);  // last 7 days
  const reports = [];
  for (const entry of turns.values()) {
    const r = auditTurn(entry);
    if (r) reports.push(r);
  }
  const summary = summarise(reports);
  if (args.has('--json')) {
    process.stdout.write(JSON.stringify({ summary, reports }, null, 2) + '\n');
  } else {
    process.stdout.write(renderText(reports, summary) + '\n');
  }
  if (jsonl) {
    const filePath = jsonl.split('=')[1];
    writeJsonl(reports, filePath);
    process.stderr.write(`wrote ${reports.length} records to ${filePath}\n`);
  }
}

if (require.main === module) {
  main(process.argv);
}

module.exports = { loadTurns, auditTurn, summarise };
