import type { ISODate, Property, SensitivityGrid, UnderwritingResult } from '../../types'
import { fmt } from '../format'
import { occupancy } from '../metrics'
import { isEstimate } from './defaults'
import { DEFAULTS_SET, memoMarker, setSummary } from './assumptionSets'
import { defaultsFor, editableFields, fieldValue, isEdited, type AssumptionEdits, type AssumptionGroupTitle } from './edits'
import { rentRollView, type ExpirationRow, type RentRollRow } from './fullView'
import { maxBid, MAX_BID_RANGE } from './maxBid'
import { cashFlowRows } from './report'
import { METRIC_LABELS, SENSITIVITY_CAPTION, sensitivityGrids, sensitivityView } from './sensitivity'
import { maxBidStat } from './summary'
import { DEBT_YIELD_FLOOR, DSCR_FLOOR, MARK_TO_MARKET_THRESHOLD, ROLLOVER_CONCENTRATION } from './underwrite'
import { operatingCashFlows } from './waterfall'

/**
 * Machine-readable underwriting for the AI analyst (`npm run underwrite -- <id> --json`).
 * Every figure a memo may cite is here with the app's display string, including
 * the spreads, ranges and differences the review checklist needs, so the
 * analyst quotes figures and never calculates them.
 */

export const AI_LABEL_SAMPLE = 'AI-generated analysis of sample data. All figures from the AVIANCRE engine.'
export const AI_LABEL = 'AI-generated analysis. All figures from the AVIANCRE engine.'

/** A number and how the app shows it. `value` is null when the engine can't compute it. */
export interface Figure {
  value: number | null
  display: string
}

export interface ExportAssumption {
  group: AssumptionGroupTitle
  key: string
  label: string
  value: number
  display: string
  /** "estimated", "imported" or "public". */
  source: string
  /** What the value is, or what should replace it if it's an estimate. */
  sourceName: string
  notes?: string
  /** Still a model default (EST badge in the app). */
  isEstimate: boolean
  edited: boolean
  default: string
}

/** A grid cell, named by its row and column labels as the app shows them. */
export interface GridCellRef {
  row: string
  column: string
  display: string
}

export interface ExportGrid {
  title: string
  metric: string
  rowTitle: string
  columnTitle: string
  /** e.g. "7.25% (Current)", "7.75% (+50 bps)". */
  rows: string[]
  columns: string[]
  /** cells[row][column]. */
  cells: string[][]
  center: GridCellRef
  low: GridCellRef | null
  high: GridCellRef | null
}

const fig = (value: number | null, display: string): Figure => ({ value, display })
const usd = (x: number) => fig(Math.round(x), fmt.usd(x))
const pct = (x: number | null, digits = 2) => fig(x, x === null ? '—' : fmt.pct(x, digits))
const multiple = (x: number | null) => fig(x, x === null ? '—' : fmt.multiple(x))
/** A difference between two rates, in basis points. */
const bps = (x: number | null) => {
  if (x === null) return fig(null, '—')
  const n = Math.round(x * 10_000)
  return fig(n, `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)} bps`)
}
const signed = (x: number | null) => fig(x, x === null ? '—' : fmt.signedPct(x))

/**
 * `set` names the assumption set `r` was run at (its edits, as applied); the
 * memo quotes its summary and copies its marker so the app can compare.
 */
export function analystExport(
  property: Property,
  asOf: ISODate,
  r: UnderwritingResult,
  set: { name: string; edits: AssumptionEdits } = { name: DEFAULTS_SET, edits: {} },
) {
  const a = r.assumptions
  const assumptions = assumptionsSection(property, asOf, r)
  const m = r.metrics
  const H = r.cashFlows.length
  const noi1 = r.cashFlows[0].netOperatingIncome
  const hasDebt = m.loanAmount > 0
  const bid = maxBid(property, asOf, a)
  const bidStat = maxBidStat(bid)

  return {
    meta: {
      label: property.isSample ? AI_LABEL_SAMPLE : AI_LABEL,
      engine: 'AVIANCRE underwriting engine (docs/UNDERWRITING.md)',
      generatedAt: r.generatedAt,
      asOf,
      analysisStart: a.acquisition.analysisStartDate,
      holdYears: H,
      scenario: a.scenario,
      isSample: property.isSample,
      units:
        'Rates are decimals (0.065 = 6.5%); bps figures are basis points; dollars are whole USD. ' +
        'Quote the display strings: they match the app.',
      assumptionSet: {
        name: set.name,
        /** The memo's header line, verbatim. */
        summary: setSummary(set.name, assumptions.edited.length),
        /** Each changed assumption with its default, for the Underwriting assumptions section. */
        changes: assumptions.edited,
        /** Copy this line verbatim into the memo (directly under the header); the app reads it and never shows it. */
        marker: memoMarker(set.name, set.edits),
      },
    },
    property: {
      id: property.id,
      name: property.name,
      assetType: property.assetType,
      buildingClass: property.buildingClass,
      address: `${property.location.address}, ${property.location.city}, ${property.location.state}`,
      submarket: property.location.submarket,
      rentableSF: fig(property.physical.rentableSF.value, fmt.sf(property.physical.rentableSF.value)),
      yearBuilt: property.physical.yearBuilt?.value ?? null,
      units: property.rentRoll.kind === 'multifamily' ? property.rentRoll.unitTypes.reduce((s, u) => s + u.unitCount, 0) : undefined,
    },
    rentRoll: rentRollSection(property, asOf, r),
    assumptions,
    cashFlows: {
      note: 'Whole dollars. Losses and costs are positive amounts. Occupancy is a decimal.',
      columns: ['Year 0', ...r.cashFlows.map((c) => `Year ${c.year}`), `Year ${H + 1} (forward, raw)`, `Year ${r.normalizedExitYear.year} (normalized for sale)`],
      rows: cashFlowRows(r).map((row) => ({
        label: row.label.trim(),
        values: row.values.map((v) => (v === null ? null : row.key ? Math.round(v) : Math.round(v * 10_000) / 10_000)),
      })),
    },
    returns: {
      purchasePrice: usd(m.purchasePrice),
      purchasePriceSource: a.acquisition.purchasePrice.sourceName,
      pricePerSF: fig(m.pricePerSF, `${fmt.usd(m.pricePerSF)}/SF`),
      totalCost: usd(m.totalCost),
      year1NOI: usd(noi1),
      goingInCapRate: pct(m.goingInCapRate),
      unleveredIRR: pct(m.unleveredIRR),
      leveredIRR: pct(m.leveredIRR),
      targetLeveredIRR: pct(a.targetLeveredIRR.value, 1),
      /** Levered IRR − target. */
      leveredIRRVsTarget: bps(m.leveredIRR === null ? null : m.leveredIRR - a.targetLeveredIRR.value),
      unleveredMultiple: multiple(m.unleveredEquityMultiple),
      leveredMultiple: multiple(m.equityMultiple),
      npv: { ...usd(m.npv), discountRate: pct(a.discountRate.value) },
      averageCashOnCash: pct(m.averageCashOnCash),
      cashOnCashByYear: m.cashOnCashByYear.map((x) => pct(x, 1)),
      exit: {
        exitNOIRaw: usd(m.exitNOIRaw),
        exitNOINormalized: usd(m.exitNOI),
        /** Normalized − raw: what normalization adds back (rollover vacancy and free rent swapped for general vacancy). */
        normalizationDifference: usd(m.exitNOI - m.exitNOIRaw),
        normalizationDifferencePct: signed(m.exitNOIRaw ? m.exitNOI / m.exitNOIRaw - 1 : null),
        exitCapRate: pct(a.exit.exitCapRate.value),
        /** Exit cap − going-in cap. */
        goingInVsExitCapSpread: bps(a.exit.exitCapRate.value - m.goingInCapRate),
        grossSaleValue: usd(m.exitValue),
        sellingCosts: usd(m.sellingCosts),
        netSaleProceeds: usd(m.netSaleProceeds),
        loanPayoff: usd(m.loanPayoff),
        netProceedsToEquity: usd(m.netSaleProceeds - m.loanPayoff),
      },
    },
    debt: {
      enabled: hasDebt,
      loanAmount: usd(m.loanAmount),
      equityRequired: usd(m.equityRequired),
      ltv: pct(hasDebt ? a.debt.ltv.value : 0, 0),
      interestRate: pct(a.debt.rate.type === 'fixed' ? a.debt.rate.rate.value : null),
      interestOnlyYears: a.debt.interestOnlyYears.value,
      amortizationYears: a.debt.amortizationYears.value,
      loanConstant: pct(m.loanConstant),
      debtYield: pct(m.debtYield),
      debtYieldFloor: pct(DEBT_YIELD_FLOOR, 0),
      minimumDSCR: multiple(m.minimumDSCR),
      minimumDSCRYear: m.minimumDSCR === null ? null : m.dscrByYear.indexOf(m.minimumDSCR) + 1,
      dscrFloor: multiple(DSCR_FLOOR),
      dscrByYear: m.dscrByYear.map(multiple),
      debtServiceByYear: r.cashFlows.map((c) => usd(c.debtService)),
      /** Going-in cap below the loan constant: debt lowers the yearly cash yield. */
      negativeLeverage: m.loanConstant !== null && m.goingInCapRate < m.loanConstant,
      /** Going-in cap − loan constant. */
      goingInCapVsLoanConstant: bps(m.loanConstant === null ? null : m.goingInCapRate - m.loanConstant),
    },
    warnings: r.warnings,
    notes: r.notes,
    sensitivity: sensitivitySection(property, asOf, r),
    maxBid: {
      label: bidStat.label,
      status: bid.status,
      target: pct(bid.target, 1),
      searchRange: `${MAX_BID_RANGE[0] * 100}% to ${MAX_BID_RANGE[1] * 100}% of the current price`,
      ...(bid.status === 'ok'
        ? {
            price: usd(bid.price),
            priceShort: bidStat.value,
            pricePerSF: fig(bid.pricePerSF, `${fmt.usd(bid.pricePerSF)}/SF`),
            goingInCapRate: pct(bid.goingInCapRate),
            vsCurrentPrice: signed(bid.vsCurrentPct),
            leveredIRR: pct(bid.leveredIRR),
          }
        : { reason: bid.reason }),
    },
  }
}

export type AnalystExport = ReturnType<typeof analystExport>

function rentRollSection(property: Property, asOf: ISODate, r: UnderwritingResult) {
  const m = r.metrics
  const occ = pct(occupancy(property, asOf), 1)
  const inPlaceVsMarket = signed(m.inPlaceVsMarket)
  const rr = property.rentRoll
  if (rr.kind === 'multifamily') {
    return {
      kind: 'multifamily' as const,
      occupancy: occ,
      inPlaceRent: fig(m.inPlaceRent, m.inPlaceRent === null ? '—' : `${fmt.usd(m.inPlaceRent)}/unit/mo`),
      marketRent: fig(m.marketRent, `${fmt.usd(m.marketRent)}/unit/mo`),
      inPlaceVsMarket,
      markToMarketThreshold: pct(MARK_TO_MARKET_THRESHOLD, 0),
      unitMix: rr.unitTypes.map((u) => ({
        label: u.label,
        units: u.unitCount,
        occupied: u.occupiedUnits,
        avgSF: u.avgSF,
        marketRent: `${fmt.usd(u.marketRentMonthly.value)}/mo`,
        inPlaceRent: u.inPlaceRentMonthly ? `${fmt.usd(u.inPlaceRentMonthly.value)}/mo` : 'not given (market assumed)',
      })),
    }
  }

  const view = rentRollView(property, r, asOf)
  if (view.kind !== 'commercial') throw new Error('expected a commercial rent roll')
  const rsf = property.physical.rentableSF.value
  const total = r.expirations.totalSF
  const peak = total.reduce((best, sf, i) => (sf > total[best] ? i : best), 0)
  const perSF = (x: number) => `${fmt.usdCents(x)}/SF`
  const options = operatingCashFlows(property, r.assumptions, asOf).aboveMarketOptions

  return {
    kind: 'commercial' as const,
    occupancy: occ,
    walt: fig(m.walt, m.walt === null ? '—' : fmt.years(m.walt)),
    inPlaceRent: fig(m.inPlaceRent, m.inPlaceRent === null ? '—' : perSF(m.inPlaceRent)),
    marketRent: fig(m.marketRent, `${perSF(m.marketRent)} (Year 1)`),
    inPlaceVsMarket,
    markToMarketThreshold: pct(MARK_TO_MARKET_THRESHOLD, 0),
    /** Rows as the app's rent roll tab shows them; market rent is projected to each lease's expiration year. */
    leases: view.rows.map(({ id: _id, vsMarketTone: _tone, ...row }): Omit<RentRollRow, 'id' | 'vsMarketTone'> => row),
    totals: view.totals,
    /** SF expiring by hold year: in-place leases, and in-place plus re-leased space rolling again. */
    expirations: view.expirations satisfies ExpirationRow[],
    largestRollover: {
      year: peak + 1,
      sf: fig(total[peak], fmt.sf(total[peak])),
      shareOfBuilding: pct(rsf ? total[peak] / rsf : null, 1),
      threshold: pct(ROLLOVER_CONCENTRATION, 0),
      yearsAboveThreshold: total.flatMap((sf, i) => (rsf && sf / rsf > ROLLOVER_CONCENTRATION ? [i + 1] : [])),
    },
    /** Fixed renewal options above projected market at expiration; the model assumes renewal at market. */
    aboveMarketRenewalOptions: options.map((o) => ({
      tenant: o.tenant,
      suite: o.suite,
      expiration: o.expirationDate,
      optionRent: perSF(o.optionRentPerSF),
      projectedMarketRent: perSF(o.marketRentPerSF),
      optionVsMarket: fmt.signedPct(o.optionRentPerSF / o.marketRentPerSF - 1),
    })),
  }
}

function assumptionsSection(property: Property, asOf: ISODate, r: UnderwritingResult) {
  const a = r.assumptions
  const defaults = defaultsFor(property, asOf)
  const items = editableFields(a).map((f): ExportAssumption => {
    const v = fieldValue(a, f.key)
    return {
      group: f.group,
      key: f.key,
      label: f.label,
      value: v.value,
      display: f.format(v.value),
      source: v.source,
      sourceName: v.sourceName,
      ...(v.notes ? { notes: v.notes } : {}),
      isEstimate: isEstimate(v),
      edited: isEdited(v),
      default: f.format(fieldValue(defaults, f.key).value),
    }
  })
  return {
    items,
    /** Labels of every assumption still at an estimated default. */
    estimated: items.filter((x) => x.isEstimate).map((x) => x.label),
    edited: items.filter((x) => x.edited).map((x) => `${x.label} ${x.display} (default ${x.default})`),
    settings: [
      { label: 'Analysis start', display: fmt.monthYear(a.acquisition.analysisStartDate) },
      ...(a.multifamily ? [] : [{ label: 'Vacant space recovery', display: fmt.label(a.leasing.vacantSpaceRecovery) }]),
      { label: 'Debt', display: a.debt.enabled ? 'On' : 'Off' },
      { label: 'Exit NOI', display: a.exit.capForwardNOI ? 'Forward year (hold + 1)' : 'Final hold year' },
    ],
  }
}

function sensitivitySection(property: Property, asOf: ISODate, r: UnderwritingResult) {
  const grids = sensitivityGrids(property, asOf, r.assumptions)
  return {
    caption: SENSITIVITY_CAPTION,
    grids: [exportGrid('Exit cap × rent growth', grids.exitCapByRentGrowth), exportGrid('Purchase price × exit cap', grids.priceByExitCap)],
    /** NOI falling in a rent-growth case below expense growth; a levered IRR range above 5 points across rent growth. */
    warnings: grids.warnings,
  }
}

function exportGrid(title: string, g: SensitivityGrid): ExportGrid {
  const v = sensitivityView(g, 'leveredIRR')
  const rows = v.rows.map((x) => `${x.value} (${x.delta})`)
  const columns = v.columns.map((x) => `${x.value} (${x.delta})`)
  const ref = (i: number, j: number): GridCellRef => ({
    row: `${v.rowTitle} ${rows[i]}`,
    column: `${v.columnTitle} ${columns[j]}`,
    display: v.cells[i][j].text,
  })
  const cells = g.cells.flatMap((row, i) => row.map((c, j) => ({ i, j, x: c.metrics.leveredIRR, center: c.center })))
  const computed = cells.filter((c) => c.x !== null)
  const pick = (better: (x: number, y: number) => boolean) =>
    computed.length ? computed.reduce((best, c) => (better(c.x!, best.x!) ? c : best)) : null
  const low = pick((x, y) => x < y)
  const high = pick((x, y) => x > y)
  const center = cells.find((c) => c.center)!

  return {
    title,
    metric: METRIC_LABELS.leveredIRR,
    rowTitle: v.rowTitle,
    columnTitle: v.columnTitle,
    rows,
    columns,
    cells: v.cells.map((row) => row.map((c) => c.text)),
    center: ref(center.i, center.j),
    low: low && ref(low.i, low.j),
    high: high && ref(high.i, high.j),
  }
}
