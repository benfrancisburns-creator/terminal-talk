# End-to-end Playwright tests

These drive the real Electron toolbar — rendering, click handlers, IPC,
settings panel, session table interactions. Complements the
logic-only harness at `scripts/run-tests.cjs` which covers pure JS / Python
units without launching Electron.

## Running

```bash
# One-time setup (if not already done via install.ps1)
cd app && npm install    # gets you the Electron binary
cd .. && npm install     # installs @playwright/test at repo root

# Run the suite
npm run test:e2e

# Interactive mode with traces for debugging
npm run test:e2e:ui

# Both logic + e2e
npm run test:all
```

## What's covered

- **Smoke** (`launch.spec.ts`): bar renders, top/bottom rows exist, all
  control buttons present, dots strip starts empty.
- **Settings panel** (`settings.spec.ts`): opens/closes, Playback controls
  present, auto-prune toggle and seconds clamp.
- **Session management** (`sessions.spec.ts`): seeded registry renders
  correctly, mute + focus + remove interactions.

## What's NOT covered (and why)

- **Cross-window click-through to a non-Electron app** — Playwright can
  launch another window but can't verify OS-level pass-through to
  arbitrary apps. Would need `robotjs` or `nut.js` for real screen-coord
  clicks.
- **Global hotkey registration at OS level** — `globalShortcut.register`
  binds at the OS input layer; Playwright's key simulation is
  page-scoped. Hotkey behaviour is tested indirectly by invoking the
  IPC handlers directly.
- **Audio actually playing through speakers** — can check `audio.paused`
  state but not speaker output.
- **Real Claude Code hook firing** — would require a real Claude Code
  session. Hook logic is tested at the synth_turn.py level in the
  logic harness instead.

## Fixture isolation

Every test gets a fresh temp directory via `TT_INSTALL_DIR`. The
toolbar reads its config, registry, and writes its clip queue to that
dir — your real `~/.terminal-talk/` is never touched.

## Known flaky areas

A few tests involving seeded session data can intermittently fail on
first run because `initialLoad()` in the renderer races with the panel
opening. The fix is a more deliberate wait on `sessionAssignments`
being populated before `openSettings()`. Listed in the design audit
follow-ups.

## Writing a new test

Import from the local fixtures:

```ts
import { test, expect } from './fixtures';
import { openSettings, clickById } from './helpers';

test('my new thing', async ({ window }) => {
  await openSettings(window);
  await clickById(window, 'myButtonId');
  await expect(window.locator('.expected-class')).toBeVisible();
});
```

For tests that need pre-seeded state:

```ts
test.describe('Seeded', () => {
  test.use({ seed: {
    assignments: { 'beefcafe': { index: 0, label: 'Test', ... } },
    config: { playback: { auto_prune: false } },
  }});

  test('does the thing', async ({ window }) => { ... });
});
```
