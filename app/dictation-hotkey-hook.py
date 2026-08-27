"""Low-level push-to-talk hook for Terminal Talk dictation.

Windows uses a WH_KEYBOARD_LL hook. macOS uses a Quartz event tap so
Ctrl+Alt+Space can stop recording as soon as the user releases the chord.
"""
from __future__ import annotations

import argparse
import ctypes
import ctypes.wintypes as wintypes
import sys

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
MODIFIER_NAMES = {"CONTROL", "CTRL", "SHIFT", "ALT", "OPTION", "WIN", "WINDOWS", "SUPER", "COMMAND", "CMD"}
DARWIN_KEY_CODES = {
    "A": 0, "S": 1, "D": 2, "F": 3, "H": 4, "G": 5, "Z": 6, "X": 7,
    "C": 8, "V": 9, "B": 11, "Q": 12, "W": 13, "E": 14, "R": 15,
    "Y": 16, "T": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22,
    "5": 23, "9": 25, "7": 26, "8": 28, "0": 29, "O": 31, "U": 32,
    "I": 34, "P": 35, "L": 37, "J": 38, "K": 40, "N": 45, "M": 46,
    "TAB": 48, "SPACE": 49, "ENTER": 36, "RETURN": 36, "ESC": 53, "ESCAPE": 53,
    "BACKSPACE": 51, "DELETE": 117, "HOME": 115, "END": 119, "PAGEUP": 116,
    "PAGEDOWN": 121, "LEFT": 123, "RIGHT": 124, "DOWN": 125, "UP": 126,
}
DARWIN_KEY_CODES.update({
    "F1": 122, "F2": 120, "F3": 99, "F4": 118, "F5": 96, "F6": 97,
    "F7": 98, "F8": 100, "F9": 101, "F10": 109, "F11": 103, "F12": 111,
})


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


def parse_accelerator_names(value: str) -> tuple[frozenset[str], str]:
    modifiers: set[str] = set()
    normal_key = ""
    for part in value.split("+"):
        key = part.strip().replace(" ", "").upper()
        if key in ("COMMANDORCONTROL", "CMDORCTRL"):
            key = "CONTROL"
        if key == "OPTION":
            key = "ALT"
        if key == "CMD":
            key = "COMMAND"
        if key in MODIFIER_NAMES:
            modifiers.add(key)
            continue
        if normal_key:
            raise SystemExit(f"Only one non-modifier key is supported on macOS: {value}")
        normal_key = key
    if not normal_key:
        raise SystemExit(f"macOS dictation hotkey needs one non-modifier key: {value}")
    if normal_key not in DARWIN_KEY_CODES:
        raise SystemExit(f"Unsupported macOS hotkey key: {normal_key}")
    return frozenset(modifiers), normal_key


def emit(line: str) -> None:
    print(line, flush=True)


def main_windows(accelerator: str) -> int:
    chord = parse_accelerator(accelerator)

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


def main_darwin(accelerator: str) -> int:
    try:
        import CoreFoundation
        import Quartz
    except ImportError as exc:
        raise SystemExit("Missing PyObjC Quartz/CoreFoundation packages for macOS dictation hotkey hook.") from exc

    modifiers, normal_key = parse_accelerator_names(accelerator)
    target_key_code = DARWIN_KEY_CODES[normal_key]
    required_flags = 0
    if "CONTROL" in modifiers or "CTRL" in modifiers:
        required_flags |= Quartz.kCGEventFlagMaskControl
    if "SHIFT" in modifiers:
        required_flags |= Quartz.kCGEventFlagMaskShift
    if "ALT" in modifiers or "OPTION" in modifiers:
        required_flags |= Quartz.kCGEventFlagMaskAlternate
    if "COMMAND" in modifiers or "CMD" in modifiers:
        required_flags |= Quartz.kCGEventFlagMaskCommand

    active = False

    def has_required_flags(event) -> bool:
        flags = Quartz.CGEventGetFlags(event)
        return (flags & required_flags) == required_flags

    def callback(proxy, event_type, event, refcon):
        del proxy, refcon
        nonlocal active
        if event_type == Quartz.kCGEventTapDisabledByTimeout:
            Quartz.CGEventTapEnable(tap, True)
            return event
        if event_type == Quartz.kCGEventFlagsChanged:
            if active and not has_required_flags(event):
                active = False
                emit("DICTATE_STOP")
                return None
            return event
        if event_type not in (Quartz.kCGEventKeyDown, Quartz.kCGEventKeyUp):
            return event
        key_code = Quartz.CGEventGetIntegerValueField(event, Quartz.kCGKeyboardEventKeycode)
        if key_code != target_key_code:
            return event
        if event_type == Quartz.kCGEventKeyDown and has_required_flags(event):
            if not active:
                active = True
                emit("DICTATE_START")
            return None
        if event_type == Quartz.kCGEventKeyUp and active:
            active = False
            emit("DICTATE_STOP")
            return None
        return event

    mask = (
        (1 << Quartz.kCGEventKeyDown)
        | (1 << Quartz.kCGEventKeyUp)
        | (1 << Quartz.kCGEventFlagsChanged)
        | (1 << Quartz.kCGEventTapDisabledByTimeout)
    )
    tap = Quartz.CGEventTapCreate(
        Quartz.kCGSessionEventTap,
        Quartz.kCGHeadInsertEventTap,
        Quartz.kCGEventTapOptionDefault,
        mask,
        callback,
        None,
    )
    if not tap:
        raise SystemExit("Could not create macOS dictation event tap. Grant Terminal Talk Accessibility permission.")
    run_loop_source = Quartz.CFMachPortCreateRunLoopSource(None, tap, 0)
    CoreFoundation.CFRunLoopAddSource(
        CoreFoundation.CFRunLoopGetCurrent(),
        run_loop_source,
        CoreFoundation.kCFRunLoopCommonModes,
    )
    Quartz.CGEventTapEnable(tap, True)
    emit("DICTATE_HOOK_READY")
    CoreFoundation.CFRunLoopRun()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--accelerator", required=True)
    args = parser.parse_args()
    if sys.platform == "win32":
        return main_windows(args.accelerator)
    if sys.platform == "darwin":
        return main_darwin(args.accelerator)
    raise SystemExit("dictation-hotkey-hook is only supported on Windows and macOS")


if __name__ == "__main__":
    raise SystemExit(main())
