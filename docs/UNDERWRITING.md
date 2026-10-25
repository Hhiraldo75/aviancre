# AVIANCRE underwriting engine

Step 1 is the calculation engine only, with no UI changes. Code lives in `src/lib/underwriting/` and uses the types in `src/types/underwriting.ts`.

## Spec

### Engine
- Monthly lease-by-lease cash flows, rolled up to 10 annual periods (plus year 11 for the exit NOI).
- Rent escalations per lease (fixed %, fixed $/SF, steps).
- Lease rollover at expiration: blend renewal vs new tenant by renewal probability (Argus-style weighted average of downtime, free rent, TI, LC and rent). New rent = market rent grown to that year. A fixed renewal option is priced at the lower of the option rent and market rent at renewal (a tenant won't exercise an above-market option), with a warning when the option is above market. Vacant suites lease up after their expected lease-up months on new-tenant terms.
- Expense recoveries by lease type: NNN (pro-rata, admin fee if set), base year, expense stop, full-service gross (none).
- Waterfall: gross potential rent, absorption/turnover vacancy, free rent, recoveries, general vacancy, credit loss, EGI, operating expenses (incl. management fee), NOI, TI, leasing commissions, capital reserves, cash flow before debt, debt service, levered cash flow.
- General vacancy is a floor: only add the amount above the vacancy already modeled from rollover and lease-up. Value-add renovation downtime comes on top of the floor (convention 19).
- Purchase price default = year-1 NOI at the default assumptions / market cap rate (overridable), plus closing costs. The estimate is anchored to defaults: it changes only when the analyst edits the market cap rate or enters a price. Edits to anything else move the going-in cap and returns, not the price. The summary card names where each cap rate came from, after its value: the submarket benchmark behind the price (e.g. "7.45% EST · Downtown / Downcity multifamily"; "price at <benchmark> X%" once other edits move the going-in cap off it), "price at your X% market cap", or "from your price"; and for the exit cap, the benchmark plus the spread (e.g. "+ 25 bps"), or "your input".
- Sale at end of year 10 = year-11 NOI / exit cap, less selling costs. Year-11 NOI is normalized first: rollover vacancy and free rent are replaced by the general vacancy rate.
- Loan: LTV, fixed rate, amortization, interest-only years, loan fee.
- Multifamily: simple unit-type model (vacancy, rent growth, turnover cost per move-out, per-unit reserves). A unit rent roll runs unit by unit, month by month (convention 18), validated against an independent Excel model (Fernhill golden test).
- Value-add business plan (unit rent rolls only, off by default): units are renovated at their next roll, offline for the downtime, then re-lease at market + a premium. It is paid for from a reserve funded with equity at closing (convention 19), validated against an independent Excel model (Fernhill value-add golden test).

### Default assumptions (`src/lib/underwriting/defaults.ts`, one set per asset type)
Office / Retail / Industrial:
- Renewal probability 65% / 70% / 70%
- Downtime 9 / 9 / 4 months
- New lease term 7 / 10 / 5 years; renewal term 5 years
- Free rent new/renewal 6/2, 3/1, 2/0 months
- TI new/renewal $60/$20, $30/$10, $5/$2 per SF
- Leasing commissions 6% new / 3% renewal of total lease value
- Market rent growth 1.5% / 2% / 3.5% per year
- Capital reserves $0.25 / $0.25 / $0.15 per SF per year

All: 5% general vacancy, 1% credit loss, 3% expense growth, 3% management fee of EGI.
Multifamily: 5% vacancy, 3% rent growth, $300 per unit per year reserves.
Loan: 60% LTV, 30-year amortization, 2 years interest-only, 1% fee ("consistent with Northmarq quotes, Oct 2026"), fixed rate by asset type = 10-year Treasury 4.96% (FRED DGS10, Oct 22, 2026) + CRED iQ spread (Mar 31, 2026, via Commercial Observer), rounded to 0.05%: multifamily 6.50% (154 bps), industrial 6.60% (162), retail 6.70% (176), office and mixed-use 7.15% (220). Source: `src/data/debtMarket.ts`.
Exit: 10-year hold, exit cap = market cap + 0.25%, 2% selling costs, 8% discount rate, 10% target levered IRR (for the max bid).

Defaults added during implementation (not in the original spec): closing costs 1.5%; new-lease escalation 3%/yr; multifamily turnover 50%/yr at $1,000 per move-out; initial capex $0.

Value-add plan (unit rent rolls only; `VALUE_ADD_DEFAULTS`): off. Its inputs are all EST:

- Units to renovate: 50% of units, rounded down (60 at Fernhill).
- Start: month 1.
- Max pace: 4 units/month.
- Cost: $12,500 per unit, a fixed budget ("Placeholder – replace with contractor bids").
- Rent premium: $175/unit/month in Year-1 dollars ("Placeholder – replace with renovated rent comps").
- Downtime: 1 month.

The count, start month and pace are "Placeholder – replace with the renovation business plan".

**Market benchmarks** (`src/data/submarkets.ts`): each asset type's submarket rows are anchored to a Providence-Warwick metro figure while keeping the earlier submarket differences: cap rates shifted by a constant, rents and vacancy scaled by a ratio, so the simple average across submarkets is the metro figure before rounding (caps to 0.05%, rents to $0.25/SF or $5/unit, vacancy to 0.1%; `src/lib/benchmarkAnchor.ts`). Rounding leaves the averaged caps up to 2.5 bps off (office 10.08%, retail 7.83%, industrial 7.78%, multifamily 7.48%).

| | Cap rate | Market rent | Vacancy | 12-mo rent growth (context only) |
|---|---|---|---|---|
| Office | 10.1% (NAR/CoStar Q1 2026) | $25/SF gross (NAR/CoStar; C&W Q3 2026: $22.85) | 13.3% multi-tenant (C&W Office MarketBeat Q3 2026; CoStar all-inventory 6.9%) | 2.9% |
| Retail | 7.8% | kept at $16–32/SF (urban street retail); metro $20/SF includes suburban strip retail, so it is context only | 3.6% | 0.1% |
| Industrial | 7.8% | kept at $9–10/SF, cited as $7.50 (C&W Industrial MarketBeat Q4 2025, NNN asking) to $11 (CoStar) | 4.8% | 5.2% |
| Multifamily | 7.5% | $2,058/unit/mo | 4.5% | 2.7% |

NAR/CoStar is the NAR Commercial Real Estate Report Q1 2026, Providence-Warwick metro (CoStar data). Every figure stays EST (confidence medium) with its source, as-of date and method in the badge. Underwriting rent growth keeps the long-run defaults above; the 12-month trailing figures show in the Analyst view only. Operating expenses and retail rents are still placeholders (retail rents EST, confidence low). The Analyst view's trend card shows the metro's Q1 2025 and Q1 2026 rent, vacancy and cap rate from the same NAR report. Mixed-use uses the office benchmark, or retail where a submarket has no office row.

Every default is a `Sourced<number>` with a label saying what should replace it (e.g. "Industry rule of thumb – replace with market report"). That lets the UI show an EST badge on each one. Analyst overrides are tagged `fromImport(…, 'Analyst input')`.

### Outputs
Going-in cap, raw and normalized year-11 NOI, in-place vs market rent, unlevered and levered IRR, equity multiple, cash-on-cash by year, DSCR by year, minimum DSCR, debt yield, WALT, NPV, plus plain-language warnings (e.g. DSCR below 1.25x, more than 25% of space rolling in one year, in-place rents more than 10% above or below market, a fixed renewal option above market).

**Sensitivity** (`src/lib/underwriting/sensitivity.ts`, top of the Returns tab): two 5×5 grids, exit cap (±25/50 bps) × market rent growth (±1/2 points, floored at 0%) and purchase price (±5/10%) × exit cap, each showing levered IRR, unlevered IRR or levered equity multiple. Every cell is a full engine run on the current assumptions, analyst edits included, with only its two inputs changed; there is no interpolation. Below the grids, warnings flag (a) any rent-growth case below expense growth in which NOI falls year over year during the hold, and (b) a levered IRR range of more than 5 points across the rent-growth cases at the current exit cap. The center cell reuses the current run, so it equals the headline figures exactly. If rent growth is edited below 1%, columns the 0% floor makes identical are shown once, and a negative edited growth is never floored. Grids are cached per assumptions object and built only while the Returns tab is open.

**Max bid** (`src/lib/underwriting/maxBid.ts`): the purchase price at which the levered IRR equals the *Target levered IRR* assumption (default 10%, EST "Placeholder – replace with investor return target", editable in the Exit group). Each trial is a full engine run with only the price changed: the loan stays at LTV × price, and closing costs and the loan fee scale with price. Operating cash flows don't depend on price, so they are computed once per solve. The solver bisects on the NPV of the levered cash flows at the target rate, which is zero exactly where IRR = target. Unlike the IRR, that NPV is defined at every price, and it falls as price rises. The search runs from 25% to 400% of the current price and stops when the bracket is under $1. It reports the price, $/SF, implied going-in cap, % vs the current price, and the levered IRR at the bid. It reports no solution, with a plain reason, when debt is off, when the target isn't reached even at 25% of the price, or when it is still exceeded at 4×. Shown as "Max bid at 10% levered IRR" on the summary card (Pricing) and in the Returns tab's Returns card, and cached per assumptions object.

**Scenarios** (`src/lib/underwriting/scenarios.ts`): Downside and Upside are preset changes layered on the current assumptions (defaults plus analyst edits). There is no new engine math: each case is the Base assumptions object with a few values moved, run through the same engine and max bid solver. The purchase price is copied from Base, never re-estimated, so all three cases are priced the same. Base itself is the same object and the same run as everywhere else, so Base output is unchanged byte for byte.

| Lever | Downside | Upside | Applies to |
|---|---|---|---|
| Market rent (Year 1) | −5% of the value | 0 | all |
| Market rent growth | −1 pt | +1 pt | all |
| Renewal probability | −10 pts | 0 | commercial |
| Downtime (new tenant) | +3 months | 0 | commercial |
| Turnover rate | +10 pts | 0 | multifamily |
| General vacancy | +2 pts | −1 pt, not below 3% | all |
| Expense growth | 0 | 0 | all (a lever you can set) |
| Exit cap rate | +50 bps | −25 bps | all |
| Rent premium (value-add) | −25% of the value | 0 | value-add plan on |
| Renovation cost (value-add) | +15% of the value | 0 | value-add plan on |

- **Rules.** Upside vacancy stops at 3%, and a Base already below 3% is left alone, never raised. Every result is held within the assumption's allowed range (renewal ≥ 0%, downtime ≤ 36 months, turnover ≤ 100%), and the override's note says when a limit applied. Rent growth is not floored at 0% (unlike the sensitivity grid), so an edited 0.5% becomes −0.5% in Downside. Debt terms don't move, so DSCR changes only through NOI. General vacancy is a floor on total vacancy, so +2 pts doesn't double-count the renewal and downtime levers: it adds vacancy in stable years and at the normalized exit. Downside is a typical committee downside (not a stress test) and has more levers than Upside.
- **Sources.** Each preset is EST ("Scenario preset – rule of thumb, replace with your own downside/upside view") until edited. Each moved assumption is EST with a note such as "Downside scenario: Base 7.70% +50 bps (preset)".
- **Editing.** Full underwriting > Assumptions > *Scenarios* has a Downside and an Upside input per lever. Edits are stored with the analyst's edits under keys like `scenarios.downside.exit.exitCapRate`, so they are saved, exported and imported with assumption sets and recorded in the memo marker. *Reset presets* clears only these; *Reset all to defaults* clears everything.
- **Comparison** (`scenarioComparison`): Year-1 NOI, Year-N NOI, exit value (gross sale value), unlevered and levered IRR, levered multiple, minimum DSCR and max bid, for each case. Each Downside and Upside value shows its change from Base ($ and %, bps for IRRs, ±x for multiples). It appears in the Investment view's *Scenarios* card and the analyst JSON, and every `npm run underwrite` prints it.
- **Viewing a scenario.** The switch in the Full underwriting header (Base | Downside | Upside), or a column header on the card, shows every tab for that case, with a line listing the moved assumptions. The Assumptions tab always shows and edits Base. `npm run underwrite -- <id> --scenario downside|upside` does the same on the command line and writes `…--downside.csv` / `.json` next to the Base files.
- **Tests.** `scenarios.test.ts`: Base identity, every lever on retail and multifamily, the vacancy floor, range limits, layering on edits, edited presets, the price held, the Base column equal to the Base run, and Downside < Base < Upside on the three golden samples.

### Checks
- Unit tests for each piece (escalations, rollover blending, recoveries, vacancy floor, loan amortization, IRR, sale) with hand-checkable numbers.
- `npm run underwrite -- <property-id>` prints the annual cash flow table and metrics, and writes them to `docs/underwriting-<property-id>.csv` for comparison against an Excel model.
- `npm run underwrite -- <property-id> --json` writes `docs/underwriting/<property-id>.json` instead of the CSV, for the AI analyst (`src/lib/underwriting/analystExport.ts`). It has:
  - `meta`: the AI label, as-of date and analysis start, and `assumptionSet` (name, the memo's header line, each change with its default, and the hidden marker line the memo copies)
  - `property`
  - `rentRoll`: occupancy, WALT, in-place vs market, the lease rows as the Rent roll tab shows them, expirations, the largest rollover year vs 25%, and above-market renewal options
  - `assumptions`: every editable assumption with its value, source label, EST flag and default, plus model settings
  - `cashFlows`: Year 0 to the normalized Year 11, in whole dollars
  - `returns`
  - `debt`: including negative leverage and the 1.25x DSCR and 9% debt yield floors
  - `warnings` and `notes`
  - `sensitivity`: both grids as levered IRR, with each grid's center, low and high cell, and the sensitivity `warnings`
  - `maxBid`

  Each figure is `{ value, display }`, with the display string the app shows. Spreads and differences the review needs are pre-computed: levered IRR vs target, exit vs going-in cap, Year-11 normalization, and going-in cap vs loan constant. The analyst quotes them and never calculates. The file carries a `generatedAt` timestamp and is regenerated on every run.
- **Validation sets.** Each golden test runs at the assumption set its Excel model was matched with, not at the app's defaults: `src/lib/underwriting/__fixtures__/<atwells|westminster|fernhill>-validation.assumptions.json`, in the assumption set file format, with every Base assumption pinned (the price at full precision, the old 6.50% rate and placeholder market figures). So the defaults can follow the market while the Excel match stays true. The files load through `parseAssumptionSetFile`, so a set that stops fitting the property fails the test. The value-add golden test runs at the Fernhill set with the plan's inputs pinned in the test.
- **Golden test.** `src/lib/underwriting/atwells.golden.test.ts` runs Atwells Retail Row (base scenario, as of 2026-10-04, at its validation set) and compares it against the frozen fixture `src/lib/underwriting/__fixtures__/atwells-benchmark.csv`. It checks every cash-flow line in every year, including both Year-11 columns, within $1. It also checks purchase price, loan amount, equity, net sale proceeds and loan payoff within $1, both IRRs within 0.0001, minimum DSCR within 0.01, and WALT within 0.01 years. The same checks also run after edits, Reset and re-applying the validation set from the store. The fixture was independently validated against the Excel benchmark (`AVIANCRE_Atwells_Underwriting_Benchmark_v2.xlsx`, matched to the cent on Oct 8, 2026).
  - No script writes to the fixture. `npm run underwrite` writes to `docs/`, and that file can change freely.
  - **Update the fixture only on purpose,** when an assumption or modeling method changes. Re-check the new numbers against Excel first. Then regenerate with `npm run underwrite -- sample-atwells-retail-row --as-of 2026-10-04 --assumptions src/lib/underwriting/__fixtures__/atwells-validation.assumptions.json` and copy `docs/underwriting-sample-atwells-retail-row.csv` over the fixture in the same commit as the change. Never update it just to make a failing test pass.
  - Oct 8, 2026 (V4 step 3B): the `WALT (years)` line changed from 2.26 to 2.19 because WALT is now measured from the analysis start (Nov 1, 2026) instead of the Oct 4 analysis date. Only that line was edited; no cash flow, price, loan, sale or return figure changed, so the Excel match still holds.
- **Westminster golden test.** `src/lib/underwriting/westminster.golden.test.ts` runs the same checks on Westminster Office Tower (base scenario, as of 2026-10-04) against `src/lib/underwriting/__fixtures__/westminster-benchmark.csv`. This is the office case: base-year recoveries, vacant-suite lease-up and the 9-month downtime. The fixture was validated against the second Excel benchmark (matched to the cent on Oct 8, 2026). The same fixture rules apply; regenerate with `npm run underwrite -- sample-westminster-tower --as-of 2026-10-04 --assumptions src/lib/underwriting/__fixtures__/westminster-validation.assumptions.json`.
- **Fernhill golden test.** `src/lib/underwriting/fernhill.golden.test.ts` is the multifamily case: the unit rent roll model (convention 18) on Fernhill Commons (base scenario, as of 2026-10-04). It covers renewal-vs-turnover rolls, loss-to-lease burn-off, lease-up of vacant and pre-leased units, and the unit on notice. It runs the same checks against `src/lib/underwriting/__fixtures__/fernhill-benchmark.csv`, with multifamily line labels and no WALT. `__fixtures__/fernhill-benchmark.json` adds:
  - the monthly loan schedule totaled by year (interest, principal, payment, ending balance), checked to the cent
  - every return metric: price, cost, loan, equity, sale and payoff within $1; going-in cap, both IRRs, both multiples, cash-on-cash, debt yield, loan constant and DSCR by year at full precision

  The engine was validated against an independent Excel model built only from written inputs, rules and the rent roll, without the code (`docs/validation/Fernhill-Excel-Check.xlsx`, Oct 24, 2026). It matched all 185 annual values (largest difference $0.00005, from the CSV's 4-decimal rounding), all 1,140 monthly values (under $0.000001) and every return metric. The same fixture rules apply. Regenerate the CSV with `npm run underwrite -- sample-fernhill-commons --as-of 2026-10-04 --assumptions src/lib/underwriting/__fixtures__/fernhill-validation.assumptions.json`. Rebuild the JSON from the loan schedule and from the `returns` and `debt` sections of the `--json` export.

- **Fernhill value-add golden test.** `src/lib/underwriting/fernhill-value-add.golden.test.ts` is the value-add case (convention 19): Fernhill at its validation set with the plan on at N = 60, S = 1, P = 4, C = $12,500, R = $175, D = 1. The inputs are pinned in the test, so the plan's defaults can move. It runs the same checks against `src/lib/underwriting/__fixtures__/fernhill-value-add-benchmark.csv`, including the plan's rows (units renovated exactly; renovation downtime, capex, reserve draw and unspent reserve within $1). It also checks:
  - the plan's inputs as the fixture lists them, and the as-is purchase price
  - the plan totals: units renovated, reserve, spend, unspent reserve and the month the program finishes
  - every row of `__fixtures__/fernhill-value-add-schedule.csv`: unit, order, renovation and re-lease months and rolls passed over exactly; re-lease rent, renovation cost and move-out cost to the cent

  The plan was validated to the cent against an independent Excel model built only from convention 19, the multifamily rules it relies on and the written inputs, without the code (`docs/validation/Fernhill-ValueAdd-Excel-Check.xlsx`, Oct 25, 2026). It matched all 228 annual values (largest difference $0.00005, from the CSV's 4-decimal rounding), all 60 schedule rows (units, months, order, re-lease rents, move-out costs) and every return metric. The same fixture rules apply. Regenerate both files with `npm run underwrite -- sample-fernhill-commons --as-of 2026-10-04 --assumptions src/lib/underwriting/__fixtures__/fernhill-validation.assumptions.json --value-add` and copy `docs/underwriting-sample-fernhill-commons--value-add.csv` and `…--value-add--schedule.csv` over the fixtures. That command uses the plan's defaults; if they no longer equal the pinned inputs (the test's first check fails), enter the pinned inputs in a set first.

All four golden tests share the checks in `src/lib/underwriting/goldenChecks.ts`.
- `npm run rent-roll -- <property-id> [--out path]` exports every lease and vacant-suite field the engine reads, including the renewal option rent and the base-year expense amount (default `docs/rent-roll-<property-id>.csv`; the Atwells export is `docs/atwells-rent-roll.csv`). A property block (asset type, building class, submarket, address) follows the rentable SF line: those set the market defaults. The rent roll import reads this format back.

**Value-add plan** (`src/lib/underwriting/valueAdd.ts`; the rules are convention 19).

- **Turning it on.** Full underwriting > Assumptions > *Value-add* has the on/off switch, which only unit rent rolls get. The plan's inputs appear while it is on.
- **Storage.** The switch is stored as `valueAdd.enabled: 1` and the inputs as `valueAdd.*`, so they are saved in assumption sets and recorded in the memo marker. Turning the plan off keeps its inputs. While it is off they change nothing: they aren't counted or listed as changes, and every output is byte-identical to a run without them.
- **Units input.** The "Units to renovate" box also takes a percent ("50%" of the units, rounded down).
- **Comparison.** With the plan on, the Returns tab's *Value-add plan* card compares As-is (the same assumptions with the plan off, at the same price) with Value-add:
  - Year-1 NOI
  - stabilized NOI (normalized Year 11)
  - when the program finishes
  - units renovated
  - reserve, total spend and unspent reserve
  - return on cost
  - exit value
  - value created
  - equity required
  - unlevered and levered IRR, levered multiple and minimum DSCR

  Next to it is the renovation pace by year.
- **Cash flow and sources & uses.** The cash flow gains the renovation lines, and sources & uses shows the reserve.
- **Command line.** `npm run underwrite -- <id> --value-add` turns the plan on, on top of any set. It prints the comparison and the pace, and adds `--value-add` to the file names (after any `--downside`/`--upside`, before `--t12`). The CSV run also writes `…--value-add--schedule.csv`, one row per renovation (unit, floor plan, status, renovation month, re-lease month, re-lease rent, cost, move-out cost, rolls passed over), so the schedule can be checked in Excel. The analyst JSON gains a `valueAdd` section only when the plan is on.
- **Tests.** `valueAdd.test.ts`:
  - a six-unit rent roll worked by hand (the example in convention 19)
  - the schedule rules
  - Fernhill with the plan off, with inert inputs: byte-identical CSV and JSON, and the golden checks
  - Fernhill with the plan on: price, reserve, value created, presets, and set round-trip

  The Fernhill value-add golden test (above) freezes the plan's full result, matched to an independent Excel model.

## Rent roll import (real deals)

The app's **Import rent roll** button and `npm run import -- <file>` read the rent roll export format as CSV or Excel `.xlsx` (first sheet). Both use `parseRentRoll` (`src/lib/rentRollImport.ts`) on a grid from `readRentRollFile` (`src/lib/rentRollFile.ts`; SheetJS 0.20.3 for `.xlsx`, loaded only when needed). Importing the Atwells export reproduces the Atwells golden results exactly, from CSV and from `.xlsx` (`src/lib/rentRollImport.test.ts`).

- **Format.** Row 1 `<name>: rent roll` (a trailing `(fictional sample data)` marks it as sample data); a `Rentable SF <n>` row; the optional property block; a `Leases` section and a `Vacant suites` section, each a header row and then one row per lease or suite, ending at a blank row. Columns are matched by name in any order. Required lease columns are Tenant, Suite, SF, Start, End, Starting rent, Escalation type, Escalation value, Lease type and Recovery method; Admin fee, Free rent, Renewal option rent and Base-year expense amount are optional. Vacant suites need Suite and SF.
- **Values.** Dates as `YYYY-MM-DD`, `M/D/YYYY` or Excel date cells. Numbers may carry `$`, thousands commas, or a trailing `%` (`3%` = 0.03). Escalation types: `fixed % per year`, `fixed $/SF per year`, `steps` (`2027-01-01: $25.00; …`), `none`. Recovery: `net`, `none`, `base-year (YYYY)`, `expense-stop ($X/SF)`. Renewal option rent: a $/SF figure or `95% of market`, priced as the first option with a 5-year term (the export has no term column).
- **Validation.** Errors block the load and list the 1-based row number (as Excel shows it) and column: missing sections or required columns, invalid dates, End on or before Start, SF that is not positive, negative or non-numeric figures, unknown escalation, lease or recovery types, a base year without its year, a rate typed as a whole percent (`3` for 0.03), and a missing or unknown asset type, class or submarket. Warnings allow the load: leased + vacant SF different from rentable SF, a duplicate suite, a lease already expired at the analysis date, an unused column, and no address. A picker choice or CLI flag replaces the file's asset type, class or submarket.
- **Sources.** Leases, rentable SF and asking rents are ACT (`imported`, "Imported rent roll (<file>)"). Market rent, OpEx, cap rate and every underwriting assumption stay EST, exactly as for a sample. Anything a rent roll doesn't have is EST "Not in rent roll – replace with …" (gross SF = rentable SF, 1 floor, zoning unknown) or omitted (year built, assessed value). The deal is placed at its submarket's center, marked approximate; nothing is geocoded on import.
- **Placing a deal on its building.** In the deal's panel, *Find <address> on the city map* searches the city parcel layer for the rent roll's address (only the address is sent) and places the deal when exactly one parcel has it; otherwise it lists the closest parcels. *Place on map* takes a parcel picked in the search or a building clicked on the map. The deal then sits at a point inside the parcel, drawn on the OpenStreetMap building there from the map's own tiles (else the parcel outline), and its panel shows the parcel's public record (tax roll by plat and lot, zoning, flood), looked up when the deal is opened. Placing also copies the parcel's zoning (the zoning map's district, else the one on the parcel record, with its ordinance height and coverage limits), flood zone, lot area and building area into the deal, so the Developer view shows its real limits, envelope and FAR the same as for a clicked parcel. *Reset to approximate location* puts it back at the submarket center, with the rent roll's "Unknown" zoning and sizes. The placement is saved with the deal, stays through a re-import with the same address, and changes no underwriting figure: the engine reads the rent roll, market figures, rentable SF and submarket, none of which placement touches.
- **Unit rent rolls (apartments).** A file with a `Units` section is read as a multifamily unit rent roll (sample: `docs/samples/fernhill-commons-unit-rent-roll.csv`, invented numbers, Class B in Olneyville per its property block; its raw `.xlsx` has no property block, so importing that asks for both; regenerate with `npx vite-node scripts/make-sample-rent-roll.ts`). The same CSV is also the built-in sample `sample-fernhill-commons` (Fernhill Commons (Sample), 91 Hartford Ave): `src/data/sampleProperties.ts` reads it with the import's parser and labels its unit mix as sample estimates, so it runs the unit-level model on the live site with nothing imported, and `npm run underwrite -- sample-fernhill-commons --json` and `/underwriting-analyst sample-fernhill-commons` write to `docs/` like any sample. Row 1 `<name>: unit rent roll`; the property block (`Asset type` multifamily, optional since the format implies it; `Units`; `Rentable SF`; `Class`; `Submarket`; `Address`); then a `Units` title row over one row per apartment. Required columns: Unit, Floor plan, SF, Status (`Occupied`/`Vacant`), Market rent ($/mo), In-place rent ($/mo). Optional columns: Other income ($/mo), Move-in, Lease end, Balance owed ($), Pre-leased (any mark but `no`; an applicant name is not kept), Future lease rent ($/mo) (the signed next lease's rent on a pre-leased unit; without it the next lease is at market), Note (free text, e.g. what a converter inferred; ignored by the engine). Errors: blank unit or floor plan, SF or market rent missing or not positive, an unknown status, an occupied unit with no rent or zero rent, and unparseable dates or numbers. Warnings: a lease end before move-in (the lease end is used as given), an expired or blank lease end on an occupied unit (month-to-month, rolls to market in month 1), a positive balance owed (not modeled; negatives are credits), a duplicate unit, an in-place rent on a vacant unit (ignored), a future lease rent on a unit that isn't pre-leased (ignored), a `Units` count or SF total that differs from the table, and no address. Units are grouped by floor plan into the engine's unit mix: the count, average SF, market rent averaged over all units, and in-place rent averaged over occupied units, all ACT. Property market rent is the unit-weighted average market rent (ACT); OpEx and the cap rate come from the submarket's multifamily benchmark (EST). Each unit is kept on the deal, so the engine models it lease by lease (convention 18).
- **Where deals live.** In the app, in this browser's local storage (`aviancre.importedDeals.v1`) only, shown with an *Imported* chip and a *Remove imported deal* button; never sent anywhere (placing a deal on its building, on request, sends only its address and parcel: see above). On the command line, `private-deals/deal-<name>.json`. `npm run underwrite`, `npm run rent-roll` and `/underwriting-analyst` accept the `deal-*` id and write their output to `private-deals/<id>/`. Git ignores `private-deals/` except its README; `npm run check-private` (and `npm test`) fails if anything else there is tracked or staged.

## Converting other rent roll layouts

Real rent rolls usually arrive as property-management reports, not in our format. Import (the app's **Import rent roll**, and `npm run convert`) detects the layout first (`detectLayout`, `src/lib/rentRollConvert.ts`) and converts it to a **unit rent roll**, which then goes through the usual validation. Only apartment unit rent rolls are converted; other layouts go to `/convert-rent-roll`.

- **Yardi "Rent Roll with Lease Charges"** (`src/lib/rentRollYardi.ts`): title rows (property name, `As Of = M/D/YYYY`), a two-row header whose labels are joined ("Unit" + "Sq Ft" → "Unit Sq Ft"), one block per unit (the unit row, more rows with one charge each, a `Total` row), then "Future Residents/Applicants" and summary sections. In-place rent = the rent charge codes (`rent`, `rnt`…); every other code counts as other income (flagged; each can be set to Rent, Other income or Excluded). A `VACANT` resident is vacant at market. Any other resident without digits (MODEL, ADMIN, DOWN…) blocks until mapped to a status. A future resident marks the unit pre-leased; their rent charges (by the same code classification), if any, are the future lease rent (flagged); their balance and lease dates are not used. A unit on notice (Move Out set) stays occupied with lease end = move-out (flagged). Charges that don't add up to the block's Total are flagged. The file's totals come from "Summary Groups" (units, occupied, vacant + non-revenue, SF, market rent) and "Summary of Charges by Charge Code" (rent and other income, using the same code classification).
- **Plain tables** (`src/lib/rentRollGeneric.ts`): the header is the row in the first 30 (or two rows read together) whose cells name the most fields by synonym, at least 3 including Unit. Synonyms include Unit/Apt #/Apartment, Sq Ft/SF/Area/Size, Tenant/Resident/Name, Market/Mkt Rent/Asking Rent, Rent/Actual Rent/Contract Rent, Lease Exp/Expiration/End, Move In/Lease Start, Balance/Past Due, Floor Plan/Unit Type/Bed/Bath, Pre-leased/Applicant, Future Rent/New Lease Rent. Status comes from a Status column (occupied, current, notice, vacant, vacant-leased…; any other value blocks until mapped), else from the tenant column (blank or "vacant" = vacant, flagged). Rows without a unit (subtotals) are skipped and flagged; a row starting with "Total" ends the table and gives the file's totals for SF, market rent and rent.
- **Floor plans** are one per (SF, market rent) pair, named `<SF> SF` (`<SF> SF · $<market>` when two pairs share an SF), or after the file's unit type when a plan has exactly one (plain tables only). The file's unit type codes go in the Note column. Plans can be renamed on the mapping screen; plans given the same name are merged.
- **Never guessed silently.** Blockers: a required field with no column (Unit, SF, market rent, in-place rent or the Yardi charge columns, and a status source), an unclassified status value or marker, no rent charge code, an occupied unit with no rent, units with no SF or market rent, a future resident for an unknown unit, no property name. Flags: everything inferred (charge code classification, status from the tenant column, notice lease ends, floor plan grouping, rentable SF as the units' total, skipped rows, an as-of date more than a year old).
- **Totals check.** Units, occupied, vacant, pre-leased, rentable SF, market rent (all, occupied, vacant), in-place rent, rent + vacant market and other income, converted vs the file's own figure: match, mismatch, or not in file. A mismatch needs an explicit "load anyway" in the app, or `--allow-mismatch` on the command line.
- **Mapping screen** (`src/components/panel/RentRollMapping.tsx`): the detected format, the column mapping (every dropdown can be changed, each marked detected / header synonym / preset / you), charge codes, status values, floor plan names, the totals check, flags and blockers, a 20-row preview with inferred cells highlighted, and *Download clean CSV*.
- **Presets.** *Save preset* keeps the confirmed mapping (column labels, charge codes, status values, and the floor plan names you gave, by SF + market rent; no deal data) in local storage (`aviancre.rentRollPresets.v1`). A file with the same header converts with it automatically. A saved floor plan name also follows a plan whose market rent changed, if it is the only plan at that SF in both files; a name typed on the mapping screen wins. *Download presets file* saves them for the command line as `private-deals/rent-roll-presets.json`.
- **Command line.** `npm run convert -- <file> [--name "…"] [--allow-mismatch]` prints the same mapping, totals check and flags, and writes `<file>-unit-rent-roll.csv` next to the file if it is in `private-deals/`, else in `private-deals/`. Nothing is written while anything blocks. `--dump` prints the file's cells with row numbers. `npm run import -- <file> --check` validates without saving and prints the unit and monthly rent totals.
- **`/convert-rent-roll <file>`** (Claude Code skill, `.claude/skills/convert-rent-roll/SKILL.md`) runs the converter first. For a layout it can't handle, it reads the dump, writes the clean CSV by the same rules (copying values only, leaving anything missing blank), runs the import check and reports totals against the file.
- **Tests.** `src/lib/rentRollConvert.test.ts` (small Yardi and plain-table grids). `scripts/convertSamples.test.ts` converts `docs/samples/fernhill-commons-raw.xlsx` and requires the exact deal that `docs/samples/fernhill-commons-unit-rent-roll.csv` imports to. `scripts/privateConversions.test.ts` runs the same checks on each `private-deals/*/expected-conversion.json` (`{ raw, clean, totals }`, expected numbers kept there, not in the repo), and is skipped when there are none.

## T-12 operating statements

A trailing-12-month operating statement replaces the estimated Year-1 operating expenses and other income with actuals. Load one from the **Investment view** (*T-12 operating statement* card > *Load T-12*) for any property, sample or imported deal, or pass `--t12 <file>` to `npm run underwrite`. Revenue still comes from the rent roll.

- **Reading** (`src/lib/t12Read.ts`). CSV or `.xlsx`, one row per line item, 12 monthly columns and an optional Total. The month header is the first row in the first 40 with 12 consecutive month cells (`Oct 2025`, `Oct-25`, `10/2025`, `2025-10`, Excel dates; `Jan` alone takes the year from a `Period = Oct 2025-Sep 2026` title, else the analyst enters the first month). The line item column is a header named Description / Account Name / Line item…, else the text column left of the months; a column of codes like `5000-0000` is the account code. The layout is labeled Yardi 12 Month Statement, AppFolio Twelve-Month Income Statement, or a plain table. Amounts may use `$`, commas, `(1,234)` or `-1,234` for negatives and `-` for zero.
- **Sections and categories.** Headings without amounts open a section (income, expenses, or below NOI for capital/replacement/debt headings, and everything after the NOI line). Rows starting with Total, and NOI, net income and cash flow rows, are subtotals: shown, never counted. Each line gets a category from its label, then its heading, then its section: rental income (incl. loss to lease), vacancy/concessions/bad debt, other income, expense recoveries (commercial: reimbursement/CAM/escalation income; for multifamily a utility reimbursement is other income), property taxes, insurance, utilities, repairs & maintenance, payroll, management fee, admin & marketing, other opex, capex / non-recurring, or not used (interest, depreciation, distributions below NOI). Every category can be changed on the mapping screen; for commercial each line has a recoverable box (default on for taxes, insurance, utilities and repairs & maintenance).
- **Make-ready.** Lines that look like make-ready or turnover are mapped to capex / non-recurring by default, with a flag: the model already charges turnover cost per move-out below NOI, and counting both would double them.
- **Signs.** Stored as income positive, deductions negative, expenses positive. Vacancy lines that are positive in the file are turned into deductions, and negative expenses into costs, each with a flag.
- **Totals check.** Total income, total operating expenses and NOI from the lines (as read, before the remapping moves anything below NOI) against the file's own rows: match, mismatch, or not in file; a mismatch needs an explicit "load anyway". Rows whose months don't add up to their Total column are flagged. Blockers: no month header, no line item column, no year, no expense lines.
- **Underwriting use** (`src/lib/t12.ts`, `defaults.ts`). Year-1 expense lines = the T-12 actual per operating category (taxes, insurance, utilities, R&M, payroll, admin & marketing, other opex), grown to Year 1 at expense growth: × (1 + g)^(months from the T-12's first month to the analysis start ÷ 12), midpoint to midpoint. For commercial a category with both recoverable and non-recoverable lines becomes two lines. The management fee stays the model's % of EGI (the T-12 fee is shown for comparison). Capex / non-recurring lines are left out and listed below NOI. Year-1 other income = the T-12's other income, grown the same way at market rent growth (`operating.otherIncomeYear1`): it replaces the rent roll's figure for multifamily and adds other income for commercial (none otherwise). These values are ACT, with the actual and the growth in the badge's notes. An edit to expense growth or rent growth re-grows them; a line the analyst entered stays as entered. Without a T-12 nothing changes (the golden tests prove it).
- **Price.** The estimated price follows default Year-1 NOI, so loading a T-12 moves it; the price's notes, the engine notes and the T-12 card say from what to what.
- **Checks** (`src/lib/underwriting/t12Check.ts`, the *T-12 check* card). At Base and the current edits: T-12 NOI vs underwritten Year-1 NOI line by line (rental income vs GPR less loss to lease and free rent; vacancy vs lease-up/rollover + general vacancy + credit loss; recoveries; other income; each expense category; the management fee), each with the NOI effect and why; the file's own NOI and what the remapping moved below NOI; other income from the T-12 next to the rent roll's; T-12 property taxes vs the city tax roll's annual taxes (PUB) once an imported deal is placed and its record has loaded; the expense ratio and opex per unit (or SF, before the management fee) vs the benchmark, labeled as an estimate; the below-NOI items next to the model's turnover cost/TI and reserves; and Year-1 NOI, price, going-in cap and levered IRR without vs with the T-12 (plus the levered IRR at the price without it, when the price is an estimate). Flags: NOI more than 10% off the T-12, taxes more than 10% off the tax roll, opex more than 20% off the benchmark, a T-12 management fee above the model's.
- **Where T-12s live.** In the app, in this browser's local storage (`aviancre.t12.v1`), by property id, apart from the deal (the deal's own entry never holds it); a re-imported rent roll keeps it, and removing the deal removes it. *Download mapped T-12* saves the mapping for the command line as `private-deals/<id>/t12.json`, which `npm run underwrite` applies automatically. On the command line `--t12` takes that `.json` or a CSV/`.xlsx` (mapped automatically; a totals mismatch stops it). A T-12 from anywhere but `docs/samples/` is treated as real: the output goes to `private-deals/<id>/` even for a sample property. Output files get a `--t12` suffix. Real T-12s are never committed, copied into `docs/` or bundled.
- **Sample.** `docs/samples/fernhill-commons-t12.csv`: a fictional Yardi-style statement for Fernhill Commons (Oct 2025 – Sep 2026), not applied to the built-in sample unless loaded. It matches its own totals, maps make-ready below NOI, and carries a 4% management fee to show the flag.
- **Tests.** `src/lib/t12Read.test.ts` (the sample, AppFolio and plain-table grids, signs, mismatches, overrides), `src/lib/t12.test.ts` (totals, growth, lines, file), `src/lib/underwriting/t12.test.ts` (the engine's other income, defaults, edits, sets, the check, the export) and the store tests.

## Assumption sets

Full underwriting > Assumptions saves the current edits as a named set per property (`src/lib/underwriting/assumptionSets.ts`, *Assumption set* bar in `AssumptionSetBar.tsx`).
- **Switch, save, delete.** The dropdown lists *Defaults* (always there, can't be deleted) and the saved sets; choosing one applies its edits. *Save as…* stores the current edits under a name (saving under an existing name replaces it, after a confirm). Editing after choosing a set marks it "Edited since saved"; switching away asks before discarding unsaved changes. *Delete set* keeps the current values applied. *Reset all to defaults* switches to Defaults.
- **Stored** in this browser's local storage (`aviancre.assumptionSets.v1`), by property id; never uploaded. An imported deal's sets stay through a re-import and are removed with the deal.
- **Files.** *Export* downloads the saved set as `<property id>--<set name>.assumptions.json`: `format`, `version`, `propertyId`, `name`, `savedAt` and `changes` (only the changed assumptions, keyed by path, in engine units: decimals for rates; edited scenario presets as `scenarios.<downside|upside>.<path>`). *Import…* checks the file is for this property and that every change is a known, in-range assumption, lists every problem, and loads nothing on error. Keep a deal's set files in `private-deals/<id>/`.
- **Expense lines.** Expense edits are keyed by line position (`operating.expenses.0.annualAmount`), and a T-12 replaces the single benchmark line with one line per category. So a set saved while a T-12 is loaded records its lines (`expenseLines`); a set without them was made on the single benchmark line (the fixtures keep that form). Applying or importing a set made on other lines than the property has now drops its expense edits (Base and presets) and says so; loading or removing a T-12 does the same to the current edits. The rest of the set applies as usual.
- **Command line.** `npm run underwrite -- <id> --assumptions <file>` validates the file the same way and runs through the same `assumptionsFor` as the app, so the figures match the app exactly. `--price` adds one more change on top (the set is then named "<set> + --price"). The console and the JSON name the set: "Assumption set: My case, 3 changes from defaults".
- **Tests.** Saving and re-applying a set reproduces the run exactly, Defaults reproduces the default run, the validation set passes the Atwells golden checks (`atwells.golden.test.ts`), and export → import round-trips with identical results (`assumptionSets.test.ts`).

## AI underwriting analyst

`/underwriting-analyst <property-id> [--assumptions <file>] [--scenario downside|upside] [--t12 <file>] [--value-add]` (`.claude/skills/underwriting-analyst/SKILL.md`) has Claude Code act as the analyst, at Defaults or at an exported assumption set (Base unless a scenario is given). The engine does all of the math; the AI only interprets it.
1. Run `npm test`, and stop if anything fails: no memo on a broken engine.
2. Run `npm run underwrite -- <id> [--assumptions <file>] --json`, then read the JSON and this document.
3. Report a 13-item review checklist as OK or FLAG: in-place vs market, above-market options, rollover concentration, WALT, Year-11 normalization, going-in vs exit cap, negative leverage, DSCR vs 1.25x, debt yield vs 9%, IRR vs target, sensitivity range, EST placeholders, and the Downside case (from the JSON's `scenarios` comparison, which the memo also quotes). With a T-12 loaded (`--t12`, or `private-deals/<id>/t12.json`), a 14th item checks the JSON's `t12` section and the memo adds an *Operating history (T-12)* section. With the value-add plan on (`--value-add`, or a set that turns it on), a 15th item checks the JSON's `valueAdd` section and the memo adds a *Value-add plan* section.
4. Write an investment committee memo to `docs/memos/<id>.md` (for an imported `deal-*` id, `private-deals/<id>/memo.md`, which the app never bundles). Under the "As of" line the memo states its set ("Assumption set: My case, 3 changes from defaults") and carries the JSON's marker line, `<!-- aviancre-assumption-set: {...} -->`, which records the exact changes. The Underwriting assumptions section lists each change with its default.

Every number in the memo is quoted from the JSON's display strings, and the memo is labeled "AI-generated analysis of sample data. All figures from the AVIANCRE engine." (an imported deal not marked as sample data drops "of sample data"). The skill only runs when invoked by name.

**Analyst memo tab** (V4 step 5B): Full underwriting shows `docs/memos/<property-id>.md` in an *Analyst memo* tab (`src/components/underwriting/AnalystMemoTab.tsx`).
- Memos are bundled with `import.meta.glob` (`src/services/analystMemos.ts`). Each memo is its own lazy chunk, fetched when the tab opens. A new or regenerated memo needs a rebuild in production; the dev server picks it up live.
- The header shows an *AI analyst* chip, "Written by Claude Code from AVIANCRE engine outputs, <date>" (the date from the memo's "As of" line) and "All figures from the engine at assumption set <name> (<n> changes from defaults)", read from the memo's marker (a memo without one was written at Defaults; the marker line is never shown). Because the header says this, the tab hides the memo's own first line when it is an italic disclaimer (`withoutDisclaimer`). The file in `docs/memos/` keeps it.
- A banner warns only when the assumptions applied now differ from the memo's set (compared change by change, not by name), naming both. A property without a memo shows the command that writes one.
- Markdown is rendered by a small built-in parser (`src/lib/markdown.ts`): headings, paragraphs, bullet and numbered lists, tables, rules, and bold, italic and code. There is no raw HTML. Wide tables scroll horizontally.

## Citywide screening estimates

**A screening estimate, not an appraisal.** The *Citywide estimates* map layer prices every commercial parcel in Providence from public data and the market benchmarks, then compares the result with the city's 2025 assessed value. It answers "where should an analyst look first?". It never reads a property's own rents, leases or expenses, and it doesn't touch the underwriting engine. Code: `src/lib/citywide/`. Coverage of the current snapshot: [citywide-coverage.md](citywide-coverage.md).

**Snapshot.** `npm run citywide:refresh` (`scripts/citywide-refresh.ts`) pulls the inputs and writes `public/data/citywide/parcels.json` (one record per lot, plus sources and the coverage report) and `outlines.json` (parcel outlines simplified to about 0.5 m). It also writes `docs/citywide-coverage.md`. The app fetches `parcels.json` only when the layer is first turned on, and `outlines.json` only when the map is then zoomed in past 14.5. It computes the estimates in the browser, so a benchmark change needs no new pull.
- **Which lots.** Every 2025 tax-roll record whose class is commercial under the RI class 2 rule (`isCommercial` in `src/lib/landUse.ts`), grouped by plat and lot. A condo lot becomes one record: assessed values are summed over its commercial records, and building area over the matching city units (by unit number, else by the city layer's commercial use code).
- **City parcel layer** (`Parcel_Zoning_FL` layer 0, queried by PIN = plat × 10,000 + lot): gross building area, land area, year built, floors, unit count and outline. A lot with no city row keeps its tax-roll point and has no building area.
- **Submarket.** The city's official neighborhoods (`Providence_Neighborhoods_(Polygon_Layer)`, same ArcGIS org) map to submarkets: Federal Hill, Fox Point, College Hill, Olneyville and Valley one to one; Lower South Providence → Port of Providence / Allens Ave. The Downtown neighborhood holds Downtown, Capital Center and the Jewelry District, so a parcel there takes the nearest of those three centers. Every other neighborhood uses the metro figures (`METRO_BENCHMARKS` in `src/data/submarkets.ts`: the same metro anchors as the submarket rows, with the NAR/CoStar Q1 2026 asking rent for retail and industrial, whose submarket rents aren't anchored). So does a submarket with no benchmark for the type, e.g. office in Federal Hill. The method is written on every estimate.
- **OpenStreetMap.** One Overpass query (refresh script only; the app never calls it) counts the offices (`office=*`, `building=office`) and the shops, restaurants, cafés, bars and banks (`shop=*`, storefront `amenity`, `building=retail/supermarket/kiosk`) inside each parcel.

**Estimate** (`estimateParcel` in `src/lib/citywide/estimate.ts`):
- **Type** from the tax-roll land use. Industrial (7) and apartments (03-*) map directly. Commercial (5, 6, 24) is office or retail when one side has at least ⅔ of the parcel's OpenStreetMap features; otherwise it is priced both ways, and the estimate is the average with the two as its range, at low confidence. Mixed use (04-*) is split by units: the units at the multifamily benchmark, and the rest of the building (gross area − units × 1,000 SF) priced like commercial space. With no space left over it is apartments only.
- **Units.** The city's unit count when it fits the tax-roll class's band (6–10, 11+, up to 5). Otherwise, gross building area ÷ 1,000 SF, kept within the band and marked EST. The city record sometimes says 1 unit on an 11+ apartment building.
- **Rentable area** = gross building area × an efficiency factor (`RENTABLE_EFFICIENCY`, EST, shown in the parcel card's NOI build): office 85%, retail 90%, industrial 95%, office/retail blend 87.5% (both options), and 90% for the commercial part of a mixed-use building, whatever its type. Apartments are priced by unit and take none.
- **NOI**, by `yearOneNOI`'s rules (`src/lib/quickFinancials.ts`): potential income at the class B benchmark rent (no class on public records) on the rentable area, or units × monthly rent × 12. Less vacancy at the benchmark rate. Less landlord expenses at the benchmark opex: office is quoted full-service, so the landlord pays all of it; retail and industrial are NNN, so only the vacant share; apartments pay per unit. Less the 3% management fee. **Value** = NOI ÷ benchmark cap rate. Every figure is EST and the parcel card shows each input with its source.
- **Confidence** is the lowest of the benchmark inputs, and low whenever the type, the units or the space split is a guess, or the metro figures were used.
- **Skipped, with the reason shown:** vacant land (14), utilities (10), no building area on the city record, and NOI ≤ 0.

**Vs peers.** Each parcel's estimate ÷ assessed is divided by the median of that ratio for its property type (office, retail, office/retail blend, industrial, apartments, mixed use), over the parcels in the snapshot with both (`src/lib/citywide/peers.ts`). 1.0× is the typical parcel of its type. The estimate runs systematically away from the assessment by type: benchmark rents describe CoStar-tracked class B space, and a whole type can be assessed above or below its income value. So the map colors and the list's default sort (highest first) use vs peers. The card and the list still show the absolute ratio. The medians are recomputed in the app from the loaded snapshot; `docs/citywide-coverage.md` lists them at the refresh.

**Bands** (vs peers, each including its lower edge): under 0.75× well below peers, 0.75–0.90× below, 0.90–1.10× in line, 1.10–1.33× above, 1.33× or more well above. On the map, red is below peers and blue is above.

**Reading it.** Well above peers means the benchmark income supports far more value than the assessment, compared with similar properties. That can point to upside, a stale assessment, or bad public data (building area, units). Well below peers can point to an over-assessment, a tax appeal, or a building the benchmark overrates. Open the card to check the inputs, then underwrite. In the first snapshot the absolute medians ran from 0.60× (office) to 2.22× (industrial).

**Map and list.** The layer draws a dot per parcel below zoom 15 and the parcel outline from zoom 15 (a dot stays where no outline loaded). Skipped buildings are drawn as hollow dots, and vacant land and utilities are not drawn. Clicking a parcel opens its public record with the *Screening estimate* card under the tax roll. *Open screening list* shows every lot, sorted by vs peers (highest first) and sortable by address, type, submarket, building SF, estimate, assessed, estimate ÷ assessed and vs peers. It filters by type, submarket (or metro), building SF, band and estimated/skipped, and parcels outside the filters fade on the map. Clicking a row flies to the parcel and opens its record.

## Modeling conventions

These are decisions made where the spec is silent. Match them when you rebuild the model in Excel.

1. **Timeline.** `asOf` = the date the analysis is run. The analysis starts on the 1st of the month after `asOf`. There are 132 monthly periods: year 1 = months 1–12, and year 11 exists only for the exit NOI. A lease occupies a month if the 1st of that month falls between its commencement and expiration dates.
2. **Escalations.** In-place rent for each month comes from `currentRentPerSF(lease, monthStart)` in `src/lib/metrics.ts`. Fixed-% and $/SF bumps apply on each commencement anniversary. Steps apply from their effective date.
3. **Recoveries** are driven by each lease's `recovery` field:
   - `net`: pro-rata share × recoverable expenses × (1 + admin fee)
   - `base-year`: share × max(0, expenses − base-year expenses)
   - `expense-stop`: SF × max(0, expenses/SF − stop)
   - `none`: 0

   Share = leased SF / rentable SF, with no gross-up, so the landlord carries the expenses on vacant space.

   **Base-year expenses.** If the lease has a *base-year expense amount* (`recovery.baseYearExpenses`: building-wide recoverable expenses in the base year, $/yr, from the lease abstract), the engine uses it as entered. If it is blank, the engine estimates it as base-year expense = year-1 opex × (1+g)^(base year − 2026), where 2026 is the first calendar year of the analysis. Rolled (speculative) leases never inherit the entered amount. They use the opex of the analysis year they start in (see 6). The estimate is conservative. Year 1 runs Nov 2026–Oct 2027, so it is mostly 2027 expenses, but it is treated as calendar 2026. That overstates each base year by about one year of growth, which understates recoveries.
4. **Rollover (Argus-style blending).** With renewal probability p, each term is the weighted average p × renewal + (1−p) × new: downtime (renewal = 0), free rent months, TI/SF and rent/SF. Leasing commissions are blended in dollars (see 7). Term months are blended the same way and rounded to whole months (e.g. 0.65 × 60 + 0.35 × 84 = 68.4 → 68). Renewal rent is market rent, unless the lease has a `RenewalOption`:
   - `fixed`: the lower of the option rent and market rent in the analysis year of expiration. At or below market, the tenant exercises the option, and the rent is flat unless the option sets `annualEscalationPct`. Above market, the tenant renews at market (escalating normally), and a warning names the tenant, option rent and projected market rent.
   - `percent-of-market`: that share of market, escalating normally.

   Only the first rollover uses the option; later rollovers renew at market. The blended speculative lease still escalates at the new-lease rate in the cash flow; the option's escalation only affects the renewal leg's lease value for commissions. New rent = year-1 market rent × (1+g)^(analysis year in which the next tenant occupies − 1). It steps up once a year, not monthly.
5. **Fractional months.** Blended downtime and free rent can come out fractional. For example, 2.7 months of downtime means months 1–2 are vacant and month 3 is 70% occupied.
6. **Speculative leases** escalate at the new-lease escalation rate on each anniversary of their start. They keep the expiring lease's recovery structure. A base year is reset to the calendar year matching the analysis year the new lease occupies (first calendar year + analysis year − 1). They roll again if they expire within the 132 months. TI and LC are paid in the first occupied month.
7. **Leasing commissions** = p × (renewal LC % × renewal lease value) + (1−p) × (new LC % × new lease value). Lease value = total scheduled base rent over that term, before free rent. The new leg escalates at the new-lease rate. The renewal leg does too, except for an exercised fixed option, which uses its own escalation (flat by default).
8. **In-place leases** are those active on `asOf`. Leases that start after `asOf` are not yet modeled.
9. **Vacant suites** stay vacant for `expectedLeaseUpMonths` (or the asset's downtime if that's missing). They then lease on 100% new-tenant terms, at the asking rent if one is set, otherwise market. Recoveries for these suites: office uses base-year (start year); retail and industrial use net.
10. **GPR** includes vacant and downtime months at what they would rent for, and the lost rent appears as absorption/turnover vacancy. Free rent abates base rent only. Recoveries are earned only on occupied SF.
11. **Waterfall signs.** Losses (vacancy, free rent, credit loss) and costs are reported as positive amounts and subtracted.
12. **General vacancy floor** (per year): target = rate × (GPR − loss to lease + recoveries + other income). General vacancy = max(0, target − (absorption/turnover vacancy − value-add renovation downtime)); renovation downtime is 0 without the plan (convention 19). Credit loss = rate × (GPR − loss to lease − absorption vacancy − free rent + recoveries + other income − general vacancy). Loss to lease is multifamily only (0 for commercial).
13. **Expenses.** There is one recoverable line, `market.opexPerYear` × RSF (× units for multifamily), grown each analysis year. With a T-12 loaded, the line is replaced by one line per T-12 operating category (each recoverable or not, as mapped), and the engine treats them exactly like the single line: summed, grown each year, the recoverable ones feeding recoveries. The management fee = rate × EGI and is not recoverable, which avoids a circular reference. Capital reserves stay flat in $/SF (or $/unit).
14. **Pricing.** Price defaults to year-1 NOI / market cap rate. Total cost = price × (1 + closing costs) + initial capex (+ the value-add reserve when the plan is on, convention 19). Going-in cap = year-1 NOI / price.
15. **Sale.** The exit year (year 11) is normalized before capping: absorption/turnover vacancy and free rent are removed and the full general vacancy rate applies instead (credit loss and management fee recalculate on the new EGI). Recoveries lost to downtime are not added back. Gross sale = normalized year-11 NOI / exit cap. Net sale = gross × (1 − selling costs). The CSV shows both the raw and normalized year-11 columns. The levered cash flow also pays off the loan balance after month 120.
16. **Debt.** Loan = LTV × price. Months 1–24 are interest-only, then a level payment amortizes the loan over 30 years. Loan fee = fee % × loan, paid from equity at t0. Equity = total cost − loan + fee.
17. **Returns.** Unlevered cash flows: t0 = −total cost; years 1–10 = CFBD (+ net sale in year 10). Levered cash flows: t0 = −equity; years 1–10 = CFBD − debt service (+ net sale − payoff in year 10). With the value-add plan on, year 10 of both also adds the unspent reserve (convention 19). NPV is unlevered, at the discount rate. The equity multiple is levered (total distributions / equity); there is also an unlevered multiple. Cash-on-cash = levered CF / equity. DSCR = NOI / debt service. Debt yield = year-1 NOI / loan. WALT is measured from the analysis start date (the first of the month after `asOf`), over leases active on `asOf`; the rent roll's remaining term uses the same start.
18. **Multifamily.** The cash flow shows Gross potential rent (at market), then Less: loss to lease, and the occupancy row is labeled Physical occupancy (before general vacancy): it counts leased units, and the general vacancy line still applies after it. For each unit type, market rentₜ = market₁ × (1+g)^(t−1). In-place rent closes the loss-to-lease gap as units turn: in-placeₜ = marketₜ − (market₁ − in-place₁) × (1+g)^(t−1) × (1−turnover)^(t−1). GPR = all units × market rent × 12, less loss to lease = occupied units × (market − in-place) × 12, shown as its own line. Other income = $/unit/month × all units × 12, grown with rent; with a T-12 loaded, its other income (grown to Year 1) replaces this figure, grown with rent the same way. There is no absorption vacancy, so general vacancy applies in full. Turnover cost = units × turnover rate × cost per move-out, grown with expenses, and is shown on the TI line. Reserves = $/unit × units.

    **Unit rent rolls** (imported apartments) run month by month instead. An occupied unit pays its in-place rent (flat) through its lease end; it rolls in the month after the month that contains its lease end date (the day is ignored). A lease ending before the analysis start, or with no end, is month-to-month and rolls in month 1. At the roll, the turnover share re-leases at that unit's market rent × (1+g)^(analysis year − 1) and the renewal share (1 − turnover rate) renews at the lower of that market rent and the current rent × (1 + max renewal increase, EST 5%); the new rent is the blend, as with a commercial renewal probability. It is one expected rent per unit, and the next roll starts from it, so a unit paying above market drops to market at its first roll. It then re-rolls every 12 months, so loss to lease burns off over several rolls rather than at the first lease end. A vacant unit's first lease is at market, or at the file's future lease rent on a pre-leased unit that has one, and has no turnover cost. Each roll costs turnover rate × cost per move-out, grown with expenses by the analysis year of the roll month. A unit on notice with a future resident (occupied and pre-leased) skips the renewal-or-turnover blend at its lease end: it goes straight to the signed lease, at the future lease rent if the file gives one, else at that year's market rent, with the full cost per move-out and no downtime; later rolls blend as usual. There is no downtime: the general vacancy floor (12) covers make-ready. Vacant units lease at the lease-up pace (EST 8 units/month), pre-leased units first, each group in file order: unit k (0-based) leases in month ⌊k / pace⌋ + 1 at that year's market rent. Until then its market rent is in GPR and shown as absorption vacancy. Other income = the file's monthly other income (all units) × 12, grown with rent, whatever the occupancy. Other income, operating expenses and reserves are annual figures; the other lines are summed from the months. GPR is every unit at market each month; loss to lease is market minus current rent on leased units, and is negative where current rent is above market. Occupancy = occupied unit-months ÷ (units × 12). The Rent roll tab shows loss to lease per floor plan: (market − in-place) on occupied units, per unit per month, as a % of their market rent, and per year. Its Pre-leased column counts every pre-leased unit, split into vacant and on notice (e.g. `4 (3 vacant, 1 on notice)`), the same count as the import's totals check.

19. **Value-add plan** (unit rent rolls only; off by default). While it is off, nothing below applies and the model is exactly conventions 1–18. Months are numbered 1, 2, … from the analysis start (month 1 = year 1's first month), and "year(m)" is the analysis year that month m falls in (months 1–12 are year 1).

    **Inputs.** Each input has its own letter:

    - N, units to renovate: a whole number from 0 to the unit count. Typed as a percent, it is ⌊percent × units⌋.
    - S, start month: 1–240.
    - P, max pace: renovations started per month, a whole number of at least 1.
    - C, cost per unit: fixed nominal dollars, not grown.
    - R, rent premium: $/unit/month in Year-1 dollars.
    - D, downtime: whole months, 0–12.

    The other inputs come from convention 18: g (market rent growth), e (expense growth), t (turnover rate), cost per move-out, and max renewal increase.

    **a. Rolls before renovation.** Each unit's roll months are where convention 18 puts them:

    - Its first roll F is:
      - for an occupied unit, the month after the month containing its lease end (month 1 when the lease has ended or has no end)
      - for a vacant unit, its lease-up month ⌊k / pace⌋ + 1
    - Its later rolls are F + 12, F + 24, …
    - A pre-leased unit's first roll is a signed lease and can't be renovated. That covers both a vacant unit with a signed applicant and an occupied unit on notice with the next resident signed. Such a unit is eligible from F + 12 on.

    **b. The schedule** is fixed before any cash flow is computed:

    1. Walk months m = S, S + 1, … through 12 × hold years (month 120). Stop once N renovations have started.
    2. In each month, take the units in rent-roll (file) order. For each unit not yet renovated whose eligible roll falls in m:
       - Renovate it in month m if fewer than P renovations have started in m and fewer than N in total.
       - Otherwise (the month is full), it is passed over. It rolls normally at m (the convention 18 blend) and is eligible again at its next roll, m + 12.
    3. Nothing starts in year 11.

    Lease-up order (pre-leased vacant units first) only sets F. Within a month, the order is always the file order.

    **c. The renovation month m** replaces the unit's roll at m:

    - The resident moves out. That costs the full cost per move-out × (1+e)^(year(m)−1), on the Turnover costs line, instead of the roll's t × cost.
    - A renovation at a vacant unit's first lease (F, not signed) has no move-out cost.
    - The renovation cost C is spent in month m.
    - From month m on, the unit's market rent is the renovated market rent: (market₁ + R) × (1+g)^(year−1), where market₁ is the unit's Year-1 market rent. So the premium grows with market rent.
    - The unit is offline in months m … m+D−1. It pays no rent, its GPR is the renovated market rent, and the same amount is absorption & turnover vacancy (shown again as *of which renovation downtime*). It isn't occupied.
    - In month m+D it leases at that month's renovated market rent, with no renewal blend and no extra cost.
    - Rent is flat until the next roll, at m + D + 12.
    - With D = 0, it re-leases in month m itself.

    **d. Later rolls** fall at m + D + 12, then every 12 months, and use convention 18's blend on the renovated market rent RM: new rent = t × RM + (1 − t) × min(RM, current × (1 + max renewal increase)), at t × cost per move-out × (1+e)^(year−1). Loss to lease = RM − current rent.

    **e. Annual lines** appear only with the plan on:

    - Units renovated (started): renovations starting in the year.
    - Of which renovation downtime: the downtime months' renovated market rent, already inside absorption & turnover vacancy.
    - Renovation capex: C × that count, below NOI.
    - Funded from renovation reserve: the same amount, added back.

    So cash flow before debt = NOI − turnover costs − leasing commissions − capital reserves − renovation capex + reserve draw. That equals the formula without the plan.

    **Renovation downtime comes on top of the general vacancy floor.** Convention 12's target is unchanged (rate × (GPR − loss to lease + recoveries + other income), with GPR including the downtime months at the renovated rent). What offsets it is now absorption & turnover vacancy minus renovation downtime: general vacancy = max(0, target − (absorption & turnover vacancy − renovation downtime)). Lease-up vacancy still offsets the floor as before. Credit loss is unchanged: rate × (GPR − loss to lease − absorption & turnover vacancy (all of it) − free rent + recoveries + other income − general vacancy).

    **f. Funding.**

    - Reserve = N × C, funded with equity at closing.
    - Total cost = price × (1 + closing costs) + initial capex + reserve.
    - The loan is LTV × price, unchanged: it funds none of the plan.
    - Equity = total cost − loan + loan fee.
    - Spent = C × renovations started in the hold. Unspent = reserve − spent, returned in year 10 (the final hold year). It is added to both the unlevered and the levered cash flow on the *Unspent reserve returned* line.
    - The reserve earns no interest.

    **g. Price and sale.**

    - The estimated price is worked out from the default assumptions with the plan off (convention 14), so the plan never raises it.
    - The sale is convention 15 on year 11, which now carries the renovated rents. Normalization sets absorption & turnover vacancy, and the renovation downtime within it, to 0, so any downtime that runs into year 11 is removed and the full general vacancy rate applies.

    **h. Outputs.**

    - **As-is** is the same assumptions with the plan off, at the same price.
    - **Stabilized NOI** = normalized year-11 NOI (the exit NOI).
    - **Program finishes** = the re-lease month (m + D) of the last renovation, once all N have started within the hold; otherwise "Not finished in the hold".
    - **Return on cost** = R × 12 ÷ C. It is simple and in Year-1 dollars: no downtime, no move-out cost.
    - **Value created** = value-add gross exit value − as-is gross exit value − spent.
    - **Pace by year**: renovations started, spend, and cumulative count and share of N.

    **i. Scenarios.** With the plan on, Downside also moves the rent premium by −25% and the cost per unit by +15%; the reserve is resized from the new cost. Upside leaves the plan alone. The presets are editable like the others.

    **Worked example** (`valueAdd.test.ts`). Analysis start Nov 2026. All six units have market $1,000 and in-place $900, with g = e = 0, t = 50%, cost per move-out $1,000 and a 5% renewal cap. The plan is N = 4, S = 1, P = 2, C = $10,000, R = $100, D = 1.

    The units, in file order:

    | Unit | Status | First roll |
    |---|---|---|
    | A | lease ends Oct 31 | month 1 |
    | B | month-to-month | month 1 |
    | C | lease ends Nov 15 | month 2 |
    | D | on notice, next resident signed | month 1 (signed) |
    | E | vacant | lease-up month 1 |
    | F | vacant, pre-leased | lease-up month 1 (signed) |

    Month by month:

    - Month 1: A and B start and fill the pace. D and F are signed; E is passed over and leases normally.
    - Month 2: C starts.
    - Month 13: D, now unsigned, comes before E in file order and is the 4th.
    - Re-lease months: A and B in month 2, C in month 3, D in month 14 (the program finishes in month 14).

    Year 1:

    - GPR = 2 × 12 × $1,100 + ($1,000 + 11 × $1,100) + 3 × 12 × $1,000 = $75,500
    - Absorption & turnover vacancy = 3 × $1,100 = $3,300, all of it renovation downtime (E and F lease in month 1, so there is no lease-up vacancy)
    - Loss to lease = $100 (C's month 1)
    - General vacancy = 5% × ($75,500 − $100) − ($3,300 − $3,300) = $3,770. The downtime doesn't reduce it.
    - Occupancy = 69 / 72
    - Turnover costs = $4,000: A, B and C move out, plus D's signed lease
    - Renovation capex = $30,000

    Year 2:

    - GPR = 4 × $13,200 + 2 × $12,000 = $76,800
    - Vacancy = $1,100 (D's month 13), all renovation downtime
    - Loss to lease = $0
    - General vacancy = 5% × $76,800 = $3,840
    - Turnover costs = $1,000 + 5 × $500 = $3,500
    - Renovation capex = $10,000

    Reserve = $40,000, all spent. With a 1-year hold, D's renovation falls outside it: $30,000 is spent and $10,000 is returned in year 1.
