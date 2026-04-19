# Changelog

All notable changes to Terminal Talk are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0] — 2026-04-19

Initial release.

### Added

**Voice in / out**
- Wake-word detection via `openWakeWord` (offline, CPU). Default phrase: "hey jarvis".
- Highlight-to-speak via wake word or `Ctrl+Shift+S`.
- Auto-speak Claude Code responses via Stop hook (PowerShell, opt-in at install).
- Voice notification on Claude Code permission prompts.
- TTS via Microsoft Edge neural voices (45 verified English voices).
- Optional OpenAI TTS fallback (`gpt-4o-mini-tts`) when edge-tts is unreachable.

**Floating toolbar (Electron)**
- Always-on-top letterbox bar with play/pause, ±10s skip, scrubber, time readout.
- Per-clip dot. Click to play, right-click to delete. Auto-deletes 90 s after manual play.
- Currently-playing dot has subtle white pulsing ring.
- Heard dots fade to white but keep a coloured outer ring.
- `Ctrl+Shift+A` toggles toolbar visibility.

**Per-terminal identity**
- 32 distinguishable arrangements: 8 solid colours, 8 horizontal splits, 8 vertical splits, 8 quadrant patterns.
- Each Claude Code terminal gets a unique colour automatically (lowest-free-index assignment).
- Session colour shown three ways: dot on toolbar, emoji in terminal statusline, optional per-session voice.
- Manual colour pinning via Sessions table dropdown — pinned colours never get reassigned.
- Session labels — set a name; appears next to the emoji in the statusline (e.g. `🟢 Frontend`).

**Per-session controls**
- Per-session voice override — pick any of 45 Edge voices for one terminal.
- Per-session speech-includes overrides (tri-state Default / On / Off):
  - Code blocks (content kept, fences stripped when on)
  - Inline code (content kept, backticks stripped when on)
  - URLs
  - Headings
  - Bullet markers
  - Image alt-text
- Saves persist through every read/write cycle in the registry.
- Hook reads global config + merges session overrides on every turn (no restart needed).

**Mic toggle**
- `Ctrl+Shift+J` toggles wake-word listener; chimes confirm on/off.
- Mic is fully released when off (`taskkill /F /T` on the listener PID).
- State persists across restarts.

**Settings panel**
- Gear icon expands the toolbar to a panel with: playback speed slider, sessions table (label + colour + chevron expand to per-session controls), about section with ASCII banner and shortcuts cheat-sheet.
- Native dropdowns rendered dark via `nativeTheme.themeSource = 'dark'`.

**Installer (Windows)**
- `install.ps1` checks Python 3.10+ / Node 18+, pip-installs deps, pre-downloads wake-word model, npm-installs Electron, copies files to `%USERPROFILE%\.terminal-talk\`, opt-in registers Claude Code hooks + statusline + Startup shortcut.
- `uninstall.ps1` reverses everything; backs up `~/.claude/settings.json` first.
- Re-runnable safely; preserves `config.json` and session colour assignments.

**Test harness**
- 43 tests covering palette logic, filename parsing, statusline assignment, edge-tts wrapper, speech-includes filtering, voice list validation, registry round-trip, BOM handling, pinned-session preservation.
- Tests use a tmp registry path so they don't race the live install.

### Notes

- Windows-only at v0.1.0. Mac and Linux ports tracked for v0.2.
- All functionality works without any cloud account (free tier). OpenAI is optional fallback only.
- No telemetry, analytics, or remote logging anywhere in the codebase.
