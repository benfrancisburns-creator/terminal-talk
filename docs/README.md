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
├── ui-kit/                         React component recreation
│   ├── README.md                   what's in the kit
│   ├── index.html                  interactive demo
│   ├── palette.js                  the 24-arrangement palette (mirrors app/renderer.js)
│   ├── Toolbar.jsx                 the 680 × 44 letterbox bar
│   ├── Dot.jsx                     coloured dot (solid / hsplit / vsplit + states)
│   ├── IconButton.jsx              round button
│   ├── Scrubber.jsx                rail + thumb
│   ├── SettingsPanel.jsx           the expandable panel
│   ├── SessionsTable.jsx           per-session rows
│   ├── AsciiBanner.jsx             About-section ASCII art
│   ├── icons.jsx                   inline SVG icons
│   └── kit.css                     component styles
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
- **UI kit** — drop into a React app to recreate the toolbar without rebuilding it from scratch.

## In lock-step with the source

The palette in `ui-kit/palette.js` is verbatim from `app/renderer.js` (24 arrangements, 8 base colours, complementary split pairings). If you change one, change the other — there's a regression test in `scripts/run-tests.cjs` that fails when they drift.

## Adding screenshots

When you have real product screenshots, drop them into `docs/screenshots/` with descriptive filenames (`toolbar-idle.png`, `toolbar-three-sessions.png`, etc.) and reference them from the top-level README. To refresh the rendered mock PNGs, run the Chrome-headless render against `design-system/mocks-annotated.html`.
