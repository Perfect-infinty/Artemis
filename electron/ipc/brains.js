// IPC: brains
module.exports = function registerBrainsIpc(deps) {
  const { ipcMain, brains } = deps;
  ipcMain.handle('brains:list', () => brains.list());
  ipcMain.handle('brains:save', (_e, b) => brains.save(b));
  ipcMain.handle('brains:delete', (_e, name) => brains.remove(name));
};
