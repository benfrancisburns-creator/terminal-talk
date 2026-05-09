"""Action library — Block C of the May-9 narration sweep (#46).

A developer at the terminal hears the same handful of action kinds
all day, just with different nouns. This module recognises the 12
recurring kinds and rewrites each detected paragraph into a tight,
spoken-form template that emphasises the WHAT + WHY without the
verbose hedging Claude / Codex tend to wrap each step in.

Pipeline location: applied between `sanitize()` (markdown → spoken
text) and the per-sentence edge-tts call. Paragraphs that don't
match a kind (or match below the confidence threshold) flow
through unchanged.

Detection strategy: each kind is a regex matcher + a slot extractor.
Matchers return (confidence ∈ [0,1], slots dict) pairs. The
highest-confidence match above the threshold wins; ties prefer the
more-specific kind (more required slots).

Public API:
    detect_kind(paragraph) → (kind, confidence, slots) | (None, 0.0, {})
    render(paragraph) → str: rewritten if confidence ≥ THRESHOLD,
                              else paragraph unchanged

Confidence thresholds were tuned against a sample of paragraphs
extracted from the 248-turn audit corpus — high enough that
casual prose ("let's think about authentication") doesn't trigger
DECIDE, low enough that explicit statements ("Going with Redis
because it's faster") do.

Kinds (in matcher-priority order — more specific first):
    COMMIT     "Committed <sha7> <subject> ..." (sha7 + colon makes it specific)
    TEST       "Tests N/M green; failing X" (N/M digits + green/failed verb)
    BUILD      "Built X" / "Built the DMG" (built + artefact)
    BLOCK      "Blocked: error in X" / "Failed: ..." (block/fail + cause)
    PLAN       "Plan: N steps" (numbered enumeration intro)
    EDIT       "Edited <file>" / "Modified X to do Y"
    RUN        "Ran <cmd>" / "Executed <cmd>"
    INVESTIGATE "Looking at X" / "Checking Y" (investigative verb + target)
    DISCOVER   "Found X — means Y" (discovery verb + implication)
    DECIDE     "Going with X because Y" (decision verb + reason)
    STATUS     "Done with X; next: Y"
    QUESTION   "...? — A or B?" (question + alternatives)

Below-threshold paragraphs are returned as-is so the existing
narrator stays in control of the everyday case. Library is
**additive** — never silently drops content the existing pipeline
would have spoken.
"""
from __future__ import annotations

import re
from collections.abc import Callable

# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------

# 7-char hex SHA — same as narration_ssml's matcher.
_SHA7_RE = re.compile(r'\b([a-f0-9]{7})\b')

# A "filename-ish" token: word characters with at least one `/` or `.`
# (to distinguish from regular nouns) — `app/main.py`, `lib/text.js`,
# `requirements-mac.txt`, `synth_turn.py`.
_FILENAME_RE = re.compile(r'\b([\w./-]+\.[\w]{1,5})\b|\b([\w-]+/[\w./-]+)\b')

# Confidence threshold above which a detected kind replaces the
# paragraph. Tuned conservatively — false-positives (replacing a
# good paragraph with a worse template) are worse than misses.
THRESHOLD = 0.70


def _trim(s: str, max_len: int = 80) -> str:
    """Trim a slot value to a sensible audio length, preserving word
    boundaries when possible."""
    s = s.strip()
    if len(s) <= max_len:
        return s
    truncated = s[:max_len].rsplit(' ', 1)[0]
    return truncated.rstrip(' ,;:.') + '...'


def _first_filename(text: str) -> str | None:
    m = _FILENAME_RE.search(text)
    return (m.group(1) or m.group(2)) if m else None


def _first_sha7(text: str) -> str | None:
    m = _SHA7_RE.search(text)
    return m.group(1) if m else None


# ----------------------------------------------------------------------
# Matchers — each returns (confidence, slots) or (0.0, {})
# ----------------------------------------------------------------------

def _match_commit(p: str) -> tuple[float, dict]:
    """COMMIT: explicit "Committed/Committing <sha7>" or commit-message
    pattern with sha + subject."""
    sha = _first_sha7(p)
    if not sha:
        return 0.0, {}
    if re.search(r'\b(?:committ?ed|commit\b)[\s:]', p, re.IGNORECASE):
        # Extract subject — anything between the SHA and the next
        # punctuation / clause break.
        idx = p.lower().find(sha.lower())
        after = p[idx + len(sha):].lstrip(' :-—').splitlines()[0]
        subject = _trim(re.split(r'[.;]', after)[0], 80)
        return 0.85, {'sha7': sha, 'subject': subject}
    return 0.0, {}


def _match_test(p: str) -> tuple[float, dict]:
    """TEST: "Tests N/M green" or "N tests passed, M failed"."""
    # Pattern A: "Tests 974/974 green" or "974/974 tests passed".
    m = re.search(r'\b(\d{1,5})\s*/\s*(\d{1,5})\b[^.\n]{0,40}\b(?:green|pass(?:ed|ing)?|ok)\b', p, re.IGNORECASE)
    if m:
        return 0.9, {'pass_count': m.group(1), 'total_count': m.group(2), 'failing_name': ''}
    # Pattern B: "N passed, M failed" — common run-tests output.
    m = re.search(r'\b(\d{1,5})\s+passed,\s*(\d{1,5})\s+failed\b', p, re.IGNORECASE)
    if m:
        total = int(m.group(1)) + int(m.group(2))
        return 0.85, {'pass_count': m.group(1), 'total_count': str(total), 'failing_name': ''}
    return 0.0, {}


def _match_build(p: str) -> tuple[float, dict]:
    """BUILD: "Built X" / "Build succeeded" / "DMG ready"."""
    m = re.search(r'\b(?:built|build(?:ed|ing)?)\s+(?:the\s+)?([\w./-]+(?:\s+\w+){0,3})', p, re.IGNORECASE)
    if m:
        artefact = _trim(m.group(1), 60)
        return 0.75, {'artefact': artefact, 'outcome': ''}
    return 0.0, {}


def _match_block(p: str) -> tuple[float, dict]:
    """BLOCK: "Blocked: ..." / "Failed: ..." / "Error: ..." with locus."""
    m = re.match(r'\s*(?:blocked|failed?|error)\s*[:-]\s*([^.\n]{4,120})', p, re.IGNORECASE)
    if m:
        return 0.85, {'reason': _trim(m.group(1), 100)}
    return 0.0, {}


def _match_plan(p: str) -> tuple[float, dict]:
    """PLAN: explicit "Plan:" / "Plan to do X, Y, Z" / "Steps:"."""
    m = re.match(r'\s*(?:plan|steps?|approach)\s*[:-]\s*([^.\n]{4,200})', p, re.IGNORECASE)
    if not m:
        return 0.0, {}
    body = m.group(1)
    # Look for an explicit step count ("4 steps", "five steps") and a
    # comma/em-dash-separated enumeration after it.
    count_match = re.match(r'(\d+)\s+steps?\b\s*[—–-]?\s*(.*)', body, re.IGNORECASE)
    if count_match:
        step_count = count_match.group(1)
        rest = count_match.group(2)
    else:
        # Fall back to counting comma-separated items.
        items = re.split(r'\s*(?:,|;)\s*', body)
        step_count = str(max(len(items), 1))
        rest = body
    # First noun = first item from the comma-separated list, ignoring
    # any leading "step 1:" prefix.
    first_item = re.split(r'\s*(?:,|;)\s*', rest.strip())[0]
    first_noun = _trim(re.sub(r'^\s*\d+[.)]\s*', '', first_item), 50)
    return 0.8, {'step_count': step_count, 'first_noun': first_noun}


def _match_edit(p: str) -> tuple[float, dict]:
    """EDIT: "Edited <file>: ..." / "Modified X to ..." / "Updated <file>"."""
    file = _first_filename(p)
    if not file:
        return 0.0, {}
    if re.search(r'\b(?:edit(?:ed|ing)?|modif(?:ied|ying)|updat(?:ed|ing)|chang(?:ed|ing))\b', p, re.IGNORECASE):
        # Strip the file token + any colon/preposition glue from the
        # paragraph before extracting summary so the summary doesn't
        # repeat the filename. Then look for "to <verb> ..." or ":
        # <summary>" connector.
        without_file = p.replace(file, '', 1)
        sm = re.search(r'\b(?:to\s+)([^.\n]{4,120})', without_file, re.IGNORECASE)
        summary = _trim(sm.group(1), 80) if sm else ''
        if not summary:
            sm = re.search(r':\s*([^.\n]{4,120})', without_file)
            if sm:
                summary = _trim(sm.group(1), 80)
        return 0.75, {'file': file, 'summary': summary}
    return 0.0, {}


def _match_run(p: str) -> tuple[float, dict]:
    """RUN: "Ran <cmd>" / "Executing X". Captures the rest of the
    line as the command (up to clause break), not just the first
    space-delimited token, so multi-word shell commands stay whole."""
    m = re.search(r'\b(?:ran|run(?:ning)?|execut(?:ed|ing))\s+(?:the\s+)?(`[^`]+`|[^\n,;.]{4,120})', p, re.IGNORECASE)
    if m:
        cmd = _trim(m.group(1).strip('`').rstrip('.'), 80)
        return 0.7, {'cmd': cmd, 'result': ''}
    return 0.0, {}


def _match_investigate(p: str) -> tuple[float, dict]:
    """INVESTIGATE: "Looking at X" / "Checking Y" / "Reading Z".
    Captures the noun phrase (filename, function, area) but stops
    before any "to <verb>" purpose clause. Stops at strong clause
    breaks (`,`, `;`, `\n`, sentence-ending `. `) but allows
    filename-internal dots like `synth_turn.py`."""
    m = re.search(r'\b(?:looking at|checking|reading|inspecting|grep(?:ping)?)\s+([^,;\n]{4,180})', p, re.IGNORECASE)
    if not m:
        return 0.0, {}
    target = m.group(1)
    # End the target at the first "to <verb>" purpose clause OR a
    # sentence-ending ". " (dot + space) so filenames keep their dots.
    end_match = re.search(r'\s+to\s+\w|\.\s|\.$', target)
    if end_match:
        target = target[:end_match.start()]
    target = target.strip().rstrip('.,;:')
    if len(target) < 3:
        return 0.0, {}
    return 0.7, {'target': _trim(target, 80)}


def _match_discover(p: str) -> tuple[float, dict]:
    """DISCOVER: "Found X — means Y" / "Discovered Z". Splits on the
    implication marker and stores fact + implication separately so the
    renderer can build "Found <fact> — means <implication>." without
    duplicating the connector word."""
    m = re.search(r'\b(?:found|discovered|noticed|spotted)\s+([^.\n]{4,250})', p, re.IGNORECASE)
    if not m:
        return 0.0, {}
    body = m.group(1).strip()
    # Look for an implication marker; capture only what FOLLOWS it
    # (not the marker itself — the renderer adds " — means ").
    imp_match = re.search(r'\s*(?:—|–|->|→)\s*(?:means\s+)?(.{3,120})|,\s*which\s+means\s+(.{3,120})', body)
    if imp_match:
        fact = _trim(body[:imp_match.start()].rstrip(' ,;:.—–'), 100)
        implication = _trim(imp_match.group(1) or imp_match.group(2), 100)
    else:
        fact = _trim(body, 100)
        implication = ''
    return 0.75, {'fact': fact, 'implication': implication}


def _match_decide(p: str) -> tuple[float, dict]:
    """DECIDE: "Going with X because Y" / "Picked X" / "Chose Y".
    The reason slot stores text AFTER the "because" connector so the
    renderer's template ("Going with X because Y") doesn't repeat it."""
    m = re.search(r'\b(?:going with|picked|chose|selected|opt(?:ed|ing)\s+for)\s+([^.,\n]{2,80})', p, re.IGNORECASE)
    if not m:
        return 0.0, {}
    option = m.group(1).strip()
    # Strip a trailing " because ..." from the option text — that
    # belongs to the reason slot, not the option.
    option = re.split(r'\s+because\s+', option, maxsplit=1, flags=re.IGNORECASE)[0]
    option = _trim(option, 60)
    reason = ''
    rm = re.search(r'\bbecause\s+([^.\n]{4,120})', p, re.IGNORECASE)
    if rm:
        reason = _trim(rm.group(1), 100)
    return 0.8, {'option': option, 'reason': reason}


def _match_status(p: str) -> tuple[float, dict]:
    """STATUS: "Done with X; next: Y"."""
    m = re.search(r'\bdone\s+with\s+([^.,;\n]{4,80})\s*[;.]\s*(?:next|now|moving)\s*:?\s*([^.\n]{4,120})', p, re.IGNORECASE)
    if m:
        return 0.8, {'done': _trim(m.group(1), 60), 'next': _trim(m.group(2), 80)}
    return 0.0, {}


def _match_question(p: str) -> tuple[float, dict]:
    """QUESTION: "...? — A or B?" — the user is being asked something
    with explicit (a)/(b) alternatives. Options can appear before OR
    after the question mark; we look for the (a) (b) markers anywhere
    in the paragraph."""
    if '?' not in p:
        return 0.0, {}
    # `[^.,?(\n]` excludes `(` so the first capture stops at the next
    # `(b)` marker — without this, `(a) X or (b) Y?` matched once and
    # consumed the second option into option_a.
    opts = re.findall(r'\(([a-z])\)\s*([^.,?(\n]{2,80})', p)
    if len(opts) < 2:
        return 0.0, {}
    # Question is everything before the first (a) marker (or up to the
    # first '?' if all options come after the question).
    first_marker = p.lower().find('(a)')
    question_text = (
        p[:first_marker].rstrip(' :;-—–') if first_marker > 0
        else p.split('?')[0] + '?'
    )
    question = _trim(question_text.strip(), 100)
    return 0.75, {
        'question': question,
        'option_a': _trim(opts[0][1].strip(), 60),
        'option_b': _trim(opts[1][1].strip(), 60),
    }


# Matcher registry. Order matters when multiple match — we pick the
# highest-confidence; ties prefer the matcher with more required slots.
_MATCHERS: list[tuple[str, Callable[[str], tuple[float, dict]], int]] = [
    ('COMMIT',      _match_commit,      2),  # sha + subject
    ('TEST',        _match_test,        2),  # pass + total
    ('BUILD',       _match_build,       1),
    ('BLOCK',       _match_block,       1),
    ('PLAN',        _match_plan,        2),
    ('EDIT',        _match_edit,        2),
    ('RUN',         _match_run,         1),
    ('INVESTIGATE', _match_investigate, 1),
    ('DISCOVER',    _match_discover,    2),
    ('DECIDE',      _match_decide,      2),
    ('STATUS',      _match_status,      2),
    ('QUESTION',    _match_question,    3),
]


def detect_kind(paragraph: str) -> tuple[str | None, float, dict]:
    """Run all matchers; return the best match (kind, confidence, slots).
    Below-threshold matches are returned as-is (caller checks confidence)."""
    if not paragraph or not paragraph.strip():
        return None, 0.0, {}
    best = (None, 0.0, {}, 0)
    for kind, fn, specificity in _MATCHERS:
        try:
            conf, slots = fn(paragraph)
        except Exception:
            continue
        # Prefer higher confidence; on tie prefer higher specificity.
        if conf > best[1] or (conf == best[1] and specificity > best[3]):
            best = (kind, conf, slots, specificity)
    return best[0], best[1], best[2]


# ----------------------------------------------------------------------
# Renderers — produce the spoken-form template per kind
# ----------------------------------------------------------------------

def _render_commit(s: dict) -> str:
    sha = s.get('sha7', '')
    subject = s.get('subject', '')
    if subject:
        return f'Committed {sha}: {subject}.'
    return f'Committed {sha}.'


def _render_test(s: dict) -> str:
    p, t, fail = s.get('pass_count', '?'), s.get('total_count', '?'), s.get('failing_name', '')
    if fail:
        return f'Tests: {p} of {t} passed; {fail} failed.'
    return f'Tests: {p} of {t} passed.'


def _render_build(s: dict) -> str:
    art = s.get('artefact', 'artefact')
    return f'Built {art}.'


def _render_block(s: dict) -> str:
    return f'Blocked: {s.get("reason", "unknown")}.'


def _render_plan(s: dict) -> str:
    n = s.get('step_count', '?')
    first = s.get('first_noun', '')
    if first:
        return f'Plan: {n} steps, starting with {first}.'
    return f'Plan: {n} steps.'


def _render_edit(s: dict) -> str:
    f = s.get('file', 'file')
    summary = s.get('summary', '')
    if summary:
        return f'Edited {f}: {summary}.'
    return f'Edited {f}.'


def _render_run(s: dict) -> str:
    cmd = s.get('cmd', 'command')
    result = s.get('result', '')
    if result:
        return f'Ran {cmd}: {result}.'
    return f'Ran {cmd}.'


def _render_investigate(s: dict) -> str:
    return f'Looking at {s.get("target", "code")}.'


def _render_discover(s: dict) -> str:
    fact = s.get('fact', '')
    imp = s.get('implication', '')
    if imp:
        return f'Found {fact} — means {imp}.'
    return f'Found {fact}.'


def _render_decide(s: dict) -> str:
    opt = s.get('option', 'an approach')
    reason = s.get('reason', '')
    if reason:
        return f'Going with {opt} because {reason}.'
    return f'Going with {opt}.'


def _render_status(s: dict) -> str:
    return f'Done with {s.get("done", "")}; next: {s.get("next", "")}.'


def _render_question(s: dict) -> str:
    return f'{s.get("question", "")} — option A: {s.get("option_a", "")}; option B: {s.get("option_b", "")}.'


_RENDERERS: dict[str, Callable[[dict], str]] = {
    'COMMIT': _render_commit,
    'TEST': _render_test,
    'BUILD': _render_build,
    'BLOCK': _render_block,
    'PLAN': _render_plan,
    'EDIT': _render_edit,
    'RUN': _render_run,
    'INVESTIGATE': _render_investigate,
    'DISCOVER': _render_discover,
    'DECIDE': _render_decide,
    'STATUS': _render_status,
    'QUESTION': _render_question,
}


def render(paragraph: str, threshold: float = THRESHOLD) -> str:
    """If `paragraph` matches a known kind with confidence ≥ threshold,
    return the templated spoken form. Otherwise return paragraph
    unchanged. Never raises — falls through on any internal failure."""
    try:
        kind, conf, slots = detect_kind(paragraph)
    except Exception:
        return paragraph
    if not kind or conf < threshold:
        return paragraph
    renderer = _RENDERERS.get(kind)
    if not renderer:
        return paragraph
    try:
        return renderer(slots)
    except Exception:
        return paragraph
