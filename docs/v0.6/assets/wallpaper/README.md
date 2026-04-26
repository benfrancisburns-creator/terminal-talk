# Terminal Talk wallpaper

A 1280×800 desktop wallpaper in the project's brand colours — coloured
ASCII "TERMINAL TALK" over the dark glass background, with the mascot
and a pixel-cloud speech bubble.

## Files

- [`terminal-talk-wallpaper.png`](terminal-talk-wallpaper.png) — ready-to-use PNG (400 KB)
- [`terminal-talk-wallpaper-bg.jpg`](terminal-talk-wallpaper-bg.jpg) — mascot-free variant, base64-embedded inside `docs/assets/terminal-talk-hero.svg` (the animated composite used in `README.md`). Regenerate with `node scripts/render-hero-background.cjs` after editing `scripts/wallpaper-bg.html`, then `node scripts/build-hero-svg.cjs`.
- [`../../../scripts/wallpaper.html`](../../../scripts/wallpaper.html) — source HTML if you want to regenerate at a different resolution

## Set it as your desktop (Windows)

1. Download [the PNG](terminal-talk-wallpaper.png)
2. Right-click → Set as desktop background

## Regenerate at a different size

```powershell
# From the repo root:
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --headless=new --disable-gpu --hide-scrollbars `
  --window-size=1920,1080 `
  --screenshot=wallpaper-1920.png `
  "file:///$PWD\scripts\wallpaper.html"
```

Swap `1920,1080` for your screen's native resolution. The HTML layout
is based on a 1280×800 canvas — scaling up will enlarge text and the
mascot proportionally but may introduce anti-aliasing on the pixel-art
cloud. For best results at other sizes, edit the CSS dimensions to
match your target resolution.
