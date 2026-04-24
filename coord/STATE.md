# STATE.md — cross-session consciousness

**Last updated:** 2026-04-24 22:50 (TT2 post-compact rehydrate; #1 green-lit to TT1; #8 watcher live)
**Updated by:** TT2

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
- **#1 heartbeat-revert** — TT1 drafting fix on `fix-pass`. TT2 verification rig RED against
  broken code (empirical proof test catches bug). Awaiting fix; Devil's-advocate on deck.
- **#2 tinkering-audio-leak** — TT1 reviewing (head-down in `synth_turn.py`).
- **#4 24h-soak** — TT2 claimed; partial baseline captured (electron ×6 ≈ 620MB, python ×7,
  no ~/.terminal-talk/logs/ dir!, session-colours.json.bak1 only). Full baseline + T+24h re-measure pending.
- **#7 top-level-key-dropped-audit** — TT2 claimed, audit from source complete: 3 of 4
  scalars drop (heartbeat_enabled, selected_tab, tabs_expanded). Fix lands with #1.
- **#8 session-ids-missing-from-toolbar** — queued; Ben live-observation 21:49.

## Findings surfaced this session

- Observability gap: `~/.terminal-talk/logs/` directory does not exist — logs live at
  `~/.terminal-talk/queue/_*.log` (TT1's #6 review confirmed; 5 separate log writers catalogued).
- electron.exe has 6 concurrent processes at ~620MB total — within normal for Chromium multi-
  process, but worth tracking in #4 over 24h.
- **Registry file rewrite churn** (TT2, 2026-04-24 post-compact): `~/.terminal-talk/session-colours.json`
  is being re-written with byte-identical content (mtime bumped, no diff) multiple times per minute
  at idle. Watcher log at `~/.terminal-talk/queue/_registry-watcher.log`. Suggests a save-site fires
  even when nothing changed — feeds into #8 diagnosis + G1 in #6 review.

## Blockers — explicit

What TT2 is waiting on (re-checked on any session resume):

| Blocker | What's needed | Who | Unblocks |
|---|---|---|---|
| TT1 draft #1 fix on `fix-pass` | My green-light sent to TT1 INBOX 22:45 — awaiting commit | TT1 | #1, #3, #7 all close together |
| Ben's #2 tense answer | "Tinkering" (present) vs "Tinkered for Xs" (past) — decides H1 vs H2 | Ben | #2 fix path |
| Ben's next wipe episode | Watcher at `scripts/watch-registry.cjs` is running; capture happens automatically | Ben (passive — normal usage) | #8 empirical root-cause |

What TT2 can do autonomously while blocked (non-idle work):
- Read TT1's fix-pass reviews as they land (#6 done, #5 pending)
- Continue #4 24h-soak (T+24h ~2026-04-25T21:44)
- Write additional diagnostic probes that don't need live Ben interaction

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
| 2026-04-24 21:49      | TT2 | 42%  | #7 audit done; #8 opened (toolbar session-IDs missing); partial #4 baseline |
| 2026-04-24 21:53      | TT2 | ~49% | HANDOVER written to `coord/HANDOVER-2026-04-24T21-53.md`; pre-compact save complete |
| 2026-04-24 22:45      | TT2 | post-compact | Rehydrated; #1 GREEN-LIT to TT1 INBOX; autonomous pivot per Ben's perpetual-motion push |
| 2026-04-24 22:50      | TT2 | post-compact | #8 registry-watcher spawned in background; already capturing idle-churn |
| 2026-04-24 23:25      | TT1 | post-compact | #1/#3/#7 combined fix drafted on `fix-pass` @ `0647460`; 4 new round-trip tests red→green; 777/777 full suite; TT2 INBOX pinged for Devil's-advocate |
| 2026-04-24 23:32      | TT2 | post-compact | Devil's-advocate PASS on #1 (3 Q's + 3 latent risks); cleared to merge; #11 settings-panel audit opened + PLAN-SYSTEMATIC-COVERAGE drafted |
| 2026-04-24 23:40      | TT1 | post-compact | Merged `fix-pass` → `main` @ `ad973d2`; #1/#3/#7 landed; live-install verification pending; claiming #6 Batch 1 (G1+G2+G3) as next fix-drafted slot |
| 2026-04-24 23:55      | TT1 | post-compact | #6 Batch 1 (G1+G2+G3) drafted on `fix-pass` @ `87c73c1`; 8 new REGISTRY LOGGING tests; 785/785 full suite; TT2 INBOX pinged for Devil's-advocate |
| 2026-04-25 00:10      | TT1 | post-compact | #11 reviewer pass on `fix-pass` @ `0f14c4f`: F1/F3/F4 confirmed; F2 undercount (7 sub-keys not 6); F5/F6/F7 opened; awaiting Ben F5 resolution + TT2 Batch 1 pass |
| 2026-04-25 00:55      | TT1 | post-compact | Batch 1 MERGED to main @ `8bc8a28` (TT2 DA PASS 00:35); #11 fix drafted on `fix-pass` @ `949296f` closing F1+F2+F3+F5+F6; 789/789; TT2 INBOX pinged |
| 2026-04-25 01:05      | TT1 | post-compact | TT2 DA'ing #11; #15 reviewer pre-read committed @ `47ac8b7` (4 corrections + 2 extra tests for eventual fix draft); queued behind #11 merge |
| 2026-04-25 01:35      | TT1 | post-compact | #11 MERGED to main @ `1df7245` (TT2 DA PASS 01:50); #15 heartbeat-voice-respect-provider drafted on `fix-pass` @ `239a505`; 795/795 (+5 new); TT2 INBOX pinged for DA |

## Pointers for a fresh session

- Read `coord/README.md` for the protocol.
- Read `coord/QUEUE.md` for the work list.
- Read `coord/INDEX.md` for module/feature/invariant/bug navigation.
- Read the latest `coord/HANDOVER-*.md` if compaction happened.
- Auto-memory at `~/.claude/projects/C--Users-Ben-Desktop-terminal-talk/memory/` has the pattern
  library — start with `feedback-multi-terminal-fix-loop.md`.
