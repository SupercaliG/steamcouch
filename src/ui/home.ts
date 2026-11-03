import {
  clamp,
  formatClock,
  formatLastPlayed,
  formatPlaytime,
  h,
  img,
} from "../dom";
import type { Action } from "../input";
import {
  getProfile,
  isFavorite,
  markPlayed,
  power,
  restrictedProfiles,
  setAllowed,
  titlesForTab,
  toggleFavorite,
  visibleTitles,
} from "../store";
import type { Profile, Tab, Title } from "../types";
import { icons } from "./icons";
import { avatar, overlayHost, toast, type Screen } from "./screen";
import { settingsOverlay } from "./settings";

// Tile row geometry (px on the 1920x1080 canvas), measured from PS5 captures.
const TILE = 106;
const BIG = 172;
const GAP = 10;
const ANCHOR_X = 170;
const LABEL_GAP = 16;

type RowItem = { type: "title"; title: Title } | { type: "library" } | { type: "store" };
type Zone = "top" | "row" | "actions" | "cards";
const TOP_ITEMS = ["games", "media", "search", "settings", "profile"] as const;
const LOWER_CARDS = 3;

export interface HomeCallbacks {
  onSwitchProfile(): void;
  onLaunch(title: Title): Promise<void>;
  /** Steam Store screen (unrestricted profiles only). */
  onOpenStore(): void;
}

export function homeScreen(initialProfile: Profile, cb: HomeCallbacks): Screen {
  let profile = initialProfile;
  let tab: Tab = "games";
  let zone: Zone = "row";
  let topIndex = 0;
  let actionIndex = 0;
  let cardIndex = 0;
  // Grown-ups get the Steam Store as the first tile, like the PS5's store
  // tile; focus starts on the most recent game next to it.
  const hasStore = (t: Tab) => t === "games" && !profile.restricted;
  const firstTitle = (t: Tab) => (hasStore(t) ? 1 : 0);
  const rowIndex: Record<Tab, number> = { games: firstTitle("games"), media: 0 };
  let items: RowItem[] = [];
  let busy = false;
  /** Title being started: its tile shows a loader until the game window is up. */
  let startingId: string | null = null;

  // ---------- static DOM ----------
  const heroA = h("div.hero-layer");
  const heroB = h("div.hero-layer");
  let heroFront = heroA;

  const tabEls = {
    games: h("div.top-tab", {}, "Games"),
    media: h("div.top-tab", {}, "Media"),
  };
  const searchEl = h("div.top-icon");
  searchEl.innerHTML = icons.search;
  const settingsEl = h("div.top-icon");
  settingsEl.innerHTML = icons.settings;
  const avatarEl = h("div.top-avatar", {}, avatar(profile, "top-avatar-img"), h("span.online-dot"));
  const clockEl = h("div.top-clock", {}, formatClock(new Date()));
  const topEls = [tabEls.games, tabEls.media, searchEl, settingsEl, avatarEl];

  const rowEl = h("div.tile-row");
  const labelEl = h("div.tile-label");

  const logoSlot = h("div.hub-logo");
  const taglineEl = h("p.hub-tagline");
  const playBtn = h("div.hub-play", {}, "Play");
  const moreBtn = h("div.hub-more", {}, h("span"), h("span"), h("span"));
  const sideCards = h("div.side-cards");
  const lowerCards = h("div.lower-cards");

  const scrollEl = h(
    "div.home-scroll",
    {},
    h(
      "header.topbar",
      {},
      h("nav.top-tabs", {}, tabEls.games, tabEls.media),
      h("div.top-right", {}, searchEl, settingsEl, avatarEl, clockEl),
    ),
    h("div.tile-row-wrap", {}, rowEl, labelEl),
    h(
      "div.hub",
      {},
      h("div.hub-left", {}, logoSlot, taglineEl, h("div.hub-actions", {}, playBtn, moreBtn)),
      sideCards,
    ),
    lowerCards,
  );

  const el = h("section.screen.home", {}, heroA, heroB, h("div.hero-shade"), scrollEl);
  const overlays = overlayHost(el);
  const clockTimer = setInterval(() => (clockEl.textContent = formatClock(new Date())), 10_000);

  // ---------- data ----------
  const focusedItem = (): RowItem | undefined => items[rowIndex[tab]];
  const focusedTitle = (): Title | undefined => {
    const item = focusedItem();
    return item?.type === "title" ? item.title : undefined;
  };

  function loadItems() {
    items = [
      ...(hasStore(tab) ? [{ type: "store" } as RowItem] : []),
      ...titlesForTab(profile, tab).map((title): RowItem => ({ type: "title", title })),
      { type: "library" },
    ];
    rowIndex[tab] = clamp(rowIndex[tab], 0, items.length - 1);
  }

  // ---------- rendering ----------
  function buildRow() {
    rowEl.replaceChildren(
      ...items.map((item) => {
        if (item.type === "library" || item.type === "store") {
          const tile = h(`div.tile.tile-icon${item.type === "store" ? ".tile-store" : ""}`);
          tile.innerHTML = item.type === "store" ? icons.store : tab === "games" ? icons.library : icons.apps;
          return tile;
        }
        return titleTile(item.title, isFavorite(profile, item.title.id), item.title.id === startingId);
      }),
    );
  }

  function layoutRow() {
    const focus = rowIndex[tab];
    let x = 0;
    let focusX = 0;
    [...rowEl.children].forEach((child, i) => {
      const tile = child as HTMLElement;
      const big = i === focus;
      if (big) focusX = x;
      tile.style.left = `${x}px`;
      tile.style.width = tile.style.height = `${big ? BIG : TILE}px`;
      tile.classList.toggle("big", big);
      tile.classList.toggle("focused", big && zone === "row");
      x += (big ? BIG : TILE) + GAP;
    });
    rowEl.style.transform = `translateX(${ANCHOR_X - focusX}px)`;

    const item = focusedItem();
    labelEl.textContent =
      item?.type === "store"
        ? "Steam Store"
        : item?.type === "library"
          ? tab === "games" ? "Game Library" : "All Apps"
          : item?.title.name ?? "";
    labelEl.style.left = `${ANCHOR_X + BIG + LABEL_GAP}px`;
  }

  // Warm the image cache for the neighbours, so moving along the row shows
  // their background art at once.
  const preloaded = new Set<string>();
  function preloadAround() {
    const i = rowIndex[tab];
    for (const k of [i - 1, i + 1, i + 2]) {
      const item = items[k];
      if (item?.type !== "title") continue;
      for (const url of [item.title.art.hero, item.title.art.logo]) {
        if (!url || preloaded.has(url)) continue;
        preloaded.add(url);
        const im = new Image();
        im.decoding = "async";
        im.src = url;
      }
    }
  }

  function renderHub() {
    preloadAround();
    const title = focusedTitle();
    const item = focusedItem();

    // Background art, cross-faded between two layers.
    const back = heroFront === heroA ? heroB : heroA;
    back.replaceChildren();
    back.style.background = "";
    if (title?.art.hero) {
      back.append(img(title.art.hero, "hero-img", () => setGradientHero(back, title)));
    } else if (title) {
      setGradientHero(back, title);
    } else {
      back.style.background = "radial-gradient(120% 90% at 70% 30%, #1d2a5c 0%, #0b1024 55%, #05070f 100%)";
    }
    back.classList.add("front");
    heroFront.classList.remove("front");
    heroFront = back;

    // Bottom-left: logo (or big text), tagline, Play.
    logoSlot.replaceChildren();
    if (item?.type === "library") {
      logoSlot.append(h("h2.hub-title", {}, tab === "games" ? "Game Library" : "All Apps"));
      taglineEl.textContent =
        tab === "games" ? "Every game you can play, in one place." : "Every app on this system.";
      playBtn.textContent = "Open";
    } else if (item?.type === "store") {
      logoSlot.append(h("h2.hub-title", {}, "Steam Store"));
      taglineEl.textContent = "Trending games, top sellers, deals, couch co-op and more.";
      playBtn.textContent = "Open";
    } else if (title) {
      const textTitle = () => logoSlot.replaceChildren(h("h2.hub-title", {}, title.name));
      if (title.art.logo) logoSlot.append(img(title.art.logo, "hub-logo-img", textTitle));
      else textTitle();
      taglineEl.textContent = title.tagline;
      if (title.id === startingId) {
        playBtn.replaceChildren(h("div.spinner.hub-spinner"), "Starting");
      } else {
        playBtn.textContent = title.kind === "app" ? "Open" : title.installed ? "Play" : "Install";
      }
    }
    moreBtn.style.visibility = title ? "visible" : "hidden";

    renderSideCards(title);
    renderLowerCards(title);
  }

  function renderSideCards(title?: Title) {
    sideCards.replaceChildren();
    if (!title) return;
    const favs = visibleTitles(profile).filter((t) => isFavorite(profile, t.id) && t.kind === title.kind);
    sideCards.append(
      h(
        "div.side-card",
        {},
        h("div.side-card-title", {}, "Favorites"),
        favs.length
          ? h("div.fav-thumbs", {}, ...favs.slice(0, 4).map((t) => titleThumb(t)))
          : h("div.side-card-empty", {}, "Press Y or ••• to add favorites"),
      ),
    );
    if (title.kind === "game") {
      sideCards.append(
        h(
          "div.side-card.stats",
          {},
          stat("Played", formatPlaytime(title.playtimeMinutes)),
          stat("Last played", formatLastPlayed(title.lastPlayed)),
        ),
      );
    }
  }

  function renderLowerCards(title?: Title) {
    const visible = visibleTitles(profile);
    const count = visible.filter((t) => t.kind === (tab === "games" ? "game" : "app")).length;
    lowerCards.replaceChildren(
      h(
        "div.lower-card",
        {},
        h("div.lower-card-kicker", {}, "About"),
        h("div.lower-card-title", {}, title?.name ?? (tab === "games" ? "Game Library" : "All Apps")),
        h("div.lower-card-body", {}, title ? `${title.source} · ${formatLastPlayed(title.lastPlayed)}` : ""),
      ),
      h(
        "div.lower-card",
        {},
        h("div.lower-card-kicker", {}, tab === "games" ? "Game Library" : "All Apps"),
        h("div.lower-card-title", {}, `${count} ${tab === "games" ? "games" : "apps"}`),
        h("div.lower-card-body", {}, "Open the full library"),
      ),
      h(
        "div.lower-card.profile-card-small",
        {},
        h("div.lower-card-kicker", {}, "Profile"),
        h("div.lower-avatar", {}, avatar(profile, "lower-avatar-img"), h("span", {}, profile.name)),
        h("div.lower-card-body", {}, "Switch profile"),
      ),
    );
    paintFocus();
  }

  function paintFocus() {
    Object.entries(tabEls).forEach(([key, tabEl]) => tabEl.classList.toggle("active", key === tab));
    topEls.forEach((t, i) => t.classList.toggle("focused", zone === "top" && i === topIndex));
    playBtn.classList.toggle("focused", zone === "actions" && actionIndex === 0);
    moreBtn.classList.toggle("focused", zone === "actions" && actionIndex === 1);
    [...lowerCards.children].forEach((c, i) =>
      c.classList.toggle("focused", zone === "cards" && i === cardIndex),
    );
    el.classList.toggle("scrolled", zone === "cards");
    [...rowEl.children].forEach((c, i) =>
      c.classList.toggle("focused", zone === "row" && i === rowIndex[tab]),
    );
  }

  function fullRender() {
    loadItems();
    buildRow();
    layoutRow();
    renderHub();
    paintFocus();
  }

  function setTab(next: Tab) {
    if (next === tab) return;
    tab = next;
    fullRender();
  }

  // ---------- actions ----------
  async function launch(title: Title) {
    if (busy) return;
    busy = true;
    // Most recent first: the game moves to the front of the row, focused,
    // with a loader on its tile while it starts.
    markPlayed(title.id);
    rowIndex[tab] = firstTitle(tab);
    startingId = title.id;
    fullRender();
    try {
      await cb.onLaunch(title);
    } finally {
      startingId = null;
      busy = false;
      fullRender();
    }
  }

  function toggleFav(title: Title) {
    const wasFav = isFavorite(profile, title.id);
    profile = toggleFavorite(profile, title.id);
    toast(wasFav ? `Removed ${title.name} from Favorites` : `Added ${title.name} to Favorites`);
    buildRow();
    layoutRow();
    renderSideCards(focusedTitle());
    paintFocus();
  }

  function activateRowItem() {
    const item = focusedItem();
    if (!item) return;
    if (item.type === "library") openLibrary();
    else if (item.type === "store") cb.onOpenStore();
    else void launch(item.title);
  }

  /**
   * The "..." menu of a title. For grown-ups it has a checkbox per kid
   * profile: checked means the title is on that kid's dashboard. A press
   * flips it and the menu stays open, so the change is visible right away.
   * `inLibrary` leaves out the menu entries that make no sense there.
   */
  function openOptions(title: Title, opts: { inLibrary?: boolean; onChange?: () => void } = {}) {
    type Option = { label: string; checked?: () => boolean; run: () => void; keepOpen?: boolean };
    const options: Option[] = [
      {
        label: isFavorite(profile, title.id) ? "Remove from Favorites" : "Add to Favorites",
        run: () => {
          toggleFav(title);
          opts.onChange?.();
        },
      },
      ...(profile.restricted
        ? []
        : restrictedProfiles().map(
            (kid): Option => ({
              label: `On ${possessive(kid.name)} dashboard`,
              checked: () => getProfile(kid.id).allow.includes(title.id),
              keepOpen: true,
              run: () => {
                const allowed = getProfile(kid.id).allow.includes(title.id);
                setAllowed(kid.id, title.id, !allowed);
                toast(allowed ? `${title.name} removed from ${kid.name}` : `${title.name} added for ${kid.name}`);
                opts.onChange?.();
              },
            }),
          )),
      ...(opts.inLibrary
        ? []
        : [
            { label: tab === "games" ? "Game Library" : "All Apps", run: openLibrary },
            { label: "Switch Profile", run: cb.onSwitchProfile },
          ]),
    ];
    let i = 0;
    const rows = options.map((o) => {
      if (!o.checked) return h("div.menu-item", {}, o.label);
      const box = h("span.menu-check");
      box.innerHTML = icons.check; // constant SVG markup
      return h("div.menu-item.menu-toggle", {}, box, h("span", {}, o.label));
    });
    const menu = h("div.menu", {}, h("div.menu-title", {}, title.name), ...rows);
    const paint = () =>
      rows.forEach((r, k) => {
        r.classList.toggle("focused", k === i);
        r.classList.toggle("on", Boolean(options[k]!.checked?.()));
      });
    paint();
    overlays.open({
      el: h("div.overlay.menu-overlay", {}, menu),
      handle(action) {
        if (action === "up") i = clamp(i - 1, 0, options.length - 1);
        else if (action === "down") i = clamp(i + 1, 0, options.length - 1);
        else if (action === "accept") {
          const option = options[i]!;
          if (!option.keepOpen) overlays.close();
          option.run();
          if (!option.keepOpen) return;
        } else if (action === "back" || action === "options") return overlays.close();
        paint();
      },
    });
  }

  function openLibrary() {
    const kind = tab === "games" ? "game" : "app";
    const filters = kind === "game" ? ["All", "Installed", "Favorites", "Non-Steam"] : ["All", "Favorites"];
    let filter = 0;
    let index = 0;
    const COLS = 7;
    let list: Title[] = [];
    const filterEls = filters.map((f) => h("div.lib-filter", {}, f));
    const grid = h("div.lib-grid");
    const gridWrap = h("div.lib-grid-wrap", {}, grid);

    const refresh = () => {
      const all = visibleTitles(profile)
        .filter((t) => t.kind === kind)
        .sort((a, b) => a.name.localeCompare(b.name));
      const name = filters[filter];
      list =
        name === "Favorites"
          ? all.filter((t) => isFavorite(profile, t.id))
          : name === "Installed"
            ? all.filter((t) => t.installed)
            : name === "Non-Steam"
              ? all.filter((t) => t.source !== "Steam")
              : all;
      index = clamp(index, 0, Math.max(0, list.length - 1));
      grid.replaceChildren(
        ...(list.length
          ? list.map((t) =>
              h("div.lib-item", {}, titleTile(t, isFavorite(profile, t.id)), h("div.lib-name", {}, t.name)),
            )
          : [h("div.lib-empty", {}, "Nothing here yet")]),
      );
      paint();
    };
    const paint = () => {
      filterEls.forEach((f, k) => f.classList.toggle("active", k === filter));
      [...grid.children].forEach((c, k) => c.classList.toggle("focused", k === index));
      // Keep the focused row second from the top once the grid scrolls.
      const focused = grid.children[index] as HTMLElement | undefined;
      const rowStep = focused && grid.children[COLS] ? (grid.children[COLS] as HTMLElement).offsetTop : 0;
      const top = focused ? focused.offsetTop : 0;
      grid.style.transform = `translateY(${-Math.max(0, top - rowStep)}px)`;
    };

    overlays.open({
      el: h(
        "div.overlay.library",
        {},
        h(
          "div.lib-header",
          {},
          h("h1.lib-title", {}, kind === "game" ? "Game Library" : "All Apps"),
          h("div.lib-filters", {}, h("span.lib-hint", {}, "LB"), ...filterEls, h("span.lib-hint", {}, "RB")),
        ),
        gridWrap,
      ),
      handle(action) {
        if (action === "back") return overlays.close();
        if (action === "tabPrev") filter = (filter - 1 + filters.length) % filters.length;
        else if (action === "tabNext") filter = (filter + 1) % filters.length;
        else if (action === "left") index = clamp(index - 1, 0, list.length - 1);
        else if (action === "right") index = clamp(index + 1, 0, list.length - 1);
        else if (action === "up") index = index - COLS >= 0 ? index - COLS : index;
        else if (action === "down") index = clamp(index + COLS, 0, list.length - 1);
        else if (action === "accept" && list[index]) {
          const t = list[index]!;
          overlays.close();
          void launch(t);
          return;
        } else if (action === "options" && list[index]) {
          openOptions(list[index]!, { inLibrary: true, onChange: refresh });
          return;
        } else return;
        if (action === "tabPrev" || action === "tabNext") refresh();
        else paint();
      },
    });
    refresh();
  }

  /** Avatar menu: switch profile and power. Kids cannot leave to Steam. */
  function openProfileMenu() {
    const options: { label: string; run: () => void }[] = [
      { label: "Switch Profile", run: cb.onSwitchProfile },
      ...(profile.restricted
        ? []
        : [
            { label: "Show Steam", run: () => void power("steam-window") },
            { label: "Steam Gaming Mode", run: () => void power("steam") },
          ]),
      { label: "Restart", run: () => void power("restart") },
      { label: "Turn Off", run: () => void power("shutdown") },
    ];
    let i = 0;
    const rows = options.map((o) => h("div.menu-item", {}, o.label));
    const paint = () => rows.forEach((r, k) => r.classList.toggle("focused", k === i));
    paint();
    overlays.open({
      el: h("div.overlay.menu-overlay", {}, h("div.menu.menu-top", {}, h("div.menu-title", {}, profile.name), ...rows)),
      handle(action) {
        if (action === "up") i = clamp(i - 1, 0, options.length - 1);
        else if (action === "down") i = clamp(i + 1, 0, options.length - 1);
        else if (action === "accept") {
          overlays.close();
          options[i]!.run();
          return;
        } else if (action === "back") return overlays.close();
        paint();
      },
    });
  }

  function openSettings() {
    if (profile.restricted) return toast("Settings are for grown-ups");
    overlays.open(
      settingsOverlay(overlays, () => {
        profile = getProfile(profile.id);
        fullRender();
      }),
    );
  }

  // ---------- input ----------
  function handle(action: Action) {
    if (busy) return;
    if (overlays.active) return overlays.active.handle(action);

    if (action === "tabPrev") return setTab("games");
    if (action === "tabNext") return setTab("media");

    const title = focusedTitle();
    if (action === "options" && title) return openOptions(title);

    switch (zone) {
      case "top":
        if (action === "left") topIndex = clamp(topIndex - 1, 0, TOP_ITEMS.length - 1);
        else if (action === "right") topIndex = clamp(topIndex + 1, 0, TOP_ITEMS.length - 1);
        else if (action === "down" || action === "back") zone = "row";
        else if (action === "accept") {
          const item = TOP_ITEMS[topIndex];
          if (item === "games" || item === "media") {
            setTab(item);
            zone = "row";
          } else if (item === "profile") return openProfileMenu();
          else if (item === "settings") return openSettings();
          else toast("Search comes in a later version");
        }
        break;

      case "row":
        if (action === "left" || action === "right") {
          const next = clamp(rowIndex[tab] + (action === "left" ? -1 : 1), 0, items.length - 1);
          if (next !== rowIndex[tab]) {
            rowIndex[tab] = next;
            layoutRow();
            renderHub();
          }
        } else if (action === "up") {
          zone = "top";
          topIndex = tab === "games" ? 0 : 1;
        } else if (action === "down") {
          zone = "actions";
          actionIndex = 0;
        } else if (action === "accept") return activateRowItem();
        break;

      case "actions":
        if (action === "left") actionIndex = 0;
        else if (action === "right" && title) actionIndex = 1;
        else if (action === "up" || action === "back") zone = "row";
        else if (action === "down") {
          zone = "cards";
          cardIndex = 0;
        } else if (action === "accept") {
          if (actionIndex === 1 && title) return openOptions(title);
          return activateRowItem();
        }
        break;

      case "cards":
        if (action === "left") cardIndex = clamp(cardIndex - 1, 0, LOWER_CARDS - 1);
        else if (action === "right") cardIndex = clamp(cardIndex + 1, 0, LOWER_CARDS - 1);
        else if (action === "up" || action === "back") zone = "actions";
        else if (action === "accept") {
          if (cardIndex === 1) openLibrary();
          else if (cardIndex === 2) return cb.onSwitchProfile();
        }
        break;
    }
    layoutRow();
    paintFocus();
  }

  fullRender();

  return {
    el,
    handle,
    destroy() {
      clearInterval(clockTimer);
    },
  };
}

// ---------- small builders ----------

/** "Kids" -> "Kids'", "Emma" -> "Emma's". */
function possessive(name: string): string {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

function titleTile(title: Title, favorite: boolean, starting = false): HTMLElement {
  const tile = h("div.tile");
  if (title.art.tile) {
    tile.append(img(title.art.tile, "tile-img", () => paintGeneratedTile(tile, title)));
  } else {
    paintGeneratedTile(tile, title);
  }
  if (favorite) {
    const badge = h("div.tile-fav");
    badge.innerHTML = icons.heart; // constant SVG markup from icons.ts
    tile.append(badge);
  }
  if (!title.installed) {
    tile.classList.add("not-installed");
    const badge = h("div.tile-download");
    badge.innerHTML = icons.download; // constant SVG markup from icons.ts
    tile.append(badge);
  }
  if (starting) tile.append(h("div.tile-loading", {}, h("div.spinner"), h("span", {}, "Starting")));
  return tile;
}

function titleThumb(title: Title): HTMLElement {
  const thumb = h("div.fav-thumb");
  if (title.art.tile) thumb.append(img(title.art.tile, "tile-img", () => paintGeneratedTile(thumb, title)));
  else paintGeneratedTile(thumb, title);
  return thumb;
}

function paintGeneratedTile(tile: HTMLElement, title: Title) {
  tile.querySelector(".tile-img")?.remove();
  const { from, to } = title.colors ?? { from: "#1f2a48", to: "#4a5b8c" };
  tile.style.background = `linear-gradient(140deg, ${from}, ${to})`;
  tile.prepend(h("div.tile-glyph", {}, title.glyph ?? title.name.slice(0, 1)));
}

function setGradientHero(layer: HTMLElement, title: Title) {
  layer.replaceChildren();
  const { from, to } = title.colors ?? { from: "#101830", to: "#2a3a6a" };
  layer.style.background = `radial-gradient(110% 100% at 75% 35%, ${to} 0%, ${from} 55%, #05060c 100%)`;
  layer.append(h("div.hero-glyph", {}, title.glyph ?? ""));
}

function stat(label: string, value: string): HTMLElement {
  return h("div.stat", {}, h("div.stat-label", {}, label), h("div.stat-value", {}, value));
}
