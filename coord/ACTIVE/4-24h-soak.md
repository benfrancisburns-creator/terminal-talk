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

| # | Metric | Source | Baseline (T+0) | T+24h | Delta |
|---|---|---|---|---|---|
| M1 | Electron RSS | `Get-Process terminal-talk` Mem(MB) | *(tbd)* | — | — |
| M2 | Electron handle count | `Get-Process terminal-talk` Handles | *(tbd)* | — | — |
| M3 | Python processes (synth + wake-word) | `Get-Process python` count + Mem | *(tbd)* | — | — |
| M4 | Log file sizes | `ls ~/.terminal-talk/logs/` wc -c | *(tbd)* | — | — |
| M5 | Orphan MP3s in queue dir | `ls ~/.terminal-talk/queue/**/*.mp3` count | *(tbd)* | — | — |
| M6 | session-colours.json integrity | JSON parse + key enumeration | *(tbd)* | — | — |
| M7 | session-colours.json.invalid-* files | count (should be 0) | *(tbd)* | — | — |
| M8 | .lock files stuck | `ls ~/.terminal-talk/**/*.lock` (should be 0) | *(tbd)* | — | — |

## Baseline capture — [tt2 · 2026-04-24T21:44:00+01:00]

*(to follow — requires the toolbar to be running live; will grab measurements in the next work
block. Perpetual-motion handoff for now: item is claimed, owner = TT2, no blocker; non-urgent
relative to #1 fix-verify which takes priority when TT1's draft lands.)*

## T+24h re-measure — [tt2 · TBD]

*(to follow at ~2026-04-25T21:44)*

## Observations / anomalies

*(anything that looks off during the soak — captured as it happens)*

## Follow-ups surfaced

*(new QUEUE items opened if the soak exposes anything; kept out of this item's scope)*

## Close-out checklist

- [ ] Baseline captured at T+0
- [ ] Re-measurement at T+24h
- [ ] Delta table filled
- [ ] Any anomaly → new QUEUE item
- [ ] Move to `DONE/4-24h-soak.md`
- [ ] Update `QUEUE.md` — #4 STATUS=done
