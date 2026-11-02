export type TitleKind = "game" | "app";

export interface TitleArt {
  /** Full-screen background (Steam library_hero, 3840x1240 or similar). */
  hero?: string;
  /** Portrait or square art used for the tile (center-cropped to a square). */
  tile?: string;
  /** Transparent game logo shown bottom-left (Steam logo.png). */
  logo?: string;
}

export interface Title {
  id: string;
  kind: TitleKind;
  name: string;
  tagline: string;
  art: TitleArt;
  /** Fallback colors when there is no art (apps, recomps). */
  colors?: { from: string; to: string };
  /** Single glyph or short text drawn on generated tiles. */
  glyph?: string;
  /** Unix seconds. Drives the Recent ordering. */
  lastPlayed?: number;
  playtimeMinutes?: number;
  /** Where the title comes from. Non-Steam and Recomp are Steam shortcuts. */
  source: "Steam" | "Non-Steam" | "Recomp" | "App";
  /** False for owned Steam games that are not installed. */
  installed: boolean;
  /**
   * False when Steam says the game cannot be played with a controller (no
   * controller support and not rated Verified/Playable on Steam Deck).
   * Undefined (shortcuts, apps) counts as playable.
   */
  controller?: boolean;
  /** `steam steam://rungameid/<gameId>` starts it (and installs if needed). */
  launch: { type: "steam"; gameId: string };
}

export interface Profile {
  id: string;
  name: string;
  /** Circle color for the letter avatar. */
  color: string;
  /** Optional picture. Without it the avatar is the first letter of the name. */
  avatar?: string;
  /**
   * Restricted profiles (Kids) only see titles on their allow list and cannot
   * open settings. Unrestricted profiles (Grown-ups) see everything.
   */
  restricted: boolean;
  /** Title ids a restricted profile may see. Ignored when not restricted. */
  allow: string[];
  favorites: string[];
  /** 4-digit passcode asked before this profile opens. */
  pin?: string;
}

export type Tab = "games" | "media";

/** A game in the Steam Store (public store data, no account needed). */
export interface StoreItem {
  appId: number;
  name: string;
  blurb: string;
  art: {
    /** 600x900 portrait capsule. */
    portrait?: string;
    /** 460x215 header, every game has one. */
    header: string;
    /** Wide library hero for the background. */
    hero?: string;
  };
  /** "$24.99", "Free", or undefined when Steam shows no price (unreleased). */
  price?: string;
  /** Price before the discount, when on sale. */
  originalPrice?: string;
  discountPct?: number;
  review?: { label: string; percent: number; count: number };
  tags: string[];
  /** Unix seconds. */
  releaseDate?: number;
  comingSoon: boolean;
  earlyAccess: boolean;
  fullController: boolean;
  /** Steam's SteamOS / Steam Deck rating. */
  steamos: "verified" | "playable" | "unsupported" | "unknown";
}

export interface StoreSection {
  id: string;
  title: string;
  items: StoreItem[];
}
