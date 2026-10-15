// Command palette (Cmd/Ctrl+K): a small floating window that opens over whatever app is in front, like Notion or Raycast.
const path = require('path');

function createPalette({ BrowserWindow, screen, isDev }) {
  let w = null;
  let shownAt = 0, hiddenAt = 0;
  const alive = () => !!w && !w.isDestroyed();

  function place() {
    const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const [width] = w.getSize();
    w.setPosition(Math.round(wa.x + (wa.width - width) / 2), Math.round(wa.y + wa.height * 0.16));
  }

  function create() {
    w = new BrowserWindow({
      width: 660, height: 520, frame: false, transparent: true, resizable: false, movable: false, alwaysOnTop: true,
      skipTaskbar: true, show: false, hasShadow: false, fullscreenable: false, minimizable: false, maximizable: false,
      backgroundColor: '#00000000',
      // macOS: a non-activating panel. A normal window's show() activates the whole app, which pulls the main Artemis window in front of the app you were using.
      ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    w.setAlwaysOnTop(true, 'floating');
    try { w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true }); } catch {}
    if (isDev) w.loadURL('http://localhost:5173/#palette');
    else w.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'), { hash: 'palette' });
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.on('blur', () => { if (!alive()) return; if (Date.now() - shownAt < 400) { try { w.focus(); } catch {} return; } hide(); });
    w.on('closed', () => { w = null; });
  }

  function show() {
    if (!alive()) create();
    place();
    // showInactive() does not activate the app (show() does, and that raises every Artemis window); focus() then only gives the panel the keyboard.
    const go = () => { if (!alive()) return; shownAt = Date.now(); if (process.platform === 'darwin') w.showInactive(); else w.show(); w.focus(); w.webContents.send('palette:shown'); };
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', go); else go();
  }
  function hide() { if (alive() && w.isVisible()) { hiddenAt = Date.now(); w.hide(); } }
  const isVisible = () => alive() && w.isVisible();
  function toggle() { if (isVisible()) hide(); else if (Date.now() - hiddenAt > 250) show(); }

  return { show, hide, toggle, isVisible };
}

module.exports = { createPalette };
