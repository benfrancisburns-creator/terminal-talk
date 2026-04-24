'use strict';

/**
 * Canonical `stripForTTS` implementation — one source of truth for how
 * Claude's markdown + tool-use noise is converted to speakable plain
 * prose before TTS. Kept as a pure function with an explicit `includes`
 * parameter; callers pass their own flags so there's no hidden global
 * dependency and the same function is trivial to unit-test.
 *
 * Previously this logic was duplicated 4 times (app/main.js,
 * scripts/run-tests.cjs, app/synth_turn.py, hooks/speak-response.ps1)
 * with the JS test copy already drifting from the production copy
 * (missing the shell-prompt / tool-use rules). Audit CC-1.
 *
 * Python mirror:      app/synth_turn.py   strip_for_tts()
 * PowerShell mirror:  hooks/speak-response.ps1   Strip-Markdown
 * These must produce byte-identical output on identical inputs.
 * The parity is enforced by the `CROSS-LANGUAGE STRIP-FOR-TTS PARITY`
 * group in scripts/run-tests.cjs.
 */

// Must stay in lock-step with DEFAULTS.speech_includes in app/main.js
// (the app merges user config over this).
const DEFAULTS = {
  code_blocks: false,
  inline_code: false,
  urls: false,
  headings: true,
  bullet_markers: false,
  image_alt: false,
  // Tool-call narration (Python-side only — JS stripForTTS doesn't act
  // on it, but the key exists here for config-shape parity with
  // synth_turn.py's DEFAULT_SPEECH_INCLUDES so the lock-step test
  // doesn't flag drift).
  tool_calls: true,
};

function stripForTTS(text, includes) {
  const inc = { ...DEFAULTS, ...(includes || {}) };
  let t = String(text == null ? '' : text);

  // Code blocks: three-way decision per fenced block. See synth_turn.py
  // for the full rationale. Short version: stripping 100% of fenced
  // content silently drops LLM "handoff message" / "quoted log" blocks
  // that are prose-in-fences. Language-tagged fences are always real
  // code; un-tagged fences get a syntax-heuristic check.
  // Each pattern carries /g so `String.match` returns ALL occurrences.
  // D1 (#19): pre-parity, JS counted max 1 hit per pattern (single-match
  // semantics) while Python's _looks_like_code counts via `findall` (all
  // matches sum). So `"npm install\nnpm test"` tripped twice in Python
  // (strip as code) but only once in JS (keep as prose) — same text
  // producing different audio depending on whether it went through
  // clipboard-speak or response-speak. Matching Python's aggressive-
  // strip stance is the correct parity target (per the module-header
  // comment: "Prefers false positives over false negatives").
  const CODE_SIGNALS = [
    /\b(def|function|fn|class)\s+\w+\s*[({:<]/g,
    /^\s*(import|from|require|using|package)\s+[\w.]/gm,
    /^\s*(if|else|elif|for|while|try|except|catch|with|switch)\s*\(/gm,
    /^\s*(if|elif|else|for|while|try|except|with|def|class)\b[^.!?\n]{0,120}:\s*$/gm,
    /^\s*[#$>]\s+\S/gm,
    /^\s*(npm|yarn|pnpm|git|pip|pipx|apt|sudo|rm|mkdir|cd|ls|cp|mv|cat|echo|curl|wget|python|python3|node|ruby|go|cargo|rustc|java|javac|mvn|gradle|docker|podman|kubectl|helm|terraform|aws|gcloud|az|taskkill|chmod|chown|ssh|scp|rsync|tar|unzip|make|cmake|gcc|clang)\s+[-\w/]/gm,
    /\b(Get|Set|New|Remove|Test|Invoke|Start|Stop|Write|Read|Import|Export|Add|Copy|Move|Out)-[A-Z]\w+\s/g,
    /^\s*[{[]\s*$/gm,
    /^\s*"[\w.-]+":\s*(null|true|false|-?\d|"|{|\[)/gm,
    /=>\s*[\w({[]/g,
    /->\s*\w/g,
    /::\s*\w/g,
    /;\s*\n/g,
  ];
  function looksLikeCode(body) {
    if (!body || !body.trim()) return false;
    let hits = 0;
    for (const re of CODE_SIGNALS) {
      const matches = body.match(re);
      if (matches) hits += matches.length;
      if (hits >= 2) return true;
    }
    return false;
  }

  const codeBlocks = [];
  t = t.replace(/```(\w*)\r?\n?([\s\S]*?)```/g, (_m, lang, body) => {
    const tagged = (lang || '').length > 0;
    if (inc.code_blocks) {
      codeBlocks.push(' ' + body + ' ');
      return `\u0000CB${codeBlocks.length - 1}\u0000`;
    }
    if (tagged || looksLikeCode(body)) return ' ';
    // Un-tagged prose-in-fences: speak the body.
    return body;
  });

  // GFM-balanced inline code: same number of backticks on each side.
  // `(backticks+)(content)\1` handles both single `foo` and double
  // `` `foo` `` correctly. Naive `([^\`]+)` mis-paired adjacent unmatched
  // backticks from different spans, swallowing prose between them.
  // Newline exclusion prevents cross-line runaway.
  const SHORTCUT_RE = /^\s*`?\s*(?:Ctrl|Cmd|Shift|Alt|Win|Super|Meta|Control|Command|Option|Windows)\s*\+/i;
  // Second whitelist: short identifier-like inline-code spans
  // (`session_id`, `/clear`, `main.js`, `pid=0`) are prose, not
  // real code. Stripping them turns explanatory sentences into
  // nonsense ("rotates the ___"). Disqualifiers: parens, braces,
  // language operators, multi-statement `;`, shell-flag patterns.
  const INLINE_PROSE_MAX = 30;
  const INLINE_CODE_DISQUAL = /[(){}]|=>|->(?![a-z])|::|;\s*\S|\s--?\w/;
  function looksLikeInlineProse(content) {
    if (!content) return false;
    const t = content.trim();
    if (!t || t.length > INLINE_PROSE_MAX) return false;
    if (t.indexOf('\n') >= 0) return false;
    return !INLINE_CODE_DISQUAL.test(t);
  }
  if (inc.inline_code) {
    t = t.replace(/(`+)([^\n]+?)\1/g, (_m, _ticks, content) => content);
  } else {
    // Keyboard shortcuts survive the strip regardless (UI instructions,
    // not code noise). The optional `?` in SHORTCUT_RE tolerates the
    // GFM double-backtick form where captured content includes inner
    // backticks like " `Ctrl+R` " — still recognised as a shortcut.
    t = t.replace(/(`+)([^\n]+?)\1/g, (_m, _ticks, content) => {
      if (SHORTCUT_RE.test(content)) return content;
      if (looksLikeInlineProse(content)) return content;
      return ' ';
    });
  }
  // Safety net: strip any surviving backtick characters (unmatched /
  // unclosed / weird edge cases). They have no speakable meaning.
  t = t.replace(/`/g, '');

  // Images: ![alt](url). Alt text optional per-toggle; URL always dropped.
  if (!inc.image_alt) t = t.replace(/!\[[^\]]*\]\([^)]+\)/g, ' ');
  else                t = t.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

  // Links: [text](url). Text always kept; URL always dropped.
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Bare URLs: strip or keep per-toggle.
  // D2 (#19): include bare `www.X` domains in the URL strip, matching
  // Python's _URL_RE. Pre-parity, JS only matched http(s)://; Python
  // ALSO matched bare www.*, so `"go to www.example.com"` with
  // urls=false produced different audio depending on whether
  // clipboard-speak (JS, kept) or response-speak (Python, stripped)
  // processed it. Case-insensitive mirrors Python's re.IGNORECASE flag.
  if (!inc.urls) t = t.replace(/https?:\/\/\S+|www\.\S+/gi, ' ');

  // Headings. When stripped, drop the whole line so the heading text
  // isn't spoken; when kept, drop the leading # hashes but keep the text.
  // D3 (#19): heading regex parity with Python's _HEADING_LINE_RE.
  //   - `{1,6}` (strict CommonMark) instead of `+` (any count)
  //   - allow leading whitespace (Python allows)
  //   - make the space-after-# optional (Python does) so `#notaheading`
  //     strips consistently with Python
  if (!inc.headings) t = t.replace(/^\s*#{1,6}\s*.*$/gm, ' ');
  else               t = t.replace(/^#+\s*/gm, '');

  // Markdown emphasis — marks gone, inner text kept, every time.
  // Triple *** / ___ first so a naive double-strip doesn't leave stray
  // asterisks on each side (which TTS reads as "asterisk asterisk").
  // `\n` exclusion on every arm: prevents a leftover single `*` from a
  // broken bold pair pairing across newlines with an unrelated stray
  // `*` (e.g. `app/*` glob) and silently eating whole paragraphs.
  t = t.replace(/\*\*\*([^*\n]+)\*\*\*/g, '$1');
  t = t.replace(/___([^_\n]+)___/g, '$1');
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  t = t.replace(/__([^_\n]+)__/g, '$1');
  t = t.replace(/\*([^*\n]+)\*/g, '$1');

  if (!inc.bullet_markers) {
    // Common UI bullet glyphs: "●⎿▶▸►○·◦▪■□▫"
    t = t.replace(/^\s*[\u25cf\u23bf\u25b6\u25b8\u25ba\u25cb\u00b7\u25e6\u25aa\u25a0\u25a1\u25ab]\s*/gm, '');
    // Strip "- ", "* ", "+ ", "1. " markers AND add implicit period so
    // each bullet reads as its own sentence. Without the period each
    // multi-line bullet list flattens to one run-on sentence downstream.
    t = t.replace(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+(.+?)[ \t]*$/gm, (_m, content) => {
      const c = content.trimEnd();
      if (!c) return '';
      return /[.!?:;]$/.test(c) ? c : c + '.';
    });
  }

  // Always drop shell prompts ($  …), quote prefixes ( >  … ), and Claude
  // Code's "Ran N hooks" tool-noise lines. These are never speech content.
  t = t.replace(/^\s*\$\s.*$/gm, '');
  t = t.replace(/^\s*>\s+.*$/gm, '');
  t = t.replace(/Ran \d+ .{0,40}hooks?.*/gi, '');

  // Pronunciation niceties for keyboard modifiers: "Ctrl+Shift+A" reads as
  // "control shift A", not "c-t-r-l plus s-h-i-f-t plus A". Covers every
  // common modifier in one sweep so multi-key chords don't partially
  // translate.
  const MODIFIER_WORD = {
    ctrl: 'control', control: 'control',
    cmd: 'command', command: 'command',
    shift: 'shift',
    alt: 'alt', option: 'option',
    win: 'windows', windows: 'windows',
    super: 'super', meta: 'meta',
  };
  t = t.replace(
    /\b(Ctrl|Control|Cmd|Command|Shift|Alt|Option|Win|Windows|Super|Meta)\+/gi,
    (_m, mod) => `${MODIFIER_WORD[mod.toLowerCase()]} `,
  );

  // Tilde — edge-tts pronounces as "tilda" which is universally wrong.
  // Drop the character; ~/path reads as "/path" (awkward but not wrong),
  // ~N loses "approximately" but context usually makes it clear.
  t = t.replace(/~/g, '');

  // Restore preserved code blocks if any (only when code_blocks=true).
  // NOSONAR: the null-byte delimiters are intentional sentinel tokens
  // written at line 45 above; no real markdown text contains \u0000 so
  // the placeholder can't collide with input content. See the paired
  // write at line 45 for the full rationale.
  if (codeBlocks.length > 0) {
    // eslint-disable-next-line no-control-regex -- paired with sentinel write at line 45
    t = t.replace(/\u0000CB(\d+)\u0000/g, (_, i) => codeBlocks[+i]);  // NOSONAR
  }

  return t.replace(/\s+/g, ' ').trim();
}

module.exports = { stripForTTS };
