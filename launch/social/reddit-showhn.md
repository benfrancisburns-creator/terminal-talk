# Reddit + Hacker News — Terminal Talk v0.3.0

Two similar but distinct formats. Don't cross-post simultaneously; stagger by at least 24 hours between each subreddit.

---

## Hacker News — Show HN

### Title

```
Show HN: Terminal Talk – Claude Code responses, read aloud (Windows, free)
```

### Body

```
I was skimming 40% of Claude Code's output — scrolling past the explanations, reading only the diffs. Built this to listen instead.

What it does:

- Sentence-by-sentence streaming TTS. Audio starts ~2-3s after Claude begins talking, not 20+s after the turn ends. If a turn has 3 tool calls, you get audio between each tool call.
- "Hey jarvis" wake-word — highlight text in ANY app, say the phrase, it reads that text. Also Ctrl+Shift+S.
- One voice per Claude Code terminal. Run 3 agents in parallel, tell them apart by ear. Per-session mute + focus controls.
- Free by default — uses Microsoft Edge Neural voices (same ones Windows' read-aloud ships with). 47 English voices.

Tech:

- Electron 41 for the floating toolbar (680 × 114 pill, snaps to edges, auto-collapses to click-through strip after 15s idle).
- Python ThreadPoolExecutor for parallel edge-tts synthesis, rolling-release with monotonic mtime so audio plays in-order regardless of which sentence finished synth first.
- openwakeword (CPU, local) for "hey jarvis". No audio leaves your machine unless you explicitly enable optional OpenAI premium voice fallback.
- safeStorage DPAPI for the one optional API key. CSP locked down with no unsafe-inline (v0.3 hardening).

Windows only. Mac/Linux on the roadmap, no date — the wake-word + clipboard plumbing need platform-specific rewrites.

Install: git clone + install.ps1, three prompts, done. Uninstall is surgical.

Audit trail: v0.3.0 closes 13 deferrals from a six-pass code audit I commissioned on v0.2.0. Full finding-by-finding catalog in the repo under `Claude Assesments/AUDIT-FINAL.md`.

Code: https://github.com/benfrancisburns-creator/terminal-talk
Demo video: <YOUTUBE_URL>

Feedback welcome. "Didn't help me" is as useful as "loved it".
```

### Posting notes

- **Post between 9 AM and 11 AM GMT on a weekday** (peaks of US + UK morning traffic).
- **Respond to every top-level comment** in the first 2 hours. Even "thanks, will try" gets a reply.
- **Don't argue with critics** — acknowledge the limit, thank them, move on. Example: `"Fair — Mac is the #1 request and it's on the roadmap. No date though."`

---

## Reddit — r/ClaudeAI

### Title

```
I built Terminal Talk — Claude Code's responses read aloud in real time (Windows, free, open source)
```

### Body

```
Hey r/ClaudeAI — long-time lurker, occasional poster.

Been running Claude Code daily for about six months. Noticed I was skimming 40% of its output — my eyes can't keep up with reading while my hands are on code. So I built a thing that listens for me.

**Terminal Talk** sits in a thin floating toolbar at the top of your screen and reads Claude's responses aloud in real time. A few design choices that matter:

1. **Sentence-level streaming.** Audio starts ~2-3 seconds after Claude begins responding. If you're in a tool-heavy turn, you get audio between each tool call instead of a 40-second silence.
2. **One voice per terminal.** I run 3-4 Claude Code sessions in parallel. Each gets its own voice + colour — I can tell at a glance (and by ear) which agent is saying what.
3. **"Hey jarvis" anywhere.** Highlight text in a browser / PDF / Slack, say the phrase, it reads it. Or Ctrl+Shift+S. Wake-word runs locally (openwakeword, CPU only, no audio leaves your machine).
4. **Free by default.** Uses Microsoft Edge Neural voices — the same 47 English voices Windows' built-in read-aloud ships with. No API key needed. OpenAI voices available as optional paid fallback.

**Per-session controls** you'll probably reach for:

- Mute a chatty agent while you focus on another. Mid-playback mute stops the clip.
- Focus one session — its unplayed clips jump the queue ahead of everyone else's.
- Auto-prune played clips after N seconds (default 20s, configurable 3-600s).

**Windows only** right now. I know; I'm sorry; Mac is the #1 request and it's on the roadmap. The wake-word daemon and clipboard plumbing need Windows-specific API replacements for macOS, and I'd rather ship a stable Windows-first than a half-working cross-platform.

**v0.3.0 is today's release.** v0.2.0 was the feature release (all the above). v0.3.0 is quality — Electron upgrade, safeStorage encryption for the optional API key, CSP hardening, 107 → 162 automated tests.

Install: clone the repo, run `.\install.ps1`, three prompts, done. Uninstall is clean.

Code + install instructions: https://github.com/benfrancisburns-creator/terminal-talk

MIT licence. Free forever. If you try it and it doesn't click, tell me — negative signal is as useful as positive.

Demo video (60s): <YOUTUBE_URL>
```

### Posting notes

- **r/ClaudeAI has ~80k subscribers** — best fit. Don't cross-post to r/ArtificialIntelligence (audience not technical enough) or r/LocalLLaMA (not quite on-topic).
- **After 24 hours**, consider r/commandline with a slightly shorter version focused on the hotkey + highlight-to-speak angle.
- **After 48 hours**, r/electron with a tech-focused version (Electron 41, CSP hardening, mock-IPC kit — things r/electron actually cares about).

---

## r/commandline — 24 hours later variant

### Title

```
A floating toolbar that reads highlighted text aloud — "hey jarvis" to trigger, Ctrl+Shift+S also works
```

### Body

```
Not specifically AI/Claude-related for this subreddit — the wake-word + highlight-to-speak stack is the part most useful to command-line people.

Highlight any text — terminal, browser, PDF, Slack, wherever the OS cursor is — say "hey jarvis", it reads that text aloud. Or press Ctrl+Shift+S. Windows, runs in the background, 14 MB RAM idle.

Uses Microsoft Edge Neural voices (free, 47 English options). Wake-word is openwakeword on CPU, no audio leaves your machine.

Originally built to read Claude Code responses, but the "highlight anything, hear it" part works regardless of what you're doing. I use it for reading long Jira tickets, PRs in the GitHub web UI, Confluence pages.

https://github.com/benfrancisburns-creator/terminal-talk

Windows only for now. MIT.
```

---

## r/electron — 48 hours later variant

### Title

```
Shipped an Electron app: a few v0.3 hardening lessons (Electron 41, CSP tightened, safeStorage)
```

### Body

```
Shipped Terminal Talk v0.3.0 this week. Writing up a few hardening decisions that might be useful to other Electron folks.

1. **Dropped `'unsafe-inline'` from style-src entirely.** Three approaches to the ~15 inline-style sites in the renderer: (a) data-attribute + generated CSS classes for enumerable values (palette indices 0-23), (b) a `.hidden` utility class for boolean display toggles, (c) Constructable Stylesheet (`document.adoptedStyleSheets`) for continuous px-value assignments (mascot position, spinner words). CSP `style-src` is now just `'self'`. Three regression tests lock it.

2. **safeStorage for the optional OpenAI API key.** DPAPI-backed `.enc` file alongside a plaintext sidecar with user-only ACL (because three PS hooks need to read the key and I'm not spawning Electron processes from hooks). Not a security improvement against a compromised user session — but against backup/snapshot leakage it matters, and my threat model is "the key shouldn't travel with a disk image".

3. **Kit = iframe of the real renderer.** Previously the design-system kit was a parallel React reimplementation. Now `docs/ui-kit/index.html` loads `app/renderer.js` verbatim with a `window.api` mock (17 invoke handlers + 8 event subscriptions, ~250 LOC). Drift is structurally impossible — if renderer.js changes, the kit changes.

4. **CI action SHA pinning.** Every `uses:` reference in `.github/workflows/*.yml` is pinned to a 40-char commit SHA with the semver tag as a trailing comment. Dependabot's `github-actions` ecosystem rewrites both on upgrade. Supply-chain guarantee of a pinned SHA + maintenance ergonomics of a floating ref.

Upgrading Electron 32 → 41 was a non-event (no relevant breakages in the 33-41 migration notes, all 13 Playwright E2E tests passed on first `npm install`). Your mileage will vary depending on which APIs you touch.

Code: https://github.com/benfrancisburns-creator/terminal-talk

Windows only (for unrelated reasons — wake-word + clipboard plumbing).
```
