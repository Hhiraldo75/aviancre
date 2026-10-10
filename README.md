# AVIANCRE

A 3D commercial real estate intelligence platform for Providence, RI. Explore
buildings on an interactive map and switch between Analyst, Broker, Developer and
Investment views of the same property.

Click any building in Providence to pull its live public record: the City of
Providence 2025 tax roll (Open Data portal); year built, building and land area,
base zoning, overlay and local historic districts and the parcel outline from the
city's ArcGIS Online layer [`Parcel_Zoning_FL`](https://services6.arcgis.com/wv9mHoqblhTsnqdG/arcgis/rest/services/Parcel_Zoning_FL/FeatureServer); and the
flood zone and base flood elevation from FEMA's DFIRM as published by RIGIS
([Statewide Flood Hazard Areas 2022](https://services2.arcgis.com/S8zZg9pg23JUEexQ/arcgis/rest/services/PLAN_DFIRM_Statewide_Flood_Hazard_Areas_2022/FeatureServer/1)).
Both ArcGIS Online services are called straight from the browser.

**The colored sample properties and all tenant, rent and market figures are fictional sample data.**

To underwrite a real deal, use **Import rent roll** (CSV or Excel, in the format
`npm run rent-roll` exports). The file is read in your browser and the deal is kept
in that browser only. From the command line, `npm run import -- <file>` saves it in
`private-deals/`, which Git ignores (see `private-deals/README.md`).

## Stack
React 19 · TypeScript · Vite · Tailwind CSS v4 · MapLibre GL JS · Zustand · Vitest

## Run it
Requires Node.js 20.19+ (or 22+).

```bash
npm install
npm run dev     # open the printed localhost URL
npm test        # metrics, NOI/IRR, stacking plan and zoning-capacity tests
```

Deploying to Vercel: see [`DEPLOY.md`](DEPLOY.md).

## Structure
- `src/types` – domain model (properties, leases, rent rolls, underwriting)
- `src/data` – sample Providence properties, submarkets, comps, zoning placeholders
- `src/lib` – pure, tested calculations (occupancy, WALT, NOI, IRR, FAR capacity)
- `src/services` – Providence Open Data tax-roll client and the GIS client for the city's ArcGIS Online parcel/zoning layers and RIGIS flood zones (called directly from the browser)
- `src/store` – shared app state (selection, parcel lookup, persona, analysis date)
- `src/components` – map, persona dashboard and sidebar UI
