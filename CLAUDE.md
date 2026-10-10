# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

AVIANCRE is a browser-only (no backend) 3D commercial real estate app for Providence, RI: React 19 + Vite 7 + Tailwind v4 + MapLibre GL + Zustand. Plans live in `ROADMAP.md`.

## Commands

- `npm test` — Vitest suite (tests are colocated `*.test.ts`; single file: `npx vitest run src/lib/metrics.test.ts`)
- `npm run build` — `tsc -b && vite build`; this is the only type check
- `npm run dev` — app at http://localhost:5173 (also serves the `/pvdgis` proxy)
- `npm run underwrite -- <id> [--as-of YYYY-MM-DD] [--assumptions set.json] [--price N] [--json]` — prints one property's underwriting at Defaults or at an exported assumption set; writes `docs/underwriting-<id>.csv`, or with `--json` the AI analyst's input `docs/underwriting/<id>.json` (for an imported `deal-*` id, both go to `private-deals/<id>/`)
- `npm run import -- <file.csv|.xlsx> [--asset-type …] [--class …] [--submarket …] [--check]` — validates a rent roll in the `npm run rent-roll` export format and saves the deal as `private-deals/deal-<name>.json` (`--check`: validate only, save nothing)
- `npm run convert -- <file> [--name …] [--allow-mismatch] [--dump]` — converts a Yardi "Rent Roll with Lease Charges" or a plain table of apartment units into the unit rent roll CSV (written under `private-deals/`), checked against the file's own totals; the app's import does the same through a mapping screen. Rules in `docs/UNDERWRITING.md` ("Converting other rent roll layouts")
- `/convert-rent-roll <file>` (project skill) — for layouts the converter can't handle, writes the clean CSV from the file's values only, runs the import check and reports totals against the file.
- `npm run check-private` — fails if Git tracks or has staged anything in `private-deals/` besides its README (also runs in `npm test`)
- `/underwriting-analyst <id> [--assumptions set.json]` (project skill) — runs the tests and the JSON export, reviews it, and writes an IC memo to `docs/memos/<id>.md` that names its assumption set. The engine does all math; the memo only quotes the JSON. Details in `docs/UNDERWRITING.md`.

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
- City ArcGIS is called at `/pvdgis/…`: the Vite proxy in dev and preview, and in production the `api/pvdgis.ts` Vercel function (US region, via the `vercel.json` rewrite), since the GIS is blocked from some non-US networks. The relay forwards only the layers and query params `providenceGis.ts` sends; a new one must be added to its allowlist (`src/services/pvdgisRelay.test.ts` checks). `VITE_PVD_GIS_URL` (the only env var) optionally overrides the base URL. Deploy steps: `DEPLOY.md`.
- Building footprints come from OSM 3D buildings by design (RIGIS outlines are from 2018 and have no heights).
- Keys (e.g. future Google 3D Tiles) go in `.env.local` (gitignored via `*.local`).

## Private deals

Real deals live in `private-deals/` (Git ignores all of it except `README.md`) or, in the app, in the browser's local storage. Never commit, copy into `docs/`, bundle (no `src/` import or glob of `private-deals/`), or send anywhere anything about an imported deal. Imported deals have ids starting with `deal-` and `importedFrom` set. The import format, validation and ACT/EST rules are in `src/lib/rentRollImport.ts` and `docs/UNDERWRITING.md`.

## Git

Solo project: commit directly to `main` in small, focused commits. No remote is configured.
