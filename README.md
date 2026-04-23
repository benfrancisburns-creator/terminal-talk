<p align="center">
  <img src="docs/assets/wallpaper/terminal-talk-wallpaper.png" alt="Terminal Talk — coloured ASCII wordmark, pixel mascot and HEY JARVIS speech bubble" width="900">
</p>

<p align="center">
  <a href="https://github.com/benfrancisburns-creator/terminal-talk/releases/latest"><img src="https://img.shields.io/github/v/release/benfrancisburns-creator/terminal-talk?color=c97b50&label=release" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/platform-Windows-0078d4" alt="Windows">
  <img src="https://img.shields.io/badge/node-18%2B-339933" alt="Node 18+">
  <img src="https://img.shields.io/badge/status-early%20beta-orange" alt="Early beta">
  <a href="https://github.com/benfrancisburns-creator/terminal-talk/actions/workflows/test.yml"><img src="https://img.shields.io/github/actions/workflow/status/benfrancisburns-creator/terminal-talk/test.yml?branch=main&label=tests" alt="Tests"></a>
</p>

> **Status: v0.4 beta · solo-maintained.** Works well on my machine, tested in CI (686 unit + 28 E2E green), but this is the first widely-shared release — expect rough edges. Issues and PRs welcome. Mac port is next (in planning), Linux after. File bugs via [private Security Advisories](https://github.com/benfrancisburns-creator/terminal-talk/security/advisories/new) (security) or [public Issues](https://github.com/benfrancisburns-creator/terminal-talk/issues) (everything else).

**Claude Code reads its replies aloud, and _"hey jarvis"_ reads any highlighted text.**

Hands-free voice output for Claude Code on Windows. Free, MIT licensed, no signup, no accounts. Microsoft Edge TTS (cloud) for voices, openWakeWord (local) for wake-word detection. Colour-blind friendly palette available in Settings › Playback.

**Try it in your browser (no install):** [live interactive toolbar demo](https://benfrancisburns-creator.github.io/terminal-talk/ui-kit/) · [project landing page](https://benfrancisburns-creator.github.io/terminal-talk/)

[Install](#install-windows) · [What it does](#what-it-does) · [What's offline](#whats-offline-and-what-isnt) · [UI states](#ui-states) · [Demo](https://benfrancisburns-creator.github.io/terminal-talk/ui-kit/) · [Privacy](#privacy--security) · [Contributing](CONTRIBUTING.md)

---

## Install (Windows)

```powershell
git clone https://github.com/benfrancisburns-creator/terminal-talk
cd terminal-talk
.\install.ps1
```

Requires Windows 10/11, Python 3.10+, Node.js 18+, a working microphone. Takes ~3 minutes.

The installer pip-installs `edge-tts`, `openwakeword`, `onnxruntime`, `sounddevice`, `numpy`; pre-downloads the `hey_jarvis` wake-word model (~30 MB, one-time); runs `npm install` for Electron; copies everything to `%USERPROFILE%\.terminal-talk\`; then asks whether to register Claude Code hooks, the per-terminal coloured emoji statusline, and auto-launch at login.

Re-running `install.ps1` is safe — it updates in place and preserves your `config.json` and session colour assignments.

---

## What's offline and what isn't

- ✅ **Wake-word detection** — openWakeWord runs on CPU, no network. Audio never leaves your machine for wake detection.
- ❌ **TTS synthesis** — Microsoft Edge TTS is a cloud service. The text being spoken goes to `speech.platform.bing.com`. Same endpoint Edge browser uses for "Read Aloud." Full detail in [Privacy & Security](#privacy--security).
- ✅ **Everything else** — session tracking, the toolbar UI, audio playback, file management, colour registry, statusline — all run locally.

---

## What it does

- **Auto-speak Claude Code responses.** Starts speaking as Claude generates, not after it finishes — audio begins ~2–3 seconds in, not 6–24 seconds after the turn ends. Each terminal gets a unique colour dot + matching statusline emoji so you can identify sessions by ear (and optionally give each its own voice).
- **"Hey jarvis" → read highlighted text.** Works in any app — browser, PDF, VS Code, Slack. Select text, say the wake word (or press `Ctrl+Shift+S`), hear it read. `Ctrl+Shift+J` toggles the mic listener cleanly on and off.
- **Permission-prompt alerts.** When Claude Code asks to use a tool, a short voice notification fires so you don't have to watch the screen waiting for a prompt.
- **Per-session controls.** Mute individual terminals (no synthesis, no clips — truly "cut the wire"), focus one to prioritise its clips in the queue, give each a custom voice, override speech-include behaviour per session (code blocks, URLs, headings, etc.).
- **Auto-pauses when you dictate.** If another app (Wispr Flow, Windows Voice Access, VoIP) grabs the mic, Terminal Talk pauses whatever's playing so it doesn't talk over you. Releases and resumes automatically. New arrivals that land during the dictation window queue up and drain in order once the mic's free — they never burst all at once.
- **End-of-reply closer.** At the end of each Claude response, Terminal Talk speaks the exact verb from the terminal footer — "Brewed for 8m 49s", "Sautéed for 1m 0s", "Cogitated for 24m 56s". Read directly off the Windows Terminal buffer via UI Automation so the audio matches what you see.
- **Runs in the background.** Small always-on-top toolbar snaps to the top or bottom edge, auto-collapses after 15 s of idle, becomes click-through when hidden. `Ctrl+Shift+A` is the universal show/hide recovery hotkey.

## UI states

Five annotated mocks rendered from [`docs/design-system/mocks-annotated.html`](docs/design-system/mocks-annotated.html) — open that page directly for the live interactive version with every annotation visible on the right-hand side.

### 01 · Idle

<p align="center">
  <img src="docs/screenshots/toolbar-idle.png" alt="Idle toolbar: empty two-row letterbox with controls on top and an empty dot strip below" width="900">
</p>

The baseline. 680 × 114 frameless two-row pill, always-on-top, drag anywhere to move. Close just hides the window — the listener keeps running and `Ctrl+Shift+A` brings it back.

### 02 · Queue with three sessions

<p align="center">
  <img src="docs/screenshots/toolbar-three-sessions.png" alt="Dot strip clusters by session: 3 red dots (Terminal A, first one playing), gap, 3 yellow dots (Terminal B), gap, 2 green dots (Terminal C)" width="900">
</p>

Three terminals queued in arrival order: **3 red** from Terminal A (first one playing, 2 queued behind), **3 yellow** from Terminal B, **2 green** from Terminal C. The 12 px gap between runs marks a change of speaker so the timeline reads as **A A A — B B B — C C** at a glance. Oldest left, newest right, never re-sorted. If Terminal C has the important message you'd wait through 5 clips first — that's the story shot 04's focus-star solves.

### 03 · Mixed states in one queue

<p align="center">
  <img src="docs/screenshots/toolbar-mixed-states.png" alt="Eight dots on one bar: 3 red (first 2 faded=heard, 3rd playing with ring), gap, 2 yellow queued, gap, 2 green queued, gap, 1 blue J-clip for hey-jarvis highlight-to-speak" width="900">
</p>

A real queue in flight. Reading left to right: Terminal A (red) sent 3 clips — you've **heard** the first two (faded, click to replay, right-click to delete) and the third is **playing** now (pulsing white ring around the same red). Terminal B (yellow) has 2 **queued** flat discs behind it, then Terminal C (green) has 2 more. The blue dot on the far right is a **J-clip** — a highlight-to-speak capture from "hey jarvis" / `Ctrl+Shift+S`; J-clips have the highest priority and jump the whole queue when they arrive. Auto-prune removes heard clips after 3–600 s (default 20 s); muted sessions never produce dots at all.

### 04 · Settings panel open

<p align="center">
  <img src="docs/screenshots/toolbar-settings-panel.png" alt="Full settings panel: Playback with speed slider + auto-prune toggle, Sessions table with focus star + mute on every row + one expanded row showing voice + speech-includes, About section with ASCII banner + shortcuts table" width="900">
</p>

The gear reveals four sections. **Playback** — speed 0.5–2.5× · master volume 0–100% · auto-prune toggle + seconds · auto-continue after clicking · colour-blind palette · heartbeat narration · reload toolbar. **OpenAI (premium)** — collapsible section for pasting an API key, flipping the "Prefer OpenAI" primary-provider toggle, and a Test button (detail in [Premium TTS](#premium-tts-optional)). **Sessions** — every active terminal on one row with chevron · swatch · 8-char ID · editable label · palette dropdown (24 arrangements) · focus ★ · mute 🔊/🔇 · remove. The chevron reveals per-session voice (45 Edge voices + 6 OpenAI voices) and seven tri-state speech-includes toggles. **About** has the ASCII banner + full shortcuts.

**Playback precedence** — (1) "hey jarvis" / `Ctrl+Shift+S` highlight-to-speak always wins · (2) unplayed clips from the focused ★ session jump the queue · (3) oldest unplayed clip from any unmuted session. That's how you make Terminal C's important reply play before Terminal A's 3-deep ramble.

### 05 · Snapped to the top edge

<p align="center">
  <img src="docs/screenshots/toolbar-snapped-top.png" alt="Toolbar flush against the top edge of a screen, flat-topped, with dots showing two heard reds plus three blues (one playing)" width="900">
</p>

Drag within ~20 px of the top or bottom edge and the bar snaps flush on release. The bar is **horizontal-only** — left/right edges aren't snap targets. `Ctrl+Shift+A` toggles the whole toolbar on and off; if it ever ends up somewhere weird, that hotkey is the recovery path and the bar re-centres on primary if it's dragged off every display.

## Who it's for

- **Claude Code users** working in the terminal who want responses read aloud (primary).
- **Anyone** who wants a fast "select text, hear it" keystroke — no agent required.
- **Voice-first workflows** — combine with a speech-to-text tool and you barely touch the keyboard. See [Companion dictation tools](#companion-dictation-tools-optional) near the bottom.

---

## Usage

### Hotkeys

All hotkeys are **global** — they work from any app. Nothing is captured from the toolbar's own window, so typing `Space` or arrow keys anywhere else can never trip playback.

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+A` | Show / hide the toolbar (your recovery hotkey) |
| `Ctrl+Shift+S` | Read the currently highlighted text |
| `Ctrl+Shift+J` | Toggle wake-word listening (chime confirms on/off) |
| `Ctrl+Shift+P` | Pause / resume playback |
| `Ctrl+Shift+O` | Pause-only (doesn't auto-resume on next clip) |
| `Ctrl+R` | Reload toolbar (same as Settings › Reload button) — use if the UI ever looks stuck |
| Say "hey jarvis" | Same as `Ctrl+Shift+S` on highlighted text |

### Wake word

Highlight text, say **"hey jarvis"**, hear it. The 30 MB model lives in `~/.terminal-talk/...` and runs entirely on CPU — no audio leaves your machine for wake-word detection.

Want a different wake word? Edit `WAKE_WORDS` in `~/.terminal-talk/app/wake-word-listener.py`. openWakeWord ships `hey_mycroft`, `hey_rhasspy`, `alexa`, `timer`, `weather`.

### The toolbar UI

```
╭──────────────────────────────────────────────────────────────────╮
│  ◀◀10  [▶]  10▶▶   ●━━━━━━━○━━━━━━━━━  1:23 / 2:10  🗑  ⚙  ✕   │  ← controls
│  ● ● ● | ● ● | ● ● ● ● ● ●                                       │  ← dot strip
╰──────────────────────────────────────────────────────────────────╯
                           ↑        ↑
                 run gap  —  different terminal
 • Oldest (plays first) on the left; newest on the right
 • Gaps between runs show which terminal spoke when
 • Idle 15 s → shrinks to a thin strip; hover to expand
```

- Each dot = one audio clip in the queue.
- **Dot colour = session colour** (matches the emoji at the bottom of that terminal). Muted sessions don't show dots at all.
- **Clips autoplay the moment they land.** Auto-prune clears played clips after 20 s by default (configurable 3-600 s, or toggle off if you're stepping away).
- **Currently playing** dot glows with a white pulsing halo (same size as the others — no layout jump).
- **Session tabs row** (above the dots) — when two or more terminals are active, a row of colour-pill tabs appears so you can filter the dot strip per terminal. Click a tab to see only that session's clips; click "All" to re-show everything. Each tab carries a small unread-count badge derived from the current queue state.
- **Click** a dot to (re)play it manually. **Right-click** to delete immediately.
- Clips for "hey jarvis" / `Ctrl+Shift+S` carry a small **J** label so you can tell them from auto-spoken Claude responses.
- Up to ~30 dots visible; beyond that the oldest drop off.
- **Drag the toolbar** near the top or bottom edge of any display and it snaps flush. Horizontal-only — no vertical dock. Position is saved across launches. If it ever ends up somewhere weird, `Ctrl+Shift+A` toggles it and the bar re-centres if it's off every display.
- **🗑 Clear played** — one-click removal of every heard clip (currently-playing clip is kept). A toast appears with a 10-second **Undo** window before the files are actually deleted from disk, so a misclick is never destructive. The `X` on the toast dismisses without restoring.

### Settings panel (gear icon)

Click the gear to expand the toolbar into a panel with:

- **Playback** —
  - **Speed slider** (0.5×–2.5×).
  - **Master volume** (0–100%). Drag live while a clip is playing. Heartbeat narration clips stay at 0.45× this value so the ambient-vs-content mix ratio is preserved at any master level.
  - **Auto-prune** on/off + seconds input (3–600 s). Applies to body clips only — tool narrations (T-prefixed) and heartbeat verbs (H-prefixed) always auto-delete on play-end regardless. Off = body clips stack up until you clear them manually.
  - **Auto-continue after clicking** — when a clip you clicked ends, chain forward through the remaining clips in time order. Default on. Turn off if you want one-clip-at-a-time click-to-replay.
  - **Colour-blind friendly palette** — swap the default 8-colour palette for Paul Tol's "muted" scheme, proven distinguishable under deutan / protan / tritan colour-blindness. Default palette stays for everyone else.
  - **Heartbeat ambient narration** — short spinner verbs ("Percolating", "Moonwalking") + thinking phrases ("Just a moment") played every ~8 s during the silent gap between you submitting a prompt and Claude's response starting. Stops the moment real response audio begins. Toggle here.
  - **Reload toolbar** button — rebuilds the UI from disk without restarting the Electron process. Same thing `Ctrl+R` does.
- **OpenAI (premium)** — collapsible. See [Premium TTS](#premium-tts-optional) below.
- **Sessions** — one row per active Claude Code session:
  - Coloured swatch + 8-character session ID.
  - Editable label (shows next to the emoji in that terminal's statusline).
  - **Colour dropdown** — 24 arrangements: 8 solid colours + 8 horizontal splits + 8 vertical splits, with complementary colour pairings on the splits so each is unambiguous. Pick anything; the change is instant on the toolbar and propagates to the statusline within a couple of seconds.
  - **Chevron** — expands to per-session voice and speech-includes overrides (see below).
- **About Terminal Talk** — banner + shortcuts cheat-sheet.

### Per-session overrides

Click the chevron on any session row to expand its per-session controls:

- **Voice for this session** — pick any of the 45 verified Edge TTS English voices. Two terminals open? Give them different voices and you'll _hear_ which one spoke without even looking. Leave on _"follow global default"_ to use the main voice.
- **Speech includes overrides** — seven tri-state toggles per session:

  | Toggle | What it controls |
  |---|---|
  | Code blocks | ` ```code``` ` blocks (content kept, fences and language tag stripped) |
  | Inline code | `` `code` `` spans (content kept, backticks stripped) |
  | URLs | bare `https://…` links |
  | Headings | `# Heading` lines |
  | Bullet markers | `- item` / `1. item` prefixes |
  | Image alt-text | `![alt text](url)` alt attribute |
  | Tool-call narration | Ephemeral spoken "Reading foo.py" / "Running npm test" clips during tool chains |

  Each toggle is **Default** (follow global), **On** (always speak), or **Off** (always skip). Saved to the session entry in `~/.terminal-talk/session-colours.json` and applied on the next turn — no restart needed.

### How session colours work

When a Claude Code terminal first interacts with Terminal Talk, the Stop hook (or statusline) registers it with the **lowest free colour index** in `~/.terminal-talk/session-colours.json`. The same hash informs both:

- The emoji at the bottom of the terminal (via Claude Code statusline).
- The dot colour on the toolbar.
- The colour of the **J** label on highlight-to-speak clips originating from that terminal.

Sessions only release their colour when the Claude Code process actually closes (and a 4-hour grace period elapses to absorb stale-PID windows). You can also pin a colour manually via the Sessions table dropdown — pinned colours never get reassigned.

When a "hey jarvis" / `Ctrl+Shift+S` fires from somewhere outside a Claude Code terminal (browser, PDF), the J dot renders **neutral grey**. From inside a Claude Code terminal, it inherits that terminal's colour.

---

## Three tiers

### 🆓 Free (default)

- **Wake word**: [openWakeWord](https://github.com/dscripka/openWakeWord) — MIT, offline, runs on CPU.
- **TTS**: [edge-tts](https://github.com/rany2/edge-tts) — Microsoft Edge's neural voices (45 verified English voices across UK, US, AU, IE, CA, IN, NZ, ZA, HK, SG, PH, NG, KE, TZ).
- No accounts. No API keys.

### 💳 Premium TTS (optional)

Add an [OpenAI API key](https://platform.openai.com/api-keys) for OpenAI TTS (`alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`). Use it as a fallback when edge-tts has a network wobble, or flip the preference so OpenAI is your primary voice and edge-tts becomes the fallback. ~$0.015 per 1,000 characters, billed directly by OpenAI.

**Easiest path — Settings panel:**
1. Click the gear, expand **OpenAI (premium)** (collapsible header with a chevron).
2. Paste your key into the password field, click **Save**. The input disappears once saved (a "Change key" link brings it back if you ever need to rotate).
3. Click **Test** to confirm it works — you'll hear a short phrase in the OpenAI voice.
4. Flip **Use OpenAI as primary** on to make OpenAI the default; leave it off to use OpenAI only as a fallback.

The key is stored encrypted via [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) (DPAPI on Windows, Keychain on Mac) at `~/.terminal-talk/openai_key.enc`. A user-ACL'd plaintext sidecar at `~/.terminal-talk/config.secrets.json` is written for the PowerShell hooks that can't reach safeStorage. Neither file is in `config.json` or git.

**Headless / advanced alternatives:**
- Environment variable `OPENAI_API_KEY=sk-...` (process-lifetime only)
- `~/.claude/.env` — existing Claude Code setup is auto-detected

### 🎙️ Voice-in + voice-out (bonus)

Install a speech-to-text tool from the [Companion dictation tools](#companion-dictation-tools-optional) table near the bottom. Say _"Claude, refactor this function"_ → Claude Code processes → Terminal Talk reads the answer back. Fully hands-free. When you activate your dictation tool mid-playback, Terminal Talk auto-pauses so you're not talking over yourself.

---

## Configuration

`~/.terminal-talk/config.json` (created on first install, preserved on re-install). Every field below has a UI control in the Settings panel — hand-editing the file is only needed for headless / scripted setups:

```json
{
  "voices": {
    "edge_clip":         "en-GB-SoniaNeural",
    "edge_response":     "en-GB-RyanNeural",
    "edge_question":     "en-GB-SoniaNeural",
    "edge_notification": "en-GB-RyanNeural",
    "openai_clip":       "shimmer",
    "openai_response":   "onyx"
  },
  "hotkeys": {
    "toggle_window":    "Control+Shift+A",
    "speak_clipboard":  "Control+Shift+S",
    "toggle_listening": "Control+Shift+J",
    "pause_resume":     "Control+Shift+P",
    "pause_only":       "Control+Shift+O"
  },
  "playback": {
    "speed":                     1.25,
    "master_volume":             1.0,
    "auto_prune":                true,
    "auto_prune_sec":            20,
    "auto_continue_after_click": true,
    "palette_variant":           "default",
    "tts_provider":              "edge"
  },
  "speech_includes": {
    "code_blocks":    false,
    "inline_code":    false,
    "urls":           false,
    "headings":       true,
    "bullet_markers": false,
    "image_alt":      false,
    "tool_calls":     true
  },
  "heartbeat_enabled": true,
  "openai_api_key": null
}
```

Key fields worth calling out:

- **`playback.master_volume`** (0.0–1.0, default 1.0) — master output volume. Heartbeat clips stay at 0.45× this value so the ambient mix ratio is preserved at any master level.
- **`playback.palette_variant`** (`"default"` | `"cb"`, default `"default"`) — swaps the 8-colour session palette for Paul Tol's "muted" scheme under deutan / protan / tritan colour-blindness.
- **`playback.tts_provider`** (`"edge"` | `"openai"`, default `"edge"`) — which TTS provider to try first. The other becomes the fallback on failure. Needs a saved `openai_api_key` (in safeStorage, NOT in this file) to set to `"openai"`.
- **`speech_includes.tool_calls`** (default `true`) — narrate each tool Claude is about to call as an ephemeral clip (e.g. _"Reading synth_turn.py"_, _"Running npm test --verbose"_, _"Searching for pattern"_). Plays at the PreToolUse hook, auto-deletes on play-end so long tool chains don't flood the dot strip.
- **`heartbeat_enabled`** (default `true`) — during the silent gap between submitting a prompt and hearing Claude's response, play short spinner-verb + thinking-phrase clips every ~8 s so you know Claude is working, not stuck. Mirrors the visible mascot word-cloud. Stops the moment real response audio begins.
- **`openai_api_key`** — always stays `null` in `config.json`. Real keys go through the Settings panel and land in the safeStorage-encrypted sidecar. Setting the key here directly still works but leaves it in plaintext on disk, so don't unless you know you need to.

Per-session overrides live in `~/.terminal-talk/session-colours.json` (managed by the toolbar UI, but you can edit by hand). Each session entry can have an optional `voice` and an optional `speech_includes` partial:

```json
{
  "assignments": {
    "abcd1234": {
      "index": 3,
      "label": "Frontend",
      "pinned": true,
      "voice": "en-US-AriaNeural",
      "speech_includes": { "code_blocks": true, "urls": false }
    }
  }
}
```

Restart the toolbar after editing config.json by hand:
```powershell
taskkill /F /IM terminal-talk.exe
wscript "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\terminal-talk.vbs"
```

---

## Privacy & Security

What Terminal Talk does:

| Action | Where it goes | Why |
|---|---|---|
| Wake-word detection | **Local only** (CPU, no network) | openWakeWord runs entirely offline. Audio is processed in-process and discarded. |
| TTS synthesis (free) | `speech.platform.bing.com` (Microsoft Edge TTS service) | The text being spoken is sent to Microsoft. Same endpoint Edge uses for "Read aloud." |
| TTS synthesis (premium) | `api.openai.com/v1/audio/speech` | Only if you've configured an OpenAI key. The text being spoken is sent to OpenAI. |
| Audio file storage | `~/.terminal-talk/queue/` | Local mp3/wav files. Auto-deleted 90s after manual play, or capped at 20 clips. |
| Session registry | `~/.terminal-talk/session-colours.json` + `~/.terminal-talk/sessions/<pid>.json` | Local-only. Tracks colour assignments and a short-lived per-PID file used to map foreground window → session. |
| Logs | `~/.terminal-talk/queue/_*.log` | Local-only diagnostic logs (toolbar, hook, voice listener). |
| Clipboard | Read locally during "hey jarvis" capture | Never sent anywhere except as TTS input above. |

What Terminal Talk does **not** do:
- No telemetry, analytics, error reporting, or "phone home" — anywhere in the codebase.
- No cloud account required (the free tier).
- No background recording or transcription. The wake-word listener processes 80 ms audio chunks locally and discards them.
- No modification of files outside `~/.terminal-talk/` and (if you opt in to hooks) `~/.claude/settings.json` (with backup).

**Permissions Terminal Talk needs:**
- Microphone access (for wake word).
- Network access to `speech.platform.bing.com` (TTS) and optionally `api.openai.com`.
- Read/write to `~/.terminal-talk/`.
- Write to `~/.claude/settings.json` (only at install/uninstall, with timestamped backup).
- Send Ctrl+C and Ctrl+Shift+S keystrokes to the foreground window (used to capture highlighted text after wake word).

---

## Self-cleanup watchdog

Terminal Talk polices itself so loose ends don't accumulate while it's running:

- **Single-instance lock** — at launch, if another Terminal Talk is already running (e.g. auto-start fired while you double-clicked the shortcut), the new process surfaces the existing window and exits immediately. You never end up with multiple main instances in Task Manager.
- **Startup sweep** — on every launch: prune audio files > 1 h old, delete `.partial` files > 60 s old (crash leftovers), drop session PID files whose PIDs are dead, and kill any orphan `wake-word-listener.py` Python process from a previous session that lost its parent.
- **Periodic sweep (every 30 min)** — the same three cleanup passes run automatically while the app is up. Each sweep appends one line to `~/.terminal-talk/queue/_watchdog.log` (`timestamp · pruned N audio, N session files · Xms`) so you can see it doing its job.
- **Mic teardown** — when wake-word listening is toggled off, the Python listener closes its `InputStream` (actually releasing the microphone at the driver level, not just muting input). The Electron side also orphan-sweeps before every listener spawn as belt-and-braces against a hot mic from a crashed previous session.

If anything ever feels "stuck", the watchdog log is the first place to look — `tail ~/.terminal-talk/queue/_watchdog.log`.

---

## Tests

A 686-test harness plus 28 Playwright E2E tests exercise the actual installed components:

```powershell
node terminal-talk/scripts/run-tests.cjs --verbose
```

Coverage:

- Palette: 24 arrangements all distinct, edge cases (wrap, negatives).
- Filename parsing: response, question, notification, clip (session-scoped + neutral).
- Statusline assignment: lowest-free-index, two distinct sessions get different colours, returning sessions keep their slot, label appended to emoji.
- Edge TTS wrapper: produces real mp3 from text input.
- Speech-includes (`stripForTTS`): 9 toggle behaviours including content preservation when "On".
- Voice list validation: every Edge voice in the dropdown actually exists in Microsoft's catalogue, defaults are valid.
- Per-session merge: 5-row truth table (true/false/null/missing/empty).
- Registry handling: no UTF-8 BOM written, BOM tolerance on read, voice + speech_includes + muted flag preserved through round-trip writes.
- Sentence splitter: abbreviation / URL / decimal protection, paragraph-break boundaries, short-merge, hard-split on over-long sentences.
- synth_turn orchestrator: transcript extraction, tool_use filtering, sanitisation with code_blocks toggle, questions-first extraction, sync state round-trip, mute skip.
- Pinned sessions: not pruned even if PID dead and `last_seen` stale.
- Install sanity: required files present, config parses.
- Self-cleanup watchdog: single-instance lock, 30-min sweep, orphan listener kill.

Tests are isolated from the live install — they use a tmp registry path so they can't race with your running statusline.

See [CONTRIBUTING.md](CONTRIBUTING.md) for adding new tests.

---

## How it works

```
                 "hey jarvis"                  highlight + Ctrl+Shift+S
                      │                                 │
                      ▼                                 │
         ┌───────────────────────┐                      │
         │  wake-word-listener   │  openWakeWord, CPU   │
         │       (Python)        │                      │
         └──────────┬────────────┘                      │
                    │ ctypes: Ctrl+Shift+S              │
                    ▼                                   ▼
         ┌─────────────────────────────────────────────────┐
         │  Electron main (globalShortcut)                  │
         │   ├─ sendCtrlC (via long-lived Python helper)    │
         │   ├─ poll clipboard for selection                │
         │   ├─ detectActiveSession (Win32 GetForeground +  │
         │   │     process tree walk, falls back to "most   │
         │   │     recently active session")                │
         │   ├─ stripForTTS (honours speech_includes)       │
         │   ├─ edge-tts (free, primary)                    │
         │   └─ fallback: OpenAI TTS                        │
         └─────────────────────────────────────────────────┘
                    │
                    ▼ writes .mp3/.wav
         ┌──────────────────────────┐
         │  ~/.terminal-talk/queue  │  fs.watch → renderer
         └──────────┬───────────────┘
                    ▼
         Floating toolbar autoplays, marks dot, auto-deletes after 90s

         Claude Code Stop hook (PowerShell) writes audio files into the same queue
         using the session's resolved voice and merged speech_includes.

         Claude Code statusline (PowerShell) reads the colour registry and emits
         the matching emoji + label per terminal.
```

The hook is the **single source of truth** for session colour assignment. The statusline reads the registry. The Electron main process reads the registry. No three-way race; one writer (with a fallback in the toolbar for sessions that haven't yet had a hook fire).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Wake word not detected | Check mic in Windows Sound settings. `tail ~/.terminal-talk/queue/_voice.log` for heartbeat scores (~0 = silence, ≥0.5 = fire). |
| Nothing plays after "hey jarvis" | First check the mic listener is on — `Ctrl+Shift+J` toggles it, and a chime confirms (high = on, low = off). If the mic is on and still nothing plays, `tail ~/.terminal-talk/queue/_toolbar.log`. Common causes there: edge-tts network wobble with no OpenAI fallback key, or the clipboard was empty when you said the wake word (highlight text before triggering). |
| Mic locked on, draining battery | `Ctrl+Shift+J` to stop the listener (high chime = on, low chime = off). |
| Hook not firing in Claude Code | Verify `~/.claude/settings.json` `Stop` hook command points to `$env:USERPROFILE\.terminal-talk\hooks\speak-response.ps1`. |
| Clipboard stays empty after "hey jarvis" | Some apps (very few) don't respond to programmatic Ctrl+C. Try a different app or `Ctrl+Shift+S` manually. |
| Dropdown text invisible (white-on-white) | Indicates Electron's `nativeTheme.themeSource` didn't apply on your build. Reinstall to update. |
| Two terminals on the same colour | Run `node terminal-talk/scripts/run-tests.cjs` — if statusline tests fail, edge-tts service is unreachable. If they pass, restart both terminals. |

---

## Uninstall

```powershell
.\uninstall.ps1
```

Stops running processes (only those in `~/.terminal-talk/`), removes the Startup shortcut, strips Terminal Talk hooks from `~/.claude/settings.json` (with timestamped backup), optionally deletes `~/.terminal-talk/`.

---

## Companion dictation tools (optional)

Terminal Talk is text-to-speech — Claude → audio. For the reverse
(your voice → Claude Code input) and fully hands-free use, pair it with a
dictation tool. A few options, ranked by free-tier generosity:

| Tool | Free tier | Paid | Platform | Notes |
|---|---|---|---|---|
| **[Wispr Flow](https://wisprflow.ai/)** | 2,000 words/wk | $12/mo | Mac, Win, iOS, Android | Best polish. Cloud only. |
| **Windows Speech Recognition** | Unlimited | Free | Windows | Built-in, no signup. Basic quality. |
| **Apple Dictation** | Unlimited | Free | Mac, iOS | Built-in. Decent on M1+. |

For light use (a few prompts/day) any free tier works. For heavy daily use you'll want one of the paid options or the OS built-ins.

Not affiliated with any of these.

---

## About the mascot

The orange four-legged character on the scrubber is a small homage to
[Claude Code](https://www.claude.com/product/claude-code). When Claude is
thinking, Claude Code shows a spinner line with a tongue-in-cheek verb —
"Moonwalking", "Finagling", "Pontificating", "Flibbertigibbeting" and
[~90 others](https://github.com/levindixon/tengu_spinner_words). Terminal
Talk uses a similar whimsical vocabulary (with credit) and attaches it to
a little character who walks along the scrubber while audio plays,
leaving random verbs from that list floating above his head. The mouth
is added because, unlike the Claude Code spinner, he actually speaks.

**He only appears when Claude Code is the source.** If you're playing a
highlight-to-speak clip (you said "hey jarvis" or pressed
<kbd>Ctrl+Shift+S</kbd>), the scrubber thumb is a plain **J** badge
instead — the mascot is reserved for audio that originated inside a
Claude Code session, so the visual identity stays tied to Claude-sourced
content.

No affiliation with Anthropic; this is a solo open-source project by an
enthusiastic Claude Code user. It's here because Claude Code's own sense
of humour is half the reason the tool is a joy to work with, and a bit
of that should live on the toolbar too.

**Trademark note:** "Claude" and "Claude Code" are trademarks of
Anthropic. This project uses neither name as its own and is not
affiliated with Anthropic.

---

## Credits

- [openWakeWord](https://github.com/dscripka/openWakeWord) — offline wake-word detection (MIT)
- [edge-tts](https://github.com/rany2/edge-tts) — Microsoft Edge TTS wrapper (LGPL-3.0)
- [Electron](https://www.electronjs.org/) — the floating toolbar runtime (MIT)
- Wake-word model `hey_jarvis_v0.1` © openWakeWord contributors
- Spinner vocabulary lifted from [levindixon/tengu_spinner_words](https://github.com/levindixon/tengu_spinner_words) — same list Claude Code uses while thinking. No affiliation with Anthropic; see the [About the mascot](#about-the-mascot) section for the why.

## Docs archives

Every minor release freezes the `docs/` tree at the time the first tag on that line was cut, so tag-linked documentation and README images don't rot when the docs on `main` move forward.

- [`docs/v0.2/`](docs/v0.2/) — v0.2 line snapshot (first seeded from `v0.2.0`).

The archival is automatic on tag push via [`.github/workflows/release.yml`](.github/workflows/release.yml); see [`scripts/archive-docs.sh`](scripts/archive-docs.sh) for the portable seed script (works on CI, macOS, Windows Git Bash).

## License

MIT. See [LICENSE](LICENSE).

Contributions welcome — Mac and Linux ports especially. See [CONTRIBUTING.md](CONTRIBUTING.md).
