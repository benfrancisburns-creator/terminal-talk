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

## T+24h re-measure — [tt2 · TBD]

*(at ~2026-04-25T22:54 — or sooner if toolbar gets re-launched and drifts visibly)*

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
