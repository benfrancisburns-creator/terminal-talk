# QUEUE.md — work list

Ordered by priority (top = next). Items are never deleted — completed ones move to `STATUS=done`
and their ACTIVE file moves to DONE/. New items can appear at any priority as reviews surface them.

**Status values:** `queued` · `in-review` · `in-test` · `fix-drafted` · `in-verify` · `done` · `blocked`
**Axis codes:** 1=correctness · 2=persistence · 3=concurrency · 4=error-recovery · 5=resource-soak · 6=observability · 7=invariant-enforcement · 8=security

---

- [ ] **#1 heartbeat-revert** — toggle heartbeat narration OFF in Settings; ~30 min later it's back
  ON when you re-open Settings. **User-hit regression.** · AXIS=1,2 · OWNER=tt1 · STATUS=in-review · ACTIVE=`ACTIVE/1-heartbeat-revert.md`

- [ ] **#2 tinkering-audio-leak** — spinner verbs ("Tinkering", "Moonwalking", "Fingling", …) are
  audibly leaking into real transcript narration instead of being ephemeral spinner audio.
  **User-hit.** · AXIS=1,6 · OWNER=tt1 · STATUS=in-review · ACTIVE=`ACTIVE/2-tinkering-audio-leak.md`

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

- [ ] **#13 speech-includes-filter-audit** (Surface J) — per sub-key, does a toggle actually
  include/exclude that content from TTS synth? Needs code-path trace through sanitiser +
  empirical probe with each sub-key set. · AXIS=1,2 · OWNER=TBD · STATUS=queued

- [ ] **#14 playback-controls-audit** (Surface H) — completed: no BROKEN findings. 3 minor
  UX notes (H-P1 button-vs-voice play parity, H-P2 no keyboard shortcut for ±10s, H-P3 undo
  window). · AXIS=1 · OWNER=tt2 · STATUS=audit-done · ACTIVE=`ACTIVE/14-playback-controls-audit.md`

- [ ] **#17 mic-aware-auto-pause-audit** (Surface D) — completed: no BROKEN, no BRITTLE. 10
  invariants verified from source (two-flag split, initial-state emit, crash-recovery,
  self-exclusion, etc.). Ben's earlier "Path C fixed" observation validated from code. One
  test gap noted (invariant I2 guard). · AXIS=1,3 · OWNER=tt2 · STATUS=audit-done
  ACTIVE=`ACTIVE/17-mic-aware-auto-pause-audit.md`
