'use strict';

const voices = require('./voices.json');

// Start with the voices Ben is already using/likes in the live setup:
// Natasha, Sonia and Ryan are the current favourites. Thomas and Libby
// are the next-best demo voices; avoid the less natural voices until
// these have been used.
const PREFERRED_AUTO_EDGE_VOICES = Object.freeze([
  'en-AU-NatashaNeural',
  'en-GB-SoniaNeural',
  'en-GB-RyanNeural',
  'en-GB-ThomasNeural',
  'en-GB-LibbyNeural',
]);

const AUTO_EDGE_VOICE_ORDER = Object.freeze([
  ...PREFERRED_AUTO_EDGE_VOICES,
  ...(voices.edge || []).map((v) => v && v.id).filter(Boolean),
].filter((id, idx, arr) => arr.indexOf(id) === idx));

function shouldAutoAssignVoice(entry) {
  return !!entry && !entry.voice && entry.voice_auto !== false;
}

function hasManualVoiceIntent(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.voice === 'string' && entry.voice.length > 0 && entry.voice_auto !== true) return true;
  return entry.voice_auto === false;
}

function allocateAutoVoice(assignments = {}, order = AUTO_EDGE_VOICE_ORDER) {
  const voiceOrder = Array.isArray(order) && order.length > 0 ? order : AUTO_EDGE_VOICE_ORDER;
  const counts = new Map();
  for (const id of voiceOrder) counts.set(id, 0);
  for (const entry of Object.values(assignments || {})) {
    if (!entry || entry.muted === true || typeof entry.voice !== 'string' || !counts.has(entry.voice)) continue;
    counts.set(entry.voice, (counts.get(entry.voice) || 0) + 1);
  }

  for (const id of voiceOrder) {
    if ((counts.get(id) || 0) === 0) {
      return { voice: id, reason: 'free' };
    }
  }

  let best = voiceOrder[0];
  let bestCount = counts.get(best) || 0;
  for (const id of voiceOrder) {
    const count = counts.get(id) || 0;
    if (count < bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return { voice: best, reason: 'least-used' };
}

function ensureAutoVoice(entry, assignments = {}, order = AUTO_EDGE_VOICE_ORDER) {
  if (!shouldAutoAssignVoice(entry)) return null;
  const alloc = allocateAutoVoice(assignments, order);
  entry.voice = alloc.voice;
  entry.voice_auto = true;
  return alloc;
}

module.exports = {
  PREFERRED_AUTO_EDGE_VOICES,
  AUTO_EDGE_VOICE_ORDER,
  allocateAutoVoice,
  ensureAutoVoice,
  hasManualVoiceIntent,
  shouldAutoAssignVoice,
};
