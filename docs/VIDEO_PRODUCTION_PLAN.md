# Terminal Talk video production plan

This is the plan for replacing the synthetic demo footage with polished recordings that use the real Terminal Talk Electron toolbar and settings panel.

## Non-negotiables

- Use the real `app/index.html`, `app/renderer.js`, `app/styles.css`, `app/lib/settings-form.js`, and `app/lib/sessions-table.js` UI.
- Do not redraw the toolbar, mascot, settings panel, dots, tabs, or session rows in a separate mock.
- Keep the terminal and Terminal Talk UI in a clean split-screen layout.
- Keep the cursor over the feature being described before the narration starts.
- Use response/body clips for normal assistant replies so the scrubber shows the real mascot.
- Use J clips only in the hey-jarvis video, where the J is the feature being explained.
- Seed demo state through the real queue, config, and session registry files.
- Use current feature names from the product, not placeholder labels like `Color 01`.

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
  - auto-prune body clips plus seconds input
  - auto-continue after clicking
  - colour-blind palette
  - heartbeat narration
  - tool-call narration
  - reload toolbar
- OpenAI premium:
  - API key save/clear/change state
  - key status
  - use OpenAI as primary
  - test voice
- Sessions:
  - session swatch
  - short session ID
  - editable label
  - 24-option colour arrangement dropdown
  - focus star
  - mute button
  - remove session
  - expandable per-session settings
  - per-session voice dropdown
  - per-session speech include overrides: code blocks, inline code, URLs, headings, bullet markers, image alt-text, tool-call narration
- About:
  - product description
  - installed version
  - global shortcuts
  - mascot/J explanation

### Behaviours worth showing

- Codex CLI and Claude Code clips enter the same toolbar queue.
- Response clips use the mascot, not J.
- Hey-jarvis clips use J and jump the queue.
- Focused sessions play before other sessions once the current clip finishes.
- Muted sessions produce no audio and no visible dots.
- Per-session voices let terminals be identified by ear.
- Speech include controls determine what Markdown/content is spoken.
- Transcript panel preserves what was spoken and, when available, the original source text.
- Heartbeat narration is ambient progress audio while an assistant is working.
- Tool-call narration is short progress audio like reading files, searching, editing, or running tests.
- Master volume must visually match the readout. If the readout says `100%`, the slider thumb must be at the far right.

## Capture tooling change required

The floating toolbar is good for real use but awkward for video composition. Add a capture-only mode behind an environment variable, for example `TT_CAPTURE_MODE=1`.

Capture mode should:

- open as a normal, opaque, framed, resizable window
- appear in the taskbar
- not force always-on-top
- not become click-through
- use the same renderer and preload as production
- keep the settings panel inside the same real window
- avoid resizing back to the small floating toolbar when settings opens
- leave normal user behavior unchanged when `TT_CAPTURE_MODE` is not set

Recommended implementation points:

- `app/main.js`: choose BrowserWindow options from `TT_CAPTURE_MODE`.
- `app/main.js`: skip `startCursorPollDriver()` in capture mode.
- `app/lib/ipc-handlers.js`: make `set-panel-open` a no-op resize in capture mode, or resize to the capture window dimensions instead of the floating `680 x 618` size.
- recording scripts: launch Electron with `TT_CAPTURE_MODE=1`, seeded `TT_INSTALL_DIR`, and deterministic queue/session/config files.

This should be treated as a video/test harness mode, not a new user-facing setting yet.

## Video set

### 1. Assistant replies and shared queue

Purpose: show Terminal Talk reading real Codex/Claude assistant output through the actual toolbar.

Layout:

- Left half: real visible terminal running Codex or Claude Code.
- Right half: real Terminal Talk capture-mode window.
- The terminal and toolbar should not overlap.
- The toolbar starts closed to settings, with the transcript panel available but collapsed unless needed.

Story:

1. Cursor starts in the terminal prompt.
2. A short prompt is entered, for example: `codex "explain what Terminal Talk just changed"`.
3. Fabricated or controlled assistant messages arrive as real queue clips.
4. The toolbar shows body clips as coloured dots.
5. The scrubber shows the real mascot while the response plays.
6. Cursor moves to the dot strip while the narration explains the queue.
7. Cursor moves to session tabs to show per-session separation.
8. Cursor opens the transcript panel and points at the spoken text.
9. End on terminal plus toolbar both visible.

Features covered:

- Codex/Claude integration
- real queue
- real mascot
- tabs
- dot strip
- transcript panel
- shared audio workflow

Avoid:

- J clips
- settings panel
- fake orange cube mascot
- overlapping terminal and toolbar

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

Purpose: show how Terminal Talk is configured, using the real settings panel.

Layout:

- Left half: real terminal with a short Terminal Talk prompt or status text.
- Right half: real Terminal Talk capture-mode window with settings open.
- The settings window should be tall enough that the current section is readable.

Story:

1. Cursor clicks the real settings gear.
2. Playback section:
   - point to speed
   - point to volume, ensuring the slider matches the percentage readout
   - toggle auto-prune off/on
   - point to seconds input
   - point to auto-continue
   - point to colour-blind palette
   - point to heartbeat narration
   - point to tool-call narration
3. OpenAI section:
   - show saved/unsaved status
   - point to primary provider toggle
   - point to test voice
   - keep this brief so it does not dominate the video
4. Sessions section:
   - rename a session to `Codex demo` or `Claude docs`
   - change colour using the real dropdown labels
   - click focus star
   - click mute
   - expand the row
   - open the voice dropdown
   - select a real voice
   - walk the speech include grid
5. End on an expanded session row with voice and speech include controls visible.

Features covered:

- playback controls
- OpenAI provider controls
- session names
- colour arrangements
- focus
- mute
- per-session voice
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

1. Implement and test `TT_CAPTURE_MODE=1`.
2. Build one reusable video harness that can:
   - create demo config
   - seed sessions
   - seed or drop clips
   - launch real Terminal Talk
   - launch the visible terminal or stage
   - move and click the cursor
   - capture the screen
3. Record the assistant replies video first, because it proves the real toolbar and mascot path.
4. Record the hey-jarvis video second, because it intentionally uses J clips.
5. Record the settings video third, after the cursor coordinate map is measured against the capture-mode settings panel.
6. Only embed videos on the landing page after frame checks confirm:
   - real mascot appears for response clips
   - J appears only in the hey-jarvis video
   - volume slider and readout match
   - settings panel is real
   - terminal and toolbar do not overlap
   - cursor is coherent with narration

## Landing-page recommendation

Keep three primary videos on the landing page:

- Assistant replies and shared queue
- Hey jarvis
- Settings and sessions

If we make the optional multi-session priority video, link it from the README or a deeper docs page instead of crowding the landing page.
