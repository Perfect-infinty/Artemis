// IPC: shell
module.exports = function registerShellIpc(deps) {
  const { ipcMain, fs, shell } = deps;
  ipcMain.handle('shell:open', (_e, p) => (p && fs.existsSync(p) ? shell.openPath(p) : null));
  ipcMain.handle('shell:reveal', (_e, p) => { if (p && fs.existsSync(p)) shell.showItemInFolder(p); });
};
