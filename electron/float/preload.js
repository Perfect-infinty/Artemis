const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('floatApi', {
  onEvent: (cb) => ipcRenderer.on('float:event', (_e, ev) => cb(ev)),
  decide: (id, ok) => ipcRenderer.invoke('tool:decision', id, ok),
  stop: () => ipcRenderer.invoke('float:stop')
});
