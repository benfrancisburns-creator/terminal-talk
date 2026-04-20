# Terminal Talk — App UI Kit

**Post D2-3**: this folder is no longer a parallel React reimplementation. `index.html` loads `../../app/renderer.js` verbatim with an in-memory `window.api` mock — the kit IS the shipping renderer, driven by a fake IPC. Any product change automatically propagates to the demo; no drift possible.

## Files

- `index.html` — the demo shell. Mounts the same DOM `app/index.html` has (by-id elements `bar`, `audio`, `dots`, `playPause`, `scrubber`, `scrubberMascot`, `scrubberJarvis`, `time`, `sessionsTable`, `speedSlider`, etc.), loads `../../app/styles.css` + `../../app/lib/palette-classes.css` + local `kit-chrome.css`, then the scripts in this order: tokens-window.js → voices-window.js → `mock-ipc.js` → `../../app/renderer.js`.
- `mock-ipc.js` — installs `window.api` with 16 invoke handlers (`getQueue`, `deleteFile`, `hideWindow`, `getConfig`, `getStaleSessions`, `updateConfig`, `setSession*`, `removeSession`, `setClickthrough`, `setPanelOpen`, `logRendererError`) and 8 event channels (`queue-updated`, `priority-play`, `clipboard-status`, `listening-state`, `force-expand`, `set-orientation`, `toggle-pause-playback`, `pause-playback-only`). Adds an "Add fake clip / Clear queue / Toggle panel" control bar below the toolbar.
- `kit-chrome.css` — purple-gradient demo backdrop + control bar styling. Overrides the two `position: fixed` rules on `.bar` / `.panel` so they flow normally in the demo page.
- `tokens.mjs` — **generated, do not hand-edit**. ESM export of `app/lib/tokens.json` for any external hand-rolled consumer. Rebuild via `node scripts/generate-tokens-css.cjs`; a drift test in `scripts/run-tests.cjs` fails if it goes out of sync with the JSON source.

## URL parameters

Both used by `docs/design-system/mocks-annotated.html` and `docs/design-system/components.html` when iframing this page:

- `?seed=<name>` — picks the preset initial state. Valid: `idle`, `three-sessions`, `mixed-states`, `settings-panel`, `snapped-top`. Default: `three-sessions`.
- `?chrome=0` — hides the "Add fake clip" control bar so iframed contexts render cleanly.

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
