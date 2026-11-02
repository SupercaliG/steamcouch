#!/usr/bin/env python3
"""Hold every gamepad while the Home menu is open.

Grabs (EVIOCGRAB) all gamepad event devices so a paused game does not queue
the presses made in the dashboard's menu, and prints those presses as menu
actions on stdout, one per line:

    up down left right accept back home

When stdin receives "release", it waits until no button is held (so the press
that picked "Resume" is not seen by the game), ungrabs, prints "released" and
exits. Uses only the standard library.
"""

import fcntl
import os
import select
import struct
import sys
import time

EVIOCGRAB = 0x40044590
EVENT = struct.Struct("llHHi")  # struct input_event on 64-bit Linux
EV_KEY, EV_ABS = 0x01, 0x03

KEYS = {
    304: "accept",  # BTN_SOUTH / A
    305: "back",  # BTN_EAST / B
    316: "home",  # BTN_MODE / Guide
    544: "up",  # BTN_DPAD_UP
    545: "down",
    546: "left",
    547: "right",
}
ABS_X, ABS_Y, ABS_HAT0X, ABS_HAT0Y = 0x00, 0x01, 0x10, 0x11
STICK_THRESHOLD = 20000  # of 32767


def is_gamepad(event_name: str) -> bool:
    """A device with BTN_SOUTH (304) in its key capabilities."""
    try:
        with open(f"/sys/class/input/{event_name}/device/capabilities/key") as f:
            words = f.read().split()
    except OSError:
        return False
    # Capability bitmap: hex words, most significant first, 64 bits each.
    bits = int("".join(w.rjust(16, "0") for w in words), 16)
    return bool(bits >> 304 & 1)


def emit(line: str) -> None:
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def main() -> None:
    fds = {}
    for name in sorted(os.listdir("/dev/input")):
        if not name.startswith("event") or not is_gamepad(name):
            continue
        try:
            fd = os.open(f"/dev/input/{name}", os.O_RDONLY | os.O_NONBLOCK)
        except OSError:
            continue
        try:
            fcntl.ioctl(fd, EVIOCGRAB, 1)
        except OSError:
            # Someone else holds it (InputPlumber holds the physical pad);
            # we still read it to know when buttons are released.
            pass
        fds[fd] = name
    emit("grabbed " + " ".join(fds.values()))

    # Keyed by code, not device: the same press can arrive on more than one
    # virtual pad (InputPlumber and Steam each make one).
    held = set()  # keys and axes currently pressed
    axis_dir = {}  # axis -> current direction or None
    releasing = False
    deadline = 0.0

    while True:
        timeout = 0.05 if releasing else None
        ready, _, _ = select.select(list(fds) + [sys.stdin], [], [], timeout)
        for fd in ready:
            if fd is sys.stdin:
                if sys.stdin.readline().strip() == "release":
                    releasing = True
                    deadline = time.monotonic() + 1.5
                continue
            try:
                data = os.read(fd, EVENT.size * 64)
            except OSError:
                continue
            for off in range(0, len(data) - EVENT.size + 1, EVENT.size):
                _, _, etype, code, value = EVENT.unpack_from(data, off)
                if etype == EV_KEY and code in KEYS:
                    key = ("key", code)
                    if value:
                        if key not in held and not releasing:
                            emit(KEYS[code])
                        held.add(key)
                    else:
                        held.discard(key)
                elif etype == EV_ABS and code in (ABS_HAT0X, ABS_HAT0Y, ABS_X, ABS_Y):
                    if code in (ABS_HAT0X, ABS_HAT0Y):
                        direction = None if value == 0 else value > 0
                    else:
                        direction = None if abs(value) < STICK_THRESHOLD else value > 0
                    key = ("abs", code)
                    if direction is None:
                        held.discard(key)
                    elif axis_dir.get(key) != direction:
                        held.add(key)
                        if not releasing:
                            vertical = code in (ABS_HAT0Y, ABS_Y)
                            emit(("down" if direction else "up") if vertical else ("right" if direction else "left"))
                    axis_dir[key] = direction
        if releasing and (not held or time.monotonic() > deadline):
            for fd in fds:
                try:
                    fcntl.ioctl(fd, EVIOCGRAB, 0)
                except OSError:
                    pass
                os.close(fd)
            emit("released")
            return


if __name__ == "__main__":
    main()
