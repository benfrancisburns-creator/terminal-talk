"""Terminal Talk statusline for Claude Code on POSIX.

Reads a session-context JSON payload from stdin, looks the session up
in `~/.terminal-talk/session-colours.json`, and emits an ANSI-coloured
glyph + (optional) label that Claude Code displays at the bottom of the
terminal. The glyph maps to the same palette index the toolbar's queue
dot uses, so what you see in the terminal matches what you see in the
toolbar.

Mirrors `app/statusline.ps1` (the Windows PowerShell version) — same
input contract, same output shape, same palette source (`app/lib/
tokens.json`). Kept as a separate file rather than wrapping the .ps1
because Claude Code's `statusLine.command` config takes one value per
platform; on POSIX it points here.

Output format (matches statusline.ps1::Get-StatuslineGlyph + label
suffix logic):
    [⭐ ][🔇 ]<glyph>[ <label>]
where <glyph> is:
    solid  (idx 0-7)  : ● with 24-bit fg
    hsplit (idx 8-15) : ▀ with fg/bg pair (top/bottom split)
    vsplit (idx 16-23): ▌ with fg/bg pair (left/right split)
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ESC = '\x1b'
SHORT_RE = re.compile(r'^[a-f0-9]{8}$')

# Fallback palette mirrors statusline.ps1's `$fallback` block — used
# when tokens.json can't be read (e.g. file missing in a partial
# install). Keep in lock-step with the PS side.
_FALLBACK = {
    'PALETTE_SIZE': 24,
    'BASE_COLOURS': [
        'ff5e5e', 'ffa726', 'ffd93d', '4ade80',
        '60a5fa', 'ee2bbd', 'c97b50', 'e0e0e0',
    ],
    'HSPLIT_PARTNER': [3, 4, 5, 0, 1, 2, 7, 6],
    'VSPLIT_PARTNER': [4, 5, 6, 7, 0, 1, 2, 3],
}


def _tt_home() -> Path:
    env = os.environ.get('TT_HOME')
    if env:
        return Path(env)
    if sys.platform.startswith('linux'):
        state = os.environ.get('XDG_STATE_HOME') or str(Path.home() / '.local' / 'state')
        return Path(state) / 'terminal-talk'
    return Path.home() / '.terminal-talk'


def _app_dir() -> Path:
    env = os.environ.get('TT_APP_DIR')
    if env:
        return Path(env)
    return Path(__file__).resolve().parent


def _read_palette() -> dict:
    path = _app_dir() / 'lib' / 'tokens.json'
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        palette = data.get('palette') or {}
        base = [str(c).strip().lstrip('#') for c in palette.get('BASE_COLOURS') or []]
        hsplit = [int(x) for x in palette.get('HSPLIT_PARTNER') or []]
        vsplit = [int(x) for x in palette.get('VSPLIT_PARTNER') or []]
        size = int(palette.get('PALETTE_SIZE') or 0)
        if len(base) >= 8 and len(hsplit) >= 8 and len(vsplit) >= 8 and size >= 24:
            return {
                'PALETTE_SIZE': size,
                'BASE_COLOURS': base,
                'HSPLIT_PARTNER': hsplit,
                'VSPLIT_PARTNER': vsplit,
            }
    except Exception:
        pass  # Invalid user palette data falls back to the shipped palette.
    return _FALLBACK


def _hex_to_rgb(hex_str: str) -> str:
    h = (hex_str or '').strip().lstrip('#')
    if not re.match(r'^[a-fA-F0-9]{6}$', h):
        h = '8a8a8a'
    return f'{int(h[0:2], 16)};{int(h[2:4], 16)};{int(h[4:6], 16)}'


def _glyph(idx: int, palette: dict) -> str:
    """24-bit ANSI-coloured glyph for a palette slot. Matches
    statusline.ps1::Get-StatuslineGlyph byte-for-byte."""
    size = int(palette['PALETTE_SIZE'])
    i = idx % size if size > 0 else 0
    if i < 0:
        i += size
    base = palette['BASE_COLOURS']
    if i < 8:
        rgb = _hex_to_rgb(base[i])
        return f'{ESC}[38;2;{rgb}m●{ESC}[0m'
    if i < 16:
        p = i - 8
        s = palette['HSPLIT_PARTNER'][p]
        fg = _hex_to_rgb(base[p])
        bg = _hex_to_rgb(base[s])
        return f'{ESC}[38;2;{fg};48;2;{bg}m▀{ESC}[0m'
    p = i - 16
    s = palette['VSPLIT_PARTNER'][p]
    fg = _hex_to_rgb(base[p])
    bg = _hex_to_rgb(base[s])
    return f'{ESC}[38;2;{fg};48;2;{bg}m▌{ESC}[0m'


def _read_registry(tt_home: Path) -> dict:
    path = os.environ.get('TT_REGISTRY_PATH') or str(tt_home / 'session-colours.json')
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except Exception:
        return {}


def _hash_index(short: str, size: int) -> int:
    """Deterministic fallback when the session has no registry entry yet
    — picks a palette index from a sum of char codes. Mirrors the
    PowerShell `$sum` fallback so a not-yet-registered session shows
    *some* colour rather than a bare glyph."""
    return sum(ord(c) for c in short) % (size or 24)


def main() -> int:
    raw = sys.stdin.read()
    if not raw:
        print('')
        return 0
    try:
        payload = json.loads(raw)
    except Exception:
        print('')
        return 0
    session_id = str(payload.get('session_id') or '')
    if not session_id:
        print('')
        return 0
    short = session_id[:8].lower()
    if not SHORT_RE.match(short):
        print('')
        return 0

    tt_home = _tt_home()
    palette = _read_palette()
    registry = _read_registry(tt_home)
    assignments = registry.get('assignments') or {}
    entry = assignments.get(short) or {}

    if isinstance(entry.get('index'), int):
        idx = int(entry['index'])
    else:
        idx = _hash_index(short, int(palette.get('PALETTE_SIZE') or 24))

    glyph = _glyph(idx, palette)
    label = str(entry.get('label') or '').strip()

    # Prefixes mirror statusline.ps1: focus first (⭐), then muted (🔇),
    # then the colour glyph. Both flags can co-occur (focused-but-muted
    # is a valid state — clip stays at the front of the queue but plays
    # silently).
    parts = []
    if entry.get('focus'):
        parts.append('⭐ ')
    if entry.get('muted'):
        parts.append('🔇 ')
    parts.append(glyph)
    if label:
        parts.append(f' {label}')
    sys.stdout.write(''.join(parts))
    sys.stdout.write('\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
