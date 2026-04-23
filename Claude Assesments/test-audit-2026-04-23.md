# Test-coverage audit — 2026-04-23

Phase 1 of the four-phase test quality programme. Doc-only. Scopes every `describe()` block in `scripts/run-tests.cjs` against every shipped module in `app/` + `hooks/`, then identifies:

- **Untested features** — code that shipped but no test exercises it.
- **Thin coverage** — tested, but not enough to catch regressions.
- **Possibly stale tests** — written for a feature that's since moved/renamed.
- **Zero-test modules** — whole files with no coverage.

Approve the gap list at the bottom before Phase 2 starts writing tests.

---

## Headline numbers

| metric | value |
|---|---|
| Total `describe()` blocks | 77 |
| Total `it()` tests | 580 |
| Shipped modules (JS / Python / PS / etc.) | 45 |
| Total source lines (non-test) | ~12,500 |
| IPC channels exposed | 22 |
| Subsystems with zero dedicated tests | 2 (transcript-watcher, scrape-hooks) |
| Features shipped in the last 2 days with no tests | 8 (see §4) |

---

## 1. Per-subsystem coverage

| subsystem | tests | shipped LOC | verdict |
|---|---|---|---|
| synth-pipeline | 122 | 2,087 | **healthy** — sentence split, grouping, tool narration, sanitiser all have depth tests. |
| ipc | 97 | 602 | **healthy** — all 22 IPC channels register-wired + most mutation handlers round-tripped. |
| ui-components | 96 | 2,352 | **healthy** — every extracted component has an EX7*-tagged block. |
| session-registry | 88 | 697 | **healthy** — palette alloc + LRU + PS identity have strong coverage. |
| audio-pipeline | 68 | 758 | **medium** — AudioPlayer + clip-paths + queue-watcher covered; mic-watcher describe block is empty (0 tests). |
| hardening | 48 | 125 | **medium** — CSP, navigation, redaction, input validation all have ≥3 tests. S5 defensive-branch group is solid. |
| config-store | 32 | 243 | **medium** — validator + api-key-store both covered; no test for `master_volume` rule (added 2026-04-23). |
| heartbeat | 13 | 162 | **thin** — decision logic covered, but HB4 system-auto-pause guard shipped untested. |
| transcript-watcher | 0 | 188 | **gap** — entire module has no dedicated test. Recent bug (`find_last_user_idx` treating `tool_result` as user) only got a Python-side unit test, not a JS-side watcher test. |
| scrape-hooks | 0 | 679 | **gap** — four PS hook scripts + `scrape-footer.ps1` + `terminal-scrape.psm1`. All untested. Justified (needs desktop session) but the parent-side timeout logic I just added (commit `d4dddac`) is testable at the PS level. |
| cross-cutting | 14 | — | **healthy** — JS↔Python defaults + install sanity + strip parity. |

---

## 2. Modules with zero or near-zero test coverage

| module | LOC | why it matters |
|---|---|---|
| `app/mic-watcher.ps1` | 94 | Drives HB4 (external app mic grab). MIC-WATCHER describe block is empty. |
| `app/wake-word-listener.py` | 289 | "hey jarvis" trigger. No tests exist. Stateful, spawns subprocesses — high risk of silent drift. |
| `app/key_helper.py` | 260 | Hotkey + foreground-process tree scanner. No tests. |
| `app/lib/transcript-watcher.js` | 188 | Phase-2 streaming. No JS tests — the module that spawns synth_turn is unvalidated. |
| `app/lib/tokens-window.js` | 60 | Palette tokens exposed to renderer. Covered obliquely by palette-parity tests but no direct surface test. |
| `app/lib/voices-window.js` | 221 | Voices list. Describe block at L3945 has 0 tests. |
| `app/scrape-footer.ps1` + `app/terminal-scrape.psm1` | 220 | UIA scrape. Understandably desktop-only, but the subprocess-timeout boundary (hook side) is testable. |
| `hooks/speak-response.ps1` | 450 | The entire Stop hook. Covered via sanitiser parity, but the orchestration (flag-clear → scrape → spawn synth_turn) is untested. |
| `hooks/speak-on-tool.ps1` | 102 | PreToolUse hook. No tests. |
| `hooks/speak-notification.ps1` | 72 | Notification hook. No tests. |
| `hooks/mark-working.ps1` | 55 | UserPromptSubmit hook — writes the flag transcript-watcher gates on. Untested. |

---

## 3. Untested features shipped in the last ~7 days

Each is a commit on `main` that didn't ship with a corresponding test.

| commit | feature | why it needs a test |
|---|---|---|
| `6244bfd` | Master volume slider | `playback.master_volume` config rule, `AudioPlayer.setMasterVolume()`, heartbeat-vs-body ratio preservation. |
| `ad10044` | On/Off pill toggles | `_wirePillToggles`, `pill-sync` custom event. |
| `a691e58` | HB4 `_systemAutoPaused` playPath guard + `systemAutoResume` drain + HB3 `-H-` prefix | playPath refuses during system-auto-pause, resume drains queue — regression magnets. |
| `e6f7fd2` | `find_last_user_idx` skips `tool_result` | Test DID ship alongside. ✓ |
| `3797bfa` | `tool_calls` in ALLOWED_INCLUDE_KEYS + cross-module parity | Tests DID ship alongside. ✓ |
| `42afafd` | Per-session round-trip | Test IS this commit. ✓ |
| `d4dddac` | Scrape-subprocess hard 4s timeout | Parent-side `System.Diagnostics.Process` + `Kill()` fall-through — untested. |
| `2b1c1a5` | STA sub-process for scrape | Untested (justified — desktop-only, but the wrapper script has testable arg-parsing). |

**Net untested items from last 7 days: 4.** Not 8 — three recent commits already shipped with tests.

---

## 4. Thin coverage areas that deserve a second pass

Tests exist but don't cover the failure modes most likely to bite:

1. **AudioPlayer mid-clip state transitions.** `systemAutoPause` during heartbeat → `systemAutoResume` after clip arrived during pause → does it play the arrival clip or skip it? Not exercised. Bug Ben reported live on 2026-04-22.

2. **Speech-includes combinatorial matrix.** Seven Boolean keys × global/per-session override × muted state = 256 + configurations. Zero combinatorial test exists. (This is Phase 3 of the plan.)

3. **Transcript watcher lifecycle.** Start → poll with flag present → transcript appears mid-flight → flag clears → synth finishes after flag clear. None of those transitions have a test.

4. **Heartbeat pause/resume races.** `isQueueActive` + `isSystemAutoPaused` + `heartbeat_enabled` form a 3-input truth table. HB1/HB2/HB3 tests cover the skip-or-emit outcome but not the race where the truth table changes mid-decision.

5. **Panel-dismissed vs toolbar-hidden state.** The pill-toggle regression that surfaced today (Ctrl+Shift+A cycle losing settings) isn't covered — the renderer keeps in-memory `sessionAssignments` that the next `queue-updated` can overwrite.

6. **Main process config-store write collisions.** Two IPC `update-config` requests arriving ~ms apart. `registry-lock` is tested but no test covers concurrent `writeConfig` (non-locked).

---

## 5. Possibly-stale tests to investigate in Phase 2

These describe blocks were added early and may no longer line up with current architecture:

| describe | suspicion |
|---|---|
| `STATUSLINE ASSIGNMENT` (L230-277) | Pre-dates `session-registry.psm1` extraction. May duplicate `PS SESSION-IDENTITY BEHAVIOUR`. |
| `PER-SESSION OVERRIDE MERGE` (L401-424) | May overlap with `EX6f-2 — ipc-handlers (session-edit mutations)`. |
| `REGISTRY BOM HANDLING` (L426-437) | Single test; PS modules now canonical — check if BOM handling is a module concern. |
| `EDGE TTS WRAPPER` (L279-285) | Single smoke test; edge_tts_speak.py has had multiple changes since. |
| `STRIP-FOR-TTS PARITY` (L2052) | 0 tests — placeholder? |
| `MIC-WATCHER` (L3738) | 0 tests — placeholder? |
| `R4 ACCESSIBILITY BASELINE` (L3862) | 0 tests — placeholder? |
| `S4.2 — voices.json parity` (L3945) | 0 tests — placeholder? |
| `S5 — api-key-store corruption paths` (L7157) | 0 tests — placeholder? |

Five of the above are empty `describe()` blocks. Phase 2 either fills them or deletes them — no point keeping empty describes.

---

## 6. Priority-ordered gap list for Phase 2

Tier A — high-risk, high-recency:

1. **`AudioPlayer.setMasterVolume` + `systemAutoPause`/`Resume` round-trip.** The pause-then-new-clip-arrives case Ben caught. 4-5 tests.
2. **Scrape subprocess 4s timeout.** Spawn a fake scrape helper that sleeps 10s, assert the parent kills and falls through. 2 tests.
3. **Transcript-watcher lifecycle.** Flag set → watcher finds transcript → spawns synth_turn → flag clears → watcher stops spawning. 4 tests.
4. **Speech-includes combinatorial smoke.** Not the full matrix yet — just the 7 × per-session override interaction that shipped. 10-15 tests. (Full matrix is Phase 3.)

Tier B — modules with no coverage:

5. **mic-watcher** (integration test via stdout contract).
6. **mark-working.ps1** (writes flag → readable by transcript-watcher).
7. **wake-word-listener.py** (at least: it starts, it stops, it doesn't crash on empty mic input).
8. **key_helper.py** (edge cases around process tree gaps).

Tier C — cleanup:

9. Fill or delete the 5 empty describe blocks in §5.
10. Resolve suspected duplicate tests in §5 Tier A.
11. Add `playback.master_volume` to the `config-validate` defaults-parity test.

---

## Recommendation for Phase 2 scope

Split Phase 2 across two sessions:

- **Phase 2a** — Tier A (items 1-4). ~25-30 new tests. Likely surfaces 1-3 real bugs.
- **Phase 2b** — Tier B + Tier C (items 5-11). ~15-20 new tests. Mostly cleanup.

**Approval questions for you:**

1. OK to do Phase 2a and 2b as two separate sessions, or should I batch them?
2. Any module in §2 you'd drop from scope (e.g., `wake-word-listener.py` — if it's effectively vestigial the audit time isn't warranted)?
3. Any Tier A item you'd demote or Tier B/C item you'd promote?

Phase 3 (combinatorial matrix) and Phase 4 (function-by-function vuln pass) stand unchanged after this audit.

---

## Post-phase updates

### Phase 2a result (commit `5ac8b77`)

465 → 512 tests, 0 regressions, 0 new bugs. Tier A complete.

### Phase 2b result

512 → 533 tests, 0 regressions. Two findings:

- **Real bug**: `Get-Date -UFormat %s` on Windows PowerShell 5.1 returns LOCAL-time seconds, not UTC. Flags written by `mark-working.ps1`, `statusline.ps1`, and `speak-response.ps1` had a BST (+1h) drift vs the JS reader's `Date.now() / 1000`. Accidentally worked in UK summer; would silently break `get-working-sessions` IPC → heartbeat gating in any other timezone. Fixed: replaced all five sites with `[DateTimeOffset]::Now.ToUnixTimeSeconds()`. Caught by a `mark-working.ps1` freshness test with a > 60s drift threshold.
- **Schema drift**: `playback.master_volume` (shipped 2026-04-23 in `6244bfd`) was in `app/lib/config-validate.js` but missing from `config.schema.json`. Editor autocomplete would mark the key as unknown. Fixed.

### Corrections to Phase 1 findings

The Phase 1 inventory agent miscounted `it()` tests inside for-loops and conditional blocks. Re-verification:

| describe block | audit claim | reality |
|---|---|---|
| `STRIP-FOR-TTS PARITY` (L2052) | 0 tests | **4** — JS ↔ Python ↔ PowerShell rule-by-rule checks |
| `MIC-WATCHER` (L4299) | 0 tests | **11** — full wiring chain from PS sidecar to audio-player flag |
| `R4 ACCESSIBILITY` (L4423) | 0 tests | **7** — aria-labels, prefers-reduced-motion, focus rings |
| `S4.2 — voices.json parity` (L4506) | 0 tests | **5** — codegen parity between source voices.json + generated window bundle |
| `S5 — api-key-store corruption` (L7892) | 0 tests | **2** — corruption recovery paths |

"Suspected stale" tests from §5 were also verified. None are actually duplicates:
- `STATUSLINE ASSIGNMENT` tests the statusline.ps1 wrapper behaviour; `PS SESSION-IDENTITY BEHAVIOUR` tests the session-registry.psm1 module it calls. Different layers.
- `PER-SESSION OVERRIDE MERGE` tests the `mergeIncludes()` helper; `EX6f-2 session-edit mutations` tests the IPC round-trip. Different concerns.
- `REGISTRY BOM HANDLING`, `EDGE TTS WRAPPER` are single-test smoke checks but each guards an invariant (no BOM written, edge-tts actually produces audio) not covered elsewhere.

### Phase 3 result

533 → 541 tests (8 new), 0 regressions. **Two real JS↔Python drifts surfaced** and documented as lock-in tests:

1. **Single-underscore emphasis**: Python's `_EMPHASIS_RE` strips `_x_` italic markers; JS's equivalent doesn't. Token `QZX_HEADING_ZQ` in plain prose becomes `QZXHEADINGZQ` via Python but unchanged via JS. Neither is unambiguously wrong — JS is safer for identifiers, Python is more faithful to markdown. Resolved as DOCUMENTED behaviour via a drift-documenter test; aligning them is a product decision you can make later.
2. **Code-block content shielding**: JS stores code-block bodies in `\0CB<N>\0` sentinel placeholders so later emphasis/bullet/url regexes can't mangle them; Python returns them inline, exposing code to all downstream regexes. A code block containing `__dunder__` reads correctly via JS highlight-to-speak but loses its underscores via the Python Stop-hook synth. Same resolution — locked in as drift, surface-visible if either side changes.

What the new combinatorial tests cover:
- **Full 128 permutations** × **5 feature-presence invariants** (640 assertions in one test): every toggle gates its own feature and doesn't bleed into another's.
- **64 × tool_calls-flip invariance** (one test): tool_calls flipping never changes JS output.
- **16 Python-parity samples** (batched subprocess call): JS ≡ Python byte-for-byte after whitespace normalization.
- **128 × 3 markdown-leak checks**: no permutation ever leaks ``` fences, `**word` bold markers, or `~`.
- **128 × null/throw safety**: every combo returns a finite string.
- **7 × 2 session-override**: per-session always wins over global.

### Phase 4 entry state

Harness sits at **541 tests, 0 gaps in the Tier-A/B/C scope, 2 documented JS↔Python drifts**. Phase 4 (function-by-function vulnerability pass) runs one module per session.

### Phase 4 — Module 1 result (commit forthcoming)

**Target**: `app/lib/text.js` / `stripForTTS`. Pipe for every turn's audio + every highlight-to-speak clip. Tested 2026-04-23.

**29 probing tests across 7 categories**:

1. **Type safety (6 tests)** — null, undefined, number, boolean, object, array. All coerce to string without throwing. The existing `String(text == null ? '' : text)` guard holds up.
2. **Regex complexity / ReDoS (5 tests)** — 100 KB plain prose, 1000 consecutive asterisks, 1000 consecutive underscores, unclosed fence with 5000-line body, 500 alternating backticks. All complete in < 500 ms (no catastrophic backtracking on any regex).
3. **Empty-payload corners (4 tests)** — empty fences, empty inline backticks, empty link `[](url)`, empty image `![](url)`. All handled cleanly.
4. **Unicode fidelity (5 tests)** — CJK, emoji, Arabic RTL, zero-width joiner adjacency, astral-plane surrogate pair. All preserved.
5. **Control chars / line endings (3 tests)** — NUL byte alongside prose, CRLF=LF equivalence, bare CR (classic-mac). All handled.
6. **Mixed/nested markdown (3 tests)** — code fence inside bullet list, emphasis inside link text, triple-asterisk bold-italic.
7. **Whitelist boundary + performance (3 tests)** — 30-char inline-code kept, 31-char stripped, 50 KB realistic input under 500 ms.

**Result**: Zero real bugs surfaced. Module 1 is robust. Found one low-severity note:

- The code-block placeholder sentinels are `\u0000CB<N>\u0000`. User input containing those exact bytes AFTER a real code fence in the same input could theoretically collide, but the `if (codeBlocks.length > 0)` guard prevents false restoration. Not a security boundary (users control their own input to TTS); no fix needed.

541 → 570 tests local (580 with other terminal's concurrent work).

### Phase 4 — remaining modules

Recommended order for subsequent sessions (biggest attack surface first):

- **Module 2**: `app/lib/palette-alloc.js` (LRU + hash-collision paths; user-intent protection recently added)
- **Module 3**: `app/session-registry.psm1` (PID migration edge cases; `/clear` handling)
- **Module 4**: `app/lib/ipc-handlers.js` (mutation surface; already covered, but look for missing validator branches)
- **Module 5**: `app/lib/audio-player.js` (state transitions during scrubbing + user clicks + system pause)
- **Module 6**: `app/lib/clip-paths.js` (path regex surface; user filenames could be adversarial)
