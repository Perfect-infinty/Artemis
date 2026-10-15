// Sentinel widget: a small always-on-top window that shows what Sentinel is doing. It stays visible when the main
// window is minimized or hidden, can be dragged anywhere, and remembers where you left it.
const path = require('path');

function createSentinelWidget({ BrowserWindow, screen, isDev, getPos, setPos }) {
  let w = null; let moveTimer = null;
  const WIDTH = 300, WIDE = 460, MIN_H = 48;
  const alive = () => !!w && !w.isDestroyed();

  function startPos() {
    const saved = getPos && getPos();
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      // keep it on a screen that still exists
      const d = screen.getDisplayNearestPoint({ x: saved.x, y: saved.y });
      const b = d.workArea;
      return { x: Math.min(Math.max(saved.x, b.x - WIDTH + 80), b.x + b.width - 80), y: Math.min(Math.max(saved.y, b.y), b.y + b.height - 60) };
    }
    const wa = screen.getPrimaryDisplay().workArea;
    return { x: Math.round(wa.x + (wa.width - WIDTH) / 2), y: wa.y + 12 };
  }

  function create() {
    const p = startPos();
    w = new BrowserWindow({
      width: WIDTH, height: MIN_H, x: p.x, y: p.y, frame: false, transparent: true, resizable: false, movable: true, alwaysOnTop: true,
      skipTaskbar: true, show: false, hasShadow: false, fullscreenable: false, minimizable: false, maximizable: false, focusable: true,
      backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    try { w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true }); } catch {}
    if (isDev) w.loadURL('http://localhost:5173/#sentinel');
    else w.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'), { hash: 'sentinel' });
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.on('move', () => {
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => { if (alive() && setPos) { const [x, y] = w.getPosition(); setPos({ x, y }); } }, 400);
    });
    w.on('closed', () => { w = null; });
  }

  function show() {
    if (!alive()) create();
    const go = () => { if (alive() && !w.isVisible()) w.showInactive(); };
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', go); else go();
  }
  function hide() { if (alive()) w.hide(); }
  function destroy() { if (alive()) w.destroy(); w = null; }
  function send(channel, payload) { if (alive() && !w.webContents.isLoading()) w.webContents.send(channel, payload); }
  /** The page reports how tall its content is. */
  function resize(h, wide) {
    if (!alive()) return;
    const width = wide ? WIDE : WIDTH;
    const height = Math.max(MIN_H, Math.min(wide ? 600 : 380, Math.round(Number(h) || MIN_H)));
    const [cw, cur] = w.getSize();
    if (cur === height && cw === width) return;
    w.setResizable(true); w.setSize(width, height); w.setResizable(false);
  }
  return { show, hide, destroy, send, resize, isVisible: () => alive() && w.isVisible(), get window() { return alive() ? w : null; } };
}

module.exports = { createSentinelWidget };
