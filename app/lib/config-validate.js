// Hand-rolled config validator. Checks each expected top-level key's shape
// against a small rules table. If ANY rule fails, the whole config is
// rejected and callers should fall back to defaults. No `ajv` dep — the
// config shape is small and the rules here are tight enough.
//
// If the config shape grows materially, swap in ajv (tracked as D2-5).

const RULES = [
  { path: 'voices',          type: 'object' },
  // F1 (#11): voice keys that the UI writes + runtime consumes. Each
  // Settings dropdown routes through `update-config`; bad hand-edits
  // (empty string, > 80 chars, non-string) would otherwise land in
  // callEdgeTTS / callOpenAITTS / speak-response.ps1 and either crash
  // the synth or produce silent audio.
  { path: 'voices.edge_response', type: 'string', maxLen: 80 },
  { path: 'voices.edge_clip',     type: 'string', maxLen: 80 },
  { path: 'voices.openai_response', type: 'string', maxLen: 80 },
  { path: 'voices.openai_clip',     type: 'string', maxLen: 80 },
  // F3 (#11): `voices.edge_question` + `voices.edge_notification`
  // removed 2026-04-25 — zero runtime consumers across app/ + hooks/.
  // questions-first extraction was retired 2026-04-22 (synth_turn.py);
  // speak-notification.ps1 reads edge_response, not edge_notification.
  // Keeping them in RULES was a vestigial no-op that documentation
  // (README + config.schema.json) continued to advertise to users.
  { path: 'hotkeys',         type: 'object' },
  { path: 'playback',        type: 'object' },
  { path: 'playback.speed',  type: 'number', min: 0.25, max: 4.0 },
  { path: 'playback.master_volume', type: 'number', min: 0.0, max: 1.0 },
  { path: 'playback.auto_prune', type: 'boolean' },
  { path: 'playback.auto_prune_sec', type: 'number', min: 1, max: 600 },
  { path: 'playback.auto_continue_after_click', type: 'boolean' },
  { path: 'playback.palette_variant', type: 'string', maxLen: 16 },
  // TTS provider preference. 'edge' (default) tries Microsoft edge-tts
  // first and only falls back to OpenAI on failure. 'openai' flips the
  // order — tries OpenAI first (needs openai_api_key set), falls back
  // to edge-tts if OpenAI errors. Consumers (synth_turn.py +
  // tts-helper.psm1) default to 'edge' for any unrecognised value.
  { path: 'playback.tts_provider', type: 'string', maxLen: 16 },
  { path: 'speech_includes', type: 'object' },
  // F2 (#11): every sub-key in DEFAULTS.speech_includes (main.js) now
  // has a corresponding validator rule. Prior to this the parent object
  // was declared but sub-keys could hold any value — a partial write of
  // `{ speech_includes: { urls: 'yes' }}` would merge + pass validation
  // and the sanitiser's truthy-check would enable URL speech despite the
  // non-boolean value. All 7 sub-keys enumerate here (including
  // `tool_calls`, exposed via per-session override in renderer.js).
  { path: 'speech_includes.code_blocks',    type: 'boolean' },
  { path: 'speech_includes.inline_code',    type: 'boolean' },
  { path: 'speech_includes.urls',           type: 'boolean' },
  { path: 'speech_includes.headings',       type: 'boolean' },
  { path: 'speech_includes.bullet_markers', type: 'boolean' },
  { path: 'speech_includes.image_alt',      type: 'boolean' },
  { path: 'speech_includes.tool_calls',     type: 'boolean' },
  // HB1 — heartbeat toggle. Default true in DEFAULTS; users disable
  // via settings or by writing false to config.json.
  { path: 'heartbeat_enabled', type: 'boolean' },
  // Experimental Haiku narrator. Off by default — when on, the Stop
  // hook spawns a separate claude --print --model <model> invocation
  // that produces a speakable summary clip alongside the existing
  // streaming pipeline. See DEFAULTS.narrator in app/main.js.
  { path: 'narrator',          type: 'object' },
  { path: 'narrator.enabled',  type: 'boolean' },
  { path: 'narrator.model',    type: 'string', maxLen: 64 },
  { path: 'openai_api_key',  type: ['string', 'null'], maxLen: 200 },
  { path: 'selected_tab',    type: 'string',  maxLen: 64 },
  { path: 'tabs_expanded',   type: 'boolean' },
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
