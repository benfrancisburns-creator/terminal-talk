# ACTIVE #7 — top-level-key-dropped-audit

- **Status:** in-test (audit-from-source complete; test drop-in drafted)
- **Owner:** TT2 (empirical-only per perpetual-motion; no reviewer needed — pattern established by #1)
- **Axes in play:** 2 (persistence), 7 (invariant enforcement)
- **Claimed:** 2026-04-24T21:48
- **Relates to:** #1 (same bug class). Must land after or together with #1's fix.

## Scope

Every top-level scalar key the validator (`app/lib/config-validate.js`) accepts must round-trip
through `config-store.save → config-store.load`. Today three of four fail silently. Add a test
that fails if ANY validator-accepted scalar is absent from either allowlist.

## Audit — from source, 2026-04-24T21:48

Top-level scalar keys accepted by `config-validate.js RULES` (filtered out object-typed rules and
nested-dot paths):

| Key | Validator type | Preserved by `config-store.load()`? | Evidence |
|---|---|---|---|
| `heartbeat_enabled` | boolean | ❌ DROPPED | not in return literal at `config-store.js:47-54` |
| `openai_api_key` | string \| null | ✅ preserved | `openai_api_key: parsed.openai_api_key ?? null` in return literal |
| `selected_tab` | string | ❌ DROPPED | not in return literal |
| `tabs_expanded` | boolean | ❌ DROPPED | not in return literal |

3 of 4 scalars silently dropped. Same class of bug as #1. Same allowlist-vs-rules asymmetry in
`ipc-handlers.js:456-462` (update-config merge).

## Fix shape (for TT1 or whoever drafts)

Same pattern as #1 — narrow per-key preservation at BOTH sites:

- `config-store.js:load()` return literal:
  ```js
  selected_tab: typeof parsed.selected_tab === 'string' ? parsed.selected_tab : defaults.selected_tab,
  tabs_expanded: typeof parsed.tabs_expanded === 'boolean' ? parsed.tabs_expanded : defaults.tabs_expanded,
  ```
- `ipc-handlers.js:update-config` merged object:
  ```js
  selected_tab: partial.selected_tab !== undefined ? partial.selected_tab : cur.selected_tab,
  tabs_expanded: partial.tabs_expanded !== undefined ? partial.tabs_expanded : cur.tabs_expanded,
  ```

## Test

The `CONFIG PERSISTENCE ROUND-TRIP` group drafted for #1 (see `ACTIVE/1-heartbeat-revert.md`
"Proposed test drop-in") already includes a test for `selected_tab` + `tabs_expanded`. That test
closes #7 when it lands alongside #1's fix.

**Bonus — programmatic audit test.** Even stronger guard: a new test that enumerates the
validator RULES table, filters to top-level scalar keys (no dots, non-object type), and
round-trips each. Catches the next time someone adds a new top-level scalar to the validator but
forgets to plumb it through. Suggested location: in the same `CONFIG PERSISTENCE ROUND-TRIP`
group, added by TT1 when drafting #1's fix.

Pseudocode:
```js
it('all validator-accepted top-level scalars round-trip (catches next-time)', () => {
  const { RULES } = require(path.join(__dirname, '..', 'app', 'lib', 'config-validate.js'));
  const scalarRules = RULES.filter(r => !r.path.includes('.') && r.type !== 'object');
  for (const rule of scalarRules) {
    // seed a distinctive value for this key, save, load, assert preserved
    // ...
  }
});
```

Would require `config-validate.js` to export RULES. If non-trivial, defer to a follow-up and
lean on the enumerated tests for now.

## Close-out checklist

- [x] Audit every validator-accepted top-level scalar against `load()` return literal
- [x] Findings documented with line-refs
- [x] Fix shape proposed (narrow per-key preservation, same as #1)
- [x] Test drop-in written (as part of #1's CONFIG PERSISTENCE ROUND-TRIP group)
- [ ] Fix landed (tracked with #1 — same commit)
- [ ] Close when #1 closes
