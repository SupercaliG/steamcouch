// Steam Store data for the dashboard's Store screen. Uses Steam's public,
// key-free endpoints (the same ones the store web pages use):
//   - store search results (JSON)       which games, in which order
//   - IStoreBrowseService/GetItems      names, art, prices, reviews, tags
//   - ISteamChartsService/GetMostPlayed "Trending Now"
// Nothing here needs or sends the user's account. Results are cached in
// memory so moving around the store does not refetch.

import {
  DISCOVER_SECTIONS,
  searchParams,
  type StoreSectionDef,
} from "../../store-filters.ts";
import type { StoreItem, StoreSection } from "../../types.ts";

const SEARCH_URL = "https://store.steampowered.com/search/results/";
const ITEMS_URL = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/";
const MOST_PLAYED_URL = "https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/";
const TAGS_URL = "https://store.steampowered.com/tagdata/populartags/english";
const CDN = "https://shared.akamai.steamstatic.com/store_item_assets/";

const TTL_MS = 30 * 60 * 1000;
const TAGS_TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 12_000;
const ITEMS_PER_CALL = 50;
const SECTION_SIZE = 20;
export const PAGE_SIZE = 50;

interface Cached<T> {
  at: number;
  value: Promise<T>;
}

/** Store region from the system locale (en_US.UTF-8 -> US); US when unknown. */
export function storeCountry(env: NodeJS.ProcessEnv = process.env): string {
  const locale = env.LC_ALL || env.LC_MONETARY || env.LANG || "";
  const m = /^[a-z]{2,3}_([A-Z]{2})/.exec(locale);
  return m?.[1] ?? "US";
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return (await res.json()) as T;
}

// ---------- raw Steam shapes (only the fields we read) ----------

interface RawItem {
  appid?: number;
  success?: number;
  visible?: boolean;
  type?: number;
  name?: string;
  is_free?: boolean;
  basic_info?: { short_description?: string };
  assets?: {
    asset_url_format?: string;
    header?: string;
    library_capsule?: string;
    library_hero?: string;
    page_background?: string;
  };
  best_purchase_option?: {
    formatted_final_price?: string;
    formatted_original_price?: string;
    discount_pct?: number;
  };
  reviews?: { summary_filtered?: { review_count?: number; percent_positive?: number; review_score_label?: string } };
  tagids?: number[];
  release?: { steam_release_date?: number; is_coming_soon?: boolean; is_early_access?: boolean };
  categories?: { controller_categoryids?: number[] };
  platforms?: { steam_deck_compat_category?: number };
}

const FULL_CONTROLLER_CATEGORY = 28;
const STEAMOS_RATING = { 1: "unsupported", 2: "playable", 3: "verified" } as const;
const TYPE_GAME = 0;
/** Most-played games to check, to fill Trending with controller games that run on SteamOS. */
const MOST_PLAYED_CHECKED = 100;

export function createSteamStore(country = storeCountry()) {
  const cache = new Map<string, Cached<unknown>>();
  const items = new Map<number, { at: number; item: StoreItem | null }>();

  function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key) as Cached<T> | undefined;
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const value = load();
    cache.set(key, { at: Date.now(), value });
    // A failed load is not kept, so the next visit tries again.
    value.catch(() => cache.delete(key));
    return value;
  }

  const tagNames = () =>
    cached("tags", TAGS_TTL_MS, async () => {
      const list = await getJson<{ tagid: number; name: string }[]>(TAGS_URL);
      return new Map(list.map((t) => [t.tagid, t.name]));
    });

  function toItem(raw: RawItem, tags: Map<number, string>): StoreItem | null {
    const assets = raw.assets;
    if (!raw.appid || !raw.name || raw.success !== 1 || raw.visible === false || raw.type !== TYPE_GAME) return null;
    if (!assets?.asset_url_format || !assets.header) return null;
    const asset = (file?: string) => (file ? CDN + assets.asset_url_format!.replace("${FILENAME}", file) : undefined);
    const buy = raw.best_purchase_option;
    const review = raw.reviews?.summary_filtered;
    const discount = buy?.discount_pct ?? 0;
    return {
      appId: raw.appid,
      name: raw.name,
      blurb: raw.basic_info?.short_description ?? "",
      art: {
        portrait: asset(assets.library_capsule),
        header: asset(assets.header)!,
        hero: asset(assets.library_hero) ?? asset(assets.page_background),
      },
      price: raw.is_free ? "Free" : buy?.formatted_final_price,
      originalPrice: discount > 0 ? buy?.formatted_original_price : undefined,
      discountPct: discount > 0 ? discount : undefined,
      review:
        review?.review_score_label && review.review_count
          ? { label: review.review_score_label, percent: review.percent_positive ?? 0, count: review.review_count }
          : undefined,
      tags: (raw.tagids ?? []).map((id) => tags.get(id)).filter((t): t is string => Boolean(t)).slice(0, 4),
      releaseDate: raw.release?.steam_release_date,
      comingSoon: Boolean(raw.release?.is_coming_soon),
      earlyAccess: Boolean(raw.release?.is_early_access),
      fullController: Boolean(raw.categories?.controller_categoryids?.includes(FULL_CONTROLLER_CATEGORY)),
      steamos:
        STEAMOS_RATING[raw.platforms?.steam_deck_compat_category as keyof typeof STEAMOS_RATING] ?? "unknown",
    };
  }

  /** Store details for app ids, in the same order. Non-games and hidden apps are dropped. */
  async function details(appIds: number[]): Promise<StoreItem[]> {
    const now = Date.now();
    const missing = [...new Set(appIds)].filter((id) => {
      const hit = items.get(id);
      return !hit || now - hit.at > TTL_MS;
    });
    if (missing.length) {
      const tags = await tagNames().catch(() => new Map<number, string>());
      for (let i = 0; i < missing.length; i += ITEMS_PER_CALL) {
        const batch = missing.slice(i, i + ITEMS_PER_CALL);
        const input = {
          ids: batch.map((appid) => ({ appid })),
          context: { language: "english", country_code: country },
          data_request: {
            include_assets: true,
            include_basic_info: true,
            include_reviews: true,
            include_release: true,
            include_platforms: true,
            include_tag_count: 8,
          },
        };
        const url = `${ITEMS_URL}?input_json=${encodeURIComponent(JSON.stringify(input))}`;
        const data = await getJson<{ response?: { store_items?: RawItem[] } }>(url);
        const got = new Map((data.response?.store_items ?? []).map((raw) => [raw.appid, raw]));
        for (const id of batch) {
          const raw = got.get(id);
          items.set(id, { at: now, item: raw ? toItem(raw, tags) : null });
        }
      }
    }
    return appIds.map((id) => items.get(id)?.item).filter((it): it is StoreItem => Boolean(it));
  }

  /** App ids from a store search, in Steam's order. Bundles and packages are skipped. */
  function search(filterIds: string[], start: number, count: number, term = ""): Promise<number[]> {
    const params = searchParams(filterIds, term);
    params.set("json", "1");
    params.set("cc", country);
    params.set("l", "english");
    params.set("start", String(start));
    params.set("count", String(count));
    params.set("category1", "998"); // games only
    return cached(`search:${params}`, TTL_MS, async () => {
      const data = await getJson<{ items?: { logo?: string }[] }>(`${SEARCH_URL}?${params}`);
      return (data.items ?? [])
        .map((it) => /\/steam\/apps\/(\d+)\//.exec(it.logo ?? "")?.[1])
        .filter((id): id is string => Boolean(id))
        .map(Number);
    });
  }

  function mostPlayed(): Promise<number[]> {
    return cached("most-played", TTL_MS, async () => {
      const data = await getJson<{ response?: { ranks?: { appid: number }[] } }>(MOST_PLAYED_URL);
      return (data.response?.ranks ?? []).map((r) => r.appid);
    });
  }

  async function section(def: StoreSectionDef): Promise<StoreSection> {
    if (def.source === "most-played") {
      // The chart has no filters: keep controller games that run on SteamOS.
      const all = await details((await mostPlayed()).slice(0, MOST_PLAYED_CHECKED));
      const items = all.filter((it) => it.fullController && (it.steamos === "verified" || it.steamos === "playable"));
      return { id: def.id, title: def.title, items: items.slice(0, SECTION_SIZE) };
    }
    const ids = await search(def.filters ?? [], 0, SECTION_SIZE + 5);
    return { id: def.id, title: def.title, items: (await details(ids)).slice(0, SECTION_SIZE) };
  }

  return {
    /** Discover rows. A row that fails to load is left out. */
    async discover(): Promise<StoreSection[]> {
      const results = await Promise.allSettled(DISCOVER_SECTIONS.map(section));
      const sections = results
        .filter((r): r is PromiseFulfilledResult<StoreSection> => r.status === "fulfilled")
        .map((r) => r.value)
        .filter((s) => s.items.length > 0);
      if (!sections.length) {
        const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
        throw failed?.reason ?? new Error("Steam Store returned nothing");
      }
      return sections;
    },

    /**
     * One page of Browse or Search results (`term` = words typed in Search);
     * `next` is the start of the next page, or null at the end.
     */
    async browse(filterIds: string[], start: number, term = ""): Promise<{ items: StoreItem[]; next: number | null }> {
      const ids = await search(filterIds, start, PAGE_SIZE, term);
      return { items: await details(ids), next: ids.length < PAGE_SIZE ? null : start + ids.length };
    },
  };
}

export type SteamStore = ReturnType<typeof createSteamStore>;
