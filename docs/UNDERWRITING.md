# AVIANCRE underwriting engine

Step 1 is the calculation engine only, with no UI changes. Code lives in `src/lib/underwriting/` and uses the types in `src/types/underwriting.ts`.

## Spec

### Engine
- Monthly lease-by-lease cash flows, rolled up to 10 annual periods (plus year 11 for the exit NOI).
- Rent escalations per lease (fixed %, fixed $/SF, steps).
- Lease rollover at expiration: blend renewal vs new tenant by renewal probability (Argus-style weighted average of downtime, free rent, TI, LC and rent). New rent = market rent grown to that year. A fixed renewal option is priced at the lower of the option rent and market rent at renewal (a tenant won't exercise an above-market option), with a warning when the option is above market. Vacant suites lease up after their expected lease-up months on new-tenant terms.
- Expense recoveries by lease type: NNN (pro-rata, admin fee if set), base year, expense stop, full-service gross (none).
- Waterfall: gross potential rent, absorption/turnover vacancy, free rent, recoveries, general vacancy, credit loss, EGI, operating expenses (incl. management fee), NOI, TI, leasing commissions, capital reserves, cash flow before debt, debt service, levered cash flow.
- General vacancy is a floor: only add the amount above the vacancy already modeled from rollover and lease-up.
- Purchase price default = year-1 NOI at the default assumptions / market cap rate (overridable), plus closing costs. The estimate is anchored to defaults: it changes only when the analyst edits the market cap rate or enters a price. Edits to anything else move the going-in cap and returns, not the price.
- Sale at end of year 10 = year-11 NOI / exit cap, less selling costs. Year-11 NOI is normalized first: rollover vacancy and free rent are replaced by the general vacancy rate.
- Loan: LTV, fixed rate, amortization, interest-only years, loan fee.
- Multifamily: simple unit-type model (vacancy, rent growth, turnover cost per move-out, per-unit reserves).

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
Loan: 60% LTV, 6.5% fixed (placeholder), 30-year amortization, 2 years interest-only, 1% fee.
Exit: 10-year hold, exit cap = market cap + 0.25%, 2% selling costs, 8% discount rate, 10% target levered IRR (for the max bid).

Defaults added during implementation (not in the original spec): closing costs 1.5%; new-lease escalation 3%/yr; multifamily turnover 50%/yr at $1,000 per move-out; initial capex $0.

Every default is a `Sourced<number>` with a label saying what should replace it (e.g. "Industry rule of thumb – replace with market report"). That lets the UI show an EST badge on each one. Analyst overrides are tagged `fromImport(…, 'Analyst input')`.

### Outputs
Going-in cap, raw and normalized year-11 NOI, in-place vs market rent, unlevered and levered IRR, equity multiple, cash-on-cash by year, DSCR by year, minimum DSCR, debt yield, WALT, NPV, plus plain-language warnings (e.g. DSCR below 1.25x, more than 25% of space rolling in one year, in-place rents more than 10% above or below market, a fixed renewal option above market).

**Sensitivity** (`src/lib/underwriting/sensitivity.ts`, top of the Returns tab): two 5×5 grids, exit cap (±25/50 bps) × market rent growth (±1/2 points, floored at 0%) and purchase price (±5/10%) × exit cap, each showing levered IRR, unlevered IRR or levered equity multiple. Every cell is a full engine run on the current assumptions, analyst edits included, with only its two inputs changed; there is no interpolation. The center cell reuses the current run, so it equals the headline figures exactly. If rent growth is edited below 1%, columns the 0% floor makes identical are shown once, and a negative edited growth is never floored. Grids are cached per assumptions object and built only while the Returns tab is open.

**Max bid** (`src/lib/underwriting/maxBid.ts`): the purchase price at which the levered IRR equals the *Target levered IRR* assumption (default 10%, EST "Placeholder – replace with investor return target", editable in the Exit group). Each trial is a full engine run with only the price changed: the loan stays at LTV × price, and closing costs and the loan fee scale with price. Operating cash flows don't depend on price, so they are computed once per solve. The solver bisects on the NPV of the levered cash flows at the target rate, which is zero exactly where IRR = target. Unlike the IRR, that NPV is defined at every price, and it falls as price rises. The search runs from 25% to 400% of the current price and stops when the bracket is under $1. It reports the price, $/SF, implied going-in cap, % vs the current price, and the levered IRR at the bid. It reports no solution, with a plain reason, when debt is off, when the target isn't reached even at 25% of the price, or when it is still exceeded at 4×. Shown as "Max bid at 10% levered IRR" on the summary card (Pricing) and in the Returns tab's Returns card, and cached per assumptions object.

### Checks
- Unit tests for each piece (escalations, rollover blending, recoveries, vacancy floor, loan amortization, IRR, sale) with hand-checkable numbers.
- `npm run underwrite -- <property-id>` prints the annual cash flow table and metrics, and writes them to `docs/underwriting-<property-id>.csv` for comparison against an Excel model.
- `npm run underwrite -- <property-id> --json` writes `docs/underwriting/<property-id>.json` instead of the CSV, for the AI analyst (`src/lib/underwriting/analystExport.ts`). It has:
  - `meta`: the AI label, as-of date and analysis start
  - `property`
  - `rentRoll`: occupancy, WALT, in-place vs market, the lease rows as the Rent roll tab shows them, expirations, the largest rollover year vs 25%, and above-market renewal options
  - `assumptions`: every editable assumption with its value, source label, EST flag and default, plus model settings
  - `cashFlows`: Year 0 to the normalized Year 11, in whole dollars
  - `returns`
  - `debt`: including negative leverage and the 1.25x DSCR and 9% debt yield floors
  - `warnings` and `notes`
  - `sensitivity`: both grids as levered IRR, with each grid's center, low and high cell
  - `maxBid`

  Each figure is `{ value, display }`, with the display string the app shows. Spreads and differences the review needs are pre-computed: levered IRR vs target, exit vs going-in cap, Year-11 normalization, and going-in cap vs loan constant. The analyst quotes them and never calculates. The file carries a `generatedAt` timestamp and is regenerated on every run.
- **Golden test.** `src/lib/underwriting/atwells.golden.test.ts` runs Atwells Retail Row (base scenario, as of 2026-10-04) and compares it against the frozen fixture `src/lib/underwriting/__fixtures__/atwells-benchmark.csv`. It checks every cash-flow line in every year, including both Year-11 columns, within $1. It also checks purchase price, loan amount, equity, net sale proceeds and loan payoff within $1, both IRRs within 0.0001, minimum DSCR within 0.01, and WALT within 0.01 years. The same checks also run after an assumption edit and Reset. The fixture was independently validated against the Excel benchmark (`AVIANCRE_Atwells_Underwriting_Benchmark_v2.xlsx`, matched to the cent on Oct 8, 2026).
  - No script writes to the fixture. `npm run underwrite` writes to `docs/`, and that file can change freely.
  - **Update the fixture only on purpose,** when an assumption or modeling method changes. Re-check the new numbers against Excel first. Then regenerate with `npm run underwrite -- sample-atwells-retail-row --as-of 2026-10-04` and copy `docs/underwriting-sample-atwells-retail-row.csv` over the fixture in the same commit as the change. Never update it just to make a failing test pass.
  - Oct 8, 2026 (V4 step 3B): the `WALT (years)` line changed from 2.26 to 2.19 because WALT is now measured from the analysis start (Nov 1, 2026) instead of the Oct 4 analysis date. Only that line was edited; no cash flow, price, loan, sale or return figure changed, so the Excel match still holds.
- **Westminster golden test.** `src/lib/underwriting/westminster.golden.test.ts` runs the same checks on Westminster Office Tower (base scenario, as of 2026-10-04) against `src/lib/underwriting/__fixtures__/westminster-benchmark.csv`. This is the office case: base-year recoveries, vacant-suite lease-up and the 9-month downtime. The fixture was validated against the second Excel benchmark (matched to the cent on Oct 8, 2026). The same fixture rules apply; regenerate with `npm run underwrite -- sample-westminster-tower --as-of 2026-10-04`. Both golden tests share the checks in `src/lib/underwriting/goldenChecks.ts`.
- `npm run rent-roll -- <property-id> [--out path]` exports every lease and vacant-suite field the engine reads, including the renewal option rent and the base-year expense amount (default `docs/rent-roll-<property-id>.csv`; the Atwells export is `docs/atwells-rent-roll.csv`). There is no rent roll import yet (ROADMAP item 6); when one is built it should read the same columns.

## AI underwriting analyst

`/underwriting-analyst <property-id>` (`.claude/skills/underwriting-analyst/SKILL.md`) has Claude Code act as the analyst. The engine does all of the math; the AI only interprets it.
1. Run `npm test`, and stop if anything fails: no memo on a broken engine.
2. Run `npm run underwrite -- <id> --json`, then read the JSON and this document.
3. Report a 12-item review checklist as OK or FLAG: in-place vs market, above-market options, rollover concentration, WALT, Year-11 normalization, going-in vs exit cap, negative leverage, DSCR vs 1.25x, debt yield vs 9%, IRR vs target, sensitivity range, and EST placeholders.
4. Write an investment committee memo to `docs/memos/<id>.md`.

Every number in the memo is quoted from the JSON's display strings, and the memo is labeled "AI-generated analysis of sample data. All figures from the AVIANCRE engine." The skill only runs when invoked by name.

**Analyst memo tab** (V4 step 5B): Full underwriting shows `docs/memos/<property-id>.md` in an *Analyst memo* tab (`src/components/underwriting/AnalystMemoTab.tsx`).
- Memos are bundled with `import.meta.glob` (`src/services/analystMemos.ts`). Each memo is its own lazy chunk, fetched when the tab opens. A new or regenerated memo needs a rebuild in production; the dev server picks it up live.
- The header shows an *AI analyst* chip, "Written by Claude Code from AVIANCRE engine outputs, <date>" (the date from the memo's "As of" line) and "All figures from the engine at default assumptions." Because the header says this, the tab hides the memo's own first line when it is an italic disclaimer (`withoutDisclaimer`). The file in `docs/memos/` keeps it.
- If any assumption is edited, a banner warns that the memo reflects default assumptions and the other tabs may differ. A property without a memo shows the command that writes one.
- Markdown is rendered by a small built-in parser (`src/lib/markdown.ts`): headings, paragraphs, bullet and numbered lists, tables, rules, and bold, italic and code. There is no raw HTML. Wide tables scroll horizontally.

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
12. **General vacancy floor** (per year): target = rate × (GPR + recoveries + other income). General vacancy = max(0, target − absorption/turnover vacancy). Credit loss = rate × (GPR − absorption vacancy − free rent + recoveries + other income − general vacancy).
13. **Expenses.** There is one recoverable line, `market.opexPerYear` × RSF (× units for multifamily), grown each analysis year. The management fee = rate × EGI and is not recoverable, which avoids a circular reference. Capital reserves stay flat in $/SF (or $/unit).
14. **Pricing.** Price defaults to year-1 NOI / market cap rate. Total cost = price × (1 + closing costs) + initial capex. Going-in cap = year-1 NOI / price.
15. **Sale.** The exit year (year 11) is normalized before capping: absorption/turnover vacancy and free rent are removed and the full general vacancy rate applies instead (credit loss and management fee recalculate on the new EGI). Recoveries lost to downtime are not added back. Gross sale = normalized year-11 NOI / exit cap. Net sale = gross × (1 − selling costs). The CSV shows both the raw and normalized year-11 columns. The levered cash flow also pays off the loan balance after month 120.
16. **Debt.** Loan = LTV × price. Months 1–24 are interest-only, then a level payment amortizes the loan over 30 years. Loan fee = fee % × loan, paid from equity at t0. Equity = total cost − loan + fee.
17. **Returns.** Unlevered cash flows: t0 = −total cost; years 1–10 = CFBD (+ net sale in year 10). Levered cash flows: t0 = −equity; years 1–10 = CFBD − debt service (+ net sale − payoff in year 10). NPV is unlevered, at the discount rate. The equity multiple is levered (total distributions / equity); there is also an unlevered multiple. Cash-on-cash = levered CF / equity. DSCR = NOI / debt service. Debt yield = year-1 NOI / loan. WALT is measured from the analysis start date (the first of the month after `asOf`), over leases active on `asOf`; the rent roll's remaining term uses the same start.
18. **Multifamily.** For each unit type, market rentₜ = market₁ × (1+g)^(t−1). In-place rent closes the loss-to-lease gap as units turn: in-placeₜ = marketₜ − (market₁ − in-place₁) × (1+g)^(t−1) × (1−turnover)^(t−1). GPR = (occupied units × in-place rent + vacant units × market rent) × 12. Other income = $/unit/month × all units × 12, grown with rent. There is no absorption vacancy, so general vacancy applies in full. Turnover cost = units × turnover rate × cost per move-out, grown with expenses, and is shown on the TI line. Reserves = $/unit × units.
