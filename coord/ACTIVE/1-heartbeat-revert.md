# ACTIVE #1 — heartbeat toggle reverts from OFF → ON after ~30 min

- **Status:** merged to main @ `ad973d2` (2026-04-24T23:40) — live-install verification pending (Ben upgrades install → toggle survives re-open-Settings). Close-out after Ben confirms.
- **Owner:** TT1 (reviewer + drafter), TT2 (tester + verification + Devil's-advocate on deck)
- **Axes in play:** 1 (correctness), 2 (persistence)
- **MAP page:** [`MAP/heartbeat-narration.md`](../MAP/heartbeat-narration.md)
- **Reported by:** Ben, live use, 2026-04-24

## User-reported symptom

> "I'm setting the heartbeat narration to off and then half an hour later I'm going back into the
> settings and it's back to on again."

## Reproduction recipe

*(To be written by TT1 reviewer. Must be deterministic — commands + wait times + observations, not
"click around and see what happens".)*

## Reviewer findings — [TT? · HH:MM]

*(TT1 fills in: code-path map from the toggle click to disk write, known state surfaces that hold
`heartbeat_enabled`, and any path that could write to those surfaces AFTER the user toggle.
Hypotheses ranked.)*

## Tester findings — [tt2 · 2026-04-24T21:38:00+01:00]

### Empirical confirmation of Bug A (live install, zero disruption required)

Ben's live `config.json` already exhibits the symptom — didn't even need to run Recipe A's
TRIGGER block to produce the evidence:

```
$ grep -c heartbeat_enabled ~/.terminal-talk/config.json
0

$ python -c "import json,pathlib; print(sorted(json.loads((pathlib.Path.home()/'.terminal-talk/config.json').read_text()).keys()))"
['hotkeys', 'openai_api_key', 'playback', 'speech_includes', 'voices']
```

Exactly the 5 top-level keys `ipc-handlers.js:456-462` hardcodes into `merged`. `heartbeat_enabled`
absent. Neither `selected_tab` nor `tabs_expanded` present either — same pattern.

**Ben's toggle is being silently dropped at the write path every time he flips it.** Bug A
confirmed on the live system, not a lab reproduction.

### Empirical confirmation of Bug B (source inspection)

Ran head on `app/lib/config-store.js` — the return literal inside `load()` at lines 47–54
explicitly lists 6 preserved top-level keys:

```js
return {
  voices: { ...defaults.voices, ...(parsed.voices || {}) },
  hotkeys: { ...defaults.hotkeys, ...(parsed.hotkeys || {}) },
  playback: { ...defaults.playback, ...(parsed.playback || {}) },
  speech_includes: { ...defaults.speech_includes, ...(parsed.speech_includes || {}) },
  window: parsed.window && typeof parsed.window === 'object' ? parsed.window : null,
  openai_api_key: parsed.openai_api_key ?? null,
};
```

`heartbeat_enabled`, `selected_tab`, `tabs_expanded` — all absent from the return literal. Even
if bug A were fixed and the write path persisted `heartbeat_enabled: false` to disk, this
read-side return would drop it before reaching the rest of the app. Bug B confirmed from source.

Skipped a runtime probe — the return literal is byte-level evidence; a dynamic test would only
echo it. A regression-guarding test belongs in the `## New test` block below, not as Tester
evidence.

### "~30 min" timing

Confirmed red herring per TT1 H4. The revert surfaces at *next Settings-panel open*, any time
after the toggle. Ben's 30-min figure is just how long he tends to wait before re-opening
Settings. No interval, no timer, no background rewrite — I re-checked `app/main.js` for any
setInterval touching `heartbeat_enabled` or `CFG`: only the 3 s openai-invalid flag poll, which
writes only `openai_api_key` and `playback.tts_provider`. None touch heartbeat.

### Verdict on TT1's fix shape

Agree on both sites. Narrow per-key preservation (`partial.x !== undefined ? partial.x : cur.x`)
rather than broad `{...cur, ...partial}` is correct: it keeps the validator's allowlist effective
as a gate against unvalidated keys sneaking through. Same for the read side.

The new round-trip test in `scripts/run-tests.cjs` (propose group `CONFIG PERSISTENCE ROUND-TRIP`)
must assert the scalar `heartbeat_enabled: false` survives `saveConfig → loadConfig`. That one
assertion catches both sites; if either drops the key, the test fails.

### Adjacent pattern (out-of-scope for #1, now item #7)

Opened QUEUE `#7 top-level-key-dropped-audit` per TT1's flag. `selected_tab` and `tabs_expanded`
are in the validator's allowlist but absent from both the write-path merge (Bug A's shape) and
the read-path return (Bug B's shape). Same class of bug, different keys. Deserves its own item
so the scope here stays tight to heartbeat.

### Go-ahead for TT1

Draft the two-site fix on `fix-pass`. I'll review the Blast-radius + Devil's-advocate blocks
before merge. New test must land in the same commit as the fix.

### Verification rig — [tt2 · 2026-04-24T21:43:00+01:00]

Built the Bug B regression probe BEFORE the fix landed, to prove the test design catches the bug
(Ben's "conduct tests that absolutely confirm it's fixed" discipline). Probe calls the real
`createConfigStore` from `app/lib/config-store.js`, seeds a JSON with `heartbeat_enabled: false`,
runs `load()`, asserts the key survives.

**Red result against current broken code** (exit 1):
```
SEED on disk had: heartbeat_enabled = false
LOAD returned:   heartbeat_enabled = undefined
LOAD returned top-level keys: [hotkeys, openai_api_key, playback, speech_includes, voices, window]
FAIL — Bug B confirmed. Test catches the bug.
```

Exactly the 6 keys in `config-store.js:47-54` return literal. `heartbeat_enabled` dropped on load.

### Proposed test drop-in for `scripts/run-tests.cjs`

Ready for TT1 to include in the fix commit (goes near the existing `MAIN.JS REGISTRY READ TOLERANCE` group ~line 1292):

```js
describe('CONFIG PERSISTENCE ROUND-TRIP', () => {
  // Regression guard for #1 heartbeat-revert + #7 adjacent-key audit.
  // If any validator-accepted top-level scalar is dropped by EITHER
  // ipc-handlers update-config merge OR config-store.load() return
  // literal, this group fails. Catches the whole bug class, not just
  // the specific instance.
  const { createConfigStore } = require(
    path.join(__dirname, '..', 'app', 'lib', 'config-store.js')
  );
  const { validateConfig } = require(
    path.join(__dirname, '..', 'app', 'lib', 'config-validate.js')
  );
  const DEFAULTS = {
    voices:          { edge_response: 'en-GB-RyanNeural' },
    hotkeys:         {},
    playback:        { speed: 1.25, tts_provider: 'edge' },
    speech_includes: { code_blocks: false },
    heartbeat_enabled: true,
    openai_api_key:    null,
    selected_tab:      'all',
    tabs_expanded:     false,
  };
  const tmpCfg = path.join(os.tmpdir(), `tt-roundtrip-${Date.now()}.json`);
  const clean = () => { try { fs.unlinkSync(tmpCfg); } catch {} };

  it('heartbeat_enabled=false survives save via store.save + re-load', () => {
    clean();
    const store = createConfigStore({ configPath: tmpCfg, defaults: DEFAULTS, validator: validateConfig });
    store.save({ ...DEFAULTS, heartbeat_enabled: false });
    const loaded = store.load();
    assertEqual(loaded.heartbeat_enabled, false, 'heartbeat_enabled must round-trip');
    clean();
  });

  it('selected_tab + tabs_expanded survive save → load (guards #7)', () => {
    clean();
    const store = createConfigStore({ configPath: tmpCfg, defaults: DEFAULTS, validator: validateConfig });
    store.save({ ...DEFAULTS, selected_tab: '7e5c9a', tabs_expanded: true });
    const loaded = store.load();
    assertEqual(loaded.selected_tab, '7e5c9a', 'selected_tab must round-trip');
    assertEqual(loaded.tabs_expanded, true,    'tabs_expanded must round-trip');
    clean();
  });

  // The IPC-handler merge path (Bug A) is a separate surface — exercised
  // via the update-config handler factory in app/lib/ipc-handlers.js.
  // TT1: suggest adding a third `it(...)` that builds the factory with
  // mock deps, calls the handler with { heartbeat_enabled: false }, and
  // asserts saveConfig was called with heartbeat_enabled:false preserved.
  // The two tests above guard Bug B end-to-end; a Bug A handler test
  // guards the merge allowlist directly.
});
```

**Verification flow post-fix:** on `fix-pass` with the patch applied, run
`node scripts/run-tests.cjs --verbose 2>&1 | grep -A5 "ROUND-TRIP"` and expect 2+ green. That
red→green transition is empirical proof the fix addresses the cause.

## Root-cause diagnosis — [TT1 · 23:15]

Two hardcoded top-level-key allowlists — one on the write path
(`app/lib/ipc-handlers.js` `update-config` handler, the merged-object
literal) and one on the read path (`app/lib/config-store.js` `load()`
return literal) — did not include `heartbeat_enabled`. Every Settings
toggle click funnelled `partial = { heartbeat_enabled: on }` through the
write-side merge, which rebuilt the persisted config from 5 hardcoded
keys and dropped the new one before `saveConfig`. Symmetric drop on
load. The validator (`config-validate.js RULES`) correctly accepted the
key but no code read from RULES, so it was a silent knowledge gap
between "keys the validator allows" and "keys the merge/load preserve".

Same defect shape on `selected_tab` and `tabs_expanded` — see #7.

## Fix proposal — [TT1 · 23:15]

Commit: *(this commit)* on `fix-pass`. Three files:

- `app/lib/ipc-handlers.js` lines ~456-472 — narrow per-key preservation
  for the three scalar keys (+ window rescued from the same drop) via a
  tiny `keepScalar(key)` helper. No broad spread that would let
  unvalidated keys leak into disk; gate still effective.
- `app/lib/config-store.js` lines ~45-60 — symmetric per-key
  preservation on load, with `defaults` fallback so downstream code can
  still trust the shape.
- `scripts/run-tests.cjs` — new `describe('CONFIG PERSISTENCE ROUND-TRIP')`
  group with 4 tests: Bug B heartbeat, Bug B selected_tab+tabs_expanded,
  RULES-driven iteration (forcing function), and a Bug A handler test
  that stubs `ipcMain` to assert the merge reaches `saveConfig` with the
  key intact.

Pre-fix: all 4 tests RED against the broken code (proof the rig catches
the bug). Post-fix: all 4 GREEN, full suite 777/777.

## Blast-radius check — [TT1 · 23:15]

- **Files touched:** `app/lib/ipc-handlers.js`, `app/lib/config-store.js`,
  `scripts/run-tests.cjs`.
- **Features depending on those files (from MAP/INDEX):**
  - `heartbeat-narration` (renderer → speak-heartbeat IPC gated on
    `CFG.heartbeat_enabled`)
  - tab selection + expand/collapse (`renderer.js:549`)
  - window position save/restore (already rescued via window branch)
  - every Settings form field (speech_includes, voices, playback,
    hotkeys, master_volume, palette_variant, tts_provider, ...). All of
    those route through the same `update-config` merge.
- **Invariants spanning those files:**
  - Config round-trip: every validator-accepted key must survive
    save→load. New invariant enforced by the RULES-driven test.
  - Atomic write semantics in `config-store.save()` — untouched.
- **Tests that MUST still pass:** all existing `config-validate`,
  `PALETTE PARITY`, `VOICE LIST VALIDATION`, `SPEECH INCLUDES`, and
  `AUTO-CONTINUE AFTER CLICK` groups rely on config-store behaviour. Ran
  full suite post-fix: 777/777 passed.
- **Tests at silent-regression risk:** none — the new `keepScalar`
  helper is a narrow per-key conditional, not a blanket spread. Unknown
  top-level keys still do not survive (desired; preserves the validator
  as a boundary).
- **Settings / flag files possibly affected:** `~/.terminal-talk/config.json`.
  First load on fixed code will include `heartbeat_enabled: true`
  (DEFAULTS fallback) since Ben's live file lacks the key. Subsequent
  toggles persist correctly. No migration script needed.

## Causality

- **Root cause:** hardcoded top-level-key allowlists diverged from the
  validator's `RULES` table. Adding a new validated scalar required
  three separate edits (RULES + write allowlist + read allowlist) with
  no forcing function. The fix restores symmetry between the three and
  adds a RULES-driven regression test so future additions fail loudly
  rather than silently drop.
- **How did this escape prior review?** The key was added to RULES
  (commit introducing heartbeat) but the two allowlists were not
  touched — reviewer saw the validator accept the key and assumed round-
  trip was intact. No test covered the full write→load cycle.
- **Is the fix addressing the cause or the symptom?** Cause. The symptom
  is "toggle reverts"; the cause is the allowlist gap. We're closing
  the gap and installing a RULES-driven test as a forcing function.
- **Smallest fix that addresses the cause:** this commit. A larger
  durable refactor (Fix-shape C: replace both allowlists with RULES
  iteration) would remove the coupling entirely; filed as follow-up
  rather than expanding scope here.

## Devil's advocate — [TT2 · 2026-04-24T23:32]

Pressure-tested TT1's 3 explicit questions + swept for latent risk. **Verdict: the fix ships.**

### Q1 — Window rescue + save-window-position interaction

Traced `saveWindowPosition` at `app/main.js:262-269`:
```
function saveWindowPosition() {
  const [x, y] = win.getPosition();
  CFG.window = { ...(CFG.window || {}), x, y };   // MUTATES CFG in place
  saveConfig(CFG);
}
```

CFG is a shared module-level mutable ref. Update-config reads `cur = getCFG()` which returns
the CFG ref. Mutation via `CFG.window = {...}` is in-place, so subsequent `getCFG()` inside
update-config sees the updated window. **No data loss.**

**Race window?** Electron IPC handlers + window-event listeners all run on the main thread's
JS event loop. Update-config (`ipcMain.handle('update-config', ...)`) is SYNCHRONOUS (no awaits).
Nothing can interleave between `getCFG()` and `saveConfig(merged)`. saveWindowPosition cannot
squeeze in mid-handler. ✓ Safe.

One subtle thing: `setCFG(merged)` creates a NEW CFG reference. After that, if saveWindowPosition
fires, it mutates the NEW merged CFG (by assignment `CFG.window = ...`). Still fine — main.js's
module-level `CFG` variable was reassigned by setCFG, so `CFG.window =` targets the current
ref. Verified ✓.

### Q2 — openai_api_key skip in RULES-driven test

The skip is correct. Reasoning:

- `openai_api_key` has `type: ['string', 'null']` in RULES but the real persistence path is
  `apiKeyStore` (encrypted sidecar). update-config always writes `openai_api_key: null` to the
  merged config literal (:461 → merged line in the actual fix).
- A round-trip `save → load` through config-store with a seeded `'sk-foo'` value WOULD appear
  to pass (parsed literal preserves via `?? null`), but that would be a misleading green — it
  would imply plaintext-in-config works, which is NOT the intended path.
- The skip correctly removes `openai_api_key` from the scalar-round-trip contract and defers
  coverage to apiKeyStore's own test surface.

**Blind spot check:** is apiKeyStore's round-trip covered? Worth a quick `grep 'apiKeyStore' scripts/run-tests.cjs` — if no coverage, that's a findings follow-up (NOT a blocker on this commit).
**Recommendation (non-blocking):** add one assertion that after `save({ openai_api_key: 'sk-foo' })` and `load()`, the returned `.openai_api_key` is `null` — documents the out-of-band-by-design contract. Can land in a follow-up.

### Q3 — `undefined` sentinel in keepScalar — no-delete semantics

Safe in current call patterns. Reasoning:

- `settings-form.js` call sites all send typed values (boolean / string / number) — never
  `undefined`, never `null` as a "delete" signal. Verified: heartbeat line 309 sends
  `{ heartbeat_enabled: !!checked }`.
- The codebase has no "remove a config key" operation. Wiping a setting means writing the
  default value back, not calling update-config with `{key: undefined}`.
- Forward-looking: if a future caller DID need delete-semantics, the pattern would need a
  sentinel swap (e.g. `null` → "use defaults"). Not a regression; just a constraint on future
  design. Document in code comment. **Non-blocking.**

### Latent risks TT1 didn't raise but I'd flag

- **R1 — Partial `{ playback: {} }` passthroughs.** `merged.playback = { ...cur.playback, ...(partial.playback || {}) }` spreads the partial second. If a caller sends `{ playback: { master_volume: 0 } }`, zero correctly overwrites. ✓
- **R2 — Empty `partial` (no keys).** Still merges correctly — `keepScalar` returns `cur[key]`
  for every scalar, sub-objects spread `cur.playback` alone. Outcome is a no-op round-trip.
  ✓ No data loss.
- **R3 — Concurrent update-config calls.** Rate-limited per `app/lib/rate-limit.js`. Since
  each handler is synchronous, concurrent calls are actually serialised by the event loop —
  can't race within the merge. ✓

### First report I'd expect from a user post-ship

None. The fix strictly restores persistence for keys that were silently dropped — no behaviour
regression possible on keys that previously worked. If anything surfaces, it's an edge case in
`_populateHeartbeat` / `_populateSelectedTab` on re-opening Settings after a save, and the
round-trip tests don't exercise the renderer populate path. But that's an F4-class UI test,
not a round-trip bug.

**Cleared to merge. 777 tests passing on fix-pass validates the contract.**

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
