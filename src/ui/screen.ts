import { h, img } from "../dom";
import type { Action } from "../input";
import { sfx } from "../sound";
import type { Profile } from "../types";

export interface Screen {
  el: HTMLElement;
  handle(action: Action): void;
  destroy?(): void;
}

/** A layer on top of a screen that takes input until it closes. */
export interface Overlay {
  el: HTMLElement;
  handle(action: Action): void;
}

/** Short message at the bottom of the screen, like a console notification. */
export function toast(message: string, opts: { silent?: boolean } = {}): void {
  const stage = document.getElementById("canvas");
  if (!stage) return;
  if (!opts.silent) sfx.notify();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  stage.append(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 400);
  }, 2200);
}

/** Round avatar: the profile picture, or its first letter on the profile color. */
export function avatar(profile: Profile, cls = "avatar"): HTMLElement {
  const el = h(`div.${cls}`, { style: `background:${profile.color}` });
  const letter = () => el.replaceChildren(h("span.avatar-letter", {}, profile.name.slice(0, 1).toUpperCase()));
  if (profile.avatar) el.append(img(profile.avatar, "avatar-img", letter));
  else letter();
  return el;
}

/** Stack of overlays owned by a screen. */
export function overlayHost(parent: HTMLElement) {
  const stack: Overlay[] = [];
  return {
    get active(): Overlay | undefined {
      return stack[stack.length - 1];
    },
    open(o: Overlay) {
      stack.push(o);
      parent.append(o.el);
      requestAnimationFrame(() => o.el.classList.add("show"));
    },
    close() {
      const o = stack.pop();
      if (!o) return;
      o.el.classList.remove("show");
      setTimeout(() => o.el.remove(), 250);
    },
  };
}
export type OverlayHost = ReturnType<typeof overlayHost>;
