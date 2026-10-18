// IPC: skills
module.exports = function registerSkillsIpc({ ipcMain, app, dialog, shell, fs, path, skills, skillRoot, getWin }) {
  ipcMain.handle('skills:list', (_e, root) => skills.list(skillRoot(root)).map(({ dir, ...s }) => s));
  ipcMain.handle('skills:get', (_e, name, root) => { const s = skills.get(name, skillRoot(root)); if (!s) return null; const { dir, ...rest } = s; return rest; });
  ipcMain.handle('skills:save', (_e, sk, root) => skills.save({ name: sk?.name, description: sk?.description, body: sk?.body, scope: sk?.scope, by: 'user' }, skillRoot(root)));
  ipcMain.handle('skills:delete', (_e, name, root) => skills.remove(name, skillRoot(root)));
  ipcMain.handle('skills:toggle', (_e, name, on, root) => skills.setEnabled(name, !!on, skillRoot(root)));
  ipcMain.handle('skills:import', async () => {
    const r = await dialog.showOpenDialog(getWin(), { title: 'Choose a SKILL.md file or a skill folder', properties: ['openFile', 'openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    return skills.importFrom(r.filePaths[0]);
  });
  ipcMain.handle('skills:reveal', () => { fs.mkdirSync(path.join(app.getPath('userData'), 'skills'), { recursive: true }); shell.openPath(path.join(app.getPath('userData'), 'skills')); return true; });
};
