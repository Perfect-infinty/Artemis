// IPC: shell
module.exports = function registerShellIpc(deps) {
  const { ipcMain, fs, shell } = deps;
  // Never launch apps or scripts from a path the renderer passes: show them in Finder instead.
  const RUNNABLE = /\.(app|command|sh|bash|zsh|tool|pkg|mpkg|dmg|terminal|scpt|scptd|applescript|workflow|action|jar|exe|bat|cmd|ps1|vbs|py|pl|rb)\/?$/i;
  ipcMain.handle('shell:open', (_e, p) => {
    if (!p || typeof p !== 'string' || !fs.existsSync(p)) return null;
    let bin = false; // an extensionless executable would run in Terminal
    try { const st = fs.statSync(p); bin = st.isFile() && (st.mode & 0o111) !== 0 && !require('path').extname(p); } catch {}
    if (RUNNABLE.test(p) || bin) { shell.showItemInFolder(p); return ''; }
    return shell.openPath(p);
  });
  // Reveal a file in Finder, or open it directly when the path is already a folder.
  ipcMain.handle('shell:reveal', (_e, p) => {
    if (!p || !fs.existsSync(p)) return false;
    try {
      if (fs.statSync(p).isDirectory()) shell.openPath(p);
      else shell.showItemInFolder(p);
      return true;
    } catch { return false; }
  });
};
