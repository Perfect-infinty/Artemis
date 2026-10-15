// IPC: project
module.exports = function registerProjectIpc(deps) {
  const { ipcMain, dialog, fs, logoDir, nativeImage, path, getWin } = deps;
  ipcMain.handle('project:pick-logo', async (_e, folder) => {
    const r = await dialog.showOpenDialog(getWin(), { title: 'Choose a project logo', properties: ['openFile'], filters: [{ name: 'Images (GIFs stay animated)', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }] });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    const file = r.filePaths[0];
    const dir = logoDir(folder);
    try {
      if (/\.gif$/i.test(file)) {
        if (fs.statSync(file).size > 1024 * 1024) return { ok: false, error: 'That GIF is larger than 1 MB. Pick a smaller one.' };
        const buf = fs.readFileSync(file);
        fs.mkdirSync(dir, { recursive: true });
        try { fs.unlinkSync(path.join(dir, 'logo.png')); } catch {}
        fs.writeFileSync(path.join(dir, 'logo.gif'), buf);
        return { ok: true, logo: 'data:image/gif;base64,' + buf.toString('base64') };
      }
      const img = nativeImage.createFromPath(file);
      if (img.isEmpty()) return { ok: false, error: 'That file could not be read as an image.' };
      const { width, height } = img.getSize();
      const side = Math.min(width, height);
      const png = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side }).resize({ width: 128, height: 128, quality: 'best' }).toPNG();
      fs.mkdirSync(dir, { recursive: true });
      try { fs.unlinkSync(path.join(dir, 'logo.gif')); } catch {}
      fs.writeFileSync(path.join(dir, 'logo.png'), png);
      return { ok: true, logo: 'data:image/png;base64,' + png.toString('base64') };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  ipcMain.handle('project:clear-logo', (_e, folder) => { for (const e of ['png', 'gif']) { try { fs.unlinkSync(path.join(logoDir(folder), 'logo.' + e)); } catch {} } return { ok: true }; });
};
