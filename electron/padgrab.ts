// Runs padgrab.py while the Home menu is open: it holds every gamepad so a
// paused game does not queue the menu presses, and reports those presses.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const ACTIONS = new Set(["up", "down", "left", "right", "accept", "back", "home"]);
const RELEASE_TIMEOUT_MS = 2500;

export interface PadGrab {
  /** Wait until no button is held, then give the gamepads back. */
  release(): Promise<void>;
}

export function startPadGrab(script: string, onAction: (action: string) => void): PadGrab {
  const child = spawn("python3", [script], { stdio: ["pipe", "pipe", "inherit"] });
  let done: (() => void) | null = null;
  const finished = new Promise<void>((resolve) => (done = resolve));
  child.on("exit", () => done?.());
  child.on("error", () => done?.()); // python3 missing: the menu still works, only less safely

  createInterface({ input: child.stdout }).on("line", (line) => {
    if (ACTIONS.has(line)) onAction(line);
  });

  return {
    async release() {
      if (child.exitCode === null && !child.killed) child.stdin.write("release\n");
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, RELEASE_TIMEOUT_MS));
      await Promise.race([finished, timeout]);
      if (child.exitCode === null) child.kill("SIGKILL"); // closing the fds also ungrabs
    },
  };
}
