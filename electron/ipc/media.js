// IPC: media
module.exports = function registerMediaIpc(deps) {
  const { ipcMain, mediaDir, mediaGen, shell } = deps;
  ipcMain.handle('media:load', (_e, file) => { try { return mediaGen.load(mediaDir(), file); } catch { return null; } });
  ipcMain.handle('media:reveal', (_e, file) => { try { mediaGen.load(mediaDir(), file); shell.showItemInFolder(file); } catch {} });
};
