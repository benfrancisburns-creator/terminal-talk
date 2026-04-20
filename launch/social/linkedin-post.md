# LinkedIn post — Terminal Talk v0.3.0

Paste the block below into a LinkedIn post. Attach the video directly (LinkedIn penalises outbound links; YouTube embed gets ~20% the reach of a native upload).

---

## Post body

Six months of running Claude Code daily and I realised I was skimming 40% of its output — scrolling past the explanations, reading only the diffs. Not because the responses weren't useful; because my eyes couldn't keep up while my hands were on code.

So I built Terminal Talk. It sits in a thin floating toolbar at the top of the screen and reads Claude's responses out loud in real time — sentence-by-sentence streaming, so audio starts ~2-3 seconds after Claude begins responding, not 20+ seconds after the turn finishes.

A few things that made the cut:

• Each Claude Code terminal gets its own colour and voice — you can run three agents in parallel and tell them apart by ear.
• Highlight any text on your machine and say "hey jarvis" — it'll read that too. Works in browsers, PDFs, Slack, anywhere.
• 47 free English voices (Microsoft Edge Neural, the same ones Windows' read-aloud uses) across UK, US, AU, CA, IE, IN + 8 more regions.
• Wake-word runs locally — no audio ever leaves your machine unless you explicitly enable optional OpenAI premium voices.
• Per-session mute and focus controls. One chatty agent? Mute it. Waiting on a specific one? Star its session and its clips jump the queue.

v0.3.0 shipped today. Windows only for now. Free, open source, MIT licence.

Built by me over the course of a few late evenings — with Claude Code, inevitably. An honest note: if you try it and it doesn't click, tell me. "Didn't help me" is as useful a signal as "loved it".

Repo + install: github.com/benfrancisburns-creator/terminal-talk

#OpenSource #DeveloperTools #Accessibility #ClaudeCode

---

## Posting notes

- **Attach the video directly** via LinkedIn's native uploader. Don't post a YouTube link.
- **Add alt text** to the video when LinkedIn prompts you — helps accessibility AND the algorithm surfaces captioned posts.
- **First hour matters** — reply to every comment in the first 60 minutes. LinkedIn heavily weights early engagement for reach.
- **Don't spam hashtags**. Three is optimal; five is fine; ten is a signal to the algorithm that you're reaching.
- **Skip emoji in the opening line** — LinkedIn's preview shows the first 140ish characters and emoji crowd out signal.
