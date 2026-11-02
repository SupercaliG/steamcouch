// Fills in missing art for non-Steam shortcuts (recomps, apps) from
// SteamGridDB, writing files into Steam's grid folder so Steam shows them too:
//   <appid>p.png      portrait tile (600x900)
//   <appid>.png       wide capsule (920x430)
//   <appid>_hero.png  background
//   <appid>_logo.png  logo
// Each shortcut is tried once per kind; misses are remembered so Steam's
// grid folder is not hammered on every library load.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Title } from "../../types.ts";

const API = "https://www.steamgriddb.com/api/v2";

const KINDS = [
  { suffix: "p", path: "grids", query: "dimensions=600x900&types=static&nsfw=false" },
  { suffix: "", path: "grids", query: "dimensions=920x430,460x215&types=static&nsfw=false" },
  { suffix: "_hero", path: "heroes", query: "types=static&nsfw=false" },
  { suffix: "_logo", path: "logos", query: "types=static&nsfw=false" },
] as const;

let running = false;

export function fillMissingArt(opts: {
  apiKey: string;
  gridDir: string;
  triedFile: string;
  titles: Title[];
}): void {
  if (running || !opts.apiKey) return;
  const tried: Record<string, true> = existsSync(opts.triedFile)
    ? JSON.parse(readFileSync(opts.triedFile, "utf8"))
    : {};

  const jobs = opts.titles.flatMap((t) => {
    const appId = /^shortcut-(\d+)$/.exec(t.id)?.[1];
    if (!appId) return [];
    return KINDS.filter((k) => {
      const key = `${appId}${k.suffix}`;
      const exists = [".png", ".jpg", ".jpeg", ".webp"].some((ext) => existsSync(join(opts.gridDir, key + ext)));
      return !exists && !tried[key];
    }).map((k) => ({ title: t, appId, kind: k }));
  });
  if (jobs.length === 0) return;

  running = true;
  const headers = { Authorization: `Bearer ${opts.apiKey}` };
  const saveTried = () => {
    mkdirSync(dirname(opts.triedFile), { recursive: true });
    writeFileSync(opts.triedFile, JSON.stringify(tried));
  };

  void (async () => {
    const gameIds = new Map<string, number | null>();
    try {
      for (const job of jobs) {
        if (!gameIds.has(job.title.name)) {
          const res = await fetch(`${API}/search/autocomplete/${encodeURIComponent(job.title.name)}`, { headers });
          const data = (await res.json()) as { data?: { id: number }[] };
          gameIds.set(job.title.name, data.data?.[0]?.id ?? null);
        }
        const gameId = gameIds.get(job.title.name);
        const key = `${job.appId}${job.kind.suffix}`;
        if (!gameId) {
          tried[key] = true; // no match on SteamGridDB
          continue;
        }
        const res = await fetch(`${API}/${job.kind.path}/game/${gameId}?${job.kind.query}`, { headers });
        const url = ((await res.json()) as { data?: { url: string }[] }).data?.[0]?.url;
        if (url) {
          const ext = (/\.(png|jpe?g|webp)$/i.exec(url)?.[1] ?? "png").toLowerCase().replace("jpeg", "jpg");
          const image = Buffer.from(await (await fetch(url)).arrayBuffer());
          writeFileSync(join(opts.gridDir, `${key}.${ext}`), image);
        }
        tried[key] = true;
      }
    } catch {
      // Offline or API error: keep what we have, try the rest next time.
    } finally {
      saveTried();
      running = false;
    }
  })();
}
