# OBS recording guide — Terminal Talk launch demo

A step-by-step for producing a 60–90 second demo video using OBS Studio. No prior OBS experience assumed.

**Target output:**
- MP4, 1080p (1920 × 1080), 30 fps
- 60–90 seconds long
- Spoken narration + real toolbar audio
- Captions (generated after recording)
- File under 100 MB for easy upload

**Total time:** ~45 minutes for the full workflow — 10 min setup, 15 min dry-run, 5 min recording, 15 min trim + caption + export.

---

## 1. One-time OBS setup (10 minutes)

Open OBS Studio. First launch it'll offer an auto-config wizard — **accept defaults for streaming/recording, pick "optimise for recording"**. Then:

### Settings → Output

- **Output Mode:** `Advanced`
- **Recording tab:**
  - **Recording Path:** `C:/Users/Ben/Videos/TerminalTalk` (create the folder first)
  - **Recording Format:** `mkv` (safer against crashes — will remux to mp4 after). If your version offers mp4 with "mkv safety" toggle, mp4 is fine.
  - **Encoder:** NVIDIA NVENC H.264 if you have an NVIDIA GPU. Otherwise `x264`.
  - **Rate Control:** `CQP`
  - **CQ Level:** `20` (lower = higher quality; 20 is near-visually-lossless for screen content)
  - **Keyframe Interval:** `2`
  - **Preset:** `Quality` (NVENC) or `veryfast` (x264)
  - **Profile:** `high`
- **Apply** → **OK**

### Settings → Video

- **Base (Canvas) Resolution:** `1920 × 1080`
- **Output (Scaled) Resolution:** `1920 × 1080` (match canvas for best quality)
- **Downscale Filter:** `Lanczos (Sharpened scaling, 32 samples)`
- **Common FPS Values:** `30` (60 is only worth it for games — doubles file size for no gain on a desktop demo)

### Settings → Audio

- **Sample Rate:** `48 kHz`
- **Desktop Audio:** your default speakers/headphones (so Terminal Talk's voice gets captured)
- **Mic/Auxiliary Audio:** your actual microphone (so your narration gets captured)

### Settings → Hotkeys (optional but strongly recommended)

Set hotkeys for:
- **Start/Stop Recording:** `Ctrl+F9` (avoids clicking OBS during the demo)
- **Start/Stop Replay Buffer:** `Ctrl+F10` (optional but useful if you want to grab highlights)

**Apply → OK.**

---

## 2. Scene setup (5 minutes)

OBS uses **Scenes** (your shot layouts) containing **Sources** (capture inputs). For a software demo you want **one scene** with three sources.

### Create the scene

1. Bottom-left **Scenes** panel → `+` → call it `Terminal Talk Demo`
2. With the scene selected, the **Sources** panel (to its right) is empty. You'll add three things.

### Source 1 — Display Capture (your whole screen)

1. **Sources +** → **Display Capture** → name `Main Display` → OK.
2. Select your primary monitor → OK.
3. You should see your desktop inside the OBS preview.

### Source 2 — Microphone (your voice)

Already wired via **Settings → Audio → Mic/Aux** above. Confirm in the **Audio Mixer** at the bottom of the OBS window — you should see two green/yellow bars:
- `Desktop Audio` (Terminal Talk's voice + any other system sound)
- `Mic/Aux` (your voice)

### Source 3 — Webcam overlay (optional)

Skip unless you want a talking-head corner. If yes:
1. **Sources +** → **Video Capture Device** → pick your webcam → OK.
2. In the preview, drag the webcam box to the bottom-right corner. Hold `Alt` while dragging a corner handle to crop it to a clean circle/square.
3. Apply a **Filter** → **Color Correction** → slight contrast bump, saturation -5.

### Test levels

In the Audio Mixer, **right-click** each source → **Filters** → add:
- **Noise Suppression (RNNoise)** on the Mic — kills keyboard + fan noise
- **Compressor** on the Mic — ratio 3:1, threshold -18 dB, so your volume stays steady whether you lean in or pull back
- **Gain** on the Mic if needed — bump so the yellow bar peaks around -6 dB when you talk normally

Same for Desktop Audio — leave Compressor + Gain off; Terminal Talk's output is already level-mastered.

---

## 3. Pre-record dry run (15 minutes)

Before hitting record, rehearse the demo 2-3 times. You'll find what doesn't work in your script on the first run.

### Prep your desktop

- **Close every distraction** — Slack, email, Discord notifications. Windows notification toggle: `Win+A` → focus assist → "Alarms only".
- **Hide sensitive tabs** in every browser window (bank, personal email, anything).
- **Clear Terminal Talk state** — delete `~/.terminal-talk/queue/*.mp3` so the dot strip starts empty.
- **Open one Claude Code terminal** that's session-coloured the way you want on camera (green for "hero" shot usually).

### Script outline (90 seconds)

Time each section. Rehearse until you hit these marks within ±5s.

| Time | Scene | Voiceover |
|---|---|---|
| 0:00 – 0:08 | Empty desktop + idle Terminal Talk toolbar | "This is Terminal Talk. Runs on Windows. Reads Claude Code's responses out loud while I work." |
| 0:08 – 0:25 | Type a prompt into Claude Code; Claude responds; **audio kicks in ~2-3s after Claude starts** | "I ask Claude to explain something — and instead of reading it, I listen. Audio starts while Claude's still talking, so by the time it's done explaining, I've already heard the first half." |
| 0:25 – 0:40 | Highlight a paragraph in a browser tab; say **"hey jarvis"** on camera → toolbar speaks the highlighted text | "I can highlight text anywhere — this is a random Wikipedia paragraph — say 'hey jarvis', and it reads. Ctrl+Shift+S does the same if you'd rather not talk to your laptop." |
| 0:40 – 0:55 | Open a second Claude Code terminal (different colour). Switch to it, send a message. **Both voices heard back-to-back.** | "Running multiple agents? Each gets its own voice. I can tell by ear which one's saying what without tab-switching." |
| 0:55 – 1:10 | Click the gear icon → settings panel opens. Point at **mute / focus / voice** columns. Mute one session. | "Every session has its own mute, its own focus flag — star one and it jumps the queue. 47 free voices, or paid OpenAI fallback if you want those." |
| 1:10 – 1:25 | Close the panel. Toolbar collapses to thin strip after 15s. **Hover → expands back.** | "After 15 seconds of inactivity it collapses to a click-through strip so it's never in the way. Hover to bring it back." |
| 1:25 – 1:30 | Fade to card: repo URL + "MIT · Windows · v0.3.0" | "Windows, free, open source. Link in the description." |

**Critical:** at 0:08 and 0:40, you need Claude Code to actually respond on cue. Rehearse the prompts so you know what's likely to trigger a multi-sentence response. Short "explain X in 3 bullet points" prompts are reliable.

### Dry-run checklist

- [ ] Terminal Talk audio levels — not too loud, not drowning your voiceover
- [ ] Mic levels — `-6 dB` peak when you talk at normal volume
- [ ] No notifications popping up
- [ ] Taskbar doesn't show anything embarrassing
- [ ] Cursor isn't distracting (consider hiding it for stretches — see tips below)
- [ ] Wake-word works reliably for the "hey jarvis" segment

---

## 4. Record (5 minutes)

- **Start Recording** (Ctrl+F9 if you set the hotkey).
- Count to 3 silently so there's a buffer at the start you can trim later.
- Run through your rehearsed script. Don't panic if you stumble — keep going, you'll cut it.
- **Stop Recording** (Ctrl+F9 again) when you've finished. Don't stop during the fade-out; leave a couple of seconds of silence for a clean trailing cut.

The file lands in your recording folder as `<timestamp>.mkv` (or `.mp4`).

### If you mess up (common)

Record 2-3 takes. 90 seconds each. You'll edit together the best segments in the next step. Don't try to get it perfect in one take — it'll sound stilted.

---

## 5. Edit + export (15 minutes)

### Option A — OBS built-in remux (minimal editing)

If your single take is clean:
1. **OBS → File → Remux Recordings** → pick the mkv → remux to mp4.
2. Trim front/back in any lightweight tool:
   - **Windows Photos → Edit → Trim** (free, comes with Windows)
   - **Clipchamp** (free, comes with Windows 11)
3. Done.

### Option B — DaVinci Resolve (free, proper editing)

Download from blackmagicdesign.com. Learning curve ~30 min one-time; after that everything below is 10 minutes.

1. **File → Import Media** → your mkv
2. Drag onto the timeline
3. Trim the dead air at head and tail with `B` (blade tool) and delete the off-cuts
4. **Effects → Transitions → Dissolve (1s)** at head + tail
5. **Color** page → slight saturation boost if the desktop looks washed out
6. **Deliver** page → preset **YouTube 1080p** → Render

Output file: ~30-60 MB for 90 seconds at 1080p30. Good to upload.

### Captions

Either:
- **YouTube auto-captions** (free, ~90% accurate; you edit the 10% that's wrong in the YouTube Studio → Subtitles editor, 5 min).
- **Clipchamp → Auto-captions** (built in, same idea).
- **Descript** (paid, $20/mo one-off; cleanest of the bunch if you do this often).

Captions matter — 75% of LinkedIn and 85% of Twitter video views happen without sound. A demo without captions gets skipped.

---

## 6. Upload + publish (10 minutes)

### YouTube (primary host)

1. studio.youtube.com → **Create → Upload video** → drag in the mp4
2. **Title:** `Terminal Talk — Claude Code responses, read aloud`
3. **Description:** paste the repo URL + a 2-line summary. Link to the v0.3.0 release in the repo.
4. **Visibility:** **Unlisted** for now. Flip to Public once you've tested the link by pasting it into your planned social posts.
5. **Thumbnail:** grab a clean frame from around 0:10 showing the toolbar + code on screen.

### Second copy for LinkedIn

LinkedIn downweights outbound YouTube links. Upload a separate copy of the mp4 directly to your LinkedIn post. Same mp4 file, uploaded twice.

---

## 7. Troubleshooting

### "Audio isn't being captured"

- **Desktop audio silent:** OBS can't capture audio from apps that hold an exclusive audio session. Fix: Windows Settings → System → Sound → App volume and device preferences → set "Default" for all of them.
- **Mic silent:** OBS → Settings → Audio → Mic/Aux shows "Disabled"? Change to the actual device. Check the physical mic mute button on headset.
- **Both capturing but mic too quiet:** Filters → Gain on the mic source → +12 dB. Re-check the mixer bar.

### "Display capture is black"

- Happens on NVIDIA laptops when OBS is running on integrated GPU and the target app on NVIDIA.
- Fix: Right-click OBS shortcut → Run with graphics processor → NVIDIA.

### "Recording stutters / dropped frames"

- Stats panel: **View → Stats**. If "Dropped frames" > 0.5%, your encoder is overloaded.
- Drop output resolution to 1280 × 720 and re-test — 720p is perfectly fine for LinkedIn/Twitter.
- Or switch encoder: NVENC if you have NVIDIA, else x264 with `veryfast` preset.

### "The wake-word doesn't fire on camera but worked in rehearsal"

- Mic gain too low (you're speaking more quietly on camera because you're nervous).
- Environmental change — a fan came on, or you're in a different room than rehearsal.
- Fix in edit: record the wake-word segment separately, voice-over the "hey jarvis" moment, cut to the toolbar reacting. Viewers can't tell.

---

## Final checklist before you hit publish

- [ ] Captions on the video and reviewed for typos
- [ ] Thumbnail doesn't show any sensitive info
- [ ] Video URL pasted into each of the launch posts (`<YOUTUBE_URL>` placeholders)
- [ ] Video is set to **Public** on YouTube (not unlisted) — unlisted videos don't embed properly in LinkedIn / Reddit
- [ ] Test: paste the URL into your own X draft, confirm the video preview loads correctly before posting
- [ ] Description includes repo URL and install one-liner

Good luck. Your first demo video won't be perfect — your tenth will be. Publish anyway.
