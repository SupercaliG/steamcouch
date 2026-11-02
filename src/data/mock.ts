import type { Profile, Title } from "../types";

// Sample data, used only when no Steam library is available (for example when
// running the UI in a browser without the Steam API). All titles are made up;
// tiles are drawn from their colors and glyphs.

const sample = (
  id: string,
  kind: Title["kind"],
  name: string,
  tagline: string,
  colors: { from: string; to: string },
  glyph: string,
  extra: Partial<Title> = {},
): Title => ({
  id,
  kind,
  name,
  tagline,
  source: kind === "app" ? "App" : "Steam",
  installed: true,
  art: {},
  colors,
  glyph,
  launch: { type: "steam", gameId: "0" },
  ...extra,
});

const DAY = 86400;
const now = Math.floor(Date.now() / 1000);

export const titles: Title[] = [
  sample("sample-sky-racers", "game", "Sky Racers", "Race through floating cities at impossible speeds.",
    { from: "#1d2b64", to: "#f8cdda" }, "S", { lastPlayed: now - 1 * DAY, playtimeMinutes: 640 }),
  sample("sample-pixel-quest", "game", "Pixel Quest 64", "A sword, a map and a world full of secrets.",
    { from: "#134e5e", to: "#71b280" }, "P", { lastPlayed: now - 3 * DAY, playtimeMinutes: 210 }),
  sample("sample-ocean-drift", "game", "Ocean Drift", "Jet across bright seas and tropical islands.",
    { from: "#0f2027", to: "#2c5364" }, "O", { lastPlayed: now - 9 * DAY, playtimeMinutes: 95 }),
  sample("sample-robo-rumble", "game", "Robo Rumble", "Build a robot and win the arena.",
    { from: "#42275a", to: "#734b6d" }, "R"),
  sample("sample-dino-dash", "game", "Dino Dash", "Run, jump and roar through prehistoric levels.",
    { from: "#3a6186", to: "#89253e" }, "D"),
  sample("sample-recomp", "game", "My Recomp", "A native PC port built from a recompiled classic.",
    { from: "#3a1c71", to: "#d76d77" }, "R", { source: "Recomp", lastPlayed: now - 5 * DAY }),
  sample("app-video", "app", "Video", "Watch videos on the big screen.", { from: "#2a0000", to: "#b30000" }, "▶"),
  sample("app-movies", "app", "Movies & TV", "Your movie and TV library.", { from: "#0f2027", to: "#2c5364" }, "🎬"),
  sample("app-music", "app", "Music", "Play music while you relax.", { from: "#41295a", to: "#c2185b" }, "♪"),
  sample("app-kids", "app", "Kids Shows", "Cartoons and shows picked for kids.", { from: "#134e5e", to: "#71b280" }, "★"),
];

// Defaults only. Changes made in Settings are saved on top of these (store.ts).
export const profiles: Profile[] = [
  {
    id: "kids",
    name: "Kids",
    color: "#2f7df6",
    restricted: true,
    allow: ["sample-pixel-quest", "sample-dino-dash", "app-kids"],
    favorites: [],
  },
  {
    id: "grownups",
    name: "Grown-ups",
    color: "#8b5cf6",
    restricted: false,
    allow: [],
    favorites: [],
  },
];
