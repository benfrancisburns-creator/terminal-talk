# Terminal Talk — Session-Registry / Colour Deep Audit (2026-06-02)

**Trigger:** Ben reported session colours changing on their own, and especially that pressing
`/clear` gives the session a *fresh* colour instead of keeping its previous one — "the registry
loses its mind."

**Method:** Traced every reader/writer of `~/.terminal-talk/session-colours.json` (the colour is the
integer `index` field, keyed by 8-char session short). Pulled live evidence: 23 `.corrupt-*`
archives, the `_hook.log`/`_toolbar.log` write trail, and a full clobber snapshot. (A 5-dimension
multi-agent audit was launched but hung after 43 agents/3.5h and was killed; the diagnosis below is
from direct investigation + live-log confirmation.)

---

## Root causes (confirmed with live evidence)

The registry is written by **6+ processes** doing read-modify-write every 1–3 s (statusline, the
three speak-* hooks, codex-identify-live, the JS queue-scanner). They serialise on a `.lock` file
whose acquire "falls through unlocked" on timeout — so each writer **must** check the lock and skip
the write on failure. Audit found two writers that didn't, plus a too-narrow `/clear` window and a
false-corrupt vector:

### FIX-A — `codex-identify-live.ps1` wrote the registry unconditionally
It did `Read-Registry → Update-SessionAssignment → Save-Registry` without checking `$locked`, unlike
statusline / speak-* / the JS `saveAssignments` (all fixed under #8/#26). On lock-fail it read a
possibly mid-rename (empty) registry and wrote it back, blanking other sessions' labels and
reshuffling colours. **Confirmed live:** `save-registry ok from=codex-identify-live keys=…` during
contention. **Fix:** mirror the `if ($locked) {…} else {read-only, skip save}` discipline. Added to
the lock-discipline regression test's file list (it had been missing — that's why it slipped).

### FIX-B — JS `writeAssignments` wrote with NO lock
`ensureAssignmentsForFiles` (the queue-scanner, runs on every clip) + backup-recovery call
`writeAssignments`, which (unlike `saveAssignments`) took no `withRegistryLock`. It also *creates
fresh entries with empty labels and new colours* from clip filenames. **Confirmed live in
`_toolbar.log`:** `write-registry from=ensure-for-files keys=1 added=[…]` and `… removed=[5cfc85a7,
019e82d3]` — the unlocked scanner dropping real sessions. **Fix:** wrap in `withRegistryLock` +
skip-on-fail, guard runs inside the lock.

### FIX-C — `/clear` lost the colour after a >600 s idle
`Update-SessionAssignment`'s PID-migration (the thing that carries colour/label/voice across the
`/clear` session-id rotation) only fired if the old entry's `last_seen` was within 600 s. Step away
>10 min, then `/clear` → migration skipped → fresh colour. A PID that is **alive right now** cannot
be OS-reused, so it's a definitive same-terminal signal. **Fix:** migrate if pid matches AND
(`last_seen` fresh **OR** pid alive). Behavioural PS test added (stale `last_seen` + live pid →
colour preserved; stale + dead pid → no migration).

### FIX-D — false-corrupt archives + colour-changing recovery
`loadAssignments` treated a single failed parse as "corrupt" → archived the file → recovered from
`.bak1/2/3` (snapshots up to 3 writes old, which can carry a *different* colour). A concurrent atomic
rename on Windows can make one read throw / see a partial file. **23 archives in ~3 weeks** is mostly
this. **Fix:** retry the parse a few times before declaring corruption.

---

## Live-data incident + recovery (during this session)

While the (old-code) app ran during the long audit, the bugs above **wiped the live registry**
(5 labels → 0, two sessions dropped, an index changed). Recovered from `session-colours.json.bak2`
(Ocrhestrator / MateainBOT / TT / Worker 1 / Codex) → primary + bak1 + bak3. After deploying the
fixes and restarting, the registry **held at keys=5, all labels, for 6+ minutes** with every writer
(including the now-fixed codex-identify-live) preserving all five.

> ⚠️ Note for Ben: `bak2` has `3eb2350c="Ocrhestrator"` (typo) at index 4 and `5cfc85a7="Worker 1"`
> at index 3 — earlier in the day these two were swapped (`3eb2350c="Worker 1"`@3,
> `5cfc85a7="Orchestrator"`@4). If the mapping looks wrong, fix those two labels in Settings; they'll
> now stick.

---

## Deployed

- `app/codex-identify-live.ps1`, `app/session-registry.psm1` → copied wholesale to
  `~/.terminal-talk/app/` (byte-identical except the fixes). `app/main.js` (FIX-B/D) → surgical
  brace-matched patch of just `writeAssignments` + `loadAssignments`+`_sleepSyncMs` into the live
  (older, un-deployed-dictation) main.js, `node --check`-verified. Backups in `%TEMP%`.
- JS logic suite green (1113/0). FIX-C validated via isolated PowerShell repro + a new behavioural
  test that runs against the deployed psm1.

## Recommendations / follow-ups (not done)

- **R-1 (test hygiene):** `runStatusline` (run-tests.cjs ~L149) sets `TT_REGISTRY_PATH` (registry is
  isolated to a temp file — `npm test` does NOT clobber the live registry) but not `TT_HOME`, so its
  test shorts leak into the live `queue/_hook.log`. Cosmetic; set `TT_HOME` to a temp dir to stop it.
  **Do not run the full PS suite against the live machine casually** — it spams the live log.
- **R-2 (Mac parity):** `posix_hooks.py migrate_by_pid` still uses the 600 s window only; apply the
  same pid-alive widening for Mac (deferred to avoid `os.kill`-on-Windows + non-deterministic-pid test
  risk).
- **R-3:** label/index occasionally observed swapping between two sessions before the full wipe — most
  likely a symptom of the unlocked-writer races (FIX-A/B); re-check after a few days on the fixed code.
- **R-4:** `scripts/_deploy-registry-patch.cjs` is a one-shot deploy helper left in the tree; remove
  or relocate before any commit (knip/file-length will flag it).
