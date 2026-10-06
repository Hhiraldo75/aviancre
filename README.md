# AVIANCRE

A 3D commercial real estate intelligence platform for Providence, RI. Explore
buildings on an interactive map and switch between Analyst, Broker, Developer and
Investment views of the same property.

**All property, tenant and market data in this repo is fictional sample data.**

## Stack
React 19 · TypeScript · Vite · Tailwind CSS v4 · MapLibre GL JS · Zustand · Vitest

## Run it
Requires Node.js 20.19+ (or 22+).

```bash
npm install
npm run dev     # open the printed localhost URL
npm test        # metrics, NOI/IRR, stacking plan and zoning-capacity tests
```

## Structure
- `src/types` – domain model (properties, leases, rent rolls, underwriting)
- `src/data` – sample Providence properties, submarkets, comps, zoning placeholders
- `src/lib` – pure, tested calculations (occupancy, WALT, NOI, IRR, FAR capacity)
- `src/store` – shared app state (selection, persona, analysis date)
- `src/components` – map, persona dashboard and sidebar UI
