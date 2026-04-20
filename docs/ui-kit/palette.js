// Terminal Talk dot palette — 24 arrangements.
// Reads from the canonical JSON via the generated tokens.mjs so that this
// reference file cannot drift from the product. Previous hand-coded
// HSPLIT_PAIRS / VSPLIT_PAIRS encoding produced different colours from the
// renderer for 9 of 16 split slots; the partner-array encoding below
// matches app/renderer.js exactly because it shares the same source.
//
//   8 solid  +  8 horizontal split  +  8 vertical split  =  24
//
// Splits pair complementary hues only. Quad arrangements were removed
// because they read as noise at 16px.

import { PALETTE } from './tokens.mjs';

export const BASE_COLOURS   = PALETTE.BASE_COLOURS;
export const NEUTRAL_COLOUR = PALETTE.NEUTRAL_COLOUR;
export const PALETTE_SIZE   = PALETTE.PALETTE_SIZE;
export const COLOUR_NAMES   = PALETTE.COLOUR_NAMES;
export const HSPLIT_PARTNER = PALETTE.HSPLIT_PARTNER;
export const VSPLIT_PARTNER = PALETTE.VSPLIT_PARTNER;

export function arrangementForIndex(idx) {
  const i = ((idx % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
  if (i < 8) return { kind: 'solid', colours: [BASE_COLOURS[i]] };
  if (i < 16) {
    const p = i - 8;
    return { kind: 'hsplit', colours: [BASE_COLOURS[p], BASE_COLOURS[HSPLIT_PARTNER[p]]] };
  }
  const p = i - 16;
  return { kind: 'vsplit', colours: [BASE_COLOURS[p], BASE_COLOURS[VSPLIT_PARTNER[p]]] };
}

export function backgroundForArrangement(arr) {
  if (!arr) return NEUTRAL_COLOUR;
  const c = arr.colours;
  switch (arr.kind) {
    case 'solid':  return c[0];
    case 'hsplit': return `linear-gradient(to bottom, ${c[0]} 50%, ${c[1]} 50%)`;
    case 'vsplit': return `linear-gradient(to right,  ${c[0]} 50%, ${c[1]} 50%)`;
    default: return c[0];
  }
}

export function primaryColourForArrangement(arr) {
  return arr && arr.colours ? arr.colours[0] : NEUTRAL_COLOUR;
}

export function arrangementLabel(i) {
  if (i < 8) return COLOUR_NAMES[i];
  if (i < 16) {
    const p = i - 8;
    return `${COLOUR_NAMES[p]} / ${COLOUR_NAMES[HSPLIT_PARTNER[p]]} — top/bottom`;
  }
  const p = i - 16;
  return `${COLOUR_NAMES[p]} / ${COLOUR_NAMES[VSPLIT_PARTNER[p]]} — left/right`;
}

// Deterministic short-id → index (for demos without the registry)
export function hashToIndex(shortId) {
  if (!shortId) return 0;
  let sum = 0;
  for (const ch of shortId) sum += ch.charCodeAt(0);
  return sum % PALETTE_SIZE;
}
