// Reads the local Steam install and returns everything the dashboard shows:
// owned Steam games (installed or not), non-Steam shortcuts (recomps, other
// games) and media apps added to Steam (YouTube via VacuumTube, etc).
//
// Sources (all relative to the Steam root, e.g. ~/.local/share/Steam):
//   config/loginusers.vdf               which account is signed in
//   steamapps/libraryfolders.vdf        extra library folders
//   steamapps/appmanifest_<id>.acf      installed apps
//   appcache/appinfo.vdf                names, types and art paths of apps
//   appcache/librarycache/<id>/         one folder per app in the library
//   userdata/<acct>/config/localconfig.vdf   last played, playtime
//   userdata/<acct>/config/shortcuts.vdf     non-Steam shortcuts
//   userdata/<acct>/config/grid/        custom art (also used for shortcuts)

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Title } from "../../types.ts";
import {
  getNumber,
  getObject,
  getString,
  parseAppInfo,
  parseBinaryVdf,
  parseTextVdf,
  type VdfObject,
} from "./vdf.ts";

const CDN = "https://shared.steamstatic.com/store_item_assets/steam/apps";
const STEAMID64_BASE = 76561197960265728n;

export interface LibraryOptions {
  steamDir: string;
  /** URL prefix the UI uses to fetch files from the grid folder. */
  gridUrl: (file: string) => string;
  /** Optional cached store taglines: appId -> short description. */
  taglines?: Record<string, string>;
}

export interface Library {
  accountId: string | undefined;
  gridDir: string | undefined;
  titles: Title[];
}

export function readLibrary(opts: LibraryOptions): Library {
  const { steamDir } = opts;
  const accountId = findAccountId(steamDir);
  const configDir = accountId ? join(steamDir, "userdata", accountId, "config") : undefined;
  const gridDir = configDir && existsSync(join(configDir, "grid")) ? join(configDir, "grid") : undefined;
  const gridFiles = new Set(gridDir ? readdirSync(gridDir) : []);

  const appInfo = readAppInfo(steamDir);
  const libraryCache = join(steamDir, "appcache", "librarycache");
  const installed = readInstalledAppIds(steamDir);
  const played = readPlayStats(configDir);
  const libraryIds = readLibraryAppIds(steamDir);

  // Owned games = apps in the library cache (or installed or played) that
  // appinfo calls a game or demo. Tools, runtimes and DLC are dropped.
  const candidateIds = new Set<number>([...libraryIds, ...installed, ...played.keys()]);
  const titles: Title[] = [];

  for (const appId of candidateIds) {
    const info = appInfo.get(appId);
    const type = getString(info, "common", "type")?.toLowerCase();
    if (type !== "game" && type !== "demo") continue;
    const name = getString(info, "common", "name");
    if (!name) continue;
    const stats = played.get(appId);
    titles.push({
      id: `steam-${appId}`,
      kind: "game",
      name,
      tagline: opts.taglines?.[appId] ?? "",
      source: "Steam",
      installed: installed.has(appId),
      art: steamArt(appId, info!, gridFiles, opts.gridUrl, libraryCache),
      lastPlayed: stats?.lastPlayed,
      playtimeMinutes: stats?.minutes,
      launch: { type: "steam", gameId: String(appId) },
      controller: playableWithController(info!),
    });
  }

  if (configDir) titles.push(...readShortcuts(configDir, gridFiles, opts.gridUrl));
  return { accountId, gridDir, titles };
}

// ------------------------------------------------------------------ account

function findAccountId(steamDir: string): string | undefined {
  const file = join(steamDir, "config", "loginusers.vdf");
  if (existsSync(file)) {
    const users = getObject(parseTextVdf(readFileSync(file, "utf8")), "users") ?? {};
    const entries = Object.entries(users);
    const recent = entries.find(([, u]) => getString(u, "MostRecent") === "1") ?? entries[0];
    if (recent) {
      const accountId = (BigInt(recent[0]) - STEAMID64_BASE).toString();
      if (existsSync(join(steamDir, "userdata", accountId))) return accountId;
    }
  }
  // Fallback: the most recently changed userdata folder.
  const userdata = join(steamDir, "userdata");
  if (!existsSync(userdata)) return undefined;
  return readdirSync(userdata)
    .filter((d) => /^\d+$/.test(d) && d !== "0")
    .sort((a, b) => statSync(join(userdata, b)).mtimeMs - statSync(join(userdata, a)).mtimeMs)[0];
}

// --------------------------------------------------------------- steam apps

/**
 * Steam's own data: the developer's controller support ("full"/"partial"),
 * or a Steam Deck rating of Playable (2) or Verified (3), which Valve only
 * gives games that work with the Deck's controls.
 */
function playableWithController(info: VdfObject): boolean {
  const support = getString(info, "common", "controller_support")?.toLowerCase();
  const deck = getString(info, "common", "steam_deck_compatibility", "category");
  return support === "full" || support === "partial" || deck === "2" || deck === "3";
}

function readAppInfo(steamDir: string): Map<number, VdfObject> {
  const file = join(steamDir, "appcache", "appinfo.vdf");
  if (!existsSync(file)) return new Map();
  return new Map(parseAppInfo(readFileSync(file)).map((e) => [e.appId, e.data]));
}

function libraryFolders(steamDir: string): string[] {
  const folders = new Set([join(steamDir, "steamapps")]);
  const file = join(steamDir, "steamapps", "libraryfolders.vdf");
  if (existsSync(file)) {
    const root = getObject(parseTextVdf(readFileSync(file, "utf8")), "libraryfolders") ?? {};
    for (const entry of Object.values(root)) {
      const path = getString(entry, "path");
      if (path && existsSync(join(path, "steamapps"))) folders.add(join(path, "steamapps"));
    }
  }
  return [...folders];
}

function readInstalledAppIds(steamDir: string): Set<number> {
  const ids = new Set<number>();
  for (const folder of libraryFolders(steamDir)) {
    for (const file of readdirSync(folder)) {
      const m = /^appmanifest_(\d+)\.acf$/.exec(file);
      if (!m) continue;
      try {
        const state = getObject(parseTextVdf(readFileSync(join(folder, file), "utf8")), "AppState");
        // StateFlags bit 4 = fully installed.
        if ((getNumber(state, "StateFlags") ?? 0) & 4) ids.add(Number(m[1]));
      } catch {
        // Ignore a manifest Steam is writing right now.
      }
    }
  }
  return ids;
}

/** One folder per app in the user's library. A dev snapshot may ship a list instead. */
function readLibraryAppIds(steamDir: string): number[] {
  const dir = join(steamDir, "appcache", "librarycache");
  const list = join(steamDir, "librarycache-dirs.txt");
  const names = existsSync(dir)
    ? readdirSync(dir)
    : existsSync(list)
      ? readFileSync(list, "utf8").split(/\r?\n/)
      : [];
  return names.filter((n) => /^\d+$/.test(n)).map(Number);
}

function readPlayStats(configDir: string | undefined): Map<number, { lastPlayed?: number; minutes?: number }> {
  const out = new Map<number, { lastPlayed?: number; minutes?: number }>();
  if (!configDir) return out;
  const file = join(configDir, "localconfig.vdf");
  if (!existsSync(file)) return out;
  const apps =
    getObject(parseTextVdf(readFileSync(file, "utf8")), "UserLocalConfigStore", "Software", "Valve", "Steam", "apps") ??
    {};
  for (const [id, app] of Object.entries(apps)) {
    if (!/^\d+$/.test(id)) continue;
    const lastPlayed = getNumber(app, "LastPlayed");
    const minutes = getNumber(app, "Playtime");
    if (lastPlayed || minutes) out.set(Number(id), { lastPlayed: lastPlayed || undefined, minutes });
  }
  return out;
}

/**
 * Art URLs for a Steam game. Steam keeps the library art it has downloaded in
 * appcache/librarycache/<appid>/ using the same relative paths as the CDN, so
 * local files are used when present (served by /api/steamart) and the CDN
 * only for the rest.
 */
function steamArt(
  appId: number,
  info: VdfObject,
  gridFiles: Set<string>,
  gridUrl: (file: string) => string,
  libraryCache: string,
): Title["art"] {
  const assets = getObject(info, "common", "library_assets_full");
  const url = (path: string) =>
    existsSync(join(libraryCache, String(appId), path))
      ? `/api/steamart/${appId}/${path.split("/").map(encodeURIComponent).join("/")}`
      : `${CDN}/${appId}/${path}`;
  const asset = (key: string) => {
    const path = getString(assets, key, "image", "english");
    return path ? url(path) : undefined;
  };
  const header = getString(info, "common", "header_image", "english");
  // Custom art the user set in Steam wins over store art.
  const custom = (suffix: string) => findGrid(gridFiles, `${appId}${suffix}`, gridUrl);
  return {
    hero: custom("_hero") ?? asset("library_hero") ?? url("library_hero.jpg"),
    tile: custom("p") ?? asset("library_capsule") ?? url(header ?? "library_600x900.jpg"),
    logo: custom("_logo") ?? asset("library_logo"),
  };
}

// --------------------------------------------------------------- shortcuts

// Known media apps, matched on the shortcut name or command.
const MEDIA: { match: RegExp; name?: string; colors: { from: string; to: string }; glyph: string; tagline: string }[] = [
  { match: /youtube|vacuumtube/i, colors: { from: "#2a0000", to: "#c4000b" }, glyph: "▶", tagline: "The TV version of YouTube. Ads blocked." },
  { match: /netflix/i, colors: { from: "#0b0b0b", to: "#8a0710" }, glyph: "N", tagline: "Movies and TV shows." },
  { match: /disney/i, colors: { from: "#05103a", to: "#1b3fa0" }, glyph: "D+", tagline: "Disney, Pixar, Marvel and Star Wars." },
  { match: /prime|amazon/i, colors: { from: "#06121f", to: "#1f6fb2" }, glyph: "P", tagline: "Prime Video movies and shows." },
  { match: /hulu/i, colors: { from: "#05200f", to: "#1ce783" }, glyph: "H", tagline: "TV shows and movies." },
  { match: /hbo|\bmax\b/i, colors: { from: "#0a0a2a", to: "#3b1fc9" }, glyph: "M", tagline: "Movies and series." },
  { match: /plex/i, colors: { from: "#111", to: "#e5a00d" }, glyph: "▸", tagline: "Your movie and TV library." },
  { match: /jellyfin/i, colors: { from: "#0b1030", to: "#7a3fd1" }, glyph: "J", tagline: "Your movie and TV library." },
  { match: /spotify/i, colors: { from: "#0b1a10", to: "#1db954" }, glyph: "♪", tagline: "Music and podcasts." },
  { match: /twitch/i, colors: { from: "#130a26", to: "#9146ff" }, glyph: "T", tagline: "Live streams." },
  { match: /crunchyroll/i, colors: { from: "#2a1000", to: "#f47521" }, glyph: "C", tagline: "Anime." },
  { match: /streaming_scripts|flatpak run .*(kodi|stremio|freetube)/i, colors: { from: "#101830", to: "#2a3a6a" }, glyph: "▶", tagline: "" },
];

function readShortcuts(configDir: string, gridFiles: Set<string>, gridUrl: (f: string) => string): Title[] {
  const file = join(configDir, "shortcuts.vdf");
  if (!existsSync(file)) return [];
  let root: VdfObject;
  try {
    root = parseBinaryVdf(readFileSync(file));
  } catch {
    return [];
  }
  const out: Title[] = [];
  for (const sc of Object.values(getObject(root, "shortcuts") ?? {})) {
    if (typeof sc !== "object") continue;
    const signed = getNumber(sc, "appid");
    const name = getString(sc, "AppName") ?? getString(sc, "appname");
    if (signed === undefined || !name) continue;
    const appId = signed >>> 0;
    const exe = `${getString(sc, "Exe") ?? ""} ${getString(sc, "LaunchOptions") ?? ""}`;
    const tags = Object.values(getObject(sc, "tags") ?? {}).map(String);
    const lastPlayed = getNumber(sc, "LastPlayTime") || undefined;
    if (getNumber(sc, "IsHidden") === 1) continue;

    const media = MEDIA.find((m) => m.match.test(name) || m.match.test(exe));
    const isRecomp = /recomp/i.test(`${name} ${exe}`) || tags.some((t) => /recomp/i.test(t));
    const art = {
      hero: findGrid(gridFiles, `${appId}_hero`, gridUrl),
      tile: findGrid(gridFiles, `${appId}p`, gridUrl) ?? findGrid(gridFiles, `${appId}`, gridUrl),
      logo: findGrid(gridFiles, `${appId}_logo`, gridUrl),
    };
    // 64-bit game id Steam uses for shortcuts: (appid << 32) | 0x02000000.
    const gameId = ((BigInt(appId) << 32n) | 0x02000000n).toString();

    out.push({
      id: `shortcut-${appId}`,
      kind: media ? "app" : "game",
      name,
      tagline: media?.tagline ?? "",
      source: media ? "App" : isRecomp ? "Recomp" : "Non-Steam",
      installed: true,
      art,
      colors: media?.colors ?? colorFor(name),
      glyph: media?.glyph ?? name.slice(0, 1).toUpperCase(),
      lastPlayed,
      launch: { type: "steam", gameId },
    });
  }
  return out;
}

function findGrid(files: Set<string>, base: string, gridUrl: (f: string) => string): string | undefined {
  for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
    if (files.has(base + ext)) return gridUrl(base + ext);
  }
  return undefined;
}

/** Stable gradient from a name, for titles without art. */
function colorFor(name: string): { from: string; to: string } {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return { from: `hsl(${hue} 55% 18%)`, to: `hsl(${(hue + 40) % 360} 65% 42%)` };
}
