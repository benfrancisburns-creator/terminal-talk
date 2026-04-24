# ACTIVE #8 — session labels / pinned / speech_includes wiped from registry

- **Status:** in-test (TT2 emergency empirical capture; awaiting TT1 review of the JS-side load path)
- **Owner:** TT2 (tester only; TT1 needs to review root cause in `app/main.js loadAssignments` or adjacent)
- **Axes in play:** 1 (correctness), 2 (persistence), 7 (invariant enforcement)
- **Reported by:** Ben, live observation 2026-04-24T21:49
- **Escalation:** same bug class as #1 but on a DIFFERENT file and code path (registry, not config).
  This is user-hit regression on the ACTIVE toolbar — his customizations are being wiped live.

## Ben's report

> "In the toolbar the session IDs have gone; they're not there anymore. For some reason they've
> gone. I don't know why but it's worth me mentioning because I can see state that will need to
> be identified in the plan as well."

## What "session IDs missing" actually is (corrected)

The 8-char shorts (session IDs proper) are still present in `session-colours.json` —
`aef91e8e`, `a29f747b`. What's gone is:

- **Labels** ("TT 1", "TT 2", "mateain brain") — now empty strings
- **Pinned status** — `true` → `false` on every entry
- **Speech-includes overrides** — `{tool_calls: false}` → field absent entirely

Ben sees the toolbar's session rows showing raw 8-char hashes instead of his human labels; the
symptom presents as "session IDs gone" because the identifying info was the label, not the short.

## Evidence — diff of `~/.terminal-talk/session-colours.json` vs `.bak1`

### `.bak1` (previous save, state as of ~21:35)

```json
{
  "24d7d4fa": {
    "speech_includes": { "tool_calls": false },
    "index": 3, "label": "mateain brain", "pinned": true,
    "claude_pid": 27316, "session_id": "24d7d4fa-...", "last_seen": 1776986918,
    "focus": false, "muted": false
  },
  "a29f747b": {
    "speech_includes": { "tool_calls": false },
    "index": 4, "label": "TT 2", "pinned": true,
    "claude_pid": 14432, ..., "last_seen": 1777062950
  },
  "aef91e8e": {
    "speech_includes": { "tool_calls": false },
    "index": 0, "label": "TT 1", "pinned": true,
    "claude_pid": 24636, ..., "last_seen": 1777062933
  }
}
```

### Current (`session-colours.json`, ~21:40)

```json
{
  "aef91e8e": {
    "last_seen": 1777063239, "index": 1,
    "focus": false, "label": "",             ← WIPED
    "muted": false, "claude_pid": 40232,
    "session_id": "aef91e8e-...", "pinned": false   ← WIPED
    // no speech_includes at all             ← WIPED
  },
  "a29f747b": {
    "last_seen": 1777066848, "index": 0,
    "focus": false, "label": "",             ← WIPED
    "muted": false, "claude_pid": 31220,
    "session_id": "a29f747b-...", "pinned": false   ← WIPED
  }
  // 24d7d4fa entirely gone (maybe auto-pruned? was not `pinned`=true anymore, so eligible)
}
```

## Pattern match to #1 / #7

**Same bug class**, different file. In #1 the allowlist-merge dropped `heartbeat_enabled` on
every write. Here the write path (likely in `app/main.js ensureAssignmentsForFiles` +
`sanitiseEntry` + `saveAssignments`, or in the IPC handlers that mutate a session entry) is
rebuilding each entry with a subset of its original fields. The preserved fields this round:
`last_seen`, `index`, `focus`, `label` (but wiped to ""), `muted`, `claude_pid`, `session_id`,
`pinned` (but wiped to false). Missing: `speech_includes`, and **the VALUES of label + pinned
are reset to defaults rather than preserved.**

This is worse than #1 because it's not just "key not preserved" — it's "key rewritten to default
value, silently". A validator-level check wouldn't catch this.

## Candidate code paths (for TT1 review)

Not speculating on the exact bug, but the likely files to audit:

- `app/main.js` — `loadAssignments` (read path, allowlist symmetric to config-store.load()),
  `saveAssignments`, `ensureAssignmentsForFiles`, `sanitiseEntry`
- `app/lib/ipc-handlers.js` — any IPC handler that edits a session entry (set-label, set-pinned,
  set-speech-includes, remove-session). See the factory ~line 448+; analogous to update-config.
- `app/session-registry.psm1` — PS-side write path; already known to preserve these fields
  (Read-Registry explicitly has `if (... speech_includes ... )` preservation). So PS-side is
  probably not the culprit; focus on JS.

## Timing correlation

The timestamps in `.bak1` (ts ~1777062933 = 21:35) vs current (ts ~1777066848 = 22:40). Between
those two saves, one of the JS-side mutation paths wrote a new version stripping the fields.
Something Ben did between 21:35 and 22:40 triggered the stripping write.

Per TT1's earlier review of #1, the PS-side registry was audited clean; the same audit on the
JS side likely hasn't been done with equal rigour. Strong candidate for the root.

## What I need from TT1

When you finish #2 review: this is higher-urgency than #2 since Ben's LIVE customizations are
being wiped every time something writes the registry. Please:

1. Audit `app/main.js` + `app/lib/ipc-handlers.js` for all writes to `session-colours.json`.
2. Compare their field-preservation against the shape in `.bak1`.
3. Propose a fix + test (same narrow-per-key preservation pattern as #1).

Will treat as blocking fix. Happy to add an immediate detection to the `MAP/session-registry.md`
page when we have one — this also surfaces `#6 log-audit` (nothing in logs would have told us
this was happening; Ben only noticed because his labels visibly vanished).

## Close-out checklist

- [x] Empirical evidence captured (`.bak1` vs current diff)
- [x] Bug class identified (same as #1, different file)
- [ ] TT1 reviews JS-side write paths
- [ ] Root cause identified
- [ ] Fix + regression test
- [ ] Verify via live install: set label "foo" on a session, do anything that triggers a
      registry write, confirm "foo" survives
