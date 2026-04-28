const { app, BrowserWindow, desktopCapturer, ipcMain, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);

const outPath = path.resolve(args.get('--out') || 'tmp/desktop-recording.webm');
const startedPath = args.get('--started') ? path.resolve(args.get('--started')) : null;
const pagePath = path.resolve(args.get('--page') || path.join(path.dirname(outPath), '_desktop-recorder.html'));
const durationMs = Number(args.get('--duration-ms') || 45000);
const fps = Number(args.get('--fps') || 30);

function html() {
  return `<!doctype html>
<meta charset="utf-8">
<script>
const { ipcRenderer } = require('electron');

async function main() {
  const source = await ipcRenderer.invoke('desktop-source');
  const constraints = {
    audio: { mandatory: { chromeMediaSource: 'desktop' } },
    video: {
      cursor: 'never',
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: source.id,
        cursor: 'never',
        maxWidth: 3840,
        maxHeight: 2160,
        maxFrameRate: ${fps}
      }
    }
  };

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    constraints.audio = false;
    delete constraints.video.cursor;
    delete constraints.video.mandatory.cursor;
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  }

  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : 'video/webm;codecs=vp8,opus';
  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: mime });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await ipcRenderer.invoke('save-recording', Array.from(bytes));
  };
  recorder.start(250);
  await ipcRenderer.invoke('recording-started');
  setTimeout(() => recorder.stop(), ${durationMs});
}

main().catch((err) => ipcRenderer.invoke('recording-failed', err.stack || err.message));
</script>`;
}

app.whenReady().then(async () => {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  if (startedPath) fs.mkdirSync(path.dirname(startedPath), { recursive: true });
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  fs.writeFileSync(pagePath, html(), 'utf8');

  ipcMain.handle('desktop-source', async () => {
    const primaryId = String(screen.getPrimaryDisplay().id);
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 },
    });
    return sources.find((source) => String(source.display_id) === primaryId) || sources[0];
  });

  ipcMain.handle('recording-started', () => {
    if (startedPath) fs.writeFileSync(startedPath, '1', 'utf8');
    return true;
  });

  ipcMain.handle('save-recording', (_event, bytes) => {
    fs.writeFileSync(outPath, Buffer.from(bytes));
    app.quit();
  });

  ipcMain.handle('recording-failed', (_event, message) => {
    console.error(message);
    app.exit(1);
  });

  const win = new BrowserWindow({
    width: 320,
    height: 200,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
      webSecurity: false,
    },
  });
  await win.loadFile(pagePath);
});
