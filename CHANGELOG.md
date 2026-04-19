# Changelog

All notable changes to Terminal Talk are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased] — 0.2.0

Large quality-of-life release built iteratively in one long session. Everything here is on top of v0.1.0.

### Added — streaming TTS
- **Streaming auto-speak.** Audio now starts ~2-3 seconds after Claude begins responding, instead of 6-24 seconds after the turn ends. Two mechanisms combine:
  - *Sentence-parallel synthesis.* Response text is split into sentences and sent to edge-tts in parallel (4-wide). Completed clips roll into the queue in order as they arrive, so the first sentence starts playing while later ones are still synthesising.
  - *Between-tool streaming via new PreToolUse hook.* Each time Claude is about to use a tool, any text written since the last synthesis gets spoken while the tool runs. Genuinely streaming audio for tool-heavy responses.
- New files: `app/synth_turn.py` (Python orchestrator — transcript extraction, sanitisation, sentence split, parallel synthesis, sync state), `app/sentence_split.py` (splitter with abbreviation / URL / decimal / paragraph-break handling), `hooks/speak-on-tool.ps1` (PreToolUse hook).
- Per-session sync state at `~/.terminal-talk/sessions/<id>-sync.json` prevents the same text being spoken twice; file-based session lock prevents hook-invocation races.
- Stop hook (`speak-response.ps1`) now spawns `synth_turn.py` detached and exits in ~150 ms instead of blocking 6-24 s during synthesis. Legacy inline path preserved as fallback if the Python script is missing.
- `install.ps1` registers the new PreToolUse hook; `uninstall.ps1` cleans it up.

### Added — toolbar UX redesign
- **Two-row layout.** 680 × 114 window: controls on top (play/pause, ±10 s, scrubber, time, clear, settings, close), dots on the bottom strip — ~30 dots fit before any clipping. Dot order flipped to oldest-left, newest-right so the row reads in playback order.
- **Session-run grouping.** Visual gaps on the dot strip between runs from different terminals, so you see at a glance which terminal said what without reordering playback.
- **Edge snapping.** Drag the toolbar anywhere; release within 50 px of an edge and it snaps flush. Left / right edges switch to a vertical layout (56 px wide, controls stacked, dots running downward). Position and dock orientation persist across launches.
- **Auto-collapse / hover-expand.** 15 s of no interaction → bar shrinks to a 14 px strip and becomes click-through so clicks pass to apps below. Hover, new clip, or keystroke → expands back. Deferred while audio is playing or unplayed clips remain in the queue, so streaming sessions don't flicker.
- **Persistent sessions.** Colour registry entries keep their slot indefinitely until removed via a new × button on each Sessions table row. No more "labelled the session, went away for an hour, came back and the label was gone".

### Added — per-session controls
- **Mute toggle.** `🔊 / 🔇` button on each Sessions row. Muted sessions skip synthesis entirely (no edge-tts calls), are filtered from the dot strip, any currently-playing clip stops if its session gets muted, and the terminal's statusline shows a `🔇` prefix.
- **Auto-prune controls.** Playback panel has a toggle ("Auto-prune played clips") and a configurable delay (3-600 s, default 20 s). On = self-managing toolbar. Off = clips stack up for review when you return to the desk. Per-clip timers honour the manual-vs-auto-play distinction (20 s manual, 20 s auto by default).

### Changed — installer / process identity
- Electron binary copied to `terminal-talk.exe` at install time (alongside the original `electron.exe`), and Startup VBS launches the rebranded binary — Task Manager now shows "terminal-talk.exe" entries instead of anonymous "electron.exe" ones.

### Fixed
- `Ctrl+Shift+J` mic mute actually releases the microphone now. Orphan sweep plus a Python-side state-file poll that tears down the `sd.InputStream` when state flips to "off". Two independent kill paths — either alone is sufficient.
- Focus-stealing toolbar. `win.show()` on every clip was grabbing focus mid-type; switched to `showInactive()` for queue-driven shows and downgraded `alwaysOnTop` from `screen-saver` to `floating`.
- Robust auto-play. `playNextPending()` now has a third-tier fallback scanning for any unplayed + unmuted clip. The old `ended` handler gate that blocked this fallback has been removed.
- Monotonic mtime on rolling release. `os.replace()` was preserving source mtime (= synth-finish time, random due to parallelism), causing playback order to skip around; now `os.utime()` stamps a monotonic counter so order matches seq.
- Active-dot pulse halo no longer clips against the window edge (window taller, overflow:hidden removed from the inner dots container).
- `speak-response.ps1` palette size corrected from 32 → 24 (matched the actual palette everywhere else).

### Tests
- 75 total, all passing. +21 new since v0.1.0 covering sentence splitter, sync state, text extraction, mute round-trip, synth-skip-on-mute.

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
- 24 distinguishable arrangements: 8 solid colours, 8 horizontal splits, 8 vertical splits. (Quad patterns removed in the pre-release because they read as noise at 16 px.)
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
- 54 tests covering palette logic, filename parsing, statusline assignment, edge-tts wrapper, speech-includes filtering, voice list validation, registry round-trip, BOM handling, pinned-session preservation.
- Tests use a tmp registry path so they don't race the live install.

### Notes

- Windows-only at v0.1.0. Mac and Linux ports tracked for v0.2.
- All functionality works without any cloud account (free tier). OpenAI is optional fallback only.
- No telemetry, analytics, or remote logging anywhere in the codebase.
