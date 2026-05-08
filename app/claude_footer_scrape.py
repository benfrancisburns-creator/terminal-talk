"""Read Claude Code's literal "Cooked for Xm Ys" footer line off the
Terminal.app tab where the running claude CLI lives, on macOS.

Why this exists: the Windows port has app/lib/footer-watcher.js which
scrapes Windows Terminal's UIA buffer for the same line. POSIX has no
equivalent terminal-buffer scrape — until now this script. It mirrors
the Windows behaviour so Mac users hear EXACTLY the verb Claude printed
("Cooked for 49 seconds" not a random "Wizarded for 49 seconds" pulled
from the toolbar's own verb list). When this works the footer audio is
literally what's on screen; when it falls back (iTerm2 / Warp / non-
Terminal.app) the synth_turn.py format_elapsed_phrase verb-randomiser
takes over and the user gets *some* footer.

Resolution chain:
    claude_pid → /dev/ttys??? (via `ps -p PID -o tty=`)
    /dev/ttys??? → Terminal.app tab (via osascript: tty of t)
    tab → history (full scrollback as a single string)
    history → newest "<Verb> for <duration>" match

Returns the matched string verbatim (e.g. "Cooked for 49s") so the
caller can humanise via humanise_footer_phrase from synth_turn.

The helper is idempotent and short-lived (one scrape per call). It's
called from synth_turn.run() in on-stop mode just before the
format_elapsed_phrase fallback fires; failures are silent so a
missing Terminal.app or a non-Terminal-app terminal cleanly degrades
to the computed-elapsed path.
"""
from __future__ import annotations

import re
import subprocess
import sys


# Generous match: a capitalised word (incl. accented characters for
# "Sautéed" / "Brûléed" / "Pondéréd"-style variants) followed by " for "
# followed by an optional minutes group and a required seconds group.
# Mirrors humanise_footer_phrase's regex in synth_turn.py so anything
# that scraping finds will also parse there.
_FOOTER_RE = re.compile(
    r'\b([A-ZÀ-Ž][a-zà-ž]+)\s+for\s+(?:(\d+)m\s*)?(\d+)s\b'
)


def _tty_for_pid(pid: int) -> str:
    """Return /dev/ttysXXX for a given pid, or empty string."""
    if not pid or pid <= 0:
        return ''
    try:
        result = subprocess.run(
            ['ps', '-p', str(pid), '-o', 'tty='],
            capture_output=True, text=True, timeout=2,
        )
    except Exception:
        return ''
    name = result.stdout.strip()
    if not name or name == '?' or name == '??':
        return ''
    return f'/dev/{name}'


def _terminal_app_history(tty_path: str) -> str:
    """Ask Terminal.app for the scrollback history of the tab whose
    `tty` property matches `tty_path`. Returns the history string, or
    empty if no tab found (iTerm2, Warp, headless, etc.).

    AppleScript walks every window and every tab inside each window
    because Terminal.app's `selected tab of window 1` is whichever the
    user last clicked, NOT necessarily the one running claude. We
    can't trust focus state here.
    """
    if not tty_path:
        return ''
    script = (
        'set out to ""\n'
        'tell application "Terminal"\n'
        '  repeat with w in windows\n'
        '    repeat with t in tabs of w\n'
        '      try\n'
        f'        if tty of t is "{tty_path}" then\n'
        '          set out to history of t\n'
        '          exit repeat\n'
        '        end if\n'
        '      end try\n'
        '    end repeat\n'
        '    if out is not "" then exit repeat\n'
        '  end repeat\n'
        'end tell\n'
        'return out\n'
    )
    try:
        result = subprocess.run(
            ['osascript', '-e', script],
            capture_output=True, text=True, timeout=4,
        )
    except Exception:
        return ''
    return result.stdout or ''


def scrape_footer_for_claude_pid(claude_pid: int) -> str:
    """Top-level entry point. Returns the latest "<Verb> for <duration>"
    line from Terminal.app's scrollback for the tab running the given
    claude_pid. Empty string on any failure or no-match.

    Designed to be called from synth_turn.run() in on-stop mode just
    before format_elapsed_phrase fallback fires. Caller passes the
    result to humanise_footer_phrase to expand m/s abbreviations into
    natural spoken English.
    """
    if sys.platform != 'darwin':
        return ''
    tty = _tty_for_pid(claude_pid)
    if not tty:
        return ''
    history = _terminal_app_history(tty)
    if not history:
        return ''
    matches = list(_FOOTER_RE.finditer(history))
    if not matches:
        return ''
    # Newest match wins. Claude prints one footer per turn and they
    # accumulate in the scrollback in chronological order, so the
    # last match is the just-finished turn's footer.
    m = matches[-1]
    return m.group(0)


if __name__ == '__main__':
    pid = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    print(scrape_footer_for_claude_pid(pid))
