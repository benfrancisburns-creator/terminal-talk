"""Short spoken phrases for tool_use entries in a Claude Code transcript.

When Claude calls a tool (Read, Edit, Bash, Grep, etc.), the terminal shows
a truncated header and the full result is captured in the JSONL but only
partially shown. The listener is in the dark: "what is Claude actually
looking at right now?"

This module turns a `tool_use` entry into a tiny spoken status line —
"Reading synth_turn.py", "Running npm test", "Searching for foo" — that
the synth pipeline emits as an ephemeral clip (T- prefix). Ephemeral
clips are played once then auto-deleted by the renderer so they never
pile up in the dot strip alongside the main response content.

Design rules:
  - Phrases are <= ~50 chars so a narration clip stays short.
  - Long arguments (paths, regexes, commands, URLs) are truncated to the
    most human-useful part (basename for paths, first word for commands,
    domain for URLs, first 40 chars for patterns/queries).
  - Unknown tools and meta tools (task management, todo lists) return
    None → no narration emitted. Silent is better than wrong.
  - Pure function. No I/O, no side effects. Exports `narrate_tool_use`.
"""

from __future__ import annotations

import os
import re
from urllib.parse import urlparse

# Max chars taken from a free-form argument (pattern, query, description)
# before truncation. Keeps total phrase under ~50 chars including the
# leading verb. Tuned so "Searching for <pattern>" stays <= 50ch.
_ARG_MAX = 32


def _basename(path: str) -> str:
    """Return path's final component, tolerating Windows and POSIX slashes.
    Empty input returns empty."""
    if not path:
        return ''
    # Normalise both slash styles before splitting
    p = path.replace('\\', '/').rstrip('/')
    return os.path.basename(p) or p


def _truncate(s: str, limit: int = _ARG_MAX) -> str:
    """Truncate at `limit` chars; add ellipsis if cut."""
    if not s:
        return ''
    s = s.strip()
    if len(s) <= limit:
        return s
    # Prefer cutting at a space near the limit for cleaner truncation
    cut = s.rfind(' ', int(limit * 0.6), limit)
    if cut <= 0:
        cut = limit
    return s[:cut].rstrip() + '...'


def _domain(url: str) -> str:
    """Extract domain from URL; fall back to the URL itself if parsing
    fails. Strips common www prefix for natural speech."""
    if not url:
        return ''
    try:
        host = urlparse(url).netloc or url
    except Exception:
        host = url
    if host.startswith('www.'):
        host = host[4:]
    return host


def _first_word(cmd: str) -> str:
    """First whitespace-delimited token of a shell command. Handles
    leading env assignments like `FOO=bar cmd ...` by skipping until
    a token without '='."""
    if not cmd:
        return ''
    for tok in cmd.split():
        if '=' not in tok:
            return tok
    return ''


# Meta tools — useful to Claude but not meaningful to narrate aloud.
# Telling the user "Updating task list" for every TodoWrite would be
# a stream of noise. Silent is better.
_SKIP_TOOLS = {
    'taskcreate', 'taskupdate', 'tasklist', 'taskget', 'taskstop',
    'taskoutput', 'todowrite', 'scriptwakeup', 'croncreate', 'crondelete',
    'cronlist', 'exitplanmode', 'enterplanmode', 'enterworktree',
    'exitworktree', 'monitor', 'pushnotification', 'remotetrigger',
    'toolsearch', 'askuserquestion',
}

# MCP tool names arrive prefixed with `mcp__<server>__<tool>`. They're
# varied and usually not worth narrating verbatim. The helper below
# reduces them to a generic "Running MCP tool on <server>" if we ever
# want to re-enable; for now the default is skip.
_MCP_PREFIX_RE = re.compile(r'^mcp__([^_]+)__')


def narrate_tool_use(tool_name: str, tool_input: dict | None) -> str | None:
    """Return a short spoken phrase for this tool call, or None to skip.

    Phrases intentionally avoid full paths, full commands, or full
    arguments — the listener wants ambient awareness ("Claude is doing X
    right now"), not a read-out of the exact invocation.
    """
    if not tool_name:
        return None

    name = tool_name.strip().lower()
    inp = tool_input or {}

    # Skip meta tools entirely
    if name in _SKIP_TOOLS:
        return None

    # MCP tools: skip by default (varied + verbose). Could be enabled
    # per-tool later by adding specific mappings above this check.
    if _MCP_PREFIX_RE.match(name):
        return None

    if name == 'read':
        base = _basename(str(inp.get('file_path', '')))
        return f'Reading {base}' if base else 'Reading a file'

    if name == 'edit':
        base = _basename(str(inp.get('file_path', '')))
        return f'Editing {base}' if base else 'Editing a file'

    if name == 'write':
        base = _basename(str(inp.get('file_path', '')))
        return f'Writing {base}' if base else 'Writing a file'

    if name == 'notebookedit':
        base = _basename(str(inp.get('notebook_path', '')))
        return f'Editing notebook {base}' if base else 'Editing notebook'

    if name == 'glob':
        pat = _truncate(str(inp.get('pattern', '')))
        return f'Finding files matching {pat}' if pat else 'Finding files'

    if name == 'grep':
        pat = _truncate(str(inp.get('pattern', '')))
        return f'Searching for {pat}' if pat else 'Searching'

    if name == 'bash':
        first = _first_word(str(inp.get('command', '')))
        return f'Running {first}' if first else 'Running a command'

    if name == 'powershell':
        first = _first_word(str(inp.get('command', '')))
        return f'Running {first}' if first else 'Running a command'

    if name == 'webfetch':
        dom = _domain(str(inp.get('url', '')))
        return f'Fetching {dom}' if dom else 'Fetching a page'

    if name == 'websearch':
        q = _truncate(str(inp.get('query', '')))
        return f'Searching the web for {q}' if q else 'Searching the web'

    # Both names exist across Claude Code versions / wrappers — alias both.
    if name in ('agent', 'task'):
        desc = _truncate(str(inp.get('description', '')))
        return f'Delegating: {desc}' if desc else 'Starting a sub-agent'

    if name == 'skill':
        skill_name = str(inp.get('skill', '')).strip()
        return f'Using the {skill_name} skill' if skill_name else 'Using a skill'

    # Unknown tools: silent. Speculation would likely mispronounce or
    # mis-frame the action. Add explicit mappings above as new tools arrive.
    return None
