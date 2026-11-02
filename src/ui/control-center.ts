// Control Center, opened with the Home button (or Select + Start).
// Mirrors the PS5 layout: a card for the running game on top, a row of round
// controls along the bottom (sound, network, switch profile, power).

import { clamp, formatClock, h } from "../dom";
import type { Action } from "../input";
import type { Title } from "../types";
import { icons } from "./icons";

export interface SystemStatus {
  volume: number;
  muted: boolean;
  output: string;
  network: { connected: boolean; type: "wifi" | "ethernet" | "none"; name: string };
}

export type PowerChoice = "restart" | "shutdown" | "steam";

export interface ControlCenterOptions {
  /** The running game, if any (frozen while the Control Center is open). */
  game: Title | null;
  /** Restricted profiles (Kids) do not get "Steam Gaming Mode". */
  restricted: boolean;
  onClose(): void;
  onQuitGame(): void;
  onSwitchProfile(): void;
  onPower(choice: PowerChoice): void;
}

type Zone = "game" | "row" | "slider" | "power";
const ROW = ["sound", "network", "profile", "power"] as const;
const VOLUME_STEP = 5;

export function controlCenter(opts: ControlCenterOptions) {
  let zone: Zone = opts.game ? "game" : "row";
  let gameIndex = 0; // 0 resume, 1 quit
  let rowIndex = 0;
  let powerIndex = 0;
  let status: SystemStatus | null = null;

  // ----- game card
  const resumeBtn = h("div.cc-pill", {}, "Resume");
  const quitBtn = h("div.cc-pill", {}, "Quit Game");
  const gameCard = opts.game
    ? h(
        "div.cc-game",
        {},
        h("div.cc-game-art", { style: opts.game.art.hero ? `background-image:url("${opts.game.art.hero}")` : "" }),
        h(
          "div.cc-game-info",
          {},
          h("div.cc-kicker", {}, "Paused"),
          h("div.cc-game-name", {}, opts.game.name),
          h("div.cc-game-actions", {}, resumeBtn, quitBtn),
        ),
      )
    : null;

  // ----- bottom row
  const soundLabel = h("div.cc-label", {}, "Sound");
  const netLabel = h("div.cc-label", {}, "Network");
  const items = ROW.map((key) => {
    const icon = h("div.cc-icon");
    const label =
      key === "sound" ? soundLabel : key === "network" ? netLabel : h("div.cc-label", {}, key === "profile" ? "Switch Profile" : "Power");
    icon.innerHTML = key === "profile" ? icons.switchUser : key === "power" ? icons.power : icons.sound; // constant SVG
    return { key, el: h("div.cc-item", {}, icon, label), icon };
  });

  // ----- sound slider
  const fill = h("div.cc-slider-fill");
  const value = h("div.cc-slider-value");
  const slider = h(
    "div.cc-popup.cc-slider",
    {},
    h("div.cc-popup-title", {}, "Sound"),
    h("div.cc-slider-track", {}, fill),
    value,
    h("div.cc-hint", {}, "◀ ▶ to change · A or B when done"),
  );

  // ----- power menu
  const powerChoices: { label: string; choice: PowerChoice | "cancel" }[] = [
    { label: "Restart", choice: "restart" },
    { label: "Turn Off", choice: "shutdown" },
    ...(opts.restricted ? [] : [{ label: "Steam Gaming Mode", choice: "steam" as const }]),
    { label: "Cancel", choice: "cancel" },
  ];
  const powerRows = powerChoices.map((c) => h("div.menu-item", {}, c.label));
  const powerMenu = h("div.cc-popup.cc-power", {}, h("div.cc-popup-title", {}, "Power"), ...powerRows);

  const clock = h("div.cc-clock", {}, formatClock(new Date()));
  const el = h(
    "div.overlay.cc",
    {},
    h(
      "div.cc-panel",
      {},
      h("div.cc-top", {}, gameCard ?? h("div.cc-kicker", {}, "Control Center"), clock),
      h("div.cc-row", {}, ...items.map((i) => i.el)),
    ),
    slider,
    powerMenu,
  );

  function paintStatus() {
    if (!status) return;
    const soundIcon = items[0]!.icon;
    soundIcon.innerHTML = status.muted || status.volume === 0 ? icons.muted : icons.sound; // constant SVG
    soundLabel.textContent = status.muted ? "Muted" : `Sound ${status.volume}%`;
    fill.style.width = `${status.muted ? 0 : status.volume}%`;
    value.textContent = status.muted ? "Muted" : `${status.volume}%${status.output ? ` · ${status.output}` : ""}`;
    const net = status.network;
    items[1]!.icon.innerHTML = !net.connected ? icons.offline : net.type === "ethernet" ? icons.ethernet : icons.wifi; // constant SVG
    netLabel.textContent = net.connected ? net.name || "Connected" : "Not connected";
  }

  function paint() {
    resumeBtn.classList.toggle("focused", zone === "game" && gameIndex === 0);
    quitBtn.classList.toggle("focused", zone === "game" && gameIndex === 1);
    items.forEach((i, k) => i.el.classList.toggle("focused", (zone === "row" || zone === "slider" || zone === "power") && k === rowIndex));
    slider.classList.toggle("show", zone === "slider");
    powerMenu.classList.toggle("show", zone === "power");
    powerRows.forEach((r, k) => r.classList.toggle("focused", k === powerIndex));
  }

  async function refresh() {
    try {
      status = (await (await fetch("/api/system")).json()) as SystemStatus;
      paintStatus();
    } catch {
      // Status is optional.
    }
  }

  async function system(body: object) {
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      status = (await res.json()) as SystemStatus;
      paintStatus();
    } catch {
      // Ignore; the next refresh shows the real state.
    }
  }

  void refresh();
  const timer = setInterval(() => {
    clock.textContent = formatClock(new Date());
    void refresh();
  }, 5000);
  paint();

  function close() {
    clearInterval(timer);
    opts.onClose();
  }

  return {
    el,
    destroy() {
      clearInterval(timer);
    },
    handle(action: Action) {
      switch (zone) {
        case "game":
          if (action === "left" || action === "right") gameIndex = action === "left" ? 0 : 1;
          else if (action === "down") zone = "row";
          else if (action === "accept") return gameIndex === 0 ? close() : opts.onQuitGame();
          else if (action === "back" || action === "home") return close();
          break;
        case "row":
          if (action === "left") rowIndex = clamp(rowIndex - 1, 0, ROW.length - 1);
          else if (action === "right") rowIndex = clamp(rowIndex + 1, 0, ROW.length - 1);
          else if (action === "up" && opts.game) zone = "game";
          else if (action === "back" || action === "home") return close();
          else if (action === "accept") {
            const key = ROW[rowIndex];
            if (key === "sound") zone = "slider";
            else if (key === "profile") return opts.onSwitchProfile();
            else if (key === "power") {
              zone = "power";
              powerIndex = 0;
            } else void refresh();
          } else if (action === "options" && ROW[rowIndex] === "sound") void system({ action: "mute" });
          break;
        case "slider":
          if (action === "left" || action === "down") void system({ action: "volume", delta: -VOLUME_STEP });
          else if (action === "right" || action === "up") void system({ action: "volume", delta: VOLUME_STEP });
          else if (action === "accept" || action === "back") zone = "row";
          else if (action === "home") return close();
          break;
        case "power":
          if (action === "up") powerIndex = clamp(powerIndex - 1, 0, powerChoices.length - 1);
          else if (action === "down") powerIndex = clamp(powerIndex + 1, 0, powerChoices.length - 1);
          else if (action === "back") zone = "row";
          else if (action === "home") return close();
          else if (action === "accept") {
            const { choice } = powerChoices[powerIndex]!;
            if (choice === "cancel") zone = "row";
            else return opts.onPower(choice);
          }
          break;
      }
      paint();
    },
  };
}
