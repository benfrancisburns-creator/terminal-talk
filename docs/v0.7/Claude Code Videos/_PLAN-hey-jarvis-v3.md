# Hey-Jarvis demo v3 — plan for sign-off

Single feature: **highlight any text → "hey jarvis" / Ctrl+Shift+S → toolbar reads it.**

This document is the contract. Once Ben signs off, the build follows it
exactly. If anything in here looks wrong, that's the moment to push back —
not after a 40-second recording.

> **Update history**
> - v3.1 — Ben's correction: clips WERE visible in v2; the real problem was
>   the toolbar was in **collapsed state** (skinny letterbox at top, cropped
>   at bottom). Reference shot: Image #6 — the EXPANDED toolbar with
>   transcript panel showing actual clip text. v3 must capture THAT state.
> - v3.1 — narrative simplified per Ben: highlight a body of text, narrate
>   what we're doing, say "hey jarvis", clip auto-plays.

## What was actually wrong with v2

| v2 problem | Root cause | Fix in v3 |
|---|---|---|
| Toolbar shows only the **collapsed strip** — playback controls + tabs + dotstrip — with skinny black letterbox above and cut-off below | Demo home boots with `panels.transcript_expanded = false`, so the toolbar never opens to its full height | **Pre-set `panels.transcript_expanded = true`** in config so the toolbar boots in the expanded state shown in image #6 |
| Even if the panel WAS open, it would have no content to show | Pre-seed only drops clips DURING the recording, so the transcript panel is empty for the first ~10s | **Pre-seed 5–6 already-played clips with substantive text in their `.txt` + `.original.txt` sidecars** so the transcript panel has lived-in content from frame 0 |
| Wrong folder name: `mateain` instead of `terminal-talk` | Copy-paste error | Stage prompt fixed to `PS C:\\projects\\terminal-talk>` |
| Cursor **drifts in empty toolbar space** rather than landing on real targets | I used estimated offsets (`+320 +92`) instead of measured pixel positions | **Measure real coords** from a calibration screenshot taken once with the EXPANDED toolbar visible, paste the rects into the script |
| Selection-highlight effect is subtle, easy to miss | One-shot CSS class swap, no animation, no synced cursor drag | **Animated selection sweep** (`width: 0 → 100%` over ~1.2s) with cursor drag at the same speed |
| Cursor too small in capture | Windows default cursor at 1080p is ~32px, gets compressed by webm | Set Windows cursor to **size 3 (large)** programmatically before recording, restore after |
| Recorder windows + post-crop accidentally clipped the toolbar's bottom too | Post-crop took 60px off the whole frame; toolbar bottom was inside that strip | Toolbar lives at y=80 to y=720 (640px tall in expanded mode) — well clear of the y=1020 crop line |

## Layout — fixed pixel rectangles (sign off these dimensions)

Recording resolution: **1920 × 1080** (cropped to **1920 × 1020** post for taskbar trim only).

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Wallpaper backdrop — terminal-talk-wallpaper-bg.jpg (no mascot)          │
│                                                                          │
│ ┌─ Fake terminal card ──────────────┐  ┌─ Real toolbar (EXPANDED) ────┐  │
│ │ ● ● ● Claude Code — terminal-talk │  │ ⏪ ⏸ ⏩  ──●────  🐙 0:03/0:03 ⚙ ✕│
│ │                                   │  │ [All 1]  [Claude Co. 1]      │  │
│ │ PS C:\projects\terminal-talk>     │  │ ●●●●●●●●  (clips lit/faded)  │  │
│ │   claude "hey what should i ship  │  │                              │  │
│ │   in v0.7"                        │  │ ▼ Transcript        [Spoken] │  │
│ │                                   │  │  Reading audio-player.js     │  │
│ │ Three things land cleanly:        │  │  Searching for system auto…  │  │
│ │ markdown tables get a speakable   │  │  Edit to handle mic captured │  │
│ │ summary; bash pipelines say what  │  │  Running the tests, then …   │  │
│ │ they do; and edits speak the      │  │  Table with 3 rows. …        │  │
│ │ enclosing function name.          │  │                              │  │
│ │                                   │  │                              │  │
│ └───────────────────────────────────┘  └──────────────────────────────┘  │
│                                                                          │
│ ▼ chip footer: highlight any text · press Ctrl+Shift+S · or say hey…    │
└──────────────────────────────────────────────────────────────────────────┘
   ↑ Stage card (left)                  ↑ EXPANDED toolbar (right)
   x: 80, y: 120                        x: 1080, y: 80
   width: 920, height: 760              width: 760, height: 720
```

**Cursor anchors (measured from calibration screenshot, not guessed):**
- `text_start` — first char of "Three things land cleanly" line
- `text_end`   — last char of the paragraph
- `dotstrip`   — dead centre of the toolbar's dot strip
- `transcript_top` — first row of the transcript panel
- `chevron`    — Spoken / Original toggle

## Pre-seed — toolbar's starting state

Critical for the toolbar to boot looking like image #6.

**Config tweaks:**
- `panels.transcript_expanded = true`  ← drives the expanded toolbar height
- `panels.transcript_view = "spoken"`
- `tabs_expanded = true`
- One pinned session "Claude Co." with focus + a coloured palette

**5 already-played clips dropped into the queue with substantive text:**

| # | spoken (.txt) | original (.original.txt) |
|---|---|---|
| 1 | "Reading audio-player.js" | (same — short clip) |
| 2 | "Searching for system auto pause — found 14 matches." | (same) |
| 3 | "Edit to handle mic captured. Around line 670." | "Around line 670, function `handleMicCaptured`. Plus a 3-line addition for the systemAutoPaused split." |
| 4 | "Running the tests, then counting matches." | "`node scripts/run-tests.cjs \| grep PASS \| wc -l` — runs the suite then pipes through grep then counts." |
| 5 | "Table with 3 rows. Columns: file, line, today, with Phase 3 v2." | "\| File \| Line \| Today \| With Phase 3 v2 \|\n\|---\|---\|---\|---\|\n\| sentence_group.py \| 87 \| around line 87 \| to flush \|\n…" |

mtimes: all in the last ~5 minutes so they sort newest-first; all before recording starts so dots show as "played" (faded).

## The narrative (per Ben — simpler)

1. We have a body of text on the left.
2. Narrator describes what's happening (one-line setup).
3. The text gets highlighted (cursor + selection sweep).
4. Narrator: "Just say hey jarvis."
5. The J-clip auto-plays the highlighted text through the toolbar.
6. The new entry lands at the top of the transcript panel.
7. End on the lived-in toolbar showing the new clip there.

## Shot-by-shot timeline

Total length: **~28 seconds**. Tight.

| t (s) | Visual state | Cursor | Audio |
|---|---|---|---|
| 0.0 | Stage + EXPANDED toolbar already showing 5 prior clips in transcript panel; dot strip with 5 faded pips | off-screen | (silent) |
| 0.8 | Same | slides in to `text_start` | (silent) |
| 1.5 | Stage card visible | parked on `text_start` | "You can have Terminal Talk read any text aloud, in any application." |
| 5.5 | Selection sweeps L→R across paragraph (animated) | drags from `text_start` → `text_end` over 1.5s, synced to selection growth | (continues) |
| 7.5 | Both lines fully selected with blue `.sel` highlight | parked on `text_end` | "Just say hey jarvis." |
| 9.5 | (silent beat — anticipation) | slides to `dotstrip` BEFORE the J-pip lands | (silent, ~600ms) |
| 10.5 | Blue J-pip lights in dot strip; mascot animates orange | parked on the new pip | **J-clip plays the highlighted content** (~7s of audio): "Three things land cleanly: markdown tables get a speakable summary; bash pipelines say what they do; and edits speak the enclosing function name." |
| 17.5 | J-pip dims to "played"; transcript panel auto-prepends the new entry | slides up to `transcript_top` BEFORE the new line lands | (silent, ~700ms) |
| 18.5 | Transcript shows the new clip text at the top | parked on the new transcript row | "Every clip lands in the transcript panel — copyable, with the original markdown beside it." |
| 23.0 | Click chevron → flips to "Original" view | clicks `chevron`, ripple at click | (silent — visual only) |
| 24.0 | Transcript shows original markdown source | parked on the new line | "Hands-free reading. Anywhere on Windows." |
| 28.0 | END — final still: full expanded toolbar with new entry highlighted | off-screen | (silent) |

## Production notes

- **Recording**: visible Electron stage + real toolbar, captured via `desktopCapturer`. Toolbar must be in shot. Ben leaves screen alone for ~30s.
- **Resolution**: 1920×1080 capture, post-cropped to 1920×1020 (taskbar trim only). Toolbar y-range 80→720 stays clear.
- **Audio**: 5 narration clips via edge-tts en-GB-RyanNeural. The "content" J-clip uses the same voice — Terminal Talk has one voice per session.
- **Cursor**: Windows scheme bumped to size 3 (large) before recording, restored after. Cubic ease-out via P/Invoke `SetCursorPos`.
- **Selection sweep**: stage HTML uses a `<span class="sel-target">` wrapping the paragraph; a `<span class="sel-mask">` overlay with `width: 0` animates to `width: 100%` over 1200ms with a `linear` curve so it matches the cursor drag.
- **Calibration step**: before the run, I open the toolbar with the seeded home + transcript expanded, take a screenshot, identify exact pixel coords for the 5 cursor anchors, paste them into the script. **Calibration is a separate first step — Ben sees the screenshot before any recording.**

## Open questions (just need a yes / no / answer)

1. **Path string** — `PS C:\projects\terminal-talk>` ok?
2. **Content text** — keep "Three things land cleanly: markdown tables… bash pipelines… edits speak the function name" (terminal-talk-flavoured, ties into v0.6 work)? Or different copy?
3. **Pre-seed transcript** — five entries above (Reading / Searching / Edit / Running tests / Table summary) — fine, or different ones?
4. **End frame** — current plan: hold on the expanded toolbar with the new clip at the top of the transcript. Alt: cursor returns to the now-faded J-pip, panel auto-collapses.
5. **Speech rate** — +5% (brisk) or +0% (natural)?
6. **Total length** — 28s ok, or shorter / longer?

## Build sequence after sign-off

1. **Calibration**: launch the seeded toolbar, freeze for 2s, screenshot the toolbar rect. Show Ben. Confirm anchors look right.
2. Pre-render the 5 narration clips.
3. Build the seeded demo home (config + .mp3 + .txt + .original.txt sidecars for the 5 prior clips).
4. Run the recorder ("recording in 5s, leave the screen alone for ~30s").
5. Post-crop. Save to `docs/Claude Code Videos/hey-jarvis-v3.webm`.
6. Extract 4 keyframes, sanity-check the layout, hand to Ben.
