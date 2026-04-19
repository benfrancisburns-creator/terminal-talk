# Terminal Talk — design assets

Visuals, UI kit, and design-system reference. Generated via Claude Design from the live source code, so colours and dimensions stay in lock-step with the product.

## Layout

```
docs/
├── README.md                      this file
├── assets/
│   ├── logo/                      brand marks (SVG)
│   │   ├── lettered-dots-banner-1200x400.svg     primary README hero
│   │   ├── lettered-dots-social-1200x630.svg     OG / social card
│   │   ├── lettered-dots-square-1024.svg         square logo @1024
│   │   ├── lettered-dots-square-512.svg          @512
│   │   ├── lettered-dots-square-256.svg          @256
│   │   ├── wordmark-pill-1024.svg                wordmark inside a pill
│   │   ├── dots-pill-1024.svg                    secondary 4-dot pill icon
│   │   ├── dots-banner-1200x240.svg              wide dots banner
│   │   ├── banner-1200x400.svg                   alt banner variant
│   │   └── favicon-32.svg                        favicon
│   ├── icons.svg                  inline SVG icon set used in the app
│   ├── wordmark.svg               flat wordmark
│   └── ascii-banner.txt           the README ASCII art block
│
├── design-system/                 self-contained HTML reference pages
│   ├── architecture.html          how the pieces fit
│   ├── colors-foreground.html     UI text + bg colour tokens
│   ├── colors-session.html        the 24-arrangement dot palette
│   ├── components-dots.html       all dot states
│   ├── component-toolbar.html     the toolbar pill
│   ├── component-sessions-row.html  one session row, expanded
│   ├── components-iconbuttons.html  the 28px round icon buttons
│   ├── components-forms.html      input / select / checkbox styling
│   ├── logo-lettered-dots.html    primary mark exploration
│   ├── logo-wordmark-pill.html    wordmark variant
│   ├── logo-exploration.html      alternative ideas considered
│   ├── mocks-annotated.html       four annotated UI mocks
│   ├── radii-spacing.html         border radii + spacing scale
│   ├── shadows.html               shadow tokens
│   ├── type-ui.html               UI typography scale
│   ├── type-mono.html             monospace typography (kbd, code)
│   └── wordmark.html              wordmark presentation
│
├── ui-kit/                        React component recreation
│   ├── README.md                  what's in the kit
│   ├── index.html                 interactive demo
│   ├── palette.js                 the 24-arrangement palette (mirrors app/renderer.js)
│   ├── Toolbar.jsx                the 680×44 letterbox bar
│   ├── Dot.jsx                    coloured dot (solid / hsplit / vsplit + states)
│   ├── IconButton.jsx             round button
│   ├── Scrubber.jsx               rail + thumb
│   ├── SettingsPanel.jsx          the expandable panel
│   ├── SessionsTable.jsx          per-session rows
│   ├── AsciiBanner.jsx            About-section ASCII art
│   ├── icons.jsx                  inline SVG icons
│   └── kit.css                    component styles
│
└── screenshots/                   in-product screenshots (PNG)
    └── early-mock.png             early Claude Design iteration
```

## How these are used

- **README hero** — `<img src="docs/assets/logo/lettered-dots-banner-1200x400.svg">` at the top.
- **Repo social card** — `lettered-dots-social-1200x630.svg`, set in repo Settings → Social preview.
- **Favicon** — `favicon-32.svg` (used by the GitHub Pages landing site).
- **Design-system pages** — open the `.html` files directly in a browser. Each is self-contained.
- **UI kit** — drop into a React app to recreate the toolbar without rebuilding it from scratch.

## In lock-step with the source

The palette in `ui-kit/palette.js` is verbatim from `app/renderer.js` (24 arrangements, 8 base colours, complementary split pairings). If you change one, change the other — there's a regression test in `scripts/run-tests.cjs` that fails when they drift.

## Adding screenshots

When you have real product screenshots, drop them into `docs/screenshots/` with descriptive filenames (`toolbar-idle.png`, `toolbar-three-sessions.png`, etc.) and reference them from the README usage section.
