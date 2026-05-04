'use strict';

const VALID_TTS_PROVIDERS = new Set(['edge', 'openai']);
const VALID_FALLBACK_PROVIDERS = new Set(['edge', 'openai', 'none']);

function normaliseTtsProvider(value, fallback = 'edge') {
  const provider = String(value || '').toLowerCase();
  return VALID_TTS_PROVIDERS.has(provider) ? provider : fallback;
}

function normaliseFallbackProvider(value, fallback = 'edge') {
  const provider = String(value || '').toLowerCase();
  return VALID_FALLBACK_PROVIDERS.has(provider) ? provider : fallback;
}

function resolveTtsRouting(playback = {}) {
  const primary = normaliseTtsProvider(playback.tts_provider, 'edge');
  const fallback = normaliseFallbackProvider(playback.tts_fallback_provider, 'edge');
  return { primary, fallback };
}

function providerOrder(playback = {}) {
  const { primary, fallback } = resolveTtsRouting(playback);
  const providers = [primary];
  if (fallback === 'none') return providers;
  const resolvedFallback = (fallback === primary && primary === 'openai') ? 'edge' : fallback;
  if (resolvedFallback !== primary) providers.push(resolvedFallback);
  return providers;
}

module.exports = {
  providerOrder,
};
