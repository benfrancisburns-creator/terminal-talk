#!/usr/bin/env node
/*
 * Local, no-subscription Terminal Talk advert renderer.
 *
 * This avoids paid AI-video services by rendering a bespoke animated
 * command center in Canvas: moving camera, terminal panels, session
 * signals, a rigged pixel mascot, speech bubble, subtitles, and end card.
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
const outPath = path.resolve(args.get('--out') || path.join(ROOT, 'tmp', 'local-command-center-ad', 'visual.webm'));
const pagePath = path.resolve(args.get('--page') || path.join(ROOT, 'tmp', 'local-command-center-ad', 'stage.html'));
const durationMs = Number(args.get('--duration-ms') || 54000);
const fps = Number(args.get('--fps') || 30);

function html() {
  return `<!doctype html>
<meta charset="utf-8">
<title>Terminal Talk Local Command Center Advert</title>
<style>
  html, body {
    margin: 0;
    width: 1280px;
    height: 720px;
    overflow: hidden;
    background: #05070b;
  }
  canvas {
    display: block;
    width: 1280px;
    height: 720px;
  }
</style>
<canvas id="stage" width="1280" height="720"></canvas>
<script>
const fs = require('node:fs');
const { ipcRenderer } = require('electron');

const W = 1280;
const H = 720;
const DURATION_MS = ${durationMs};
const FPS = ${fps};
const OUT_PATH = ${JSON.stringify(outPath.replace(/\\/g, '\\\\'))};
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

const palette = ['#ff5e5e', '#ffa726', '#ffd93d', '#4ade80', '#60a5fa', '#c084fc', '#c97b50', '#e0e0e0'];
const shadows = ['#9c2020', '#a85e00', '#8c5f00', '#166534', '#1e40af', '#6f2cb6', '#5d2f14', '#6b7280'];
const cyan = '#22d3ee';
const orange = '#ffa726';

const lines = [
  { at: 0.7,  end: 4.3,  who: 'MASCOT',   text: 'Terminal Talk online. Claude and Codex sessions are in view.' },
  { at: 5.2,  end: 7.0,  who: 'MASCOT',   text: 'Frontend, settings status.' },
  { at: 7.2,  end: 10.3, who: 'FRONTEND', text: 'Auto collapse, shortcuts, and voice controls are ready.' },
  { at: 11.0, end: 12.3, who: 'MASCOT',   text: 'Backend?' },
  { at: 12.7, end: 15.4, who: 'BACKEND',  text: 'Native hooks are live. Queue handling and auto prune are stable.' },
  { at: 16.1, end: 18.0, who: 'MASCOT',   text: 'Tests and docs, status.' },
  { at: 18.2, end: 20.2, who: 'TESTS',    text: 'Checks green. Capture scripts verified.' },
  { at: 20.5, end: 22.7, who: 'DOCS',     text: 'Video feature list updated.' },
  { at: 23.5, end: 25.8, who: 'MASCOT',   text: 'Codex, give me heartbeat state.' },
  { at: 26.0, end: 28.0, who: 'CODEX',    text: 'Working state mapped. Terminal title synced.' },
  { at: 28.6, end: 30.9, who: 'CLAUDE',   text: 'Plugin session cleanup is complete.' },
  { at: 31.4, end: 35.2, who: 'MASCOT',   text: 'Decision point: OpenAI fallback stays opt in.' },
  { at: 36.0, end: 39.0, who: 'MASCOT',   text: 'Hey Jarvis clip received. Priority audio goes first.' },
  { at: 40.0, end: 45.4, who: 'MASCOT',   text: 'Each session has a label, colour, voice, and transcript. Keep building.' },
  { at: 46.2, end: 51.0, who: 'NARRATOR', text: 'Terminal Talk gives Claude Code and Codex one spoken queue, with identity, shortcuts, and voice fallback.' },
];

const panels = [
  { id: 'FRONTEND', label: 'FRONTEND', side: -1, x: -420, z: 760, y: -68, w: 250, h: 142, c: cyan, active: [5.2, 10.5], rows: ['toolbar', 'settings', 'shortcuts', 'collapse'] },
  { id: 'BACKEND', label: 'BACKEND', side: 1, x: 420, z: 750, y: -62, w: 250, h: 142, c: orange, active: [11.0, 15.6], rows: ['hooks', 'queue', 'fallback', 'prune'] },
  { id: 'TESTS', label: 'TESTS', side: -1, x: -520, z: 440, y: 130, w: 230, h: 120, c: '#4ade80', active: [16.1, 20.4], rows: ['unit', 'sync', 'audio', 'green'] },
  { id: 'DOCS', label: 'DOCS', side: -1, x: -210, z: 360, y: 190, w: 210, h: 105, c: '#ffd93d', active: [19.9, 23.0], rows: ['videos', 'features', 'settings'] },
  { id: 'CODEX', label: 'CODEX CLI', side: 1, x: 520, z: 430, y: 126, w: 250, h: 118, c: '#60a5fa', active: [23.2, 28.3], rows: ['heartbeat', 'title', 'working'] },
  { id: 'CLAUDE', label: 'CLAUDE CODE', side: 0, x: 0, z: 900, y: -198, w: 260, h: 108, c: '#c084fc', active: [27.7, 31.0], rows: ['plugin', 'cleanup', 'notes'] },
  { id: 'DEPLOY', label: 'OPENAI', side: 1, x: 330, z: 300, y: 12, w: 230, h: 100, c: '#ff5e5e', active: [31.1, 37.0], rows: ['primary', 'fallback', 'test'] },
];

function clamp(v, min = 0, max = 1) { return Math.max(min, Math.min(max, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function easeOut(t) { return 1 - Math.pow(1 - clamp(t), 3); }
function easeInOut(t) {
  t = clamp(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function between(t, a, b) { return clamp((t - a) / (b - a)); }
function alphaRange(t, a, b, fade = 0.55) {
  return clamp(Math.min(between(t, a, a + fade), 1 - between(t, b - fade, b)));
}
function activeLine(t) {
  return lines.find((line) => t >= line.at && t <= line.end) || null;
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function camera(t) {
  return {
    yaw: Math.sin(t * 0.07) * 0.18 + alphaRange(t, 6, 16, 2) * -0.08 + alphaRange(t, 23, 34, 2) * 0.10,
    push: 1 + between(t, 0, 54) * 0.18 + alphaRange(t, 31, 37, 1) * 0.08,
    rise: Math.sin(t * 0.09) * 12 - alphaRange(t, 46, 54, 1) * 20,
  };
}
function project(x, y, z, t) {
  const cam = camera(t);
  const cos = Math.cos(cam.yaw);
  const sin = Math.sin(cam.yaw);
  const rx = x * cos - z * sin;
  const rz = x * sin + z * cos;
  const depth = 760 / (rz + 760);
  return {
    x: W / 2 + rx * depth * cam.push,
    y: H * 0.54 + (y + cam.rise) * depth * cam.push,
    s: depth * cam.push,
    z: rz,
  };
}

function drawRoom(t) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#070b12');
  g.addColorStop(0.46, '#0b111d');
  g.addColorStop(1, '#05070b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W / 2, H * 0.56, 40, W / 2, H * 0.56, 680);
  glow.addColorStop(0, 'rgba(255,167,38,0.25)');
  glow.addColorStop(0.35, 'rgba(34,211,238,0.08)');
  glow.addColorStop(1, 'rgba(0,0,0,0.0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.lineCap = 'round';
  for (let z = 120; z < 1200; z += 90) {
    const a = project(-720, 250, z, t);
    const b = project(720, 250, z, t);
    ctx.globalAlpha = 0.10 + 0.05 * Math.sin(t + z);
    ctx.strokeStyle = z % 180 === 0 ? orange : cyan;
    ctx.lineWidth = 1.2 * Math.max(a.s, 0.5);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (let x = -720; x <= 720; x += 90) {
    const a = project(x, 250, 90, t);
    const b = project(x, 250, 1180, t);
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = cyan;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = orange;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(W / 2, H * 0.62, 250 + Math.sin(t) * 8, 58, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = '#e8f5ff';
  for (let i = 0; i < 20; i++) {
    const x = (i * 71 + t * 18) % (W + 160) - 80;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x - 120, H);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPanel(panel, t) {
  const intro = easeOut(between(t, panel.active[0] - 2.0, panel.active[0] - 0.2));
  const active = alphaRange(t, panel.active[0], panel.active[1], 0.45);
  if (!intro && !active) return;
  const p = project(panel.x, panel.y, panel.z, t);
  const w = panel.w * p.s;
  const h = panel.h * p.s;
  const x = p.x - w / 2 + (1 - intro) * panel.side * 60;
  const y = p.y - h / 2;

  ctx.save();
  ctx.globalAlpha = 0.28 + intro * 0.45 + active * 0.28;
  ctx.shadowColor = panel.c;
  ctx.shadowBlur = 12 + active * 28;
  ctx.fillStyle = 'rgba(6, 12, 22, 0.82)';
  roundRect(x, y, w, h, 14 * p.s);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = panel.c;
  ctx.lineWidth = Math.max(1, 1.4 * p.s + active);
  ctx.stroke();

  ctx.globalAlpha = intro;
  ctx.font = '800 ' + Math.round(15 * p.s) + 'px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = panel.c;
  ctx.fillText(panel.label, x + 16 * p.s, y + 28 * p.s);
  ctx.font = Math.round(11 * p.s) + 'px Consolas, monospace';
  panel.rows.forEach((row, i) => {
    const lineIn = easeOut(between(t, panel.active[0] - 0.7 + i * 0.16, panel.active[0] + 0.4 + i * 0.16));
    if (!lineIn) return;
    const yy = y + (54 + i * 18) * p.s;
    ctx.globalAlpha = lineIn * (0.48 + active * 0.5);
    ctx.fillStyle = i % 2 ? panel.c : 'rgba(233, 242, 255, 0.86)';
    ctx.fillText('> ' + row, x + 16 * p.s, yy);
    ctx.globalAlpha = lineIn * (0.24 + active * 0.55);
    ctx.fillStyle = panel.c;
    roundRect(x + w - (96 + i * 16) * p.s, yy - 8 * p.s, (70 + i * 9) * p.s, 4 * p.s, 2 * p.s);
    ctx.fill();
  });
  if (active) {
    ctx.globalAlpha = active;
    ctx.fillStyle = panel.c;
    ctx.beginPath();
    ctx.arc(x + w - 22 * p.s, y + 24 * p.s, 5 * p.s + Math.sin(t * 8) * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPanels(t) {
  [...panels].sort((a, b) => b.z - a.z).forEach((panel) => drawPanel(panel, t));
}

function drawConnections(t) {
  ctx.save();
  ctx.lineCap = 'round';
  const center = project(0, 72, 280, t);
  panels.forEach((panel) => {
    const active = alphaRange(t, panel.active[0] - 0.5, panel.active[1] + 0.4, 0.7);
    if (!active) return;
    const p = project(panel.x, panel.y, panel.z, t);
    ctx.globalAlpha = active * 0.72;
    ctx.strokeStyle = panel.c;
    ctx.shadowColor = panel.c;
    ctx.shadowBlur = 16;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.quadraticCurveTo((center.x + p.x) / 2, Math.min(center.y, p.y) - 54 * p.s, p.x, p.y);
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const q = ((t - panel.active[0]) * 0.45 + i / 3) % 1;
      const x = lerp(center.x, p.x, easeInOut(q));
      const y = lerp(center.y, p.y, q);
      ctx.globalAlpha = active * (1 - q);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, 3.6 + active * 2.0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.restore();
}

function mascotPose(t) {
  const enter = easeOut(between(t, 0.1, 2.6));
  let x = lerp(-170, 640, enter);
  let y = lerp(500, 395, enter);
  let s = lerp(0.9, 1.62, enter);
  const focus = [
    { a: 5.1, b: 10.8, dx: -62, dy: -8 },
    { a: 11.0, b: 15.8, dx: 62, dy: -8 },
    { a: 16.0, b: 23.0, dx: -38, dy: 18 },
    { a: 23.0, b: 30.8, dx: 44, dy: 10 },
    { a: 31.0, b: 38.8, dx: 22, dy: -14 },
  ];
  focus.forEach((f) => {
    const a = alphaRange(t, f.a, f.b, 0.8);
    x += f.dx * a;
    y += f.dy * a;
  });
  const end = easeInOut(between(t, 45.8, 51.5));
  s = lerp(s, 1.35, end);
  y = lerp(y, 350, end);
  y += Math.sin(t * 2.4) * 4;
  return { x, y, s };
}

function drawMascot(t) {
  const pose = mascotPose(t);
  const line = activeLine(t);
  const speaking = !!line && (line.who === 'MASCOT' || line.who === 'NARRATOR');
  const idx = Math.floor(t * 1.2) % palette.length;
  const body = palette[idx];
  const shadow = shadows[idx];
  const open = speaking && Math.sin(t * 18) > -0.2;

  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(Math.sin(t * 1.6) * 0.018);
  ctx.scale(pose.s, pose.s);
  ctx.translate(-70, -60);
  ctx.imageSmoothingEnabled = false;
  function rect(x, y, w, h, fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }
  ctx.globalAlpha = 0.30;
  rect(22, 14, 114, 88, '#000');
  rect(9, 50, 13, 26, '#000');
  rect(136, 50, 13, 26, '#000');
  rect(28, 102, 16, 32, '#000');
  rect(55, 102, 16, 32, '#000');
  rect(88, 102, 16, 32, '#000');
  rect(115, 102, 16, 32, '#000');
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
  rect(36, 26, 16, 16, '#282828');
  rect(88, 26, 16, 16, '#282828');
  if (open) {
    rect(44, 56, 52, 20, '#282828');
    rect(52, 64, 36, 5, '#ffcf70');
  } else {
    rect(44, 58, 8, 6, '#282828');
    rect(88, 58, 8, 6, '#282828');
    rect(44, 64, 52, 6, '#282828');
  }
  ctx.restore();

  ctx.save();
  for (let i = 0; i < 10; i++) {
    const age = ((t * 1.8 + i * 0.17) % 1);
    ctx.globalAlpha = (1 - age) * 0.28;
    ctx.fillStyle = palette[i % palette.length];
    roundRect(pose.x - 80 - age * 110, pose.y + 18 + Math.sin(t * 2 + i) * 18, 20 + i, 5, 3);
    ctx.fill();
  }
  ctx.restore();
}

function drawBubble(t) {
  const line = activeLine(t);
  if (!line) return;
  const a = alphaRange(t, line.at, line.end, 0.22);
  if (!a) return;
  const pose = mascotPose(t);
  const label = line.who === 'MASCOT' || line.who === 'NARRATOR' ? 'HEY JARVIS' : line.who + ' REPORT';
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(pose.x + 104, pose.y - 165);
  ctx.scale(0.88, 0.88);
  ctx.imageSmoothingEnabled = false;
  function rect(x, y, w, h, fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
  ctx.globalAlpha = a * 0.32;
  rect(16, 16, 300, 110, '#000');
  ctx.globalAlpha = a;
  rect(40, 0, 40, 10, '#fff'); rect(110, 0, 50, 10, '#fff'); rect(190, 0, 40, 10, '#fff');
  rect(20, 10, 260, 10, '#fff'); rect(10, 20, 280, 70, '#fff'); rect(20, 90, 260, 10, '#fff');
  rect(40, 100, 40, 10, '#fff'); rect(120, 100, 50, 10, '#fff'); rect(0, 70, 10, 20, '#fff');
  ctx.imageSmoothingEnabled = true;
  ctx.fillStyle = '#0e0f13';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 18px Consolas, monospace';
  ctx.fillText(label, 150, 49);
  ctx.font = '700 11px Consolas, monospace';
  const words = line.text.toUpperCase().split(' ');
  ctx.fillText(words.slice(0, 4).join(' '), 150, 71);
  ctx.fillText(words.slice(4, 8).join(' '), 150, 87);
  ctx.restore();
}

function drawPriorityClip(t) {
  const a = alphaRange(t, 35.4, 41.2, 0.7);
  if (!a) return;
  const p = easeInOut(between(t, 35.4, 38.2));
  const x = lerp(76, 506, p);
  const y = lerp(340, 276, p);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.shadowColor = '#4ade80';
  ctx.shadowBlur = 24;
  ctx.fillStyle = 'rgba(9, 18, 14, 0.88)';
  roundRect(x, y, 270, 70, 14);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#4ade80';
  ctx.stroke();
  ctx.font = '800 13px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#4ade80';
  ctx.fillText('HEY JARVIS PRIORITY CLIP', x + 18, y + 26);
  ctx.font = '600 16px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#f8fafc';
  ctx.fillText('selected text jumps the queue', x + 18, y + 51);
  ctx.restore();
}

function drawDecision(t) {
  const a = alphaRange(t, 31.1, 37.2, 0.6);
  if (!a) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.shadowColor = orange;
  ctx.shadowBlur = 28;
  ctx.fillStyle = 'rgba(8, 13, 21, 0.86)';
  roundRect(432, 180, 416, 116, 18);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = orange;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = orange;
  ctx.font = '900 16px "Segoe UI", Arial, sans-serif';
  ctx.fillText('DECISION RECEIVED', 640, 216);
  ctx.fillStyle = '#f8fafc';
  ctx.font = '900 31px "Segoe UI", Arial, sans-serif';
  ctx.fillText('FALLBACK IS OPT IN', 640, 257);
  ctx.fillStyle = 'rgba(232, 240, 255, 0.78)';
  ctx.font = '700 15px "Segoe UI", Arial, sans-serif';
  ctx.fillText('free voices stay available by default', 640, 282);
  ctx.restore();
}

function drawSubtitle(t) {
  const line = activeLine(t);
  if (!line) return;
  const a = alphaRange(t, line.at, line.end, 0.16);
  if (!a) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(4, 7, 12, 0.76)';
  roundRect(140, 623, 1000, 60, 16);
  ctx.fill();
  ctx.strokeStyle = line.who === 'MASCOT' ? orange : cyan;
  ctx.globalAlpha = a * 0.68;
  ctx.stroke();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.fillStyle = line.who === 'MASCOT' ? orange : cyan;
  ctx.font = '900 14px "Segoe UI", Arial, sans-serif';
  ctx.fillText(line.who, 640, 645);
  ctx.fillStyle = '#f8fafc';
  let size = 21;
  do {
    ctx.font = '650 ' + size + 'px "Segoe UI", Arial, sans-serif';
    size -= 1;
  } while (ctx.measureText(line.text).width > 940 && size >= 14);
  ctx.fillText(line.text, 640, 672);
  ctx.restore();
}

function drawEndCard(t) {
  const a = alphaRange(t, 46.0, 54.0, 1.0);
  if (!a) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(3, 6, 11, 0.64)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.shadowColor = orange;
  ctx.shadowBlur = 24;
  ctx.fillStyle = '#f8fafc';
  ctx.font = '900 58px "Segoe UI", Arial, sans-serif';
  ctx.fillText('TERMINAL TALK', 640, 154);
  ctx.shadowBlur = 0;
  ctx.font = '700 20px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = 'rgba(230, 239, 255, 0.84)';
  ctx.fillText('Spoken queue, session identity, shortcuts, and fallback voices', 640, 194);
  for (let i = 0; i < palette.length; i++) {
    ctx.fillStyle = palette[i];
    ctx.globalAlpha = a * 0.86;
    ctx.beginPath();
    ctx.arc(548 + i * 26, 230, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawScan(t) {
  ctx.save();
  ctx.globalAlpha = 0.038;
  ctx.fillStyle = '#ffffff';
  const offset = Math.floor((t * 18) % 6);
  for (let y = offset; y < H; y += 6) ctx.fillRect(0, y, W, 1);
  ctx.restore();
}

function drawFrame(ms) {
  const t = ms / 1000;
  ctx.clearRect(0, 0, W, H);
  drawRoom(t);
  drawConnections(t);
  drawPanels(t);
  drawDecision(t);
  drawPriorityClip(t);
  drawMascot(t);
  drawBubble(t);
  drawSubtitle(t);
  drawEndCard(t);
  drawScan(t);
  const fadeIn = 1 - between(t, 0, 1);
  const fadeOut = between(t, 52, 54);
  if (fadeIn || fadeOut) {
    ctx.save();
    ctx.globalAlpha = clamp(fadeIn + fadeOut);
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

async function main() {
  const stream = canvas.captureStream(FPS);
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm;codecs=vp8';
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 9_000_000 });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstop = async () => {
    fs.writeFileSync(OUT_PATH, Buffer.from(await new Blob(chunks, { type: mime }).arrayBuffer()));
    await ipcRenderer.invoke('recording-finished');
  };
  recorder.start(250);
  const start = performance.now();
  function tick(now) {
    const elapsed = Math.min(now - start, DURATION_MS);
    drawFrame(elapsed);
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
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[render] renderer gone:', JSON.stringify(details));
    app.exit(1);
  });
  await win.loadFile(pagePath);
});
