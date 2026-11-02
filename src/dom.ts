type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | null | undefined | false;

/** Tiny element builder: h("div.card.big", { id: "x" }, child, ...). */
export function h(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const [name = "div", ...classes] = tag.split(".");
  const el = document.createElement(name);
  if (classes.length) el.className = classes.join(" ");
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === "style") el.setAttribute("style", String(value));
    else if (key.startsWith("data-")) el.setAttribute(key, String(value));
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

/** Image that removes itself (or calls onFail) when the URL does not load. */
export function img(src: string, cls: string, onFail?: () => void): HTMLImageElement {
  const el = document.createElement("img");
  el.className = cls;
  el.decoding = "async";
  el.draggable = false;
  el.addEventListener("error", () => {
    if (onFail) onFail();
    else el.remove();
  });
  el.src = src;
  return el;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function formatClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatPlaytime(minutes = 0): string {
  if (minutes <= 0) return "None";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

export function formatLastPlayed(unixSeconds?: number): string {
  if (!unixSeconds) return "Not played yet";
  const days = Math.floor((Date.now() / 1000 - unixSeconds) / 86400);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}
