"""Runs a command in a pseudo-terminal for the browser terminal of aws sessions.

Usage: python3 -I pty-bridge.py COLS ROWS COMMAND...

stdin and stdout carry the terminal bytes. File descriptor 3 takes "COLS ROWS" lines to resize.
Node has no built-in pty and the lab avoids native modules, so this stands in for node-pty.
"""
import errno
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

CONTROL_FD = 3


def set_size(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def write_all(fd, data):
    while data:
        data = data[os.write(fd, data):]


def main():
    cols, rows, command = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3:]
    pid, master = pty.fork()
    if pid == 0:
        os.execvp(command[0], command)
    set_size(master, cols, rows)

    watched = [0, master, CONTROL_FD]
    control = b""
    try:
        while True:
            ready, _, _ = select.select(watched, [], [])
            if master in ready:
                try:
                    data = os.read(master, 65536)
                except OSError as e:
                    if e.errno == errno.EIO:  # the shell exited
                        break
                    raise
                if not data:
                    break
                write_all(1, data)
            if 0 in ready:
                data = os.read(0, 65536)
                if not data:  # the browser went away
                    break
                write_all(master, data)
            if CONTROL_FD in ready:
                data = os.read(CONTROL_FD, 1024)
                if not data:
                    watched.remove(CONTROL_FD)
                    continue
                control += data
                while b"\n" in control:
                    line, control = control.split(b"\n", 1)
                    try:
                        c, r = (int(x) for x in line.split())
                        # The kernel sends SIGWINCH to the foreground job when the size changes.
                        set_size(master, c, r)
                    except (ValueError, OSError):
                        pass
    finally:
        try:
            os.killpg(os.getpgid(pid), signal.SIGHUP)
        except OSError:
            pass
        try:
            os.waitpid(pid, 0)
        except OSError:
            pass


if __name__ == "__main__":
    main()
