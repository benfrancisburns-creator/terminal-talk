'use strict';

// Registry entry sanitiser — extracted from app/main.js 2026-04-26 to
// keep main.js under the 2000-line absolute ceiling while adding the
// pending_adopt round-trip preservation that Option C continuation
// prompts depend on.
//
// Pure function: caller injects the regex + valid-include-key set so
// the same constants stay defined exactly once in main.js. Validates
// every field that lands in the on-disk registry; anything malformed
// gets dropped silently rather than letting a corrupt entry poison
// the whole assignments map.

function createRegistrySanitiser({ shortKeyRe, voiceKeyRe, validIncludeKeys }) {
  function sanitiseEntry(e) {
    if (!e || typeof e !== 'object') return null;
    const idx = Number(e.index);
    if (!Number.isFinite(idx) || idx < 0 || idx > 23) return null;
    const out = {
      index: Math.floor(idx),
      session_id: typeof e.session_id === 'string' ? e.session_id.slice(0, 80) : '',
      claude_pid: Number.isFinite(Number(e.claude_pid)) ? Number(e.claude_pid) : 0,
      label: typeof e.label === 'string' ? e.label.slice(0, 60) : '',
      pinned: e.pinned === true,
      muted: e.muted === true,
      focus: e.focus === true,
      last_seen: Number.isFinite(Number(e.last_seen)) ? Number(e.last_seen) : 0,
    };
    if (typeof e.voice === 'string' && e.voice.length <= 80 && voiceKeyRe.test(e.voice)) {
      out.voice = e.voice;
    }
    if (e.speech_includes && typeof e.speech_includes === 'object') {
      const inc = {};
      for (const k of Object.keys(e.speech_includes)) {
        if (validIncludeKeys.has(k) && typeof e.speech_includes[k] === 'boolean') {
          inc[k] = e.speech_includes[k];
        }
      }
      if (Object.keys(inc).length > 0) out.speech_includes = inc;
    }
    // pending_adopt — stashed by Update-SessionAssignment when /clear
    // migrates voice / speech_includes overrides; cleared by resolve-
    // session-continuation. Re-validate to stop a corrupt stash from
    // smuggling in invalid voices / speech keys on round-trip.
    const p = e.pending_adopt;
    if (p && typeof p === 'object') {
      const c = {};
      if (typeof p.voice === 'string' && p.voice.length <= 80 && voiceKeyRe.test(p.voice)) c.voice = p.voice;
      if (p.speech_includes && typeof p.speech_includes === 'object') {
        const inc = {};
        for (const k of Object.keys(p.speech_includes)) {
          if (validIncludeKeys.has(k) && typeof p.speech_includes[k] === 'boolean') inc[k] = p.speech_includes[k];
        }
        if (Object.keys(inc).length > 0) c.speech_includes = inc;
      }
      if (typeof p.from_short === 'string' && shortKeyRe.test(p.from_short)) c.from_short = p.from_short;
      if (Number.isFinite(Number(p.created_at))) c.created_at = Number(p.created_at);
      if (c.voice || c.speech_includes) out.pending_adopt = c;
    }
    return out;
  }
  return { sanitiseEntry };
}

module.exports = { createRegistrySanitiser };
