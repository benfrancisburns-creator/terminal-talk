"""Windows low-level push-to-talk hook for Terminal Talk dictation."""
from __future__ import annotations

import argparse
import ctypes
import sys
from ctypes import wintypes


KEYS = {
    "CONTROL": 0x11, "CTRL": 0x11, "SHIFT": 0x10, "ALT": 0x12,
    "OPTION": 0x12, "WIN": 0x5B, "WINDOWS": 0x5B, "SUPER": 0x5B,
    "SPACE": 0x20, "TAB": 0x09, "ENTER": 0x0D, "RETURN": 0x0D,
    "ESC": 0x1B, "ESCAPE": 0x1B, "BACKSPACE": 0x08, "DELETE": 0x2E,
    "INSERT": 0x2D, "HOME": 0x24, "END": 0x23, "PAGEUP": 0x21,
    "PAGEDOWN": 0x22, "UP": 0x26, "DOWN": 0x28, "LEFT": 0x25,
    "RIGHT": 0x27,
}
KEYS.update({chr(c): c for c in range(ord("A"), ord("Z") + 1)})
KEYS.update({str(i): 0x30 + i for i in range(10)})
KEYS.update({f"F{i}": 0x6F + i for i in range(1, 25)})
NORMALIZE_VK = {
    0xA0: 0x10, 0xA1: 0x10,  # left/right shift
    0xA2: 0x11, 0xA3: 0x11,  # left/right ctrl
    0xA4: 0x12, 0xA5: 0x12,  # left/right alt/menu
    0x5B: 0x5B, 0x5C: 0x5B,  # left/right Windows
}


def parse_accelerator(value: str) -> frozenset[int]:
    keys: set[int] = set()
    for part in value.split("+"):
        key = part.strip().replace(" ", "").upper()
        if key in ("COMMANDORCONTROL", "CMDORCTRL"):
            key = "CONTROL"
        if key not in KEYS:
            raise SystemExit(f"Unsupported hotkey part: {part}")
        keys.add(KEYS[key])
    if not keys:
        raise SystemExit("No hotkey keys parsed.")
    return frozenset(keys)


def emit(line: str) -> None:
    print(line, flush=True)


def main() -> int:
    if sys.platform != "win32":
        raise SystemExit("dictation-hotkey-hook is Windows-only")

    parser = argparse.ArgumentParser()
    parser.add_argument("--accelerator", required=True)
    args = parser.parse_args()
    chord = parse_accelerator(args.accelerator)

    user32 = ctypes.windll.user32

    WH_KEYBOARD_LL = 13
    HC_ACTION = 0
    WM_KEYDOWN = 0x0100
    WM_KEYUP = 0x0101
    WM_SYSKEYDOWN = 0x0104
    WM_SYSKEYUP = 0x0105

    class KBDLLHOOKSTRUCT(ctypes.Structure):
        _fields_ = [
            ("vkCode", wintypes.DWORD),
            ("scanCode", wintypes.DWORD),
            ("flags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("dwExtraInfo", ctypes.c_void_p),
        ]

    HOOKPROC = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)
    user32.SetWindowsHookExW.argtypes = [ctypes.c_int, HOOKPROC, wintypes.HINSTANCE, wintypes.DWORD]
    user32.SetWindowsHookExW.restype = wintypes.HHOOK
    user32.CallNextHookEx.argtypes = [wintypes.HHOOK, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM]
    user32.CallNextHookEx.restype = ctypes.c_long
    user32.UnhookWindowsHookEx.argtypes = [wintypes.HHOOK]
    user32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT]
    user32.GetMessageW.restype = wintypes.BOOL

    pressed: set[int] = set()
    suppressed_down: set[int] = set()
    active = False
    hook = None

    def callback(n_code, w_param, l_param):
        nonlocal active
        if n_code != HC_ACTION:
            return user32.CallNextHookEx(hook, n_code, w_param, l_param)

        raw_vk = int(ctypes.cast(l_param, ctypes.POINTER(KBDLLHOOKSTRUCT)).contents.vkCode)
        vk = NORMALIZE_VK.get(raw_vk, raw_vk)
        is_down = int(w_param) in (WM_KEYDOWN, WM_SYSKEYDOWN)
        is_up = int(w_param) in (WM_KEYUP, WM_SYSKEYUP)

        if is_down:
            pressed.add(vk)
            if not active and chord.issubset(pressed):
                active = True
                suppressed_down.add(vk)
                emit("DICTATE_START")
                return 1
            if active and vk in chord:
                suppressed_down.add(vk)
                return 1
        elif is_up:
            was_active = active
            if vk in pressed:
                pressed.remove(vk)
            if was_active and vk in chord and not chord.issubset(pressed):
                active = False
                emit("DICTATE_STOP")
            if was_active and vk in suppressed_down:
                suppressed_down.discard(vk)
                return 1

        return user32.CallNextHookEx(hook, n_code, w_param, l_param)

    callback_ref = HOOKPROC(callback)
    hook = user32.SetWindowsHookExW(WH_KEYBOARD_LL, callback_ref, None, 0)
    if not hook:
        raise ctypes.WinError()

    emit("DICTATE_HOOK_READY")
    msg = wintypes.MSG()
    try:
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) != 0:
            pass
    finally:
        user32.UnhookWindowsHookEx(hook)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
