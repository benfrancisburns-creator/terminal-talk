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
import concurrent.futures
import contextlib
import json
import os
import re
import socket
import sys
import time
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from threading import Lock

try:
    from sentence_group import group_sentences_for_tts
    from tool_narration import narrate_tool_use
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from sentence_group import group_sentences_for_tts
    from tool_narration import narrate_tool_use


# ---------------------------------------------------------------------------
# Paths + constants
# ---------------------------------------------------------------------------

# D2-3d — `TT_HOME` env var overrides the default root so the test
# harness can redirect to a temp dir and never touch the user's live
# registry / queue while an Electron toolbar is running. Without this,
# a concurrent main.js `saveAssignments` can overwrite a test's
# seeded registry between the seed-write and synth_turn reading it,
# leaking a synthesised clip under a stale test-fixture short.
_TT_HOME_ENV = os.environ.get('TT_HOME')
TT_HOME = Path(_TT_HOME_ENV) if _TT_HOME_ENV else (Path.home() / '.terminal-talk')
QUEUE_DIR = TT_HOME / 'queue'
SESSIONS_DIR = TT_HOME / 'sessions'
CONFIG_PATH = TT_HOME / 'config.json'
# D2 safeStorage sidecar. Main.js (Electron) decrypts the OpenAI API
# key via safeStorage on load and writes plaintext here for same-user
# non-Electron consumers (PS hooks + this script) to read. ACL'd to
# the current user on install; absent if the user never set a key.
SECRETS_PATH = TT_HOME / 'config.secrets.json'
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

# Lock file timeout: if another invocation is holding the lock for this
# session longer than this, assume it's dead and proceed.
LOCK_STALE_SEC = 60

# Sessionshort validation: 8 hex chars. Refusing anything else stops path
# traversal via crafted transcript paths.
SESSION_SHORT_RE = re.compile(r'^[a-f0-9]{8}$')

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
        }
    try:
        with open(p, encoding='utf-8') as f:
            data = json.load(f)
        return {
            'turn_boundary': int(data.get('turn_boundary', -1)),
            'synthesized_line_indices': list(data.get('synthesized_line_indices', [])),
            # Back-compat: older sync files from v0.4 / pre-tool-narration
            # won't have this key; default to empty so we never blow up.
            'announced_tool_line_indices': list(data.get('announced_tool_line_indices', [])),
        }
    except Exception as e:
        _log(f'sync state read fail ({session_id[:8]}): {e}; resetting')
        return {
            'turn_boundary': -1,
            'synthesized_line_indices': [],
            'announced_tool_line_indices': [],
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
        for _ in range(40):  # ~2s of polling
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
        _log('could not acquire session lock; proceeding without')
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
    """Line index (0-based) of most recent user-type entry, or -1."""
    for i in range(len(entries) - 1, -1, -1):
        if entries[i].get('type') == 'user':
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


def tool_use_entries_after(entries: list[dict], start_idx: int) -> list[tuple]:
    """Return list of (line_idx, tool_name, tool_input) for assistant tool_use
    content after start_idx. One tuple per tool_use block; a single assistant
    entry can contain multiple parallel tool calls, each emitted separately."""
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
            if tool_name:
                out.append((i, tool_name, tool_input))
    return out


# ---------------------------------------------------------------------------
# Sanitisation  (mirrors speak-response.ps1 lines 260-306)
# ---------------------------------------------------------------------------

_CODE_FENCE_RE = re.compile(r'```[a-zA-Z0-9_+-]*\n?([\s\S]*?)```')
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
_URL_RE = re.compile(r'https?://\S+|www\.\S+', re.IGNORECASE)
_HEADING_LINE_RE = re.compile(r'^\s*#{1,6}\s*.*$', re.MULTILINE)
_BULLET_MARKER_RE = re.compile(r'^\s*([-*+]|\d+\.)\s+', re.MULTILINE)
# Triple-asterisk emphasis (bold-italic ***x***) must be stripped BEFORE
# the double-asterisk rule, because a naive `\*\*(...)\*\*` on `***x***`
# matches the inner `**x**` and leaves a stray `*` on each side — which
# TTS dutifully reads as "asterisk". Bug reported by user hearing
# "asterisk asterisk foo asterisk asterisk" on bold-italic headings.
_TRIPLE_EMPHASIS_RE = re.compile(r'\*\*\*([^*\n]+)\*\*\*|___([^_\n]+)___')
_EMPHASIS_RE = re.compile(r'\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_')
_IMG_RE = re.compile(r'!\[([^\]]*)\]\([^\)]+\)')
# All common keyboard modifiers in one regex — used to rewrite
# `Modifier+Key` into spoken words. Without this, `Ctrl+Shift+A` only
# translates the first segment and TTS reads the rest as "shift plus A".
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

    # Code blocks. noqa SIM108: the suggested ternary is a single line
    # with nested lambda + method chain + boolean — less readable than
    # explicit if/else even though it's shorter.
    if flags.get('code_blocks', False):  # noqa: SIM108
        t = _CODE_FENCE_RE.sub(lambda m: m.group(1), t)
    else:
        t = _CODE_FENCE_RE.sub('', t)

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
            if _KBD_SHORTCUT_RE.match(content):
                return content
            return ''
        t = _INLINE_CODE_RE.sub(_inline_code_repl, t)

    # Safety net: strip any surviving backtick characters. Unmatched
    # backticks (GFM double-backtick edge cases, unclosed inline code,
    # stray ticks in prose) have no speakable meaning and were
    # otherwise read as literals or just sat as garbage in the output.
    t = t.replace('`', '')

    # Images: alt text or strip entirely
    if flags.get('image_alt', True):  # noqa: SIM108
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

    # Headings — drop whole line
    if not flags.get('headings', True):
        t = _HEADING_LINE_RE.sub('', t)
    else:
        # Keep heading text but drop the # marks
        t = re.sub(r'^\s*#{1,6}\s*', '', t, flags=re.MULTILINE)

    # Bullet markers. Stripping just the "- " prefix leaves each bullet's
    # content on its own line but without sentence-ending punctuation —
    # sentence_split treats single newlines as spaces, so a 5-bullet list
    # flattens into one 500-char run-on sentence. Instead, capture the
    # whole bullet line and emit "content." (adding an implicit period if
    # the author didn't end the bullet with terminator punctuation) so
    # sentence_split splits each bullet as its own sentence.
    if not flags.get('bullet_markers', True):
        def _bullet_line_repl(m: re.Match) -> str:
            content = m.group(1).rstrip()
            if not content:
                return ''
            if content[-1] not in '.!?:;':
                content = content + '.'
            return content
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

    # Collapse excessive blank lines
    t = re.sub(r'\n{3,}', '\n\n', t)

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
                    voice = str(entry['voice'])
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
            last_err = f'rc={proc.returncode} size={out_path.stat().st_size if out_path.exists() else 0}'
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


def _run_openai_fallback(sentence: str, api_key: str, voice: str, out_path: Path) -> bool:
    """OpenAI TTS fallback (mirrors current Stop hook). Optional."""
    import subprocess
    script = Path(__file__).resolve().parent / 'openai_tts.py'
    if not script.exists():
        return False
    try:
        proc = subprocess.run(
            [sys.executable, str(script), api_key, voice, str(out_path)],
            input=sentence.encode('utf-8'),
            timeout=SYNTH_TIMEOUT_SEC,
            capture_output=True,
        )
        if proc.returncode == 0 and out_path.exists() and out_path.stat().st_size > 500:
            return True
    except Exception as e:
        _log(f'openai fallback fail: {e}')
    return False


def synthesize_parallel(
    sentences: list[str],
    voice: str,
    session_short: str,
    openai_key: str | None,
    prefix: str = '',  # e.g., 'Q-' for questions
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
            except Exception as e:
                _log(f'release move fail seq={seq}: {e}')

    def _synth_task(seq: int, sentence: str) -> None:
        tmp = tmp_dir / f'{turn_ts}-{session_short}-{seq:04d}.mp3'
        ok = _run_edge_tts(sentence, voice, tmp)
        if not ok and openai_key:
            ok = _run_openai_fallback(sentence, openai_key, 'alloy', tmp)
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
        done, not_done = concurrent.futures.wait(
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

def run(session_id: str, transcript_path: str, mode: str) -> int:
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

    with _SessionLock(session_id):
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

        pending = [
            (i, txt) for (i, txt) in assistant_text_entries_after(entries, user_idx)
            if i not in state['synthesized_line_indices']
        ]

        if not pending:
            _log(f'{mode}: no new assistant text for {session_short}')
            return 0

        config = load_config()
        voice, flags, openai_key, muted = resolve_voice_and_flags(session_short, config)

        # Muted sessions: cut the wire. Still advance the sync state so that
        # when the user unmutes, we don't retroactively synthesise the silent
        # period's text — unmute means "from now on", not "replay history".
        if muted:
            _log(f'{mode}: {session_short} is muted, skipping synthesis')
            state['synthesized_line_indices'].extend(i for i, _ in pending)
            save_sync_state(session_id, state)
            return 0

        combined = '\n'.join(t for _, t in pending)
        clean = sanitize(combined, flags)
        if not clean:
            _log(f'{mode}: sanitised text empty for {session_short}')
            # Still mark synthesized so we don't retry on next tool use
            state['synthesized_line_indices'].extend(i for i, _ in pending)
            save_sync_state(session_id, state)
            return 0

        # For on-stop: questions extracted separately and played first
        question_sentences: list[str] = []
        if mode == 'on-stop':
            questions = extract_questions(clean)
            if questions:
                question_sentences = [f'Question. {q}' for q in questions]

        # For on-tool: also narrate the tool_use entries that Claude is
        # about to call. PreToolUse fires before the tool runs, so the
        # tool_use blocks are already in the transcript by now. Each
        # narration synthesised as an ephemeral clip (T- prefix) that
        # the renderer auto-deletes immediately after playback, so the
        # dot strip doesn't fill up with "Reading foo.py" / "Running npm"
        # / etc. across a long tool chain.
        tool_narrations: list[str] = []
        tool_indices_done: list[int] = []
        if mode == 'on-tool' and flags.get('tool_calls', True):
            announced_set = set(state.get('announced_tool_line_indices', []))
            for tool_idx, tname, tinput in tool_use_entries_after(entries, user_idx):
                if tool_idx in announced_set:
                    continue
                phrase = narrate_tool_use(tname, tinput)
                if phrase:
                    tool_narrations.append(phrase)
                # Always mark as "handled" even if narration was None so we
                # don't re-consider the same entry on the next hook fire.
                tool_indices_done.append(tool_idx)

        # Body: group sentences into TTS-ready clips. Without grouping,
        # every full stop becomes its own clip, which shreds connected
        # prose into staccato delivery. group_sentences_for_tts glues
        # adjacent short sentences up to ~300 chars per clip while
        # respecting paragraph boundaries. Questions stay ungrouped
        # (they're the "hear the ask first" primitive and are meant to
        # land as short standalone clips ahead of the body).
        body_clips = group_sentences_for_tts(clean)
        if not body_clips:
            state['synthesized_line_indices'].extend(i for i, _ in pending)
            save_sync_state(session_id, state)
            return 0

        _log(f'{mode}: {session_short} — {len(pending)} new entries, '
             f'{len(body_clips)} body clips, {len(question_sentences)} questions, '
             f'{len(tool_narrations)} tool narrations')

        # Write questions first (play first due to mtime ordering from
        # release order: questions are synthesised + released before body,
        # so their mtimes are earlier. The 'Q-' prefix is a human-readable
        # marker on the filename, not the ordering mechanism.)
        if question_sentences:
            synthesize_parallel(question_sentences, voice, session_short, openai_key, prefix='Q-')
        # Tool narrations are ephemeral: synthesised with T- prefix so the
        # renderer auto-deletes them immediately after playback rather than
        # waiting for the normal auto-prune timer. They announce "what
        # Claude is doing right now" during long tool chains and would
        # otherwise flood the dot strip.
        if tool_narrations:
            synthesize_parallel(tool_narrations, voice, session_short, openai_key, prefix='T-')
        synthesize_parallel(body_clips, voice, session_short, openai_key)

        # Mark pending entries as synthesized regardless of individual clip
        # outcomes (partial failures don't cause replay attempts)
        state['synthesized_line_indices'].extend(i for i, _ in pending)
        # Same policy for tool narrations: once we've considered a tool_use
        # entry for narration (whether we actually emitted a phrase or not),
        # never reconsider it. Prevents double-announcing on the next hook fire.
        if tool_indices_done:
            announced = list(state.get('announced_tool_line_indices', []))
            announced.extend(tool_indices_done)
            state['announced_tool_line_indices'] = announced
        save_sync_state(session_id, state)
        return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description='Terminal Talk per-turn synthesis')
    p.add_argument('--session', required=True, help='Claude Code session ID (UUID or similar)')
    p.add_argument('--transcript', required=True, help='Path to transcript JSONL')
    p.add_argument('--mode', required=True, choices=['on-tool', 'on-stop'])
    args = p.parse_args(argv)
    try:
        return run(args.session, args.transcript, args.mode)
    except KeyboardInterrupt:
        _log('interrupted')
        return 130
    except Exception as e:
        _log(f'UNCAUGHT: {type(e).__name__}: {e}')
        return 1


if __name__ == '__main__':
    sys.exit(main())
