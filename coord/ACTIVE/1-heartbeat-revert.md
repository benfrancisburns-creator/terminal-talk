# ACTIVE #1 — heartbeat toggle reverts from OFF → ON after ~30 min

- **Status:** in-review (TT1 claimed 2026-04-24T21:16)
- **Owner:** TT1 (reviewer), TT2 (tester on deck)
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
