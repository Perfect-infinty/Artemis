#!/usr/bin/env python3
"""Runs a shell inside a real pseudo-terminal for Artemis' built-in terminal.

stdin/stdout = the terminal's bytes. File descriptor 3 = control lines ("resize COLS ROWS").
usage: pty-helper.py COLS ROWS CWD SHELL
"""
import fcntl, os, pty, select, signal, struct, sys, termios

cols, rows = int(sys.argv[1]), int(sys.argv[2])
cwd, shell = sys.argv[3], sys.argv[4]

def set_size(fd, c, r):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', max(r, 1), max(c, 1), 0, 0))

pid, master = pty.fork()
if pid == 0:
    try:
        os.chdir(cwd)
    except OSError:
        pass
    env = dict(os.environ, TERM='xterm-256color', COLORTERM='truecolor', TERM_PROGRAM='Artemis')
    args = [shell, '-l'] if os.path.basename(shell) in ('zsh', 'bash', 'fish', 'sh') else [shell]
    try:
        os.execvpe(shell, args, env)
    except OSError:
        os.execvpe('/bin/sh', ['/bin/sh'], env)

set_size(master, cols, rows)
ctl = os.fdopen(3, 'rb', buffering=0) if os.path.exists('/dev/fd/3') else None
out = sys.stdout.buffer
status = 0
buf = b''
try:
    while True:
        fds = [0, master] + ([3] if ctl else [])
        r, _, _ = select.select(fds, [], [])
        if master in r:
            try:
                data = os.read(master, 65536)
            except OSError:
                data = b''
            if not data:
                break
            out.write(data); out.flush()
        if 0 in r:
            data = os.read(0, 65536)
            if not data:
                os.kill(pid, signal.SIGHUP)
                break
            os.write(master, data)
        if ctl and 3 in r:
            chunk = ctl.read(4096)
            if not chunk:
                ctl = None
            else:
                buf += chunk
                while b'\n' in buf:
                    line, buf = buf.split(b'\n', 1)
                    p = line.decode('utf-8', 'ignore').split()
                    if len(p) == 3 and p[0] == 'resize':
                        try: set_size(master, int(p[1]), int(p[2]))
                        except Exception: pass
finally:
    try:
        _, st = os.waitpid(pid, 0)
        status = os.waitstatus_to_exitcode(st) if hasattr(os, 'waitstatus_to_exitcode') else (st >> 8)
    except Exception:
        pass
sys.exit(max(0, status))
