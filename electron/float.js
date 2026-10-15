// Floating always-on-top panel shown while the assistant controls the computer.
// It never takes focus (so typed keys go to the app being controlled) and is hidden from screenshots.
const path = require('path');

function createFloat({ BrowserWindow, screen }) {
  let w = null;

  const alive = () => !!w && !w.isDestroyed();

  function open() {
    if (alive()) { w.showInactive(); return; }
    const wa = screen.getPrimaryDisplay().workArea;
    const width = 360, height = 440, margin = 16;
    w = new BrowserWindow({
      width, height, x: wa.x + wa.width - width - margin, y: wa.y + wa.height - height - margin,
      frame: false, alwaysOnTop: true, focusable: false, skipTaskbar: true, resizable: true, minimizable: false, maximizable: false,
      fullscreenable: false, hasShadow: true, show: false, backgroundColor: '#1f1e1d',
      webPreferences: { preload: path.join(__dirname, 'float', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    try { w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true }); } catch {}
    try { w.setContentProtection(true); } catch {} // keeps the panel out of screenshots
    w.loadFile(path.join(__dirname, 'float', 'index.html'));
    w.once('ready-to-show', () => { if (alive()) w.showInactive(); });
    w.on('closed', () => { w = null; });
  }

  function close() { if (alive()) w.close(); w = null; }
  function send(ev) { if (alive() && !w.webContents.isLoading()) w.webContents.send('float:event', ev); else if (alive()) w.webContents.once('did-finish-load', () => alive() && w.webContents.send('float:event', ev)); }
  /** Screen rectangle (points) covered by the panel, or null. */
  function rect() { return alive() && w.isVisible() ? w.getBounds() : null; }

  return { open, close, send, rect, isOpen: alive };
}

module.exports = { createFloat };
