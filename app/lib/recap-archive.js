'use strict';

// Session recap archive — main-process side of the "catch up on what I
// missed" feature (2026-10-05).
//
// Problem: body clips auto-delete ~20 s after they play. If the user is
// away from the machine the clips play, vanish, and the only trace is
// the .txt sidecar. The user wants to click a session tab -> Recap ->
// "last 10 clips" / "last 5 minutes" and hear them again.
//
// Mechanism: instead of unlinking a body clip when it leaves the queue
// (auto-prune, manual delete, bin, stale sweep) we MOVE it into
// <queue>/recap/ and keep it there for `playback.recap_keep_min` minutes
// (default 120). A recap request copies the chosen clips back into the
// queue dir under a STAGED name:
//
//     <newts>-R-<original name>
//
// The fresh timestamp prefix makes the copy the newest file on disk, so
// it lands inside the queue watcher's lexical pre-slice + MAX_FILES
// window and shows up as a dot. The `-R-` marker lets every other path
// (delete-file, sidecar reads, boot cleanup) recognise a staged copy and
// recover the original name — a staged copy is never re-archived, it is
// simply unlinked, because the archive already holds the original.
//
// Eligibility: only assistant body clips are kept — a clip must carry a
// session short and must NOT be a highlight-to-speak J clip (`-clip-`)
// or an ephemeral T-/H- tool-narration / heartbeat clip. Everything else
// is unlinked exactly as before.
//
// Metadata: <queue>/recap/index.json maps original filename ->
// { durationSec, archivedAt, reason, played }. Durations come from the
// renderer (audio.duration at `ended`) when known; otherwise they are
// estimated from the file bytes (WAV header byte-rate, or the first MP3
// frame header's bitrate — edge-tts writes 48 kbit/s CBR). The index is
// rewritten atomically (tmp + rename) and self-heals: entries whose file
// is gone are dropped on every prune.
//
// Retention: prune() removes clips older than the keep window, then
// enforces hard caps (200 per session / 1000 total, oldest first). A keep
// window of 0 disables the feature: nothing is archived and prune()
// empties the directory.
//
// Factory-injected fs/path/now so the unit harness can drive it against
// a temp dir without Electron.

const realFs = require('node:fs');
const realPath = require('node:path');
const clipPathsLib = require('./clip-paths');

const RECAP_DIR_NAME = 'recap';
const INDEX_NAME = 'index.json';
const DEFAULT_KEEP_MS = 120 * 60 * 1000;
const DEFAULT_MAX_PER_SESSION = 200;
const DEFAULT_MAX_TOTAL = 1000;
// Hard cap on clips staged by one recap request. The renderer only ever
// sees the newest MAX_FILES (50) queue files, so staging more than that
// would leave the overflow unplayable — and every staged copy also pushes
// one older live clip out of that window until it is pruned again. 25
// (~4 minutes of speech) keeps half the window for real arrivals.
const MAX_RECAP_CLIPS = 25;
// Last-resort byte-rate guess when neither the index nor the file header
// yields a duration: edge-tts default output is 48 kbit/s mono MP3.
const FALLBACK_BYTES_PER_SEC = 6000;
const AUDIO_RE = /\.(mp3|wav)$/i;
// Status chatter that is not a "message" and would only pad a recap:
//   <ts>-9999-<short>     Claude "Worked for X" footer clip (footer-watcher)
//   <ts>-E-0000-<short>   Codex "Codex worked for X" / "Codex finished"
//   <ts>-notif-<short>    permission-prompt notification (speak-notification)
//   <ts>-plugin-start-<short>  Codex plugin "loaded" announcement
const STATUS_CLIP_RE = /-(?:9999|E-\d{4}|notif|plugin-start)-[a-f0-9]{8}\.(?:mp3|wav)$/i;
// Only clips that left the queue WITHOUT the user asking are worth a
// replay: the renderer's post-play auto-prune and the 1-hour stale sweep.
// An explicit right-click delete / bin / clear-session means "I don't
// want these" — those are unlinked, and any archived original of the same
// name is dropped too so an [All] recap can't resurrect them.
const ARCHIVE_REASONS = new Set(['played-auto-prune', 'stale-prune']);
const DEFAULT_MAX_TOTAL_BYTES = 300 * 1024 * 1024;
// Inline housekeeping cadence: prune() every N archives so the caps can't
// overshoot by more than N between the 30-minute watchdog sweeps.
const INLINE_PRUNE_EVERY = 50;
const SHORT_RE = /^[a-f0-9]{8}$/;

// MPEG audio bitrate tables (kbit/s), index 1..14. Layer III only — that
// is all edge-tts / OpenAI ever emit. 0 and 15 are reserved/invalid.
const MP3_BITRATES = {
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

function formatQueueTimestamp(ms) {
  const d = new Date(ms);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${pad(d.getMilliseconds(), 3)}`;
}

// Pure: parse enough of a WAV / MP3 header to turn a byte size into a
// duration. Returns null when the bytes don't look like either format.
function estimateDurationFromBytes(head, size, name) {
  if (!head || !Number.isFinite(size) || size <= 0) return null;
  const lower = String(name || '').toLowerCase();
  // WAV: RIFF....WAVE, fmt chunk byte-rate at offset 28.
  if (head.length >= 32 && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WAVE') {
    const byteRate = head.readUInt32LE(28);
    if (byteRate > 0) return Math.max(0, (size - 44) / byteRate);
    return null;
  }
  if (lower.endsWith('.wav')) return null;
  // MP3: skip an ID3v2 tag if present, then find the first frame sync.
  let offset = 0;
  if (head.length >= 10 && head.toString('ascii', 0, 3) === 'ID3') {
    const tagSize = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f);
    offset = 10 + tagSize;
  }
  for (let i = offset; i + 3 < head.length; i++) {
    if (head[i] !== 0xff || (head[i + 1] & 0xe0) !== 0xe0) continue;
    const versionBits = (head[i + 1] >> 3) & 0x03;   // 00 = v2.5, 10 = v2, 11 = v1
    const layerBits = (head[i + 1] >> 1) & 0x03;     // 01 = Layer III
    const bitrateIdx = (head[i + 2] >> 4) & 0x0f;
    if (versionBits === 1 || layerBits !== 1 || bitrateIdx === 0 || bitrateIdx === 15) continue;
    const table = versionBits === 3 ? MP3_BITRATES.v1 : MP3_BITRATES.v2;
    const kbps = table[bitrateIdx];
    if (!kbps) continue;
    return Math.max(0, (size - i) * 8 / (kbps * 1000));
  }
  return null;
}

function createRecapArchive({
  queueDir,
  fs = realFs,
  path = realPath,
  clipPaths = clipPathsLib,
  diag = () => {},
  now = () => Date.now(),
  getKeepMs = () => DEFAULT_KEEP_MS,
  maxPerSession = DEFAULT_MAX_PER_SESSION,
  maxTotal = DEFAULT_MAX_TOTAL,
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
  maxRecapClips = MAX_RECAP_CLIPS,
} = {}) {
  if (!queueDir) throw new Error('createRecapArchive: queueDir required');
  const recapDir = path.join(queueDir, RECAP_DIR_NAME);
  const indexPath = path.join(recapDir, INDEX_NAME);
  let archivedSincePrune = 0;

  function keepMs() {
    const v = Number(getKeepMs());
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  function isEnabled() { return keepMs() > 0; }

  function baseName(p) { return String(p || '').split(/[\\/]/).pop() || ''; }

  // Body clips only: has a session short, not a J clip, not T-/H-
  // ephemeral, not footer / notification / Codex-status chatter.
  function isEligible(name) {
    if (!AUDIO_RE.test(name)) return false;
    if (clipPaths.isRecapClip(name)) return false;
    if (clipPaths.isClipFile(name)) return false;
    if (clipPaths.isEphemeralClip(name)) return false;
    if (STATUS_CLIP_RE.test(name)) return false;
    return !!clipPaths.extractSessionShort(name);
  }

  // ---- index ---------------------------------------------------------

  function readIndex() {
    try {
      const raw = fs.readFileSync(indexPath, 'utf8');
      const parsed = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }

  function writeIndex(index) {
    try {
      fs.mkdirSync(recapDir, { recursive: true });
      const tmp = `${indexPath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(index) + '\n', 'utf8');
      fs.renameSync(tmp, indexPath);
      return true;
    } catch (e) {
      diag(`recap: index write failed: ${e && e.message}`);
      return false;
    }
  }

  function updateIndex(name, patch) {
    const index = readIndex();
    const prev = index[name] || {};
    const next = { ...prev };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null) continue;
      // Never overwrite a measured duration with a missing one.
      if (k === 'durationSec' && !(Number.isFinite(v) && v > 0)) continue;
      next[k] = v;
    }
    index[name] = next;
    writeIndex(index);
    return next;
  }

  // ---- archive / unlink ----------------------------------------------

  // Remove `filePath` from the queue. Body clips are moved into the
  // archive (when the feature is on); everything else is unlinked.
  // Returns { action: 'archived'|'unlinked'|'missing', staged, name } or
  // throws on a genuine fs failure so the IPC caller can report false and
  // the renderer's retry ladder can try again (Windows AV / handle locks).
  function archiveOrUnlink(filePath, { reason = 'manual', durationSec = null, played = null } = {}) {
    const name = baseName(filePath);
    const staged = clipPaths.isRecapClip(name);
    const wasPlayed = typeof played === 'boolean' ? played : /^played/.test(String(reason));
    if (staged) {
      // A replayed copy: the archive already has the original. Record the
      // measured duration against the original and drop the copy.
      const original = clipPaths.recapOriginalName(name);
      if (original && Number.isFinite(durationSec) && durationSec > 0 && isEnabled()) {
        try { updateIndex(original, { durationSec }); } catch {}
      }
      return { action: unlinkIfPresent(filePath), staged: true, name };
    }
    if (!isEnabled() || !isEligible(name)) {
      return { action: unlinkIfPresent(filePath), staged: false, name };
    }
    const dest = path.join(recapDir, name);
    if (!ARCHIVE_REASONS.has(String(reason || ''))) {
      // Explicit user delete: gone from the queue AND from the archive.
      const action = unlinkIfPresent(filePath);
      if (fs.existsSync(dest)) {
        try { fs.unlinkSync(dest); } catch {}
        const index = readIndex();
        if (index[name]) { delete index[name]; writeIndex(index); }
      }
      return { action, staged: false, name };
    }
    try { fs.mkdirSync(recapDir, { recursive: true }); } catch {}
    if (fs.existsSync(dest)) {
      // Already archived (e.g. pruner raced the renderer). Keep the
      // archived original, discard the queue copy.
      const action = unlinkIfPresent(filePath);
      updateIndex(name, { durationSec, played: wasPlayed || undefined });
      return { action, staged: false, name };
    }
    try {
      fs.renameSync(filePath, dest);
    } catch (e) {
      // ENOENT is ambiguous: the SOURCE may be gone (fine — already
      // deleted), or the recap dir may be unusable (mkdir failed above,
      // or `recap` is a stray file). Only report 'missing' when the clip
      // really is gone; otherwise honour the delete with a plain unlink
      // so the renderer never sees "true" while the file is still on disk
      // (it would reload and replay on the next scan). Locks (EBUSY /
      // EPERM) still throw so the renderer's retry ladder runs.
      if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) {
        if (!fs.existsSync(filePath)) return { action: 'missing', staged: false, name };
        diag(`recap: archive dir unusable (${e.code}) — deleting ${name} instead`);
        return { action: unlinkIfPresent(filePath), staged: false, name, degraded: true };
      }
      if (e && e.code === 'EXDEV') {
        fs.copyFileSync(filePath, dest);
        fs.unlinkSync(filePath);
      } else {
        throw e;
      }
    }
    updateIndex(name, { durationSec, archivedAt: now(), reason: String(reason || 'manual'), played: wasPlayed });
    if (++archivedSincePrune >= INLINE_PRUNE_EVERY) {
      archivedSincePrune = 0;
      try { prune(); } catch {}
    }
    return { action: 'archived', staged: false, name };
  }

  function unlinkIfPresent(filePath) {
    try {
      fs.unlinkSync(filePath);
      return 'unlinked';
    } catch (e) {
      if (e && e.code === 'ENOENT') return 'missing';
      throw e;
    }
  }

  // ---- listing -------------------------------------------------------

  function durationFor(name, fullPath, size, index) {
    const entry = index[name];
    if (entry && Number.isFinite(entry.durationSec) && entry.durationSec > 0) {
      return { durationSec: entry.durationSec, estimated: false };
    }
    let est = null;
    try {
      const fd = fs.openSync(fullPath, 'r');
      try {
        const head = Buffer.alloc(4096);
        const n = fs.readSync(fd, head, 0, head.length, 0);
        est = estimateDurationFromBytes(head.subarray(0, n), size, name);
      } finally { fs.closeSync(fd); }
    } catch {}
    if (!Number.isFinite(est) || est <= 0) est = size / FALLBACK_BYTES_PER_SEC;
    return { durationSec: est, estimated: true };
  }

  function listArchived(short = 'all') {
    const out = [];
    let names;
    try { names = fs.readdirSync(recapDir); } catch { return out; }
    const index = readIndex();
    for (const name of names) {
      if (!AUDIO_RE.test(name) || !isEligible(name)) continue;
      const clipShort = clipPaths.extractSessionShort(name);
      if (short !== 'all' && clipShort !== short) continue;
      const full = path.join(recapDir, name);
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      const d = durationFor(name, full, stat.size, index);
      out.push({
        name,
        path: full,
        short: clipShort,
        mtime: stat.mtimeMs,
        size: stat.size,
        durationSec: d.durationSec,
        estimated: d.estimated,
        played: !!(index[name] && index[name].played),
        live: false,
      });
    }
    out.sort((a, b) => a.mtime - b.mtime);
    return out;
  }

  // Live queue clips for a session (not archived yet — unplayed, or
  // played with auto-prune off). `livePaths` is the uncapped on-disk list
  // main already computes for the tab badges.
  function listLive(short, livePaths) {
    const out = [];
    const index = readIndex();
    for (const p of livePaths || []) {
      const name = baseName(p);
      if (!isEligible(name)) continue;
      const clipShort = clipPaths.extractSessionShort(name);
      if (short !== 'all' && clipShort !== short) continue;
      let stat;
      try { stat = fs.statSync(p); } catch { continue; }
      const d = durationFor(name, p, stat.size, index);
      out.push({
        name, path: p, short: clipShort, mtime: stat.mtimeMs, size: stat.size,
        durationSec: d.durationSec, estimated: d.estimated, played: false, live: true,
      });
    }
    return out;
  }

  // Archive + live, deduped by original name (a live copy wins so we
  // never stage a duplicate of a clip that is still in the queue),
  // chronological order.
  function listAll(short, livePaths) {
    const byName = new Map();
    for (const e of listArchived(short)) byName.set(e.name, e);
    for (const e of listLive(short, livePaths)) byName.set(e.name, e);
    return [...byName.values()].sort((a, b) => a.mtime - b.mtime);
  }

  function summary(short, livePaths) {
    const all = listAll(short, livePaths);
    let totalSec = 0;
    for (const e of all) totalSec += e.durationSec;
    return {
      short,
      count: all.length,
      totalSec,
      oldestMtime: all.length ? all[0].mtime : null,
      newestMtime: all.length ? all[all.length - 1].mtime : null,
      keepMin: Math.round(keepMs() / 60000),
      enabled: isEnabled(),
      maxClips: maxRecapClips,
    };
  }

  // Pick the clips for a recap: newest-first until `value` clips (mode
  // 'count') or until the cumulative duration reaches `value` minutes
  // (mode 'minutes' — the clip that crosses the line is included so the
  // user never gets less than they asked for). Always at least one clip
  // when anything is available; never more than maxRecapClips. Returned
  // in chronological (playback) order.
  function select(short, { mode = 'count', value = 10, allow = null } = {}, livePaths) {
    let all = listAll(short, livePaths);
    if (typeof allow === 'function') all = all.filter((e) => allow(e.short));
    if (all.length === 0) return [];
    const newestFirst = all.slice().reverse();
    const picked = [];
    if (mode === 'minutes') {
      const targetSec = Math.max(1, Number(value) || 1) * 60;
      let acc = 0;
      for (const e of newestFirst) {
        if (picked.length >= maxRecapClips) break;
        picked.push(e);
        acc += e.durationSec;
        if (acc >= targetSec) break;
      }
    } else {
      const n = Math.max(1, Math.min(maxRecapClips, Math.floor(Number(value) || 1)));
      for (const e of newestFirst) {
        if (picked.length >= n) break;
        picked.push(e);
      }
    }
    return picked.reverse();
  }

  // ---- staging -------------------------------------------------------

  // Copy archived clips back into the queue under staged names. Entries
  // that are already live are passed through untouched. mtimes are set
  // to a monotonic now-based sequence (chronological order preserved,
  // 2 ms apart) so the staged copies are the newest files on disk.
  function stage(entries) {
    const staged = [];
    let t = now();
    for (const e of entries || []) {
      if (!e || !e.name) continue;
      if (e.live) {
        staged.push({ path: e.path, name: e.name, mtime: e.mtime, durationSec: e.durationSec, live: true, originalName: e.name });
        continue;
      }
      // Defence in depth: only stage names that are plain basenames of
      // eligible archived clips — never anything with a path separator.
      const name = baseName(e.name);
      if (name !== e.name || !isEligible(name)) continue;
      const src = path.join(recapDir, name);
      if (!fs.existsSync(src)) continue;
      const stagedName = `${formatQueueTimestamp(t)}-R-${name}`;
      const dest = path.join(queueDir, stagedName);
      let onDiskMtime;
      try {
        // Write a fresh file rather than copyFileSync: on Windows a copy
        // keeps the source's old mtime, and the queue watcher orders by
        // mtime — a stale value would put the replay at the far left or
        // outside the MAX_FILES window. Then stamp the exact monotonic
        // value and VERIFY it took; a copy with the wrong mtime is worse
        // than no copy, so drop it.
        fs.writeFileSync(dest, fs.readFileSync(src));
        const sec = t / 1000;
        try { fs.utimesSync(dest, sec, sec); } catch {}
        onDiskMtime = fs.statSync(dest).mtimeMs;
        if (!(onDiskMtime >= t - 5)) {
          try { fs.unlinkSync(dest); } catch {}
          diag(`recap: stage mtime verify failed for ${name} (${onDiskMtime} < ${t})`);
          continue;
        }
      } catch (err) {
        diag(`recap: stage failed for ${name}: ${err && err.message}`);
        continue;
      }
      staged.push({ path: dest, name: stagedName, mtime: onDiskMtime, durationSec: e.durationSec, live: false, originalName: name });
      t += 2;
    }
    return staged;
  }

  // ---- housekeeping --------------------------------------------------

  // Remove archived clips past the keep window, enforce the hard caps,
  // and drop index entries whose file is gone. Returns counts.
  function prune() {
    const result = { removed: 0, kept: 0 };
    let names;
    try { names = fs.readdirSync(recapDir); } catch { return result; }
    const keep = keepMs();
    const t = now();
    const survivors = [];
    for (const name of names) {
      if (!AUDIO_RE.test(name)) continue;
      const full = path.join(recapDir, name);
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (keep <= 0 || (t - stat.mtimeMs) > keep || !isEligible(name)) {
        try { fs.unlinkSync(full); result.removed++; } catch {}
        continue;
      }
      survivors.push({ name, full, mtime: stat.mtimeMs, size: stat.size, short: clipPaths.extractSessionShort(name) });
    }
    // Per-session cap, then total count + byte caps — oldest go first.
    survivors.sort((a, b) => b.mtime - a.mtime);
    const perSession = new Map();
    const keepSet = new Set();
    let total = 0;
    let bytes = 0;
    for (const s of survivors) {
      const n = (perSession.get(s.short) || 0) + 1;
      if (n > maxPerSession || total >= maxTotal || bytes + s.size > maxTotalBytes) {
        try { fs.unlinkSync(s.full); result.removed++; } catch {}
        continue;
      }
      // Only clips actually kept consume a per-session slot — a big clip
      // evicted by the byte cap must not push a smaller one that fits out.
      perSession.set(s.short, n);
      total++;
      bytes += s.size;
      keepSet.add(s.name);
    }
    archivedSincePrune = 0;
    result.kept = keepSet.size;
    // Self-heal the index.
    const index = readIndex();
    let dirty = false;
    for (const name of Object.keys(index)) {
      if (!keepSet.has(name)) { delete index[name]; dirty = true; }
    }
    if (dirty || (keep <= 0 && Object.keys(index).length === 0)) {
      if (keepSet.size === 0) {
        try { fs.unlinkSync(indexPath); } catch {}
      } else {
        writeIndex(index);
      }
    }
    return result;
  }

  // Sessions that have at least one archived clip. Shipped with every
  // queue-updated payload so a session that went quiet (no live clips,
  // last_seen past the tabs' 30-minute window) still gets a tab to recap
  // from — the whole point is catching up on a session you walked away
  // from.
  function listShorts() {
    const shorts = new Set();
    let names;
    try { names = fs.readdirSync(recapDir); } catch { return []; }
    for (const name of names) {
      if (!AUDIO_RE.test(name) || !isEligible(name)) continue;
      const short = clipPaths.extractSessionShort(name);
      if (short) shorts.add(short);
    }
    return [...shorts].sort();
  }

  // remove-session / plugin cleanup: forget a session's archived clips so a
  // later [All] recap cannot resurrect a session the user removed.
  function purgeSession(short) {
    if (!short || !SHORT_RE.test(String(short))) return 0;
    let purged = 0;
    let names;
    try { names = fs.readdirSync(recapDir); } catch { return 0; }
    for (const name of names) {
      if (!AUDIO_RE.test(name) || clipPaths.extractSessionShort(name) !== short) continue;
      try { fs.unlinkSync(path.join(recapDir, name)); purged++; } catch {}
    }
    if (purged > 0) {
      const index = readIndex();
      let dirty = false;
      for (const name of Object.keys(index)) {
        if (clipPaths.extractSessionShort(name) === short) { delete index[name]; dirty = true; }
      }
      if (dirty) writeIndex(index);
    }
    return purged;
  }

  // Boot-time: staged copies left in the queue by a previous run (the
  // toolbar quit mid-recap, or auto-prune was off) are replays, never
  // originals — drop them so the queue only shows real arrivals.
  function cleanStagedCopies() {
    let removed = 0;
    let names;
    try { names = fs.readdirSync(queueDir); } catch { return removed; }
    for (const name of names) {
      if (!clipPaths.isRecapClip(name)) continue;
      try { fs.unlinkSync(path.join(queueDir, name)); removed++; } catch {}
    }
    return removed;
  }

  // Sidecar lookup for the transcript panel: a staged copy reads the
  // ORIGINAL clip's .txt / .original.txt (sidecars never move).
  function sidecarBaseFor(audioPath) {
    const name = baseName(audioPath);
    const original = clipPaths.recapOriginalName(name);
    const effective = original || name;
    const ext = path.extname(effective).toLowerCase();
    if (ext !== '.mp3' && ext !== '.wav') return null;
    return path.join(queueDir, effective.slice(0, -ext.length));
  }

  return {
    recapDir,
    indexPath,
    isEnabled,
    isEligible,
    archiveOrUnlink,
    listArchived,
    listAll,
    summary,
    select,
    stage,
    prune,
    cleanStagedCopies,
    listShorts,
    purgeSession,
    sidecarBaseFor,
    readIndex,
    constants: { MAX_RECAP_CLIPS: maxRecapClips, DEFAULT_KEEP_MS, ARCHIVE_REASONS },
  };
}

module.exports = {
  createRecapArchive,
  estimateDurationFromBytes,
  formatQueueTimestamp,
  RECAP_DIR_NAME,
  MAX_RECAP_CLIPS,
  DEFAULT_KEEP_MS,
};
