'use strict';

// Registry write-path guard + delta helpers — extracted from app/main.js
// 2026-04-25 to bring main.js under the 2000-line absolute ceiling.
//
// Three concerns colocated here:
//
//   1. `writeDelta(newAll)` — read on-disk registry, diff against incoming
//      payload, return { count, added, removed, changed }. Used by the
//      Batch 1 G1+G3 observability log lines.
//
//   2. `USER_INTENT_WRITERS` — set of IPC handler names allowed to clear
//      label / pinned / manual voice / muted / focus / heartbeat / speech_includes. Any
//      writer NOT in this set goes through the guard.
//
//   3. `guardUserIntent(all, caller)` — defensive restoration. For any
//      caller outside USER_INTENT_WRITERS, reads the on-disk entry; if
//      the incoming payload would WIPE a user-intent field that the
//      disk has, restore it. Two restoration modes — per-field (entry
//      exists in both) and missing-entry (disk has an entry the payload
//      lacks; restore unless PID-migrated to a different short).
//
// Factory pattern: caller injects `registryPath` + `fs` so the unit
// harness can mock disk reads. `fs` defaults to node:fs for production
// callers.

const realFs = require('node:fs');

function _hasUserIntent(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.label === 'string' && entry.label.length > 0 && entry.auto_label !== true) return true;
  if (entry.pinned === true) return true;
  if (typeof entry.voice === 'string' && entry.voice.length > 0 && entry.voice_auto !== true) return true;
  if (entry.voice_auto === false) return true;
  if (entry.muted === true) return true;
  if (entry.focus === true) return true;
  if (typeof entry.heartbeat_enabled === 'boolean') return true;
  if (entry.speech_includes && typeof entry.speech_includes === 'object' &&
      Object.keys(entry.speech_includes).length > 0) return true;
  return false;
}

function _readDiskRegistry(registryPath, fs) {
  try {
    let raw = fs.readFileSync(registryPath, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    const parsed = JSON.parse(raw);
    if (parsed && parsed.assignments && typeof parsed.assignments === 'object') {
      return parsed.assignments;
    }
  } catch { /* missing or parse-failure — caller treats as empty */ }
  return {};
}

const USER_INTENT_WRITERS = new Set([
  'set-session-label',
  'set-session-index',
  'set-session-voice',
  'set-session-muted',
  'set-session-focus',
  'set-session-include',
  'set-session-heartbeat',
  'remove-session',
  'codex-plugin-cleanup',
]);

const METADATA_FIELDS = [
  'source_kind',
  'source_label',
  'source_app',
  'source_cwd',
  'source',
  'source_originator',
  'source_pid',
  'source_child_pid',
  'source_key',
  'adapter',
  'claude_code_entrypoint',
  'codex_desktop_title_status',
  'codex_desktop_title',
  'codex_desktop_title_error',
  'claude_desktop_title_status',
  'claude_desktop_title',
  'claude_desktop_title_error',
  'claude_desktop_title_synced_at',
  'claude_desktop_session_file',
  'claude_desktop_renderer_title',
];

const CAPABILITY_FIELDS = [
  'auto_register',
  'tool_events',
  'response_events',
  'mcp_speak',
  'manual_speak_selection',
];

function createRegistryGuard({ registryPath, fs = realFs } = {}) {
  if (!registryPath) {
    throw new Error('createRegistryGuard: registryPath required');
  }

  function writeDelta(newAll) {
    const oldAll = _readDiskRegistry(registryPath, fs);
    const oldKeys = Object.keys(oldAll);
    const newKeys = Object.keys(newAll);
    const newSet = new Set(newKeys);
    const oldSet = new Set(oldKeys);
    const added = newKeys.filter((k) => !oldSet.has(k));
    const removed = oldKeys.filter((k) => !newSet.has(k));
    const changed = [];
    for (const k of newKeys) {
      if (!oldSet.has(k)) continue;
      if (JSON.stringify(oldAll[k]) !== JSON.stringify(newAll[k])) changed.push(k);
    }
    return { count: newKeys.length, added, removed, changed };
  }

  function guardUserIntent(all, caller) {
    // Returns a list of "{short}:{field}" or "{short}:*missing*" tokens
    // that were restored, or [] if no restoration happened. Best-effort
    // — if the disk read fails, we fall through without restoration
    // (the bare write still happens).
    //
    // Two restoration modes:
    //   1. FIELD restoration — entry exists in both disk and payload but
    //      the payload's entry has fewer user-intent fields. Restore the
    //      disk's field value.
    //   2. ENTRY restoration — entry exists on disk with user-intent but
    //      is completely missing from the payload. This fires when a
    //      statusline / hook race reads-empty-then-writes, dropping the
    //      other terminal's entry entirely. Add the disk entry back.
    if (USER_INTENT_WRITERS.has(caller)) return [];
    const oldAll = _readDiskRegistry(registryPath, fs);
    if (Object.keys(oldAll).length === 0) return [];
    const restored = [];
    // PID-migration exclusion. Update-SessionAssignment legitimately re-keys
    // an entry from old-short to new-short on /clear (matching by claude_pid,
    // moving label/pinned/voice/speech_includes to the new short, removing
    // the old). Without this exclusion, the missing-entry restoration below
    // would add the old short back, duplicating the entry. Detect by pid
    // match between any payload entry and the disk's missing entry.
    const payloadPids = new Map();
    for (const short of Object.keys(all)) {
      const entry = all[short];
      if (!entry || typeof entry !== 'object') continue;
      const pid = Number(entry.claude_pid);
      if (Number.isFinite(pid) && pid > 0) payloadPids.set(pid, short);
    }
    // Missing-entry restoration. Any disk entry with user-intent that's
    // absent from the payload gets re-added verbatim — UNLESS its pid
    // appears under a different short in the payload (PID migration).
    for (const short of Object.keys(oldAll)) {
      if (Object.prototype.hasOwnProperty.call(all, short)) continue;
      if (!_hasUserIntent(oldAll[short])) continue;
      const oldPid = Number(oldAll[short].claude_pid);
      if (oldPid > 0 && payloadPids.has(oldPid)) continue;  // migration
      all[short] = oldAll[short];
      restored.push(`${short}:*missing*`);
    }
    // Per-field restoration on entries present in both.
    for (const short of Object.keys(all)) {
      const oldEntry = oldAll[short];
      if (!oldEntry) continue;
      const newEntry = all[short];
      if (!newEntry || typeof newEntry !== 'object') continue;
      if (typeof oldEntry.label === 'string' && oldEntry.label.length > 0 && oldEntry.auto_label !== true &&
          (typeof newEntry.label !== 'string' || newEntry.label.length === 0)) {
        newEntry.label = oldEntry.label;
        restored.push(`${short}:label`);
      }
      if (oldEntry.pinned === true && newEntry.pinned !== true) {
        newEntry.pinned = true;
        restored.push(`${short}:pinned`);
      }
      // Index restoration. Touch-path writers (codex-session-watcher,
      // speak-on-tool, speak-response, statusline) load the registry,
      // touch bookkeeping, and write back. If the user changed the
      // palette index between their load and write, the stale payload
      // would clobber the user's choice. Restore from disk when the
      // entry has user-intent and indices differ. set-session-index is
      // in USER_INTENT_WRITERS so it short-circuits before reaching
      // here, leaving its own writes intact.
      if (_hasUserIntent(oldEntry) &&
          Number.isFinite(Number(oldEntry.index)) &&
          Number(oldEntry.index) !== Number(newEntry.index)) {
        newEntry.index = Number(oldEntry.index);
        restored.push(`${short}:index`);
      }
      if (oldEntry.voice_auto === false && newEntry.voice_auto !== false) {
        newEntry.voice_auto = false;
        restored.push(`${short}:voice_auto`);
      }
      if (typeof oldEntry.voice === 'string' && oldEntry.voice && oldEntry.voice_auto !== true && !newEntry.voice) {
        newEntry.voice = oldEntry.voice;
        restored.push(`${short}:voice`);
      }
      if (oldEntry.muted === true && newEntry.muted !== true) {
        newEntry.muted = true;
        restored.push(`${short}:muted`);
      }
      if (oldEntry.focus === true && newEntry.focus !== true) {
        newEntry.focus = true;
        restored.push(`${short}:focus`);
      }
      if (typeof oldEntry.heartbeat_enabled === 'boolean' &&
          typeof newEntry.heartbeat_enabled !== 'boolean') {
        newEntry.heartbeat_enabled = oldEntry.heartbeat_enabled;
        restored.push(`${short}:heartbeat_enabled`);
      }
      if (oldEntry.speech_includes && typeof oldEntry.speech_includes === 'object' &&
          Object.keys(oldEntry.speech_includes).length > 0 &&
          (!newEntry.speech_includes || Object.keys(newEntry.speech_includes).length === 0)) {
        newEntry.speech_includes = oldEntry.speech_includes;
        restored.push(`${short}:speech_includes`);
      }
      if (oldEntry.capabilities && typeof oldEntry.capabilities === 'object') {
        if (!newEntry.capabilities || typeof newEntry.capabilities !== 'object') {
          newEntry.capabilities = {};
        }
        for (const field of CAPABILITY_FIELDS) {
          if (typeof oldEntry.capabilities[field] === 'boolean' &&
              typeof newEntry.capabilities[field] !== 'boolean') {
            newEntry.capabilities[field] = oldEntry.capabilities[field];
            restored.push(`${short}:capabilities.${field}`);
          }
        }
      }
      for (const field of METADATA_FIELDS) {
        if (typeof oldEntry[field] === 'string' && oldEntry[field] &&
            (typeof newEntry[field] !== 'string' || !newEntry[field])) {
          newEntry[field] = oldEntry[field];
          restored.push(`${short}:${field}`);
        }
      }
      if (Number.isFinite(Number(oldEntry.codex_desktop_title_synced_at)) &&
          !Number.isFinite(Number(newEntry.codex_desktop_title_synced_at))) {
        newEntry.codex_desktop_title_synced_at = Math.floor(Number(oldEntry.codex_desktop_title_synced_at));
        restored.push(`${short}:codex_desktop_title_synced_at`);
      }
      if (Number.isFinite(Number(oldEntry.claude_desktop_title_synced_at)) &&
          !Number.isFinite(Number(newEntry.claude_desktop_title_synced_at))) {
        newEntry.claude_desktop_title_synced_at = Math.floor(Number(oldEntry.claude_desktop_title_synced_at));
        restored.push(`${short}:claude_desktop_title_synced_at`);
      }
    }
    return restored;
  }

  return { writeDelta, guardUserIntent, USER_INTENT_WRITERS, hasUserIntent: _hasUserIntent };
}

// USER_INTENT_WRITERS is intentionally NOT a top-level export. Callers
// access the set via the factory return (`createRegistryGuard().USER_INTENT_WRITERS`).
// Exporting at top level too triggered Knip's unused-export rule.
module.exports = { createRegistryGuard };
