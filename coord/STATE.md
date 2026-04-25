# STATE.md — cross-session consciousness

**Last updated:** 2026-04-25 03:45 (TT2 shipped D1+D2+D3 parity fixes; DA'd #15 + #8 defensive)
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

## Blockers — explicit (as of 2026-04-25 03:45)

| Blocker | What's needed | Who | Unblocks |
|---|---|---|---|
| TT1 to merge #15 + #8 defensive | TT2 DA PASS sent 03:15 + 03:45 — awaiting their merge action | TT1 | Frees fix-drafted slot; #15 closes voice-routing; #8 defensive masks wipe until root cause pinned |
| TT1 to claim #16 next | Fix spec staged in ACTIVE/16 | TT1 | Closes speakClipboard provider mismatch |
| TT1 to claim #24 + #25 | New items from Ben's B-2 + B-4 decisions | TT1 | Tool_calls global UI + OpenAI collapse default |

TT2 has NO blockers — self-directing:
- D4 emphasis regex audit (Surface J remaining divergence)
- Path A race tightening for heartbeat (ACTIVE_FRESH_MS extension)
- Verify #8 root cause when Batch 1 observability + GUARD diag captures the next wipe
- Re-measure #4 24h-soak at ~2026-04-25T22:54

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
| 2026-04-25 01:50      | TT2 | post-compact | #11 DA PASS; F5 resolved by Ben (remove edge_notification); ben.md INBOX created for decisions; #8 wipe-source trace → Path 3 (set-session-label empty) primary candidate |
| 2026-04-25 02:15      | TT1 | escalation   | Ben reported another #8 wipe 00:05; bak1 (23:45) → current diff = labels + pinned + speech_includes lost, PIDs changed (delete-then-recreate). Batch 1 logging + #8 defensive guard DEPLOYED to live install, toolbar restarted, watcher respawned. Guard commit on `fix-pass` @ `55366e5`; 802/802 (+7 new). Guard is belt-and-braces — masks user-visible damage while root cause still open. |
| 2026-04-25 02:30      | TT2 | post-compact | K-1 race fix applied (@ `1967be8` main): openai-invalid watcher consumes flag before clear. 5 Ben decisions (B-1..B-5) all resolved. Surface B heartbeat state-machine verified clean |
| 2026-04-25 02:45      | TT2 | post-compact | #19 JS↔Python sanitizer parity audit end-to-end (B-5). 3 divergences found: D1 (material, looksLikeCode counting), D2 (URL www.X), D3 (heading regex). Fix shapes drafted |
| 2026-04-25 02:50      | TT1 | #8 ROOT      | SMOKING GUN found in `_hook.log` after Ben re-labelled: repeated `save-registry ok from=statusline keys=1` where should be 2. Lock-fail-unlocked-save race identified. Fix on `fix-pass` @ `5b7354d`: statusline + 2 hooks skip write on lock fail; guard extended with Mode 1 (missing-entry restoration) for belt+braces. 806/806 (+4 new). Deployed + toolbar restarted. **#8 root cause closed.** |
| 2026-04-25 03:15      | TT2 | post-compact | #15 DA PASS @ `239a505`; D1 parity fix shipped @ `439d8ea` main (looksLikeCode counts ALL matches per pattern, matches Python) |
| 2026-04-25 03:45      | TT2 | post-compact | D2+D3 parity fixes shipped @ `f9b098c` main. #8 defensive guard DA PASS @ `55366e5` (user-intent restoration on touch-path writes). 830 tests green |
| 2026-04-25 04:05      | TT2 | post-compact | #19 D4 (emphasis) parity fix shipped @ `fd44c4a` main. All 4 #19 divergences now closed. 831 green |
| 2026-04-25 04:10      | TT1 | post-compact | Merged `fix-pass` → `main` including #15 + #8 defensive + #8 root fix (`5b7354d`). Fix-drafted slot cleared. Claiming #16 speakClipboard-respect-provider next per TT2 sequencing |
| 2026-04-25 04:30      | TT1 | post-compact | #8 PID-migration exclusion @ `df93fab` (PS SESSION-IDENTITY tests fixed); voice-dispatch.js + voice-command-recognize.ps1 + updated wake-word-listener.py brought into git. Merged `fix-pass` → `main` |
| 2026-04-25 04:40      | TT1 | post-compact | #16 speakClipboard-respect-provider drafted + merged @ `8b8b08c`. 853/853 (+5). Live install + toolbar restarted. Labels survive. Fix-drafted slot empty. Claiming #24 tool_calls-global-checkbox (Ben B-2) next |

## Pointers for a fresh session

- Read `coord/README.md` for the protocol.
- Read `coord/QUEUE.md` for the work list.
- Read `coord/INDEX.md` for module/feature/invariant/bug navigation.
- Read the latest `coord/HANDOVER-*.md` if compaction happened.
- Auto-memory at `~/.claude/projects/C--Users-Ben-Desktop-terminal-talk/memory/` has the pattern
  library — start with `feedback-multi-terminal-fix-loop.md`.
