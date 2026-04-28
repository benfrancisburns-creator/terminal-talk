const { app, BrowserWindow, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);

const name = args.get('--name') || 'assistant';
const title = args.get('--title') || `Terminal Talk ${name} demo`;
const flagPath = args.get('--flag') ? path.resolve(args.get('--flag')) : null;
const x = Number(args.get('--x') || 24);
const y = Number(args.get('--y') || 36);
const width = Number(args.get('--width') || 900);
const height = Number(args.get('--height') || 900);
const pagePath = path.resolve(args.get('--page') || path.join(process.cwd(), 'tmp', `terminal-stage-${name}.html`));

function terminalHtml() {
  const command = {
    assistant: 'terminal-talk overview --agents "Claude Code,Codex"',
    heyjarvis: 'claude "review the migration note"',
    settings: 'terminal-talk settings',
    openai: 'terminal-talk settings --openai-tts',
    sessions: 'terminal-talk sessions --sync-identities',
    transcript: 'terminal-talk transcript --spoken-and-original',
  }[name] || 'terminal-talk overview';

  return `<!doctype html>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  :root {
    color-scheme: dark;
    font-family: "Cascadia Mono", "Consolas", monospace;
    background: #050608;
  }

  * { box-sizing: border-box; }
  html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
  body {
    background:
      linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0) 72px),
      #050608;
    color: #e9edf5;
  }

  .top {
    height: 46px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 16px;
    background: #111318;
    border-bottom: 1px solid #2a2d35;
    color: #f4f7fb;
    font: 600 14px "Segoe UI", sans-serif;
  }

  .icon {
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border-radius: 5px;
    background: #161a22;
    border: 1px solid #3a4150;
    color: #8fb4ff;
    font: 700 15px "Consolas", monospace;
  }

  .terminal {
    height: calc(100% - 46px);
    padding: 28px 32px;
    font-size: 19px;
    line-height: 1.48;
    letter-spacing: 0;
  }

  .prompt { color: #70e5a1; }
  .path { color: #9fb8ff; }
  .assistant { color: #69d8ff; font-weight: 700; }
  .dim { color: #8d96a7; }
  .line { margin: 0 0 12px; opacity: 0; transform: translateY(5px); transition: opacity 220ms ease, transform 220ms ease; }
  .line.visible { opacity: 1; transform: translateY(0); }
  .selected {
    background: #174d85;
    color: #ffffff;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
    padding: 1px 0;
  }
  .cursor {
    display: inline-block;
    width: 10px;
    height: 1.2em;
    vertical-align: -0.18em;
    background: #e9edf5;
    animation: blink 1s steps(1, end) infinite;
  }
  @keyframes blink { 50% { opacity: 0; } }
</style>
<body>
  <div class="top"><span class="icon">&gt;_</span><span>${escapeHtml(title)}</span></div>
  <main class="terminal">
    <p class="line visible"><span class="prompt">PS</span> <span class="path">C:\\Users\\Ben\\Desktop\\terminal-talk</span>&gt; ${escapeHtml(command)}<span class="cursor"></span></p>
    <div id="content"></div>
  </main>
<script>
  const { ipcRenderer } = require('electron');
  const name = ${JSON.stringify(name)};
  const flagPath = ${JSON.stringify(flagPath)};
  const content = document.getElementById('content');

  function line(html, delay) {
    setTimeout(() => {
      const p = document.createElement('p');
      p.className = 'line';
      p.innerHTML = html;
      content.appendChild(p);
      requestAnimationFrame(() => p.classList.add('visible'));
    }, delay);
  }

  function runAssistant() {
    line('<span class="assistant">Claude Code</span>', 900);
    line('Hooks send replies, tool calls, and heartbeat clips to Terminal Talk.', 2100);
    line('<span class="assistant">Codex CLI</span>', 8400);
    line('Session logs feed the same spoken queue and transcript.', 9600);
    line('Shared controls: colour, voice, mute, focus, and transcript history.', 15600);
  }

  function runHeyJarvis() {
    line('The Hub schema migration is approved.', 300);
    line('Apply it during the maintenance window on Friday at 8 PM.', 700);
    setTimeout(() => {
      for (const p of content.querySelectorAll('.line')) p.innerHTML = '<span class="selected">' + p.textContent + '</span>';
    }, 5400);
    line('<span class="dim">Text selected. Say hey jarvis or press Ctrl+Shift+S.</span>', 6200);
  }

  function runSettings() {
    line('Settings walkthrough', 900);
    line('The cursor on the right follows the feature being explained.', 1900);
    line('Codex and Claude integration is covered in a separate video.', 7800);
  }

  function runOpenAi() {
    line('<span class="assistant">OpenAI premium voices</span>', 900);
    line('Keys are saved outside config.json and hidden after save.', 2100);
    line('Edge remains the free default; OpenAI can become the primary provider.', 9400);
    line('The other provider stays wired as the fallback.', 16000);
  }

  function runSessions() {
    line('<span class="assistant">Session identity sync</span>', 900);
    line('Claude Code and Codex share the same toolbar queue and colour registry.', 2300);
    line('Labels, colours, mute, focus and voices are remembered per session.', 10400);
    line('Terminal Talk Codex can mirror the slot into the Windows Terminal tab.', 17600);
  }

  function runTranscript() {
    line('<span class="assistant">Transcript panel</span>', 900);
    line('Recent clips keep both spoken text and original markdown source.', 2300);
    line('Filter by session, copy a clip, and jump back into the conversation.', 10100);
  }

  async function waitForFlag() {
    if (!flagPath) return;
    while (!(await ipcRenderer.invoke('file-exists', flagPath))) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  waitForFlag().then(() => {
    if (name === 'heyjarvis') runHeyJarvis();
    else if (name === 'settings') runSettings();
    else if (name === 'openai') runOpenAi();
    else if (name === 'sessions') runSessions();
    else if (name === 'transcript') runTranscript();
    else runAssistant();
  });
</script>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  fs.writeFileSync(pagePath, terminalHtml(), 'utf8');

  const { ipcMain } = require('electron');
  ipcMain.handle('file-exists', (_event, filePath) => fs.existsSync(filePath));

  const win = new BrowserWindow({
    title,
    x,
    y,
    width,
    height,
    frame: true,
    alwaysOnTop: true,
    show: true,
    backgroundColor: '#050608',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });
  await win.loadFile(pagePath);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
});
