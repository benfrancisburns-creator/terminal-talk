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

## Reviewer audit — [tt1 · 2026-04-24T22:20:00+01:00]

### Every write path to `session-colours.json`, audited

**JS side (5 surfaces):**

| # | Site | Pattern | Field-preservation? |
|---|---|---|---|
| J1 | `main.js:1368` `ensureAssignmentsForFiles` | prune (isSessionLive) then fresh-alloc for new shorts | **Preserves** existing entries; only TOUCHES entries flagged not-live. **New-alloc creates defaults** (label='', pinned=false, no speech_includes) — expected for genuinely-new shorts |
| J2 | `main.js:1254` `loadAssignments` backup-recovery writeback | `writeAssignments(b, { skipBackup: true })` with b = backup's _parseRegistryFile output | Preserves — sanitiseEntry input → sanitiseEntry output is identity for well-formed entries |
| J3 | `main.js:saveWindowPosition` → `saveConfig` | doesn't touch registry | N/A |
| J4 | `ipc-handlers.js` set-session-label / index / focus / muted / voice / include (6 handlers) | direct mutation: `all[shortId].X = newValue` then saveAssignments | **Preserves** — single-field assignment, other fields untouched |
| J5 | `ipc-handlers.js:232` remove-session | `delete all[shortId]` then saveAssignments + queue-file purge | **Preserves** remaining entries |

**PS side (3 surfaces, all going through `session-registry.psm1`):**

| # | Site | Pattern | Field-preservation? |
|---|---|---|---|
| P1 | `statusline.ps1:164-172` | `Enter-Lock → Read → Update-SessionAssignment → Save → Exit-Lock` | Depends on which Update branch fires (below) |
| P2 | `speak-response.ps1:149-156` | same triplet | same |
| P3 | `speak-on-tool.ps1:69-77` | same triplet | same |

**`Update-SessionAssignment` branches** (`session-registry.psm1:155-284`):

| Branch | Line | Field-preservation? |
|---|---|---|
| Existing-short hit | 183-188 | **Preserves** — mutates last_seen/session_id/claude_pid in place, other fields stay |
| PID-migration hit | 216-223 | **Preserves** — `$migrated = $Assignments[$oldShort]` is a hashtable reference; mutate three fields, re-key to new short. All other fields carried over |
| Fresh-allocation | 274-283 | **Creates defaults** — `label=''`, `pinned=$false`, `muted=$false`, `focus=$false`, no speech_includes. Expected for genuinely-new shorts |
| LRU-eviction → fresh | 243-271 | **Evicts some OTHER entry** (with no user-intent), then fresh-allocates (defaults) |

**Round-trip integrity:**

- `Read-Registry` (`session-registry.psm1:101-153`) — explicitly preserves label, pinned, muted, focus, last_seen, voice, speech_includes for ALL existing fields.
- `Save-Registry` (`session-registry.psm1:287-307`) — `ConvertTo-Json -Depth 5` on the hashtable, no field filtering.
- `sanitiseEntry` (`main.js:1149-1176`) — preserves label, voice, speech_includes when well-typed; strict `pinned: e.pinned === true` check which correctly handles JSON boolean `true`.

### What that audit tells us

**No direct code path in the read/write triplets visibly wipes label/pinned/speech_includes** for
an existing entry. The only patterns that produce default-value entries are:

1. **Fresh-allocation in Update-SessionAssignment** (PS) when a truly new short appears.
2. **Fresh-allocation in ensureAssignmentsForFiles** (JS) when a queue file references a short
   not in the current `all` object.

The evidence in Ben's diff (pinned changing from `true` → `false` while session shorts are
preserved) is consistent with **the entries being DELETED and re-created** via path 1 or 2 above,
NOT modified in place. Which means something upstream pruned the entries first.

### The culprit — most likely scenarios, ranked

| # | Hypothesis | Evidence | Next test |
|---|---|---|---|
| **H1** | `/clear` in Claude Code rotates the short (first 8 hex of session_id) outside the PidMigrateWindowSec (10 min). Old pinned entry sits stale. New short gets fresh-allocated in PS with defaults. Eventually the old short's claude_pid dies, 4h grace expires, ensureAssignmentsForFiles prunes the old pinned-true entry by... wait, pinned=true should survive prune. Unless last_seen updates on old entry stopped when CLI reused its PID for the new short and the PID-migration hit, but fresh-alloc ALSO ran because the migration window had passed | **PARTIAL** | Check if Ben ran `/clear` between 21:35 and 22:40 after >10 min of idle. Check `hooks.log` for PS hook timestamps |
| **H2** | PID-reuse race — `isPidAlive` in main.js returns true when Windows reused the same PID for an unrelated process, keeps an entry alive that should've been pruned. Conversely, an entry whose PID was reused could trip the migration branch on a NEW terminal and get its fields stolen by that new session | UNCONFIRMED | Look at each current entry's claude_pid against Ben's actual Claude CLI PIDs in Task Manager at the moment of the write |
| **H3** | Backup-recovery path (`loadAssignments:1246-1258`) fires because primary parses as empty, recovers from `.bak1`, writes back via `writeAssignments(b, { skipBackup: true })`. But if primary WASN'T empty — just missing one entry — no recovery fires, and the half-wiped state persists | UNCONFIRMED | Audit whether `primary.length == 0` is the right check or should be "any valid entry present" |
| H4 | A bug I haven't found in the read/write code | Possible | Would need a live `inotifywait`-style file watcher to capture the exact sequence of reads/writes that preceded a user-customization-wipe |

### What TT2 should try next (if context permits before compact)

1. **Real-time registry watch during a customization-wipe:**
   ```
   # Terminal 1 (background watcher):
   while true; do
     if [ "$(stat -c %Y ~/.terminal-talk/session-colours.json 2>/dev/null)" != "$PREV" ]; then
       PREV=$(stat -c %Y ~/.terminal-talk/session-colours.json)
       echo "=== CHANGE at $(date +%T.%3N) ==="
       cat ~/.terminal-talk/session-colours.json | python -c "import json,sys; d=json.load(sys.stdin); \
         print(json.dumps({k: {'label':v.get('label',''), 'pinned':v.get('pinned'), 'pid':v.get('claude_pid')} for k,v in d['assignments'].items()}, indent=2))"
     fi
     sleep 0.5
   done
   ```
   Let it run. Have Ben set a label "TESTWIPE" on one session. Then do whatever he usually does
   (submit prompts, switch sessions, `/clear`, etc). The watcher will log every mutation. The
   PRECEDING mutation before TESTWIPE vanishes is the culprit code path.

2. **Also capture hook log** at `~/.terminal-talk/queue/_hook.log` (or wherever PS hooks log
   per mark-working.ps1:18) — correlates which PS hook ran when.

3. **Check PID-migration-window overflow:** `_hook.log` has timestamps; compute time between
   consecutive hook fires for the SAME claude_pid. If any gap > 600 sec, /clear-after-idle
   would create a fresh entry.

### Fix proposal — regardless of which hypothesis fires

The test that would have caught this class of bug:

```js
// scripts/run-tests.cjs — SESSION REGISTRY ROUND-TRIP group
describe('SESSION REGISTRY ROUND-TRIP (preserve user intent)', () => {
  it('write entry with every field set → round-trip through save→load preserves all', () => {
    const entry = {
      index: 3, session_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      claude_pid: 12345, label: 'mateain brain', pinned: true,
      muted: false, focus: false, last_seen: 1776986918,
      voice: 'en-GB-RyanNeural',
      speech_includes: { tool_calls: false, urls: true }
    };
    // saveAssignments({ aaaaaaaa: entry }) then loadAssignments()
    // assert every field unchanged.
  });

  it('create entry, then ensureAssignmentsForFiles round-trips without wiping user intent', () => {
    // Seed pinned+labelled entry. Run ensureAssignmentsForFiles with
    // a queue file referencing a DIFFERENT short. Assert the original
    // entry is unchanged — no fields stripped.
  });

  it('PID-migration preserves label+pinned+speech_includes', () => {
    // Seed entry with user-intent. Invoke Update-SessionAssignment
    // with a NEW short but same claude_pid within migration window.
    // Assert migrated entry has all original intent fields.
  });

  it('Update-SessionAssignment fresh-alloc does NOT touch existing entries', () => {
    // Seed entry A with labels + speech_includes.
    // Invoke Update for a completely new short (outside migration window).
    // Assert entry A is unchanged; new entry has defaults (expected).
  });
});
```

Any future write path that loses a user-intent field fails these tests.

### Fix shape — AFTER empirical narrowing

Depends on which hypothesis fires. But in all cases the fix is likely:

- **If H1 (PidMigrateWindowSec expiry):** Increase migration window OR remove the freshness gate
  for *pinned* entries specifically. "If the new PID matches any pinned entry, migrate regardless
  of last_seen age."
- **If H2 (PID reuse):** Add a secondary identity check (session_id prefix match, or a stable
  CLI instance ID).
- **If H3 (backup-recovery partial miss):** Change the "primary empty" check to "every validator-
  approved pinned entry from backup is present in primary".

## Close-out checklist

- [x] Empirical evidence captured (`.bak1` vs current diff)
- [x] Bug class identified (same as #1, different file)
- [x] TT1 reviews JS-side write paths — **done; no direct wipe found in any single code path**
- [x] **Code-path audit complete** — all 5 JS + 3 PS write sites preserve fields in place; the
  wipe must come from a **delete-then-recreate sequence** across multiple hook fires
- [ ] Root cause identified — **HYPOTHESIS H1 (PID-migration window expiry) most likely**;
  need real-time registry-watch evidence (recipe above) to confirm
- [ ] Fix + regression test — `SESSION REGISTRY ROUND-TRIP` test group staged above
- [ ] Verify via live install: set label "TESTWIPE", watch registry file, identify triggering
      hook fire
