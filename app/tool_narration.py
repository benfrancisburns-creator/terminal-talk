"""Smart spoken phrases for tool_use entries in a Claude Code transcript.

When Claude uses a tool (Read, Edit, Bash, Grep, etc.), this module
produces a short speakable phrase describing *what is actually
happening* — not the literal tool invocation. The synth pipeline emits
each phrase as an ephemeral T-prefix clip.

Design goals (vs the previous "Reading foo.py" mechanical version):
  - Speak file names naturally ("the auth middleware file"), not
    "auth slash middleware dot ts".
  - Detect semantic patterns in Edit (rename, comment-only, imports
    update) rather than always saying "Editing X".
  - Map known shell commands to spoken intent ("Running the tests"
    instead of "Running npm").
  - Avoid repeating a file name on consecutive tool calls that touch
    the same file — drop the suffix when prev_call.file_path matches.
  - Suppress noise: whitespace-only edits, repeat reads of the same
    file, failed tool calls (when caller can detect them).

Pure module. No I/O, no global state. Caller threads `prev_call` to
get same-file suppression.

Phrase length: deliberately uncapped. Clear and accurate beats short
and cryptic.
"""

from __future__ import annotations

import os
import re
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# File-path naturalisation
# ---------------------------------------------------------------------------

# Generic basenames that don't carry meaning on their own. When the
# basename is one of these, we prepend the parent directory name so
# "lib/middleware.ts" becomes "the lib middleware" rather than "the
# middleware". Without this guard, a project full of index/main/utils
# files would produce indistinguishable narrations.
_GENERIC_BASENAMES = {
    'index', 'main', 'init', 'router', 'helper', 'helpers', 'utils',
    'util', 'utility', 'utilities', 'types', 'config', 'constants',
    'hook', 'hooks', 'middleware', 'handler', 'handlers', 'common',
    'shared', 'core', 'base', 'app', 'mod', 'module',
}

# Special-case files that have a canonical natural name.
_SPECIAL_FILES = {
    'package.json':       'the package json',
    'package-lock.json':  'the lock file',
    'tsconfig.json':      'the typescript config',
    'jsconfig.json':      'the javascript config',
    'pyproject.toml':     'the pyproject file',
    'requirements.txt':   'the requirements file',
    'cargo.toml':         'the cargo manifest',
    'gemfile':            'the gemfile',
    'dockerfile':         'the dockerfile',
    'makefile':           'the makefile',
    'readme.md':          'the readme',
    'readme.txt':         'the readme',
    'readme':             'the readme',
    'changelog.md':       'the changelog',
    'changelog':          'the changelog',
    'license':            'the license',
    'license.md':         'the license',
    '.gitignore':         'the gitignore',
    '.dockerignore':      'the dockerignore',
    '.env':               'the env file',
    '.env.example':       'the example env file',
}

# Extensions whose presence is more informative than the bare name.
# Most extensions get stripped silently ("auth.ts" -> "auth"); these
# survive into the spoken phrase ("the package json").
_KEEP_EXTENSIONS = {'json', 'yml', 'yaml', 'toml', 'md', 'log'}


def _to_words(name: str) -> str:
    """Convert kebab-case / snake_case / camelCase to space-separated."""
    if not name:
        return ''
    # camelCase -> camel Case
    s = re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', name)
    # PascalCase boundaries (XMLParser -> XML Parser)
    s = re.sub(r'(?<=[A-Z])(?=[A-Z][a-z])', ' ', s)
    # kebab + snake
    s = s.replace('-', ' ').replace('_', ' ')
    # collapse whitespace
    s = re.sub(r'\s+', ' ', s).strip()
    return s.lower()


def naturalise_path(path: str) -> str:
    """Turn a file path into a spoken phrase like 'the auth router file'.

    Rules:
      - Empty input -> empty string.
      - Special-case lookup table wins (`package.json` -> "the package json").
      - Strip path; take basename; check special-case again.
      - Drop most extensions; keep informative ones (json/yml/md/log/...).
      - kebab/snake/camel -> spaces.
      - If basename is generic (index/router/utils/...) AND a parent
        directory exists, prepend the parent dir's natural name so
        "auth/router.ts" becomes "the auth router" not "the router".
      - Test files: "*.test.ts" / "*.spec.ts" -> "the X test".
    """
    if not path:
        return ''
    norm = path.replace('\\', '/').rstrip('/')
    base = os.path.basename(norm) or norm
    # Special-case match (case-insensitive on the lookup key).
    low = base.lower()
    if low in _SPECIAL_FILES:
        return _SPECIAL_FILES[low]

    # Detect test files before stripping extension. Patterns like
    # `narrator.test.ts` and `narrator.spec.ts` should narrate as
    # "the narrator test" — the .test.ts is the part that matters.
    is_test = False
    test_match = re.match(r'(.+?)\.(test|spec)\.(ts|tsx|js|jsx|py)$', low)
    if test_match:
        base_clean = test_match.group(1)
        is_test = True
    else:
        # Drop extension unless it's an informative one.
        stem, dot, ext = base.rpartition('.')
        ext_low = ext.lower()
        if dot and ext_low in _KEEP_EXTENSIONS:
            base_clean = base  # keep the whole thing including extension
        elif dot and stem:
            base_clean = stem
        else:
            base_clean = base

    # Detect known config patterns where the extension is informative
    # but should be expressed as a word, not a literal.
    # config.example.json -> "the example config" (already special-cased
    # for that exact name, but generic case: foo.example.json).
    example_match = re.match(r'(.+?)\.example\.(json|yml|yaml|toml)$', low)
    if example_match:
        return f'the example {_to_words(example_match.group(1))}'

    # If basename is generic, prepend the parent dir's natural name.
    parent = os.path.dirname(norm)
    parent_base = os.path.basename(parent) if parent else ''
    base_words = _to_words(base_clean.partition('.')[0]) if not is_test else _to_words(base_clean)

    if base_words in _GENERIC_BASENAMES and parent_base:
        parent_words = _to_words(parent_base)
        if is_test:
            return f'the {parent_words} {base_words} test'
        # For json/yml/md/log, keep the extension word naturally.
        if base_clean.lower().endswith(('.json', '.yml', '.yaml', '.toml', '.md', '.log')):
            ext_w = base_clean.lower().rpartition('.')[2]
            ext_word = {'yml': 'yaml', 'toml': 'toml'}.get(ext_w, ext_w)
            return f'the {parent_words} {base_words} {ext_word}'
        return f'the {parent_words} {base_words} file'

    # Non-generic basename: speak it directly.
    if is_test:
        return f'the {base_words} test'
    if base_clean.lower().endswith(('.json', '.yml', '.yaml', '.toml')):
        # `eslint.config.js` -> "the eslint config" (already covered by
        # parent prepend); generic .json file -> "the X json".
        ext_w = base_clean.lower().rpartition('.')[2]
        return f'the {base_words} {ext_w}'
    if base_clean.lower().endswith('.md'):
        return f'the {base_words} doc'
    if base_clean.lower().endswith('.log'):
        return f'the {base_words} log'
    return f'the {base_words} file'


# ---------------------------------------------------------------------------
# Edit / Write helpers — semantic detection of the change
# ---------------------------------------------------------------------------

# Identifier-shaped tokens of length >= 3. Used by rename detection.
_IDENT_RE = re.compile(r'\b[A-Za-z_][A-Za-z0-9_]{2,}\b')

# Comment-line patterns by language style. Used by comment-only detection.
# Matches lines whose only non-whitespace content is a comment; deliberately
# forgiving about trailing prose — a `// foo` line passes whether or not
# the body has prose.
_COMMENT_LINE_RE = re.compile(r'^\s*(?://|#|--|\*|/\*|<!--).*$')


def _strip_whitespace(s: str) -> str:
    """Remove all whitespace for whitespace-only-change detection."""
    return re.sub(r'\s+', '', s or '')


def _looks_whitespace_only(old: str, new: str) -> bool:
    """True if old and new differ only in whitespace."""
    return _strip_whitespace(old) == _strip_whitespace(new)


def _looks_comment_only(old: str, new: str) -> bool:
    """True if every line in both old and new is a comment line."""
    if not old or not new:
        return False
    o_lines = old.strip().splitlines()
    n_lines = new.strip().splitlines()
    if not o_lines or not n_lines:
        return False
    return (all(_COMMENT_LINE_RE.match(line) for line in o_lines)
            and all(_COMMENT_LINE_RE.match(line) for line in n_lines))


def _looks_imports_only(old: str, new: str) -> bool:
    """True if both strings look like import / require / from / using lines.
    Used to detect refactors that only touch imports."""
    if not old or not new:
        return False
    pat = re.compile(r'^\s*(import|from|require|using|package|use\s+)\b')
    o_lines = [ln for ln in old.strip().splitlines() if ln.strip()]
    n_lines = [ln for ln in new.strip().splitlines() if ln.strip()]
    if not o_lines or not n_lines:
        return False
    return all(pat.match(line) for line in o_lines) and all(pat.match(line) for line in n_lines)


def _detect_rename(old: str, new: str) -> tuple[str, str] | None:
    """Detect a single-identifier rename.

    Returns (old_name, new_name) if exactly one identifier is removed
    and one identifier is added between the strings (with the rest
    unchanged). Returns None for any other pattern."""
    if not old or not new:
        return None
    old_ids = set(_IDENT_RE.findall(old))
    new_ids = set(_IDENT_RE.findall(new))
    removed = old_ids - new_ids
    added = new_ids - old_ids
    if len(removed) == 1 and len(added) == 1:
        old_name = next(iter(removed))
        new_name = next(iter(added))
        # Sanity: both must be reasonable identifiers (not numeric-only).
        if old_name and new_name and not old_name.isdigit() and not new_name.isdigit():
            return (old_name, new_name)
    return None


def _count_lines(s: str) -> int:
    """Count lines (1-indexed; '' -> 0, 'foo' -> 1, 'foo\\nbar' -> 2)."""
    if not s:
        return 0
    return s.count('\n') + (0 if s.endswith('\n') else 1)


# ---------------------------------------------------------------------------
# Bash command -> spoken phrase
# ---------------------------------------------------------------------------

# Ordered list — first match wins. Each entry: (regex on full command,
# template). Templates can use \1, \2 for captured groups.
_BASH_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r'^npm\s+test\b'),                    'Running the tests'),
    (re.compile(r'^npm\s+run\s+lint(?::fix)?\b'),     'Running the linter'),
    (re.compile(r'^npm\s+run\s+build\b'),             'Building the project'),
    (re.compile(r'^npm\s+run\s+check:?(\S*)'),        r'Running the \1 check'),
    (re.compile(r'^npm\s+run\s+(\S+)'),               r'Running the \1 npm script'),
    (re.compile(r'^npm\s+(install|ci)\b'),            'Installing dependencies'),
    (re.compile(r'^(yarn|pnpm)\s+test\b'),            'Running the tests'),
    (re.compile(r'^(yarn|pnpm)\s+install\b'),         'Installing dependencies'),
    (re.compile(r'^pip\s+install\b'),                 'Installing Python packages'),
    (re.compile(r'^pytest\b'),                        'Running the python tests'),
    (re.compile(r'^cargo\s+test\b'),                  'Running cargo test'),
    (re.compile(r'^cargo\s+build\b'),                 'Building with cargo'),
    (re.compile(r'^make\s+(\S+)'),                    r'Running make \1'),
    (re.compile(r'^make\b'),                          'Running make'),

    # Git
    (re.compile(r'^git\s+status\b'),                  'Checking git status'),
    (re.compile(r'^git\s+diff\s+(\S+)'),              r'Comparing against \1'),
    (re.compile(r'^git\s+diff\b'),                    'Looking at the diff'),
    (re.compile(r'^git\s+log\b'),                     'Checking git history'),
    (re.compile(r'^git\s+show\b'),                    'Looking at a commit'),
    (re.compile(r'^git\s+commit\b'),                  'Committing'),
    (re.compile(r'^git\s+push\s+--force(?:-with-lease)?'), 'Force-pushing'),
    (re.compile(r'^git\s+push\b'),                    'Pushing'),
    (re.compile(r'^git\s+pull\b'),                    'Pulling latest'),
    (re.compile(r'^git\s+fetch\b'),                   'Fetching from origin'),
    (re.compile(r'^git\s+checkout\s+-b\s+(\S+)'),     r'Cutting branch \1'),
    (re.compile(r'^git\s+checkout\s+(\S+)'),          r'Switching to \1'),
    (re.compile(r'^git\s+rebase\b'),                  'Rebasing'),
    (re.compile(r'^git\s+merge\b'),                   'Merging'),
    (re.compile(r'^git\s+stash\b'),                   'Stashing changes'),
    (re.compile(r'^git\s+add\b'),                     'Staging changes'),
    (re.compile(r'^git\s+restore\b'),                 'Restoring files'),
    (re.compile(r'^git\s+reset\b'),                   'Resetting'),
    (re.compile(r'^git\s+branch\b'),                  'Checking branches'),
    (re.compile(r'^git\s+remote\b'),                  'Checking remotes'),

    # GitHub CLI
    (re.compile(r'^gh\s+pr\s+create\b'),              'Opening a pull request'),
    (re.compile(r'^gh\s+pr\s+view\b'),                'Looking at the pull request'),
    (re.compile(r'^gh\s+pr\s+list\b'),                'Listing pull requests'),
    (re.compile(r'^gh\s+pr\s+close\b'),               'Closing a pull request'),
    (re.compile(r'^gh\s+pr\s+ready\b'),               'Marking the PR ready'),
    (re.compile(r'^gh\s+pr\s+comment\b'),             'Commenting on the PR'),
    (re.compile(r'^gh\s+run\s+list\b'),               'Checking recent CI runs'),
    (re.compile(r'^gh\s+run\s+view\b'),               'Looking at the CI run'),
    (re.compile(r'^gh\s+api\b'),                      'Calling the GitHub API'),
    (re.compile(r'^gh\s+issue\b'),                    'Working with issues'),

    # Filesystem navigation
    (re.compile(r'^cd\s+(\S+)'),                      r'Switching to \1'),
    (re.compile(r'^pwd\b'),                           'Checking the current directory'),
    (re.compile(r'^ls(?:\s+-\w+)?\s*$'),              'Listing files'),
    (re.compile(r'^ls\s+(\S+)'),                      r'Listing \1'),
    (re.compile(r'^mkdir\s+-p\s+(\S+)'),              r'Creating the \1 folder'),
    (re.compile(r'^mkdir\s+(\S+)'),                   r'Creating the \1 folder'),
    (re.compile(r'^rm\s+-r\w*\s+(\S+)'),              r'Removing \1'),
    (re.compile(r'^rm\s+(\S+)'),                      r'Removing \1'),
    (re.compile(r'^cp\s+(\S+)'),                      r'Copying \1'),
    (re.compile(r'^mv\s+(\S+)'),                      r'Moving \1'),
    (re.compile(r'^touch\s+(\S+)'),                   r'Creating \1'),
    (re.compile(r'^cat\s+(\S+)'),                     r'Reading \1'),
    (re.compile(r'^head\s+(?:-\w+\s+)?(\S+)'),        r'Looking at the start of \1'),
    (re.compile(r'^tail\s+(?:-\w+\s+)?(\S+)'),        r'Looking at the end of \1'),
    (re.compile(r'^which\s+(\S+)'),                   r'Finding \1'),
    (re.compile(r'^echo\b'),                          'Printing a value'),

    # Languages / runtimes
    (re.compile(r'^python\d?\s+(\S+\.py)'),           r'Running the \1 script'),
    (re.compile(r'^node\s+(\S+\.(?:js|cjs|mjs))'),    r'Running \1'),
    (re.compile(r'^node\s+--version\b'),              'Checking the node version'),
    (re.compile(r'^python\d?\s+--version\b'),         'Checking the python version'),
    (re.compile(r'^powershell(?:\.exe)?'),            'Running a PowerShell script'),
    (re.compile(r'^docker\s+ps\b'),                   'Listing docker containers'),
    (re.compile(r'^docker\s+build\b'),                'Building a docker image'),

    # Terminal-talk specific
    (re.compile(r'^bash\s+scripts/'),                 'Running a project script'),
    (re.compile(r'^node\s+scripts/'),                 'Running a project script'),
]


def _strip_env_assignments(cmd: str) -> str:
    """Skip leading `FOO=bar` assignments so the matched command starts at
    the real verb. `FOO=bar npm test` -> `npm test`."""
    if not cmd:
        return ''
    out: list[str] = []
    started = False
    for tok in cmd.split():
        if not started and re.match(r'^[A-Z_][A-Z0-9_]*=', tok):
            continue
        started = True
        out.append(tok)
    return ' '.join(out) if out else cmd


# Heredoc detection: `<verb> <args>? << ?[-]?[quotedmarker]\n...\nmarker`
# Matches the OUTER command structure so the inner script body doesn't
# trip the regex (`[^<]*` between verb and `<<` blocks `<` from leaking
# into the args slot).
_HEREDOC_RE = re.compile(r"^(\w+)([^<\n]*)<<-?\s*['\"]?(\w+)['\"]?", re.DOTALL)


def _narrate_heredoc(cmd: str) -> str | None:
    """Detect heredoc invocations (`python3 << EOF`, `cat << 'EOF' > f.txt`,
    `bash << EOF`) and produce a spoken phrase that reflects the actual
    operation, not the literal `python3` / `cat` head verb. Returns None
    if not a heredoc."""
    m = _HEREDOC_RE.match(cmd)
    if not m:
        return None
    verb = m.group(1).lower()
    middle = m.group(2)  # everything between verb and `<<`
    redirect_m = re.search(r'>\s*(\S+)', middle)
    target_file = redirect_m.group(1) if redirect_m else None

    if verb == 'cat':
        if target_file:
            return f'Writing {naturalise_path(target_file)}'
        return 'Writing inline content'
    if verb in ('python', 'python3', 'py'):
        return 'Running an inline python script'
    if verb == 'node':
        return 'Running an inline node script'
    if verb in ('bash', 'sh', 'zsh'):
        return 'Running an inline shell script'
    if verb == 'powershell':
        return 'Running an inline PowerShell script'
    return f'Running an inline {verb} script'


# Match a leading `echo "..."` (or `echo '...'` or unquoted echo) followed
# by ` && `. Used to strip noisy "echo === HEADER ===" framing from
# multi-stage chains so the meaningful work surfaces in the narration.
_ECHO_HEAD_RE = re.compile(r'''^echo\s+(?:"[^"]*"|'[^']*'|[^&|;]+?)\s+&&\s+(.+)$''', re.DOTALL)


def _strip_leading_echo(cmd: str) -> str:
    """If the command starts with an `echo "..."` stage followed by `&&`,
    drop the echo so the rest of the chain narrates as the head action.
    Common pattern: `echo "=== heading ===" && actual_command`. Recurses
    once so back-to-back echo headers (`echo "A" && echo "B" && cmd`) all
    get peeled."""
    m = _ECHO_HEAD_RE.match(cmd)
    if m:
        rest = m.group(1).strip()
        # Recurse one level — handles `echo X && echo Y && cmd`.
        return _strip_leading_echo(rest) if rest != cmd else rest
    return cmd


def _narrate_single_command(head: str) -> str | None:
    """Lookup the BASH_PATTERNS table for a single command (no chain
    awareness). Returns the matched phrase or a generic 'Running <verb>'
    fallback."""
    for pat, template in _BASH_PATTERNS:
        m = pat.match(head)
        if m:
            try:
                return m.expand(template)
            except re.error:
                return template
    first = head.split()[0] if head.split() else ''
    return f'Running {first}' if first else None


def _narrate_and_chain(cmd: str) -> str | None:
    """Narrate a command that contains `&&` chains. Splits on ` && `,
    narrates each stage via _narrate_single_command, then joins the
    meaningful ones into a flowing phrase:

        2 stages -> "X then y"
        3 stages -> "X, then y, then z"
        4+ stages -> "X and N more steps"

    Returns None if the chain has fewer than 2 narratable stages (the
    caller falls back to single-command narration)."""
    stages = [s.strip() for s in re.split(r'\s&&\s', cmd) if s.strip()]
    if len(stages) < 2:
        return None
    phrases: list[str] = []
    for s in stages:
        cleaned = _strip_env_assignments(s)
        p = _narrate_single_command(cleaned)
        if p:
            phrases.append(p)
    if len(phrases) < 2:
        return None
    if len(phrases) == 2:
        return f'{phrases[0]} then {phrases[1][0].lower()}{phrases[1][1:]}'
    if len(phrases) == 3:
        return (f'{phrases[0]}, then {phrases[1][0].lower()}{phrases[1][1:]}, '
                f'then {phrases[2][0].lower()}{phrases[2][1:]}')
    return f'{phrases[0]} and {len(phrases) - 1} more steps'


def narrate_bash(command: str) -> str | None:
    """Map a shell command to a spoken phrase. Honours four tiers in order:

      1. Strip leading `echo "header"` framing if followed by real work.
      2. Heredoc detection — `python3 << EOF` narrates as the actual
         intent, not the literal `python3` head.
      3. AND-chain detection — multi-step pipelines narrate every step.
      4. Fall through to single-command lookup against _BASH_PATTERNS,
         with a `(in a pipeline)` tag for `|` / `;` chains.

    Returns None for empty commands."""
    if not command:
        return 'Running a command'
    cmd = _strip_env_assignments(command).strip()
    if not cmd:
        return 'Running a command'

    # 1. Strip leading echo framing — common in our own scripts.
    cmd = _strip_leading_echo(cmd)
    if not cmd:
        return 'Running a command'

    # 2. Heredoc — must come before chain detection because the body
    #    might contain `&&` / `;` that aren't real chain operators.
    heredoc_phrase = _narrate_heredoc(cmd)
    if heredoc_phrase:
        return heredoc_phrase

    # 3. AND-chain — every stage gets narrated; result is a flowing
    #    description of the whole sequence.
    if ' && ' in cmd:
        chain_phrase = _narrate_and_chain(cmd)
        if chain_phrase:
            return chain_phrase
        # AND-chain detected but couldn't extract 2+ meaningful phrases —
        # fall through to single-command on the head (existing behaviour).

    # 4. Pipe (`|`) or semicolon (`;`) — describe the head + tag.
    is_pipeline = bool(re.search(r'\s\|\s|\s;\s', cmd))
    head = re.split(r'\s\|\s|\s;\s', cmd, maxsplit=1)[0].strip() if is_pipeline else cmd

    phrase = _narrate_single_command(head)
    if not phrase:
        return 'Running a command'
    if is_pipeline:
        return f'{phrase} (in a pipeline)'
    return phrase


# ---------------------------------------------------------------------------
# Per-tool narrators (input dict + previous file path -> phrase or None)
# ---------------------------------------------------------------------------

def _maybe_in_file(prev_file: str | None, curr_file: str | None, suffix: str) -> str:
    """Return ` in <suffix>` unless prev_file matches curr_file, in which
    case return ''. Used to suppress same-file repetition on consecutive
    tool calls touching the same file."""
    if not curr_file:
        return ''
    if prev_file and prev_file == curr_file:
        return ''
    if not suffix:
        return ''
    return f' in {suffix}'


def _narrate_read(inp: dict, prev_file: str | None,
                  prev_tool: str | None = None) -> str | None:
    path = str(inp.get('file_path', ''))
    if not path:
        return 'Looking at a file'
    base = os.path.basename(path.replace('\\', '/'))
    natural = naturalise_path(path)
    low = base.lower()

    # Same-file consecutive Read suppression. Re-reading the same file
    # back-to-back (e.g. Edit → Read → Edit) doesn't add information
    # for the listener — they already know we're working on this file.
    if prev_tool == 'read' and prev_file == path:
        return None

    # offset/limit means Claude is investigating a specific region, not
    # reviewing the whole file. Speak about it as a partial read so the
    # listener knows it's spot-checking, not full review.
    has_partial = ('offset' in inp and inp.get('offset') is not None) or \
                  ('limit' in inp and inp.get('limit') is not None)

    if low.endswith('.log'):
        return f'Checking part of {natural}' if has_partial else f'Checking {natural}'
    if low in _SPECIAL_FILES:
        return f'Reading part of {natural}' if has_partial else f'Reading {natural}'
    if has_partial:
        return f'Looking at part of {natural}'
    return f'Looking at {natural}'


def _narrate_edit(inp: dict, prev_file: str | None,
                  prev_tool: str | None = None) -> str | None:
    path = str(inp.get('file_path', ''))
    old = str(inp.get('old_string', ''))
    new = str(inp.get('new_string', ''))
    natural = naturalise_path(path) if path else ''
    in_file = _maybe_in_file(prev_file, path, natural)

    # Whitespace-only suppression always wins — even on repeats.
    if old and new and _looks_whitespace_only(old, new):
        return None

    # Same-file consecutive Edit dedup. The first edit speaks the file
    # name fully; subsequent edits to the same file get terse phrases
    # so the audio doesn't repeat the filename 5 times in a row when
    # Claude makes multiple incremental changes to one file.
    is_repeat_edit = (prev_tool == 'edit' and prev_file == path and bool(path))

    if old and new:
        rename = _detect_rename(old, new)
        if rename:
            old_name, new_name = rename
            if is_repeat_edit:
                return f'Then renamed {old_name} to {new_name}'
            return f'Renamed {old_name} to {new_name}{in_file}'
        if _looks_imports_only(old, new):
            if is_repeat_edit:
                return 'More import changes'
            return f'Updated imports{in_file}' if in_file else 'Updated imports'
        if _looks_comment_only(old, new):
            if is_repeat_edit:
                return 'More comment changes'
            return f'Updated comments{in_file}' if in_file else 'Updated comments'

    # Generic edit. Speak about size if it's notable.
    old_lines = _count_lines(old)
    new_lines = _count_lines(new)
    delta = new_lines - old_lines
    if delta > 5:
        if is_repeat_edit:
            return f'Added {delta} more lines'
        return f'Added {delta} lines{in_file}' if in_file else f'Added {delta} lines to {natural}'
    if delta < -5:
        if is_repeat_edit:
            return f'Removed {-delta} more lines'
        return f'Removed {-delta} lines{in_file}' if in_file else f'Removed {-delta} lines from {natural}'

    if is_repeat_edit:
        return 'Another change to the same file'
    if natural:
        return f'Edited {natural}'
    return 'Edited a file'


def _narrate_write(inp: dict, prev_file: str | None) -> str | None:
    path = str(inp.get('file_path', ''))
    content = str(inp.get('content', ''))
    if not path:
        return 'Writing a file'
    natural = naturalise_path(path)
    line_count = _count_lines(content)

    low = path.replace('\\', '/').lower()
    is_test = bool(re.search(r'\.(test|spec)\.(ts|tsx|js|jsx|py)$', low)) or '/tests/' in low or '/__tests__/' in low

    # Big files get a line count; tiny ones don't.
    size_suffix = ''
    if line_count >= 100:
        size_suffix = f' — {line_count} lines'
    elif line_count >= 30:
        size_suffix = ''  # mid-size is not worth speaking about

    if is_test:
        return f'Wrote a new test: {natural}{size_suffix}'
    if low.endswith('.md'):
        return f'Wrote {natural}{size_suffix}'
    if low.endswith(('.json', '.yml', '.yaml', '.toml')):
        return f'Wrote a config file: {natural}{size_suffix}'
    if low.endswith(('.tsx', '.jsx')):
        return f'Wrote a new component: {natural}{size_suffix}'
    return f'Wrote a new module: {natural}{size_suffix}'


def _narrate_glob(inp: dict, prev_file: str | None) -> str | None:
    pattern = str(inp.get('pattern', '')).strip()
    if not pattern:
        return 'Searching for files'
    # Common shapes: **/*.ext, *.ext, dir/**/*.ext, specific filename.
    # Map extensions to language names for natural speech.
    ext_lang = {
        'js': 'javascript', 'ts': 'typescript', 'jsx': 'javascript',
        'tsx': 'typescript', 'py': 'python', 'rb': 'ruby',
        'go': 'go', 'rs': 'rust', 'java': 'java', 'kt': 'kotlin',
        'cs': 'C-sharp', 'cpp': 'C++', 'c': 'C',
        'md': 'markdown', 'json': 'json', 'yml': 'yaml', 'yaml': 'yaml',
        'toml': 'toml', 'sh': 'shell', 'ps1': 'PowerShell',
        'css': 'css', 'html': 'html', 'sql': 'sql',
    }
    m = re.match(r'^(?:\*\*?/)?\*\.(\w+)$', pattern)
    if m:
        lang = ext_lang.get(m.group(1).lower(), m.group(1))
        return f'Looking for {lang} files'
    # `dir/**/*.ext` — speak about the dir.
    m = re.match(r'^([\w\-/]+)/\*\*?/\*\.(\w+)$', pattern)
    if m:
        lang = ext_lang.get(m.group(2).lower(), m.group(2))
        dir_words = _to_words(os.path.basename(m.group(1).rstrip('/')))
        return f'Looking for {lang} files in the {dir_words} folder'
    # Plain literal path / specific file.
    if '*' not in pattern:
        return f'Looking for {naturalise_path(pattern)}'
    return f'Searching with pattern {pattern}'


def _narrate_grep(inp: dict, prev_file: str | None,
                  prev_tool: str | None = None) -> str | None:
    pattern = str(inp.get('pattern', '')).strip()
    type_ = str(inp.get('type', '')).strip().lower()
    if not pattern:
        return 'Searching the code'

    # Plain identifier (no regex specials beyond \w) -> speak it.
    if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_\-]{0,40}', pattern):
        if type_:
            return f'Searching {type_} files for {pattern}'
        return f'Searching for {pattern}'

    # TODO/FIXME pattern is a special-case classic.
    if pattern in ('TODO', 'FIXME', 'TODO|FIXME', 'TODO\\|FIXME'):
        return 'Searching for to-do markers'

    # OR-pattern detection: `foo|bar|baz` outside a character class.
    # Common shape when Claude is finding any of N test names / function
    # names / anchor strings. Heuristic: contains `|`, has no `[`, all
    # alternatives look like plain text snippets (≤ 50 chars each, no
    # regex specials beyond word chars + spaces). Bare `|` between
    # plain identifiers narrates as "for several patterns".
    if '|' in pattern and ']' not in pattern:
        alts = [a.strip() for a in pattern.split('|')]
        is_simple = all(
            a and len(a) <= 50 and re.fullmatch(r"[A-Za-z0-9_\-\s'\"=()/.:]+", a)
            for a in alts
        )
        if is_simple and len(alts) >= 2:
            n = len(alts)
            if type_:
                return f'Searching {type_} files for {n} patterns'
            return f'Searching for {n} different patterns'

    if 'function' in pattern.lower() and r'\w' in pattern:
        return 'Searching for function definitions'
    if pattern.startswith(('import', 'require')):
        return 'Searching for imports'

    # Anything more complex — don't speak the regex.
    if type_:
        return f'Searching {type_} files'
    return 'Searching the code'


def _narrate_webfetch(inp: dict, prev_file: str | None) -> str | None:
    url = str(inp.get('url', '')).strip()
    if not url:
        return 'Fetching a web page'
    try:
        host = urlparse(url).netloc or url
    except Exception:
        host = url
    if host.startswith('www.'):
        host = host[4:]
    return f'Fetching from {host}' if host else 'Fetching a web page'


def _narrate_websearch(inp: dict, prev_file: str | None) -> str | None:
    query = str(inp.get('query', '')).strip()
    if not query:
        return 'Searching the web'
    # Take first ~6 words for the spoken phrase.
    words = query.split()
    short = ' '.join(words[:6])
    if len(words) > 6:
        short += '...'
    return f'Searching the web for {short}'


def _narrate_agent(inp: dict, prev_file: str | None) -> str | None:
    """Agent (Task) tool — invoking a subagent."""
    desc = str(inp.get('description', '')).strip()
    sub_type = str(inp.get('subagent_type', '')).strip()
    if desc:
        # Use natural description if it reads as a sentence start.
        return f'Delegating: {desc}'
    if sub_type:
        return f'Spawning the {sub_type} agent'
    return 'Starting a sub-agent'


def _narrate_todowrite(inp: dict, prev_file: str | None) -> str | None:
    """TodoWrite — describe what is currently in flight, not the literal
    list update. The activeForm field is the present-continuous version
    designed exactly for this kind of narration."""
    todos = inp.get('todos') or []
    if not isinstance(todos, list) or not todos:
        return None
    in_progress = [t for t in todos if isinstance(t, dict) and t.get('status') == 'in_progress']
    completed = [t for t in todos if isinstance(t, dict) and t.get('status') == 'completed']
    pending = [t for t in todos if isinstance(t, dict) and t.get('status') == 'pending']

    # Anything currently in progress is the most newsworthy thing.
    if in_progress:
        active = in_progress[0]
        active_form = str(active.get('activeForm', '')).strip()
        if active_form:
            return active_form
        content = str(active.get('content', '')).strip()
        if content:
            return f'Working on {content}'

    if completed and not pending and not in_progress:
        return 'All tasks complete'
    if completed:
        return f'{len(completed)} task{"" if len(completed) == 1 else "s"} done, {len(pending)} to go'
    if pending and not completed and not in_progress:
        return f'{len(pending)} new task{"" if len(pending) == 1 else "s"} on the list'
    return None


def _narrate_notebookedit(inp: dict, prev_file: str | None) -> str | None:
    path = str(inp.get('notebook_path', ''))
    if not path:
        return 'Editing a notebook'
    natural = naturalise_path(path)
    mode = str(inp.get('edit_mode', 'replace')).lower()
    in_file = _maybe_in_file(prev_file, path, natural)
    if mode == 'insert':
        return f'Added a cell{in_file}' if in_file else f'Added a cell to {natural}'
    if mode == 'delete':
        return f'Removed a cell{in_file}' if in_file else f'Removed a cell from {natural}'
    return f'Edited a cell{in_file}' if in_file else f'Edited a cell in {natural}'


def _narrate_skill(inp: dict, prev_file: str | None) -> str | None:
    skill_name = str(inp.get('skill', '')).strip()
    return f'Using the {skill_name} skill' if skill_name else 'Using a skill'


# ---------------------------------------------------------------------------
# Main dispatcher
# ---------------------------------------------------------------------------

# Tools that are explicitly suppressed (return None). All low-value
# meta-actions for an audio narration. Adjust here to enable.
_SKIP_TOOLS = {
    'taskcreate', 'taskupdate', 'tasklist', 'taskget', 'taskstop',
    'taskoutput', 'schedulewakeup', 'croncreate', 'crondelete',
    'cronlist', 'exitplanmode', 'enterplanmode', 'enterworktree',
    'exitworktree', 'monitor', 'pushnotification', 'remotetrigger',
    'toolsearch', 'askuserquestion',
}

# MCP tool names arrive prefixed with `mcp__<server>__<tool>`.
_MCP_PREFIX_RE = re.compile(r'^mcp__([^_]+)__')


def _file_path_of(tool_input: dict | None) -> str | None:
    """Extract the file path field from a tool's input, regardless of which
    field name it uses. Used for same-file-suppression continuity."""
    if not isinstance(tool_input, dict):
        return None
    for key in ('file_path', 'notebook_path', 'path'):
        v = tool_input.get(key)
        if isinstance(v, str) and v:
            return v
    return None


def narrate_tool_use(
    tool_name: str,
    tool_input: dict | None,
    prev_call: tuple[str, dict] | None = None,
) -> str | None:
    """Return a short spoken phrase for this tool call, or None to skip.

    `prev_call` is `(prev_tool_name, prev_tool_input)` from the previous
    narrator-emitting tool call in the same turn (None on the first call).
    Used to suppress same-file repetition: when this call's file_path
    matches the previous call's, the narrator drops the "in <file>"
    suffix to keep consecutive narrations crisp.
    """
    if not tool_name:
        return None
    name = tool_name.strip().lower()
    inp = tool_input or {}

    # Hard-skip meta tools.
    if name in _SKIP_TOOLS:
        return None
    # MCP tools: skip by default.
    if _MCP_PREFIX_RE.match(name):
        return None

    prev_file = _file_path_of(prev_call[1]) if prev_call else None
    prev_tool = prev_call[0].strip().lower() if prev_call else None

    # Tool dispatch.
    if name == 'read':
        return _narrate_read(inp, prev_file, prev_tool)
    if name == 'edit':
        return _narrate_edit(inp, prev_file, prev_tool)
    if name == 'write':
        return _narrate_write(inp, prev_file)
    if name == 'glob':
        return _narrate_glob(inp, prev_file)
    if name == 'grep':
        return _narrate_grep(inp, prev_file, prev_tool)
    if name in ('bash', 'powershell'):
        return narrate_bash(str(inp.get('command', '')))
    if name == 'webfetch':
        return _narrate_webfetch(inp, prev_file)
    if name == 'websearch':
        return _narrate_websearch(inp, prev_file)
    if name in ('agent', 'task'):
        return _narrate_agent(inp, prev_file)
    if name == 'todowrite':
        return _narrate_todowrite(inp, prev_file)
    if name == 'notebookedit':
        return _narrate_notebookedit(inp, prev_file)
    if name == 'skill':
        return _narrate_skill(inp, prev_file)

    # Unknown tool: silent. Speculation would mispronounce or mis-frame.
    return None
