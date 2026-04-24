# ACTIVE #19 — JS vs Python sanitiser parity end-to-end audit

- **Status:** audit-done (3 divergences found; 1 material)
- **Owner:** TT2
- **Axes in play:** 1 (correctness), 7 (invariant)
- **Opened:** 2026-04-25T02:45 (per Ben B-5 decision)
- **Method:** side-by-side inspection of `app/lib/text.js` (JS) and `app/synth_turn.py` (Python)
  sanitisers. Same contract, two implementations.

## Why this matters

Both sanitisers read the same `speech_includes` flags and are supposed to produce the same
output for the same input. JS runs in `speakClipboard` (highlight-to-speak / "hey jarvis");
Python runs in `synth_turn.py` for response-body / tool / question clips. If the two diverge,
the same text produces different audio depending on which path Ben trips.

## Contract

For each `speech_includes` sub-key toggle, both sanitisers should make the **same**
inclusion/exclusion decision and produce the **same** output.

## Regex inventory — byte-level comparison

| Regex | JS (`text.js`) | Python (`synth_turn.py`) | Match |
|---|---|---|---|
| CODE_SIGNAL patterns (13 regexes) | lines 47-61 | lines 447-475 (`_CODE_SIGNAL_PATTERNS`) | **Byte-identical** ✓ |
| `_INLINE_CODE_RE` | `/(\`+)([^\n]+?)\1/g` | `r'(`+)([^\n]+?)\1'` | **Identical** ✓ |
| `_KBD_SHORTCUT_RE` | `/^\s*\`?\s*(?:Ctrl\|Cmd\|...)\s*\+/i` | same pattern (MULTILINE+IGNORECASE) | **Identical** ✓ |
| `_INLINE_CODE_DISQUAL` | `/[(){}]\|=>\|->(?![a-z])\|::\|;\s*\S\|\s--?\w/` | same pattern | **Identical** ✓ |
| `INLINE_PROSE_MAX` | 30 | 30 | **Identical** ✓ |
| `_URL_RE` | `/https?:\/\/\S+/g` | `r'https?://\S+\|www\.\S+'` (IGNORECASE) | **DIFFERENT (D2)** |
| `_HEADING_LINE_RE` | `/^#+\s+.*$/gm` | `r'^\s*#{1,6}\s*.*$'` (MULTILINE) | **DIFFERENT (D3)** |
| `_IMG_RE` | `/!\[[^\]]*\]\([^)]+\)/g` | `r'!\[([^\]]*)\]\([^\)]+\)'` | Identical (note Python captures alt group) |
| `_EMPHASIS_RE` | Not re-read | `r'\*\*([^*\n]+)\*\*\|__([^_\n]+)__\|\*([^*\n]+)\*\|_([^_\n]+)_'` | Not audited |

## Divergences

### ✗ D1 (MATERIAL) — `looksLikeCode` counting logic

**JS `looksLikeCode` (`text.js:62-71`):**

```js
let hits = 0;
for (const re of CODE_SIGNALS) {
  const m = body.match(re);
  if (m) hits++;           // ← at most 1 hit per pattern
  if (hits >= 2) return true;
}
```

**Python `_looks_like_code` (`synth_turn.py:488-498`):**

```python
hits = 0
for pat in _CODE_SIGNAL_PATTERNS:
    hits += len(pat.findall(content))   # ← ALL matches per pattern sum in
    if hits >= 2:
        return True
```

**Concrete divergence:**

Input: `"npm install\nnpm test\n"` — pattern #6 (shell-command-at-line-start) matches twice.

- **Python:** `findall` returns 2 → `hits = 2` → returns True → strip as code. ✓
- **JS:** `match` returns first match only → `hits = 1` → threshold not met. If nothing else
  matches, returns False → KEEP as prose. ✗

For the same input, clipboard-speak KEEPS the text; response-speak STRIPS it. Different
audio.

**Severity:** material — prose-in-fence and code-in-fence detection diverges on inputs that
have repeat-pattern matches from a single regex.

**Fix shape:** align both. Python matches JS (single-count-per-pattern) OR JS matches Python
(all-matches). Python's approach is "more aggressive strip" per its own comment — matches the
deliberate false-positive-preferred stance. **Recommendation: make JS match Python** via:

```js
hits += (body.match(re) || []).length;   // requires re to have /g flag
```

Would need to append `/g` to each CODE_SIGNALS regex that lacks it. Trivial diff.

### ~ D2 (minor) — URL regex scope

**JS:** `/https?:\/\/\S+/g` — matches `http://X`, `https://X`.

**Python:** `r'https?://\S+|www\.\S+'` (IGNORECASE) — **also matches bare `www.X`**.

**Concrete divergence:** text `"go to www.example.com"` with `urls=false`:
- Python strips the `www.example.com` → "go to".
- JS keeps the `www.example.com` → "go to www example com" (audible domain).

**Severity:** low-moderate. Most LLM responses use `http(s)://` full URLs; bare `www.X` is
rare in AI output. But consistent: pick one.

**Fix shape:** align JS:

```js
/https?:\/\/\S+|www\.\S+/gi
```

### ~ D3 (minor) — Heading regex differences

Three sub-divergences in one regex:

| Aspect | JS `/^#+\s+.*$/gm` | Python `r'^\s*#{1,6}\s*.*$'` |
|---|---|---|
| Hash count | `+` (1+) | `{1,6}` (strict HTML) |
| Leading whitespace | not allowed | allowed |
| Space after # | **required** (`\s+`) | **optional** (`\s*`) |

**Concrete divergences:**
- Input `"####### Overheading"` (7 hashes): JS strips whole line; Python KEEPS (above {1,6}).
- Input `"  # heading with leading ws"`: JS KEEPS (no match); Python strips.
- Input `"#notaheading"` (no space after): JS KEEPS (no match on `\s+`); Python strips.

**Severity:** low. Real-world LLM output rarely triggers these edges.

**Fix shape:** pick the stricter interpretation (Python's for HTML-semantic correctness, or
JS's for looser whole-line stripping). I'd go with Python's as it matches CommonMark spec.

### ? D4 (not audited) — Emphasis regex

Python has a dedicated `_TRIPLE_EMPHASIS_RE` + `_EMPHASIS_RE`. JS has emphasis handling but
the regex wasn't in scope of this audit. Worth one more sweep but not blocking.

## Fix priority recommendation

1. **D1 FIRST** — material divergence that produces different audio for realistic inputs.
   Change JS CODE_SIGNALS to use `/g` flag + `.length` count. Add a test: feed
   `"npm install\nnpm test"` to both, assert both strip.
2. **D2 + D3** as a tidy-up patch — align URL + heading regexes.
3. **D4** — separate micro-audit.

## Regression test shape

```js
describe('SANITIZER JS↔PY PARITY (#19)', () => {
  // Seed inputs whose outputs SHOULD match between stripForTTS (JS) and
  // sanitize (Python). Assert byte-equal after both pass with same flags.
  const CASES = [
    { in: 'npm install\nnpm test', flags: { code_blocks: false } },
    { in: 'See www.example.com', flags: { urls: false } },
    { in: '####### Big Heading', flags: { headings: false } },
    // ... etc.
  ];
  for (const c of CASES) {
    it(`parity: ${c.in.slice(0, 30)}`, () => {
      const jsOut = stripForTTS(c.in, c.flags);
      // call python via node child_process or precomputed expected
      const pyOut = runPythonSanitize(c.in, c.flags);
      assertEqual(jsOut.trim(), pyOut.trim(), 'JS/PY parity');
    });
  }
});
```

## Close-out

- [x] 13 code-signal regexes confirmed byte-identical
- [x] Inline-code heuristics confirmed identical
- [x] 3 real divergences found (D1 material, D2+D3 minor, D4 deferred)
- [x] Fix shapes drafted
- [x] Regression test shape drafted
- [ ] D1 fix lands as a real commit (JS uses /g + length)
- [ ] D2+D3 alignment patch
- [ ] D4 emphasis regex audit
