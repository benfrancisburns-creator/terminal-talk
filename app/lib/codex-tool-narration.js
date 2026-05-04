'use strict';

const TOOL_EVENT_TYPES = new Set(['function_call', 'custom_tool_call']);
// eslint-disable-next-line no-control-regex -- ANSI escape sequences start with ESC (\x1b)
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

function parseJsonObjectMaybe(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toWords(name) {
  if (!name) return '';
  return String(name)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const SPECIAL_FILES = new Map([
  ['package.json', 'the package json'],
  ['package-lock.json', 'the lock file'],
  ['tsconfig.json', 'the typescript config'],
  ['jsconfig.json', 'the javascript config'],
  ['pyproject.toml', 'the pyproject file'],
  ['requirements.txt', 'the requirements file'],
  ['cargo.toml', 'the cargo manifest'],
  ['dockerfile', 'the dockerfile'],
  ['makefile', 'the makefile'],
  ['readme.md', 'the readme'],
  ['readme.txt', 'the readme'],
  ['readme', 'the readme'],
  ['changelog.md', 'the changelog'],
  ['license', 'the license'],
  ['license.md', 'the license'],
  ['.gitignore', 'the gitignore'],
  ['.env', 'the env file'],
  ['.env.example', 'the example env file'],
]);

const GENERIC_BASENAMES = new Set([
  'index', 'main', 'init', 'router', 'helper', 'helpers', 'utils',
  'util', 'types', 'config', 'constants', 'hook', 'hooks', 'middleware',
  'handler', 'handlers', 'common', 'shared', 'core', 'base', 'app',
  'module',
]);

function stripQuotes(value) {
  return String(value || '').replace(/^['"]|['"]$/g, '');
}

function naturalisePath(inputPath) {
  if (!inputPath) return '';
  const cleaned = stripQuotes(inputPath).replace(/\\/g, '/').replace(/\/+$/g, '');
  const parts = cleaned.split('/').filter(Boolean);
  const base = parts[parts.length - 1] || cleaned;
  const low = base.toLowerCase();
  if (SPECIAL_FILES.has(low)) return SPECIAL_FILES.get(low);

  const testMatch = low.match(/^(.+?)\.(test|spec)\.(ts|tsx|js|jsx|py)$/);
  const exampleMatch = low.match(/^(.+?)\.example\.(json|ya?ml|toml)$/);
  if (exampleMatch) return `the example ${toWords(exampleMatch[1])}`;

  let stem = base;
  let ext = '';
  const dot = base.lastIndexOf('.');
  if (dot > 0) {
    stem = base.slice(0, dot);
    ext = base.slice(dot + 1).toLowerCase();
  }
  const baseWords = testMatch ? toWords(testMatch[1]) : toWords(stem);
  const parentWords = parts.length > 1 ? toWords(parts[parts.length - 2]) : '';
  const prefix = GENERIC_BASENAMES.has(baseWords) && parentWords
    ? `${parentWords} ${baseWords}`
    : baseWords;

  if (testMatch) return `the ${prefix} test`;
  if (['json', 'yml', 'yaml', 'toml'].includes(ext)) return `the ${prefix} ${ext === 'yml' ? 'yaml' : ext}`;
  if (ext === 'md') return `the ${prefix} doc`;
  if (ext === 'log') return `the ${prefix} log`;
  return `the ${prefix} file`;
}

function phraseFromTemplate(template, match) {
  return template.replace(/\\(\d)/g, (_, n) => match[Number(n)] || '');
}

function tokenizeCommand(command) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(command || '')))) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  return out.filter(Boolean);
}

function splitCommandStages(command) {
  const stages = [];
  let buf = '';
  let quote = '';
  let braceDepth = 0;
  const text = String(command || '');

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1] || '';
    if (quote) {
      buf += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === '{') {
      braceDepth++;
      buf += ch;
      continue;
    }
    if (ch === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      buf += ch;
      continue;
    }
    if (braceDepth === 0 && ch === '&' && next === '&') {
      if (buf.trim()) stages.push(buf.trim());
      buf = '';
      i++;
      continue;
    }
    if (braceDepth === 0 && ch === '|') {
      if (buf.trim()) stages.push(buf.trim());
      buf = '';
      continue;
    }
    if (braceDepth === 0 && ch === ';' && /\s/.test(text[i - 1] || '') && /\s/.test(next)) {
      if (buf.trim()) stages.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) stages.push(buf.trim());
  return stages;
}

function formatCount(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function cleanSearchPattern(pattern) {
  let p = String(pattern || '').trim();
  if (!p) return '';
  p = stripQuotes(p)
    .replace(/\\b/g, '')
    .replace(/\\s\*\([^)]*\)/g, '')
    .replace(/[.*+?^${}()[\]\\]/g, ' ')
    .replace(/\|/g, ' or ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!p || p.length > 42 || /^[^a-z0-9]+$/i.test(p)) return 'the pattern';
  return p.toLowerCase();
}

function describeSearchScope(paths) {
  const cleaned = (paths || [])
    .map((p) => String(p || '').trim())
    .filter((p) => p && !p.startsWith('-') && p !== '.');
  if (cleaned.length === 0) return 'the codebase';
  if (cleaned.length === 1) return naturalisePath(cleaned[0]).replace(/^the /, '');
  const names = cleaned.slice(0, 2).map((p) => naturalisePath(p).replace(/^the /, '').replace(/ file$/, ''));
  return cleaned.length > 2 ? `${names.join(' and ')} and ${cleaned.length - 2} more places` : names.join(' and ');
}

function summariseSearchCommand(head) {
  const tokens = tokenizeCommand(head);
  const cmd = (tokens[0] || '').toLowerCase();
  if (!['rg', 'grep', 'select-string', 'findstr'].includes(cmd)) return null;
  let pattern = '';
  const paths = [];
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    const low = t.toLowerCase();
    if (['-n', '--line-number', '-i', '--ignore-case', '-s', '--hidden', '--files'].includes(low)) continue;
    if (['-g', '--glob', '--type', '-t', '-e', '--regexp', '-pattern', '-path'].includes(low)) {
      if ((low === '-e' || low === '--regexp' || low === '-pattern') && tokens[i + 1]) {
        pattern = pattern || tokens[i + 1];
      } else if (low === '-path' && tokens[i + 1]) {
        paths.push(tokens[i + 1]);
      }
      i++;
      continue;
    }
    if (t.startsWith('-')) continue;
    if (!pattern) pattern = t;
    else paths.push(t);
  }
  if (cmd === 'rg' && tokens.includes('--files')) return 'Listing files tracked by ripgrep';
  const scope = describeSearchScope(paths);
  const spokenPattern = cleanSearchPattern(pattern);
  return spokenPattern ? `Searching ${scope} for ${spokenPattern}` : `Searching ${scope}`;
}

const OPTION_VALUE_FLAGS = new Set([
  '-path', '-literalpath', '-filter', '-include', '-exclude', '-first',
  '-last', '-skip', '-totalcount', '-tail', '-head', '-encoding', '-pattern',
  '-case', '-context', '-count', '-depth', '-name', '-type', '-g', '--glob',
  '--type', '-t', '-e', '--regexp', '-n', '-c',
]);

function findPathArgument(tokens) {
  for (let i = 1; i < tokens.length - 1; i++) {
    const low = tokens[i].toLowerCase();
    if (low === '-path' || low === '-literalpath') return tokens[i + 1];
  }
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    const low = token.toLowerCase();
    if (OPTION_VALUE_FLAGS.has(low)) {
      i++;
      continue;
    }
    if (token.startsWith('-')) continue;
    return token;
  }
  return '';
}

function naturaliseFolderTarget(inputPath) {
  const cleaned = stripQuotes(inputPath);
  if (!cleaned || cleaned === '.') return 'the current folder';
  const natural = naturalisePath(cleaned);
  const base = cleaned.replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
  if (!/\.[A-Za-z0-9]+$/.test(base) || /[*?]/.test(base)) {
    return natural.replace(/ file$/, ' folder');
  }
  return natural;
}

function contextSuffixFromResult(resultText) {
  const scope = extractVisibleContextScope(resultText);
  return scope ? ` around ${scope}` : '';
}

function summariseReadCommand(command, resultText = '') {
  const target = findPathArgument(tokenizeCommand(command));
  const suffix = contextSuffixFromResult(resultText);
  return target ? `Looking at ${naturalisePath(target)}${suffix}` : `Looking at a file${suffix}`;
}

function summarisePartialReadCommand(command, resultText = '') {
  const target = findPathArgument(tokenizeCommand(command));
  const suffix = contextSuffixFromResult(resultText);
  return target ? `Looking at part of ${naturalisePath(target)}${suffix}` : `Looking at part of a file${suffix}`;
}

function summariseListCommand(command) {
  const target = findPathArgument(tokenizeCommand(command));
  return target ? `Listing ${naturaliseFolderTarget(target)}` : 'Listing files';
}

function isSearchCommand(command) {
  const first = (tokenizeCommand(command)[0] || '').toLowerCase();
  return ['rg', 'grep', 'select-string', 'findstr'].includes(first);
}

function isListCommand(command) {
  const first = (tokenizeCommand(command)[0] || '').toLowerCase();
  return ['ls', 'dir', 'get-childitem'].includes(first);
}

function tailResultNoun(head, basePhrase) {
  if (isSearchCommand(head)) return 'match';
  if (isListCommand(head) || /^Listing\b/.test(basePhrase)) return 'result';
  return 'line';
}

function formatTailCount(count, noun) {
  return formatCount(count, noun, noun === 'match' ? 'matches' : `${noun}s`);
}

function optionNumber(tokens, names) {
  const lowerNames = new Set(names.map((n) => n.toLowerCase()));
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!lowerNames.has(tokens[i].toLowerCase())) continue;
    const n = Number.parseInt(tokens[i + 1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function cleanTailPattern(pattern) {
  const cleaned = cleanSearchPattern(pattern);
  return cleaned === 'the pattern' ? 'the pattern' : cleaned;
}

function describeTailStage(stage, context) {
  const tokens = tokenizeCommand(stage);
  const verb = (tokens[0] || '').toLowerCase();
  if (!verb) return null;
  const noun = tailResultNoun(context.head, context.basePhrase);

  if (verb === 'select-object') {
    const first = optionNumber(tokens, ['-First']);
    const last = optionNumber(tokens, ['-Last']);
    const skip = optionNumber(tokens, ['-Skip']);
    if (first && skip) {
      return { priority: 90, join: ', ', text: `${formatTailCount(first, noun)} after line ${skip}` };
    }
    if (first) return { priority: 90, join: ', ', text: `first ${formatTailCount(first, noun)}` };
    if (last) return { priority: 90, join: ', ', text: `last ${formatTailCount(last, noun)}` };
    return null;
  }

  if (verb === 'measure-object' || verb === 'measure') {
    if (tokens.some((t) => t.toLowerCase() === '-line')) {
      return {
        priority: 95,
        join: ' and ',
        text: noun === 'match' ? 'counting matches' : 'counting lines',
      };
    }
    return { priority: 65, join: ' and ', text: 'counting results' };
  }

  if (verb === 'select-string' || verb === 'grep' || verb === 'rg' || verb === 'findstr') {
    let pattern = '';
    for (let i = 1; i < tokens.length; i++) {
      const low = tokens[i].toLowerCase();
      if (['-pattern', '-e', '--regexp'].includes(low) && tokens[i + 1]) {
        pattern = tokens[i + 1];
        break;
      }
      if (tokens[i].startsWith('-')) {
        if (OPTION_VALUE_FLAGS.has(low)) i++;
        continue;
      }
      pattern = tokens[i];
      break;
    }
    return {
      priority: 80,
      join: ' and ',
      text: pattern ? `filtering for ${cleanTailPattern(pattern)}` : 'filtering results',
    };
  }

  if (verb === 'where-object') return { priority: 60, join: ' and ', text: 'filtering results' };
  if (verb === 'sort-object' || verb === 'sort') return { priority: 20, join: ' and ', text: 'sorting results' };
  if (verb === 'uniq') return { priority: 25, join: ' and ', text: 'removing duplicates' };
  if (verb === 'foreach-object') return { priority: 15, join: ' and ', text: 'processing each result' };
  if (verb === 'wc' && tokens.includes('-l')) return { priority: 95, join: ' and ', text: 'counting lines' };
  if (verb === 'head') {
    const n = optionNumber(tokens, ['-n']) || Number.parseInt((tokens.find((t) => /^-\d+$/.test(t)) || '').slice(1), 10);
    return { priority: 90, join: ', ', text: n ? `first ${formatTailCount(n, noun)}` : `first ${noun}s` };
  }
  if (verb === 'tail') {
    const n = optionNumber(tokens, ['-n']) || Number.parseInt((tokens.find((t) => /^-\d+$/.test(t)) || '').slice(1), 10);
    return { priority: 90, join: ', ', text: n ? `last ${formatTailCount(n, noun)}` : `last ${noun}s` };
  }
  if (verb === 'jq') return { priority: 70, join: ' and ', text: 'processing JSON' };
  if (verb === 'tee' || verb === 'tee-object') return { priority: 45, join: ' and ', text: 'saving a copy' };
  if (verb === 'out-string' || verb === 'format-table' || verb === 'format-list') return null;
  return null;
}

function applyTailDescription(basePhrase, head, tailStages) {
  const candidates = [];
  for (const stage of tailStages) {
    const desc = describeTailStage(stage, { head, basePhrase });
    if (desc) candidates.push(desc);
  }
  if (candidates.length === 0) return basePhrase;
  candidates.sort((a, b) => b.priority - a.priority);
  const best = candidates[0];
  return `${basePhrase}${best.join}${best.text}`;
}

function stableVariantIndex(seed, count) {
  if (count <= 1) return 0;
  let h = 2166136261;
  for (const ch of String(seed || '')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % count;
}

function leadingToolVerb(phrase) {
  const m = String(phrase || '').trim().match(/^([A-Za-z]+)/);
  return m ? m[1].toLowerCase() : '';
}

function chooseVariantAvoiding(seed, variants, avoidVerbs = []) {
  const pool = variants.filter(Boolean);
  if (pool.length === 0) return '';
  const avoid = new Set((avoidVerbs || []).map((v) => String(v || '').toLowerCase()).filter(Boolean));
  const start = stableVariantIndex(seed, pool.length);
  for (let i = 0; i < pool.length; i++) {
    const candidate = pool[(start + i) % pool.length];
    const verb = leadingToolVerb(candidate);
    if (!avoid.has(verb)) return candidate;
  }
  return pool[start];
}

function varyToolPhrase(phrase, seed = '', opts = {}) {
  if (!phrase) return phrase;
  const text = String(phrase);
  const key = seed ? `${seed}|${text}` : text;
  const avoidVerbs = Array.isArray(opts.avoidVerbs) ? opts.avoidVerbs : [];
  const rest = (prefix) => text.slice(prefix.length);
  const choose = (variants) => chooseVariantAvoiding(key, variants, avoidVerbs);

  if (text.startsWith('Searching for ')) {
    const value = rest('Searching for ');
    return choose([
      `Searching for ${value}`,
      `Scanning for ${value}`,
      `Looking for ${value}`,
      `Finding ${value}`,
    ]);
  }
  if (text.startsWith('Searching the code')) {
    const value = rest('Searching the code');
    return choose([
      `Searching the code${value}`,
      `Scanning the code${value}`,
      `Reviewing the code${value}`,
    ]);
  }
  if (text.startsWith('Searching the web')) return text;
  if (text.startsWith('Searching ')) {
    const value = rest('Searching ');
    return choose([
      `Searching ${value}`,
      `Scanning ${value}`,
      `Looking through ${value}`,
      `Checking ${value}`,
    ]);
  }
  if (text.startsWith('Looking for ')) {
    const value = rest('Looking for ');
    return choose([
      `Looking for ${value}`,
      `Finding ${value}`,
      `Scanning for ${value}`,
    ]);
  }
  if (text.startsWith('Looking at part of ')) {
    const value = rest('Looking at part of ');
    return choose([
      `Looking at part of ${value}`,
      `Reviewing part of ${value}`,
      `Opening part of ${value}`,
      `Inspecting part of ${value}`,
    ]);
  }
  if (text.startsWith('Looking at ')) {
    const value = rest('Looking at ');
    return choose([
      `Looking at ${value}`,
      `Opening ${value}`,
      `Reviewing ${value}`,
      `Inspecting ${value}`,
      `Viewing ${value}`,
    ]);
  }
  if (text.startsWith('Reading ')) {
    const value = rest('Reading ');
    return choose([
      `Reading ${value}`,
      `Opening ${value}`,
      `Reviewing ${value}`,
      `Inspecting ${value}`,
      `Viewing ${value}`,
    ]);
  }
  if (text.startsWith('Checking ')) {
    const value = rest('Checking ');
    return choose([
      `Checking ${value}`,
      `Reviewing ${value}`,
      `Verifying ${value}`,
    ]);
  }
  if (text.startsWith('Listing ')) {
    const value = rest('Listing ');
    return choose([
      `Listing ${value}`,
      `Showing ${value}`,
      `Gathering ${value}`,
      `Collecting ${value}`,
    ]);
  }
  if (text.startsWith('Running a project script') || text.startsWith('Running a PowerShell script')) {
    return choose([
      text,
      text.replace('Running', 'Starting'),
      text.replace('Running', 'Launching'),
    ]);
  }
  return text;
}

const SHELL_PATTERNS = [
  [/^npm\s+test\b/, 'Running the tests'],
  [/^npm\s+run\s+lint(?::fix)?\b/, 'Running the linter'],
  [/^npm\s+run\s+build\b/, 'Building the project'],
  [/^npm\s+run\s+check:file-length\b/, 'Checking file length limits'],
  [/^npm\s+run\s+check:?(\S*)/, 'Running the \\1 check'],
  [/^npm\s+run\s+(\S+)/, 'Running the \\1 npm script'],
  [/^npm\s+(install|ci)\b/, 'Installing dependencies'],
  [/^(yarn|pnpm)\s+test\b/, 'Running the tests'],
  [/^(yarn|pnpm)\s+install\b/, 'Installing dependencies'],
  [/^pytest\b/, 'Running the python tests'],
  [/^node\s+scripts[\\/]+run-tests\.cjs\b/, 'Running the test harness'],
  [/^node\s+scripts[\\/]+check-doc-drift\.cjs\b/, 'Checking the docs against the app'],
  [/^node\s+scripts[\\/]+check-file-length\.cjs\b/, 'Checking file length limits'],
  [/^node\s+scripts[\\/]+sync-app-mirror\.cjs\b/, 'Syncing the app mirror'],
  [/^node\s+scripts[\\/]+/, 'Running a project script'],
  [/^npx\s+eslint\b/, 'Running the linter'],
  [/^npx\s+playwright\b/, 'Running Playwright tests'],
  [/^git\s+status\b/, 'Checking git status'],
  [/^git\s+diff\s+--check\b/, 'Checking the diff for whitespace issues'],
  [/^git\s+diff\s+--\s+(.+)/, (m) => `Looking at changes in ${naturalisePath(m[1].split(/\s+/)[0])}`],
  [/^git\s+diff\s+(\S+)/, 'Comparing against \\1'],
  [/^git\s+diff\b/, 'Looking at the diff'],
  [/^git\s+log\b/, 'Checking git history'],
  [/^git\s+show\b/, 'Looking at a commit'],
  [/^git\s+branch\b/, 'Checking branches'],
  [/^git\s+fetch\b/, 'Fetching from origin'],
  [/^git\s+pull\b/, 'Pulling latest'],
  [/^git\s+push\b/, 'Pushing'],
  [/^git\s+add\b/, 'Staging changes'],
  [/^git\s+restore\b/, 'Restoring files'],
  [/^git\s+reset\b/, 'Resetting'],
  [/^(get-content|cat)\b/i, (m, ctx) => summariseReadCommand(m.input, ctx.resultText)],
  [/^(head|tail)\b/i, (m, ctx) => summarisePartialReadCommand(m.input, ctx.resultText)],
  [/^(ls|dir|get-childitem)\b/i, (m) => summariseListCommand(m.input)],
  [/^(rg|grep|select-string|findstr)\b/i, (m) => summariseSearchCommand(m.input) || 'Searching files'],
  [/^python\d?\s+-c\b/i, 'Running an inline Python snippet'],
  [/^node\s+-e\b/i, 'Running an inline Node snippet'],
  [/^pwsh\s+-c\b/i, 'Running an inline PowerShell snippet'],
  [/^powershell(?:\.exe)?\s+-command\b/i, 'Running an inline PowerShell command'],
  [/^powershell(?:\.exe)?\b/i, 'Running a PowerShell script'],
  [/^docker\s+ps\b/, 'Listing docker containers'],
  [/^docker\s+build\b/, 'Building a docker image'],
];

function stripLeadingEcho(command) {
  let text = String(command || '').trim();
  for (let i = 0; i < 4; i++) {
    const next = text
      .replace(/^\s*echo\s+["'][^"']{1,120}["']\s*(?:&&|;)\s*/i, '')
      .replace(/^\s*start-sleep\s+(?:-\S+\s+)?\d+(?:\.\d+)?\s*(?:&&|;)\s*/i, '')
      .trim();
    if (next === text) return text;
    text = next;
  }
  return text;
}

function summariseSingleShellCommand(command, resultText = '') {
  for (const [pattern, template] of SHELL_PATTERNS) {
    const match = command.match(pattern);
    if (!match) continue;
    return typeof template === 'function'
      ? template(match, { resultText })
      : phraseFromTemplate(template, match);
  }
  return null;
}

function summariseShellCommand(command, resultText = '') {
  let text = String(command || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Running a shell command';
  text = stripLeadingEcho(text);
  const stages = splitCommandStages(text);
  const head = stages[0] || text;
  const phrase = summariseSingleShellCommand(head, resultText) || 'Running a shell command';
  if (stages.length > 1) return applyTailDescription(phrase, head, stages.slice(1));
  return phrase;
}

function cleanPermissionJustification(justification) {
  let text = String(justification || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  text = text.split(/(?<=[.?])\s+/)[0] || text;
  text = text.replace(/\?+$/g, '').trim();
  text = text.replace(/^do you want to\s+/i, '');
  return text;
}

function toPermissionAction(phrase) {
  const text = String(phrase || '').trim();
  const replacements = [
    [/^Running\s+/i, 'run '],
    [/^Checking\s+/i, 'check '],
    [/^Syncing\s+/i, 'sync '],
    [/^Looking at\s+/i, 'look at '],
    [/^Listing\s+/i, 'list '],
    [/^Editing\s+/i, 'edit '],
    [/^Applying\s+/i, 'apply '],
    [/^Adding\s+/i, 'add '],
    [/^Deleting\s+/i, 'delete '],
    [/^Installing\s+/i, 'install '],
    [/^Building\s+/i, 'build '],
    [/^Pulling\s+/i, 'pull '],
    [/^Pushing\b/i, 'push'],
    [/^Fetching\s+/i, 'fetch '],
  ];
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(text)) return text.replace(pattern, replacement).trim();
  }
  return text ? text[0].toLowerCase() + text.slice(1) : '';
}

function summarisePermissionRequest(args, fallbackCommand) {
  const mode = String((args && args.sandbox_permissions) || '').toLowerCase();
  if (mode !== 'require_escalated') return null;
  const reason = cleanPermissionJustification(args.justification);
  if (reason) {
    if (/^allow\s+/i.test(reason)) {
      return `Codex needs permission for ${reason.replace(/^allow\s+/i, '')}`;
    }
    return `Codex needs permission to ${reason}`;
  }
  const action = toPermissionAction(summariseShellCommand((args && (args.command || args.cmd)) || fallbackCommand || ''));
  return action ? `Codex needs permission to ${action}` : 'Codex needs permission to continue';
}

function prettifyToolName(name) {
  const raw = String(name || '').replace(/^functions\./, '');
  const mcp = raw.match(/^mcp__(?:[^_]+_)*([^_]+)__(.+)$/);
  const cleaned = mcp ? `${mcp[1]} ${mcp[2]}` : raw;
  return cleaned
    .replace(/[_-]+/g, ' ')
    .trim();
}

function extractPatchText(payload) {
  if (payload && payload.tool_input && typeof payload.tool_input === 'object') {
    const cmd = payload.tool_input.command || payload.tool_input.patch;
    if (typeof cmd === 'string' && /\*\*\* (?:Begin Patch|Update File|Add File|Delete File)/.test(cmd)) return cmd;
  }
  const candidates = [
    payload && payload.input,
    payload && payload.content,
    payload && payload.arguments,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /\*\*\* (?:Begin Patch|Update File|Add File|Delete File)/.test(candidate)) {
      return candidate;
    }
    const parsed = parseJsonObjectMaybe(candidate);
    for (const value of Object.values(parsed)) {
      if (typeof value === 'string' && /\*\*\* (?:Begin Patch|Update File|Add File|Delete File)/.test(value)) {
        return value;
      }
    }
  }
  return '';
}

const FUNCTION_DECL_PATTERNS = [
  /^[ \t]*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$-]*)/,
  /^[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  /^[ \t]*def\s+([A-Za-z_]\w*)/,
  /^[ \t]*function\s+([A-Z][A-Za-z]+-[A-Z][A-Za-z]+)/,
  /^[ \t]*(?:export\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/,
];

const CLASS_DECL_PATTERNS = [
  /^[ \t]*(?:export\s+)?class\s+([A-Z][A-Za-z0-9_]*)/,
  /^[ \t]*(?:export\s+)?interface\s+([A-Z][A-Za-z0-9_]*)/,
];

const CONTEXT_SCOPE_PATTERNS = [
  { re: /^[ \t]{0,3}#{1,6}\s+(.{1,100}?)\s*$/, kind: 'section' },
  { re: /^[ \t]*#region\s+(.{1,100}?)\s*$/i, kind: 'section' },
  {
    re: /^[ \t]*(?:\/\/|#|--)\s*(?:section|feature|region|phase|step|panel|toolbar|settings|audio|speech|narration|codex|claude|tts)\s*[:-]\s*(.{1,100}?)\s*$/i,
    kind: 'section',
  },
  { re: /^[ \t]*(?:\/\/|#|--)\s*[-=]{2,}\s*(.{3,100}?)\s*[-=]{2,}\s*$/i, kind: 'section' },
  {
    re: /^[ \t]*\/\*+\s*(?:section|feature|region|phase|step|panel|toolbar|settings|audio|speech|narration|codex|claude|tts)\s*[:-]\s*(.{1,100}?)\s*\*+\/\s*$/i,
    kind: 'section',
  },
  { re: /^[ \t]*\/\*+\s*[-=]{2,}\s*(.{3,100}?)\s*[-=]{2,}\s*\*+\/\s*$/i, kind: 'section' },
  { re: /^[ \t]*(?:test\.)?(?:describe|context)\s*\(\s*['"]([^'"]{1,100})['"]/, kind: 'tests' },
];

const RESERVED_SCOPE_NAMES = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'try', 'else', 'do', 'return',
]);

function naturaliseIdentifier(name) {
  return toWords(String(name || '').replace(/^_+/, ''));
}

function cleanContextLabel(label) {
  let text = String(label || '')
    .replace(/<!--|-->|\/\*+|\*\//g, ' ')
    .replace(/[`*_#~|]+/g, ' ')
    .replace(/[-=]{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[ .:[\](){}/-]+|[ .:[\](){}/-]+$/g, '');
  if (!text) return '';
  text = text.replace(/^(?:section|feature|region|phase|step|panel|toolbar|settings|audio|speech|narration|codex|claude|tts)\s*[:-]\s*/i, '');
  text = text
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (text.length < 3) return '';
  const words = text.split(/\s+/);
  return words.length > 10 ? words.slice(0, 10).join(' ') : text;
}

function extractCodeScopeFromSourceLine(line) {
  const source = String(line || '').replace(/^[+\- ]/, '');
  for (const pattern of FUNCTION_DECL_PATTERNS) {
    const m = source.match(pattern);
    if (m && !RESERVED_SCOPE_NAMES.has(String(m[1]).toLowerCase())) {
      return naturaliseIdentifier(m[1]) || m[1];
    }
  }
  for (const pattern of CLASS_DECL_PATTERNS) {
    const m = source.match(pattern);
    if (m) return naturaliseIdentifier(m[1]) || m[1];
  }
  return '';
}

function extractContextScopeFromSourceLine(line) {
  const source = String(line || '').replace(/^[+\- ]/, '');
  for (const { re, kind } of CONTEXT_SCOPE_PATTERNS) {
    const m = source.match(re);
    if (!m) continue;
    const label = cleanContextLabel(m[1]);
    if (!label) continue;
    return kind === 'tests' ? `the ${label} tests` : `the ${label} section`;
  }
  return '';
}

function extractScopeFromSourceLine(line) {
  return extractCodeScopeFromSourceLine(line) || extractContextScopeFromSourceLine(line);
}

function extractCommentProseScopeFromLine(line) {
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
  const label = cleanContextLabel(source);
  const words = label ? label.split(/\s+/) : [];
  return words.length >= 4 && words.length <= 12 ? `the ${label} area` : '';
}

function stripReadOutputPrefix(line) {
  return String(line || '')
    .replace(ANSI_RE, '')
    .replace(/^\s*\d+\s*(?:→|\||:|\t)\s?/, '')
    .replace(/^\s*(?:Output|Exit code|Wall time):.*$/i, '');
}

function extractVisibleContextScope(text, maxLines = 260) {
  const body = String(text || '');
  if (!body.trim()) return '';
  let codeScope = '';
  let contextScope = '';
  let proseScope = '';
  for (const raw of body.split(/\r?\n/).slice(0, maxLines)) {
    const line = stripReadOutputPrefix(raw);
    if (!line.trim()) continue;
    if (!codeScope) codeScope = extractCodeScopeFromSourceLine(line);
    if (!contextScope) contextScope = extractContextScopeFromSourceLine(line);
    if (!proseScope) proseScope = extractCommentProseScopeFromLine(line);
    if (codeScope && contextScope) break;
  }
  return codeScope || contextScope || proseScope;
}

function extractPatchScope(lines) {
  let nearest = '';
  for (const raw of lines) {
    const line = String(raw || '');
    const header = line.match(/^@@.*?@@\s*(.+)$/);
    if (header) {
      const headerScope = extractScopeFromSourceLine(header[1]);
      if (headerScope) nearest = headerScope;
      continue;
    }
    if (line.startsWith('+')) {
      const addedScope = extractScopeFromSourceLine(line);
      if (addedScope) return addedScope;
    }
    if (line.startsWith(' ') || line.startsWith('-')) {
      const scope = extractScopeFromSourceLine(line);
      if (scope) nearest = scope;
    }
    if ((line.startsWith('+') || line.startsWith('-')) && nearest) return nearest;
  }
  return nearest;
}

function analysePatch(patch) {
  const files = [];
  let current = null;
  for (const line of String(patch || '').split(/\r?\n/)) {
    const fileMatch = line.match(/^\*\*\* (Update|Add|Delete) File:\s+(.+)$/);
    if (fileMatch) {
      current = {
        action: fileMatch[1].toLowerCase(),
        path: fileMatch[2].trim(),
        added: 0,
        removed: 0,
        firstNewLine: 0,
        lines: [],
        scope: '',
      };
      files.push(current);
      continue;
    }
    if (!current) continue;
    current.lines.push(line);
    const hunk = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?/);
    if (hunk && !current.firstNewLine) {
      current.firstNewLine = Number.parseInt(hunk[1], 10) || 0;
      continue;
    }
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('***')) continue;
    if (line.startsWith('+')) current.added++;
    else if (line.startsWith('-')) current.removed++;
  }
  for (const file of files) file.scope = extractPatchScope(file.lines);
  return files;
}

function formatLineDelta(added, removed) {
  if (added > 0 && removed > 0) {
    return `adding ${formatCount(added, 'line')} and removing ${formatCount(removed, 'line')}`;
  }
  if (added > 0) return `adding ${formatCount(added, 'line')}`;
  if (removed > 0) return `removing ${formatCount(removed, 'line')}`;
  return '';
}

function summarisePatchToolCall(payload) {
  const patch = extractPatchText(payload);
  if (!patch) return 'Applying a code patch';
  const files = analysePatch(patch);
  if (files.length === 0) return 'Applying a code patch';
  if (files.length > 1) {
    const added = files.reduce((sum, file) => sum + file.added, 0);
    const removed = files.reduce((sum, file) => sum + file.removed, 0);
    const counts = formatLineDelta(added, removed);
    return counts ? `Applying a code patch to ${files.length} files, ${counts}` : `Applying a code patch to ${files.length} files`;
  }
  const file = files[0];
  const natural = naturalisePath(file.path);
  if (file.action === 'add') {
    return file.added > 0 ? `Adding ${natural}, ${formatCount(file.added, 'line')}` : `Adding ${natural}`;
  }
  if (file.action === 'delete') {
    return file.removed > 0 ? `Deleting ${natural}, ${formatCount(file.removed, 'line')}` : `Deleting ${natural}`;
  }
  const locality = file.scope
    ? ` around ${file.scope}`
    : (file.firstNewLine ? ` around line ${file.firstNewLine}` : '');
  const counts = formatLineDelta(file.added, file.removed);
  return counts ? `Editing ${natural}${locality}, ${counts}` : `Editing ${natural}${locality}`;
}

function extractResultText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractResultText).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    return ['content', 'text', 'output', 'stdout', 'aggregated_output', 'stderr']
      .map((key) => extractResultText(value[key]))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function resultTextFromToolPayload(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return extractResultText(
    payload.tool_result
    || payload.toolResult
    || payload.result
    || payload.output
    || payload.stdout
    || payload.aggregated_output,
  );
}

function wantsCodexToolResultContext(eventOrPhrase) {
  const phrase = typeof eventOrPhrase === 'string'
    ? eventOrPhrase
    : String((eventOrPhrase && eventOrPhrase.phrase) || '');
  if (!phrase || /\baround\b/i.test(phrase)) return false;
  return /^(?:Looking at|Reading|Checking)(?: part of)?\b/.test(phrase);
}

function enrichCodexToolPhraseWithResult(phrase, resultText) {
  if (!wantsCodexToolResultContext(phrase)) return phrase;
  const scope = extractVisibleContextScope(resultText);
  return scope ? `${phrase} around ${scope}` : phrase;
}

function narrateCodexToolCallPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const toolName = String(payload.name || payload.tool_name || '').trim();
  if (!toolName) return null;
  const name = toolName.replace(/^functions\./, '');
  if (name === 'update_plan') return null;
  if (['shell_command', 'Bash', 'bash', 'shell'].includes(name)) {
    const args = payload.tool_input && typeof payload.tool_input === 'object'
      ? payload.tool_input
      : parseJsonObjectMaybe(payload.arguments);
    const permissionPhrase = summarisePermissionRequest(args, args.command || args.cmd || '');
    if (permissionPhrase) return permissionPhrase;
    return summariseShellCommand(args.command || args.cmd || '', resultTextFromToolPayload(payload));
  }
  if (['apply_patch', 'Edit', 'Write'].includes(name)) return summarisePatchToolCall(payload);
  const label = prettifyToolName(name);
  return label ? `Using ${label}` : null;
}

function extractCodexToolCallEvent(line) {
  if (!line || !line.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (parsed.type !== 'response_item') return null;
  const payload = parsed.payload || {};
  if (!TOOL_EVENT_TYPES.has(payload.type)) return null;
  const phrase = narrateCodexToolCallPayload(payload);
  if (!phrase) return null;
  return {
    timestamp: parsed.timestamp || '',
    callId: String(payload.call_id || payload.id || ''),
    toolName: String(payload.name || ''),
    phrase,
  };
}

function extractCodexToolOutputEvent(line) {
  if (!line || !line.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const payload = parsed.payload || {};
  if (parsed.type === 'event_msg' && payload.type === 'exec_command_end') {
    const output = payload.aggregated_output || payload.stdout || payload.stderr || '';
    if (!payload.call_id || !output) return null;
    return {
      timestamp: parsed.timestamp || '',
      callId: String(payload.call_id || ''),
      output: String(output),
    };
  }
  if (parsed.type === 'response_item' && payload.type === 'function_call_output') {
    if (!payload.call_id || !payload.output) return null;
    return {
      timestamp: parsed.timestamp || '',
      callId: String(payload.call_id || ''),
      output: String(payload.output),
    };
  }
  return null;
}

module.exports = {
  extractCodexToolCallEvent,
  extractCodexToolOutputEvent,
  enrichCodexToolPhraseWithResult,
  leadingToolVerb,
  narrateCodexToolCallPayload,
  naturalisePath,
  summariseShellCommand,
  varyToolPhrase,
  wantsCodexToolResultContext,
};
