// IPC: files
module.exports = function registerFilesIpc(deps) {
  const { ipcMain, BrowserWindow, app, defaultFilesDir, dialog, files, tools, getWin } = deps;
  ipcMain.handle('files:pick', async (e) => {
    const parent = BrowserWindow.fromWebContents(e.sender) || getWin();
    const r = await dialog.showOpenDialog(parent, { properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return [];
    return Promise.all(r.filePaths.map((p) => files.parseAttachment(p)));
  });
  ipcMain.handle('files:parse-buffer', (_e, name, bytes) => files.parseBuffer(name, bytes, app.getPath('temp')));
  ipcMain.handle('files:parse', (_e, paths) => Promise.all((paths || []).map((p) => files.parseAttachment(p))));
  ipcMain.handle('files:default-folder', () => defaultFilesDir());
  ipcMain.handle('files:preview-project', async (_e, folder, rel) => {
    try { return await files.parseAttachment(tools.resolveSafe(folder, rel), 400000); } catch (e) { return { name: String(rel), kind: 'error', error: e.message }; }
  });
};
