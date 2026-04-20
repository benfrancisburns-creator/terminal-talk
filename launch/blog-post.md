# Terminal Talk — Claude Code responses, read aloud

**v0.3.0 released today** · Windows, free, open source · [github.com/benfrancisburns-creator/terminal-talk](https://github.com/benfrancisburns-creator/terminal-talk)

---

I've been running Claude Code for six months. Somewhere around month three I realised I was skimming 40% of its output — scrolling past the explanations, looking only at diffs. The responses are thorough. I'm the one who couldn't keep up with the reading.

Terminal Talk was the fix. It watches Claude Code's output and reads it aloud, in real time, in the background. I can keep my hands on the keyboard while my ears catch up.

It does a few other things well, but that's the centre of it.

## What it does

**Auto-speaks every Claude response.** Sentence-by-sentence streaming — audio starts ~2-3 seconds after Claude begins responding, not 20 seconds after the turn ends. If a turn involves three tool calls, you get audio between each tool call instead of a 40-second silence followed by a wall of speech.

**"Hey jarvis" anywhere.** Highlight text in any app — browser, PDF, Slack, another terminal — say "hey jarvis", and it reads that text. No copy-paste dance. Ctrl+Shift+S does the same thing if you'd rather not talk to your laptop.

**One voice per terminal.** Each Claude Code window gets its own colour and voice. When three agents are running in parallel, you can tell them apart by ear. Mute any session with one click; focus one and its clips jump the queue.

**Edge voices by default.** Uses the same Microsoft Neural voices that Windows' built-in read-aloud feature ships with — free, offline-capable after first contact, 47 English voices across UK / US / AU / CA / IE / IN / NZ / ZA / HK / SG / PH / NG / KE / TZ. Premium OpenAI voices available as optional paid fallback.

**A tiny floating toolbar.** 680 × 114 px pill that docks to the top or bottom edge. Shows a dot per clip, oldest-left newest-right, pulsing while playing. Snaps flush on edges. Auto-collapses to a thin strip after 15 seconds of inactivity and becomes click-through so it's never in your way.

<video controls width="720"><source src="<YOUTUBE_URL>"></video>

## Why I built it

Three reasons, stacked:

1. **Cognitive bandwidth.** My eyes were already on code. Using them to also read prose was doubling up. Ears were sitting idle.
2. **Background awareness.** I run multiple Claude Code agents in parallel. With Terminal Talk I can hear which agent is saying what without tab-switching.
3. **Accessibility.** A friend with mild dyslexia tried an early build and said it was the first dev tool they'd used that let them keep up with Claude's output in real time. That moved the project from "nice to have" to "worth finishing properly".

## How I built it

Electron + Python on the plumbing side. The renderer is vanilla JS because I wanted to keep the runtime stable (no build step, no framework churn), and the streaming synthesis pipeline is Python because `edge-tts` has the best free voice catalogue and Python has the cleanest `ThreadPoolExecutor`.

Wake-word detection uses `openwakeword` (local, CPU-only, private). No audio leaves your machine unless you explicitly enable the optional OpenAI fallback for premium voices.

The UI kit in the repo `loads the real renderer` inside a browser with a mocked IPC — which means the design system demo can't drift from the shipping product. If I change the toolbar, the demo changes. Nothing to sync.

## What v0.3.0 added over v0.2.0

v0.2.0 was the feature release (streaming audio, per-session mute/focus, the two-row toolbar, wake-word). v0.3.0 is the quality release:

- **Electron 41** (from 32) — security + longevity
- **safeStorage-encrypted API keys** on disk (DPAPI-backed, useless on another machine)
- **CSP hardened** — the renderer can no longer set inline styles; every dynamic value goes through a Constructable Stylesheet or a generated CSS class
- **Pinned CI** — every GitHub Action is SHA-pinned; Dependabot rewrites the pin on upgrade
- **Pixel-diff regression rig** for the palette
- **107 → 162 automated tests** across unit, end-to-end, doc-drift, coverage, CodeQL

Nothing a user sees. Everything under the bonnet is tighter.

## Install

```powershell
git clone https://github.com/benfrancisburns-creator/terminal-talk
cd terminal-talk
.\install.ps1
```

Three prompts (hooks / statusline / auto-start on login). Say yes to all unless you have specific reasons not to. Restart Claude Code; the next response you hear will be spoken aloud.

To uninstall later: `.\uninstall.ps1`. Surgical — removes the files it installed, nothing else.

## What's missing

**Windows only.** macOS and Linux are on the roadmap but not scheduled. The wake-word listener and clipboard plumbing need platform-specific rewrites; the rest is portable.

**No Safari / Firefox / Chrome extensions.** Terminal Talk is a desktop background service. It reacts to Claude Code hooks; it doesn't hook into a browser.

**No cloud sync.** Every setting is local to your machine. Labels, voices, focus, mute state — all per-install. Intentional (fewer failure modes, no backend to host).

**No crash reporting.** Privacy-first. Errors land in a local log file (`~/.terminal-talk/_toolbar.log`). If something breaks, open an issue and include the log — that's the entire feedback loop.

## Source + issues

Code: [github.com/benfrancisburns-creator/terminal-talk](https://github.com/benfrancisburns-creator/terminal-talk)

Bug reports + feature requests: [github.com/benfrancisburns-creator/terminal-talk/issues](https://github.com/benfrancisburns-creator/terminal-talk/issues)

Licence: MIT. Use it, fork it, ship your own variant. A PR back is always welcome but never obligatory.

---

*If you try it and it genuinely helps, tell me. If you try it and it doesn't, tell me that too — both signals are useful.*
