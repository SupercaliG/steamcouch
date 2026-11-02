// Steam Store screen, laid out like the PS5 store: Discover (rows of
// trending, top sellers, deals, couch co-op, ...) and Browse (filters on the
// left, results on the right). A game opens its page in Steam's own
// controller-friendly store, where it can be bought; Home comes back here.

import { clamp, formatClock, h, img } from "../dom";
import type { Action } from "../input";
import { ownedAppIds, storeBrowse, storeDiscover } from "../store";
import {
  DEFAULT_FILTERS,
  GROUP_ORDER,
  SINGLE_CHOICE,
  STORE_FILTERS,
  type StoreFilter,
} from "../store-filters";
import type { StoreItem, StoreSection } from "../types";
import { icons } from "./icons";
import { toast, type Screen } from "./screen";

// Geometry (px on the 1920x1080 canvas).
const ROW_TILE_W = 176;
const ROW_GAP = 20;
const ROW_STEP = 372;
const GRID_COLS = 5;
const LOAD_MORE_ROWS = 2;
const HERO_DELAY_MS = 140;
const FILTER_DELAY_MS = 350;
const VEIL_MS = 3500;

type View = "discover" | "browse";
type PanelEntry = { kind: "group"; label: string } | { kind: "filter"; filter: StoreFilter };

export interface ShopCallbacks {
  onBack(): void;
  /** Show the game's page in Steam's store. */
  onOpenInSteam(item: StoreItem): Promise<void>;
}

export function shopScreen(cb: ShopCallbacks): Screen {
  let view: View = "discover";
  let busy = false;
  const owned = ownedAppIds();

  // Discover state.
  let sections: StoreSection[] = [];
  let row = 0;
  const cols: number[] = [];

  // Browse state.
  let filters = [...DEFAULT_FILTERS];
  let zone: "panel" | "grid" = "panel";
  let panelIndex = 0;
  let results: StoreItem[] = [];
  let gridIndex = 0;
  let next: number | null = 0;
  let loadingMore = false;
  let request = 0;
  let filterTimer: ReturnType<typeof setTimeout> | undefined;

  // ---------- static DOM ----------
  const heroA = h("div.hero-layer");
  const heroB = h("div.hero-layer");
  let heroFront = heroA;
  let heroUrl = "";
  let heroTimer: ReturnType<typeof setTimeout> | undefined;

  const tabEls: Record<View, HTMLElement> = {
    discover: h("div.top-tab", {}, "Discover"),
    browse: h("div.top-tab", {}, "Browse"),
  };
  const brand = h("div.shop-brand", {}, h("span.shop-brand-icon"), "Steam Store");
  (brand.firstChild as HTMLElement).innerHTML = icons.store; // constant SVG markup
  const clockEl = h("div.top-clock", {}, formatClock(new Date()));
  const topbar = h(
    "header.topbar.shop-top",
    {},
    h(
      "nav.shop-nav",
      {},
      brand,
      h("span.lib-hint", {}, "LB"),
      tabEls.discover,
      tabEls.browse,
      h("span.lib-hint", {}, "RB"),
    ),
    h("div.top-right", {}, clockEl),
  );

  // Discover: info about the focused game, then the rows.
  const infoEl = h("div.shop-info");
  const rowsEl = h("div.shop-rows");
  const discoverEl = h("div.shop-discover", {}, infoEl, h("div.shop-rows-wrap", {}, rowsEl));

  // Browse: filter list, results grid.
  const panelList = h("div.shop-panel");
  const gridHead = h("div.shop-grid-head");
  const grid = h("div.shop-grid");
  const gridStatus = h("div.shop-grid-status");
  const browseEl = h(
    "div.shop-browse",
    {},
    h("div.shop-panel-wrap", {}, panelList),
    gridHead,
    h("div.shop-grid-wrap", {}, grid, gridStatus),
  );

  const statusEl = h("div.shop-status");
  const el = h(
    "section.screen.shop",
    {},
    heroA,
    heroB,
    h("div.hero-shade.shop-shade"),
    topbar,
    discoverEl,
    browseEl,
    statusEl,
  );
  const clockTimer = setInterval(() => (clockEl.textContent = formatClock(new Date())), 10_000);

  // ---------- shared ----------
  function focusedItem(): StoreItem | undefined {
    if (view === "discover") return sections[row]?.items[cols[row] ?? 0];
    return zone === "grid" ? results[gridIndex] : results[0];
  }

  /** Background art of the focused game, cross-faded after a short pause. */
  function setHero(item?: StoreItem) {
    const url = item?.art.hero ?? item?.art.header ?? "";
    if (url === heroUrl) return;
    heroUrl = url;
    clearTimeout(heroTimer);
    heroTimer = setTimeout(() => {
      const back = heroFront === heroA ? heroB : heroA;
      back.replaceChildren();
      if (url) back.append(img(url, item?.art.hero ? "hero-img" : "hero-img shop-hero-soft"));
      back.classList.add("front");
      heroFront.classList.remove("front");
      heroFront = back;
    }, HERO_DELAY_MS);
  }

  function setStatus(text: string, spinner = false) {
    statusEl.replaceChildren(...(text ? [...(spinner ? [h("div.spinner")] : []), h("span", {}, text)] : []));
    statusEl.classList.toggle("show", Boolean(text));
  }

  function paintTabs() {
    tabEls.discover.classList.toggle("active", view === "discover");
    tabEls.browse.classList.toggle("active", view === "browse");
    discoverEl.classList.toggle("hidden", view !== "discover");
    browseEl.classList.toggle("hidden", view !== "browse");
  }

  function setView(target: View) {
    if (target === view) return;
    view = target;
    paintTabs();
    if (view === "browse" && results.length === 0 && next !== null) void loadResults(true);
    if (view === "discover") paintDiscover();
    else paintBrowse();
  }

  // ---------- Discover ----------
  function buildDiscover() {
    rowsEl.replaceChildren(
      ...sections.map((s, i) => {
        cols[i] ??= 0;
        return h(
          "div.shop-row",
          {},
          h("div.shop-row-title", {}, s.title),
          h("div.shop-row-track", {}, h("div.shop-row-tiles", {}, ...s.items.map((it) => storeTile(it, owned)))),
        );
      }),
    );
  }

  function paintDiscover() {
    rowsEl.style.transform = `translateY(${-row * ROW_STEP}px)`;
    [...rowsEl.children].forEach((rowEl, r) => {
      rowEl.classList.toggle("current", r === row);
      const tiles = rowEl.querySelector(".shop-row-tiles") as HTMLElement;
      const col = cols[r] ?? 0;
      tiles.style.transform = `translateX(${-Math.max(0, col - 1) * (ROW_TILE_W + ROW_GAP)}px)`;
      [...tiles.children].forEach((t, c) => t.classList.toggle("focused", r === row && c === col));
    });
    const item = focusedItem();
    renderInfo(item);
    setHero(item);
  }

  function renderInfo(item?: StoreItem) {
    if (!item) return infoEl.replaceChildren();
    infoEl.replaceChildren(
      h("h1.shop-name", {}, item.name),
      metaLine(item, owned.has(item.appId)),
      ...(item.tags.length ? [h("div.shop-tags", {}, item.tags.join("  ·  "))] : []),
      h("p.shop-blurb", {}, item.blurb),
    );
  }

  async function loadDiscover() {
    setStatus("Loading the Steam Store", true);
    try {
      sections = await storeDiscover();
      setStatus("");
      buildDiscover();
      paintDiscover();
    } catch (err) {
      console.error(err);
      setStatus("Can't reach the Steam Store. Check the network, then press A to try again.");
    }
  }

  // ---------- Browse ----------
  const panelEntries: PanelEntry[] = GROUP_ORDER.flatMap((group): PanelEntry[] => [
    { kind: "group", label: group === "Genre" ? "Genres" : group },
    ...STORE_FILTERS.filter((f) => f.group === group).map((filter): PanelEntry => ({ kind: "filter", filter })),
  ]);
  const filterEntries = panelEntries.filter((e): e is Extract<PanelEntry, { kind: "filter" }> => e.kind === "filter");
  const panelEls = new Map<string, HTMLElement>();

  function buildPanel() {
    panelList.replaceChildren(
      ...panelEntries.map((e) => {
        if (e.kind === "group") return h("div.shop-group", {}, e.label);
        const check = h("span.shop-check");
        check.innerHTML = icons.check; // constant SVG markup
        const rowEl = h("div.shop-filter", {}, check, h("span", {}, e.filter.label));
        panelEls.set(e.filter.id, rowEl);
        return rowEl;
      }),
    );
  }

  function paintBrowse() {
    filterEntries.forEach((e, i) => {
      const rowEl = panelEls.get(e.filter.id)!;
      rowEl.classList.toggle("on", filters.includes(e.filter.id));
      rowEl.classList.toggle("focused", zone === "panel" && i === panelIndex);
    });
    // Keep the focused filter in view.
    const focusedRow = panelEls.get(filterEntries[panelIndex]!.filter.id)!;
    panelList.style.transform = `translateY(${-Math.max(0, focusedRow.offsetTop - 220)}px)`;

    [...grid.children].forEach((c, i) => c.classList.toggle("focused", zone === "grid" && i === gridIndex));
    const focused = grid.children[gridIndex] as HTMLElement | undefined;
    const rowStep = grid.children[GRID_COLS] ? (grid.children[GRID_COLS] as HTMLElement).offsetTop : 0;
    const top = zone === "grid" && focused ? focused.offsetTop : 0;
    grid.style.transform = `translateY(${-Math.max(0, top - rowStep)}px)`;

    const labels = STORE_FILTERS.filter((f) => filters.includes(f.id)).map((f) => f.label);
    gridHead.replaceChildren(
      h("span.shop-grid-filters", {}, labels.join("  ·  ")),
      h("span.shop-grid-hint", {}, h("span.lib-hint", {}, "Y"), " Reset filters"),
    );
    setHero(zone === "grid" ? results[gridIndex] : undefined);
  }

  async function loadResults(reset: boolean) {
    const id = ++request;
    if (reset) {
      results = [];
      gridIndex = 0;
      next = 0;
      grid.replaceChildren();
      gridStatus.replaceChildren(h("div.spinner"), h("span", {}, "Loading"));
    }
    if (next === null) return;
    loadingMore = true;
    try {
      const page = await storeBrowse(filters, next);
      if (id !== request) return; // filters changed while loading
      const seen = new Set(results.map((r) => r.appId));
      const fresh = page.items.filter((it) => !seen.has(it.appId));
      results.push(...fresh);
      next = page.next;
      grid.append(
        ...fresh.map((it) =>
          h(
            "div.shop-item",
            {},
            storeTile(it, owned),
            h("div.shop-item-name", {}, it.name),
          ),
        ),
      );
      gridStatus.replaceChildren(results.length ? "" : "No games match these filters");
    } catch (err) {
      console.error(err);
      if (id === request) gridStatus.replaceChildren("Can't reach the Steam Store right now");
    } finally {
      if (id === request) loadingMore = false;
    }
    if (zone === "grid" && results.length === 0) zone = "panel";
    paintBrowse();
  }

  function toggleFilter(f: StoreFilter) {
    const on = filters.includes(f.id);
    if (SINGLE_CHOICE.includes(f.group)) {
      // Sort always keeps one choice; Price can be turned off.
      if (on && f.group === "Sort") return;
      filters = filters.filter((id) => STORE_FILTERS.find((x) => x.id === id)?.group !== f.group);
      if (!on) filters.push(f.id);
    } else {
      filters = on ? filters.filter((id) => id !== f.id) : [...filters, f.id];
    }
    paintBrowse();
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => void loadResults(true), FILTER_DELAY_MS);
  }

  function maybeLoadMore() {
    const rows = Math.ceil(results.length / GRID_COLS);
    if (!loadingMore && next !== null && Math.floor(gridIndex / GRID_COLS) >= rows - LOAD_MORE_ROWS) {
      void loadResults(false);
    }
  }

  // ---------- opening a game ----------
  async function open(item: StoreItem) {
    if (busy) return;
    busy = true;
    const veil = h(
      "div.launch-veil",
      {},
      img(item.art.hero ?? item.art.header, "launch-art"),
      h(
        "div.shop-veil-text",
        {},
        h("div.launch-text", {}, h("div.spinner"), `Opening ${item.name} in Steam`),
        h("div.shop-veil-hint", {}, "Press the Home button to come back to the store"),
      ),
    );
    el.append(veil);
    requestAnimationFrame(() => veil.classList.add("show"));
    try {
      await cb.onOpenInSteam(item);
      await new Promise((r) => setTimeout(r, VEIL_MS));
    } catch (err) {
      console.error(err);
      toast("Could not open the Steam Store");
    } finally {
      veil.classList.remove("show");
      setTimeout(() => veil.remove(), 500);
      busy = false;
    }
  }

  // ---------- input ----------
  function handle(action: Action) {
    if (busy) return;
    if (action === "tabPrev") return setView("discover");
    if (action === "tabNext") return setView("browse");

    if (view === "discover") {
      if (!sections.length) {
        if (action === "back") cb.onBack();
        else if (action === "accept") void loadDiscover();
        return;
      }
      const items = sections[row]!.items;
      if (action === "back") return cb.onBack();
      if (action === "left") cols[row] = clamp((cols[row] ?? 0) - 1, 0, items.length - 1);
      else if (action === "right") cols[row] = clamp((cols[row] ?? 0) + 1, 0, items.length - 1);
      else if (action === "up") row = clamp(row - 1, 0, sections.length - 1);
      else if (action === "down") row = clamp(row + 1, 0, sections.length - 1);
      else if (action === "accept") {
        const item = focusedItem();
        if (item) void open(item);
        return;
      } else return;
      paintDiscover();
      return;
    }

    if (action === "options") {
      filters = [...DEFAULT_FILTERS];
      toast("Filters reset");
      paintBrowse();
      void loadResults(true);
      return;
    }
    if (zone === "panel") {
      if (action === "back") return cb.onBack();
      if (action === "up") panelIndex = clamp(panelIndex - 1, 0, filterEntries.length - 1);
      else if (action === "down") panelIndex = clamp(panelIndex + 1, 0, filterEntries.length - 1);
      else if (action === "accept") return toggleFilter(filterEntries[panelIndex]!.filter);
      else if (action === "right" && results.length) zone = "grid";
      else return;
    } else {
      const col = gridIndex % GRID_COLS;
      if (action === "back" || (action === "left" && col === 0)) zone = "panel";
      else if (action === "left") gridIndex -= 1;
      else if (action === "right") gridIndex = clamp(gridIndex + 1, 0, results.length - 1);
      else if (action === "up") gridIndex = gridIndex >= GRID_COLS ? gridIndex - GRID_COLS : gridIndex;
      else if (action === "down") gridIndex = clamp(gridIndex + GRID_COLS, 0, results.length - 1);
      else if (action === "accept") {
        const item = results[gridIndex];
        if (item) void open(item);
        return;
      } else return;
      maybeLoadMore();
    }
    paintBrowse();
  }

  buildPanel();
  paintTabs();
  void loadDiscover();

  return {
    el,
    handle,
    destroy() {
      clearInterval(clockTimer);
      clearTimeout(heroTimer);
      clearTimeout(filterTimer);
      request++;
    },
  };
}

// ---------- small builders ----------

/** Portrait capsule with the price under it. Games without one show their header art. */
function storeTile(item: StoreItem, owned: Set<number>): HTMLElement {
  const art = h("div.shop-tile");
  const fallback = () => {
    art.replaceChildren(
      img(item.art.header, "shop-tile-blur"),
      img(item.art.header, "shop-tile-header"),
    );
    addBadges();
  };
  const addBadges = () => {
    if (item.discountPct) art.append(h("div.shop-discount", {}, `-${item.discountPct}%`));
  };
  if (item.art.portrait) art.append(img(item.art.portrait, "shop-tile-img", fallback));
  else fallback();
  if (item.art.portrait) addBadges();
  return h("div.shop-card", {}, art, priceLine(item, owned.has(item.appId)));
}

function priceLine(item: StoreItem, isOwned: boolean): HTMLElement {
  if (isOwned) return h("div.shop-price.owned", {}, "In Library");
  if (item.comingSoon) return h("div.shop-price.dim", {}, "Coming Soon");
  if (item.originalPrice) {
    return h("div.shop-price", {}, h("s.shop-was", {}, item.originalPrice), item.price ?? "");
  }
  return h("div.shop-price", {}, item.price ?? "");
}

function metaLine(item: StoreItem, isOwned: boolean): HTMLElement {
  const chips: (HTMLElement | null)[] = [];
  if (isOwned) chips.push(h("span.shop-chip.owned", {}, "In Library"));
  if (item.discountPct) chips.push(h("span.shop-discount.inline", {}, `-${item.discountPct}%`));
  if (item.originalPrice) chips.push(h("s.shop-was", {}, item.originalPrice));
  if (item.price) chips.push(h("span.shop-meta-price", {}, item.price));
  if (item.comingSoon) {
    const when = item.releaseDate ? ` · ${formatDate(item.releaseDate)}` : "";
    chips.push(h("span.shop-chip", {}, `Coming Soon${when}`));
  } else if (item.earlyAccess) chips.push(h("span.shop-chip", {}, "Early Access"));
  if (item.review) {
    chips.push(
      h(
        `span.shop-review.${item.review.percent >= 70 ? "good" : item.review.percent >= 40 ? "mixed" : "bad"}`,
        {},
        item.review.label,
      ),
    );
  }
  if (item.fullController) chips.push(h("span.shop-chip", {}, "Full Controller Support"));
  if (item.steamos === "verified") chips.push(h("span.shop-chip", {}, "SteamOS Verified"));
  else if (item.steamos === "playable") chips.push(h("span.shop-chip", {}, "SteamOS Playable"));
  else if (item.steamos === "unsupported") chips.push(h("span.shop-chip.warn", {}, "Not supported on SteamOS"));
  return h("div.shop-meta", {}, ...chips);
}

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
