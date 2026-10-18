// IPC: providers
module.exports = function registerProvidersIpc(deps) {
  const { ipcMain, encStr, getProviderKey, providersLib, publicProviders, readProviderKeys, readProviders, writeJson } = deps;
  ipcMain.handle('providers:presets', () => providersLib.PRESETS);
  ipcMain.handle('providers:list', () => ({ providers: publicProviders(), prices: providersLib.priceMap(readProviders()) }));
  ipcMain.handle('providers:save', (_e, p, apiKey) => {
    const list = readProviders();
    const clean = providersLib.normalize(p || {}, p && p.id);
    const i = list.findIndex((x) => x.id === clean.id);
    if (i >= 0) list[i] = clean; else list.push(clean);
    writeJson('providers', list);
    if (typeof apiKey === 'string') {
      const keys = readProviderKeys();
      if (apiKey.trim()) keys[clean.id] = encStr(apiKey.trim());
      else if (p && p.clearKey) delete keys[clean.id];
      writeJson('providerkeys', keys);
    }
    return { providers: publicProviders(), prices: providersLib.priceMap(list), saved: clean.id };
  });
  ipcMain.handle('providers:delete', (_e, id) => {
    writeJson('providers', readProviders().filter((p) => p.id !== id));
    const keys = readProviderKeys(); delete keys[id]; writeJson('providerkeys', keys);
    return { providers: publicProviders(), prices: providersLib.priceMap(readProviders()) };
  });
  ipcMain.handle('providers:test', (_e, p, apiKey) => {
    const typed = typeof apiKey === 'string' && apiKey.trim();
    if (typed) return providersLib.probe({ baseUrl: p && p.baseUrl, key: typed, models: p && p.models, headers: p && p.headers });
    // the stored key only ever goes to the saved provider's own URL and headers, never to ones sent by the renderer
    const saved = p && p.id ? readProviders().find((x) => x.id === p.id) : null;
    const stored = saved ? getProviderKey(saved.id) || '' : '';
    if (stored) return providersLib.probe({ baseUrl: saved.baseUrl, key: stored, models: p.models || saved.models, headers: saved.headers });
    return providersLib.probe({ baseUrl: p && p.baseUrl, key: '', models: p && p.models, headers: p && p.headers });
  });
};
