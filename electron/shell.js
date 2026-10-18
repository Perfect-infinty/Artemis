// run_command: runs a shell command on the user's machine. Not a sandbox: the blocklist only catches common destructive
// mistakes; the user's approval is the real guard.
const { exec } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const INTERP = '(?:sh|bash|zsh|dash|ksh|fish|python[0-9.]*|perl|ruby|node|php|osascript)';
const BLOCKED = [
  [/\b(sudo|doas)\b/, 'sudo is not allowed'],
  [/\bmkfs(\.|\b)/, 'formatting disks is not allowed'],
  [/\bdd\s+[^|;&]*\bof=\/dev\//, 'writing to devices is not allowed'],
  [/:\(\)\s*\{/, 'fork bombs are not allowed'],
  [/\b(shutdown|reboot|halt)\b/, 'shutdown/reboot is not allowed'],
  [new RegExp('\\b(curl|wget)\\b[^;&]*\\|\\s*(env\\s+)?' + INTERP + '\\b'), 'piping downloads into a shell or interpreter is not allowed'],
  [new RegExp('\\b(' + INTERP.slice(3, -1) + '|source|\\.)\\s+(-\\S+\\s+)*<\\(\\s*(curl|wget)\\b'), 'running a download through process substitution is not allowed'],
  [/(\beval|\s-c)\s+\$\(\s*(curl|wget)\b/, 'running a download is not allowed']
];

// Protected targets for recursive delete / find -delete: /, ~, and top-level system folders.
const PROTECTED = /^(\/|~\/?|\/\*|~\/\*|\/\.|~\/\.)$|^\/(Users|home|System|Applications|Library|bin|sbin|usr|etc|var|private|opt|Volumes)\/?\*?$|^~\/(Documents|Desktop|Downloads|Library|Pictures|Movies|Music)\/?\*?$/;

/** Flattens quoting and spellings of home so the checks see one form: "$HOME" / ${HOME} / /Users/me -> ~, --recursive -> -r. */
function normalize(cmd) {
  const home = os.homedir();
  let s = String(cmd).replace(/\\\n/g, ' ').replace(/["'`\\]/g, '');
  s = s.replace(/\$\{HOME\}|\$HOME\b/g, '~');
  if (home && home.length > 1) s = s.split(home).join('~');
  s = s.replace(/(^|[\s=])\/(Users|home)\/[^\s/;&|]+(?=\/|\s|$|[;&|])/g, '$1~');
  s = s.replace(/--recursive\b/g, '-r').replace(/--force\b/g, '-f').replace(/--dir\b/g, '-d').replace(/--no-preserve-root\b/g, '-f');
  s = s.replace(/~\/+/g, '~/').replace(/\/{2,}/g, '/');
  return s;
}

/** Why a command is blocked, or '' if it is not. */
function blockedReason(command) {
  const s = normalize(command);
  for (const [re, why] of BLOCKED) if (re.test(s) || re.test(String(command))) return why;
  for (const seg of s.split(/;|&&|\|\||\||&|\n|\$\(|`/)) {
    let t = seg.trim().split(/\s+/).filter(Boolean);
    while (t.length && /^(\w+=\S*|command|builtin|exec|nohup|time|xargs|env|nice)$/.test(t[0])) t = t.slice(1);
    if (!t.length) continue;
    const cmd = t[0].replace(/^.*\//, '');
    const flags = t.slice(1).filter((x) => /^-[^-]/.test(x)).join('');
    const targets = t.slice(1).filter((x) => !x.startsWith('-'));
    if (cmd === 'rm' && /[rR]/.test(flags) && targets.some((x) => PROTECTED.test(x))) return 'recursive delete of / or ~ is not allowed';
    if (cmd === 'find' && (t.includes('-delete') || /-exec(dir)?\s+rm\b/.test(t.join(' '))) && targets.some((x) => PROTECTED.test(x))) return 'deleting with find in / or ~ is not allowed';
  }
  return '';
}

const clip = (s, n) => (s.length > n ? s.slice(0, n) + `\n…[truncated, ${s.length} characters total]` : s);

function runCommand({ command, cwd, timeout_seconds }, { signal, defaultCwd } = {}) {
  return new Promise((resolve) => {
    const cmd = String(command || '').trim();
    if (!cmd) return resolve({ ok: false, text: 'Error: command is empty' });
    const why = blockedReason(cmd);
    if (why) return resolve({ ok: false, text: `Error: blocked — ${why}.` });

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

module.exports = { runCommand, BLOCKED, blockedReason, normalize };
