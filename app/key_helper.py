"""Long-lived helper process spawned by the Electron main.

Reads lines from stdin; executes commands; writes one response line per command.

Commands:
  ctrlc                 Send Ctrl+C to the foreground window.
  fgtree                Return JSON { fg_pid, descendants } -- the foreground
                        window's process ID plus every descendant PID in its
                        process tree. Used by speakClipboard to map hey-jarvis
                        to the currently-focused Claude Code session.
  exit                  Terminate the helper.

Replies "ok" / "err <reason>" / the JSON payload for fgtree.
"""
import sys
import json
import ctypes
from ctypes import wintypes

_u32 = ctypes.windll.user32
_k32 = ctypes.windll.kernel32

_VK_CONTROL = 0x11
_VK_C = 0x43
_KEYUP = 0x0002


def ctrlc():
    _u32.keybd_event(_VK_CONTROL, 0, 0, 0)
    _u32.keybd_event(_VK_C, 0, 0, 0)
    _u32.keybd_event(_VK_C, 0, _KEYUP, 0)
    _u32.keybd_event(_VK_CONTROL, 0, _KEYUP, 0)


# --- Process tree snapshot via CreateToolhelp32Snapshot ---
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


def get_foreground_pid() -> int:
    hwnd = _u32.GetForegroundWindow()
    if not hwnd:
        return 0
    pid = wintypes.DWORD()
    _u32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return int(pid.value)


def get_process_tree() -> dict:
    """Return { parent_pid: [child_pid, ...] } for all processes."""
    snapshot = _k32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snapshot == -1:
        return {}
    entry = PROCESSENTRY32()
    entry.dwSize = ctypes.sizeof(PROCESSENTRY32)
    tree: dict[int, list[int]] = {}
    try:
        if _k32.Process32First(snapshot, ctypes.byref(entry)):
            while True:
                tree.setdefault(int(entry.th32ParentProcessID), []).append(int(entry.th32ProcessID))
                if not _k32.Process32Next(snapshot, ctypes.byref(entry)):
                    break
    finally:
        _k32.CloseHandle(snapshot)
    return tree


def descendants_of(root_pid: int) -> list[int]:
    tree = get_process_tree()
    out: list[int] = []
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


def main():
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass
    for raw in sys.stdin:
        cmd = raw.strip().lower()
        if not cmd:
            continue
        try:
            if cmd == 'ctrlc':
                ctrlc()
                sys.stdout.write('ok\n')
            elif cmd == 'fgtree':
                sys.stdout.write(fgtree_payload() + '\n')
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
