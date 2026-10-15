// IPC: agents
module.exports = function registerAgentsIpc(deps) {
  const { ipcMain, agents, fs, shell, skillRoot } = deps;
  ipcMain.handle('agents:list', (_e, root) => agents.list(skillRoot(root)).map(({ file, ...a }) => a));
  ipcMain.handle('agents:save', (_e, a, root) => agents.save(a || {}, skillRoot(root)));
  ipcMain.handle('agents:delete', (_e, name, root) => agents.remove(name, skillRoot(root)));
  ipcMain.handle('agents:reveal', () => { fs.mkdirSync(agents.dir, { recursive: true }); shell.openPath(agents.dir); return true; });
  ipcMain.handle('agents:groups', () => { const { GROUPS, GROUP_LABELS } = require('../subagents'); return Object.keys(GROUPS).map((id) => ({ id, label: GROUP_LABELS[id] })); });
};
