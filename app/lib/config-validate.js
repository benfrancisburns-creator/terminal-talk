// Hand-rolled config validator. Checks each expected top-level key's shape
// against a small rules table. If ANY rule fails, the whole config is
// rejected and callers should fall back to defaults. No `ajv` dep — the
// config shape is small and the rules here are tight enough.
//
// If the config shape grows materially, swap in ajv (tracked as D2-5).

const RULES = [
  { path: 'voices',          type: 'object' },
  { path: 'voices.edge_response',  type: 'string', maxLen: 80 },
  { path: 'voices.edge_question',  type: 'string', maxLen: 80 },
  { path: 'voices.edge_notification', type: 'string', maxLen: 80 },
  { path: 'hotkeys',         type: 'object' },
  { path: 'playback',        type: 'object' },
  { path: 'playback.speed',  type: 'number', min: 0.25, max: 4.0 },
  { path: 'playback.auto_prune', type: 'boolean' },
  { path: 'playback.auto_prune_sec', type: 'number', min: 1, max: 600 },
  { path: 'playback.auto_continue_after_click', type: 'boolean' },
  { path: 'playback.palette_variant', type: 'string', maxLen: 16 },
  { path: 'speech_includes', type: 'object' },
  { path: 'openai_api_key',  type: ['string', 'null'], maxLen: 200 },
];

function getPath(obj, path) {
  let cur = obj;
  for (const segment of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[segment];
  }
  return cur;
}

function validateRule(value, rule) {
  if (value === undefined) return { ok: true };   // optional keys — missing is fine, defaults fill in
  const types = Array.isArray(rule.type) ? rule.type : [rule.type];
  const actualType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (!types.includes(actualType)) {
    return { ok: false, reason: `${rule.path}: expected ${types.join('|')}, got ${actualType}` };
  }
  if (actualType === 'string' && rule.maxLen !== undefined && value.length > rule.maxLen) {
    return { ok: false, reason: `${rule.path}: string too long (${value.length} > ${rule.maxLen})` };
  }
  if (actualType === 'number') {
    if (rule.min !== undefined && value < rule.min) return { ok: false, reason: `${rule.path}: ${value} < min ${rule.min}` };
    if (rule.max !== undefined && value > rule.max) return { ok: false, reason: `${rule.path}: ${value} > max ${rule.max}` };
  }
  return { ok: true };
}

function validateConfig(obj) {
  if (!obj || typeof obj !== 'object') {
    return { ok: false, violations: ['root: not an object'] };
  }
  const violations = [];
  for (const rule of RULES) {
    const value = getPath(obj, rule.path);
    const r = validateRule(value, rule);
    if (!r.ok) violations.push(r.reason);
  }
  return { ok: violations.length === 0, violations };
}

module.exports = { validateConfig, RULES };
