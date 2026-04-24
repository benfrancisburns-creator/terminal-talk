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
