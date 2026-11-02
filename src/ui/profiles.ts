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
  const dust = particles();

  const el = h(
    "section.screen.profiles",
    {},
    dust.el,
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
      dust.stop();
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

// ---------------------------------------------------------------- particles

interface Mote {
  x: number;
  y: number;
  /** Size in px. */
  r: number;
  /** Drift in px per second. */
  vx: number;
  vy: number;
  alpha: number;
  /** Twinkle speed and phase. */
  tw: number;
  phase: number;
  sprite: HTMLCanvasElement;
}

const W = 1920;
const H = 1080;
/** The light ribbons run through this band, so more dust gathers there. */
const BAND_TOP = 480;
const BAND_BOTTOM = 880;

/** Soft round light, drawn once and reused for every particle. */
function glowSprite(core: string, edge: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, core);
  grad.addColorStop(0.25, edge);
  grad.addColorStop(1, "rgba(0, 0, 0, 0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

/**
 * Floating light dust in three depths: many tiny far specks, brighter
 * glowing motes, and a few large out-of-focus bokeh circles. Nearer layers
 * drift faster, which gives the background depth.
 */
function particles(): { el: HTMLElement; stop(): void } {
  const canvas = document.createElement("canvas");
  canvas.className = "particles";
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const white = glowSprite("rgba(255, 255, 255, 1)", "rgba(190, 210, 255, 0.55)");
  const blue = glowSprite("rgba(170, 200, 255, 1)", "rgba(80, 120, 255, 0.45)");
  const bokeh = glowSprite("rgba(120, 160, 255, 0.5)", "rgba(70, 110, 255, 0.28)");

  const rand = (a: number, b: number) => a + Math.random() * (b - a);
  const inBand = () => rand(BAND_TOP, BAND_BOTTOM);
  const motes: Mote[] = [];
  const add = (count: number, make: () => Omit<Mote, "x" | "y" | "phase"> & { band?: boolean }) => {
    for (let i = 0; i < count; i++) {
      const m = make();
      motes.push({ ...m, x: rand(0, W), y: m.band ? inBand() : rand(0, H), phase: rand(0, Math.PI * 2) });
    }
  };
  // Far specks, everywhere.
  add(220, () => ({ r: rand(2.5, 6), vx: rand(2, 8), vy: rand(-6, -1), alpha: rand(0.4, 0.95), tw: rand(0.6, 1.8), sprite: white }));
  // Far specks gathered along the ribbons.
  add(160, () => ({ r: rand(3, 8), vx: rand(6, 16), vy: rand(-4, 2), alpha: rand(0.5, 1), tw: rand(0.8, 2.2), sprite: blue, band: true }));
  // Mid glowing motes.
  add(70, () => ({ r: rand(10, 24), vx: rand(8, 20), vy: rand(-10, -3), alpha: rand(0.45, 0.9), tw: rand(0.4, 1.2), sprite: blue }));
  // Near, out of focus.
  add(18, () => ({ r: rand(60, 160), vx: rand(10, 24), vy: rand(-8, -2), alpha: rand(0.1, 0.24), tw: rand(0.15, 0.4), sprite: bokeh }));

  let raf = 0;
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    for (const m of motes) {
      m.x += m.vx * dt;
      m.y += m.vy * dt + Math.sin(t * 0.5 + m.phase) * 4 * dt;
      // Wrap around the edges, with room for the particle's size.
      if (m.x - m.r > W) m.x = -m.r;
      if (m.y + m.r < 0) m.y = H + m.r;
      else if (m.y - m.r > H) m.y = -m.r;
      ctx.globalAlpha = m.alpha * (0.55 + 0.45 * Math.sin(t * m.tw + m.phase));
      ctx.drawImage(m.sprite, m.x - m.r, m.y - m.r, m.r * 2, m.r * 2);
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    el: canvas,
    stop: () => cancelAnimationFrame(raf),
  };
}
