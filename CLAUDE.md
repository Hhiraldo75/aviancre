# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

AVIANCRE is a browser-only (no backend) 3D commercial real estate app for Providence, RI: React 19 + Vite 7 + Tailwind v4 + MapLibre GL + Zustand. Plans live in `ROADMAP.md`.

## Commands

- `npm test` — Vitest suite (tests are colocated `*.test.ts`; single file: `npx vitest run src/lib/metrics.test.ts`)
- `npm run build` — `tsc -b && vite build`; this is the only type check
- `npm run dev` — app at http://localhost:5173 (also serves the `/pvdgis` proxy)

Before calling a change done, run `npm test` and `npm run build`. For UI changes, also check it in `npm run dev`.

## Code style

No linter/formatter is configured — match existing code: no semicolons, single quotes, 2-space indent, default-exported components.

TypeScript is strict (`tsconfig.app.json`): `verbatimModuleSyntax` (use `import type` for types), `erasableSyntaxOnly` (no enums, namespaces, or parameter properties), `noUnusedLocals`/`noUnusedParameters`.

## Domain conventions

- `Pct` is a decimal (0.065 = 6.5%, never 6.5); `Bps` is basis points; `LngLat` is `[lng, lat]` (`src/types/common.ts`).
- Any figure an analyst might question is a `Sourced<T>` — build it with `fromPublic` / `fromImport` / `estimate` / `estimateWithBand` from `src/lib/sourced.ts`, never by hand.
- Calculations belong in `src/lib/` as pure functions; state lives in the single store `src/store/useAppStore.ts`.

## Data sources & gotchas

- Sample properties, tenants, rents, and market figures in `src/data/` are fictional; zoning FAR/height limits in `src/data/zoning.ts` are placeholders. Tests pin `AS_OF = '2026-10-04'` and assert on specific sample properties — editing `sampleProperties.ts` can break them.
- Parcel click (`lookupParcel`) queries Providence Open Data tax roll (Socrata `6ub4-iebe`, CORS-enabled, primary) and City ArcGIS (secondary) in parallel. GIS has an 8s timeout and degrades to `{status:'unavailable'}` rather than failing the lookup. A newer click aborts the older one via the module-level `AbortController` — preserve the `current()` check before `set`.
- City ArcGIS goes through the Vite `/pvdgis` proxy, which exists only in dev; production needs `VITE_PVD_GIS_URL` (the only env var) pointing at a relay. The GIS is blocked from some non-US networks.
- Building footprints come from OSM 3D buildings by design (RIGIS outlines are from 2018 and have no heights).
- Keys (e.g. future Google 3D Tiles) go in `.env.local` (gitignored via `*.local`).

## Git

Solo project: commit directly to `main` in small, focused commits. No remote is configured.
