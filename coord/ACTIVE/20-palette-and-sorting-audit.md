# ACTIVE #20 — palette allocation + session sorting audit

- **Status:** audit-done (palette clean; 1 lead for #8 surfaced in adjacent code)
- **Owner:** TT2
- **Axes in play:** 1 (correctness), 7 (invariant)
- **Opened:** 2026-04-25T01:00
- **Method:** code inspection of `palette-alloc.js`, `sanitiseEntry`, `ensureAssignmentsForFiles`, `sessions-table.js` sort logic.

## Surface

When a new session short arrives in the queue, how does it get a palette index? When the
existing slots are full, who gets evicted? When the sessions table renders, in what order do
sessions appear?

## Verified invariants

- **I1 — 3-level allocator.** `palette-alloc.js:28-89` — (1) lowest free index in 0..size-1,
  (2) LRU eviction of entries with NO user intent, (3) hash-mod as last resort. Returns
  `{ index, evicted, reason }`, pure / side-effect-free. ✓
- **I2 — `hasUserIntent` eviction guard.** `palette-alloc.js:55-61` — an entry is protected
  from LRU eviction if pinned OR has a label OR voice OR muted OR focus OR speech_includes
  override. Covers all 6 forms of "user configured this; don't throw away". ✓
- **I3 — Defensive paletteSize clamp.** `palette-alloc.js:35` — non-finite or ≤0 sizes snap
  to 24. Prevents `NaN = x % 0` rendering bug. Comment confirms this was caught by
  2026-04-23 Phase 4 audit. ✓
- **I4 — LRU tiebreak is stable.** `palette-alloc.js:64-69` — last_seen ascending, then
  shortId ascending. Deterministic across runs. ✓
- **I5 — Sort by index is stable.** `sessions-table.js:164` —
  `entries.sort((a, b) => (a[1].index || 0) - (b[1].index || 0))`. Colour arrangement
  consistent across renders. ✓

## Lead for #8 investigation (surfaced in adjacent code)

Not a Surface I bug, but worth flagging for the #8 watcher-capture debrief:

**ensureAssignmentsForFiles fresh-alloc path** (`app/main.js:1340-1368`). When a session
short is in the queue but not in `all`, a new entry is created with:

```js
all[short] = {
  index: alloc.index,
  session_id: short,
  claude_pid: 0,
  label: '',         // ← wiped
  pinned: false,     // ← wiped
  last_seen: now
};
```

**Candidate path for #8 "label wiped, pinned=true observed"**: if `sanitiseEntry`
(`main.js:1149-1182`) drops an entry (returns `null` for out-of-range `index`, non-object,
etc.), `loadAssignments` filters it out. Next `ensureAssignmentsForFiles` call sees the
short as "new", triggers the fresh-alloc with `label=''`.

**BUT** — we observed `pinned=true` survived the wipe. Fresh-alloc sets `pinned=false`. So
either:

- A different path resurrects the entry with mixed state (JS-side wipes label, PS-side keeps
  pinned via `Update-SessionAssignment`), OR
- `sanitiseEntry` keeps the entry but zeros some fields (currently it returns a new object
  with `label: ... slice(0, 60) : ''` — if input.label is non-string, it gets coerced to
  ''), OR
- A write race between JS fresh-alloc and PS hook means one writer sets label='' while
  another sets pinned=true independently.

**Probe TT1 can run when drafting #8 fix:** inject a test that calls `sanitiseEntry` with a
well-formed label='foo' pinned=true entry + verifies BOTH survive. Then call with
label=42 (non-string) + pinned=true + verifies label→'' but pinned stays true. That replicates
the observed wipe pattern and would confirm the bug class.

Filing this as observation on #8 (ACTIVE/8), not a separate queue item.

## Findings matrix

| Feature | Verdict | Notes |
|---|---|---|
| Lowest-free index allocation | ✓ works | |
| LRU eviction with user-intent guard | ✓ works | 6-field `hasUserIntent` guard |
| Hash-mod collision fallback | ✓ works | With defensive paletteSize clamp |
| Stable tiebreak on eviction | ✓ works | last_seen asc, shortId asc |
| Sessions-table sort by index | ✓ works | Simple numeric sort |
| Field-shape validation on load | ✓ works | `sanitiseEntry` |
| #8 wipe class (adjacent) | ~ candidate path in ensureAssignmentsForFiles | flagged for TT1's #8 fix draft |

## Regression test gaps

Existing test coverage for `allocatePaletteIndex` is solid (audit 2026-04-23 Phase 4 Module
2 already pinned paletteSize=0 + every branch). Gap:

- No test asserts that `sanitiseEntry` + `loadAssignments` + `ensureAssignmentsForFiles`
  as a SEQUENCE preserve user-intent fields when called on a realistic input. The unit tests
  cover each in isolation; the fresh-alloc trip-hazard emerges only in the sequence. Pairs
  with the #8 round-trip test group TT1 already drafted.

## Close-out

- [x] palette-alloc fully audited, clean
- [x] sessions-table sorting verified
- [x] 5 invariants documented
- [x] #8 adjacent lead surfaced, flagged for TT1
- [x] Regression test gap identified (sequence-level `sanitise` + `ensure` coverage)
