// gamescope focus control and the running game.
//
// gamescope shows the window whose app id comes first in the root property
// GAMESCOPECTRL_BASELAYER_APPID. The dashboard window is tagged with its own
// app id and always stays in that list, so Steam's own windows (sign-in,
// dialogs) stay behind it and it comes back when a game closes:
//
//   idle:            [DASHBOARD]
//   game in front:   [gameAppId, DASHBOARD]
//   home menu open:  [DASHBOARD]  (game frozen behind it with SIGSTOP)
//   needs Steam UI:  [769, DASHBOARD]  (install / sign-in dialogs)
//
// A game counts as running while any of its processes live (Steam marks them
// with SteamGameId), not only while its window shows. Many games first open
// an updater or launcher window (Epic Online Services, EA, Ubisoft), close
// it, then open the game window: the gap must not end the game. A game that
// started some other way (the Play button in Steam's store) is picked up too.
//
// Uses xprop, which ships with Bazzite. Does nothing outside gamescope.

import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

/** App id for the dashboard window; any value no Steam app uses. */
export const DASHBOARD_APP_ID = 7_690_001;
const STEAM_UI_APP_ID = 769;
const POLL_MS = 2000;
const GIVE_UP_MS = 10 * 60 * 1000;
const QUIT_GRACE_MS = 4000;
/** Polls in a row with no process and no window before a game counts as closed. */
const END_MISSES = 2;
/** After closing a game, its last processes are not picked up again for this long. */
const IGNORE_AFTER_QUIT_MS = 15_000;
/**
 * A game whose window has been gone this long gives the screen back, even if
 * a process lingers, so the dashboard never ignores the controller for a
 * game nobody can see. It is picked up again if a window comes back.
 */
const NO_WINDOW_MS = 90_000;
/** Steam background jobs that may carry a game id but are not the game. */
const NOT_THE_GAME = /^fossilize/;

const inGamescope = () => Boolean(process.env.GAMESCOPE_WAYLAND_DISPLAY) && Boolean(process.env.DISPLAY);

function xprop(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile("xprop", args, { timeout: 3000 }, (err, stdout) => resolve(err ? "" : stdout));
  });
}

function setBaselayer(appIds: number[]) {
  if (!inGamescope()) return Promise.resolve("");
  return xprop([
    "-root",
    "-f",
    "GAMESCOPECTRL_BASELAYER_APPID",
    "32c",
    "-set",
    "GAMESCOPECTRL_BASELAYER_APPID",
    appIds.join(","),
  ]);
}

async function focusableApps(): Promise<number[]> {
  const out = await xprop(["-root", "GAMESCOPE_FOCUSABLE_APPS"]);
  return (out.split("=")[1] ?? "").split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
}

/** gamescope app id for a Steam game id (shortcuts carry it in the top 32 bits). */
export function appIdFor(gameId: string): number {
  const id = BigInt(gameId);
  return id > 0xffffffffn ? Number(id >> 32n) : Number(id);
}

/** Game id -> PIDs of every process Steam started for a game (they carry SteamGameId). */
function gameProcesses(): Map<string, number[]> {
  const games = new Map<string, number[]>();
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    try {
      const env = readFileSync(`/proc/${entry}/environ`, "utf8");
      const id = /(?:^|\0)SteamGameId=(\d+)\0/.exec(env)?.[1];
      if (!id || NOT_THE_GAME.test(readFileSync(`/proc/${entry}/comm`, "utf8"))) continue;
      if (id && id !== "0") games.set(id, [...(games.get(id) ?? []), Number(entry)]);
    } catch {
      // Process ended or belongs to another user.
    }
  }
  return games;
}

const gamePids = (gameId: string) => gameProcesses().get(gameId) ?? [];

/** Send a signal to every process of a game; ignores ones already gone. */
function signalGame(gameId: string, sig: NodeJS.Signals) {
  for (const pid of gamePids(gameId)) {
    try {
      process.kill(pid, sig);
    } catch {
      // Already gone.
    }
  }
}

export interface RunningGame {
  gameId: string;
  appId: number;
}

export function createFocusManager(log: (msg: string) => void = () => undefined) {
  let running: RunningGame | null = null;
  let frozen = false;
  let showingSteamUi = false;
  let seen = false;
  let steamUiSeen = false;
  let misses = 0;
  let lastWindow = 0; // when the game last had a window (0 = not yet)
  let polling = false;
  let started = 0;
  let timer: NodeJS.Timeout | undefined;
  let layer = "";
  const ignored = new Map<string, number>(); // game id -> ignore until

  /** Set the base layer only when it changes (it is checked every poll). */
  const show = async (appIds: number[]) => {
    const next = appIds.join(",");
    if (next === layer) return;
    layer = next;
    await setBaselayer(appIds);
  };

  /** The game in front; other game windows (launchers, updaters) right behind it. */
  const gameLayer = (game: RunningGame, apps: number[]) => [
    game.appId,
    ...apps.filter((a) => a !== game.appId && a !== STEAM_UI_APP_ID && a !== DASHBOARD_APP_ID),
    DASHBOARD_APP_ID,
  ];

  const reset = async () => {
    if (running && frozen) signalGame(running.gameId, "SIGCONT");
    frozen = false;
    running = null;
    showingSteamUi = false;
    seen = false;
    steamUiSeen = false;
    misses = 0;
    await show([DASHBOARD_APP_ID]);
  };

  const track = (game: RunningGame, needsSteamUi: boolean) => {
    running = game;
    showingSteamUi = needsSteamUi;
    seen = false;
    steamUiSeen = false;
    misses = 0;
    lastWindow = 0;
    started = Date.now();
  };

  /** True once a Steam window that was showing has closed again. */
  const steamUiClosed = (apps: number[]) => {
    if (apps.includes(STEAM_UI_APP_ID)) steamUiSeen = true;
    return steamUiSeen && !apps.includes(STEAM_UI_APP_ID);
  };

  async function poll() {
    const apps = await focusableApps();
    const games = gameProcesses();

    if (running) {
      const game = running;
      const hasWindow = apps.includes(game.appId);
      const alive = (games.get(game.gameId)?.length ?? 0) > 0 || hasWindow;
      if (hasWindow) lastWindow = Date.now();
      else if (lastWindow && !frozen && Date.now() - lastWindow > NO_WINDOW_MS) {
        log(`focus: game ${game.gameId} has no window, showing the dashboard`);
        return reset();
      }
      // Install prompt closed and the game did not start: back to the dashboard.
      if (showingSteamUi && !alive && steamUiClosed(apps)) return reset();
      if (alive) {
        seen = true;
        misses = 0;
      } else if (seen) {
        if (++misses >= END_MISSES) {
          log(`focus: game ${game.gameId} closed`);
          return reset();
        }
        return;
      } else if (Date.now() - started > GIVE_UP_MS) {
        return reset(); // never started
      }
      if (frozen) return;
      // An install prompt was showing; once the game has a window, show the game.
      if (showingSteamUi && apps.includes(game.appId)) showingSteamUi = false;
      if (!showingSteamUi) await show(gameLayer(game, apps));
      return;
    }

    // A game started without the dashboard (Steam's Play button, a launcher):
    // follow it and put it in front, so Home can pause or close it.
    const now = Date.now();
    for (const [id, until] of ignored) if (until < now) ignored.delete(id);
    // Only a game with a window: a process alone may be a background job.
    const gameId = [...games.keys()].find((id) => !ignored.has(id) && apps.includes(appIdFor(id)));
    if (gameId) {
      log(`focus: following game ${gameId} (not started from the dashboard)`);
      track({ gameId, appId: appIdFor(gameId) }, false);
      seen = true;
      lastWindow = now;
      await show(gameLayer(running!, apps));
      return;
    }

    // Steam's own windows (store page, sign-in): back to the dashboard when they close.
    if (showingSteamUi && (steamUiClosed(apps) || now - started > GIVE_UP_MS)) await reset();
  }

  const startWatching = () => {
    if (timer || !inGamescope()) return;
    timer = setInterval(async () => {
      if (polling) return; // the last check is still running (xprop can be slow)
      polling = true;
      try {
        await poll();
      } finally {
        polling = false;
      }
    }, POLL_MS);
  };

  return {
    /** Tag our window and make it the base layer. `xid` is the X11 window id. */
    async attach(xid: number) {
      if (!inGamescope()) return;
      await xprop(["-id", String(xid), "-f", "STEAM_GAME", "32c", "-set", "STEAM_GAME", String(DASHBOARD_APP_ID)]);
      await reset();
      startWatching();
    },

    /**
     * A game is starting: put it in front once its window exists. `appId` is
     * the gamescope app id (Steam app id, or a shortcut's upper 32 bits).
     * `needsSteamUi` shows Steam's own windows instead (install prompts).
     */
    async launch(game: RunningGame, needsSteamUi = false) {
      ignored.delete(game.gameId);
      track(game, needsSteamUi);
      await show([needsSteamUi ? STEAM_UI_APP_ID : game.appId, DASHBOARD_APP_ID]);
    },

    /** Bring Steam's own windows forward (sign-in, downloads). */
    async showSteamUi() {
      running = null;
      frozen = false;
      showingSteamUi = true;
      seen = false;
      steamUiSeen = false;
      started = Date.now();
      await show([STEAM_UI_APP_ID, DASHBOARD_APP_ID]);
    },

    /** Steam's windows are done (store page closed): show the game if one runs, else the dashboard. */
    async leaveSteamUi() {
      showingSteamUi = false;
      if (running && !frozen) await show(gameLayer(running, await focusableApps()));
      else if (!running) await reset();
    },

    running: () => running,

    /**
     * Home button: freeze the game (like the "Pause Games" Deck plugin) and
     * put the dashboard in front. Online games may disconnect while frozen.
     */
    async home() {
      if (running && !frozen) {
        signalGame(running.gameId, "SIGSTOP");
        frozen = true;
      }
      await show([DASHBOARD_APP_ID]);
    },

    /** Unfreeze the game and put it back in front. */
    async resume() {
      if (!running) return;
      if (frozen) signalGame(running.gameId, "SIGCONT");
      frozen = false;
      await show(gameLayer(running, await focusableApps()));
    },

    /** Close the running game: SIGTERM, then SIGKILL whatever is left. */
    async quit() {
      const game = running;
      await reset(); // also unfreezes, so the game can handle SIGTERM
      if (!game) return;
      ignored.set(game.gameId, Date.now() + IGNORE_AFTER_QUIT_MS);
      signalGame(game.gameId, "SIGTERM");
      setTimeout(() => signalGame(game.gameId, "SIGKILL"), QUIT_GRACE_MS);
    },

    reset,
  };
}
