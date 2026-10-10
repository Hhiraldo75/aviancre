# AVIANCRE Roadmap

## Done
- [x] Vite + React + TypeScript + Tailwind setup
- [x] MapLibre 3D map of Providence (OpenStreetMap buildings via OpenFreeMap)
- [x] Domain model: properties, leases, rent rolls, underwriting types, data-source labels
- [x] Sample dataset: 10 Providence properties, 9 submarkets, sale comps, zoning placeholders
- [x] Map ↔ sidebar sync: occupancy-colored buildings, click to select, fly-to
- [x] Persona dashboard: Analyst / Broker / Developer / Investment views
- [x] Tested calculations: occupancy, WALT, mark-to-market, NOI, IRR, stacking plan, FAR capacity
- [x] Click any building → live public record: Providence Open Data 2025 tax roll (owner, land use, assessed value, taxes, condo units), plus year built, building and land area, zoning, overlay and historic districts and parcel outline from the city's ArcGIS Online `Parcel_Zoning_FL`, and flood zone and base flood elevation from RIGIS's FEMA DFIRM (2022)
- [x] Address search: type-ahead over the city's parcel addresses (ArcGIS Online `Parcel_Zoning_FL`) plus the sample properties and imported deals; picking one flies there and opens its public record
- [x] Filters synced across map and list: asset type, size, occupancy, lease expiration, submarket, levered IRR and max bid vs price; shareable in the URL

## Next
1. **Real building footprints and parcels** (in progress)
   - [x] Live tax-roll lookup (Providence Open Data, works from any network)
   - [x] GIS enrichment (zoning, overlays, flood + BFE, building size, outline) from ArcGIS Online (city `Parcel_Zoning_FL` + RIGIS DFIRM), reachable from any network; replaced the city's webgis.providenceri.gov server, which drops non-US connections
   - [x] Attach each sample property to a real parcel (address, tax map, coordinates from the 2025 tax roll)
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
5. **Rent estimation engine** with comps and confidence ranges; **rent roll import** (CSV/Excel)
6. **Deploy** to Vercel or Netlify for a public portfolio link
