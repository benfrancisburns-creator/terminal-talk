# Terminal Talk Video Storyboards

Date: 2026-05-01

This replaces the loose "rerun the old scripts" approach. The next video pass should be planned, captured, reviewed, and only then published.

Update: `docs/VIDEO_SESSION_PLAN.md` is now the preferred planning document for the new video set. This file remains useful as a record of the old-public-video defects and earlier storyboard thinking.

## Current Problems To Avoid

- User mouse movement corrupted the transcript and settings recordings.
- One session-sync recording left an idle cursor parked on screen.
- The Hey Jarvis recording cuts into narration mid-sentence.
- The overview has a silent gap around 19-29 seconds.
- The OpenAI recording captured a connectivity pop-up.
- The local command-center advert has doubled narration.
- The videos do not clearly show the collapsed toolbar flashing the speaking session colour.
- The transcript video undersells the fact that Terminal Talk keeps a log of recent clips/messages, not just a temporary audio toolbar.
- The current set does not show a real Codex session in a terminal or a real Claude Code session in a terminal.

## Capture Rules

- Use the current installed Terminal Talk toolbar for the main proof videos.
- Record in a clean Windows workspace with notifications, connectivity prompts, and unrelated apps closed.
- Do not use the physical mouse during capture. Cursor movement must be scripted or the OS cursor must be hidden while a controlled demo cursor is rendered.
- Start each video with a five-second quiet pre-roll, then trim it out after review.
- Record video and narration separately unless the clip intentionally demonstrates live audio.
- Every recording must have both WebM and MP4 outputs.
- Do not publish a file until it passes the acceptance checks in this document.

## Final Public Video Set

The landing page should lean on real-product proof:

1. `terminal-talk-overview` - real Codex and Claude sessions feeding one toolbar.
2. `terminal-talk-queue-jarvis` - highlighted text becomes a priority J clip.
3. `terminal-talk-settings-sessions` - current settings and per-session controls.
4. `terminal-talk-session-sync-controls` - collapsed letterbox, identity, focus, mute, and terminal labels.
5. `terminal-talk-transcript-spoken-original` - recent log/transcript review with Spoken and Original views.
6. `terminal-talk-openai-api-key` - paid OpenAI routing, key status, fallback, and test voice.

Marketing/supporting cuts:

7. `terminal-talk-command-center-ad` - short polished product story.
8. `terminal-talk-local-command-center-ad` - optional only; fix doubled narration or remove from the landing page.
9. `terminal-talk-user-hero` - optional feature hero; use only if it adds something beyond the overview.

## 1. `terminal-talk-overview`

Purpose: prove the real installed toolbar reads real assistant sessions from terminals.

Layout:

- Left: two real terminal panes, one running Codex and one running Claude Code.
- Right or top: the current installed Terminal Talk toolbar, not a mock.
- Keep the toolbar small enough that the desktop still looks usable.

Shot order:

1. Show Terminal Talk already running in its compact toolbar state.
2. Show a real terminal in `C:\Users\Ben\Desktop\terminal-talk` running `codex`.
3. Send a short prompt that produces a small response, for example: "summarise what Terminal Talk does in one sentence".
4. Show the Codex response arrive in the toolbar as a normal assistant clip with the mascot, not J.
5. Show a real Claude Code terminal and send a similarly small prompt.
6. Show Claude and Codex clips together in the same dot strip, with different session colours.
7. Let the toolbar auto-collapse.
8. Drop or wait for a new clip while collapsed; the slim letterbox must flash the speaking session colour without expanding over the desktop.
9. Re-open the toolbar and show the tabs/dots still identify which terminal spoke.

Must show:

- Real Codex terminal.
- Real Claude Code terminal.
- Current installed toolbar.
- Mascot for assistant response clips.
- Shared queue/dot strip.
- Collapsed letterbox highlighting the speaking session colour.

Reject if:

- There is a silent gap longer than 2 seconds during narration.
- J appears for assistant response clips.
- The toolbar expands over the desktop when the collapsed highlight is the feature being shown.
- The clip does not include both Codex and Claude Code.

## 2. `terminal-talk-queue-jarvis`

Purpose: show highlighted text becoming a priority J clip.

Layout:

- Left: a real app with selectable text, preferably a terminal or editor note.
- Right/top: current installed toolbar.

Shot order:

1. Show a normal assistant response clip already queued, using the mascot.
2. Highlight a short block of text in the terminal/editor.
3. Trigger Hey Jarvis or `Ctrl+Shift+S`.
4. Show the new clip landing as a J clip.
5. Show the J clip jumping ahead of pending normal clips.
6. Open the transcript panel and show the highlighted text saved as a recent log entry.
7. End with the J clip visible in the strip and the transcript row visible.

Must show:

- The selected text before the clip is created.
- The J identity only for highlight-to-speak.
- Priority ordering.
- Transcript/log entry for the spoken text.

Reject if:

- Narration starts mid-sentence.
- Assistant response clips use J.
- The highlighted text is not visible long enough to read.
- The clip cuts before the priority behaviour is obvious.

## 3. `terminal-talk-settings-sessions`

Purpose: show the current configuration surface clearly.

Layout:

- Real installed toolbar with settings open.
- The settings panel must be large and readable.
- A terminal can sit in the background, but settings are the subject.

Shot order:

1. Open settings from the real gear button.
2. Playback section:
   - speed
   - master volume
   - auto-collapse delay
   - auto-prune body clips and seconds input
   - explain that tool narration and heartbeat clips remain ambient and delete quickly
   - auto-continue after clicking
   - colour-blind palette
   - heartbeat narration
   - tool-call narration
3. OpenAI section:
   - key status
   - primary provider toggle
   - fallback provider toggle
   - test voice button
4. Shortcuts section:
   - show editable global accelerator fields
   - show reset defaults
5. Sessions section:
   - rename one session
   - change colour using the real dropdown
   - focus star
   - mute button
   - expand row
   - per-session voice dropdown
   - heartbeat override
   - speech includes grid
6. End on the expanded session row.

Must show:

- Auto-collapse and auto-prune as separate controls.
- OpenAI fallback as paid opt-in, not automatic.
- Global shortcuts.
- Per-session voice, heartbeat override, and speech includes.

Reject if:

- User mouse appears unexpectedly.
- The cursor idles away from the feature being narrated.
- The recording is interrupted by any external pop-up.
- Volume slider and readout disagree.

## 4. `terminal-talk-session-sync-controls`

Purpose: show how Terminal Talk makes multiple sessions identifiable while staying minimal.

Layout:

- Two real terminal panes plus the installed toolbar.
- Settings may open briefly for session controls, but the central proof is the compact/collapsed toolbar.

Shot order:

1. Show two terminal sessions with readable labels: `Codex demo` and `Claude docs`.
2. Show the toolbar dot strip with different colours for each session.
3. Show session tabs and unread counts.
4. Let the toolbar collapse.
5. Trigger a Codex clip; the collapsed bar flashes the Codex colour.
6. Trigger a Claude clip; the collapsed bar flashes the Claude colour.
7. Open settings to the Sessions area.
8. Change a session label or colour and show it reflected in the terminal/title/status identity surface.
9. Focus one session and show its next clip taking priority.
10. Mute the other session and show that it stops producing visible/audio clips.

Must show:

- Minimal collapsed toolbar.
- Colour flash by speaking terminal.
- Session labels/colours tied to real terminal identity.
- Focus and mute behaviour.

Reject if:

- The OS cursor sits idle over the video.
- The recording does not include the collapsed highlight.
- The terminal identity is fake or disconnected from the toolbar session row.

## 5. `terminal-talk-transcript-spoken-original`

Purpose: show Terminal Talk as a recent-message log, not just an audio widget.

Layout:

- Current toolbar with transcript panel open.
- A terminal/editor source on the side for original Markdown examples.

Shot order:

1. Queue or generate at least ten recent clips from two sessions.
2. Open the transcript/log panel.
3. Show the list of recent messages, scoped by the selected session tab.
4. Show a response with cleaned spoken text.
5. Toggle to Original and show the original Markdown/source.
6. Show a table example where Spoken is summarised instead of read raw.
7. Show a numbered/list example where speech keeps useful numbering.
8. Show copy button behaviour.
9. Switch session tabs and return to All.

Must show:

- Recent transcript/log list.
- Around ten recent entries if the UI supports it in the viewport.
- Spoken/Original toggle.
- Original source that differs from spoken text.
- Session filtering.

Reject if:

- User mouse movement interrupts the recording.
- The transcript is shown only as a one-row afterthought.
- The video says "logs" without showing the log/recent-message list.

## 6. `terminal-talk-openai-api-key`

Purpose: explain paid OpenAI routing without making it look required.

Layout:

- Settings panel open to OpenAI.
- No browser, connectivity, or billing pop-ups on screen.

Shot order:

1. Start with Edge/free route as the default.
2. Show the API key status row.
3. Show save/change/clear key state without exposing the key.
4. Toggle "Use OpenAI as primary" on and back off.
5. Toggle "Use OpenAI as fallback" on and back off.
6. Point out fallback is paid opt-in; when off, Edge remains fallback.
7. Use Test voice to create a normal test clip in the toolbar.
8. End with OpenAI primary/fallback back in the intended safe default state.

Must show:

- Edge default.
- Primary and fallback are separate.
- Fallback is paid opt-in.
- Test voice path.

Reject if:

- Any connectivity or notification window appears.
- An API key is visible.
- The final state leaves paid fallback on unintentionally.

## 7. `terminal-talk-command-center-ad`

Purpose: polished high-level product story, not proof of functionality.

Shot order:

1. "One spoken queue for Claude Code and Codex."
2. "Session identity follows the work."
3. "Collapsed toolbar stays out of the way."
4. "Settings control playback, shortcuts, voices, fallback, and transcripts."
5. End on the product name.

Must show:

- No doubled narration.
- Captions match narration.
- It supports, but does not replace, the real toolbar videos.

## 8. `terminal-talk-local-command-center-ad`

Decision: keep only if the doubled narration is fixed and the cut adds a different angle from the main advert.

If kept, it must:

- Use either dialogue or narrator, not both overlapping unintentionally.
- Avoid long lines that overflow subtitles.
- Mention real current features: session identity, collapsed toolbar, shortcuts, OpenAI fallback, transcript logs.

Reject if:

- Dialogue overlaps itself.
- The cut feels less clear than the real product videos.

## 9. `terminal-talk-user-hero`

Decision: optional. Use only if there is a clear hero-placement need.

If kept, it should be short:

1. Product name.
2. Real toolbar or command-center visual.
3. One sentence: "Claude Code and Codex feed one spoken queue."
4. One sentence: "Collapsed colour flashes show which terminal is talking."
5. End.

Reject if:

- It repeats the overview without adding a better first impression.
- It replaces real product footage on the landing page.

## Review Checklist Before Publishing

- Watch the full WebM and MP4.
- Check there are no external pop-ups.
- Check the cursor is either scripted and intentional or hidden.
- Check narration starts cleanly and does not cut mid-sentence.
- Check there are no unexplained silent sections longer than 2 seconds.
- Check assistant response clips use the mascot.
- Check Hey Jarvis clips use J.
- Check collapsed toolbar colour flash is visible in at least two videos.
- Check at least one real Codex terminal is visible.
- Check at least one real Claude Code terminal is visible.
- Check transcript/log video shows a meaningful recent-message list.
- Check the landing page cache key is updated only after all files pass review.
