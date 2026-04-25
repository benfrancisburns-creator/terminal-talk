# ACTIVE #27 — voice-command pipeline audit

- **Status:** audit-done (2 doc-drift findings; no BROKEN)
- **Owner:** TT2
- **Axes in play:** 1 (correctness), 6 (observability), 7 (invariant)
- **Opened:** 2026-04-25T08:55
- **Method:** code inspection of `app/voice-command-recognize.ps1` + caller chain
  (`app/wake-word-listener.py`) + dispatch sink (`app/main.js` VOICE_COMMAND_ALLOWED +
  `app/lib/voice-dispatch.js`).

## Surface

The voice-command pipeline:

```
wake-word fires (openWakeWord) → wake-word-listener.py captures ~2.5s WAV
        ↓
voice-command-recognize.ps1 (System.Speech.Recognition + programmatic grammar)
        ↓ JSON: {"action":"play","confidence":0.87}
wake-word-listener.py parses + filters by MIN_CONFIDENCE
        ↓ writes voice-command.json
main.js startVoiceCommandWatcher polls every 50ms
        ↓ checks against VOICE_COMMAND_ALLOWED whitelist
voice-dispatch.js dispatch(action) → audio state transition
```

## Verified invariants

- ✓ **I1 — Programmatic grammar.** `voice-command-recognize.ps1:54-67`. Built via Choices +
  GrammarBuilder, no SRGS XML, no `xml:lang` binding. Robust across en-GB / en-US locales
  (rationale at lines 9-15).
- ✓ **I2 — Synonym collapse.** `phraseToAction` maps 10 phrases → 7 canonical actions
  (skip→next, again/previous→back). User vocabulary is wider than action surface; collapse
  happens in PS so the action-set crossing main.js is exactly 7 stable values.
- ✓ **I3 — VOICE_COMMAND_ALLOWED matches.** `main.js:1847-1849` declares the whitelist as
  exactly the 7 action values phraseToAction emits. ✓
- ✓ **I4 — Confidence gate.** `wake-word-listener.py:128` defines `MIN_CONFIDENCE` and line
  328 gates dispatch on `confidence >= MIN_CONFIDENCE`. Below-floor matches go to a
  low-confidence diag + debug-WAV capture (`_voice-debug/lowconf-*.wav`). No silent
  acceptance of weak matches.
- ✓ **I5 — Always emits parseable JSON.** `voice-command-recognize.ps1` always outputs
  either a `{...}` or `{}` to stdout. The catch block ensures even .NET load failures don't
  break the parser (line 95-99). Caller never sees malformed output.
- ✓ **I6 — Time-bounded recognition.** `Recognize([TimeSpan]::FromSeconds(3))` caps the
  call at 3s so a malformed WAV can't stall the pipeline (line 74).
- ✓ **I7 — Resource cleanup.** `$recognizer.Dispose()` in finally block; defensive `if
  ($recognizer)` guard against undefined-on-load-fail (line 100-103).
- ✓ **I8 — voice-dispatch correctness.** Already audited in #14 (Surface H). State machine
  handles play/pause/resume/next/back/stop/cancel + idempotent / fallback / scrubbing edge
  cases.

## Findings

### ~ F1 (low) — Exit-code doc-comment drift in `voice-command-recognize.ps1`

**Site:** lines 28-30:

```
# Exit code:
#   0 on any outcome (even no match — caller parses JSON)
#   1 on setup failure (.NET class load fail)
```

**Reality:** the catch block at line 94-99 catches setup failures, writes `{}` to stdout +
`Write-Error` to stderr. The script then runs to end → **exits 0, not 1.** No `throw` or
`exit 1` in the catch path.

**Severity:** low. Caller (`wake-word-listener.py`) parses stdout JSON; doesn't check exit
code. Functionally correct. Documentation-only drift.

**Fix shape:** either (a) update the doc comment to say "exit 0 on any outcome (setup
failure surfaces only via stderr Write-Error)", or (b) add `exit 1` after Write-Output
'{}' in the catch block to actually match the docs. (a) is safer (no behaviour change).

### ~ F2 (low) — Stale lock-step comment

**Site:** lines 17-19:

```
# Keep this vocab in lock-step with ../scripts/run-tests.cjs
# VOICE_COMMAND_ALLOWED + main.js VOICE_COMMAND_ALLOWED. If you add a
# new verb, update both.
```

**Reality:** `grep VOICE_COMMAND_ALLOWED scripts/run-tests.cjs` returns nothing. The
constant only exists in `main.js`. The doc comment promises a triple-lock-step that's
actually a double-lock-step.

**Severity:** low. Either update the comment to drop the run-tests reference, OR add a
forcing-function test in run-tests.cjs that:

```js
it('voice-command vocab in lock-step across PS + JS', () => {
  // Read phraseToAction keys from voice-command-recognize.ps1 source.
  // Read VOICE_COMMAND_ALLOWED from main.js source.
  // Assert: every phraseToAction VALUE is in VOICE_COMMAND_ALLOWED.
  // Assert: every VOICE_COMMAND_ALLOWED member appears as a phraseToAction value.
});
```

The forcing function is the better fix — drift becomes a CI red flag.

### ✓ Positive observations

- Unrecognised `$result.Text` outside `phraseToAction` keys → `{}` (line 84-90). Belt-and-
  braces against grammar/recognizer mismatch. Defensive design.
- Empty WAV / silence → `{}` (line 91-93). Same.
- Multi-word phrases NOT supported — single-word grammar by design. Documented intent.

## Disposition

Two trivial documentation/test-coverage follow-ups (F1 + F2). No real bugs. Pipeline is
correct + observable.

Suggest opening:
- **#28** — F2 forcing-function test (small, clear value). Either lane.
- F1 fix is a one-line comment edit; can fold into any commit touching this file.

## Close-out

- [x] Pipeline traced end-to-end (5 stages)
- [x] 8 invariants verified
- [x] F1 doc-drift identified
- [x] F2 stale lock-step comment identified
- [x] No BROKEN findings
- [ ] #28 forcing-function test (optional follow-up)
