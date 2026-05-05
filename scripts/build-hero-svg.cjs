#!/usr/bin/env node
/*
 * Generates the Terminal Talk hero SVG assets:
 *   - docs/assets/terminal-talk-hero.svg
 *   - docs/assets/mascot-animated.svg
 *   - app/assets/about-terminal-talk-hero.svg
 *
 * Structure:
 *   1. <image> element embedding terminal-talk-wallpaper-bg.jpg as a
 *      base64 data URL. That PNG renders the dark-glass background,
 *      coloured ASCII "TERMINAL TALK" wordmark, palette dots, and
 *      tagline — but WITHOUT the mascot or speech bubble (those are
 *      hidden in scripts/wallpaper-bg.html so the composite can draw
 *      animated versions on top at the exact same coords).
 *
 *   2. Animated mascot group, translated to the mascot's bounding box
 *      saved in scripts/hero-bounds.json. The mascot cycles through all
 *      24 Terminal Talk palette arrangements: 8 solid, 8 top/bottom
 *      splits, and 8 left/right splits.
 *
 *   3. Pixelated cloud speech bubble (matching the wallpaper hero's
 *      30×11 pixel-grid cloud, scaled 10× to the original cloud's
 *      300×110 display size) with crossfading Terminal Talk phrases.
 *
 * Re-run this script whenever the background changes (e.g. after
 * scripts/render-hero-background.cjs is regenerated at a different
 * resolution). The base64 data URL is the only fragile bit.
 *
 * Run: `node scripts/build-hero-svg.cjs`
 */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const ROOT      = path.join(__dirname, '..');
const BG_JPG    = path.join(ROOT, 'docs', 'assets', 'wallpaper',
                            'terminal-talk-wallpaper-bg.jpg');
const BOUNDS_JS = path.join(__dirname, 'hero-bounds.json');
const OUT_COMPOSITE_SVG = path.join(ROOT, 'docs', 'assets', 'terminal-talk-hero.svg');
const OUT_MASCOT_SVG    = path.join(ROOT, 'docs', 'assets', 'mascot-animated.svg');
const OUT_ABOUT_SVG     = path.join(ROOT, 'app', 'assets', 'about-terminal-talk-hero.svg');
const { palette } = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'lib', 'tokens.json'), 'utf8'));

const CYCLE_SECONDS = 16.8;
const SHADOW_COLOURS = [
  '#9c2020',
  '#a85e00',
  '#8c6f00',
  '#166534',
  '#1e40af',
  '#86188f',
  '#5d2f14',
  '#6b7280',
];
const PHRASES = [
  ['Claude replies', 'speak automatically'],
  ['Codex updates', 'join the queue'],
  ['Focus one session', 'hear it first'],
  ['Desktop apps keep', 'their TT identity'],
  ['Tool calls narrate', 'while they run'],
  ['Transcripts keep', 'spoken + original'],
  ['Hey Jarvis reads', 'selected text'],
  ['Auto-prune clears', 'played clips'],
  ['Muted sessions', 'stay quiet'],
  ['Footer closer', 'Brewed for 8m 4s'],
  ['Split colours', 'match everywhere'],
  ['Hands-free coding', 'without babysitting'],
];

function readBase64(filePath) {
  const bytes = fs.readFileSync(filePath);
  return bytes.toString('base64');
}

function formatPct(n) {
  return n.toFixed(4).replace(/\.?0+$/, '');
}

function arrangementVars(i, colours) {
  const { HSPLIT_PARTNER, VSPLIT_PARTNER } = palette;
  const primaryIndex = i < 8 ? i : (i < 16 ? i - 8 : i - 16);
  const secondaryIndex = i < 8
    ? primaryIndex
    : (i < 16 ? HSPLIT_PARTNER[primaryIndex] : VSPLIT_PARTNER[primaryIndex]);
  const primary = colours[primaryIndex];
  const secondary = colours[secondaryIndex];
  if (i < 8) {
    return {
      bodyTopLeft: primary,
      bodyTopRight: primary,
      bodyBottomLeft: primary,
      bodyBottomRight: primary,
      earLeftTop: primary,
      earLeftBottom: primary,
      earRightTop: primary,
      earRightBottom: primary,
      legLeft: primary,
      legRight: primary,
    };
  }
  if (i < 16) {
    return {
      bodyTopLeft: primary,
      bodyTopRight: primary,
      bodyBottomLeft: secondary,
      bodyBottomRight: secondary,
      earLeftTop: primary,
      earLeftBottom: secondary,
      earRightTop: primary,
      earRightBottom: secondary,
      legLeft: secondary,
      legRight: secondary,
    };
  }
  return {
    bodyTopLeft: primary,
    bodyTopRight: secondary,
    bodyBottomLeft: primary,
    bodyBottomRight: secondary,
    earLeftTop: primary,
    earLeftBottom: primary,
    earRightTop: secondary,
    earRightBottom: secondary,
    legLeft: primary,
    legRight: secondary,
  };
}

function mascotDeclarations(vars, prefix) {
  return [
    `--${prefix}-body-tl: ${vars.bodyTopLeft}`,
    `--${prefix}-body-tr: ${vars.bodyTopRight}`,
    `--${prefix}-body-bl: ${vars.bodyBottomLeft}`,
    `--${prefix}-body-br: ${vars.bodyBottomRight}`,
    `--${prefix}-ear-lt: ${vars.earLeftTop}`,
    `--${prefix}-ear-lb: ${vars.earLeftBottom}`,
    `--${prefix}-ear-rt: ${vars.earRightTop}`,
    `--${prefix}-ear-rb: ${vars.earRightBottom}`,
    `--${prefix}-leg-l: ${vars.legLeft}`,
    `--${prefix}-leg-r: ${vars.legRight}`,
  ].join('; ');
}

function mascotDefaults() {
  return `${mascotDeclarations(arrangementVars(1, palette.BASE_COLOURS), 'm')}; ${mascotDeclarations(arrangementVars(1, SHADOW_COLOURS), 'ms')};`;
}

function mascotKeyframes(name, colours, prefix) {
  const lines = [`    @keyframes ${name} {`];
  for (let i = 0; i < palette.PALETTE_SIZE; i++) {
    const start = formatPct((i / palette.PALETTE_SIZE) * 100);
    const end = formatPct(((i + 1) / palette.PALETTE_SIZE) * 100);
    lines.push(`      ${start}%, ${end}% { ${mascotDeclarations(arrangementVars(i, colours), prefix)}; }`);
  }
  lines.push('    }');
  return lines.join('\n');
}

function phraseDelayRules() {
  const secondsPerPhrase = CYCLE_SECONDS / PHRASES.length;
  return PHRASES.map((_, i) =>
    `    .phrase.p${i + 1} { animation-delay: ${formatPct(i * secondsPerPhrase)}s; }`
  ).join('\n');
}

function phraseKeyframes() {
  const slice = 100 / PHRASES.length;
  const fadeIn = Math.min(2.5, slice * 0.3);
  const visible = Math.max(fadeIn + 1, slice - 1.1);
  return `    @keyframes phraseFade {
      0%    { opacity: 0; }
      ${formatPct(fadeIn)}% { opacity: 1; }
      ${formatPct(visible)}% { opacity: 1; }
      ${formatPct(slice)}% { opacity: 0; }
      100%  { opacity: 0; }
    }`;
}

function phraseText(x, y, size, lineHeight) {
  return PHRASES.map(([line1, line2], i) => {
    const cls = `phrase p${i + 1}`;
    const dy = lineHeight;
    return `    <text class="${cls}" x="${x}" y="${y}" font-size="${size}">
      <tspan x="${x}" dy="0">${line1}</tspan>
      <tspan x="${x}" dy="${dy}">${line2}</tspan>
    </text>`;
  }).join('\n');
}

function mascotSvgParts() {
  return `
    <g transform="translate(4, 4)">
      <rect x="13" y="0"  width="57" height="44" fill="var(--ms-body-tl)"/>
      <rect x="70" y="0"  width="57" height="44" fill="var(--ms-body-tr)"/>
      <rect x="13" y="44" width="57" height="44" fill="var(--ms-body-bl)"/>
      <rect x="70" y="44" width="57" height="44" fill="var(--ms-body-br)"/>
      <rect x="0"   y="36" width="13" height="8"  fill="var(--ms-ear-lt)"/>
      <rect x="0"   y="44" width="13" height="18" fill="var(--ms-ear-lb)"/>
      <rect x="127" y="36" width="13" height="8"  fill="var(--ms-ear-rt)"/>
      <rect x="127" y="44" width="13" height="18" fill="var(--ms-ear-rb)"/>
      <rect x="19"  y="88" width="16" height="32" fill="var(--ms-leg-l)"/>
      <rect x="46"  y="88" width="16" height="32" fill="var(--ms-leg-l)"/>
      <rect x="79"  y="88" width="16" height="32" fill="var(--ms-leg-r)"/>
      <rect x="106" y="88" width="16" height="32" fill="var(--ms-leg-r)"/>
    </g>
    <rect x="13" y="0"  width="57" height="44" fill="var(--m-body-tl)"/>
    <rect x="70" y="0"  width="57" height="44" fill="var(--m-body-tr)"/>
    <rect x="13" y="44" width="57" height="44" fill="var(--m-body-bl)"/>
    <rect x="70" y="44" width="57" height="44" fill="var(--m-body-br)"/>
    <rect x="0"   y="36" width="13" height="8"  fill="var(--m-ear-lt)"/>
    <rect x="0"   y="44" width="13" height="18" fill="var(--m-ear-lb)"/>
    <rect x="127" y="36" width="13" height="8"  fill="var(--m-ear-rt)"/>
    <rect x="127" y="44" width="13" height="18" fill="var(--m-ear-rb)"/>
    <rect x="19"  y="88" width="16" height="32" fill="var(--m-leg-l)"/>
    <rect x="46"  y="88" width="16" height="32" fill="var(--m-leg-l)"/>
    <rect x="79"  y="88" width="16" height="32" fill="var(--m-leg-r)"/>
    <rect x="106" y="88" width="16" height="32" fill="var(--m-leg-r)"/>
    <rect x="36"  y="26" width="16" height="16" fill="#1a1a1a"/>
    <rect x="88"  y="26" width="16" height="16" fill="#1a1a1a"/>
    <rect x="44"  y="58" width="8"  height="6" fill="#1a1a1a"/>
    <rect x="88"  y="58" width="8"  height="6" fill="#1a1a1a"/>
    <rect x="44"  y="64" width="52" height="6" fill="#1a1a1a"/>`;
}

function sharedStyle() {
  return `    svg {
      ${mascotDefaults()}
      animation: cycleMascot ${CYCLE_SECONDS}s steps(1, end) infinite,
                 cycleMascotShadow ${CYCLE_SECONDS}s steps(1, end) infinite;
    }
${mascotKeyframes('cycleMascot', palette.BASE_COLOURS, 'm')}
${mascotKeyframes('cycleMascotShadow', SHADOW_COLOURS, 'ms')}
    .phrase { opacity: 0; animation: phraseFade ${CYCLE_SECONDS}s linear infinite; }
${phraseDelayRules()}
${phraseKeyframes()}
    @media (prefers-reduced-motion: reduce) {
      svg { animation: none; ${mascotDefaults()} }
      .phrase { animation: none; }
      .phrase.p1 { opacity: 1; }
    }`;
}

function buildSvg({ bgB64, mascot, cloud }) {
  // Mascot: original rendered at width=134 from viewBox 140. Use the
  // same 0.957 scale so the animated body rects line up with where
  // the static mascot was in the PNG.
  const mascotScale = mascot.w / 140;
  const mx = Math.round(mascot.x);
  const my = Math.round(mascot.y);

  // Cloud: original rendered at width=300 from viewBox 30 grid units.
  // Scale 10 matches (each grid unit = 10 display px). Tail sits at
  // grid x=0, y=7-8, so the cloud's visual left edge equals the
  // bounding box's x exactly.
  const cloudScale = cloud.w / 30;
  const cx = Math.round(cloud.x);
  const cy = Math.round(cloud.y);

  // Text centre: cloud body interior mid-point. Grid centre (15, 6.6)
  // → display (cx + 15*scale, cy + 6.6*scale).
  const textX = Math.round(cx + 15 * cloudScale);
  const textY = Math.round(cy + 6.6 * cloudScale);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Terminal Talk composite hero.

     Single self-contained SVG replacing the old two-image hero in
     README.md (static wallpaper PNG + separate animated mascot SVG).
     Base layer is a JPEG of the wallpaper with mascot + bubble
     removed; foreground overlay is pure SVG animated mascot + cloud
     speech bubble at the exact coords the originals occupied.

     Generator: scripts/build-hero-svg.cjs (do NOT hand-edit; re-run
     the generator after changing scripts/wallpaper-bg.html or
     scripts/render-hero-background.cjs).
-->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 800" shape-rendering="crispEdges" role="img" aria-label="Terminal Talk — coloured ASCII wordmark with a pixel mascot cycling through all 24 solid and split session palette arrangements while the speech bubble crossfades through assistant workflow phrases">
  <style><![CDATA[
${sharedStyle()}
  ]]></style>

  <defs>
    <filter id="cloud-shadow" x="-3%" y="-3%" width="115%" height="115%">
      <feDropShadow dx="4" dy="4" stdDeviation="0" flood-color="#0a0f19" flood-opacity="0.85"/>
      <feDropShadow dx="8" dy="8" stdDeviation="0" flood-color="#000000" flood-opacity="0.5"/>
    </filter>
  </defs>

  <!-- 1. Wallpaper background (no mascot / no bubble). -->
  <image href="data:image/jpeg;base64,${bgB64}" x="0" y="0" width="1280" height="800"/>

  <!-- 2. Animated mascot at the original mascot's bounding box. -->
  <g transform="translate(${mx}, ${my}) scale(${mascotScale.toFixed(4)})">
${mascotSvgParts()}
  </g>

  <!-- 3. Animated cloud speech bubble. Pixel-grid at scale 10 matches
       the original cloud's 300×110 render from viewBox 30×11. -->
  <g transform="translate(${cx}, ${cy})" filter="url(#cloud-shadow)">
    <g transform="scale(${cloudScale.toFixed(4)})">
      <rect x="4"  y="0"  width="4"  height="1" fill="#ffffff"/>
      <rect x="11" y="0"  width="5"  height="1" fill="#ffffff"/>
      <rect x="19" y="0"  width="4"  height="1" fill="#ffffff"/>
      <rect x="2"  y="1"  width="26" height="1" fill="#ffffff"/>
      <rect x="1"  y="2"  width="28" height="7" fill="#ffffff"/>
      <rect x="2"  y="9"  width="26" height="1" fill="#ffffff"/>
      <rect x="4"  y="10" width="4"  height="1" fill="#ffffff"/>
      <rect x="12" y="10" width="5"  height="1" fill="#ffffff"/>
      <rect x="0"  y="7"  width="1"  height="1" fill="#ffffff"/>
      <rect x="0"  y="8"  width="1"  height="1" fill="#ffffff"/>
    </g>
  </g>

  <!-- 4. Crossfading phrases centred inside the cloud body. Rendered
       outside the shadow filter so the text stays crisp (filter is on
       the cloud-white group only). -->
  <g font-family="'Cascadia Code','Cascadia Mono',Consolas,monospace" font-weight="700" fill="#0e0f13" text-anchor="middle">
${phraseText(textX, textY - 10, 17, 21)}
  </g>
</svg>
`;
}

function buildMascotSvg() {
  const textX = 280;
  const textY = 84;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Terminal Talk animated mascot.

     Generated by scripts/build-hero-svg.cjs. The character cycles through
     all 24 Terminal Talk palette arrangements and the cloud rotates
     through concise workflow phrases. Do not hand-edit this file.
-->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 180" shape-rendering="crispEdges" role="img" aria-label="Terminal Talk mascot cycling through all 24 solid and split session palette arrangements with assistant workflow phrases in the speech bubble">
  <style><![CDATA[
${sharedStyle()}
  ]]></style>

  <defs>
    <filter id="cloud-shadow" x="-10%" y="-10%" width="130%" height="130%">
      <feDropShadow dx="4" dy="4" stdDeviation="0" flood-color="#0a0f19" flood-opacity="0.85"/>
      <feDropShadow dx="8" dy="8" stdDeviation="0" flood-color="#000000" flood-opacity="0.5"/>
    </filter>
  </defs>

  <g transform="translate(30, 28)">
${mascotSvgParts()}
  </g>

  <g transform="translate(190, 52)" filter="url(#cloud-shadow)">
    <g transform="scale(6)">
      <rect x="4"  y="0"  width="4"  height="1" fill="#ffffff"/>
      <rect x="11" y="0"  width="5"  height="1" fill="#ffffff"/>
      <rect x="19" y="0"  width="4"  height="1" fill="#ffffff"/>
      <rect x="2"  y="1"  width="26" height="1" fill="#ffffff"/>
      <rect x="1"  y="2"  width="28" height="7" fill="#ffffff"/>
      <rect x="2"  y="9"  width="26" height="1" fill="#ffffff"/>
      <rect x="4"  y="10" width="4"  height="1" fill="#ffffff"/>
      <rect x="12" y="10" width="5"  height="1" fill="#ffffff"/>
      <rect x="0"  y="7"  width="1"  height="1" fill="#ffffff"/>
      <rect x="0"  y="8"  width="1"  height="1" fill="#ffffff"/>
    </g>
  </g>

  <g font-family="ui-monospace, Menlo, Consolas, monospace" font-weight="700" fill="#0e0f13" text-anchor="middle">
${phraseText(textX, textY, 11, 14)}
  </g>
</svg>
`;
}

function main() {
  if (!fs.existsSync(BG_JPG)) {
    console.error('Missing background JPEG. Run: node scripts/render-hero-background.cjs');
    process.exit(1);
  }
  if (!fs.existsSync(BOUNDS_JS)) {
    console.error('Missing bounds JSON. Run: node scripts/render-hero-background.cjs');
    process.exit(1);
  }

  const bgB64  = readBase64(BG_JPG);
  const bounds = JSON.parse(fs.readFileSync(BOUNDS_JS, 'utf8'));

  const composite = buildSvg({ bgB64, mascot: bounds.mascot, cloud: bounds.cloud });
  const mascotSvg = buildMascotSvg();
  for (const out of [OUT_COMPOSITE_SVG, OUT_ABOUT_SVG]) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, composite);
    const sizeKb = (Buffer.byteLength(composite, 'utf8') / 1024).toFixed(1);
    console.log(`[hero] wrote ${out} (${sizeKb} KB)`);
  }
  fs.writeFileSync(OUT_MASCOT_SVG, mascotSvg);
  const mascotKb = (Buffer.byteLength(mascotSvg, 'utf8') / 1024).toFixed(1);
  console.log(`[hero] wrote ${OUT_MASCOT_SVG} (${mascotKb} KB)`);
}

main();
