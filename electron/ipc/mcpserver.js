// IPC: mcpserver
module.exports = function registerMcpserverIpc(deps) {
  const { ipcMain, mcpServerInfo, saveSettings, setSecret, syncMcpServer } = deps;
  ipcMain.handle('mcpserver:info', () => mcpServerInfo());
  ipcMain.handle('mcpserver:set', async (_e, o = {}) => {
    const patch = {};
    if (typeof o.enabled === 'boolean') patch.mcpServerEnabled = o.enabled;
    if (typeof o.alwaysAllow === 'boolean') patch.mcpAlwaysAllow = o.alwaysAllow;
    if (o.port !== undefined) patch.mcpServerPort = Math.min(65535, Math.max(1024, parseInt(o.port, 10) || 8788));
    saveSettings(patch);
    if (o.resetToken) setSecret('mcpToken', require('crypto').randomBytes(24).toString('hex'));
    await syncMcpServer();
    return mcpServerInfo();
  });
};
