// Terminal Talk dot palette — 24 arrangements.
// Lifted verbatim from app/renderer.js so visuals stay in lock-step with the product.
//
//   8 solid  +  8 horizontal split  +  8 vertical split  =  24
//
// Splits pair complementary hues only. Quad arrangements were removed
// because they read as noise at 16px.

export const BASE_COLOURS = [
  '#ff5e5e', // red
  '#ffa726', // orange
  '#ffd93d', // yellow
  '#4ade80', // green
  '#60a5fa', // blue
  '#c084fc', // purple
  '#c97b50', // brown (copper)
  '#e0e0e0', // white
];
export const NEUTRAL_COLOUR = '#8a8a8a';
export const PALETTE_SIZE = 24;

// hsplit (top/bottom) — 4 complementary pairs, each + its reverse → 8
const HSPLIT_PAIRS = [
  ['red', 'green'],   ['green', 'red'],
  ['orange', 'blue'], ['blue', 'orange'],
  ['yellow', 'purple'], ['purple', 'yellow'],
  ['brown', 'white'], ['white', 'brown'],
];
// vsplit (left/right) — 4 complementary pairs, each + its reverse → 8
const VSPLIT_PAIRS = [
  ['red', 'blue'],    ['blue', 'red'],
  ['orange', 'purple'], ['purple', 'orange'],
  ['yellow', 'brown'], ['brown', 'yellow'],
  ['green', 'white'], ['white', 'green'],
];

const NAME_TO_HEX = {
  red: '#ff5e5e', orange: '#ffa726', yellow: '#ffd93d', green: '#4ade80',
  blue: '#60a5fa', purple: '#c084fc', brown: '#c97b50', white: '#e0e0e0',
};
const COLOUR_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Brown', 'White'];
const NAME_TO_TITLE = {
  red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green',
  blue: 'Blue', purple: 'Purple', brown: 'Brown', white: 'White',
};

export function arrangementForIndex(idx) {
  const i = ((idx % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
  if (i < 8) return { kind: 'solid', colours: [BASE_COLOURS[i]] };
  if (i < 16) {
    const [a, b] = HSPLIT_PAIRS[i - 8];
    return { kind: 'hsplit', colours: [NAME_TO_HEX[a], NAME_TO_HEX[b]] };
  }
  const [a, b] = VSPLIT_PAIRS[i - 16];
  return { kind: 'vsplit', colours: [NAME_TO_HEX[a], NAME_TO_HEX[b]] };
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
    const [a, b] = HSPLIT_PAIRS[i - 8];
    return `${NAME_TO_TITLE[a]} / ${NAME_TO_TITLE[b]} — top/bottom`;
  }
  const [a, b] = VSPLIT_PAIRS[i - 16];
  return `${NAME_TO_TITLE[a]} / ${NAME_TO_TITLE[b]} — left/right`;
}

// Deterministic short-id → index (for demos without the registry)
export function hashToIndex(shortId) {
  if (!shortId) return 0;
  let sum = 0;
  for (const ch of shortId) sum += ch.charCodeAt(0);
  return sum % PALETTE_SIZE;
}
