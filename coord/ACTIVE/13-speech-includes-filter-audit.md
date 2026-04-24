# ACTIVE #13 — speech-includes filter (sanitiser) audit

- **Status:** audit-done (1 latent bug, 1 parity-gap for follow-up)
- **Owner:** TT2
- **Axes in play:** 1 (correctness), 7 (invariant)
- **Opened:** 2026-04-25T00:45
- **Method:** code inspection across `app/synth_turn.py::sanitize`, `app/lib/text.js::stripForTTS`, `resolve_voice_and_flags`.

## Surface

For each of 6 sub-keys — `code_blocks`, `inline_code`, `urls`, `headings`, `bullet_markers`,
`image_alt` — check that toggling it in Settings produces the expected inclusion / exclusion
from TTS audio on BOTH synth paths (response body via Python, clipboard-speak via JS).

## Sub-key behaviour map

Per-key logic traced from source:

| Sub-key | True = include | False = strip | Python sanitize() fallback | JS stripForTTS fallback | Match? |
|---|---|---|---|---|---|
| `code_blocks` | keep fenced body | strip unless prose-in-fence (3-way heuristic) | `get('code_blocks', False)` | from DEFAULTS spread | ✓ |
| `inline_code` | keep backtick content | strip except keyboard shortcuts + identifier-like prose | `get('inline_code', False)` | from DEFAULTS spread | ✓ |
| `urls` | keep | strip | `get('urls', False)` | from DEFAULTS spread | ✓ |
| `headings` | keep text, strip # | drop line | `get('headings', True)` | from DEFAULTS spread | ✓ |
| `bullet_markers` | keep `- ` etc. | strip + punctuate line | **`get('bullet_markers', True)`** | from DEFAULTS spread | **✗ BRITTLE (J-S1)** |
| `image_alt` | substitute alt | strip entirely | **`get('image_alt', True)`** | from DEFAULTS spread | **✗ BRITTLE (J-S1)** |

## Findings

### ✗ J-S1 (LATENT) — Python sanitiser fallback defaults disagree with `DEFAULT_SPEECH_INCLUDES`

**Site:** `app/synth_turn.py:652` and `:680`

```py
if flags.get('image_alt', True):  # ← fallback True
    t = _IMG_RE.sub(lambda m: m.group(1), t)    # keep alt
else:
    t = _IMG_RE.sub('', t)                       # strip

if not flags.get('bullet_markers', True):  # ← fallback True
    # strip markers + punctuate
```

But `DEFAULT_SPEECH_INCLUDES` (line 732-745) declares:

```py
'bullet_markers': False,
'image_alt': False,
```

**Why this is latent:** the only callers (`sanitize(raw_chunk, flags)` at :1121 and :1408)
receive `flags` from `resolve_voice_and_flags`, which pre-populates all 6 sub-keys from
`dict(DEFAULT_SPEECH_INCLUDES)`. So the `.get()` fallbacks never fire under the current code
paths.

**Why it's still worth fixing:** The drift-fix comment at :728-731 explicitly says:

> *"Previous drift: this file shipped bullet_markers=True + image_alt=True while JS shipped
> False for both, so the streaming hook spoke bullet markers and image alt-text that the
> clipboard-speak flow never did."*

The comment says it's fixed — but **the `.get()` fallbacks at :652 and :680 still carry the
old True values.** Any future caller (test, new hook, refactor that changes resolver output)
that passes partial `flags` dict to `sanitize` triggers the old drift again. One-line fix:

```py
if flags.get('image_alt', False):        # match DEFAULTS
if not flags.get('bullet_markers', False):  # match DEFAULTS
```

**Regression test shape** (forcing function — catches future drift without relying on reader
discipline):

```py
def test_sanitize_fallbacks_match_defaults():
    """Every `flags.get(k, fallback)` call in sanitize() must use fallback == DEFAULT_SPEECH_INCLUDES[k].
    Catches the J-S1 drift class by inspection, not by behaviour test."""
    src = Path('app/synth_turn.py').read_text()
    for key, default in DEFAULT_SPEECH_INCLUDES.items():
        pattern = rf"flags\.get\(['\"]{key}['\"],\s*(True|False)"
        for m in re.finditer(pattern, src):
            fallback = m.group(1) == 'True'
            assert fallback == default, \
                f"sanitize fallback for {key}={fallback} disagrees with default {default}"
```

### ? J-S2 (UNAUDITED) — JS vs Python code-signal heuristic parity

`app/lib/text.js::looksLikeCode` uses 14 code-signal regexes for the untagged-fence test.
`app/synth_turn.py::_looks_like_code` (not read end-to-end in this audit) does the same job.
If the two sets of heuristics diverge, the same prose-in-fence block could be KEPT by one
sanitiser and STRIPPED by the other — producing different audio for clipboard-speak vs
response-body on the same text.

Not in scope for this audit. Open as a separate queue item if Ben wants parity enforced.

### ✓ Everything else

- 4 of 6 sub-keys have matching fallbacks (✓ table above).
- JS `stripForTTS` uses a spread-defaults pattern (`{ ...DEFAULTS, ...includes }`) that
  structurally prevents the J-S1 class. Cleaner pattern; would close J-S1 if Python adopted
  it too.
- Both sanitisers respect the sub-key flags correctly on their configured values.
- Per-session override (`entry.speech_includes`) at `synth_turn.py:803-806` correctly merges
  over the config-level defaults — session-level precedence preserved.
- Sophisticated code_blocks 3-way heuristic (explicit tag / syntax-signals / prose) is the
  fix Ben benefited from for his 4.9k-char response (74% was prose-in-fences).
- Inline code preserves keyboard shortcuts + identifier-like prose — UI instruction
  preservation works.

## Close-out

- [x] All 6 sub-keys traced through both sanitisers
- [x] J-S1 (latent defaults drift) identified + fix shape + forcing-function test
- [x] J-S2 (cross-sanitiser parity) flagged for follow-up audit
- [ ] Open QUEUE #18 for J-S1 fix (Python one-liner + forcing test)
- [ ] Open QUEUE #19 for J-S2 parity audit (if Ben wants)
