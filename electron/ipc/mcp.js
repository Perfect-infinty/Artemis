// IPC: mcp
module.exports = function registerMcpIpc(deps) {
  const { ipcMain, mcp, oauthCallbackServer, oauthPending, parseImport, readMcpList, shell, writeJson } = deps;
  ipcMain.handle('mcp:status', () => mcp.status(readMcpList()));
  ipcMain.handle('mcp:list', () => readMcpList());
  ipcMain.handle('mcp:save', async (_e, list) => {
    const clean = (Array.isArray(list) ? list : []).map((c) => ({
      id: String(c.id || Math.random().toString(36).slice(2, 10)), name: String(c.name || 'server').slice(0, 60), type: c.type === 'http' ? 'http' : 'stdio',
      command: String(c.command || ''), args: Array.isArray(c.args) ? c.args.map(String) : [], env: c.env && typeof c.env === 'object' ? c.env : {},
      url: String(c.url || ''), headers: c.headers && typeof c.headers === 'object' ? c.headers : {}, oauth: c.oauth && typeof c.oauth === 'object' ? c.oauth : undefined,
      authorizationUrl: String(c.authorizationUrl || ''), tokenUrl: String(c.tokenUrl || ''), clientId: String(c.clientId || ''), clientSecret: String(c.clientSecret || ''), scope: String(c.scope || ''), enabled: c.enabled !== false
    }));
    writeJson('mcp', clean);
    await mcp.configure(clean);
    return mcp.status(clean);
  });
  ipcMain.handle('mcp:oauth-start', async (_e, cfg) => {
    try {
      if (!cfg?.authorizationUrl || !cfg?.tokenUrl) throw new Error('Authorization URL and token URL are required.');
      const state = crypto.randomBytes(24).toString('hex');
      const redirectUri = `http://127.0.0.1:${oauthCallbackServer.address().port}/callback`;
      const params = new URLSearchParams({ response_type: 'code', client_id: cfg.clientId || '', redirect_uri: redirectUri, state, ...(cfg.scope ? { scope: cfg.scope } : {}) });
      shell.openExternal(`${cfg.authorizationUrl}${cfg.authorizationUrl.includes('?') ? '&' : '?'}${params.toString()}`);
      const result = await new Promise((resolve, reject) => { oauthPending.set(state, { resolve, reject }); setTimeout(() => { if (oauthPending.delete(state)) reject(new Error('OAuth timed out.')); }, 180000); });
      const body = new URLSearchParams({ grant_type: 'authorization_code', code: result.code, client_id: cfg.clientId || '', redirect_uri: redirectUri, ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}) });
      const tokenRes = await fetch(cfg.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body });
      const token = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || !token.access_token) throw new Error(token.error_description || token.error || `Token request failed (${tokenRes.status})`);
      return { ok: true, oauth: { accessToken: token.access_token, refreshToken: token.refresh_token || '', expiresAt: token.expires_in ? Date.now() + Number(token.expires_in) * 1000 : 0 } };
    } catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
  ipcMain.handle('mcp:oauth-callback-url', () => `http://127.0.0.1:${oauthCallbackServer.address().port}/callback`);
  ipcMain.handle('mcp:oauth-open', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return true; });
  ipcMain.handle('mcp:import', (_e, text) => { try { return { ok: true, servers: parseImport(String(text)) }; } catch (e) { return { ok: false, error: e.message }; } });
};
