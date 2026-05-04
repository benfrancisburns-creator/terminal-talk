# Session Handoff - 2026-04-29

## Current State

Working directory: `C:\Users\Ben\Desktop\terminal-talk`

Branch: `main`

Local HEAD and `origin/main` were both `e5b2a53 Polish landing page videos` before the current uncommitted work.

The worktree is intentionally dirty. Do not reset it. There are many tracked changes and several new files from the Codex integration, toolbar behaviour, settings/session UI, docs, installer, tests, and live runtime work. Some edits may be from concurrent sessions; work with them rather than reverting.

No commit has been made.

## Latest Completed Work

### Codex Tool Narration

`app/lib/codex-tool-narration.js` now produces more useful spoken tool-call clips for Codex:

- Shell pipelines avoid the repeated generic "in a pipeline" phrasing where there is a clearer action.
- Pipeline tails describe intent, such as first/last lines, selected fields, counts, filters, sorts, or result limits.
- `Start-Sleep ...; real-command` is peeled so narration describes the real command.
- Patch narration describes the edited file, added/removed line counts, and nearby function/class/scope when detectable.
- Permission requests now generate a T-clip before Codex asks for escalation, using the first sentence of the approval justification when available.

Important test coverage was added in `scripts/run-tests.cjs`.

### Codex Terminal Identity

The new unwanted colour/session row was traced to background Codex/agent rollout files being registered as if they were real terminal sessions.

Terminal Codex rollout metadata:

- `source: "cli"`
- `originator: "codex-tui"`

Non-terminal/background rollout metadata seen in the bug:

- `source: "vscode"`
- `originator: "Claude Code"`
- `approval_policy: "never"`

The fix is to only register Codex rollouts that are real terminal sources. This is now implemented in:

- `app/lib/codex-session-watcher.js`
- `app/codex-terminal.psm1`
- `app/codex-identify-live.ps1`

Added helper/tests include:

- `isCodexTerminalSource`
- `extractCodexSessionMetaEvent`
- `readCodexRolloutMeta`
- PowerShell `Test-CodexTerminalRolloutMeta`
- Candidate selection tests that prove newer non-terminal rollouts are skipped.

### Live Cleanup

The live install under `C:\Users\Ben\.terminal-talk` was updated with the verified source-filter files and the toolbar was restarted.

Removed bad live session entries:

- `019dd684`
- `019dd6cd`
- `019dd6e3`

Removed related live queue/session files and the matching bad session pid file where applicable.

Registry after cleanup was verified clean and remained clean after a short wait. At that point the live registry contained:

- `019dd52c`: `CODEX CURRENT`, red, pid `24032`
- `019dcdf7`: `CODEX VIDEO`, orange, pid `18084`
- `6ea2bdd5`: `TT CC`, index `11`, pid `15168`
- `b14d0399`: unlabelled, index `4`, pid `15168`

The exact active sessions may change after restart or user activity, but non-terminal rollouts should not create new colour rows.

### Toolbar / Letterbox Behaviour

Prior work in this dirty tree includes the toolbar movement and resting-state changes:

- Auto-collapse delay is now configurable and can be set to 3 seconds.
- Playback no longer pins the full toolbar open by itself.
- If playback starts while settings is closed and the cursor is not hovering, the toolbar can collapse to the slim strip.
- The collapsed strip holds the speaking session colour for the duration of the active audio clip and stops when the clip ends.
- Hovering or opening settings keeps the toolbar expanded.

The user specifically wants the letterbox highlight to last exactly as long as the audio clip, not a short flash.

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

## Verification

Latest verified checks after the Codex source-filter and narration work:

- `node scripts\run-tests.cjs`: `1065 passed, 0 failed`
- `npx eslint app scripts docs\ui-kit eslint.config.js --max-warnings=0`: passed
- `node scripts\check-doc-drift.cjs`: passed
- `node scripts\sync-app-mirror.cjs --check`: passed after syncing
- `node scripts\check-file-length.cjs`: passed after updating the baseline
- `git diff --check`: passed, with only normal CRLF warnings

Known note: `node scripts\run-tests.cjs --logic-only` can fail inside the sandbox because PowerShell/Python/live-session probes are blocked or return null there. The full harness result above is the useful verification.

## Dirty Worktree Snapshot

The tree is large and intentionally uncommitted. Recent `git status --short` showed many modified files including:

- `README.md`
- `app/codex-launch.ps1`
- `app/codex-terminal.psm1`
- `app/codex-wt-launch.ps1`
- `app/index.html`
- `app/main.js`
- `app/preload.js`
- `app/renderer.js`
- `app/styles.css`
- `app/lib/audio-player.js`
- `app/lib/codex-session-watcher.js`
- `app/lib/config-validate.js`
- `app/lib/heartbeat.js`
- `app/lib/ipc-handlers.js`
- `app/lib/palette-alloc.js`
- `app/lib/registry-guard.js`
- `app/lib/sessions-table.js`
- `app/lib/settings-form.js`
- `app/lib/text.js`
- `app/lib/window-dock.js`
- `app/session-registry.psm1`
- `app/synth_turn.py`
- `config.example.json`
- `config.schema.json`
- `docs/*`
- `file-length-baseline.json`
- `install.ps1`
- `scripts/run-tests.cjs`
- `tests/e2e/*`
- `uninstall.ps1`

New untracked files at the same point:

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

## Next Watchpoints

- If a new unexpected colour/session row appears, inspect the first rollout JSONL metadata. It must not register unless it is `source: "cli"` and `originator: "codex-tui"`.
- If a Codex tab glitches back to `Windows PowerShell`, inspect the title loop and launch/identity scripts rather than changing palette allocation first.
- The user wants the Codex tab title to show the colour dot and user session name from the settings/session area, updating when the session name or colour changes.
- Avoid tight polling for identity updates. Prefer event/input-bound updates from session setting changes and hook/status events.
- Before committing, review the dirty tree and split if useful:
  1. Codex identity/hooks/tool narration/heartbeat
  2. Toolbar/settings/session UI and collapsed-strip behaviour
  3. Docs/tests/install updates
