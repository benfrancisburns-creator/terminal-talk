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

### Added — architecture refactor (external-audit follow-up)
Three shared modules extracted from copy-pasted logic:
- **`app/lib/text.js`** — canonical `stripForTTS` (markdown → speakable prose). Replaces 4 copies (main.js, tests, synth_turn.py, speak-response.ps1). Python + PowerShell mirrors remain (can't share JS code) and are verified against the canonical on every test run by a new `STRIP-FOR-TTS PARITY` group.
- **`app/session-registry.psm1`** — shared PowerShell module for session-colour assignment: `Read-Registry`, `Update-SessionAssignment`, `Save-Registry`, `Write-SessionPidFile`. Replaces the ~80-line lowest-free-index + hash-fallback + atomic-write block that used to live copy-pasted in `statusline.ps1`, `speak-response.ps1`, and `speak-on-tool.ps1`.
- **`app/tts-helper.psm1`** — shared edge-tts + OpenAI fallback chain: `Resolve-OpenAiApiKey`, `Invoke-EdgeTts`, `Invoke-OpenAiTts`, `Invoke-TtsWithFallback`. Replaces the Invoke-TTS function + key-walker duplicated across the response and notification hooks.

Net: ~260 lines of duplication deleted. New regression-guard test groups hard-fail if any caller re-inlines the logic.

### Added — installer hardening
- `-Unattended` / `-HooksYes` / `-StatuslineYes` / `-StartupYes` flags. CI install step now uses these instead of piping newlines into stdin.
- **`requirements.txt`** pinning Python deps (edge-tts 7.2.8, openwakeword 0.6.0, onnxruntime 1.24.4, sounddevice 0.5.5, numpy 2.4.4). Dependabot raises weekly PRs; harness gates them.
- Corrupt `~/.claude/settings.json` is detected and the installer refuses to proceed (prevents mid-edit crash leaving the user with both no hooks AND a broken settings file).
- Settings.json backups auto-rotate — keep the last 5, prune older.
- Installer parses clean under strict `[ScriptBlock]::Create()` (em-dashes in UTF-8-no-BOM strings that tripped PS 5.1's ANSI codepage are gone).

### Added — security hardening
Following [Electron's 2026 security checklist](https://www.electronjs.org/docs/latest/tutorial/security) + CNCF TAG-Security hygiene guide:
- Strict **CSP** on the renderer: `default-src 'none'`, `connect-src 'none'`, `script-src 'self'`, `media-src 'self' blob: file:`. Renderer has no network fetch surface.
- **Navigation guards**: `will-navigate` blocks anything off-app, `setWindowOpenHandler` denies by default, `will-attach-webview` prevented.
- **Single-instance lock** via `app.requestSingleInstanceLock()` — duplicate launches surface the existing window and exit (fixes "5 terminal-talk.exe in Task Manager" bug).
- **Self-cleanup watchdog** runs every 30 minutes — prunes stale audio, dead-PID session files, orphan wake-word listener processes. Logs to `~/.terminal-talk/queue/_watchdog.log`.
- Repo meta: `SECURITY.md` (responsible-disclosure policy + hardening summary), `.github/dependabot.yml` (npm + pip + github-actions weekly), `.github/workflows/codeql.yml` (JS + Python + actions SAST), `.github/ISSUE_TEMPLATE/*`, `.github/PULL_REQUEST_TEMPLATE.md`, `CODE_OF_CONDUCT.md`.
- Workflow default-deny: `permissions: contents: read` at top of `test.yml`.
- Electron dependency pinned exactly (`32.2.0` — was `^32.2.0`).

### Added — UX (scrubber mascot)
- Native `<input type="range">` thumb replaced with an SVG overlay of the wallpaper mascot. While audio plays forward his legs bob + body scurries up-down (walk cycle). Drag the scrubber forward → legs sweep right; drag backward → mascot **rotates 180° (angry face)** + legs sweep left. Body bob skips during angry-flip to avoid transform collision.
- Scrubber now driven by `requestAnimationFrame` (~60 fps) instead of `timeupdate` (~4 fps) — mascot glides instead of stepping.
- Claude Code's 90 `tengu_spinner_words` (Moonwalking, Flibbertigibbeting, Cerebrating, Honking…) float up from the mascot's head as tiny white pixel-cloud speech bubbles with a stepped wallpaper silhouette + drop-shadow. Random order, jittered 850–1500 ms between emits.

### Added — branding
- Full-size **1280 × 800 wallpaper** (`docs/assets/wallpaper/`) of the ASCII TERMINAL TALK wordmark + pixel mascot + HEY JARVIS speech bubble. Used as the README hero + GitHub OG image.
- Per-letter 3D cast-shadow via `text-shadow` (each letter's shadow is a darker shade of its face colour, not a bevel line inside the glyph). R + TALK's L both cyan for visual through-line.
- Six annotated UI mocks in `docs/design-system/mocks-annotated.html` rendered to individual PNGs, embedded in the README's new "UI states" section.

### Fixed — bugs from external code review
- **User-visible: wrong voice config keys** in `synth_turn.py`. Read `voices.response_voice` (doesn't exist) and `voices.openai_api_key` (wrong nesting) — so changing the global response voice in the settings panel silently did nothing, and the streaming OpenAI fallback never fired. Now reads `voices.edge_response` and root-level `openai_api_key` to match the JS writer.
- **Speech-includes defaults drift**: Python had `bullet_markers=True, image_alt=True` while JS had `false, false`. Streaming hook was speaking bullet markers the clipboard-speak flow wasn't. Flipped Python to match JS. Lock-step now enforced by test group `JS ↔ PYTHON DEFAULTS ARE IN LOCK-STEP`.
- **Stale palette bound**: `set-session-index` clamped to 31 but palette is 24 (0–23). Valid IPC input was rejected by the registry sanitiser → silent UI/registry drift. Clamp now 23.
- **Silent edge-tts sentence drops**: one-shot failures with no retry + no log meant ~1 sentence per turn could vanish. Now retries 3× with 0.4/0.8 s backoff; final failure logs an 80-char preview of the lost sentence to `_hook.log`.
- **Settings-panel flicker at bottom edge**: the off-screen rescue tested the whole window's centre, which with the panel open was below the work area → rescue yanked the window back mid-drag. Now tests only the 114 px bar region.
- **`applyDock('bottom')` slammed the panel shut**: hard-coded collapsed height. Now reads current height, preserves whichever state the user was in.
- **Panel-open while bottom-docked grew off-screen**: `setSize` kept y fixed. Now uses `setBounds` with y-adjust so the panel grows *upward* from a bottom-docked bar.
- **Space / Arrow keys hijacked typing**: toolbar's renderer listened for `Space` / `ArrowLeft` / `ArrowRight`, which fired when the user had recently clicked the bar and then typed in another app. Removed — pause is `Ctrl+Shift+P` / `Ctrl+Shift+O` globals. Kept Escape with a `document.hasFocus()` guard.
- **Vertical left/right dock removed entirely**: unrecoverable-state bug on multi-monitor rearrangement (bar stuck vertical mid-screen with no drag path back). Horizontal-only snap (top/bottom) now. Ctrl+Shift+A stays the recovery hotkey.
- **Off-screen rescue**: if the bar ends up off every connected display (unplugged monitor, swapped laptop), it re-centres on primary-top automatically.

### Changed — docs
- README hero is the wallpaper, not the retired dots-lettered banner.
- README has a new "UI states" section with 5 annotated mocks + captions, plus a "Status: early beta · solo-maintained" banner above the marketing copy.
- CONTRIBUTING source-tree listing updated with `synth_turn.py`, `sentence_split.py`, `lib/text.js`, `session-registry.psm1`, `tts-helper.psm1`, `speak-on-tool.ps1`, `tests/e2e/`, `render-mocks.cjs`.
- SECURITY.md function name corrected: `redactSecrets()` → `redactForLog()`.
- Test counts synced across README (121 → 128), SECURITY.md (83 → 128), CONTRIBUTING (75 → 128).

### Tests
- **128 unit + 13 Playwright E2E**, all green. **+53 new tests** since the session started.
- New regression-guard groups: `STRIP-FOR-TTS PARITY`, `PS SESSION-REGISTRY MODULE IS CANONICAL`, `PS TTS-HELPER MODULE IS CANONICAL`, `JS ↔ PYTHON DEFAULTS ARE IN LOCK-STEP`, `HARDENING: renderer CSP`, `HARDENING: navigation guards`, `SELF-CLEANUP WATCHDOG`. Each hard-fails if a consolidated module gets re-inlined or a documented default flips.
- Cross-platform CI: Linux logic-only (58/58) + Windows full harness (128/128) + CodeQL (JS + Python + actions).

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
