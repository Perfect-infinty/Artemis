// IPC: term
module.exports = function registerTermIpc(deps) {
  const { ipcMain, BrowserWindow, openTermWindow, termWindows, terminals, getWin } = deps;
  ipcMain.handle('term:open', (_e, o = {}) => terminals.open({ cols: o.cols, rows: o.rows, cwd: o.cwd }));
  ipcMain.handle('term:input', (_e, id, data) => { terminals.input(String(id), data); return true; });
  ipcMain.handle('term:resize', (_e, id, cols, rows) => { terminals.resize(String(id), cols, rows); return true; });
  ipcMain.handle('term:snapshot', (_e, id) => terminals.snapshot(String(id)));
  ipcMain.handle('term:close', (_e, id) => { const w = termWindows.get(String(id)); if (w && !w.isDestroyed()) { w.__docked = false; w.close(); } else terminals.close(String(id)); return true; });
  ipcMain.handle('term:popout', (_e, id, float) => { openTermWindow(String(id), !!float); return true; });
  ipcMain.handle('term:dock', (_e, id) => {
    const w = termWindows.get(String(id));
    if (w && !w.isDestroyed()) { w.__docked = true; w.close(); }
    if (getWin() && !getWin().isDestroyed()) { getWin().show(); getWin().focus(); getWin().webContents.send('term:docked', { id: String(id) }); }
    return true;
  });
  ipcMain.handle('term:float', (e, on) => { const w = BrowserWindow.fromWebContents(e.sender); if (!w) return false; w.setAlwaysOnTop(!!on, 'floating'); return w.isAlwaysOnTop(); });
};
