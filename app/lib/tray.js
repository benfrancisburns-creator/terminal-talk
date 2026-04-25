'use strict';

// System-tray icon + context menu — extracted from app/main.js
// 2026-04-25 (#29 lib-extraction sweep) to bring main.js under the
// 2000-line absolute ceiling.
//
// Lifecycle: `start()` creates the Tray instance from `iconPath` and
// wires the click + right-click handlers. Right-click opens a context
// menu with Show/Hide toolbar + Quit. `stop()` destroys the Tray.
//
// Factory pattern: caller injects Electron's `Tray`, `Menu`,
// `nativeImage`, `app`, `getWin`, `toggleWindow`, `iconPath`, `diag`.

function createTray({
  Tray,
  Menu,
  nativeImage,
  app,
  iconPath,
  getWin,
  toggleWindow,
  diag = () => {},
} = {}) {
  if (!Tray) throw new Error('createTray: Tray required');
  if (!Menu) throw new Error('createTray: Menu required');
  if (!nativeImage) throw new Error('createTray: nativeImage required');
  if (!app) throw new Error('createTray: app required');
  if (!iconPath) throw new Error('createTray: iconPath required');
  if (typeof getWin !== 'function') throw new Error('createTray: getWin required');
  if (typeof toggleWindow !== 'function') throw new Error('createTray: toggleWindow required');

  let tray = null;

  function start() {
    if (tray) return;
    try {
      const img = nativeImage.createFromPath(iconPath);
      if (img.isEmpty()) {
        diag(`tray: icon file missing or empty at ${iconPath} — tray disabled`);
        return;
      }
      tray = new Tray(img);
      tray.setToolTip('Terminal Talk');
      tray.on('click', () => {
        try { toggleWindow(); } catch (e) { diag(`tray click: ${e.message}`); }
      });
      const buildMenu = () => {
        const win = getWin();
        return Menu.buildFromTemplate([
          {
            label: (win && !win.isDestroyed() && win.isVisible()) ? 'Hide toolbar' : 'Show toolbar',
            click: () => { try { toggleWindow(); } catch {} },
          },
          { type: 'separator' },
          {
            label: 'Quit Terminal Talk',
            click: () => { app.quit(); },
          },
        ]);
      };
      tray.on('right-click', () => {
        try { tray.popUpContextMenu(buildMenu()); } catch (e) { diag(`tray right-click: ${e.message}`); }
      });
      diag('tray: started');
    } catch (e) {
      diag(`tray: start failed: ${e.message}`);
      tray = null;
    }
  }

  function stop() {
    if (!tray) return;
    try { tray.destroy(); } catch {}
    tray = null;
  }

  return { start, stop };
}

module.exports = { createTray };
