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
  // Tool-call narration is a routing flag, not a markdown transform:
  // Claude consumes it in synth_turn.py and Codex consumes it in the
  // JS rollout watcher. stripForTTS keeps it in the defaults shape for
  // config parity but does not edit text based on it.
  tool_calls: true,
};

function stripForTTS(text, includes) {
  const inc = { ...DEFAULTS, ...(includes || {}) };
  let t = String(text == null ? '' : text);

  function tableCellSummary(cell) {
    return String(cell || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/`+([^`\n]+?)`+/g, '$1')
      .replace(/[*_~|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // GFM markdown tables → speakable summary line. Without this transform
  // the raw `| col | col |` lines pass through and edge-tts refuses the
  // resulting clip (rc=1, size=0) — listener loses the whole table
  // silently. Speak the shape and first row so the listener gets both
  // the section context and a small sample without reading every cell.
  // Mirror in app/synth_turn.py.
  t = t.replace(
    /^[ \t]*\|(.+)\|[ \t]*\r?\n^[ \t]*\|(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*\r?\n((?:^[ \t]*\|.+\|[ \t]*\r?\n?)+)/gm,
    (_full, header, rowsBlock) => {
      const headerCells = header.split('|').map(tableCellSummary).filter(Boolean);
      const rows = rowsBlock
        .split(/\r?\n/)
        .filter((line) => /^\s*\|/.test(line))
        .map((line) => line.replace(/^\s*\||\|\s*$/g, '').split('|').map(tableCellSummary));
      const rowCount = rows.length;
      if (headerCells.length === 0) return `Table with ${rowCount} rows.\n`;
      const plural = rowCount === 1 ? 'row' : 'rows';
      const firstRow = rows[0] || [];
      const pairs = [];
      const maxCells = Math.min(headerCells.length, firstRow.length, 3);
      for (let i = 0; i < maxCells; i++) {
        if (headerCells[i] && firstRow[i]) pairs.push(`${headerCells[i]}: ${firstRow[i]}`);
      }
      const sample = pairs.length ? ` First row: ${pairs.join('; ')}.` : '';
      return `Table with ${rowCount} ${plural}. Columns: ${headerCells.join(', ')}.${sample}\n`;
    },
  );

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

  function codeLanguageName(lang) {
    const key = String(lang || '').trim().toLowerCase();
    const names = {
      js: 'javascript',
      jsx: 'javascript',
      cjs: 'javascript',
      mjs: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      py: 'python',
      ps1: 'powershell',
      psm1: 'powershell',
      pwsh: 'powershell',
      sh: 'shell',
      bash: 'shell',
      zsh: 'shell',
      yml: 'yaml',
    };
    return names[key] || key;
  }

  function codeIdentifierToWords(name) {
    return String(name || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function cleanCodeBlockLabel(label) {
    const text = String(label || '')
      .replace(/[`*_#~|]+/g, ' ')
      .replace(/[^A-Za-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    return text.split(/\s+/).slice(0, 10).join(' ');
  }

  function cleanCommentContext(line) {
    let source = String(line || '')
      .replace(/^[+\- ]/, '')
      .trim()
      .replace(/^(?:\/\/|#|--)\s?/, '')
      .replace(/^\/\*+\s?/, '')
      .replace(/^\*\s?/, '')
      .replace(/\*+\/$/, '')
      .replace(/^(?:[-*+]|\d+\.)\s+/, '')
      .trim();
    if (!source) return '';
    if (/^(?:param|returns?|throws?|todo|fixme|copyright|license|eslint|ts-ignore)\b/i.test(source)) return '';
    if (/[{};=<>]|=>|\b(?:const|let|var|return|if|else|for|while)\b/.test(source)) return '';
    source = source.split(/[.!?]\s+|\s+(?:—|--|-)\s+/, 1)[0];
    const label = cleanCodeBlockLabel(source);
    const words = label ? label.split(/\s+/) : [];
    return words.length >= 4 && words.length <= 12 ? `the ${label} area` : '';
  }

  function visibleContextScope(body) {
    let codeScope = '';
    let contextScope = '';
    let proseScope = '';
    for (const raw of String(body || '').split(/\r?\n/).slice(0, 260)) {
      const line = raw.replace(/^\s*\d+\s*(?:→|\||:|\t)\s?/, '');
      if (!line.trim()) continue;
      if (!codeScope) {
        const m = line.match(/^[ \t]*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$-]*)/)
          || line.match(/^[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/)
          || line.match(/^[ \t]*def\s+([A-Za-z_]\w*)/)
          || line.match(/^[ \t]*function\s+([A-Z][A-Za-z]+-[A-Z][A-Za-z]+)/)
          || line.match(/^[ \t]*(?:export\s+)?class\s+([A-Z][A-Za-z0-9_]*)/)
          || line.match(/^[ \t]*(?:export\s+)?interface\s+([A-Z][A-Za-z0-9_]*)/);
        if (m) codeScope = codeIdentifierToWords(m[1]) || m[1];
      }
      if (!contextScope) {
        const m = line.match(/^[ \t]{0,3}#{1,6}\s+(.{1,100}?)\s*$/)
          || line.match(/^[ \t]*#region\s+(.{1,100}?)\s*$/i)
          || line.match(/^[ \t]*(?:\/\/|#|--)\s*(?:section|feature|region|phase|step|panel|toolbar|settings|audio|speech|narration|codex|claude|tts)\s*[:\-]\s*(.{1,100}?)\s*$/i)
          || line.match(/^[ \t]*(?:test\.)?(?:describe|context)\s*\(\s*['"]([^'"]{1,100})['"]/);
        if (m) {
          const label = cleanCodeBlockLabel(m[1]);
          if (label) contextScope = /\b(?:describe|context)\s*\(/.test(line) ? `the ${label} tests` : `the ${label} section`;
        }
      }
      if (!proseScope) proseScope = cleanCommentContext(line);
      if (codeScope && contextScope) break;
    }
    return codeScope || contextScope || proseScope;
  }

  function codeBlockFocus(body) {
    const classMatch = body.match(/^[ \t]*(?:export\s+)?(?:class|interface)\s+([A-Za-z_$][\w$]*)/m);
    if (classMatch) return `defines the ${codeIdentifierToWords(classMatch[1])} class`;
    const funcMatch = body.match(/^[ \t]*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/m)
      || body.match(/^[ \t]*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/m)
      || body.match(/^[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/m)
      || body.match(/^[ \t]*function\s+([A-Z][A-Za-z]+-[A-Z][A-Za-z]+)/m);
    if (funcMatch) return `defines the ${codeIdentifierToWords(funcMatch[1])} function`;
    const testMatch = body.match(/\b(?:describe|it|test)\s*\(\s*['"]([^'"]{1,100})['"]/);
    if (testMatch) {
      const label = cleanCodeBlockLabel(testMatch[1]);
      if (label) return `contains the ${label} tests`;
    }
    const scope = visibleContextScope(body);
    return scope ? `around ${scope}` : '';
  }

  function codeBlockSummary(lang, body) {
    const lines = String(body || '').split(/\r?\n/).filter((line) => line.trim()).length;
    if (lines === 0) return ' ';
    const language = codeLanguageName(lang);
    const languagePhrase = language ? ` of ${language}` : '';
    let shape = '';
    const focus = codeBlockFocus(String(body || ''));
    if (focus) shape = `, ${focus}`;
    else if (/^[ \t]*(?:export\s+)?class\s+[A-Za-z_$][\w$]*/m.test(body)) shape = ', defines a class';
    else if (
      /^[ \t]*(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(/m.test(body)
      || /^[ \t]*(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/m.test(body)
      || /^[ \t]*(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/m.test(body)
      || /^[ \t]*function\s+[A-Z][A-Za-z]+-[A-Z][A-Za-z]+/m.test(body)
    ) shape = ', defines a function';
    else if (/\b(?:describe|it|test)\s*\(\s*['"]/.test(body)) shape = ', contains tests';
    else if (/^\s*(?:npm|yarn|pnpm|git|pip|python|python3|node|pwsh|powershell|docker|kubectl)\s+[-\w/]/m.test(body)) shape = ', shows shell commands';
    else if (/^\s*[{[]\s*$/m.test(body) || /^\s*"[\w.-]+":\s*/m.test(body)) shape = ', shows data';
    const plural = lines === 1 ? 'line' : 'lines';
    return ` Code block: ${lines} ${plural}${languagePhrase}${shape}. `;
  }

  const codeBlocks = [];
  t = t.replace(/```(\w*)\r?\n?([\s\S]*?)```/g, (_m, lang, body) => {
    const tagged = (lang || '').length > 0;
    if (inc.code_blocks) {
      codeBlocks.push(' ' + body + ' ');
      return `\u0000CB${codeBlocks.length - 1}\u0000`;
    }
    if (tagged || looksLikeCode(body)) return codeBlockSummary(lang, body);
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
  // isn't spoken; when kept, call it out explicitly. Screen text uses
  // size and weight to mark a section; audio needs an equivalent cue.
  // D3 (#19): heading regex parity with Python's _HEADING_LINE_RE.
  //   - `{1,6}` (strict CommonMark) instead of `+` (any count)
  //   - allow leading whitespace (Python allows)
  //   - make the space-after-# optional (Python does) so `#notaheading`
  //     strips consistently with Python
  if (!inc.headings) {
    t = t.replace(/^\s*#{1,6}\s*.*$/gm, ' ');
  } else {
    t = t.replace(/^\s*#{1,6}\s*(.+?)\s*$/gm, (_m, heading) => {
      const h = String(heading || '').trim();
      return h ? `Section: ${h}.` : ' ';
    });
  }

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
  // D4 (#19): single-underscore emphasis `_word_` — present in Python's
  // _EMPHASIS_RE, previously missing on JS side. Without this, prose
  // like `this is _emphasized_ text` reaches TTS as "this is underscore
  // emphasized underscore text". Mirrors Python's final alternation arm.
  t = t.replace(/_([^_\n]+)_/g, '$1');

  function punctuateBullet(content, prefix = '') {
    const c = String(content || '').trimEnd();
    if (!c) return '';
    const body = /[.!?:;]$/.test(c) ? c : `${c}.`;
    return prefix ? `${prefix}${body}` : body;
  }
  function numberMarkedLists(input) {
    let unorderedN = 0;
    let orderedActive = false;
    let orderedNext = 1;
    return String(input).split('\n').map((line) => {
      const m = line.match(/^[ \t]*([-*+]|\d+[.)])[ \t]+(.+?)[ \t]*$/);
      if (!m) {
        unorderedN = 0;
        if (!/^[ \t]/.test(line)) {
          orderedActive = false;
          orderedNext = 1;
        }
        return line;
      }

      const marker = m[1];
      if (/^[-*+]$/.test(marker)) {
        unorderedN += 1;
        return `${unorderedN}. ${punctuateBullet(m[2])}`;
      }

      unorderedN = 0;
      const rawNumber = Number.parseInt(marker, 10);
      const spokenNumber = rawNumber > 1 ? rawNumber : (orderedActive ? orderedNext : 1);
      orderedActive = true;
      orderedNext = spokenNumber + 1;
      return `${spokenNumber}. ${punctuateBullet(m[2])}`;
    }).join('\n');
  }
  if (inc.bullet_markers) {
    // Keep the fact that this is a list without repeating "bullet" on
    // every item or feeding raw "-" / "*" to TTS. Numbering gives a
    // compact audible boundary and resets for each separate list.
    t = numberMarkedLists(t);
  } else {
    // Common UI bullet glyphs: "●⎿▶▸►○·◦▪■□▫"
    t = t.replace(/^\s*[\u25cf\u23bf\u25b6\u25b8\u25ba\u25cb\u00b7\u25e6\u25aa\u25a0\u25a1\u25ab]\s*/gm, '');
    // Strip "- ", "* ", "+ ", "1. " markers AND add implicit period so
    // each bullet reads as its own sentence. Without the period each
    // multi-line bullet list flattens to one run-on sentence downstream.
    t = t.replace(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+(.+?)[ \t]*$/gm,
      (_m, content) => punctuateBullet(content));
  }

  // Always drop shell prompts ($  ...), quote prefixes ( >  ... ), assistant
  // hook-status noise ("Ran N hooks", "Running four PostToolUse hooks"), and
  // Codex Desktop/Electron debug logs. These are never speech content.
  t = t.replace(/^\s*\$\s.*$/gm, '');
  t = t.replace(/^\s*>\s+.*$/gm, '');
  t = t.replace(/\b(?:Ran|Running)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+.{0,50}hooks?.*/gi, '');
  t = t.replace(/^[^\r\n]*(?:\[electron-fetch-handler\]|\[electron-message-handler\]|\[AppServerConnection\]|\[git\]\s+\[git-origins\])[^\r\n]*$/gmi, '');

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

  // "live" at sentence end is ambiguous to TTS and can be pronounced
  // like "I live in a house". For Terminal Talk status/deploy phrasing,
  // rewrite only the current/running sense to unambiguous words.
  t = t
    .replace(/\b[Dd]one and live\b/g, (m) => (m[0] === 'D' ? 'Done and running' : 'done and running'))
    .replace(/\b[Nn]ow live\b/g, (m) => (m[0] === 'N' ? 'Now running' : 'now running'))
    .replace(/\b([Ii]s|[Aa]re) live\b/g, '$1 running')
    .replace(/\blive (install|app|toolbar|version|session|registry|config|configuration|runtime|files?|audio)\b/gi,
      (_m, noun) => `active ${noun}`);

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
