# Terminal Talk Handoff - Live Codex-in-Claude Plugin Audit

Date saved: 2026-04-30 00:10 Europe/London

## User goal

Make Codex sessions launched from Claude Code via the Codex companion/plugin register cleanly in Terminal Talk, announce their visible identity, keep their palette/name coherent with the toolbar/settings sessions area, and remove themselves from the registry when the spawned agent finishes.

The user specifically does not want mystery sessions appearing in the toolbar or settings registry. If Claude Code starts a Codex plugin job, Terminal Talk should tell the user which session ID/color/name will speak. When that job ends, it should sign out automatically.

## Live trace being audited

Claude launched a Codex companion background job from the `TT 2 CLAUDE` terminal.

Companion job:

- Job ID: `task-moknh94g-59zfxp`
- Codex CLI PID reported by companion: `23628`
- Model/effort: `gpt-5.5 / xhigh`
- Companion log: `C:\Users\Ben\AppData\Local\Temp\codex-companion\terminal-talk-911028799a7cce13\jobs\task-moknh94g-59zfxp.log`

Codex session:

- Thread ID: `019ddb71-a76c-77c2-9870-d4d16274b6b1`
- Turn ID: `019ddb71-af36-7862-9116-75c8ef407aa7`
- Short ID: `019ddb71`
- Resume command: `codex resume 019ddb71-a76c-77c2-9870-d4d16274b6b1`

Terminal Talk registration:

- Registry payload: `C:\Users\Ben\.terminal-talk\sessions\019ddb71-plugin-start.json`
- Caller: `codex-session-start`
- Assigned palette index: `1`
- Palette color: `#ffa726` / orange
- Label: `Claude Codex - terminal-talk`
- Source cwd: `C:\Users\Ben\Desktop\terminal-talk`

Live flags observed:

- `019ddb71-plugin-start.json`
- `019ddb71-plugin-start-announced.flag`
- `019ddb71-working.flag`

Start announcement audio existed and said:

`Claude Code has started a Codex session for terminal-talk. It will appear as Claude Codex - terminal-talk with the orange marker. Session ID 019ddb71.`

## Audit verdict so far

The start path worked:

1. `codex-session-start.ps1` fired.
2. Registry write happened.
3. Palette slot was assigned.
4. Start announcement flag and audio were created.
5. Working/heartbeat flag was live.
6. Tool narration clips arrived under `019ddb71`.

The stop path also fired:

- Hook log showed `codex-stop` synced short `019ddb71`.
- It scheduled delayed plugin cleanup with 120s delay.
- Cleanup removed the plugin session from registry.
- Cleanup purged about 70 queue files for `019ddb71`.

## Bug found

After cleanup, the toolbar process immediately re-added `019ddb71` as a bare ghost assignment.

The re-created entry looked like:

```json
"019ddb71": {
  "last_seen": 1777503899,
  "index": 1,
  "focus": false,
  "label": "",
  "muted": false,
  "claude_pid": 0,
  "session_id": "019ddb71",
  "pinned": false
}
```

This matters because it strips `source_kind=codex-plugin`, `source_label`, `source_cwd`, and the real session ID. Later cleanup can no longer identify it as a plugin session.

Likely root cause:

- `Remove-CodexPluginSession` works.
- `ensureAssignmentsForFiles(files)` in `app/main.js` receives or still holds a stale queue file list that includes `019ddb71`.
- It creates a new assignment for any short ID it sees in queue files.
- There is no recent-cleanup tombstone, so cleaned plugin sessions can be re-created from stale queue snapshots.

Secondary issue noticed:

- The same `ensure-for-files` write appeared to touch/change existing assignments and may have produced a palette collision. In the observed registry, `019dd52c` moved to index `0`, colliding with `8b087e3a` index `0`. Treat this as a related registry integrity risk while patching.

## Code locations already inspected

- `hooks/codex-session-start.ps1`
- `hooks/codex-stop.ps1`
- `hooks/codex-plugin-cleanup.ps1`
- `app/codex-hook-common.psm1`
- `app/main.js`
- `app/lib/codex-session-watcher.js`
- `scripts/run-tests.cjs`

Important functions:

- `Sync-CodexHookSession`
- `Start-CodexPluginStartAnnouncement`
- `Start-CodexPluginSessionCleanup`
- `Remove-CodexPluginSession`
- `ensureAssignmentsForFiles`
- `CodexSessionWatcher._removePluginSession`
- `CodexSessionWatcher._touchAssignment`

## Patch plan

1. Add a plugin cleanup tombstone.
   - Write `C:\Users\Ben\.terminal-talk\sessions\<short>-plugin-cleaned.flag` when plugin cleanup runs.
   - Keep the tombstone for a short period instead of deleting it with the other plugin flags.
   - Use the same tombstone when the JS watcher removes a completed plugin session.

2. Guard `ensureAssignmentsForFiles(files)` in `app/main.js`.
   - Add `isRecentlyCleanedPluginShort(short)`.
   - If a short has a recent tombstone, do not create a new assignment from queue files.
   - Also delete any already re-created ghost during prune if it has a recent tombstone.

3. Make cleanup tolerant of metadata clobbering.
   - `Remove-CodexPluginSession` should remove if the registry entry is a plugin entry OR plugin marker files still exist.
   - This handles the race where `source_kind` is stripped before delayed cleanup runs.

4. Add the same recent-cleanup guard in `app/lib/codex-session-watcher.js` before `_touchAssignment` can recreate a cleaned plugin short.

5. Add tests in `scripts/run-tests.cjs`.
   - Assert `app/main.js` references plugin-cleaned tombstones before creating assignments from queue files.
   - Assert `Remove-CodexPluginSession` writes `plugin-cleaned.flag`.
   - Assert cleanup can proceed from plugin marker files even when registry metadata was clobbered.
   - Existing plugin cleanup tests are around the later `scripts/run-tests.cjs` sections near the Codex plugin cleanup coverage.

6. Run:
   - `node scripts/check-file-length.cjs --update`
   - `& 'C:\Program Files\PowerShell\7\pwsh.exe' -Command 'node scripts\run-tests.cjs'`

7. Deploy to the live install and restart toolbar after tests.

8. After deploy, remove the current bare `019ddb71` ghost from the live registry if still present.

## Fix implemented 2026-04-30 00:31 Europe/London

Implemented and deployed the cleanup race fix.

Changed source files:

- `app/main.js`
- `app/codex-hook-common.psm1`
- `app/lib/codex-session-watcher.js`
- `scripts/run-tests.cjs`
- `file-length-baseline.json`

What changed:

1. Plugin cleanup now writes `sessions/<short>-plugin-cleaned.flag`.
2. New plugin starts clear any old tombstone for their own short.
3. `ensureAssignmentsForFiles(files)` skips stale queue files for recently cleaned plugin shorts.
4. `ensureAssignmentsForFiles(files)` also prunes any already resurrected ghost entry when the tombstone is recent.
5. `CodexSessionWatcher._touchAssignment` now refuses to recreate a recently cleaned plugin short.
6. `CodexSessionWatcher._removePluginSession` writes the same tombstone before queue purge.
7. `Remove-CodexPluginSession` can still remove a plugin short if `source_kind` was clobbered but plugin marker files prove the identity.

Verification:

- `node scripts/check-file-length.cjs --update`
- `& 'C:\Program Files\PowerShell\7\pwsh.exe' -Command 'node scripts\run-tests.cjs'`
- Result: `1089 passed, 0 failed`

Live deploy:

- Copied patched files to `C:\Users\Ben\.terminal-talk\app`.
- Restarted the live toolbar.
- Removed bare ghost registry entry `019ddb71`.
- Wrote live tombstone `C:\Users\Ben\.terminal-talk\sessions\019ddb71-plugin-cleaned.flag`.
- Confirmed no live queue files remained for `019ddb71`.
- Confirmed live registry now only contains `8b087e3a`, `019dd52c`, and `a681db35`.

Status: the start/sustained-registration gap and the cleanup resurrection gap are both closed in the live install.

## Existing verification before this handoff

Before this audit, the full harness had passed:

`1086 passed, 0 failed`

That was after the tool narration and code-block summary improvements. The current tombstone/registry race fix has not yet been implemented at the time this handoff was saved.

## User-provided Lane 2 audit result

The user reported the Claude-launched Lane 2 audit finished in `10m 28s` with verdict:

- high: 2
- medium: 3
- low: 0
- seed edge-fallback excluded from count

Need fetch/save Claude's full Lane 2 output when available and fold any new findings into this audit.

Additional sustained-registration proof point from the user:

- Codex session `019ddb71-a76c-77c2-9870-d4d16274b6b1` stayed registered with Terminal Talk for the whole `10m 28s` run.
- It kept the same working flag and the same palette slot `1`.
- This validates sustained heartbeat/registration over the job lifetime, not only the initial `codex-session-start` hook.
- The remaining bug is cleanup aftermath: after stop cleanup, stale toolbar queue scanning can resurrect the short ID as a bare ghost entry.
