# ACTIVE #4 — 24h resource-soak

- **Status:** in-test (baseline-capture phase)
- **Owner:** TT2 (empirical-role-only; no reviewer needed per perpetual-motion rule)
- **Axes in play:** 5 (resource behaviour over time)
- **Claimed:** 2026-04-24T21:44
- **Nature:** passive observation over ~24h — baseline now, re-measure at T+24h.

## Goal

Does the toolbar + its Python synth fleet + its PS sidecars stay well-behaved over a full user
workday? Looking for slow leaks, unbounded growth, orphan processes, stale files.

## Measurements

| # | Metric | Source | Baseline (T+0, 22:54) | T+24h | Delta |
|---|---|---|---|---|---|
| M1 | Electron RSS | `Get-Process terminal-talk` | **0 MB (app not running)** | — | — |
| M2 | Electron handle count | `Get-Process terminal-talk` | **0 (app not running)** | — | — |
| M3 | Python processes | `Get-Process python` | **14 procs, 120.3 MB RSS sum, 1349 handles** | — | — |
| M4a | `_toolbar.log` | du -b | 497,788 B | — | — |
| M4b | `_hook.log` | du -b | 260,223 B | — | — |
| M4c | `_voice.log` | du -b | 561,088 B | — | — |
| M4d | `_watchdog.log` | du -b | 21,674 B | — | — |
| M4e | `_helper.log` | du -b | 953 B | — | — |
| M4f | `_registry-watcher.log` | du -b | 2,485 B (new, mine) | — | — |
| M5 | MP3s in queue tree | `find queue -name '*.mp3'` | 34 | — | — |
| M6 | registry integrity | parse + count | 2 entries (both pinned, both `label=""` — live #8 wipe) | — | — |
| M7 | `session-colours.json.invalid-*` | count (should be 0) | 0 ✓ | — | — |
| M8 | stuck .lock files | `find ~/.terminal-talk -name '*.lock'` | 1 expected (sessions/*-sync.lock for this claude instance) | — | — |

## Baseline capture — [tt2 · 2026-04-24T22:54:00+01:00]

Captured after resume + compact. Key observations:

- **Toolbar is NOT currently running** (electron count=0). Last `_toolbar.log` entry at
  21:35:22Z: `update-config IN: {"heartbeat_enabled":false}` → `OK: saved=true` (the dishonest
  log TT1 flagged in #6 G2 — the partial was silently dropped, but the "OK saved=true" is
  technically truthful about the file-write).
- **14 orphan python processes** — age distribution:
  - 4 procs from **2026-04-22 00:15** (2 days 22h old)
  - 1 proc from **2026-04-23 23:08** (24h old)
  - 2 procs from **2026-04-24 20:24** (2.5h old)
  - 7 procs from **2026-04-24 22:35** (19 min old)
  - The 7 oldest have NO parent electron process → orphaned from dead boot sessions. Likely
    edge-tts retry workers or wake-word-listener instances that didn't exit cleanly.
- **`_voice.log` at 561 KB, append-only, unbounded** (per TT1 #6 review). Fastest-growing log.
- **2 registry entries, both pinned, both `label=""`**. Ben's live customization is already
  gone — the #8 wipe happened during or before the last boot (pre 21:35). The wipe isn't
  future-hypothetical; it's already in the file. Watcher will catch the next one.
- **No `.invalid-*` files, no stuck locks** (beyond the one this claude session owns).

## T+10h intermediate measure — [tt2 · 2026-04-25T08:55]

| # | Metric | T+0 | T+10h | Delta |
|---|---|---|---|---|
| M1 | Electron RSS | 0 (off) | 0 (off) | — (Ben not using right now) |
| M3a | Python proc count | 14 | **11** | -3 (some orphans cleaned) |
| M3b | Python RSS sum | 120.3 MB | **192.3 MB** | +72 MB (wake-word now active = openWakeWord 84 MB) |
| M3c | Python handles | 1349 | 1579 | +230 |
| M4a | `_toolbar.log` | 498 KB | 546 KB | +49 KB |
| M4b | `_hook.log` | 260 KB | **608 KB** | +348 KB (Batch 1 + Batch 2 observability) |
| M4c | `_voice.log` | 561 KB | 624 KB | +63 KB |
| M4d | `_watchdog.log` | 21.6 KB | 24.5 KB | +3 KB (slow growth — good) |
| M4f | `_registry-watcher.log` | 2.5 KB | **163 KB** | +160 KB (TT2's idle-churn watcher) |
| M5 | MP3s in queue | 34 | **0** | -34 (clearPlayed or auto-prune cleaned) |

### Intermediate observations

- **Orphan python pattern persists.** 5 procs from 2026-04-22 (3+ days old, ~1 MB each)
  + 1 from 2026-04-23 still around. TT1 claimed #9 (orphan-python-on-toolbar-exit) at
  08:50 — fix shape: hard-kill voiceProc + keyHelper on will-quit + generalise sweep to
  cover key_helper script too. Their fix should drain these orphans.
- **MP3 cleanup working.** Queue has 0 MP3s vs 34 at T+0. Either Ben hit clearPlayed or
  auto-prune (default 20s) cleaned them.
- **Observability cost.** `_hook.log` grew 348 KB and `_registry-watcher.log` grew 160 KB
  in 10h. At this rate, `_hook.log` would reach 1 MB rotation threshold (per #6 design)
  in ~28h. `_registry-watcher.log` has no rotation — needs sampling or rotation if we
  keep the watcher running long-term.
- **No `save-registry skip` lines yet.** `grep skip _hook.log` → 0. The PS lock-fail path
  has not fired since deploy = lock acquisition has been clean. Good empirical signal.
- **No GUARD diag fires either.** `grep GUARD _hook.log` → 0. Confirms TT1's defensive
  guard hasn't needed to restore any user-intent fields = the lock-fail-fall-through wipe
  pattern hasn't recurred since the root-cause fix.

## T+24h re-measure — [tt2 · TBD]

*(at ~2026-04-25T22:54 — capture full deltas; expect orphan-python count to drop to ~0
once TT1's #9 fix lands and Ben restarts; expect _registry-watcher.log to keep growing
unless watcher gets rotation or stops)*

## T+24h re-measure — [tt2 · TBD]

*(to follow at ~2026-04-25T21:44)*

## Observations / anomalies

- **Orphan python accumulation pattern** — 7 processes from at least 3 prior boots still alive.
  When electron exits, it does not kill its python children. These aren't leaking RSS (0.2–2.1
  MB each for the old ones) but they are handles + PIDs. Over a long soak this could accumulate.
- **registry idle-churn** (from watcher) — the session-colours.json file was rewritten with
  byte-identical content twice within 7 seconds of my watcher starting. A save-site fires on
  state-change that produces no delta. Not strictly a leak but it's wasted IO and expands the
  window for delete-then-recreate races.

## Follow-ups surfaced

- **Candidate QUEUE item #9 — orphan-python-on-toolbar-exit.** Either track under #5
  (error-recovery) or open as its own item. Repro: launch toolbar, note python PIDs, quit
  toolbar, check PIDs — expect all to exit; observe many still alive.
- **Candidate QUEUE item #10 — `_voice.log` unbounded growth.** Rotation policy needed (same
  pattern as `_hook.log` > 1MB rotates to `.1`). 561 KB in 2 days means ~10 MB/month at current
  rate; fine for now but no rotation means eventual `C:` disk pressure.

## Close-out checklist

- [ ] Baseline captured at T+0
- [ ] Re-measurement at T+24h
- [ ] Delta table filled
- [ ] Any anomaly → new QUEUE item
- [ ] Move to `DONE/4-24h-soak.md`
- [ ] Update `QUEUE.md` — #4 STATUS=done
