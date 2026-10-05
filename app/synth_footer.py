"""End-of-turn footer audio computation for POSIX (macOS / Linux).

Windows handles the footer via app/lib/footer-watcher.js — it scrapes
Claude Code's literal "Cooked for Xm Ys" line off the Windows Terminal
buffer via UIA. This module is the POSIX equivalent. Two-tier strategy:

    1. macOS Terminal.app + iTerm2: claude_footer_scrape.py reads the
       running tab's scrollback via AppleScript and returns Claude's
       literal footer line. Same UX as Windows — the spoken verb +
       duration matches exactly what's printed on screen.
    2. Fallback (Warp / WezTerm / SSH session / scrape miss / Linux):
       compute the elapsed from JSONL entry timestamps, synthesise
       format_elapsed_phrase. Verb is randomised, the number is
       still correct.

Used by synth_turn.run() in on-stop mode. Extracted from synth_turn.py
during Phase 0 of the v0.7 housekeeping pass to keep that file under
the 2725-line absolute ceiling and bring the run() function's
cyclomatic complexity back below the ruff C901 threshold (33).
"""
from __future__ import annotations

import json
import random as _random_module
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# Past-tense spinner verbs mirroring Claude Code's own terminal footer
# ("Cooked for 49s", "Sautéed for 1m 0s"). Present-continuous forms live
# in app/lib/heartbeat.js SPINNER_VERBS; this is the past-tense render
# so the end-of-response clip sounds natural ("Simmered for 2 minutes"
# not "Simmering for 2 minutes"). Sautéed explicitly included because
# the terminal uses it and it's what Ben pointed at in the transcript.
# Irregulars (Thinking → Thought, Doing → Done, Spinning → Spun) use
# their standard past forms.
PAST_TENSE_VERBS = (
    'Accomplished', 'Actioned', 'Actualised', 'Baked', 'Booped', 'Brewed',
    'Calculated', 'Cerebrated', 'Channelled', 'Churned', 'Clauded', 'Coalesced',
    'Cogitated', 'Combobulated', 'Computed', 'Concocted', 'Conjured', 'Considered',
    'Contemplated', 'Cooked', 'Crafted', 'Created', 'Crunched', 'Deciphered',
    'Deliberated', 'Determined', 'Discombobulated', 'Divined', 'Effected',
    'Elucidated', 'Enchanted', 'Envisioned', 'Finagled', 'Flibbertigibbeted',
    'Forged', 'Formed', 'Frolicked', 'Generated', 'Germinated', 'Hatched',
    'Herded', 'Honked', 'Hustled', 'Ideated', 'Imagined', 'Incubated',
    'Inferred', 'Jived', 'Manifested', 'Marinated', 'Meandered', 'Moonwalked',
    'Moseyed', 'Mulled', 'Mustered', 'Mused', 'Noodled', 'Percolated',
    'Perused', 'Philosophised', 'Pontificated', 'Pondered', 'Processed',
    'Puttered', 'Puzzled', 'Reticulated', 'Ruminated', 'Sautéed', 'Schemed',
    'Schlepped', 'Shimmied', 'Shucked', 'Simmered', 'Smooshed', 'Spelunked',
    'Spun', 'Stewed', 'Sussed', 'Synthesised', 'Thought', 'Tinkered',
    'Transmuted', 'Unfurled', 'Unravelled', 'Vibed', 'Wandered', 'Whirred',
    'Wibbled', 'Wizarded', 'Worked', 'Wrangled',
)


# Footer line printed by Claude Code looks like "Cooked for 49s" or
# "Sautéed for 1m 23s". Tightened to match what humanise_footer_phrase
# expects so the scrape result and the parser stay in lock-step.
_FOOTER_PARSE_RE = re.compile(
    r'^([A-Za-zÀ-ſ]+)\s+for\s+(?:(\d+)m\s*)?(\d+)s\s*$'
)
_SCRAPE_PARSE_RE = re.compile(
    r'^([A-ZÀ-Ž][a-zà-ž]+)\s+for\s+(?:(\d+)m\s*)?(\d+)s\s*$'
)
_TIMESTAMP_RE = re.compile(
    r'^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z?$'
)


def _parse_timestamp(value) -> float:
    """Parse a Claude Code JSONL ISO-8601 UTC timestamp to epoch seconds.

    Accepts strings like '2026-05-04T13:38:06.064Z' (the format Claude
    Code writes). Returns 0.0 on any parse failure so callers can fall
    back gracefully.
    """
    if not isinstance(value, str):
        return 0.0
    m = _TIMESTAMP_RE.match(value.strip())
    if not m:
        return 0.0
    try:
        y, mo, d, h, mi, s = (int(m.group(i)) for i in range(1, 7))
        frac = m.group(7)
        micro = int((frac + '000000')[:6]) if frac else 0
        dt = datetime(y, mo, d, h, mi, s, micro, tzinfo=timezone.utc)
        return dt.timestamp()
    except Exception:
        return 0.0


def elapsed_from_transcript(entries: list, user_idx: int) -> int:
    """Compute elapsed seconds from JSONL: last_user_prompt → last_assistant.

    user_idx is the index of the most recent USER PROMPT (already filtered
    against tool_result entries by find_last_user_idx). The last assistant
    timestamp is the latest 'assistant' entry after that index. Returns 0
    if either timestamp is unreadable, so callers fall back to their own
    elapsed measurement.
    """
    if user_idx is None or user_idx < 0 or user_idx >= len(entries):
        return 0
    user_ts = _parse_timestamp((entries[user_idx] or {}).get('timestamp'))
    if user_ts <= 0:
        return 0
    last_assistant_ts = 0.0
    for i in range(len(entries) - 1, user_idx, -1):
        e = entries[i] or {}
        if e.get('type') != 'assistant':
            continue
        ts = _parse_timestamp(e.get('timestamp'))
        if ts > last_assistant_ts:
            last_assistant_ts = ts
            break
    if last_assistant_ts <= 0:
        return 0
    delta = last_assistant_ts - user_ts
    if delta < 1:
        return 0
    return int(round(delta))


def humanise_footer_phrase(footer: str) -> str:
    """Expand a scraped Claude Code footer into natural spoken English.

    Claude Code prints e.g. 'Crunched for 6m 39s' to the terminal. Edge-TTS
    pronounces 'm' as "em" and 's' as "ess" — gibberish. This expands the
    abbreviation in place while keeping the actual verb Claude Code chose,
    so the audio clip says exactly what's on screen but spoken naturally.

    Returns the original string unchanged if the format isn't recognised.

        'Crunched for 6m 39s' → 'Crunched for 6 minutes and 39 seconds'
        'Cooked for 49s'      → 'Cooked for 49 seconds'
        'Brewed for 1m'       → 'Brewed for 1 minute'
        'Brewed for 1m 1s'    → 'Brewed for 1 minute and 1 second'
    """
    if not footer:
        return ''
    m = _FOOTER_PARSE_RE.match(footer.strip())
    if not m:
        return footer.strip()
    verb = m.group(1)
    mins = int(m.group(2)) if m.group(2) else 0
    secs = int(m.group(3))
    if mins == 0:
        return f'{verb} for {secs} second{"" if secs == 1 else "s"}'
    if secs == 0:
        return f'{verb} for {mins} minute{"" if mins == 1 else "s"}'
    return (
        f'{verb} for {mins} minute{"" if mins == 1 else "s"} '
        f'and {secs} second{"" if secs == 1 else "s"}'
    )


def format_elapsed_phrase(seconds: int, rng=None) -> str:
    """Humanise a turn duration for the end-of-response audio clip.

    Mirrors Claude Code's terminal footer "Cooked for 49s" / "Sautéed
    for 1m 0s" pattern, but kept in natural spoken English so edge-tts
    doesn't say "one em zero ess" for "1m 0s". Verb picked at random
    from PAST_TENSE_VERBS per turn — matches the terminal's varied
    spinner feel. `rng` overridable for deterministic tests.

        5   → 'Cooked for 5 seconds'
        59  → 'Sautéed for 59 seconds'
        60  → 'Simmered for 1 minute'
        90  → 'Pondered for 1 minute and 30 seconds'
        448 → 'Thought for 7 minutes and 28 seconds'
    """
    if seconds is None or seconds < 1:
        return ''
    seconds = int(seconds)
    if rng is None:
        rng = _random_module
    verb = rng.choice(PAST_TENSE_VERBS)
    mins, secs = divmod(seconds, 60)
    if mins == 0:
        return f'{verb} for {secs} second{"" if secs == 1 else "s"}'
    if secs == 0:
        return f'{verb} for {mins} minute{"" if mins == 1 else "s"}'
    return (
        f'{verb} for {mins} minute{"" if mins == 1 else "s"} '
        f'and {secs} second{"" if secs == 1 else "s"}'
    )


def owes_footer(mode: str, elapsed_sec: int | None, entries: list,
                user_idx: int) -> bool:
    """Quick predicate used by synth_turn.run() to decide whether the
    early-exit ("nothing to synthesise") path can fire.

    On Windows the footer is owned by footer-watcher.js — synth_turn
    never owes one, so the answer is always False (callers should
    skip this check on win32 anyway). On POSIX:

      - If the hook gave us a positive elapsed_sec, we owe a footer.
      - Else if the JSONL transcript carries a positive elapsed
        between the user prompt and the last assistant entry, we owe
        one anyway (the hook flag may have been missed; JSONL is
        authoritative).

    Cheap pre-check; the full footer text is computed later only if
    one is owed.
    """
    if mode != 'on-stop' or sys.platform == 'win32':
        return False
    if elapsed_sec is not None and elapsed_sec >= 1:
        return True
    return elapsed_from_transcript(entries, user_idx) >= 1


def _read_claude_pid_for_session(session_short: str) -> int:
    """Look up `claude_pid` for the given session_short from the
    on-disk registry. Avoids importing posix_hooks (would be circular).
    """
    reg_path = Path.home() / '.terminal-talk' / 'session-colours.json'
    if not reg_path.exists():
        return 0
    try:
        data = json.loads(reg_path.read_text(encoding='utf-8'))
        entry = (data.get('assignments') or {}).get(session_short) or {}
        return int(entry.get('claude_pid') or 0)
    except Exception:
        return 0


def _try_terminal_scrape(claude_pid: int) -> str:
    """Tier-1 footer: ask claude_footer_scrape for Claude's literal line.
    Returns the scraped string verbatim or empty on any failure."""
    if claude_pid <= 0:
        return ''
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    try:
        from claude_footer_scrape import scrape_footer_for_claude_pid
    except Exception:
        return ''
    try:
        return scrape_footer_for_claude_pid(claude_pid) or ''
    except Exception:
        return ''


def compute_footer_clip_text(
    *,
    mode: str,
    elapsed_sec: int | None,
    entries: list,
    user_idx: int,
    session_short: str,
    log_fn=None,
) -> str:
    """Top-level entry point that synth_turn.run() calls in on-stop mode.

    Returns the spoken text of the footer clip (e.g. "Cooked for 25
    seconds"), or empty string if the elapsed is too short / we're on
    Windows / not in on-stop mode. Caller pipes the result into
    synthesize_parallel as a single-clip batch.

    Two-tier strategy (POSIX only):

      Tier 1 — macOS Terminal.app/iTerm2 scrape: read the actual line
        Claude printed and humanise it ("Sautéed for 14m 6s" →
        "Sautéed for 14 minutes and 6 seconds"). Sanity-checked against
        JSONL elapsed via a 0.85-1.20 ratio band; out-of-band scrapes
        are treated as stale (a previous turn's line that Claude
        hasn't yet overwritten with the fresh one) and we fall through
        to tier 2.

      Tier 2 — format_elapsed_phrase from JSONL elapsed: pick a verb
        at random from PAST_TENSE_VERBS, format the duration. Always
        produces something when elapsed >= 1s.

    log_fn is called with diag strings for the audit trail; pass
    synth_turn._log so the lines land in the same hook log everything
    else does.
    """
    if mode != 'on-stop' or sys.platform == 'win32':
        return ''
    log = log_fn or (lambda _msg: None)
    jsonl_elapsed = elapsed_from_transcript(entries, user_idx)
    chosen_elapsed = jsonl_elapsed if jsonl_elapsed > 0 else (elapsed_sec or 0)
    if chosen_elapsed < 1:
        return ''
    # Tier 1: scrape on macOS only.
    if sys.platform == 'darwin':
        try:
            claude_pid = _read_claude_pid_for_session(session_short)
            scraped = _try_terminal_scrape(claude_pid)
            if scraped:
                m = _SCRAPE_PARSE_RE.match(scraped.strip())
                if m:
                    scraped_secs = int(m.group(2) or 0) * 60 + int(m.group(3))
                    ratio = (
                        scraped_secs / chosen_elapsed
                        if scraped_secs > 0
                        else 0.0
                    )
                    # Field-observed ratios sit at 1.00-1.01; 0.85-1.20
                    # admits 20% over-measure (tool-pause variance) while
                    # rejecting clearly-stale prior-turn lines.
                    if 0.85 <= ratio <= 1.20:
                        log(
                            f'on-stop: scraped Terminal.app footer '
                            f'"{scraped}" (scraped={scraped_secs}s '
                            f'JSONL={chosen_elapsed}s ratio={ratio:.2f})'
                        )
                        return humanise_footer_phrase(scraped)
                    log(
                        f'on-stop: scraped footer "{scraped}" rejected '
                        f'(scraped={scraped_secs}s JSONL={chosen_elapsed}s '
                        f'ratio={ratio:.2f} outside 0.85-1.20) — falling back'
                    )
        except Exception as exc:
            log(f'on-stop: footer scrape failed: {type(exc).__name__}: {exc}')
    # Tier 2: format from JSONL elapsed.
    return format_elapsed_phrase(chosen_elapsed)
