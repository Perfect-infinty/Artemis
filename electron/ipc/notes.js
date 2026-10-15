// IPC: notes
module.exports = function registerNotesIpc({ ipcMain, dialog, shell, notesStore, readJson, writeJson, getWin }) {
  const notesSafe = (fn) => async (_e, ...a) => { try { return { ok: true, ...(await fn(...a)) }; } catch (e) { return { ok: false, error: e.message }; } };
  ipcMain.handle('notes:root', () => notesStore.root());
  ipcMain.handle('notes:pickRoot', async () => {
    const r = await dialog.showOpenDialog(getWin(), { title: 'Choose the Notes folder', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    writeJson('settings', { ...readJson('settings', {}), notesFolder: r.filePaths[0] });
    return r.filePaths[0];
  });
  ipcMain.handle('notes:list', notesSafe(() => ({ items: notesStore.list() })));
  ipcMain.handle('notes:read', notesSafe((p) => notesStore.read(p, { max: 2e6 })));
  ipcMain.handle('notes:write', notesSafe((p, t) => notesStore.write(p, t)));
  ipcMain.handle('notes:create', notesSafe((n, f, t) => notesStore.create(n, f, t)));
  ipcMain.handle('notes:createFolder', notesSafe((n, f) => notesStore.createFolder(n, f)));
  ipcMain.handle('notes:rename', notesSafe((p, n) => notesStore.rename(p, n)));
  ipcMain.handle('notes:move', notesSafe((p, f) => notesStore.move(p, f)));
  ipcMain.handle('notes:delete', notesSafe((p) => { notesStore.remove(p); return {}; }));
  ipcMain.handle('notes:search', notesSafe((q) => ({ results: notesStore.search(q) })));
  ipcMain.handle('notes:reveal', () => { shell.openPath(notesStore.root()); return true; });
};
