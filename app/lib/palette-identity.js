'use strict';

const TOKENS = require('./tokens.json');

const COLOUR_MARKERS = Object.freeze([
  '🔴',
  '🟠',
  '🟡',
  '🟢',
  '🔵',
  '🟣',
  '🟤',
  '⚪',
]);

const DEFAULT_NAMES = Object.freeze([
  'Red',
  'Orange',
  'Yellow',
  'Green',
  'Blue',
  'Magenta',
  'Brown',
  'White',
]);

function palette() {
  return (TOKENS && TOKENS.palette) || {};
}

function paletteSize() {
  const size = Number(palette().PALETTE_SIZE);
  return Number.isFinite(size) && size > 0 ? Math.floor(size) : 24;
}

function clampIndex(index) {
  const size = paletteSize();
  const n = Math.floor(Number(index) || 0);
  if (n < 0) return 0;
  if (n >= size) return size - 1;
  return n;
}

function colourNames() {
  const names = palette().COLOUR_NAMES;
  return Array.isArray(names) && names.length >= 8 ? names : DEFAULT_NAMES;
}

function pairForIndex(index) {
  const n = clampIndex(index);
  const names = colourNames();
  const hsplit = Array.isArray(palette().HSPLIT_PARTNER) ? palette().HSPLIT_PARTNER : [];
  const vsplit = Array.isArray(palette().VSPLIT_PARTNER) ? palette().VSPLIT_PARTNER : [];
  const primary = n < 8 ? n : n < 16 ? n - 8 : n - 16;
  const secondary = n < 8 ? primary : n < 16 ? hsplit[primary] : vsplit[primary];
  const cleanPrimary = Number.isFinite(Number(primary)) ? Math.max(0, Math.min(7, Number(primary))) : 0;
  const cleanSecondary = Number.isFinite(Number(secondary)) ? Math.max(0, Math.min(7, Number(secondary))) : cleanPrimary;
  return {
    index: n,
    kind: n < 8 ? 'solid' : n < 16 ? 'hsplit' : 'vsplit',
    primary: cleanPrimary,
    secondary: cleanSecondary,
    primaryName: names[cleanPrimary] || 'Colour',
    secondaryName: names[cleanSecondary] || names[cleanPrimary] || 'Colour',
    primaryMarker: COLOUR_MARKERS[cleanPrimary] || '●',
    secondaryMarker: COLOUR_MARKERS[cleanSecondary] || COLOUR_MARKERS[cleanPrimary] || '●',
  };
}

function colourNameForIndex(index) {
  const pair = pairForIndex(index);
  if (pair.kind === 'solid' || pair.primary === pair.secondary) return pair.primaryName;
  return `${pair.primaryName} / ${pair.secondaryName}`;
}

function colourMarkerForIndex(index) {
  const pair = pairForIndex(index);
  if (pair.kind === 'solid' || pair.primary === pair.secondary) return pair.primaryMarker;
  return `${pair.primaryMarker}${pair.secondaryMarker}`;
}

module.exports = {
  colourMarkerForIndex,
  colourNameForIndex,
};
