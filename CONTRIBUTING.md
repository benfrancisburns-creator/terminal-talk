# Contributing to Terminal Talk

Thanks for taking a look. This is a small, focused project — easy to understand and easy to extend.

## Project layout

```
terminal-talk/
├── README.md
├── LICENSE                       MIT
├── CHANGELOG.md
├── install.ps1                   Windows installer
├── uninstall.ps1                 Windows uninstaller
├── config.example.json           Default config copied on first install
├── package.json                  npm scripts (test, etc.)
├── app/                          Electron + Python runtime
│   ├── main.js                   Main process: hotkeys, IPC, queue watcher, TTS dispatch
│   ├── preload.js                IPC bridge (contextIsolation = true)
│   ├── renderer.js               Renderer: settings panel, dot rendering
│   ├── index.html                Toolbar + settings panel markup
│   ├── styles.css                Dark dropdown, dots, panel styling
│   ├── package.json              Electron dependency
│   ├── wake-word-listener.py     openWakeWord + ctypes Ctrl+Shift+S
│   ├── key_helper.py             Long-lived stdin-driven Win32 key sender
│   ├── edge_tts_speak.py         edge-tts wrapper (handles SelectorEventLoop quirk)
│   └── statusline.ps1            Reads/writes session-colours.json, emits emoji
├── hooks/
│   ├── speak-response.ps1        Claude Code Stop hook
│   └── speak-notification.ps1    Claude Code Notification hook
├── scripts/
│   ├── start-toolbar.vbs         Silent Electron launcher (used by Startup shortcut)
│   └── run-tests.cjs             43-test harness
└── docs/                         (planned)
```

## Working on the code

### One-time setup

```powershell
git clone https://github.com/YOUR-USERNAME/terminal-talk
cd terminal-talk
.\install.ps1     # installs to %USERPROFILE%\.terminal-talk\
```

### The dev loop

```powershell
# 1. Edit a file in terminal-talk/app/ or terminal-talk/hooks/
# 2. Sync to the live install
copy app\<changed>.* "$env:USERPROFILE\.terminal-talk\app\"
copy hooks\<changed>.ps1 "$env:USERPROFILE\.terminal-talk\hooks\"

# 3. Restart the toolbar (only needed for main.js / renderer.js / index.html / styles.css)
taskkill /F /IM electron.exe
wscript "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\terminal-talk.vbs"
```

PowerShell hooks (`speak-response.ps1`, `speak-notification.ps1`, `statusline.ps1`) are re-read on every invocation, so no restart needed.

### Running tests

```powershell
node scripts/run-tests.cjs            # quick
node scripts/run-tests.cjs --verbose  # full output
```

Tests use a tmp registry path (`%TEMP%\tt-test-session-colours.json`), so they're fully isolated from your live install — your real session colours won't be touched.

### Adding a test

Tests live in `scripts/run-tests.cjs`. Pattern:

```js
describe('YOUR GROUP', () => {
  it('does the right thing', () => {
    const out = someFunction(input);
    assertEqual(out, expected);
  });
});
```

The test file inlines its own copies of pure functions (`stripForTTS`, `arrangementForIndex`, etc.) to keep `app/renderer.js` Electron-free. **Keep these inline copies in lock-step** with `app/renderer.js` and `app/main.js` — comments at the top of each duplicated block flag this.

Tests that exercise the real PowerShell scripts spawn `powershell.exe` via `spawnSync` with the `TT_REGISTRY_PATH` env var pointing at the tmp file.

## Architecture invariants

If you change one of these, expect things to break in surprising ways:

1. **Single source of truth for session colours**: `~/.terminal-talk/session-colours.json`. Owners that may write: the Stop hook, the statusline, and `main.js`'s `ensureAssignmentsForFiles`. All three must use the same prune rule (`pinned OR PID alive OR last_seen within 4 h`).
2. **Filename encoding**: `<timestamp>-<sessionShort>.{wav,mp3}` for responses, `-Q-` prefix for questions, `-notif-` for notifications, `-clip-<short|neutral>-<idx>` for highlight-to-speak. The renderer's regex assumes this exactly.
3. **PowerShell file writes use `[IO.File]::WriteAllText` with `UTF8Encoding($false)`** to avoid the BOM that Node's `JSON.parse` rejects. There's a regression test for this.
4. **The hook is the authoritative writer of session colour assignments.** Statusline updates an existing entry; `main.js` only adds when it sees a filename for an unknown session.
5. **`speech_includes` and `voice` per-session keys must be preserved** through every load → modify → save cycle. Tests cover this; PowerShell's hashtable conversion drops unknown fields silently if you don't explicitly copy them.

## Code style

- JS: vanilla, no build step. Use `const`, prefer functions over classes.
- PowerShell: PS 5.1 compatible (the version `powershell.exe` defaults to). Avoid em-dashes and other multi-byte chars in source — PS 5.1 chokes on them without a BOM.
- Python: 3.10+. Stdlib only where possible.

## Issues and PRs

Open an issue describing the bug or the feature. For PRs:

1. Add or update tests in `scripts/run-tests.cjs`.
2. Run the harness — must be 100% green.
3. Update README and CHANGELOG if the user-facing surface changes.
4. One concern per PR.

## Mac / Linux ports

The components most needing platform abstraction:

- `wake-word-listener.py` — uses `ctypes.windll.user32.keybd_event`. On macOS use `pyobjc` + Quartz; on Linux use `python-uinput` or `xdotool`.
- `key_helper.py` — same, plus the `GetForegroundWindow` walk in `fgtree`.
- `*.ps1` — port to bash for macOS / Linux. Hooks would live as `.sh` and the Claude Code hook config would invoke `bash -c '...'`.
- `start-toolbar.vbs` — replace with `.command` (macOS LaunchAgent) or `systemd --user` unit (Linux).

Open a tracking issue before starting either; happy to coordinate.
