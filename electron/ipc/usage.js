// IPC: usage
module.exports = function registerUsageIpc(deps) {
  const { ipcMain, readJson, writeJson } = deps;
  ipcMain.handle('usage:get', () => readJson('usage', []));
  ipcMain.handle('usage:clear', () => { writeJson('usage', []); return []; });
};
