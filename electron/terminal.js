// Built-in terminal: real shells in pseudo-terminals. A small Python helper (pty-helper.py) owns the PTY, so no native module is needed.
// Sessions live in the main process, so a terminal can move between the app and its own window without losing anything.
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const KEEP = 200 * 1024; // scrollback kept for re-attaching

function createTerminals({ helperPath, emit, defaultCwd = () => os.homedir(), platform = process.platform, python }) {
  const sessions = new Map();
  let seq = 0;
  const helper = () => (helperPath || path.join(__dirname, 'pty-helper.py')).replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  const findPython = () => {
    if (python) return python;
    for (const p of ['/usr/bin/python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3', 'python3']) {
      try { execFileSync(p, ['-c', 'import pty'], { stdio: 'ignore', timeout: 4000 }); return p; } catch {}
    }
    return null;
  };

  function open({ cols = 80, rows = 24, cwd, shell } = {}) {
    if (platform === 'win32') return { ok: false, error: 'The built-in terminal is available on macOS and Linux.' };
    const py = findPython();
    if (!py) return { ok: false, error: 'The terminal needs Python 3. On a Mac, run "xcode-select --install" in Terminal, or "brew install python".' };
    const dir = cwd && fs.existsSync(cwd) ? cwd : defaultCwd();
    const sh = shell || process.env.SHELL || '/bin/zsh';
    const child = spawn(py, [helper(), String(Math.max(cols, 2)), String(Math.max(rows, 2)), dir, sh], { stdio: ['pipe', 'pipe', 'pipe', 'pipe'], cwd: dir });
    const id = 't' + (++seq);
    const s = { id, child, dir, sh, buf: Buffer.alloc(0), title: path.basename(sh), exited: null, dec: new (require('string_decoder').StringDecoder)('utf8') };
    sessions.set(id, s);
    child.stdout.on('data', (d) => {
      s.buf = Buffer.concat([s.buf, d]); if (s.buf.length > KEEP) s.buf = s.buf.subarray(s.buf.length - KEEP);
      const text = s.dec.write(d); if (text) emit('term:data', { id, data: text });
    });
    child.stderr.on('data', (d) => emit('term:data', { id, data: String(d) }));
    child.on('error', (e) => { s.exited = -1; emit('term:data', { id, data: `\r\n[could not start: ${e.message}]\r\n` }); emit('term:exit', { id, code: -1 }); });
    child.on('exit', (code) => { s.exited = code ?? 0; emit('term:exit', { id, code: s.exited }); });
    return { ok: true, id, cwd: dir, shell: sh };
  }
  const get = (id) => sessions.get(id);
  return {
    open,
    input: (id, data) => { const s = get(id); if (s && s.exited === null) { try { s.child.stdin.write(String(data)); } catch {} } },
    resize: (id, cols, rows) => { const s = get(id); if (s && s.exited === null) { try { s.child.stdio[3].write(`resize ${Math.max(2, cols | 0)} ${Math.max(2, rows | 0)}\n`); } catch {} } },
    /** Scrollback for a window that attaches to an existing session. */
    snapshot: (id) => { const s = get(id); return s ? { ok: true, data: s.buf.toString('utf8'), exited: s.exited, cwd: s.dir, shell: s.sh } : { ok: false }; },
    close: (id) => { const s = get(id); if (!s) return; sessions.delete(id); try { s.child.stdin.end(); } catch {} setTimeout(() => { try { s.child.kill('SIGKILL'); } catch {} }, 800).unref?.(); },
    closeAll: () => { for (const id of [...sessions.keys()]) { const s = sessions.get(id); sessions.delete(id); try { s.child.kill('SIGHUP'); } catch {} } },
    count: () => sessions.size
  };
}

module.exports = { createTerminals };
