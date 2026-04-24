# STATE.md — cross-session consciousness

**Last updated:** 2026-04-24 (scaffolded; no items in flight yet)
**Updated by:** TT2

The one file any fresh session reads FIRST to pick up where the team is. Keep it under 200 lines.
Chatter goes in ACTIVE/ACTIVE files; this file is summaries + pointers.

---

## Current mission

**Robustness sweep on v0.5.0.** No new features. Every fix ships with a new test that would have
caught the original bug. Every commit that touches state passes a blast-radius check (see
`README.md`).

## Team

- **TT2** — this terminal, tester. Main branch at `C:\Users\Ben\Desktop\terminal-talk\`.
- **TT1** — other terminal, reviewer. Worktree at `C:\Users\Ben\Desktop\terminal-talk-tt1\` on
  branch `fix-pass` (expected — set up on TT1's first session).

## Queue position

See `QUEUE.md`. Initial seed: 6 items.

**Active now:** #1 heartbeat-revert — TT1 reviewing (ETA 15–25 min for recipe), TT2 on deck for empirical testing.

## Invariants discovered this run

*(none yet — items will add here as they close)*

## Checkpoint log

| Timestamp | Terminal | Context | Note |
|---|---|---|---|
| 2026-04-24 (scaffold) | TT2 | ~38% | coord/ tree created; waiting on TT1 kickoff |
| 2026-04-24 21:21      | TT2 | 37%  | TT1 online, claimed #1, handshake replied, standing down 20 min |

## Pointers for a fresh session

- Read `coord/README.md` for the protocol.
- Read `coord/QUEUE.md` for the work list.
- Read `coord/INDEX.md` for module/feature/invariant/bug navigation.
- Read the latest `coord/HANDOVER-*.md` if compaction happened.
- Auto-memory at `~/.claude/projects/C--Users-Ben-Desktop-terminal-talk/memory/` has the pattern
  library — start with `feedback-multi-terminal-fix-loop.md`.
