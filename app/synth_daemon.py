"""Long-lived synth dispatcher over a Unix domain socket — Phase 11
(#35). Imports synth_turn once at boot; thereafter dispatches per-
request synth runs without paying the Python cold-start tax.

Why: every Claude / Codex hook fires `python synth_turn.py ...` as a
fresh subprocess. Cold-start + module imports cost ~50-100 ms each;
a typical turn fires 6-12 times (on-stream during typing + on-tool
per tool invocation + on-stop per turn). 0.5-1 s of pure startup
overhead per response. With this daemon: socket round-trip <5 ms,
synth_turn module already loaded.

Posix-only. The matching socket-first dispatcher lives in
posix_hooks.py:spawn_synth which falls back to the existing Popen
path if the daemon is unavailable. Daemon down ≠ broken hooks.

Protocol: line-delimited JSON request → line-delimited JSON
response on a per-connection basis. One round-trip per turn.

Request:
    {"session_id": "...", "transcript_path": "...",
     "mode": "on-stop", "elapsed_sec": 25, "footer_phrase": ""}

Response:
    {"ok": true,  "exit_code": 0, "elapsed_ms": 740}    # success
    {"ok": false, "error": "<TypeError|ValueError|...>"} # error
"""
from __future__ import annotations

import contextlib
import json
import logging
import logging.handlers
import os
import signal
import socket
import sys
import threading
import time
import traceback
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(APP_DIR))

# Resolve TT_HOME the same way synth_turn / wake_word_config / posix_hooks do.
_TT_HOME_ENV = os.environ.get('TT_HOME') or os.environ.get('TT_INSTALL_DIR')
TT_HOME = Path(_TT_HOME_ENV) if _TT_HOME_ENV else (Path.home() / '.terminal-talk')
SOCKET_PATH = TT_HOME / 'synth.sock'
LOG_PATH = TT_HOME / 'queue' / '_synth_daemon.log'

LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
_handler = logging.handlers.RotatingFileHandler(
    LOG_PATH, maxBytes=1_048_576, backupCount=1, encoding='utf-8',
)
_handler.setFormatter(logging.Formatter(
    '%(asctime)s.%(msecs)03d %(message)s', datefmt='%H:%M:%S',
))
logging.basicConfig(level=logging.INFO, handlers=[_handler])
log = logging.getLogger('synth-daemon')

# Per-connection request bound. Synth jobs can run for tens of
# seconds on long turns; this is the response-write timeout, not the
# overall request budget — the daemon waits indefinitely for the
# synth_turn.run() call to finish so the parent never gets a
# half-baked partial.
RECV_BUF_BYTES = 65536  # request lines never approach this; cap defensively


def _import_synth_turn():
    """Lazy import — bringing in synth_turn pulls numpy + asyncio +
    edge-tts which take ~50-100 ms. Doing it once at daemon boot is
    the entire point of this process."""
    import synth_turn  # noqa: F401
    return synth_turn


def handle_request(synth_turn_module, req: dict) -> dict:
    """Run synth_turn.run(...) for a single request. Returns response
    dict suitable for JSON serialisation."""
    start = time.monotonic()
    required = ('session_id', 'transcript_path', 'mode')
    missing = [k for k in required if k not in req or req[k] in (None, '')]
    if missing:
        return {'ok': False, 'error': f'missing required keys: {missing}'}
    try:
        rc = synth_turn_module.run(
            session_id=str(req['session_id']),
            transcript_path=str(req['transcript_path']),
            mode=str(req['mode']),
            elapsed_sec=int(req.get('elapsed_sec') or 0),
            footer_phrase=str(req.get('footer_phrase') or ''),
        )
        elapsed_ms = int((time.monotonic() - start) * 1000)
        return {'ok': True, 'exit_code': int(rc), 'elapsed_ms': elapsed_ms}
    except Exception as e:
        log.error(f'request failed: {e}\n{traceback.format_exc()}')
        return {'ok': False, 'error': f'{type(e).__name__}: {e}'}


def _read_request_line(conn: socket.socket) -> bytes | None:
    """Read until newline or EOF; return the raw line bytes (no trailing
    \\n) or None if connection closed before a line was read."""
    buf = b''
    while b'\n' not in buf and len(buf) < RECV_BUF_BYTES:
        chunk = conn.recv(4096)
        if not chunk:
            return None
        buf += chunk
    line, _, _ = buf.partition(b'\n')
    return line


def handle_connection(synth_turn_module, conn: socket.socket) -> None:
    try:
        line = _read_request_line(conn)
        if line is None:
            return
        try:
            req = json.loads(line.decode('utf-8'))
        except Exception as e:
            resp = {'ok': False, 'error': f'parse error: {type(e).__name__}: {e}'}
            with contextlib.suppress(Exception):
                conn.sendall(json.dumps(resp).encode('utf-8') + b'\n')
            return
        resp = handle_request(synth_turn_module, req)
        with contextlib.suppress(Exception):
            conn.sendall(json.dumps(resp).encode('utf-8') + b'\n')
    finally:
        with contextlib.suppress(Exception):
            conn.close()


def serve() -> int:
    """Bind the Unix socket + accept loop. Returns 0 on clean shutdown,
    non-zero on bind failure."""
    if sys.platform == 'win32':
        log.error('synth_daemon is POSIX-only; refusing to start on win32')
        return 2

    # Stale-socket cleanup — previous run crashed and left the path.
    # bind() would fail with EADDRINUSE otherwise. Acceptable race here:
    # if another daemon is actually listening, our bind below fails and
    # we return non-zero.
    with contextlib.suppress(FileNotFoundError):
        SOCKET_PATH.unlink()
    SOCKET_PATH.parent.mkdir(parents=True, exist_ok=True)

    synth_turn_module = _import_synth_turn()

    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        sock.bind(str(SOCKET_PATH))
    except OSError as e:
        log.error(f'bind failed: {e}')
        return 3
    os.chmod(SOCKET_PATH, 0o600)  # owner-only — synth runs as the user
    sock.listen(8)
    log.info(f'listening on {SOCKET_PATH} (pid={os.getpid()})')

    shutting_down = threading.Event()

    def _shutdown(_signum, _frame):
        if shutting_down.is_set():
            return
        shutting_down.set()
        log.info('shutdown signal received')
        with contextlib.suppress(Exception):
            sock.close()
        with contextlib.suppress(FileNotFoundError):
            SOCKET_PATH.unlink()

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    while not shutting_down.is_set():
        try:
            conn, _ = sock.accept()
        except OSError:
            # Either we shut down (sock closed) or transient EBADF.
            if shutting_down.is_set():
                break
            log.warning('accept transient OSError; retrying')
            time.sleep(0.05)
            continue
        # synth_turn.run() takes a per-session lock internally, so
        # concurrent requests for the SAME session serialise via that;
        # cross-session requests run in parallel as intended.
        threading.Thread(
            target=handle_connection,
            args=(synth_turn_module, conn),
            daemon=True,
        ).start()
    return 0


if __name__ == '__main__':
    sys.exit(serve())
