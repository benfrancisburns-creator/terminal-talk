# ACTIVE #26 — JS-side `withRegistryLock` falls through on lock-fail

- **Status:** bug-confirmed (same class as PS-side #8 root cause); fix-shape drafted
- **Owner:** TT2 (audit + fix-shape) → awaiting TT1 to claim or DA
- **Axes in play:** 1 (correctness), 3 (concurrency)
- **Opened:** 2026-04-25T08:35 — surfaced by Surface C deeper audit post-#8 closure.

## Bug

`app/lib/registry-lock.js:68-76`:

```js
function withRegistryLock(registryPath, fn) {
  const lockPath = registryPath + '.lock';
  const held = acquire(lockPath);
  try {
    return fn();              // ← runs UNCONDITIONALLY, regardless of `held`
  } finally {
    if (held) release(lockPath);
  }
}
```

Comment at lines 22-25 explicitly acknowledges:

> *"If acquire times out after ACQUIRE_TIMEOUT_MS we fall through and proceed unlocked.
> Philosophy: a stuck lock shouldn't freeze the toolbar. The worst case (un-guarded
> concurrent write) is exactly what we had before this lock."*

This is the **same class of bug** TT1 just fixed on PS-side (`5b7354d`) — and the PS fix
proves the "philosophy" was wrong. Falling through on lock-fail produced the exact #8
wipe: stale read → write clobbers another writer.

## Why the PS fix doesn't cover this

PS fix branches on `$locked` in 3 callers (statusline, speak-on-tool, speak-response) →
skips Save when lock not held. Good for PS writers.

JS-side: `saveAssignments` (the only production caller of `withRegistryLock`) falls
through unconditionally. So:

- IPC fires (e.g. `set-session-label`) → `loadAssignments()` reads current state
- A PS writer (or another JS handler in flight) writes the registry
- `saveAssignments(all, ...)` calls `withRegistryLock` → lock acquire times out →
  falls through → writes JS's stale `all`, clobbering the PS writer's changes
- User-visible: their PS-side change vanishes (label set in toolbar, statusline
  re-fires shortly after, JS write clobbers PS write)

## Mitigation already in place — but partial

The `_guardUserIntent` defensive guard restores user-intent fields from disk when a
non-USER_INTENT_WRITER caller would wipe them. But:

- USER_INTENT_WRITERS callers (`set-session-label`, etc.) are **excluded** from the guard
  by design (they're allowed to clear fields). So a `set-session-label('')` lock-fail
  fall-through on top of a concurrent PS update will still wipe.
- Non-user-intent fields (`last_seen`, `claude_pid`, `index`) are not restored. Lock-fail
  fall-through can clobber these without trace.

So the guard masks ~80% of the symptom but the underlying bug class is still live.

## Fix shape

Mirror TT1's PS-side fix: skip the write when lock not held. Two design options:

### Option A — pass `held` to the callback (back-compat)

```js
function withRegistryLock(registryPath, fn) {
  const lockPath = registryPath + '.lock';
  const held = acquire(lockPath);
  try {
    return fn(held);  // pass held to caller; existing fn() signatures still work
  } finally {
    if (held) release(lockPath);
  }
}
```

Then `saveAssignments`:

```js
return withRegistryLock(COLOURS_REGISTRY, (held) => {
  if (!held) {
    diag(`save-registry skip from=${caller} reason=lock-timeout — next save will retry`);
    return false;
  }
  try { /* existing write */ }
  catch (e) { diag(`saveAssignments fail from=${caller}: ${e.message}`); return false; }
});
```

**Pros:** zero breaking changes; existing tests + callers (`() => 42`) still work; matches
PS-side semantics 1:1.
**Cons:** silent for callers who don't opt in (but only one prod caller).

### Option B — return `{ held, value }`

```js
function withRegistryLock(registryPath, fn) {
  const held = acquire(lockPath);
  try {
    if (!held) return { held: false, value: undefined };
    return { held: true, value: fn() };
  } finally {
    if (held) release(lockPath);
  }
}
```

**Pros:** caller can't accidentally not-branch; explicit shape.
**Cons:** breaks every existing test + the Knip module export check.

**Recommend Option A.** Smaller diff, back-compat, symmetric to PS fix.

## Regression test shape

```js
describe('REGISTRY LOCK SKIP-ON-FAIL (#26)', () => {
  it('saveAssignments emits skip diag when lock cannot be acquired', async () => {
    // Hold the lock externally (simulate PS or other writer).
    // Call saveAssignments; assert:
    //   - return value is false
    //   - diag captured `save-registry skip from=<caller> reason=lock-timeout`
    //   - the registry file was NOT modified
  });
  it('withRegistryLock passes held=false when acquire times out', () => {
    // External lock; call withRegistryLock(path, (held) => held);
    // Assert returned value === false (held was passed).
  });
});
```

## Disposition

This is a real bug, same class as #8's PS root cause. Defensive guard masks user-visible
impact for ~80% of fields but the underlying race remains.

**Suggest TT1 claim** (you have the freshest context from `5b7354d`'s PS fix). I'll DA
when you push.

If TT1 prefers to keep the slot for #25 / Batch 2, ping back via INBOX and I'll ship
this myself — fix shape is small and symmetric. Either way, this should land.
