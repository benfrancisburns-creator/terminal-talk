# STATE.md — cross-session consciousness

**Last updated:** 2026-04-24 21:42 (Tester verified #1 bugs; TT1 drafting fix; TT1 claiming #2)
**Updated by:** TT2 (merged TT1's perpetual-motion addition)

The one file any fresh session reads FIRST to pick up where the team is. Keep it under 200 lines.
Chatter goes in ACTIVE/ACTIVE files; this file is summaries + pointers.

---

## Current mission

**Robustness sweep on v0.5.0.** No new features. Every fix ships with a new test that would have
caught the original bug. Every commit that touches state passes a blast-radius check (see
`README.md`).

## Operating principle — perpetual motion

**Neither terminal idles.** As soon as one hands off an item via INBOX/branch, it claims the
next queued item. Handoff is async — the blocked terminal picks it up whenever it next checks
INBOX, meanwhile the other terminal is already deep in the next item. Cap 3 open items per
terminal. Full rule in `README.md § Perpetual motion`.

## Team

- **TT2** — tester. Main branch at `C:\Users\Ben\Desktop\terminal-talk\`.
- **TT1** — reviewer. Worktree at `C:\Users\Ben\Desktop\terminal-talk-tt1\` on branch `fix-pass`.

## Queue position

See `QUEUE.md`. Initial seed: 6 items.

**Active now:**
- **#1 heartbeat-revert** — `fix-drafted` by TT1 (pending on `fix-pass`). Both bugs confirmed by
  TT2 empirically (Bug A on live config.json; Bug B via source inspection). Awaiting TT1 fix
  commit + then TT2 Devil's-advocate.
- **#2 tinkering-audio-leak** — claimed by TT1 as reviewer per perpetual-motion rule.
- **#4 24h-soak** — TT2 claiming as empirical-only work (tester-role-only; no reviewer needed).
- **#7 top-level-key-dropped-audit** — queued; opened during #1 review for `selected_tab` +
  `tabs_expanded` adjacent pattern.

## Invariants discovered this run

*(none closed yet — items will add here as they close)*

## Checkpoint log

| Timestamp | Terminal | Context | Note |
|---|---|---|---|
| 2026-04-24 (scaffold) | TT2 | ~38% | coord/ tree created; waiting on TT1 kickoff |
| 2026-04-24 21:21      | TT2 | 37%  | TT1 online, claimed #1, handshake replied |
| 2026-04-24 21:35      | TT1 | ~50% | #1 review committed + pushed; #2 claimed per perpetual-motion |
| 2026-04-24 21:38      | TT2 | 39%  | #1 Bug A + B empirically verified; #7 opened; TT1 cleared to draft |
| 2026-04-24 21:42      | TT2 | 40%  | TT1 perpetual-motion protocol merged to main; claiming #4 (soak) |

## Pointers for a fresh session

- Read `coord/README.md` for the protocol.
- Read `coord/QUEUE.md` for the work list.
- Read `coord/INDEX.md` for module/feature/invariant/bug navigation.
- Read the latest `coord/HANDOVER-*.md` if compaction happened.
- Auto-memory at `~/.claude/projects/C--Users-Ben-Desktop-terminal-talk/memory/` has the pattern
  library — start with `feedback-multi-terminal-fix-loop.md`.
