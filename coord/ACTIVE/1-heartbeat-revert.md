# ACTIVE #1 — heartbeat toggle reverts from OFF → ON after ~30 min

- **Status:** in-review
- **Owner:** tt1
- **Axes in play:** 1 (correctness), 2 (persistence)
- **MAP page:** [`MAP/heartbeat-narration.md`](../MAP/heartbeat-narration.md)
- **Reported by:** Ben, live use, 2026-04-24

## User-reported symptom

> "I'm setting the heartbeat narration to off and then half an hour later I'm going back into the
> settings and it's back to on again."

## Reproduction recipe — [tt1 · 2026-04-24T21:20:00+01:00]

Deterministic. The "~30 min" in the symptom is coincidental; the revert triggers on the **next
Settings-panel open** after the toggle, which is usually just whenever Ben goes back in. Stepwise:

### Recipe A — minimum-steps reproduction (no timers needed)

```
# PREP
1. Close the toolbar if running:
      taskkill /F /IM electron.exe ; taskkill /F /IM terminal-talk.exe
2. Baseline config: make heartbeat_enabled observable on disk.
      python -c "import json,pathlib; p=pathlib.Path.home()/'.terminal-talk/config.json'; \
                 c=json.loads(p.read_text()); c['heartbeat_enabled']=True; \
                 p.write_text(json.dumps(c, indent=2))"
3. Confirm on-disk state:
      grep heartbeat_enabled ~/.terminal-talk/config.json
      (expected: "heartbeat_enabled": true,)
4. Launch toolbar (normal shortcut).

# TRIGGER
5. Open Settings panel. Observe heartbeat toggle: should be ON.
6. Click toggle OFF. Wait 500 ms.
7. Close Settings panel.
8. Re-read config.json:
      grep heartbeat_enabled ~/.terminal-talk/config.json

# OBSERVE
9. EXPECTED (bug present): grep returns EMPTY. The key is gone from disk.
   VS INTENDED: grep returns "heartbeat_enabled": false,

10. Re-open Settings panel.
11. Observe the heartbeat toggle: shows ON again.
    (Because step 8 left config.json without the key, loadSettings reads it as undefined,
     _populateHeartbeat runs `cfg.heartbeat_enabled !== false` which is `true !== false` = true.)

12. Wait any amount of time. 0 seconds works. Bug is ALREADY present — no 30 min needed.
```

**Faster-than-30-min confirmation:** `grep heartbeat_enabled ~/.terminal-talk/config.json`
immediately after step 7 shows the key missing. The "30 minutes" in the user-visible symptom is
just "the next time Ben happened to open Settings". There is no hidden timer rewriting the file.

### Recipe B — confirms the hypothesis by BYPASSING the bug path

Skip the IPC — write `heartbeat_enabled: false` directly to config.json via a hand-edit, restart
the toolbar, open Settings. Toggle SHOULD show OFF. If this ALSO shows ON (bug B below), the read
path is compounding the write-path bug.

### Empirical confirmation BEFORE any fix — [tt1 · 2026-04-24T21:20:00+01:00]

Ben's CURRENT live config at `C:\Users\Ben\.terminal-talk\config.json` already exhibits the bug:
file ends at `"openai_api_key": null` with NO `heartbeat_enabled` key present. Direct evidence
that the write path has been silently dropping it at least since the last Settings-panel
interaction.

## Reviewer findings — [tt1 · 2026-04-24T21:20:00+01:00]

### Code-path map (toggle click → disk write)

1. **UI binding** — `app/lib/settings-form.js:307-311` `_wireHeartbeatToggle`.
   On the heartbeat-toggle checkbox `change` event:
   ```js
   await this._api.updateConfig({ heartbeat_enabled: on });
   if (window.TT_CONFIG_SNAPSHOT) window.TT_CONFIG_SNAPSHOT.heartbeat_enabled = on;
   ```
   Writes a partial with exactly one top-level key: `{ heartbeat_enabled: true|false }`.

2. **IPC boundary** — `app/preload.js:23`:
   `updateConfig: (partial) => ipcRenderer.invoke('update-config', partial)`.
   Passes `partial` through contextBridge unchanged.

3. **Main handler** — `app/lib/ipc-handlers.js:448-468` `handle('update-config')`.
   The critical code:
   ```js
   const cur = getCFG();
   const merged = {
     voices:          { ...cur.voices,          ...(partial.voices          || {}) },
     hotkeys:         { ...cur.hotkeys,         ...(partial.hotkeys         || {}) },
     playback:        { ...cur.playback,        ...(partial.playback        || {}) },
     speech_includes: { ...cur.speech_includes, ...(partial.speech_includes || {}) },
     openai_api_key:  null,
   };
   const ok = saveConfig(merged);
   setCFG(merged);
   ```
   **`merged` is built with exactly 5 explicit top-level keys. `heartbeat_enabled` is not one of
   them** — so even when the partial carries `heartbeat_enabled: false`, the merge silently
   drops it before reaching disk. **Bug site A.**

4. **Disk write** — `app/lib/config-store.js:55-68` `save(cfg)`.
   Atomic `.tmp` + rename. Writes whatever object it's given, faithfully. Not a bug site; it
   does exactly what it's asked — persist `merged`, which is already missing the key.

5. **Round-trip on re-load** — `app/lib/config-store.js:45-52` `load()`.
   ```js
   return {
     voices:          { ...defaults.voices,          ...(parsed.voices          || {}) },
     hotkeys:         { ...defaults.hotkeys,         ...(parsed.hotkeys         || {}) },
     playback:        { ...defaults.playback,        ...(parsed.playback        || {}) },
     speech_includes: { ...defaults.speech_includes, ...(parsed.speech_includes || {}) },
     window:          parsed.window ...,
     openai_api_key:  parsed.openai_api_key ?? null,
   };
   ```
   **Same allowlist shape on the READ side** — even if bug site A were fixed and
   `heartbeat_enabled: false` made it onto disk, `load()` would still drop it coming back in.
   **Bug site B.** Both must be fixed.

6. **Settings-panel re-populate** — `app/lib/settings-form.js:650-657` `_populateHeartbeat`.
   ```js
   const on = cfg.heartbeat_enabled !== false;
   heartbeatToggle.checked = on;
   ```
   `undefined !== false` is `true`, so when the key is missing (as it always is on disk after
   bug A drops it), the toggle renders ON. Not a bug site — the `!== false` defaulting is the
   intentional DEFAULTS policy — but it's what surfaces the lower bug to the user.

### State surfaces that hold `heartbeat_enabled`

Audited via `rg '\bheartbeat_enabled\b' app/`:

| # | Surface | File · line | Lifetime | Written by |
|---|---|---|---|---|
| S1 | `DEFAULTS.heartbeat_enabled` | `app/main.js:99` | process lifetime, const | hardcoded `true` |
| S2 | `CFG.heartbeat_enabled` (main-side live config) | `app/main.js:137` + reassigned via `setCFG` | process lifetime | `loadConfig()` at boot, `setCFG(merged)` in update-config |
| S3 | `config.json` on disk — `heartbeat_enabled` key | `~/.terminal-talk/config.json` | persistent | `saveConfig(cfg)` — currently NEVER includes the key because of A |
| S4 | `window.TT_CONFIG_SNAPSHOT.heartbeat_enabled` (renderer mirror) | set by `loadSettings()` and by settings-form line 310 | renderer process lifetime | refreshed from CFG on every Settings-panel open |
| S5 | config-validate RULES table entry | `app/lib/config-validate.js:30` | const | — (validator only, allows key but doesn't preserve it) |

Validator (S5) correctly lists `heartbeat_enabled` as a legal top-level boolean, so a hand-edited
config.json with `"heartbeat_enabled": false` parses as valid. The validator is not the bug.

### Hypotheses ranked

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| H1 | `update-config` IPC merge drops `heartbeat_enabled` because the allowlist has exactly 5 top-level keys and `heartbeat_enabled` isn't one of them | **CONFIRMED** | `ipc-handlers.js:456-462` — key literally not in the merge object; Ben's live `config.json` lacks the key despite him having toggled it |
| H2 | `config-store.load()` drops `heartbeat_enabled` on READ for the same allowlist reason | **CONFIRMED** | `config-store.js:45-52` — same shape, 6 explicit keys, `heartbeat_enabled` absent. Compound with H1; fixing only H1 leaves the next app-restart re-reverting |
| H3 | Some background process (self-cleanup watchdog, orphan sweep, openai-invalid-flag watcher) rewrites `config.json` on a timer, clobbering the key | **UNLIKELY** | Grep for `saveConfig(` shows 6 sites; all are user-initiated flows (update-config, label/index/voice set, explicit migration, openai key-invalid auto-unset). None are timer-driven rewrites of unrelated keys |
| H4 | The ~30-min timing points at a `setInterval` refresh that overrides renderer state | **FALSE** | No interval touches `heartbeat_enabled`. The "~30 min" is just "how long until Ben next opened Settings". The bug manifests immediately on re-open, any time after toggle |
| H5 | Renderer `loadSettings()` races with in-flight `update-config`, re-reading stale CFG | **RULED OUT** | `loadSettings` calls `get-config` which returns the CFG set by `setCFG(merged)` — same broken `merged`. No race needed; the bug is in the merge shape itself |

**Compound diagnosis:** H1 is the write-side silent drop. H2 is the symmetric read-side drop that
would re-introduce the bug even if H1 were fixed (anyone hand-editing `config.json` to persist
`heartbeat_enabled: false` would see it lost at next load). Both must be patched.

### Pattern — adjacent keys at identical risk

Same bug shape applies to **two more top-level keys** the validator accepts (`config-validate.js`)
but that neither `update-config` nor `config-store.load()` round-trips:

- `selected_tab` (line 32)
- `tabs_expanded` (line 33)

If either is ever user-settable via UI + `updateConfig` partial, it'll silently fail persistence
the same way. **Out of scope for #1** — flagging so TT2 can open a follow-up QUEUE item (`#7
top-level-key-dropped-audit`) rather than expanding this item's scope.

### Proposed fix shape (draft — not yet committed code)

Two parallel changes, both minimal, both preserve byte-for-byte behaviour for the five already-
handled sub-objects:

- **Write (A):** `ipc-handlers.js` — add an explicit line preserving the scalar:
  `heartbeat_enabled: (partial.heartbeat_enabled !== undefined ? partial.heartbeat_enabled : cur.heartbeat_enabled)`. Narrow form — explicit per-key handling — is safer than a broad
  `{ ...cur, ...partial }` refactor because the validator's allowlist keeps unvalidated keys from
  sneaking through.
- **Read (B):** `config-store.js:load()` — add
  `heartbeat_enabled: typeof parsed.heartbeat_enabled === 'boolean' ? parsed.heartbeat_enabled : defaults.heartbeat_enabled`.
  Preserves the "invalid → defaults" contract.

Test to add (required before close per protocol): a new group `CONFIG PERSISTENCE ROUND-TRIP` in
`scripts/run-tests.cjs` that calls `saveConfig({ heartbeat_enabled: false, ...other })` then
`loadConfig()` and asserts the loaded object still has `heartbeat_enabled === false`. Minimal,
deterministic, catches both bug sites in one assertion.

## Tester findings — [TT? · HH:MM]

*(TT2 fills in: run Recipe A against live install, confirm `grep heartbeat_enabled config.json`
returns empty after the toggle-off step. Also try Recipe B to isolate bug A vs bug B.)*

## Tester findings — [TT? · HH:MM]

*(TT2 fills in: real `config.json` contents at each step of the recipe, any log lines observed,
exact timing of the revert if it can be triggered faster than 30 min.)*

## Root-cause diagnosis — [TT? · HH:MM]

*(Whoever finds it writes a paragraph: what actually causes the revert. Must identify the write
that clobbers the user's OFF setting, not just "config gets rewritten".)*

## Fix proposal — [TT? · HH:MM]

*(Code diff / PR link.)*

## Blast-radius check — [TT? · HH:MM]

- **Files touched:** *(to be filled)*
- **Features depending on those files (from MAP):** *(to be filled)*
- **Invariants spanning those files (from INDEX):** *(to be filled)*
- **Tests that MUST still pass:** *(to be filled)*
- **Tests at silent-regression risk:** *(to be filled)*
- **Settings / flag files possibly affected:** *(to be filled)*

## Causality

- **Root cause:** *(not symptom)*
- **How did this escape prior review?**
- **Is the fix addressing the cause or the symptom?**
- **Smallest fix that addresses the cause:**

## Devil's advocate — [OTHER TERMINAL · HH:MM]

*(The terminal that DID NOT draft the fix fills this. What could this change break that the
author didn't consider? Any feature in the MAP that shares state with the touched files?
If we ship this, what's the first report we'd expect from a user?)*

## New test that guards against regression

*(Required before close — file path + test name.)*

## Verification — [TT2 · HH:MM]

*(TT2 runs the fix against the original recipe in live install. Reports: bug reproduced pre-fix,
bug NOT reproduced post-fix, other features unaffected.)*

## Close-out checklist

- [ ] Bug reproduced on pre-fix install
- [ ] Fix applied; bug no longer reproduces
- [ ] New test in place and green
- [ ] `MAP/heartbeat-narration.md` updated with invariants discovered + files touched
- [ ] `INDEX.md` updated — new invariant row, new historical-bugs row
- [ ] Commit + push
- [ ] Move this file to `DONE/1-heartbeat-revert.md`
- [ ] Update `QUEUE.md` — #1 STATUS=done
