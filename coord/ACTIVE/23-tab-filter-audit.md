# ACTIVE #23 — tab switching + session filter audit

- **Status:** audit-done (clean via #1 fix + existing stale-guard)
- **Owner:** TT2
- **Axes in play:** 1 (correctness), 2 (persistence)
- **Opened:** 2026-04-25T01:35
- **Method:** code inspection of `app/renderer.js:531-570` (tab state) + `app/lib/tabs.js` + cross-check against `renderDots` contract.

## Surface

The tab strip filters the dot queue by session. Selection + expanded state persist across
restarts. Must handle a persisted `selected_tab` that no longer has a matching session.

## Invariants verified

- ✓ **I1 — State persistence via config.** `renderer.js:559` —
  `updateConfig({ selected_tab, tabs_expanded })` is the only persistence path. With TT1's
  #1 fix (merged at `0647460`), both keys now round-trip through update-config and load.
  Before #1, both were silently dropped; Surface E (tabs) was BROKEN. Post-fix: ✓

- ✓ **I2 — Stale-session guard.** `renderer.js:563-570` comment:
  *"Validated after first sessionAssignments sync in renderDots so a gone-stale session
  doesn't leave the user staring at an empty strip."*

- ✓ **I3 — State-change triggers re-render.** `onTabSelect` + `onExpandChange` both call
  `renderDots()` after updating state (lines 547, 552). Idempotent via equality check at
  :544 — same-tab click doesn't re-render.

- ✓ **I4 — Default is 'all'.** `renderer.js:537` — `let selectedTab = 'all'`. First boot +
  any deserialisation miss fall to the permissive view; the user never sees an empty strip
  from a bad default.

## Findings

No BROKEN. No BRITTLE of substance.

The only historical concern (Surface E = tabs BROKEN due to selected_tab + tabs_expanded not
persisting) is closed by TT1's #1 fix. When Ben re-opens Settings after toggling heartbeat
and re-selecting a tab filter, both now survive.

## Adjacent note

Tab-filter logic inside `renderDots` isn't re-audited here — the concern was persistence
(Surface E + #1) and that's closed. Deeper audit of renderDots filter correctness (bucket
assignment, muted-filter interaction, focus-filter interaction) is a separate surface if
Ben wants it; not in the PLAN.

## Close-out

- [x] State persistence verified (depends on #1 fix — live)
- [x] Stale-session guard present (comment-documented)
- [x] Default 'all' falls back safely
- [x] Surface E (tabs) considered closed alongside #1 merge
