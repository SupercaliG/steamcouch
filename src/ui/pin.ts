import { h } from "../dom";
import type { Action } from "../input";
import type { Overlay } from "./screen";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "cancel", "0", "del"] as const;
const COLS = 3;
const LENGTH = 4;

/**
 * Controller-friendly 4-digit keypad. Calls onDone with the code once 4 digits
 * are in, or onCancel. B deletes a digit, or cancels when empty.
 */
export function pinPad(opts: {
  title: string;
  subtitle?: string;
  onDone(pin: string): void;
  onCancel(): void;
}): Overlay & { reset(message?: string): void } {
  let index = 0;
  let entered = "";

  const dots = Array.from({ length: LENGTH }, () => h("span.pin-dot"));
  const subtitle = h("div.pin-subtitle", {}, opts.subtitle ?? "");
  const keys = KEYS.map((k) =>
    h(`div.pin-key${k === "cancel" || k === "del" ? ".pin-key-text" : ""}`, {}, k === "cancel" ? "Cancel" : k === "del" ? "⌫" : k),
  );

  const el = h(
    "div.overlay.pin-overlay",
    {},
    h(
      "div.pin-box",
      {},
      h("div.pin-title", {}, opts.title),
      subtitle,
      h("div.pin-dots", {}, ...dots),
      h("div.pin-grid", {}, ...keys),
    ),
  );

  const paint = () => {
    dots.forEach((d, i) => d.classList.toggle("filled", i < entered.length));
    keys.forEach((k, i) => k.classList.toggle("focused", i === index));
  };
  paint();

  const press = (key: (typeof KEYS)[number]) => {
    if (key === "cancel") return opts.onCancel();
    if (key === "del") entered = entered.slice(0, -1);
    else if (entered.length < LENGTH) entered += key;
    paint();
    if (entered.length === LENGTH) {
      const pin = entered;
      setTimeout(() => opts.onDone(pin), 120);
    }
  };

  return {
    el,
    handle(action: Action) {
      const row = Math.floor(index / COLS);
      const col = index % COLS;
      if (action === "left" && col > 0) index--;
      else if (action === "right" && col < COLS - 1) index++;
      else if (action === "up" && row > 0) index -= COLS;
      else if (action === "down" && row < KEYS.length / COLS - 1) index += COLS;
      else if (action === "accept") return press(KEYS[index]!);
      else if (action === "back") {
        if (entered) entered = entered.slice(0, -1);
        else return opts.onCancel();
      }
      paint();
    },
    reset(message?: string) {
      entered = "";
      if (message !== undefined) subtitle.textContent = message;
      el.querySelector(".pin-box")?.classList.remove("shake");
      void (el.querySelector(".pin-box") as HTMLElement | null)?.offsetWidth;
      if (message) el.querySelector(".pin-box")?.classList.add("shake");
      paint();
    },
  };
}
