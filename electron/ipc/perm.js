// IPC: perm
module.exports = function registerPermIpc(deps) {
  const { ipcMain, permissions } = deps;
  ipcMain.handle('perm:status', () => permissions.status());
  ipcMain.handle('perm:request', async (_e, kind) => { await permissions.request(kind); return permissions.status(); });
};
