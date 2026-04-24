# PLAN — systematic feature-by-feature coverage

**Opened:** 2026-04-24T23:15 · TT2
**Driver:** Ben's push — prior assessments said "fixed" but features don't all behave as intended.
Queue-driven fixes only close REPORTED issues. We need proactive coverage.

## Framing — why queue-driven alone is insufficient

The coord/ QUEUE is reactive. Items #1–#10 all started from a Ben observation or a reviewer's
code-path audit that triggered on a suspected class. That catches reported bugs but leaves
this class uncovered:

- **Features that partially work** — toggles that take effect once but forget on restart (#1).
- **Dead declarations** — validator rules with no UI writer (F3 in #11 audit).
- **Features that work but lack validation / tests** — voice dropdowns (F1), speech_includes
  sub-keys (F2).
- **Features that work but with brittle edge cases** — window.x/y racy with update-config.

A systematic audit pass that enumerates every feature + tests it against its contract surfaces
these without waiting for a Ben-visible regression.

## The coverage spine

Every surface in the app is audited. For each feature:

1. **Contract** — one-line statement of what should happen on user interaction + on restart.
2. **Probes** — concrete steps to verify. Code-inspection + empirical where possible.
3. **Findings matrix** — ✓ works / ✗ broken / ~ brittle, with file:line + fix shape.
4. **Regression tests** — one per finding, RED before fix lands.

## The coverage inventory

Roughly 12 feature surfaces. Prioritised by user-facing blast radius.

| # | Surface | Contract | QUEUE item | Status |
|---|---|---|---|---|
| A | Settings panel (17 controls) | every control persists + takes effect | #11 | ✓ audited — F1/F2/F3/F4 opened, #1/#3/#7 already in queue |
| B | Heartbeat narration (HB1+HB2) | clips fire when Claude thinks; stop when body lands; pause when mic captured | #2 | partial — TT1 reviewed, path discriminator outstanding |
| C | Session registry (labels/pinned/voice/muted/focus/include) | every edit survives every save-path + restart | #8 | watcher running; empirical capture pending |
| D | Mic-aware auto-pause | heartbeat + body playback both pause while Wispr holds the mic | — | Ben says working; needs audit to confirm |
| E | Tabs (selection + expanded state) | selected filter persists; expanded/collapsed persists | #1 (shared fix) | broken via allowlist-drop |
| F | Tab switching + session filter | only the selected tab's sessions render | — | not yet audited |
| G | Voice dispatch (edge vs openai, response vs clip) | correct voice used for response body vs heartbeat clip vs tool narration | — | not yet audited; F1 suggests incomplete validator |
| H | Playback controls (play/pause, back10, fwd10, scrubber, clearPlayed) | keyboard shortcuts + buttons both work; state survives reloads | — | not yet audited |
| I | Session sorting + palette allocation | colours stable across restarts; index drag-reorder persists | — | not yet audited |
| J | Speech-includes filtering (sanitiser) | checked boxes = speak; unchecked = omit; applies to code/inline/URL/heading/bullet/image-alt | — | sub-key validator gap (F2); logic not yet audited |
| K | OpenAI key flow (save, clear, test, auto-unset on 401, rotate) | saved key encrypted; 401 auto-unsets; test button synthesises | — | not yet audited |
| L | Window dock (left/right) + position | window x/y persists; dock edge persists; re-dock after monitor change | — | TT1 #3 flagged racy; not yet audited |

## Cadence

Two terminals per the perpetual-motion rule. Suggested split:

- **TT1 (reviewer)** — picks a surface, reads the code end-to-end, fills the Contract section,
  and the code-path audit. Commits a review block on `fix-pass`.
- **TT2 (tester)** — runs probes (live-install observation + synthetic harness), fills the
  Findings matrix, writes regression tests that trip on any broken invariant. Commits to `main`.

Handoff = async via INBOX. When a surface's review + tests are both committed, it enters
`in-fix`. TT1 drafts the fix (shared test now RED-confirmed, GREEN after). TT2 verifies + Devil's-
advocate. Close = both committed + round-trip test landed.

## Proposed first rotation (autonomous work items ready NOW)

While blocked on Ben for Path A/B discriminator on #2, TT2 can proceed autonomously on:

1. **Surface G — Voice dispatch audit**. Code: `app/lib/voice-dispatch.js` + synth_turn.py voice
   selection logic. Contract: per clip type (response, heartbeat, tool, notification) the right
   voice is used per the tts_provider setting.
2. **Surface J — Speech-includes filtering audit**. Code: `app/wake-word-listener.py` or the
   sanitiser (find the actual module). Contract: per sub-key, checked → included in TTS,
   unchecked → stripped before synth.
3. **Surface H — Playback controls audit**. Code: `app/renderer.js` event handlers. Contract:
   every button + keyboard shortcut produces the expected state transition.

Each delivers a similar ACTIVE file to #11 (matrix + findings + fix shapes + test shapes).

## Success criteria for this loop

- All 12 surfaces have an ACTIVE audit file with findings matrix.
- Every ✗ BROKEN or ~ BRITTLE finding has a QUEUE item + round-trip regression test.
- `scripts/run-tests.cjs` has a `FEATURE COVERAGE` family with one describe per surface.
- The 2-week bug-rate drops because most user-surfaced regressions now fail a test before ship.

## Non-goals

- New features. Purely robustness + coverage of existing features.
- Aesthetic fixes (UI copy, spacing) unless they mask a logic bug.
- Retroactive refactoring — only touch a module if its audit turns up a broken invariant.
