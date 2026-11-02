// One-line game descriptions from the Steam store, cached on disk.
// Steam rate-limits the store API, so missing entries are fetched slowly in
// the background and show up on the next library load.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const DELAY_MS = 1500;

export function taglineCache(file: string) {
  let cache: Record<string, string> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  let running = false;

  const save = () => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(cache, null, 1));
  };

  return {
    get all(): Record<string, string> {
      return cache;
    },
    /** Fetch descriptions for app ids not in the cache yet. */
    fill(appIds: number[]) {
      const missing = appIds.filter((id) => !(String(id) in cache));
      if (running || missing.length === 0) return;
      running = true;
      void (async () => {
        for (const id of missing) {
          try {
            const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${id}&filters=basic`);
            if (res.status === 429) break; // rate limited; try again next load
            const json = (await res.json()) as Record<string, { success: boolean; data?: { short_description?: string } }>;
            cache = { ...cache, [id]: cleanText(json[id]?.data?.short_description ?? "") };
            save();
          } catch {
            break; // offline; try again next load
          }
          await new Promise((r) => setTimeout(r, DELAY_MS));
        }
        running = false;
      })();
    },
  };
}

/** Store text has HTML entities and can be long; keep the first sentence. */
function cleanText(html: string): string {
  const text = html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  const first = /^(.{20,160}?[.!?])(\s|$)/.exec(text)?.[1];
  return first ?? (text.length > 160 ? `${text.slice(0, 157).trimEnd()}...` : text);
}
