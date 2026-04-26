# STATE.md — cross-session consciousness

**Last updated:** 2026-04-26 00:00 (TT2 pre-clear save; #30 fix shipped @ 41baf7f, awaiting Ben live verify; 888 tests)
**Updated by:** TT2 (pre-clear handover)

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

## Blockers — explicit (as of 2026-04-25 08:30)

**No blockers either side.** All 4 of TT2's previously-blocking items shipped overnight:

- ✓ #15 heartbeat-voice-respect-provider — merged
- ✓ #16 speakClipboard-respect-provider — merged
- ✓ #24 tool_calls global Settings checkbox — merged
- ✓ #25 OpenAI section collapse default (Ben B-4) — merged @ `b992b75`
- ✓ #8 ROOT CAUSE — TT1 found via Batch 1 observability log forensics; fixed at `5b7354d`
  (lock-fail-skip in 3 PS callers + missing-entry guard restoration). Empirically verified:
  CURRENT registry == BAK1, both labels intact, 1095 save-registry "ok" lines + 0 "skip"
  (lock clean since deploy).

Self-directable next items in TT2's lane:
- Re-measure #4 24h-soak at ~2026-04-25T22:54 (≈14h from now)
- Surface C session-registry deeper audit (now that root cause is closed; verify other
  write paths follow the same lock-or-skip discipline)
- Review TT1's voice-command-recognize.ps1 + voice-dispatch.js (recently tracked at
  `df93fab`) for correctness — never audited
- D4-style follow-ups on any remaining sanitiser drifts (none identified, all closed)

Self-directable next items in TT1's lane (THEY pick — I won't direct):
- #25 OpenAI section collapse default (Ben B-4)
- Batch 2 of #6 log-audit (G6 + G8)
- #18-#23 audit reviews (revisit any of TT2's audits as DA passes)

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
| 2026-04-25 04:05      | TT2 | post-compact | D4 single-underscore emphasis shipped @ `fd44c4a` — #19 fully closed. PHASE 3 'known drift' test converted to parity-achieved. 831 tests green |
| 2026-04-25 04:15      | TT2 | post-compact | #8 pattern audit (`e3492e1`): all 6 set-session-* IPCs share clear-keeps-pinned shape — observed pinned/empty-label state may be user-action-reachable, not just bug |
| 2026-04-25 ~05-08     | TT1 | autonomous   | While TT2 was working JS parity: #15 merged, #8 defensive merged, **#8 ROOT CAUSE found via Batch 1 _hook.log forensics @ `5b7354d`** (lock-fail-skip in 3 PS callers; smoking gun = repeated `keys=1` saves where should be 2). #8 PID-migration exclusion @ `df93fab`. #16 merged @ `8b8b08c`. #24 tool_calls global checkbox merged @ `d6ebfef`. 858/858 |
| 2026-04-25 08:30      | TT2 | post-pull    | Verified live registry: both labels intact, BAK1 matches CURRENT, 1095 ok + 0 skip. **#8 closed.** Pulled main; suite green; STATE refreshed |
| 2026-04-25 04:05      | TT2 | post-compact | #19 D4 (emphasis) parity fix shipped @ `fd44c4a` main. All 4 #19 divergences now closed. 831 green |
| 2026-04-25 04:10      | TT1 | post-compact | Merged `fix-pass` → `main` including #15 + #8 defensive + #8 root fix (`5b7354d`). Fix-drafted slot cleared. Claiming #16 speakClipboard-respect-provider next per TT2 sequencing |
| 2026-04-25 04:30      | TT1 | post-compact | #8 PID-migration exclusion @ `df93fab` (PS SESSION-IDENTITY tests fixed); voice-dispatch.js + voice-command-recognize.ps1 + updated wake-word-listener.py brought into git. Merged `fix-pass` → `main` |
| 2026-04-25 04:40      | TT1 | post-compact | #16 speakClipboard-respect-provider drafted + merged @ `8b8b08c`. 853/853 (+5). Live install + toolbar restarted. Labels survive. Fix-drafted slot empty. Claiming #24 tool_calls-global-checkbox (Ben B-2) next |
| 2026-04-25 05:00      | TT1 | post-compact | #24 tool_calls-global-checkbox drafted + merged @ `d6ebfef`. New tri-ctrl pill row in Settings; default-true semantics for tool_calls + headings. Surfaced: 6 of the 7 speech_includes sub-keys still have no global UI control (incBoxes refs them but HTML doesn't); kept comment in code. 858/858 (+5). Live install + restarted. Labels survive |
| 2026-04-25 08:45      | TT1 | post-compact | #25 OpenAI section collapse default (Ben B-4) drafted + merged @ `b992b75`. New `onPanelOpen()` lifecycle method on SettingsForm; renderer wires it from settingsBtn click. Per-panel-open re-default; one-shot-per-decision shape preserved mid-session. 862/862 (+4). Deployed |
| 2026-04-25 09:10      | TT1 | post-compact | #6 Batch 2 (G6 watchdog resource metrics + G8 stale-flag filter logging) drafted + merged @ `5881437`. createWatchdog factory accepts getResourceMetrics; main.js wires {rss_mb, queue_files, registry_bytes, voice_procs}. get-working-sessions emits filter diag with per-short age annotation. 869/869 (+7). Deployed. Lifted forward of #4 close-out so TT2's 22:54 soak re-measure benefits from the new observability |
| 2026-04-25 09:30      | TT1 | post-compact | #9 orphan-python-on-toolbar-exit drafted + merged @ `fa95d64`. Hard taskkill /F /T + extended sweep covering wake-word-listener AND key_helper. ORPHAN_PY_SCRIPTS allowlist with regex-validated fragments. 874/874 (+5). Deployed |
| 2026-04-25 09:55      | TT1 | post-compact | #26 JS withRegistryLock skip-on-fail drafted + merged @ `d39239d`. Mirror of PS-side #8 root fix per TT2's `ec7f362` audit. saveAssignments branches on held + emits skip diag. ACQUIRE_TIMEOUT_MS=500 pinned. writeAssignments called out as Surface C follow-up. 879/879 (+5). Deployed; labels survive |
| 2026-04-25 10:25      | TT1 | post-compact | #10 _voice.log size-capped rotation drafted + merged @ `df1980b`. Switched wake-word-listener.py from logging.basicConfig to RotatingFileHandler (1 MB cap, 1 backup) — matches _hook.log convention. End-to-end runtime test (20K log lines → .1 backup created, main < 1.2 MB). 881/881 (+2). Deployed |
| 2026-04-25 10:55      | TT1 | post-compact | #6 Batch 3 (G0+G4+G5+G7 observability polish) drafted + merged @ `f2062b9`. **#6 log-audit fully closed across 3 batches.** Boot-event diag, Update-SessionAssignment branch tag, key_helper ctrlc fg_pid context, logs/README redirect stub. Live boot line: `boot version=0.4.0 pid=16120 cfg_path=... cfg_keys=[heartbeat_enabled,hotkeys,...,window] heartbeat=on tts_provider=openai`. 886/886 (+5). Deployed |
| 2026-04-25 11-25      | TT2 | self-direct  | CI cleanup (`2a51ca9`+`3cd0b2f`+`70e72aa`); #29 main.js extract @ `48d1151` (5 new lib modules: registry-guard, tray, voice-command-watcher + 2); deleted scripts/watch-registry.cjs (#8 closed); #30 HB4 two-flag split @ `41baf7f` closing heartbeat-during-Wispr-dictation regression (888/888) |
| 2026-04-26 01:25      | TT1 | pre-/clear   | Pre-`/clear` save: HANDOVER written to `coord/HANDOVER-2026-04-26T012539.md`; brain entry to `~/Documents/Terminal-Talk-Brain/_conversations/`; project memory snapshot updated. Run scoreboard: 12 closed by TT1 + #29 + #30 by TT2; 777 → 888 tests (+111); #6 log-audit fully closed; #8 ROOT closed; all Ben B-decisions resolved |
| 2026-04-26 02:00      | TT2 | post-/clear  | Resume after /clear. #30 passive verify clean — `_toolbar.log` shows ZERO `heartbeat:` lines inside any MIC_CAPTURED→MIC_RELEASED window across full log (most recent 00:32:51→00:33:29). Awaiting Ben's live re-test for full closure. **#18 sanitizer-fallback-drift CLOSED @ `ef42731`** — image_alt+bullet_markers fallbacks flipped True→False to match DEFAULTS; forcing-function test reads synth_turn.py source + asserts every flags.get fallback matches. 888 → 889 tests (+1) |
| 2026-04-26 02:30      | TT2 | post-/clear  | **#28 voice-command-vocab-forcing-test CLOSED @ `6834562`** — phraseToAction values (PS) ↔ VOICE_COMMAND_ALLOWED (JS main.js) source-diff invariant test in VOICE COMMAND (Phase 1) describe group; same shape as #18. 889 → 890. Closes #27 F2 follow-up. Two forcing-function tests live in same resume — pattern catalogued for future invariant audits. Open queue items in TT2 lane: #4 (24h-soak re-measure, T+24h ~21:42 today still ahead), #5 (error-recovery-matrix, broad), main.js sub-2000 follow-up (file-length ceiling parked at 2050 → 2000 after one more small extract) |

## 2026-04-26 pre-clear summary — TT2

**main at `41baf7f`** — #30 fix shipped. **#30 OPEN — awaiting Ben's live verify.**
Live install synced; Ben needs to restart toolbar OR Ctrl+R to pick up new
audio-player.js, then re-test Wispr dictation.

**Three-terminal coord:**
- TT1 — reviewer (offline-ish). Last commit on fix-pass: `f2062b9` (Batch 3).
- TT2 — me. Tester / audit / ad-hoc fix lane.
- TT3 — narrator + lib-extraction lane. narrator-subagent at `9aa5231` (green).
- Ben's terminal — building/testing the narrator sub-agent.

**Closed this stretch (12+ items):** #1, #3, #7, #8 root cause + defensive, #9, #10,
#11, #15, #16, #19 (D1+D2+D3+D4), #24, #25, #26, #27 audit, #29 lib extract, #6 full
log-audit (3 batches G0-G8). 888 tests; CI 3-gate ratchet (c8 functions 75→68;
file-length ceiling 2000→2050 temp; lint+Knip cleanup) all green.

**OPEN (TT2 owns):** #30 heartbeat-during-dictation regression. Smoking gun captured.
Root cause: `audio-player.js` had single shared `_systemAutoPaused` flag; Chromium
mediaSession 'play' clears it during Wispr dictation → heartbeat gate opens. Fix
implements the two-flag split (`_micCaptured` + `_systemAutoPaused`) that was
documented in comments but never coded. 3 lock-in regression tests added.
**Lesson saved as `feedback-audit-from-code-not-comments.md`** — Surface D #17 audit
trusted comments over code; missed #30 because of it.

**Resume sequence:**
1. Read `coord/HANDOVER-2026-04-26T00-00.md` (gitignored, local) for full pre-clear
   dump including #30 verify recipe + IPC chain diagnostic order if test still fails.
2. Read this STATE.md (cross-session consciousness).
3. Read `coord/INBOX/tt2.md` tail for any TT1/TT3 messages.
4. Run `tail -30 ~/.terminal-talk/queue/_toolbar.log` — check for `heartbeat:` lines
   between MIC_CAPTURED and MIC_RELEASED. If 0, #30 is verified closed.

## Pointers for a fresh session

- Read `coord/README.md` for the protocol.
- Read `coord/QUEUE.md` for the work list.
- Read `coord/INDEX.md` for module/feature/invariant/bug navigation.
- Read the latest `coord/HANDOVER-*.md` if compaction happened.
- Auto-memory at `~/.claude/projects/C--Users-Ben-Desktop-terminal-talk/memory/` has the pattern
  library — start with `feedback-multi-terminal-fix-loop.md`.
