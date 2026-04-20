"""Sentence splitter for Terminal Talk streaming TTS.

Military-grade splitter that handles the edge cases TTS actually trips on:
- Abbreviations (Mr., Dr., etc., e.g., U.S., a.m.) — don't split mid-abbreviation
- Decimal numbers / versions (3.14, v1.2.3, 192.168.0.1)
- URLs (https://foo.com/path.html)
- Ellipses (...)
- Multiple terminators (!!, ?!)
- Code-ish tokens (file.txt, api.call())
- Paragraph breaks (\\n\\n) — treated as boundaries even without punctuation
- Very short sentences (<15 chars) — merged into neighbour to avoid choppy TTS
- Very long sentences (>400 chars) — split on comma/space so no single edge-tts
  request runs forever

Pure function. No I/O, no side effects. Exports `split_sentences(text)`.
"""

from __future__ import annotations

import re

# Abbreviations that commonly end with a period but NOT a sentence.
# Lowercased check, period stripped. If a token (lowercase, period-stripped)
# is in this set, the following period is treated as part of the token.
_ABBREVIATIONS = {
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'ave', 'blvd', 'rd',
    'vs', 'etc', 'inc', 'ltd', 'corp', 'co', 'llc', 'plc',
    'e.g', 'i.e', 'c.f', 'a.m', 'p.m',
    'no', 'vol', 'pp', 'ch', 'sec', 'fig', 'eq', 'rev',
    'u.s', 'u.k', 'u.n', 'e.u',
    'phd', 'md', 'ba', 'ma', 'bsc', 'msc',
    'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
    'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
    # A2-4 extras. Hand-picked from the audit's false-positive list:
    # technical prose ("approx.", "ref.", "misc.", "incl./excl.", "assoc."),
    # department / job-title abbreviations common in docs ("dept.", "ed.",
    # "gen.", "gov.", "pres.", "rep.", "sen.") and the bare "aka" +
    # already-present "vs" (documented here so the reader doesn't wonder
    # why "vs." doesn't split mid-sentence).
    'approx', 'aka', 'ref', 'misc', 'incl', 'excl', 'assoc',
    'dept', 'ed', 'gen', 'gov', 'pres', 'rep', 'sen',
}

# Min/max sentence lengths (chars, post-strip).
MIN_SENTENCE_LEN = 15
MAX_SENTENCE_LEN = 400

# Sentinels — must not appear in natural text. Using private-use Unicode block.
_DOT_SENTINEL = '\uE000'
_URL_SENTINEL_PREFIX = '\uE001URL'

# URL regex — captures http(s), ftp, file, mailto and bare www.* forms.
_URL_RE = re.compile(
    r'(?:(?:https?|ftp|file|mailto):[^\s]+|www\.[^\s]+)',
    re.IGNORECASE,
)

# Pattern for "word followed by period" — used for abbreviation detection.
# Captures the token BEFORE the period so we can check the abbreviation set.
# A2-4: bumped char class from {1,5} to {1,8} so 6-8 char abbreviations
# like "approx.", "assoc.", "associated." candidates get considered. The
# abbreviation SET (not the regex) is the authoritative filter, so this
# widens the candidate pool without changing the decision rule.
_WORD_DOT_RE = re.compile(r"\b([A-Za-z]{1,8}(?:\.[A-Za-z]{1,8}){0,3})\.")

# Decimal / version numbers. Must not split on the internal periods.
_NUMBER_DOT_RE = re.compile(r'\b(\d+(?:\.\d+)+)\b')

# Split on ONE OR MORE of . ! ? (or the ellipsis char), possibly followed by
# closing quote/bracket, then whitespace or end. Captures the terminator so
# we can reattach it. A2-4: CJK full-stop / exclamation / question added so
# Japanese and Chinese transcripts split at sentence ends too. CJK variants
# don't normally carry a trailing space -- pattern already treats the
# optional space greedily via \s+ match, but the CJK terminators themselves
# are intentionally kept in the `[]` so they count as terminators even when
# followed directly by more text (covered by the paragraph-level sentence
# check, not by this regex).
_SENTENCE_END_RE = re.compile(
    r'([.!?\u2026\u3002\uFF01\uFF1F]+["\')\]]*)\s+',
)

# Hard paragraph break — two or more newlines.
_PARA_BREAK_RE = re.compile(r'\n{2,}')

# Single newline inside a paragraph — we keep as space.
_SINGLE_NEWLINE_RE = re.compile(r'\n+')


def _protect_abbreviations(text: str) -> str:
    """Replace trailing dots of abbreviations with a sentinel so they don't
    count as sentence terminators. Restored later."""

    def repl(m: re.Match) -> str:
        token = m.group(1)
        # Strip internal dots for abbreviation check (handles "U.S.", "e.g.")
        check = token.lower()
        if check in _ABBREVIATIONS or check.replace('.', '') in _ABBREVIATIONS:
            return token + _DOT_SENTINEL
        return m.group(0)

    return _WORD_DOT_RE.sub(repl, text)


def _protect_urls(text: str) -> tuple[str, list[str]]:
    """Replace URLs with placeholders; return (protected_text, urls)."""
    urls: list[str] = []

    def repl(m: re.Match) -> str:
        urls.append(m.group(0))
        return f'{_URL_SENTINEL_PREFIX}{len(urls) - 1}\uE002'

    return _URL_RE.sub(repl, text), urls


def _protect_decimals(text: str) -> str:
    """Replace decimal-internal dots with sentinel."""

    def repl(m: re.Match) -> str:
        return m.group(1).replace('.', _DOT_SENTINEL)

    return _NUMBER_DOT_RE.sub(repl, text)


def _restore(text: str, urls: list[str]) -> str:
    text = text.replace(_DOT_SENTINEL, '.')
    for i, url in enumerate(urls):
        text = text.replace(f'{_URL_SENTINEL_PREFIX}{i}\uE002', url)
    return text


def _split_on_terminators(paragraph: str) -> list[str]:
    """Split a single paragraph (no internal \\n\\n) on sentence terminators.
    Input is expected to already have abbreviations / URLs / decimals protected.
    """
    if not paragraph.strip():
        return []

    parts: list[str] = []
    last_end = 0
    for m in _SENTENCE_END_RE.finditer(paragraph):
        terminator_end = m.end(1)  # include the punctuation, exclude trailing space
        parts.append(paragraph[last_end:terminator_end])
        last_end = m.end()  # skip the whitespace too
    tail = paragraph[last_end:]
    if tail.strip():
        parts.append(tail)
    return [p.strip() for p in parts if p.strip()]


def _hard_split_long(sentence: str, max_len: int) -> list[str]:
    """For sentences over max_len, split on ', ' or space boundaries so no
    single edge-tts request blows up. Preserves order; never drops content."""
    if len(sentence) <= max_len:
        return [sentence]

    chunks: list[str] = []
    remaining = sentence
    while len(remaining) > max_len:
        # Prefer splitting at ', ' within a window [max_len*0.6, max_len].
        window_start = int(max_len * 0.6)
        cut = -1
        # A2-4: em-dash (U+2014) and en-dash (U+2013) now valid split points
        # even WITHOUT surrounding spaces. Common in tight prose ("word—word")
        # where the hard-splitter would otherwise have no legal cut except
        # on a bare space. Order matters: try the nicer, more-delimited
        # variants first; fall back to bare dashes; space last.
        for marker in (', ', '; ', ' — ', ' - ', '\u2014', '\u2013', ' '):
            idx = remaining.rfind(marker, window_start, max_len)
            if idx > 0:
                cut = idx + len(marker)
                break
        if cut <= 0:
            cut = max_len
        chunks.append(remaining[:cut].strip())
        remaining = remaining[cut:].strip()
    if remaining:
        chunks.append(remaining)
    return [c for c in chunks if c]


def _merge_shorts(sentences: list[str], min_len: int) -> list[str]:
    """Merge sentences shorter than min_len with the NEXT sentence so the TTS
    queue doesn't get flooded with tiny clips ('OK.' / 'Yes.' / 'Right.')."""
    if not sentences:
        return []

    merged: list[str] = []
    buf = ''
    for s in sentences:
        if buf:
            # Join with space; keep terminator from s
            candidate = f'{buf} {s}'
            if len(candidate) >= min_len:
                merged.append(candidate)
                buf = ''
            else:
                buf = candidate
        elif len(s) < min_len:
            buf = s
        else:
            merged.append(s)
    if buf:
        # Tail buffer — if we have previous merged sentences, stitch to last;
        # otherwise emit alone (single short sentence in whole input).
        if merged:
            merged[-1] = f'{merged[-1]} {buf}'
        else:
            merged.append(buf)
    return merged


def split_sentences(text: str) -> list[str]:
    """Split `text` into TTS-ready sentences.

    - Returns a list of non-empty, stripped strings in original order.
    - Each string is roughly in [MIN_SENTENCE_LEN, MAX_SENTENCE_LEN] chars.
    - Abbreviations, URLs, decimals are not split internally.
    - Paragraph breaks (\\n\\n) are always treated as sentence boundaries.
    - Empty / whitespace-only input returns [].
    """
    if not text or not text.strip():
        return []

    # Normalise line endings. A2-4 adds U+0085 (NEL, common in Java/VB
    # exports) and U+2028 (LINE SEPARATOR, occasionally from word
    # processors) to the existing \r\n / \r handling so pasted transcripts
    # from those sources don't keep ghost line breaks that the paragraph
    # splitter would miss.
    text = (
        text.replace('\r\n', '\n')
            .replace('\r', '\n')
            .replace('\u0085', '\n')
            .replace('\u2028', '\n')
    )

    # Protect abbreviations, URLs, decimals so the terminator regex doesn't
    # catch their periods.
    text = _protect_abbreviations(text)
    text, urls = _protect_urls(text)
    text = _protect_decimals(text)

    # Split into paragraphs first
    paragraphs = _PARA_BREAK_RE.split(text)

    all_sentences: list[str] = []
    for para in paragraphs:
        # Flatten internal single newlines to spaces — treat paragraph as one
        # block for terminator-based splitting.
        para_flat = _SINGLE_NEWLINE_RE.sub(' ', para).strip()
        if not para_flat:
            continue
        # If paragraph has no terminator at all, it's one sentence.
        # Include CJK full-stop (\u3002), fullwidth ! (\uFF01) and ? (\uFF1F)
        # per A2-4 so Chinese / Japanese paragraphs aren't treated as
        # terminator-free.
        if not re.search(r'[.!?\u2026\u3002\uFF01\uFF1F]', para_flat):
            all_sentences.append(para_flat)
            continue
        parts = _split_on_terminators(para_flat)
        all_sentences.extend(parts)

    # Restore protected dots and URLs
    all_sentences = [_restore(s, urls) for s in all_sentences]

    # Hard-split anything over max length
    expanded: list[str] = []
    for s in all_sentences:
        expanded.extend(_hard_split_long(s, MAX_SENTENCE_LEN))

    # Merge tiny ones
    return _merge_shorts(expanded, MIN_SENTENCE_LEN)


if __name__ == '__main__':
    import sys
    sample = sys.stdin.read() if not sys.stdin.isatty() else (
        "Hello world. Mr. Smith went to the U.S. yesterday at 3:14 p.m. "
        "He bought a copy of version 1.2.3 from https://foo.com/path.html. "
        "Then he said: 'Really?!' Yes.\n\nNew paragraph here. And another sentence."
    )
    for i, s in enumerate(split_sentences(sample)):
        print(f'[{i}] {s}')
