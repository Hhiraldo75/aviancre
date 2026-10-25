# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

AVIANCRE is a browser-only (no backend) 3D commercial real estate app for Providence, RI: React 19 + Vite 7 + Tailwind v4 + MapLibre GL + Zustand. Plans live in `ROADMAP.md`.

## Commands

- `npm test` — Vitest suite (tests are colocated `*.test.ts`; single file: `npx vitest run src/lib/metrics.test.ts`)
- `npm run build` — `tsc -b && vite build`; this is the only type check
- `npm run dev` — app at http://localhost:5173
- `npm run underwrite -- <id> [--as-of YYYY-MM-DD] [--assumptions set.json] [--price N] [--scenario base|downside|upside] [--t12 file] [--value-add] [--json]` — prints one property's underwriting at Defaults or at an exported assumption set, plus Base/Downside/Upside side by side; writes `docs/underwriting-<id>.csv`, or with `--json` the AI analyst's input `docs/underwriting/<id>.json` (for an imported `deal-*` id, both go to `private-deals/<id>/`). A non-base `--scenario` runs that case and adds `--downside`/`--upside` to the file names. `--t12` (a T-12 CSV/.xlsx, or the mapped `.json` from the app; `private-deals/<id>/t12.json` is applied automatically) takes Year-1 opex and other income from the T-12, prints the T-12 check and adds `--t12` to the file names; a T-12 not from `docs/samples/` sends the output to `private-deals/<id>/`. `--value-add` turns on the value-add plan (unit rent rolls only; off by default, and while off every output is byte-identical), prints As-is vs Value-add, adds `--value-add` to the file names (after any scenario's) and, for the CSV, writes the renovation schedule next to it
- `npm run import -- <file.csv|.xlsx> [--asset-type …] [--class …] [--submarket …] [--check]` — validates a rent roll in the `npm run rent-roll` export format and saves the deal as `private-deals/deal-<name>.json` (`--check`: validate only, save nothing)
- `npm run convert -- <file> [--name …] [--allow-mismatch] [--dump]` — converts a Yardi "Rent Roll with Lease Charges" or a plain table of apartment units into the unit rent roll CSV (written under `private-deals/`), checked against the file's own totals; the app's import does the same through a mapping screen. Rules in `docs/UNDERWRITING.md` ("Converting other rent roll layouts")
- `/convert-rent-roll <file>` (project skill) — for layouts the converter can't handle, writes the clean CSV from the file's values only, runs the import check and reports totals against the file.
- `npm run check-private` — fails if Git tracks or has staged anything in `private-deals/` besides its README (also runs in `npm test`, and before every commit via `.githooks/pre-commit`, which `npm install`'s `prepare` script enables with `core.hooksPath`)
- `/underwriting-analyst <id> [--assumptions set.json] [--scenario downside|upside] [--t12 file] [--value-add]` (project skill) — runs the tests and the JSON export, reviews it, and writes an IC memo to `docs/memos/<id>.md` that names its assumption set. The engine does all math; the memo only quotes the JSON. Details in `docs/UNDERWRITING.md`.

Before calling a change done, run `npm test` and `npm run build`. For UI changes, also check it in `npm run dev`.

## Code style

No linter/formatter is configured — match existing code: no semicolons, single quotes, 2-space indent, default-exported components.

TypeScript is strict (`tsconfig.app.json`): `verbatimModuleSyntax` (use `import type` for types), `erasableSyntaxOnly` (no enums, namespaces, or parameter properties), `noUnusedLocals`/`noUnusedParameters`.

## Domain conventions

- `Pct` is a decimal (0.065 = 6.5%, never 6.5); `Bps` is basis points; `LngLat` is `[lng, lat]` (`src/types/common.ts`).
- Any figure an analyst might question is a `Sourced<T>` — build it with `fromPublic` / `fromImport` / `estimate` / `estimateWithBand` from `src/lib/sourced.ts`, never by hand.
- Calculations belong in `src/lib/` as pure functions; state lives in the single store `src/store/useAppStore.ts`.

## Data sources & gotchas

- Sample properties, tenants and rents in `src/data/` are fictional. Market benchmarks (`submarkets.ts`) are anchored to NAR/CoStar Q1 2026 and C&W metro figures and debt rates (`debtMarket.ts`) to Treasury + spreads, still EST; opex is a placeholder. Golden tests run at their `__fixtures__/*-validation.assumptions.json` sets, never at defaults; zoning heights and coverage in `src/data/zoning.ts` are from the Providence Zoning Ordinance (amended through July 22, 2026), which sets no FAR, and are keyed by the city map's codes (e.g. `D-1-100`). Tests pin `AS_OF = '2026-10-04'` and assert on specific sample properties — editing `sampleProperties.ts` can break them.
- Parcel click (`lookupParcel`) queries Providence Open Data tax roll (Socrata `6ub4-iebe`, primary) and, in parallel, the GIS layers in `src/services/providenceGis.ts` (secondary): the city's ArcGIS Online `Parcel_Zoning_FL` (layer 0 parcels with CAMA, 12 base zoning, 3–7 overlay districts, 8 local historic) and RIGIS `PLAN_DFIRM_Statewide_Flood_Hazard_Areas_2022` layer 1 (flood zone, static BFE; -9999 = none). Only the parcel layer must answer. GIS has a 10 s timeout and degrades to `{status:'unavailable'}` rather than failing the lookup. A newer click aborts the older one via the module-level `AbortController` — preserve the `current()` check before `set`.
- Every source is CORS-enabled (`Access-Control-Allow-Origin: *`) and called straight from the browser: no proxy, no serverless functions, no env vars. Don't use the city's own `webgis.providenceri.gov`: it drops connections from outside the US, including Vercel. Deploy steps: `DEPLOY.md`.
- Building footprints come from OSM 3D buildings by design (RIGIS outlines are from 2018 and have no heights).
- Keys (e.g. future Google 3D Tiles) go in `.env.local` (gitignored via `*.local`).

## Private deals

Real deals live in `private-deals/` (Git ignores all of it except `README.md`) or, in the app, in the browser's local storage. Never commit, copy into `docs/`, bundle (no `src/` import or glob of `private-deals/`), or send anywhere anything about an imported deal. T-12s follow the same rules: the app keeps them in local storage (`aviancre.t12.v1`, apart from the deal), the command line in `private-deals/<id>/t12.json`; the only committed T-12 is the fictional `docs/samples/fernhill-commons-t12.csv`. One exception, only when the analyst asks: placing a deal on its building sends the rent roll's address to the city parcel search ("Find … on the city map"), and a placed deal's public record is looked up by its parcel's plat/lot and point, like any parcel click; the deal's name, rents and tenants never leave the browser. The placement (`location.placement`, footprint) is saved with the deal in local storage. Imported deals have ids starting with `deal-` and `importedFrom` set. The import format, validation and ACT/EST rules are in `src/lib/rentRollImport.ts` and `docs/UNDERWRITING.md`.

## Git

Solo project: commit directly to `main` in small, focused commits. Pushing `main` to `origin` (GitHub) redeploys Vercel.
