// Electron shell for the couch PC. Runs as the gamescope session client:
// one fullscreen window with the dashboard UI, plus the backend API served on
// the app:// scheme so the UI's fetch("/api/...") calls work unchanged.
//
// Steam is started separately (hidden) by the session script; games are
// launched through it with steam://rungameid/<id>.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, normalize, sep } from "node:path";
import { app, BrowserWindow, protocol } from "electron";
import { createApi, type PowerAction } from "../src/main/api.ts";
import { createFocusManager } from "./focus.ts";
import { createInputPlumber, MODE_PASS, MODE_ALL } from "./inputplumber.ts";
import { startPadGrab, type PadGrab } from "./padgrab.ts";
import { changeVolume, systemStatus, toggleMute } from "./system.ts";

/** Exit code that tells the session script to switch back to Steam Gaming Mode. */
const EXIT_TO_STEAM = 42;

const UI_DIR = join(__dirname, "..", "dist");
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json",
};

function steamRoot(): string {
  const candidates = [
    process.env.STEAMCOUCH_STEAM_DIR,
    join(homedir(), ".local", "share", "Steam"),
    join(homedir(), ".steam", "steam"),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => existsSync(join(p, "steamapps"))) ?? candidates[0]!;
}

function run(cmd: string, args: string[]) {
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

const focus = createFocusManager();
let win: BrowserWindow | null = null;

const log = (msg: string) => console.log(`[steamcouch] ${msg}`);

// Controller routing for the Control Center. With InputPlumber (Bazzite), its
// intercept mode sends Home to us and, while the menu is open, every press
// (see inputplumber.ts). Without it, padgrab.py holds the gamepads instead.
const plumber = createInputPlumber(log);
let usePlumber = false;
const sendPad = (action: string) => win?.webContents.send("pad", action);

async function menuInput() {
  if (usePlumber) await plumber.setMode(MODE_ALL);
  else if (!grab && existsSync(PADGRAB)) grab = startPadGrab(PADGRAB, sendPad);
}

async function normalInput() {
  if (usePlumber) {
    await plumber.waitForRelease(); // the press that closed the menu stays out of the game
    await plumber.setMode(MODE_PASS);
  } else await releaseGrab();
}

/** Never leave the controller captured when the dashboard exits. */
function restoreInputSync() {
  try {
    const tree = execFileSync("busctl", ["--system", "--list", "tree", "org.shadowblip.InputPlumber"], {
      encoding: "utf8",
      timeout: 2000,
    });
    for (const dev of new Set(tree.match(/\/org\/shadowblip\/InputPlumber\/CompositeDevice\d+(?=\s|$)/gm) ?? [])) {
      execFileSync("busctl", [
        "--system", "set-property", "org.shadowblip.InputPlumber", dev,
        "org.shadowblip.Input.CompositeDevice", "InterceptMode", "u", "0",
      ], { timeout: 2000 });
    }
  } catch {
    // InputPlumber not present.
  }
}

const PADGRAB = app.isPackaged
  ? join(process.resourcesPath, "padgrab.py")
  : join(__dirname, "..", "electron", "padgrab.py");
let grab: PadGrab | null = null;

async function releaseGrab() {
  const g = grab;
  grab = null;
  await g?.release();
}

/** gamescope app id for a Steam game id (shortcuts carry it in the top 32 bits). */
function appIdFor(gameId: string): number {
  const id = BigInt(gameId);
  return id > 0xffffffffn ? Number(id >> 32n) : Number(id);
}

const handleApi = createApi({
  steamDir: steamRoot(),
  dataDir: join(homedir(), ".config", "steamcouch"),
  launch: (gameId, { installed }) => {
    void focus.launch({ gameId, appId: appIdFor(gameId) }, !installed);
    run("steam", [`steam://rungameid/${gameId}`]);
  },
  system: { status: systemStatus, volume: changeVolume, mute: toggleMute },
  game: {
    running: () => focus.running(),
    home: () => focus.home(), // freezes the game; the page asks for menu input
    resume: async () => {
      await normalInput(); // waits for the buttons to be let go
      await focus.resume();
    },
    quit: async () => {
      await normalInput();
      await focus.quit();
    },
  },
  input: { menu: menuInput, normal: normalInput },
  power: (action: PowerAction) => {
    if (action === "steam-window") {
      // Bring Steam's own window forward (sign-in, downloads, settings).
      void focus.showSteamUi();
      run("steam", ["steam://open/main"]);
    } else if (action === "restart") run("systemctl", ["reboot"]);
    else if (action === "shutdown") run("systemctl", ["poweroff"]);
    else {
      restoreInputSync();
      app.exit(action === "steam" ? EXIT_TO_STEAM : 0);
    }
  },
});

// Chromium under gamescope: use XWayland so gamescope can manage focus, and
// keep rendering when a game has focus.
app.commandLine.appendSwitch("ozone-platform", "x11");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) app.exit(0);

app.whenReady().then(() => {
  protocol.handle("app", async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const body = request.method === "GET" ? undefined : await request.text();
      const res = await handleApi(request.method, url.pathname + url.search, body);
      return new Response(res.body as BodyInit, { status: res.status, headers: { "Content-Type": res.type } });
    }
    // Static UI files; never leave UI_DIR. (Files live inside app.asar, which
    // has no symlinks, so rejecting ".." and a separator-aware prefix check
    // are enough.)
    let decoded: string;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (decoded.split(/[/\\]/).includes("..") || decoded.includes("\u0000")) {
      return new Response("Bad request", { status: 400 });
    }
    const rel = normalize(decoded).replace(/^([/\\])+/, "") || "index.html";
    const file = join(UI_DIR, rel);
    if (!file.startsWith(UI_DIR + sep) || !existsSync(file)) return new Response("Not found", { status: 404 });
    return new Response(readFileSync(file), {
      headers: { "Content-Type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream" },
    });
  });

  win = new BrowserWindow({
    fullscreen: true,
    frame: false,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      preload: join(__dirname, "preload.cjs"),
    },
  });
  const w = win;
  w.once("ready-to-show", () => {
    w.show();
    w.focus();
    // X11 window id, used to tag the window for gamescope.
    const handle = w.getNativeWindowHandle();
    if (handle.length >= 4) void focus.attach(handle.readUInt32LE(0));
  });
  // Only our own UI may load in the window; external links are ignored.
  w.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("app://")) e.preventDefault();
  });
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void w.loadURL("app://ui/index.html");

  // Home button through InputPlumber, when it manages the controller.
  void (async () => {
    usePlumber = await plumber.available();
    log(usePlumber ? "inputplumber: found, using intercept mode" : "inputplumber: not found, using padgrab");
    if (!usePlumber) return;
    await plumber.setMode(MODE_PASS);
    plumber.start(sendPad);
  })();
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  plumber.stop();
  restoreInputSync();
});
