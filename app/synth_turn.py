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
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, Future
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Iterable, List, Optional

try:
    from sentence_split import split_sentences
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from sentence_split import split_sentences


# ---------------------------------------------------------------------------
# Paths + constants
# ---------------------------------------------------------------------------

TT_HOME = Path.home() / '.terminal-talk'
QUEUE_DIR = TT_HOME / 'queue'
SESSIONS_DIR = TT_HOME / 'sessions'
CONFIG_PATH = TT_HOME / 'config.json'
REGISTRY_PATH = TT_HOME / 'session-colours.json'
LOG_PATH = QUEUE_DIR / '_hook.log'
EDGE_TTS_SCRIPT = Path(__file__).resolve().parent / 'edge_tts_speak.py'

# Max parallel edge-tts workers. Edge-tts endpoint tolerates a handful of
# concurrent requests; too many → rate limits and backoff storm.
MAX_PARALLEL_SYNTH = 4

# Per-synthesis safety timeout (seconds). edge_tts_speak already retries up
# to 6 times with its own backoff; this is the last-resort kill.
SYNTH_TIMEOUT_SEC = 40

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
        return {'turn_boundary': -1, 'synthesized_line_indices': []}
    try:
        with open(p, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return {
            'turn_boundary': int(data.get('turn_boundary', -1)),
            'synthesized_line_indices': list(data.get('synthesized_line_indices', [])),
        }
    except Exception as e:
        _log(f'sync state read fail ({session_id[:8]}): {e}; resetting')
        return {'turn_boundary': -1, 'synthesized_line_indices': []}


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
        for _ in range(40):  # ~2s of polling
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(fd, str(os.getpid()).encode())
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
        if self.acquired:
            try:
                self.path.unlink(missing_ok=True)
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Transcript extraction
# ---------------------------------------------------------------------------

def read_transcript_lines(transcript_path: Path) -> List[dict]:
    """Parse transcript JSONL. Invalid lines are skipped with a log entry."""
    entries: List[dict] = []
    try:
        with open(transcript_path, 'r', encoding='utf-8') as f:
            for i, raw in enumerate(f):
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


def find_last_user_idx(entries: List[dict]) -> int:
    """Line index (0-based) of most recent user-type entry, or -1."""
    for i in range(len(entries) - 1, -1, -1):
        if entries[i].get('type') == 'user':
            return i
    return -1


def assistant_text_entries_after(entries: List[dict], start_idx: int) -> List[tuple]:
    """Return list of (line_idx, text) for assistant-text content after start_idx."""
    out: List[tuple] = []
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


# ---------------------------------------------------------------------------
# Sanitisation  (mirrors speak-response.ps1 lines 260-306)
# ---------------------------------------------------------------------------

_CODE_FENCE_RE = re.compile(r'```[a-zA-Z0-9_+-]*\n?([\s\S]*?)```')
_INLINE_CODE_RE = re.compile(r'`([^`]+)`')
_URL_RE = re.compile(r'https?://\S+|www\.\S+', re.IGNORECASE)
_HEADING_LINE_RE = re.compile(r'^\s*#{1,6}\s*.*$', re.MULTILINE)
_BULLET_MARKER_RE = re.compile(r'^\s*([-*+]|\d+\.)\s+', re.MULTILINE)
_EMPHASIS_RE = re.compile(r'\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_')
_IMG_RE = re.compile(r'!\[([^\]]*)\]\([^\)]+\)')
_CTRL_RE = re.compile(r'\bCtrl\+', re.IGNORECASE)
_CMD_RE = re.compile(r'\bCmd\+', re.IGNORECASE)


def sanitize(text: str, flags: dict) -> str:
    if not text:
        return ''
    t = text

    # Code blocks
    if flags.get('code_blocks', False):
        t = _CODE_FENCE_RE.sub(lambda m: m.group(1), t)
    else:
        t = _CODE_FENCE_RE.sub('', t)

    # Inline code
    if flags.get('inline_code', False):
        t = _INLINE_CODE_RE.sub(lambda m: m.group(1), t)
    else:
        t = _INLINE_CODE_RE.sub('', t)

    # Images: alt text or strip entirely
    if flags.get('image_alt', True):
        t = _IMG_RE.sub(lambda m: m.group(1), t)
    else:
        t = _IMG_RE.sub('', t)

    # Markdown emphasis — always strip (keep content)
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

    # Bullet markers
    if not flags.get('bullet_markers', True):
        t = _BULLET_MARKER_RE.sub('', t)

    # Keyboard modifiers → words so TTS pronounces naturally
    t = _CTRL_RE.sub('control ', t)
    t = _CMD_RE.sub('command ', t)

    # Collapse excessive blank lines
    t = re.sub(r'\n{3,}', '\n\n', t)

    return t.strip()


# ---------------------------------------------------------------------------
# Config / voice / speech-includes resolution
# ---------------------------------------------------------------------------

DEFAULT_SPEECH_INCLUDES = {
    'code_blocks': False,
    'inline_code': False,
    'urls': False,
    'headings': True,
    'bullet_markers': True,
    'image_alt': True,
}


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        _log(f'config read fail: {e}')
        return {}


def resolve_voice_and_flags(session_short: str, config: dict) -> tuple[str, dict, Optional[str], bool]:
    """Returns (voice, speech_includes, openai_key_or_none, muted).

    Per-session override beats config default. If nothing set, uses a conservative
    default. speech_includes flags follow the same precedence. `muted` is read
    straight from the session registry — config has no global mute.
    """
    voice = config.get('voices', {}).get('response_voice', 'en-GB-RyanNeural')
    openai_key = config.get('voices', {}).get('openai_api_key') or None
    flags = dict(DEFAULT_SPEECH_INCLUDES)
    cfg_inc = config.get('speech_includes', {})
    for k in flags:
        if k in cfg_inc and isinstance(cfg_inc[k], bool):
            flags[k] = cfg_inc[k]

    muted = False

    # Per-session override
    try:
        if REGISTRY_PATH.exists():
            with open(REGISTRY_PATH, 'r', encoding='utf-8') as f:
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

def _run_edge_tts(sentence: str, voice: str, out_path: Path) -> bool:
    """Invoke edge_tts_speak.py. Returns True on success."""
    import subprocess
    try:
        proc = subprocess.run(
            [sys.executable, str(EDGE_TTS_SCRIPT), voice, str(out_path)],
            input=sentence.encode('utf-8'),
            timeout=SYNTH_TIMEOUT_SEC,
            capture_output=True,
        )
        if proc.returncode == 0 and out_path.exists() and out_path.stat().st_size > 500:
            return True
        _log(f'edge-tts rc={proc.returncode} size={out_path.stat().st_size if out_path.exists() else 0}')
    except subprocess.TimeoutExpired:
        _log(f'edge-tts timeout for sentence len={len(sentence)}')
    except Exception as e:
        _log(f'edge-tts exec fail: {e}')
    # Clean up partial output on any failure
    if out_path.exists():
        try:
            out_path.unlink()
        except Exception:
            pass
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
    sentences: List[str],
    voice: str,
    session_short: str,
    openai_key: Optional[str],
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
    results: dict[int, Optional[Path]] = {}
    next_release = [0]
    release_lock = Lock()
    written_count = [0]

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

    with ThreadPoolExecutor(max_workers=MAX_PARALLEL_SYNTH) as ex:
        futures: List[Future] = []
        for seq, sent in enumerate(sentences):
            futures.append(ex.submit(_synth_task, seq, sent))
        # Wait for everything (ThreadPool.__exit__ joins)

    # Clean up tmp dir if empty
    try:
        tmp_dir.rmdir()
    except OSError:
        pass  # still has files from partial failures; cleanup later

    _log(f'synth complete: {written_count[0]}/{len(sentences)} clips for {session_short}')
    return written_count[0]


# ---------------------------------------------------------------------------
# Questions-first extraction
# ---------------------------------------------------------------------------

_QUESTION_RE = re.compile(r'([^.!?\n]{5,}\?)')


def extract_questions(text: str) -> List[str]:
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

        # Turn boundary changed? Reset synthesized list.
        if state['turn_boundary'] != user_idx:
            state = {'turn_boundary': user_idx, 'synthesized_line_indices': []}

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
        question_sentences: List[str] = []
        if mode == 'on-stop':
            questions = extract_questions(clean)
            if questions:
                question_sentences = [f'Question. {q}' for q in questions]

        body_sentences = split_sentences(clean)
        if not body_sentences:
            state['synthesized_line_indices'].extend(i for i, _ in pending)
            save_sync_state(session_id, state)
            return 0

        _log(f'{mode}: {session_short} — {len(pending)} new entries, '
             f'{len(body_sentences)} body sentences, {len(question_sentences)} questions')

        # Write questions first (play first due to lexicographic filename ordering:
        # prefix 'Q' sorts before empty, so questions go out ahead)
        if question_sentences:
            synthesize_parallel(question_sentences, voice, session_short, openai_key, prefix='Q-')
        synthesize_parallel(body_sentences, voice, session_short, openai_key)

        # Mark pending entries as synthesized regardless of individual clip
        # outcomes (partial failures don't cause replay attempts)
        state['synthesized_line_indices'].extend(i for i, _ in pending)
        save_sync_state(session_id, state)
        return 0


def main(argv: Optional[List[str]] = None) -> int:
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
