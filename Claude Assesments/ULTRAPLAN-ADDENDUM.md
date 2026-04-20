# Terminal Talk — ULTRAPLAN ADDENDUM (v2)

Everything ULTRAPLAN missed, tiered and scoped. Derived from the same six assessments now that ULTRAPLAN's 58 scoped items are all shipped at `73e637f` (v0.2.0).

**Total new items: 23 actionable + 6 explicit deferrals.** Split so two terminals can execute in parallel without touching each other's files.

---

## Ledger — what this fixes that ULTRAPLAN didn't

Gaps identified in post-ship audit (see chat history, 2026-04-20):

1. **3 structural §8 items** from `terminal-talk-bundle-review.md`: §8d (annotated-mocks generation), §8e (collapse duplicated design-system pages), §8f (version the docs).
2. **~15 per-file "military-grade upgrades"** from `terminal-talk-full-review.md` that never got triaged into any tier.
3. **Positive findings** (R7/R9/R13-15/R18/R20/R24-25/R28-29/R31/R37, G16/G27, H1, F19) — require no action, logged for completeness only.

---

## Table of contents

1. [Tier A-2 — quick hardening wins (~1h)](#tier-a-2)
2. [Stream S1 — renderer observability (~1h)](#stream-s1)
3. [Stream S2 — Python helper robustness (~2h)](#stream-s2)
4. [Stream S3 — IPC hardening (~2h)](#stream-s3)
5. [Stream S4 — test harness modernisation (~3h)](#stream-s4)
6. [Stream S5 — §8d mocks-annotated iframe wrapper (~2h)](#stream-s5)
7. [Tier Z-2 — polish (~1.5h)](#tier-z-2)
8. [Tier D-2 — deferred (v0.3+)](#tier-d-2)
9. [Terminal split + file-scope contract](#terminal-split)

**Total active work: ~12h across two terminals.**

---

## Tier A-2

Four quick wins, each <30 min, independent files.

| # | ID | Source | Fix | File |
|---|----|---|---|---|
| A2-1 | full-review §8 preload.js | preload has no unsubscribe path — event listeners leak if re-subscribed | Return disposer `() => ipcRenderer.off(...)` from every subscribe method | `app/preload.js` |
| A2-2 | full-review §7 main.js | `AUDIO_FILE_RE` drifts between `countFiles` and `isAudioFile` — different regexes for the same concept | Hoist `AUDIO_FILE_RE = /\.(mp3|wav)$/i` module-level; use both sites | `app/main.js` |
| A2-3 | full-review §12 edge_tts_speak.py | Magic number `500`, hardcoded retry `6`, no timeout on `c.save(tmp)` | Extract `MIN_MP3_BYTES = 500`, `EDGE_TTS_RETRIES` from env, wrap save in `asyncio.wait_for(..., timeout=30)` | `app/edge_tts_speak.py` |
| A2-4 | full-review §14 sentence_split.py | `_WORD_DOT_RE {1,5}` misses 6-char abbrevs; no en/em-dash without spaces; no NEL/LS normalisation; abbrev list short; no CJK | Bump to `{1,8}`, add dash variants, normalise U+0085/U+2028, expand abbreviation set (approx, vs., aka, ref, misc, incl, excl, assoc, dept, ed, gen, gov, pres, rep, sen), add CJK terminator `。！？`, add test per new abbrev | `app/sentence_split.py`, `scripts/run-tests.cjs` |

---

## Stream S1

**Renderer observability — window-level error capture (~1h).**

ULTRAPLAN's R35 wired `unhandledRejection` / `uncaughtException` handlers in `main.js`. The renderer side was never done — a JS exception in `renderer.js` silently kills the UI today with zero diagnostics. Full-review §9 calls this out.

- **S1.1** — `app/preload.js`: expose `api.logRendererError({ message, stack, source })` via a new IPC channel.
- **S1.2** — `app/main.js`: handle the IPC, append to existing `_toolbar.log` with a `[renderer-error]` prefix, rate-limit to 1/sec per distinct stack.
- **S1.3** — `app/renderer.js`: register `window.onerror` + `window.onunhandledrejection` handlers that serialise and forward.
- **S1.4** — `scripts/run-tests.cjs`: one behaviour test that throws inside a `setTimeout` in the renderer (via test harness's IPC injection) and asserts the log line arrives.

**File scope:** `app/preload.js`, `app/main.js`, `app/renderer.js`, `scripts/run-tests.cjs`.

---

## Stream S2

**Python helper robustness (~2h).** Three independent helpers, each with one-to-three hardening edits.

### S2.1 — `app/synth_turn.py` (~45m)
- Lock file stores `{pid}:{hostname}:{ts_ms}` instead of bare PID — foolproof stale-steal detection across network shares.
- `ThreadPoolExecutor.__exit__` wrapped in `concurrent.futures.wait(timeout=SYNTH_TIMEOUT_SEC * 2)` with cancel-on-timeout. Prevents one deadlocked edge-tts worker hanging the whole hook.
- One summary metric line per invocation: `synth_turn: n=12 ok=12 total_ms=3421 parallelism=4`.

### S2.2 — `app/key_helper.py` (~45m)
- Replace `keybd_event` with `SendInput` (single atomic `INPUT_KEYBOARD` struct). More reliable across keyboard layouts; Microsoft's recommended API since Vista.
- Cache `get_process_tree` snapshot for 500 ms (invalidated on receiving `fgtree` after a timestamp-bumped marker).
- Per-session helper log `~/.terminal-talk/queue/_helper.log` — one line per command received, no command output.

### S2.3 — `app/wake-word-listener.py` (~30m)
- Adaptive threshold via EMA of recent scores: fire when `score > (noise_ema + 0.3)`. Removes false-positives in noisy rooms.
- `--selftest` flag: load model, open stream for 3 s, exit 0 if no crash. Installer can smoke-test post-dep install.

**File scope:** `app/synth_turn.py`, `app/key_helper.py`, `app/wake-word-listener.py`.

---

## Stream S3

**IPC hardening (~2h).** Three items addressing full-review §7's "what could go wrong if the renderer is ever compromised" concerns.

### S3.1 — IPC rate limits on mutating handlers (~45m)
Current risk: if the renderer is ever XSS-compromised, mutating handlers (`update-config`, `set-session-voice`, `set-session-label`, `set-session-focus`, `set-session-muted`, `set-session-include`, `remove-session`) have no rate cap — a malicious renderer could thrash config.json thousands of times per second.

Token-bucket limit: 20 calls/sec per handler name (not per session). Over limit → reject + log. Test: harness sends 100 calls in a tight loop, asserts ≥80 rejections logged.

### S3.2 — Extend `redactForLog` to arbitrary sensitive-key patterns (~30m)
Today it only strips `openai_api_key`. Replace the single-property check with a set lookup against a module-level `REDACT_KEYS = Set<string>`. Add `openai_api_key`, `claude_api_key` (future-proof), `supabase_service_key`, anything matching `/(api|secret|token|password|passwd)_?key/i`.

### S3.3 — Config schema validate on load (no new deps, ~45m)
Hand-rolled validator: `validateConfig(obj)` walks a table of `{ path, type, min, max, enum }` rules. On violation → log + fall back to defaults + archive the bad file as `config.json.invalid-<ts>`. No `ajv` dep; tight enough for this config shape.

**File scope:** `app/main.js`, `scripts/run-tests.cjs`, `config.schema.js` (new — plain JS rules table, not JSON Schema).

---

## Stream S4

**Test harness modernisation (~3h).** Fixes the three structural issues full-review §24 flagged:

### S4.1 — Behaviour tests replace source-grep (~1.5h)
Current: `run-tests.cjs:937-996` greps `main.js` source for strings like `/startWatchdog\(\)/` to "verify" the watchdog fires. Rename the function → test passes even if behaviour broke.

Replace with: spawn Electron in `TT_TEST_MODE=1`, use the existing IPC injection points, query real behaviour. Start with the watchdog (easiest; add an IPC `ping-watchdog` that returns last-sweep timestamp). Roll to nav-guards and CSP checks same way.

### S4.2 — EDGE_VOICES extraction + CI catalogue snapshot (~45m)
- Extract the 45-entry voice list from `app/renderer.js:851-913` to `app/lib/voices.json`.
- `scripts/verify-voices.cjs`: fetches `python -m edge_tts --list-voices`, diffs against `voices.json`, fails if a shipped voice is gone from Microsoft's catalogue.
- Wire into CI (optional job, runs weekly; failure posts an issue rather than blocking PRs).

### S4.3 — Coverage reporting via `c8` (~45m)
- Add `c8` as devDependency.
- `npm run test:coverage` runs `c8 node scripts/run-tests.cjs --logic-only`.
- Upload `coverage/` as CI artefact.
- Set a floor (`c8 --check-coverage --lines 75`) but don't fail initial PRs — let the floor track upward.

**File scope:** `scripts/run-tests.cjs`, `scripts/verify-voices.cjs` (new), `app/lib/voices.json` (new), `app/renderer.js` (import voices.json), `package.json` (c8 dep + scripts), `.github/workflows/test.yml` (coverage upload).

---

## Stream S5

**§8d — mocks-annotated iframes the kit with overlay annotations (~2h).**

Current: `docs/design-system/mocks-annotated.html` is 1,051 hand-written lines reproducing the product's visuals with duplicate CSS. Every product change risks drift.

Rewrite as:
- iframe pointing at `docs/ui-kit/index.html?seed=<preset-name>` (kit gains a URL-param loader for seeded demo state).
- Overlay `<div class="annotation">` elements positioned absolutely on top via JS that measures the iframe's DOM.
- Five preset seeds matching the five current mock sections: `idle`, `three-sessions`, `mixed-states`, `settings-panel`, `snapped-top`.

Benefit: kit and mocks share the exact same DOM + CSS at runtime. Product change → kit updates via R2/R1 token pipeline → mocks update automatically.

**File scope:** `docs/design-system/mocks-annotated.html`, `docs/ui-kit/index.html` (add seed loader).

---

## Tier Z-2

Polish, each <30 min, fully independent files.

| # | ID | Source | Fix | File |
|---|----|---|---|---|
| Z2-1 | full-review §34 CI | Action versions pinned by tag (`@v4`), not SHA — supply-chain risk | Pin to SHAs; Dependabot already configured to bump | `.github/workflows/*.yml` |
| Z2-2 | full-review §34 CI | No Node-version matrix — regressions on older Node slip through | `strategy.matrix.node: [18, 20, 22]` on Ubuntu job | `.github/workflows/test.yml` |
| Z2-3 | full-review §34 CI | No Playwright job in CI — the 13 E2E tests only run locally | Add `e2e-windows` job on `windows-latest` running `npx playwright test` | `.github/workflows/test.yml` |
| Z2-4 | full-review §7 main.js | No integrity check on spawned Python scripts | Compute SHA-256 of each `app/*.py` at boot, log diag line; don't block on mismatch (forensic only) | `app/main.js` |
| Z2-5 | full-review §7 main.js | `helperRequest` has no parent-side health check — if key_helper hangs, requests time out forever but process stays alive | Ping/pong every 30 s; respawn on 2 s silence | `app/main.js` |
| Z2-6 | full-review §17 statusline.ps1 | Statusline re-reads registry on every prompt — race on rapid invocations | 100 ms debounce (file-level cache with mtime check) | `app/statusline.ps1` |
| Z2-7 | full-review §21 install.ps1 | No post-copy verification — tampered install files go undetected | Write `~/.terminal-talk/manifest.json` with SHA-256 of every installed file | `install.ps1` |
| Z2-8 | full-review §22 uninstall.ps1 | `Remove-Item -Recurse -Force` can partial-fail on locked files | `Get-Process | Wait-Process -Timeout 5` between stop and remove; list leftovers | `uninstall.ps1` |

---

## Tier D-2

Explicit deferrals — carried so they don't disappear.

| # | Item | Why deferred |
|---|---|---|
| D2-1 | **§8e — collapse duplicated design-system pages into dynamic `components.html?name=dots`** | Touches `colors-session.html`, `components-dots.html`, `component-sessions-row.html`, `components-forms.html` + needs a routing layer. v0.3 work. |
| D2-2 | **§8f — version the docs (`docs/v0.2/` archive on release)** | Needs a release-time script and decision on Git LFS for screenshots. v0.3 work. |
| D2-3 | **Kit-as-iframe-wrapper (original §8b)** | Already carried in ULTRAPLAN out-of-scope list. Dependency for making S5 even cleaner (kit iframes product; mocks iframe kit). |
| D2-4 | **IPC signing / integrity for PS hooks → synth_turn handoff** | Architecture decision: does the threat model warrant authentication between trusted local processes? Design-review not code. |
| D2-5 | **Config validation via `ajv`** | S3.3 ships a hand-rolled validator. If config shape grows, upgrading to ajv gets us JSON-Schema-driven editor autocomplete. Cost: one npm dep. |
| D2-6 | **ULTRAPLAN's original D1 + D2 + D3** | Electron 32→41 upgrade, safeStorage, pixel-diff rig. Still deferred. |

Plus carry-overs from ULTRAPLAN "Out of scope" (unchanged): Mac/Linux port, signed-manifest verification for installer, Sentry/Crashpad.

---

## Terminal split

Language-based. No overlap on any single file.

### Terminal-1 — "JS / TS / CI" (~7.5h)

**Branch:** `stream-ua2-js`  **Worktree:** `../terminal-talk-ua2/`

- A2-1 `app/preload.js` disposers
- A2-2 `app/main.js` AUDIO_FILE_RE constant
- S1 (all four sub-items)
- S3 (all three sub-items)
- S4 (all three sub-items)
- Z2-1, Z2-2, Z2-3 — CI hardening
- Z2-4, Z2-5 — main.js integrity + keyHelper watchdog

### Terminal-2 — "Python / docs / install" (~4.5h)

**Branch:** `stream-ua2-py`  **Worktree:** `../terminal-talk-ua2-py/`

- A2-3 `app/edge_tts_speak.py` constants + timeout
- A2-4 `app/sentence_split.py` abbrev + dash + NEL/LS + CJK (plus 1 new test per new abbrev)
- S2 (all three sub-items)
- S5 §8d mocks-annotated iframe rewrite
- Z2-6 `app/statusline.ps1` debounce
- Z2-7 `install.ps1` manifest
- Z2-8 `uninstall.ps1` wait-process

### Files each terminal may touch

**Terminal-1 only:** `app/preload.js`, `app/main.js`, `app/renderer.js`, `scripts/run-tests.cjs`, `scripts/verify-voices.cjs` (new), `app/lib/voices.json` (new), `config.schema.js` (new), `package.json`, `.github/workflows/*.yml`.

**Terminal-2 only:** `app/edge_tts_speak.py`, `app/sentence_split.py`, `app/synth_turn.py`, `app/key_helper.py`, `app/wake-word-listener.py`, `app/statusline.ps1`, `install.ps1`, `uninstall.ps1`, `docs/design-system/mocks-annotated.html`, `docs/ui-kit/index.html`.

**Conflict zone:**
- `scripts/run-tests.cjs` — Terminal-1 adds behaviour + coverage tests; Terminal-2 adds per-abbreviation tests in the SENTENCE SPLIT describe block.
  Resolution: Terminal-2 appends only inside the existing `describe('SENTENCE SPLIT', ...)` block (lines around 860); Terminal-1 adds new describe blocks at the end of file. Zero line overlap if both stay inside their islands. Pull before each commit regardless.
- `docs/ui-kit/index.html` — Terminal-1 does not touch; Terminal-2 adds a URL-param seed loader as part of S5.
- `app/renderer.js` — Terminal-1 imports voices.json (S4.2); Terminal-2 does not touch. No conflict.

---

## Merge order

1. Tier A-2 + Stream S3.3 config schema — lands first, independent
2. Stream S1 (observability) and Stream S2 (Python helpers) — parallel, no file overlap
3. Stream S3.1 + S3.2 (IPC hardening) + Stream S5 (mocks-annotated) — parallel
4. Stream S4 (test modernisation) — after S1/S3 land so behaviour tests cover the new handlers
5. Tier Z-2 — any order; lands last

No stream blocks any other except S4 preferring S1/S3 to be merged so it can test the real handlers.

---

## Test posture after this lands

| Phase | New tests | Target total |
|-------|-----------|--------------|
| After Tier A-2 | +15 (~8 for sentence_split abbrevs, +2 AUDIO_FILE_RE, +5 edge_tts env-override) | 122 |
| After S1 | +3 (renderer error → log, rate-limit, stack-dedupe) | 125 |
| After S2 | +5 (synth_turn lock identity, executor timeout, key_helper SendInput smoke, wake-word selftest, adaptive threshold) | 130 |
| After S3 | +8 (IPC rate limit × 5 handlers, redactForLog key set, config validator happy/sad path) | 138 |
| After S4 | +10 (watchdog behaviour, CSP behaviour, nav-guard behaviour, voice-catalogue parity, coverage-floor smoke) + coverage CI artefact | 148 |
| After S5 | +2 (iframe mounts, annotations overlay within 200 ms) | 150 |
| After Tier Z-2 | +3 (statusline debounce under burst, install manifest SHA matches, uninstall wait-process timeout) | 153 |

Target: **153 unit + 13 E2E + 3 CI guards (doc-drift, voice catalogue, Playwright on Windows).**

---

## Success criteria

- **Tier A-2 done**: npm test 122 green. No magic numbers in `edge_tts_speak.py`. Every abbreviation in the expanded list has a round-trip test.
- **Stream S1 done**: throw in renderer → line appears in `_toolbar.log` within 100 ms. Stack dedupe keeps log under control during runaway exception loops.
- **Stream S2 done**: `synth_turn.py` survives kill -9 on a worker (lock gets stolen cleanly). `key_helper.py` sends identical keystrokes on `de-DE`, `en-US`, `en-GB`. `wake-word --selftest` exits 0 on the CI runner.
- **Stream S3 done**: 100-IPC-call-burst test logs ≥80 rejections. `redactForLog` strips every key matching the pattern + the explicit deny-list. Bad config.json boots with defaults, archived at `config.json.invalid-<ts>`.
- **Stream S4 done**: every source-grep assertion in `run-tests.cjs:937-996` replaced with a behaviour test. `c8` coverage report in CI artefacts. Weekly voice-catalogue job exists and passes.
- **Stream S5 done**: `mocks-annotated.html` file size < 400 lines (from 1,051). Annotation overlays align within 2 px of their target elements across all 5 seeds.
- **Tier Z-2 done**: CI runs on Node 18/20/22 matrix. Playwright job green on windows-latest. `~/.terminal-talk/manifest.json` present after install; SHA verification script in `scripts/verify-install.cjs`.

---

## Next action

Both terminals: pull `main`, read this file, read `COORDINATION.md`, pick a stream from your lane, create worktree, go. Commit per logical unit.
