# AVIANCRE Roadmap

## Done
- [x] Vite + React + TypeScript + Tailwind setup
- [x] MapLibre 3D map of Providence (OpenStreetMap buildings via OpenFreeMap)
- [x] Domain model: properties, leases, rent rolls, underwriting types, data-source labels
- [x] Sample dataset: 10 Providence properties, 9 submarkets, sale comps, zoning placeholders
- [x] Map ↔ sidebar sync: occupancy-colored buildings, click to select, fly-to
- [x] Persona dashboard: Analyst / Broker / Developer / Investment views
- [x] Tested calculations: occupancy, WALT, mark-to-market, NOI, IRR, stacking plan, FAR capacity
- [x] Click any building → live public record: Providence Open Data 2025 tax roll (owner, land use, assessed value, taxes, condo units), plus City GIS zoning, flood, year built, building size and parcel outline when that server is reachable

## Next
1. **Real building footprints and parcels** (in progress)
   - [x] Live tax-roll lookup (Providence Open Data, works from any network)
   - [x] City GIS enrichment (zoning, flood, building size, outline) when reachable; blocked from some non-US networks
   - [ ] For deployment: a small US-hosted relay so GIS details work for every visitor
   - [ ] Attach each sample property to a real parcel instead of a placeholder square
   - [ ] Decode state/municipal use codes into plain-language property types
   - Footprints: keep OpenStreetMap buildings (the statewide RIGIS layer is 2018 machine-generated outlines with no heights)
2. **Photorealistic 3D toggle**
   - Optional "Photorealistic" mode using Google Photorealistic 3D Tiles (deck.gl or CesiumJS)
   - Translucent highlight of the selected property over the photo mesh
   - Requires a Google Maps Platform API key; keep the key out of Git (`.env.local`)
3. **Underwriting engine**
   - Lease-by-lease 10-year cash flow, rollover (renewal probability, downtime, TI/LC), debt, IRR, DSCR
   - Replaces the quick estimate in the Investment view; validated against a hand-built Excel model
4. **Live assumptions panel**: change rent growth, exit cap or interest rate and see results update
5. **Filters**: asset type, size, occupancy and expiration window, synced across map and list
6. **Rent estimation engine** with comps and confidence ranges; **rent roll import** (CSV/Excel)
7. **Deploy** to Vercel or Netlify for a public portfolio link
