# Terminal Talk — launch kit

Ship collateral for v0.3.0 public launch. Everything here is ready-to-copy; nothing's prescriptive. Adapt the tone to whichever platform you're posting on.

## What's in this folder

```
launch/
├── README.md                 this file — checklist + where to put what
├── blog-post.md              ~600-word technical announcement. Good for
│                             dev.to, Medium, or the GitHub Pages landing.
├── obs-recording-guide.md    step-by-step for the demo video using OBS
└── social/
    ├── twitter-thread.md     5-tweet thread for X
    ├── linkedin-post.md      single-paragraph LinkedIn post
    └── reddit-showhn.md      Reddit + Hacker News Show HN templates
```

## Launch-day checklist

Run this top-to-bottom. Each step is ~5-15 minutes.

### Pre-launch (do once, before posting anything)

- [ ] **Double-check `README.md`** is the version you want strangers to land on. Screenshots embedded, install instructions clear, the "Windows-only" line is visible above the fold.
- [ ] **Confirm the `v0.3.0` release is visible** on GitHub — `gh release view v0.3.0` or browse to `github.com/benfrancisburns-creator/terminal-talk/releases/tag/v0.3.0`. If the auto-release didn't fire on tag push, run `gh release create v0.3.0 --notes-from-tag`.
- [ ] **Record the demo video** — follow `launch/obs-recording-guide.md`. Target 60-90 seconds.
- [ ] **Upload the video** to YouTube (unlisted first, so you can share it everywhere before flipping public). Grab the link.
- [ ] **Swap YouTube link placeholders** in `blog-post.md`, `twitter-thread.md`, `linkedin-post.md`, `reddit-showhn.md`. Find `<YOUTUBE_URL>` and replace.

### Post order — fastest first

1. **GitHub release description** — paste `blog-post.md` content (or a shortened version) into the release notes. Auto-generated from the tag message is a fine fallback.
2. **Twitter/X thread** — `social/twitter-thread.md`. 5 tweets, ~280 char each, embed the video in tweet 1.
3. **Hacker News — Show HN** — `social/reddit-showhn.md` (HN section). Title format: `Show HN: Terminal Talk – Claude Code responses, read aloud (Windows, free)`. Post 9-11 AM GMT weekday for best visibility.
4. **LinkedIn** — `social/linkedin-post.md`. Attach the video directly rather than linking (LinkedIn penalises outbound links).
5. **Reddit** — ONE subreddit first (`r/ClaudeAI` is the best fit). Follow `social/reddit-showhn.md`. Don't cross-post within 24 hours or you'll trip the multi-post filter. After 24h, consider `r/commandline` with a slightly different angle.

### After-launch monitoring (first 24 hours)

- [ ] **Watch `github.com/benfrancisburns-creator/terminal-talk/issues`** — any bug reports should get an acknowledgment within ~2 hours even if the fix takes longer
- [ ] **Check `gh release view v0.3.0 --json assets`** for download count
- [ ] **Reply to comments** on HN / Reddit — reply to everything in the first few hours, it's how threads build
- [ ] **If something breaks in the wild**: tag `v0.3.1` with the fix. Don't hotfix on main without a version bump — installers out in the wild will keep installing whatever `install.ps1` currently points at.

### Before-you-post honest gut-checks

- **The two D2-3 follow-ups** (kit demo audio shim + fetch-and-splice). Neither affects the product itself. But if someone reading the announcement opens the demo page and notices "it doesn't play audio" — they might ask about it in the thread. **Recommended**: ship v0.3.1 with both fixes FIRST, then launch. Budget ~45 minutes.
- **The video**. Without it, LinkedIn + Twitter engagement will be ~5× lower. Don't skip.
- **Windows-only caveat**. State it clearly in the first 100 characters of every post. You'll get "Mac port?" in every thread — have a canned response ready ("On the roadmap; priority is stability on Windows first. Contributions welcome.").

## Voice / tone

Match the commit-message style — honest, specific, no hype, no emoji spam. Examples of good moves:

- ✅ "Turns out I'd been reading 40% of Claude's output without engaging with it. Built this to listen instead."
- ✅ "Free by default — uses Microsoft Edge's neural voices (same ones the Windows read-aloud feature uses). OpenAI voices as optional paid fallback."
- ✅ "Windows only. Mac/Linux ports on the roadmap but I'm not committing a date."

Don't write:

- ❌ "Game-changing AI-powered productivity tool 🚀🤖✨"
- ❌ Fake scarcity ("limited beta", "early access")
- ❌ "Revolutionary" for anything less than a new law of physics
