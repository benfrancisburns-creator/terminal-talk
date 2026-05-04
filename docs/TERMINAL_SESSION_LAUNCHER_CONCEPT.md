# Terminal Session Launcher Concept

Date: 2026-05-01
Updated: 2026-05-02

This started as a parked feature idea discovered during the live video dry run.

Status: implemented for the Windows recording path and now part of the main video plan. The current flow can launch Claude Code or Codex from Terminal Talk Settings, pre-assign a label/colour, and bind the real session after Claude statusline or Codex hook registration.

## Idea

Terminal Talk could create new Claude Code or Codex terminal sessions directly from its UI.

Instead of asking the user to open Windows Terminal, `cd` into a project, launch `claude` or `codex`, then rename the row after registration, Terminal Talk could expose a `Create new session` flow.

## Proposed Flow

1. User opens Terminal Talk Settings -> Sessions.
2. User clicks `Create new session`.
3. User chooses:
   - Assistant: Claude Code or Codex
   - Project folder
   - Friendly label, for example `Claude x TT` or `Codex x TT`
   - Session colour / colour arrangement
   - Optional voice/focus defaults
4. User clicks `Create`.
5. Terminal Talk launches Windows Terminal in the chosen project folder.
6. Terminal Talk starts `claude` or `codex`.
7. Terminal Talk pre-allocates or immediately updates the session row with the chosen label and colour.
8. When the assistant emits its normal registration event, Terminal Talk binds the real process/session ID to the pre-created row.

## Why It Helps

- Makes setup much easier for new users.
- Turns Terminal Talk from a passive listener into a session command center.
- Avoids manual project-folder navigation.
- Lets the user name and colour sessions before the first assistant message.
- Creates a cleaner first-run experience for Claude Code and Codex.
- Reuses the Windows Terminal launch work already proven by `scripts/open-video-demo-terminals.ps1`.

## Important Behaviour Differences

Claude Code:

- Usually registers immediately through its statusline.
- Terminal Talk can bind the launched process quickly.
- The label/colour can be applied almost immediately.

Codex:

- Starts in the terminal first.
- Does not enter the Terminal Talk registry until its first Codex conversation event.
- Terminal Talk may need a pending/preallocated launcher row until the first prompt fires.

## Implementation Notes

- Start with Windows support using `wt.exe`.
- Use `pwsh.exe -NoExit -Command` with explicit executable paths where needed.
- Keep launch titles no-space internally, then apply friendly Terminal Talk labels after registration.
- Add a project folder picker through Electron main-process IPC.
- Store pending launches in the runtime registry with:
  - provider: `claude` or `codex`
  - project path
  - requested label
  - requested colour/voice
  - pending short ID / launcher ID shown in the UI until the real assistant session ID arrives
  - launched process ID when available
  - pending timeout / cleanup rule
- On Claude statusline or Codex hook event, match the process/project/session and convert the pending launch into a normal session row.

The create flow should treat colour as part of the visible session identity, not as an afterthought. The pending row should already show the chosen colour dot/swatch while waiting for the real Claude or Codex session ID to bind.

## Risks / Questions

- Codex cannot be fully registered until it emits a hook event.
- If the assistant opens auth/login prompts, Terminal Talk must leave control with the user.
- Project folder permissions and missing executables need clear errors.
- Cross-platform launch commands will need separate macOS/Linux paths.
- The UI must not make Terminal Talk feel like an IDE; it should remain a light command center.

## Video Status

Include this in the current recording pass.

The main proof video should start from Terminal Talk Settings -> Sessions and use `Create session` to launch the demo terminals. Do not show a helper command as the primary product path.

For the recording workflow, Terminal Talk can use deterministic Windows Terminal placement:

- `TT_CREATE_SESSION_WINDOW_POS`
- `TT_CREATE_SESSION_WINDOW_SIZE`
- `TT_CREATE_SESSION_WINDOW_BOUNDS`

That lets the created terminals land in known monitor quadrants for the video without the user manually dragging windows around. If Windows Terminal ignores the initial placement, the fallback mover applies the requested pixel bounds after launch.
