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

## Perpetual motion — never idle

**Core rule: neither terminal waits on the other.** The item lifecycle above is a *per-item*
flow, not a serialisation across items. As soon as a terminal finishes its part of an item and
hands off, it **immediately** claims the next available `QUEUE.md` item matching its role.

Any steady state where one terminal is "waiting for the other to respond" is a protocol
failure. Handoff is asynchronous — the blocked terminal picks up the handoff whenever it next
checks its INBOX or pulls the branch; meanwhile the other terminal is already deep in the next
item.

**Concrete applications of the rule:**

- TT1 finishes a review block → writes to `INBOX/tt2.md` → **immediately claims the next queued
  item** and starts its review pass. Does NOT wait for TT2's empirical verification. When TT2's
  tester findings land in the existing ACTIVE file, TT1 picks that item back up at whatever
  available moment — in parallel with whatever's in flight.
- TT2 finishes empirical verification → writes to `INBOX/tt1.md` → **immediately moves to the
  next item's test pass OR claims an empirical-role-only item** (live soak, error-recovery
  matrix). Does NOT wait for the fix.
- Devil's advocate blocks the PR push, not other work. When one item sits with `STATUS=in-verify`
  awaiting the other terminal's devil's-advocate block, that item is parked; other items
  progress.

**Concurrency limits** — each terminal can have multiple items at different lifecycle stages
concurrently. Cap total open items per terminal at **3** to avoid thrash. The ACTIVE file for
each captures enough state that either terminal can rehydrate context in seconds on return.

| Terminal | active `in-review` | active `in-test` | active `fix-drafted` | awaiting-handoff |
|---|---|---|---|---|
| TT1 reviewer | ≤ 2 | — | ≤ 1 | unbounded |
| TT2 tester | — | ≤ 2 | — | unbounded |

**Handoff protocol — the single invariant:** the LAST action in every work block is a message to
the other terminal's INBOX (or a push to `fix-pass` / `main`). That message IS the handoff. The
terminal **then immediately claims the next queued item** — that single action is what keeps the
cycle perpetual. If a work block ends without an INBOX message, the handoff wasn't clean.

**If `QUEUE.md` is empty for your role:** check whether any ACTIVE item has a block awaiting YOU
that's been sitting unanswered — return to the oldest one first. Only if every ACTIVE item is
genuinely `awaiting-handoff`-from-the-other-terminal is it legitimate to idle; in that narrow
case, drop a one-liner in `coord/BEN.md` and wait on the other terminal or Ben.

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
