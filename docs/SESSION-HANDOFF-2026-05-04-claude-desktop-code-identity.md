# Session Handoff: Claude Desktop Code Identity Sync

Date: 2026-05-04
Project: `C:\Users\Ben\Desktop\terminal-talk`
Focus: Terminal Talk integration with Claude Code sessions hosted inside Claude Desktop

This handoff is for a Claude Code session that will investigate and fix the Claude Desktop side of Terminal Talk session identity. Ben has closed the desktop sessions because the Claude Desktop Code session identities became muddled. Codex Desktop has been tested by Ben and should be treated as working unless a targeted regression is found.

Start the Claude Code session with this prompt:

```text
Read docs/SESSION-HANDOFF-2026-05-04-claude-desktop-code-identity.md in full. Focus only on Terminal Talk identity sync for Claude Code sessions hosted inside Claude Desktop. Do not change the Codex Desktop path unless you can prove the Claude fix requires it. First diagnose how Claude Desktop stores, refreshes, and live-renames Claude Code recents/sidebar entries, then propose or implement the narrowest reliable fix.
```

## Goal

When a user starts a new Claude Code session inside Claude Desktop and sends the first message, Terminal Talk should:

1. Detect the Claude Desktop-hosted Claude Code session automatically.
2. Create or update exactly one Terminal Talk registry row for that session.
3. Preserve the correct Terminal Talk label, colour, voice, and source identity for that specific Claude Desktop Code session.
4. Make that identity visible in Claude Desktop's left Recents/sidebar and the top session/worktree label without requiring a full Claude Desktop restart.
5. Let the Terminal Talk Settings > Sessions sync button update the Claude Desktop visible label/colour for the correct session only.

The current problem is that persistence mostly works, but live visible identity inside Claude Desktop is unreliable. Session ids and colours have been observed becoming muddled between Claude Desktop Code sessions.

## Current User Position

Ben's latest state:

- All desktop sessions were closed because the Claude Desktop Code identity rows became confusing.
- Codex Desktop identity sync has been tested and is considered acceptable for now.
- A fresh Claude Code terminal session has been opened so Claude Code can work on this.
- Ben wants the Claude Desktop-hosted Claude Code recents/sidebar identity to be clear per session, not just hidden in Terminal Talk Settings.

## Absolute Rules

1. Do not disturb the Codex Desktop integration unless a change is strictly required for shared infrastructure.
2. Do not use coordinate-based UI automation for Claude Desktop rename. It was tested and failed unsafe by typing into the Claude chat instead of the rename control.
3. Do not manually create duplicate Terminal Talk MCP rows for Claude Code sessions. Claude Code hosted in Claude Desktop should be detected from hooks and/or Claude Desktop session files.
4. Do not claim live sidebar sync works unless it is visible in Claude Desktop and backed by Claude's `main.log` showing a real `LocalSessions.updateSession` or `LocalAgentModeSessions.updateSession` call for the correct `local_...` id.
5. Do not use app restart as the fix. Restart can prove persistence, but the target workflow must work during an active session.
6. Preserve user-owned labels and colours. Auto-registration must not overwrite a label/colour that the user set in Terminal Talk Settings.

## What Is Working

Terminal Talk can already find Claude Desktop-hosted Claude Code artifacts.

Relevant stores:

- Claude Desktop local Code sessions:
  `C:\Users\Ben\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude-code-sessions\...\local_*.json`
- Claude Desktop worktree index:
  `C:\Users\Ben\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\git-worktrees.json`
- Claude Desktop logs:
  `C:\Users\Ben\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\logs\main.log`
- Terminal Talk registry:
  `C:\Users\Ben\.terminal-talk\session-colours.json`

The Claude Desktop `local_*.json` rows contain useful fields:

- `sessionId`: Claude Desktop local id, like `local_215d64f4-...`
- `cliSessionId`: Claude Code session id, whose first 8 hex chars are the Terminal Talk short id
- `title`
- `titleSource`
- `color`
- `cwd`
- `worktreeName`

Terminal Talk has code to write persistent title fields into these files and into `git-worktrees.json`. Restarting Claude Desktop has picked up the saved titles, proving persistence works.

Relevant implementation files:

- `app/lib/claude-desktop-title-sync.js`
- `app/lib/claude-desktop-live-sync.js`
- `app/lib/codex-identity-sync.js`
- `app/lib/ipc-handlers.js`
- `app/lib/sessions-table.js`
- `app/session-registry.psm1`
- `app/assistant-session-launch.ps1`
- `app/sync-claude-desktop-refresh.ps1`

Relevant tests:

- `scripts/run-tests.cjs`, section `CLAUDE DESKTOP TITLE SYNC`
- `scripts/run-tests.cjs`, section `CLAUDE DESKTOP SESSION REGISTRY`

Current logic tests pass:

```powershell
node scripts\run-tests.cjs --logic-only
```

Last verified result:

```text
Tests: 959 passed, 0 failed
```

## What Is Not Working

### Live Claude Desktop sidebar/header update

Terminal Talk can write persisted titles, but the already-open Claude Desktop renderer/sidebar does not reliably update from disk.

Observed behavior:

- A Claude Desktop restart can pick up Terminal Talk titles.
- During an active Claude Desktop session, pressing sync in Terminal Talk often updates disk but not the visible Claude Desktop recents row.
- Ctrl+R refresh was not enough; it reloads the current URL but does not necessarily rebuild the Electron main-process session list from disk.
- External Terminal Talk writes do not guarantee a `LocalSessions.updateSession` log entry.

The expected live path in Claude appears to be:

```text
LocalSessions.updateSession: sessionId=local_..., options={"title":"...","titleSource":"user",...}
LocalAgentModeSessions.updateSession: sessionId=local_..., options={"title":"...","titleSource":"user",...}
```

Terminal Talk currently tries CDP in `app/lib/claude-desktop-live-sync.js`, but this is not reliable because Claude Desktop blocks ordinary remote debugging with a signed auth gate.

### Coordinate UI rename failed and was removed

We tested an experimental script that tried to right-click the current Claude Desktop recents row and use the rename UI. It failed unsafe:

- It missed the rename control.
- It typed into the Claude chat.
- It did not produce a `LocalSessions.updateSession` log entry.
- The script and IPC fallback were removed.

Do not revive that approach unless it is replaced with semantic UI automation or an internal API call. Windows UI Automation only exposed the outer Electron window in testing, not reliable inner web controls.

### Session identity can be overwritten by watcher auto-registration

During testing, a Claude Desktop Code row was seen changing from a split colour/title to a new default identity after the session-file watcher re-registered it. Example symptoms:

- The visible Claude Desktop row showed split identities like `TT Orange / Blue`, `TT Green / Red`, `TT Red / Blue`.
- The Terminal Talk registry row for one session later showed a different index/label than expected.
- Logs showed `claude desktop session-file registered ...` for rows that had already existed previously.

This suggests at least one bug around one of these areas:

- row reuse after delete/close/reopen;
- preserving user-owned `label`, `index`, `auto_label`, and `voice`;
- matching by `cliSessionId` versus `localSessionId`;
- stale session files causing a row to be reintroduced after the user deleted or changed it;
- file watcher writes racing with settings edits;
- multiple Claude Desktop Code sessions under the same workspace/worktree folder confusing matching.

## Important Code Paths

### Session file registration

File:

```text
app/lib/claude-desktop-title-sync.js
```

Key functions:

- `discoverClaudeCodeSessionFiles`
- `registerClaudeDesktopCodeSessions`
- `applyClaudeDesktopSessionMetadata`
- `buildClaudeDesktopSessionTitle`
- `syncClaudeDesktopSessionTitles`
- `syncClaudeDesktopGitWorktreeTitle`
- `appendClaudeTranscriptTitle`

Things to inspect:

- Does `registerClaudeDesktopCodeSessions` ever create a fresh row when it should reuse a hidden/deleted/renamed one?
- Does it preserve user-owned `entry.index` and `entry.label` when a session file changes?
- Does it incorrectly turn `auto_label` back on?
- Does it match the correct `localSessionId` for the correct `cliSessionId` when multiple local files exist?
- Does `activityMsForSession` choose the correct local file if there are stale copies?

### Registry hook attribution

File:

```text
app/session-registry.psm1
```

Relevant function:

```text
Set-ClaudeDesktopMetadata
```

Expected stamped fields:

- `source_kind = claude-desktop`
- `source_label = Claude Desktop`
- `source_app = Claude`
- `source_key = claude-desktop:<sessionId>`
- `claude_code_entrypoint = claude-desktop`
- parent/child PIDs when available
- `adapter = hooks` when hook-owned
- capabilities showing whether hooks/tool events are available

Things to inspect:

- Hook-owned rows and session-file-owned rows must converge on the same row, not create duplicates.
- The same `cliSessionId` must remain the canonical session key even if Claude Desktop changes `localSessionId`.
- Hook metadata must enrich the row without resetting user label/colour.

### Live update bridge

File:

```text
app/lib/claude-desktop-live-sync.js
```

Current approach:

- Tries CDP ports and evaluates an expression in the Claude renderer:
  `window["claude.web"].LocalAgentModeSessions.updateSession(...)`
  or
  `window["claude.web"].LocalSessions.updateSession(...)`

Known blocker:

- Claude Desktop rejects ordinary `--remote-debugging-port` unless a valid `CLAUDE_CDP_AUTH` token is present. That token appears to be signed/verified by Claude's app, so Terminal Talk cannot simply generate it.

Things to investigate:

- Is there a supported local IPC, MCP, deep link, app-server, or renderer event route to call `updateSession`?
- Does Claude Code itself have a supported command/control request for rename that routes through Claude Desktop's `onRenameSession` bridge?
- Can a Claude Code plugin/MCP call rename the host Desktop Code session semantically?
- Does the Claude Desktop Code session expose a local control socket or JSON-RPC endpoint for session metadata?

### Manual Settings sync button

Files:

```text
app/lib/ipc-handlers.js
app/lib/sessions-table.js
app/preload.js
```

Current behavior:

- Settings session row has a sync button.
- For Claude, this calls `sync-claude-desktop-title`.
- It writes persisted files and then tries live bridge/refresh.
- If the live path fails, it marks status `live_unavailable` with an error.

The sync button should ultimately:

1. Resolve the exact Terminal Talk row by short id.
2. Resolve the exact Claude Desktop `localSessionId` by `cliSessionId`.
3. Update the persisted files.
4. Trigger the real Claude Desktop live update path for that exact `localSessionId`.
5. Mark `live_synced` only after a real update is observed.

## Codex Desktop Status: Leave Alone

Ben says Codex Desktop is okay after testing.

Do not make broad changes to:

- `app/lib/codex-desktop-title-sync.js`
- `app/sync-codex-desktop-active-title.ps1`
- `scripts/sync-codex-desktop-active-title.ps1`
- Codex rollout watching
- Codex global hook policy

Known Codex lesson that should not be repeated:

- Global Codex hooks caused unrelated Codex sessions to show visible hook status lines.
- Codex Desktop integration should stay based on rollout/app-server/UI sync, not global hooks.

## Recent Failed Experiment To Avoid

The following was tested and rolled back:

- `app/sync-claude-desktop-ui-title.ps1`
- IPC fallback from `sync-claude-desktop-title` to that script
- test parser references to that script

The failure mode was clear: coordinate automation targeted the wrong place in the Claude UI and typed into chat. The workspace was cleaned afterward:

- no `app/sync-claude-desktop-ui-title.ps1`
- no repo-root extracted `index.js`
- no repo-root extracted `index.pre.js`
- logic tests pass

## Useful Diagnostic Commands

List current Claude Desktop processes:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -match 'Claude|claude' -or $_.CommandLine -match 'Claude' } |
  Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine |
  Format-List
```

Inspect recent Claude Desktop log events:

```powershell
$log = "$env:LOCALAPPDATA\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\logs\main.log"
Select-String -Path $log -Pattern "LocalSessions\.updateSession|LocalAgentModeSessions\.updateSession|setFocusedSession|Reloading current URL|topFrameUrl|sendMessage" |
  Select-Object -Last 120 |
  ForEach-Object { $_.Line }
```

Inspect Claude Desktop Code session files:

```powershell
$root = "$env:LOCALAPPDATA\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude-code-sessions"
Get-ChildItem -Path $root -Recurse -Filter "local_*.json" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 20 FullName, LastWriteTime
```

Read a Claude Desktop Code session file:

```powershell
$file = "<path-to-local-session-json>"
Get-Content -Raw -LiteralPath $file |
  ConvertFrom-Json |
  Select-Object sessionId, cliSessionId, title, titleSource, color, cwd, worktreeName, lastActivityAt |
  ConvertTo-Json -Depth 4
```

Inspect Terminal Talk Claude Desktop rows:

```powershell
$p = Join-Path $env:USERPROFILE ".terminal-talk\session-colours.json"
$a = (Get-Content -Raw -Path $p | ConvertFrom-Json).assignments
$a.PSObject.Properties |
  Where-Object { $_.Value.source_kind -eq "claude-desktop" -or $_.Value.claude_desktop_title } |
  ForEach-Object {
    [pscustomobject]@{
      short = $_.Name
      label = $_.Value.label
      auto_label = $_.Value.auto_label
      index = $_.Value.index
      session_id = $_.Value.session_id
      source_key = $_.Value.source_key
      adapter = $_.Value.adapter
      status = $_.Value.claude_desktop_title_status
      title = $_.Value.claude_desktop_title
      file = $_.Value.claude_desktop_session_file
    }
  } |
  Format-List
```

Run tests:

```powershell
node scripts\run-tests.cjs --logic-only
```

## Recommended Investigation Plan

1. Reproduce from a clean Claude Desktop state:
   - Start one new Claude Desktop Code session.
   - Send one short message.
   - Watch Claude's session file, Terminal Talk registry row, and Claude `main.log`.
   - Confirm whether Terminal Talk creates exactly one row and preserves it.

2. Add a second Claude Desktop Code session:
   - Use a different label/colour in Terminal Talk Settings if possible.
   - Verify each `cliSessionId` maps to exactly one short id.
   - Verify each `localSessionId` maps back to the right row.

3. Find the real live rename route:
   - Prefer a Claude-supported API/control request/bridge over UI automation.
   - Search Claude Code/Claude Desktop docs and local package behavior if needed.
   - Confirm with `main.log` that `updateSession` fires for the correct `local_...` id.

4. Fix persistence/identity races first:
   - Ensure session-file auto-registration never overwrites user label/colour.
   - Ensure hidden/deleted stale session files cannot resurrect confusing rows unless the session is actually active/recent.
   - Ensure settings edits and watcher writes cannot race into stale `claude_desktop_title_status`/title/error combinations.

5. Only then wire the Settings sync button to the live route.

## Acceptance Criteria

A fix is acceptable when this works without restarting Claude Desktop:

1. Create Claude Desktop Code session A.
2. Send a message.
3. Terminal Talk creates one row for A.
4. Set A's label and colour in Terminal Talk Settings.
5. Sync A.
6. Claude Desktop visibly shows A's Terminal Talk identity in Recents/top label.
7. Create Claude Desktop Code session B.
8. Send a message.
9. Terminal Talk creates one row for B and does not corrupt A.
10. Set B's label and colour, sync B, and verify B updates while A remains correct.
11. Claude `main.log` shows update calls for the correct `local_...` ids.
12. `node scripts\run-tests.cjs --logic-only` passes.

## Notes For The Implementer

Ben cares about the user-facing workflow, not only the backing files. If the label exists in Terminal Talk but not in Claude Desktop's visible sidebar, the job is not done.

The cleanest outcome is a real live bridge into Claude Desktop's own session manager. If that is impossible in the current Claude Desktop build, document the blocker clearly and keep the persisted cold-start behavior stable rather than adding fragile UI scripting.
