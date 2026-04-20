# X / Twitter thread — Terminal Talk v0.3.0 launch

5 tweets, ~280 chars each. Video in tweet 1. Thread together.

---

## Tweet 1 (hook + video)

Six months of Claude Code and I realised I was skimming 40% of its output.

Terminal Talk reads Claude's responses out loud while I work. Hands on keyboard, ears catch up.

v0.3.0 out today. Windows, free, open source.

🎬 [attach the demo video]

github.com/benfrancisburns-creator/terminal-talk

---

## Tweet 2 (the core mechanic)

Sentence-by-sentence streaming — audio starts ~2-3 seconds after Claude begins talking, not 20+ seconds after it's done.

Three tool calls in one turn? You get audio between each one. No more 40-second silences.

---

## Tweet 3 ("hey jarvis")

Highlight text ANYWHERE on your machine — browser, PDF, Slack, another terminal — say "hey jarvis", and it reads that text aloud.

`Ctrl+Shift+S` does the same if you'd rather not talk to your laptop.

Wake-word runs locally. `openwakeword` on CPU, no audio leaves your machine.

---

## Tweet 4 (one voice per terminal)

Multiple Claude Code agents running in parallel?

Each terminal gets its own colour + voice. Tell them apart by ear.

Mute any session with one click. Focus one and its clips jump the queue. Mid-playback mute stops the clip.

---

## Tweet 5 (install + honesty)

Install: `git clone` + `install.ps1`. Three prompts, three yeses, done.

Windows only — Mac/Linux on roadmap, no date.

Built with Electron + Python. Edge Neural voices by default (free, 47 English options). OpenAI voices optional.

MIT licence. github.com/benfrancisburns-creator/terminal-talk

---

## Alternative shorter version (for Threads / Bluesky)

> Claude Code is verbose and my eyes were skimming. Built a thing that reads responses out loud instead. Sentence-level streaming so audio starts while Claude's still talking. One voice per terminal. Free, Windows, open source.
>
> [video] github.com/benfrancisburns-creator/terminal-talk

---

## Posting notes

- **Embed the video in tweet 1**, not as a link. X kills reach on outbound YouTube links.
- **Thread them immediately** — don't leave a gap between tweet 1 and tweet 2 or the algorithm treats them separately.
- **Pin tweet 1** to your profile for the launch week.
- **Don't reply-guy your own thread** with extra "bump" tweets. It reads as desperate. Reply only to people engaging.
- **Likely questions + canned replies** (save as notes in your phone before posting):
  - *"Mac port?"* — "On the roadmap; Windows stability first. PRs welcome."
  - *"Is the wake-word always listening?"* — "Yes when enabled, no audio leaves your machine. Toggle with Ctrl+Shift+J — chime confirms on/off."
  - *"What's the latency?"* — "~2-3s from Claude starting to speak, vs 20s+ if you waited for the turn to finish."
  - *"Why Electron instead of native?"* — "Fast shipping + one codebase. Native is a roadmap item if usage justifies it."
