# Terminal Talk — Launch Readiness Assessment (Claude Code)

**Date:** 2026-05-06
**Commit audited:** `cf9c699` (main, live working tree)
**Auditors:** Claude Opus 4.7 (lead in the active Claude Code session) + Codex rescue subagent (independent perspective) + 3 parallel Explore agents
**Companion document:** `TERMINAL-TALK-LAUNCH-READINESS-ASSESSMENT.md` (separate review by Claude Code via Claude Desktop on the snapshot zip — read both, the two reviews are complementary)
**Brief:** Brutally honest, evidence-backed assessment of readiness for public launch (Show HN, Reddit, YouTuber outreach), with a prioritised punch list and 4-week launch sequence.

---

## Executive summary

**Verdict: not launch-ready, but ~2 weeks of focused work away from being so.**

- **Code, tests, security:** strong. 970/972 logic tests passing, 0 npm vulns, 0 ESLint errors, full CI matrix green, MIT licensed, comprehensive `SECURITY.md`, encrypted OpenAI key storage, no telemetry. This is the strongest part of the repo and beats most v1 launches.
- **Repo hygiene:** strong on the public-facing surface (README, LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, issue + PR templates, semver releases, CHANGELOG, badges, topics, dependabot). **Weak on internal-vs-public separation** — see the companion document for the leak audit.
- **Documentation:** good but with one gap (MCP API surface is undocumented for external integrators).
- **Distribution / first-run UX:** weak. The landing page CTA says "Download for Windows" but there is no installer attached and no `electron-builder` / `electron-forge` config exists in the repo to build one. **This is the single biggest "close-the-tab in 30 seconds" risk.**
- **Platform story consistency:** weak. README says "Mac port next, Linux after"; landing says non-Windows glue isn't written; the repo ships a working `install.sh` and `posix_hooks.py`. Three different stories. A senior dev will spot this in 60 seconds.
- **Marketing assets:** mostly ready. Landing page is well-written, social/blog/Reddit/HN drafts are professional-grade and include posting tactics. Demo videos are recent (May 3 2026) but **no hero video has been uploaded to YouTube**, and every social template has a `<YOUTUBE_URL>` placeholder.
- **Positioning:** weak. The repo competes against Aider voice, Voice Mode, ElevenLabs MCP, and Cursor dictation but doesn't differentiate against any of them on the landing page. The actual differentiator is narrow and defensible — *local, session-aware narration and control for parallel Claude/Codex sessions* — but it isn't articulated.

**Senior-dev professionalism score: 5/10 today, achievable to 8/10 with the punch list below.** (Companion document scores 6.5/10 — the difference is they were more generous on the substance side; both reviewers agree the surface drags the average down.)

---

## 1. Repository hygiene

| Item | Status | Evidence |
|---|---|---|
| README.md | ✅ Strong | First 200 words sell the product; hero SVG `docs/assets/terminal-talk-hero.svg`; 3-line install at `README.md:134-146`; 5 badges (release, license, platform, Node version, tests) |
| LICENSE | ✅ MIT, matches `package.json` license field | `LICENSE:1-3` |
| CONTRIBUTING.md | ✅ 141 lines, comprehensive |  |
| CODE_OF_CONDUCT.md | ✅ Contributor Covenant 2.1, 52 lines | enforcement contact `benjaminfrancisburns@gmail.com` |
| SECURITY.md | ✅ 133 lines, GitHub Security Advisories disclosure path, 72hr SLA | `SECURITY.md:19-27` |
| Issue templates | ✅ bug + feature + config | `.github/ISSUE_TEMPLATE/bug_report.yml` (65 lines), `feature_request.yml` (30 lines) |
| PR template | ✅ 37 lines | `.github/PULL_REQUEST_TEMPLATE.md` |
| Topics | ✅ 12 relevant topics | `accessibility, anthropic, claude-code, edge-tts, electron, hands-free, openwakeword, text-to-speech, tts, voice-assistant, wake-word, windows` |
| Releases | ⚠️ semver tags v0.1→v0.6, CHANGELOG per version, **but no installer attached** | `releases/latest` has no `.zip` or `.exe`. CTA on landing breaks. |
| Discussions | ❌ Disabled | `has_discussions: false` |
| Pinned issues | ❌ None |  |
| CODEOWNERS | ❌ Absent (acceptable for solo repo) |  |
| FUNDING.yml | ❌ Absent (acceptable pre-monetisation) |  |
| Workflows | ✅ All 12 lanes green at `cf9c699` | `pure-logic-tests` (Node 18/20/22), `lint`, `knip`, `python-lint`, `npm-audit`, `pip-audit`, `file-length`, `powershell-lint`, `windows-full`, `e2e-windows`, `release`, `doc-drift` |
| Internal scaffolding leak risk | ⚠️ See companion document § "Hidden internal scaffolding that should not be public" | `COORDINATION.md`, `ASSESSMENTS/`, `docs/SESSION-HANDOFF-*.md`, `docs/LIVE-*.log`, `docs/VIDEO_*.md` are all not gitignored |

---

## 2. Code quality and architecture

**Run results at `cf9c699`:**

| Check | Result |
|---|---|
| `node scripts/run-tests.cjs --logic-only` | **970 passed, 2 failed** |
| `node scripts/check-file-length.cjs` | **6 violations** (renderer.js +59, dot-strip.js +5, heartbeat.js +11, tabs.js +2, transcript-panel.js +7, capture-kit-screenshots.cjs +32) |
| `npx eslint app scripts docs/ui-kit` | ✅ 0 errors, 0 warnings |
| `npm audit` | ✅ 0 vulnerabilities (218 deps) |
| `pip-audit` | ✅ 0 vulnerabilities |
| Coverage thresholds | lines 75 / branches 67 / functions 68 |

**Failing tests:** `docs/app-mirror/ is in sync with app/` (stale; fix with `node scripts/sync-app-mirror.cjs`) and `collapsed letterbox` (Codex's uncommitted CSS in working tree only — committed state passes CI).

**Silent-failure surfaces** (top offenders):
- `app/renderer.js:189, 1167, 1972, 2292, 2338, 2427, 2523, 2571` — eight `.catch(() => {})` cases.
- `app/codex-hook-common.psm1:90, 103-105` — three Codex session-ID extraction `try { } catch {}` blocks. Could silently misroute clips.
- `app/main.js:1845` (per AUDIT-FOCUS-2026-04-30) — wake-word listener stderr discarded entirely.

**Subsystems with no unit-test coverage** (renderer-only DOM components, covered indirectly by E2E):
`audio-player.js`, `dot-strip.js`, `sessions-table.js`, `settings-form.js`, `tabs.js`, `transcript-panel.js`, `tray.js`, `window-dock.js`. Plus `voice-dispatch.js` `pickFallbackClip()` per AUDIT-FOCUS.

**Type safety:** No TypeScript, no JSDoc on the public IPC surface (`window.api.*` in `app/preload.js`). External integrators have no type contract.

---

## 3. Documentation

**README:** ✅ A new developer can get the app running in <10 min.

**Architecture document:** ✅ Three layers — README ASCII diagram at `:522-557`, `docs/design-system/architecture.html`, `docs/v0.6/architecture/ipc-integrity.md`.

**Per-feature parity:** ✅ Heartbeat, tool narration, audio player, transcript panel, sessions table, markdown sanitiser all match README claims to code.

**CHANGELOG:** ✅ Keep-a-Changelog format, current to v0.6.0.

**Gaps:**
- **MCP server API undocumented for external use** — `app/terminal-talk-mcp-server.js:12-68` defines five tools. External integrators must read source. Needs a `docs/MCP-API.md`.
- **No "Next steps after install" guidance** — `README.md:142` ends at "takes ~3 minutes". No "now check the system tray" or "press Ctrl+Shift+S to test highlight-to-speak".
- **Install timing claim** — "~3 minutes" is optimistic; on slow networks + first `npm install` it's 5-10 min.
- **Missing prerequisite** — Git is required by the install path but not in the prereq list.

---

## 4. Distribution & first-run UX

**This is the weakest area of the project.**

1. **Git is undocumented as a prereq** (`README.md:142`).
2. **Install flags are undocumented** (`install.ps1:14`) — `-Launch`, `-NoShortcuts`, `-CodexHooksYes`, `-ClaudeHooksYes`, `-StartupYes` exist; README compresses install to one sentence.
3. **`-Launch` can drop the user into a hidden window** — `install.ps1:568` calls electron with `show: WINDOW_MODE` (`app/main.js:518, 529`). Normal toolbar mode = `WINDOW_MODE` false → window invisible. Even visible, the toolbar collapses to a 14px-tall pill (`app/styles.css:33, 52`). User finishes install, sees nothing, closes the tab.
4. **Edge TTS cloud dependency not surfaced at install-time** — default voice synth calls `speech.platform.bing.com`. Documented in README but not in the installer.
5. **No SmartScreen guidance** — Windows will block first launch with an unrecognized-app warning. `SECURITY.md:119-126` acknowledges this but README install steps don't warn about it.
6. **First spoken clip path is opaque** — empty selection just logs "No highlighted text captured" (`app/main.js:1189`). Hotkey registration failures aren't surfaced in UI.
7. **Landing page CTA mismatch** — `docs/index.html:788` says "⬇ Download for Windows" → links to `/releases/latest` → no installer, and **no `electron-builder` config in the repo to build one**.

**POSIX path:** `install.sh` and `app/posix_hooks.py` are real working code. But `key_helper.py:25` uses `ctypes.windll`, wake-word and mic-watcher are Windows-only, and the landing page itself says non-Windows glue isn't written. **The repo ships POSIX install paths it doesn't admit to anywhere user-facing.**

---

## 5. Platform story, privacy & legal

**Platform story conflicts** (three sources, three answers):
- `README.md:14` — "Mac port next, Linux after"
- `docs/index.html:1081` — "Mac and Linux glue is not yet written"
- `install.sh:1`, `app/posix_hooks.py:1` — fully implemented POSIX install + hook handlers

**Privacy:** ✅ Strong. `README.md:446-471` covers what touches the network and what stays local. No telemetry — verified by grepping `app/` for outbound calls.

**OpenAI key:** ✅ Strong. `app/lib/api-key-store.js` uses Electron `safeStorage` with a plaintext sidecar at `config.secrets.json` for hooks. Migration from old plaintext keys handled.

**License compatibility:** ✅ All deps MIT/BSD/LGPL-3.0 — compatible with project's MIT.

**SECURITY.md:** ✅ Excellent.

**Gaps:**
- Trademark search not done — USPTO TESS at https://tmsearch.uspto.gov/ before launch.
- Domain not secured — `terminal-talk.com / .dev / .ai / .app`. £10/year, do this **before** any public post.
- Code signing absent — SmartScreen will flag every install. Document the SmartScreen UX in install steps; Azure Trusted Signing as cheapest legitimate path.

---

## 6. Landing page & marketing assets

**Above-fold copy:** ✅ Strong. *"Your coding agents speak back, in order, through one toolbar."*

**Live UI demo iframe:** ✅ Today's work. Real renderer with click-to-explore detail panel for every button/toggle/feature.

**Demo content:** ⚠️ Mixed. Videos at `docs/videos/` are **dated May 3 2026** (recent), but the demo section copy (`docs/index.html:901`) says *"updated videos are next"* — copy contradicts asset state. **No hero video uploaded to YouTube** — every social/blog template has a `<YOUTUBE_URL>` placeholder.

**SEO:** ⚠️ Basic. Meta description present, OG image at `docs/assets/wallpaper/terminal-talk-wallpaper.png` is undersized (should be 1200×630), no JSON-LD `SoftwareApplication` schema.

**Mobile responsiveness:** ✅ 5 media-query breakpoints. Untested on actual devices.

**Accessibility:** ⚠️ Alt text good, ARIA landmarks present, **but zero video captions**.

**Differentiation:** ❌ Missing. No "Why Terminal Talk over X" section.

**Marketing kit at `~/Documents/terminal-talk-launch/`:**
- `blog-post.md` (89 lines) — ready, has `<YOUTUBE_URL>` placeholder
- `social/twitter-thread.md` (45 lines) — 5-tweet thread with canned reply bank
- `social/linkedin-post.md` (23 lines) — professional tone, posting-tactic notes
- `social/reddit-showhn.md` (94 lines) — HN + r/ClaudeAI + r/commandline + r/electron with staggered posting
- `obs-recording-guide.md` (190 lines) — production-grade

---

## 7. Launch channels & YouTuber outreach

**Channel map (priority order):**

1. **GitHub release with packaged installer** — must exist before anything else.
2. **Show HN** — Tuesday/Wednesday 09:00 UTC. Title: `Show HN: Terminal Talk – Hands-free voice output for Claude Code and Codex`.
3. **r/ClaudeAI + r/Anthropic + r/LocalLLaMA + r/programming** — staggered over 48 hours.
4. **Twitter/X thread** — at-mention `@AnthropicAI`, `@ClaudeAI`.
5. **YouTuber DMs** — see drafts below.
6. **Hacker News follow-up "Ask HN"** — 2 weeks post-launch.
7. **Dev.to / Hashnode crosspost** — week 2.
8. **Product Hunt** — week 3 only if Show HN went well.

**YouTuber DM drafts** (each 4-5 lines):

---

**Theo Browne (t3.gg)** — full-stack/Next.js, occasionally AI tooling
> Hey Theo — built a thing you might find useful. Terminal Talk gives every Claude Code and Codex CLI session its own voice + colour, so you can run 4 agents in parallel and actually keep up without reading every terminal. MIT, free, runs locally. Demo: [link]. Happy to ship a custom build or jump on a 15-min call if it's worth a look.

**Matt Wolfe (FutureTools)** — AI tool surveyor
> Hi Matt — I'm Ben, solo plumber turned indie dev (no joke), and I just shipped Terminal Talk: a hands-free voice layer for Claude Code / Codex / Claude Desktop. Free, MIT, no signup. Built it because I'm dyslexic and lose 40% of agent output when I skim. 90-second demo: [link]. Would love to hear if it fits FutureTools' radar — happy to send the install zip ahead.

**Nathaniel Whittemore (AI Daily Brief)** — daily AI news
> Hey Nathaniel — quick pitch. Terminal Talk turns parallel Claude Code / Codex sessions into one colour-coded audio stream you can follow without watching the screen. The interesting framing for the show: "session-aware narration" is a gap most voice-AI tools miss — Aider does dictation, ElevenLabs does TTS, but nobody handles the orchestration layer for multi-agent workflows. MIT, free, indie. [link]

**Riley Brown** — Cursor / AI workflow
> Hey Riley — your Cursor workflows are wild. I've shipped a complement for the Claude Code / Codex side: Terminal Talk gives every CLI session its own voice + identity, so multi-agent workflows become listenable. MIT, free, local. Would the Cursor crowd care if you mentioned it? Demo: [link]. Open to feature requests if you'd want to make it Cursor-friendly.

**AI Jason** — workflow demos
> Hi Jason — Terminal Talk: hands-free voice for Claude Code / Codex CLI sessions, with session-coloured tabs, mute/focus per assistant, and "hey jarvis" highlight-to-speak. Built solo, MIT licensed. The demo is genuinely visual — colour-coded waveform animations, mascot scrubber, all of it. Could be a 5-min YouTube short. 90-sec demo: [link].

**David Ondrej** — technical deep dives
> Hey David — open-source angle for the channel. Terminal Talk is a solo-built Electron + Python + openWakeWord layer over Claude Code / Codex CLI. Local wake-word (no cloud mic), Edge TTS for free voices, OpenAI optional, MIT. The architecture hooks into Claude's hook system + watches Codex rollouts. 100% open, no telemetry. Worth a deep-dive? [link]

**ColeMedin** — AI agents and dev tooling
> Hi Cole — your Claude Code coverage is the best on YouTube. Terminal Talk plugs into the hook system and gives every parallel session its own voice + colour-coded UI. MIT, free, no accounts. Would your audience care? 90-sec demo here: [link]. Happy to walk through the architecture.

**All About AI** — broad AI coverage
> Hi — Terminal Talk is a hands-free voice layer for Claude Code / Codex with a real accessibility angle (built it because I'm dyslexic and miss agent output when I skim-read). Free, MIT, 90-sec demo: [link]. Could be a good fit for the productivity/accessibility crossover videos.

**Simon Willison** (blog/Mastodon, not YouTube)
> Simon — open-source MIT layer over Claude Code's hook system + Codex rollout watcher: Terminal Talk gives every CLI agent its own voice and colour identity. Edge TTS for free voices, OpenAI key support optional, openWakeWord for local "hey jarvis". No telemetry, no accounts. Architecture write-up here: [link]. Would value your read if you have time.

---

**Outreach mechanics:**
- Send DMs Tuesday-Thursday morning their timezone, never weekends.
- Personalise the first line for each — show you've watched their content.
- Always include: 90-sec demo URL, GitHub URL, one-line ask, opt-out ("totally fine if not").
- Track opens with a per-recipient unique URL tag (`?ref=theo-2026-05`).
- Don't send to all 9 in one day — stagger 2-3/day.

---

## 8. Post-launch infrastructure

**What's in place:**
- Issue templates → community can file bugs cleanly.
- CI + CodeQL → regressions caught automatically.
- Dependabot → weekly dep PRs.
- Releases workflow → tags trigger archive snapshots.

**What's missing:**
- Issue triage SLA — no documented "I'll respond within X hours".
- GitHub Discussions disabled — Q&A goes to Issues, mixing bug reports with newbie support.
- No Discord, no community surface for non-bug questions.
- No telemetry plan (intentional, but means you'll never know which features get used).
- No `ROADMAP.md` or GitHub Projects board users can react to.
- No versioning cadence commitment.

---

## 9. Comparables & differentiation

| Project | Stars | Lane | Copy | Differentiate against |
|---|---|---|---|---|
| **Aider** | ~44k | AI coding assistant | Animated SVG screencast, terse install clarity | Aider already has voice-to-code; TT's lane is *session monitoring*, not dictation |
| **Continue.dev** | ~33k | AI coding agent | Quickstart structure | TT is not another agent — it's the listening/speaking layer around existing agents |
| **Plandex** | ~15k | AI planner | One-scan workflow diagram | TT can be the notification layer around Plandex, Aider, Cursor — not a competitor |

**Direct competitors already in the voice/AI lane:**
- **Aider voice** — voice-to-code dictation
- **Voice Mode** — voice conversation wrapper for Claude Code and Cursor
- **ElevenLabs MCP** — premium TTS via MCP
- **Voicy / Cursor dictation** — general dictation into Cursor

**TT's actual differentiator** (currently invisible on landing):
- Local wake-word (offline)
- Session-aware narration across **multiple** parallel Claude/Codex sessions
- Per-session colour identity + mute/focus
- Free Edge voices by default
- No accounts, no cloud, no telemetry

---

## 10. Honest gut check (per Codex's outsider review)

**Q1. Senior-dev professionalism score, 1-10:** **5/10 today.** Code, tests, security are 8/10; distribution and platform-story consistency are 3/10.

**Q2. Single biggest reason a new visitor closes the tab in 30 seconds:** Distribution friction. CTA promises a download that doesn't exist.

**Q3. Most embarrassing thing a senior dev notices in 60 seconds:** The mismatch between platform claims and operational reality, **plus** (per the companion review) the unredacted `COORDINATION.md` and `docs/SESSION-HANDOFF-*.md` files that aren't gitignored.

---

## Punch list (priority × effort)

| # | What | Why it matters at launch | Effort |
|---|---|---|---|
| 1 | **Build a packaged Windows installer (.zip or .exe), attach to GitHub release, point landing CTA at it** | Unblocks every other channel. CTA without a real download = bounce. | M |
| 2 | **Reconcile platform story** — pick one of: (a) Windows-only, label POSIX as "preview", or (b) remove `install.sh` + POSIX hooks. Update README + landing + installer to one truth. | Senior-dev credibility hit otherwise. | S |
| 3 | **Gitignore + git-rm internal scaffolding** (`COORDINATION.md`, `ASSESSMENTS/`, `docs/SESSION-HANDOFF-*.md`, `docs/LIVE-*.log`, `docs/VIDEO_*.md`, `docs/COMMAND_CENTER_*.md`, `docs/PAGE_HARVEST_CONCEPT.md`, `docs/TERMINAL_SESSION_LAUNCHER_CONCEPT.md`) | Currently leaks Windows username path + raw Codex logs to GitHub. | XS |
| 4 | **Sync app-mirror + bump file-length baselines** | Fresh checkout has 0 failing tests. | XS |
| 5 | **Upload hero demo video to YouTube** — populates `<YOUTUBE_URL>` in 4 social templates | Currently every social post template is non-deliverable. | S |
| 6 | **Add "Why Terminal Talk" comparison section** on landing — name competitors, explain session-monitoring differentiator | Visitors who know competitors otherwise dismiss as redundant. | S |
| 7 | **Document MCP API** at `docs/MCP-API.md` — 5 tool schemas with examples and error cases | External integrators currently read source. Gates Claude Desktop adoption. | M |
| 8 | **First-run UX** — `-Launch` shows a one-time onboarding window | Users finish install and see nothing. Dropoff. | M |
| 9 | **Register `terminal-talk.dev`** (£10/year) | Squat risk after a Show HN front-page. | XS |
| 10 | **Add SmartScreen warning explanation** to README install steps | Stops install-time panic. | XS |
| 11 | Add Git to README prereq list at `:142` | Missing prereq blocks the *first* command. | XS |
| 12 | Document all `install.ps1` flags in README | Power users today don't know they exist. | XS |
| 13 | Surface failures in UI: empty selection toast, hotkey-registration banner, TTS failure indicator | Today errors only hit log files; users assume the tool is broken. | M |
| 14 | Resize OG image to 1200×630 + add JSON-LD `SoftwareApplication` schema | Twitter/LinkedIn previews crop badly today. | XS |
| 15 | Generate auto-captions (WebVTT) for all 9 demo videos | Accessibility + SEO. | M |
| 16 | Enable GitHub Discussions, create Q&A / Ideas categories | Separates support questions from bug reports. | XS |
| 17 | Pin top 3 roadmap issues | Sets expectations for incoming community. | XS |
| 18 | Collect 1-2 testimonials from early reviewers, add quote block on landing | Social proof. | S |
| 19 | Add JSDoc `@typedef` for `window.api.*` in `app/preload.js` | Type contract for external MCP integrators. | M |
| 20 | Fix silent `.catch(() => {})` in `app/renderer.js:1167, 1972` | Silent failures users currently can't diagnose. | XS |
| 21 | Trademark search at https://tmsearch.uspto.gov/ | Avoids C&D after launch. | XS |
| 22 | Set up free Discord server for community Q&A and feature voting | Lowers cost of community engagement once growth starts. | S |
| 23 | Adjust install timing claim from "~3 minutes" to "3-10 minutes depending on network" | Honesty. | XS |
| 24 | Code-sign the Windows installer via Azure Trusted Signing | Removes SmartScreen friction, professional-grade. | L |
| 25 | Decide telemetry policy — opt-in error reporting via Sentry, or commit to no-telemetry forever. Document. | Affects every roadmap decision. | M |

**Effort scale:** XS < 30 min, S = 30 min - 2h, M = 2-8h, L = > 1 day.

---

## Suggested launch sequence (4-week)

### Week 1 — Foundations (must-fix before any public post)
- **Day 1-2:** #1 (packaged installer), #2 (platform story), #3 (gitignore internal scaffolding), #4 (sync app-mirror), #9 (register domain), #10 (SmartScreen note), #11 (Git prereq), #12 (flags doc).
- **Day 3:** #6 (comparison section on landing), #14 (OG image + JSON-LD), #23 (install timing).
- **Day 4-5:** #5 (upload hero video), #15 (video captions), #21 (trademark check).

### Week 2 — UX polish & docs
- **Day 6-7:** #7 (MCP API doc), #19 (JSDoc on preload).
- **Day 8-9:** #8 (first-run onboarding window), #13 (UI failure surfaces), #20 (silent-catch fixes).
- **Day 10:** #16 (Discussions on), #17 (pin roadmap issues), #18 (testimonial outreach).

### Week 3 — Soft launch
- **Day 11:** Post to **r/ClaudeAI** only.
- **Day 12:** Post to **r/LocalLLaMA** + **r/programming**.
- **Day 13:** Send **3 of the 9 YouTuber DMs** (priority: Simon Willison, Theo Browne, Cole Medin).
- **Day 14:** Twitter thread.
- **Day 15:** Watch + respond.

### Week 4 — Hard launch
- **Day 16 (Tue, 09:00 UTC):** **Show HN**. Opening comment = blog post intro. Active for first 4 hours.
- **Day 17:** Cross-post blog to dev.to and Hashnode.
- **Day 18-19:** Send remaining **6 YouTuber DMs**.
- **Day 20:** LinkedIn post.
- **Day 21:** Retrospective. Plan v0.7.

**Stop conditions:** if any of items #1, #2, #3, #5 isn't done, do NOT post.

---

## Final note

The code is ready. The story isn't. The 4-week plan above closes that gap without slowing down further development. The biggest risk to a successful launch isn't technical — it's the gap between what the tool actually does (session-aware narration for parallel Claude/Codex sessions, novel and defensible) and what the landing/distribution conveys (yet another voice tool, ill-positioned, with a broken download button). Fix the framing and the funnel; the product underneath holds up.
