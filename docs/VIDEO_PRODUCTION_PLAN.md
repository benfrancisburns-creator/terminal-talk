# Terminal Talk video production plan

This is the plan for replacing the synthetic demo footage with polished recordings that use the real Terminal Talk Electron toolbar and settings panel.

Use `docs/VIDEO_SESSION_PLAN.md` as the controlling shot list for the next recording pass. `docs/VIDEO_STORYBOARDS.md` remains useful as a record of the old-public-video defects and earlier storyboard thinking. This file tracks production constraints and harness notes; the session plan defines what each video must show and what makes a take unacceptable.

## Non-negotiables

- Use the real `app/index.html`, `app/renderer.js`, `app/styles.css`, `app/lib/settings-form.js`, and `app/lib/sessions-table.js` UI.
- Do not redraw the toolbar, mascot, settings panel, dots, tabs, or session rows in a separate mock.
- The main proof videos must use the current installed toolbar, not just an isolated mock render.
- At least one video must show a real Codex terminal session.
- At least one video must show a real Claude Code terminal session.
- At least one video must show Terminal Talk creating Claude Code and Codex sessions from Settings -> Sessions -> Create session.
- The main proof video should use terminal-read narration: assistant responses provide the spoken demo through Terminal Talk, rather than a separate voiceover talking over the product.
- At least two videos must show the collapsed toolbar flashing the speaking session colour.
- The transcript/log video must show a recent-message list, not just a single clip entry.
- Keep the terminal and Terminal Talk UI in a clean two-screen or split-screen layout.
- Keep the cursor over the feature being described before the narration starts.
- Use response/body clips for normal assistant replies so the scrubber shows the real mascot.
- Use J clips only in the hey-jarvis video, where the J is the feature being explained.
- Seed demo state through the real queue, config, and session registry files.
- Use current feature names from the product, not placeholder labels like `Color 01`.
- Do not leave duplicate old demo terminal windows visible on a recorded monitor.

## Current feature map

### Toolbar

- Playback controls: back 10 seconds, play/pause, forward 10 seconds.
- Scrubber: real walking mascot for assistant response clips.
- J mode: plain `J` badge for highlight-to-speak clips.
- Time display.
- Clear played clips, with undo toast.
- Settings gear.
- Hide button.
- Session tabs: `All` plus one tab per active session, each with unread counts.
- Dot strip: coloured clips, heard state, active halo, run gaps between sessions, J clips, muted-session filtering.
- Transcript panel: expandable list of recent clips, copy buttons, Spoken/Original toggle, scoped by selected session tab.

### Settings panel

- Playback:
  - speed slider
  - master volume slider
  - auto-collapse delay
  - auto-prune body clips plus seconds input; tool narration and heartbeat clips remain ambient and delete quickly
  - auto-continue after clicking
  - colour-blind palette
  - heartbeat narration
  - tool-call narration
  - reload toolbar
- OpenAI premium:
  - API key save/clear/change state
  - key status
  - use OpenAI as primary
  - use OpenAI as fallback, paid opt-in
  - test voice
- Sessions:
  - Create session launcher for Codex / Claude Code
  - project folder picker
  - launch permissions: Default or the assistant's dangerous startup mode
  - Save default launch profile per assistant
  - deterministic Windows Terminal placement for recording / controlled launch flows
  - provisional Codex launch rows that bind to the real Codex session after the first conversation event
  - collision-safe Codex session identity when two Codex sessions share the same native short prefix
  - session swatch
  - short session ID
  - editable label
  - 24-option colour arrangement dropdown
  - focus star
  - mute button
  - remove session
  - expandable per-session settings
  - per-session voice dropdown
  - per-session heartbeat override
  - per-session speech include overrides: code blocks, inline code, URLs, headings, bullet markers, image alt-text, tool-call narration
- Shortcuts:
  - editable global accelerator fields
  - show / hide toolbar
  - read selected text
  - mic listener
  - pause / resume
  - pause only
  - reset defaults
- About:
  - product description
  - installed version
  - global shortcuts
  - mascot/J explanation

### Behaviours worth showing

- Codex CLI and Claude Code clips share the same toolbar strip while keeping separate per-terminal queues.
- Response clips use the mascot, not J.
- Hey-jarvis clips use J and jump the queue.
- Focused sessions play before other sessions once the current clip finishes.
- Muted sessions produce no audio and no visible dots.
- Per-session voices let terminals be identified by ear.
- Fresh sessions auto-assign distinct voices, while manual voice choices are preserved.
- New audio flashes the collapsed letterbox in the speaking session colour without expanding over the user's work.
- Codex terminal identity uses the Settings colour and label, and normal Codex launches happen from any project folder.
- Claude Code and Codex can be launched from Terminal Talk Settings with label, colour, project folder, and startup permission mode.
- Speech include controls determine what Markdown/content is spoken.
- Transcript panel preserves what was spoken and, when available, the original source text.
- Heartbeat narration is ambient progress audio while an assistant is working.
- Tool-call narration is short progress audio like reading files, searching, editing, or running tests.
- Master volume must visually match the readout. If the readout says `100%`, the slider thumb must be at the far right.

See `docs/VIDEO_REFRESH_CHANGELOG.md` for the post-2026-04-28 feature list that must be covered before replacing the current videos.

## Capture tooling status

The floating toolbar is good for real use but awkward for video composition. The app now has a capture-only mode behind `TT_CAPTURE_MODE=1`.

Important: capture mode is useful for controlled settings-panel shots, but it is not a substitute for the live integration proof. The overview/session-sync recordings need the installed toolbar plus real Codex/Claude terminal sessions so viewers can see Terminal Talk working in the actual workflow.

Capture mode should continue to:

- open as a normal, opaque, framed, resizable window
- appear in the taskbar
- not force always-on-top
- not become click-through
- use the same renderer and preload as production
- keep the settings panel inside the same real window
- avoid resizing back to the small floating toolbar when settings opens
- leave normal user behavior unchanged when `TT_CAPTURE_MODE` is not set

Implemented touchpoints to keep verified:

- `app/main.js`: choose BrowserWindow options from `TT_CAPTURE_MODE`.
- `app/main.js`: skip `startCursorPollDriver()` in capture mode.
- `app/lib/ipc-handlers.js`: make `set-panel-open` a no-op resize in capture mode, or resize to the capture window dimensions instead of the floating `680 x 618` size.
- recording scripts: launch Electron with `TT_CAPTURE_MODE=1`, seeded `TT_INSTALL_DIR`, and deterministic queue/session/config files.

This should be treated as a video/test harness mode, not a new user-facing setting yet.

## Video set

### 1. Create sessions: four terminals, one toolbar

Purpose: show Terminal Talk creating real Claude Code and Codex sessions, then reading their assistant output through the actual toolbar.

Layout:

- Record a two-screen span when possible.
- Terminal screen: four Windows Terminal windows in quadrants:
  - `Claude TT A`
  - `Codex TT A`
  - `Claude TT B`
  - `Codex TT B`
- Toolbar screen: real installed Terminal Talk toolbar, starting collapsed, then Settings -> Sessions.
- The terminals and toolbar should not overlap.
- Use deterministic placement (`TT_CREATE_SESSION_WINDOW_POS`, `TT_CREATE_SESSION_WINDOW_SIZE`, `TT_CREATE_SESSION_WINDOW_BOUNDS`) or immediately move the created windows after launch.

Story:

1. Start with Terminal Talk collapsed and no demo terminals visible.
2. Hover the toolbar, then open Settings with the cog.
3. Show Settings -> Sessions -> Create session.
4. Create `Claude TT A` from Terminal Talk.
5. Show Claude registering immediately.
6. Create `Codex TT A` from Terminal Talk.
7. Send the first Codex cue prompt so Codex binds from provisional launch row to real session ID.
8. Repeat for `Claude TT B` and `Codex TT B`.
9. Use `docs/video-narration/operator-cue-sheet.md` so assistant responses provide the narration.
10. The toolbar shows body clips as coloured dots and the mascot while responses play.
11. Open tabs/dot strip to show that clips share the toolbar strip but keep separate per-terminal queues.
12. Open transcript and point at the spoken text entries.
13. Let the toolbar collapse and send cues from different sessions to capture colour flashes.
14. End with all four session rows or the transcript list visible.

Features covered:

- Create session from Settings
- project folder launch
- launch permission mode
- label and colour before/at registration
- Codex/Claude integration
- real shared toolbar strip with per-terminal queues
- real mascot
- tabs
- dot strip
- transcript panel
- collapsed colour flash
- terminal-read narration

Avoid:

- J clips
- fake orange cube mascot
- overlapping terminal and toolbar
- old duplicate demo terminal windows
- external narration fighting Terminal Talk audio

### 2. Hey jarvis highlight-to-speak

Purpose: show highlighted text becoming a priority J clip.

Layout:

- Left half: real terminal, browser, or editor with selectable text.
- Right half: real Terminal Talk capture-mode window.
- Transcript panel can be open at the end, but not from the first frame unless it helps the composition.

Story:

1. Cursor moves to the text.
2. Text is highlighted visibly.
3. Cursor moves to the toolbar dot strip before the clip arrives.
4. The user says `hey jarvis` or triggers `Ctrl+Shift+S`.
5. A J clip lands and jumps the queue.
6. The highlighted text is spoken.
7. Cursor opens the transcript panel and points at the new entry.
8. End with the J clip and transcript entry visible.

Features covered:

- highlight any text
- wake word / hotkey trigger
- J clip identity
- priority playback
- transcript capture

This is the one video where J is correct and should be explained directly.

### 3. Settings and sessions

Purpose: show how Terminal Talk is configured after the viewer has already seen Create session working in the main proof video.

Layout:

- Left half: real terminal with a short Terminal Talk prompt or status text.
- Right half: real Terminal Talk capture-mode window with settings open.
- The settings window should be tall enough that the current section is readable.

Story:

1. Cursor clicks the real settings gear.
2. Playback section:
   - point to speed
   - point to volume, ensuring the slider matches the percentage readout
   - point to auto-collapse delay
   - toggle auto-prune off/on
   - point to seconds input and explain body clips versus ambient tool/heartbeat clips
   - point to auto-continue
   - point to colour-blind palette
   - point to heartbeat narration
   - point to tool-call narration
3. OpenAI section:
   - show saved/unsaved status
   - point to primary provider toggle
   - point to paid fallback toggle
   - point to test voice
   - keep this brief so it does not dominate the video
4. Shortcuts section:
   - click one shortcut field so the capture prompt is visible
   - show reset defaults
   - keep the defaults intact for recording unless the shot intentionally demonstrates changing one
5. Sessions section:
   - briefly point at Create session as the same launcher used in video 1
   - rename a session to `Codex demo` or `Claude docs`
   - change colour using the real dropdown labels
   - click focus star
   - click mute
   - expand the row
   - open the voice dropdown
   - select a real voice
   - show the heartbeat override
   - walk the speech include grid
6. End on an expanded session row with voice, heartbeat, and speech include controls visible.

Features covered:

- playback controls
- OpenAI provider controls
- global shortcut editor
- session names
- colour arrangements
- focus
- mute
- per-session voice
- heartbeat override
- speech includes

Avoid:

- fake settings UI
- placeholder colour names
- cursor drifting away from the feature being narrated
- cutting off before the expanded session controls are shown

### 4. Optional: focus, mute, and multi-session priority

Purpose: show why sessions matter when multiple terminals are active.

Layout:

- Left half: two real terminal panes or a controlled terminal stage showing two assistant sessions.
- Right half: real Terminal Talk capture-mode window with settings open to Sessions.

Story:

1. Two sessions produce clips.
2. The dot strip shows run gaps and tabs.
3. Cursor selects one session tab.
4. Cursor focuses a session.
5. Next clip from the focused session plays before the other queued clips.
6. Cursor mutes the other session.
7. Muted session clips disappear / stop producing dots.

Features covered:

- run gaps
- tabs
- focus priority
- mute semantics
- multi-session clarity

This can be folded into the settings video if we want only three landing-page videos.

## Cursor rules

- Cursor arrives at the target before narration mentions it.
- Each click has a visible pause after it.
- Settings explanations should use the real control, not the row label when possible.
- For sliders, park on the thumb or the value readout.
- For toggles, park on the active pill, click the opposite pill, then return to the resulting state if needed.
- For dropdowns, open the dropdown and hold long enough for options to read.
- For session-specific features, keep the row expanded.
- For transcript, park on the exact row being discussed.

## Demo data rules

- Use deterministic demo homes under `tmp/`.
- Seed `config.json` so the UI starts in a readable state.
- Seed `session-colours.json` with realistic labels:
  - `Codex demo`
  - `Claude docs`
  - `Frontend`
  - `Audit run`
- Use real palette indexes so swatches and dots match.
- Use body clip filenames for assistant replies.
- Use `-clip-<short>-<index>` filenames only for hey-jarvis clips.
- Write `.txt` sidecars for transcript rows.
- Write `.original.txt` sidecars when showing Spoken/Original.
- Keep audio clip text short enough that visuals do not outrun narration.

## Recording order

1. Smoke-test `TT_CAPTURE_MODE=1`.
2. Smoke-test installed-toolbar two-screen capture with deterministic Windows Terminal placement.
3. Build one reusable video harness that can:
   - create demo config
   - seed sessions
   - seed or drop clips
   - launch real Terminal Talk
   - launch assistant sessions from Terminal Talk Settings where the product path is being demonstrated
   - move created terminal windows into measured bounds
   - move and click the cursor
   - capture the screen
   - hide or script the OS cursor so physical mouse movement cannot corrupt a take
   - close or suppress connectivity prompts and unrelated notifications before recording
   - close any duplicate stale demo windows before recording
4. Record the Create sessions / four terminals video first, because it proves the real installed toolbar, real assistants, real launcher, and real mascot path.
5. Record the hey-jarvis video second, because it intentionally uses J clips.
6. Record the settings video third, after the viewer has already seen Create session in the proof video.
7. Review each take before proceeding to the next recording.
8. Only embed videos on the landing page after frame checks confirm:
   - real mascot appears for response clips
   - J appears only in the hey-jarvis video
   - volume slider and readout match
   - settings panel is real
   - terminal and toolbar do not overlap
   - cursor is coherent with narration
   - collapsed toolbar colour flash is visible
   - no external pop-ups appear
   - no duplicate stale demo terminals appear
   - narration has no unexplained silent gap longer than 2 seconds

## Landing-page recommendation

Keep three primary videos on the landing page:

- Create sessions: four terminals, one toolbar
- Hey jarvis
- Settings and sessions

If we make the optional multi-session priority video, link it from the README or a deeper docs page instead of crowding the landing page.
