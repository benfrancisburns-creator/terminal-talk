#!/usr/bin/env node
/*
 * Electron canvas renderer for the Terminal Talk command-center advert.
 *
 * Produces a silent WebM from a deterministic 1280x720 canvas animation.
 * Audio is muxed by scripts/build-marketing-ad.ps1 so narration/music can
 * be swapped without changing the visual render.
 */

'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const ROOT = path.resolve(__dirname, '..');
const outPath = path.resolve(args.get('--out') || path.join(ROOT, 'tmp', 'marketing-ad', 'visual.webm'));
const pagePath = path.resolve(args.get('--page') || path.join(ROOT, 'tmp', 'marketing-ad', 'marketing-ad.html'));
const backgroundPath = path.resolve(args.get('--background') || path.join(ROOT, 'docs', 'assets', 'ad', 'terminal-talk-command-center.png'));
const durationMs = Number(args.get('--duration-ms') || 46000);
const fps = Number(args.get('--fps') || 30);

function fileUrl(filePath) {
  return 'file:///' + filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function html() {
  const backgroundUrl = fileUrl(backgroundPath);
  const output = outPath.replace(/\\/g, '\\\\');
  return `<!doctype html>
<meta charset="utf-8">
<title>Terminal Talk Command Center Advert</title>
<style>
  html, body {
    margin: 0;
    width: 1280px;
    height: 720px;
    overflow: hidden;
    background: #07090f;
  }
  canvas {
    display: block;
    width: 1280px;
    height: 720px;
    image-rendering: auto;
  }
</style>
<canvas id="stage" width="1280" height="720"></canvas>
<script>
const { ipcRenderer } = require('electron');
const fs = require('node:fs');

const W = 1280;
const H = 720;
const DURATION_MS = ${durationMs};
const FPS = ${fps};
const BG_URL = ${JSON.stringify(backgroundUrl)};
const OUT_PATH = ${JSON.stringify(output)};
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = true;

const palette = ['#ff5e5e', '#ffa726', '#ffd93d', '#4ade80', '#60a5fa', '#c084fc', '#c97b50', '#e0e0e0'];
const darkPalette = ['#9c2020', '#a85e00', '#8c6f00', '#166534', '#1e40af', '#6f2cb6', '#5d2f14', '#6b7280'];

function clamp(v, min = 0, max = 1) { return Math.max(min, Math.min(max, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function easeOutCubic(t) { return 1 - Math.pow(1 - clamp(t), 3); }
function easeInOut(t) {
  t = clamp(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function between(time, a, b) { return clamp((time - a) / (b - a)); }
function alphaBetween(time, a, b, fade = 0.6) {
  const inA = between(time, a, a + fade);
  const outA = 1 - between(time, b - fade, b);
  return clamp(Math.min(inA, outA));
}

function mulberry32(seed) {
  return function rand() {
    let t = seed += 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x54414c4b);
const particles = Array.from({ length: 120 }, (_, i) => ({
  x: rand() * W,
  y: rand() * H,
  r: 0.5 + rand() * 2.0,
  speed: 8 + rand() * 26,
  hue: rand() < 0.55 ? 'cyan' : 'orange',
  phase: rand() * 8,
  lane: i % 5,
}));

function drawCoverImage(img, zoom, panX, panY) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.max(W / iw, H / ih) * zoom;
  const sw = W / scale;
  const sh = H / scale;
  const sx = (iw - sw) / 2 + panX * iw;
  const sy = (ih - sh) / 2 + panY * ih;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
}

function drawBackdrop(img, time) {
  const progress = time / (DURATION_MS / 1000);
  const zoom = 1.01 + 0.045 * progress;
  drawCoverImage(img, zoom, Math.sin(time * 0.08) * 0.006, Math.cos(time * 0.06) * 0.004);

  let g = ctx.createRadialGradient(W / 2, H * 0.56, 80, W / 2, H * 0.56, 650);
  g.addColorStop(0, 'rgba(255, 167, 38, 0.13)');
  g.addColorStop(0.45, 'rgba(11, 14, 22, 0.10)');
  g.addColorStop(1, 'rgba(5, 7, 12, 0.74)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, 'rgba(1, 10, 18, 0.18)');
  g.addColorStop(0.5, 'rgba(5, 6, 10, 0.03)');
  g.addColorStop(1, 'rgba(24, 9, 35, 0.26)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = '#9eeaff';
  ctx.lineWidth = 1;
  for (let x = -60; x < W + 60; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x + Math.sin(time + x) * 10, H);
    ctx.lineTo(W / 2 + (x - W / 2) * 0.2, H * 0.55);
    ctx.stroke();
  }
  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPanel(x, y, w, h, label, accent, time, delay, mode) {
  const a = easeOutCubic(between(time, delay, delay + 1.4));
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
  const lift = (1 - a) * 28;
  y += lift;

  ctx.shadowColor = accent;
  ctx.shadowBlur = 18 * (0.45 + 0.4 * Math.sin(time * 2 + delay));
  ctx.fillStyle = 'rgba(8, 12, 20, 0.64)';
  roundRect(x, y, w, h, 14);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = accent;
  ctx.globalAlpha = a * 0.75;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.globalAlpha = a;
  ctx.font = '700 14px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = accent;
  ctx.fillText(label, x + 18, y + 28);
  ctx.font = '12px Consolas, monospace';
  const rows = Math.floor((h - 54) / 16);
  for (let i = 0; i < rows; i++) {
    const yy = y + 52 + i * 16;
    const pulse = 0.45 + 0.35 * Math.sin(time * 2.4 + i + delay);
    const len = w * (0.25 + ((i * 37 + mode * 19) % 48) / 100);
    ctx.fillStyle = i % 3 === 0 ? accent : 'rgba(214, 232, 255, 0.62)';
    ctx.globalAlpha = a * (i % 3 === 0 ? pulse : 0.45);
    roundRect(x + 18, yy, len, 4, 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawConnections(time) {
  const nodes = [
    { x: 243, y: 180, c: '#22d3ee', start: 6.2 },
    { x: 1010, y: 180, c: '#ffa726', start: 8.0 },
    { x: 255, y: 520, c: '#4ade80', start: 12.4 },
    { x: 1014, y: 518, c: '#c084fc', start: 15.2 },
    { x: 640, y: 110, c: '#60a5fa', start: 20.0 },
  ];
  ctx.save();
  ctx.lineCap = 'round';
  for (const n of nodes) {
    const a = easeOutCubic(between(time, n.start, n.start + 1.2));
    if (!a) continue;
    ctx.globalAlpha = a * 0.75;
    ctx.strokeStyle = n.c;
    ctx.lineWidth = 2;
    ctx.shadowColor = n.c;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(640, 386);
    const c1x = lerp(640, n.x, 0.42);
    const c1y = lerp(386, n.y, 0.18);
    const c2x = lerp(640, n.x, 0.68);
    const c2y = lerp(386, n.y, 0.82);
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, n.x, n.y);
    ctx.stroke();

    const p = ((time - n.start) * 0.32) % 1;
    const dotX = lerp(640, n.x, p);
    const dotY = lerp(386, n.y, easeInOut(p));
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawParticles(time) {
  ctx.save();
  for (const p of particles) {
    const drift = (time * p.speed + p.phase * 40) % (H + 120);
    const y = (p.y + drift) % (H + 120) - 60;
    const x = p.x + Math.sin(time * 0.3 + p.phase) * (12 + p.lane * 3);
    ctx.globalAlpha = 0.12 + 0.28 * Math.sin(time * 1.7 + p.phase) ** 2;
    ctx.fillStyle = p.hue === 'cyan' ? '#22d3ee' : '#ffa726';
    ctx.beginPath();
    ctx.arc(x, y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawMascot(x, y, s, time) {
  const bodyIndex = Math.floor(time * 1.15) % palette.length;
  const body = palette[bodyIndex];
  const shadow = darkPalette[bodyIndex];
  const speaking = Math.sin(time * 18) > 0.05;

  ctx.save();
  ctx.translate(x - 70 * s, y - 60 * s + Math.sin(time * 2.2) * 4);
  ctx.scale(s, s);
  ctx.imageSmoothingEnabled = false;

  function rect(rx, ry, rw, rh, fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(rx, ry, rw, rh);
  }
  ctx.globalAlpha = 0.35;
  rect(18, 8, 114, 88, '#000');
  rect(5, 44, 13, 26, '#000');
  rect(132, 44, 13, 26, '#000');
  rect(24, 96, 16, 32, '#000');
  rect(51, 96, 16, 32, '#000');
  rect(84, 96, 16, 32, '#000');
  rect(111, 96, 16, 32, '#000');

  ctx.globalAlpha = 1;
  rect(17, 4, 114, 88, shadow);
  rect(4, 40, 13, 26, shadow);
  rect(131, 40, 13, 26, shadow);
  rect(23, 92, 16, 32, shadow);
  rect(50, 92, 16, 32, shadow);
  rect(83, 92, 16, 32, shadow);
  rect(110, 92, 16, 32, shadow);

  rect(13, 0, 114, 88, body);
  rect(0, 36, 13, 26, body);
  rect(127, 36, 13, 26, body);
  rect(19, 88, 16, 32, body);
  rect(46, 88, 16, 32, body);
  rect(79, 88, 16, 32, body);
  rect(106, 88, 16, 32, body);

  rect(36, 26, 16, 16, '#1a1a1a');
  rect(88, 26, 16, 16, '#1a1a1a');
  if (speaking) {
    rect(44, 58, 52, 18, '#1a1a1a');
    rect(52, 64, 36, 6, '#ffcf70');
  } else {
    rect(44, 58, 8, 6, '#1a1a1a');
    rect(88, 58, 8, 6, '#1a1a1a');
    rect(44, 64, 52, 6, '#1a1a1a');
  }
  ctx.restore();
}

function drawPixelBubble(x, y, scale, phrase, time, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = false;
  function rect(rx, ry, rw, rh, fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(rx, ry, rw, rh);
  }
  ctx.globalAlpha = alpha * 0.28;
  rect(12, 12, 300, 110, '#000');
  ctx.globalAlpha = alpha;
  rect(40, 0, 40, 10, '#fff');
  rect(110, 0, 50, 10, '#fff');
  rect(190, 0, 40, 10, '#fff');
  rect(20, 10, 260, 10, '#fff');
  rect(10, 20, 280, 70, '#fff');
  rect(20, 90, 260, 10, '#fff');
  rect(40, 100, 40, 10, '#fff');
  rect(120, 100, 50, 10, '#fff');
  rect(0, 70, 10, 20, '#fff');
  ctx.scale(1 / scale, 1 / scale);
  ctx.font = '700 ' + Math.round(15 * scale) + 'px Consolas, monospace';
  ctx.fillStyle = '#0e0f13';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(phrase, 150 * scale, 58 * scale);
  ctx.restore();
}

function drawCaption(text, sub, time, a, b) {
  const alpha = alphaBetween(time, a, b, 0.8);
  if (!alpha) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 24;
  ctx.fillStyle = '#f7fbff';
  ctx.font = '700 36px "Segoe UI", Arial, sans-serif';
  ctx.fillText(text, W / 2, H - 114);
  if (sub) {
    ctx.font = '500 18px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = 'rgba(218, 232, 255, 0.82)';
    ctx.fillText(sub, W / 2, H - 78);
  }
  ctx.restore();
}

function drawHeroWordmark(time) {
  const a = alphaBetween(time, 36.0, 46.0, 1.2);
  if (!a) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.shadowColor = '#ffa726';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#f6f7fb';
  ctx.font = '900 56px "Segoe UI", Arial, sans-serif';
  ctx.fillText('TERMINAL TALK', W / 2, 116);
  ctx.shadowBlur = 0;
  ctx.font = '600 17px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = 'rgba(231, 238, 255, 0.78)';
  ctx.fillText('HANDS-FREE WORKFLOW FOR CLAUDE CODE AND CODEX', W / 2, 154);
  const dotsX = W / 2 - 80;
  for (let i = 0; i < palette.length; i++) {
    ctx.fillStyle = palette[i];
    ctx.globalAlpha = a * 0.75;
    ctx.beginPath();
    ctx.arc(dotsX + i * 23, 184, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawScene(img, ms) {
  const time = ms / 1000;
  ctx.clearRect(0, 0, W, H);
  drawBackdrop(img, time);
  drawParticles(time);

  drawPanel(58, 72, 332, 168, 'FRONT END', '#22d3ee', time, 5.4, 1);
  drawPanel(890, 74, 330, 170, 'BACK END', '#ffa726', time, 7.4, 2);
  drawPanel(74, 470, 318, 142, 'TESTS + DOCS', '#4ade80', time, 11.8, 3);
  drawPanel(886, 468, 322, 144, 'DEPLOY + REVIEW', '#c084fc', time, 14.8, 4);
  drawPanel(498, 48, 284, 118, 'ASSISTANT STREAMS', '#60a5fa', time, 19.0, 5);
  drawConnections(time);

  const mascotIn = easeOutCubic(between(time, 1.2, 3.4));
  const mascotScale = lerp(0.5, 1.7, mascotIn) * (1 + 0.03 * Math.sin(time * 1.2));
  drawMascot(W / 2, lerp(438, 376, mascotIn), mascotScale, time);

  const phrases = [
    'QUEUE CLEAR',
    'TESTS GREEN',
    'HEY JARVIS',
    'DEPLOY READY',
    'CODEX + CLAUDE',
    'KEEP MOVING',
  ];
  const phrase = phrases[Math.floor(time / 5.2) % phrases.length];
  drawPixelBubble(W / 2 + 132, 248 + Math.sin(time * 2.0) * 3, 0.86, phrase, time, alphaBetween(time, 2.4, 38.0, 0.8));

  drawCaption('Every busy terminal becomes a command center.', 'Terminal Talk turns assistant output into spoken situational awareness.', time, 0.5, 7.2);
  drawCaption('Frontend, backend, tests, docs, deployments.', 'One mascot, one queue, every project still visible.', time, 7.2, 15.2);
  drawCaption('Hear the work without staring at the log.', 'Responses, tool calls, heartbeats, and priority clips stay in rhythm.', time, 15.2, 24.2);
  drawCaption('Hey Jarvis reads anything on screen.', 'Select text anywhere and push it straight to the spoken queue.', time, 24.2, 32.5);
  drawCaption('Claude Code and Codex stay in the loop.', 'Less context switching. Fewer missed messages. Cleaner flow.', time, 32.5, 39.4);
  drawHeroWordmark(time);

  const fadeIn = between(time, 0, 1.0);
  const fadeOut = between(time, 43.4, 46.0);
  ctx.save();
  ctx.fillStyle = '#05070b';
  ctx.globalAlpha = 1 - fadeIn + fadeOut;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

async function loadImage(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

async function main() {
  const bg = await loadImage(BG_URL);
  const stream = canvas.captureStream(FPS);
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm;codecs=vp8';
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: mime });
    const bytes = Buffer.from(await blob.arrayBuffer());
    fs.writeFileSync(OUT_PATH, bytes);
    await ipcRenderer.invoke('recording-finished');
  };

  recorder.start(250);
  await ipcRenderer.invoke('recording-started');
  const start = performance.now();
  function tick(now) {
    const elapsed = Math.min(now - start, DURATION_MS);
    drawScene(bg, elapsed);
    if (elapsed < DURATION_MS) requestAnimationFrame(tick);
    else setTimeout(() => recorder.stop(), 180);
  }
  requestAnimationFrame(tick);
}

main().catch((error) => ipcRenderer.invoke('recording-failed', error.stack || error.message));
</script>`;
}

app.whenReady().then(async () => {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  fs.writeFileSync(pagePath, html(), 'utf8');

  ipcMain.handle('recording-started', () => true);
  ipcMain.handle('recording-finished', () => app.quit());
  ipcMain.handle('recording-failed', (_event, message) => {
    console.error(message);
    app.exit(1);
  });

  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    show: true,
    frame: false,
    resizable: false,
    backgroundColor: '#05070b',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
      webSecurity: false,
    },
  });
  win.webContents.on('console-message', (_event, _level, message) => {
    console.log('[render-page]', message);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[render] renderer gone:', JSON.stringify(details));
    app.exit(1);
  });
  await win.loadFile(pagePath);
});
