// run_command: runs a shell command on the user's machine. Not a sandbox.
const { exec } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const BLOCKED = [
  [/\bsudo\b/, 'sudo is not allowed'],
  [/\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rf][a-zA-Z]*\s+(-[a-zA-Z]+\s+)*(\/|~|\$HOME|\/\*|~\/\*)(\s|$)/, 'recursive delete of / or ~ is not allowed'],
  [/\bmkfs(\.|\b)/, 'formatting disks is not allowed'],
  [/\bdd\s+[^|;&]*\bof=\/dev\//, 'writing to devices is not allowed'],
  [/:\(\)\s*\{/, 'fork bombs are not allowed'],
  [/\b(shutdown|reboot|halt)\b/, 'shutdown/reboot is not allowed'],
  [/\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/, 'piping downloads into a shell is not allowed']
];

const clip = (s, n) => (s.length > n ? s.slice(0, n) + `\n…[truncated, ${s.length} characters total]` : s);

function runCommand({ command, cwd, timeout_seconds }, { signal, defaultCwd } = {}) {
  return new Promise((resolve) => {
    const cmd = String(command || '').trim();
    if (!cmd) return resolve({ ok: false, text: 'Error: command is empty' });
    for (const [re, why] of BLOCKED) if (re.test(cmd)) return resolve({ ok: false, text: `Error: blocked — ${why}.` });

    const dir = cwd ? path.resolve(defaultCwd || os.homedir(), cwd) : (defaultCwd || os.homedir());
    if (!fs.existsSync(dir)) return resolve({ ok: false, text: `Error: directory not found: ${dir}` });
    const timeout = Math.min(Math.max(Number(timeout_seconds) || 60, 1), 300) * 1000;

    exec(cmd, {
      cwd: dir, timeout, maxBuffer: 10 * 1024 * 1024, signal,
      shell: process.env.SHELL || '/bin/sh', env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' }
    }, (err, stdout, stderr) => {
      let code = 0, note = '';
      if (err) {
        if (err.name === 'AbortError' || signal?.aborted) return resolve({ ok: false, text: 'Error: command cancelled.' });
        if (err.killed && err.signal) note = `\n(timed out after ${timeout / 1000}s and was killed)`;
        code = typeof err.code === 'number' ? err.code : 1;
      }
      const out = clip(stdout || '', 24000), er = clip(stderr || '', 8000);
      resolve({
        ok: code === 0 && !note,
        text: `cwd: ${dir}\nexit code: ${code}${note}\n--- stdout ---\n${out || '(empty)'}\n--- stderr ---\n${er || '(empty)'}`
      });
    });
  });
}

module.exports = { runCommand, BLOCKED };
