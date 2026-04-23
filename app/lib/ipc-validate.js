'use strict';

// EX6e — extracted from app/main.js as part of the v0.4 big-file
// refactor. Input-validation helpers for IPC handler args.
//
// Every IPC handler that mutates state ran these checks inline in
// main.js. Pulling them into a module:
//   - makes each validator unit-testable without Electron;
//   - keeps main.js focused on orchestration;
//   - lets future IPC handlers reuse the same shape without
//     copy-pasting the regex/length bounds.
//
// The HARDENING: input validation + HARDENING: voice id validation
// test groups in scripts/run-tests.cjs already exercise these
// patterns via source-grep; this extraction preserves their
// semantics byte-for-byte.

const SHORT_RE = /^[a-f0-9]{8}$/;
const VOICE_RE = /^[A-Za-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z]+(?:Multilingual|Expressive)?Neural$|^(alloy|echo|fable|onyx|nova|shimmer)$/;
// KEEP IN SYNC with VALID_INCLUDE_KEYS in app/main.js — the IPC gate
// (this set) rejects any key not listed, and the disk sanitiser
// (main.js set) drops any key not listed on read. A mismatch means
// "UI lets you toggle it, IPC silently refuses to save" — exactly the
// class of bug that hid tool_calls from persistence for weeks.
const ALLOWED_INCLUDE_KEYS = new Set(['code_blocks', 'inline_code', 'urls', 'headings', 'bullet_markers', 'image_alt', 'tool_calls']);
const MAX_LABEL_LEN = 60;
const MAX_VOICE_LEN = 80;

function validShort(s) {
  return typeof s === 'string' && SHORT_RE.test(s);
}

function validVoice(s) {
  return typeof s === 'string' && s.length <= MAX_VOICE_LEN && VOICE_RE.test(s);
}

function sanitiseLabel(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\r\n\t]/g, ' ').slice(0, MAX_LABEL_LEN).trim();
}

module.exports = {
  validShort,
  validVoice,
  sanitiseLabel,
  ALLOWED_INCLUDE_KEYS,
};
