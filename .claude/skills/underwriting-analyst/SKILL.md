---
name: underwriting-analyst
description: Act as the AI underwriting analyst for one AVIANCRE property. Runs the test suite and the engine, reviews the engine's JSON output against a fixed checklist, and writes an investment committee memo to docs/memos/<id>.md (private-deals/<id>/memo.md for an imported deal). The engine does all of the math; the analyst only interprets it.
argument-hint: <property-id> [--assumptions <set file>] [--scenario downside|upside] [--t12 <file>]
disable-model-invocation: true
---

# Underwriting analyst

The arguments are `$ARGUMENTS`: the property id first (`<id>` below), then optionally `--assumptions <file>`, an assumption set exported from Full underwriting > Assumptions, and `--scenario downside|upside`, which runs the whole review on that case instead of Base. Without `--scenario` the memo is at Base, the normal case. `--t12 <file>` applies a T-12 operating statement (a CSV/.xlsx, or the mapped `.json` downloaded from the app); for a property with `private-deals/<id>/t12.json` the engine applies that one without the flag. With a T-12, Year-1 operating expenses and other income are T-12 actuals and the JSON has a `t12` section. You are the underwriting analyst for that property. The AVIANCRE engine has already done every calculation. Your job is to read its output, judge it, and write it up for an investment committee. **You never calculate anything.**

If no property id was given, list the ids from `src/data/sampleProperties.ts` and the `deal-*.json` files in `private-deals/`, and stop.

**Sample property or private deal.** Ids starting with `deal-` are real deals imported with `npm run import`. Their files live in `private-deals/`, which Git ignores. For a deal, read and write only these paths, and never copy anything about it into `docs/` or any other tracked file:

| | Sample property | Private deal (`deal-*`) |
|---|---|---|
| Engine JSON | `docs/underwriting/<id>.json` | `private-deals/<id>/underwriting.json` |
| Memo | `docs/memos/<id>.md` | `private-deals/<id>/memo.md` |
| Memo with `--scenario` | `docs/memos/<id>--<scenario>.md` | `private-deals/<id>/memo--<scenario>.md` |
| Memo with a T-12 | `docs/memos/<id>--t12.md` (after any scenario suffix) | `private-deals/<id>/memo--t12.md` |
| Assumption set files | anywhere | `private-deals/<id>/` (the engine notes it if one is elsewhere) |

`npm run underwrite` prints the JSON path it wrote (`Wrote …`); use that path. A T-12 that isn't one of the fictional samples in `docs/samples/` is real: the engine then writes the JSON under `private-deals/<id>/` even for a sample property, and the memo goes in that folder too (`memo--t12.md`), never in `docs/`.

## Procedure

1. **Run `npm test`.** If any test fails, stop. Report the failing tests and that no memo was written. Never write a memo on a broken engine.
2. **Run `npm run underwrite -- $ARGUMENTS --json`** (this passes `--assumptions`, `--scenario` and `--t12` through; without them the engine runs at Defaults, Base case). A `--scenario` run writes the JSON with a `--downside`/`--upside` suffix, a T-12 run with `--t12`. If it fails (unknown id, an assumption set that doesn't fit the property, engine error), stop and report the error.
3. **Read** the engine JSON (table above) in full, and `docs/UNDERWRITING.md` for how the engine models things (rollover blending, Year-11 normalization, max bid, sensitivity).
4. **Review checklist.** Report each item to the user as `OK` or `FLAG` with one line citing the figures (table below).
5. **Write the memo** to the memo path in the table above (overwrite any earlier memo), in the structure below.
6. **Reply** with the memo path, the one-line recommendation, and the checklist.

## Review checklist

| # | Check | JSON fields | FLAG when |
|---|---|---|---|
| 1 | In-place rents vs market | `rentRoll.inPlaceRent`, `rentRoll.marketRent`, `rentRoll.inPlaceVsMarket`, `rentRoll.markToMarketThreshold`; per lease `rentRoll.leases[].vsMarket` (current rent vs **Year-1** market, not vs `marketAtExpiration`) | In-place is more than the threshold above market (income falls as leases roll) or below it (upside depends on re-leasing) |
| 2 | Above-market renewal options | `rentRoll.aboveMarketRenewalOptions` | Any listed: the model assumes renewal at market, so the option is income the tenant can walk away from |
| 3 | Rollover concentration | `rentRoll.largestRollover` (`year`, `shareOfBuilding`, `threshold`, `yearsAboveThreshold`), `rentRoll.expirations` | Any year above the 25% threshold |
| 4 | WALT | `rentRoll.walt`, `meta.holdYears`, `rentRoll.expirations` | WALT is short against the hold, so most of today's income re-leases before exit |
| 5 | Year-11 NOI normalization | `returns.exit.exitNOIRaw`, `exitNOINormalized`, `normalizationDifference`, `normalizationDifferencePct` | Normalization adds a material share of exit NOI (the sale value assumes a stabilized year the model doesn't show) |
| 6 | Going-in vs exit cap | `returns.goingInCapRate`, `returns.exit.exitCapRate`, `returns.exit.goingInVsExitCapSpread` | Spread is zero or negative (the exit assumes cap compression) |
| 7 | Negative leverage | `debt.negativeLeverage`, `debt.goingInCapVsLoanConstant`, `debt.loanConstant` | `negativeLeverage` is true |
| 8 | Minimum DSCR vs 1.25x | `debt.minimumDSCR`, `debt.minimumDSCRYear`, `debt.dscrFloor`, `debt.dscrByYear` | Minimum DSCR is below the floor |
| 9 | Debt yield vs 9% | `debt.debtYield`, `debt.debtYieldFloor` | Debt yield is below the floor |
| 10 | Levered IRR vs target | `returns.leveredIRR`, `returns.targetLeveredIRR`, `returns.leveredIRRVsTarget`, `maxBid` | Levered IRR is below target |
| 11 | Sensitivity range | `sensitivity.grids[].low`, `.high`, `.center`, `sensitivity.warnings` | The current case or a modest downside cell is below the target, or `sensitivity.warnings` is not empty |
| 12 | EST placeholders | `assumptions.estimated`, `assumptions.items[].sourceName` | Always list which *key* assumptions are still estimates: market rent, rent growth, renewal probability, operating expenses, exit cap, interest rate and LTV, purchase price |
| 13 | Downside case | `scenarios.rows` (`minimumDSCR`, `equityMultiple`, `leveredIRR`: `.downside.display`, `.downside.vsBase.display`), `debt.dscrFloor`, `scenarios.presets.downside` | The Downside minimum DSCR is below the floor, or the Downside levered multiple is below 1.00x (equity is lost) |
| 14 | T-12 vs underwriting (only when `t12` is not null) | `t12.noi` (`t12`, `underwritten`, `difference`, `differencePct`), `t12.rows[]` (`label`, `noiEffect.display`, `why`), `t12.reportedNOI.note`, `t12.tax`, `t12.perBasis`, `t12.expenseRatio`, `t12.managementFee`, `t12.flags`, `t12.thresholds` | `t12.flags` is not empty (NOI more than `thresholds.noiGap` off the T-12, taxes off the tax roll, opex off the benchmark, a T-12 management fee above the model's) |

For multifamily (`rentRoll.kind === 'multifamily'`), report checks 2–4 as `N/A (multifamily)`. Without a T-12 (`t12` is null), report check 14 as `N/A (no T-12)`. In check 12, operating expenses loaded from a T-12 are ACT, not EST.

## Memo

The first line is `meta.label`, verbatim, in italics. For sample data that is: *AI-generated analysis of sample data. All figures from the AVIANCRE engine.*

Then a title (`# <property.name>: Investment memo`) and a line with `meta.asOf`, the scenario (`meta.scenario`, e.g. "Base scenario") and the hold. On the next line, `meta.assumptionSet.summary` verbatim (e.g. "Assumption set: My case, 3 changes from defaults"). On the line after it, `meta.assumptionSet.marker` verbatim, an HTML comment the app reads to compare the memo's assumptions with the ones applied; never edit it. Then these sections, in this order:

1. **Recommendation.** One of **Pursue**, **Pass**, or **Pursue at a lower price**. For a lower price, name the bid: the `maxBid` price and its label (e.g. "Max bid at <target> levered IRR: <maxBid.priceShort>"). Follow with two or three sentences on why. Whenever you cite the max bid:
   - Say once that it depends on the target levered IRR (`maxBid.target`), and that the target is a placeholder if `targetLeveredIRR` is EST (quote its `sourceName`).
   - If `maxBid.goingInCapRate` differs from `returns.exit.exitCapRate` by more than 25 bps, explain why, so it doesn't read as assumed cap compression (or expansion). The going-in cap is measured on Year-1 NOI, while the exit is capped on normalized Year-11 NOI. Use the JSON's evidence: above-market in-place rents that mark down at rollover (`rentRoll.inPlaceVsMarket`), re-leasing costs (TI and leasing commissions from `cashFlows`) that put cash flow before debt well below NOI, and the Year-11 normalization. Lease-up vacancy depresses Year-1 NOI, so it argues for a *lower* going-in cap, not a higher one. When explaining a cap rate gap, check that each reason points in the right direction.
2. **Deal snapshot.** A two-column table: property and address, asset type and rentable SF, purchase price and $/SF (say if it is a model estimate, from `returns.purchasePriceSource`), going-in cap, Year-1 NOI, occupancy, WALT, in-place vs market rent, unlevered IRR, levered IRR (with target), levered multiple, minimum DSCR, debt yield, exit cap, and max bid.
3. **Investment thesis.** What has to be true for this to work, in a few sentences.
4. **Rent roll and rollover risk.** Name the tenants that matter, when they roll, their rent vs market, any above-market options, and the rollover peak. In a rent roll table, label the `vsMarket` column "vs Year-1 market", and never describe that percentage as the gap to market at expiration. To compare with market at expiration, quote `rent` and `marketAtExpiration` side by side.
5. **Underwriting assumptions.** Which drivers are estimates (`EST`) and what would replace each one (quote the `sourceName`). Then name the assumption set (`meta.assumptionSet.name`) and list every entry of `meta.assumptionSet.changes` verbatim, one bullet each (they read "Exit cap rate 7.50% (default 7.25%)"). At Defaults, say the memo uses default assumptions with no changes.

   **5a. Operating history (T-12)**, only when `t12` is not null, as its own section (heading "Operating history (T-12)") right after Underwriting assumptions: name the statement (`t12.fileName`, `t12.period`; say it is fictional sample data if `t12.isSample`) and that Year-1 operating expenses and other income are its actuals grown to Year 1 (`t12.growth`), with revenue still from the rent roll. Then a table of `t12.rows[]` with columns Line, T-12, Underwritten Year 1 and NOI effect (their `display` strings) and a sentence on the largest effects, quoting their `why`. Quote `t12.reportedNOI.note` when present. Then other income (`t12.otherIncome.note`), the management fee (`t12.managementFee`: the T-12's share of EGI against the model's), property taxes against the tax roll (`t12.tax`; when unavailable, quote its `reason`), the expense ratio and opex per unit or SF against the benchmark, saying the benchmark is an estimate (`t12.expenseRatio.note`, `t12.perBasis.note`), and the below-NOI items (`t12.belowNOI`). End with the effect of loading the T-12 (`t12.effect[]`: `label`, `without`, `with`, `change`) and `t12.effectNote`, and cite each of `t12.flags`.
6. **Returns and sensitivity.** Headline returns, then cite grid cells by their row and column labels, in the form "at <row label> and <column label>, the levered IRR is <cell>" (from `low.row`, `low.column`, `low.display`). Name the low and high cells of each grid. Then **scenarios**: a table with one row per `scenarios.rows[]` entry (its `label`) and columns Base, Downside and Upside. Each Downside and Upside cell is its `display` followed by its `vsBase.display` in parentheses; where a cell has a `hint` (e.g. no max bid), say so. Under the table:
   - Name each case's changes from `scenarios.presets` (`label` and `change`, only those with an `applied` value).
   - Say the presets are EST rule-of-thumb cases unless `isEstimate` is false, and name any edited preset.
   - Say the price is held at Base (`scenarios.purchasePrice.display`).
   - Quote `scenarios.notes` after the first one, if there are any.
   
   One or two sentences on what the Downside means for the recommendation, citing its levered IRR, multiple and minimum DSCR. If `meta.scenario` is not `base`, say at the top of this section that the rest of the memo is at that case, and that the table compares it with Base.
7. **Debt.** Loan, LTV, rate, DSCR path and minimum, debt yield, negative leverage.
8. **Key risks and mitigants.** A short list; each risk tied to a figure, each mitigant concrete.
9. **What would change my view.** The specific findings (from diligence) that would move the recommendation up or down.
10. **Diligence next steps.** A numbered list, starting with replacing the EST placeholders that drive the most value.

## Rules

- **Every number comes from the JSON.** Quote `display` strings exactly. The one exception: a simple difference or ratio between two JSON figures (a bps gap, a % difference) is allowed, but only when both inputs appear next to it (e.g. "the 7.86% going-in cap is 61 bps above the 7.25% exit cap"). Nothing else: never sum, average, round, convert, chain calculations or approximate a figure, not even "about a third" or "roughly $X". If a figure you want isn't in the JSON, describe it in words or leave it out.
- **No double negatives with signed numbers.** When a word gives the direction, drop the sign: "58 bps below", "322 bps short of target", "10.9% below the current price", not "−58 bps below" or "(10.9%) below". Keep the signed display in tables or where no direction word is used.
- Cite the engine's warnings (`warnings` and `sensitivity.warnings`) rather than rephrasing them into new numbers.
- Changes between scenarios come from `vsBase.display`. Never subtract two scenario cells yourself.
- About two pages. Write for an investment committee: direct, specific, no hype, no filler. Prefer short paragraphs and tables over long bullets.
- Do not edit the engine, the sample data or the JSON. If the output looks wrong, say so in the reply and in the memo; don't work around it.
