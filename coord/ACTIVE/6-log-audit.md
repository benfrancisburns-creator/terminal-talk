# ACTIVE #6 — log-audit: diagnose user-hit bugs from `~/.terminal-talk/queue/_*.log` alone

- **Status:** in-review
- **Owner:** tt1
- **Axes in play:** 6 (observability)
- **Reported by:** Ben (queue seed, 2026-04-24)

## Queue-item goal

> Review the last ~2 weeks of user-hit bugs. For each, ask: could we have diagnosed it from
> `~/.terminal-talk/logs/` alone? If not, what log line is missing? Produce a "log coverage gaps"
> list, fix them.

## Reviewer findings — [tt1 · 2026-04-24T22:45:00+01:00]

### Inventory — actual logging surfaces on live install

First finding: the question assumes `~/.terminal-talk/logs/` exists. **It doesn't.** All logging
lives under `~/.terminal-talk/queue/` with an underscore prefix:

| Path | Writer | Rotation | What it captures |
|---|---|---|---|
| `queue/_toolbar.log` | `main.js diag()` | size-capped in `diag` itself | IPC mutations, mic-watcher transitions, voice-command dispatch, heartbeat clip generation, global shortcuts, watchdog boots |
| `queue/_hook.log` + `_hook.log.1` | PS hooks (`mark-working.ps1`, `speak-on-tool.ps1`, `speak-response.ps1`, `speak-notification.ps1`) + `synth_turn.py` | > 1 MB rotates to `.1` | hook fires, synth spawn, clip counts, edge-tts retries |
| `queue/_voice.log` | Python `wake-word-listener.py` | append-only, unbounded | openWakeWord scores, FIRE events, post-wake capture durations, SAPI results |
| `queue/_watchdog.log` | `main.js` watchdog | append-only | 30-min sweep results (pruned counts + ms) |
| `queue/_helper.log` | `key_helper.py` | append-only | `ctrlc` events (Ctrl+C key-sends) |

Second finding: `queue/_voice-debug/` (added by TT1 during voice-command work 2026-04-24) — 20-file-cap WAV captures for unrecognised / low-confidence wake-word firings. Good observability for that subsystem specifically.

### G0 — log path discoverability itself is a gap

The queue item literally says "from `~/.terminal-talk/logs/` alone" — TT2's STATE.md checkpoint
even flagged: *"~/.terminal-talk/logs/ directory does not exist on Ben's install — where are logs
going?"*. If a developer or triaged user opens the obvious path they find nothing.

**Fix:** either (a) move logs to `~/.terminal-talk/logs/` and leave symlinks at the `_*.log`
paths for callers, or (b) document the `queue/_*.log` convention prominently in README +
CONTRIBUTING + the diag message at first-log-write. Option (b) is smaller blast-radius; (a) is
more discoverable.

### Per-bug coverage analysis

For each user-hit bug in the queue (+ the ones surfaced earlier this session), could we have
diagnosed from log lines alone? Scoring: ✓ yes · ~ partial · ✗ no.

| Bug | `_toolbar.log` | `_hook.log` | `_voice.log` | Overall diagnosis-from-logs-alone? |
|---|---|---|---|---|
| #1 heartbeat-revert (config.json key dropped) | ~ (has `update-config OK: saved=true` but dishonest when key dropped) | — | — | ✗ **NO** — would need to read config.json manually to notice |
| #2 tinkering-audio-leak | ✓ (has `heartbeat: "Tinkering" → <file>`) | ✓ (has `synth` clip counts) | — | ✓ **YES** — filename prefix + synth path both visible |
| #3 settings-persistence full (heartbeat + tabs + window) | ~ (same dishonest update-config log) | — | — | ✗ **NO** — same root cause as #1 |
| #4 24h-soak (memory / orphans) | — | — | — | ~ **PARTIAL** — `_watchdog.log` has prune counts but no memory / file-count data over time |
| #5 error-recovery matrix | ~ (edge-tts retry logs in `_hook.log`) | ~ | — | ~ **PARTIAL** — partial coverage per dep; no aggregate |
| #8 session-registry wipe | — | — | — | ✗ **NO** — `saveAssignments` + `Save-Registry` both silent on success; no visibility into WHO wrote WHAT to `session-colours.json` |
| Ctrl+Shift+J mic-gate race (earlier this session) | ✓ (has `mic-watcher: MIC_CAPTURED C:#...`) | — | ✓ | ✓ **YES** — live log proved the filter didn't match |
| Voice-command intermittent "play" | — | — | ✓ (NOW has `command matched`, `post-wake silent`, RMS numbers — added today) | ✓ **YES** — after today's additions |
| Heartbeat-not-firing-for-TT2 (working flag stale) | ~ | — | — | ~ **PARTIAL** — needed to read working-flag file's epoch manually; no log saying "session X has stale working flag, age=NNN sec" |
| Ghost "feedface" session entry | — | — | — | ✗ **NO** — no "this write to session-colours.json came from %caller%" attribution |

### Ranked log-coverage gaps

**G1 — Registry writes are silent on success** *(blocks diagnosis of #8)*

`main.js saveAssignments()` and `writeAssignments()` only log on FAILURE. Successful writes —
the ones we desperately need to see when Ben's labels vanish between saves — produce no
log line. Same for PS-side `Save-Registry`. Makes delete-then-recreate wipes completely
invisible until a user-visible regression.

- **Fix shape:** add `diag('saveAssignments ok: keys=<n>, delta={added:[...], removed:[...]}')`
  on success. Before write, diff current vs previous-loaded state; emit the keys added/removed
  and list any entry whose `{label, pinned, speech_includes}` changed. Tiny log footprint
  (<200 bytes per save), massive diagnosis value.
- **Files:** `app/main.js:1262-1285 writeAssignments`, `app/main.js:1417-1426 saveAssignments`,
  `app/session-registry.psm1:287-307 Save-Registry` (log to `$logFile` in each hook).

**G2 — `update-config` log claims success when partials are silently dropped** *(blocks
diagnosis of #1, #3)*

`ipc-handlers.js:465` logs `update-config OK: saved=true, edge_response=<voice>`. The "saved=true"
is factually correct (disk-write succeeded) but misleading — the merged object may have
silently dropped keys the partial contained. From the log alone there's no way to notice.

- **Fix shape:** change the success log to compare partial top-level keys vs merged top-level
  keys. If ANY partial key was dropped, log a warning:
  `update-config WARN: dropped keys from partial — [heartbeat_enabled, selected_tab]`.
  Emits on the existing bug immediately, and catches any future allowlist drift.
- **File:** `app/lib/ipc-handlers.js:448-468`.

**G3 — No writer-attribution on registry saves** *(blocks diagnosis of #8 + future multi-writer
races)*

Five distinct writers can touch `session-colours.json`: main.js boot, main.js IPC (6 set-session-*
+ remove-session handlers + ensureAssignmentsForFiles), `statusline.ps1`, `speak-on-tool.ps1`,
`speak-response.ps1`. When a write corrupts state, we have no idea which wrote last — log
lines say "save ok" without caller identity.

- **Fix shape:** every save-site passes a `caller` string to a shared `saveWithLog(caller, all)`
  wrapper; the wrapper emits `saveAssignments from <caller>: keys=<n>, <any-delta>`. PS side
  gets the same via a `-CallerTag` param on `Save-Registry`.
- **Files:** `app/main.js`, `app/lib/ipc-handlers.js`, `app/session-registry.psm1`, plus the
  3 hook scripts.

**G4 — No hook-state-delta logging** *(low-observability for session-identity bugs)*

`_hook.log` has `===== fired =====` and `spawned synth for <short>` but nothing about what
the hook CHANGED. If a PS hook runs `Update-SessionAssignment` and migrates a PID, that's
invisible. If fresh-alloc creates a new entry, that's invisible. Identity-migration bugs
(the #8 hypothesis) are hard to narrow without this.

- **Fix shape:** `Update-SessionAssignment` returns a string tag of which branch fired
  (`existing-hit` / `pid-migration` / `fresh-alloc` / `lru-evict`). Caller logs:
  `update-session <short> → <branch> index=<idx> pid=<pid>`.
- **Files:** `app/session-registry.psm1`, plus the 3 hook callsites.

**G5 — No boot-event log** *(diagnosis-of-last-resort baseline missing)*

Neither `_toolbar.log` nor `_hook.log` has a clear "app started" line on launch. When
debugging across restarts, you have to infer boots from timestamps. Missing key context:
app version, CFG-loaded-from, PID, which main.js is running (installed vs node_modules/electron
directly).

- **Fix shape:** `===== Terminal Talk v<version>: main.js pid=<pid>, CFG=<path>, CFG-keys=[...]
  =====` at top of `_toolbar.log` on every boot. Also captures the **validator-approved-key
  presence report** — would have surfaced bug #1 on every launch by showing
  `heartbeat_enabled=MISSING` in the key list.
- **File:** `app/main.js` app-ready handler.

**G6 — Watchdog logs lack memory / resource data** *(blocks diagnosis of #4 24h-soak)*

`_watchdog.log` has `sweep ok · pruned 0 audio · 4 session files · 598ms` but no memory
footprint of the toolbar processes, no file-count in queue/, no registry size. TT2 already
noted they had to gather this manually for #4. Baseline would be trivial to emit once per
sweep.

- **Fix shape:** extend watchdog sweep log:
  `sweep ok · pruned=0 audio, 4 session · rss_mb=<from process.memoryUsage>,
   queue_files=<N>, registry_bytes=<S>, voice_procs=<V>`.
- **File:** `app/main.js` watchdog.

**G7 — `_helper.log` is context-free** *(low value for hey-jarvis / Ctrl+Shift+S bugs)*

Only records `<ts> ctrlc`. No indication of who asked, or what was highlighted, or whether
capture succeeded. Makes speak-clipboard bug diagnosis guesswork.

- **Fix shape:** include origin hint (global-shortcut vs wake-word) and outcome
  (`captured=<N chars>` / `empty`).
- **File:** `app/key_helper.py`.

**G8 — Stale-flag detection invisible** *(blocks the TT2-heartbeat-not-firing bug earlier today)*

When `get-working-sessions` drops a flag because it's > 600 s old, the IPC silently returns
a filtered list. The dropped flag is invisible to downstream consumers who wonder why
heartbeat isn't firing for a session they can see is working.

- **Fix shape:** `ipc-handlers.js:549-569 get-working-sessions` logs `filtered N stale flags:
  [short,short,...]` at INFO when the filter actually drops anything. At DEBUG all the time,
  but INFO only on non-empty drops.
- **File:** `app/lib/ipc-handlers.js:549-569`.

### Summary — priority order for closing gaps

Ordered by **"did it block diagnosis of a real user-hit bug in this session?"** — highest
impact first:

1. **G1** (registry silent on success) — #8 undiagnosable from logs today. Critical.
2. **G2** (update-config saved=true is dishonest) — #1, #3 same. Critical.
3. **G3** (no writer attribution) — compounds #8; necessary before #8 fix can be verified.
4. **G5** (no boot-event log) — would surface #1 on every launch via CFG-keys report.
5. **G4** (no hook-branch-delta logging) — pins #8 hypothesis H1 empirically.
6. **G8** (silent flag filtering) — blocked earlier-session heartbeat-not-firing diagnosis.
7. **G6** (watchdog lacks resource data) — needed for #4 full coverage.
8. **G7** (ctrlc log context-free) — lowest-impact of the list.
9. **G0** (path discoverability) — docs-only; trivial. Land with any of the fixes above.

### Proposed fix approach

Single-commit-per-gap. Each gap closes with one line-of-log added + a small test asserting
the line fires on the right trigger. Test pattern for each:

```js
it('G<N>: <gap> emits log line <format>', () => {
  // Exercise the code path.
  // Assert the log line matches the expected format.
});
```

Tests run quickly because they just check diag-call arguments (no disk IO). Blast-radius is
one function per gap; regression risk is minimal.

**Recommended batching:**
- **Batch 1 (urgent, blocks diagnosis of #1/#3/#8):** G1 + G2 + G3. ~150 lines total.
- **Batch 2 (24h-soak support):** G6 + G8. Land together with #4 close-out.
- **Batch 3 (polish):** G4 + G5 + G7 + G0. Land last.

### Non-fix observations

- **`_voice.log` coverage is GOOD** — openWakeWord scores, FIRE events, post-wake capture
  durations, SAPI confidence, RMS, voice-command action + fallback reason, debug-WAV trail.
  This was deliberately built up during voice-command work earlier today (commits on fix-pass
  + main). Use it as a template for what other subsystems should look like.
- **`_toolbar.log` mic-watcher coverage is GOOD** — logs every MIC_CAPTURED + MIC_RELEASED
  with the actual registry key name. Proved the self-filter bug earlier today (Ben saw
  `MIC_CAPTURED C:#Users#Ben#AppData#Local#Python#pythoncore-3.14-64#python.exe` and we
  knew the filter pattern needed updating).
- **Synth `_hook.log` line is GOOD** — `synth: n=7 ok=6 total_ms=80313 parallelism=4` gives
  us exact body-clip counts + timing. Useful for #2 timing correlations.

The pattern that works: log every external-facing event with structured key=value data.
The gaps are all "log what the code already knows, but isn't saying".

## Tester findings — [TT? · HH:MM]

*(TT2: once you have a free block after #1/#2/#3/#8 verifications, this is an observability
item that can be tested by reading the diff between "log with gap" and "log with G1 fix"
against a reproduced #8 scenario. Specifically: after G1 lands, re-run the #8 real-time
registry watcher, confirm the `saveAssignments from <caller>` lines let you identify the
wipe source without needing the watcher at all.)*

## Fix proposal — [TT? · HH:MM]

*(Draft in this file after TT2's batch-1 verification arrives.)*

## Blast-radius check

- **Files touched (Batch 1):** `app/main.js`, `app/lib/ipc-handlers.js`,
  `app/session-registry.psm1`, 3 hook files for shared `-CallerTag` param
- **Features affected:** observability only (no behaviour change)
- **Tests that MUST still pass:** all existing `HARDENING` tests (S3 redaction — new log lines
  must go through `redactForLog`); all `UPDATE-CONFIG` tests
- **Tests at silent-regression risk:** any test that scrapes `_toolbar.log` for specific lines
  — grep scripts/ for `_toolbar.log` readers

## Close-out checklist

- [ ] Batch 1 gaps (G1, G2, G3) land with tests
- [ ] Bug #8 re-diagnosed purely from logs post-Batch-1 — proves the fix's effectiveness
- [ ] Batch 2 gaps (G6, G8) land
- [ ] Batch 3 gaps (G0, G4, G5, G7) land
- [ ] README + CONTRIBUTING updated with the `queue/_*.log` convention (G0)
- [ ] `MAP/observability.md` stub created and populated
- [ ] `INDEX.md` gets a new invariant row: "every successful registry write emits a log line
      with caller attribution + entry-delta summary"
- [ ] Move this file to `DONE/6-log-audit.md`, QUEUE #6 STATUS=done
