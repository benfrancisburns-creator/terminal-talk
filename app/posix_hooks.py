#!/usr/bin/env python3
"""POSIX hook helper for Terminal Talk.

This is the Linux/macOS counterpart to the PowerShell hook scripts. Thin
`.sh` wrappers call this file for Claude and Codex lifecycle events so the
shell layer stays boring and JSON/registry logic lives in Python.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

SHORT_RE = re.compile(r'^[a-f0-9]{8}$')
PALETTE_AUTO_ORDER = [
    0, 4, 3, 5, 2, 6, 7, 16, 11, 9, 10, 14,
    20, 8, 12, 13, 17, 18, 19, 21, 22, 23, 1, 15,
]
LOCK_STALE_SEC = 3.0
LOCK_TIMEOUT_SEC = 0.5
PLUGIN_CLEANUP_DELAY_SEC = 120


def default_tt_home() -> Path:
    if sys.platform.startswith('linux'):
        return Path(os.environ.get('XDG_STATE_HOME') or (Path.home() / '.local' / 'state')) / 'terminal-talk'
    return Path.home() / '.terminal-talk'


TT_HOME = Path(os.environ.get('TT_HOME') or os.environ.get('TT_INSTALL_DIR') or default_tt_home()).expanduser()
APP_DIR = Path(os.environ.get('TT_APP_DIR') or (TT_HOME / 'app')).expanduser()
if not (APP_DIR / 'synth_turn.py').exists():
    APP_DIR = Path(__file__).resolve().parent
TT_HOME.mkdir(parents=True, exist_ok=True)
QUEUE_DIR = TT_HOME / 'queue'
SESSIONS_DIR = TT_HOME / 'sessions'
REGISTRY_PATH = Path(os.environ.get('TT_REGISTRY_PATH') or (TT_HOME / 'session-colours.json'))
LOG_PATH = QUEUE_DIR / '_hook.log'


def _python_exe() -> str:
    return os.environ.get('TT_PYTHON_EXE') or sys.executable or 'python3'


def _ensure_dirs() -> None:
    QUEUE_DIR.mkdir(parents=True, exist_ok=True)
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)


def log(caller: str, message: str) -> None:
    try:
        _ensure_dirs()
        if LOG_PATH.exists() and LOG_PATH.stat().st_size > 1024 * 1024:
            backup = LOG_PATH.with_name(LOG_PATH.name + '.1')
            with contextlib.suppress(FileNotFoundError):
                backup.unlink()
            LOG_PATH.replace(backup)
        stamp = time.strftime('%H:%M:%S')
        with LOG_PATH.open('a', encoding='utf-8') as f:
            f.write(f'{stamp} [{caller}] {message}\n')
    except Exception:
        pass


def read_payload() -> dict[str, Any] | None:
    raw = sys.stdin.read()
    if not raw.strip():
        return None
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else None
    except Exception as exc:
        log('posix-hook', f'payload parse failed: {exc}')
        return None


def session_short(session_id: str) -> str:
    sid = (session_id or '').strip().lower()
    if len(sid) >= 8 and SHORT_RE.match(sid[:8]):
        return sid[:8]
    if not sid:
        return ''
    return hashlib.sha1(sid.encode('utf-8')).hexdigest()[:8]


def session_from_transcript(payload: dict[str, Any]) -> tuple[str, Path | None]:
    transcript_raw = str(payload.get('transcript_path') or payload.get('transcriptPath') or '')
    transcript = Path(transcript_raw).expanduser() if transcript_raw else None
    session_id = str(payload.get('session_id') or '')
    if not session_id and transcript:
        session_id = transcript.stem
    return session_id, transcript


def epoch() -> int:
    return int(time.time())


def read_registry() -> dict[str, Any]:
    try:
        raw = REGISTRY_PATH.read_text(encoding='utf-8-sig')
        parsed = json.loads(raw)
        assignments = parsed.get('assignments', {})
        return assignments if isinstance(assignments, dict) else {}
    except Exception:
        return {}


def save_registry(assignments: dict[str, Any], caller: str) -> bool:
    _ensure_dirs()
    tmp = REGISTRY_PATH.with_name(REGISTRY_PATH.name + '.tmp')
    try:
        tmp.write_text(json.dumps({'assignments': assignments}, indent=2), encoding='utf-8')
        os.replace(tmp, REGISTRY_PATH)
        log(caller, f'save-registry ok keys={len(assignments)}')
        return True
    except Exception as exc:
        log(caller, f'save-registry failed: {exc}')
        with contextlib.suppress(Exception):
            tmp.unlink()
        return False


class RegistryLock:
    def __init__(self, path: Path):
        self.lock_path = Path(str(path) + '.lock')
        self.held = False

    def __enter__(self) -> bool:
        start = time.monotonic()
        while time.monotonic() - start < LOCK_TIMEOUT_SEC:
            try:
                fd = os.open(str(self.lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                try:
                    os.write(fd, str(os.getpid()).encode('ascii'))
                finally:
                    os.close(fd)
                self.held = True
                return True
            except FileExistsError:
                try:
                    if time.time() - self.lock_path.stat().st_mtime > LOCK_STALE_SEC:
                        self.lock_path.unlink()
                        continue
                except FileNotFoundError:
                    continue
                time.sleep(0.015)
        return False

    def __exit__(self, *_exc: object) -> None:
        if not self.held:
            return
        with contextlib.suppress(FileNotFoundError):
            self.lock_path.unlink()


def palette_auto_order(size: int = 24) -> list[int]:
    out: list[int] = []
    seen: set[int] = set()
    for idx in PALETTE_AUTO_ORDER:
        if 0 <= idx < size and idx not in seen:
            out.append(idx)
            seen.add(idx)
    for idx in range(size):
        if idx not in seen:
            out.append(idx)
    return out


def has_user_intent(entry: dict[str, Any]) -> bool:
    if not isinstance(entry, dict):
        return False
    if entry.get('label') and entry.get('auto_label') is not True:
        return True
    if entry.get('pinned') is True:
        return True
    if entry.get('voice') and entry.get('voice_auto') is not True:
        return True
    if entry.get('voice_auto') is False:
        return True
    if entry.get('muted') is True or entry.get('focus') is True:
        return True
    if isinstance(entry.get('heartbeat_enabled'), bool):
        return True
    inc = entry.get('speech_includes')
    return isinstance(inc, dict) and bool(inc)


def allocate_palette(assignments: dict[str, Any], new_short: str) -> int:
    busy = {
        int(e.get('index')) for e in assignments.values()
        if isinstance(e, dict) and str(e.get('index', '')).isdigit()
    }
    for idx in palette_auto_order(24):
        if idx not in busy:
            return idx
    candidates = [
        (str(k), v) for k, v in assignments.items()
        if isinstance(v, dict) and v.get('pinned') is not True and not has_user_intent(v)
    ]
    if candidates:
        candidates.sort(key=lambda kv: (int(kv[1].get('last_seen') or 0), kv[0]))
        evicted, entry = candidates[0]
        idx = int(entry.get('index') or 0)
        assignments.pop(evicted, None)
        return idx
    return sum(ord(ch) for ch in new_short) % 24


def touch_assignment(
    session_id: str,
    caller: str,
    pid: int = 0,
    label: str = '',
    source_kind: str = '',
    source_cwd: str = '',
    source: str = '',
    source_originator: str = '',
) -> tuple[str, dict[str, Any] | None]:
    short = session_short(session_id)
    if not SHORT_RE.match(short):
        log(caller, f'invalid short for session {session_id!r}')
        return '', None

    with RegistryLock(REGISTRY_PATH) as held:
        assignments = read_registry()
        if not held:
            entry = assignments.get(short)
            return short, entry if isinstance(entry, dict) else None

        entry = assignments.get(short)
        now = epoch()
        if not isinstance(entry, dict):
            entry = {
                'index': allocate_palette(assignments, short),
                'session_id': session_id,
                'claude_pid': pid,
                'label': label or '',
                'pinned': False,
                'last_seen': now,
            }
            assignments[short] = entry
        else:
            entry['session_id'] = session_id
            entry['claude_pid'] = pid
            entry['last_seen'] = now
            if label and (not entry.get('label') or entry.get('auto_label') is True):
                entry['label'] = label
                entry['auto_label'] = True

        if source_kind:
            entry['source_kind'] = source_kind
        if source_cwd:
            entry['source_cwd'] = source_cwd
        if source:
            entry['source'] = source
        if source_originator:
            entry['source_originator'] = source_originator
        if label and source_kind == 'codex-plugin':
            entry.setdefault('source_label', label)

        save_registry(assignments, caller)
        return short, entry


def mark_working(short: str, caller: str) -> None:
    if not SHORT_RE.match(short):
        return
    _ensure_dirs()
    (SESSIONS_DIR / f'{short}-working.flag').write_text(str(epoch()), encoding='utf-8')
    log(caller, f'working flag set for {short}')


def clear_working(short: str, caller: str) -> int:
    if not SHORT_RE.match(short):
        return 0
    flag = SESSIONS_DIR / f'{short}-working.flag'
    elapsed = 0
    try:
        started = int(flag.read_text(encoding='utf-8').strip())
        if started > 0:
            elapsed = max(0, epoch() - started)
    except Exception:
        pass
    try:
        flag.unlink()
        log(caller, f'working flag cleared for {short} elapsed={elapsed}s')
    except FileNotFoundError:
        pass
    return elapsed


def spawn_synth(session_id: str, transcript: Path, mode: str, caller: str, elapsed_sec: int = 0) -> int:
    synth = APP_DIR / 'synth_turn.py'
    if not synth.exists() or not transcript.exists():
        log(caller, f'synth skip: synth={synth.exists()} transcript={transcript}')
        return 0
    short = session_short(session_id)
    err_path = QUEUE_DIR / f'synth-{mode}-{short}.err'
    args = [
        _python_exe(), '-u', str(synth),
        '--session', session_id,
        '--transcript', str(transcript),
        '--mode', mode,
    ]
    if elapsed_sec > 0:
        args.extend(['--elapsed-sec', str(elapsed_sec)])
    err = err_path.open('ab')
    try:
        proc = subprocess.Popen(
            args,
            cwd=str(TT_HOME),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=err,
            start_new_session=True,
        )
        log(caller, f'spawned synth pid={proc.pid} mode={mode} short={short}')
        return 0
    except Exception as exc:
        log(caller, f'synth spawn failed: {exc}')
        return 0
    finally:
        with contextlib.suppress(Exception):
            err.close()


def handle_claude_mark(caller: str = 'mark-working') -> int:
    payload = read_payload()
    if not payload:
        return 0
    session_id, transcript = session_from_transcript(payload)
    short = session_short(session_id)
    if SHORT_RE.match(short):
        mark_working(short, caller)
    return 0


def handle_claude_tool() -> int:
    caller = 'speak-on-tool'
    payload = read_payload()
    if not payload:
        return 0
    session_id, transcript = session_from_transcript(payload)
    if not session_id or not transcript or not transcript.exists():
        log(caller, f'transcript missing: {transcript}')
        return 0
    short, _entry = touch_assignment(session_id, caller, pid=os.getppid())
    if short:
        mark_working(short, caller)
    return spawn_synth(session_id, transcript, 'on-tool', caller)


def handle_claude_stop() -> int:
    caller = 'speak-response'
    payload = read_payload()
    if not payload:
        return 0
    session_id, transcript = session_from_transcript(payload)
    if not session_id or not transcript or not transcript.exists():
        log(caller, f'transcript missing: {transcript}')
        return 0
    short, _entry = touch_assignment(session_id, caller, pid=os.getppid())
    elapsed = clear_working(short, caller) if short else 0
    return spawn_synth(session_id, transcript, 'on-stop', caller, elapsed_sec=elapsed)


def import_synth_turn():
    sys.path.insert(0, str(APP_DIR))
    import synth_turn  # type: ignore
    return synth_turn


def handle_notification() -> int:
    caller = 'speak-notification'
    payload = read_payload()
    if not payload:
        return 0
    message = str(payload.get('message') or '')
    if 'permission' not in message.lower():
        log(caller, 'skip: not a permission prompt')
        return 0
    short = session_short(str(payload.get('session_id') or 'unknown0'))
    if not SHORT_RE.match(short):
        short = 'unknown0'
    spoken = f'Claude needs permission. {message}'
    try:
        synth_turn = import_synth_turn()
        config = synth_turn.load_config()
        voice, _flags, openai_key, muted = synth_turn.resolve_voice_and_flags(short, config)
        if muted:
            log(caller, f'{short} is muted, skipping notification')
            return 0
        provider, fallback_provider, openai_voice = synth_turn.resolve_tts_routing(config)
        synth_turn.synthesize_parallel(
            [spoken], voice, short, openai_key,
            prefix='N-', provider=provider,
            fallback_provider=fallback_provider,
            openai_voice=openai_voice,
        )
    except Exception as exc:
        log(caller, f'notification synth failed: {type(exc).__name__}: {exc}')
    return 0


def read_rollout_meta(path: Path) -> dict[str, Any] | None:
    try:
        first = path.read_text(encoding='utf-8').splitlines()[0]
        parsed = json.loads(first)
    except Exception:
        return None
    if parsed.get('type') != 'session_meta' or not isinstance(parsed.get('payload'), dict):
        return None
    payload = parsed['payload']
    sid = str(payload.get('id') or '').lower()
    if not sid:
        return None
    return {
        'session_id': sid,
        'short': session_short(sid),
        'cwd': str(payload.get('cwd') or ''),
        'source': str(payload.get('source') or ''),
        'originator': str(payload.get('originator') or ''),
        'terminal_source': is_terminal_rollout(payload),
    }


def is_terminal_rollout(meta: dict[str, Any]) -> bool:
    source = str(meta.get('source') or '').lower()
    originator = str(meta.get('originator') or '').lower()
    if source == 'cli' or originator == 'codex-tui':
        return True
    return bool(not source and not originator)


def resolve_rollout_meta(payload: dict[str, Any], session_id: str) -> dict[str, Any] | None:
    for name in ('transcript_path', 'transcriptPath', 'rollout_path', 'rolloutPath', 'session_path', 'sessionPath'):
        raw = payload.get(name)
        if not raw:
            continue
        meta = read_rollout_meta(Path(str(raw)).expanduser())
        if meta and meta.get('session_id') == session_id.lower():
            return meta
    sessions_root = Path(os.environ.get('CODEX_HOME') or (Path.home() / '.codex')) / 'sessions'
    if not sessions_root.exists():
        return None
    try:
        matches = sorted(
            sessions_root.rglob(f'*{session_id.lower()}.jsonl'),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
    except Exception:
        matches = []
    for path in matches[:20]:
        meta = read_rollout_meta(path)
        if meta and meta.get('session_id') == session_id.lower():
            return meta
    return None


def plugin_label(cwd: str) -> str:
    project = Path(cwd).name if cwd else 'background task'
    label = f'Claude Codex - {project or "background task"}'
    return label[:60].strip()


def announce_plugin_start(short: str, session_id: str, entry: dict[str, Any], caller: str) -> None:
    if not SHORT_RE.match(short):
        return
    marker = SESSIONS_DIR / f'{short}-plugin-start-announced.flag'
    if marker.exists():
        return
    _ensure_dirs()
    marker.write_text(str(epoch()), encoding='utf-8')
    job = {
        'short': short,
        'session_id': session_id,
        'label': entry.get('label') or entry.get('source_label') or 'Claude Codex',
        'index': entry.get('index', 0),
        'source_cwd': entry.get('source_cwd', ''),
        'caller': caller,
    }
    (SESSIONS_DIR / f'{short}-plugin-start.json').write_text(
        json.dumps(job, indent=2), encoding='utf-8'
    )
    try:
        synth_turn = import_synth_turn()
        config = synth_turn.load_config()
        voice, _flags, openai_key, muted = synth_turn.resolve_voice_and_flags(short, config)
        if muted:
            return
        provider, fallback_provider, openai_voice = synth_turn.resolve_tts_routing(config)
        spoken = f"Codex plugin session registered. {job['label']}. Session ID {short}."
        synth_turn.synthesize_parallel(
            [spoken], voice, short, openai_key,
            prefix='N-', provider=provider,
            fallback_provider=fallback_provider,
            openai_voice=openai_voice,
        )
    except Exception as exc:
        log(caller, f'plugin start announcement failed: {type(exc).__name__}: {exc}')


def remove_plugin_session(short: str, caller: str, purge_queue: bool = False) -> bool:
    if not SHORT_RE.match(short):
        return False
    with RegistryLock(REGISTRY_PATH) as held:
        assignments = read_registry()
        entry = assignments.get(short)
        has_marker = (SESSIONS_DIR / f'{short}-plugin-start.json').exists() or (
            SESSIONS_DIR / f'{short}-plugin-start-announced.flag'
        ).exists()
        if isinstance(entry, dict) and entry.get('source_kind') == 'codex-plugin' and held:
            assignments.pop(short, None)
            save_registry(assignments, caller)
        elif not has_marker:
            return False
    (SESSIONS_DIR / f'{short}-plugin-cleaned.flag').write_text(str(epoch()), encoding='utf-8')
    for suffix in ('working.flag', 'plugin-start-announced.flag', 'plugin-start.json'):
        with contextlib.suppress(FileNotFoundError):
            (SESSIONS_DIR / f'{short}-{suffix}').unlink()
    if purge_queue and QUEUE_DIR.exists():
        for path in QUEUE_DIR.iterdir():
            if path.is_file() and f'-{short}' in path.name:
                with contextlib.suppress(Exception):
                    path.unlink()
    log(caller, f'removed plugin session {short}')
    return True


def schedule_plugin_cleanup(short: str, caller: str, delay: int = PLUGIN_CLEANUP_DELAY_SEC) -> None:
    if not SHORT_RE.match(short):
        return
    args = [
        _python_exe(), str(APP_DIR / 'posix_hooks.py'),
        'plugin-cleanup', '--short', short, '--delay', str(max(0, delay)), '--purge-queue',
    ]
    try:
        subprocess.Popen(
            args, cwd=str(TT_HOME), stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        log(caller, f'scheduled plugin cleanup short={short} delay={delay}s')
    except Exception as exc:
        log(caller, f'plugin cleanup spawn failed: {exc}')


def handle_codex(event: str) -> int:
    caller = f'codex-{event}'
    payload = read_payload()
    if not payload:
        return 0
    session_id = str(payload.get('session_id') or payload.get('id') or payload.get('thread_id') or '').lower()
    if not session_id:
        log(caller, 'no session_id in payload')
        return 0
    meta = resolve_rollout_meta(payload, session_id)
    cwd = str(payload.get('cwd') or '')
    source = ''
    originator = ''
    source_kind = ''
    label = ''
    if meta:
        cwd = str(meta.get('cwd') or cwd)
        source = str(meta.get('source') or '')
        originator = str(meta.get('originator') or '')
        if meta.get('terminal_source') is False:
            source_kind = 'codex-plugin'
            label = plugin_label(cwd)
    if str(payload.get('source_kind') or '') == 'codex-plugin':
        source_kind = 'codex-plugin'
        label = plugin_label(cwd)

    short, entry = touch_assignment(
        session_id, caller, pid=os.getppid(), label=label,
        source_kind=source_kind, source_cwd=cwd,
        source=source, source_originator=originator,
    )
    if not short:
        return 0
    if event in ('session-start', 'mark-working', 'on-tool', 'post-tool'):
        mark_working(short, caller)
    if source_kind == 'codex-plugin' and event == 'session-start' and entry:
        announce_plugin_start(short, session_id, entry, caller)
    if event == 'stop':
        clear_working(short, caller)
        if source_kind == 'codex-plugin':
            schedule_plugin_cleanup(short, caller)
    return 0


def handle_plugin_cleanup(args: argparse.Namespace) -> int:
    delay = max(0, int(args.delay or 0))
    if delay:
        time.sleep(delay)
    remove_plugin_session(str(args.short or ''), 'codex-plugin-cleanup', purge_queue=bool(args.purge_queue))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Terminal Talk POSIX hook helper')
    parser.add_argument('event', choices=[
        'claude-mark-working', 'claude-on-tool', 'claude-stop', 'claude-notification',
        'codex-session-start', 'codex-mark-working', 'codex-on-tool',
        'codex-post-tool', 'codex-stop', 'plugin-cleanup',
    ])
    parser.add_argument('--short', default='')
    parser.add_argument('--delay', type=int, default=0)
    parser.add_argument('--purge-queue', action='store_true')
    args = parser.parse_args(argv)

    if args.event == 'claude-mark-working':
        return handle_claude_mark()
    if args.event == 'claude-on-tool':
        return handle_claude_tool()
    if args.event == 'claude-stop':
        return handle_claude_stop()
    if args.event == 'claude-notification':
        return handle_notification()
    if args.event == 'plugin-cleanup':
        return handle_plugin_cleanup(args)
    return handle_codex(args.event.replace('codex-', ''))


if __name__ == '__main__':
    raise SystemExit(main())
