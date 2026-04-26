# QUEUE.md — work list

Ordered by priority (top = next). Items are never deleted — completed ones move to `STATUS=done`
and their ACTIVE file moves to DONE/. New items can appear at any priority as reviews surface them.

**Status values:** `queued` · `in-review` · `in-test` · `fix-drafted` · `in-verify` · `done` · `blocked`
**Axis codes:** 1=correctness · 2=persistence · 3=concurrency · 4=error-recovery · 5=resource-soak · 6=observability · 7=invariant-enforcement · 8=security

---

- [ ] **#1 heartbeat-revert** — toggle heartbeat narration OFF in Settings; ~30 min later it's back
  ON when you re-open Settings. **User-hit regression.** · AXIS=1,2 · OWNER=tt1 · STATUS=in-review · ACTIVE=`ACTIVE/1-heartbeat-revert.md`

- [x] **#2 tinkering-audio-leak** — RECOMMEND CLOSE (2026-04-25). Code investigation:
  Path C (heartbeat during Wispr dictation) was the actual bug; fixed 2026-04-23 via HB4
  two-flag split (verified in Surface D audit #17). Path A (heartbeat just before body
  arrives) is a narrow race with low-severity output. Path B (footer "Tinkered for Xs")
  is by-design. Python never synths present-continuous verbs; JS never synths past-tense
  — impossible to hear "Tinkering" at full body volume via any normal path.
  · AXIS=1,6 · OWNER=tt2 · STATUS=recommend-close · ACTIVE=`ACTIVE/2-tinkering-audio-leak.md`

- [ ] **#3 settings-persistence-full-audit** — systematic pass: every toggle, every slider, every
  text field in the Settings panel. Toggle · reload window · restart app · reboot PC. Verify state
  survives each. Find all classes-of-bug like #1 not just the specific instance. · AXIS=2,7
  OWNER=tt1 · STATUS=in-review · ACTIVE=`ACTIVE/3-settings-persistence-full-audit.md`

- [ ] **#4 24h-soak** — leave toolbar running overnight with representative activity (queued clips,
  session switches, mic events, heartbeat). Track: memory growth, `~/.terminal-talk/logs/` size,
  orphan Python processes, orphan MP3 files, registry file integrity. · AXIS=5 · OWNER=tt2
  STATUS=in-test · ACTIVE=`ACTIVE/4-24h-soak.md`

- [ ] **#5 error-recovery-matrix** — deliberately break each external dependency and watch: edge-tts
  offline, OpenAI 401, mic held indefinitely by another app, disk full during synth, network drop
  mid-request, Windows sleep during active playback. Toolbar should degrade gracefully, never
  crash-and-silent. · AXIS=4 · OWNER=TBD · STATUS=queued

- [ ] **#6 log-audit** — review the last ~2 weeks of user-hit bugs. For each, ask: could we have
  diagnosed it from `~/.terminal-talk/logs/` alone? If not, what log line is missing? Produce a
  "log coverage gaps" list, fix them. · AXIS=6 · OWNER=tt1 · STATUS=in-review · ACTIVE=`ACTIVE/6-log-audit.md`

- [ ] **#7 top-level-key-dropped-audit** — the same allowlist-merge bug surfaced on #1 for
  `heartbeat_enabled` applies to `selected_tab` and `tabs_expanded` (validated; see ACTIVE
  file). Audit complete: 3 of 4 top-level scalars fail the round-trip. Fix shape drafted, test
  drop-in written. Closes WITH #1 since the test covers both. · AXIS=2,7 · OWNER=tt2
  STATUS=fix-drafted (ready to land in #1's fix commit) · ACTIVE=`ACTIVE/7-top-level-key-dropped-audit.md`

- [ ] **#8 session labels / pinned / speech_includes wiped from registry** — Ben observed
  "session IDs gone"; empirical diff of `session-colours.json` vs `.bak1` shows LABELS,
  PINNED=true, and SPEECH_INCLUDES overrides all being silently wiped between saves. Same bug
  CLASS as #1 but different file — JS-side session-registry write path is rebuilding entries
  with subset/default values instead of preserving user state. **URGENT: Ben's live
  customizations being wiped continuously.** · AXIS=1,2,7 · OWNER=tt2 (empirical) · STATUS=in-test
  ACTIVE=`ACTIVE/8-session-ids-missing-from-toolbar.md`

- [ ] **#9 orphan-python-on-toolbar-exit** — surfaced by #4 soak baseline: when electron exits,
  its python children (wake-word-listener, edge-tts workers) are not killed. T+0 snapshot shows
  14 python procs with 7 from prior boots still alive (up to 2 days 22h old). Zero-ish RSS
  individually but accumulates handles+PIDs over long soaks and complicates cleanup. · AXIS=4,5
  OWNER=TBD · STATUS=queued

- [ ] **#10 `_voice.log` unbounded growth** — `_hook.log` rotates at 1 MB → `.1`; `_voice.log`
  has no rotation (561 KB after ~2 days → ~10 MB/month). Low urgency but clear gap. Add same
  size-capped rotation as `_hook.log`. · AXIS=5,6 · OWNER=TBD · STATUS=queued

- [ ] **#11 settings-panel-audit** — systematic feature-by-feature audit of all 17 panel
  controls. Surfaced F1 (voice validator coverage gap: 3 UI keys unvalidated), F2 (speech_includes
  sub-keys unvalidated), F3 (2 dead validator declarations), F4 (OpenAI section collapse state
  ephemeral). No new BROKEN states (pre-known #1/#3/#7 confirmed), 2 brittle. · AXIS=1,2,7
  OWNER=tt2 · STATUS=in-test · ACTIVE=`ACTIVE/11-settings-panel-audit.md`

- [ ] **#12 voice-dispatch-audit** (Surface G per `PLAN-SYSTEMATIC-COVERAGE.md`) — completed:
  ✗ G-V1 heartbeat ignores tts_provider (contradicts UI tooltip), ✗ G-V2 speakClipboard
  ignores tts_provider (same), ~ G-V3 edge_question dead, ~ G-V4 edge_notification dead.
  · AXIS=1 · OWNER=tt2 · STATUS=audit-done · ACTIVE=`ACTIVE/12-voice-dispatch-audit.md`

- [ ] **#15 heartbeat-voice-respect-provider** — `ipc-handlers.js:604,:616` always calls
  `callEdgeTTS` for heartbeats regardless of `playback.tts_provider`. UI tooltip explicitly
  promises heartbeats play in OpenAI's voice when the toggle is on. Fix: provider-aware
  branch like `synth_turn.py::synthesize_parallel`. Test: stub both wrappers, assert correct
  call path. **Surfaced by #12 audit.** · AXIS=1 · OWNER=TBD · STATUS=queued

- [ ] **#16 speakClipboard-respect-provider** — `main.js:1103-1117` always tries edge FIRST
  with OpenAI as fallback, regardless of `tts_provider`. Same UI-contract violation as #15.
  Fix: branch on `tts_provider` before the call. **Surfaced by #12 audit.** · AXIS=1
  OWNER=TBD · STATUS=queued

- [ ] **#13 speech-includes-filter-audit** (Surface J) — completed: 4 of 6 sub-keys have
  matching fallbacks; J-S1 latent drift (Python `flags.get` fallbacks for `image_alt` +
  `bullet_markers` are True but DEFAULTS are False); J-S2 unaudited cross-sanitiser parity.
  · AXIS=1,7 · OWNER=tt2 · STATUS=audit-done · ACTIVE=`ACTIVE/13-speech-includes-filter-audit.md`

- [x] **#18 sanitizer-fallback-drift** — **CLOSED 2026-04-26 by TT2 @ `ef42731`.** Both
  fallbacks (`image_alt`, `bullet_markers`) flipped True→False to match DEFAULTS. New
  forcing-function test in SPEECH INCLUDES describe group parses DEFAULT_SPEECH_INCLUDES +
  every `flags.get('<k>', <bool>)` site from synth_turn.py source and asserts agreement —
  any future drift fails CI by inspection. 888 → 889 tests. Surfaced by #13 audit.
  · AXIS=7 · OWNER=tt2 · STATUS=done

- [x] **#19 sanitizer-cross-parity-audit** — **CLOSED 2026-04-25.** 4 divergences found, all
  fixed on JS side to match Python: D1 (looksLikeCode counting) @ `439d8ea`, D2+D3 (URL
  www.X + heading regex) @ `f9b098c`, D4 (single-underscore emphasis) now shipped. The
  PHASE 3 "known drift" test converted to a parity-achieved assertion. 831/831 tests green.
  · AXIS=1,7 · OWNER=tt2 · STATUS=done · ACTIVE=`ACTIVE/19-sanitizer-cross-parity-audit.md`

- [ ] **#20 palette-allocation-audit** (Surface I) — audited: 5 invariants verified clean.
  Palette allocator is well-designed (3-level free→LRU→hash-mod; hasUserIntent guard covers 6
  fields; defensive size clamp). Surfaced a #8-adjacent lead: `sanitiseEntry` drop + fresh-alloc
  recreate path is a candidate for the label-wipe pattern. Flagged in ACTIVE/8 for TT1's fix
  draft. · AXIS=1,7 · OWNER=tt2 · STATUS=audit-done
  ACTIVE=`ACTIVE/20-palette-and-sorting-audit.md`

- [ ] **#21 openai-key-flow-audit** (Surface K) — audited: 8 invariants verified (atomic
  write order, clear-both-files, safeStorage-unavailable cleanup, plaintext migration,
  401-auto-unset 4-step, idempotent failure, no plaintext in logs, hook/synth sidecar). Two
  minor findings: K-1 narrow race between 401 auto-unset and concurrent user-save (user's
  pasted key could be wiped in ~5ms window); K-2 stale .enc after safeStorage flips
  unavailable (disk-clutter, not security). · AXIS=1,3,8 · OWNER=tt2 · STATUS=audit-done
  ACTIVE=`ACTIVE/21-openai-key-flow-audit.md`

- [ ] **#22 window-dock-audit** (Surface L) — audited: 6 invariants verified clean.
  Pure-geometry module, 79 LoC, no side effects. Edge-snap threshold + overshoot tie-break
  + bar-centre rescue all well-considered. Adjacent check: the `window.x/y/dock racy` strand
  of #3 appears resolved by TT1's #1 fix (update-config merge now preserves `window`).
  · AXIS=1 · OWNER=tt2 · STATUS=audit-done
  ACTIVE=`ACTIVE/22-window-dock-audit.md`

- [ ] **#23 tab-filter-audit** (Surface F) — audited: 4 invariants clean via #1 fix +
  existing stale-session guard. Tab selection + expanded state now persist correctly. Default
  `'all'` provides safe fallback. Deeper renderDots filter-bucket audit deferred (separate
  surface not in PLAN). · AXIS=1,2 · OWNER=tt2 · STATUS=audit-done
  ACTIVE=`ACTIVE/23-tab-filter-audit.md`

- [ ] **#24 tool_calls-global-checkbox** (Ben B-2 decision) — add a 7th global Settings
  checkbox for `speech_includes.tool_calls`. Mirrors the existing 6 checkboxes so users
  don't have to toggle it per-session. TT1 lane when #15/#16 land. · AXIS=1 · OWNER=TBD
  STATUS=queued

- [ ] **#25 openai-section-collapse-default** (Ben B-4 decision) — OpenAI Settings section
  should default to collapsed on every panel open, regardless of whether it was expanded
  during a previous panel session. Current `_openaiCollapseDecided` flag in settings-form.js
  is per-instance; need to reset it on every panel open (or remove it) so the collapse
  decision re-applies every time. · AXIS=1 · OWNER=TBD · STATUS=queued

- [x] **#26 js-lock-fail-fall-through** — **CLOSED 2026-04-25 by TT1 @ `d39239d`.** Same
  lock-fail-fall-through bug class as #8's PS root cause; symmetric fix on JS side. TT1
  picked it up after TT2 audit + INBOX ping; landed Option A (pass `held` to fn). 879
  tests green. Coord pattern win — TT2 found via Surface C deeper audit, queued + INBOX'd,
  TT1 shipped same day. · AXIS=1,3 · OWNER=tt1 · STATUS=done
  ACTIVE=`ACTIVE/26-js-lock-fail-fall-through.md`

- [ ] **#27 voice-command-pipeline-audit** — audited end-to-end: 8 invariants verified,
  no BROKEN findings. Pipeline (wake-word → recognize.ps1 → confidence gate → main.js
  whitelist → voice-dispatch) is correct + observable. Two minor doc-drift findings
  (F1 exit-code comment, F2 stale lock-step reference). · AXIS=1,6,7 · OWNER=tt2
  STATUS=audit-done · ACTIVE=`ACTIVE/27-voice-command-pipeline-audit.md`

- [ ] **#28 voice-command-vocab-forcing-test** (#27 F2 follow-up) — add a test that
  asserts phraseToAction values in `voice-command-recognize.ps1` exactly match
  `VOICE_COMMAND_ALLOWED` in main.js, by reading both source files and comparing sets.
  Catches future drift as a CI red flag. · AXIS=7 · OWNER=TBD · STATUS=queued

- [ ] **#14 playback-controls-audit** (Surface H) — completed: no BROKEN findings. 3 minor
  UX notes (H-P1 button-vs-voice play parity, H-P2 no keyboard shortcut for ±10s, H-P3 undo
  window). · AXIS=1 · OWNER=tt2 · STATUS=audit-done · ACTIVE=`ACTIVE/14-playback-controls-audit.md`

- [ ] **#17 mic-aware-auto-pause-audit** (Surface D) — completed: no BROKEN, no BRITTLE. 10
  invariants verified from source (two-flag split, initial-state emit, crash-recovery,
  self-exclusion, etc.). Ben's earlier "Path C fixed" observation validated from code. One
  test gap noted (invariant I2 guard). · AXIS=1,3 · OWNER=tt2 · STATUS=audit-done
  ACTIVE=`ACTIVE/17-mic-aware-auto-pause-audit.md`
