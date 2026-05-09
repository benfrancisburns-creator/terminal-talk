// Headless video recorder for Claude Code demo videos.
//
// Why this exists: Codex's record-terminal-talk-stage.cjs uses a visible
// Electron BrowserWindow + desktopCapturer, which means a window pops up
// in front of whatever the user is doing. If they close it (reasonably!),
// the recorder dies with STATUS_CONTROL_C_EXIT.
//
// This recorder runs Chromium headless via Playwright's `recordVideo`
// option — no window ever appears, the user can keep working. The
// trade-off: we can't capture the real Terminal Talk toolbar's audio
// since the toolbar lives in a separate process. So:
//   1. Playwright produces a silent .webm of the stage HTML.
//   2. We pre-render audio clips with edge-tts (already done into _clips/).
//   3. ffmpeg concatenates the clips at the spec's `at:` offsets, on top
//      of a silent base of `durationMs` length.
//   4. ffmpeg muxes the silent video + the assembled audio into the final.
//
// All paths are local; the bundled Playwright ffmpeg is enough.

const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SPEC_PATH = path.resolve(__dirname, '_smart-narration.spec.json');
const CLIP_DIR  = path.resolve(__dirname, '_clips');
const OUT_PATH  = path.resolve(__dirname, 'smart-tool-narration.webm');
const TMP_DIR   = path.resolve(__dirname, '_tmp-build');
const WALLPAPER = path.resolve(ROOT, 'docs/assets/wallpaper/terminal-talk-wallpaper.png');

// Playwright's bundled ffmpeg is stripped down (`--disable-everything`)
// — no adelay, no amix, no AAC. Use the full build that imageio-ffmpeg
// ships via pip (one Python package, self-contained binary). Resolved
// at runtime by asking Python where it dropped the binary.
const FFMPEG = (() => {
  const r = spawnSync('python', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())']);
  if (r.status !== 0) {
    throw new Error('imageio-ffmpeg missing — run `pip install imageio-ffmpeg`');
  }
  return r.stdout.toString().trim();
})();

const STAGE_W = 1280;
const STAGE_H = 720;

(async () => {
  if (!fs.existsSync(FFMPEG)) {
    throw new Error(`ffmpeg not found at ${FFMPEG}`);
  }
  console.log('[record] ffmpeg:', FFMPEG);
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
  fs.mkdirSync(TMP_DIR, { recursive: true });

  // ---------------------------------------------------------------------
  // 1. Pre-render the stage HTML to a temp file and load it in headless
  //    Chromium with recordVideo. The page mirrors Codex's stage layout
  //    (wallpaper + frosted prompt card + chip footer) but stripped of
  //    the desktopCapturer code — Playwright handles the recording.
  // ---------------------------------------------------------------------
  const wallpaperUrl = `file:///${WALLPAPER.replace(/\\/g, '/')}`;
  const chips = (spec.chips || []).map((c) => `<span class="chip"><i></i>${c}</span>`).join('');
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
      linear-gradient(180deg, rgba(7,8,12,.56), rgba(7,8,12,.2) 42%, rgba(7,8,12,.64)),
      radial-gradient(circle at 24% 18%, rgba(96,165,250,.18), transparent 38%),
      radial-gradient(circle at 78% 78%, rgba(201,123,80,.22), transparent 42%);
  }
  .frame { position: relative; z-index: 1; width: 100%; height: 100%; padding: 150px 70px 54px; }
  .prompt-card {
    width: min(${spec.cardWidth || 940}px, 100%);
    margin: 0 auto;
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
    padding: 25px 28px 30px;
    font: ${spec.fontSize || 18}px/1.75 "Cascadia Mono", Consolas, "Courier New", monospace;
  }
  .line { min-height: 31px; white-space: pre-wrap; }
  .prompt  { color: #4ade80; }
  .cmd     { color: #f8fafc; }
  .dim     { color: rgba(255,255,255,.55); }
  .accent  { color: #c97b50; }
  .blue    { color: #60a5fa; }
  .highlight {
    display: inline-block; padding: 0 5px; border-radius: 4px;
    background: rgba(96,165,250,.22); color: #dbeafe;
  }
  /* Faux toolbar — small dotstrip over the card to stand in for the
     real Terminal Talk toolbar (which lives in a separate Electron
     process and isn't captureable headless). Dots light up on cue. */
  .faux-toolbar {
    width: 520px; margin: 28px auto 0;
    height: 56px; border-radius: 12px;
    background: rgba(7,9,14,.86);
    border: 1px solid rgba(255,255,255,.14);
    box-shadow: 0 12px 40px rgba(0,0,0,.55);
    display: flex; align-items: center; gap: 10px;
    padding: 0 18px;
  }
  .mascot { width: 26px; height: 26px; border-radius: 999px;
            background: radial-gradient(circle at 35% 35%, #fff5ea, #c97b50 70%); }
  .strip { display: flex; align-items: center; gap: 7px; flex: 1; }
  .pip {
    width: 12px; height: 12px; border-radius: 999px;
    background: rgba(255,255,255,.18);
    transition: background 280ms ease, transform 280ms ease, box-shadow 280ms ease;
  }
  .pip.lit-a    { background: #c97b50;
                  box-shadow: 0 0 8px rgba(201,123,80,.6); transform: scale(1.18); }
  .pip.lit-b    { background: #60a5fa;
                  box-shadow: 0 0 8px rgba(96,165,250,.6); transform: scale(1.18); }
  .pip.played-a { background: rgba(201,123,80,.42); }
  .pip.played-b { background: rgba(96,165,250,.42); }
  .gear { width: 16px; height: 16px; border-radius: 999px;
          border: 2px solid rgba(255,255,255,.4); }
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
    <div class="faux-toolbar">
      <div class="mascot"></div>
      <div class="strip" id="strip">
        <span class="pip"></span><span class="pip"></span><span class="pip"></span>
        <span class="pip"></span><span class="pip"></span><span class="pip"></span>
        <span class="pip"></span><span class="pip"></span><span class="pip"></span>
      </div>
      <div class="gear"></div>
    </div>
  </section>
  <div class="footer">${chips}</div>
</main>
<script>
const states = ${JSON.stringify(spec.states || [])};
const litCues = ${JSON.stringify(spec.pipCues || [])};
const terminal = document.getElementById('terminal');
const strip = document.getElementById('strip');
const pips = strip.querySelectorAll('.pip');

function render(i) {
  const state = states[i] || states[states.length - 1] || { lines: [] };
  terminal.innerHTML = (state.lines || [])
    .map((line) => '<div class="line">' + line + '</div>').join('');
}
function lightPip(idx, side) {
  const klass = side === 'b' ? 'lit-b' : 'lit-a';
  const playedKlass = side === 'b' ? 'played-b' : 'played-a';
  // Demote previously-lit pips to "played"
  pips.forEach((p) => {
    if (p.classList.contains('lit-a')) { p.classList.remove('lit-a'); p.classList.add('played-a'); }
    if (p.classList.contains('lit-b')) { p.classList.remove('lit-b'); p.classList.add('played-b'); }
  });
  if (pips[idx]) pips[idx].classList.add(klass);
}
render(0);
states.forEach((state, index) => {
  if (index === 0) return;
  setTimeout(() => render(index), state.at || 0);
});
litCues.forEach((cue, i) => {
  setTimeout(() => lightPip(cue.pip ?? i, cue.side || 'a'), cue.at || 0);
});
</script>`;

  const stagePath = path.join(TMP_DIR, 'stage.html');
  fs.writeFileSync(stagePath, stageHtml);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: STAGE_W, height: STAGE_H },
    deviceScaleFactor: 1,
    recordVideo: { dir: TMP_DIR, size: { width: STAGE_W, height: STAGE_H } },
  });
  const page = await ctx.newPage();
  console.log('[record] loading stage…');
  await page.goto('file:///' + stagePath.replace(/\\/g, '/'));
  console.log('[record] capturing for', spec.durationMs, 'ms…');
  await page.waitForTimeout(spec.durationMs + 600);
  await page.close();
  await ctx.close();
  await browser.close();

  // Find the produced webm (Playwright names it with a hash).
  const captures = fs.readdirSync(TMP_DIR).filter((f) => f.endsWith('.webm'));
  if (captures.length === 0) throw new Error('Playwright produced no webm');
  const silentVideo = path.join(TMP_DIR, captures[captures.length - 1]);
  console.log('[record] silent video:', silentVideo);

  // ---------------------------------------------------------------------
  // 2. Build the audio track. Each clip starts at its `at:` offset,
  //    relative to the start of the recording. Use ffmpeg filter_complex
  //    with `adelay` (in ms) to position each clip on a single mixed
  //    output of `durationMs` total length. dropout_transition=0 keeps
  //    quiet sections quiet.
  // ---------------------------------------------------------------------
  const audioCues = spec.audioCues || [];
  if (audioCues.length === 0) {
    throw new Error('spec must define audioCues: [{at, file}, ...]');
  }
  const audioPath = path.join(TMP_DIR, 'audio.m4a');
  const inputs = audioCues.flatMap((c) => ['-i', path.join(CLIP_DIR, c.file)]);
  const filter = audioCues.map((c, i) => `[${i}]adelay=${c.at}|${c.at}[a${i}]`).join(';')
    + ';' + audioCues.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${audioCues.length}:dropout_transition=0:normalize=0[mix]`;
  console.log('[record] mixing audio…');
  const audioRes = spawnSync(FFMPEG, [
    '-y', ...inputs,
    '-filter_complex', filter,
    '-map', '[mix]',
    '-t', String(spec.durationMs / 1000),
    '-c:a', 'aac', '-b:a', '160k',
    audioPath,
  ], { stdio: 'inherit' });
  if (audioRes.status !== 0) throw new Error(`ffmpeg audio mix failed: exit ${audioRes.status}`);

  // ---------------------------------------------------------------------
  // 3. Mux the silent video + the assembled audio.
  // ---------------------------------------------------------------------
  console.log('[record] muxing video + audio →', OUT_PATH);
  const muxRes = spawnSync(FFMPEG, [
    '-y',
    '-i', silentVideo,
    '-i', audioPath,
    '-c:v', 'copy',
    '-c:a', 'libopus', '-b:a', '160k',
    '-shortest',
    OUT_PATH,
  ], { stdio: 'inherit' });
  if (muxRes.status !== 0) throw new Error(`ffmpeg mux failed: exit ${muxRes.status}`);

  console.log('\n[record] OK — wrote', OUT_PATH);
  console.log('[record] size:', (fs.statSync(OUT_PATH).size / 1024 / 1024).toFixed(2), 'MB');
})().catch((err) => {
  console.error('[record] FAIL:', err.message);
  process.exit(1);
});
