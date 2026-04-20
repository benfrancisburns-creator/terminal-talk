# Terminal Talk — design assets

Visuals, UI kit, and design-system reference for Terminal Talk.

## Layout

```
docs/
├── README.md                       this file
├── LAUNCH.md                       Show HN / launch playbook
├── DESIGN-AUDIT.md                 research-backed UI audit
├── index.html                      GitHub Pages landing site
│
├── assets/
│   ├── wallpaper/                  primary brand artwork
│   │   ├── terminal-talk-wallpaper.png   1280×800 PNG — README hero
│   │   └── README.md                     regeneration instructions
│   ├── logo/
│   │   └── favicon-32.svg          favicon used by the GitHub Pages site
│   ├── icons.svg                   inline SVG icon set used in the app
│   └── ascii-banner.txt            ASCII "TERMINAL TALK" block art
│
├── design-system/                  self-contained HTML reference pages
│   ├── architecture.html           how the pieces fit
│   ├── colors-foreground.html      UI text + bg colour tokens
│   ├── colors-session.html         the 24-arrangement dot palette
│   ├── components-dots.html        all dot states
│   ├── component-toolbar.html      the toolbar pill
│   ├── component-sessions-row.html   one session row, expanded
│   ├── components-iconbuttons.html   the 28 px round icon buttons
│   ├── components-forms.html       input / select / checkbox styling
│   ├── mocks-annotated.html        four annotated UI mocks (see below)
│   ├── radii-spacing.html          border radii + spacing scale
│   ├── shadows.html                shadow tokens
│   ├── type-ui.html                UI typography scale
│   ├── type-mono.html              monospace typography (kbd, code)
│   └── wordmark.html               wordmark presentation
│
├── ui-kit/                         live demo — iframes app/renderer.js
│   ├── README.md                   what's in the kit
│   ├── index.html                  interactive demo shell
│   ├── mock-ipc.js                 in-memory window.api stub + 5 seeds
│   ├── kit-chrome.css              purple-gradient demo backdrop
│   └── tokens.mjs                  generated ESM palette (for any hand-rolled consumer)
│
└── screenshots/                    rendered product shots (PNG)
    └── ...                         (mock renders from mocks-annotated.html)
```

## How these are used

- **README hero** — `docs/assets/wallpaper/terminal-talk-wallpaper.png` — the 1280 × 800 wallpaper with coloured ASCII "TERMINAL TALK", pixel mascot and "HEY TT" speech bubble. Regeneration instructions live in `assets/wallpaper/README.md`.
- **Repo social card** — the same wallpaper PNG doubles as the GitHub OG image; set it in repo **Settings → Social preview** to override the default.
- **Favicon** — `favicon-32.svg`, used by the GitHub Pages landing site.
- **Design-system pages** — open the `.html` files directly in a browser. Each is self-contained.
- **Annotated mocks** — `design-system/mocks-annotated.html` renders four live HTML/SVG mockups of the toolbar (Idle / Three sessions / Mixed states / Settings panel open) with annotations to the right of each. Rendered PNG versions are embedded in the top-level README. The source HTML trails the shipping UI — newer features (focus mode, auto-prune toggle, pause hotkeys, per-session mute) may not be represented yet.
- **UI kit** — open `ui-kit/index.html` in a browser. The page loads the real `app/renderer.js` with an in-memory mock of the Electron IPC surface, so every demo is the shipping behaviour: four-tier playback precedence, real auto-prune timing, real `renderSessionsTable` with focus bail and palette classes, real Constructable Stylesheet for mascot position. Audio playback is the one thing that doesn't work — the mock paths aren't real files — but every visual + interaction is genuine.

## In lock-step with the source

After D2-3 the kit IS the source: its `index.html` loads `../../app/renderer.js` verbatim. The generated `tokens.mjs` is retained for any external hand-rolled consumer (e.g. a plugin) — a drift test in `scripts/run-tests.cjs` asserts it stays byte-identical to `app/lib/tokens.json`. Palette class rules consumed via `data-palette` attribute come from the generated `app/lib/palette-classes.css`.

## Adding screenshots

When you have real product screenshots, drop them into `docs/screenshots/` with descriptive filenames (`toolbar-idle.png`, `toolbar-three-sessions.png`, etc.) and reference them from the top-level README. To refresh the rendered mock PNGs, run the Chrome-headless render against `design-system/mocks-annotated.html`.
