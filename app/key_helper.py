"""Long-lived helper process spawned by the Electron main.

Reads lines from stdin; executes commands; writes one response line per command.

Commands:
  ctrlc                 Send Ctrl+C to the foreground window.
  fgtree                Return JSON { fg_pid, descendants } -- the foreground
                        window's process ID plus every descendant PID in its
                        process tree. Used by speakClipboard to map hey-jarvis
                        to the currently-focused Claude Code session.
  fgtree-bump           Invalidate the process-tree cache, force a fresh
                        snapshot on the next fgtree.
  exit                  Terminate the helper.

Replies "ok" / "err <reason>" / the JSON payload for fgtree.

S2.2: SendInput replaces keybd_event (more reliable under UAC / DPI-scaling
edge cases); process-tree snapshots cached for 500 ms so back-to-back fgtree
calls during one captureSelection don't rebuild the whole snapshot; every
command received is logged to `~/.terminal-talk/queue/_helper.log` for
forensic replay (command + ts only, no output payloads).
"""
from __future__ import annotations

import contextlib
import ctypes
import ctypes.wintypes as wintypes
import json
import sys
import time
from pathlib import Path

_u32 = ctypes.windll.user32
_k32 = ctypes.windll.kernel32

_VK_CONTROL = 0x11
_VK_C = 0x43
_KEYEVENTF_KEYUP = 0x0002
_INPUT_KEYBOARD = 1


# ---------------------------------------------------------------------------
# SendInput replacement for keybd_event (S2.2).
# keybd_event is marked "superseded by SendInput" in the Windows API docs
# since Vista; under UAC-elevated targets or some DPI-scaled contexts the
# key can be silently dropped. SendInput uses a single kernel transition
# per struct array and is the documented modern path.
# ---------------------------------------------------------------------------

class _KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ('wVk', wintypes.WORD),
        ('wScan', wintypes.WORD),
        ('dwFlags', wintypes.DWORD),
        ('time', wintypes.DWORD),
        ('dwExtraInfo', ctypes.POINTER(wintypes.ULONG)),
    ]


class _INPUT_UNION(ctypes.Union):
    _fields_ = [
        ('ki', _KEYBDINPUT),
        # Padding to the size of the larger MOUSEINPUT / HARDWAREINPUT
        # variants so a future Windows update that enlarges one of those
        # doesn't shift our field offsets. ctypes picks max automatically,
        # explicit padding here documents the constraint.
        ('_pad', ctypes.c_byte * 32),
    ]


class _INPUT(ctypes.Structure):
    _anonymous_ = ('u',)
    _fields_ = [
        ('type', wintypes.DWORD),
        ('u', _INPUT_UNION),
    ]


_SendInput = _u32.SendInput
_SendInput.argtypes = (wintypes.UINT, ctypes.POINTER(_INPUT), ctypes.c_int)
_SendInput.restype = wintypes.UINT


def _press(vk: int, up: bool) -> _INPUT:
    ev = _INPUT()
    ev.type = _INPUT_KEYBOARD
    ev.ki.wVk = vk
    ev.ki.wScan = 0
    ev.ki.dwFlags = _KEYEVENTF_KEYUP if up else 0
    ev.ki.time = 0
    ev.ki.dwExtraInfo = None
    return ev


def ctrlc() -> None:
    """Send Ctrl-down, C-down, C-up, Ctrl-up as one SendInput call.
    Atomic in-kernel so no other input event can interleave between the
    four virtual-key transitions."""
    events = (_INPUT * 4)(
        _press(_VK_CONTROL, False),
        _press(_VK_C, False),
        _press(_VK_C, True),
        _press(_VK_CONTROL, True),
    )
    n = _SendInput(4, events, ctypes.sizeof(_INPUT))
    if n != 4:
        # SendInput returns the number of events successfully inserted
        # into the input stream; anything less is UIPI / other-session
        # blocked. Raise so the caller logs `err`.
        raise RuntimeError(f'SendInput inserted {n}/4 events')


# ---------------------------------------------------------------------------
# Process-tree snapshot via CreateToolhelp32Snapshot, with a 500 ms cache.
# A single captureSelection cycle typically fires fgtree 1-3 times back to
# back; without the cache each call re-walks every process on the box.
# 500 ms is short enough that "which window is in the foreground" answers
# don't go stale on real user input; long enough to batch the burst.
# ---------------------------------------------------------------------------
TH32CS_SNAPPROCESS = 0x00000002

class PROCESSENTRY32(ctypes.Structure):
    _fields_ = [
        ('dwSize', wintypes.DWORD),
        ('cntUsage', wintypes.DWORD),
        ('th32ProcessID', wintypes.DWORD),
        ('th32DefaultHeapID', ctypes.c_void_p),
        ('th32ModuleID', wintypes.DWORD),
        ('cntThreads', wintypes.DWORD),
        ('th32ParentProcessID', wintypes.DWORD),
        ('pcPriClassBase', ctypes.c_long),
        ('dwFlags', wintypes.DWORD),
        ('szExeFile', ctypes.c_char * 260),
    ]


_PROC_CACHE_TTL_SEC = 0.5
_proc_cache: dict | None = None
_proc_cache_at: float = 0.0


def _snapshot_process_tree() -> dict:
    """Walk every process and build a { parent_pid: [child_pid, ...] } map."""
    snapshot = _k32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snapshot == -1:
        return {}
    entry = PROCESSENTRY32()
    entry.dwSize = ctypes.sizeof(PROCESSENTRY32)
    tree: dict = {}
    try:
        if _k32.Process32First(snapshot, ctypes.byref(entry)):
            while True:
                tree.setdefault(int(entry.th32ParentProcessID), []).append(int(entry.th32ProcessID))
                if not _k32.Process32Next(snapshot, ctypes.byref(entry)):
                    break
    finally:
        _k32.CloseHandle(snapshot)
    return tree


def get_process_tree() -> dict:
    """Return the cached process tree if fresh, else take a new snapshot."""
    global _proc_cache, _proc_cache_at
    now = time.monotonic()
    if _proc_cache is not None and (now - _proc_cache_at) < _PROC_CACHE_TTL_SEC:
        return _proc_cache
    _proc_cache = _snapshot_process_tree()
    _proc_cache_at = now
    return _proc_cache


def invalidate_proc_cache() -> None:
    """Force the next get_process_tree() to re-snapshot. Used when the
    caller has just spawned a child and knows the cached tree is stale."""
    global _proc_cache, _proc_cache_at
    _proc_cache = None
    _proc_cache_at = 0.0


def get_foreground_pid() -> int:
    hwnd = _u32.GetForegroundWindow()
    if not hwnd:
        return 0
    pid = wintypes.DWORD()
    _u32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return int(pid.value)


def descendants_of(root_pid: int) -> list:
    tree = get_process_tree()
    out: list = []
    stack = [root_pid]
    seen = set()
    while stack:
        p = stack.pop()
        for child in tree.get(p, []):
            if child in seen:
                continue
            seen.add(child)
            out.append(child)
            stack.append(child)
    return out


def fgtree_payload() -> str:
    fg = get_foreground_pid()
    desc = descendants_of(fg) if fg else []
    return json.dumps({'fg_pid': fg, 'descendants': desc})


# ---------------------------------------------------------------------------
# Per-command log (_helper.log). Audit §18 wanted a forensic trail showing
# what the parent asked this helper to do. We log COMMAND NAME + timestamp
# only -- not the reply payload -- because fgtree replies include PIDs
# that trace user activity and shouldn't sit in a plain-text log.
# Best-effort: a write failure must NOT abort the command.
# ---------------------------------------------------------------------------
_LOG_PATH = Path.home() / '.terminal-talk' / 'queue' / '_helper.log'


def _log_cmd(cmd: str) -> None:
    try:
        _LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        ts = time.strftime('%Y-%m-%dT%H:%M:%S', time.localtime())
        with open(_LOG_PATH, 'a', encoding='utf-8') as fh:
            fh.write(f'{ts} {cmd}\n')
    except Exception:
        pass  # diagnostic log is best-effort — missing log must never crash helper


def main() -> int:
    with contextlib.suppress(Exception):
        sys.stdout.reconfigure(line_buffering=True)
    for raw in sys.stdin:
        cmd = raw.strip().lower()
        if not cmd:
            continue
        _log_cmd(cmd)
        try:
            if cmd == 'ctrlc':
                ctrlc()
                sys.stdout.write('ok\n')
            elif cmd == 'fgtree':
                sys.stdout.write(fgtree_payload() + '\n')
            elif cmd == 'fgtree-bump':
                invalidate_proc_cache()
                sys.stdout.write('ok\n')
            elif cmd == 'exit':
                return 0
            else:
                sys.stdout.write(f'err unknown: {cmd}\n')
            sys.stdout.flush()
        except Exception as e:
            sys.stdout.write(f'err {type(e).__name__}: {e}\n')
            sys.stdout.flush()
    return 0


if __name__ == '__main__':
    sys.exit(main())
