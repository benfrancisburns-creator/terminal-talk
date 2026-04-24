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

## Wipe-source trace — [tt2 · 2026-04-25T02:00:00+01:00]

Systematic trace of every path that could produce `label='' pinned=true`. Key enumerate:

### Path 1 — `ensureAssignmentsForFiles` fresh-alloc (`app/main.js:1356-1363`)

Creates new entry with `label: '', pinned: false`. **Does NOT match #8 pattern** (pinned
wrong). Rules this path out as the *sole* wipe source.

### Path 2 — `Update-SessionAssignment` fresh-alloc (`app/session-registry.psm1:274-283`)

PS-side equivalent. Also `label: '', pinned: $false`. Same result — ruled out.

### Path 3 — `set-session-label` IPC with empty label (`app/lib/ipc-handlers.js:165-175`) ★ **matches #8**

```js
const clean = sanitiseLabel(label);
all[shortId].label = clean;
if (clean) all[shortId].pinned = true;  // ← pinned NOT cleared when label is empty
```

Setting label to '' keeps `pinned` at its previous value. **If the entry was pinned
previously (user set label earlier), the resulting state is `label='' pinned=true`** —
exactly the observed #8 pattern.

**Triggering user action:** click into the Settings row's label input, clear it
(Backspace / Select-all-Delete), click away. The HTML `change` event fires with
`labelInput.value.trim() === ''` → calls `_onSetLabel(shortId, '')` → IPC writes.

Relevant code: `app/lib/sessions-table.js:240-252` — the label `<input>` is wired with a
`change` listener that calls `_onSetLabel(shortId, labelInput.value.trim())`.

### Path 4 — sanitiseEntry coerces non-string label to '' (`app/main.js:1157`)

```js
label: typeof e.label === 'string' ? e.label.slice(0, 60) : ''
```

If the on-disk entry has `label: null`, `label: undefined`, or `label: {}` (non-string),
load coerces to `''` but preserves all other fields including `pinned`. **Matches #8 pattern
IF some writer produces a non-string label.**

**Who could produce that?** Not current JS or PS code — both always write `label: ''` or a
non-empty string, never null/undefined/object. So this path requires one of:
- External tooling (user hand-edited JSON), OR
- Crash-mid-write (atomic `.tmp + rename` should prevent, but not bulletproof under OS-level
  crash or antivirus file-lock), OR
- A future code path that writes a non-string by accident.

### Verdict

**Path 3 is the primary candidate for #8.** Observation matches the user-action result
exactly. The "I didn't clear labels" report could reconcile with:

- A misclick (keyboard focus landed in label input during a different action; then a
  separate keystroke or click-away caused `change` to fire with empty value).
- A re-population bug elsewhere that programmatically set `labelInput.value = ''` and then
  dispatched `change` (would need to grep for any `dispatchEvent(new Event('change'))` on
  label inputs — I did a quick scan, none found).

### Recommended fix for #8

1. **Add a Devil's-advocate UX guard.** In `sessions-table.js:249-251`, require confirmation
   if the new label is empty AND the session was pinned. Either a small inline confirm
   ("clear label? [yes/cancel]") or just ignore empty inputs that would clear a pinned
   session (treat as no-op). Small change, prevents accidental clears.
2. **Observability logging from Batch 1 will pin it.** The new registry-write log line
   `save-registry ok from=set-session-label keys=N changed=[short]` will show every
   label-wipe event with timestamp + caller. Ben's watcher (`_registry-watcher.log`)
   already captures this too. Next wipe episode, we'll see if it was `set-session-label`
   (→ Path 3) or `write-registry from=ensure-for-files` (→ Path 1/2) or a third-party
   writer.
3. **Regression test for Path 3 (guard):** assert that `set-session-label(short, '')` on a
   pinned entry returns false OR a `requiresConfirm` signal — not a silent wipe.

### Lead still open for TT1's #8 fix draft

- Check the PS side `Read-Registry:128` (`if ($v.label) ...`) — is there any PowerShell
  JSON-parse quirk where a legitimately set string label comes back as `null` in
  `$v.label`? I don't think so, but worth a probe (read a registry file with a valid
  label, dump `$v.label`'s actual type + value).
- Check for any programmatic label clears during tab-switch / focus-change (I didn't find
  any, but my grep was shallow).

## Tester follow-up — [tt2 · 2026-04-24T22:54:00+01:00]

### LIVE evidence: wipe already manifest

Parsed current `session-colours.json` just now. 2 inner entries, both pinned, both `label=""`:

```
aef91e8e: label="" pinned=Y voice=null speech_includes={"tool_calls":false}
a29f747b: label="" pinned=Y voice=null speech_includes={"tool_calls":false}
```

Ben's labels ARE already wiped right now. The `pinned=true` and the `{tool_calls:false}` override
survived, but labels didn't. This is the exact field-loss pattern documented in the empirical
diff earlier. Suggests the "delete-then-recreate" hypothesis reshapes via partial preservation —
some fields are kept (pinned, speech_includes), others are lost (label). Either:

- **The fresh-alloc path copies SOME fields from the old entry but not `label`.** Narrows to
  a per-field preservation bug inside the migration branch.
- **OR** labels are wiped by a different path than pinned/speech_includes — mixed mechanism.

The watcher will tell us: when the NEXT wipe happens (or the next save regardless), the
CHANGED line will show which fields flipped.

## Tester follow-up — [tt2 · 2026-04-24T22:50:00+01:00]

### Watcher spawned

Script at `scripts/watch-registry.cjs` running in background. Polls `session-colours.json` mtime
every 500ms, logs to `~/.terminal-talk/queue/_registry-watcher.log`. Captures per-entry diff
(label / pinned / voice / speech_includes / claude_pid / index / last_seen) on every mutation.

**Already captured (within 2 min of start, app at idle):**

```
[22:32:48] SNAPSHOT 1 entries size=1245
[22:32:54] TOUCH (mtime bumped, content identical) size=1245
[22:32:55] TOUCH (mtime bumped, content identical) size=1245
```

TOUCH events are the file being re-written with byte-identical content — a save-site is firing
without any state change. This is consistent with TT1's #6 review finding **G1 — registry writes
are silent on success** (we can see the file move but not who wrote it or why). Adds evidence
to the idle-churn angle: if something is re-saving the file several times per minute even when
the user didn't touch anything, the window for the delete-then-recreate sequence to fire is
**much wider** than we thought.

### What I'm monitoring for

- **MUTATION** lines with `CHANGED <short>: <before> -> <after>` when Ben's labels/pinned/
  speech_includes flip from set → empty. That's the smoking gun.
- **ADDED / REMOVED** pairs separated by seconds — the delete-then-recreate pattern in action.
- High-frequency TOUCH at the time of a wipe — tells us the wipe is write-site-triggered rather
  than parse-recovery-triggered.

## Close-out checklist

- [x] Empirical evidence captured (`.bak1` vs current diff)
- [x] Bug class identified (same as #1, different file)
- [x] TT1 reviews JS-side write paths (`4d07faf` — every write-site audited clean)
- [x] Real-time watcher running (captures next wipe automatically, no Ben action needed)
- [ ] Root cause identified — awaiting empirical MUTATION capture during a wipe episode
- [ ] Fix + regression test (TT1 has `SESSION REGISTRY ROUND-TRIP` 4-scenario test staged)
- [ ] Verify via live install: set label "foo" on a session, do anything that triggers a
      registry write, confirm "foo" survives
