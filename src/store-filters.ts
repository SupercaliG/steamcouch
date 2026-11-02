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
  { id: "deck", label: "Steam Deck Verified", group: "Features", param: "deck_compatibility", value: "3" },

  { id: "price-free", label: "Free", group: "Price", param: "maxprice", value: "free" },
  { id: "price-10", label: "Under $10", group: "Price", param: "maxprice", value: "10" },
  { id: "price-20", label: "Under $20", group: "Price", param: "maxprice", value: "20" },
  { id: "price-sale", label: "On Sale", group: "Price", param: "specials", value: "1" },
];

export const GROUP_ORDER: FilterGroup[] = ["Sort", "Players", "Genre", "Features", "Price"];
export const DEFAULT_FILTERS = ["sort-top"];

/** Discover rows: a Steam search (by filter ids) or the most-played chart. */
export interface StoreSectionDef {
  id: string;
  title: string;
  filters?: string[];
  source?: "most-played";
}

export const DISCOVER_SECTIONS: StoreSectionDef[] = [
  { id: "trending", title: "Trending Now", source: "most-played" },
  { id: "top", title: "Top Sellers", filters: ["sort-top"] },
  { id: "new", title: "New & Popular", filters: ["sort-popular-new"] },
  { id: "deals", title: "Deals", filters: ["sort-top", "price-sale"] },
  { id: "couch", title: "Couch Co-op", filters: ["sort-top", "split-coop"] },
  { id: "indie", title: "Indie Favorites", filters: ["sort-top", "indie"] },
  { id: "family", title: "Family Friendly", filters: ["sort-top", "family"] },
  { id: "free", title: "Free to Play", filters: ["sort-top", "price-free"] },
  { id: "soon", title: "Coming Soon", filters: ["sort-soon"] },
];

/** Steam search parameters for a set of filter ids. Unknown ids are ignored. */
export function searchParams(ids: string[]): URLSearchParams {
  const params = new URLSearchParams();
  const multi: Record<string, string[]> = {};
  for (const f of STORE_FILTERS) {
    if (!ids.includes(f.id)) continue;
    if (f.param === "tags" || f.param === "category2") (multi[f.param] ??= []).push(f.value);
    else params.set(f.param, f.value);
  }
  for (const [key, values] of Object.entries(multi)) params.set(key, values.join(","));
  if (!params.has("filter") && !params.has("sort_by")) params.set("filter", "topsellers");
  return params;
}
