# Terminal Talk — App UI Kit

**Post D2-3**: this folder is no longer a parallel React reimplementation. `index.html` loads `../../app/renderer.js` verbatim with an in-memory `window.api` mock — the kit IS the shipping renderer, driven by a fake IPC. Any product change automatically propagates to the demo; no drift possible.

## Files

- `index.html` — the demo shell. Mounts the same DOM `app/index.html` has (by-id elements `bar`, `audio`, `dots`, `playPause`, `scrubber`, `scrubberMascot`, `scrubberJarvis`, `time`, `sessionsTable`, `speedSlider`, `volumeSlider`, etc.), loads `../../app/styles.css` + `../../app/lib/palette-classes.css` + local `kit-chrome.css`, then the scripts in this order: tokens-window → voices-window → clip-paths → heartbeat → component → stale-session-poller → dot-strip → tabs → sessions-table → settings-form → audio-player → `mock-ipc.js` → `../../app/renderer.js`.
- `mock-ipc.js` — installs `window.api` with the full 22-channel IPC surface (`getQueue`, `getConfig`, `getStaleSessions`, `getOpenAiKeyStatus`, `testOpenAiVoice`, `getWorkingSessions`, `getVersion`, `updateConfig`, `setSession*`, `removeSession`, `deleteFile`, `hideWindow`, `setClickthrough`, `setPanelOpen`, `logRendererError`, `reloadRenderer`, `speakHeartbeat`) plus 10 event channels (`queue-updated`, `priority-play`, `clipboard-status`, `listening-state`, `force-expand`, `set-orientation`, `toggle-pause-playback`, `pause-playback-only`, `mic-captured-elsewhere`, `mic-released`). Adds an "Add fake clip / Clear queue / Manual replay demo / Transcript / Collapsed signal / Toggle panel / Reset" control bar below the toolbar.
- `kit-chrome.css` — purple-gradient demo backdrop + control bar styling. Overrides the two `position: fixed` rules on `.bar` / `.panel` so they flow normally in the demo page.
- `tokens.mjs` — **generated, do not hand-edit**. ESM export of `app/lib/tokens.json` for any external hand-rolled consumer. Rebuild via `node scripts/generate-tokens-css.cjs`; a drift test in `scripts/run-tests.cjs` fails if it goes out of sync with the JSON source.

## URL parameters

Both used by `docs/design-system/mocks-annotated.html` and `docs/design-system/components.html` when iframing this page:

- `?seed=<name>` — picks the preset initial state. Default: `three-sessions`. Valid:

  | seed | what it shows |
  |---|---|
  | `idle` | empty queue, panel closed, no sessions |
  | `three-sessions` | A A A — B B B — C C run-clustered queue, oldest playing |
  | `mixed-states` | heard + playing + queued + J-clip across four sessions |
  | `settings-panel` | 3 sessions, panel open — good for Playback-section shots |
  | `snapped-top` | two sessions, visually docked to the top edge |
  | `tabs-active` | 3 labelled sessions — the tabs row pops with unread badges |
  | `settings-panel-openai-unset` | panel open, OpenAI tab, password input visible |
  | `settings-panel-openai-saved` | panel open, OpenAI tab, compact saved-key row visible |
  | `settings-panel-sessions-expanded` | panel open, first session row auto-expanded — voice dropdown + 7 tri-state toggles visible |
  | `heartbeat` | queue mixing body + `H-` prefix ephemeral clips |
  | `collapsed-signal` | forced collapsed letterbox signal using a split palette |

- `?chrome=0` — hides the "Add fake clip" control bar so iframed contexts render cleanly.
- `?mockAudioMs=<milliseconds>` — controls the silent mock clip duration. With visible kit chrome the default is 4500 ms so humans can see auto-played, active, and manual replay states; with `chrome=0` the default stays 200 ms for screenshot capture speed. Landing-page explainers can use a long value such as `45000` to hold the current clip while users click around.
- `?demoHoldOpen=1` — keeps the product renderer's normal toolbar geometry but feeds it a longer mock collapse delay so landing-page demos do not shrink while someone is reading.
- `?demoCollapsed=1&demoCollapsedPalette=16` — forces the product renderer into the animated collapsed letterbox state for inspection. Use with `seed=collapsed-signal`.
- Visible kit chrome also defaults to `windowMode=1` and stretches the collapse delay to 60 s, so the toolbar stays inspectable while you click around. Hidden capture frames keep the product default, unless `windowMode=1` is supplied. `demoCollapsed=1` intentionally bypasses the default window mode.

### Screenshot recipes

The kit is the source of truth for README images — rather than
taking live-app screenshots, load the kit with the right seed and
grab the frame. Images stay pixel-identical to what ships, and a
product change automatically updates the kit on next sync.

| docs/screenshots/ file | seed to load |
|---|---|
| `toolbar-idle.png` | `idle` |
| `toolbar-three-sessions.png` | `three-sessions` |
| `toolbar-mixed-states.png` | `mixed-states` |
| `toolbar-settings-panel.png` | `settings-panel` |
| `toolbar-snapped-top.png` | `snapped-top` |
| `toolbar-tabs-with-sessions.png` | `tabs-active` |
| `toolbar-resting-with-tabs.png` | `tabs-active` |
| `toolbar-transcript-expanded.png` | `tabs-active` + transcript expanded |
| `toolbar-openai-section-saved.png` | `settings-panel-openai-saved&settingsScrollTarget=openai` |
| `toolbar-openai-section-unset.png` | `settings-panel-openai-unset` |
| `toolbar-sessions-panel-expanded.png` | `settings-panel-sessions-expanded` |
| `toolbar-heartbeat.png` | `heartbeat` |
| `toolbar-create-session-tab.png` | `settings-panel&settingsScrollTarget=create-session` |
| `toolbar-shortcuts-tab.png` | `settings-panel&settingsScrollTarget=shortcuts` |
| `toolbar-about-tab.png` | `settings-panel&settingsScrollTarget=about` |
| `toolbar-collapsed-resting.png` | synthetic collapsed resting strip |
| `toolbar-collapsed-signal-horizontal.png` | synthetic collapsed state using product `.collapsed-signal` CSS, palette 20 |
| `toolbar-collapsed-signal-vertical.png` | synthetic collapsed state using product `.collapsed-signal` CSS, palette 11 |

## What works / what doesn't

- ✅ Every visual: bar geometry, dot colours + states, session row 7-column grid, focus ★, mute 🔊/🔇, × remove, scrubber mascot walk, spinner words, collapse-on-idle, settings panel open/close, palette dropdown, voice dropdown, speech-includes tri-state.
- ✅ Every interaction: click a dot, right-click to remove, click focus to promote, click mute to silence a session, edit a label, change a palette index, toggle auto-prune, adjust speed slider. All driven by the real `renderer.js` code paths.
- ✅ Real timing: auto-prune countdown, rolling-release queue ordering, drag-snap threshold logic, four-tier playback precedence.
- ❌ **Audio playback**. `fileUrl(path)` returns `file:///…` but the mock's "paths" are fake filenames, not real MP3s on disk. The audio element fires `error` and the renderer skips to next. Everything visual still works; only sound is absent. For real audio, run the Electron app.

## Toolbar geometry reference

The bar is 680 px wide and two rows tall (~114 px):

| Row | Height | Contents |
|---|---|---|
| `.bar-top` | 36 px | Back10 · Play/Pause · Fwd10 · Scrubber · Time · Clear · Settings · Close |
| gap | 4 px | (flex gap) |
| `.dots-row` | 44 px | Clip queue — left-aligned, overflow visible so the active dot's pulse halo isn't clipped |
| padding | 6 px top / 8 px bottom | |

Sessions row is a 7-column grid: chevron · swatch · short · label · colour select · focus ☆/★ · mute 🔊/🔇 · remove ×.

Design width of `index.html`: 720 px (680 bar + 20 margins). Above-fold height: 640 px.

## Adding a new seed

1. Edit `SEEDS` in `mock-ipc.js` — add a new case in `buildSeed(name)` returning `{ queueFiles, sessions, staleShorts?, panelOpen? }`.
2. Add the seed name to the list in `index.html`'s URL-param comment block.
3. If the mocks-annotated or components pages want it, update their iframe srcs.

## Why D2-3 matters

Before D2-3, the kit was 8 JSX files + `palette.js` + `kit.css` — a parallel React implementation that had to be manually kept in sync with `app/renderer.js`. Pass-1 §8b flagged this as "the wrong abstraction". Every product change risked kit drift, which pass-1 §1a–§1d caught the kit failing at (palette encoding wrong in 9 of 16 slots, toolbar geometry wrong, three headline features missing).

After D2-3, the kit can't drift because it's literally the same code running. The list below used to be "implement in the kit too when you add to the product":

- Four-tier playback precedence (priority → focus → pending → fallback) in `playNextPending()`
- Hey-jarvis placeholder dot (R6.3)
- Auto-prune scheduler (`scheduleAutoDelete`) with 30 s / 90 s paths
- Stale-session greying poll (`pollStaleSessions`, A6)
- Rolling-release in-order monotonic-mtime audio queue
- Drag-to-snap with 20 px edge threshold
- Palette-index CSS applied via `data-palette` (D2-9)

All of these now appear in the kit for free whenever `app/renderer.js` runs.
