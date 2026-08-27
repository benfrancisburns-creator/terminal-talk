"""Plain-text pronunciation + pacing rewrites for edge-tts.

History: this module originally emitted SSML (`<speak xmlns="...">`,
`<break>`, `<say-as>`, `<sub>`). That was wrong: `edge_tts.Communicate`
XML-escapes its input and wraps it in its own `<speak>` envelope, so
our outer `<speak xmlns="http://www.w3.org/2001/10/synthesis">` was
delivered to Microsoft's Azure endpoint as escaped text content and
read aloud verbatim — every clip began with "speak version 1 xmlns
http www w3 org 2001 10 synthesis xml lang en G B". The fix is to
keep the substitutions but emit plain text, which edge-tts handles
natively.

What the module still does:
  1. **Pacing** — ensures bullets, table rows, paragraphs end in
     sentence-terminating punctuation so edge-tts produces audible
     pauses on its own (it pauses naturally on `.`, `,`, `;`, `\n`).
  2. **Letter-by-letter pronunciation** for short-SHA commit hashes
     (`a48a6e3` → `a 4 8 a 6 e 3`). Spaced single characters read
     one-by-one naturally — no `<say-as>` needed.
  3. **Acronym + extension aliases** for common dev terms (`npm`
     → `N P M`, `.py` → `dot py`). Spaced letters get spelled out
     by the voice.

The module name stays `narration_ssml` for historical reasons and to
avoid churning imports — it no longer produces SSML.

Public API (unchanged signatures):
    needs_ssml(text)              → bool: still True when the text
                                    has SHAs / bullets / table rows /
                                    known acronyms worth rewriting
    apply_pronunciation(text)     → str: substitute aliases inline
    insert_breaks(text)           → str: ensure pause-worthy
                                    punctuation between segments
    build(text, lang='en-GB')     → str: full pipeline
"""
from __future__ import annotations

import re

# 7-char hex strings that look like git short-SHAs. False positives
# (a 7-char hex noun) are cheap — the audio is just letter-by-letter
# for one word — but missing real SHAs is bad.
_SHA7_RE = re.compile(r'\b([a-f0-9]{7})\b')

# Dev acronyms and short tokens that edge-tts mispronounces by default.
# Map: lowercase form → spoken text (forced spelling / phonetic spelling).
# Order matters when keys overlap; we sort longest-first at substitution
# time so JSONL beats JSON beats JS.
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

# File extensions read with deliberate "dot X" prefix — the user wants
# "dot py" not "py" when hearing `app/main.py` etc. Captured at word
# boundaries to avoid mangling fully-qualified names.
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

# Characters that already produce an audible pause in edge-tts. If a
# line ends in one of these we leave it alone; otherwise insert_breaks
# appends a period so the next segment doesn't run together.
_PAUSE_PUNCT = '.!?:;,'


def _spell_sha7(text: str) -> str:
    """Replace each 7-char hex SHA match with its characters separated
    by spaces, so edge-tts pronounces them one at a time. Single
    letters/digits voiced separately read out cleanly without needing
    SSML `<say-as>`."""
    return _SHA7_RE.sub(lambda m: ' '.join(m.group(1)), text)


def apply_pronunciation(text: str) -> str:
    """Substitute spoken-form aliases inline for known acronyms +
    file extensions. Order: longest keys first so JSONL beats JSON
    beats JS (avoid mid-word overlaps)."""
    out = text
    # Extensions first — they have the dot anchor so they're less
    # ambiguous than bare acronyms. Prepend a space to the substitution
    # so `main.py` → `main dot py` rather than `maindot py` — the `.`
    # gets consumed by the match so we need a separator on the left.
    for ext in sorted(_EXTENSION_ALIASES.keys(), key=len, reverse=True):
        alias = _EXTENSION_ALIASES[ext]
        pat = re.compile(re.escape(ext) + r'(?=$|[^\w])', re.IGNORECASE)
        out = pat.sub(' ' + alias, out)
    # Then acronyms. Word boundaries; case-insensitive.
    for acro in sorted(_ACRONYM_ALIASES.keys(), key=len, reverse=True):
        alias = _ACRONYM_ALIASES[acro]
        pat = re.compile(r'\b' + re.escape(acro) + r'\b', re.IGNORECASE)
        out = pat.sub(alias, out)
    return out


def insert_breaks(text: str) -> str:
    """Ensure each non-blank line ends in pause-worthy punctuation so
    edge-tts produces an audible break before the next line. Edge-tts
    pauses naturally on `.`, `,`, `;`, `\\n` — we just guarantee at
    least one of them is present at line boundaries."""
    lines = text.split('\n')
    out_lines: list[str] = []
    for line in lines:
        stripped = line.rstrip()
        if stripped and out_lines:
            prev = out_lines[-1].rstrip()
            if prev and prev[-1] not in _PAUSE_PUNCT:
                out_lines[-1] = prev + '.'
        out_lines.append(line)
    return '\n'.join(out_lines)


def needs_ssml(text: str) -> bool:
    """Heuristic: is this text worth running through `build()`?
    True when the text has structural markers we want to pause around
    OR known patterns (commit hashes, acronyms) the alias map handles.
    Name kept for compatibility — the module no longer emits SSML."""
    if not text:
        return False
    if _SHA7_RE.search(text):
        return True
    lines = [ln for ln in text.split('\n') if ln.strip()]
    bullets = sum(1 for ln in lines if re.match(r'^\s*(?:\d+\.|[-*+])\s+', ln))
    rows = sum(1 for ln in lines if ln.lstrip().startswith('|'))
    if bullets >= 2 or rows >= 2:
        return True
    lower = text.lower()
    if any(re.search(r'\b' + re.escape(acro) + r'\b', lower) for acro in _ACRONYM_ALIASES):
        return True
    return any(re.search(re.escape(ext) + r'(?=$|[^\w])', lower) for ext in _EXTENSION_ALIASES)


def build(text: str, lang: str = 'en-GB') -> str:
    """Spell SHAs → alias acronyms + extensions → ensure inter-line
    pause punctuation. Plain text, ready to feed straight to edge-tts.

    The `lang` parameter is accepted for API stability but no longer
    used — edge-tts picks language from the voice name."""
    if not text:
        return text
    spelled = _spell_sha7(text)
    aliased = apply_pronunciation(spelled)
    return insert_breaks(aliased)
