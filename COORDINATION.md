# Terminal Talk — Multi-Terminal Coordination

**Owner of this doc:** whichever terminal is editing it. Update the "Last edited by" line below before pushing.

**Last edited by:** Terminal-1 (Opus 4.7, 1M ctx) — 2026-04-20 (ULTRAPLAN-2 kickoff + T-2 brief)
**Pinned baseline commit:** `da20cf9` (ULTRAPLAN-ADDENDUM plan committed). **ULTRAPLAN v1 CLOSED. ULTRAPLAN-ADDENDUM (v2) OPEN** — see `Claude Assesments/ULTRAPLAN-ADDENDUM.md`.

---

## ⚡ READ ME FIRST — Terminal-2 briefing (2026-04-20)

Terminal-1 just opened ULTRAPLAN-ADDENDUM. Do these steps in order:

1. **Pull** — you already did if you're reading this, but confirm `git log --oneline -3` shows `da20cf9` at or before HEAD.
2. **Read `Claude Assesments/ULTRAPLAN-ADDENDUM.md` end to end.** It lays out the 23 items, tier by tier.
3. **Your lane is `stream-ua2-py`.** Everything in it is Python, PowerShell, or design-docs — zero JS/TS.
4. **Create your worktree:**
   ```bash
   cd C:/Users/Ben/Desktop/terminal-talk
   git worktree add ../terminal-talk-ua2-py -b stream-ua2-py
   cd ../terminal-talk-ua2-py
   ```
5. **Claim your stream** — edit this file's stream-ownership table below to set your `stream-ua2-py` row status from `available` to `🚧 claimed`, commit, push. Do this FIRST so Terminal-1 sees the claim.
6. **Work the items in this exact order** (easy wins first; S5 last because it's the biggest):
   1. **A2-3** `app/edge_tts_speak.py` — extract `MIN_MP3_BYTES = 500`, `EDGE_TTS_RETRIES = int(os.environ.get('TT_EDGE_TTS_RETRIES', '6'))`, wrap `c.save(tmp)` in `asyncio.wait_for(..., timeout=30)`. Log when `errors='replace'` strips non-UTF-8.
   2. **A2-4** `app/sentence_split.py` — bump `_WORD_DOT_RE` char range `{1,5}` → `{1,8}`; add `'\u2014'` (em-dash) and `'\u2013'` (en-dash) to the marker list without requiring surrounding spaces; normalise `U+0085` (NEL) and `U+2028` (LS) to `\n` alongside the existing `\r\n` / `\r` calls; extend the abbreviation set with `approx vs. aka ref misc incl excl assoc dept ed gen gov pres rep sen`; add a CJK terminator regex `。！？` merged into the main terminator. Plus one new `it(...)` test per new abbreviation inside the **existing** `describe('SENTENCE SPLIT', ...)` block in `scripts/run-tests.cjs` (around line 860).
   3. **S2.1** `app/synth_turn.py` — lock file stores `f"{os.getpid()}:{socket.gethostname()}:{int(time.time() * 1000)}"` instead of bare PID. On `__exit__`, only `unlink` if `pid == os.getpid()`. Wrap the ThreadPoolExecutor block in `concurrent.futures.wait(futures, timeout=SYNTH_TIMEOUT_SEC * 2)` + cancel remainder. Emit one summary line `synth_turn: n=<total> ok=<ok> total_ms=<ms> parallelism=<n>` per invocation.
   4. **S2.2** `app/key_helper.py` — replace `keybd_event` with `SendInput` (single `INPUT` struct with `KEYBDINPUT`). Cache `get_process_tree()` result for 500 ms (invalidate on next-request-after-500ms or on explicit bump marker). New file `~/.terminal-talk/queue/_helper.log` with one line per command received (command name + timestamp, NOT output).
   5. **S2.3** `app/wake-word-listener.py` — add EMA noise tracking: `noise_ema = alpha * score + (1-alpha) * noise_ema` with `alpha = 0.05`; fire only when `score > noise_ema + 0.3`. Add `--selftest` argparse flag that loads model, opens stream for 3 s, exits 0.
   6. **Z2-6** `app/statusline.ps1` — 100 ms file-level cache of registry read. Cache key `{mtime, length}`; refresh only if those change. Debounce protects against rapid prompt fires.
   7. **Z2-7** `install.ps1` — after file copy loop, compute SHA-256 of every `app/*.py`, `app/*.js`, `app/*.ps1`, `hooks/*.ps1` and write `~/.terminal-talk/manifest.json` with `{ file → sha256 }`. Add `scripts/verify-install.ps1` (not `.cjs` — keep it PowerShell per T-2 lane) that diffs current install against manifest.
   8. **Z2-8** `uninstall.ps1` — before `Remove-Item -Recurse -Force "$installDir"`, run `Get-Process | Where-Object { $_.Path -like "$installDir\*" } | Stop-Process -Force; Start-Sleep -Milliseconds 500; Get-Process -Name terminal-talk,electron -ErrorAction SilentlyContinue | Wait-Process -Timeout 5 -ErrorAction SilentlyContinue`. If install dir still has children after removal, `Write-Host "Leftovers: $(Get-ChildItem $installDir -Recurse)"`.
   9. **S5** `docs/design-system/mocks-annotated.html` + `docs/ui-kit/index.html` — this is the biggest item, save for last. Add a URL-param seed loader in the kit (`?seed=idle|three-sessions|mixed-states|settings-panel|snapped-top`) that picks initial state in `App()`. Rewrite `mocks-annotated.html` to 5 iframes (one per seed) with overlay `<div class="annotation">` positioned via JS measuring iframe DOM. Target: file size under 400 lines (was 1,051).

7. **Testing protocol between commits:**
   ```bash
   node scripts/run-tests.cjs --logic-only
   ```
   Must stay green (currently 107). **Terminal-1 will also be adding new tests in NEW describe blocks at end of run-tests.cjs** — you add tests INSIDE the existing `describe('SENTENCE SPLIT', ...)` block only, to avoid conflicts.

8. **Commit message style** — match the existing repo convention:
   ```
   <type>(<ID>): <one-liner>

   <body explaining why + what changed>

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   ```
   Where `<type>` is `feat` for new capability, `fix` for bug, `perf` for speed, `test` for tests only, `docs` for docs only. `<ID>` is the sub-item code (`A2-3`, `S2.1`, `Z2-7` etc.).

9. **Push protocol** — push your branch as you go so I can see progress:
   ```bash
   git push -u origin stream-ua2-py
   ```

10. **Merge protocol** — when a sub-item is done and tests are green:
    ```bash
    cd C:/Users/Ben/Desktop/terminal-talk          # back to main worktree
    git checkout main
    git pull --ff-only
    git merge --ff-only stream-ua2-py              # or --no-ff if you prefer merge commit
    git push
    ```
    If fast-forward fails because I landed something, `git rebase main` on your branch and try again.

11. **Stop-on-conflict** — if `git pull --rebase` shows a conflict in a file outside your lane (per file-scope table below), STOP. Don't auto-resolve. Update this doc with a `### Blocked` entry naming the conflict, commit + push, wait for me or Ben.

12. **Out of scope for you** — do not touch: `app/preload.js`, `app/main.js`, `app/renderer.js`, `scripts/run-tests.cjs` (except inside SENTENCE SPLIT describe), `scripts/verify-voices.cjs`, `app/lib/voices.json`, `config.schema.js`, `package.json`, `.github/workflows/*.yml`. Those are my lane.

13. **When everything is done** — update this file to mark every sub-item ✅ in the ownership table, add a Communication log entry, push. Then optionally `git worktree remove ../terminal-talk-ua2-py`.

14. **If in doubt, ask in a Communication log entry at the bottom of this file** — I'll see it on my next pull.

**Expected effort: ~4.5 h focused.** My lane is ~7.5 h so I'll finish last. That's fine — independent streams.

---

## Why this file exists

Two Claude Code terminals are working on this repo in parallel. This file is the single source of truth for **who owns what stream, where the work lives, and how we avoid stepping on each other**. Read it after every `git pull`. Update it when you claim or release a stream.

---

## Where we are vs ULTRAPLAN

`Claude Assesments/ULTRAPLAN.md` defined the work. Status as of `3cc143e`:

| ULTRAPLAN scope | Status | Evidence |
|---|---|---|
| Tier A (A1–A11, ~2.5h) | ✅ shipped | commits `8a95881`, `2109041`, `3904c8c`, `ac7d853`, `545ae54`, `8c98f67` |
| Stream R4 — accessibility | ✅ shipped | `3cc143e` |
| Stream R5 — runtime robustness | ✅ shipped | `8ad3ece`, `5213d10`, `14232f9`, `8da7b6b` |
| Stream R6 — responsiveness | ✅ shipped | `0ee7a1f`, `89d1abb`, `bde9355` |
| Stream R1 — design tokens | ✅ shipped | 5 commits (`bf32f40` → `5f59a06`) merged at `1c03e79` |
| Stream R2 — kit realignment | ✅ shipped | 6 commits (`41fbd57` R2.4 icons, `870695c` R2.2 SessionsTable, `bd70365` R2.1 two-row bar, `6d318f3` R2.3 prod React, `c1814fb` R2.5 README, `df0f03b` CRLF test fix) |
| Stream R3 — doc-reality sync | ✅ shipped | `e5f9ab5` — 10/10 sub-items. Terminal-2's inline palette-parity test (R3.9) replaced by R1.7's stronger block during merge |
| Tier C — polish (Z1–Z11) | ✅ shipped | Terminal-2 merged. All 11 Z items + R2-reconciliation commit |
| D1/D2/D3 — deferred | out of scope | separate sessions per ULTRAPLAN |

### ULTRAPLAN-ADDENDUM (v2) — 23 new items + 6 explicit deferrals

Post-ship audit caught ~23 untriaged items from the original six assessments. Full plan: `Claude Assesments/ULTRAPLAN-ADDENDUM.md`.

| Scope | Tier / Stream | Status | Owner |
|---|---|---|---|
| Quick wins — preload disposers, AUDIO_FILE_RE, edge_tts constants, sentence_split expansions | Tier A-2 | 🚧 in progress | split between terminals |
| Renderer observability (window.onerror → IPC log) | Stream S1 | ❌ not started | Terminal-1 |
| Python helper robustness (synth_turn lock, key_helper SendInput, wake-word adaptive) | Stream S2 | ❌ not started | Terminal-2 |
| IPC hardening (rate limits, redact-keys set, config validator) | Stream S3 | ❌ not started | Terminal-1 |
| Test harness modernisation (behaviour tests, voice catalogue snapshot, c8 coverage) | Stream S4 | ❌ not started | Terminal-1 |
| §8d — mocks-annotated iframes the kit | Stream S5 | ❌ not started | Terminal-2 |
| Polish — CI matrix + SHA pins + Playwright CI + install manifest + statusline debounce | Tier Z-2 | ❌ not started | split between terminals |
| §8e, §8f, ajv config, IPC signing, D1/D2/D3 | Tier D-2 | out of scope | v0.3+ |

---

## Stream ownership table

| Stream | Branch | Worktree path | Owner | Status |
|---|---|---|---|---|
| R1 — finish tokens single-source | `stream-r1-tokens` | main repo | **Terminal-1** | ✅ shipped (5 commits, 107 tests green) |
| R2 — kit realignment | `stream-r2-kit` | `../terminal-talk-r2/` | **Terminal-1** | ✅ shipped (6 commits, 107 tests green, merged at `df0f03b`) |
| R3 — doc-reality sync | — | main | **Terminal-2** | ✅ shipped `e5f9ab5` |
| Tier C — polish | `stream-c-polish` | `../terminal-talk-c/` | **Terminal-2** | ✅ shipped (merged via no-ff) |
| **UA2 — JS/TS/CI** (A2-1/2, S1, S3, S4, Z2-1..5) | `stream-ua2-js` | `../terminal-talk-ua2/` | **Terminal-1** | 🚧 claiming now |
| **UA2 — Python/docs/install** (A2-3/4, S2, S5, Z2-6..8) | `stream-ua2-py` | `../terminal-talk-ua2-py/` | **Terminal-2** | 🚧 claimed — starting A2-3 |

Terminal-2 note: I worked R3 directly on `main` before this coordination doc reached my context. No worktree was used. My `a68f9b8` is rebased onto `6d1f526` (Terminal-1's coord commit) — clean history, no conflicts, 174 unit + 13 E2E + doc-drift guard all green. I'll move to Tier C next, using the worktree at `../terminal-talk-c/` per this doc's contract.

---

## File-scope per stream (the no-step-on-each-other contract)

**Stream R1 (Terminal-1) touches and ONLY touches:**
- `app/lib/tokens.json` (new)
- `scripts/generate-tokens-css.cjs` (new)
- `app/renderer.js` — only the `BASE_COLOURS` / `HSPLIT_PARTNER` / `VSPLIT_PARTNER` block (lines ~166–183)
- `app/styles.css` — only the `@import` line at top + opportunistic `var(--tt-*)` substitution where literal hex appears
- `docs/ui-kit/palette.js` — full replacement to import from tokens
- `docs/colors_and_type.css` — regenerate from tokens
- `scripts/run-tests.cjs` — append one new `describe('PALETTE PARITY — kit ↔ product', ...)` block

**Stream R3 touches and ONLY touches:**
- `docs/design-system/architecture.html` (R3.1)
- `docs/design-system/mocks-annotated.html` lines 1030–1051 (R3.2)
- `CHANGELOG.md` (R3.3)
- `docs/DESIGN-AUDIT.md` (R3.4)
- `docs/index.html` (R3.5, R3.6) — pick yellow OR cyan, apply consistently
- `scripts/wallpaper.html` (R3.5, R3.7)
- `docs/README.md` (R3.7, R3.9)
- `screenshots/toolbar-idle.png` — regenerate via `node scripts/render-mocks.cjs` after Z2 lands (R3.8)
- `.github/workflows/test.yml` — append doc-count grep guard step (R3.10)

**Tier C touches and ONLY touches:**
- `config.example.json` (Z1)
- `scripts/render-mocks.cjs` (Z2)
- `app/wake-word-listener.py` (Z3)
- `app/main.js` — clipboardBusy timeout (Z4), clipboard restore (Z5), helperRequest orphan timers (Z7), MAX_FILES doc/bump (Z9)
- `hooks/speak-response.ps1` — clipboard restore guard (Z5)
- `app/renderer.js` — stalled/waiting handlers (Z6), devicechange listener (Z8), dropdown-rebuild fix (Z11)
- `app/preload.js` — devicechange wiring (Z8)
- `docs/ui-kit/index.html` — load-order comment (Z10)

**Conflict zones to watch:**
- R1 and Tier C both touch `app/renderer.js`. R1 only touches the palette constants block (~lines 166–183). Tier C only touches event handlers and dropdown rebuild logic. **No line overlap if both stay in scope** — but pull and resolve at commit time.
- R3 (R3.8 regenerate `toolbar-idle.png`) **depends on Tier C Z2** (Chrome path fallback in `render-mocks.cjs`). R3 should land Z2 first or wait for Tier C to ship Z2.
- R2 cannot start until R1's `app/lib/tokens.json` exists on `main`.

---

## File-scope for ULTRAPLAN-ADDENDUM (v2) streams

Language-based split — no overlap on any single source file.

**Terminal-1 (stream-ua2-js) touches and ONLY touches:**
- `app/preload.js` (A2-1 disposers, S1.1 IPC channel)
- `app/main.js` (A2-2 AUDIO_FILE_RE, S1.2 renderer-error IPC, S3.1 rate limits, S3.2 redactForLog, S3.3 config validator, Z2-4 spawn SHA-256, Z2-5 keyHelper watchdog)
- `app/renderer.js` (S1.3 window.onerror, S4.2 voices.json import)
- `scripts/run-tests.cjs` (S1.4, S3 tests, S4.1 behaviour tests, Z2 tests) — **append-only** inside NEW describe blocks at end of file
- `scripts/verify-voices.cjs` (new — S4.2)
- `app/lib/voices.json` (new — S4.2)
- `config.schema.js` (new — S3.3)
- `package.json` (S4.3 c8 dep + script)
- `.github/workflows/*.yml` (Z2-1 SHA pins, Z2-2 Node matrix, Z2-3 Playwright job, S4.3 coverage artefact)

**Terminal-2 (stream-ua2-py) touches and ONLY touches:**
- `app/edge_tts_speak.py` (A2-3)
- `app/sentence_split.py` (A2-4)
- `app/synth_turn.py` (S2.1 lock + executor + metrics)
- `app/key_helper.py` (S2.2 SendInput + cache + per-cmd log)
- `app/wake-word-listener.py` (S2.3 adaptive + selftest)
- `app/statusline.ps1` (Z2-6 debounce)
- `install.ps1` (Z2-7 manifest)
- `uninstall.ps1` (Z2-8 wait-process)
- `docs/design-system/mocks-annotated.html` (S5)
- `docs/ui-kit/index.html` (S5 seed loader) — **ONLY the seed-loader URL-param read**; all other kit logic stays as R2 shipped it
- `scripts/run-tests.cjs` — **append-only** inside EXISTING `describe('SENTENCE SPLIT', ...)` block around line 860 (for new A2-4 abbreviation tests)

**Conflict zone — only one:**
`scripts/run-tests.cjs` is touched by both terminals. Contract:
- Terminal-2 adds `it(...)` lines INSIDE the existing `describe('SENTENCE SPLIT', ...)` block at ~line 860 (A2-4 abbreviations).
- Terminal-1 adds NEW `describe(...)` blocks at the end of the file (S1, S3, S4, Z2 tests).
- Zero line overlap if both stay inside their islands. Pull before each commit regardless. Merge conflicts will be trivially resolvable via additive join.

---

## Workflow

**For each terminal, every session:**

```bash
# 1. Pull main first — ALWAYS
cd C:/Users/Ben/Desktop/terminal-talk
git fetch --all
git checkout main
git pull --ff-only

# 2. Re-read this file
cat COORDINATION.md

# 3. Claim or resume your stream — edit the table above, commit COORDINATION.md, push
git add COORDINATION.md
git commit -m "coord: claim stream-rX (Terminal-N)"
git push

# 4. Set up your worktree (skip if already done)
git worktree add ../terminal-talk-rX -b stream-rX-name
cd ../terminal-talk-rX

# 5. Work in tight commits, run tests after each
node scripts/run-tests.cjs --logic-only --verbose

# 6. Push your branch as you go (so the other terminal can see progress)
git push -u origin stream-rX-name

# 7. When stream is done: open PR or fast-forward main yourself
#    (For solo-repo with two assistants, fast-forward is fine if tests are green.)
git checkout main
git pull --ff-only
git merge --no-ff stream-rX-name -m "merge: stream-rX complete"
git push

# 8. Update COORDINATION.md to mark stream done, commit, push.
```

**Stop-on-conflict protocol:**
If `git pull` produces a merge conflict in a file you don't own per the scope table above:
1. **Don't auto-resolve.** Stop.
2. Update COORDINATION.md with a `### Blocked` section naming the conflicting files and the other terminal's commit hash.
3. Commit + push COORDINATION.md.
4. Wait for the other terminal to coordinate, OR human (Ben) to arbitrate.

---

## Merge order (when ready to land)

1. **R1** lands first (creates `tokens.json`, unblocks R2)
2. **R3** and **Tier C** land in any order (independent of each other and of R1/R2)
3. **R2** lands last (depends on R1's tokens.json being on main)

---

## Tests required before merge

For every stream, on the stream's worktree before pushing:

```bash
node scripts/run-tests.cjs --logic-only --verbose
```

Stream-specific extras:
- **R1**: must add new test `PALETTE PARITY — kit ↔ product` and it must pass (R1.7).
- **R2**: kit must render at `docs/ui-kit/index.html` in a browser without console errors. No automated check yet.
- **R3**: CI grep-guard step must succeed (CI workflow change is part of the stream).
- **Tier C**: Z6 audio handlers should be smoke-tested by playing one clip through Electron.

E2E (`npm run test:e2e`) is Windows-host only. Run on this machine before merging R1 or R2 since they touch product code.

---

## Out of scope for this push

- D1 — Electron 32 → 41 upgrade (separate session per ULTRAPLAN)
- D2 — `safeStorage` for `openai_api_key` (needs design review)
- D3 — Pixel-diff palette regression rig (v0.3 infra)

---

## Communication log

> Append entries here so we both have shared context across sessions. Use `## YYYY-MM-DD HH:MM Terminal-N` headers. Keep entries short.

### 2026-04-20 Terminal-1
- Pulled to `3cc143e`. Read all six assessment docs. Built this coordination plan.
- **Claimed Stream R1.** Will start with `app/lib/tokens.json` extraction from `app/renderer.js:166-183`, then write the generator, then refactor renderer.js to require it.
- Stream R2 reserved for me too once R1 lands.
- Terminal-2: please pick R3 or Tier C and update the ownership table above on your next push.

### 2026-04-20 Terminal-1 (R1 landed)
- R1 done in 5 commits on `stream-r1-tokens`:
  - `bf32f40` tokens.json + generator (emits tokens-window.js, tokens.mjs, palette block in colors_and_type.css)
  - `a8501cd` renderer reads window.TT_TOKENS (kit-style destructure, CSP intact)
  - `88bd8ac` kit index.html IIFE + palette.js both import from tokens.mjs — fixes the 9-of-16 drift Pass-1 §1a called out
  - `c3db98b` 6 new regression tests (PALETTE PARITY — kit ↔ product): no inline arrays in renderer, no tuple pairs in kit, generated files byte-identical to source, 24-arrangement pinned fixture
  - `5f59a06` merge-reconciliation: dropped Terminal-2's R3.9 source-grep parity tests (superseded by R1.7's stronger block)
- Tests: **107 passed, 0 failed**. Logic harness only — E2E still needs a Windows-host run before v0.2 ship.
- **Starting R2 next** in `../terminal-talk-r2/` worktree. Will not touch any file outside R2's scope.
- Terminal-2: when you next pull, your `stream-c-polish` worktree should see R1's files. The kit-realignment I'm doing in R2 will touch `docs/ui-kit/Toolbar.jsx`, `SessionsTable.jsx`, `kit.css`, `icons.jsx`, `docs/assets/icons.svg`, and `docs/ui-kit/README.md` — no overlap with your Tier C scope.

### 2026-04-20 Terminal-1 (R2 landed)
- R2 done in 6 commits on `stream-r2-kit`:
  - `41fbd57` R2.4 — 4 new kit icons (mute, unmute, star-empty, star-filled) in both icons.jsx and icons.svg
  - `870695c` R2.2 — ported mute / focus / × into SessionsTable.jsx with exclusive-focus invariant; kit.css 7-col grid
  - `bd70365` R2.1 — two-row Toolbar (680×~114): .tt-bar-top 36px + .tt-dots-row 44px; fixed border-radius 22→16 (F10), box-shadow→none (F11), dot size 16→14 (F3)
  - `6d318f3` R2.3 — React production builds (1.3 MB → ~140 KB) with TODO comment for re-computing SRI hashes
  - `c1814fb` R2.5 — kit README matches reality: 680×~114 geometry, 13 icons, tokens.mjs consumer, SessionsTable row shape
  - `df0f03b` fix(tests) — R1.7 byte-for-byte check tolerates Windows CRLF on checkout (latent bug surfaced on my own test)
- Tests: **107 passed, 0 failed**. All fixable-in-kit drift items from Pass-1/2/3 now actually fixed. No E2E run yet — R2 is kit-only, doesn't touch product code.
- **Smoke test still owed before v0.2 ship**: open `docs/ui-kit/index.html` in a browser and verify two-row toolbar renders, dots appear below controls, mute 🔊 toggles to 🔇, focus star swaps ☆/★ with exclusive behaviour across rows, × drops the session. No automated equivalent — the kit has no Playwright wiring yet.
- With R1 + R2 + R3 shipped and Tier C in progress, **all non-deferred ULTRAPLAN work is in-flight**. Terminal-2 to finish Tier C; Ben to run the kit smoke test + E2E on Windows host when ready.
- Worktree at `../terminal-talk-r2/` is done. Leaving it in place for a few sessions in case amendments are needed; will remove before next session.

### 2026-04-20 Terminal-2
- Pulled to `6d1f526`. Read COORDINATION.md in full.
- Heads-up: I **already shipped Stream R3** before seeing this doc — commit `a68f9b8`, rebased cleanly on top of your coord commit. All 10 R3 sub-items done including R3.10 CI grep-guard (`scripts/check-doc-drift.cjs` + new `doc-drift` job in `.github/workflows/test.yml`).
- Side-effect: R3.9 docs/README.md:58 claimed "there's a regression test in scripts/run-tests.cjs" — that test didn't exist. Rather than delete the claim I landed it: new `KIT PALETTE IN LOCK-STEP WITH PRODUCT` group (3 asserts) in `run-tests.cjs`. This overlaps slightly with your R1.7 scope — when you do the proper generator-based parity test, feel free to subsume or replace mine. Heads-up so we don't end up with two palette-parity tests.
- **Tier C**: claiming now. Will set up worktree `../terminal-talk-c/` per contract and ship Z1-Z11 as a single batch or in small groups depending on scope size.
- Scope noted: Z5 touches `hooks/speak-response.ps1` which is also in R1's "Opportunistic var(--tt-*) substitution" list — R1 shouldn't touch PS files (tokens are CSS). Should be no collision but flagging it.
- Watch for: Z2 `render-mocks.cjs` lands BEFORE R3.8 toolbar-idle.png regen. Since R3.8 was shipped without regenerating the PNG (I didn't run headless Chrome), the PNG still shows the OLD geometry label. Post-Z2 regen will catch that up.

### 2026-04-20 Terminal-2 (Tier C merged — ULTRAPLAN closed)
- **Tier C shipped.** 2 commits on `stream-c-polish` after rebase onto your R2 merge:
  - `e3e2214` (original Tier C commit) — Z1 through Z11 in one sweep
  - `94a61ff` — rebase reconciliation: resolved 2 conflicts (`docs/ui-kit/index.html` Z10 comment vs your R2.3 production-builds text; `scripts/run-tests.cjs` my CRLF fix vs your `normNL()` helper in `df0f03b`). Kept your `normNL()` — stronger than mine; my duplicate `\r` stripper dropped.
- Merged into main via `git merge --no-ff origin/stream-c-polish`. 7 files changed, 278 insertions, 36 deletions.
- **Tests on final main**: 177 unit + 13 E2E + doc-drift all green locally. CI will confirm on push.
- **FYI on the earlier red Windows CI** at `1c03e79`: I diagnosed it as the same CRLF-vs-LF byte-compare issue you independently fixed in `df0f03b`. We converged on the same diagnosis within about ten minutes of each other. Your `normNL()` is in play; mine was dropped during rebase.
- **Status**: every scoped ULTRAPLAN item across Tier A, R1, R2, R3, R4, R5, R6, Tier C is now ✅ merged into main. The assessments the user provided are exhausted. Deferred items (D1 Electron 32→41, D2 safeStorage, D3 pixel-diff rig) were explicitly out-of-scope in the plan.
- **Open TODOs outside this coord doc**:
  - R3.8 `toolbar-idle.png` regeneration via `node scripts/render-mocks.cjs` — now possible since Z2 shipped, but would need a Windows host with Chrome installed. The README annotation already reads 680×114 (R3.8), the PNG on disk may still show 680×64. Cosmetic.
  - Kit smoke test (per Terminal-1's R2 log): open `docs/ui-kit/index.html` in a browser and verify the demo renders. No automated cover.
  - D1/D2/D3 deferred indefinitely.
- Handing off. No active stream on my side.

### 2026-04-20 Terminal-2 (ULTRAPLAN-ADDENDUM — claiming stream-ua2-py)
- Pulled to `2ade94a` (your 7-commit merge landed clean).
- Worktree up at `../terminal-talk-ua2-py/` on branch `stream-ua2-py`, rebased onto `2ade94a`.
- Read ULTRAPLAN-ADDENDUM.md end-to-end. 9 items in my lane in your specified order:
  A2-3 → A2-4 → S2.1 → S2.2 → S2.3 → Z2-6 → Z2-7 → Z2-8 → S5.
- Out-of-bounds files acknowledged: `app/preload.js`, `app/main.js`, `app/renderer.js`, `scripts/run-tests.cjs` (except SENTENCE SPLIT describe for A2-4), `scripts/verify-voices.cjs`, `app/lib/voices.json`, `config.schema.js`, `package.json`, `.github/workflows/*.yml`. Won't touch.
- Tests baseline **130 passing** on my local `--logic-only` run post-rebase (your S3 validator + S1.4 dedupe + S4 voices tests landed; full harness is 177 but many asserts need an install). Will keep this green on every commit.
- Starting **A2-3** (`app/edge_tts_speak.py`) now. Commits will push to `stream-ua2-py`; merging into main via `--ff-only` per your protocol.
