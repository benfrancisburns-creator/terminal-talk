# S5 — Coverage baseline + unit-test gap fill

**Date:** 2026-04-20
**Tool:** c8 10.1.2
**Scope:** `app/lib/*.js` + `scripts/*.cjs` (the `--logic-only` subset that runs without Electron/DOM)

## Before

Running `npm run test:coverage` at the start of S5:

```
All files                  |   74.44 |    64.09 |   88.13 |   74.44
 app/lib                   |   97.74 |    77.21 |   91.66 |   97.74
 scripts                   |   69.15 |    60.18 |   85.71 |   69.15
```

`app/lib/` was already in good shape. Gaps concentrated in **branch coverage** — defensive fallbacks, error paths, and contention paths that happy-path tests don't exercise.

### Pre-fix gap list

| Module | Line | Branch | Uncovered |
|---|---|---|---|
| `registry-lock.js` | 91% | **53%** | Contention path — busyWait + ACQUIRE_TIMEOUT_MS fall-through |
| `api-key-store.js` | 96% | 73% | Decrypt-fail + secret-parse-fail logger paths |
| `palette-alloc.js` | 100% | 71% | null/undefined assignments, missing last_seen tiebreak, null newShort |
| `concurrency.js` | 100% | 75% | Non-array items, 0/NaN limit, non-Error throw |
| `session-stale.js` | 100% | 76% | Non-object assignments, non-Set liveShorts, malformed entries |
| `config-validate.js` | 97% | 83% | String-too-long branch |
| `text.js` | 99% | 79% | `image_alt: false` strip-entirely branch |

### What's deliberately NOT measured

`app/main.js` (1,802 lines) and `app/renderer.js` (1,681 lines) need the Electron + DOM harness to run, so c8 on the `--logic-only` subset excludes them. They're covered by the 13 Playwright E2E tests instead (S6's surface).

The right path to closing those gaps is **extracting testable pure logic into `app/lib/*`** rather than trying to jsdom-ify renderer.js. That's a v0.4 big-file-refactor follow-up, not an S5 unit-test exercise.

## Fixes applied — 7 new describe blocks, 18 new tests

Added a dedicated `S5 — coverage-gap fills` section at the bottom of `scripts/run-tests.cjs` with one describe per gap:

1. **`S5 — registry-lock contention`** (2 tests) — seeds a fresh lock file directly and attempts acquire, verifying both the timeout path (returns `false` after ~500 ms) and the graceful-degrade path (`withRegistryLock` still runs the inner fn when acquire failed).
2. **`S5 — api-key-store corruption paths`** (2 tests) — injects a fake safeStorage whose `decryptString` throws, and a corrupt JSON secrets file. Verifies logger lines + fallthrough semantics.
3. **`S5 — palette-alloc defensive branches`** (5 tests) — `null`/`undefined` assignments default to `{}`, LRU tiebreak uses shortId ascending when `last_seen` equal, missing `last_seen` coerces to 0 for comparison, hash-collision path when all slots pinned, `null` newShort handled.
4. **`S5 — concurrency mapLimit defensive branches`** (3 tests) — non-array items coerce to `[]`, `limit=0` or NaN coerce to 1, non-Error throws get wrapped in `new Error(String(x))`.
5. **`S5 — session-stale defensive branches`** (3 tests) — non-object assignments return `[]`, non-Set liveShorts is coerced via `new Set(x)`, malformed entries are skipped without crashing.
6. **`S5 — config-validate string maxLen`** (1 test) — oversized `voices.edge_response` (500 chars vs maxLen 80) is rejected with `string too long` violation.
7. **`S5 — text.js image_alt=false strips entire image markdown`** (2 tests) — documents both branches of the `image_alt` toggle.

## After

```
All files                  |   76.26 |    68.34 |   89.06 |   76.26
 app/lib                   |     100 |    88.76 |   95.83 |     100
 scripts                   |    71.3 |    62.04 |      85 |    71.3
```

**Every module in `app/lib/` is now at 100% line coverage.** Branch coverage jumped from 77.21% → 88.76% (~+12 pp). Overall line coverage 74.44% → 76.26%.

## CI floor set

`.github/workflows/test.yml` — the `coverage` job is promoted from log-only to **blocking** with c8's `--check-coverage` flag against the new baseline:

```
c8 --check-coverage \
   --lines 76 --branches 68 --functions 89 \
   --reporter=text --reporter=lcov \
   node scripts/run-tests.cjs --logic-only
```

Ratchet-only-up convention: each future commit must maintain or improve these numbers. Drift downward fails CI. When coverage improves meaningfully, we bump the thresholds in the same PR so they lock in the gain.

## Out of scope (noted for follow-up)

- **`scripts/run-tests.cjs`** at 71% is the test harness itself. Its own uncovered lines are error paths inside individual `it()` blocks that get triggered only when other tests fail. Self-referential; not worth closing.
- **`scripts/sync-app-mirror.cjs`** at 74% is only run by `npm run sync-app-mirror`, not by the tests. Can be unit-tested but each test would be mostly filesystem setup. Low ROI.
- **`app/main.js` + `app/renderer.js`** — 3.5k lines with zero unit coverage. Extracting testable chunks to `lib/` is the right path, and it's a S5 follow-up. Big-file refactor worth its own session.
