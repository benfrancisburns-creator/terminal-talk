const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);

const x = Number(args.get('--x') || 0);
const y = Number(args.get('--y') || 0);
const width = Number(args.get('--width') || 1280);
const height = Number(args.get('--height') || 720);
const imagePath = args.get('--image') ? path.resolve(args.get('--image')) : '';
const pagePath = path.resolve(args.get('--page') || path.join(process.cwd(), 'tmp', 'terminal-talk-demo-backdrop.html'));

function fileUrl(filePath) {
  return 'file:///' + filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function html() {
  const image = imagePath && fs.existsSync(imagePath) ? fileUrl(imagePath) : '';
  return `<!doctype html>
<meta charset="utf-8">
<style>
  html, body {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
    background:
      linear-gradient(90deg, rgba(10, 12, 18, 0.58), rgba(10, 12, 18, 0.22)),
      ${image ? `url("${image}")` : 'linear-gradient(135deg, #172236, #1d1028)'};
    background-size: cover;
    background-position: center;
  }
</style>`;
}

app.whenReady().then(async () => {
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  fs.writeFileSync(pagePath, html(), 'utf8');

  const win = new BrowserWindow({
    title: 'Terminal Talk Demo Backdrop',
    x,
    y,
    width,
    height,
    frame: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: true,
    backgroundColor: '#0e0f13',
  });
  await win.loadFile(pagePath);
  win.setAlwaysOnTop(true, 'floating');
  win.moveTop();
});
