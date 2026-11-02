// The dashboard's backend. The UI talks to it with fetch("/api/..."):
//   - in development through the Vite dev server (vite.config.ts)
//   - on the couch PC through Electron's app:// protocol (electron/main.ts)
// Both call handleApi(), so the UI code is the same in both places.

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, sep } from "node:path";
import { readLibrary, type Library } from "./steam/library.ts";
import { createSteamStore } from "./steam/store.ts";
import { fillMissingArt } from "./steam/steamgriddb.ts";
import { taglineCache } from "./steam/taglines.ts";

export interface ApiConfig {
  steamDir: string;
  /** Folder for settings.json, caches and the SteamGridDB key. */
  dataDir: string;
  /** Starts a title. Absent in development (launch is simulated). */
  launch?: (gameId: string, opts: { installed: boolean }) => void;
  /** Power actions. Absent in development. */
  power?: (action: PowerAction) => void;
  /** The running game (Home button menu). Absent in development. */
  game?: {
    running(): { gameId: string } | null;
    home(): Promise<void>;
    resume(): Promise<void>;
    quit(): Promise<void>;
  };
  /** Sound and network for the Control Center. A fake is used in development. */
  system?: SystemControls;
  /** Controller routing while the Control Center is open. Absent in development. */
  input?: { menu(): Promise<void>; normal(): Promise<void> };
  /** Shows a game's page in Steam's own store, and goes back. Absent in development. */
  steamStore?: { open(appId: number): Promise<void>; close(): Promise<void> };
}

export type GameAction = "home" | "resume" | "quit";

export interface SystemControls {
  status(): Promise<unknown>;
  volume(delta: number): Promise<void>;
  mute(): Promise<void>;
}

/** Stand-in for development: keeps a fake volume in memory. */
function devSystem(): SystemControls {
  let volume = 60;
  let muted = false;
  return {
    status: async () => ({
      volume,
      muted,
      output: "TV",
      network: { connected: true, type: "wifi", name: "Home Wi-Fi" },
    }),
    volume: async (delta) => {
      volume = Math.max(0, Math.min(100, volume + delta));
      muted = false;
    },
    mute: async () => {
      muted = !muted;
    },
  };
}

export type PowerAction = "steam" | "steam-window" | "restart" | "shutdown" | "quit";

export interface ApiResponse {
  status: number;
  type: string;
  body: string | Buffer;
}

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export function createApi(config: ApiConfig) {
  const taglines = taglineCache(join(config.dataDir, "cache", "taglines.json"));
  const settingsFile = join(config.dataDir, "settings.json");
  const gridKeyFile = join(config.dataDir, "steamgriddb.key");
  let lib: Library | undefined;
  const system = config.system ?? devSystem();
  const store = createSteamStore();

  const json = (data: unknown, status = 200): ApiResponse => ({
    status,
    type: "application/json",
    body: JSON.stringify(data),
  });

  function loadLibrary(): Library {
    lib = readLibrary({
      steamDir: config.steamDir,
      gridUrl: (file) => `/api/grid/${encodeURIComponent(file)}`,
      taglines: taglines.all,
    });
    // Background work; results show up on the next load.
    taglines.fill(
      lib.titles
        .filter((t) => t.source === "Steam")
        .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
        .map((t) => Number(t.launch.gameId)),
    );
    if (lib.gridDir && existsSync(gridKeyFile)) {
      fillMissingArt({
        apiKey: readFileSync(gridKeyFile, "utf8").trim(),
        gridDir: lib.gridDir,
        triedFile: join(config.dataDir, "cache", "steamgriddb-tried.json"),
        titles: lib.titles.filter((t) => t.source !== "Steam"),
      });
    }
    return lib;
  }

  return async function handleApi(method: string, url: string, body?: string): Promise<ApiResponse> {
    const path = url.split("?")[0] ?? "";

    if (method === "GET" && path === "/api/library") {
      const l = loadLibrary();
      return json({ accountId: l.accountId, titles: l.titles });
    }

    if (method === "GET" && path.startsWith("/api/grid/")) {
      const file = basename(decodeURIComponent(path.slice("/api/grid/".length)));
      const type = IMAGE_TYPES[extname(file).toLowerCase()];
      const gridDir = (lib ?? loadLibrary()).gridDir;
      const full = gridDir ? join(gridDir, file) : "";
      if (!type || !gridDir || !existsSync(full)) return { status: 404, type: "text/plain", body: "" };
      return { status: 200, type, body: readFileSync(full) };
    }

    if (method === "GET" && path.startsWith("/api/steamart/")) {
      // /api/steamart/<appid>/<path inside Steam's librarycache/<appid>/>
      const bad: ApiResponse = { status: 400, type: "text/plain", body: "" };
      let parts: string[];
      try {
        parts = path.slice("/api/steamart/".length).split("/").map(decodeURIComponent);
      } catch {
        return bad;
      }
      const [appId, ...rest] = parts;
      // Segments must be plain names: no separators (even encoded), no dot names.
      if (!appId || !/^\d+$/.test(appId) || rest.length === 0) return bad;
      if (rest.some((p) => !p || p === "." || p === ".." || /[\\/\u0000]/.test(p))) return bad;
      const base = join(config.steamDir, "appcache", "librarycache", appId);
      const candidate = join(base, ...rest);
      if (!existsSync(candidate)) return { status: 404, type: "text/plain", body: "" };
      // Resolve symlinks and make sure the file is still inside this app's folder.
      const realBase = realpathSync(base);
      const full = realpathSync(candidate);
      if (!full.startsWith(realBase + sep)) return bad;
      const type = IMAGE_TYPES[extname(full).toLowerCase()];
      if (!type) return { status: 404, type: "text/plain", body: "" };
      return { status: 200, type, body: readFileSync(full) };
    }

    if (path === "/api/settings") {
      if (method === "GET") {
        return json(existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")) : {});
      }
      if (method === "PUT" && body) {
        JSON.parse(body); // reject invalid JSON before writing
        mkdirSync(dirname(settingsFile), { recursive: true });
        writeFileSync(settingsFile, body);
        return json({ ok: true });
      }
    }

    if (method === "POST" && path === "/api/launch" && body) {
      const { gameId, installed = true } = JSON.parse(body) as { gameId?: string; installed?: boolean };
      if (!gameId || !/^\d+$/.test(gameId)) return json({ error: "bad gameId" }, 400);
      config.launch?.(gameId, { installed });
      return json({ ok: true, simulated: !config.launch });
    }

    if (method === "GET" && path === "/api/game") {
      return json({ running: config.game?.running()?.gameId ?? null });
    }

    if (method === "POST" && path === "/api/game" && body) {
      const { action } = JSON.parse(body) as { action?: GameAction };
      if (action === "home") await config.game?.home();
      else if (action === "resume") await config.game?.resume();
      else if (action === "quit") await config.game?.quit();
      else return json({ error: "bad action" }, 400);
      return json({ ok: true });
    }

    if (method === "POST" && path === "/api/input" && body) {
      const { mode } = JSON.parse(body) as { mode?: string };
      if (mode === "menu") await config.input?.menu();
      else if (mode === "normal") await config.input?.normal();
      else return json({ error: "bad mode" }, 400);
      return json({ ok: true });
    }

    if (method === "GET" && path === "/api/system") {
      return json(await system.status());
    }

    if (method === "POST" && path === "/api/system" && body) {
      const { action, delta } = JSON.parse(body) as { action?: string; delta?: number };
      if (action === "volume" && typeof delta === "number" && Math.abs(delta) <= 100) await system.volume(delta);
      else if (action === "mute") await system.mute();
      else return json({ error: "bad action" }, 400);
      return json(await system.status());
    }

    if (method === "POST" && path === "/api/power" && body) {
      const { action } = JSON.parse(body) as { action?: PowerAction };
      if (!action || !["steam", "steam-window", "restart", "shutdown", "quit"].includes(action)) {
        return json({ error: "bad action" }, 400);
      }
      config.power?.(action);
      return json({ ok: true, simulated: !config.power });
    }

    if (method === "GET" && path === "/api/store/discover") {
      try {
        return json({ sections: await store.discover() });
      } catch (err) {
        return json({ error: String(err) }, 502);
      }
    }

    if (method === "GET" && path === "/api/store/browse") {
      const query = new URLSearchParams(url.split("?")[1] ?? "");
      const filters = (query.get("f") ?? "").split(",").filter((f) => /^[a-z0-9-]+$/.test(f));
      const start = Number(query.get("start") ?? 0);
      if (!Number.isInteger(start) || start < 0 || start > 5000) return json({ error: "bad start" }, 400);
      try {
        return json(await store.browse(filters, start));
      } catch (err) {
        return json({ error: String(err) }, 502);
      }
    }

    if (method === "POST" && path === "/api/store/open" && body) {
      const { appId } = JSON.parse(body) as { appId?: number };
      if (!Number.isInteger(appId) || appId! <= 0) return json({ error: "bad appId" }, 400);
      await config.steamStore?.open(appId!);
      return json({ ok: true, simulated: !config.steamStore });
    }

    if (method === "POST" && path === "/api/store/close") {
      await config.steamStore?.close();
      return json({ ok: true });
    }

    return json({ error: "not found" }, 404);
  };
}
