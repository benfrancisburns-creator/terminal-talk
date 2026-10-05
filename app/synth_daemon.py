"""Long-lived synth dispatcher — Phase 11 (#35), win32 transport 2026-07-13.
Imports synth_turn once at boot; thereafter dispatches per-request synth
runs without paying the Python cold-start tax.

Why: every Claude / Codex hook fires `python synth_turn.py ...` as a
fresh subprocess. Cold-start + module imports cost ~50-100 ms each;
a typical turn fires 6-12 times (on-stream during typing + on-tool
per tool invocation + on-stop per turn). 0.5-1 s of pure startup
overhead per response. With this daemon: socket round-trip <5 ms,
synth_turn module already loaded.

Transport is per-platform:
  - POSIX: Unix domain socket at TT_HOME/synth.sock (0600, unchanged
    since Phase 11). Client: posix_hooks.py:spawn_synth.
  - Windows: TCP loopback on an ephemeral 127.0.0.1 port, advertised in
    TT_HOME/synth-port.json together with a per-boot random token that
    every request must echo. Loopback TCP is reachable by OTHER local
    users (unlike a user-profile Unix socket), so the token restores the
    same-user trust boundary documented in ipc-integrity.md. Clients:
    app/synth-dispatch.psm1 (hooks) + app/lib/synth-client.js (watcher).
  TT_SYNTH_TRANSPORT=unix|tcp overrides the default (used by tests to
  exercise the TCP path on POSIX CI).

The matching dispatchers fall back to the existing Popen path if the
daemon is unavailable. Daemon down ≠ broken hooks.

Additionally, running under the daemon sets TT_SYNTH_DAEMON=1 which
switches synth_turn's transcript reader to an incremental append-only
cache — long sessions stop re-parsing the whole JSONL on every fire.

Protocol: line-delimited JSON request → line-delimited JSON
response on a per-connection basis. One round-trip per turn.

Request:
    {"session_id": "...", "transcript_path": "...",
     "mode": "on-stop", "elapsed_sec": 25, "footer_phrase": "",
     "token": "<required on TCP, ignored on Unix socket>"}

Response:
    {"ok": true,  "exit_code": 0, "elapsed_ms": 740}    # success
    {"ok": false, "error": "<TypeError|ValueError|...>"} # error
"""
from __future__ import annotations

import atexit
import contextlib
import json
import logging
import logging.handlers
import os
import secrets
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
PORT_FILE = TT_HOME / 'synth-port.json'
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


def handle_connection(synth_turn_module, conn: socket.socket,
                      token: str | None = None) -> None:
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
        # TCP transport carries a per-boot token (see module docstring).
        # compare_digest so the reject path is constant-time. The Unix-
        # socket transport passes token=None and skips the check —
        # filesystem permissions are the boundary there.
        if token is not None:
            supplied = str(req.get('token') or '')
            if not secrets.compare_digest(supplied, token):
                log.warning('request rejected: bad or missing token')
                resp = {'ok': False, 'error': 'unauthorised'}
                with contextlib.suppress(Exception):
                    conn.sendall(json.dumps(resp).encode('utf-8') + b'\n')
                return
        resp = handle_request(synth_turn_module, req)
        with contextlib.suppress(Exception):
            conn.sendall(json.dumps(resp).encode('utf-8') + b'\n')
    finally:
        with contextlib.suppress(Exception):
            conn.close()


def _cleanup_endpoint_files() -> None:
    """Remove the advertised endpoint (socket path / port file). Called
    from the signal handler AND atexit — on Windows a TerminateProcess
    from the toolbar skips both, so clients also treat a connect-refused
    port file as 'daemon down' and boot overwrites it atomically."""
    with contextlib.suppress(Exception):
        SOCKET_PATH.unlink()
    with contextlib.suppress(Exception):
        PORT_FILE.unlink()


def _make_server_socket() -> tuple[socket.socket | None, str | None]:
    """Bind the platform transport. Returns (sock, token). token is None
    on the Unix-socket path (no in-band auth needed), a random hex string
    on TCP. Returns (None, None) on bind failure (already logged)."""
    transport = os.environ.get('TT_SYNTH_TRANSPORT') or (
        'tcp' if sys.platform == 'win32' else 'unix')

    if transport == 'unix':
        af_unix = getattr(socket, 'AF_UNIX', None)
        if af_unix is None:
            log.error('unix transport requested but AF_UNIX unavailable on this platform')
            return None, None
        # Stale-socket cleanup — previous run crashed and left the path.
        # bind() would fail with EADDRINUSE otherwise. Acceptable race here:
        # if another daemon is actually listening, our bind below fails and
        # we return non-zero.
        with contextlib.suppress(FileNotFoundError):
            SOCKET_PATH.unlink()
        SOCKET_PATH.parent.mkdir(parents=True, exist_ok=True)
        sock = socket.socket(af_unix, socket.SOCK_STREAM)
        try:
            sock.bind(str(SOCKET_PATH))
        except OSError as e:
            log.error(f'bind failed: {e}')
            return None, None
        os.chmod(SOCKET_PATH, 0o600)  # owner-only — synth runs as the user
        return sock, None

    # TCP loopback (Windows default). Ephemeral port; advertise via an
    # atomically-replaced port file so a half-written file is never read.
    # No SO_REUSEADDR on purpose — on Windows it permits port hijack.
    token = secrets.token_hex(16)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(('127.0.0.1', 0))
    except OSError as e:
        log.error(f'tcp bind failed: {e}')
        return None, None
    port = sock.getsockname()[1]
    try:
        PORT_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = PORT_FILE.with_name(PORT_FILE.name + '.tmp')
        tmp.write_text(
            json.dumps({'v': 1, 'port': port, 'token': token, 'pid': os.getpid()}),
            encoding='utf-8',
        )
        os.replace(tmp, PORT_FILE)
    except OSError as e:
        log.error(f'port file write failed: {e}')
        with contextlib.suppress(Exception):
            sock.close()
        return None, None
    return sock, token


def serve() -> int:
    """Bind the platform transport + accept loop. Returns 0 on clean
    shutdown, non-zero on bind failure."""
    # Flag BEFORE importing synth_turn: its transcript reader checks this
    # at call time to enable the daemon-only incremental parse cache.
    os.environ['TT_SYNTH_DAEMON'] = '1'

    sock, token = _make_server_socket()
    if sock is None:
        return 3

    atexit.register(_cleanup_endpoint_files)
    synth_turn_module = _import_synth_turn()

    sock.listen(8)
    endpoint = f'127.0.0.1:{sock.getsockname()[1]}' if token else str(SOCKET_PATH)
    log.info(f'listening on {endpoint} (pid={os.getpid()})')

    shutting_down = threading.Event()

    def _shutdown(_signum, _frame):
        if shutting_down.is_set():
            return
        shutting_down.set()
        log.info('shutdown signal received')
        with contextlib.suppress(Exception):
            sock.close()
        _cleanup_endpoint_files()

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
            args=(synth_turn_module, conn, token),
            daemon=True,
        ).start()
    return 0


if __name__ == '__main__':
    sys.exit(serve())
