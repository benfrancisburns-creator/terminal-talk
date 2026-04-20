# Terminal Talk — App UI Kit

Pixel-fidelity recreation of the Electron toolbar + settings panel. Components are split so designers can mix and match.

- `index.html` — interactive demo: bar collapsed → click gear → panel expands with live sessions table and playback controls. A background button adds fake audio clips so you can see the dots flow.
- `Toolbar.jsx` — the 680×~114 two-row bar (controls on top, clip-queue dot strip below).
- `Dot.jsx` — the coloured dot (solid / hsplit / vsplit, + clip / active / heard states).
- `IconButton.jsx` — 28px round button wrapper (handles `play` and `close` variants).
- `Scrubber.jsx` — rail + thumb + halo on hover.
- `SettingsPanel.jsx` — the expandable panel below the bar.
- `SessionsTable.jsx` — per-session rows with mute / focus / × and expandable per-session controls.
- `AsciiBanner.jsx` — the "About" ASCII art block.
- `icons.jsx` — 13 inline SVG icons (back10, fwd10, play, pause, clear, settings, close, chevron-right/down, mute, unmute, star-empty, star-filled).
- `palette.js` — the 24-arrangement colour system (8 solid + 8 hsplit + 8 vsplit, complementary pairs) — imports from `tokens.mjs`, which is generated from `app/lib/tokens.json` so the kit can't drift from the renderer.
- `tokens.mjs` — generated. Do not hand-edit. Rebuild with `node scripts/generate-tokens-css.cjs`.

### Toolbar geometry

The bar is 680 px wide and **two rows tall** (~114 px):

| Row | Height | Contents |
|---|---|---|
| `.tt-bar-top` | 36 px | Back10 · Play/Pause · Fwd10 · Scrubber · Time · Clear · Settings · Close |
| gap | 4 px | (flex gap) |
| `.tt-dots-row` | 44 px | Clip queue — left-aligned, overflow visible so the active dot's pulse halo isn't clipped |
| padding | 6 px top / 8 px bottom | |

Sessions row is a 7-column grid: chevron · swatch · short · label · colour select · focus ☆/★ · mute 🔊/🔇 · remove ×.

Design width of `index.html`: 720 px (680 bar + 20 margins). Above-fold height: 640 px.
