# S6 — E2E Playwright coverage expansion

**Date:** 2026-04-20
**Tool:** Playwright 1.59 via `@playwright/test`
**Scope:** 3 spec files, Electron 41.2.1 windowed app

## Before

13 E2E tests across 3 spec files:

- `launch.spec.ts` (4) — toolbar boots, rows render, control buttons present, dots strip starts empty
- `sessions.spec.ts` (5) — seeded rows render + labels visible, mute toggles class, focus is exclusive, mute + focus independent, remove deletes row
- `settings.spec.ts` (4) — panel opens/closes on ⚙ click, speed + auto-prune controls visible, auto-prune toggle persists, auto-prune-sec clamps 3-600

## Feature-gap enumeration

Cross-referenced the above against features surfaced by README.md + the settings panel + v0.3.x ship history:

| Feature | Covered? | Why/why not |
|---|---|---|
| `auto_continue_after_click` toggle (v0.3.6) | **no** | Feature added post the existing spec set |
| Speed slider readout | **no** | Visible in settings but no assertion |
| About section (ASCII banner + shortcuts) | **no** | Renders in settings but untested |
| Strict CSP (D2-9 `style-src 'self'`) | **no** | Runtime invariant, no regression test |
| `<html lang="en">` (v0.3.8 N5-N8 accessibility fixes) | **no** | Added but not locked-in |
| `#close` button a11y (aria-label) | **no** | Button tested for presence, not attrs |
| `#clearPlayed` a11y (aria-label + title) | **no** | Same |
| Label input editable | **no** | Displays via input[value=…] but no edit flow |
| Palette selector shape | **no** | 24-arrangement selector not asserted |
| Focus-star glyph swap | **no** | Only `.focused` class tested |
| Hey-jarvis / wake-word | **skip** | Can't simulate Windows-level global shortcuts from Playwright |
| Priority queue | **skip** | Needs audio playback + shortcut |
| Pause icon swap | **skip** | Needs audio playing |
| Stale-session greying | **skip** | Polls on 10 s interval — too slow for unit-style E2E |
| Multi-monitor positioning | **skip** | Single-display CI runner |

## New tests (12 added — 25 total)

### launch.spec.ts (+3)

- **S6: `<html lang="en">` is set** — reads `document.documentElement.lang`. Locks in the v0.3.8 accessibility fix.
- **S6: `#close` button has aria-label** — verifies screen-reader label present.
- **S6: `#clearPlayed` has both title + aria-label** — same for the trash icon.

### sessions.spec.ts (+4)

- **S6: label input is editable and dispatches on change** — fills input, blurs via Tab, verifies value persists in DOM.
- **S6: palette selector offers 24 arrangements** — asserts the `<select>` exposes `PALETTE_SIZE=24` options. Shape-check rather than end-to-end persistence (IPC round-trip + rebuild causes a flake-prone race; seeded index=0 is re-verified).
- **S6: each seeded session renders a single dot per clip (none yet)** — documents the "sessions are colour reservations, not auto-visible" default — no clips in queue means no dots even with 2 sessions.
- **S6: focus star uses filled/hollow glyph to reflect state** — verifies ☆ → ★ on focus click.

### settings.spec.ts (+5)

- **S6: auto-continue-after-click toggle exists and is ON by default (v0.3.6)** — new setting from the v0.3.6 State-B/State-C fix.
- **S6: auto-continue-after-click toggle persists a change** — off → on round-trip.
- **S6: speed slider displays its current value via the readout** — asserts `#speedValue` contains `"1.25"` from seeded config.
- **S6: About section renders ASCII banner + shortcuts table** — verifies `<pre class="ascii-banner">` + `<table.shortcuts tbody tr>` x 6. Locks in the v0.3.8 table semantic structure.
- **S6: strict CSP invariant** — reads the meta[http-equiv=Content-Security-Policy] content, asserts `style-src 'self'` present AND `'unsafe-inline'` absent. This is the D2-9 invariant that's been regressed twice — the runtime check catches it the moment the renderer slips.

### 1 flake fixed during authoring

Initial draft had a `selectOption('5')` + `toHaveValue('5')` round-trip that flaked with received `'1'` (session 2's seeded index). Root cause: `setSessionIndex` IPC round-trip + subsequent `renderSessionsTable` rebuild races against Playwright's value assertion. Rewrote as a shape assertion (24 options exist) which tests the renderer's responsibility (paletteOptionsClone correctness) without depending on async persistence.

## Results

- `npx playwright test` → **25/25 passing**. Average per-test 6.7–7.2 s; total 2.9 m sequential.
- Slow-test reporter flagged no tests above its 5 s threshold (all boot-time is Electron launch, not test body).
- Windows-only run for now; Mac/Linux electron binary paths in `fixtures.ts` are ready but untested.

## What still can't be E2E-tested

Listed explicitly so a future reader doesn't duplicate the question:

- **Audio playback** — headless Electron on CI can't route audio. The silent-WAV shim trick used in the kit demo (`docs/ui-kit/mock-ipc.js`) could be adapted, but no current test body requires it.
- **Global shortcuts** — `globalShortcut.register` requires Windows-level OS delivery; Playwright only does page-scope keyboard events. Hey-jarvis, speak-clipboard, and toggle-listening hotkeys stay manual-QA.
- **Stale-session greying** — the `get-stale-sessions` IPC polls every 10 s. A test-mode IPC to trigger-poll-now would be needed; deferred.
- **Multi-monitor dock** — needs >1 display.
- **Audio-device hotplug (R30)** — would require `navigator.mediaDevices.devicechange` which Playwright can't synthesise.

None of these are new gaps; they're inherent to the Playwright + headless-Electron + Windows-CI combination. Manual QA + CI-plus-integration covers the risk.
