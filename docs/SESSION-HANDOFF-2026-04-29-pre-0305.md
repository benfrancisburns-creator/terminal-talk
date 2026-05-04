# Session Handoff - 2026-04-29

## Current State

Branch: `main`

Local HEAD and `origin/main` were both `e5b2a53 Polish landing page videos` before this uncommitted work.

The worktree is intentionally dirty. Do not reset it. The current changes cover Codex integration, heartbeat/tool narration, settings polish, installer/hook updates, docs, tests, and the toolbar collapsed-strip playback fix.

## Main Behaviour Changes

- Codex now has native hook support for identity/work state plus rollout watching for spoken `commentary`, `final`, shell-command narration, and patch narration.
- Codex working state now writes/clears working flags so heartbeat starts while Codex is busy.
- Global heartbeat is the default, with per-session `Default / On / Off` heartbeat overrides in the expanded session row.
- `speech_includes.tool_calls` now controls Codex tool narration as well as Claude tool narration.
- Auto-collapse delay is exposed in Settings and clamps to `1-120` seconds.
- The toolbar no longer stays fully open just because audio is playing.
- If playback starts while Settings is closed and the cursor is not hovering, the toolbar collapses to the slim strip and holds the speaking session colour until that clip stops.
- If the user is hovering or Settings is open, the toolbar stays expanded.

## Important Files Added

- `app/codex-hook-common.psm1`
- `app/codex-identify-live.ps1`
- `app/lib/codex-identity-sync.js`
- `app/lib/codex-tool-narration.js`
- `app/lib/cursor-clickthrough.js`
- `hooks/codex-mark-working.ps1`
- `hooks/codex-on-tool.ps1`
- `hooks/codex-post-tool.ps1`
- `hooks/codex-session-start.ps1`
- `hooks/codex-stop.ps1`

## Latest Toolbar Fix

The user reported that when Codex/coloured code was speaking, the toolbar sometimes went to the full resting state instead of staying collapsed as a glanceable colour strip.

Root cause: `app/renderer.js` had a collapse rule that returned early whenever playback was active, so audio pinned the full toolbar open.

Fix:

- Removed the `isPlaybackActive()` early return from the idle-collapse interval.
- Added `collapseForBackgroundPlayback(path)`.
- `onPlayStart` now collapses and colours the strip if the toolbar is open but the user is not hovering.
- Added a `mouseleave` cursor reset so stale hover state is less likely.
- Updated E2E coverage in `tests/e2e/production.spec.ts` to assert that an open toolbar collapses to the session-colour strip when playback starts in the background.

## Verification Run

After the toolbar collapsed-strip fix:

- Targeted Playwright playback-collapse tests: `3 passed`
- Full Playwright suite: `35 passed`
- Logic-only harness: `881 passed, 0 failed`
- `npm run lint -- --max-warnings=0`: passed
- `node scripts/check-doc-drift.cjs`: passed
- `node scripts/sync-app-mirror.cjs --check`: passed
- `node scripts/check-file-length.cjs`: passed
- `git diff --check`: passed, only normal LF to CRLF warnings

Earlier in the same work session, before the final toolbar collapse tweak:

- Full local harness: `1061 passed, 0 failed`
- Coverage gate passed
- `npm run knip`: passed
- `python -m ruff check app/*.py`: passed
- `npm audit --audit-level=low`: `0 vulnerabilities`
- PSScriptAnalyzer: `0 findings`

## Installed Runtime

The verified runtime was synced into:

`C:\Users\Ben\.terminal-talk`

Manifest verification after the latest sync:

`OK 75 files verified clean`

The running Electron toolbar still needs a reload/restart to pick up the renderer changes. `Ctrl+R` on the toolbar should be enough.

## Commit Readiness

No known functional blockers are open at this point.

Before committing, do a quick review of the large dirty worktree and decide whether to commit as one production-hardening commit or split into:

1. Codex identity/hooks/tool narration/heartbeat
2. UI/settings/session overrides/collapse behaviour
3. Docs/tests/install updates

GitHub Actions will not show the new passing state until the changes are committed and pushed.
