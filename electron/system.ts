// System status and controls for the Control Center: sound (PipeWire via
// wpctl) and network (NetworkManager via nmcli). Both ship with Bazzite.

import { execFile } from "node:child_process";

export interface SystemStatus {
  volume: number; // 0..100
  muted: boolean;
  output: string; // sound device name, e.g. the TV
  network: { connected: boolean; type: "wifi" | "ethernet" | "none"; name: string };
}

const SINK = "@DEFAULT_AUDIO_SINK@";

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 3000 }, (err, stdout) => resolve(err ? "" : stdout));
  });
}

export async function systemStatus(): Promise<SystemStatus> {
  const [vol, inspect, devices] = await Promise.all([
    run("wpctl", ["get-volume", SINK]),
    run("wpctl", ["inspect", SINK]),
    run("nmcli", ["-t", "-f", "TYPE,STATE,CONNECTION", "device"]),
  ]);
  const level = Number(/Volume:\s*([\d.]+)/.exec(vol)?.[1] ?? 0);
  const output =
    /node\.nick = "([^"]+)"/.exec(inspect)?.[1] ?? /node\.description = "([^"]+)"/.exec(inspect)?.[1] ?? "";

  let network: SystemStatus["network"] = { connected: false, type: "none", name: "" };
  for (const line of devices.split("\n")) {
    const [type, state, ...name] = line.split(":");
    if ((type === "wifi" || type === "ethernet") && state === "connected") {
      network = { connected: true, type, name: name.join(":") };
      if (type === "ethernet") break; // prefer wired
    }
  }
  return { volume: Math.round(level * 100), muted: /\[MUTED\]/.test(vol), output, network };
}

/** Change volume by `delta` percent (clamped to 0..100) and unmute. */
export async function changeVolume(delta: number): Promise<void> {
  const step = `${Math.abs(delta)}%${delta >= 0 ? "+" : "-"}`;
  await run("wpctl", ["set-mute", SINK, "0"]);
  await run("wpctl", ["set-volume", "-l", "1.0", SINK, step]);
}

export async function toggleMute(): Promise<void> {
  await run("wpctl", ["set-mute", SINK, "toggle"]);
}
