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

  // Code blocks: when included, keep body content only (drop the ``` fences
  // and the optional language tag). When excluded, drop the whole block.
  // Preserve kept blocks via a null-sentinel token so downstream regexes
  // don't touch their content — restored at the very end.
  const codeBlocks = [];
  if (inc.code_blocks) {
    t = t.replace(/```(?:\w+)?\r?\n?([\s\S]*?)```/g, (_m, body) => {
      codeBlocks.push(' ' + body + ' ');
      return `\u0000CB${codeBlocks.length - 1}\u0000`;
    });
  } else {
    t = t.replace(/```[\s\S]*?```/g, ' ');
  }

  // GFM-balanced inline code: same number of backticks on each side.
  // `(backticks+)(content)\1` handles both single `foo` and double
  // `` `foo` `` correctly. Naive `([^\`]+)` mis-paired adjacent unmatched
  // backticks from different spans, swallowing prose between them.
  // Newline exclusion prevents cross-line runaway.
  const SHORTCUT_RE = /^\s*`?\s*(?:Ctrl|Cmd|Shift|Alt|Win|Super|Meta|Control|Command|Option|Windows)\s*\+/i;
  if (inc.inline_code) {
    t = t.replace(/(`+)([^\n]+?)\1/g, (_m, _ticks, content) => content);
  } else {
    // Keyboard shortcuts survive the strip regardless (UI instructions,
    // not code noise). The optional `?` in SHORTCUT_RE tolerates the
    // GFM double-backtick form where captured content includes inner
    // backticks like " `Ctrl+R` " — still recognised as a shortcut.
    t = t.replace(/(`+)([^\n]+?)\1/g, (_m, _ticks, content) => (
      SHORTCUT_RE.test(content) ? content : ' '
    ));
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
  if (!inc.urls) t = t.replace(/https?:\/\/\S+/g, ' ');

  // Headings. When stripped, drop the whole line so the heading text
  // isn't spoken; when kept, drop the leading # hashes but keep the text.
  if (!inc.headings) t = t.replace(/^#+\s+.*$/gm, ' ');
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
