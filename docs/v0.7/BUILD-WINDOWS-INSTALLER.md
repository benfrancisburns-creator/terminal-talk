# Building the Windows installer

Terminal Talk ships an `electron-builder` config in `app/package.json` so the same source tree that supports `git clone` + `.\install.ps1` can also produce a packaged Windows installer (`Terminal Talk-Setup-<version>.exe`) and a portable `.exe` for users who don't want to install at all.

This is the path that lets the landing page's "Download for Windows" CTA actually deliver a download.

## Prerequisites

- Windows 10/11 (electron-builder needs Windows to produce signed-shape installer artefacts even though it can cross-compile for partial cases)
- Node.js 18+
- Python 3.10+ (only required if you want the installer to bundle the wake-word model — for a code-only installer, Python isn't needed at build time)

## First-time setup

```powershell
cd app
npm install
```

This pulls in `electron` 41.2.1 + `electron-builder` 25.x. Allow ~80 MB.

## Build commands

```powershell
# Quick unpacked build — no installer, just the app folder. Good for testing.
npm run pack

# Full NSIS installer (.exe with setup wizard).
npm run build:winnsis

# Full portable build (single .exe, no install required).
npm run build:winportable

# Both NSIS + portable in one go.
npm run build:win
```

Output lands in `<repo-root>/dist/`:

```
dist/
├── Terminal Talk-Setup-0.6.0.exe        # NSIS installer
├── Terminal Talk-Portable-0.6.0.exe     # Single-file portable
├── win-unpacked/                         # Unpacked app for `npm run pack`
└── builder-effective-config.yaml         # electron-builder's resolved config
```

`dist/` is gitignored.

## Branding (icon, banner)

The build expects `build-resources/` at the repo root for branding assets:

- `build-resources/icon.ico` — Windows installer + window icon (256x256, multi-resolution)
- `build-resources/installerIcon.ico` — overrides the installer EXE icon
- `build-resources/uninstallerIcon.ico` — overrides the uninstaller icon
- `build-resources/installerHeader.bmp` — top banner of the NSIS installer (150×57)
- `build-resources/installerSidebar.bmp` — left sidebar on the welcome page (164×314)

If any of these are missing, electron-builder uses sensible defaults (the Electron logo). Replace before any public release.

## What's NOT done yet

This config produces an **unsigned** installer. Windows SmartScreen will flag every install with "Windows protected your PC." Users see "More info → Run anyway" — same friction the current README documents.

To remove SmartScreen friction, the installer needs to be code-signed with one of:

1. **EV Code Signing certificate** — ~£200/year, requires a registered business + identity verification, USB token shipped physically. Highest reputation immediately.
2. **Azure Trusted Signing** — Microsoft's managed signing service, ~£10/month, no USB token, works once your Microsoft Entra tenant + business verification clears (1–4 weeks). Cheapest path to no-SmartScreen.
3. **Standard Code Signing** (non-EV) — ~£60/year, but reputation accrues only after enough installs, so SmartScreen still warns for the first ~90 days. Generally not worth the price.

Recommended path: Azure Trusted Signing post-funding.

When signing is configured, add to `app/package.json`'s `build.win` block:

```json
"signtoolOptions": {
  "signingHashAlgorithms": ["sha256"],
  "publisherName": "Ben Burns"
}
```

…and provide cert detail via env vars (`CSC_LINK`, `CSC_KEY_PASSWORD`) at build time. See [electron-builder code-signing docs](https://www.electron.build/code-signing).

## Wiring to the GitHub release pipeline

Today `release.yml` only archives the `docs/` folder. To attach a built installer to each tagged release, add a Windows-runner job that:

1. `npm install` (in `app/`)
2. `npm run build:win`
3. Uploads `dist/Terminal Talk-Setup-<version>.exe` and `dist/Terminal Talk-Portable-<version>.exe` to the release using `softprops/action-gh-release@v2` or similar.

Don't enable this until you've successfully run a local `npm run build:winnsis` and verified the `.exe` actually installs and launches the toolbar — electron-builder configs have non-obvious failure modes that are easier to debug locally than in CI.

## Sanity checklist before a public download

- [ ] `npm run build:winnsis` produces a working `.exe`
- [ ] Installing it lays down `%USERPROFILE%\.terminal-talk\` with the Electron app
- [ ] First-run welcome toast appears (proves config first_run_completed wiring is intact in the packaged build)
- [ ] Ctrl+Shift+S highlight-to-speak works (proves Python + edge-tts are bundled)
- [ ] The toolbar shows the right version in Settings → About
- [ ] Uninstaller runs cleanly via Settings → Apps
- [ ] SmartScreen warning is documented in the download page (until signing is in place)
- [ ] Installer is attached to the matching `vX.Y.Z` GitHub release before `docs/index.html` "Download for Windows" CTA is repointed at it
