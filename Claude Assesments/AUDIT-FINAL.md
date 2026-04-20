# Terminal Talk — Final Audit (Claude Assessments → shipped state)

**Pass date:** 2026-04-20
**Main at:** `3b18a3c` (post-ULTRAPLAN-ADDENDUM + render-mocks hotfix)
**Tests:** 146 `--logic-only` · full harness green on CI (`eda368f` was the last CI validation)

Systematic cross-reference of every numbered finding across the six source assessments + the ULTRAPLAN + the ULTRAPLAN-ADDENDUM against shipped git history. Purpose: answer "have we covered all bases, all faults rectified?"

---

## Cross-cutting findings — `terminal-talk-full-review.md` (CC-1..CC-8)

| ID | Finding | Disposition | Commit |
|----|---------|-------------|--------|
| CC-1 | `stripForTTS` × 4 copies | ✅ shipped | `a3b5b69` refactor(A2) |
| CC-2 | Python/JS `speech_includes` default mismatch | ✅ shipped | `1c85c86` (pre-ULTRAPLAN) |
| CC-3 | Wrong `response_voice` / `voices.openai_api_key` keys | ✅ shipped | `1c85c86` |
| CC-4 | Session-registry × 4 PS copies | ✅ shipped | `38e1c1d` refactor(A3) |
| CC-5 | Stale palette upper-bound (31→23) | ✅ shipped | `1c85c86` |
| CC-6 | Vertical-dock dead code | ✅ shipped | `b9e760d` |
| CC-7 | Stale doc counts | ✅ shipped | `7b8f107` + `2dfdd53` + R3 |
| CC-8 | OpenAI-TTS fallback × 3 PS copies | ✅ shipped | `2bba5e2` |

---

## Bundle review pass 1 — `terminal-talk-bundle-review.md`

| ID | Finding | Disposition | Commit |
|----|---------|-------------|--------|
| §1a | Kit palette disagrees with product (9/16 slots) | ✅ shipped | R1 (`88bd8ac` kit imports from tokens.mjs) |
| §1b | Kit toolbar geometry wrong (44 vs 114) | ✅ shipped | R2.1 (`bd70365`) |
| §1c | Kit SessionsTable missing mute/focus/× | ✅ shipped | R2.2 (`870695c`) |
| §1d | Kit loads React dev build | ✅ shipped | R2.3 (`6d318f3`) |
| §2a | Architecture diagram says "AutoHotkey/ps" | ✅ shipped | R3.1 (`e5f9ab5`) |
| §2b | Wrong queue dir `%APPDATA%` | ✅ shipped | R3.1 |
| §2c | Flow description misattributes keystroke | ✅ shipped | R3.1 |
| §3a | Three doc test-count drift | ✅ shipped | R3.3 + doc-drift CI guard |
| §3b | `SECURITY.md:97` redactSecrets→redactForLog | ✅ shipped | R3 / CC-7 |
| §3c | CONTRIBUTING source-tree stale | ✅ shipped | R3 |
| §3d | DESIGN-AUDIT line count | ✅ shipped | R3.4 |
| §8a | One shared design-tokens source | ✅ shipped | R1 (`bf32f40` tokens.json) |
| §8b | Kit-as-iframe-wrapper | ⏸ deferred | D2-3 (v0.3+) |
| §8c | Design-system pages visual diff against product | ⏸ deferred | D3 (v0.3+) |
| §8d | Annotated mocks should be generated, not hand-drawn | ✅ shipped | S5 (`bd1d923`) — now iframes the kit |
| §8e | Delete design-system pages that duplicate product | ⏸ deferred | D2-1 (v0.3+) |
| §8f | Version the docs (`docs/v0.2/` archive) | ⏸ deferred | D2-2 (v0.3+) |

---

## Pass 2 — `terminal-talk-bundle-review-pass2.md` (F1–F27)

| ID | Finding | Disposition |
|----|---------|-------------|
| F1 | Missing `docs/colors_and_type.css` | ✅ shipped A10 (`ac7d853`) + R1 regeneration |
| F2 | Kit toolbar geometry | ✅ shipped R2.1 |
| F3 | Dot size drift (14 vs 16) | ✅ shipped R2.1 (dots now 14px) |
| F4 | Mystery blue accent `#4FA3FF` | ✅ verified — product actually has it (`styles.css:201`), kit now matches |
| F5 | Settings cog SVG drift | ✅ shipped R2 (kit uses same path) |
| F6 | `components-dots.html` drift | ✅ resolved by F1 (colors_and_type.css) |
| F7 | `component-sessions-row.html` drift | ✅ resolved by F1 |
| F8 | Mystery blue in components-forms.html | ✅ verified as correct |
| F9 | Blue accent in components-iconbuttons.html | ✅ verified as correct |
| F10 | Radius drift 22→16 | ✅ shipped R2.1 (kit now 16px) |
| F11 | Phantom shadow on bar | ✅ shipped R2.1 (box-shadow: none) |
| F12 | Slider accent mystery blue | ✅ verified (product has white thumb, kit respects) |
| F13 | Mono font drift | ✅ shipped R3.4 (acknowledges product has no mono) |
| F14 | `type-ui.html` broken | ✅ resolved by F1 |
| F15 | `wordmark.html` broken | ✅ resolved by F1 |
| F16 | docs/README trails-product disclaimer | ✅ shipped R3 |
| F17 | False palette regression-test claim | ✅ shipped R1.7 (`c3db98b`) — test now actually exists |
| F18 | icons.svg missing 4 icons | ✅ shipped R2.4 (`41fbd57`) |
| F19 | ASCII banner consistency | ✅ positive finding, no action |
| F20 | toolbar-idle.png "680 × 64" | ✅ shipped R3.8 (text) + `3b18a3c` (PNG regenerated) |
| F21 | 9th colour (cyan) on landing | ✅ shipped R3.5 (cyan→yellow; brand cyan documented) |
| F22 | Screenshot layout inconsistency | ✅ resolved by R2 + PNG regen |
| F23 | Idle/settings screenshots wrong layout | ✅ resolved by PNG regen |
| F24 | three-sessions/snapped-top correct layout | ✅ verified |
| F25 | False multi-monitor claim | ✅ shipped R3.2 (`e5f9ab5`) |
| F26 | render-mocks.cjs hardcoded Chrome | ✅ shipped Z2 (`d6987f4`) + improved in `3b18a3c` |
| F27 | Mascot vs palette orange intentional | ✅ positive finding |

---

## Pass 3 — `terminal-talk-bundle-review-pass3.md` (G1–G30)

| ID | Finding | Disposition |
|----|---------|-------------|
| G1 | Kit script load order brittle | ✅ shipped Z10 |
| G2 | useEffect cleanup warning | ✅ resolved (minor) |
| G3 | ASCII banner in 3 places | ⏸ accepted (drift trap flagged; low priority) |
| G4 | Near-zero ARIA | ✅ shipped R4 |
| G5 | Mascot lacks aria-hidden | ✅ shipped R4.1 |
| G6 | Sessions table semantic markup | ✅ shipped R4.3 |
| G7 | Icon buttons use `title` not `aria-label` | ✅ shipped R4.2 |
| G8 | No `:focus-visible` / `prefers-reduced-motion` | ✅ shipped R4.4 + R4.5 |
| G9 | Focus-update race | ✅ shipped R5.3 (`8da7b6b`) |
| G10 | Palette hash collision no linear probe | ✅ shipped A1 (`8c98f67`) — LRU eviction |
| G11 | `extractSessionShort` regex order | ✅ shipped A7 |
| G12 | `priorityPaths` unbounded | ✅ shipped R5.1 |
| G13 | `scheduleAutoDelete` race | ✅ shipped R5.2 |
| G14 | config.example missing pause hotkeys | ✅ shipped Z1 |
| G15 | package.json versions behind CHANGELOG | ✅ shipped A8 (v0.2.0 tag) |
| G16 | Regression test for JS↔Python lock-step | ✅ positive finding (existed) |
| G17 | CHANGELOG advertises removed vertical | ✅ shipped R3.3 |
| G18 | CHANGELOG test count stale | ✅ shipped R3.3 + doc-drift |
| G19 | CHANGELOG + DESIGN-AUDIT three-tier | ✅ shipped R3.3 + R3.4 |
| G20 | Focus mode missing from CHANGELOG | ✅ shipped R3.3 |
| G21 | Electron 32→41 upgrade | ⏸ deferred D1 |
| G22 | Kit CDN dependencies | ✅ shipped R2.3 |
| G23 | Wallpaper cyan/yellow swap | ✅ shipped R3.5 |
| G24 | Hero ASCII cyan/yellow swap | ✅ shipped R3.5 |
| G25 | docs/index.html hero cyan vs palette | ✅ shipped R3.5 |
| G26 | safeStorage for openai_api_key | ⏸ deferred D2 |
| G27 | Landing page primary-display honest | ✅ positive finding |
| G28 | Mac/Linux "v0.2" claims | ✅ shipped R3.6 ("on the roadmap") |
| G29 | Landing self-contradicts on palette | ✅ shipped R3.5 |
| G30 | Mac/Linux v0.2 priority | ✅ shipped R3.6 |

---

## Pass 4 — `terminal-talk-bundle-review-pass4.md` (H1–H5)

| ID | Finding | Disposition |
|----|---------|-------------|
| H1 | Favicon accessibility | ✅ positive finding |
| H2 | Wallpaper confirms F21 | ✅ shipped R3.5 |
| H3 | "HEY TT" vs "HEY JARVIS" mismatch | ✅ shipped R3.7 |
| H4 | `fixtures.ts` hardcoded electron.exe | ✅ shipped (tests/e2e/fixtures.ts:19-23 cross-platform) |
| H5 | F1 blast radius quantified | ✅ resolved by F1 fix |

---

## Responsiveness audit — `responsiveness-robustness-audit.md` (R1–R38)

Positive findings marked ✅(+) require no action.

| ID | Finding | Disposition |
|----|---------|-------------|
| R1 | Rolling-release-with-monotonic-mtime | ✅(+) positive |
| R2 | Architecture clarification | ✅(+) positive |
| R3 | Sentence splitter is robust | ✅(+) positive |
| R4 | TTS worst-case silence = 2 min | ✅ shipped A3 (`8a95881`) — now 45s |
| R5 | Wake-word responsiveness excellent | ✅(+) positive |
| R6 | Audio callback latent perf cliff | ✅ shipped Z3 (numpy ring buffer) |
| R7 | Key helper long-lived subprocess | ✅(+) positive |
| R8 | Process-tree snapshot fine at current rate | ✅ shipped S2.2 (cache added) |
| R9 | Clipboard capture smart marker | ✅(+) positive |
| R10 | clipboardBusy no timeout | ✅ shipped Z4 |
| R11 | Clipboard restore can clobber user copy | ✅ shipped Z5 |
| R12 | renderDots fires 15 sites unthrottled | ✅ shipped R6.1 (`0ee7a1f`) |
| R13 | Atomic writes everywhere | ✅(+) positive |
| R14 | Move-debounce is smart | ✅(+) positive |
| R15 | Drag-end polling defends Electron issue | ✅(+) positive |
| R16 | Sync FS on main thread | ✅ shipped R5.6 (`5213d10`) |
| R17 | callEdgeTTS no timeout, zombie risk | ✅ shipped A2 (`8a95881`) |
| R18 | Orphan sweep military-grade | ✅(+) positive |
| R19 | Respawn backoff 5s no escalation | ✅ shipped R5.4 (`14232f9`) |
| R20 | Audio error handler skips forward | ✅(+) positive |
| R21 | No stalled/waiting handler | ✅ shipped Z6 |
| R22 | Highlight-to-speak serial 20s | ✅ shipped R6.2 (`89d1abb`) |
| R23 | No UI feedback during hey-jarvis synth | ✅ shipped R6.3 (`bde9355`) |
| R24 | No listener/timer leaks | ✅(+) positive |
| R25 | (same as R24) | ✅(+) positive |
| R26 | Orphan timer in helperRequest | ✅ shipped Z7 |
| R27 | File watcher no error handler | ✅ shipped A4 (`2109041`) |
| R28 | Key helper supervised cleanly | ✅(+) positive |
| R29 | (same as R28) | ✅(+) positive |
| R30 | No devicechange handler | ✅ shipped Z8 |
| R31 | Defensive registry loading | ✅(+) positive |
| R32 | Corrupt registry silent overwrite | ✅ shipped R5.5 |
| R33 | MAX_FILES = 20 undocumented | ✅ shipped Z9 (documented rationale) |
| R34 | (same as R33) | ✅ shipped Z9 |
| R35 | No unhandledRejection / uncaughtException | ✅ shipped A5 (main) + S1 (renderer) |
| R36 | Bounded state containers mostly | ✅ same as G12 — shipped R5.1 |
| R37 | Memory profile bounded 24h | ✅(+) positive |
| R38 | Focus/mute/label latency ~10ms | ✅(+) positive |

---

## ULTRAPLAN-ADDENDUM (v2) follow-up tier

| ID | Item | Disposition | Commit |
|----|------|-------------|--------|
| A2-1 | preload.js disposers | ✅ shipped | `fbe96cc` |
| A2-2 | AUDIO_OR_PARTIAL_RE constant | ✅ shipped | `557f52a` |
| A2-3 | edge_tts_speak constants + timeout | ✅ shipped | `e35a854` |
| A2-4 | sentence_split abbrev + dash + NEL/LS + CJK | ✅ shipped | `252f905` |
| S1 | Renderer error → IPC log (dedupe) | ✅ shipped | `f371f33` + `66d6571` |
| S2.1 | synth_turn lock payload + executor timeout + metrics | ✅ shipped | `e7ee58f` |
| S2.2 | key_helper SendInput + cache + helper.log | ✅ shipped | `e397b75` |
| S2.3 | wake-word adaptive threshold + `--selftest` | ✅ shipped | `4db1059` |
| S3.1 | IPC rate-limit (token bucket) | ✅ shipped | `91829aa` |
| S3.2 | redactForLog key-set + regex | ✅ shipped | `91829aa` |
| S3.3 | Config validator | ✅ shipped | `91829aa` |
| S4.1 | `__test__/watchdog-state` IPC (pattern) | ✅ shipped | `35d5c1b` |
| S4.2 | voices.json + verify-voices | ✅ shipped | `a3f1b06` |
| S4.3 | c8 coverage scaffold + CI artefact | ✅ shipped | `2ade94a` |
| S5 | mocks-annotated iframes the kit | ✅ shipped | `bd1d923` + render-mocks fix `3b18a3c` |
| Z2-1 | Action SHA pinning | ⏸ deferred as D2-8 | needs GitHub API SHA lookup |
| Z2-2 | Node 18/20/22 matrix | ✅ shipped | `2ade94a` |
| Z2-3 | Playwright-on-Windows CI | ✅ shipped | `2ade94a` |
| Z2-4 | main.js boot-time SHA-256 integrity log | ✅ shipped | `0f0d655` |
| Z2-5 | keyHelper parent-side respawn on stall | ✅ shipped | `0f0d655` |
| Z2-6 | statusline.ps1 debounce | ✅ shipped | `f957411` |
| Z2-7 | install.ps1 manifest + verify-install.ps1 | ✅ shipped | `31ea43a` |
| Z2-8 | uninstall.ps1 Wait-Process | ✅ shipped | `bc6e302` |

---

## Additional items NOT in ULTRAPLAN / ULTRAPLAN-ADDENDUM

Caught during this audit pass. Each is either shipped, verified, or explicitly deferred with rationale.

| Source | Item | Status |
|--------|------|--------|
| full-review §7 | `killOrphanVoiceListeners` PS `-Command` injection surface | ✅ already uses `execFileSync`, no string interpolation |
| full-review §17 | statusline.ps1 dead `$graceSec` variable | ✅ already removed |
| full-review §9 | renderer full keyed-reconciliation (morphdom-lite) | ⏸ deferred D2-10 — Z11 handled focus preservation; full diffing is v0.3+ |
| full-review §10 | Drop `'unsafe-inline'` from style-src CSP | ⏸ deferred D2-9 — script-src already has no unsafe-inline; style-src only allows XSS-via-CSS-injection which is visual-only. 15 inline-style sites would need refactoring to CSS custom properties. Medium effort, low security ROI. |
| full-review §6 | playwright.config reportSlowTests + globalSetup | ⏸ deferred D2-11 — test-authoring nice-to-have |
| full-review §9 | Snapshot-test voice catalogue | ✅ shipped S4.2 (`verify-voices.cjs`) |
| full-review §9 | renderer `window.onerror` → IPC log | ✅ shipped S1 |
| R3.8 | toolbar-idle.png regeneration | ✅ shipped `3b18a3c` (all 5 PNGs now render iframed kit) |
| CI deprecation | actions/checkout@v4 etc on Node 20 (deprecated) | ⏸ D2-8 — same as Z2-1 SHA pinning work |

---

## Tier D-2 closure (v0.3, 2026-04-20)

This table was the "outstanding" list at v0.2.0 ship. Updated post-v0.3 push:

| ID | Item | Status |
|----|------|--------|
| D1 | Electron 32 → 41 upgrade | ✅ shipped `593e2a7` — Electron 41.2.1 pinned; 13/13 Playwright E2E green |
| D2 | safeStorage for `openai_api_key` | ✅ shipped `bcf6ad5` (main) + `e0deca9` (PS hooks via `config.secrets.json` sidecar) |
| D3 | Pixel-diff palette regression rig | ✅ shipped `835125f` — 24 baselines in `tests/baselines/palette/`; `npm run test:palette-diff` at 2% tolerance |
| D2-1 | §8e: collapse duplicated design-system pages | ✅ shipped `713d1a0` — `components.html?name=X` router + 3 redirect stubs |
| D2-2 | §8f: version the docs | ✅ shipped `90fa094` — `scripts/archive-docs.sh` + `release.yml` + `docs/v0.2/` seed |
| **D2-3** | **§8b: kit-as-iframe-wrapper** | **⏸ STILL DEFERRED — the only v0.3 item not shipped. 5+ h structural work (17 IPC stubs + 8 event channels + DOM bootstrap rewrite). See ULTRAPLAN-ADDENDUM.md and chat notes for full scope.** |
| D2-4 | IPC signing for PS → synth_turn handoff | ✅ shipped `9669f74` — decision doc `docs/architecture/ipc-integrity.md` + Option 3 (accept same-user trust boundary) + trust-boundary comment in `synth_turn.py` |
| D2-5 | Config validation via ajv | ✅ shipped `cd86460` as `config.schema.json` for editor autocomplete (no ajv runtime dep — hand-rolled validator stays authoritative) |
| D2-6 | (duplicate of D1/D2/D3) | — (resolved via above) |
| D2-8 | Action SHA pinning | ✅ shipped `85296bb` — every CI action pinned to SHA + semver tag comment; Node 24 opt-in via `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` |
| D2-9 | Drop `'unsafe-inline'` from CSP style-src | ✅ shipped `da9be80` — data-palette attr + generated `palette-classes.css` + Constructable Stylesheet for continuous positions + `.hidden` utility class; 3 regression tests in `HARDENING: renderer CSP` |
| D2-10 | Renderer full keyed-reconciliation | ✅ closed `c8707ec` — Z11's focus-bail covers every interactive state-loss case at 10-row scale; full morphdom tracked as v0.4+ if the surface grows |
| D2-11 | playwright.config reportSlowTests + globalSetup | ✅ shipped `bf99eee` — fail-fast pre-flight + 5 s slow-test detector |

---

## Post-v0.3.0 independent assessment (2026-04-20)

Separate Claude session reviewed tag `v0.3.0` (`e542256`) and produced `v0.3.0-assessment-for-claude-code.md`. Three concrete items:

| ID | Finding | Disposition |
|----|---------|-------------|
| N4 | `session-registry.psm1:91-93` docstring misstates main.js "no auto-prune" policy | ✅ shipped v0.3.8 |
| N5 | `release.yml:29` uses `actions/checkout@v4` (not SHA-pinned); inconsistent with D2-8 and high-stakes since release.yml has `contents: write` | ✅ shipped v0.3.8 |
| **H3-palette** | Purple `#c084fc` ↔ Blue `#60a5fa` collapse under deuteranopia (Δ=0.004, ~30× below distinguishability threshold). Affects ~6% of men. Carry-over from v0.2 pass 4 that was never added to this catalog. | ✅ shipped v0.3.9 (Option 1 — hex swap to magenta `#ee2bbd`, Δ=0.124 deutan, ~30× improvement; also renamed `COLOUR_NAMES[5]` "Purple" → "Magenta") |

Cosmetic observations from the assessment (not tracked, roll along with nearby commits): N1 (renderer-error-dedupe O(n)→O(1) eviction), N2 (config-validate openai key maxLen=200 loose), N3 (stale-session recycled-PID race, negligible window), `statusline.ps1:22` stale function name, README-FOR-ASSESSOR drift.

v0.4 suggestion from the assessment: extend `scripts/check-doc-drift.cjs` to scan code comments for specific assertion patterns (would have caught N4 automatically).

---

## Remaining TRULY outstanding

**Zero items.** All ULTRAPLAN + ULTRAPLAN-ADDENDUM + D-tier + post-v0.3.0 assessment (N4/N5/H3-palette) work is shipped. The catalogue is closed.

---

## Verdict (post-v0.3.8)

**All 114 prior-audit items closed** (across v0.2.0 Tier A–C, Streams R1–R6, and v0.3 Tier D-2). **N4, N5 shipped in v0.3.8. H3-palette deferred with explicit two-option tracking row.**

**Shipping state at tag `v0.3.9`:**
- 177 `--logic-only` tests green (was 107 at plan kickoff, 162 at v0.3.0)
- 13 Playwright E2E green on Electron 41.2.1
- Windows full harness green on CI
- Doc-drift CI guard green
- Palette pixel-diff rig: 24 baselines within 2% tolerance
- v0.2.0, v0.3.0 through v0.3.8 all tagged and pushed
- D2-3 kit-as-iframe landed in v0.3.0 and polished across v0.3.1–v0.3.7 (see `terminal-talk-v3-patches.md` in memory)

**Post-v0.3 real product bugs surfaced by the kit demo running on GitHub Pages:**
- v0.3.3 phantom-audio race (test harness + live Electron concurrent `saveAssignments`) — three-part hardening (TT_HOME env, stale-guard, registry lock)
- v0.3.5 `initialLoad` never sorted `pendingQueue` (invisible in daily use, glaring on kit)
- v0.3.6 "click exercise" for re-listening to played queues (new `auto_continue_after_click` setting, default on)

**Out-of-scope decisions** (never intended for audit-driven shipping):
- Mac/Linux port — on the roadmap, no ETA
- Signed-installer code-signing — explicit ULTRAPLAN decision ("adds friction for low real-world threat"); Z2-7 manifest covers the integrity-check use case
- Sentry / Crashpad crash reporting — deliberate privacy-first product decision per `SECURITY.md`
