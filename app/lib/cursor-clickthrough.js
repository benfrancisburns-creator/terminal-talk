'use strict';

function normaliseRegion(region) {
  if (!region || typeof region !== 'object') return null;
  const next = {
    x: Math.max(0, Math.floor(Number(region.x))),
    y: Math.max(0, Math.floor(Number(region.y))),
    width: Math.max(1, Math.ceil(Number(region.width))),
    height: Math.max(1, Math.ceil(Number(region.height))),
  };
  if (!Number.isFinite(next.x) || !Number.isFinite(next.y) ||
      !Number.isFinite(next.width) || !Number.isFinite(next.height)) {
    return null;
  }
  return next;
}

function cursorOverRegion(cursor, bounds, region) {
  const overWindow = cursor.x >= bounds.x &&
    cursor.x < bounds.x + bounds.width &&
    cursor.y >= bounds.y &&
    cursor.y < bounds.y + bounds.height;
  if (!overWindow) return { overWindow, overInteractive: false };
  if (!region) return { overWindow, overInteractive: true };
  const overInteractive = cursor.x >= bounds.x + region.x &&
    cursor.x < bounds.x + region.x + region.width &&
    cursor.y >= bounds.y + region.y &&
    cursor.y < bounds.y + region.y + region.height;
  return { overWindow, overInteractive };
}

function createCursorClickthroughDriver({
  getWin,
  screen,
  diag = () => {},
  onStateChange = null,
  intervalMs = 80,
  testMode = false,
}) {
  let interactiveRegion = null;
  let forceInteractiveUntil = 0;
  let lastLogged = null;
  let lastStateKey = null;
  let timer = null;

  function setInteractiveRegion(region) {
    const next = normaliseRegion(region);
    interactiveRegion = next;
    return !!next;
  }

  function forceInteractive(ms = 1200) {
    const duration = Math.max(0, Math.floor(Number(ms) || 0));
    forceInteractiveUntil = Math.max(forceInteractiveUntil, Date.now() + duration);
  }

  function pollOnce() {
    const win = getWin();
    if (!win || win.isDestroyed()) return;
    if (testMode) return;
    let cursor;
    try { cursor = screen.getCursorScreenPoint(); } catch { return; }
    let bounds;
    try { bounds = win.getBounds(); } catch { return; }
    const { overWindow, overInteractive } = cursorOverRegion(cursor, bounds, interactiveRegion);
    const forcedInteractive = Date.now() < forceInteractiveUntil;
    const wantClickthrough = forcedInteractive ? false : !overInteractive;
    try {
      win.setIgnoreMouseEvents(wantClickthrough, { forward: true });
    } catch (e) {
      diag(`reload-trace: cursor-poll setIgnoreMouseEvents threw: ${e && e.message}`);
      return;
    }
    const effectiveOverInteractive = forcedInteractive ? true : overInteractive;
    const stateKey = `${overWindow ? 1 : 0}:${effectiveOverInteractive ? 1 : 0}`;
    if (stateKey !== lastStateKey) {
      lastStateKey = stateKey;
      if (typeof onStateChange === 'function') {
        try { onStateChange({ overWindow, overInteractive: effectiveOverInteractive }); } catch {}
      }
    }
    if (wantClickthrough !== lastLogged) {
      lastLogged = wantClickthrough;
      diag(`reload-trace: cursor-poll overWindow=${overWindow} overInteractive=${overInteractive} forcedInteractive=${forcedInteractive} ignoreMouseEvents=${wantClickthrough}`);
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(pollOnce, intervalMs);
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return { start, stop, setInteractiveRegion, forceInteractive, pollOnce };
}

module.exports = {
  createCursorClickthroughDriver,
  _internals: { normaliseRegion, cursorOverRegion },
};
