// D2-3b — fetch + splice the real product body into this page.
// Replaces the hand-duplicated DOM the kit carried in v0.3.0. Closes
// the last structural drift surface: if someone adds a new element to
// the product's index.html, the kit now inherits it automatically on
// next load.
//
// D2-3c — paths target docs/app-mirror/ rather than ../../app/ so the
// GitHub Pages build (which only publishes /docs) can resolve them.
// The mirror is kept in sync by scripts/sync-app-mirror.cjs; a
// --check run in the test suite fails if it drifts.
//
// Execution order matters: renderer.js reads elements by id at module
// top level (audio, dots, playPause, scrubberMascot, sessionsTable,
// speedSlider, …). The splice + script-chain load must complete in the
// right order:
//
//   1. fetch ../app-mirror/index.html (the mirrored product DOM)
//   2. extract body — strip <script> and <link> tags (they'd either
//      re-load the wrong paths or never fire)
//   3. splice extracted body content into our document.body
//   4. load tokens-window.js → voices-window.js → mock-ipc.js → renderer.js
//      in strict sequence (each awaited before the next)
//
// Any failure at step 1 or 2 falls back to console.error + keeps the
// demo shell visible rather than a silent blank page.

(async function bootstrap() {
  const APP_INDEX = '../app-mirror/index.html';

  let html;
  try {
    const res = await fetch(APP_INDEX);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    console.error('[kit-bootstrap] failed to fetch app-mirror/index.html:', e);
    const err = document.createElement('div');
    err.style.cssText = 'padding:24px;color:#ff6b6b;font-family:monospace';
    err.textContent = 'Kit demo failed to load app-mirror/index.html — open this page via a local HTTP server (not file://).';
    document.body.appendChild(err);
    return;
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const realBody = doc.body;
  if (!realBody) {
    console.error('[kit-bootstrap] parsed document has no body');
    return;
  }

  // Strip inert-after-parse elements that would duplicate-load or re-fire
  // if we appended them. Inline <svg> (the scrubber mascot) and <style>
  // blocks stay — they're declarative DOM.
  realBody.querySelectorAll('script, link[rel="stylesheet"]').forEach(n => n.remove());

  // Move the cleaned body content into our document.
  while (realBody.firstChild) document.body.appendChild(realBody.firstChild);

  // Load the script chain. Sequential so renderer.js sees tokens + voices +
  // window.api in place before its module-top-level code runs.
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });

  try {
    await loadScript('../app-mirror/lib/tokens-window.js');
    await loadScript('../app-mirror/lib/voices-window.js');
    await loadScript('mock-ipc.js');
    await loadScript('../app-mirror/renderer.js');
  } catch (e) {
    console.error('[kit-bootstrap]', e);
  }
})();
