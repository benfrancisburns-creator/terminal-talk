"""Wake-word config loader, kept separate from wake-word-listener.py
so tests can exercise it without importing numpy / sounddevice /
openwakeword (none of which the loader needs).

Public surface:
    WAKE_WORDS_DEFAULT      list[str] — canonical fallback
    BUILTIN_WAKE_WORDS      frozenset[str] — canned-name allowlist
    MAX_CUSTOM_MODEL_BYTES  int — sanity cap on user-supplied .onnx files
    resolve_config_path()   Path — same logic as synth_turn.py's resolver
    validate_wake_word(e)   str | None — accepts canned name OR valid path
    load_wake_words(log)    list[str] — read config.json, validate, fall back

`log` is any object with .warning(msg). Pass logging.getLogger(...) at
runtime; tests can pass a stub recorder.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Protocol


class _LogLike(Protocol):
    def warning(self, msg: str) -> None: ...


WAKE_WORDS_DEFAULT: list[str] = ['hey_jarvis']

# openWakeWord 0.6 ships these short-name models that resolve without a
# path. Anything in here is accepted as a canned name; anything else is
# treated as a filesystem path to a user-trained .onnx model.
BUILTIN_WAKE_WORDS: frozenset[str] = frozenset({
    'alexa', 'hey_jarvis', 'hey_mycroft', 'hey_rhasspy', 'timer', 'weather',
})

# Sanity cap on user-supplied .onnx files. Real openWakeWord models are
# ~100-200 KB; 5 MB is generous and stops accidental path mistakes from
# loading something huge into the audio thread.
MAX_CUSTOM_MODEL_BYTES: int = 5 * 1024 * 1024


def resolve_config_path() -> Path:
    """Match synth_turn.py's resolution: TT_CONFIG_PATH env wins, XDG on
    Linux without TT_HOME, else TT_HOME/config.json (default home is
    ~/.terminal-talk)."""
    if os.environ.get('TT_CONFIG_PATH'):
        return Path(os.environ['TT_CONFIG_PATH'])
    tt_home_env = os.environ.get('TT_HOME') or os.environ.get('TT_INSTALL_DIR')
    if not tt_home_env and sys.platform.startswith('linux'):
        return (Path(os.environ.get('XDG_CONFIG_HOME') or (Path.home() / '.config'))
                / 'terminal-talk' / 'config.json')
    base = Path(tt_home_env) if tt_home_env else Path.home() / '.terminal-talk'
    return base / 'config.json'


def validate_wake_word(entry: object, log: _LogLike | None = None) -> str | None:
    """Return the entry as a string if valid, else None.

    Canned names pass through unchanged (openWakeWord resolves them
    internally). Paths must exist, end in .onnx, and be < 5 MB.
    Tilde and env-var expansion is supported on paths."""
    if not isinstance(entry, str):
        return None
    e = entry.strip()
    if not e:
        return None
    if e in BUILTIN_WAKE_WORDS:
        return e
    p = Path(os.path.expandvars(e)).expanduser()
    if not p.exists():
        if log:
            log.warning(f'wake_words: path not found: {e}')
        return None
    if p.suffix.lower() != '.onnx':
        if log:
            log.warning(f'wake_words: path not .onnx: {e}')
        return None
    try:
        size = p.stat().st_size
    except OSError as exc:
        if log:
            log.warning(f'wake_words: stat failed for {e}: {exc}')
        return None
    if size > MAX_CUSTOM_MODEL_BYTES:
        if log:
            log.warning(f'wake_words: too large ({size} > {MAX_CUSTOM_MODEL_BYTES}): {e}')
        return None
    return str(p)


def load_wake_words(log: _LogLike | None = None) -> list[str]:
    """Read config.json's wake_words array; validate each entry; fall
    back to WAKE_WORDS_DEFAULT if the config is absent, malformed, or
    yields no valid entries. Always returns a non-empty list so callers
    don't have to handle empty-input edge cases."""
    path = resolve_config_path()
    try:
        if not path.exists():
            return list(WAKE_WORDS_DEFAULT)
        cfg = json.loads(path.read_text(encoding='utf-8'))
    except Exception as e:
        if log:
            log.warning(f'wake_words: config read fail ({type(e).__name__}: {e}); using default')
        return list(WAKE_WORDS_DEFAULT)
    raw = cfg.get('wake_words') if isinstance(cfg, dict) else None
    if not isinstance(raw, list):
        return list(WAKE_WORDS_DEFAULT)
    validated = [v for v in (validate_wake_word(s, log=log) for s in raw) if v]
    if not validated:
        if log:
            log.warning('wake_words: config yielded no valid entries; using default')
        return list(WAKE_WORDS_DEFAULT)
    return validated
