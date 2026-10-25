# AVIANCRE Roadmap

## Done
- [x] Vite + React + TypeScript + Tailwind setup
- [x] MapLibre 3D map of Providence (OpenStreetMap buildings via OpenFreeMap)
- [x] Landing page console is clean: the basemap's numeric filters (e.g. road shields on `ref_length`) no longer warn "Expected value to be of type number, but found null"
- [x] Domain model: properties, leases, rent rolls, underwriting types, data-source labels
- [x] Sample dataset: 11 Providence properties, 9 submarkets, sale comps
- [x] Zoning limits from the Providence Zoning Ordinance (amended through July 22, 2026) for all 26 districts on the city map, each citing its section: max height everywhere, max coverage in residential districts; the ordinance sets no FAR, and the panels say so
- [x] Map ↔ sidebar sync: occupancy-colored buildings, click to select, fly-to
- [x] Persona dashboard: Analyst / Broker / Developer / Investment views
- [x] Tested calculations: occupancy, WALT, mark-to-market, NOI, IRR, stacking plan, zoning envelope (lot × max coverage × stories, where the ordinance caps coverage)
- [x] Click any building → live public record: Providence Open Data 2025 tax roll (owner, land use, assessed value, taxes, condo units), plus year built, building and land area, zoning, overlay and historic districts and parcel outline from the city's ArcGIS Online `Parcel_Zoning_FL`, and flood zone and base flood elevation from RIGIS's FEMA DFIRM (2022)
- [x] Address search: type-ahead over the city's parcel addresses (ArcGIS Online `Parcel_Zoning_FL`) plus the sample properties and imported deals; picking one flies there and opens its public record
- [x] Filters synced across map and list: asset type, size, occupancy, lease expiration, submarket, levered IRR and max bid vs price; shareable in the URL
- [x] Citywide screening estimates: every commercial lot (RI class 2) priced from public building data and the benchmarks (rentable share of gross area, NOI ÷ cap, everything EST), colored on the map by estimate ÷ 2025 assessed value relative to the median for the property type ("vs peers"), with the NOI build on the parcel card and a sortable, filterable screening list; static snapshot from `npm run citywide:refresh`, lazy-loaded; submarkets from the city's official neighborhoods, office vs retail from OpenStreetMap tags. Screening estimate, not an appraisal

## Next
1. **Real building footprints and parcels** (in progress)
   - [x] Live tax-roll lookup (Providence Open Data, works from any network)
   - [x] GIS enrichment (zoning, overlays, flood + BFE, building size, outline) from ArcGIS Online (city `Parcel_Zoning_FL` + RIGIS DFIRM), reachable from any network; replaced the city's webgis.providenceri.gov server, which drops non-US connections
   - [x] Attach each sample property to a real parcel (address, tax map, coordinates from the 2025 tax roll)
   - [x] Decode state/municipal use codes into plain-language property types
   - [x] Imported deals on their real building: find the rent roll's address in the city parcels (on request), or search or click the building; the deal takes the OSM building on that parcel (else the parcel outline), shows the parcel's public record, and can be reset to its approximate pin
   - [x] Follow-up: estimate a placed deal's floor count as city gross building area ÷ building outline area (labeled EST, with the formula), so the Developer view's height and nonconforming note stop relying on the rent roll's 1 floor
   - Footprints: keep OpenStreetMap buildings (the statewide RIGIS layer is 2018 machine-generated outlines with no heights)
2. **Photorealistic 3D toggle**
   - Optional "Photorealistic" mode using Google Photorealistic 3D Tiles (deck.gl or CesiumJS)
   - Translucent highlight of the selected property over the photo mesh
   - Requires a Google Maps Platform API key; keep the key out of Git (`.env.local`)
3. **Underwriting engine**
   - Lease-by-lease 10-year cash flow, rollover (renewal probability, downtime, TI/LC), debt, IRR, DSCR
   - Replaces the quick estimate in the Investment view; validated against a hand-built Excel model
4. **Live assumptions panel**: change rent growth, exit cap or interest rate and see results update
   - [x] Scenarios: Base, Downside and Upside side by side at the Base price (Investment view card, a switch in Full underwriting, `--scenario` on the CLI, a `scenarios` section in the analyst JSON); EST presets, editable and saved with assumption sets
   - [x] Value-add business plan (multifamily unit rent rolls, off by default): renovate units at their next roll at a set pace, re-lease at market + premium, funded by an equity reserve at closing; As-is vs Value-add card and pace by year in the Returns tab, `--value-add` on the CLI with a renovation schedule CSV, a `valueAdd` section in the analyst JSON, Downside premium/cost presets. Rules in `docs/UNDERWRITING.md` convention 19
5. **Rent estimation engine** with comps and confidence ranges; **rent roll import** (CSV/Excel)
   - [x] T-12 import: Yardi/AppFolio/plain 12-month statements mapped to categories with a totals check; Year-1 opex and other income from actuals; T-12 check in the Investment view (NOI bridge, taxes vs tax roll, ratios vs benchmark, price/IRR effect); in the analyst export and memo
6. **Deploy** to Vercel or Netlify for a public portfolio link
