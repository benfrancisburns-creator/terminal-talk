# ACTIVE #22 — window dock + display-rescue audit

- **Status:** audit-done (clean — no findings of substance)
- **Owner:** TT2
- **Axes in play:** 1 (correctness)
- **Opened:** 2026-04-25T01:25
- **Method:** code inspection of `app/lib/window-dock.js` (pure 79 LoC module).

## Surface

Two pure-geometry helpers: horizontal-edge snap detection + off-display window rescue.

## Invariants verified

- ✓ **I1 — Pure functions, no side effects.** No Electron imports, no BrowserWindow refs.
  Takes primitive numbers/objects, returns primitive decisions. Orchestration lives in
  main.js. Design matches testability goal stated in module header.

- ✓ **I2 — Negative overshoot counted as snap-eligible.** `findDockedEdge:37-38` — both
  top- and bottom-distance are tested against `< threshold`, so negative distances (window
  pushed past an edge) ALWAYS qualify regardless of threshold.

- ✓ **I3 — Edge tie-break is deterministic.** `findDockedEdge:43-44` — on tie between top
  + bottom (e.g., small screen, bar in middle), `sortKey(d) = Math.max(0, d)` normalises
  overshoots to 0, then ascending sort picks whichever was pushed first (top, since line
  37 fires before 38). Arbitrary but deterministic, so same input → same decision every
  call.

- ✓ **I4 — Rescue tests bar centre, not full window.** `clampToVisibleDisplay:53-54`
  comment explicitly: *"an expanded settings panel overflowing the bottom doesn't trip the
  rescue mid-drag"*. The bar centre (top barHeight px) is the user-visible anchor; settings
  panel can legitimately extend off-screen when expanded.

- ✓ **I5 — Rescue bails out if any display covers the bar.** `clampToVisibleDisplay:66-71`
  — `displays.some(d => centre-in-workArea(d))`. Multi-display setups: bar is valid if it's
  on ANY connected display, not just primary.

- ✓ **I6 — Rescue target is deterministic.** Falls back to primary display, centred
  horizontally, 12 px below top. Same recovery location every time.

## Adjacent check — `window.x/y/dock` persistence race (TT1 #3 flag)

TT1's #3 review flagged `window.x/y/dock` as "racy" with update-config. **Re-checked against
TT1's #1 fix (`0647460`):** the new `update-config` merge preserves `window`:

```js
if (partial.window !== undefined) merged.window = partial.window;
else if (cur.window !== undefined) merged.window = cur.window;
```

And `saveWindowPosition` at `main.js:266` mutates `CFG.window` in-place before `saveConfig`.
Because IPC handlers run single-threaded on the main thread's event loop, no interleave is
possible within a handler. Sequential writes (update-config OR saveWindowPosition, any
order) both preserve state correctly. ✓ **The race TT1 flagged appears resolved by the #1 fix.**

Recommendation: close the `window.x/y/dock racy` strand of #3 as fixed; track as an
invariant ("window field survives arbitrary interleaving of save-window-position and
update-config") and add a regression test that drives both paths in both orders.

## No new findings

Module is tight, testable, and well-considered. The thoughtful decisions (bar-centre
rescue, overshoot-as-zero-in-tie-break) suggest careful design review when it was extracted.

## Close-out

- [x] All 2 functions traced
- [x] 6 invariants verified
- [x] #3-window strand re-checked; appears resolved by TT1 #1 fix
- [x] No findings of substance
- [ ] Optional: add regression test for window-field preservation under update-config ×
      save-window-position interleaving (strengthens #3 closure)
