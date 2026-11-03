// On-screen keyboard for the controller: d-pad moves, A types the key.
// Every row is 10 units wide, so Up/Down keep the same column.

import { clamp, h } from "../dom";
import type { Action } from "../input";

type Special = "space" | "delete" | "clear";
interface Key {
  label: string;
  /** Text typed, or a special key. */
  value: string | Special;
  /** Width in columns. */
  span: number;
}

const COLS = 10;
const letters = (s: string): Key[] => [...s].map((c) => ({ label: c, value: c, span: 1 }));
const LAYOUT: Key[][] = [
  letters("1234567890"),
  letters("qwertyuiop"),
  letters("asdfghjkl'"),
  letters("zxcvbnm-:&"),
  [
    { label: "Space", value: "space", span: 6 },
    { label: "Delete", value: "delete", span: 2 },
    { label: "Clear", value: "clear", span: 2 },
  ],
];

export interface Keyboard {
  el: HTMLElement;
  text(): string;
  /** Show or hide the focus ring (when focus moves out to the results). */
  setActive(on: boolean): void;
  deleteLast(): void;
  clear(): void;
  /**
   * Handle a d-pad or A press. Returns the side the focus tried to leave by
   * when there is no key that way, so the screen can move focus out.
   */
  handle(action: Action): "left" | "right" | "up" | "down" | undefined;
}

export function keyboard(opts: { maxLength: number; onChange(text: string): void }): Keyboard {
  let text = "";
  let row = 1;
  let col = 0; // column (0..9) the focus is on; wide keys cover several
  let active = true;

  const keyEls = LAYOUT.map((keys) =>
    keys.map((k) => h(`div.kb-key${k.span > 1 ? ".wide" : ""}`, { style: `grid-column: span ${k.span}` }, k.label)),
  );
  const el = h("div.kb", {}, ...keyEls.map((els) => h("div.kb-row", {}, ...els)));

  /** Index of the key in `r` that covers column `c`. */
  const keyAt = (r: number, c: number) => {
    let start = 0;
    return LAYOUT[r]!.findIndex((k) => {
      const hit = c >= start && c < start + k.span;
      start += k.span;
      return hit;
    });
  };
  const keyStart = (r: number, i: number) => LAYOUT[r]!.slice(0, i).reduce((n, k) => n + k.span, 0);

  const paint = () => {
    const at = keyAt(row, col);
    keyEls.forEach((els, r) => els.forEach((k, i) => k.classList.toggle("focused", active && r === row && i === at)));
  };

  const set = (next: string) => {
    if (next === text) return;
    text = next;
    opts.onChange(text);
  };

  const type = (key: Key) => {
    if (key.value === "delete") return set(text.slice(0, -1));
    if (key.value === "clear") return set("");
    const add = key.value === "space" ? " " : key.value;
    if (add === " " && (text === "" || text.endsWith(" "))) return;
    if (text.length < opts.maxLength) set(text + add);
  };

  paint();
  return {
    el,
    text: () => text,
    setActive(on) {
      active = on;
      paint();
    },
    deleteLast: () => set(text.slice(0, -1)),
    clear: () => set(""),
    handle(action) {
      const i = keyAt(row, col);
      const key = LAYOUT[row]![i]!;
      if (action === "accept") {
        type(key);
        return;
      }
      if (action === "left") {
        if (i === 0) return "left";
        col = keyStart(row, i - 1);
      } else if (action === "right") {
        if (i === LAYOUT[row]!.length - 1) return "right";
        col = keyStart(row, i + 1);
      } else if (action === "up") {
        if (row === 0) return "up";
        row -= 1;
      } else if (action === "down") {
        if (row === LAYOUT.length - 1) return "down";
        row += 1;
      }
      col = clamp(col, 0, COLS - 1);
      paint();
      return undefined;
    },
  };
}
