# Terminal Talk — Delete / Prune / Queue Deep Audit (2026-06-02)

**Trigger:** Ben reported the dot-delete being *"not reliable, not robust — it doesn't delete
at once when I right-click on them."*

**Method:** Relaunched the live app, traced the full delete + auto-prune + queue-watch paths,
pulled live evidence from `~/.terminal-talk/`, and ran a **44-agent read-only audit** (5 finder
dimensions → adversarial verify → completeness critic): 38 findings → **24 confirmed**.

---

## Live evidence (the smoking gun)

`~/.terminal-talk/queue/` at audit time:

| Class | Count | Pruned? |
|---|---:|---|
| `.played.json` markers | **98,821** | ❌ **no rule — unbounded** |
| `.txt` / `.original.txt` sidecars | 49,571 | ✅ 14-day (working) |
| audio (`.mp3`/`.wav`) | 29 | ✅ staleMs |
| **Total** | **148,529 files / 310 MB** | |

Oldest `.played.json`: **2026-05-10 (23 days)** — confirms zero pruning.

A 148K-entry directory makes **every `fs.readdirSync(queueDir)` slow on the main thread**.
`queue-watcher.list()`/`listPaths()` re-scan the *whole* dir on every `fs.watch` fire (which
markers/sidecars trigger constantly), so the main process is frequently busy — the user's IPC
`delete-file` request queues behind it → *"doesn't delete at once."*

---

## FIXED this session

### F-1 (root cause) — `.played.json` markers never pruned → queue-dir bloat
- Written `app/lib/ipc-handlers.js`:984 on every auto-prune/ephemeral delete; `prune.js` had no
  rule for them. **Not vestigial** — they feed offline `scripts/synth-audit.cjs` (`loadTurns(7d)`;
  older markers read by nothing).
- **Fix:** `prune.js` — added `PLAYED_MARKER_MAX_AGE_MS = 7 days` prune rule (== consumer window,
  so nothing breaks). Kept the write. **+ unit test.**
- **+ one-time live cleanup:** deleted **75,645** markers older than 7 days → dir **148,529 → 73,470**.

### F-2 — one right-click deleted TWO dots / rapid deletes unreliable
- `app/lib/dot-strip.js`. One physical right-click fires **both** `mousedown`(button 2) **and**
  `contextmenu`. Under a busy main thread (the queue-watch readdir + the first delete's render),
  the strip **re-renders between the two events**, so the trailing `contextmenu` lands on the
  **adjacent** dot and deletes it too — Ben's *"deleted 2 with one click."* (Confirmed live: paired
  `reason=manual` deletes ~250 ms apart hitting consecutive files `-0003/-0004`, `-0005/-0006`.)
- The two events share **neither a path nor a fixed time gap**, so the old instance-wide 300 ms
  time guard only collapsed them when congestion kept the gap < 300 ms (hence "intermittent"), and
  swallowed legitimate rapid distinct deletes. *(A first attempt to key the guard on `path+time`
  was wrong — the paired events have different paths — and was replaced.)*
- **Fix:** gate by **event role**. `mousedown` is the authoritative delete and is **never
  suppressed** (so rapid right-clicks on different dots each delete); the `contextmenu` that trails
  a mousedown within 600 ms is the redundant half of one gesture and is dropped. On platforms where
  button-2 `mousedown` doesn't fire, `contextmenu` is the sole trigger and still deletes once.
  **+ 2 unit tests** (rapid distinct via mousedown both delete; one gesture whose contextmenu lands
  on a different dot deletes once).

### F-3 — `deleteDot()` + `clearAllPlayed()` leaked priority state (audit find)
- Both removed clips from `queue`/`played`/`heard` but **not** `priorityPaths`/`priorityQueue`
  (the auto-delete path's `_removeClipFromQueuesAndState` does). A manually-deleted priority
  ("hey jarvis") clip lingered → next autoplay drain tried to play a missing file.
- **Fix:** routed both through `_removeClipFromQueuesAndState`; `deleteDot` now also passes
  `reason='manual'` for the diagnostic log.

---

## Deferred → tracked recommendations (genuine, lower-priority / higher-risk)

- **R-1 (perf, medium):** `readdir` cost scales with dir size. The cleanup + prune cut the file
  count (the trigger); the architectural fix is to move markers + sidecars into queue
  *subdirectories* so the hot dir holds only audio. Bigger change (synth-audit, transcript-panel,
  prune all assume a flat dir).
- **R-2 (medium):** Ephemeral (`T-`) tool-narration clips write `.txt` sidecars + `.played.json`
  markers despite being ambient noise deleted after 200 ms — the dominant volume driver. Decide
  whether ephemeral clips need either.
- **R-3 (robustness, critical-per-audit):** `_attemptAutoDelete()` gives up after 12 retries
  (~5 min) leaving the file on disk and the clip stuck in `played` state. Currently by design (so
  an undeleteable file can't re-enter autoplay). Consider a slow background retry instead of full
  abandonment. Rare (needs a persistent OS lock).
- **R-4 (medium):** Manual `delete-file` doesn't remove the clip's `.txt`/`.original.txt` sidecars
  → orphan sidecars until the 14-day sweep. Low real impact (dot is gone; panel won't show them).
- **R-5 (perf, low):** `queue-watcher` could use `readdirSync(dir,{withFileTypes:true})` / async
  read + a longer `fs.watch` debounce to cut main-thread cost under churn.
- **R-6 (low):** `delete-file` IPC return contract (null/true/false) is ambiguous; a transient
  EBUSY returns `false` which the retry loop could misread as permanent.
- **R-7 (low):** `prune.js` `.tmp_synth` cleanup uses `rmdirSync` (throws ENOTEMPTY if a non-
  `.partial` lingers; error swallowed → dir never removed).
- **R-8 (test gap):** No coverage for delete+undo+queue-update interactions, priority-clip delete,
  or max-retry exhaustion. (F-3's path is now exercised; the rest remain.)

---

## Status

- Fixes F-1..F-3 implemented in repo + mirror synced (`docs/app-mirror`).
- Unit tests added for F-1, F-2; full suite green (see session log).
- Live cleanup done (148,529 → 73,470 files). Steady-state now bounded by the 7-day rule.
- Deploy to `~/.terminal-talk/app/` (prune.js, dot-strip.js, renderer.js) + app restart: see session.
- **Not committed** — `scripts/run-tests.cjs` carries unrelated in-progress Codex flaky-test work;
  left git untouched to avoid entangling it. Offer standing to commit the delete-fix files separately.
