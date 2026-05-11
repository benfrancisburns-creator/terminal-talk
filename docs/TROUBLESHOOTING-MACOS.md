# Troubleshooting Terminal Talk on macOS

Common Mac issues and their fixes. The fastest first step for almost any
problem is:

```sh
bash ~/.terminal-talk/tt-doctor.sh
```

That prints a colour-coded pass/fail report across every subsystem. If
you're filing an issue or asking for help, paste that output — it tells
the support side what's actually broken.

---

## I don't hear any audio

**Check**: `bash ~/.terminal-talk/tt-doctor.sh`

If section 4 (audio synthesis) shows `say(1)` working but `edge-tts`
failing, it's a network problem — `edge-tts` calls Microsoft's cloud TTS
service. Verify your DNS / VPN / firewall isn't blocking
`speech.platform.bing.com:443`. The `say` fallback will keep working
offline, but voice quality drops.

If `say(1)` itself fails, your macOS speech subsystem is broken. Open
**System Settings → Accessibility → Spoken Content → System Voice** and
re-select your voice — that re-installs the synth pipeline.

If the venv import checks fail (section 2), re-run the installer:

```sh
bash ~/code/terminal-talk/install.sh
```

---

## Wake word ("hey jarvis") doesn't fire

**Check 1**: Is the listener running?

```sh
pgrep -fl wake-word-listener.py
```

If nothing prints, the listener isn't up. Restart the toolbar:

```sh
~/.terminal-talk/start-toolbar.sh
```

**Check 2**: Microphone permission. macOS shows a one-time prompt the
first time the listener captures audio; if you missed it or denied it,
open **System Settings → Privacy & Security → Microphone** and enable
the entry for `Electron` (or `Terminal Talk`).

**Check 3**: Adaptive noise floor. In a noisy room, the listener
deliberately raises its threshold so background chatter doesn't
trigger. Speak the wake word more clearly + closer to the mic, or
move to a quieter spot.

**Check 4**: `tail ~/.terminal-talk/queue/_voice.log` — the listener
logs every model load + every fire attempt. If you see `FATAL: model
load failed`, the openWakeWord model wasn't downloaded. Fix:

```sh
~/.terminal-talk/.venv/bin/python \
  -c 'from openwakeword.utils import download_models; download_models()'
```

---

## Highlight-to-speak does nothing (Ctrl+Shift+S)

**Check**: Accessibility permission. macOS requires Accessibility
access to synthesise the Cmd+C keystroke that copies your highlighted
text. Open **System Settings → Privacy & Security → Accessibility**
and enable `Electron` (or `Terminal Talk`).

If the permission is granted but it still doesn't work, the keystroke
helper's clipboard read is timing out. Try slowing it down — highlight
the text, wait 200 ms, then press Ctrl+Shift+S.

`tail ~/.terminal-talk/queue/_helper.log` shows the helper's view; if
it received the trigger but couldn't read the clipboard, that line
will be there.

---

## Voice commands ("hey jarvis play / pause / next") don't work

**Check 1**: Speech Recognition permission. This is a separate macOS
permission from Microphone. Open **System Settings → Privacy &
Security → Speech Recognition** and enable Electron / Terminal Talk.

**Check 2**: `tail ~/.terminal-talk/queue/_voice.log` for lines like
`Speech recognition permission not granted`. If you see those, the
permission isn't being honoured — toggle it off and back on in
System Settings.

**Check 3**: Vocabulary. Recognised verbs are: `play`, `pause`,
`resume`, `next`, `skip`, `back`, `again`, `previous`, `stop`,
`cancel`, `stop talking`, `shut up`, `silence`. Anything else falls
through to the "speak the highlighted text" path (same as a bare
"hey jarvis" with no command after).

---

## Footer audio is randomised, not matching what's on screen

The Mac footer scraper reads Terminal.app or iTerm2 buffers via
AppleScript. If your terminal is something else (Warp, Alacritty,
Kitty, Ghostty), the scraper has nothing to read and falls back to
generating a generic footer phrase.

Workaround: use Terminal.app or iTerm2 for Claude Code / Codex
sessions when you want the synthesised footer to match the screen
text. Other terminals will still get audio, just with a generic
"Worked for X" rather than echoing the on-screen verb.

---

## Auto-pause when I dictate doesn't work

The Mac mic-watcher (Phase 3, v0.7+) uses CoreAudio HAL to detect
when another app starts capturing the mic. macOS 14 (Sonoma) or
later required.

**Check 1**: `pgrep -fl mic_watcher_mac.py`. If nothing prints, the
watcher isn't up — restart the toolbar.

**Check 2**: `tail ~/.terminal-talk/queue/_toolbar.log` for
`mic-watcher (mac):` lines. You should see `MIC_CAPTURED` /
`MIC_RELEASED` events when you start / stop dictation in another
app.

**Check 3**: Older macOS. The required CoreAudio properties
(`kAudioProcessPropertyIsRunningInput`) only exist on macOS 14+. On
Big Sur / Monterey / Ventura, the watcher disables itself and the
auto-pause feature won't work — there's no fallback path.

---

## Start dictation hotkey doesn't open Apple Dictation

Terminal Talk's `Ctrl+Shift+D` shortcut pauses playback and asks macOS to start
Dictation in the currently focused app.

**Check 1**: Make sure dictation is enabled in **System Settings > Keyboard >
Dictation**.

**Check 2**: Grant Accessibility permission to Terminal Talk. The bridge uses
the foreground app's **Edit > Start Dictation** menu first, then falls back to
the macOS dictation keyboard shortcut path.

**Check 3**: Some apps do not expose an Edit menu item for Dictation. Focus a
plain text field in TextEdit or Terminal and try again.

**Check 4**: `tail ~/.terminal-talk/queue/_toolbar.log` and look for
`startDictation: helper OK` or a helper failure.

---

## Custom wake word doesn't load

**Check**: `~/.terminal-talk/config.json` syntax. The `wake_words`
field is an array of strings; each string is either a canned name
(`alexa`, `hey_jarvis`, `hey_mycroft`, `hey_rhasspy`, `timer`,
`weather`) or an absolute path to an `.onnx` file under 5 MB.

```json
{
  "wake_words": ["hey_jarvis", "/Users/me/models/hey_claude.onnx"]
}
```

If your custom path is wrong, `tail _voice.log` will show
`wake_words: path not found: /your/path` — fix the path and restart
the toolbar.

---

## How to reset all permissions

If macOS permissions get into a confused state, reset them:

```sh
tccutil reset Microphone
tccutil reset Accessibility
tccutil reset SpeechRecognition
```

Then restart the toolbar. The next time each subsystem activates,
macOS will prompt you fresh.

---

## How to inspect logs

| Log | What's in it |
|---|---|
| `~/.terminal-talk/queue/_hook.log` | Synth pipeline (clip generation, sentence splitting, edge-tts errors) |
| `~/.terminal-talk/queue/_voice.log` | Wake-word listener (model load, fire detections, voice commands) |
| `~/.terminal-talk/queue/_helper.log` | Keystroke helper (Ctrl+Shift+S handling, clipboard reads) |
| `~/.terminal-talk/queue/_toolbar.log` | Toolbar main process (window state, watchers, IPC) |

All four rotate at 1 MB with one backup, so disk usage stays bounded
at ~8 MB worst case.

---

## How to use tt-doctor

```sh
bash ~/.terminal-talk/tt-doctor.sh           # full report
bash ~/.terminal-talk/tt-doctor.sh --no-net  # skip edge-tts probe (offline / CI)
bash ~/.terminal-talk/tt-doctor.sh --help
```

Sections:
1. **Environment** — node, python3, git, brew presence
2. **Venv + Python deps** — edge-tts, sounddevice, openwakeword,
   plus macOS frameworks CoreAudio, Speech, Quartz
3. **Hooks** — Claude + Codex hook entries registered + executable
4. **Audio synthesis** — `say(1)` round-trip + `edge-tts` cloud probe
5. **macOS permissions** — TCC.db introspection (Accessibility,
   Microphone, Speech Recognition)
6. **Toolbar process** — `pgrep` for the Electron toolbar + listener
7. **Recent errors** — last 5 ERROR / FATAL / Traceback lines from
   each log

Exit code is 0 if every check passed, 1 if any failed (warnings
don't fail the report).

---

## Still stuck?

File an issue at <https://github.com/benfrancisburns-creator/terminal-talk/issues>
with the full output of `bash ~/.terminal-talk/tt-doctor.sh` and
`tail -50 ~/.terminal-talk/queue/_*.log`. Including those two
together short-circuits 90% of the back-and-forth.
