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
// Uses xprop, which ships with Bazzite. Does nothing outside gamescope.

import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

/** App id for the dashboard window; any value no Steam app uses. */
export const DASHBOARD_APP_ID = 7_690_001;
const STEAM_UI_APP_ID = 769;
const POLL_MS = 2000;
const GIVE_UP_MS = 10 * 60 * 1000;
const QUIT_GRACE_MS = 4000;

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

/** PIDs that Steam started for this game id (Steam sets SteamGameId on them). */
function gamePids(gameId: string): number[] {
  const pids: number[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const env = readFileSync(`/proc/${entry}/environ`, "utf8");
      if (env.includes(`\0SteamGameId=${gameId}\0`) || env.startsWith(`SteamGameId=${gameId}\0`)) {
        pids.push(Number(entry));
      }
    } catch {
      // Process ended or belongs to another user.
    }
  }
  return pids.filter((pid) => pid !== process.pid);
}

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

export function createFocusManager() {
  let running: RunningGame | null = null;
  let frozen = false;
  let showingSteamUi = false;
  let seen = false;
  let started = 0;
  let timer: NodeJS.Timeout | undefined;

  const stopWatching = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };

  const reset = async () => {
    if (running && frozen) signalGame(running.gameId, "SIGCONT");
    frozen = false;
    running = null;
    showingSteamUi = false;
    seen = false;
    stopWatching();
    await setBaselayer([DASHBOARD_APP_ID]);
  };

  const watch = () => {
    stopWatching();
    timer = setInterval(async () => {
      const target = showingSteamUi ? STEAM_UI_APP_ID : running?.appId;
      if (target === undefined) return;
      const apps = await focusableApps();
      if (apps.includes(target)) seen = true;
      // Game closed (or Steam dialog dismissed): back to the dashboard.
      else if (seen) await reset();
      // Never showed up (failed to start): stop waiting.
      else if (Date.now() - started > GIVE_UP_MS) await reset();
    }, POLL_MS);
  };

  return {
    /** Tag our window and make it the base layer. `xid` is the X11 window id. */
    async attach(xid: number) {
      if (!inGamescope()) return;
      await xprop(["-id", String(xid), "-f", "STEAM_GAME", "32c", "-set", "STEAM_GAME", String(DASHBOARD_APP_ID)]);
      await reset();
    },

    /**
     * A game is starting: put it in front once its window exists. `appId` is
     * the gamescope app id (Steam app id, or a shortcut's upper 32 bits).
     * `needsSteamUi` shows Steam's own windows instead (install prompts).
     */
    async launch(game: RunningGame, needsSteamUi = false) {
      running = game;
      showingSteamUi = needsSteamUi;
      seen = false;
      started = Date.now();
      await setBaselayer([needsSteamUi ? STEAM_UI_APP_ID : game.appId, DASHBOARD_APP_ID]);
      if (inGamescope()) watch();
    },

    /** Bring Steam's own windows forward (sign-in, downloads). */
    async showSteamUi() {
      running = null;
      showingSteamUi = true;
      seen = false;
      started = Date.now();
      await setBaselayer([STEAM_UI_APP_ID, DASHBOARD_APP_ID]);
      if (inGamescope()) watch();
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
      await setBaselayer([DASHBOARD_APP_ID]);
    },

    /** Unfreeze the game and put it back in front. */
    async resume() {
      if (!running) return;
      if (frozen) signalGame(running.gameId, "SIGCONT");
      frozen = false;
      await setBaselayer([running.appId, DASHBOARD_APP_ID]);
    },

    /** Close the running game: SIGTERM, then SIGKILL whatever is left. */
    async quit() {
      const game = running;
      await reset(); // also unfreezes, so the game can handle SIGTERM
      if (!game) return;
      signalGame(game.gameId, "SIGTERM");
      setTimeout(() => signalGame(game.gameId, "SIGKILL"), QUIT_GRACE_MS);
    },

    reset,
  };
}
