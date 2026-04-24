#!/usr/bin/env node
/*
 * Generates docs/assets/terminal-talk-hero.svg — the single composite
 * hero image used in README.md.
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
 *      saved in scripts/hero-bounds.json. Same CSS colour-cycle as
 *      docs/assets/mascot-animated.svg — 8 palette colours, 10s loop,
 *      synced drop-shadow colour variable.
 *
 *   3. Pixelated cloud speech bubble (matching the wallpaper hero's
 *      30×11 pixel-grid cloud, scaled 10× to the original cloud's
 *      300×110 display size) with seven crossfading phrases.
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
const OUT_SVG   = path.join(ROOT, 'docs', 'assets', 'terminal-talk-hero.svg');

function readBase64(filePath) {
  const bytes = fs.readFileSync(filePath);
  return bytes.toString('base64');
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
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 800" shape-rendering="crispEdges" role="img" aria-label="Terminal Talk — coloured ASCII wordmark with an animated pixel mascot cycling through session colours and a pixelated cloud speech bubble crossfading through Claude Code phrases">
  <style><![CDATA[
    svg {
      color: #ffa726;
      --mascot-shadow: #a85e00;
      animation: cycleBody 10s steps(1, end) infinite,
                 cycleShadow 10s steps(1, end) infinite;
    }
    @keyframes cycleBody {
      0%,   12.5% { color: #ff5e5e; }
      12.5%, 25%  { color: #ffa726; }
      25%,   37.5% { color: #ffd93d; }
      37.5%, 50%  { color: #4ade80; }
      50%,   62.5% { color: #60a5fa; }
      62.5%, 75%  { color: #ee2bbd; }
      75%,   87.5% { color: #c97b50; }
      87.5%, 100% { color: #e0e0e0; }
    }
    @keyframes cycleShadow {
      0%,   12.5% { --mascot-shadow: #9c2020; }
      12.5%, 25%  { --mascot-shadow: #a85e00; }
      25%,   37.5% { --mascot-shadow: #8c6f00; }
      37.5%, 50%  { --mascot-shadow: #166534; }
      50%,   62.5% { --mascot-shadow: #1e40af; }
      62.5%, 75%  { --mascot-shadow: #86188f; }
      75%,   87.5% { --mascot-shadow: #5d2f14; }
      87.5%, 100% { --mascot-shadow: #6b7280; }
    }
    .phrase { opacity: 0; animation: phraseFade 10s linear infinite; }
    .phrase.p1 { animation-delay:  0s; }
    .phrase.p2 { animation-delay:  1.43s; }
    .phrase.p3 { animation-delay:  2.86s; }
    .phrase.p4 { animation-delay:  4.29s; }
    .phrase.p5 { animation-delay:  5.72s; }
    .phrase.p6 { animation-delay:  7.15s; }
    .phrase.p7 { animation-delay:  8.58s; }
    @keyframes phraseFade {
      0%    { opacity: 0; }
      2%    { opacity: 1; }
      12.5% { opacity: 1; }
      14.5% { opacity: 0; }
      100%  { opacity: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      svg { animation: none; color: #ffa726; --mascot-shadow: #a85e00; }
      .phrase { animation: none; }
      .phrase.p1 { opacity: 1; }
    }
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
    <g transform="translate(4, 4)">
      <rect x="13"  y="0"  width="114" height="88" fill="var(--mascot-shadow)"/>
      <rect x="0"   y="36" width="13"  height="26" fill="var(--mascot-shadow)"/>
      <rect x="127" y="36" width="13"  height="26" fill="var(--mascot-shadow)"/>
      <rect x="19"  y="88" width="16"  height="32" fill="var(--mascot-shadow)"/>
      <rect x="46"  y="88" width="16"  height="32" fill="var(--mascot-shadow)"/>
      <rect x="79"  y="88" width="16"  height="32" fill="var(--mascot-shadow)"/>
      <rect x="106" y="88" width="16"  height="32" fill="var(--mascot-shadow)"/>
    </g>
    <rect x="13"  y="0"  width="114" height="88" fill="currentColor"/>
    <rect x="0"   y="36" width="13"  height="26" fill="currentColor"/>
    <rect x="127" y="36" width="13"  height="26" fill="currentColor"/>
    <rect x="19"  y="88" width="16"  height="32" fill="currentColor"/>
    <rect x="46"  y="88" width="16"  height="32" fill="currentColor"/>
    <rect x="79"  y="88" width="16"  height="32" fill="currentColor"/>
    <rect x="106" y="88" width="16"  height="32" fill="currentColor"/>
    <rect x="36"  y="26" width="16"  height="16" fill="#1a1a1a"/>
    <rect x="88"  y="26" width="16"  height="16" fill="#1a1a1a"/>
    <rect x="44"  y="58" width="8"   height="6"  fill="#1a1a1a"/>
    <rect x="88"  y="58" width="8"   height="6"  fill="#1a1a1a"/>
    <rect x="44"  y="64" width="52"  height="6"  fill="#1a1a1a"/>
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
    <text class="phrase p1" x="${textX}" y="${textY}" font-size="26" letter-spacing="1.5">HEY JARVIS</text>
    <text class="phrase p2" x="${textX}" y="${textY}" font-size="22">Cooked for 49s</text>
    <text class="phrase p3" x="${textX}" y="${textY}" font-size="22">Reading foo.py</text>
    <text class="phrase p4" x="${textX}" y="${textY}" font-size="24">Moonwalking</text>
    <text class="phrase p5" x="${textX}" y="${textY}" font-size="20">Running npm test</text>
    <text class="phrase p6" x="${textX}" y="${textY}" font-size="21">Brewed for 8m 4s</text>
    <text class="phrase p7" x="${textX}" y="${textY}" font-size="20">Sautéed for 1m 0s</text>
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

  const svg = buildSvg({ bgB64, mascot: bounds.mascot, cloud: bounds.cloud });
  fs.writeFileSync(OUT_SVG, svg);
  const sizeKb = (Buffer.byteLength(svg, 'utf8') / 1024).toFixed(1);
  console.log(`[hero] wrote ${OUT_SVG} (${sizeKb} KB)`);
}

main();
