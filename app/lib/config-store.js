'use strict';

// EX6a — extracted from app/main.js as part of the v0.4 big-file
// refactor. Wraps loadConfig + saveConfig with atomic-write
// semantics and merge-with-defaults behaviour.
//
// Design: factory-based so the unit harness can inject a fake
// `validator`, `logger`, and `configPath` without pulling in
// Electron. The factory-returned `{ load, save }` pair is the
// sole public API.
//
// Behaviour preserved byte-for-byte from the original main.js
// implementation (see commit history pre-EX6a for rationale):
//   - load() returns DEFAULTS on parse error or validation failure.
//   - Invalid configs are ARCHIVED to <path>.invalid-<ts> before
//     falling back to DEFAULTS, so a user can recover a hand-edit
//     we rejected by mistake.
//   - save() writes to <path>.tmp then renames — crash-safe.

const fs = require('node:fs');

function createConfigStore({ configPath, defaults, validator, logger }) {
  if (!configPath) throw new Error('createConfigStore: configPath required');
  if (!defaults) throw new Error('createConfigStore: defaults required');
  if (typeof validator !== 'function') throw new Error('createConfigStore: validator must be a function');
  const log = typeof logger === 'function' ? logger : () => {};

  function load() {
    let parsed;
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      parsed = JSON.parse(raw);
    } catch { return defaults; }
    const v = validator(parsed);
    if (!v.ok) {
      try {
        const archivePath = configPath + '.invalid-' + Date.now();
        fs.renameSync(configPath, archivePath);
        log(`config.json invalid (${v.violations.join('; ')}) — archived to ${archivePath}; using DEFAULTS`);
      } catch (e) {
        log(`config.json invalid (${v.violations.join('; ')}); archive failed: ${e.message}`);
      }
      return defaults;
    }
    return {
      voices: { ...defaults.voices, ...(parsed.voices || {}) },
      hotkeys: { ...defaults.hotkeys, ...(parsed.hotkeys || {}) },
      playback: { ...defaults.playback, ...(parsed.playback || {}) },
      speech_includes: { ...defaults.speech_includes, ...(parsed.speech_includes || {}) },
      window: parsed.window && typeof parsed.window === 'object' ? parsed.window : null,
      openai_api_key: parsed.openai_api_key ?? null,
    };
  }

  function save(cfg) {
    // Atomic: write to .tmp first, then rename. A crash mid-write leaves
    // either the old config or the new config intact — never a half-
    // written file.
    try {
      const tmp = configPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
      fs.renameSync(tmp, configPath);
      return true;
    } catch (e) {
      log(`saveConfig fail: ${e.message}`);
      return false;
    }
  }

  return { load, save };
}

module.exports = { createConfigStore };
