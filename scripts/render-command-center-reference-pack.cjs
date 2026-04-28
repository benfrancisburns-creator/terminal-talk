#!/usr/bin/env node
/*
 * Renders reference PNGs for external AI video tools.
 *
 * These files are meant to be uploaded to tools such as Runway Act-Two,
 * Runway Gen-4 References, Sora storyboards, or HeyGen Photo Avatar so
 * the model sees the real Terminal Talk mascot, speech bubble, palette,
 * and command-center environment.
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'assets', 'ad', 'production-pack');
const WALLPAPER = path.join(ROOT, 'docs', 'assets', 'wallpaper', 'terminal-talk-wallpaper.png');
const COMMAND_CENTER = path.join(ROOT, 'docs', 'assets', 'ad', 'terminal-talk-command-center.png');

function dataUrl(filePath, mime) {
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

function html() {
  const wallpaperUrl = dataUrl(WALLPAPER, 'image/png');
  const commandCenterUrl = dataUrl(COMMAND_CENTER, 'image/png');
  return `<!doctype html>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    background: transparent;
    font-family: "Segoe UI", system-ui, sans-serif;
  }
  .stage {
    position: relative;
    overflow: hidden;
    background:
      radial-gradient(circle at 50% 55%, rgba(255, 167, 38, 0.16), transparent 34%),
      radial-gradient(circle at 25% 25%, rgba(34, 211, 238, 0.16), transparent 40%),
      #0e0f13;
    color: #f8fafc;
  }
  .transparent {
    background: transparent;
  }
  .center {
    display: grid;
    place-items: center;
  }
  .mascot-wrap {
    position: relative;
    width: 720px;
    height: 640px;
    display: grid;
    place-items: center;
  }
  .mascot {
    width: 560px;
    height: 480px;
    filter:
      drop-shadow(14px 14px 0 #b36620)
      drop-shadow(28px 28px 0 #7a3f0f);
  }
  .mascot rect {
    shape-rendering: crispEdges;
  }
  .bubble {
    width: 720px;
    height: 264px;
    filter:
      drop-shadow(16px 16px 0 rgba(10, 15, 25, 0.85))
      drop-shadow(32px 32px 0 rgba(0, 0, 0, 0.5));
  }
  .bubble text {
    font-family: "Cascadia Code", Consolas, monospace;
    font-weight: 800;
    fill: #0e0f13;
  }
  .reference-sheet {
    width: 1920px;
    height: 1080px;
    padding: 58px;
    background:
      linear-gradient(90deg, rgba(4, 7, 12, 0.92), rgba(5, 8, 14, 0.72)),
      url("${commandCenterUrl}") center / cover no-repeat;
  }
  .sheet-grid {
    display: grid;
    grid-template-columns: 1.04fr 0.96fr;
    gap: 36px;
    height: 100%;
  }
  .card {
    border: 1px solid rgba(148, 163, 184, 0.22);
    background: rgba(9, 13, 22, 0.62);
    border-radius: 24px;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
    overflow: hidden;
  }
  .wallpaper-card {
    display: grid;
    place-items: center;
    padding: 34px;
  }
  .wallpaper-card img {
    width: 100%;
    border-radius: 18px;
    box-shadow: 0 20px 70px rgba(0, 0, 0, 0.42);
  }
  .right {
    display: grid;
    grid-template-rows: 1fr auto;
    gap: 36px;
  }
  .hero-card {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 0;
  }
  .hero-card .mascot {
    width: 440px;
    height: 378px;
  }
  .hero-card .bubble {
    position: absolute;
    right: 36px;
    top: 66px;
    width: 430px;
    height: 158px;
  }
  .title {
    position: absolute;
    left: 36px;
    top: 34px;
    font-size: 42px;
    font-weight: 900;
    letter-spacing: 0.04em;
    color: #f8fafc;
    text-shadow: 0 0 28px rgba(255, 167, 38, 0.35);
  }
  .subtitle {
    position: absolute;
    left: 38px;
    bottom: 34px;
    font-size: 22px;
    color: rgba(232, 240, 255, 0.72);
  }
  .palette {
    display: flex;
    gap: 18px;
    padding: 28px 34px;
    align-items: center;
  }
  .dot {
    width: 46px;
    height: 46px;
    border-radius: 50%;
    box-shadow: 0 0 26px currentColor;
  }
</style>

<template id="mascot">
  <svg class="mascot" viewBox="0 0 140 120" xmlns="http://www.w3.org/2000/svg">
    <rect x="13"  y="0"  width="114" height="88" fill="#ff8c1a"/>
    <rect x="0"   y="36" width="13"  height="26" fill="#ff8c1a"/>
    <rect x="127" y="36" width="13"  height="26" fill="#ff8c1a"/>
    <rect x="19"  y="88" width="16" height="32" fill="#ff8c1a"/>
    <rect x="46"  y="88" width="16" height="32" fill="#ff8c1a"/>
    <rect x="79"  y="88" width="16" height="32" fill="#ff8c1a"/>
    <rect x="106" y="88" width="16" height="32" fill="#ff8c1a"/>
    <rect x="36" y="26" width="16" height="16" fill="#3a3a3a"/>
    <rect x="88" y="26" width="16" height="16" fill="#3a3a3a"/>
    <rect x="44" y="58" width="8"  height="6" fill="#3a3a3a"/>
    <rect x="88" y="58" width="8"  height="6" fill="#3a3a3a"/>
    <rect x="44" y="64" width="52" height="6" fill="#3a3a3a"/>
  </svg>
</template>

<template id="bubble">
  <svg class="bubble" viewBox="0 0 30 11" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <rect x="4"  y="0" width="4" height="1" fill="white"/>
    <rect x="11" y="0" width="5" height="1" fill="white"/>
    <rect x="19" y="0" width="4" height="1" fill="white"/>
    <rect x="2"  y="1" width="26" height="1" fill="white"/>
    <rect x="1"  y="2" width="28" height="7" fill="white"/>
    <rect x="2"  y="9" width="26" height="1" fill="white"/>
    <rect x="4"  y="10" width="4" height="1" fill="white"/>
    <rect x="12" y="10" width="5" height="1" fill="white"/>
    <rect x="0"  y="7" width="1" height="1" fill="white"/>
    <rect x="0"  y="8" width="1" height="1" fill="white"/>
    <text x="15" y="6.6" font-size="2.1" text-anchor="middle">HEY JARVIS</text>
  </svg>
</template>

<div id="mascotRef" class="stage center" style="width:1024px;height:1024px">
  <div class="mascot-wrap"></div>
</div>
<div id="mascotAlpha" class="transparent center" style="width:1024px;height:1024px">
  <div class="mascot-wrap"></div>
</div>
<div id="bubbleAlpha" class="transparent center" style="width:1024px;height:512px"></div>
<div id="brandSheet" class="reference-sheet">
  <div class="sheet-grid">
    <div class="card wallpaper-card">
      <img src="${wallpaperUrl}" alt="">
    </div>
    <div class="right">
      <div class="card hero-card">
        <div class="title">TERMINAL TALK</div>
        <div class="bubble-holder"></div>
        <div class="mascot-holder"></div>
        <div class="subtitle">Mascot commander. Spoken terminal intelligence. Claude Code + Codex.</div>
      </div>
      <div class="card palette">
        ${['#ff5e5e', '#ffa726', '#ffd93d', '#4ade80', '#60a5fa', '#c084fc', '#c97b50', '#e0e0e0']
          .map((color) => `<div class="dot" style="background:${color};color:${color}"></div>`).join('')}
      </div>
    </div>
  </div>
</div>

<script>
  function clone(id) {
    return document.getElementById(id).content.firstElementChild.cloneNode(true);
  }
  document.querySelector('#mascotRef .mascot-wrap').appendChild(clone('mascot'));
  document.querySelector('#mascotAlpha .mascot-wrap').appendChild(clone('mascot'));
  document.querySelector('#bubbleAlpha').appendChild(clone('bubble'));
  document.querySelector('#brandSheet .mascot-holder').appendChild(clone('mascot'));
  document.querySelector('#brandSheet .bubble-holder').appendChild(clone('bubble'));
</script>`;
}

async function main() {
  let chromium;
  try {
    ({ chromium } = require('@playwright/test'));
  } catch {
    console.error('Playwright not installed. Run: npm install');
    process.exit(2);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.setContent(html(), { waitUntil: 'load' });
  await page.waitForTimeout(300);

  const shots = [
    ['#mascotRef', 'terminal-talk-mascot-character-reference.png', false],
    ['#mascotAlpha', 'terminal-talk-mascot-transparent.png', true],
    ['#bubbleAlpha', 'terminal-talk-speech-bubble-transparent.png', true],
    ['#brandSheet', 'terminal-talk-brand-reference-sheet.png', false],
  ];

  for (const [selector, name, transparent] of shots) {
    const el = page.locator(selector);
    await el.screenshot({
      path: path.join(OUT_DIR, name),
      omitBackground: transparent,
    });
    console.log('[render] wrote', path.join(OUT_DIR, name));
  }

  await browser.close();
}

main().catch((error) => {
  console.error('[render] fatal:', error);
  process.exit(1);
});
