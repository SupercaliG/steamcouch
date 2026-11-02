# steamcouch dashboard: plan

A console-style home screen for a living-room PC (Bazzite, NVIDIA GPU, TV,
game controller). Layout follows the PS5 home screen as closely as possible, with no
Sony logos, fonts, sounds, or other assets.


## Screens

1. **Who's playing?** Profile picker at boot: Kids, Mommy, Daddy.
2. **Games tab.** Top bar (Games | Media tabs, search, settings, avatar, clock).
   One row of square tiles: recent games first, favorites pinned with a heart,
   Game Library tile last. The focused tile grows and its name shows beside it.
   Full-screen hero art of the focused game. Bottom-left: logo or title, one
   line of text, wide "Play" pill, round "..." button. Right: cards
   (favorites, progress / time played). Down on the D-pad scrolls to more cards.
3. **Media tab.** Same layout. Tiles are apps: YouTube (VacuumTube), movies,
   music, kids apps. "Open" in place of "Play".
4. **Game Library.** Grid of all games, filters (installed, favorites, recomps).

Profiles decide which games and apps show. Kids see only titles on their allow
list. Mommy and Daddy see everything. Profile data lives in a local JSON file.

## Architecture

- **UI:** TypeScript + Vite, plain DOM, CSS. 1920x1080 fixed canvas scaled to
  the screen. Controller input through the browser Gamepad API, keyboard as a
  fallback for development.
- **Shell:** Electron. Runs as the gamescope session client (in place of the
  Steam UI) with `--use-gl=egl` on NVIDIA. gamescope needs
  `--force-composition` on this GPU (found during the OpenGamepadUI test).
- **Data (main process):**
  - Steam games: `steamapps/libraryfolders.vdf`, `appmanifest_*.acf`,
    `userdata/<id>/config/localconfig.vdf` (LastPlayed).
  - Non-Steam games and apps (recomps, VacuumTube): `userdata/<id>/config/shortcuts.vdf`
    (binary VDF), art in `userdata/<id>/config/grid/`.
  - Art: `appcache/librarycache/<appid>/`, fallback to the Steam CDN.
- **Launching:** Steam runs hidden in the background. The dashboard starts
  titles with `steam steam://rungameid/<id>`. gamescope moves focus to the game
  and back to the dashboard when it exits.

## Phases

1. **UI prototype (browser, mock data).** All 3 screens, controller and
   keyboard navigation, animations. Runs on any PC with `npm run dev`.
2. **Real data.** Steam library parser, shortcuts.vdf parser, art lookup,
   profiles file. Test against a copy of the couch PC's Steam folder.
3. **Electron shell + session.** Package, launch games, focus handling,
   gamescope session file, test on the TV.
4. **Polish.** Sounds, Home-button menu (volume, Wi-Fi, power), search,
   settings, parental allow list editor.
5. **Ship.** Add to the custom image (`bazzite-deck-nvidia-lts`) as the default
   session, with Steam Gaming Mode one menu away.

## Open questions

- Home button: Steam captures it. Phase 3 decides between Steam's overlay
  (works today) and our own menu.
- Steam Input for the dashboard itself when Steam is in the background.
