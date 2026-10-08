# AVIANCRE underwriting engine

Step 1 is the calculation engine only, with no UI changes. Code lives in `src/lib/underwriting/` and uses the types in `src/types/underwriting.ts`.

## Spec

### Engine
- Monthly lease-by-lease cash flows, rolled up to 10 annual periods (plus year 11 for the exit NOI).
- Rent escalations per lease (fixed %, fixed $/SF, steps).
- Lease rollover at expiration: blend renewal vs new tenant by renewal probability (Argus-style weighted average of downtime, free rent, TI, LC and rent). New rent = market rent grown to that year. Vacant suites lease up after their expected lease-up months on new-tenant terms.
- Expense recoveries by lease type: NNN (pro-rata, admin fee if set), base year, expense stop, full-service gross (none).
- Waterfall: gross potential rent, absorption/turnover vacancy, free rent, recoveries, general vacancy, credit loss, EGI, operating expenses (incl. management fee), NOI, TI, leasing commissions, capital reserves, cash flow before debt, debt service, levered cash flow.
- General vacancy is a floor: only add the amount above the vacancy already modeled from rollover and lease-up.
- Purchase price default = year-1 NOI / market cap rate (overridable), plus closing costs.
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
Exit: 10-year hold, exit cap = market cap + 0.25%, 2% selling costs, 8% discount rate.

Defaults added during implementation (not in the original spec): closing costs 1.5%; new-lease escalation 3%/yr; multifamily turnover 50%/yr at $1,000 per move-out; initial capex $0.

Every default is a `Sourced<number>` with a label saying what should replace it (e.g. "Industry rule of thumb – replace with market report"). That lets the UI show an EST badge on each one. Analyst overrides are tagged `fromImport(…, 'Analyst input')`.

### Outputs
Going-in cap, raw and normalized year-11 NOI, in-place vs market rent, unlevered and levered IRR, equity multiple, cash-on-cash by year, DSCR by year, minimum DSCR, debt yield, WALT, NPV, plus plain-language warnings (e.g. DSCR below 1.25x, more than 25% of space rolling in one year, in-place rents more than 10% above or below market).

### Checks
- Unit tests for each piece (escalations, rollover blending, recoveries, vacancy floor, loan amortization, IRR, sale) with hand-checkable numbers.
- `npm run underwrite -- <property-id>` prints the annual cash flow table and metrics, and writes them to `docs/underwriting-<property-id>.csv` for comparison against an Excel model.

## Modeling conventions

These are decisions made where the spec is silent. Match them when you rebuild the model in Excel.

1. **Timeline.** `asOf` = the date the analysis is run. The analysis starts on the 1st of the month after `asOf`. There are 132 monthly periods: year 1 = months 1–12, and year 11 exists only for the exit NOI. A lease occupies a month if the 1st of that month falls between its commencement and expiration dates.
2. **Escalations.** In-place rent for each month comes from `currentRentPerSF(lease, monthStart)` in `src/lib/metrics.ts`. Fixed-% and $/SF bumps apply on each commencement anniversary. Steps apply from their effective date.
3. **Recoveries** are driven by each lease's `recovery` field:
   - `net`: pro-rata share × recoverable expenses × (1 + admin fee)
   - `base-year`: share × max(0, expenses − base-year expenses)
   - `expense-stop`: SF × max(0, expenses/SF − stop)
   - `none`: 0

   Share = leased SF / rentable SF, with no gross-up, so the landlord carries the expenses on vacant space. Base-year expenses = year-1 expenses × (1+g)^(base year − first calendar year of the analysis).
4. **Rollover (Argus-style blending).** With renewal probability p, each term is the weighted average p × renewal + (1−p) × new: downtime (renewal = 0), free rent months, TI/SF and rent/SF. Leasing commissions are blended in dollars (see 8). Term months are blended the same way and rounded. Renewal rent is market rent, unless the lease has a `RenewalOption` (`fixed` = that $/SF, `percent-of-market` = that share of market). New rent = year-1 market rent × (1+g)^(analysis year in which the next tenant occupies − 1). It steps up once a year, not monthly.
5. **Fractional months.** Blended downtime and free rent can come out fractional. For example, 2.7 months of downtime means months 1–2 are vacant and month 3 is 70% occupied.
6. **Speculative leases** escalate at the new-lease escalation rate on each anniversary of their start. They keep the expiring lease's recovery structure. A base year is reset to the calendar year matching the analysis year the new lease occupies (first calendar year + analysis year − 1). They roll again if they expire within the 132 months. TI and LC are paid in the first occupied month.
7. **Leasing commissions** = p × (renewal LC % × renewal lease value) + (1−p) × (new LC % × new lease value). Lease value = total scheduled base rent over that term, escalated, before free rent.
8. **In-place leases** are those active on `asOf`. Leases that start after `asOf` are not yet modeled.
9. **Vacant suites** stay vacant for `expectedLeaseUpMonths` (or the asset's downtime if that's missing). They then lease on 100% new-tenant terms, at the asking rent if one is set, otherwise market. Recoveries for these suites: office uses base-year (start year); retail and industrial use net.
10. **GPR** includes vacant and downtime months at what they would rent for, and the lost rent appears as absorption/turnover vacancy. Free rent abates base rent only. Recoveries are earned only on occupied SF.
11. **Waterfall signs.** Losses (vacancy, free rent, credit loss) and costs are reported as positive amounts and subtracted.
12. **General vacancy floor** (per year): target = rate × (GPR + recoveries + other income). General vacancy = max(0, target − absorption/turnover vacancy). Credit loss = rate × (GPR − absorption vacancy − free rent + recoveries + other income − general vacancy).
13. **Expenses.** There is one recoverable line, `market.opexPerYear` × RSF (× units for multifamily), grown each analysis year. The management fee = rate × EGI and is not recoverable, which avoids a circular reference. Capital reserves stay flat in $/SF (or $/unit).
14. **Pricing.** Price defaults to year-1 NOI / market cap rate. Total cost = price × (1 + closing costs) + initial capex. Going-in cap = year-1 NOI / price.
15. **Sale.** The exit year (year 11) is normalized before capping: absorption/turnover vacancy and free rent are removed and the full general vacancy rate applies instead (credit loss and management fee recalculate on the new EGI). Recoveries lost to downtime are not added back. Gross sale = normalized year-11 NOI / exit cap. Net sale = gross × (1 − selling costs). The CSV shows both the raw and normalized year-11 columns. The levered cash flow also pays off the loan balance after month 120.
16. **Debt.** Loan = LTV × price. Months 1–24 are interest-only, then a level payment amortizes the loan over 30 years. Loan fee = fee % × loan, paid from equity at t0. Equity = total cost − loan + fee.
17. **Returns.** Unlevered cash flows: t0 = −total cost; years 1–10 = CFBD (+ net sale in year 10). Levered cash flows: t0 = −equity; years 1–10 = CFBD − debt service (+ net sale − payoff in year 10). NPV is unlevered, at the discount rate. The equity multiple is levered (total distributions / equity); there is also an unlevered multiple. Cash-on-cash = levered CF / equity. DSCR = NOI / debt service. Debt yield = year-1 NOI / loan. WALT is measured from `asOf`.
18. **Multifamily.** For each unit type, market rentₜ = market₁ × (1+g)^(t−1). In-place rent closes the loss-to-lease gap as units turn: in-placeₜ = marketₜ − (market₁ − in-place₁) × (1+g)^(t−1) × (1−turnover)^(t−1). GPR = (occupied units × in-place rent + vacant units × market rent) × 12. Other income = $/unit/month × all units × 12, grown with rent. There is no absorption vacancy, so general vacancy applies in full. Turnover cost = units × turnover rate × cost per move-out, grown with expenses, and is shown on the TI line. Reserves = $/unit × units.
