// IPC: logs
module.exports = function registerLogsIpc({ ipcMain, shell, fs, logger }) {
  ipcMain.handle('logs:get', (_e, n) => ({ entries: logger.recent(Number(n) || 1000), tasks: logger.tasks(), file: logger.file() }));
  ipcMain.handle('logs:clear', () => logger.clear());
  ipcMain.handle('logs:reveal', () => { try { fs.mkdirSync(logger.dir, { recursive: true }); fs.existsSync(logger.file()) ? shell.showItemInFolder(logger.file()) : shell.openPath(logger.dir); } catch {} return true; });
  ipcMain.handle('logs:add', (_e, o = {}) => { logger.log(o.level, 'ui:' + String(o.source || 'app').slice(0, 16), o.message, o.data); return true; });
  ipcMain.handle('logs:progress', (_e, o = {}) => { if (o.id) logger.progress(String(o.id).slice(0, 60), o.label, { pct: o.pct, state: o.state, detail: o.detail }); return true; });
};
