import { clamp, formatClock, h } from "../dom";
import type { Action } from "../input";
import type { Profile } from "../types";
import { pinPad } from "./pin";
import { avatar, overlayHost, toast, type Screen } from "./screen";

/** "Who's playing?" screen shown at power-on and when switching profiles. */
export function profileScreen(
  profiles: Profile[],
  initialId: string | undefined,
  onPick: (profile: Profile) => void,
): Screen {
  // Focusable items: each profile, then the "Add User" button.
  let index = Math.max(0, profiles.findIndex((p) => p.id === initialId));

  const cards = profiles.map((p) =>
    h("div.profile-card", {}, avatar(p, "profile-avatar"), h("div.profile-name", {}, p.name)),
  );
  const add = h("div.profile-add", {}, h("div.profile-add-btn", {}, "+"), h("div.profile-add-label", {}, "Add User"));
  const clock = h("div.profile-clock", {}, formatClock(new Date()));
  const timer = setInterval(() => (clock.textContent = formatClock(new Date())), 10_000);

  const el = h(
    "section.screen.profiles",
    {},
    waves(),
    clock,
    h("h1.profiles-title", {}, "Who's playing?"),
    h("div.profiles-row", {}, ...cards),
    add,
  );
  const overlays = overlayHost(el);

  const render = () => {
    cards.forEach((c, i) => c.classList.toggle("focused", i === index));
    add.classList.toggle("focused", index === profiles.length);
  };
  render();

  const pick = (profile: Profile) => {
    if (!profile.pin) return onPick(profile);
    const pad = pinPad({
      title: profile.name,
      subtitle: "Enter passcode",
      onCancel: () => overlays.close(),
      onDone: (pin) => {
        if (pin === profile.pin) {
          overlays.close();
          onPick(profile);
        } else pad.reset("Wrong passcode. Try again.");
      },
    });
    overlays.open(pad);
  };

  return {
    el,
    handle(action: Action) {
      if (overlays.active) return overlays.active.handle(action);
      const onAdd = index === profiles.length;
      if (action === "left" && !onAdd) index = clamp(index - 1, 0, profiles.length - 1);
      else if (action === "right" && !onAdd) index = clamp(index + 1, 0, profiles.length - 1);
      else if (action === "down") index = profiles.length;
      else if (action === "up" && onAdd) index = 0;
      else if (action === "accept") {
        if (onAdd) toast("Adding users comes in a later version");
        else pick(profiles[index]!);
        return;
      }
      render();
    },
    destroy() {
      clearInterval(timer);
    },
  };
}

/** Slow flowing light ribbons, drawn with SVG so they stay sharp on a TV. */
function waves(): HTMLElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "waves");
  svg.setAttribute("viewBox", "0 0 1920 1080");
  svg.setAttribute("preserveAspectRatio", "none");
  const paths = [
    "M-100 620 C 300 420, 700 900, 1100 640 S 1800 380, 2050 520",
    "M-100 700 C 380 520, 760 980, 1180 700 S 1820 460, 2050 610",
    "M-100 780 C 420 640, 820 1040, 1240 780 S 1840 560, 2050 700",
  ];
  paths.forEach((d, i) => {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    p.setAttribute("class", `wave wave-${i}`);
    svg.append(p);
  });
  const wrap = h("div.waves-wrap");
  wrap.append(svg);
  return wrap;
}
