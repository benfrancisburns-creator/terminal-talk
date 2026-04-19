# Terminal Talk — App UI Kit

Pixel-fidelity recreation of the Electron toolbar + settings panel. Components are split so designers can mix and match.

- `index.html` — interactive demo: bar collapsed → click gear → panel expands with live sessions table and playback controls. A background button adds fake audio clips so you can see the dots flow.
- `Toolbar.jsx` — the 680×44 letterbox bar.
- `Dot.jsx` — the coloured dot (solid / hsplit / vsplit, + clip / active / heard states).
- `IconButton.jsx` — 28px round button wrapper (handles `play` and `close` variants).
- `Scrubber.jsx` — rail + thumb + halo on hover.
- `SettingsPanel.jsx` — the expandable panel below the bar.
- `SessionsTable.jsx` — per-session rows with expandable per-session controls.
- `AsciiBanner.jsx` — the "About" ASCII art block.
- `icons.jsx` — the 11 inline SVG icons.
- `palette.js` — the 24-arrangement colour system (8 solid + 8 hsplit + 8 vsplit, complementary pairs) — lifted from `app/renderer.js`.

Design width of `index.html`: 720px (680 bar + 20 margins). Above-fold height: 640px.
