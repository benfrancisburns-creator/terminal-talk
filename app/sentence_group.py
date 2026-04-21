"""Group sentences into TTS-ready clips for natural delivery.

Sits between `sentence_split.split_sentences()` (which produces per-sentence
chunks tuned for correctness — abbreviations, URLs, decimals safe) and
`synth_turn.synthesize_parallel()` (which synthesises one clip per input).

Without this layer, every full stop becomes its own clip. For short
connected prose like "Good night Ben. Memory saved. Next session resumes
cleanly." the listener hears three separate audio files with inter-clip
pauses where Claude's own prose would flow.

Strategy (informed by Deepgram + Azure + camb.ai chunking research):
  - **Target ~300 chars per clip.** Deepgram's "natural sentence" range for
    long-form content is 200-400; 300 is the middle and matches edge-tts's
    4096-byte internal chunk limit with comfortable headroom.
  - **Flush when projected length > target.** Adjacent short sentences glue
    together up to target; once target is crossed, emit the clip and start
    a fresh buffer. First clip stays naturally small because the first 2-3
    sentences usually fit under 300.
  - **Hard cap at 500 chars.** Any single sentence over 500 emits alone.
    Upstream splitter already hard-splits at 400, so this is defensive.
  - **Paragraph breaks (\\n\\n) always flush.** Paragraphs carry semantic
    structure; collapsing across them would lose the "change of thought" cue.
  - **Empty input returns [].**

Tunables override via env vars so CI can lock thresholds without source edits.
"""

from __future__ import annotations

import os
import re

try:
    from sentence_split import split_sentences
except ImportError:
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from sentence_split import split_sentences


# ---------------------------------------------------------------------------
# Defaults. Env overrides let CI pin thresholds without code changes.
# ---------------------------------------------------------------------------

TARGET_GROUP_CHARS = int(os.environ.get('TT_GROUP_TARGET', '300'))
HARD_MAX_CHARS = int(os.environ.get('TT_GROUP_HARD_MAX', '500'))

_PARAGRAPH_BREAK_RE = re.compile(r'\n{2,}')


def group_sentences_for_tts(
    text: str,
    *,
    target: int | None = None,
    hard_max: int | None = None,
) -> list[str]:
    """Split `text` into paragraphs, sentence-split each, and glue adjacent
    sentences together within paragraph bounds up to `target` chars.

    Returns clips in reading order. Each clip is ready to hand to edge-tts.
    """
    t_target = target if target is not None else TARGET_GROUP_CHARS
    t_hard = hard_max if hard_max is not None else HARD_MAX_CHARS

    if not text or not text.strip():
        return []

    groups: list[str] = []

    for para in _PARAGRAPH_BREAK_RE.split(text):
        if not para.strip():
            continue
        para_sentences = split_sentences(para)
        if not para_sentences:
            continue

        buf: list[str] = []
        buf_len = 0

        def _flush() -> None:
            nonlocal buf, buf_len
            if buf:
                groups.append(' '.join(buf))
                buf = []
                buf_len = 0

        for s in para_sentences:
            # Defensive: a single sentence over hard cap emits alone.
            # Upstream splitter hard-splits at 400, so rare.
            if len(s) > t_hard:
                _flush()
                groups.append(s)
                continue

            projected = buf_len + (1 if buf else 0) + len(s)
            if buf and projected > t_target:
                _flush()

            buf.append(s)
            buf_len += len(s) + (1 if buf_len else 0)

        _flush()

    return groups


if __name__ == '__main__':
    import sys
    sample = sys.stdin.read() if not sys.stdin.isatty() else (
        "Good night Ben, everything saved: memory files, project docs, "
        "and the ten commits are on the main with CI green. "
        "Next session will boot straight into context.\n\n"
        "Sleep well."
    )
    for i, g in enumerate(group_sentences_for_tts(sample)):
        print(f'[{i}] ({len(g)}ch) {g}')
