# coord/ — two-terminal regression-fix protocol

Two Claude Code terminals work together here on **robustness + regression fixes** (no new features).
Scope stays tight; every fix ships with a new test that would have caught the original bug.

## Who's who

- **TT2** (this terminal) — tester. Runs the live install on Ben's desktop, reproduces bugs
  empirically, grabs real `~/.terminal-talk/` state + real log lines as evidence. Main branch at
  `C:\Users\Ben\Desktop\terminal-talk\`.
- **TT1** — reviewer. Deep-reads code, maps state machines, writes invariants, predicts breakage.
  Worktree at `C:\Users\Ben\Desktop\terminal-talk-tt1\` on branch `fix-pass` so experimental changes
  don't disturb TT2's live install.

Neither terminal silos work by *file*; they silo by *role*. Both touch every module — one empirically,
one analytically.

## The four durable memory surfaces (all committed)

| File | Purpose | Size target |
|---|---|---|
| `STATE.md` | Cross-session consciousness — where the team is today | < 200 lines |
| `INDEX.md` | Table of contents — modules, features, invariants, historical bugs | grows |
| `MAP/<feature>.md` | Per-feature deep page — state surfaces, files, invariants, tests, gotchas | grows |
| `ACTIVE/<id>-<slug>.md` | Current item's working memory — verbose, signed, timestamped | bounded per-item |
| `DONE/<id>-<slug>.md` | Archived closed items | grows |

## The four chatter surfaces (all gitignored — see `.gitignore`)

| File | Purpose |
|---|---|
| `INBOX/tt1.md` · `INBOX/tt2.md` | Handoff messages — each file is where messages TO that terminal land |
| `LOCKS/<path>.lock` | 15-min stale-steal when one terminal is actively editing a file |
| `HANDOVER-<ts>.md` | Pre-compact session dumps — "I was at X, next step is Y" |
| `BEN.md` | Human interrupt — both terminals halt and read this on any change |

## Item lifecycle

1. **Queue** — item appears in `QUEUE.md` with `OWNER=TBD STATUS=queued`.
2. **Claim** — a terminal sets `OWNER=tt?` and creates `ACTIVE/<id>-<slug>.md`, `STATUS=in-review`.
3. **Review** — TT1 (reviewer) writes reproduction recipe + hypotheses + code-path map. Appends to ACTIVE.
4. **Test** — TT2 (tester) runs the recipe in the live install. Records real state evidence. Appends to ACTIVE.
5. **Propose fix** — whichever terminal found root cause drafts the patch in its worktree. ACTIVE gets
   the *Causality* block (root cause, not symptom) + *Blast-radius check* (files touched, features
   affected via MAP, invariants via INDEX, tests that must pass / may silently regress).
6. **Devil's advocate** — the *other* terminal fills in the *Devil's Advocate* block: what could this
   change break that the author didn't consider? Blocking for state-persistence + multi-writer changes;
   advisory for pure-UI.
7. **Verify** — TT2 runs the fix in the live install against the original recipe, confirms bug gone,
   confirms nothing else regressed. Appends to ACTIVE. Writes a new test that would have caught the
   bug; test goes green.
8. **Close** — commit + push. Move ACTIVE → DONE. Update INDEX (new invariant + historical-bugs entry).
   Update MAP/<feature>.md with what was learned. Mark queue item `STATUS=done`.

## Locks and conflicts

Before editing any file in `app/` or `scripts/`, drop a lock:

```
echo "tt? · $(date -Iseconds)" > coord/LOCKS/<file-path-slug>.lock
```

The other terminal checks `coord/LOCKS/` before editing. If a fresh lock exists, work on a different
file or block on the other terminal's `INBOX`. Stale locks (> 15 min) can be stolen — same semantics as
`app/lib/registry-lock.js`.

## Session-health thresholds

Each terminal self-monitors via `/context`:

- **~200k tokens** — breathing check. Append a one-line pulse to `STATE.md`.
- **~400k tokens** — checkpoint. Full STATE.md update, then switch to lean mode (no re-reading files
  already explored; delegate big explores to subagents).
- **~550k tokens** — compact. Commit everything, write `HANDOVER-<ts>.md`, run `/compact`, resume from
  `STATE.md` + latest HANDOVER.
- **Hard ceiling 600k.** Never cross.

## Ben-interrupt protocol

- Dropping a new `coord/BEN.md` or saying "STOP" / "PAUSE" in either terminal → both halt at the
  next tool-call boundary, read `BEN.md`, respond via INBOX before resuming.
- Ben confirms merges of state-persistence fixes before push to `main`.

## The eight quality axes

Every item gets reviewed against the ones that apply:

1. **Correctness** under normal use
2. **Persistence** across app relaunch, PC reboot, `/clear`, crash
3. **Concurrency** — multi-writer races on files, registry, flags
4. **Error recovery** — degrades gracefully when deps fail (edge-tts offline, disk full, etc.)
5. **Resource behaviour over time** — 24h soak, memory, zombies, orphan files
6. **Observability** — when it breaks, can we diagnose from logs alone?
7. **Invariant enforcement** — every invariant has a test that fails if it breaks
8. **Security boundaries** — IPC validators, CSP, secret leaks, file permissions
