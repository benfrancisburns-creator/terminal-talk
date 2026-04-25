// v0.3.3 — multi-writer guard for session-colours.json.
//
// Background: v0.3.2 shipped with `saveAssignments` using atomic
// temp+rename, which prevents torn reads but does NOT prevent two
// writers overwriting each other. This caused a real leak during
// development: the test harness seeded a fixture short (cafebeef)
// into the real registry, a live Electron's `saveAssignments` fired
// between the seed-write and synth_turn.py reading it, the synth
// fell back to muted=false, and an MP3 got synthesised + played.
//
// v0.3.3 Fix 1 (TT_HOME env) made the test stop writing to the real
// registry, which eliminates the specific leak. This file adds belt-
// and-brace defence: any future concurrent writer (second Electron
// instance, PS hook direct write, future tool) will serialise via a
// sentinel file.
//
// Design choices:
//   - O_EXCL create (Node's 'wx' flag) is the single portable primitive
//     that gives us atomic "acquire or fail". No native flock binding.
//   - If the lock is older than LOCK_STALE_MS, we steal it rather than
//     waiting. Protects against crashed holders that never release.
//   - If acquire times out after ACQUIRE_TIMEOUT_MS we fall through
//     and proceed unlocked. Philosophy: a stuck lock shouldn't freeze
//     the toolbar. The worst case (un-guarded concurrent write) is
//     exactly what we had before this lock.
//   - Retry polls without `setTimeout` so callers can stay synchronous.
//     Lock windows are measured in tens of ms, not seconds, so a tight
//     loop with micro-waits is fine.

const fs = require('node:fs');

const LOCK_STALE_MS = 3000;        // lock older than this is considered abandoned
const ACQUIRE_TIMEOUT_MS = 500;    // give up waiting and proceed unlocked after
const POLL_BACKOFF_MS = 15;        // wait between retries

function busyWait(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin — callers are sync */ }
}

function acquire(lockPath) {
  const start = Date.now();
  while (Date.now() - start < ACQUIRE_TIMEOUT_MS) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      try { fs.writeSync(fd, String(process.pid)); } catch {}
      try { fs.closeSync(fd); } catch {}
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          try { fs.unlinkSync(lockPath); } catch {}
          continue;
        }
      } catch {}
      busyWait(POLL_BACKOFF_MS);
    }
  }
  return false;
}

function release(lockPath) {
  try { fs.unlinkSync(lockPath); } catch {}
}

// fn is called with the boolean `held`. Existing zero-arg callbacks
// (`() => 42`) keep working — JavaScript ignores extra arguments. Callers
// that care about lock-fail vs lock-held branch on `held`. #26 — prior
// to this change, fn ran unconditionally and any caller that did
// Read-Update-Save races a concurrent writer (the same wipe class TT1
// closed on PS at 5b7354d for #8). Now caller can detect lock-timeout
// and skip the write rather than clobber stale data.
function withRegistryLock(registryPath, fn) {
  const lockPath = registryPath + '.lock';
  const held = acquire(lockPath);
  try {
    return fn(held);
  } finally {
    if (held) release(lockPath);
  }
}

module.exports = { withRegistryLock, _internals: { acquire, release, LOCK_STALE_MS, ACQUIRE_TIMEOUT_MS, POLL_BACKOFF_MS } };
