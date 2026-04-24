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
  **User-hit.** · AXIS=1,6 · OWNER=TBD · STATUS=queued

- [ ] **#3 settings-persistence-full-audit** — systematic pass: every toggle, every slider, every
  text field in the Settings panel. Toggle · reload window · restart app · reboot PC. Verify state
  survives each. Find all classes-of-bug like #1 not just the specific instance. · AXIS=2,7
  OWNER=TBD · STATUS=queued

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
  "log coverage gaps" list, fix them. · AXIS=6 · OWNER=TBD · STATUS=queued

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
