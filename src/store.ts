import { profiles as defaultProfiles, legacyProfiles, titles as mockTitles } from "./data/mock";
import type { Profile, StoreItem, StoreSection, Tab, Title } from "./types";

// App data plus per-profile settings (favorites, allow list, passcode).
// Titles come from the local Steam library (/api/library); the mock list is
// only used when that API is not available. Settings are saved through
// /api/settings (a JSON file on the couch PC), with localStorage as a fallback.

let titles: Title[] = mockTitles;
export let librarySource: "steam" | "mock" = "mock";

/** How many recent games the home row shows before the library tile. */
const HOME_ROW_LIMIT = 12;

type ProfileSettings = Pick<Profile, "favorites" | "allow" | "pin">;
interface SavedSettings {
  profiles: Record<string, Partial<ProfileSettings>>;
  /** Titles started from the dashboard, unix seconds (Steam updates its own copy later). */
  lastPlayed: Record<string, number>;
  /** Hide games that cannot be played with a controller. On unless turned off in Settings. */
  controllerOnly?: boolean;
  /** Menu sounds. On unless turned off in Settings. */
  menuSounds?: boolean;
}

const LOCAL_KEY = "steamcouch.settings";
let settings: SavedSettings = { profiles: {}, lastPlayed: {} };
/** Profile id -> picture URL, for profiles with a picture sent from a phone. */
let avatars: Record<string, string> = {};
let settingsApi = false;

export async function loadLibrary(): Promise<void> {
  await Promise.all([
    (async () => {
      try {
        const res = await fetch("/api/library");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        titles = ((await res.json()) as { titles: Title[] }).titles;
        librarySource = "steam";
      } catch (err) {
        console.warn("Steam library not available, using sample data:", err);
      }
    })(),
    (async () => {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        settings = { profiles: {}, lastPlayed: {}, ...((await res.json()) as Partial<SavedSettings>) };
        settingsApi = true;
      } catch {
        settings = { profiles: {}, lastPlayed: {}, ...JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "{}") };
      }
    })(),
    refreshAvatars(),
  ]);
  migrateProfiles();
}

/** Copy settings saved under an old profile id (e.g. "grownups") to the profiles that replaced it. */
function migrateProfiles() {
  let changed = false;
  for (const [oldId, newIds] of Object.entries(legacyProfiles)) {
    const saved = settings.profiles[oldId];
    if (!saved) continue;
    for (const id of newIds) settings.profiles[id] ??= structuredClone(saved);
    delete settings.profiles[oldId];
    changed = true;
  }
  if (changed) persist();
}

function persist() {
  const body = JSON.stringify(settings);
  if (!settingsApi) return localStorage.setItem(LOCAL_KEY, body);
  void fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body }).catch(
    (err: unknown) => console.error("Could not save settings:", err),
  );
}

function save(profile: Profile): Profile {
  settings.profiles[profile.id] = { favorites: profile.favorites, allow: profile.allow, pin: profile.pin };
  persist();
  return profile;
}

export function allProfiles(): Profile[] {
  return defaultProfiles.map((p) => ({ ...p, ...settings.profiles[p.id], avatar: avatars[p.id] ?? p.avatar }));
}

/** Reload which profiles have a picture. True when something changed. */
export async function refreshAvatars(): Promise<boolean> {
  try {
    const res = await fetch("/api/avatars");
    if (!res.ok) return false;
    const next = (await res.json()) as Record<string, string>;
    const changed = JSON.stringify(next) !== JSON.stringify(avatars);
    avatars = next;
    return changed;
  } catch {
    return false;
  }
}

/** Let a phone send a picture for a profile; returns the link for the QR code. */
export async function startAvatarUpload(profileId: string): Promise<string> {
  const res = await fetch("/api/avatars/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId }),
  });
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data.url;
}

export async function stopAvatarUpload(): Promise<void> {
  await fetch("/api/avatars/stop", { method: "POST" }).catch(() => undefined);
}

export async function removeAvatar(profileId: string): Promise<void> {
  await fetch("/api/avatars/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId }),
  });
  await refreshAvatars();
}

export function getProfile(id: string): Profile {
  const p = allProfiles().find((x) => x.id === id);
  if (!p) throw new Error(`Unknown profile ${id}`);
  return p;
}

export function restrictedProfiles(): Profile[] {
  return allProfiles().filter((p) => p.restricted);
}

export function allTitles(): Title[] {
  return titles.map((t) => ({ ...t, lastPlayed: Math.max(settings.lastPlayed[t.id] ?? 0, t.lastPlayed ?? 0) || undefined }));
}

export function canSee(profile: Profile, titleId: string): boolean {
  return !profile.restricted || profile.allow.includes(titleId);
}

/** True while games without controller support are hidden (the default). */
export function controllerOnly(): boolean {
  return settings.controllerOnly !== false;
}

export function setControllerOnly(on: boolean): void {
  settings.controllerOnly = on;
  persist();
}

export function menuSounds(): boolean {
  return settings.menuSounds !== false;
}

export function setMenuSounds(on: boolean): void {
  settings.menuSounds = on;
  persist();
}

/** Titles a profile sees on Home and in the library. */
export function visibleTitles(profile: Profile): Title[] {
  const hideNoController = controllerOnly();
  return allTitles().filter(
    (t) => canSee(profile, t.id) && !(hideNoController && t.kind === "game" && t.controller === false),
  );
}

/**
 * Home row for one tab: most recently played first, never-played last (A-Z).
 * Games that are neither installed nor played stay in the library only.
 */
export function titlesForTab(profile: Profile, tab: Tab): Title[] {
  const kind = tab === "games" ? "game" : "app";
  return visibleTitles(profile)
    .filter((t) => t.kind === kind && (t.installed || t.lastPlayed))
    .sort((a, b) => {
      const byRecent = (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0);
      return byRecent !== 0 ? byRecent : a.name.localeCompare(b.name);
    })
    .slice(0, HOME_ROW_LIMIT);
}

export function isFavorite(profile: Profile, titleId: string): boolean {
  return profile.favorites.includes(titleId);
}

export function toggleFavorite(profile: Profile, titleId: string): Profile {
  const favorites = isFavorite(profile, titleId)
    ? profile.favorites.filter((id) => id !== titleId)
    : [...profile.favorites, titleId];
  return save({ ...profile, favorites });
}

/** Add or remove a title from a restricted profile's allow list. */
export function setAllowed(profileId: string, titleId: string, allowed: boolean): Profile {
  const p = getProfile(profileId);
  const allow = allowed
    ? [...new Set([...p.allow, titleId])]
    : p.allow.filter((id) => id !== titleId);
  // A title the profile can no longer see should not stay a favorite.
  const favorites = allowed ? p.favorites : p.favorites.filter((id) => id !== titleId);
  return save({ ...p, allow, favorites });
}

export function setPin(profileId: string, pin: string | undefined): Profile {
  return save({ ...getProfile(profileId), pin });
}

export function markPlayed(titleId: string): void {
  settings.lastPlayed[titleId] = Math.floor(Date.now() / 1000);
  persist();
}

/** Ask the backend to start a title through Steam. */
export async function launchTitle(title: Title): Promise<void> {
  const res = await fetch("/api/launch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId: title.launch.gameId, installed: title.installed }),
  });
  if (!res.ok) throw new Error(`Launch failed: HTTP ${res.status}`);
}

export type PowerAction = "steam" | "steam-window" | "restart" | "shutdown";

export async function power(action: PowerAction): Promise<void> {
  await fetch("/api/power", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

/** True while a title started from the dashboard is still running. */
export async function gameRunning(): Promise<boolean> {
  try {
    const res = await fetch("/api/game");
    return Boolean(((await res.json()) as { running: string | null }).running);
  } catch {
    return false;
  }
}

export async function gameAction(action: "home" | "resume" | "quit"): Promise<void> {
  await fetch("/api/game", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

// ---------------------------------------------------------------- Steam Store

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function storeDiscover(): Promise<StoreSection[]> {
  return (await getJson<{ sections: StoreSection[] }>("/api/store/discover")).sections;
}

export function storeBrowse(
  filters: string[],
  start: number,
  term = "",
): Promise<{ items: StoreItem[]; next: number | null }> {
  const q = new URLSearchParams({ f: filters.join(","), start: String(start) });
  if (term) q.set("q", term);
  return getJson(`/api/store/browse?${q}`);
}

/** Steam app ids the user already owns (their Steam games in the library). */
export function ownedAppIds(): Set<number> {
  return new Set(titles.filter((t) => t.source === "Steam").map((t) => Number(t.launch.gameId)));
}

/** Show a game's page in Steam's controller-friendly store. */
export async function openStorePage(appId: number): Promise<void> {
  const res = await fetch("/api/store/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** Put the dashboard back in front of Steam's store. */
export async function closeStorePage(): Promise<void> {
  await fetch("/api/store/close", { method: "POST" }).catch(() => undefined);
}
