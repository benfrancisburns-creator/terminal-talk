"""SSML builder for edge-tts — Block B of the May-9 narration sweep.

Edge TTS accepts plain text (default) OR SSML when the input begins
with `<speak`. Switching to SSML unlocks three things the audit
flagged as missing:

  1. **Pauses** between bullets (200 ms), table rows (400 ms), and
     paragraphs (600 ms). Without these, edge-tts runs sentences
     together when the source markdown lacks period punctuation.

  2. **Letter-by-letter pronunciation** for short-SHA commit hashes
     (`a48a6e3` → "a four eight a six e three"). The default voice
     reads them as garbage syllables; users hear nothing useful.

  3. **Acronym + extension aliases** for common dev terms (npm,
     DMG, CLI, IPC, .py, .js, .json, etc.). Without aliases the
     voice mispronounces "DMG" as "dimg" and "npm" as "nim".

The builder is **opt-in per call**: callers decide whether the input
needs SSML based on its content shape. Pure prose stays plain-text
because the synth fast path skips the wrapper. Anything with
multi-row tables, multi-bullet lists, commit hashes, or known
acronyms gets the SSML treatment.

Public API:
    needs_ssml(text)              → bool: heuristic for "worth wrapping"
    apply_pronunciation(text)     → str: substitute aliases inline
    insert_breaks(text)           → str: add <break> between segments
    wrap_speak(content)           → str: full <speak>...</speak> envelope
    build(text, voice_lang='en-GB') → str: pipeline of all four

Fallback discipline: callers MUST be ready for the synth subprocess
to reject the SSML and retry with the plain text. We never break
audio for the sake of nicer pauses.
"""
from __future__ import annotations

import re

# 7-char hex strings that look like git short-SHAs. We deliberately
# don't try to be smarter than this — false positives (a 7-char hex
# noun in prose) are cheap (the audio is just letter-by-letter for
# one word) but missing real SHAs is bad.
_SHA7_RE = re.compile(r'\b([a-f0-9]{7})\b')

# Dev acronyms and short tokens that edge-tts mispronounces by default.
# Map: lowercase form → SSML alias text (forced spelling). Order
# matters when multiple keys overlap; we sort longest-first at
# substitution time so JSONL beats JSON beats JS.
_ACRONYM_ALIASES: dict[str, str] = {
    'npm':   'N P M',
    'dmg':   'D M G',
    'cli':   'C L I',
    'ipc':   'I P C',
    'tts':   'T T S',
    'ssml':  'S S M L',
    'json':  'jay son',
    'jsonl': 'jay son L',
    'cc':    'C C',
    'os':    'O S',
    'api':   'A P I',
    'dom':   'D O M',
    'pid':   'P I D',
    'sha':   'S H A',
    'sha7':  'S H A seven',
    'pyobjc': 'pie obj C',
    'mp3':   'M P 3',
    'wav':   'wave',
    'gfm':   'G F M',
    'tcp':   'T C P',
    'udp':   'U D P',
    'sql':   'S Q L',
    'sqlite': 'S Q L lite',
    'github': 'git hub',
    'github actions': 'git hub actions',
    'macos': 'mac O S',
    'ios':   'I O S',
    'csv':   'C S V',
    'jsx':   'J S X',
    'tsx':   'T S X',
    'sdk':   'S D K',
    'http':  'H T T P',
    'https': 'H T T P S',
    'css':   'C S S',
    'svg':   'S V G',
    'png':   'P N G',
}

# File extensions read with deliberate "dot X" prefix — the user
# wants "dot py" not "py" when hearing `app/main.py` etc. Captured
# at word boundaries to avoid mangling URLs / fully-qualified names.
_EXTENSION_ALIASES: dict[str, str] = {
    '.py':    'dot py',
    '.js':    'dot J S',
    '.ts':    'dot T S',
    '.cjs':   'dot C J S',
    '.mjs':   'dot M J S',
    '.md':    'dot M D',
    '.sh':    'dot S H',
    '.ps1':   'dot P S one',
    '.json':  'dot jay son',
    '.jsonl': 'dot jay son L',
    '.yml':   'dot Y M L',
    '.yaml':  'dot Y A M L',
    '.toml':  'dot toh m L',
    '.onnx':  'dot O N N X',
    '.dmg':   'dot D M G',
    '.exe':   'dot E X E',
    '.zip':   'dot zip',
    '.css':   'dot C S S',
    '.html':  'dot H T M L',
    '.svg':   'dot S V G',
    '.png':   'dot P N G',
    '.mp3':   'dot M P 3',
    '.wav':   'dot wave',
    '.aiff':  'dot A I F F',
}

# Pause durations (ms). Tuned to feel natural without dragging out
# rapid-fire technical content.
PAUSE_BULLET_MS = 200
PAUSE_TABLE_ROW_MS = 400
PAUSE_PARAGRAPH_MS = 600
PAUSE_HEADING_MS = 100


def _xml_escape(text: str) -> str:
    """Minimal XML escape sufficient for SSML text content. We don't
    need to handle attribute quoting because we never put user text in
    attributes — only inside element bodies."""
    return (text
        .replace('&', '&amp;')
        .replace('<', '&lt;')
        .replace('>', '&gt;')
    )


def _spell_sha7(text: str) -> str:
    """Wrap each 7-char hex match in <say-as interpret-as="characters">.
    Operates on already-escaped text so we don't double-escape the
    contents we're wrapping."""
    return _SHA7_RE.sub(
        lambda m: f'<say-as interpret-as="characters">{m.group(1)}</say-as>',
        text,
    )


def apply_pronunciation(text: str) -> str:
    """Substitute SSML <sub alias="..."> tags around known acronyms +
    file extensions. Input must already be XML-escaped. Order: longest
    keys first so JSONL beats JSON beats JS (avoid mid-word overlaps)."""
    out = text
    # Extensions first — they have the dot anchor so they're less
    # ambiguous than bare acronyms.
    for ext in sorted(_EXTENSION_ALIASES.keys(), key=len, reverse=True):
        alias = _EXTENSION_ALIASES[ext]
        # Match the extension only at word/path boundaries — `.py` in
        # `app/main.py` should match, but `.py` inside `.python` (no
        # such case) should not. Use lookahead for non-word.
        pat = re.compile(re.escape(ext) + r'(?=$|[^\w])', re.IGNORECASE)
        out = pat.sub(f'<sub alias="{alias}">{ext}</sub>', out)
    # Then acronyms. Only match at word boundaries; case-insensitive.
    for acro in sorted(_ACRONYM_ALIASES.keys(), key=len, reverse=True):
        alias = _ACRONYM_ALIASES[acro]
        pat = re.compile(r'\b' + re.escape(acro) + r'\b', re.IGNORECASE)
        out = pat.sub(f'<sub alias="{alias}">{acro}</sub>', out)
    return out


def insert_breaks(text: str) -> str:
    """Insert <break> tags between segments based on markdown structure.
    Operates on already-escaped + alias-substituted text. We add
    breaks AFTER newlines because that's where edge-tts otherwise
    produces no audible pause."""
    lines = text.split('\n')
    out_lines: list[str] = []
    prev_kind = 'prose'
    for line in lines:
        stripped = line.strip()
        if not stripped:
            # Blank line — paragraph break.
            if out_lines:
                out_lines.append(f'<break time="{PAUSE_PARAGRAPH_MS}ms"/>')
            prev_kind = 'paragraph'
            continue
        # Detect kind. Heading = leading `#`. Bullet = leading `-`/`*`/digits.
        # Table row = leading `|`. Anything else = prose.
        kind = 'prose'
        if stripped.startswith('#'):
            kind = 'heading'
        elif re.match(r'^\s*(?:\d+\.|[-*+])\s+', line):
            kind = 'bullet'
        elif stripped.startswith('|'):
            kind = 'table'
        # Insert pre-line break based on the JOIN: previous kind →
        # this kind. Same-kind transitions get their kind's pause;
        # different-kind transitions take the larger.
        if out_lines:
            if kind == prev_kind:
                if kind == 'bullet':
                    out_lines.append(f'<break time="{PAUSE_BULLET_MS}ms"/>')
                elif kind == 'table':
                    out_lines.append(f'<break time="{PAUSE_TABLE_ROW_MS}ms"/>')
                # prose-prose, heading-heading: rely on natural sentence flow
            elif prev_kind == 'heading' or kind == 'heading':
                out_lines.append(f'<break time="{PAUSE_HEADING_MS}ms"/>')
            else:
                out_lines.append(f'<break time="{PAUSE_PARAGRAPH_MS}ms"/>')
        out_lines.append(line)
        prev_kind = kind
    return '\n'.join(out_lines)


def wrap_speak(content: str, lang: str = 'en-GB') -> str:
    """Wrap content in a `<speak>` element. Uses Microsoft's Speech
    Synthesis Markup Language schema URI (required by edge-tts)."""
    return (
        f'<speak version="1.0" '
        f'xmlns="http://www.w3.org/2001/10/synthesis" '
        f'xml:lang="{lang}">{content}</speak>'
    )


def needs_ssml(text: str) -> bool:
    """Heuristic: should this text be wrapped in SSML?
    True when the text has structural markers we want to pause around
    OR known patterns (commit hashes, acronyms) the alias map handles."""
    if not text:
        return False
    if _SHA7_RE.search(text):
        return True
    # Multi-line table or bullet list → benefits from <break>.
    lines = [ln for ln in text.split('\n') if ln.strip()]
    bullets = sum(1 for ln in lines if re.match(r'^\s*(?:\d+\.|[-*+])\s+', ln))
    rows = sum(1 for ln in lines if ln.lstrip().startswith('|'))
    if bullets >= 2 or rows >= 2:
        return True
    # Known acronym or extension present → benefits from alias.
    lower = text.lower()
    if any(re.search(r'\b' + re.escape(acro) + r'\b', lower) for acro in _ACRONYM_ALIASES):
        return True
    return any(re.search(re.escape(ext) + r'(?=$|[^\w])', lower) for ext in _EXTENSION_ALIASES)


def build(text: str, lang: str = 'en-GB') -> str:
    """Full SSML pipeline: escape → spell SHAs → alias acronyms +
    extensions → insert breaks → wrap. Idempotent on already-built
    SSML strings (returns them unchanged)."""
    if text.lstrip().startswith('<speak'):
        return text
    escaped = _xml_escape(text)
    spelled = _spell_sha7(escaped)
    aliased = apply_pronunciation(spelled)
    broken = insert_breaks(aliased)
    return wrap_speak(broken, lang=lang)
