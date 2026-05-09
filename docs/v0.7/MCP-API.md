# Terminal Talk MCP API

**Status:** v0.6 · stable contract · five tools

Terminal Talk ships a Model Context Protocol server (`app/terminal-talk-mcp-server.js`) that lets external desktop assistants — most commonly **Claude Desktop Code** — register themselves as Terminal Talk audio sessions, speak text, mark working state, update session metadata, and list active sessions.

This document is the **integrator contract**. Read it if you're connecting a desktop app, custom client, or new assistant integration to Terminal Talk's audio queue.

If you only use Claude Code or Codex CLI, you don't need this — those wire up automatically through hooks and rollout watchers. The MCP API exists for clients that don't have a hook surface (Claude Desktop) or that want programmatic control over Terminal Talk's session graph.

---

## Connection

The server speaks JSON-RPC over stdio. Run it directly with:

```bash
node app/terminal-talk-mcp-server.js
```

It implements the MCP 2025-03-26 protocol with these capabilities:

```json
{
  "protocolVersion": "2025-03-26",
  "capabilities": { "tools": {} },
  "serverInfo": { "name": "terminal-talk", "version": "0.6.0" }
}
```

Self-test (without entering the JSON-RPC loop):

```bash
node app/terminal-talk-mcp-server.js --self-test
# → {"ok":true,"tools":["terminal_talk_register_session","terminal_talk_speak","terminal_talk_mark_working","terminal_talk_set_session","terminal_talk_list_sessions"]}
```

### Claude Desktop configuration

Add the server to `~/.claude/mcp.json` (or your platform's Claude Desktop equivalent):

```json
{
  "mcpServers": {
    "terminal-talk": {
      "command": "node",
      "args": ["C:\\Users\\YOU\\.terminal-talk\\app\\terminal-talk-mcp-server.js"],
      "env": {}
    }
  }
}
```

On macOS/Linux, replace the path with `~/.terminal-talk/app/terminal-talk-mcp-server.js` resolved as appropriate. Restart Claude Desktop after editing.

### Environment

The server reads Terminal Talk's home directory from these env vars (in order): `TT_HOME` → `TT_INSTALL_DIR` → platform default.

| Platform | Default home |
|---|---|
| Windows | `%USERPROFILE%\.terminal-talk` |
| Linux | `$XDG_STATE_HOME/terminal-talk` (typically `~/.local/state/terminal-talk`) |
| macOS | `~/.terminal-talk` |

Config path can be overridden with `TT_CONFIG_PATH`. On Linux, when neither `TT_HOME` nor `TT_INSTALL_DIR` is set, config defaults to `$XDG_CONFIG_HOME/terminal-talk/config.json`.

---

## Tools

### 1. `terminal_talk_register_session`

Register or reuse a Terminal Talk audio session. **Use this only for external desktop assistants** — Claude Code and Codex CLI auto-register through hooks and rollout watchers, so calling this for them creates duplicate rows.

#### Parameters

| Field | Type | Required | Description |
|---|---|---|---|
| `label` | string | no | Human-readable session label, e.g. `"Claude Desktop"`. If omitted, a label is generated from `source_kind` + `session_key`. |
| `source_kind` | string | no | Defaults to `"claude-desktop"`. Other recognised values: `"codex-desktop"`, `"custom"`. |
| `session_key` | string | no | **Stable key to reuse the same Terminal Talk row across calls.** Without this, every register creates a new session. Use a key that's stable across the integrator's restarts (e.g. Claude Desktop's conversation UUID). |
| `project_path` | string | no | Optional workspace root. Used in the Sessions table for context. |
| `voice` | string | no | Edge TTS voice id, e.g. `"en-GB-RyanNeural"`. Must match Edge's `<lang>-<region>-<name>Neural` pattern. |
| `colour` | string \| number | no | Palette colour name (`red`, `orange`, `yellow`, `green`, `blue`, `magenta`, `brown`, `white`) or palette index `0`–`23`. If omitted, the next free index is allocated. |
| `muted` | boolean | no | Initial mute state. |
| `focus` | boolean | no | Set as the focused session — clips from this session jump the queue. |

#### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "terminal_talk_register_session",
    "arguments": {
      "label": "Claude Desktop · Refactoring auth",
      "source_kind": "claude-desktop",
      "session_key": "conv-7e5c9a04",
      "voice": "en-GB-SoniaNeural",
      "colour": "magenta"
    }
  }
}
```

#### Result

```json
{
  "content": [{
    "type": "text",
    "text": "{\n  \"short_id\": \"7e5c9a04\",\n  \"label\": \"Claude Desktop · Refactoring auth\",\n  \"colour_index\": 5,\n  \"voice\": \"en-GB-SoniaNeural\",\n  \"reused\": false\n}"
  }]
}
```

The returned `short_id` (always 8 lowercase hex chars) is the handle for every other tool call. Save it.

---

### 2. `terminal_talk_speak`

Speak text through Terminal Talk under an existing session.

#### Parameters

| Field | Type | Required | Description |
|---|---|---|---|
| `short_id` | string | yes | The 8-char id returned by `register_session`. |
| `text` | string | yes | Text to synthesize and queue. Markdown is stripped per the session's speech-includes policy. |
| `kind` | enum | no | One of `"response"`, `"notification"`, `"tool"`, `"heartbeat"`. Defaults to `"response"`. Different kinds get different visual treatment in the dot strip. |
| `max_chars` | number | no | Optional maximum characters per audio chunk. Long text is sentence-split and queued as multiple clips; this caps each chunk's TTS request. |

#### Example

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "terminal_talk_speak",
    "arguments": {
      "short_id": "7e5c9a04",
      "text": "Refactor complete. All tests pass.",
      "kind": "response"
    }
  }
}
```

#### Behaviour

- Text is sentence-split (`app/sentence_split.py`) and synthesized in parallel via Edge TTS or OpenAI TTS depending on the session's voice.
- Clips land in `~/.terminal-talk/queue/` and are picked up by the Electron renderer's queue watcher.
- The session's mute state, focus state, and global TTS provider preference all apply.
- A muted session's `speak` call returns successfully but produces no audio.

---

### 3. `terminal_talk_mark_working`

Mark a session as working (still doing something) or idle. Affects heartbeat narration timing and visual state in the toolbar.

#### Parameters

| Field | Type | Required | Description |
|---|---|---|---|
| `short_id` | string | yes | Session id. |
| `working` | boolean | no | `true` to mark working, `false` to mark idle. |
| `state` | enum | no | Alternative to `working` — pass `"working"` or `"idle"` as a string. |

Pass either `working` or `state`, not both. If both are passed, `working` wins.

#### Example

```json
{
  "method": "tools/call",
  "params": {
    "name": "terminal_talk_mark_working",
    "arguments": { "short_id": "7e5c9a04", "working": true }
  }
}
```

#### Why this matters

Heartbeat narration (`"Pondering..."`, `"Thinking through it..."`) only fires for sessions in working state when the queue has been silent for 5+ seconds. Marking a session idle stops those ambient pings and suppresses the working indicator on its tab.

---

### 4. `terminal_talk_set_session`

Update label, colour, voice, mute, or focus for an existing session.

#### Parameters

| Field | Type | Required | Description |
|---|---|---|---|
| `short_id` | string | yes | Session id. |
| `label` | string | no | New display label. |
| `colour` | string \| number | no | Palette name or index. Same accepted values as register. |
| `colour_index` | number | no | Alternative integer-only form. |
| `voice` | string | no | Edge voice id (validated against the regex). |
| `muted` | boolean | no | New mute state. |
| `focus` | boolean | no | If `true`, this session becomes the focused one (any other session loses focus). |

Only fields that are present in the call are updated. Omitted fields are unchanged.

#### Example

```json
{
  "method": "tools/call",
  "params": {
    "name": "terminal_talk_set_session",
    "arguments": {
      "short_id": "7e5c9a04",
      "label": "Claude Desktop · Done",
      "muted": true
    }
  }
}
```

---

### 5. `terminal_talk_list_sessions`

List all known sessions and basic state. **Does not expose transcript contents** — for privacy, the call returns metadata only.

#### Parameters

None.

#### Example response

```json
{
  "content": [{
    "type": "text",
    "text": "[\n  {\n    \"short_id\": \"7e5c9a04\",\n    \"label\": \"Claude Desktop · Refactoring auth\",\n    \"source_kind\": \"claude-desktop\",\n    \"colour_index\": 5,\n    \"voice\": \"en-GB-SoniaNeural\",\n    \"muted\": false,\n    \"focus\": false,\n    \"working\": true,\n    \"last_seen\": 1762553428\n  },\n  {\n    \"short_id\": \"a08f2b71\",\n    \"label\": \"Codex CLI\",\n    \"source_kind\": \"codex-cli\",\n    \"colour_index\": 12,\n    \"voice\": \"en-GB-RyanNeural\",\n    \"muted\": false,\n    \"focus\": true,\n    \"working\": false,\n    \"last_seen\": 1762553410\n  }\n]"
  }]
}
```

---

## Errors

JSON-RPC errors follow the standard codes:

| Code | Meaning |
|---|---|
| `-32601` | Method not found (unknown tool name or RPC method). |
| `-32000` | Tool execution error. The `message` field carries the detail (e.g. `"unknown short_id"`, `"voice does not match Edge naming"`, `"session not found"`). |

Examples:

```json
// Unknown tool
{ "jsonrpc": "2.0", "id": 7, "error": { "code": -32601, "message": "method not found: tools/foo" } }

// Bad voice id
{ "jsonrpc": "2.0", "id": 8, "error": { "code": -32000, "message": "voice 'en-Bad-Format' does not match Edge naming" } }
```

The server catches all exceptions, returns them as `-32000`, and continues running. It never crashes on bad input.

---

## What this API does NOT expose

By design, the MCP server is read-mostly for sensitive state. It will not:

- Return transcript text content
- Expose the OpenAI API key (encrypted at rest)
- Modify hotkey bindings, statusline config, or hook registrations
- Stop, pause, or restart audio playback (this is renderer-owned)
- Delete sessions or clip files

If your integration needs any of these, file a GitHub issue describing the use case — they're plausibly addable behind a clear consent prompt.

---

## Validation rules

| Field | Rule |
|---|---|
| `short_id` | Must match `/^[a-f0-9]{8}$/`. Calls with malformed ids return `-32000`. |
| `voice` | Must match `/^[A-Za-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z]+(?:Multilingual|Expressive)?Neural$/`. |
| `colour` (string) | Must be one of `red`, `orange`, `yellow`, `green`, `blue`, `magenta`, `brown`, `white`. |
| `colour` / `colour_index` (number) | Must be integer `0`–`23`. |
| `kind` | Must be one of `response`, `notification`, `tool`, `heartbeat`. |
| `state` | Must be `working` or `idle`. |

Validation failures return `-32000` with a descriptive `message`.

---

## Versioning

The MCP protocol version is pinned at `2025-03-26`. The Terminal Talk version returned in `serverInfo.version` matches the project's release version (currently `0.6.0`).

Tool schemas are stable for v0.x — fields may be added but never removed or renamed without a major version bump and explicit migration notes in `CHANGELOG.md`.

---

## Implementation reference

- Server: [`app/terminal-talk-mcp-server.js`](../app/terminal-talk-mcp-server.js)
- Tool implementations: [`app/lib/terminal-talk-mcp-tools.js`](../app/lib/terminal-talk-mcp-tools.js)
- Session registry storage: `~/.terminal-talk/session-colours.json`
- Audio queue: `~/.terminal-talk/queue/`

For bugs in the MCP path specifically, file an issue tagged `mcp`. For security concerns, use [private Security Advisories](https://github.com/benfrancisburns-creator/terminal-talk/security/advisories/new).
