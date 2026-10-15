// IPC: profile
module.exports = function registerProfileIpc(deps) {
  const { ipcMain, avatarData, avatarFile, dialog, fs, nativeImage, path, profileDir, shell, getWin } = deps;
  ipcMain.handle('profile:get', () => ({ avatar: avatarData(), folder: profileDir() }));
  ipcMain.handle('profile:pick-avatar', async () => {
    const r = await dialog.showOpenDialog(getWin(), { title: 'Choose a profile picture', properties: ['openFile'], filters: [{ name: 'Images (GIFs stay animated)', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }] });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    const file = r.filePaths[0];
    fs.mkdirSync(path.dirname(avatarFile()), { recursive: true });
    if (/\.gif$/i.test(file)) {
      // keep GIFs as they are so they stay animated (a resize would flatten them to one frame)
      if (fs.statSync(file).size > 8 * 1024 * 1024) return { ok: false, error: 'That GIF is larger than 8 MB. Pick a smaller one.' };
      fs.copyFileSync(file, avatarFile('gif'));
      try { fs.unlinkSync(avatarFile('png')); } catch {}
      return { ok: true, avatar: avatarData() };
    }
    const img = nativeImage.createFromPath(file);
    if (img.isEmpty()) return { ok: false, error: 'That file could not be read as an image.' };
    const { width, height } = img.getSize();
    const side = Math.min(width, height);
    const out = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side }).resize({ width: 256, height: 256, quality: 'best' });
    fs.writeFileSync(avatarFile('png'), out.toPNG());
    try { fs.unlinkSync(avatarFile('gif')); } catch {}
    return { ok: true, avatar: avatarData() };
  });
  ipcMain.handle('profile:clear-avatar', () => { for (const e of ['png', 'gif']) { try { fs.unlinkSync(avatarFile(e)); } catch {} } return { ok: true, avatar: null }; });
  ipcMain.handle('profile:reveal', () => { fs.mkdirSync(path.join(profileDir(), 'images'), { recursive: true }); shell.openPath(profileDir()); return true; });
};
