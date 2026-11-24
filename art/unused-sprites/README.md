# Unused sprites

Art the app does not draw today, kept out of `public/` so it is not served or precached by the service worker (every file under `public/assets` is downloaded when the app is installed). Move a file back to `public/assets/raw/` when something uses it.

| File | What it is | Possible use |
|---|---|---|
| `ancient_idle.gif` (400 KB) | Android's idle animation of the ancient-stage Bóbr | the ancient stage on Home (BACKLOG: "Bóbr extras") |
| `gear.png` | the hand-drawn gear made for Home's Settings tile, dropped when Home was reworked (fbd3816) | a Settings icon |
| `button_back.png`, `button_next.png`, `arrow_left.png`, `arrow_right.png` | Android's arrow buttons | the button picker (BACKLOG: "Other Android button sprites") |
| `symbol_stop.png` | Android's stop symbol | |
| `tile_set.png` | Android's first world tile sheet (the world map uses its own sheets) | |

Found 2026-11-24 by searching `src`, `scripts` and `index.html` for each file name, counting names built at run time (`achievement_${medal}`, `bar_${color}_left`, `${category}_inactive`, `button_${variant}`). The `.9.png` frame sources in `public/assets/raw` all stay: `scripts/prepare-frames.mjs` builds the frames from them.
