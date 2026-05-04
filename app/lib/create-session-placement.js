'use strict';

const POS_RE = /^-?\d+,-?\d+$/;
const SIZE_RE = /^\d+,\d+$/;
const BOUNDS_RE = /^-?\d+,-?\d+,\d+,\d+$/;

function cleanValue(value, re) {
  const text = typeof value === 'string' ? value.trim() : '';
  return re.test(text) ? text : '';
}

function objectSpec(raw) {
  if (typeof raw === 'string') return { windowBounds: raw };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  return {};
}

function firstString(spec, keys) {
  for (const key of keys) {
    if (typeof spec[key] === 'string') return spec[key];
  }
  return '';
}

function normaliseCreateSessionWindowPlacement(raw) {
  const spec = objectSpec(raw);
  const placement = {};
  const windowPosition = cleanValue(firstString(spec, ['windowPosition', 'windowPos', 'position', 'pos']), POS_RE);
  const windowSize = cleanValue(firstString(spec, ['windowSize', 'size']), SIZE_RE);
  const windowBounds = cleanValue(firstString(spec, ['windowBounds', 'bounds', 'rect']), BOUNDS_RE);
  if (windowPosition) placement.windowPosition = windowPosition;
  if (windowSize) placement.windowSize = windowSize;
  if (windowBounds) placement.windowBounds = windowBounds;
  return placement;
}

function hasPlacement(placement) {
  return !!(placement && (placement.windowPosition || placement.windowSize || placement.windowBounds));
}

function placementCandidateKeys(kind, label, index) {
  const kindKey = String(kind || '').trim().toLowerCase();
  const labelText = String(label || '').trim();
  const labelSlug = labelText.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const n = Number(index);
  const indexText = Number.isFinite(n) ? String(Math.max(0, Math.min(23, Math.floor(n)))) : '';
  const keys = [
    kindKey && labelText ? `${kindKey}:${labelText}` : '',
    labelText,
    kindKey && labelSlug ? `${kindKey}:${labelSlug}` : '',
    labelSlug,
    kindKey && indexText ? `${kindKey}:${indexText}` : '',
    indexText,
    kindKey,
  ];
  return keys.filter((key, i) => key && keys.indexOf(key) === i);
}

function resolveCreateSessionWindowPlacement({ payload, panels, kind, label, index } = {}) {
  const direct = normaliseCreateSessionWindowPlacement(payload);
  const placementMap = panels && typeof panels === 'object' && !Array.isArray(panels)
    ? panels.create_session_window_placements
    : null;
  let mapped = {};
  if (placementMap && typeof placementMap === 'object' && !Array.isArray(placementMap)) {
    for (const key of placementCandidateKeys(kind, label, index)) {
      mapped = normaliseCreateSessionWindowPlacement(placementMap[key]);
      if (hasPlacement(mapped)) break;
    }
  }
  return { ...mapped, ...direct };
}

module.exports = {
  normaliseCreateSessionWindowPlacement,
  placementCandidateKeys,
  resolveCreateSessionWindowPlacement,
};
