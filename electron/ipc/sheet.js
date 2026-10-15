// IPC: sheet
module.exports = function registerSheetIpc(deps) {
  const { ipcMain, BrowserWindow, dialog, files } = deps;
  ipcMain.handle('sheet:load', (_e, p) => { try { return { ok: true, ...files.loadSheets(p) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('sheet:save', (_e, p, sheets, opts) => { try { return { ok: true, ...files.saveSheets(p, sheets, opts || {}) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('sheet:save-as', async (e, sheets, suggested, opts) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showSaveDialog(w, { defaultPath: suggested || 'table.xlsx', filters: [{ name: 'Spreadsheet', extensions: ['xlsx', 'csv', 'tsv', 'xls', 'xlsb', 'ods'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    try { return { ok: true, path: r.filePath, ...files.saveSheets(r.filePath, sheets, { ...(opts || {}), backup: false }) }; } catch (err) { return { ok: false, error: err.message }; }
  });
};
