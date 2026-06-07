# Terminal Talk — Launch Readiness Assessment
**Reviewer**: Claude Opus 4.7
**Date**: 2026-05-06
**Source of evidence**: `terminal-talk-snapshot-2026-05-06.zip` (6,633 files, ~437 MB; ~79k source LoC visible to GitHub public after gitignore filter). Sandbox network was disabled, so I could not fetch the live GitHub repo, the Pages site, the `releases` page, npm advisory data, or any external trademark/domain register. Every "Not present" claim in this document refers to the snapshot only; if the live repo differs, treat those items as "verify before launch."

---

## 1. Executive summary

You are **not ready to launch** in the sense the brief asks for ("polished v1.0 from a senior independent dev"). The code, tests, CI, CHANGELOG and security policy are genuinely strong — comparable to or above what most solo Show-HN projects ship. But three categories of issues sit between you and a launch that won't get torn down:

1. **The landing page lies to visitors.** The big copper "⬇ Download for Windows" CTA points at `releases/latest`, and there is no built artefact: no `electron-builder`/`electron-forge` config anywhere in the repo, `release.yml` only archives docs, no signed `.exe` is produced. A senior dev will close the tab in 30 seconds.
2. **The "public" repo isn't actually clean.** `COORDINATION.md` (750 lines), `ASSESSMENTS/` (S1-S7 internal quality tier), the entire `docs/SESSION-HANDOFF-*.md` pile (6 files), `docs/LIVE-CODEX-IN-CLAUDE-AUDIT-2026-04-29.log`, and `docs/VIDEO_*` planning docs are **not gitignored** and will be on GitHub. They expose Claude/Codex agent-style reasoning logs, your local Windows username path, multi-terminal scaffolding, and unfinished planning. This is the single most embarrassing thing a senior dev will see in 60 seconds.
3. **Tests fail and file-length gates are red.** 4 logic-only test failures, 6 file-length baseline violations, `app/main.js` at 2,649 lines and `app/renderer.js` at 2,642 lines. Plus a leaked SonarQube token in your snapshot (gitignored, but you just emailed it to me — treat it as compromised and rotate today).

Below: a senior dev would put you at **6.5 / 10** today (deep substance, weak surface). Fix the items in the top-10 punch list and you legitimately reach 8.5–9 / 10. The gap is roughly **2–3 weekends of focused work**, not a re-architect.

---

## 2. Per-section findings

### Section 1 — Repository hygiene (GitHub-facing)

| Item | Status | Evidence |
|---|---|---|
| README first 200 words | **Present, but bloated** | `README.md` is 657 lines, 57.7 KB. The 30-second pitch is buried under a hero SVG, six badges, status disclaimer, then a "Technical overview" table before any "What is this?" sentence shows a reader what they came for. |
| Hero asset | Present | `docs/assets/terminal-talk-hero.svg` referenced at `README.md:2`. ASCII wordmark with mascot. |
| 30-second pitch | **Weak** | The actual pitch line — "Terminal Talk turns Claude Code, Codex CLI, Claude Desktop Code, and Codex Desktop output into one colour-coded audio workstream" — sits at `README.md:16`, but is preceded by 14 lines of badges/status. By the time a reader reaches it they've already seen four uses of "session-coloured" without a definition. |
| Install in 3 lines | Present at `README.md:136-140` (`git clone` + `cd` + `.\install.ps1`) | But this is **not a 3-line install for an end-user.** It's a 3-line install for a developer who already has Node, Python 3.10+, PowerShell, git, and Windows. The landing page promises "Three commands, under two minutes" — true for a dev, false for the audience that clicks "Download for Windows". |
| Demo GIF/video above fold | **Not present** | `find docs/ -name '*.gif' -o -name '*.mp4' -o -name '*.webm'` returns zero files. Eight static screenshots (`docs/screenshots/`) but no motion. `docs/LAUNCH.md:139` literally says "Without a video, the launch will flop" — this is the single biggest gap. |
| LICENSE | **Present, correct** | `LICENSE` MIT, "Copyright (c) 2026 Ben Burns". `package.json:6` declares `"license": "MIT"`. Aligned. |
| CONTRIBUTING.md | Present, 140 lines | `CONTRIBUTING.md` — useful project layout, dev loop, test instructions. Quality is good. |
| CODE_OF_CONDUCT.md | Present | Contributor Covenant v2.1, 52 lines. Standard. |
| SECURITY.md | **Present, well-thought-out** | `SECURITY.md`, 132 lines. Private Security Advisories flow, fallback email, what-to-include list, 72-hour ack window. Better than most solo projects. |
| Issue templates | Present | `.github/ISSUE_TEMPLATE/{bug_report.yml, feature_request.yml, config.yml}`. Question-template **not present** — `config.yml` redirects questions to Discussions, which is fine. |
| PR template | Present | `.github/PULL_REQUEST_TEMPLATE.md`, 39 lines, with a usable checklist. |
| Topics/About | Cannot verify | Network disabled. The repo's `homepage` and 11 `keywords` are set in `package.json:5-42`. Assume nothing is on the GitHub side until you check. |
| Social preview image | Present (OG) | `docs/index.html:10` sets `og:image` to `terminal-talk-wallpaper.png`. **Not** the same as a GitHub repo social preview — that has to be uploaded in Settings → Options. Cannot verify, do this manually. |
| Releases | **Empty / source-only** | `release.yml` only archives docs (`docs/v0.2/`); no built artefact, no signed binary, no installer. The README badge `shields.io/github/v/release` points at this empty page. |
| Discussions enabled / pinned | Cannot verify | Network disabled. `ISSUE_TEMPLATE/config.yml` references it; assume it's enabled. |
| Badges | Present | 6 badges at `README.md:6-11` (release, license, platform, Node, status, tests). Reasonable set. No download/star-history badge yet — fine for v0.6. |
| Workflows | **Excellent quality** | `.github/workflows/test.yml` (336 lines): Node 18/20/22 matrix, ESLint zero-warnings, ruff, Knip, npm audit, pip-audit, file-length gate, PSScriptAnalyzer, c8 coverage with ratchet, Windows full harness, Playwright on Windows. All actions SHA-pinned. **`release.yml` is the gap** — only commits a `docs/vX.Y/` snapshot back. |

**Hidden internal scaffolding that should not be public:**

| Path | Currently gitignored? | Verdict |
|---|---|---|
| `COORDINATION.md` (750 lines, multi-terminal coordination scaffolding referencing "Terminal-1 (Opus 4.7, 1M ctx)") | **No** — `.gitignore` lists `coord/` (the directory) but not the root file | **Will be on GitHub. Move/delete or gitignore.** |
| `ASSESSMENTS/S1-knip ... S7-deps-functional-filelen` | **No** | **Will be on GitHub.** |
| `AGENTS.md` (5 lines, references your MCP tool internals) | **No** | Borderline — this one is at least short and product-relevant. Could be reframed to `.claude/AGENTS.md` for tool guidance. |
| `docs/SESSION-HANDOFF-*.md` × 6 files | **No** | **Will be on GitHub.** Each one literally is a Claude/Codex coding session log, exposing `C:\Users\Ben\Desktop\terminal-talk` (`docs/SESSION-HANDOFF-2026-04-29.md:5`), worktree-dirty workflow, and unrefined planning. Move out of `docs/`. |
| `docs/LIVE-CODEX-IN-CLAUDE-AUDIT-2026-04-29.log` | **No** | **Will be on GitHub.** |
| `docs/VIDEO_*.md`, `docs/COMMAND_CENTER_*.md`, `docs/PAGE_HARVEST_CONCEPT.md`, `docs/TERMINAL_SESSION_LAUNCHER_CONCEPT.md` | **No** | **Will be on GitHub.** Internal planning docs. Move to a `notes/` or `internal/` directory and gitignore that. |
| `Claude Assesments/`, `coord/`, `GHRC/`, `iNPLAY IMAGES/`, `.claude/`, `.sonarqube-token`, `.tmp-mocks/`, `.tmp-pixel-diff/`, `.ruff_cache/` | **Yes, gitignored** | Fine. |

> **Two folder-name issues even on the gitignored set:** `Claude Assesments/` is misspelled (should be `Assessments/`), and folder names with spaces (`Claude Assesments/`, `iNPLAY IMAGES/`) are awkward across cross-platform tooling. Cosmetic, but not what a senior would have.

### Section 2 — Code quality and architecture

**Tests run (5 consecutive runs, all identical):**
```
node scripts/run-tests.cjs --logic-only
Tests: 968 passed, 4 failed
```

The 4 deterministic failures:

1. `PALETTE PARITY — kit ↔ product (R1.7 + D2-3) → docs/app-mirror/ is in sync with app/ (D2-3c)` → "docs/app-mirror/ is stale — run `node scripts/sync-app-mirror.cjs` to refresh". Pre-launch git-hygiene fail; `docs/app-mirror/styles.css` drifted from `app/styles.css`. Trivial fix.
2. `SYNTH TURN SYNC STATE → load returns empty state for new session` → `assertEqual: expected "-1 0", got "42 2"`. **State leak between tests** — the test loads sync-state for a session that should be brand-new and gets back another session's data. Substantive.
3. `SYNTH TURN → run() does NOT append a duration phrase to body clips` → "no body-clip call". The orchestrator `synth_turn.py` (1,960 lines) is the audio path's beating heart; this test asserting a behavioural invariant is failing. Substantive.
4. `MIC-WATCHER → collapsed letterbox is short and preserves split-palette orientation` → "heard clip dots must paint their palette ring through `--dot-ring-bg`". CSS contract drift. Substantive.

**File-length gate (6 violations against your own ratchet):**
```
node scripts/check-file-length.cjs
✗ app/lib/dot-strip.js          190 > 185
✗ app/lib/heartbeat.js          186 > 175
✗ app/lib/tabs.js               275 > 273
✗ app/lib/transcript-panel.js   320 > 313
✗ app/renderer.js              2642 > 2583
✗ scripts/capture-kit-screenshots.cjs  302 > 270
```

This means **CI is currently red on `main`**. (Or at minimum, on the snapshot's working tree.) The `tests` badge in your README will stay green only if CI on `main` last passed, but a fresh CI run would fail the `file-length` job and either the `pure-logic-tests` job (failures #1–#4) and the `windows-full` job. **You should not link a tests badge that's about to flip red on launch day.**

**Largest source files (LoC):**
- `app/main.js` — **2,649 lines** (Electron main; should be split — settings/IPC/queue/watcher/lifecycle into separate modules)
- `app/renderer.js` — **2,642 lines** (one file rendering the entire toolbar UI; some extraction has happened into `app/lib/dot-strip.js`, `audio-player.js` etc., but the bulk lives in renderer)
- `app/styles.css` — **2,025 lines** (single CSS file)
- `app/synth_turn.py` — **1,960 lines**
- `app/tool_narration.py` — **1,851 lines**
- `app/lib/ipc-handlers.js` — **1,153 lines**

A senior dev opening `main.js` will see 2,649 lines in a single file and form an opinion before reading any of it. Even your own ratcheting baseline classes these as legacy debt — the gate accepts them but doesn't shrink them.

**Coverage thresholds (`.github/workflows/test.yml:267-269`):**
```
--lines 75 --branches 67 --functions 68
```

These are **honest but on the low side for a "v1.0 polished launch."** Comments at lines 250–263 explain the floor was deliberately ratcheted *down* from 89 → 75 → 68 across recent renderer work, with a TODO to raise it back via Playwright coverage reporting. Healthy intent, but at launch a reader running `npm run test:coverage` will see lower numbers than the README's "covered by a large unit harness plus 39 Playwright E2E tests" implies.

**Subsystems with effectively zero unit-test coverage** (cross-referenced with line-comment evidence):
- `app/main.js` (Electron main process) — most logic only exercised by Playwright on Windows; coverage report won't include it because c8 logic-only doesn't load Electron.
- `app/wake-word-listener.py` (598 lines, openWakeWord) — Python logic, not in the JS unit harness; only smoke-tested at install time.
- `app/codex-launch.ps1`, all `*.ps1` scripts — only tested when `--logic-only` is OFF on Windows.
- `app/lib/audio-player.js` (927 lines) — has tests in `EX7e — AudioPlayer` group, but renderer-side state-machine paths run in real DOM only.

**Silent-failure surface:**
- 71 `-ErrorAction SilentlyContinue` invocations across `app/*.ps1` + `app/*.psm1`, plus 2 top-of-file `$ErrorActionPreference = 'SilentlyContinue'` (`app/codex-terminal.psm1:2`, `app/scrape-footer.ps1:19`). For PowerShell that's whole-script error swallowing. Some are correct (best-effort filesystem cleanup), but the discipline is inverted from how the JS side handles it (which logs via `diag()`).
- JS `} catch {}` empty catches outside `node_modules`: 6 hits, all for filesystem `unlinkSync` cleanup of files that may not exist (`app/lib/api-key-store.js:40-41,54`). These are intentional and `eslint.config.js:74` explicitly allows them via `'no-empty': ['error', { allowEmptyCatch: true }]`. Acceptable.

**Lint config strictness:**
`eslint.config.js` extends only `js.configs.recommended`. **Not** TypeScript, **not** `eslint-plugin-security`, `eslint-plugin-promise`, `eslint-plugin-import`, `eslint-plugin-jsdoc`, or `eslint-plugin-n`. Custom rules added: `eqeqeq`, `no-var`, `prefer-const`, `no-implicit-globals`, `no-param-reassign` (warn), `no-empty: allowEmptyCatch`. **Reasonable for a personal project; below industry baseline for a "senior independent dev v1.0" launch** — comparable repos in the same niche (Aider, Continue.dev) ship typed code or much stricter lint. Worth listing as known debt rather than fixing pre-launch.

**TODO/FIXME debt:**
`grep -rn "TODO\|FIXME"` returns 5 hits, all of which are *test references to the literal string* "TODO|FIXME" used to test grep narration. **No actual TODO/FIXME debt in source code.** This is genuinely impressive and unusual.

**Dependency pinning:**
- `requirements.txt` — fully pinned to `==`. Commented rationale at top. Excellent.
- `package.json:43-50` — devDependencies use `^` carets. Standard for libraries; less ideal for a published app where you want byte-identical CI runs.
- `package-lock.json` is **gitignored** (`.gitignore:3`). For a public Node project, lockfiles are normally committed — you lose `npm ci` reproducibility in CI (test.yml line 67 confirms it falls back to `npm install`). Senior dev red flag.

**`npm audit` / `pip-audit`:** Cannot run in this sandbox (network disabled). `.github/workflows/test.yml:108-151` runs both on every CI build at audit-level=low — assume zero CVEs at last green run. Manual check: rerun before launch and confirm.

**Cross-platform install reproducibility:**
- `install.ps1` (582 lines) is well-structured: prereq checks (Python 3.10+, Node 18+), `Get-Consent` helper that respects `-Unattended`, idempotent re-runs (`README.md:146`).
- `install.sh` exists (`install.sh`, 10,805 bytes) — **but the README's entire install section is Windows-only**, and `install.sh` is not advertised as supported. The Posix path is half-done.
- Smoke scripts `scripts/smoke-posix-{full-,hooks,install,uninstall}.sh` exist but don't run in main CI. Treat Linux/macOS as **unsupported at launch** in messaging.

### Section 3 — Documentation

**Could a developer get the app running in <10 minutes from the README alone?**

Likely — *if they're on Windows 10/11 with PowerShell, Python 3.10+, Node 18+, git, and a working microphone, all already installed.* The actual blockers a fresh dev hits:

1. **README line 14 disclaimer** ("solo-maintained, expect rough edges") sets a defensive tone before anything is sold. Move it lower.
2. **README line 22** offers "Try it in your browser" — `https://benfrancisburns-creator.github.io/terminal-talk/ui-kit/`. Good. But a UI-kit is not a working demo; a fresh user will think they're getting a real demo and find a static palette playground.
3. **No video means no proof the audio actually works** until install completes. For a TTS app, that's the single most important demo channel.
4. **Privacy section mid-flight** — `README.md:446` (Privacy & Security) is *good content* but in the wrong place; for a tool that touches mic + clipboard, this should be summarised in 3 bullets near the top.
5. **45 Edge voices vs 53 in the catalogue** — `README.md:340` says "45 verified English voices"; `app/lib/voices-window.js` has 53 `"id"` entries (`grep -c '"id"' app/lib/voices-window.js` → 53). Stale claim. Run `npm run verify-voices` and update.

**`docs/` index** (`docs/README.md`) — present, well-structured, 30+ lines explaining layout. Solid.

**Architecture document** — only `docs/architecture/ipc-integrity.md`. The README has a useful ASCII flow diagram (`README.md:526-553`) but no real architecture doc. For 79k LoC this is thin. The Feature Map at `README.md:39-49` partly compensates.

**Per-feature documentation parity** — strong. Every README claim I spot-checked maps to actual code (palette 24 arrangements ↔ `app/lib/palette-alloc.js`; speech-includes 7 toggles ↔ `app/lib/text.js`; safeStorage flow ↔ `app/lib/api-key-store.js`).

**Troubleshooting / FAQ** — `README.md:560-573`, 9 rows. Reasonable but reactive — the "Codex hooks not firing" failure mode is missing despite Codex being a major v0.6 addition.

**MCP API surface for Claude Desktop** — Documented thinly in `AGENTS.md` (5 lines) and `app/terminal-talk-mcp-server.js` (6,074 bytes). For a public MCP server, you need a `docs/MCP.md` with tool list, parameters, and example claude_desktop_config.json snippet.

### Section 4 — Distribution and first-run UX

This is **the single weakest area.**

| Item | Status | Evidence |
|---|---|---|
| Built artefact for non-developer | **Not present** | No `electron-builder.yml`, `forge.config.js`, `electron-builder` or `electron-forge` in `package.json` deps. No `setup.exe`, `.msi`, or installer in `release.yml`. The "Download for Windows" CTA at `docs/index.html:788` lands users at `releases/latest`, which is empty. |
| Code signing | **Not present** | No `signtool` invocation, no certificate flow, no `electron-builder` win.signtoolOptions. **Even a self-signed binary** would be better than the current "git clone" path. |
| Auto-update | **Not present** | No `electron-updater`, `update-electron-app`, no Squirrel.Windows. Re-running `install.ps1` is the documented update path (`README.md:146`). For a desktop app shipped to non-developers, this is below baseline. |
| Uninstall | Present | `uninstall.ps1` (10,805 bytes) — stops processes, strips hooks from `~/.claude/settings.json` and `~/.codex/hooks.json` with timestamped backups, optional delete of `~/.terminal-talk/`. Documented at `README.md:577-582`. **Solid.** |
| First-run UX | Cannot verify visually | `install.ps1` ends with consent prompts for Claude hooks, statusline, Codex hooks, Desktop shortcut, Startup. Then user has to know to launch via Start Menu. **No first-run welcome window, no guided tour, no "click here to test the wake word" flow.** A user who installs and doesn't see anything happen has no fallback. |
| OpenAI key safety | **Genuinely well-designed** | `app/lib/api-key-store.js` — safeStorage primary (DPAPI on Windows), ACL'd plaintext sidecar at `~/.terminal-talk/config.secrets.json` for the PS hooks, migration from old config.json plaintext, documented threat model at lines 1-23. This is the most senior-looking module in the repo. |
| Key leak protection | Present | `'HARDENING: secrets do not leak to logs'` test group (excluded by `--logic-only`); `redactForLog` group also present. |

### Section 5 — Privacy, security, legal

| Item | Status | Evidence |
|---|---|---|
| Privacy doc | Present | Inline in `README.md:446-484` rather than a separate `PRIVACY.md`. Content is good (3-column table of network destinations + a "What Terminal Talk does NOT do" list). For a launch, **a separate `PRIVACY.md`** linked from the landing page lifts trust significantly — search engines and reviewers look for it. |
| OpenAI key location | Documented | `~/.terminal-talk/openai_key.enc` (encrypted) + `~/.terminal-talk/config.secrets.json` (plaintext, user-ACL'd). `README.md:354` and the `app/lib/api-key-store.js` header. |
| Telemetry | **None** | `README.md:461` claims "No telemetry, analytics, error reporting, or 'phone home' — anywhere in the codebase." Spot-check: `grep -rn "analytics\|telemetry\|posthog\|sentry\|mixpanel" app/` returns nothing. Claim verified. |
| License compatibility | Need to verify | `README.md:639-643` declares MIT/LGPL-3.0/MIT/openWakeWord. **edge-tts is LGPL-3.0** — for an MIT *application* you're fine because edge-tts is wrapped via `subprocess` (your `app/edge_tts_speak.py` calls it as a CLI), not statically linked. Note this rationale somewhere in `LICENSES.md` or the Credits section to head off the "but you're MIT and depend on LGPL" argument. |
| Trademark "Terminal Talk" | **Not searched in this assessment** (network disabled) | Generic English phrase — high collision risk. Before launch: USPTO TESS, EUIPO TMview, UK IPO. Also check Google Play / iOS App Store. |
| Domain ownership | **Not checked** (network disabled) | `terminaltalk.dev` referenced as future option in `docs/LAUNCH.md:215`. Check `terminal-talk.{com,dev,ai,app,io}` and grab the cheap ones today (£10–£30 each). Even if you don't use them, denying squatters costs £40 total. |
| **Leaked credentials in your snapshot** | 🚨 | `.sonarqube-token` contains `squ_8633cd8e277e86f1d7382e9b6bdd978bca84fa70`. Gitignored on disk, so not on GitHub — but **you just emailed me a zip with it inside.** Treat as compromised: rotate at https://sonarcloud.io/account/security today. |
| **GitHub recovery codes in snapshot** | 🚨 | `GHRC/github-recovery-codes.txt` (206 bytes). Gitignored, not on GitHub, but in the zip you sent. **Regenerate immediately** at https://github.com/settings/auth/recovery-codes. Also, `GHRC/` is at repo root: at minimum move this off the repo entirely. Recovery codes don't belong in a working tree. |

### Section 6 — Landing page and marketing assets

`docs/index.html` (1,738 lines) reviewed as a paid landing page reviewer would.

**Strengths:**
- Visual polish is genuinely high. Self-hosted Cascadia Mono with split unicode-range faces (`docs/index.html:23-42`), proper `font-display: block` with preload, ASCII wordmark in 8 palette colours. This is the work of someone who cares about craft.
- Privacy section (`docs/index.html:1041`) is up-front and 3-column.
- FAQ section (`docs/index.html:1069`).
- OG image set, viewport set, language set, favicon SVG.

**Weaknesses ranked by launch-day severity:**
1. **Primary CTA is broken.** `docs/index.html:787-790` — "⬇ Download for Windows" → `releases/latest`. There's nothing to download. **A senior dev clicking that CTA and finding source-only releases will close the tab.** This is the single biggest fix.
2. **No demo above the fold.** Static screenshots only. `docs/index.html:896` ("Terminal Talk in motion") is below ~900 lines of CSS + 80 lines of nav and hero. A voice tool needs a 30-second autoplaying demo *at the top*.
3. **No "Why this over X" section.** No comparison to the known alternatives in this niche. A reviewer (or HN commenter) will ask "why not Aider's voice mode? Why not Whisper-hooked Codex?"  — be ready with a side-by-side. One paragraph or one table is enough.
4. **Mobile responsiveness** — only one media query at `docs/index.html:85` (`@media (max-width: 640px) { .nav-links { display: none; } }`) — that hides nav links on mobile but doesn't reflow the hero ASCII wordmark, which will overflow horizontally on a 375px iPhone. Test on a real phone before launch.
5. **Lighthouse performance** — cannot run in this sandbox. Three custom font weights × two unicode ranges = six woff2 preloads (`docs/index.html:13-14`); could drop to two if you prove the ones you actually use. Also a 70 KB hero SVG (`docs/assets/about-terminal-talk-hero.svg`).

**Demo video** — **not present.** No `.gif`, `.mp4`, or `.webm` anywhere under `docs/`. `docs/LAUNCH.md:139` literally says "Without a video, the launch will flop." You agree with yourself; just haven't done it yet.

**Screenshots** — 18 PNGs in `docs/screenshots/`, captured at consistent sizes per the README table. Good. **Not annotated** — none have callouts ("see the colour dot here"), labels, or arrows. For a tool whose value-prop is *visual session identity*, annotated shots would carry more weight.

**Social media kit** — There is no `social/` directory in the snapshot at the root and the brief mentioned a possible `~/Documents/terminal-talk-launch/social/` outside the repo. Not visible to me.

**"Why use this over alternatives"** — none of the obvious comparisons (Aider's voice mode, Continue.dev's accessibility plugins, raw Whisper hooks for Codex, ElevenLabs API + AutoHotkey custom toolbars) is named anywhere in the README or landing page. Add one short paragraph or 5-row table — see Section 7 below.

### Section 7 — Launch channels and outreach plan

**You already have an excellent launch playbook at `docs/LAUNCH.md` (220 lines).** I read it carefully — it's better than what I was about to draft. Specifically, the timing strategy (`docs/LAUNCH.md:159-170`), the order of posts, the babysitting discipline (`docs/LAUNCH.md:172-177`), and the "What NOT to do" section are all senior-grade.

What's **missing** from your existing playbook, that I'd add:

- **No subreddit list beyond r/ClaudeAI / r/commandline** — the brief asks for r/programming (you flag as "skip"), r/Anthropic, r/OpenAI, r/LocalLLaMA. My recommendation:
  - **r/ClaudeAI** — yes (your playbook has it; primary).
  - **r/commandline** — yes.
  - **r/Anthropic** — quieter, post a reframed version aimed at the maintainer audience.
  - **r/LocalLLaMA** — only if you re-frame around the *local* angle (offline wake-word, no telemetry, opt-in cloud TTS). Mention "edge-tts uses Microsoft cloud" up-front or you'll be downvoted in 10 minutes for mis-pitching.
  - **r/OpenAI** — risky. They're a noisier audience and Codex isn't loved there since the GPT-5 era. Skip unless your thread on r/ClaudeAI takes off.
  - **r/programming** — your call to skip is correct. Self-promo gets nuked.
- **Hacker News post** — your draft at `docs/LAUNCH.md:9-43` is strong. Two notes: title `Show HN: Terminal Talk – Voice workflow for Claude Code and Codex CLI` is good (HN penalises emoji and superlatives). **Add a sentence about the offline wake-word** in the first paragraph — that's the single most clickable detail and you bury it.
- **Twitter/X mention list** — You have `@AnthropicAI`. Add: `@AnthropicAI` (post-launch, not in launch tweet — they don't @-back), `@karpathy` (long-shot), and named devs only after they've found it organically. **Don't @-spam on launch — it reads desperate.**
- **Product Hunt** — for a Windows-only dev tool, **PH gives you ~5–10% of the value of an HN front page**. Not worth the hunter coordination, asset prep, and 24-hour babysitting unless you're going to Mac anyway. Skip until v0.7 with Mac.

**YouTuber outreach DMs** — drafts in Section 5 below.

### Section 8 — Post-launch infra

| Item | Status |
|---|---|
| Issue triage commitment | **Implicit** in `SECURITY.md:38` ("72-hour ack window for security"). No equivalent commitment for normal issues. Add 1 line to README/CONTRIBUTING: "I respond to issues within 3 business days; if I'm slow, ping `@benfrancisburns-creator`." |
| Discussions | Cannot verify (network disabled). `ISSUE_TEMPLATE/config.yml` references it; assume yes. |
| Discord | None mentioned. Don't start one for v0.6 — too much overhead for a solo maintainer. |
| Roadmap | **Not present** as `ROADMAP.md`. Mentioned inline in `README.md:14` ("Mac port is next, Linux after"). Add a real `ROADMAP.md` — even three sections (Now / Next / Later) gives users somewhere to react. |
| Telemetry plan | None (you've committed to none). That's fine — but **plan how you'll know if anyone is actually using it**. Without telemetry, your only signals are stars + issue volume + Twitter. That's enough for v0.6. |
| Versioning + release cadence | Currently 0.1.x → 0.6.0 over April–May 2026, ~one minor every 1–2 weeks. `CHANGELOG.md` is rigorous (845 lines, Keep-a-Changelog format). **Don't commit to a cadence** in writing — just keep doing what you're doing. |

### Section 9 — Comparable projects benchmark

I cannot fetch live star counts or current README structure (network disabled). The list below uses my training-time familiarity with these projects; **verify before citing publicly.**

| Project | What it is | What they do at launch you can copy | What they don't have you can differentiate on |
|---|---|---|---|
| **Aider** (`paul-gauthier/aider`) | Terminal AI pair-programmer, Python | Single demo GIF dominates the README (`docs/screenshots/aider-screencast.gif` style). One-line install via pipx. CHANGELOG used aggressively. Heavy use of "what makes this different" tables. | No voice. No session-identity colour layer. No always-on toolbar. |
| **Continue.dev** | VS Code/JetBrains AI assistant, TypeScript | Strong landing page with autoplaying short loops. "Why Continue?" section with 5 reasons. Discord-first community. Open-source + commercial layers carefully separated. | IDE-bound (you're terminal-bound — that's a different niche). No accessibility-driven voice angle. |
| **Plandex** (`plandex-ai/plandex`) | Terminal AI for big tasks, Go | Demo GIF in README. Architecture diagram (their "How it works" goes deeper than yours). Self-hosted vs cloud option. | No voice. |
| **Repomix** (`yamadashy/repomix`) | Pack a repo into a single file for LLM input | Excellent README hierarchy: "Why?" "Quick Start" "Features" in that exact order. Heavy use of mermaid diagrams. | Different problem space — no UX learning. |
| **`llm` by Simon Willison** | CLI for any LLM provider, Python | Plugin-architecture is the differentiator. Simon's blog posts ARE the launch — every release gets a writeup. | No voice. No GUI. |

**Patterns from the four most-relevant (Aider, Continue.dev, Plandex, llm):**

1. **All four lead the README with a demo GIF/screencast above the fold.** You don't.
2. **All four have a "Why X" or "Comparison" section.** You don't.
3. **None of them ship a "git clone + run install script" install path as the primary CTA.** They all ship pip / npm / brew / signed binary.
4. **Three of four have a Discord.** You don't need one (yet).
5. **All four have a written architecture doc.** You have ipc-integrity.md only.

### Section 10 — Honest gut check

**1. If you launched today, what's the single biggest reason a new visitor would close the tab in 30 seconds?**

The "⬇ Download for Windows" CTA on `docs/index.html` resolves to an empty Releases page that requires `git`, `node`, `python`, `powershell` and a microphone before the user sees a single character of audio. The mismatch between the marketing surface ("Three commands, under two minutes" — `docs/index.html:1020`) and the reality (developer-tier prereqs + manual hook consent + Start Menu launch) is what loses the visitor.

**2. What's the most embarrassing thing in the repo right now that a senior dev would notice in 60 seconds?**

`docs/SESSION-HANDOFF-2026-04-29.md` (and 5 sibling files, plus `docs/LIVE-CODEX-IN-CLAUDE-AUDIT-2026-04-29.log`) sitting in a public-facing `docs/` directory. They expose `C:\Users\Ben\Desktop\terminal-talk`, read as raw Claude Code conversation logs, and signal that the developer hasn't separated their working notes from their public surface. Tied with `COORDINATION.md` at root (750 lines of multi-terminal coordination scaffolding addressed to "Terminal-1 (Opus 4.7, 1M ctx)") and `ASSESSMENTS/` not being gitignored.

**3. Senior-dev professionalism rating, 1–10, with reasoning**

**6.5/10 today.** Reasoning:
- **+ Substance** (testing, security, dependency hygiene, CI quality, code-review-grade comments in `app/lib/api-key-store.js`) is **8.5/10**. Better than most v1.0 solo launches.
- **− Surface** (landing page CTA broken, no demo video, internal scaffolding leaking into `docs/`, file-length gate red, 4 failing tests, two 2,600-line monoliths) drags it to **5/10**.
- The gap is execution, not knowledge. The brain that wrote `app/lib/api-key-store.js` knows what a polished launch looks like. The launch surface just hasn't caught up.

**Fix the top-10 punch list and you're at 8.5–9/10.** Realistic and reachable in 2–3 weekends.

---

## 3. Punch list (sorted by priority = impact × inverse-effort)

| # | What | Why it matters at launch | Effort |
|---|---|---|---|
| **1** | **Rotate the SonarQube token (`squ_...`) and regenerate GitHub recovery codes.** Before anything else. | The snapshot you sent contains both. Rotate within hours, not days. | **S** (10 min) |
| **2** | **Replace the "Download for Windows" CTA target.** Either (a) ship a real `electron-builder` artefact attached to the next release, or (b) re-label it "View install instructions" until you can. (b) is fine for v0.6. | The current behaviour breaks the trust contract on click 1. | **S** (1 hr to relabel; **L** to actually ship a built artefact) |
| **3** | **Move all internal scaffolding out of the public repo surface.** Move `docs/SESSION-HANDOFF-*.md`, `docs/LIVE-CODEX-*.log`, `docs/VIDEO_*.md`, `docs/COMMAND_CENTER_*.md`, `docs/PAGE_HARVEST_CONCEPT.md`, `docs/TERMINAL_SESSION_LAUNCHER_CONCEPT.md`, `COORDINATION.md`, `ASSESSMENTS/`, `AGENTS.md` into a new `notes/` directory, then add `notes/` to `.gitignore`. **And actually delete `GHRC/`** from the repo working tree — recovery codes do not belong in a code repository at all. | This is the single most embarrassing surface a senior reviewer hits. | **S** (90 min) |
| **4** | **Record a 30-second demo video** following your own `docs/LAUNCH.md:139` plan (Claude → "hey jarvis" → Codex → both dots). Drop as `docs/screenshots/demo.gif` and embed at `README.md:2` and at the top of `docs/index.html`. | A TTS app without an audible/visual demo cannot convert visitors. Your own playbook says this. | **M** (3-4 hrs incl. retakes + ezgif convert) |
| **5** | **Fix the 4 failing tests** before launch day so the `tests` badge stays green:<br>(a) `node scripts/sync-app-mirror.cjs` to clear the docs/app-mirror drift;<br>(b) investigate the `SYNTH TURN SYNC STATE` cross-session leak;<br>(c) investigate the `run() does NOT append a duration phrase` regression;<br>(d) restore the `--dot-ring-bg` CSS contract for the collapsed letterbox. | The README has a tests badge. If it goes red on launch day, every reviewer assumes the project is unmaintained. | **M** (4-6 hrs total) |
| **6** | **Add a "Why Terminal Talk vs alternatives" section** to README and landing page. Even a 5-row table (Aider voice, Continue.dev, raw Whisper hooks, ElevenLabs+AHK, Terminal Talk) is enough. | First HN comment will be "why not X?" — you want the answer in the README, not the comments. | **S** (45 min) |
| **7** | **Move the 30-second pitch above all badges and disclaimers** at the top of `README.md`. Lead with what it does in plain English, then status, then badges. Currently the order is hero → 6 badges → defensive disclaimer → pitch line at line 16. | Your strongest line is the third paragraph. Reorder. | **S** (15 min) |
| **8** | **Trim `README.md` from 657 lines to ~300.** Move `Settings panel reference`, `Configuration JSON keys`, `Self-cleanup watchdog`, `Tests coverage list`, `Companion dictation tools`, `About the mascot` into separate files under `docs/` and link from the README. | A 657-line README signals "I haven't decided what's important." A 300-line README signals "I have." | **M** (2-3 hrs) |
| **9** | **Stop gitignoring `package-lock.json` and commit it.** Switch CI from `npm install` to `npm ci`. | Reproducible builds are table stakes for a public Node project; readers checking your repo for "is this a serious codebase" will look for the lockfile. | **S** (20 min) |
| **10** | **Add a `PRIVACY.md`** at repo root, mirroring the README's privacy section + linking from the landing page footer. | Search engines + reviewer-bots look for `PRIVACY.md` specifically. Inline-only privacy info doesn't rank or get cited. | **S** (30 min) |
| 11 | Update README's "45 verified Edge voices" to "53" (`grep -c '"id"' app/lib/voices-window.js`). | Stale claim; will get noticed. | S (5 min) |
| 12 | Update CI workflow comment in `release.yml:13` and `test.yml:300` ("13 tests") — actual count is 39. | Stale. | S (5 min) |
| 13 | Build a real `electron-builder` config and attach a signed (or at least built) `.exe` to the v0.7 release. Even **unsigned** beats source-only because users can run it without installing Node + Python first. | This is the only path to non-developer adoption. | **L** (1-2 weekends incl. signing setup) |
| 14 | Search "Terminal Talk" trademark on USPTO TESS, EUIPO TMview, UK IPO. Document outcome in `LICENSES.md` or a private note. | Generic phrase = collision risk. | M (60 min for all three) |
| 15 | Register `terminal-talk.{com,dev,ai,app,io}` (or whichever are free). Even just to deny squatters; £40 total. | Post-launch you can't go back. | S (20 min) |
| 16 | Add a `ROADMAP.md` with 3 sections: Now / Next / Later. Even one bullet per section. | Users want a place to react. | S (30 min) |
| 17 | Add `docs/MCP.md` documenting the Claude Desktop MCP server tool surface (`app/terminal-talk-mcp-server.js`). | An MCP server with no docs reads as half-finished. | M (90 min) |
| 18 | Add a Codex troubleshooting row to the README troubleshooting table. | Codex is your v0.6 banner feature; missing trouble-row reads like an oversight. | S (15 min) |
| 19 | Annotate 2-3 of the 18 screenshots with callouts ("← session colour dot", "← currently speaking"). | Visual proofs are stronger when they're labelled. | S (30 min total in any image editor) |
| 20 | Set up GitHub repo "Social preview image" in Settings → Options. Use `docs/assets/wallpaper/terminal-talk-wallpaper.png`. | Twitter/Slack previews carry the link. | S (5 min) |
| 21 | Make `app/index.html`'s CSP visible in `SECURITY.md` so reviewers can verify hardening claims without reading source. | One-line visibility. | S (10 min) |
| 22 | Plan the renderer + main split as a v0.7 milestone — extract IPC + queue-watcher + lifecycle from `main.js`. | Visible refactor signal in CHANGELOG = "this is being maintained." | L (1-2 weekends) |

> **Top 10 = items #1-#10 above.** Start with #1 (rotate the leaked tokens) before launching anything. Items #2, #3, #4, #5 are non-negotiable for "polished v1.0" framing. Items #6-#10 noticeably lift you from 6.5 to 8 /10. Items #11-#22 are polish and post-launch.

---

## 4. Suggested launch sequence (4 weeks max)

> **All week numbers are sequential from "today, Wednesday 2026-05-06". Adjust if "today" moves.**

### Week 1 (May 6–12) — Stop the bleeding

- **Today, Wed May 6**: Punch list **#1** (rotate SonarQube token + regenerate GitHub recovery codes). Do this first.
- **Today, Wed May 6**: Punch list **#3** (move internal scaffolding out of public surface). 90 minutes.
- **Thu May 7**: Punch list **#5** (fix the 4 failing tests). Push fix, confirm CI green.
- **Fri May 8**: Punch list **#7** (reorder README opening), **#9** (commit package-lock), **#10** (add PRIVACY.md), **#11**, **#12**, **#18**, **#19**.
- **Weekend May 9–10**: Punch list **#4** — record + edit the 30-second demo video. Drop the GIF in the repo. Embed in README + landing page. **This single weekend is your highest-leverage time.**

End-of-week status: CI green, no scaffolding leak, demo embedded, repo passes the 60-second senior-dev sniff test. **You could launch here as v0.6 if you must.**

### Week 2 (May 13–19) — Fix the CTA contract

- **Mon May 13 → Wed May 15**: Punch list **#2** (relabel CTA OR start `electron-builder` setup). Decide which.
  - Path (a) — Relabel CTA from "Download for Windows" to "View install instructions" pointing to the README install section. 1 hour.
  - Path (b) — Start `electron-builder` config (item **#13**). Aim for an *unsigned* `.exe` build attached to a v0.7-rc1 release. 1 weekend.
- **Thu May 14 → Fri May 15**: Punch list **#6** (Why Terminal Talk vs alternatives section), **#8** (trim README), **#16** (ROADMAP.md), **#17** (MCP.md).
- **Weekend May 16–17**: First YouTuber outreach (DMs in section 5 below). Don't announce launch date — soft contact only.

End-of-week status: README is ~300 lines and reads cleanly, CTA matches reality, "why this" section answers HN's first comment.

### Week 3 (May 20–26) — Build the launch surface

- **Mon May 20 → Wed May 22**: Punch list **#13** (real built artefact). If you didn't pick path (b) in week 2, this is your last shot. Aim for unsigned `.exe` at minimum. Test on a clean Windows VM.
- **Thu May 21 → Fri May 22**: Punch list **#14** (trademark search), **#15** (domain registration), **#20** (social preview image), **#21**, **#22 plan only**.
- **Weekend May 23–24**: Tag v0.7.0 with the built artefact. Run through your own `docs/LAUNCH.md` plan **as a dry run** — post draft Show HN/Reddit text in a private gist and re-read 24 hours later for tone.

End-of-week status: v0.7 is tagged with a real downloadable artefact, surface is polished, plan is rehearsed.

### Week 4 (May 27–Jun 2) — Show HN day

- **Mon May 27**: Final pre-launch pass. Run all CI locally. `node scripts/run-tests.cjs --logic-only`. Confirm green.
- **Tue May 28 OR Wed May 29 OR Thu May 30**: **Show HN day.** Follow your existing `docs/LAUNCH.md` playbook to the letter — it's correct. Recommend Wed May 29 to give Tuesday for any last issue + Thursday as buffer for HN momentum.
- **Day-of**:
  - 4pm UK / 8am Pacific — Show HN.
  - +5 min — Anthropic Discord (#community-projects).
  - +10 min — r/ClaudeAI.
  - +15 min — r/commandline.
  - +20 min — Twitter/X with embedded video (NO @-mentions in launch tweet).
  - +30 min — TLDR + Bytes + Console newsletter submissions.
  - **Then babysit for 4 hours minimum.** Reply to every comment. No defensive replies. "Good point, will look into it" + ticket it.
- **Day +1 to +7**: Triage issues. **Do not push commits during the first 24 hours** — your `docs/LAUNCH.md:204` advice is correct.

### What if you slip?

If week 1 takes 10 days: launch in week 5. **Don't rush.** A clean launch is worth 10x a rushed one. The single tightest constraint is the demo video — without it, nothing else matters.

---

## 5. YouTuber outreach drafts

> **All drafts are personalised against my training-time impression of each creator's content. Verify their current focus before sending — if Theo's been off Claude Code for a month, swap the angle. Tone is plumber-meets-dev, no corporate filler. All assume you'll attach the 30-second demo GIF.**

### Theo Browne (@theo / t3.gg)

```
Hey Theo — built a thing you might enjoy roasting on stream.

Terminal Talk: Claude Code + Codex CLI replies get spoken aloud, each session
gets a colour-coded dot on a tiny floating toolbar, and "hey jarvis" reads
any highlighted text. Free, local wake-word, MIT.

Reason it'd fit your stack: you stream-debug a lot of agent output and the
"watch terminal then watch terminal" loop is exactly what this kills. Also,
two Claude Code terminals open = two voices via Edge TTS. You'd hear which
one finished without looking.

Happy to add a "Theo voice" preset if useful. Demo: [GIF/link].
Repo: github.com/benfrancisburns-creator/terminal-talk
```

**Why him**: t3.gg streams a lot of multi-terminal AI workflow content; the "two voices for two sessions" feature is a 30-second on-stream demo that lands. *Don't* offer him advertising or premium features — he doesn't need them.

### Matt Wolfe (Future Tools / @mreflow)

```
Hey Matt — found something that'd fit a "free AI tool" segment.

Terminal Talk is open-source TTS for Claude Code and OpenAI Codex CLI:
auto-speaks the agent's replies, says "hey jarvis" reads any highlighted
text aloud (browser, PDF, anywhere). Free by default — uses Microsoft Edge's
neural voices and runs the wake-word entirely offline on CPU.

Two angles for your audience:
- Productivity: hands-free coding loop with a dictation tool like Wispr Flow.
- Accessibility: legitimately useful for devs who can't watch terminals all day.

MIT licensed, Windows-only today, Mac/Linux on the roadmap.
Demo: [GIF/link]. Repo: github.com/benfrancisburns-creator/terminal-talk

Happy to do a quick walkthrough call if it's a fit.
```

**Why him**: Future Tools covers free + open-source AI tooling weekly. The accessibility angle is the wedge — most of his AI-tool segments don't have one.

### The AI Daily Brief (Nathaniel Whittemore)

```
Hi Nathaniel — pitching a "small open-source thing solving a real workflow
problem" segment.

Terminal Talk: free open-source voice layer for Claude Code and Codex CLI.
Each agent session gets a colour-coded dot + optional voice on a tiny floating
toolbar; "hey jarvis" reads any highlighted text. Wake-word runs entirely
offline. MIT, Windows-first, solo-built (UK plumber-turned-dev).

Why it might fit the brief: it's the kind of thing your audience asks for —
a productivity layer specifically for the people already using Claude Code
daily. Free tier solves the actual problem; paid OpenAI TTS is opt-in only.

Demo: [GIF/link]. Repo: github.com/benfrancisburns-creator/terminal-talk
Happy to give you a 5-minute walkthrough if useful.
```

**Why him**: TADB covers tooling-of-the-week with a strategic-business framing. Lead with the "solo-built UK plumber" angle — it's a built-in story hook he can use.

### Riley Brown (@rileybrown.ai)

```
Hi Riley — built something that fits the "indie maker, real tool" beat.

Terminal Talk: floating toolbar that turns Claude Code and Codex CLI into a
colour-coded audio workstream. Each session = its own dot + voice. "Hey
jarvis" reads any highlighted text aloud. Free, open-source, MIT.

Background that might be the hook: I'm a UK plumber/PM, this is my first
software project, written solo (with Claude Code as my pair). v0.6 has 970+
unit tests and 39 Playwright E2E. Took 6 weeks of evenings.

If "non-dev ships real dev tool" lands for your channel, happy to do a
walkthrough call.

Demo: [GIF/link]. Repo: github.com/benfrancisburns-creator/terminal-talk
```

**Why him**: Riley covers indie-maker stories. "Plumber → dev → ships real tool" is exactly his beat. **The 970 tests detail is what makes it not feel like vibe-coding.**

### AI Jason (@aijasonz)

```
Hey Jason — pitching a 5-min walkthrough.

Terminal Talk: open-source toolbar that speaks Claude Code and Codex replies
with session colour-coding, plus "hey jarvis" → reads any highlighted text.
Wake-word runs offline (openWakeWord, CPU-only); TTS is free Microsoft Edge
by default, OpenAI optional.

Two reasons it'd play well: (1) genuinely free with a credible privacy
posture (no telemetry, no signup) — your audience asks for this constantly;
(2) the 24-arrangement palette + per-session voice is a fun visual demo on
camera.

MIT, Windows, solo-maintained. Demo: [GIF/link].
Repo: github.com/benfrancisburns-creator/terminal-talk
```

**Why him**: Jason covers practical AI tooling with hands-on walkthroughs.  Fast lead-in to the demo. Don't overpitch — he's been burned by overpromising tools.

### David Ondrej (@DavidOndrej1)

```
Hey David — built a hands-free voice layer for Claude Code and Codex CLI.

Terminal Talk speaks agent replies aloud, gives each session its own colour
dot and (optional) voice, and "hey jarvis" reads any highlighted text. Free,
MIT, runs the wake-word offline.

The angle for your audience: you do a lot of "fastest way to ship X with
Claude/Codex" content. This kills the watch-terminal loop entirely — you
trigger a long-running agent task and walk away; come back when you hear it
finish. Combine with Wispr Flow and you barely touch the keyboard.

Demo: [GIF/link]. Repo: github.com/benfrancisburns-creator/terminal-talk
Happy to ship a custom feature if it'd help a video.
```

**Why him**: David's content emphasises speed and minimal-friction agent workflows. The "walk away from your computer" angle is the hook.

### ColeMedin (Cole Medin)

```
Hi Cole — pitching for the open-source AI tooling beat.

Terminal Talk: open-source (MIT) TTS layer for Claude Code and OpenAI Codex
CLI. Each session = a colour-coded dot + voice on a tiny floating toolbar.
"Hey jarvis" reads any highlighted text. Wake-word is fully offline (open-
WakeWord, CPU). Free by default; OpenAI TTS opt-in.

What might fit your channel: clean small Electron + Python + PowerShell
codebase (~80k LoC), 970+ unit tests, Knip + ESLint + ruff + PSScriptAnalyzer
all gating CI, Dependabot weekly, Playwright E2E on real Windows. Architecture
is documented and the privacy posture is verifiable in code.

Solo-built, v0.6. Windows today, Mac/Linux on the roadmap.
Demo: [GIF/link]. Repo: github.com/benfrancisburns-creator/terminal-talk
```

**Why him**: Cole goes deep on open-source AI repos and code quality. The CI + test detail is what differentiates this from a "vibe-coded weekend project" pitch.

### All About AI (@allaboutai)

```
Hey — pitching a free productivity tool that fits the "tool of the week" beat.

Terminal Talk: open-source toolbar that speaks Claude Code and Codex CLI
replies, gives each session its own colour identity + voice, and reads any
highlighted text via "hey jarvis". Free, MIT, no signup.

For your audience: it's the rare AI tool with a real free tier (Microsoft
Edge TTS — no API key) and a credible offline story (wake-word entirely
local). Pairs nicely with any speech-to-text tool for full hands-free.

Windows today, Mac/Linux on the roadmap (PRs welcome).
Demo: [GIF/link]. Repo: github.com/benfrancisburns-creator/terminal-talk
```

**Why them**: AAA covers free-tier AI tools weekly. The "real free tier, not a 7-day trial" framing is the wedge.

### Simon Willison (blog + Mastodon, not YouTube)

```
Hi Simon — sharing a small open-source thing in case it's interesting for
your weeknotes.

Terminal Talk: voice layer for Claude Code and OpenAI Codex CLI. Auto-speaks
agent replies, "hey jarvis" reads any highlighted text. Free tier uses
Microsoft Edge TTS (same endpoint Edge browser's "Read Aloud" uses),
optional OpenAI TTS opt-in. Wake-word is openWakeWord, runs offline on CPU.

The bit that might be most interesting to you: the Codex CLI integration
tails ~/.codex/sessions/ rollout JSONL files for `agent_message` events
(commentary + final phases). Per-file offset tracking, signature dedup
against rewrite-replays. It worked surprisingly well as a watch path —
might be a useful pattern for other Codex-side tooling.

MIT, Windows-only today, no telemetry. Solo-built by a UK plumber doing
their first software project (with a lot of help from Claude Code).
Repo: github.com/benfrancisburns-creator/terminal-talk

No expectations — just thought the rollout-watching pattern might be your
kind of thing.
```

**Why him**: Simon covers technically-interesting open-source patterns in TILs. The Codex rollout-watching architecture is the wedge — *don't* lead with the voice angle (everyone leads with that), lead with the technical detail. **And do not pitch him a video** — he doesn't make them. A blog mention from Simon is worth ~3 HN front-page hits.

---

## Closing note

You've done senior-grade work where it counts most: code quality, security posture, CI discipline, CHANGELOG hygiene, and dependency rigour. The launch surface (CTA, demo, public-facing repo cleanliness) is where you're behind, and that's the *easier* gap to close — 2–3 focused weekends. Don't ship until items #1-#10 are done. **The thing in this repo most worth being proud of is `app/lib/api-key-store.js`.** Read it again before launch — the surface should match that bar.

— Claude
