#!/usr/bin/env node
/* eslint-disable no-console -- diagnostic script */
// Real-time session-registry watcher.
// Logs every mutation of ~/.terminal-talk/session-colours.json to
// ~/.terminal-talk/queue/_registry-watcher.log with a per-entry delta
// (label / pinned / speech_includes / voice). Intended to catch the #8
// delete-then-recreate wipe in-flight during normal usage.
//
// Usage:  node scripts/watch-registry.cjs
// Stops on SIGINT.

const fs = require('fs');
const path = require('path');
const os = require('os');

const REG = path.join(os.homedir(), '.terminal-talk', 'session-colours.json');
const LOG = path.join(os.homedir(), '.terminal-talk', 'queue', '_registry-watcher.log');

let last = null;
let lastMtime = 0;

function snap() {
  try {
    const raw = fs.readFileSync(REG, 'utf8');
    const st = fs.statSync(REG);
    return { raw, parsed: JSON.parse(raw), mtime: st.mtimeMs, size: st.size };
  } catch (e) { return { err: e.message }; }
}

function fingerprint(entry) {
  if (!entry || typeof entry !== 'object') return String(entry);
  return JSON.stringify({
    label: entry.label ?? '',
    pinned: !!entry.pinned,
    voice: entry.voice ?? null,
    speech_includes: entry.speech_includes ?? null,
    claude_pid: entry.claude_pid ?? null,
    index: entry.index ?? null,
    last_seen: entry.last_seen ?? null,
  });
}

function diff(prev, next) {
  if (!prev || !prev.parsed) return { note: 'first-snapshot', entries: Object.keys(next.parsed || {}).length };
  const p = prev.parsed, n = next.parsed;
  const pk = new Set(Object.keys(p)), nk = new Set(Object.keys(n));
  const added = [...nk].filter(k => !pk.has(k));
  const removed = [...pk].filter(k => !nk.has(k));
  const changed = [];
  for (const k of nk) {
    if (!pk.has(k)) continue;
    const pf = fingerprint(p[k]);
    const nf = fingerprint(n[k]);
    if (pf !== nf) changed.push({ short: k, before: p[k], after: n[k] });
  }
  return { added, removed, changed, sizeDelta: next.size - (prev.size || 0) };
}

function write(msg) {
  try { fs.appendFileSync(LOG, msg + '\n'); } catch {}
  console.log(msg);
}

function tick() {
  const cur = snap();
  if (cur.err) { write(`[${new Date().toISOString()}] READ-ERR ${cur.err}`); return; }
  if (cur.mtime === lastMtime) return;
  lastMtime = cur.mtime;
  const d = diff(last, cur);
  const ts = new Date().toISOString();
  if (d.note) {
    write(`[${ts}] SNAPSHOT ${d.entries} entries size=${cur.size}`);
  } else if (!d.added.length && !d.removed.length && !d.changed.length) {
    write(`[${ts}] TOUCH (mtime bumped, content identical) size=${cur.size}`);
  } else {
    write(`[${ts}] MUTATION size=${cur.size} sizeDelta=${d.sizeDelta}`);
    if (d.added.length) write(`  ADDED: ${JSON.stringify(d.added)}`);
    if (d.removed.length) write(`  REMOVED: ${JSON.stringify(d.removed)}`);
    for (const c of d.changed) {
      const bf = fingerprint(c.before), af = fingerprint(c.after);
      write(`  CHANGED ${c.short}: ${bf} -> ${af}`);
    }
  }
  last = cur;
}

fs.mkdirSync(path.dirname(LOG), { recursive: true });
write(`[${new Date().toISOString()}] --- watcher start, polling ${REG} every 500ms ---`);
tick();
setInterval(tick, 500);
process.on('SIGINT', () => { write(`[${new Date().toISOString()}] --- watcher stop ---`); process.exit(0); });
