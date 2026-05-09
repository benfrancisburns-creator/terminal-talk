# Mac and Linux Portability Plan

Terminal Talk is still Windows-first, but Linux is now treated as a native
desktop target rather than a clone of the Windows install. The runtime has an
explicit platform contract in `app/lib/platform.js`; new ports should build
against that boundary instead of adding more scattered `process.platform`
checks through the app.

## Current State

Portable or mostly portable:

1. Electron toolbar window, queue rendering, playback UI, settings UI.
2. Queue, sessions, registry, config, palette, voice assignment, and clip
   pruning under the platform home.
3. Edge TTS and OpenAI TTS wrappers, provided Python and dependencies are
   installed.
4. Codex rollout/session watcher, because it tails files under `~/.codex`.
5. Claude transcript watcher, because it tails files under `~/.claude`.
6. POSIX hook wrappers for Claude and Codex are now present in `hooks/*.sh`.
7. `install.sh` can copy the runtime, install deps, and register POSIX hook
   commands in Claude/Codex config files.
8. `uninstall.sh` removes POSIX hooks, Codex TOML keys, desktop/autostart
   entries, app files, and preserves user config by default unless
   `--remove-config` is passed.
9. Linux uses XDG-aware defaults:
   - state: `${XDG_STATE_HOME:-~/.local/state}/terminal-talk`
   - app/data: `${XDG_DATA_HOME:-~/.local/share}/terminal-talk`
   - config: `${XDG_CONFIG_HOME:-~/.config}/terminal-talk`
   - `TT_INSTALL_DIR` still forces the legacy single-directory layout for
     tests, packaged builds, and backwards compatibility.
10. Electron enables `GlobalShortcutsPortal` on Linux before app readiness so
   Wayland global shortcut registration uses the desktop portal path.

Windows-only today:

1. `install.ps1` / `uninstall.ps1`.
2. PowerShell Claude hooks in `hooks/*.ps1`; POSIX wrappers now exist, but
   they still need real Claude Code verification on Linux/macOS.
3. PowerShell Codex lifecycle hooks in `hooks/codex-*.ps1`; POSIX wrappers now
   exist, but they still need real Codex CLI verification on Linux/macOS.
4. Optional/manual Windows Terminal tab colour launch path through
   `codex-wt-launch.ps1`; this is no longer exposed as a Desktop/Start Menu
   shortcut because it opens outside the user's chosen project folder.
5. Live Codex terminal title sync through `codex-identify-live.ps1`.
6. Microphone-usage watcher through `mic-watcher.ps1`.
7. Claude footer scraping through Windows UI Automation.
8. Startup shortcuts through `.vbs`, Start Menu, and Desktop `.lnk` files.

## Platform Contract

`app/lib/platform.js` owns:

1. runtime state directory resolution.
2. Linux XDG config/data directory resolution.
3. Python executable selection.
4. PowerShell executable selection.
5. Windows taskkill path.
6. feature flags for Windows-only helpers.

Defaults:

1. Windows uses `python`, absolute `powershell.exe`, and `taskkill.exe`.
2. Linux uses XDG state/data/config locations by default.
3. macOS keeps the legacy `~/.terminal-talk` layout until a proper macOS
   Application Support pass is done.
4. macOS/Linux use `python3`, expose `pwsh` only as an overrideable command,
   and disable Windows-only helpers.
5. `TT_HOME`, `TT_INSTALL_DIR`, `TT_APP_DIR`, `TT_CONFIG_PATH`,
   `TT_PYTHON_EXE`, and `TT_POWERSHELL_EXE` override the defaults for tests,
   packaged builds, and unusual machines.

## Native Linux Contract

Linux should be validated as a Linux desktop app:

1. Wayland and X11:
   - global shortcuts use Electron's portal-backed Wayland feature flag.
   - final verification must include GNOME/KDE because compositor policy can
     still block or prompt for shortcuts.
2. Tray/status notifier:
   - Electron's Linux tray path depends on the desktop shell's
     StatusNotifier/AppIndicator support.
   - GNOME may need an extension for visible tray icons; KDE generally exposes
     the system tray by default.
3. Audio:
   - Edge/OpenAI synthesis is file based and portable.
   - playback and microphone testing must be done against the real
     PulseAudio/PipeWire device stack, or WSLg's PulseAudio bridge when using
     WSL2.
4. Startup:
   - Linux autostart uses a freedesktop `.desktop` entry, not Windows
     shortcuts or VBS.
5. Hook runtime:
   - Claude/Codex hooks call shell wrappers, which delegate JSON/registry work
     to `app/posix_hooks.py`.
   - `terminal-talk.env` records the installed state/app/config paths so hooks
     do not have to guess where the Linux install lives.

## Porting Work Still Needed

1. Run `./install.sh --unattended` on a real Linux desktop and on macOS.
2. Verify Claude Code executes the POSIX hook commands exactly as written in
   `~/.claude/settings.json`.
3. Verify Codex CLI executes the POSIX hook commands exactly as written in
   `~/.codex/hooks.json`.
4. Replace Windows UIA footer scraping with one of:
   - terminal transcript metadata when available.
   - Claude/Codex hook payload data when available.
   - a best-effort no-footer fallback.
5. Add macOS launch integration:
   - optional LaunchAgent for startup.
   - app bundle or `npm start` launcher.
   - no tab colour promise unless the chosen terminal supports an API.
6. Verify Linux launch integration on a real desktop:
   - desktop menu `.desktop` entry.
   - optional autostart entry.
   - system tray behaviour checked against GNOME/KDE.
   - no tab colour promise unless the chosen terminal supports an API.
7. Add a native mic-usage watcher per platform, or keep the feature disabled
   outside Windows until it is reliable.

## Testing From Windows

Windows can cover the shared logic, but not native OS behaviour:

1. `node scripts/run-tests.cjs --logic-only` catches cross-platform JavaScript
   and Python logic drift.
2. Platform contract tests simulate `win32`, `darwin`, and `linux`.
3. `scripts/smoke-posix-hooks.sh` exercises the POSIX Claude hook path against
   a temporary `TT_HOME`.
4. `scripts/smoke-posix-install.sh` exercises `install.sh` against a temporary
   `HOME` and `TT_INSTALL_DIR`, including Claude/Codex hook registration.
5. `scripts/smoke-posix-uninstall.sh` exercises hook removal, Codex TOML cleanup,
   app-file removal, config preservation, XDG cleanup, desktop entry removal,
   and autostart removal.
6. `scripts/smoke-posix-full-install.sh` performs a full temporary WSL install,
   including pip/npm dependency installation. If wake-word dependencies are not
   available for that Python/Linux combination, install still completes with a
   `wake-word-unavailable.flag`.
7. Real macOS and Linux machines are still required for microphone devices,
   global shortcuts, tray behaviour, startup integration, and terminal title or
   colour APIs.

Verified on this Windows machine through WSL2 Ubuntu:

1. POSIX Python helper syntax.
2. POSIX shell wrapper syntax.
3. POSIX Claude hook smoke path.
4. POSIX installer smoke path with temporary config files.
5. POSIX uninstaller smoke path with temporary config files.
6. Full temporary POSIX install path including dependencies.

## Definition of Done for Mac/Linux

1. Fresh install works without editing files manually.
2. Toolbar starts, persists config, and plays queued clips.
3. Claude and Codex sessions register with colour, label, voice, and cleanup.
4. Tool narration and final response audio work from hooks.
5. Wake word and highlighted-text speech work, or the installer clearly marks
   unsupported features as disabled.
6. Uninstall removes hooks, startup entries, and app files without deleting user
   config unless requested.
