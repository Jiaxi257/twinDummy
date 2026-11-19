# twinDummy · Neighbourhood Studio (Nijkerk)

Grid-based neighbourhood design workspace. Pick a CBS neighbourhood, a BRK parcel or draw a polygon in Nijkerk, load
3DBAG LoD1.3 buildings, BGT ground surfaces and trees for it, then design on a 20 × 20 grid (5 m cells) — from scratch or
from the existing site.

**Live:** https://oikawakaki.github.io/twinDummy/ (after GitHub Pages is enabled: Settings → Pages → Deploy from branch → `main` / root)

## Data

- Loaded live in the browser: PDOK (CBS Wijken en Buurten 2026, BRK Kadastrale kaart, BGT, Luchtfoto Actueel_ortho25) and 3DBAG.
- Bundled fallback (used when live requests are blocked, e.g. in the claude.ai preview):
  - `data/<tx>_<ty>.json` — 1 km RD tiles of all of Nijkerk: 3DBAG buildings, BGT surfaces and trees, BRK parcels (snapshot 2026-11-19).
  - `aerial/*.jpg` — PDOK aerial sprite sheets (z9–14 whole municipality, z15–17 built-up neighbourhoods).

Sources: 3DBAG © TU Delft / 3DGI (CC BY 4.0); PDOK / Kadaster / CBS / Beeldmateriaal Nederland; OpenFreeMap / © OpenStreetMap.

## Run locally

```
python3 -m http.server 8000   # then open http://localhost:8000
```

## Rebuild

Sources are in `tools/src/`; `tools/build.py` assembles `index.html`. `build_tiles.py`, `build_sample.py`,
`fetch_aerial.py` / `build_aerial_packs.py` / `build_aerial_sprites.py` refresh the bundled data.
