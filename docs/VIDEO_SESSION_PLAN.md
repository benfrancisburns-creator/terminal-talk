# Terminal Talk Video Session Plan

Date: 2026-05-02

This is the working plan for a new video set. It is not constrained by the old public video filenames. The point is to show the product clearly, with real workflows, and avoid recording anything until each session has a known setup, shot list, and pass/fail checks.

## Overall Strategy

Record one coherent master proof first, then cut shorter chapter videos from it.

1. Make a long-form master capture where Terminal Talk explains, then action proves the point on screen.
2. Show Terminal Talk creating real Claude Code and Codex terminals from Settings.
3. Prompt all four terminals with substantial visible prompts so the terminals narrate the demo themselves.
4. Show four real assistant sessions feeding one toolbar while retaining separate session identities.
5. Show the minimal collapsed toolbar state and session-colour flash.
6. Show Jarvis as the fast free "read this text" feature.
7. Show transcript/logs as the durable record of what was spoken.
8. Show sessions/settings, premium/OpenAI, and advanced narration after the product proof is established.
9. Export shorter videos from the master using `docs/video-narration/master-demo-chapters.json` and `scripts/export-video-chapters.ps1`.

Page Harvest is parked in `docs/PAGE_HARVEST_CONCEPT.md` and should not be included in this recording pass unless the feature is actually implemented.

## Master Capture First

The preferred production pass is now:

- Record a single long-form master, potentially 30 minutes if the product story needs that space.
- Add a clear intro and chapter section in the recording.
- Use Terminal Talk narration and real terminal responses throughout.
- Keep the sequence relaxed enough to sell the product: explain a control, show the control, trigger action, then let Terminal Talk speak the proof.
- After review, adjust `docs/video-narration/master-demo-chapters.json`.
- Run `scripts/export-video-chapters.ps1` to create the shorter cuts.

Supporting files:

- `docs/video-narration/master-demo-outline.md`
- `docs/video-narration/master-demo-prompts.md`
- `docs/video-narration/master-demo-chapters.json`

## Proposed Final Set

### 1. Create Sessions: Four Terminals, One Toolbar

Purpose: prove Terminal Talk can create and track real Claude Code and real Codex sessions from its own Settings panel, then use those terminals as the narration source for the video.

Primary message:

Terminal Talk launches Claude Code and Codex into project terminals, then keeps their responses in one toolbar while preserving separate colours, labels, voices, queues, transcript entries, and collapsed-state colour flashes.

Needs:

- Terminal Talk running from the installed toolbar.
- The new Settings -> Sessions -> Create session form available.
- No duplicate or stale Claude/Codex demo terminals on any recorded screen.
- A harmless project folder selected for both launches, preferably `C:\Users\Ben\Desktop\terminal-talk`.
- Terminal-read cue files prepared in `docs/video-narration/`.
- Short cue prompts prepared in `docs/video-narration/operator-cue-sheet.md`.
- User available to confirm authentication/permission prompts if either CLI asks.

Suggested layout:

- Capture spans two monitors as one recording region.
- Terminal screen: four Windows Terminal windows in quadrants.
  - Top-left: `Claude TT A`
  - Top-right: `Codex TT A`
  - Bottom-left: `Claude TT B`
  - Bottom-right: `Codex TT B`
- Toolbar screen: Terminal Talk collapsed at first, then expanded, then Settings open to Sessions.
- Screen should be clean, with no browser/connectivity overlays or old demo windows.
- No helper-created assistant terminals should appear before the Settings `Create` button is clicked.

Opening state for recording:

- Recording starts with Terminal Talk collapsed on the toolbar screen and no demo terminals visible on the terminal screen.
- Hover the toolbar to show its resting state.
- Open Settings with the cog, then click the `Sessions` tab.
- The `Create session` form is visible before the first terminal is launched.
- All old demo/practice terminal windows are closed before recording starts.
- The normal toolbar registry is acceptable for product footage, but old stale sessions should be removed or clearly inactive.
- If a clean video-state runtime is used, restore the user's normal runtime state after the recording pass.

Create session defaults for the take:

- Claude A:
  - Assistant: `Claude Code`
  - Permissions: `Default` or `Dangerously skip permissions` only if that is the intended demo mode.
  - Project folder: `C:\Users\Ben\Desktop\terminal-talk`
  - Label: `Claude TT A`
  - Colour: blue or another clear non-Codex colour.
- Codex A:
  - Assistant: `Codex`
  - Permissions: `Default` or `Dangerously bypass approvals and sandbox` only if that is the intended demo mode.
  - Project folder: `C:\Users\Ben\Desktop\terminal-talk`
  - Label: `Codex TT A`
  - Colour: magenta or another clear non-Claude colour.
- Claude B:
  - Assistant: `Claude Code`
  - Project folder: `C:\Users\Ben\Desktop\terminal-talk`
  - Label: `Claude TT B`
  - Colour: brown/orange or another distinct colour.
- Codex B:
  - Assistant: `Codex`
  - Project folder: `C:\Users\Ben\Desktop\terminal-talk`
  - Label: `Codex TT B`
  - Colour: white or another distinct colour.
- Use `Save default` before the recorded take if we want the form to prefill cleanly.
- Narration should call this "Create session", not "creator_session".

Window placement rule:

- Terminals must be launched by clicking Terminal Talk's `Create` button.
- Use deterministic Windows Terminal placement for the recording pass:
  - `TT_CREATE_SESSION_WINDOW_POS`
  - `TT_CREATE_SESSION_WINDOW_SIZE`
  - `TT_CREATE_SESSION_WINDOW_BOUNDS`
- If Windows Terminal opens in the wrong place, move the already-created terminal window after it appears. The arranger may reposition windows, but it must not create new assistant terminals.
- Reject the take if the settings panel overlaps the terminal area or any terminal opens over the Terminal Talk panel and stays there.

Shot list:

1. Start with Terminal Talk collapsed on the toolbar screen. No demo terminals are visible on the terminal screen.
2. Hover the toolbar to show the compact controls, then let it settle.
3. Click the cog and open Settings -> Sessions.
4. Show `Create session` with assistant, project folder, label, colour, and permissions.
5. Create `Claude TT A`; hold while the terminal appears in the top-left quadrant.
6. Show `Claude TT A` registering in Sessions.
7. Send cue `CLAUDE-A-01` from `docs/video-narration/operator-cue-sheet.md`.
8. Create `Codex TT A`; hold while the terminal appears in the top-right quadrant.
9. Send cue `CODEX-A-01` as the first Codex prompt; hold while Codex binds from provisional row to real session ID.
10. Create `Claude TT B`; hold while the terminal appears in the bottom-left quadrant.
11. Send cue `CLAUDE-B-01`.
12. Create `Codex TT B`; hold while the terminal appears in the bottom-right quadrant.
13. Send cue `CODEX-B-01`; verify Codex A and Codex B stay separate even if their real session IDs share a prefix.
14. Keep Settings open and show all four session rows.
15. Send queue/identity cues from the operator sheet while the dot strip and tabs are visible.
16. Open one row's voice dropdown and show that sessions can have distinct voices.
17. Open transcript and send transcript cues.
18. Let the toolbar collapse.
19. Send collapsed-toolbar cues from different terminals and capture the correct session-colour flash.
20. End on either Sessions with all four rows visible or Transcript with recent spoken entries visible.

Planned terminal-read narration handoff:

Use `scripts/send-video-cue.ps1 -Cue <cue-id>` for the live take. It expands the cue into the matching terminal-read prompt and sends it to the expected Windows Terminal title.

| Beat | Terminal cue |
| --- | --- |
| Claude registration | `CLAUDE-A-01` |
| Codex registration | `CODEX-A-01` |
| Second Claude session | `CLAUDE-B-01` |
| Second Codex session | `CODEX-B-01` |
| Queue identity | `CLAUDE-A-04`, `CODEX-A-04`, `CLAUDE-B-04`, `CODEX-B-04` |
| Transcript | `CLAUDE-A-05`, `CODEX-A-05` |
| Collapsed flash | `CLAUDE-A-06`, `CODEX-A-06`, `CLAUDE-B-06`, `CODEX-B-06` |

What this video must prove:

- Terminal Talk can create real Claude Code terminals.
- Terminal Talk can create real Codex terminals.
- Four real assistant terminals feed the same toolbar strip.
- Each terminal keeps its own session queue identity.
- Assistant responses use the mascot, not J.
- Sessions are visually distinct.
- Transcript/log entries are created.
- Collapsed toolbar flashes the speaking session colour.

User role:

- Confirm authentication or interactive startup prompts if either CLI asks.
- Confirm window placement after Terminal Talk creates them.
- Do not open assistant terminals manually during the take.
- Avoid touching mouse/keyboard once recording starts.

Assistant role:

- Prepare cue files and checklist.
- Prepare the Create session defaults in the Settings form.
- Only arrange terminal windows after Terminal Talk creates them.
- Start recorder.
- Watch logs/queue if needed.
- Review output before accepting.

Reject the take if:

- Terminals appear before the Settings `Create` clicks.
- Any helper/script creates assistant terminals instead of Terminal Talk creating them.
- Duplicate old demo terminal windows are visible.
- Fewer than four assistant sessions are shown.
- The toolbar is mocked.
- A pop-up appears.
- Narration has a long silent gap.
- Any assistant body response appears as a J clip.
- The Permissions dropdown shows stale values such as `Plan`, `Auto`, or `Accept edits`; it should only show `Default` and the assistant's dangerous launch mode.

### 2. Minimal Toolbar, Maximum Signal

Purpose: show that the toolbar can stay out of the way while still identifying the speaking terminal.

Primary message:

When collapsed, Terminal Talk does not steal the screen. It flashes the speaking session colour so you know which terminal is talking.

Needs:

- At least two sessions already registered, ideally the Claude and Codex sessions from video 1.
- A way to trigger one short clip from each session.
- Toolbar auto-collapse set to 3 seconds.

Suggested layout:

- Two terminals visible.
- Toolbar snapped to top or bottom edge.
- Settings closed.

Shot list:

1. Show expanded toolbar for orientation.
2. Let it auto-collapse.
3. Trigger a Claude response or drop a Claude-colour clip.
4. Capture the collapsed strip flashing/holding Claude colour.
5. Reopen toolbar; show matching Claude dot/session.
6. Let it collapse again.
7. Trigger a Codex response or drop a Codex-colour clip.
8. Capture the collapsed strip flashing/holding Codex colour.
9. Reopen toolbar and show both session colours in dots/tabs.

What this video must prove:

- The toolbar can be minimal.
- Session colour is still useful while collapsed.
- Claude and Codex are distinguishable without opening settings.

User role:

- Keep hands off during collapse/flash shots.
- Confirm visually whether the flash is clear enough.

Reject the take if:

- The toolbar expands automatically when the point is collapsed mode.
- The colour flash is too short or not visible.
- The cursor sits over the toolbar and keeps it expanded.
- The viewer cannot tell which session spoke.

### 3. Hey Jarvis: Read Anything

Purpose: show the free highlight-to-speak feature.

Primary message:

Jarvis reads selected text from any app without needing Claude, Codex, or OpenAI.

Needs:

- A clean text source: browser article, README, PDF, or editor note.
- Terminal Talk running.
- Mic listener or hotkey path ready.
- A short selected paragraph.

Suggested layout:

- Browser/editor on most of screen.
- Toolbar visible at edge.
- Transcript panel closed until the end.

Shot list:

1. Show a body of text that would be annoying to read manually.
2. Highlight a short paragraph.
3. Trigger Jarvis with `Ctrl+Shift+S` or wake word.
4. Show the J clip landing in the toolbar.
5. Show that J takes priority over normal queued clips if any exist.
6. Open transcript/log panel.
7. Show the selected text saved as a recent spoken entry.
8. If triggered from a tracked assistant terminal, show inherited session colour; otherwise show neutral J.

What this video must prove:

- Jarvis is free/simple/read-anywhere.
- It does not require Claude/Codex.
- J clips are distinct from assistant response clips.
- Spoken text is logged.

User role:

- Highlight the text only if scripting selection is unreliable.
- Avoid moving the mouse after highlight/trigger.

Reject the take if:

- Narration starts mid-line.
- The selected text is not visible.
- The clip does not clearly show J.
- The transcript entry is missing.

### 4. Sessions: Identity, Voices, Focus, Mute

Purpose: explain the session model using real sessions that already exist.

Primary message:

Every terminal can have its own colour, label, voice, focus, mute state, heartbeat rule, and speech rules.

Needs:

- Claude and Codex sessions present in Settings.
- At least two rows in the Sessions panel.
- Voice list available.
- No need for live assistant output during every shot, but existing session rows should be real.

Suggested layout:

- Settings panel open and readable.
- Terminals visible enough to connect rows back to real sessions.

Shot list:

1. Open Settings -> Sessions.
2. Point to Claude row and Codex row.
3. Rename one row to a human-friendly label.
4. Change colour arrangement from the dropdown.
5. Show terminal identity/title/status reflecting label/colour where possible.
6. Open voice dropdown and show auto-assigned/used voices.
7. Set a manual voice for one session.
8. Click focus star and explain focused-session priority.
9. Click mute and explain muted sessions produce no audio/no dots.
10. Expand row.
11. Show heartbeat override.
12. Show speech include overrides.

What this video must prove:

- Session controls are tied to real assistant sessions.
- Colour/label/voice are understandable.
- Focus/mute are practical queue controls.
- Per-session overrides exist below the chevron.

User role:

- Confirm which visible terminal is Claude/Codex before recording.
- Avoid changing real preferred settings unless we intentionally restore them afterwards.

Reject the take if:

- The rows look seeded/fake with no relation to terminals.
- Cursor points at labels instead of actual controls.
- The row is not expanded long enough to see overrides.

### 5. Settings: Playback, Shortcuts, OpenAI

Purpose: group global controls in a way that is understandable.

Primary message:

Settings control how Terminal Talk behaves globally: playback, cleanup, shortcuts, and optional premium voices.

Needs:

- Settings panel readable.
- OpenAI key hidden/safe.
- Recording environment free of connectivity pop-ups.

Suggested layout:

- Settings panel is the main subject.
- Terminals can be in the background but are not central.

Shot list:

1. Open Settings.
2. Playback:
   - speed
   - master volume
   - auto-collapse delay
   - auto-prune on/off and seconds
   - explain body clips versus ambient tool/heartbeat clips
   - auto-continue after clicking
   - colour-blind palette
   - heartbeat narration
   - tool-call narration
3. Shortcuts:
   - show editable shortcuts
   - show show/hide toolbar
   - show Jarvis/read-selected-text
   - show mic listener
   - show pause/resume
   - show reset defaults
4. OpenAI:
   - Edge/free is default
   - key status row
   - primary OpenAI toggle
   - fallback OpenAI toggle as paid opt-in
   - test voice
5. End with paid toggles back in intended safe state.

What this video must prove:

- Auto-collapse and auto-prune are different.
- Shortcuts are user-editable.
- OpenAI is optional and paid.
- Edge/free path remains default.

User role:

- Confirm we should not expose any real API key state.
- Confirm final settings are restored.

Reject the take if:

- Connectivity window appears.
- API key is visible.
- Final state leaves paid fallback enabled accidentally.
- Volume readout does not match slider.

### 6. Transcript And Logs: Spoken vs Original

Purpose: show Terminal Talk as a recent-message log, not only an audio toolbar.

Primary message:

Every spoken item can be reviewed, copied, filtered, and compared against the original Markdown/source.

Needs:

- Several recent clips from Claude, Codex, and Jarvis.
- Sidecars with spoken and original text.
- Examples that differ meaningfully:
  - table summary
  - numbered/list handling
  - inline code/code block cleanup
  - URL handling

Suggested layout:

- Toolbar with transcript expanded.
- Source text/editor visible beside it if useful.

Shot list:

1. Open transcript panel.
2. Show 8-10 recent entries if possible.
3. Point to session colour/source labels.
4. Filter by Claude/Codex tab.
5. Return to All.
6. Toggle Spoken view.
7. Toggle Original view.
8. Show a Markdown example where Spoken differs from Original.
9. Use copy button.
10. End with transcript list visible.

What this video must prove:

- Terminal Talk keeps recent logs.
- Spoken and Original are different and useful.
- Session filtering works.
- Jarvis and assistant clips both appear in the log.

User role:

- None during capture if we seed controlled entries.

Reject the take if:

- Transcript only shows one or two entries.
- The video says "logs" but no meaningful log list is visible.
- Mouse movement corrupts the shot.

### 7. Tool Narration And Heartbeat

Purpose: show that Terminal Talk speaks progress, not only final replies.

Primary message:

When assistants are busy, Terminal Talk can narrate tool activity and heartbeat progress so you know work is still happening.

Needs:

- Claude or Codex task that safely performs visible tool actions.
- Heartbeat enabled.
- Tool-call narration enabled.
- Short task with predictable actions.

Suggested layout:

- One terminal visible.
- Toolbar visible.
- Transcript can be opened at end.

Shot list:

1. Start an assistant task that reads/searches/edits or runs a safe command.
2. Show a short tool narration clip landing.
3. Let the queue go quiet while the assistant is still working.
4. Show heartbeat narration/mascot word cloud.
5. Assistant response arrives.
6. Heartbeat stops.
7. Open transcript/log and show tool/progress clips separate from body response.

What this video must prove:

- Tool narration explains activity.
- Heartbeat is ambient progress.
- Real response audio takes over when available.

User role:

- Help choose a harmless task/prompt.
- Approve any assistant action if the terminal asks.

Reject the take if:

- The assistant gets stuck or requests unsafe permissions.
- Heartbeat talks over real response audio.
- Progress narration is too noisy or confusing.

## Recommended Recording Order

1. Create Sessions: Four Terminals, One Toolbar.
2. Minimal Toolbar, Maximum Signal.
3. Hey Jarvis: Read Anything.
4. Sessions: Identity, Voices, Focus, Mute.
5. Transcript And Logs.
6. Settings: Playback, Shortcuts, OpenAI.
7. Tool Narration And Heartbeat.

Reasoning: the first three establish the product. The settings videos then have real session context instead of feeling abstract.

## Shared Pre-Flight Checklist

- Terminal Talk is running and visible with `Ctrl+Shift+A`.
- Claude Code command works.
- Codex command works.
- Two-screen capture span chosen.
- Terminal screen and toolbar screen chosen.
- Terminal window bounds measured for four quadrants.
- `docs/video-narration/operator-cue-sheet.md` is open or copied into the control notes.
- No duplicate stale demo terminals are visible on any recorded monitor.
- Notifications/connectivity pop-ups suppressed.
- Browser tabs unrelated to the video closed.
- Toolbar position decided.
- Recording area decided.
- Physical mouse not touched during capture unless planned.
- Prompts copied into a prep note.
- User confirms "ready" before recorder starts.

## Shared Review Checklist

- Watch the full video before moving to the next recording.
- No external pop-ups.
- No accidental mouse/cursor movement.
- No narration cut-offs.
- No unexplained silence longer than 2 seconds.
- Correct clip identity: mascot for assistant, J for Jarvis.
- Collapsed flash is visible when that is the point.
- WebM and MP4 both generated.
- Landing page references updated only after all chosen videos pass review.
