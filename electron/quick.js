// Quick chat: a small always-on-top window opened from the tray icon or a global shortcut.
const path = require('path');

function createQuick({ BrowserWindow, screen, isDev, nativeTheme }) {
  let w = null;
  let pos = null; // where the user last dragged the window to
  let mode = 'chat'; // the tab the window shows: 'chat' or 'search' (the renderer reports Cmd+1 / Cmd+2 switches)
  let shownAt = 0, hiddenAt = 0; // a tray click steals focus for a moment: without these the window opens and instantly closes
  const alive = () => !!w && !w.isDestroyed();
  const WIDTH = 680, COLLAPSED = 106, WITH_CHIPS = 164, EXPANDED = 560;

  function place() {
    if (pos && screen.getAllDisplays().some((d) => pos.x >= d.bounds.x - 20 && pos.x < d.bounds.x + d.bounds.width - 60 && pos.y >= d.bounds.y && pos.y < d.bounds.y + d.bounds.height - 60)) { w.setPosition(pos.x, pos.y); return; }
    const pt = screen.getCursorScreenPoint();
    const wa = screen.getDisplayNearestPoint(pt).workArea;
    const [width, height] = w.getSize();
    w.setPosition(Math.round(wa.x + (wa.width - width) / 2), Math.round(wa.y + Math.min(wa.height * 0.18, wa.height - height - 20)));
  }

  function create() {
    w = new BrowserWindow({
      width: WIDTH, height: COLLAPSED, frame: false, transparent: true, resizable: false, movable: true, alwaysOnTop: true,
      skipTaskbar: true, show: false, hasShadow: false, fullscreenable: false, minimizable: false, maximizable: false,
      backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    w.setAlwaysOnTop(true, 'floating');
    try { w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true }); } catch {}
    if (isDev) w.loadURL('http://localhost:5173/#quick');
    else w.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'), { hash: 'quick' });
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.on('blur', () => { if (!alive() || w.__hideOnBlur === false) return; if (Date.now() - shownAt < 500) { try { w.focus(); } catch {} return; } hide(); });
    w.on('closed', () => { w = null; });
  }

  /** Opens the window on a tab: 'chat' (default) or 'search'. */
  function show(on) {
    mode = on === 'search' ? 'search' : 'chat';
    if (!alive()) create();
    if (!w.isVisible()) place();
    const go = () => { if (!alive()) return; shownAt = Date.now(); w.show(); w.focus(); try { if (process.platform === 'darwin') require('electron').app.dock?.show(); } catch {} w.webContents.send('quick:shown', { mode }); };
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', go); else go();
  }
  function hide() { if (alive() && w.isVisible()) { hiddenAt = Date.now(); try { const [x, y] = w.getPosition(); pos = { x, y }; } catch {} w.hide(); } }
  const isVisible = () => alive() && w.isVisible();
  // Clicking the tray icon while the window is open first blurs it (it hides), then the click arrives: that click means "close", not "open again".
  // With the window open on the other tab, the shortcut switches to its tab instead of closing the window.
  function toggle(on) {
    const want = on === 'search' ? 'search' : 'chat';
    if (isVisible()) { if (on && want !== mode) show(want); else hide(); } else if (Date.now() - hiddenAt > 350) show(want);
  }
  const setMode = (m) => { mode = m === 'search' ? 'search' : 'chat'; };
  function resize(mode) {
    if (!alive()) return;
    const h = mode === 'chips' ? WITH_CHIPS : mode ? EXPANDED : COLLAPSED;
    const [, cur] = w.getSize();
    if (cur === h) return;
    w.setResizable(true); w.setSize(WIDTH, h); w.setResizable(false);
  }
  /** While a task is running the window should not vanish when it loses focus. */
  function keepOpen(on) { if (alive()) w.__hideOnBlur = !on; }

  return { show, hide, toggle, resize, isVisible, keepOpen, setMode, get window() { return alive() ? w : null; } };
}

module.exports = { createQuick };
