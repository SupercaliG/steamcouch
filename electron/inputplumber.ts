// Controller routing through InputPlumber (Bazzite's input manager).
//
// InputPlumber owns the physical controller and feeds games through virtual
// pads. Its "intercept mode" decides what it keeps for itself:
//   1 = Pass:   everything goes to the game, except Home (ui_guide), which is
//               sent to us over D-Bus. Pressing Home also switches to mode 2.
//   2 = All:    nothing reaches the game; every press comes to us on D-Bus.
// We stay in 1 while the dashboard or a game is in front, and use 2 while the
// Control Center is open so menu presses never reach the game.
//
// Uses busctl and gdbus, which ship with Bazzite. Does nothing elsewhere.

import { execFile, spawn, type ChildProcess } from "node:child_process";

const SERVICE = "org.shadowblip.InputPlumber";
const IFACE = "org.shadowblip.Input.CompositeDevice";
const DBUS_TARGET = "/org/shadowblip/InputPlumber/devices/target/dbus0";

export const MODE_PASS = 1;
export const MODE_ALL = 2;

/** InputPlumber D-Bus event names -> dashboard actions. */
const EVENTS: Record<string, string> = {
  ui_guide: "home",
  ui_up: "up",
  ui_down: "down",
  ui_left: "left",
  ui_right: "right",
  ui_accept: "accept",
  ui_back: "back",
  ui_action: "options", // Y
  ui_quick: "home", // "..." / QAM button on handhelds
  ui_l1: "tabPrev",
  ui_r1: "tabNext",
};

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 3000 }, (err, stdout) => resolve(err ? "" : stdout));
  });
}

async function compositeDevices(): Promise<string[]> {
  const tree = await run("busctl", ["--system", "--list", "tree", SERVICE]);
  return [...new Set(tree.match(/\/org\/shadowblip\/InputPlumber\/CompositeDevice\d+(?=\s|$)/gm) ?? [])];
}

/** How often to look for controllers that InputPlumber picked up or dropped. */
const POLL_MS = 2000;

export function createInputPlumber(log: (msg: string) => void) {
  let monitor: ChildProcess | null = null;
  let poller: NodeJS.Timeout | null = null;
  const held = new Set<string>();
  // Controllers InputPlumber manages now, and the mode they should be in.
  // A controller that is off when the dashboard starts shows up later.
  let known = new Set<string>();
  let mode = MODE_PASS;

  const apply = (dev: string, m: number) =>
    run("busctl", ["--system", "set-property", SERVICE, dev, IFACE, "InterceptMode", "u", String(m)]);

  async function setMode(m: number) {
    mode = m;
    known = new Set(await compositeDevices());
    for (const dev of known) await apply(dev, m);
    log(`inputplumber: intercept mode ${m}`);
  }

  async function poll(onAction: (action: string) => void) {
    const now = new Set(await compositeDevices());
    for (const dev of now) {
      if (known.has(dev)) continue;
      await apply(dev, mode);
      log(`inputplumber: controller ${dev.split("/").pop()} found, intercept mode ${mode}`);
    }
    if (known.size > 0 && now.size === 0) log("inputplumber: no controller");
    known = now;
    if (known.size > 0) startMonitor(onAction);
  }

  function startMonitor(onAction: (action: string) => void) {
    if (monitor) return;
    monitor = spawn("gdbus", ["monitor", "--system", "--dest", SERVICE, "--object-path", DBUS_TARGET], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let buffer = "";
    monitor.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        // .../dbus0: org.shadowblip.Input.DBusDevice.InputEvent ('ui_guide', 1.0)
        const m = /InputEvent \('([^']+)', ([-\d.]+)\)/.exec(line);
        if (!m) continue;
        const [, event, value] = m;
        const pressed = Number(value) > 0.5;
        if (pressed) held.add(event!);
        else held.delete(event!);
        if (event === "ui_guide") log(`inputplumber: Home ${pressed ? "pressed" : "released"}`);
        const action = EVENTS[event!];
        if (action && pressed) onAction(action);
      }
    });
    monitor.on("exit", () => {
      monitor = null;
      log("inputplumber: monitor stopped");
    });
  }

  return {
    setMode,

    /** True when InputPlumber manages at least one controller. */
    active() {
      return known.size > 0;
    },

    /**
     * Track controllers and listen for D-Bus input events; `onAction` gets
     * dashboard actions on press. Safe to call when InputPlumber is absent.
     */
    async start(onAction: (action: string) => void) {
      if (poller) return;
      await poll(onAction);
      poller = setInterval(() => void poll(onAction), POLL_MS);
    },

    /** Wait (up to 1.5 s) until no button is held, so a release is not sent to the game. */
    async waitForRelease() {
      const until = Date.now() + 1500;
      while (held.size > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 30));
      held.clear();
    },

    stop() {
      if (poller) clearInterval(poller);
      poller = null;
      monitor?.kill();
      monitor = null;
    },
  };
}
