#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const url = require('url');

const root = path.resolve(__dirname, '..');
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (process.argv[i] && process.argv[i].startsWith('--')) {
    args.set(process.argv[i].slice(2), process.argv[i + 1]);
  }
}

const requestedPort = Number(args.get('port') || process.env.PORT || 4174);
const host = args.get('host') || '127.0.0.1';

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.cjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.woff2', 'font/woff2'],
]);

const reloadClients = new Set();

function safePath(requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0]);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const resolved = path.resolve(root, normalized.replace(/^[/\\]/, ''));
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

function liveReloadSnippet() {
  return `
<script>
(() => {
  const source = new EventSource('/__terminal_talk_live_reload');
  source.addEventListener('reload', () => window.location.reload());
})();
</script>`;
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, buffer) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(err.code === 'ENOENT' ? 'Not found' : String(err.message || err));
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    let body = buffer;
    if (ext === '.html') {
      const html = buffer.toString('utf8');
      body = Buffer.from(html.replace(/<\/body>/i, `${liveReloadSnippet()}\n</body>`), 'utf8');
    }
    res.writeHead(200, {
      'Content-Type': mime.get(ext) || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  });
}

function handleReload(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  reloadClients.add(res);
  req.on('close', () => reloadClients.delete(res));
}

function broadcastReload() {
  for (const client of reloadClients) {
    client.write('event: reload\n');
    client.write(`data: ${Date.now()}\n\n`);
  }
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url || '/');
  if (parsed.pathname === '/__terminal_talk_live_reload') {
    handleReload(req, res);
    return;
  }

  const filePath = safePath(parsed.pathname === '/' ? '/docs/carousel-prototype.html' : parsed.pathname || '/');
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) {
      serveFile(res, path.join(filePath, 'index.html'));
      return;
    }
    serveFile(res, filePath);
  });
});

let debounceTimer = null;
function scheduleReload(filename) {
  if (!filename) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(broadcastReload, 120);
}

for (const folder of ['docs', 'scripts']) {
  const watchPath = path.join(root, folder);
  if (fs.existsSync(watchPath)) {
    fs.watch(watchPath, { recursive: true }, (_event, filename) => scheduleReload(filename));
  }
}

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  const nextPort = requestedPort + 1;
  server.listen(nextPort, host, () => {
    console.log(`Terminal Talk live preview: http://${host}:${nextPort}/docs/carousel-prototype.html`);
  });
});

server.listen(requestedPort, host, () => {
  const address = server.address();
  console.log(`Terminal Talk live preview: http://${host}:${address.port}/docs/carousel-prototype.html`);
});
