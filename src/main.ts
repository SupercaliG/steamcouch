import "@fontsource-variable/inter";
import "./styles.css";
import { h } from "./dom";
import { startInput, type Action } from "./input";
import {
  allProfiles,
  allTitles,
  closeStorePage,
  gameAction,
  gameRunning,
  gameState,
  getProfile,
  launchTitle as startTitle,
  loadLibrary,
  menuSounds,
  openStorePage,
  power,
  runningGameId,
} from "./store";
import { sfx } from "./sound";
import type { Profile, Title } from "./types";
import { controlCenter } from "./ui/control-center";
import { homeScreen } from "./ui/home";
import { profileScreen } from "./ui/profiles";
import { shopScreen } from "./ui/shop";
import { toast, type Screen } from "./ui/screen";

// Fixed 1920x1080 canvas scaled to fit the window, like a console output.
const stage = document.getElementById("stage")!;
const canvas = h("div", { id: "canvas" });
stage.append(canvas);

const fit = () => {
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
};
window.addEventListener("resize", fit);
fit();

let current: Screen | null = null;
let lastProfileId: string | undefined;

function show(next: Screen) {
  const prev = current;
  current = next;
  next.el.classList.add("entering");
  canvas.append(next.el);
  requestAnimationFrame(() => requestAnimationFrame(() => next.el.classList.remove("entering")));
  if (prev) {
    prev.el.classList.add("leaving");
    prev.destroy?.();
    setTimeout(() => prev.el.remove(), 450);
  }
}

function showProfiles() {
  show(
    profileScreen(allProfiles(), lastProfileId, (profile) => {
      sfx.login();
      showHome(profile);
    }),
  );
}

function showHome(profile: Profile) {
  lastProfileId = profile.id;
  show(
    homeScreen(profile, {
      onSwitchProfile: showProfiles,
      onLaunch: launchTitle,
      onOpenStore: () => showStore(profile),
    }),
  );
}

function showStore(profile: Profile) {
  if (profile.restricted) return;
  show(
    shopScreen({
      onBack: () => showHome(profile),
      onOpenInSteam: async (item) => {
        await openStorePage(item.appId);
        inSteamStore = true;
      },
    }),
  );
}

// ---------------------------------------------------------------- Steam store page
//
// A store page opens in Steam's own Big Picture store (it has the Buy button).
// Steam is in front then, so presses are ignored here, like in a game. Home
// closes it and shows the dashboard's store again.

let inSteamStore = false;

async function leaveSteamStore() {
  inSteamStore = false;
  sfx.close();
  await closeStorePage();
  // Pressing Home makes InputPlumber hold every press for us; give them back.
  await inputMode("normal");
}

// ---------------------------------------------------------------- in game
//
// While a game is in front the dashboard still receives controller input
// (gamescope keeps it running behind the game). Everything except Home is
// ignored then, so buttons pressed in the game do nothing here.

let gameTitle: Title | null = null;
let inGame = false;
let gameMenu: { el: HTMLElement; handle(a: Action): void; destroy?(): void } | null = null;
const GAME_POLL_MS = 2000;

/**
 * Follow the game the backend follows. It also finds games the dashboard did
 * not start (Steam's Play button, a launcher), so Home can still close them,
 * and notices when a game closes by itself (its own menu, or a crash).
 */
setInterval(async () => {
  if (opening) return;
  const id = await runningGameId();
  if (id && !inGame) {
    gameTitle = allTitles().find((t) => t.launch.gameId === id) ?? unknownGame(id);
    inGame = true;
    if (inSteamStore) inSteamStore = false; // a game started from the store page
  } else if (!id && inGame) {
    inGame = false;
    closeGameMenu();
  }
}, GAME_POLL_MS);

/** A running game that is not in the library list (new, or a shortcut we do not know). */
function unknownGame(gameId: string): Title {
  return {
    id: `steam:${gameId}`,
    kind: "game",
    name: "Game",
    tagline: "",
    art: {},
    source: "Steam",
    installed: true,
    launch: { type: "steam", gameId },
  };
}

const LAUNCH_POLL_MS = 1000;
const LAUNCH_GIVE_UP_MS = 10 * 60 * 1000;
/** Steam shows its install prompt for games that are not installed. */
const INSTALL_PROMPT_MS = 3000;
let closingGame = false;

/** Wait until the game shows a window ("ready"), or stops before that ("ended"). */
async function waitForGame(): Promise<"ready" | "ended"> {
  const until = Date.now() + LAUNCH_GIVE_UP_MS;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, LAUNCH_POLL_MS));
    const state = await gameState();
    if (state.ready) return "ready";
    if (!state.running) return "ended";
  }
  return "ended";
}

/**
 * Starts a title through Steam and resolves once its window is up, so the
 * home screen can show a loader on the tile until then. gamescope moves focus
 * to the game window when it appears and back to the dashboard when it closes.
 */
async function launchTitle(title: Title): Promise<void> {
  sfx.launch();
  closingGame = false;
  try {
    await startTitle(title);
  } catch (err) {
    console.error(err);
    sfx.error();
    toast(`Could not start ${title.name}`, { silent: true });
    return;
  }
  gameTitle = title;
  inGame = true;
  if (!title.installed) {
    await new Promise((resolve) => setTimeout(resolve, INSTALL_PROMPT_MS));
    return;
  }
  if ((await waitForGame()) === "ended" && !closingGame) {
    sfx.error();
    toast(`${title.name} did not start`, { silent: true });
  }
}

/** Ask the backend to route every controller press to the menu, or back. */
function inputMode(mode: "menu" | "normal") {
  return fetch("/api/input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  }).catch(() => undefined);
}

let opening = false;

/**
 * Home button: the Control Center. A running game is frozen behind it, and
 * while it is open every controller press comes to it (never to the game).
 */
async function openControlCenter() {
  if (gameMenu || opening) return;
  opening = true;
  sfx.open();
  const running = inGame && (await gameRunning());
  if (inGame && !running) inGame = false;
  if (running) await gameAction("home"); // freeze game, dashboard in front
  await inputMode("menu");
  opening = false;

  const leave = async () => {
    closeGameMenu();
    await inputMode("normal");
  };

  const restricted = lastProfileId ? getProfile(lastProfileId).restricted : true;
  const cc = controlCenter({
    game: running ? gameTitle : null,
    restricted,
    onClose: () => void (running ? resume() : leave()),
    onQuitGame: () => void quit(),
    onSwitchProfile: async () => {
      if (running) await quit();
      else await leave();
      showProfiles();
    },
    onPower: async (choice) => {
      if (running) await quit();
      else await leave();
      await power(choice);
    },
  });
  canvas.append(cc.el);
  requestAnimationFrame(() => cc.el.classList.add("show"));
  gameMenu = cc;
}

function closeGameMenu() {
  if (!gameMenu) return;
  const menu = gameMenu;
  gameMenu = null;
  sfx.close();
  menu.destroy?.();
  menu.el.classList.remove("show");
  setTimeout(() => menu.el.remove(), 250);
}

async function resume() {
  closeGameMenu();
  await gameAction("resume");
}

async function quit() {
  closingGame = true;
  const name = gameTitle?.name ?? "the game";
  closeGameMenu();
  await gameAction("quit");
  inGame = false;
  toast(`Closing ${name}`);
}

// Presses from the main process: the Home button (InputPlumber hands it to us
// instead of the game) and, while the Control Center is open, every press.
const bridge = (window as unknown as { steamcouch?: { onPad(cb: (a: string) => void): void } }).steamcouch;
bridge?.onPad((action) => {
  if (gameMenu) return withSound(action as Action, () => gameMenu!.handle(action as Action));
  if (action === "home") void (inSteamStore ? leaveSteamStore() : openControlCenter());
});

startInput((action) => {
  if (gameMenu) return withSound(action, () => gameMenu!.handle(action));
  if (action === "home") return void (inSteamStore ? leaveSteamStore() : openControlCenter());
  if (inGame || inSteamStore) return; // buttons belong to the game, or to Steam
  withSound(action, () => current?.handle(action));
});

// ---------------------------------------------------------------- sounds
//
// Screens do not play the everyday sounds themselves. Instead every press is
// handled here, and the screen change tells which sound fits: if the press
// changed something on screen, focus moved (or a view opened or closed). If
// nothing changed, the press hit an edge. Screens and actions that make their
// own sound (log in, start a game, a message) win over the everyday sound.

const changes = new MutationObserver(() => undefined);

function withSound(action: Action, run: () => void) {
  const mark = sfx.mark();
  changes.observe(canvas, { subtree: true, childList: true, attributes: true, characterData: true });
  try {
    run();
  } finally {
    const changed = changes.takeRecords().length > 0;
    changes.disconnect();
    if (!sfx.playedSince(mark)) everydaySound(action, changed);
  }
}

function everydaySound(action: Action, changed: boolean) {
  switch (action) {
    case "up":
    case "down":
    case "left":
    case "right":
      return changed ? sfx.move() : sfx.edge();
    case "tabPrev":
    case "tabNext":
      return changed ? sfx.tab() : sfx.edge();
    case "accept":
      return sfx.select();
    case "back":
      return changed ? sfx.back() : undefined;
    case "options":
      return changed ? sfx.select() : undefined;
    case "home":
      return undefined;
  }
}

void loadLibrary().then(() => {
  sfx.setEnabled(menuSounds());
  sfx.startup();
  showProfiles();
});
