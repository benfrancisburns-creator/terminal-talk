# Claude Code settings walkthrough guide

Use this as the script and shot order for the `terminal-talk-settings-sessions.webm` style video.

The log files behind the build are mostly startup and watcher health lines:

- `boot version=0.5.0 ... heartbeat=on tts_provider=edge`
- integrity checks for the helper scripts
- `transcript-watcher` and `codex-session-watcher` start
- hotkeys are registered
- `voice listener started`
- `mic-watcher started`
- occasional retry lines when the listener restarts

That means the useful story is not the raw logs themselves. The video should explain the product surface the logs drive: settings, session routing, and speech rules.

## Goal

Show how Terminal Talk turns a set of Claude Code sessions into a controllable audio workflow:

1. Open the settings panel.
2. Show playback controls.
3. Show session naming and session identity.
4. Show per-session voice selection.
5. Show shortcut editing and reset defaults briefly.
6. Show speech include overrides.
7. Keep the cursor on the control being described.

## Shot order

1. Start from the terminal and the toolbar already running.
2. Click the gear icon to open settings.
3. Narrate playback controls:
   - speed
   - volume
   - auto-collapse delay
   - auto-prune
   - auto-prune seconds
   - auto-continue after click
   - colour-blind palette
   - heartbeat narration
   - tool-call narration
4. Show the OpenAI section briefly:
   - primary provider toggle
   - paid fallback toggle
   - test voice
5. Show the Shortcuts section:
   - click one accelerator field
   - show the reset defaults button
6. Scroll to sessions.
7. Rename a session and show that the label changes the row identity.
8. Change the session colour.
9. Toggle focus on, then mute on.
10. Expand the session row.
11. Pick a voice for that session.
12. Show the heartbeat override.
13. Walk through the speech include toggles:
   - headings
   - bullets
   - URLs
   - inline code
   - code blocks
   - images
   - tool calls
14. End with the settings panel still open so the viewer sees the full control surface.

## Narration points

- Terminal Talk tracks multiple Claude Code sessions separately.
- Each session can have its own colour, name, focus state, mute state, and voice.
- Playback settings control how much audio is generated and what gets pruned automatically.
- Auto-prune applies to body/response clips; tool narration and heartbeat clips are ambient and disappear quickly after playback.
- Global shortcuts can be changed from Settings and restored to defaults.
- Speech include rules decide which kinds of content become audio.
- The cursor should always land on the control before the narration explains it.

## Visual rules

- Keep the settings panel open for the section being discussed.
- Use clicks, toggles, and dropdown opens instead of only moving the cursor.
- Do not let the narration describe a feature before it is visible.
- Keep the cursor parked over the exact feature while it is being explained.
- Use a short pause after each toggle or dropdown change so the state change reads clearly.
- If the point is session-specific, keep the session row expanded while speaking about it.

## Good ending

Close on a still frame that shows:

- the settings panel open
- one session renamed
- one session colour chosen
- voice selection visible
- heartbeat override visible
- speech include toggles visible

That gives the viewer the whole mental model in one frame.
