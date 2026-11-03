// Steam Store sections and Browse filters. Shared by the UI (labels, groups)
// and the backend (the Steam search parameters each one maps to).
//
// Tag ids come from store.steampowered.com/tagdata/populartags/english,
// category ids from the store search page (category2 = players,
// category3 = features).

export type FilterGroup = "Sort" | "Genre" | "Players" | "Features" | "Price";

export interface StoreFilter {
  id: string;
  label: string;
  group: FilterGroup;
  /** Steam search parameter and value. Tags and categories combine (AND). */
  param: "filter" | "sort_by" | "tags" | "category2" | "category3" | "deck_compatibility" | "maxprice" | "specials";
  value: string;
}

/** Groups where only one choice can be on at a time. */
export const SINGLE_CHOICE: FilterGroup[] = ["Sort", "Price"];

const tag = (id: string, label: string, value: number): StoreFilter => ({
  id,
  label,
  group: "Genre",
  param: "tags",
  value: String(value),
});
const players = (id: string, label: string, value: number): StoreFilter => ({
  id,
  label,
  group: "Players",
  param: "category2",
  value: String(value),
});

export const STORE_FILTERS: StoreFilter[] = [
  { id: "sort-top", label: "Top Sellers", group: "Sort", param: "filter", value: "topsellers" },
  { id: "sort-popular-new", label: "New & Popular", group: "Sort", param: "filter", value: "popularnew" },
  { id: "sort-newest", label: "Newest", group: "Sort", param: "sort_by", value: "Released_DESC" },
  { id: "sort-soon", label: "Coming Soon", group: "Sort", param: "filter", value: "popularcomingsoon" },

  players("split-coop", "Split-screen Co-op", 39),
  players("split-pvp", "Split-screen Versus", 37),
  players("online-coop", "Online Co-op", 38),
  players("coop", "Any Co-op", 9),
  players("remote-play", "Remote Play Together", 44),
  players("multiplayer", "Multiplayer", 1),
  players("single", "Single-player", 2),

  tag("action", "Action", 19),
  tag("adventure", "Adventure", 21),
  tag("casual", "Casual", 597),
  tag("indie", "Indie", 492),
  tag("family", "Family Friendly", 5350),
  tag("platformer", "Platformer", 1625),
  tag("puzzle", "Puzzle", 1664),
  tag("racing", "Racing", 699),
  tag("sports", "Sports", 701),
  tag("party", "Party Game", 7178),
  tag("rpg", "RPG", 122),
  tag("simulation", "Simulation", 599),
  tag("strategy", "Strategy", 9),
  tag("cozy", "Cozy", 97376),
  tag("relaxing", "Relaxing", 1654),
  tag("cute", "Cute", 4726),
  tag("funny", "Funny", 4136),
  tag("open-world", "Open World", 1695),
  tag("sandbox", "Sandbox", 3810),
  tag("farming", "Farming Sim", 87918),
  tag("story", "Story Rich", 1742),
  tag("metroidvania", "Metroidvania", 1628),
  tag("roguelike", "Roguelike", 1716),
  tag("arcade", "Arcade", 1773),
  tag("retro", "Retro", 4004),
  tag("rhythm", "Rhythm", 1752),
  tag("fighting", "Fighting", 1743),
  tag("shooter", "Shooter", 1774),
  tag("survival", "Survival", 1662),
  tag("horror", "Horror", 1667),
  tag("anime", "Anime", 4085),
  tag("scifi", "Sci-fi", 3942),
  tag("fantasy", "Fantasy", 1684),
  tag("f2p", "Free to Play", 113),

  { id: "controller", label: "Full Controller Support", group: "Features", param: "category3", value: "28" },
  // Steam Deck "Verified" (3) or "Playable" (2). Leaves out games Steam marks
  // "Unsupported" on SteamOS (often anti-cheat) and ones it has not tested.
  { id: "steamos", label: "Runs on SteamOS", group: "Features", param: "deck_compatibility", value: "2,3" },

  { id: "price-free", label: "Free", group: "Price", param: "maxprice", value: "free" },
  { id: "price-10", label: "Under $10", group: "Price", param: "maxprice", value: "10" },
  { id: "price-20", label: "Under $20", group: "Price", param: "maxprice", value: "20" },
  { id: "price-sale", label: "On Sale", group: "Price", param: "specials", value: "1" },
];

export const GROUP_ORDER: FilterGroup[] = ["Sort", "Players", "Genre", "Features", "Price"];
/** Every store list starts with these: couch games that run on this PC. */
export const REQUIRED_FILTERS = ["controller", "steamos"];
export const DEFAULT_FILTERS = ["sort-top", ...REQUIRED_FILTERS];

/** Discover rows: a Steam search (by filter ids) or the most-played chart. */
export interface StoreSectionDef {
  id: string;
  title: string;
  filters?: string[];
  source?: "most-played";
}

const req = REQUIRED_FILTERS;
export const DISCOVER_SECTIONS: StoreSectionDef[] = [
  { id: "trending", title: "Trending Now", source: "most-played" },
  { id: "top", title: "Top Sellers", filters: ["sort-top", ...req] },
  { id: "new", title: "New & Popular", filters: ["sort-popular-new", ...req] },
  { id: "deals", title: "Deals", filters: ["sort-top", "price-sale", ...req] },
  { id: "couch", title: "Couch Co-op", filters: ["sort-top", "split-coop", ...req] },
  { id: "indie", title: "Indie Favorites", filters: ["sort-top", "indie", ...req] },
  { id: "family", title: "Family Friendly", filters: ["sort-top", "family", ...req] },
  { id: "free", title: "Free to Play", filters: ["sort-top", "price-free", ...req] },
  // Unreleased games are not rated for SteamOS yet, so only the controller counts.
  { id: "soon", title: "Coming Soon", filters: ["sort-soon", "controller"] },
];

/**
 * Steam search parameters for a set of filter ids. Unknown ids are ignored.
 * With a search term and no sort filter, Steam sorts by best match.
 */
export function searchParams(ids: string[], term = ""): URLSearchParams {
  const params = new URLSearchParams();
  if (term) params.set("term", term);
  const multi: Record<string, string[]> = {};
  for (const f of STORE_FILTERS) {
    if (!ids.includes(f.id)) continue;
    if (f.param === "tags" || f.param === "category2") (multi[f.param] ??= []).push(f.value);
    else params.set(f.param, f.value);
  }
  for (const [key, values] of Object.entries(multi)) params.set(key, values.join(","));
  if (!term && !params.has("filter") && !params.has("sort_by")) params.set("filter", "topsellers");
  return params;
}
