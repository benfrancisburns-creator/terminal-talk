# Desktop App Integration Plan

Date: 2026-05-03

Status: Codex Desktop title sync, Claude Desktop-hosted Claude Code registry attribution, and Claude Desktop local Claude Code title sync are implemented locally and deployed to the live install. Claude Desktop-hosted Claude Code now also auto-registers from local `claude-code-sessions` files before the first response hook. Terminal Talk MCP stdio bridge exists as an experimental local adapter for assistants without hook/session-file identity.

## Goal

Let Terminal Talk work with the desktop workflows people are moving into:

- Claude Desktop, including Claude Desktop calling local MCP tools and Claude Code through MCP.
- ChatGPT Desktop and the Codex app, including local Codex app workflows where available.
- Existing Claude Code and Codex CLI terminals, which must remain the most reliable integration path.

The product goal is not just "detect a window". The goal is to make desktop-agent work appear in Terminal Talk as a normal controllable audio session: label, colour, voice, mute, focus, working state, queue clips, and transcript/sidecar text where we legitimately have it.

## Current Terminal Talk Integration Model

Terminal Talk is strongest when an assistant exposes lifecycle files or hooks.

Claude Code:

- Hooks are registered in `~/.claude/settings.json`.
- Hook payloads include `session_id`, `transcript_path`, `cwd`, and event details.
- Terminal Talk writes session rows to `~/.terminal-talk/session-colours.json`.
- Working state is stored in `~/.terminal-talk/sessions/*-working.flag`.
- Response audio is written into `~/.terminal-talk/queue`.
- `app/lib/transcript-watcher.js` tails Claude JSONL transcripts while a session is working.

Codex CLI:

- Codex hook registration is now an explicit advanced option, not the default install path.
- The default path is the Terminal Talk launcher plus rollout watching. This avoids writing global `~/.codex` hook configuration, which affects unrelated Codex CLI and Codex Desktop sessions using the same Codex home.
- Optional hooks can still be registered in `~/.codex/hooks.json` for users who want generic Codex CLI lifecycle state outside Terminal Talk-launched sessions.
- Hook payloads include `session_id`, `transcript_path`, `cwd`, tool data, prompt data, and latest assistant message.
- `app/lib/codex-session-watcher.js` watches `~/.codex/sessions` rollout JSONL files and queues Codex commentary/final/tool narration.
- `app/codex-hook-common.psm1` keeps Codex CLI and Codex plugin sessions registered in the same session registry as Claude.

This model should stay canonical. Desktop integrations should feed this same registry and queue rather than creating a second product surface.

## Local Findings

On this machine:

- Claude Desktop is installed as `Claude_1.4758.0.0_x64__pzs8sxrjxfjjc`, executable `app\Claude.exe`.
- ChatGPT Desktop is installed as `OpenAI.ChatGPT-Desktop_1.2026.119.0_x64__2p2nqsd0c76g0`, executable `app\ChatGPT.exe`.
- `claude --version` returns `2.1.126 (Claude Code)`.
- `codex --version` returns `codex-cli 0.128.0`.
- Start menu entries currently show `Claude`, `ChatGPT`, and `Codex`.
- Codex Desktop is installed as `OpenAI.Codex_26.429.3425.0_x64__2p2nqsd0c76g0`.
- Codex CLI includes `codex app-server` and `codex mcp-server` commands.
- When Codex Desktop opens, it launches a packaged Electron app plus a child process:
  - `...\OpenAI.Codex_26.429.3425.0_x64__2p2nqsd0c76g0\app\Codex.exe`
  - `...\OpenAI.Codex_26.429.3425.0_x64__2p2nqsd0c76g0\app\resources\codex.exe app-server --analytics-default-enabled`
- The desktop-owned app-server process appears to be stdio-owned by the desktop app. `codex app-server proxy` currently fails to connect to the default control socket at `~\.codex\app-server-control\app-server-control.sock`.
- A separate Terminal Talk-owned `codex app-server --listen stdio://` process initializes successfully and can call `thread/list` against `~\.codex`. The response shape is `{ data, nextCursor, backwardsCursor }`; include explicit `sourceKinds` when listing, because the documented default is interactive sources only.
- Confirmed with deliberate Codex Desktop prompts: desktop-created threads are visible through a Terminal Talk-owned `codex app-server` `thread/list` call and are persisted in the shared `~\.codex\sessions` rollout store.
- In this Windows Codex Desktop build, the desktop test thread reported `source: "vscode"` rather than `source: "appServer"`. It used a Codex worktree cwd under `C:\Users\Ben\Documents\Codex\2026-05-03\...` and a readable name/title (`Test Codex Desktop integration`). Terminal Talk should therefore classify Codex Desktop sessions by a combination of source, cwd/worktree pattern, rollout path, app process state, and title rather than assuming `source=appServer`.
- `thread/name/set` from a Terminal Talk-owned app-server persists Codex Desktop titles into `~\.codex\session_index.jsonl`, `~\.codex\state_5.sqlite`, and the rollout JSONL `thread_name_updated` stream. The already-open Codex Desktop window does not reliably repaint its sidebar/header from that external write; its Electron-owned child app-server appears to keep an in-memory thread list. Closing the visible window can leave the Electron process running in the background, so treat Desktop title sync as persisted but pending visible refresh until a controlled full quit and relaunch proves the cold-start behavior.
- The practical no-restart workaround is to use Codex Desktop's own live UI path: copy the active session id with `Ctrl+Alt+C`, resolve the matching Terminal Talk registry title, then trigger Codex Desktop rename with `Ctrl+Alt+R`. `app/sync-codex-desktop-active-title.ps1` implements this as an explicit/manual nudge and is copied by the installer with the rest of `app/`, so it survives reinstall/update copies. The helper reads the registry as UTF-8, prefers the current Terminal Talk label over any cached `codex_desktop_title`, verifies the open Codex chat matches the requested row, then applies the title. It should not run silently in the background because it must focus Codex Desktop and paste into its rename control.
- Codex Desktop rollout `session_meta` lines can be large because Desktop injects app-context instructions. The rollout watcher must read enough of the first line to classify `source=vscode` / `originator=Codex Desktop`, and it must register/pin the Terminal Talk row as soon as the first `user_message` marks the thread working. Waiting until the first assistant response leaves the visible Desktop row unstamped during the important first interaction.
- Codex hooks are user-level/global on this machine. Enabling Terminal Talk hooks in `~\.codex` caused unrelated Codex sessions to show `Running UserPromptSubmit/PreToolUse/PostToolUse hooks` status lines. Even fast/no-op hook scripts can still be surfaced by the running Codex TUI because hook discovery is global and cached per process. Therefore Codex hooks must not be used for Codex Desktop integration and must stay opt-in for Codex CLI.
- Claude Desktop can launch a managed Claude Code child process. On this machine the desktop parent process is the Windows Store `Claude_1.4758.0.0_x64__pzs8sxrjxfjjc\app\claude.exe`, with a child Claude Code process under `AppData\Roaming\Claude\claude-code\...\claude.exe`.
- Claude Desktop-hosted Claude Code still writes normal `~\.claude\sessions\<pid>.json` metadata. The tested session included `entrypoint: "claude-desktop"`, `kind: "interactive"`, `cwd`, and the normal Claude Code `sessionId`.
- Claude Desktop also writes local Claude Code session rows under `...\Claude\claude-code-sessions\...\local_*.json`. These rows contain `cliSessionId`, `title`, `titleSource`, `color`, `worktreeName`, and the worktree path.
- Claude Desktop Code recents also consult `...\Claude\git-worktrees.json`; the visible row can be the worktree display name rather than only the local session `title`.
- The existing Claude Code hook path already queues Terminal Talk audio for Claude Desktop-hosted Claude Code responses. The tested message created queue clips and registered short id `c3747aac`.
- `app/session-registry.psm1` now detects this path and stamps registry rows with `source_kind=claude-desktop`, `source_label=Claude Desktop`, `source_app=Claude`, `adapter=hooks`, `claude_code_entrypoint=claude-desktop`, parent/child PIDs, source cwd, capabilities, and a persistent pin. Blank/auto labels become `Claude Desktop`, while user labels remain user-owned.
- `app/lib/claude-desktop-title-sync.js` now matches Terminal Talk registry rows to Claude Desktop local Claude Code rows by `cliSessionId` and writes titles such as `🟤 TT Brown · Test Terminal Talk MCP integration`. It also writes the local session `worktreeName`, Claude's `color`, and the matching `git-worktrees.json` value `name`, so new Desktop Code rows keep the Terminal Talk label/colour persistently across Claude restarts and sidebar refreshes. It also creates missing registry rows from recent unarchived Claude Code Desktop session files, then the normal hooks enrich those rows with live PID/tool metadata once they fire. This is local Claude Code-in-Desktop metadata, not native Claude chat recents.

The local AppData/package inspection only listed app install/runtime locations and executable metadata. It did not read private conversation databases or app cache contents.

## Official Capability Map

Claude Desktop:

- Claude Desktop supports local MCP through Desktop Extensions (DXT), and local MCP servers can be installed and managed from Settings > Extensions. Source: [Anthropic Help Center, local MCP servers on Claude Desktop](https://support.anthropic.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).
- Claude Code can run as an MCP server with `claude mcp serve`, and Anthropic documents adding that server to `claude_desktop_config.json`. Source: [Claude Code MCP docs](https://docs.anthropic.com/en/docs/claude-code/mcp).
- Claude Code hooks are first-class and include session/transcript data through stdin. Source: [Claude Code hooks reference](https://docs.anthropic.com/en/docs/claude-code/hooks).

Codex:

- The Codex app is officially available on macOS and Windows, and is described as a desktop command center for parallel Codex threads with worktrees, automations, Git, terminal/actions, skills, plugins, and MCP servers. Source: [OpenAI Codex app docs](https://developers.openai.com/codex/app).
- Codex hooks are a documented lifecycle extension point. They discover `hooks.json` or `config.toml`, pass one JSON object on stdin, and include common fields like `session_id`, `transcript_path`, `cwd`, `hook_event_name`, and `model`. Source: [OpenAI Codex hooks docs](https://developers.openai.com/codex/hooks).
- Codex MCP configuration is supported in the CLI and IDE extension, stored in `~/.codex/config.toml`. Source: [OpenAI Codex MCP docs](https://developers.openai.com/codex/mcp).
- Codex can run as an MCP server using `codex mcp-server`. Source: [OpenAI Codex Agents SDK guide](https://developers.openai.com/codex/guides/agents-sdk).
- Codex exposes an experimental app-server protocol with thread, turn, command, model, skill, and plugin methods. Source: [OpenAI Codex app-server docs](https://developers.openai.com/codex/app-server).

ChatGPT Desktop:

- ChatGPT macOS has "Work with Apps" for IDEs, terminals, and notes. It reads selected/open app context and can make code edits in supported IDEs, but this is ChatGPT reading other apps, not another app receiving ChatGPT response events. Source: [OpenAI Work with Apps on macOS](https://help.openai.com/en/articles/10119604-work-with-apps-on-macos).
- ChatGPT Apps SDK connectors are MCP-based, but OpenAI documents that the MCP server must be reachable over HTTPS for ChatGPT connector creation. Local development requires a public tunnel such as ngrok or Cloudflare Tunnel. Source: [OpenAI Apps SDK, Connect from ChatGPT](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt).
- MCP Apps in ChatGPT run embedded UIs through the MCP Apps standard bridge. Source: [OpenAI Apps SDK, MCP Apps in ChatGPT](https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt).

## Feasibility Matrix

| Surface | Best Integration | What We Can Reliably Get | Risk |
| --- | --- | --- | --- |
| Claude Code terminal | Existing hooks plus transcript watcher | Session id, cwd, transcript path, tools, prompts, final response, live streaming | Low |
| Codex CLI terminal | Existing hooks plus rollout watcher | Session id, cwd, transcript path, tools, prompt, latest answer, JSONL events | Low |
| Claude Desktop-hosted Claude Code | Existing Claude Code hooks plus Desktop attribution | Session id, cwd, parent/child PIDs, final response audio, tool hooks where Claude Code emits them, registry label/colour/voice/focus | Low-medium: automatic for hosted Claude Code, not for ordinary Claude Desktop chat text |
| Claude Desktop native chat | Terminal Talk MCP server or DXT | Claude can call `register_session`, `speak`, `set_session_state`, `mark_working` | Medium: not automatic unless Claude calls the tool |
| Claude Desktop calling Claude Code MCP | Pair Terminal Talk MCP with Claude Code MCP | Claude Desktop can run Claude Code tools and separately call Terminal Talk | Medium: Claude Code MCP is not the same as a normal terminal transcript |
| Codex app | Shared Codex rollout/state watcher plus app-server `thread/list` metadata | Desktop-created thread id, cwd/worktree, source, title/name, rollout path, updated time; persisted title writes | Medium: source currently reports as `vscode`, and visible title refresh is eventually consistent |
| Codex MCP server | Existing Codex session watcher plus `source_kind=codex-mcp` | Codex sessions launched by MCP tools may still write rollout data | Medium: needs live verification |
| ChatGPT Desktop | Manual/window attach, or Apps SDK HTTPS connector | Register/speak through MCP connector; selected-text speech fallback | High for automatic response capture |
| ChatGPT macOS Work with Apps | Potential future "Terminal Talk as supported app" concept | ChatGPT can read Terminal Talk if supported; not useful for response capture | High and platform-specific |

## Proposed Adapter Model

Add a desktop-source layer above the existing session registry.

Registry additions:

```json
{
  "source_kind": "claude-desktop",
  "source_label": "Claude Desktop",
  "source_app": "Claude",
  "source_pid": 12345,
  "source_window_title": "Claude",
  "source_cwd": "C:\\Users\\Ben\\Desktop\\terminal-talk",
  "adapter": "mcp",
  "capabilities": {
    "auto_register": true,
    "tool_events": false,
    "response_events": false,
    "manual_speak_selection": true
  }
}
```

Adapter tiers:

1. Full lifecycle adapter
   - Uses real hooks, transcripts, rollout files, or app-server events.
   - Can auto-register, mark working, narrate tools, and speak final responses.
   - Existing Claude Code and Codex CLI are already here.

2. Hook-backed desktop adapter
   - Uses ordinary CLI hooks fired from a desktop-managed assistant child process.
   - Can auto-register, mark working, narrate tools, and speak final responses when the hosted tool exposes those hooks.
   - Claude Desktop-hosted Claude Code now uses this tier.

3. MCP adapter
   - Exposes Terminal Talk as a tool the desktop assistant can call.
   - Can register a session and speak text, but only when the assistant calls the tool.
   - Best fit for native Claude Desktop chats that do not emit Claude Code hook payloads.

4. Manual desktop adapter
   - Detects an installed/running desktop app and lets the user attach it as a Terminal Talk session.
   - Hotkeys can speak selected/copied text under that attached label/voice.
   - No hidden scraping and no fake "automatic" claim.

## Terminal Talk MCP Server

Build a local MCP server named `terminal-talk`.

Implemented experimental files:

- `app/terminal-talk-mcp-server.js`
- `app/lib/terminal-talk-mcp-tools.js`

The server speaks stdio JSON-RPC and advertises Terminal Talk tools through `tools/list`. It is deployed in the live install at `C:\Users\Ben\.terminal-talk\app\terminal-talk-mcp-server.js`, but Claude Desktop config enablement is still a separate step because Claude Desktop must restart to load local MCP config changes.

Initial tools:

- `terminal_talk_register_session`
  - Input: label, source kind, optional project path, optional voice, optional colour.
  - Output: Terminal Talk `short_id`, label, current voice/colour, and instructions to use that id for future speech.

- `terminal_talk_speak`
  - Input: text, `short_id`, kind (`response`, `notification`, `tool`, `host`), optional priority.
  - Output: queued clip metadata.
  - Implementation should reuse the existing TTS path and queue format so playback, focus, mute, and sidecars still work.

- `terminal_talk_mark_working`
  - Input: `short_id`, state.
  - Output: current working state.

- `terminal_talk_set_session`
  - Input: `short_id`, label/voice/colour/focus/mute.
  - Output: updated registry entry.

- `terminal_talk_list_sessions`
  - Output: active Terminal Talk sessions and basic state. No private transcript contents.

Claude Desktop packaging:

- Development path: local stdio server in `claude_desktop_config.json`.
- Product path: DXT package so Claude Desktop users install it from Settings > Extensions.

ChatGPT packaging:

- ChatGPT Apps SDK connector path requires a Streamable HTTP MCP endpoint reachable over HTTPS.
- For local development, this means a deliberate tunnel plus auth.
- This is useful for demos and public product exposure, but it is not the same privacy posture as Claude Desktop local MCP.

## Codex App Strategy

The Codex app should get a separate spike because it has better official automation surfaces than ordinary ChatGPT Desktop.

Confirmed test result:

- A Codex Desktop prompt created a thread visible to a separate Terminal Talk-owned app-server watcher.
- The thread was stored as a normal rollout JSONL under `~\.codex\sessions\2026\05\03\...`.
- The thread source was `vscode`, not `appServer`.
- The cwd was a generated Codex worktree under `C:\Users\Ben\Documents\Codex\2026-05-03\...`.
- The title/name was available from `thread/list`.

Implementation test order:

1. Install/open Codex app if not already present as a separate Start entry.
2. Start one local Codex app thread in this repo.
3. Keep `~/.codex/hooks.json` disabled while testing Desktop; hooks are global and their UI status leaks into unrelated Codex sessions.
4. Check whether `~/.codex/sessions` rollout JSONL files update with app thread events.
5. Run a Terminal Talk-owned app-server watcher at the same time:
   - start `codex app-server --listen stdio:// --analytics-default-enabled`,
   - call `initialize` with `experimentalApi: true`,
   - call `thread/list` with explicit `sourceKinds` including `appServer`,
   - redact `preview` and turn contents during diagnostics.
6. Use rollout/app-server metadata to update `source_kind` labelling so Terminal Talk can distinguish `codex-cli`, `codex-desktop`, `codex-vscode`, and `codex-mcp`.
7. If hooks are not enough, build a read-only app-server watcher behind an experimental feature flag:
   - list active threads,
   - subscribe/read thread turn events,
   - map thread id to Terminal Talk short id,
   - queue assistant messages through the existing TTS path.

Codex Desktop classification should treat `source=vscode` plus a generated `Documents\Codex\YYYY-MM-DD\...` cwd and a running `OpenAI.Codex` process as likely `codex-desktop` unless a real VS Code Codex process/window is also detected.

Use app-server before reading app private databases. App-server is documented; local app cache scraping is brittle and privacy-sensitive.

## ChatGPT Desktop Strategy

ChatGPT Desktop is the least direct for Terminal Talk response capture.

Recommended approach:

1. Treat ChatGPT Desktop as a detectable desktop source.
2. Add "Attach active desktop chat" to Settings > Sessions.
3. Add "Speak selected text as attached session" and "Speak clipboard as attached session" hotkeys.
4. Build a Terminal Talk Apps SDK connector only after the local MCP server exists.

This gives users value without claiming automatic ChatGPT response narration where no supported local response event exists.

## Privacy And Security Rules

- Do not scrape Claude Desktop or ChatGPT Desktop conversation caches by default.
- Do not read app-local SQLite stores unless the user explicitly opts into a diagnostic spike.
- MCP tools should be minimal and audio-focused first. They should not expose broad filesystem access.
- Public HTTPS connectors for ChatGPT must require a token or short-lived capability secret.
- Keep spoken sidecars because the queue needs replayable transcript text, but respect existing pruning settings.
- Desktop/manual adapters must clearly indicate whether a session is automatic, MCP-driven, or manual.

## Implementation Phases

Phase 1: Desktop source detector

- Add a read-only detector for installed/running `Claude`, `ChatGPT`, and `Codex`.
- Show app version, process state, executable, and visible windows where available.
- Add no content reading.

Phase 2: Manual desktop session attach

- Add a Settings > Sessions action to attach the active Claude/ChatGPT/Codex window as a Terminal Talk session.
- Store source metadata in `session-colours.json`.
- Add a hotkey for "speak selection/clipboard as attached session".

Phase 3: Terminal Talk MCP server

- Build local stdio MCP server. Done experimentally in `app/terminal-talk-mcp-server.js`.
- Package Claude Desktop dev config and later a DXT.
- Add tests around registry writes and queue clip creation. Registry/write-state tests are in `scripts/run-tests.cjs`; full queue synthesis through MCP still needs a non-network audio smoke.

Phase 4: Codex app integration

- Do not use global Codex hooks for Codex Desktop. They are visible in unrelated sessions and cached by running Codex processes.
- Watch `~\.codex\sessions` and `thread/list` metadata for desktop-created rollout entries.
- Add classification for desktop-created sessions that currently report `source=vscode`.
- Implement experimental app-server watcher only for gaps that the rollout watcher cannot cover.

## Clean Reinstatement Contract

After the hook-noise regression, the product contract should be:

1. Claude Code terminal:
   - Keep the existing Claude hooks and transcript watcher. Claude hooks are scoped through Claude Code settings and have not shown the same Codex Desktop spillover problem.

2. Claude Desktop-hosted Claude Code:
   - Keep Claude Desktop session-file auto-registration and title stamping.
   - Let normal Claude Code hooks enrich the row when the hosted Claude Code process emits them.
   - Do not manually register duplicate MCP rows unless the session is native Claude Desktop chat without Claude Code metadata.

3. Codex CLI launched by Terminal Talk:
   - Use `app/codex-launch.ps1` and the rollout watcher for identity, title, audio, and tool narration.
   - Do not require global Codex hooks.

4. Codex Desktop:
   - Use rollout JSONL plus Terminal Talk-owned app-server `thread/list` / `thread/name/set`.
   - Auto-register and pin the registry row on the first Desktop `user_message`, before the first assistant response.
   - Treat visible Desktop title sync as persisted-pending-refresh unless a cold restart proves the renderer refreshed.
   - Do not install or require global Codex hooks.
   - Stamp a visible title identity in the Desktop session itself: `TT <Colour> · <label>`. Keep the internal registry short id in Terminal Talk settings/debug state, not in the Desktop chat title.

5. Generic Codex CLI sessions not launched by Terminal Talk:
   - Best-effort rollout watcher registration remains available when rollout metadata identifies a terminal source.
   - Optional global hooks can be enabled by an advanced user, but the installer must warn that this changes all Codex sessions under `~/.codex`.

6. Any future Desktop adapter:
   - Must prove whether it writes shared user-level config.
   - Must include a rollback path and a smoke test that a separate Codex/Claude session remains unaffected.

Phase 5: ChatGPT connector

- Wrap the MCP server as Streamable HTTP with auth.
- Document developer-mode/tunnel setup.
- Keep it opt-in because it exposes a local tool over HTTPS.

## First Implementation Slice

Build Phase 1 and Phase 2 together:

1. `app/lib/desktop-source-detector.js`
2. IPC handler: `get-desktop-sources`
3. Settings tab/panel: "Desktop apps"
4. Registry support for `source_kind`, `source_app`, `source_pid`, `source_window_title`, `adapter`, and `capabilities`
5. Manual attached-session creation
6. Hotkey path to queue selected/copied text under that session

This is the lowest-risk slice. It creates visible product value immediately and gives us a stable place to plug in Claude Desktop MCP and Codex app-server later.
