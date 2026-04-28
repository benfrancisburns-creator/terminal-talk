// Stage recorder for the "with toolbar" videos. Runs as a visible
// frameless Electron BrowserWindow that fills the demo region, then
// captures the WHOLE primary display via desktopCapturer (so the real
// Terminal Talk toolbar — which lives in another Electron process —
// gets recorded too). Mirrors Codex's tmp/record-terminal-talk-stage.cjs
// but supports `cardAlign: "left"` so the prompt-card narrative sits on
// the left half and leaves the right half clean for the toolbar.

const { app, BrowserWindow, desktopCapturer, ipcMain, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);

const specPath  = path.resolve(args.get('--spec'));
const spec      = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const outPath   = path.resolve(args.get('--out')   || spec.out);
const stagePath = path.resolve(args.get('--stage') || 'tmp/cc-stage.html');
const width     = Number(args.get('--width')  || spec.width  || 1280);
const height    = Number(args.get('--height') || spec.height || 720);
const x         = Number(args.get('--x') || spec.x || 120);
const y         = Number(args.get('--y') || spec.y || 80);
const durationMs = Number(args.get('--duration-ms') || spec.durationMs || 56000);
const wallpaperPath = path.resolve(args.get('--wallpaper') || 'docs/assets/wallpaper/terminal-talk-wallpaper.png');
const wallpaperUrl = `file:///${wallpaperPath.replace(/\\/g, '/')}`;

const states = JSON.stringify(spec.states || []);
const chips  = (spec.chips || ['real toolbar', 'real audio'])
  .map((c) => `<span class="chip"><i></i>${c}</span>`).join('');
const cardAlign = spec.cardAlign === 'left' ? 'left' : 'center';

const stageHtml = `<!doctype html>
<meta charset="utf-8">
<title>${spec.title || 'Terminal Talk Demo'}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
  body {
    background: #0e0f13 url("${wallpaperUrl}") center / cover no-repeat;
    color: #fff;
    font-family: "Segoe UI", system-ui, sans-serif;
  }
  body::before {
    content: ""; position: fixed; inset: 0;
    background:
      linear-gradient(180deg, rgba(7,8,12,.56), rgba(7,8,12,.18) 42%, rgba(7,8,12,.62)),
      radial-gradient(circle at 22% 18%, rgba(96,165,250,.18), transparent 38%),
      radial-gradient(circle at 78% 78%, rgba(201,123,80,.20), transparent 42%);
  }
  .frame { position: relative; z-index: 1; width: 100%; height: 100%;
           padding: ${cardAlign === 'left' ? '110px 70px 64px 70px' : '150px 70px 54px 70px'}; }
  .prompt-card {
    width: min(${spec.cardWidth || 940}px, 100%);
    ${cardAlign === 'left' ? 'margin: 0;' : 'margin: 0 auto;'}
    border: 1px solid rgba(255,255,255,.14);
    border-radius: 12px;
    background: rgba(5,7,11,.78);
    box-shadow: 0 30px 110px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.06);
    overflow: hidden;
    backdrop-filter: blur(14px) saturate(130%);
  }
  .titlebar {
    height: 44px; display: flex; align-items: center; gap: 9px;
    padding: 0 16px;
    border-bottom: 1px solid rgba(255,255,255,.09);
    color: rgba(255,255,255,.6); font-size: 12px;
  }
  .dot { width: 10px; height: 10px; border-radius: 999px; }
  .dot.red { background: #ff5e5e; }
  .dot.orange { background: #ffa726; }
  .dot.green { background: #4ade80; }
  .title { margin-left: 6px; letter-spacing: .01em; }
  .terminal {
    min-height: ${spec.terminalHeight || 350}px;
    padding: 22px 26px 26px;
    font: ${spec.fontSize || 17}px/1.7 "Cascadia Mono", Consolas, "Courier New", monospace;
  }
  .line { min-height: 30px; white-space: pre-wrap; }
  .prompt  { color: #4ade80; }
  .cmd     { color: #f8fafc; }
  .dim     { color: rgba(255,255,255,.55); }
  .accent  { color: #c97b50; }
  .blue    { color: #60a5fa; }
  .highlight {
    display: inline-block; padding: 0 5px; border-radius: 4px;
    background: rgba(96,165,250,.22); color: #dbeafe;
  }
  code { background: rgba(255,255,255,.08); padding: 1px 5px; border-radius: 3px;
         font-family: "Cascadia Mono", Consolas, monospace; font-size: 0.92em; }
  /* Selected-text look — mimics Windows blue selection so the listener
     sees the highlight effect synchronised with the narration. */
  .sel { background: rgba(96,165,250,.34); color: #f8fafc;
         padding: 1px 4px; border-radius: 2px; box-shadow: 0 0 0 1px rgba(96,165,250,.5); }
  /* Inline indicator for "playing now as a J-clip" — small blue dot
     pulsing in time with the audio. */
  .jdot { display: inline-block; width: 9px; height: 9px; border-radius: 50%;
          background: #60a5fa; box-shadow: 0 0 8px rgba(96,165,250,.7);
          margin-left: 4px; animation: jpulse 700ms ease-in-out infinite; }
  @keyframes jpulse { 0%,100% { transform: scale(1); opacity: 1; }
                       50%    { transform: scale(1.35); opacity: .55; } }
  .footer {
    position: absolute; left: 70px; right: 70px; bottom: 26px;
    display: flex; justify-content: center; gap: 12px;
  }
  .chip {
    display: inline-flex; align-items: center; gap: 7px;
    height: 28px; padding: 0 12px;
    border-radius: 14px; border: 1px solid rgba(255,255,255,.12);
    background: rgba(0,0,0,.42); color: rgba(255,255,255,.72);
    font-size: 12px; backdrop-filter: blur(10px);
  }
  .chip i { width: 7px; height: 7px; border-radius: 50%; background: #c97b50; display: block; }
</style>
<main class="frame">
  <section class="prompt-card">
    <div class="titlebar">
      <span class="dot red"></span><span class="dot orange"></span><span class="dot green"></span>
      <span class="title">${spec.windowTitle || 'Claude Code'}</span>
    </div>
    <div class="terminal" id="terminal"></div>
  </section>
  <div class="footer">${chips}</div>
</main>
<script>
const { ipcRenderer } = require('electron');
const terminal = document.getElementById('terminal');
const states = ${states};
function render(i) {
  const state = states[i] || states[states.length - 1] || { lines: [] };
  terminal.innerHTML = (state.lines || [])
    .map((line) => '<div class="line">' + line + '</div>').join('');
}
async function start() {
  render(0);
  states.forEach((state, index) => {
    if (index === 0) return;
    setTimeout(() => render(index), state.at || 0);
  });
  const source = await ipcRenderer.invoke('desktop-source');
  const constraints = {
    audio: { mandatory: { chromeMediaSource: 'desktop' } },
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: source.id,
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: 30
      }
    }
  };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    document.title = 'Desktop audio capture failed: ' + err.message;
    constraints.audio = false;
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  }
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : 'video/webm;codecs=vp8,opus';
  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: mime });
    const buf = new Uint8Array(await blob.arrayBuffer());
    await ipcRenderer.invoke('save-recording', Array.from(buf));
  };
  recorder.start(250);
  await ipcRenderer.invoke('recording-started');
  setTimeout(() => recorder.stop(), ${durationMs});
}
start().catch((err) => ipcRenderer.invoke('recording-failed', err.stack || err.message));
</script>`;

app.whenReady().then(async () => {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.mkdirSync(path.dirname(stagePath), { recursive: true });
  fs.writeFileSync(stagePath, stageHtml, 'utf8');

  const win = new BrowserWindow({
    width, height, x, y,
    frame: false, resizable: false, movable: false,
    // fullscreen=true hides the Windows taskbar during recording so it
    // doesn't show along the bottom of every frame. skipTaskbar=true
    // keeps the recorder's icon off the taskbar so it doesn't flash up
    // when capture starts.
    fullscreen: spec.fullscreen !== false,
    skipTaskbar: true,
    title: spec.title || 'Terminal Talk Demo',
    backgroundColor: '#0e0f13',
    webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false },
  });
  ipcMain.handle('desktop-source', async () => {
    const primaryId = String(screen.getPrimaryDisplay().id);
    const sources = await desktopCapturer.getSources({
      types: ['screen'], thumbnailSize: { width: 1, height: 1 },
    });
    return sources.find((s) => String(s.display_id) === primaryId) || sources[0];
  });
  ipcMain.handle('recording-started', () => true);
  ipcMain.handle('save-recording', (_e, bytes) => {
    fs.writeFileSync(outPath, Buffer.from(bytes));
    app.quit();
  });
  ipcMain.handle('recording-failed', (_e, message) => {
    console.error(message);
    app.exit(1);
  });
  await win.loadFile(stagePath);
});
