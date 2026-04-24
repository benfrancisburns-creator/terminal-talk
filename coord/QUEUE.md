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
  orphan Python processes, orphan MP3 files, registry file integrity. · AXIS=5 · OWNER=TBD
  STATUS=queued

- [ ] **#5 error-recovery-matrix** — deliberately break each external dependency and watch: edge-tts
  offline, OpenAI 401, mic held indefinitely by another app, disk full during synth, network drop
  mid-request, Windows sleep during active playback. Toolbar should degrade gracefully, never
  crash-and-silent. · AXIS=4 · OWNER=TBD · STATUS=queued

- [ ] **#6 log-audit** — review the last ~2 weeks of user-hit bugs. For each, ask: could we have
  diagnosed it from `~/.terminal-talk/logs/` alone? If not, what log line is missing? Produce a
  "log coverage gaps" list, fix them. · AXIS=6 · OWNER=TBD · STATUS=queued

- [ ] **#7 top-level-key-dropped-audit** — the same allowlist-merge bug surfaced on #1 for
  `heartbeat_enabled` applies at least to `selected_tab` and `tabs_expanded` (both in the
  validator's allowlist, neither in `ipc-handlers.js update-config` merge nor `config-store.js
  load()` return literal). Audit ALL validator-accepted top-level keys for symmetric coverage on
  write + read. Add a static test that fails if any validator-accepted key is absent from either
  allowlist. Surfaced by TT1 during #1 review; kept out of #1 scope per protocol.
  AXIS=2,7 · OWNER=TBD · STATUS=queued
