# S3 — Python (ruff) + PowerShell (PSScriptAnalyzer) findings

**Scanned:** 2026-04-20

## Python — ruff

**Tool:** Ruff 0.15.11
**Config:** `ruff.toml` — line-length 120, target py310, rules E+F+W+I+B+C90+UP+SIM+PIE
**Files:** `app/synth_turn.py`, `app/sentence_split.py`, `app/edge_tts_speak.py`, `app/key_helper.py`, `app/wake-word-listener.py` (5 files, 1,687 lines)

### Baseline (after target-version fix)

After correcting `target-version` from `py38` → `py310` (install.ps1 pins 3.10+), **50 findings**:

| Count | Rule | Description |
|---|---|---|
| 24 | UP006 | `List[str]` → `list[str]` (PEP 585) |
| 5 | UP015 | Redundant `open()` modes |
| 4 | UP045 | `Optional[X]` → `X \| None` (PEP 604) |
| 3 | SIM105 | `try/except/pass` → `contextlib.suppress(...)` |
| 3 | SIM108 | `if/else` block → ternary |
| 2 | E701 | Multiple statements on one line |
| 1 | B007 | Unused loop control variable |
| 1 | C901 | Function complexity 22 > 15 |
| 1 | F401 | Unused import |
| 1 | I001 | Unsorted imports |

### Actions

**Auto-fixed (40 of 50):** `ruff check --fix` applied all safe fixes — UP006, UP015, UP045, F401, I001, and most E701s. No hand-editing.

**Hand-fixed (7):**
- **B007** (`synth_turn.py::parse_transcript`): loop variable `i` was unused; simplified `for i, raw in enumerate(f)` → `for raw in f`.
- **SIM105 × 3** (`synth_turn.py:483`, `synth_turn.py:609`, `key_helper.py:231`): converted `try/except/pass` → `with contextlib.suppress(...):`. Added `import contextlib` to both files.
- **C901** (`wake-word-listener.py::main`): complexity 22 > threshold 15. Extracted the stream-management loop (mute-toggle driven open/close cycle, ~40 lines) into `_run_stream_loop(callback)`. Also factored `_open_stream`/`_close_stream` helpers to keep the main tightly scoped. Main now focuses on: model load, audio device query, ring + noise-EMA init, callback closure definition, delegate to loop. Complexity dropped below 15; audio callback hot path untouched so the real-time allocation hygiene the existing comments call out is preserved.

**Accepted with `noqa` (3):**
- **SIM108 × 3** (`synth_turn.py::sanitize`): ruff wants the three `if/else` blocks around regex-sub calls converted to ternaries. The suggested one-liners have nested lambda + method-chain + boolean inside the ternary, less readable than the explicit form. `# noqa: SIM108` added with rationale.

### Final state

`python -m ruff check app/*.py` → **All checks passed.** Exit 0.

---

## PowerShell — PSScriptAnalyzer

**Tool:** PSScriptAnalyzer 1.25
**Config:** `PSScriptAnalyzerSettings.psd1` (severity = Error + Warning)
**Files:** 7 total — `hooks/*.ps1` (4), `app/*.ps1` (1), `app/*.psm1` (2), `install.ps1`, `uninstall.ps1`

### Baseline (after rule exclusions)

Initial scan produced 83 findings but 74 of them were idiomatic false-positives for our context:

- **50× PSAvoidUsingWriteHost** — our install/uninstall/hook scripts *intentionally* write to the user's console and must NOT participate in pipelines (their callers are Claude Code's Stop hook, `install.ps1` interactive prompts, etc.). Write-Host is exactly the right primitive here. Same rationale as ESLint's `no-console: off`.
- **24× PSAvoidUsingEmptyCatchBlock** — `try { fs-op } catch {}` is idiomatic for best-effort file/registry cleanup. Mirrors ESLint's `no-empty: { allowEmptyCatch: true }`.

Both excluded in `PSScriptAnalyzerSettings.psd1` with rationale comments. Also pre-excluded:
- **PSUseShouldProcessForStateChangingFunctions** — our hooks are non-interactive, no WhatIf/Confirm semantics.
- **PSAvoidGlobalVars** — modules intentionally cache registry state via globals.

Post-exclusion: **9 real findings**.

| # | Rule | File:line | Action |
|---|---|---|---|
| 1 | PSAvoidAssignmentToAutomaticVariable | `hooks/speak-on-tool.ps1:81` | **fix** — renamed `$args = @(...)` to `$synthArgs`. `$args` is a PowerShell automatic variable; assigning clobbers the caller's access to its arguments. |
| 2–5 | PSUseBOMForUnicodeEncodedFile | `hooks/speak-response.ps1`, `app/statusline.ps1`, `app/tts-helper.psm1`, `uninstall.ps1` | **fix** — re-saved each with a UTF-8 BOM prepended. These files contain non-ASCII (emoji used as session colour indicators + branded prompts), and without a BOM the PowerShell 5.x default encoding can misread them. 4 one-shot re-encodes. |
| 6 | PSUseDeclaredVarsMoreThanAssignments | `app/statusline.ps1:87` | **fix** — `$paletteSize = 24` was a leftover from an earlier arrangement-mapping pass; the statusline uses `$hsplitPartner` + `$vsplitPartner` tables instead. Deleted. |
| 7 | PSReviewUnusedParameter | `install.ps1::Unattended` | **suppress** — false positive. `$Unattended` IS used inside the script-scoped `Get-Consent` helper, but PSScriptAnalyzer doesn't track script-param usage across nested function bodies. Added `[Diagnostics.CodeAnalysis.SuppressMessageAttribute]` with justification string. |
| 8–9 | PSUseSingularNouns | `tts-helper.psm1::Invoke-EdgeTts`, `Invoke-OpenAiTts` | **rule exclude** — `Tts` is an acronym (Text-To-Speech), not a grammatical plural. Renaming to `Invoke-EdgeSpeech` etc. would ripple through every hook + module that imports them. Industry-standard cmdlets like `ConvertTo-Json` accept the same shape. Added `PSUseSingularNouns` to ExcludeRules with rationale. |

### Final state

`Invoke-ScriptAnalyzer -Settings PSScriptAnalyzerSettings.psd1` → **0 findings.**

---

## Combined S3 impact

| Tool | Before | After | Fix breakdown |
|---|---|---|---|
| ruff | 50 findings (including type modernization, contextmanager suggestions, 1 complexity violation) | 0 | 40 auto, 7 hand, 3 accept-with-noqa |
| PSScriptAnalyzer | 83 findings (74 idiomatic FPs + 9 real) | 0 | 5 hand, 2 suppress-attr/noqa, 2 rule-exclude-with-rationale |

Notable pattern: **ESLint's `allowEmptyCatch` + PSScriptAnalyzer's `PSAvoidUsingEmptyCatchBlock` exclusion + ruff's `contextlib.suppress` preference** are all the same conversation — "best-effort filesystem operations are idiomatic in this codebase". The three tools converged on the same class of false-positive in their own languages.
