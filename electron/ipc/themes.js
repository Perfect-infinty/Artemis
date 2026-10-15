// IPC: themes
module.exports = function registerThemesIpc({ ipcMain, dialog, shell, fs, path, themes, themeDirs, listThemes, nativeThemeFor, broadcastTheme, getSettings, saveSettings, getWin }) {
  ipcMain.handle('themes:list', (_e, folder) => listThemes(folder));
  ipcMain.handle('themes:folder', (_e, which) => { const d = themeDirs(); const target = which === 'user' ? d.user : d.project || d.user; fs.mkdirSync(target, { recursive: true }); return target; });
  ipcMain.handle('themes:open', async (_e, which) => { const d = themeDirs(); const target = which === 'user' ? d.user : d.project || d.user; fs.mkdirSync(target, { recursive: true }); const err = await shell.openPath(target); return err ? { ok: false, error: err } : { ok: true, folder: target }; });
  ipcMain.handle('themes:import', async (_e, folder) => {
    const d = themeDirs();
    const target = folder && d.project && path.resolve(folder) === path.resolve(d.project) ? d.project : d.user;
    const picked = await dialog.showOpenDialog(getWin(), { title: 'Import theme', filters: [{ name: 'Theme', extensions: ['json'] }], properties: ['openFile', 'multiSelections'] });
    if (picked.canceled || !picked.filePaths.length) return null;
    const out = themes.importFiles(picked.filePaths, { user: d.user, project: target });
    nativeThemeFor(); broadcastTheme();
    return out;
  });
  ipcMain.handle('themes:delete', (_e, file) => { const d = themeDirs(); const out = themes.removeFile(file, d); const id = getSettings().theme; if (!listThemes().themes.some((t) => t.id === id)) saveSettings({ theme: 'system' }); nativeThemeFor(); broadcastTheme(); return out; });
  ipcMain.handle('themes:reveal', () => { const d = themeDirs(); const target = d.project || d.user; fs.mkdirSync(target, { recursive: true }); shell.openPath(target); return target; });
};
