// IPC: usage
module.exports = function registerUsageIpc(deps) {
  const { ipcMain, getUsage, setUsage } = deps;
  ipcMain.handle('usage:get', () => getUsage().slice());
  ipcMain.handle('usage:clear', () => { setUsage([]); return []; });
};
