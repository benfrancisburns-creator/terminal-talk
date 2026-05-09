"""Terminal Talk — per-turn synthesis orchestrator.

Called from two hooks:
  on-tool  (PreToolUse)  — synthesise any unspoken assistant text so far
  on-stop  (Stop)         — synthesise whatever remains + extract questions

Why this script exists: we want audio to start within ~2-3s of Claude producing
text, not 6-24s. We achieve that by (a) splitting the text into sentences and
synthesising them in parallel (ThreadPoolExecutor), (b) rolling each completed
clip into the queue as soon as its predecessors are done, and (c) also firing
mid-response as each tool starts so streaming audio follows Claude's output.

Military-grade bits:
  - Malformed JSON lines skipped silently (never crash)
  - Sync state read/written atomically (temp + os.replace)
  - Per-session isolation — no state shared across concurrent sessions
  - Lock file prevents two invocations from racing on the same session
  - edge-tts invocations isolated: one failure never blocks the others
  - Sentinels/placeholders in sentence splitter avoid mangling abbrev/URL/decimal
  - Sessionshort is regex-validated before file paths are constructed
  - Every error path logs to _hook.log; nothing fails silently

Trust boundary (D2-4):
  This script trusts any same-user process that invokes it. Hooks call
  `Start-Process python synth_turn.py --session <id> --transcript <path>
  --mode <...>` without authentication; nothing here verifies the caller
  beyond arg shape. That is intentional -- Terminal Talk is a single-
  user desktop app, and any attacker running under the user's own
  account already has access to every file, the microphone, and the
  keyboard. A signature check between same-user processes would be
  defence theatre. See `docs/architecture/ipc-integrity.md` for the
  full decision and the scenarios that would reverse it (multi-user
  install, browser-extension companion, packaged least-privilege
  execution).
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import socket
import sys
import time
from concurrent.futures import Future, ThreadPoolExecutor
from concurrent.futures import wait as wait_futures
from datetime import datetime
from pathlib import Path
from threading import Lock

try:
    from sentence_group import group_sentences_for_tts
    from tool_narration import extract_visible_context_scope, leading_tool_verb, narrate_tool_use, vary_tool_phrase
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from sentence_group import group_sentences_for_tts
    from tool_narration import extract_visible_context_scope, leading_tool_verb, narrate_tool_use, vary_tool_phrase


# ---------------------------------------------------------------------------
# Paths + constants
# ---------------------------------------------------------------------------

# D2-3d — `TT_HOME` env var overrides the default root so the test
# harness can redirect to a temp dir and never touch the user's live
# registry / queue while an Electron toolbar is running. Without this,
# a concurrent main.js `saveAssignments` can overwrite a test's
# seeded registry between the seed-write and synth_turn reading it,
# leaking a synthesised clip under a stale test-fixture short.
def _default_tt_home() -> Path:
    if sys.platform.startswith('linux'):
        return Path(os.environ.get('XDG_STATE_HOME') or (Path.home() / '.local' / 'state')) / 'terminal-talk'
    return Path.home() / '.terminal-talk'


_TT_HOME_ENV = os.environ.get('TT_HOME') or os.environ.get('TT_INSTALL_DIR')
TT_HOME = Path(_TT_HOME_ENV) if _TT_HOME_ENV else _default_tt_home()
QUEUE_DIR = TT_HOME / 'queue'
SESSIONS_DIR = TT_HOME / 'sessions'
if os.environ.get('TT_CONFIG_PATH'):
    CONFIG_PATH = Path(os.environ['TT_CONFIG_PATH'])
elif sys.platform.startswith('linux') and not _TT_HOME_ENV:
    CONFIG_PATH = Path(os.environ.get('XDG_CONFIG_HOME') or (Path.home() / '.config')) / 'terminal-talk' / 'config.json'
else:
    CONFIG_PATH = TT_HOME / 'config.json'
# D2 safeStorage sidecar. Main.js (Electron) decrypts the OpenAI API
# key via safeStorage on load and writes plaintext here for same-user
# non-Electron consumers (PS hooks + this script) to read. ACL'd to
# the current user on install; absent if the user never set a key.
SECRETS_PATH = Path(
    os.environ.get('TT_SECRETS_PATH') or (CONFIG_PATH.parent / 'config.secrets.json')
)
REGISTRY_PATH = TT_HOME / 'session-colours.json'
LOG_PATH = QUEUE_DIR / '_hook.log'
EDGE_TTS_SCRIPT = Path(__file__).resolve().parent / 'edge_tts_speak.py'


def _load_openai_key_from_secrets():
    """Return the OpenAI API key from `config.secrets.json`, or None.
    Never throws -- a malformed or unreadable sidecar is treated as
    "no key", which falls through to the legacy config.json reader
    and from there to the null path (no OpenAI fallback this turn)."""
    if not SECRETS_PATH.exists():
        return None
    try:
        with open(SECRETS_PATH, encoding='utf-8') as f:
            data = json.load(f)
        key = data.get('openai_api_key')
        return str(key) if key else None
    except Exception:
        return None

# Max parallel edge-tts workers. Edge-tts endpoint tolerates a handful of
# concurrent requests; too many → rate limits and backoff storm.
MAX_PARALLEL_SYNTH = 4

# Per-synthesis safety timeout (seconds). edge_tts_speak already retries up
# to 6 times with its own backoff; this is the last-resort kill.
# Per-attempt timeout on the edge-tts subprocess. Was 40 s but _run_edge_tts
# retries 3 times — so worst case was 120 s of total silence on a single
# flaky sentence (the rolling-release lock blocks later sentences until the
# stuck one resolves). At 15 s × 3 retries = 45 s worst case, users now
# notice "oh, something's gone wrong" instead of assuming the app is frozen.
# Responsiveness audit R4.
SYNTH_TIMEOUT_SEC = 15
# OpenAI's /v1/audio/speech is noticeably slower than edge-tts — short
# prose regularly takes 5–15 s, longer chunks can run 20–30 s on a
# congested OpenAI endpoint or a poor connection. The edge-tts cap
# above is tight because edge-tts retries; OpenAI is single-shot per
# invocation, so a harder cap here means every turn falls back to
# edge-tts and the user's "Prefer OpenAI" toggle is effectively a
# no-op. Observed 2026-04-23: every /clear turn timed out at 15 s
# and played in Edge voice despite the toggle being on. 60 s is a
# generous ceiling that still guarantees a stuck request can't wedge
# a whole batch — synthesize_parallel's 2× SYNTH_TIMEOUT outer cap
# overrides individual tasks anyway.
SYNTH_OPENAI_TIMEOUT_SEC = 60

# Lock file timeout: if another invocation is holding the lock for this
# session longer than this, assume it's dead and proceed.
LOCK_STALE_SEC = 60

# How long to wait trying to acquire the per-session lock before giving up.
# Previously 2 s (40 × 50 ms polling). That's shorter than the edge-tts
# retry budget (3 attempts × 15 s = 45 s worst case), so a backlog of
# PreToolUse fires would cascade: fire 1 holds the lock through its
# retries, fires 2..N give up after 2 s and "proceed without" — reading
# stale state and re-narrating tool-use entries fire 1 hadn't marked
# announced yet. User heard the same "Reading X / Running Y" phrase 3-4×
# per tool call. 30 s now matches real synth duration; on ultimate
# timeout (stale-lock steal at LOCK_STALE_SEC already handled during
# polling), the new run exits rather than duplicating work.
LOCK_ACQUIRE_TIMEOUT_SEC = 30

# Sessionshort validation: 8 hex chars. Refusing anything else stops path
# traversal via crafted transcript paths.
SESSION_SHORT_RE = re.compile(r'^[a-f0-9]{8}$')

# Edge-voice shape: <lang>-<region>-<Name>[Multilingual|Expressive]Neural.
# Used to reject cross-provider voice strings (OpenAI: 'nova', 'onyx', etc.)
# that the UI can save as a per-session override. Without this guard, the
# Edge fallback path passes 'nova' to edge_tts.Communicate() which fails
# with rc=1 size=0; combined with an exhausted OpenAI quota the session
# loses ALL audio while other sessions keep working. Audit by Codex
# adversarial review 2026-04-29.
EDGE_VOICE_RE = re.compile(
    r'^[A-Za-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z]+'
    r'(?:Multilingual|Expressive)?Neural$'
)

SESSIONSHORT_LEN = 8


def _ensure_dirs() -> None:
    for d in (QUEUE_DIR, SESSIONS_DIR):
        d.mkdir(parents=True, exist_ok=True)


def _log(msg: str) -> None:
    """Best-effort append to the shared hook log."""
    try:
        _ensure_dirs()
        # Rotate past 1 MB (matches speak-response.ps1 convention)
        if LOG_PATH.exists() and LOG_PATH.stat().st_size > 1_048_576:
            LOG_PATH.replace(LOG_PATH.with_suffix('.log.1'))
        with open(LOG_PATH, 'a', encoding='utf-8') as f:
            f.write(f'{datetime.now():%H:%M:%S.%f} [synth] {msg}\n')
    except Exception:
        pass  # logging must never raise


# ---------------------------------------------------------------------------
# Sync state  (per-session, atomic read/write)
# ---------------------------------------------------------------------------

def _sync_path(session_id: str) -> Path:
    return SESSIONS_DIR / f'{session_id}-sync.json'


def _lock_path(session_id: str) -> Path:
    return SESSIONS_DIR / f'{session_id}-sync.lock'


def load_sync_state(session_id: str) -> dict:
    p = _sync_path(session_id)
    if not p.exists():
        return {
            'turn_boundary': -1,
            'synthesized_line_indices': [],
            'announced_tool_line_indices': [],
            'partial_text_offsets': {},
        }
    try:
        with open(p, encoding='utf-8') as f:
            data = json.load(f)
        # Back-compat: earlier sync files missing newer fields default
        # to empty — no crash, no re-synth.
        raw_offsets = data.get('partial_text_offsets', {}) or {}
        # JSON keys are always strings; coerce to int for easier use.
        partial_text_offsets = {}
        for k, v in raw_offsets.items():
            try:
                partial_text_offsets[int(k)] = int(v)
            except (TypeError, ValueError):
                continue
        return {
            'turn_boundary': int(data.get('turn_boundary', -1)),
            'synthesized_line_indices': list(data.get('synthesized_line_indices', [])),
            'announced_tool_line_indices': list(data.get('announced_tool_line_indices', [])),
            # Phase 2 (on-stream): per-line char offset of how much of a
            # growing assistant text entry we've already synthesised. A
            # 3000-char response entry can land incrementally in the JSONL
            # as Claude streams tokens; this lets on-stream mode synth
            # the first few sentences as they appear, remember where it
            # stopped, and pick up the rest on the next poll.
            'partial_text_offsets': partial_text_offsets,
        }
    except Exception as e:
        _log(f'sync state read fail ({session_id[:8]}): {e}; resetting')
        return {
            'turn_boundary': -1,
            'synthesized_line_indices': [],
            'announced_tool_line_indices': [],
            'partial_text_offsets': {},
        }


def save_sync_state(session_id: str, state: dict) -> None:
    p = _sync_path(session_id)
    tmp = p.with_suffix('.json.tmp')
    try:
        _ensure_dirs()
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(state, f)
        os.replace(tmp, p)  # atomic on Win + POSIX
    except Exception as e:
        _log(f'sync state write fail ({session_id[:8]}): {e}')


class _SessionLock:
    """File-based lock to prevent two synth_turn.py runs racing on one session.

    Acquires by creating a lockfile exclusively. If the file exists but is
    older than LOCK_STALE_SEC, treat as stale and steal. Best-effort — we log
    and continue if locking fails; duplicate clips are cheaper than silence.
    """

    def __init__(self, session_id: str):
        self.path = _lock_path(session_id)
        self.acquired = False

    def __enter__(self):
        _ensure_dirs()
        # S2.1: lockfile payload now records pid + host + acquisition time
        # (ms since epoch) instead of a bare PID. Host guards against
        # different machines sharing a networked sessions/ via cloud
        # backup; ms timestamp disambiguates PID re-use on fast turn loops.
        payload = f'{os.getpid()}:{socket.gethostname()}:{int(time.time() * 1000)}'
        self._payload = payload
        # Poll at 50 ms -> total attempts = timeout_sec × 20.
        attempts = max(1, LOCK_ACQUIRE_TIMEOUT_SEC * 20)
        for _ in range(attempts):
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(fd, payload.encode())
                os.close(fd)
                self.acquired = True
                return self
            except FileExistsError:
                try:
                    age = time.time() - self.path.stat().st_mtime
                    if age > LOCK_STALE_SEC:
                        _log(f'stealing stale lock ({age:.0f}s old)')
                        self.path.unlink(missing_ok=True)
                        continue
                except FileNotFoundError:
                    continue
                time.sleep(0.05)
        # Couldn't acquire within timeout. Don't "proceed without" — that
        # was the 2026-04-23 duplication bug: racing synth_turn runs each
        # read stale state and re-narrated the same tool_use entries 3-4
        # times per call. The current holder will mark those entries
        # announced on its own exit; the NEXT PreToolUse fire will spawn
        # a fresh run that sees the correct state and picks up any genuine
        # new deltas. self.acquired stays False so the caller knows to
        # skip its work.
        _log(
            f'could not acquire session lock within {LOCK_ACQUIRE_TIMEOUT_SEC}s; '
            f'skipping this run (holder will cover these entries)'
        )
        return self

    def __exit__(self, *_exc):
        if not self.acquired:
            return
        # S2.1: only unlink if the lockfile still has OUR payload. Prevents
        # an __exit__ after PID reuse from deleting another invocation's
        # fresh lock. A crash-then-restart scenario would otherwise hand
        # the stale-lock path a running PID that happens to match.
        try:
            existing = self.path.read_bytes().decode('utf-8', 'replace')
            mine_pid = str(os.getpid())
            # Match pid prefix only (payload might've been truncated on
            # disk or the host/timestamp rewritten). Enough to prevent
            # the cross-process delete-wrong-lock failure mode.
            if existing.split(':', 1)[0] == mine_pid:
                self.path.unlink(missing_ok=True)
            else:
                _log(
                    f'session lock owned by another process '
                    f'(payload={existing!r}, mine_pid={mine_pid}) -- leaving in place'
                )
        except FileNotFoundError:
            pass  # already gone; nothing to do
        except Exception as e:
            _log(f'session lock release failed: {type(e).__name__}: {e}')


# ---------------------------------------------------------------------------
# Transcript extraction
# ---------------------------------------------------------------------------

def read_transcript_lines(transcript_path: Path) -> list[dict]:
    """Parse transcript JSONL. Invalid lines are skipped with a log entry."""
    entries: list[dict] = []
    try:
        with open(transcript_path, encoding='utf-8') as f:
            for raw in f:
                raw = raw.strip()
                if not raw:
                    entries.append({})  # keep index alignment
                    continue
                try:
                    entries.append(json.loads(raw))
                except json.JSONDecodeError:
                    entries.append({})
    except FileNotFoundError:
        _log(f'transcript missing: {transcript_path}')
    except Exception as e:
        _log(f'transcript read fail: {e}')
    return entries


def find_last_user_idx(entries: list[dict]) -> int:
    """Line index (0-based) of the most recent REAL user prompt, or -1.

    tool_result entries also carry type='user' in the JSONL, but they're
    mid-turn (the tool returning to Claude), not a new turn boundary.
    Treating them as user prompts caused on-stream to skip every
    intermediate assistant-text chunk in a multi-tool-call turn: every
    tool_result jumped turn_boundary past the text Claude had just
    written, so assistant_text_entries_after(…, user_idx) came back
    empty and the watcher exited quiet. Fix: only count user entries
    whose content is NOT a tool_result block.
    """
    for i in range(len(entries) - 1, -1, -1):
        e = entries[i]
        if e.get('type') != 'user':
            continue
        content = e.get('message', {}).get('content', [])
        if isinstance(content, list):
            is_tool_result = any(
                isinstance(c, dict) and c.get('type') == 'tool_result'
                for c in content
            )
            if is_tool_result:
                continue
        return i
    return -1


def assistant_text_entries_after(entries: list[dict], start_idx: int) -> list[tuple]:
    """Return list of (line_idx, text) for assistant-text content after start_idx."""
    out: list[tuple] = []
    for i in range(start_idx + 1, len(entries)):
        e = entries[i]
        if e.get('type') != 'assistant':
            continue
        content = e.get('message', {}).get('content', [])
        texts = [c.get('text', '') for c in content if c.get('type') == 'text']
        text = '\n'.join(t for t in texts if t)
        if text.strip():
            out.append((i, text))
    return out


# Sentence-terminator scan for streaming safety. We only synth content
# up to the LAST terminator in the growing suffix — anything after the
# last `.!?` might be an in-progress sentence that'll grow on the next
# poll. Without this, on-stream could speak "Let me chec" mid-token.
_STREAM_SAFE_END_RE = re.compile(r'[.!?][")\]]*(?=\s|$)')


def _safe_stream_slice(content: str, start: int) -> tuple[str, int]:
    """Return (slice, new_offset) for the portion of `content[start:]`
    that ends on a complete sentence. Empty slice means 'nothing new
    is fully-formed yet, wait for more tokens'. Offsets are absolute
    positions in the original content string."""
    if start >= len(content):
        return ('', start)
    tail = content[start:]
    # Find the LAST sentence-terminator in the tail. Using finditer +
    # max so we always pick the latest safe boundary, not the first one.
    last_end = -1
    for m in _STREAM_SAFE_END_RE.finditer(tail):
        last_end = m.end()
    if last_end < 0:
        # No terminator yet — defer.
        return ('', start)
    return (tail[:last_end], start + last_end)


def tool_use_entries_after(entries: list[dict], start_idx: int) -> list[tuple]:
    """Return list of (line_idx, tool_name, tool_input, tool_result) for
    assistant tool_use content after start_idx. One tuple per tool_use
    block; a single assistant entry can contain multiple parallel tool
    calls, each emitted separately.

    `tool_result` is the structured `toolUseResult` dict from the matching
    user-side tool_result entry — paired by `tool_use_id` — or None when
    the result hasn't landed yet (in-flight on-tool fire) or the entry
    didn't include the structured field. Lets narrate_tool_use surface
    counts ("found 26 files") and stdout heads ("755 passed") that live
    only on the result side, never on the input."""
    # Pre-index toolUseResult dicts by tool_use_id so we don't quadratic-
    # scan for every emitted tool_use. Cheap walk through the same slice.
    results_by_id: dict[str, dict] = {}
    for j in range(start_idx + 1, len(entries)):
        ej = entries[j]
        if ej.get('type') != 'user':
            continue
        msg_content = ej.get('message', {}).get('content', [])
        if not isinstance(msg_content, list):
            continue
        # Pair via the tool_use_id field on the inner tool_result block.
        # The structured payload sits at the entry's top level under
        # `toolUseResult`; the inner content[].content is just the
        # truncated text Claude sees.
        tool_use_id = None
        for c in msg_content:
            if isinstance(c, dict) and c.get('type') == 'tool_result':
                tool_use_id = c.get('tool_use_id')
                break
        if not tool_use_id:
            continue
        result = ej.get('toolUseResult')
        if isinstance(result, dict):
            results_by_id[tool_use_id] = result

    out: list[tuple] = []
    for i in range(start_idx + 1, len(entries)):
        e = entries[i]
        if e.get('type') != 'assistant':
            continue
        content = e.get('message', {}).get('content', [])
        if not isinstance(content, list):
            continue
        for c in content:
            if c.get('type') != 'tool_use':
                continue
            tool_name = str(c.get('name', '')).strip()
            tool_input = c.get('input') if isinstance(c.get('input'), dict) else {}
            tool_use_id = c.get('id')
            tool_result = results_by_id.get(tool_use_id) if tool_use_id else None
            if tool_name:
                out.append((i, tool_name, tool_input, tool_result))
    return out


# ---------------------------------------------------------------------------
# Sanitisation  (mirrors speak-response.ps1 lines 260-306)
# ---------------------------------------------------------------------------

# Code fence regex now captures TWO groups: the language tag (possibly
# empty) and the body. Language tag presence is a strong signal the
# block is genuinely code; absence + non-code body means the block is
# prose dressed in ``` for visual effect (a common LLM pattern that
# used to vanish from audio silently).
_CODE_FENCE_RE = re.compile(r'```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```')

# Patterns that strongly indicate the content is real code, not prose.
# Tuned to avoid false positives on prose that merely mentions
# programming terms ("use the class keyword"). Each pattern looks for
# SYNTAX, not just keyword presence.
_CODE_SIGNAL_PATTERNS = [
    # Function / class definitions — identifier followed by paren or colon
    re.compile(r'\b(def|function|fn|class)\s+\w+\s*[({:<]'),
    # Import statements at line start
    re.compile(r'^\s*(import|from|require|using|package)\s+[\w.]', re.MULTILINE),
    # Control flow with code-style parens or trailing colons
    re.compile(r'^\s*(if|else|elif|for|while|try|except|catch|with|switch)\s*\(', re.MULTILINE),
    re.compile(r'^\s*(if|elif|else|for|while|try|except|with|def|class)\b[^.!?\n]{0,120}:\s*$', re.MULTILINE),
    # Shell prompts / invocations at line start
    re.compile(r'^\s*[#$>]\s+\S', re.MULTILINE),
    re.compile(
        r'^\s*(npm|yarn|pnpm|git|pip|pipx|apt|sudo|rm|mkdir|cd|ls|cp|mv|cat|echo|'
        r'curl|wget|python|python3|node|ruby|go|cargo|rustc|java|javac|mvn|gradle|'
        r'docker|podman|kubectl|helm|terraform|aws|gcloud|az|taskkill|chmod|chown|'
        r'ssh|scp|rsync|tar|unzip|make|cmake|gcc|clang)\s+[-\w/]', re.MULTILINE,
    ),
    # PowerShell cmdlets (Verb-Noun pattern)
    re.compile(r'\b(Get|Set|New|Remove|Test|Invoke|Start|Stop|Write|Read|Import|Export|Add|Copy|Move|Out)-[A-Z]\w+\s'),
    # JSON / object-literal opener lines
    re.compile(r'^\s*[\{\[]\s*$', re.MULTILINE),
    re.compile(r'^\s*"[\w.-]+":\s*(null|true|false|-?\d|"|\{|\[)', re.MULTILINE),
    # Arrow / pointer / scope operators specific to code
    re.compile(r'=>\s*[\w(\{\[]'),
    re.compile(r'->\s*\w'),
    re.compile(r'::\s*\w'),
    # Trailing semicolon statement endings (3+ required — stops a single
    # sentence like "Oh; right" from flipping a whole block).
    re.compile(r';\s*\n'),
]


def _looks_like_code(content: str) -> bool:
    """Return True if `content` contains enough code-syntax signals to
    be treated as real code. Called only when a ``` fence has NO
    language tag — tagged fences are always treated as code.

    Prefers false positives (strip prose that has 2+ code signals)
    over false negatives (speak code that shouldn't be spoken). A
    mis-stripped prose block is a known-failure mode we can fix with
    tag or pattern tweaks; a mis-spoken code block is annoying noise.
    """
    if not content or not content.strip():
        return False
    hits = 0
    for pat in _CODE_SIGNAL_PATTERNS:
        hits += len(pat.findall(content))
        if hits >= 2:  # early-exit once threshold is crossed
            return True
    # A single hit is ambiguous — could be a prose block that mentions
    # one code-like token ("see git log for the history"). Don't flip
    # the whole block on one signal.
    return False


def _code_language_name(lang: str) -> str:
    key = (lang or '').strip().lower()
    names = {
        'js': 'javascript',
        'jsx': 'javascript',
        'cjs': 'javascript',
        'mjs': 'javascript',
        'ts': 'typescript',
        'tsx': 'typescript',
        'py': 'python',
        'ps1': 'powershell',
        'psm1': 'powershell',
        'pwsh': 'powershell',
        'sh': 'shell',
        'bash': 'shell',
        'zsh': 'shell',
        'yml': 'yaml',
    }
    return names.get(key, key)


def _code_identifier_to_words(name: str) -> str:
    s = re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', name or '')
    s = re.sub(r'(?<=[A-Z])(?=[A-Z][a-z])', ' ', s)
    s = re.sub(r'[_-]+', ' ', s)
    return re.sub(r'\s+', ' ', s).strip().lower()


def _clean_code_block_label(label: str) -> str:
    s = re.sub(r'[`*_#~|]+', ' ', label or '')
    s = re.sub(r'[^A-Za-z0-9]+', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip().lower()
    words = s.split()
    return ' '.join(words[:10])


def _code_block_focus(content: str) -> str:
    class_match = re.search(
        r'^[ \t]*(?:export\s+)?(?:class|interface)\s+([A-Za-z_$][\w$]*)',
        content,
        re.MULTILINE,
    )
    if class_match:
        return f'defines the {_code_identifier_to_words(class_match.group(1))} class'

    func_patterns = [
        r'^[ \t]*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(',
        r'^[ \t]*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(',
        r'^[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>',
        r'^[ \t]*function\s+([A-Z][A-Za-z]+-[A-Z][A-Za-z]+)',
    ]
    for pattern in func_patterns:
        m = re.search(pattern, content, re.MULTILINE)
        if m:
            return f'defines the {_code_identifier_to_words(m.group(1))} function'

    test_match = re.search(r'\b(?:describe|it|test)\s*\(\s*[\'"]([^\'"]{1,100})[\'"]', content)
    if test_match:
        label = _clean_code_block_label(test_match.group(1))
        if label:
            return f'contains the {label} tests'

    scope = extract_visible_context_scope(content)
    return f'around {scope}' if scope else ''


def _code_block_summary(lang: str, content: str) -> str:
    lines = len([ln for ln in (content or '').splitlines() if ln.strip()])
    if lines == 0:
        return ' '
    language = _code_language_name(lang)
    language_phrase = f' of {language}' if language else ''
    shape = ''
    focus = _code_block_focus(content)
    if focus:
        shape = f', {focus}'
    elif re.search(r'^[ \t]*(?:export\s+)?class\s+[A-Za-z_$][\w$]*', content, re.MULTILINE):
        shape = ', defines a class'
    elif (
        re.search(r'^[ \t]*(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(', content, re.MULTILINE)
        or re.search(r'^[ \t]*(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(', content, re.MULTILINE)
        or re.search(r'^[ \t]*(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>', content, re.MULTILINE)
        or re.search(r'^[ \t]*function\s+[A-Z][A-Za-z]+-[A-Z][A-Za-z]+', content, re.MULTILINE)
    ):
        shape = ', defines a function'
    elif re.search(r'\b(?:describe|it|test)\s*\(\s*[\'"]', content):
        shape = ', contains tests'
    elif re.search(r'^\s*(?:npm|yarn|pnpm|git|pip|python|python3|node|pwsh|powershell|docker|kubectl)\s+[-\w/]', content, re.MULTILINE):
        shape = ', shows shell commands'
    elif re.search(r'^\s*[\{\[]\s*$', content, re.MULTILINE) or re.search(r'^\s*"[\w.-]+":\s*', content, re.MULTILINE):
        shape = ', shows data'
    plural = 'line' if lines == 1 else 'lines'
    return f' Code block: {lines} {plural}{language_phrase}{shape}. '


# Inline code: GFM-style balanced backtick runs. `(backticks+)(content)\1`
# requires the closing run to have the same number of backticks as the
# opening. This correctly parses both single `foo` and double `` `foo` ``
# forms without the naive `\`([^\`]+)\`` regex's failure mode, where
# adjacent unmatched backticks from different code spans got mis-paired
# and content between them silently vanished. Newlines are excluded so
# cross-line runaway matches can't eat whole bullet-list paragraphs.
_INLINE_CODE_RE = re.compile(r'(`+)([^\n]+?)\1')
# Keyboard shortcuts inside inline code (e.g. `Ctrl+R`) are user-facing UI
# instructions, not code noise. They must survive the inline_code=False
# strip so the listener actually hears "control R" — otherwise the prose
# "hit `Ctrl+R` on the toolbar" silently collapses to "hit on the toolbar".
# The optional leading `\s*`?\s*` tolerates GFM double-backtick wrapping
# (`` `Ctrl+R` ``) where the captured content starts with " `Ctrl+R` "
# — we still want to recognise that as a shortcut.
_KBD_SHORTCUT_RE = re.compile(
    r'^\s*`?\s*(?:Ctrl|Cmd|Shift|Alt|Win|Super|Meta|Control|Command|Option|Windows)\s*\+',
    re.IGNORECASE,
)

# When inline_code=False we normally drop backticked spans, but a
# second class of backticks is prose: short technical identifiers
# (`session_id`, `/clear`, `main.js`, `Update-SessionAssignment`,
# `pid=0`) that appear inline in explanatory sentences. Stripping
# them turns "/clear rotates the session_id" into "rotates the" —
# sentence collapses. This heuristic keeps content that LOOKS like
# an identifier / filename / flag / literal and strips content that
# looks like real code (function calls, multi-statement blocks,
# piped shell commands).
_INLINE_PROSE_MAX_LEN = 30
# Disqualifiers — any match = strip (real code):
#   `(` or `)`           — function calls, if-conditions
#   `{` or `}`           — object literals, blocks
#   `=>` / `->` / `::`   — language operators
#   `; <nonspace>`       — two statements separated by semicolon
#   ` -\w` / ` --\w`     — shell-command flag preceded by a space
_INLINE_CODE_DISQUAL_RE = re.compile(
    r'[(){}]|=>|->(?![a-z])|::|;\s*\S|\s--?\w'
)


def _inline_looks_like_prose(content: str) -> bool:
    """Does this inline-code span read as prose (short identifier /
    filename / literal) rather than code syntax?"""
    if not content:
        return False
    trimmed = content.strip()
    if not trimmed or len(trimmed) > _INLINE_PROSE_MAX_LEN:
        return False
    if '\n' in trimmed:
        return False
    return not _INLINE_CODE_DISQUAL_RE.search(trimmed)
_URL_RE = re.compile(r'https?://\S+|www\.\S+', re.IGNORECASE)
_HEADING_LINE_RE = re.compile(r'^\s*#{1,6}\s*.*$', re.MULTILINE)
# Triple-asterisk emphasis (bold-italic ***x***) must be stripped BEFORE
# the double-asterisk rule, because a naive `\*\*(...)\*\*` on `***x***`
# matches the inner `**x**` and leaves a stray `*` on each side — which
# TTS dutifully reads as "asterisk". Bug reported by user hearing
# "asterisk asterisk foo asterisk asterisk" on bold-italic headings.
_TRIPLE_EMPHASIS_RE = re.compile(r'\*\*\*([^*\n]+)\*\*\*|___([^_\n]+)___')
# `\n` exclusion on every arm: prevents a leftover single `*` from a
# broken bold pair pairing across newlines with an unrelated stray `*`
# (e.g. `app/*` glob) and silently eating whole paragraphs as italic
# content. Cross-line emphasis would be surprising markdown anyway.
_EMPHASIS_RE = re.compile(r'\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_')
_IMG_RE = re.compile(r'!\[([^\]]*)\]\([^\)]+\)')
# All common keyboard modifiers in one regex — used to rewrite
# `Modifier+Key` into spoken words. Without this, `Ctrl+Shift+A` only
# translates the first segment and TTS reads the rest as "shift plus A".
# GFM markdown tables. Match a header row, an alignment-separator row
# (---|---|---), and one or more body rows. Without this transform the
# raw `| col | col |` lines pass through as one giant clip that edge-tts
# refuses (rc=1, size=0) — the listener loses the entire table silently.
# Replacement is a one-line speakable summary so the tabular content is
# at least announced. Anchored to start-of-line in MULTILINE mode.
_MARKDOWN_TABLE_RE = re.compile(
    r'^[ \t]*\|(?P<header>.+)\|[ \t]*\n'
    r'^[ \t]*\|(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*\n'
    r'(?P<rows>(?:^[ \t]*\|.+\|[ \t]*\n?)+)',
    re.MULTILINE,
)


def _table_cell_summary(cell: str) -> str:
    """Clean one markdown-table cell for a short spoken summary.

    HTML-tag stripping is selective: real HTML tags get stripped (e.g.
    `<br/>`, `<div class="x">`, `</span>`) but lower-case identifier-
    style placeholders inside angle brackets stay verbatim
    (`<file>`, `<one-line why>`, `<sha7>`). Without this, a decision-
    matrix table with template syntax loses its slot names — Ben hit
    this in the May-9 audit on a 12-row 'Kind | Template | What it
    cuts' table that read 'Edited : ' aloud."""
    s = str(cell or '')
    # Strip only attribute-bearing or close-tag forms; keep lower-case
    # placeholder syntax. `<file>` and `<one-line why>` survive;
    # `<br/>`, `<div class="x">`, `</p>` are removed.
    # Strip when the angle-bracket content has real HTML markup chars
    # (`=`, `"`, `/`). Anything else (placeholders like `<file>`,
    # `<one-line why>`, `<sha7>` and even uppercase `<TYPE>`) survives
    # verbatim because audio listeners need to hear the slot name.
    s = re.sub(r'<[^>]*[="/][^>]*>', ' ', s)
    s = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', s)
    s = re.sub(r'`+([^`\n]+?)`+', r'\1', s)
    s = re.sub(r'[*_~|]+', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


# Thresholds for table narration (tuned 2026-05-09 against 231-turn
# audit corpus that showed 12-row decision matrices losing 11/12 of
# their content under the original 10-row limit):
#   <= 25 rows  → read every row (most decision/comparison tables fit)
#   26-50 rows  → "abridged" mode: rows 1-3 + last 2, with an omitted-
#                 count note between them (preserves table shape +
#                 endpoint data without forcing 50-row monologue audio)
#   > 50 rows   → first-row sample only (truly massive enumerations —
#                 commit logs spanning months, file inventories etc.)
_TABLE_FULL_READ_ROW_LIMIT = 25
_TABLE_ABRIDGED_ROW_LIMIT = 50
_TABLE_ABRIDGED_HEAD_ROWS = 3
_TABLE_ABRIDGED_TAIL_ROWS = 2


def _table_row_phrase(header_cells: list[str], cells: list[str]) -> str:
    """Speakable rendering of one body row: 'col-name: cell; col-name: cell'.
    Empty cells skipped (no signal). Empty HEADERS get a 'col N' fallback
    so a table with `| | |` blank-header rows still narrates its data —
    the May-9 audit caught a 5-row 'Commits added · CI gates · Phases
    done' table reduced to just 'Table with 5 rows.' because every
    row produced an empty pair."""
    pairs = []
    for i in range(min(len(header_cells), len(cells))):
        if not cells[i]:
            continue
        label = header_cells[i] or f'col {i+1}'
        pairs.append(f'{label}: {cells[i]}')
    return '; '.join(pairs)


def _table_summary(m: re.Match[str]) -> str:
    """Replace a markdown table block with speakable text.

    Audio cannot preserve columns visually. Two strategies depending on
    table size:

      Small tables (<= _TABLE_FULL_READ_ROW_LIMIT rows): read every
        row as 'Row N: col-name: cell; col-name: cell.' Listener gets
        every datum the writer put in the table.

      Larger tables: fall back to the old 'shape + first row' summary
        because reading 20+ rows aloud is its own bad-UX failure mode.
    """
    header_cells = [_table_cell_summary(c) for c in m.group('header').split('|')]
    rows = []
    for ln in m.group('rows').splitlines():
        if not ln.strip().startswith('|'):
            continue
        cells = [_table_cell_summary(c) for c in ln.strip().strip('|').split('|')]
        rows.append(cells)
    row_count = len(rows)
    # Empty-header tables (`| | |\n|---|---|\n...`) used to bail out
    # with "Table with N rows." and silently drop the data — Ben's
    # 2026-05-09 audit caught a 5-row "Commits / CI gates / Phases"
    # table reduced to nothing. Now we keep header_cells at full
    # length (including empty strings) so the row renderer can fall
    # back to `col N` labels via _table_row_phrase.
    non_empty_headers = [c for c in header_cells if c]
    cols = ', '.join(non_empty_headers) if non_empty_headers else f'{len(header_cells)} unnamed'
    plural = 'row' if row_count == 1 else 'rows'

    if row_count <= _TABLE_FULL_READ_ROW_LIMIT:
        # Read every row. Sentence-split treats each ". " as a clip
        # boundary so listener gets a natural pause between rows.
        body_parts = [f'Table with {row_count} {plural}.', f'Columns: {cols}.']
        for i, cells in enumerate(rows, start=1):
            phrase = _table_row_phrase(header_cells, cells)
            if phrase:
                body_parts.append(f'Row {i}: {phrase}.')
        return ' '.join(body_parts) + '\n'

    if row_count <= _TABLE_ABRIDGED_ROW_LIMIT:
        # 26-50 rows: read first N + last M with an omitted-count note
        # between them. Captures the table's endpoints (which are
        # usually meaningful — first row often the most-recent commit /
        # most-important entry; last row often the summary / oldest)
        # while keeping audio under ~90 s.
        head = rows[:_TABLE_ABRIDGED_HEAD_ROWS]
        tail = rows[-_TABLE_ABRIDGED_TAIL_ROWS:]
        omitted = row_count - len(head) - len(tail)
        body_parts = [f'Table with {row_count} {plural}.', f'Columns: {cols}.']
        for i, cells in enumerate(head, start=1):
            phrase = _table_row_phrase(header_cells, cells)
            if phrase:
                body_parts.append(f'Row {i}: {phrase}.')
        if omitted > 0:
            body_parts.append(f'Rows {len(head)+1} through {row_count - len(tail)} omitted ({omitted} {("row" if omitted == 1 else "rows")}).')
        for offset, cells in enumerate(tail):
            i = row_count - len(tail) + 1 + offset
            phrase = _table_row_phrase(header_cells, cells)
            if phrase:
                body_parts.append(f'Row {i}: {phrase}.')
        return ' '.join(body_parts) + '\n'

    first_row = rows[0] if rows else []
    sample_phrase = _table_row_phrase(
        header_cells, first_row[:min(3, len(first_row))],
    )
    sample = f' First row: {sample_phrase}.' if sample_phrase else ''
    return f'Table with {row_count} {plural}. Columns: {cols}.{sample}\n'


_KBD_MODIFIER_RE = re.compile(
    r'\b(Ctrl|Control|Cmd|Command|Shift|Alt|Option|Win|Windows|Super|Meta)\+',
    re.IGNORECASE,
)
_MODIFIER_SPOKEN = {
    'ctrl': 'control', 'control': 'control',
    'cmd': 'command', 'command': 'command',
    'shift': 'shift',
    'alt': 'alt', 'option': 'option',
    'win': 'windows', 'windows': 'windows',
    'super': 'super',
    'meta': 'meta',
}


def sanitize(text: str, flags: dict) -> str:
    if not text:
        return ''
    t = text

    # Markdown tables → speakable summary line. Must run before code-fence
    # processing so a table inside a fenced block still gets summarised
    # if the fence body survives.
    t = _MARKDOWN_TABLE_RE.sub(_table_summary, t)

    # Code blocks. Three-way decision per fenced block:
    #   1. If `code_blocks=true` → always keep body (user opted in to code audio).
    #   2. If fence has an explicit language tag (```python / ```bash / etc.) →
    #      treat as real code, strip body when code_blocks=false.
    #   3. If NO language tag AND body doesn't match code-syntax signals →
    #      it's prose dressed in ``` for visual effect — KEEP the body.
    #
    # Rationale: the previous behaviour stripped 100 % of anything fenced,
    # silently dropping forward-messages, quoted log excerpts, copy-paste
    # blocks, etc. from audio. A 4.9 k-char response where 74 % was
    # fenced-prose became a 1.3 k-char audio stream — listeners got only
    # the lead and lost the meaty parts. Language-tag-or-syntax-signals
    # is the robust rule that doesn't depend on the LLM remembering not
    # to fence its prose.
    keep_code = flags.get('code_blocks', False)

    def _code_fence_repl(m: re.Match) -> str:
        lang = m.group(1).strip()
        content = m.group(2)
        if keep_code:
            return content
        if lang:
            return _code_block_summary(lang, content)  # Explicit tag = definitely code; summarise body.
        if _looks_like_code(content):
            return _code_block_summary(lang, content)  # No tag but content has code signals; summarise.
        return content  # No tag + prose-like body; speak the content.

    t = _CODE_FENCE_RE.sub(_code_fence_repl, t)

    # Inline code. When inline_code=False we normally drop the whole
    # backticked span, but keyboard shortcuts get preserved regardless —
    # they're UI instructions, not code content, and silently dropping
    # them turns "press `Ctrl+R` to reload" into "press to reload".
    # With the GFM-balanced regex, group(2) is the content (group(1) is
    # the backtick run count used as the backreference).
    if flags.get('inline_code', False):
        t = _INLINE_CODE_RE.sub(lambda m: m.group(2), t)
    else:
        def _inline_code_repl(m: re.Match) -> str:
            content = m.group(2)
            # Keyboard shortcuts always survive (later modifier translation
            # reads `Ctrl+R` as "control R").
            if _KBD_SHORTCUT_RE.match(content):
                return content
            # Short identifier-like content is prose, not code — speak it.
            # Catches cases like `/clear`, `session_id`, `main.js`,
            # `Update-SessionAssignment` that make prose unreadable when
            # stripped ("rotates the ___" doesn't make sense to a listener).
            if _inline_looks_like_prose(content):
                return content
            # Return a SPACE, not empty. Empty collapses `**\`code\`**`
            # to `****` which misaligns with adjacent bold markers and
            # causes the emphasis regex to greedy-match across unrelated
            # pairs, silently eating prose.
            return ' '
        t = _INLINE_CODE_RE.sub(_inline_code_repl, t)

    # Safety net: strip any surviving backtick characters. Unmatched
    # backticks (GFM double-backtick edge cases, unclosed inline code,
    # stray ticks in prose) have no speakable meaning and were
    # otherwise read as literals or just sat as garbage in the output.
    t = t.replace('`', '')

    # Images: alt text or strip entirely
    if flags.get('image_alt', False):  # noqa: SIM108  # fallback matches DEFAULT_SPEECH_INCLUDES
        t = _IMG_RE.sub(lambda m: m.group(1), t)
    else:
        t = _IMG_RE.sub('', t)

    # Markdown emphasis — always strip (keep content). Triple form first
    # so the double-form regex below doesn't fragment it.
    t = _TRIPLE_EMPHASIS_RE.sub(lambda m: next((g for g in m.groups() if g), ''), t)
    t = _EMPHASIS_RE.sub(lambda m: next((g for g in m.groups() if g), ''), t)

    # URLs
    if not flags.get('urls', False):
        t = _URL_RE.sub('', t)

    # Headings — drop whole line or call out the section explicitly.
    if not flags.get('headings', True):
        t = _HEADING_LINE_RE.sub('', t)
    else:
        def _heading_repl(m: re.Match) -> str:
            h = m.group(1).strip()
            return f'Section: {h}.' if h else ' '
        t = re.sub(r'^\s*#{1,6}\s*(.+?)\s*$', _heading_repl, t, flags=re.MULTILINE)

    # Bullet markers. Stripping just the "- " prefix leaves each bullet's
    # content on its own line but without sentence-ending punctuation —
    # sentence_split treats single newlines as spaces, so a 5-bullet list
    # flattens into one 500-char run-on sentence. Instead, capture the
    # whole bullet line and emit "content." (adding an implicit period if
    # the author didn't end the bullet with terminator punctuation) so
    # sentence_split splits each bullet as its own sentence.
    def _punctuate_bullet(content: str, prefix: str = '') -> str:
        c = content.rstrip()
        if not c:
            return ''
        if c[-1] not in '.!?:;':
            c = c + '.'
        return f'{prefix}{c}' if prefix else c

    if flags.get('bullet_markers', False):
        def _number_marked_lists(text: str) -> str:
            unordered_n = 0
            ordered_active = False
            ordered_next = 1
            out: list[str] = []
            for line in text.split('\n'):
                m = re.match(r'^[ \t]*([-*+]|\d+[.)])[ \t]+(.+?)[ \t]*$', line)
                if not m:
                    unordered_n = 0
                    if not re.match(r'^[ \t]', line):
                        ordered_active = False
                        ordered_next = 1
                    out.append(line)
                    continue

                marker = m.group(1)
                if marker in ('-', '*', '+'):
                    unordered_n += 1
                    out.append(f'{unordered_n}. {_punctuate_bullet(m.group(2))}')
                    continue

                unordered_n = 0
                raw_number = int(re.match(r'\d+', marker).group(0))
                spoken_number = raw_number if raw_number > 1 else (ordered_next if ordered_active else 1)
                ordered_active = True
                ordered_next = spoken_number + 1
                out.append(f'{spoken_number}. {_punctuate_bullet(m.group(2))}')
            return '\n'.join(out)
        t = _number_marked_lists(t)
    else:  # fallback matches DEFAULT_SPEECH_INCLUDES
        def _bullet_line_repl(m: re.Match) -> str:
            return _punctuate_bullet(m.group(1))
        t = re.sub(
            r'^[ \t]*(?:[-*+]|\d+\.)[ \t]+(.+?)[ \t]*$',
            _bullet_line_repl,
            t,
            flags=re.MULTILINE,
        )

    # Keyboard modifiers → words so TTS pronounces naturally. Covers
    # every common modifier in one sweep so `Ctrl+Shift+A` reads as
    # "control shift A" not "control Shift+A" (which TTS reads as
    # "control shift plus A").
    t = _KBD_MODIFIER_RE.sub(
        lambda m: _MODIFIER_SPOKEN[m.group(1).lower()] + ' ',
        t,
    )

    # Tilde — edge-tts pronounces as "tilda" which is universally wrong.
    # Common contexts are ~/path (home-dir shorthand) and ~N (approximately);
    # in both cases dropping the character is the cleanest fix. The
    # "approximately" semantic is rarely essential and context usually
    # makes it clear. User-reported.
    t = t.replace('~', '')

    # "live" at sentence end is ambiguous to TTS and can be pronounced
    # like "I live in a house". For Terminal Talk status/deploy phrasing,
    # rewrite only the current/running sense to unambiguous words.
    t = re.sub(
        r'\b[Dd]one and live\b',
        lambda m: 'Done and running' if m.group(0)[0] == 'D' else 'done and running',
        t,
    )
    t = re.sub(
        r'\b[Nn]ow live\b',
        lambda m: 'Now running' if m.group(0)[0] == 'N' else 'now running',
        t,
    )
    t = re.sub(r'\b([Ii]s|[Aa]re) live\b', r'\1 running', t)
    t = re.sub(
        r'\blive (install|app|toolbar|version|session|registry|config|configuration|runtime|files?|audio)\b',
        lambda m: f'active {m.group(1)}',
        t,
        flags=re.IGNORECASE,
    )

    # Collapse excessive blank lines
    t = re.sub(r'\n{3,}', '\n\n', t)
    # Collapse runs of spaces/tabs (but preserve newlines) introduced
    # when inline-code strip replaces a backticked span with a space.
    # Without this, prose like "like `a` or `b`" (with both inline codes
    # stripped) leaves behind "like   or  " — multi-space runs that
    # carry no meaning and just bulk the text pre-sentence-split.
    # Matches JS stripForTTS's `\s+` collapse, minus newline handling.
    t = re.sub(r'[^\S\n]+', ' ', t)

    return t.strip()


# ---------------------------------------------------------------------------
# Config / voice / speech-includes resolution
# ---------------------------------------------------------------------------

# Must stay in lock-step with DEFAULTS.speech_includes in app/main.js:45-52.
# Previous drift: this file shipped bullet_markers=True + image_alt=True while
# JS shipped False for both, so the streaming hook spoke bullet markers and
# image alt-text that the clipboard-speak flow (which reads from JS) never did.
DEFAULT_SPEECH_INCLUDES = {
    'code_blocks': False,
    'inline_code': False,
    'urls': False,
    'headings': True,
    'bullet_markers': False,
    'image_alt': False,
    # Tool-call narration. When True, on-tool mode emits short ephemeral
    # clips ("Reading foo.py", "Running npm test", etc.) as Claude
    # invokes tools, so the user hears ambient status during long tool
    # chains. Default on — turn off per-session if you want silence during
    # agentic work.
    'tool_calls': True,
}


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    try:
        with open(CONFIG_PATH, encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        _log(f'config read fail: {e}')
        return {}


def resolve_voice_and_flags(session_short: str, config: dict) -> tuple[str, dict, str | None, bool]:
    """Returns (voice, speech_includes, openai_key_or_none, muted).

    Per-session override beats config default. If nothing set, uses a conservative
    default. speech_includes flags follow the same precedence. `muted` is read
    straight from the session registry — config has no global mute.
    """
    # Config key is `edge_response`, not `response_voice` — the previous name
    # didn't exist anywhere else in the system, so when a user changed the
    # global response voice in the settings panel, the streaming hook
    # silently ignored it and always fell back to the hardcoded Ryan default.
    voice = config.get('voices', {}).get('edge_response', 'en-GB-RyanNeural')
    # D2 safeStorage: the OpenAI key moved out of config.json into
    # `~/.terminal-talk/config.secrets.json` on the same boot cycle
    # main.js first encrypts it via safeStorage. The sidecar is the
    # single plaintext copy, ACL'd to the current user. We prefer
    # the sidecar if present; fall through to legacy config.json for
    # v0.2-era installs that haven't yet had main.js migrate them;
    # fall through to None if neither has a key (existing null-check
    # logic below skips OpenAI synthesis without breaking anything).
    openai_key = _load_openai_key_from_secrets() or config.get('openai_api_key') or None
    flags = dict(DEFAULT_SPEECH_INCLUDES)
    cfg_inc = config.get('speech_includes', {})
    for k in flags:
        if k in cfg_inc and isinstance(cfg_inc[k], bool):
            flags[k] = cfg_inc[k]

    muted = False

    # Per-session override
    try:
        if REGISTRY_PATH.exists():
            with open(REGISTRY_PATH, encoding='utf-8') as f:
                reg_raw = f.read()
            # Tolerate BOM written by PowerShell paths
            if reg_raw.startswith('\ufeff'):
                reg_raw = reg_raw[1:]
            reg = json.loads(reg_raw)
            entry = reg.get('assignments', {}).get(session_short)
            if entry:
                if entry.get('voice'):
                    candidate = str(entry['voice'])
                    if EDGE_VOICE_RE.match(candidate):
                        voice = candidate
                    else:
                        _log(
                            f'ignoring non-Edge per-session voice for Edge fallback: '
                            f'session={session_short} voice={candidate!r}'
                        )
                if entry.get('muted') is True:
                    muted = True
                per_inc = entry.get('speech_includes', {})
                for k in flags:
                    if k in per_inc and isinstance(per_inc[k], bool):
                        flags[k] = per_inc[k]
    except Exception as e:
        _log(f'registry read fail (non-fatal): {e}')

    return voice, flags, openai_key, muted


# ---------------------------------------------------------------------------
# Parallel synthesis with rolling in-order release
# ---------------------------------------------------------------------------

def _run_say_fallback(sentence: str, out_path: Path) -> bool:
    """macOS-only emergency TTS fallback. Fires AFTER the user's
    configured providers (edge-tts, optionally openai-tts) have all
    refused this sentence — typically a transient `NoAudioReceived`
    response from speech.platform.bing.com. Without this fallback the
    sentence drops silently from the queue and the user never hears
    that segment of Claude's response.

    Uses /usr/bin/say + /usr/bin/afconvert (both ship with every
    macOS install — no extra deps to manage):

        say -o tmp.aiff "<sentence>"
        afconvert -f WAVE -d LEI16 tmp.aiff <out_path>

    The output file extension stays .mp3 to match synthesize_parallel's
    filename convention; the bytes are WAV-format. Electron's
    HTMLAudioElement (Safari WebKit on macOS) handles WAV content
    regardless of extension, and the .txt sidecar matching keys off
    the .mp3 stem so the transcript panel still finds the spoken-text
    pair.

    Voice quality is noticeably lower than edge-tts neural voices —
    that's the trade-off, and why this is a last-resort. Better the
    user hears a slightly-flatter rendition of the sentence than
    silence where audio should have been. Logged distinctly so the
    audit trail in _hook.log makes it obvious when edge-tts was
    unreliable enough to trigger the local path.
    """
    if sys.platform != 'darwin':
        return False
    import subprocess
    aiff_tmp = out_path.with_suffix('.aiff.tmp')
    try:
        say_proc = subprocess.run(
            ['/usr/bin/say', '-o', str(aiff_tmp), '--', sentence],
            capture_output=True, timeout=15,
        )
        if say_proc.returncode != 0 or not aiff_tmp.exists():
            stderr = say_proc.stderr.decode('utf-8', errors='replace').strip()
            _log(
                f'say fallback: say(1) failed rc={say_proc.returncode} '
                f'stderr={stderr[:200]!r}'
            )
            return False
        af_proc = subprocess.run(
            ['/usr/bin/afconvert', '-f', 'WAVE', '-d', 'LEI16',
             str(aiff_tmp), str(out_path)],
            capture_output=True, timeout=10,
        )
        if (
            af_proc.returncode != 0
            or not out_path.exists()
            or out_path.stat().st_size < 500
        ):
            size = out_path.stat().st_size if out_path.exists() else 0
            stderr = af_proc.stderr.decode('utf-8', errors='replace').strip()
            _log(
                f'say fallback: afconvert failed rc={af_proc.returncode} '
                f'size={size} stderr={stderr[:200]!r}'
            )
            return False
        return True
    except subprocess.TimeoutExpired:
        _log(f'say fallback: timeout (sentence len={len(sentence)})')
        return False
    except Exception as e:
        _log(f'say fallback: exception {type(e).__name__}: {e}')
        return False
    finally:
        if aiff_tmp.exists():
            with contextlib.suppress(Exception):
                aiff_tmp.unlink()


def _run_edge_tts(sentence: str, voice: str, out_path: Path, attempts: int = 3) -> bool:
    """Invoke edge_tts_speak.py with retries on transient Microsoft-service
    wobbles. Returns True on success.

    edge-tts (speech.platform.bing.com) occasionally returns rc=1 size=0 on
    a single call for no clear reason — service hiccup, rate-limit blip,
    TLS stutter. Before this wrapper retried, each wobble silently dropped
    a sentence: the user would hear "11/12 clips" with no way to know
    which one went missing. Now we retry 3× with exponential-ish backoff
    (0.4 s, 1.0 s) and, on final failure, log a preview of the sentence so
    the user can see exactly what was lost. Total worst-case overhead:
    ~1.5 s of sleep per lost sentence — far preferable to a silent gap."""
    import subprocess
    last_err = None
    for attempt in range(1, attempts + 1):
        try:
            proc = subprocess.run(
                [sys.executable, str(EDGE_TTS_SCRIPT), voice, str(out_path)],
                input=sentence.encode('utf-8'),
                timeout=SYNTH_TIMEOUT_SEC,
                capture_output=True,
            )
            if proc.returncode == 0 and out_path.exists() and out_path.stat().st_size > 500:
                if attempt > 1:
                    _log(f'edge-tts recovered on attempt {attempt}/{attempts}')
                return True
            size = out_path.stat().st_size if out_path.exists() else 0
            stderr = proc.stderr.decode('utf-8', errors='replace').strip()
            last_err = f'rc={proc.returncode} size={size}'
            if stderr:
                last_err += f' stderr={stderr[:500]!r}'
        except subprocess.TimeoutExpired:
            last_err = f'timeout len={len(sentence)}'
        except Exception as e:
            last_err = f'exec fail: {e}'
        # Clean partial output between attempts so the next retry starts
        # from a known-empty path.
        if out_path.exists():
            with contextlib.suppress(Exception):
                out_path.unlink()
        if attempt < attempts:
            _log(f'edge-tts attempt {attempt}/{attempts} failed ({last_err}); retrying')
            time.sleep(0.4 * (2 ** (attempt - 1)))  # 0.4 s, 0.8 s
    # All retries exhausted — log what was lost so the user can find it.
    preview = sentence[:80].replace('\n', ' ').replace('\r', ' ')
    _log(f'edge-tts FAILED after {attempts} attempts ({last_err}); sentence lost: {preview!r}')
    return False


def resolve_tts_routing(config: dict) -> tuple[str, str, str]:
    """Return (provider, fallback_provider, openai_voice) for this turn.

    provider is 'edge' or 'openai'. Anything else (malformed config,
    missing key) gets normalised to 'edge' — Ben's default + safest
    route when the toggle has an unexpected value.

    fallback_provider is explicit: 'edge', 'openai', or 'none'. Missing
    and malformed values normalise to 'edge', which means Edge-primary
    turns do NOT silently fall back to paid OpenAI. Users opt into that
    by setting playback.tts_fallback_provider to 'openai'.

    openai_voice reads voices.openai_response. Keeps the voice Ben
    picked from the dropdown when the OpenAI path fires — previously
    hardcoded to 'alloy' no matter what he selected.
    """
    playback = config.get('playback') or {}
    provider = str(playback.get('tts_provider') or 'edge').lower()
    if provider not in ('edge', 'openai'):
        provider = 'edge'
    fallback_provider = str(playback.get('tts_fallback_provider') or 'edge').lower()
    if fallback_provider not in ('edge', 'openai', 'none'):
        fallback_provider = 'edge'
    voices = config.get('voices') or {}
    openai_voice = voices.get('openai_response') or 'alloy'
    return provider, fallback_provider, openai_voice


def _run_openai_fallback(sentence: str, api_key: str, voice: str, out_path: Path) -> bool:
    """OpenAI TTS synth (primary OR explicit fallback route).
    Mirrors current Stop hook. Optional.

    API key is passed to the subprocess via the OPENAI_API_KEY env var,
    NOT argv, so a TimeoutExpired / CalledProcessError stringifier
    can't dump the key into the hook log. (It did on 2026-04-23, one
    turn before we moved it off argv.)
    """
    import os as _os
    import subprocess
    script = Path(__file__).resolve().parent / 'openai_tts.py'
    if not script.exists():
        return False
    env = dict(_os.environ)
    env['OPENAI_API_KEY'] = api_key
    try:
        proc = subprocess.run(
            [sys.executable, str(script), voice, str(out_path)],
            input=sentence.encode('utf-8'),
            timeout=SYNTH_OPENAI_TIMEOUT_SEC,
            capture_output=True,
            env=env,
        )
        if proc.returncode == 0 and out_path.exists() and out_path.stat().st_size > 500:
            return True
        # Exit code 2 = HTTP 401 (invalid key). openai_tts.py distinguishes
        # this from generic failure so we can drop an auto-unset marker
        # that main.js picks up on its next sweep — clears the safeStorage
        # key + flips OpenAI provider routes back to 'edge' so we don't
        # keep hammering the API with a rejected key.
        if proc.returncode == 2:
            try:
                flag = SESSIONS_DIR / 'openai-invalid.flag'
                flag.parent.mkdir(parents=True, exist_ok=True)
                flag.write_text(str(int(time.time())), encoding='utf-8')
                _log('openai key rejected (HTTP 401) — wrote openai-invalid.flag')
            except Exception:
                pass  # best-effort; main.js falls back on its next check
        # Failure path: scrub stderr for accidental key echoes (defence
        # in depth — the wrapper writes to stderr, and an indiscreet
        # traceback from urllib could in theory contain headers).
        err = (proc.stderr.decode('utf-8', 'replace') if proc.stderr else '').strip()
        if api_key and api_key in err:
            err = err.replace(api_key, '<redacted>')
        _log(f'openai route rc={proc.returncode} stderr={err[:200]}')
    except subprocess.TimeoutExpired:
        # Explicitly DO NOT log the exception object itself — Python's
        # default repr includes the full cmd (argv) which used to
        # contain the key. Voice + timeout is plenty to diagnose.
        _log(f'openai route timeout ({SYNTH_OPENAI_TIMEOUT_SEC}s) voice={voice}')
    except Exception as e:
        msg = str(e)
        if api_key and api_key in msg:
            msg = msg.replace(api_key, '<redacted>')
        _log(f'openai route fail: {type(e).__name__}: {msg[:200]}')
    return False


def synthesize_parallel(
    sentences: list[str],
    voice: str,
    session_short: str,
    openai_key: str | None,
    prefix: str = '',  # e.g., 'Q-' for questions
    # TTS routing: try `provider` first, then only the explicit
    # `fallback_provider`. Default fallback is 'edge', so Edge-primary
    # turns do not silently spend OpenAI credits when edge-tts fails.
    # `voice` stays the edge voice so existing callers don't change
    # meaning; `openai_voice` was previously hardcoded to 'alloy' which
    # ignored the user's Settings dropdown pick. Now honours it.
    provider: str = 'edge',
    fallback_provider: str = 'edge',
    openai_voice: str = 'alloy',
    # Optional pre-strip-for-tts text for the transcript-panel feature.
    # When provided, written to <base>.original.txt alongside the
    # audio file so the renderer can show the user the source text
    # (with markdown intact) in addition to the spoken text. Length
    # must match `sentences` 1:1; mismatched length is silently
    # ignored. Pure additive — callers that don't pass it just don't
    # get the .original.txt sidecar.
    originals: list[str] | None = None,
    # Whole-turn fallback: when a per-clip mapping isn't available
    # (sanitiser + sentence-grouper turn one chunk into N clips, so the
    # 1:1 mapping is lossy), callers can pass the entire pre-sanitiser
    # markdown source for the turn. Same string is written to every
    # clip's .original.txt so the transcript-panel "Original" toggle
    # always has SOMETHING to show — listener loses per-clip granularity
    # but gains visibility into the markdown that was supposed to play.
    original_full: str | None = None,
) -> int:
    """Synthesize each sentence; write to queue in order as they finish.

    Each clip gets a filename like:
        <turn_ts>-<prefix><seq:04d>-<sessionshort>.mp3
    The turn_ts component anchors the whole batch to one moment; the padded
    seq within it guarantees lexicographic (and mtime, since we write in
    order) ordering regardless of which synth finishes first.

    Returns the number of clips successfully written.
    """
    if not SESSION_SHORT_RE.match(session_short):
        _log(f'refusing synth: invalid sessionshort {session_short!r}')
        return 0
    if not sentences:
        return 0

    _ensure_dirs()
    turn_ts = datetime.now().strftime('%Y%m%dT%H%M%S%f')[:-3]
    tmp_dir = QUEUE_DIR / '.tmp_synth'
    tmp_dir.mkdir(exist_ok=True)

    # seq → tmp_path (set when synth completes, None on failure)
    results: dict[int, Path | None] = {}
    next_release = [0]
    release_lock = Lock()
    written_count = [0]
    # Monotonic mtime counter. os.replace preserves source mtime (which is
    # synth-finish time — out of seq order because clips synthesise in
    # parallel). The toolbar sorts playback by mtime, so we must stamp
    # mtimes in release order to guarantee playback matches text order.
    last_mtime = [time.time()]

    # Validate `originals` length matches sentences; ignore if mismatched
    # (defensive — a buggy caller shouldn't kill the whole turn).
    use_originals = bool(originals) and len(originals or []) == len(sentences)

    def _write_text_sidecar(audio_path: Path, sentence: str, original: str | None) -> None:
        """Persist .txt (spoken) + optionally .original.txt (pre-strip)
        sidecars next to the audio clip. Used by the transcript-panel
        feature in the renderer to show users the text of each clip
        with copy support. Failures here never break audio playback —
        the text panel just won't have content for that clip.

        Per-clip `original` wins; falls back to `original_full` (the
        whole-turn markdown source) so even when the caller can't
        provide a 1:1 mapping the panel still has something to show."""
        try:
            base = audio_path.with_suffix('')
            base.with_suffix('.txt').write_text(sentence, encoding='utf-8')
            chosen = original if original is not None else original_full
            if chosen and chosen.strip() and chosen != sentence:
                base.with_suffix('.original.txt').write_text(chosen, encoding='utf-8')
        except Exception as e:
            _log(f'sidecar write fail for {audio_path.name}: {e}')

    def _release_ready():
        """Move completed clips to queue dir in seq order. Called under lock."""
        while next_release[0] in results:
            seq = next_release[0]
            tmp = results[seq]
            next_release[0] += 1
            if tmp is None:
                continue
            # Final filename: <turn_ts>-<prefix><seq>-<sessionshort>.mp3
            # Keep seq padded so even if sorting falls back to filename,
            # order is preserved.
            final = QUEUE_DIR / f'{turn_ts}-{prefix}{seq:04d}-{session_short}.mp3'
            try:
                os.replace(tmp, final)
                # Force monotonically increasing mtime so queue playback
                # order matches seq order. 2 ms steps are well above NTFS
                # (100 ns) and ext4 (1 ns) resolution, so no ties.
                next_mtime = max(time.time(), last_mtime[0] + 0.002)
                os.utime(final, (next_mtime, next_mtime))
                last_mtime[0] = next_mtime
                written_count[0] += 1
                # Transcript-panel sidecar — written AFTER the audio
                # file is in place so the renderer's queue-watcher
                # always sees a complete (audio + .txt) pair atomically.
                original = (originals or [None] * len(sentences))[seq] if use_originals else None
                _write_text_sidecar(final, sentences[seq], original)
            except Exception as e:
                _log(f'release move fail seq={seq}: {e}')

    provider = str(provider or 'edge').lower()
    if provider not in ('edge', 'openai'):
        provider = 'edge'
    fallback_provider = str(fallback_provider or 'edge').lower()
    if fallback_provider not in ('edge', 'openai', 'none'):
        fallback_provider = 'edge'
    provider_order = [provider]
    if fallback_provider != 'none':
        resolved_fallback = 'edge' if fallback_provider == provider == 'openai' else fallback_provider
        if resolved_fallback != provider:
            provider_order.append(resolved_fallback)

    def _synth_task(seq: int, sentence: str) -> None:
        tmp = tmp_dir / f'{turn_ts}-{session_short}-{seq:04d}.mp3'
        ok = False
        for route in provider_order:
            if route == 'openai':
                if not openai_key:
                    continue
                ok = _run_openai_fallback(sentence, openai_key, openai_voice, tmp)
            else:
                ok = _run_edge_tts(sentence, voice, tmp)
            if ok:
                break
        # Last-resort fallback: macOS local TTS via /usr/bin/say. Only
        # fires when every configured provider has refused this
        # sentence — typically transient edge-tts NoAudioReceived. The
        # local path is offline + free + always available, so it acts
        # as a reliability floor: the user always hears *something*
        # instead of a silently-dropped sentence. Voice quality is
        # lower than the cloud providers, which is the deliberate
        # trade-off (free + reliable > polished + flaky).
        if not ok and sys.platform == 'darwin':
            if _run_say_fallback(sentence, tmp):
                ok = True
                preview = sentence[:80].replace('\n', ' ')
                _log(f'say fallback succeeded for: {preview!r}')
        with release_lock:
            results[seq] = tmp if ok else None
            _release_ready()

    # S2.1: wrap the executor's implicit join in an explicit wait() so a
    # rogue sentence hang can't keep the whole turn hostage. SYNTH_TIMEOUT
    # is the per-attempt cap; 2× that gives comfortable headroom for the
    # retry logic but still bounded. Any future still running after the
    # cap gets cancelled -- its clip is lost, but the turn progresses.
    _started = time.monotonic()
    with ThreadPoolExecutor(max_workers=MAX_PARALLEL_SYNTH) as ex:
        futures: list[Future] = []
        for seq, sent in enumerate(sentences):
            futures.append(ex.submit(_synth_task, seq, sent))
        done, not_done = wait_futures(
            futures,
            timeout=SYNTH_TIMEOUT_SEC * 2,
        )
        if not_done:
            _log(
                f'synth turn exceeded {SYNTH_TIMEOUT_SEC * 2}s cap; '
                f'cancelling {len(not_done)} leftover futures'
            )
            for f in not_done:
                f.cancel()

    # Clean up tmp dir if empty. OSError fires if files remain from
    # partial failures — left on disk for next run / manual cleanup.
    with contextlib.suppress(OSError):
        tmp_dir.rmdir()

    # S2.1: one-line summary with the shape `synth_turn: n=<total> ok=<ok>
    # total_ms=<ms> parallelism=<n>` so log greps can pull per-turn
    # throughput stats without parsing multiple log lines.
    _total_ms = int((time.monotonic() - _started) * 1000)
    _log(
        f'synth_turn: n={len(sentences)} ok={written_count[0]} '
        f'total_ms={_total_ms} parallelism={MAX_PARALLEL_SYNTH}'
    )
    _log(f'synth complete: {written_count[0]}/{len(sentences)} clips for {session_short}')
    return written_count[0]


# ---------------------------------------------------------------------------
# Questions-first extraction
# ---------------------------------------------------------------------------

_QUESTION_RE = re.compile(r'([^.!?\n]{5,}\?)')


def extract_questions(text: str) -> list[str]:
    """Pull standalone questions out of response text. Mirrors the existing
    PowerShell regex exactly to preserve behaviour."""
    return [m.strip() for m in _QUESTION_RE.findall(text or '')]


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

def _do_stream(
    session_id: str,
    session_short: str,
    entries: list[dict],
    user_idx: int,
    state: dict,
) -> int:
    """Full on-stream flow: slice-by-offset → sanitize → group → synth.
    Called from run() when mode == 'on-stream'. Returns 0 on success."""
    body_text_chunks, updated_offsets, fully_done = _run_stream_mode(
        session_id, session_short, entries, user_idx, state
    )
    if not body_text_chunks:
        # Nothing new + no complete sentences yet. Quiet exit — the
        # watcher will poll again in ~500ms.
        return 0

    config = load_config()
    voice, flags, openai_key, muted = resolve_voice_and_flags(session_short, config)
    provider, fallback_provider, openai_voice = resolve_tts_routing(config)
    if muted:
        # Don't synth, but DO advance offsets + mark done so unmute
        # picks up from current moment, not replay history.
        state['partial_text_offsets'] = updated_offsets
        state['synthesized_line_indices'].extend(fully_done)
        save_sync_state(session_id, state)
        return 0

    # Each chunk goes through the full sanitize + group pipeline
    # independently so paragraph boundaries within a chunk are
    # respected and adjacent small sentences merge naturally.
    all_clips: list[str] = []
    for raw_chunk in body_text_chunks:
        clean = sanitize(raw_chunk, flags)
        if not clean:
            continue
        all_clips.extend(group_sentences_for_tts(clean))
    if not all_clips:
        state['partial_text_offsets'] = updated_offsets
        state['synthesized_line_indices'].extend(fully_done)
        save_sync_state(session_id, state)
        return 0

    _log(
        f'on-stream: {session_short} — {len(body_text_chunks)} chunk(s), '
        f'{len(all_clips)} body clips, {len(fully_done)} line(s) fully done'
    )
    synthesize_parallel(all_clips, voice, session_short, openai_key,
                        provider=provider, openai_voice=openai_voice,
                        fallback_provider=fallback_provider,
                        original_full='\n\n'.join(body_text_chunks))

    state['partial_text_offsets'] = updated_offsets
    state['synthesized_line_indices'].extend(fully_done)
    save_sync_state(session_id, state)
    return 0


def _run_stream_mode(
    session_id: str,
    session_short: str,
    entries: list[dict],
    user_idx: int,
    state: dict,
) -> tuple[list[str], dict[int, int], list[int]]:
    """Compute streaming body-clips + updated partial offsets.

    Returns (body_clips, updated_offsets, fully_processed_lines).
    Caller handles synthesis + state persistence.

    Streaming strategy: for each assistant-text entry after `user_idx`,
    read the current chars, slice from the last-recorded offset up to
    the last safe sentence boundary, group+synth that slice, advance
    the offset. A line only lands in `fully_processed_lines` when the
    slice fully consumed the entry (covers the legacy
    `synthesized_line_indices` semantics — prevents on-stop from
    re-synthing content on-stream already said).
    """
    body_text_chunks: list[str] = []
    updated_offsets: dict[int, int] = dict(state.get('partial_text_offsets', {}))
    fully_done: list[int] = []
    synthesized = set(state.get('synthesized_line_indices', []))

    for i, text in assistant_text_entries_after(entries, user_idx):
        if i in synthesized:
            continue
        offset = int(updated_offsets.get(i, 0))
        slice_text, new_offset = _safe_stream_slice(text, offset)
        if not slice_text:
            continue
        body_text_chunks.append(slice_text)
        updated_offsets[i] = new_offset
        # If we've consumed the whole entry, mark it fully done so
        # on-stop doesn't re-process it.
        if new_offset >= len(text):
            fully_done.append(i)

    return body_text_chunks, updated_offsets, fully_done


# Past-tense verb list, ISO-8601 timestamp parser, JSONL-elapsed
# computation, footer humaniser, format_elapsed_phrase, and the
# scrape+drift-check footer pipeline live in app/synth_footer.py to
# keep this file under the 2725-line file-length ceiling AND to bring
# run()'s cyclomatic complexity below the ruff C901 threshold (33).
# Phase 0 of the v0.7 housekeeping pass.


def run(session_id: str, transcript_path: str, mode: str, elapsed_sec: int = 0,
        footer_phrase: str = '') -> int:
    """Returns exit code (0 on success, non-zero on unrecoverable error)."""
    if not session_id or len(session_id) < SESSIONSHORT_LEN:
        _log(f'invalid session_id: {session_id!r}')
        return 2
    session_short = session_id[:SESSIONSHORT_LEN].lower()
    if not SESSION_SHORT_RE.match(session_short):
        _log(f'invalid session_short: {session_short!r}')
        return 2

    transcript = Path(transcript_path)
    # Windows path normalisation (`/c/...` → `C:\\...`)
    if not transcript.is_absolute() and transcript_path.startswith('/'):
        m = re.match(r'/([a-zA-Z])/(.+)', transcript_path)
        if m:
            transcript = Path(f'{m.group(1).upper()}:/{m.group(2)}')
    if not transcript.exists():
        _log(f'transcript does not exist: {transcript}')
        return 2

    with _SessionLock(session_id) as lock:
        # If the lock wasn't acquired within LOCK_ACQUIRE_TIMEOUT_SEC, exit
        # early rather than racing the current holder. The holder will
        # mark this turn's tool_use entries announced + any pending
        # assistant text synthesized; the next PreToolUse / Stop fire will
        # pick up any genuine new deltas with fresh state. Proceeding
        # without the lock was the 2026-04-23 narration-duplication bug.
        if not lock.acquired:
            _log('lock contention -- deferring to current holder')
            return 0

        entries = read_transcript_lines(transcript)
        if not entries:
            _log('no transcript entries')
            return 0

        user_idx = find_last_user_idx(entries)
        state = load_sync_state(session_id)

        # Turn boundary changed? Reset synthesized + announced lists.
        if state['turn_boundary'] != user_idx:
            state = {
                'turn_boundary': user_idx,
                'synthesized_line_indices': [],
                'announced_tool_line_indices': [],
            }

        # Streaming mode takes a different path — it slices growing
        # entries by char-offset instead of the whole-entry "pending"
        # model the stop/tool modes use.
        if mode == 'on-stream':
            return _do_stream(session_id, session_short, entries, user_idx, state)

        # Pending text entries for this non-stream mode. If on-stream has
        # already synthesised a portion of an entry (recorded in
        # partial_text_offsets), we only want the TAIL — not the whole
        # entry, which would duplicate content the user already heard.
        # Previously on-stop ignored partial offsets and re-synthesised
        # full entries, producing byte-identical duplicate clips a few
        # seconds after on-stream's versions (user-reported: 5+ repeats
        # across recent responses).
        partial_offsets = state.get('partial_text_offsets', {}) or {}
        pending_raw = [
            (i, txt) for (i, txt) in assistant_text_entries_after(entries, user_idx)
            if i not in state['synthesized_line_indices']
        ]
        pending = []
        for (i, txt) in pending_raw:
            off = int(partial_offsets.get(i, 0) or 0)
            if off >= len(txt):
                # on-stream fully consumed this entry between its last
                # tick and this hook firing — nothing left to say.
                continue
            pending.append((i, txt[off:]))

        # Compute unannounced tool_use entries (on-tool mode only). We do
        # this BEFORE the "nothing to do" early-exit so that back-to-back
        # tool chains without prose between them don't silently skip
        # narration — the original TN1 regression surfaced in logs as
        # a run of "no new assistant text" for several minutes while
        # plenty of tool calls were firing.
        announced_set = set(state.get('announced_tool_line_indices', []))
        new_tool_entries: list[tuple] = []
        if mode == 'on-tool':
            for tool_idx, tname, tinput, tresult in tool_use_entries_after(entries, user_idx):
                if tool_idx not in announced_set:
                    new_tool_entries.append((tool_idx, tname, tinput, tresult))

        # On-stop owes the user a footer clip when elapsed is known.
        # owes_footer in synth_footer.py encapsulates the POSIX two-
        # tier check (hook elapsed_sec OR JSONL-derived elapsed) and
        # the Windows-side short-circuit (footer-watcher.js owns it
        # there, so synth_turn never owes a footer on win32).
        from synth_footer import owes_footer as _owes_footer
        is_owed_footer = _owes_footer(mode, elapsed_sec, entries, user_idx)
        if not pending and not new_tool_entries and not is_owed_footer:
            _log(f'{mode}: nothing new for {session_short}')
            return 0

        config = load_config()
        voice, flags, openai_key, muted = resolve_voice_and_flags(session_short, config)
        provider, fallback_provider, openai_voice = resolve_tts_routing(config)

        # Muted sessions: cut the wire. Still advance sync state for both
        # text and tool entries so that when the user unmutes we don't
        # retroactively synthesise the silent period's content — unmute
        # means "from now on", not "replay history".
        if muted:
            _log(f'{mode}: {session_short} is muted, skipping synthesis')
            state['synthesized_line_indices'].extend(i for i, _ in pending)
            if new_tool_entries:
                state['announced_tool_line_indices'] = list(
                    announced_set.union(i for i, _, _, _ in new_tool_entries)
                )
            save_sync_state(session_id, state)
            return 0

        # Questions-first extraction was removed 2026-04-22. Rationale:
        # extracting every `?`-ending sentence and playing it BEFORE the
        # body caused three problems the user hit in practice:
        #   1. Order mismatch — a question heard in isolation often needs
        #      the preceding prose to make sense; "was Ben in Firefox?"
        #      means nothing without the diagnostic setup that led to it.
        #   2. False positives — the regex caught `?` inside inline code
        #      spans (e.g. "`?`-sentences") as "questions".
        #   3. Duplication — a question was spoken once as a Q-clip and
        #      again in natural body flow, adding audible clutter.
        # Audio now tracks terminal order 1:1. extract_questions() stays
        # in this module for the test harness and any future re-enable.
        question_sentences: list[str] = []

        # Tool narrations (ephemeral T- clips). Emit regardless of
        # whether text is also pending — "Reading foo.py" during a
        # long tool chain is the whole point of TN1.
        tool_narrations: list[str] = []
        tool_indices_done: list[int] = []
        if new_tool_entries and flags.get('tool_calls', True):
            # Thread `prev_call` so the narrator can suppress same-file
            # repetition (e.g. consecutive Edit + Read on the same file
            # drop the "in <file>" suffix on the second call).
            prev_call: tuple[str, dict] | None = None
            recent_tool_verbs: list[str] = []
            for tool_idx, tname, tinput, tresult in new_tool_entries:
                phrase = narrate_tool_use(tname, tinput,
                                          prev_call=prev_call,
                                          tool_result=tresult)
                if phrase:
                    seed = f'{tname}|{json.dumps(tinput or {}, sort_keys=True, default=str)}'
                    phrase = vary_tool_phrase(phrase, seed, avoid_verbs=recent_tool_verbs[-3:])
                    tool_narrations.append(phrase)
                    verb = leading_tool_verb(phrase)
                    if verb:
                        recent_tool_verbs = (recent_tool_verbs + [verb])[-6:]
                    # Only update prev_call when narration was emitted.
                    # Suppressed tool_uses (whitespace-only edits, meta
                    # tools) shouldn't reset the same-file context.
                    prev_call = (tname, tinput or {})
                # Mark handled even if narration was None so we don't
                # reconsider the same entry on the next hook fire.
                tool_indices_done.append(tool_idx)
            # Batch-level phrase dedup: when an assistant turn issues
            # multiple bash calls of the same shape (e.g. 4× echo + grep
            # diagnostic shells, each producing "Searching for X (in a
            # pipeline)"), narrating each one wastes audio time on
            # redundant content. Drop phrases identical to one already
            # emitted in this batch. Cross-batch dedup is deliberately
            # NOT done — same phrase across separate hook fires usually
            # reflects genuinely separate user intents.
            from tool_narration import dedup_phrases
            tool_narrations = dedup_phrases(tool_narrations)
        elif new_tool_entries:
            # tool_calls disabled: still mark as handled.
            tool_indices_done.extend(i for i, _, _, _ in new_tool_entries)

        # Body: only runs when we have new prose to synth. When pending
        # is empty (pure tool chain), we skip straight to the narration
        # emit below. group_sentences_for_tts glues adjacent short
        # sentences up to ~300 chars while respecting paragraph
        # boundaries (NG1).
        body_clips: list[str] = []
        body_combined_raw: str = ''
        if pending:
            body_combined_raw = '\n'.join(t for _, t in pending)
            clean = sanitize(body_combined_raw, flags)
            if clean:
                body_clips = group_sentences_for_tts(clean)

        # End-of-response elapsed-time audio. POSIX two-tier strategy
        # (Windows owns its own footer via footer-watcher.js): scrape
        # Claude's literal printed line on Mac when possible, else
        # format from JSONL elapsed. See synth_footer.py for full
        # documentation of the tier logic + drift sanity check.
        from synth_footer import compute_footer_clip_text
        footer_clip_text = compute_footer_clip_text(
            mode=mode,
            elapsed_sec=elapsed_sec,
            entries=entries,
            user_idx=user_idx,
            session_short=session_short,
            log_fn=_log,
        )

        _log(f'{mode}: {session_short} — {len(pending)} new entries, '
             f'{len(body_clips)} body clips, {len(question_sentences)} questions, '
             f'{len(tool_narrations)} tool narrations')

        # Write questions first (play first due to mtime ordering from
        # release order: questions are synthesised + released before
        # body, so their mtimes are earlier). Tool narrations between
        # so the listener gets "Reading X" before the response prose.
        if question_sentences:
            synthesize_parallel(question_sentences, voice, session_short, openai_key,
                                prefix='Q-', provider=provider,
                                fallback_provider=fallback_provider,
                                openai_voice=openai_voice)
        if tool_narrations:
            synthesize_parallel(tool_narrations, voice, session_short, openai_key,
                                prefix='T-', provider=provider,
                                fallback_provider=fallback_provider,
                                openai_voice=openai_voice)
        if body_clips:
            synthesize_parallel(body_clips, voice, session_short, openai_key,
                                provider=provider,
                                fallback_provider=fallback_provider,
                                openai_voice=openai_voice,
                                original_full=body_combined_raw or None)

        # Footer clip last so its mtime sorts after every body clip in
        # the queue. Separate synthesise call rather than appending to
        # body_clips because (a) we don't want body_combined_raw used as
        # its .original.txt (the source markdown), and (b) the second
        # call's turn_ts is naturally later than body's, which is what
        # gives us the trailing-mtime ordering.
        if footer_clip_text:
            synthesize_parallel([footer_clip_text], voice, session_short, openai_key,
                                provider=provider,
                                fallback_provider=fallback_provider,
                                openai_voice=openai_voice)
            _log(f'on-stop: synthesised footer "{footer_clip_text}" for {session_short}')

        # Update sync state. Both dimensions tracked independently:
        # synthesized_line_indices for assistant-text entries,
        # announced_tool_line_indices for tool_use entries.
        if pending:
            state['synthesized_line_indices'].extend(i for i, _ in pending)
            # Clear per-line partial offsets for entries we just fully
            # consumed — they're done-done now, the on-stream watcher
            # won't see them again (already in synthesized_line_indices).
            if partial_offsets:
                done_set = set(i for i, _ in pending)
                state['partial_text_offsets'] = {
                    k: v for k, v in partial_offsets.items() if k not in done_set
                }
        if tool_indices_done:
            state['announced_tool_line_indices'] = list(
                announced_set.union(tool_indices_done)
            )
        save_sync_state(session_id, state)
        return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description='Terminal Talk per-turn synthesis')
    p.add_argument('--session', required=True, help='Claude Code session ID (UUID or similar)')
    p.add_argument('--transcript', required=True, help='Path to transcript JSONL')
    p.add_argument('--mode', required=True, choices=['on-tool', 'on-stop', 'on-stream'])
    p.add_argument('--elapsed-sec', type=int, default=0,
                   help='Seconds since UserPromptSubmit; speak-response.ps1 reads '
                        'the working flag mtime and passes it here for the '
                        'end-of-response "worked for X" clip (on-stop only).')
    p.add_argument('--footer-phrase', type=str, default='',
                   help='Verbatim footer string scraped from the Windows Terminal '
                        'buffer (e.g. "Sautéed for 1m 0s"). Overrides the computed '
                        'fallback when non-empty. The scrape validates freshness '
                        'against --elapsed-sec before passing it here, so either '
                        'this is trustworthy or it is empty.')
    args = p.parse_args(argv)
    try:
        return run(args.session, args.transcript, args.mode,
                   elapsed_sec=args.elapsed_sec, footer_phrase=args.footer_phrase)
    except KeyboardInterrupt:
        _log('interrupted')
        return 130
    except Exception as e:
        _log(f'UNCAUGHT: {type(e).__name__}: {e}')
        return 1


# Backwards-compat re-exports for the test harness, which imports
# `synth_turn.PAST_TENSE_VERBS` / `synth_turn.format_elapsed_phrase`
# directly via `python -c "import synth_turn; ..."`. Phase 0 moved
# the canonical implementations to synth_footer; rebinding them as
# module attributes here keeps the existing tests passing without
# touching the test file. Module-attribute reassignment (not from-
# import) sidesteps the I001 import-block-ordering check on a
# bottom-of-file re-export.
import synth_footer as _synth_footer  # noqa: E402

PAST_TENSE_VERBS = _synth_footer.PAST_TENSE_VERBS
_elapsed_from_transcript = _synth_footer.elapsed_from_transcript
format_elapsed_phrase = _synth_footer.format_elapsed_phrase
humanise_footer_phrase = _synth_footer.humanise_footer_phrase


if __name__ == '__main__':
    sys.exit(main())
