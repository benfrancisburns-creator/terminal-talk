# Terminal Talk — launch playbook

Single-window launch (one Tuesday-to-Thursday, ideally 4-7pm UK / 8-11am Pacific) hits Show HN at peak, gives Reddit time to bake during the US morning, and lets Twitter cross-pollinate. Don't space these out across days — concurrent posts amplify each other.

## What to write — ready to paste

### 1. Show HN (post on https://news.ycombinator.com/submit)

**Title** (use exactly — HN punishes embellishment):
```
Show HN: Terminal Talk – Voice workflow for Claude Code and Codex CLI
```

**URL**: `https://github.com/benfrancisburns-creator/terminal-talk`

**Text** (optional but recommended for Show HN):
```
I built this because I was getting RSI from constantly reading terminal coding
agent output. Wanted something that spoke Claude Code and Codex CLI replies
aloud and let me say
"hey jarvis" to read any highlighted text — without signing up for anything
or sending audio to a cloud service.

How it works:
- Auto-speaks Claude Code via hooks and Codex CLI via local session logs
- "Hey jarvis" or Ctrl+Shift+S reads highlighted text from any app
- Each Claude Code or Codex session gets its own colour and optional voice.
  Claude can show a matching statusline glyph; Codex gets a matching
  Terminal Talk title/PID mapping when you run it normally in a project terminal.

Stack is visible: Electron toolbar, Python for wake-word (openWakeWord, runs
offline on CPU) and edge-tts wrapper, PowerShell hooks for Claude, and a JS
Codex rollout watcher. Large test harness, MIT.

Free tier uses Microsoft Edge's neural voices — same endpoint Edge browser
uses for "Read Aloud", no API key needed. Optional OpenAI TTS fallback if
you want it. Privacy section in the README documents every network call.

Windows-only today; Mac/Linux on the roadmap (no ETA). Pairs nicely with
Wispr Flow or similar for full voice-in + voice-out.

Repo: https://github.com/benfrancisburns-creator/terminal-talk
```

### 2. Reddit r/ClaudeAI

**Title**:
```
[Show] I built Terminal Talk — Claude Code and Codex CLI read replies aloud + "hey jarvis" reads highlighted text. Free, no signup.
```

**Body**:
```
Got tired of reading every single terminal-agent reply, so I built this:

- Claude Code auto-speaks via hooks; Codex CLI auto-speaks via local session logs
- Say "hey jarvis" with text highlighted (anywhere — browser, PDF, VS Code) and
  it reads it aloud
- Each Claude/Codex session gets a unique colour dot on a tiny floating toolbar
- You can give each session its own voice too, so two sessions sound different

Free by default — uses Microsoft Edge's neural voices (no API key required) and
openWakeWord for the wake word (runs entirely offline on CPU). Optional OpenAI
TTS fallback if you want it.

Stack: Electron toolbar + Python wake listener + PowerShell hooks + Codex watcher. MIT licensed.
Windows-only today; Mac/Linux ports on the roadmap (no ETA).

Repo: https://github.com/benfrancisburns-creator/terminal-talk

Pairs nicely with Wispr Flow / Talon / Windows Voice Access for full hands-free.

Happy to answer questions.
```

### 3. Reddit r/commandline

**Title**:
```
Terminal Talk — TTS playback for Claude Code, Codex CLI, and highlighted text
```

**Body**: (same as r/ClaudeAI but lead with "for those using terminal coding agents").

### 4. Reddit r/programming

Skip unless r/ClaudeAI does well. r/programming is harsh on self-promotion.

### 5. Twitter / X post

```
Built Terminal Talk: a free voice workflow for Claude Code and Codex CLI.

→ Auto-speaks Claude and Codex replies
→ Say "hey jarvis" to read any highlighted text aloud
→ Each terminal gets its own colour + optional voice
→ Edge TTS + openWakeWord = no signup, runs locally

MIT, Windows. Mac/Linux on the roadmap.
github.com/benfrancisburns-creator/terminal-talk

[ATTACH 30-SEC DEMO VIDEO]
```

Tag in a reply: `@AnthropicAI`

### 6. Anthropic Discord (#community-projects or similar)

Keep it short, the community values it:

```
Hey 👋 just shipped Terminal Talk — free open-source voice workflow for Claude Code and Codex CLI.

Claude hooks and Codex session logs speak responses aloud, "hey jarvis" reads
any highlighted text, each session gets a unique colour identifier on a small
floating toolbar.
Pairs nicely with a speech-to-text tool for fully hands-free use.

Free + offline wake-word + Edge TTS, no signup needed.
github.com/benfrancisburns-creator/terminal-talk

Happy for feedback or PRs (Mac/Linux ports especially welcome).
```

### 7. Dev newsletter submissions (slow burn — submit then move on)

- TLDR Newsletter: https://tldr.tech/submit (mention in dev/AI section)
- Bytes (JS-leaning): bytes.dev/submit
- Console (dev tools): console.substack.com/submit

For each: link + the Show HN body text. They'll edit it.

---

## What you need to do — step by step

### Step 1 — Record the demo video (~10 min)

This is the single most-important thing. People won't read about a voice tool, they need to see+hear it. **Without a video, the launch will flop.**

What to record (~30 seconds):
1. **0–5s**: A Claude Code terminal visible. Send a short message ("Explain rate limiting in two sentences"). Claude responds and you hear it spoken aloud.
2. **5–15s**: Switch to a browser tab, highlight a paragraph. Say _"hey jarvis"_. Hear it read aloud.
3. **15–25s**: Open a normal project terminal, run `codex`, send another prompt, and show the toolbar — two different colour dots for Claude and Codex. Briefly point out they're the same Terminal Talk queue.
4. **25–30s**: End on the toolbar with both dots visible.

How to record on Windows:
- Press `Win + G` to open Xbox Game Bar
- Click the circular record button (or `Win + Alt + R`)
- Save lands in `Videos/Captures/`
- Convert to GIF if needed: drop on https://ezgif.com/video-to-gif (under 8 MB for Twitter, under 25 MB for HN)

Filename: `docs/screenshots/demo.gif` — drop into the repo.

### Step 2 — Decide launch day + time

Tuesday, Wednesday, or Thursday. Avoid Mondays (back-to-work noise) and Fridays (everyone's off the platforms by EOD). Aim for **4pm UK (8am Pacific)** — hits the start of the US workday.

### Step 3 — Post in this exact order, in one sitting

| Order | Where | Time after first post |
|---|---|---|
| 1 | Show HN | T+0 |
| 2 | Anthropic Discord | T+5min |
| 3 | r/ClaudeAI | T+10min |
| 4 | r/commandline | T+15min |
| 5 | Twitter/X (with video) | T+20min |
| 6 | Newsletter submissions | T+30min |

The reason for the order: HN first because timing matters there. Then community channels (Discord, Reddit) where you can answer questions while the HN post is gaining traction. Twitter last because it benefits from people sharing the HN link.

### Step 4 — Babysit comments for 2-4 hours

- Refresh Show HN every 15 min for the first 2 hours. **Reply to every comment.** Not replying = ranking penalty.
- Reddit: same. First 30 min of comments matter most for upvote velocity.
- Discord: thank people, answer questions.
- Don't argue with critics — say "good point, will look into that" and move on.

### Step 5 — Track the result

- HN front page (top 30) = ~2,000-5,000 visits. Star count usually jumps 200-1000.
- Show HN even off-front-page = 500-1500 visits. Stars: 50-200.
- Reddit: depends. r/ClaudeAI is small but engaged.
- Twitter: usually a slow burn. Wait 48h before judging.

**If it goes nowhere first time**: the post timing was probably bad, or the demo video wasn't compelling. Wait 4-6 weeks, improve the video, retry on a different day. HN allows resubmissions if a post got <5 upvotes.

### Step 6 — Iterate based on feedback

The first 50 users will tell you what's wrong. Common asks for tools like this:
- "Why isn't this on Mac?" → acknowledge it's on the roadmap, no ETA, PRs welcome
- "Does it work without OpenAI?" → yes, that's the whole point — fix the README if this question keeps coming up
- "Privacy?" → already in the Privacy & Security section
- "Can I change the wake word?" → it's documented but maybe not prominent enough
- Bug reports → file as GitHub issues, fix in batches

---

## What NOT to do

- Don't post the same content to 8 subreddits ("brigading" — gets you shadow-banned)
- Don't tag/mention everyone with "what do you think?" — comes across as spam
- Don't reply to critical comments defensively. Acknowledge, move on, fix later
- Don't commit obvious changes to the repo during the launch window — keep the commit history clean for that 24h
- Don't pay for distribution. Free dev tools that pay for promotion read as suspicious

---

## After the launch

If it gains traction:
- Add a "Stars over time" badge to the README (use https://star-history.com)
- Pin a "GitHub Discussions" thread for feedback
- Publish a public roadmap for Mac/Linux ports when the first PR lands
- Consider a `terminaltalk.dev` domain if the project sticks (£10/year)

If it didn't land:
- Don't take it personally. Distribution is luck × demo quality × timing
- Keep iterating on the product. Your second post in 6 weeks with a better demo will land harder
