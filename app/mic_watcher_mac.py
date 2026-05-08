"""macOS mic-watcher — emits MIC_CAPTURED / MIC_RELEASED on stdout.

Mirrors the contract of mic-watcher.ps1 (Windows). Long-running
process spawned by the toolbar's `createMicWatcher` factory; each
state change is one stdout line consumed by the parent.

Stdout protocol:
    MIC_CAPTURED <app>    — a non-self process started using the mic
    MIC_RELEASED          — the last non-self process stopped using it

Detection mechanism: CoreAudio HAL's process audio objects (macOS 14+).
We enumerate `kAudioHardwarePropertyProcessObjectList`, filter to those
with `kAudioProcessPropertyIsRunningInput=1`, get their PIDs via
`kAudioProcessPropertyPID`, and exclude:
  * our own PID
  * the wake-word listener (its python path is recorded at
    ~/.terminal-talk/listener-python-path.txt)
  * Apple system daemons that are always-on for "Hey Siri" etc.

If any non-excluded PID is running input, the mic is "captured
elsewhere" — pause TTS playback. When the last one drops, "released".

Initial-state emission at startup: we emit MIC_RELEASED so the parent
knows our baseline; if a foreign mic-user is already active at boot,
the next poll emits MIC_CAPTURED on top.

PyObjC quirk: `AudioObjectGetPropertyData`'s qualifierData arg
(`null_accepted=True`) breaks if you pass None — pass `b''` instead.
We hit this before; if you see "TypeError: converting to a C array",
that's the cause.
"""
from __future__ import annotations

import os
import struct
import subprocess
import sys
import time

try:
    from CoreAudio import (
        AudioObjectGetPropertyData,
        AudioObjectGetPropertyDataSize,
        AudioObjectPropertyAddress,
        kAudioHardwarePropertyProcessObjectList,
        kAudioObjectSystemObject,
        kAudioProcessPropertyIsRunningInput,
        kAudioProcessPropertyPID,
    )
except ImportError as e:
    sys.stderr.write(f'mic_watcher_mac: CoreAudio import failed: {e}\n')
    sys.exit(2)

# FourCC literals — not reliably exposed by name on every PyObjC build.
_SCOPE_GLOBAL = 0x676C6F62  # 'glob'
_ELEMENT_MAIN = 0

# Apple system daemons that hold the mic for system features (Siri,
# dictation pre-warm). They're always-running and shouldn't trip the
# "user is dictating" signal. Match against ps comm output.
_SYSTEM_DAEMON_NAMES = {
    'corespeechd',          # CoreSpeech / "Hey Siri" wake detection
    'speechrecognitiond',   # Voice Control / speech APIs
    'BiomeAgent',           # Apple Intelligence biome
    'mediaanalysisd',       # On-device media analysis
}

POLL_INTERVAL_SEC = 0.5


def _enum_process_audio_objects() -> list[int]:
    """Return AudioObjectID list of all process audio objects."""
    addr = AudioObjectPropertyAddress(
        kAudioHardwarePropertyProcessObjectList,
        _SCOPE_GLOBAL,
        _ELEMENT_MAIN,
    )
    err, size = AudioObjectGetPropertyDataSize(
        kAudioObjectSystemObject, addr, 0, None, None,
    )
    if err != 0 or size <= 0:
        return []
    n = size // 4  # AudioObjectID = UInt32
    err, _, data = AudioObjectGetPropertyData(
        kAudioObjectSystemObject, addr, 0, b'', size, None,
    )
    if err != 0 or not data:
        return []
    return list(struct.unpack(f'<{n}I', bytes(data)))


def _get_pid(proc_obj_id: int) -> int:
    """Return the OS PID for a process audio object, or -1 on failure."""
    addr = AudioObjectPropertyAddress(
        kAudioProcessPropertyPID, _SCOPE_GLOBAL, _ELEMENT_MAIN,
    )
    try:
        err, _, data = AudioObjectGetPropertyData(
            proc_obj_id, addr, 0, b'', 4, None,
        )
        if err != 0 or not data:
            return -1
        return struct.unpack('<i', bytes(data))[0]
    except Exception:
        return -1


def _is_running_input(proc_obj_id: int) -> bool:
    addr = AudioObjectPropertyAddress(
        kAudioProcessPropertyIsRunningInput, _SCOPE_GLOBAL, _ELEMENT_MAIN,
    )
    try:
        err, _, data = AudioObjectGetPropertyData(
            proc_obj_id, addr, 0, b'', 4, None,
        )
        if err != 0 or not data:
            return False
        return struct.unpack('<I', bytes(data))[0] != 0
    except Exception:
        return False


def _proc_comm(pid: int) -> str:
    """Return short process name (basename of executable). 'unknown' on failure."""
    try:
        out = subprocess.check_output(
            ['ps', '-p', str(pid), '-o', 'comm='],
            text=True, stderr=subprocess.DEVNULL, timeout=1.0,
        ).strip()
        return os.path.basename(out) if out else 'unknown'
    except Exception:
        return 'unknown'


def _self_pids() -> set[int]:
    """PIDs we should never count as 'mic captured elsewhere':
       our own PID + any python process running wake-word-listener.py.

       We match on the script name (not the python interpreter path) because
       venv-style installs symlink ~/.terminal-talk/.venv/bin/python to a
       framework python, and ps resolves the symlink when reporting the
       command line. Listener's `sys.executable` records the venv path but
       ps shows the framework path, so a path-prefix match fails.
       The script name `wake-word-listener.py` is unambiguous: anything
       running it IS our listener (or someone has cloned our repo, which
       is fine to self-exclude either way)."""
    pids = {os.getpid()}
    try:
        out = subprocess.check_output(
            ['ps', '-Ao', 'pid,command'],
            text=True, stderr=subprocess.DEVNULL, timeout=2.0,
        )
    except Exception:
        return pids
    for line in out.splitlines()[1:]:
        line = line.strip()
        if not line:
            continue
        parts = line.split(None, 1)
        if len(parts) < 2:
            continue
        try:
            pid = int(parts[0])
        except ValueError:
            continue
        cmd = parts[1]
        if 'wake-word-listener.py' in cmd:
            pids.add(pid)
    return pids


def _foreign_mic_users() -> dict[int, str]:
    """Return {pid: comm} for non-self processes currently using mic input.
    Excludes system daemons that always hold the mic."""
    self_pids = _self_pids()
    out = {}
    for obj_id in _enum_process_audio_objects():
        if not _is_running_input(obj_id):
            continue
        pid = _get_pid(obj_id)
        if pid <= 0 or pid in self_pids:
            continue
        comm = _proc_comm(pid)
        if comm in _SYSTEM_DAEMON_NAMES:
            continue
        out[pid] = comm
    return out


def main() -> int:
    sys.stderr.write(f'mic_watcher_mac: starting (pid={os.getpid()}, poll={POLL_INTERVAL_SEC}s)\n')
    # Initial baseline: emit RELEASED so parent knows our state.
    sys.stdout.write('MIC_RELEASED\n')
    sys.stdout.flush()
    prev: set[int] = set()
    while True:
        try:
            cur = _foreign_mic_users()
        except Exception as e:
            sys.stderr.write(f'mic_watcher_mac: poll error: {type(e).__name__}: {e}\n')
            time.sleep(POLL_INTERVAL_SEC * 2)
            continue
        cur_pids = set(cur.keys())
        if not prev and cur_pids:
            # Pick the first foreign user as the reported app name.
            first_pid = next(iter(cur_pids))
            app = cur[first_pid]
            sys.stdout.write(f'MIC_CAPTURED {app}\n')
            sys.stdout.flush()
        elif prev and not cur_pids:
            sys.stdout.write('MIC_RELEASED\n')
            sys.stdout.flush()
        prev = cur_pids
        time.sleep(POLL_INTERVAL_SEC)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
