# Terminal Talk Video Refresh Change List

Date: 2026-05-01

The current public videos under `docs/videos/` were generated on 2026-04-28. This file tracks features added or materially changed after those recordings so the next video pass covers the product accurately.

## Shipped Changes To Cover

### Toolbar And Resting State

- The toolbar now auto-collapses after 3 seconds by default instead of the old long delay.
- The delay is configurable in Settings -> Playback through `playback.collapse_delay_sec` with a 1-120 second range.
- Audio arriving while collapsed no longer expands the toolbar over the user's work. The letterbox flashes in the speaking session colour.
- The letterbox highlight is held for the duration of the active clip and clears when playback ends.
- The toolbar movement/docking path has been tightened: top/bottom snap only, saved position, off-display recovery, click-through while hidden/collapsed, and `Ctrl+Shift+A` as the recovery hotkey.

### Settings And Global Controls

- Playback now has explicit global controls for master volume, auto-collapse delay, auto-prune body clips, and the auto-prune seconds input.
- The auto-prune row should be explained precisely: body/response clips follow the user delay, while tool narration and heartbeat clips remain ambient and delete quickly after playback.
- Settings now includes a Shortcuts section for editing the global accelerator bindings: show/hide toolbar, read selected text, mic listener, pause/resume, and pause only.
- The shortcut editor captures a replacement keypress, validates conflicts, updates the About shortcut table, and has a reset-to-defaults button.
- The settings video should show that these are global app controls, not per-session settings.

### Sessions, Colours, And Voices

- Fresh sessions now get auto-assigned Edge voices through `voice_auto: true`.
- The first auto-voice choices use the voices already preferred in the live setup: `en-AU-NatashaNeural`, `en-GB-SoniaNeural`, then `en-GB-RyanNeural`.
- Manual session voice choices set `voice_auto: false` and are preserved; automatic assignment will not overwrite them.
- Heartbeat narration keeps its separate global clip voice, so it does not change when session response voices are assigned.
- The voice dropdown marks voices that are already in use, with the owning session's palette colour behind the option.
- Session colours now use a spread-first palette allocation order so early sessions are high-contrast rather than adjacent colours like orange/yellow or orange/red.
- The 24 palette arrangements remain manually selectable per session, with the colour-blind palette still available globally.

### Codex Identity And Registry

- Codex CLI now uses native hooks for identity and working-state registration, with rollout tailing for assistant messages and tool progress.
- Normal Codex usage is: open a terminal in any project folder and run `codex`. No Terminal Talk project folder or Terminal Talk Codex shortcut is required.
- Codex terminal titles show the session colour marker and the Settings session label, without noisy `00` / `01` IDs.
- Session label and colour changes from the Settings sessions area propagate back to the Codex terminal identity surface.
- Claude Code-launched Codex plugin sessions are labelled as `Claude Codex - <project folder>` instead of appearing as mystery sessions.
- Codex plugin starts announce the session identity, colour, and short ID in audio.
- Codex plugin cleanup now removes finished plugin sessions from the registry and leaves a tombstone so stale queue files cannot resurrect ghost sessions.
- Non-terminal Codex rollout files are ignored unless a live hook has identified the session, so background files do not steal palette slots or flash the letterbox.
- The old `Terminal Talk Codex` Desktop/Start Menu shortcut workflow has been removed from the public workflow and should not be shown in refreshed videos.

### Tool Narration

- Tool narration is richer for both Claude Code and Codex:
  - intent summaries for reading, searching, editing, patching, and tests;
  - shell command summaries for common commands;
  - pipeline narration only when the pipeline stage adds useful context;
  - batch deduplication so the same phrase is not spoken repeatedly;
  - deterministic verb variation so repeated actions do not all say "opening" or "searching";
  - permission-request narration for Codex escalated commands.
- Edit narration now includes file context, line counts, and local scope where available.
- Scope detection walks `originalFile` when available, then falls back to patch context, nearby headings, test names, and plain-English comments.
- This is the "what, where, why" narration path: what action is happening, where in the codebase it is happening, and why that area matters when the transcript gives enough context.

### Transcript And Speech Includes

- The speech-includes surface now needs to be shown as a real feature, not just a checkbox grid:
  - code blocks;
  - inline code;
  - URLs;
  - headings;
  - bullet/list markers;
  - image alt text;
  - tool-call narration.
- Tables are summarised instead of being read as raw Markdown.
- List markers no longer repeat "bullet" for every item. When markers are enabled, unordered lists are numbered for speech, and ordered Markdown lists keep meaningful numbering.
- The spoken/original transcript toggle is more important now because spoken text may be cleaned, summarised, or renumbered for audio.

### TTS Routing And OpenAI

- Edge remains the free default route.
- OpenAI primary is paid and opt-in.
- OpenAI fallback is also paid and opt-in; fallback defaults to Edge/free unless the user explicitly enables OpenAI fallback.
- The settings video should show the warning meaning clearly: users need to watch credits or configure billing/top-up if they choose OpenAI fallback.

### Linux/Mac Readiness Work

- POSIX install, uninstall, hook wrappers, XDG path handling, and WSL smoke tests now exist.
- Do not present Linux/macOS as fully supported in launch videos until a real Linux desktop and a Mac have verified tray, audio, mic, global shortcuts, windowing, Claude hooks, and Codex hooks.

## Videos To Refresh

### `terminal-talk-user-hero` And `terminal-talk-overview`

Update the high-level story:

- Claude Code and Codex both feed the same toolbar.
- The toolbar can stay collapsed without stealing focus.
- New audio is visible through the coloured letterbox flash.
- Different sessions can be identified by colour, label, and voice.

### `terminal-talk-settings-sessions`

Add or emphasize:

- auto-collapse delay control;
- master volume;
- auto-prune body clips plus seconds, including the distinction from always-ambient tool/heartbeat clips;
- OpenAI fallback being paid opt-in;
- editable global shortcuts and reset defaults;
- tool-call narration toggle;
- per-session auto voices and manual voice changes;
- used voices highlighted by session colour;
- heartbeat override;
- speech-includes controls.

### `terminal-talk-session-sync-controls`

Update for the new identity system:

- spread-first colour assignment;
- label/colour changes updating terminal identity;
- Codex terminal title colour marker plus label;
- Claude statusline glyph plus label;
- normal `codex` launch from any project folder;
- no Terminal Talk Codex shortcut.

### `terminal-talk-transcript-spoken-original`

Add examples for:

- table summary;
- numbered list speech;
- inline code versus code block treatment;
- spoken/original differences.

### `terminal-talk-queue-jarvis`

Add the current collapsed-letterbox behaviour:

- Hey Jarvis/highlight clips still use the J identity.
- Assistant clips use the mascot/session colour path.
- Collapsed arrival flashes by source session instead of expanding the full toolbar.

### `docs/Claude Code Videos/smart-tool-narration*.webm`

Re-record or replace. The old version does not show:

- deterministic wording variation;
- richer search/edit/test narration;
- function/section/comment scope detection;
- Codex tool narration parity;
- permission request clips.

### New Codex Identity/Plugin Clip

Consider a short dedicated clip for:

- Claude Code launching a Codex plugin session;
- Terminal Talk announcing `Claude Codex - <project>`;
- the session speaking with its colour/voice;
- cleanup removing the row after completion.

## Open Gaps Before Recording

- Linux/macOS should stay as "in progress" until verified on real machines.
- Re-check the live toolbar height/bottom border before recording the resting-state shots; this was a user-visible issue in the earlier audit.
