import type { ISODate, Property, Sourced, UnderwritingAssumptions, UnderwritingResult } from '../../types'
import { fmt } from '../format'
import { estimate } from '../sourced'
import { isEstimate } from './defaults'
import { assumptionChanges, assumptionsFor, defaultsFor, type AssumptionEdits } from './edits'
import { maxBid, type MaxBid } from './maxBid'
import { DSCR_FLOOR, underwrite } from './underwrite'

/**
 * Display-ready summary of a base-scenario underwriting run, for the
 * Investment view card. Formats and validates engine output; no new math.
 */

export interface SummaryStat {
  label: string
  value: string
  hint?: string
  tone?: 'good' | 'warn'
  /** EST badge, only on the cap rates; the card notes estimates once for everything else. */
  src?: Sourced<unknown>
}

export interface SummaryWarning {
  /** First sentence of the engine warning, for a bullet. */
  short: string
  /** The engine warning as written, for the tooltip. */
  full: string
}

export interface NOIYear {
  year: number
  noi: number
  /** Income lost to lease rollover: absorption/turnover vacancy plus free rent. */
  lostToRollover: number
  /** e.g. "Year 4: NOI $302,232 · lost to rollover $28,444" */
  tooltip: string
}

export interface SummarySection {
  title: string
  stats: SummaryStat[]
}

export type UnderwritingSummary =
  | {
      status: 'ok'
      isSample: boolean
      /** Set for a deal imported from a rent roll file. */
      importedFrom?: Property['importedFrom']
      scenario: UnderwritingAssumptions['scenario']
      holdYears: number
      /** Set when any result depends on an estimated assumption; lists them. */
      estimates?: Sourced<unknown>
      /** Edited assumptions, e.g. "Exit cap rate 7.50% (default 7.25%)"; empty at defaults. */
      changes: string[]
      sections: SummarySection[]
      warnings: SummaryWarning[]
      /** NOI by hold year, for the projection chart. */
      noiByYear: NOIYear[]
    }
  | { status: 'unavailable'; reason: string }

export const PRICE_ESTIMATE_HINT = 'Model estimate at default assumptions: Year-1 NOI ÷ market cap'

/** First sentence of a warning: splits at a period followed by a capitalized word. */
const firstSentence = (text: string) => text.split(/(?<=\.)\s+(?=[A-Z])/)[0]

const multiple = (x: number) => `${x.toFixed(2)}x`
const pctOrDash = (x: number | null, digits = 2) => (x === null ? '—' : fmt.pct(x, digits))

/** Reasons the engine can't run on a property, checked before running it. */
function missingData(p: Property): string | null {
  if (!(p.physical.rentableSF?.value > 0)) return 'This property has no rentable SF, so it can’t be underwritten.'
  if (!(p.market.marketCapRate?.value > 0)) return 'There is no market cap rate for this property to price it from.'
  const rr = p.rentRoll
  const empty =
    rr.kind === 'commercial'
      ? rr.leases.length + rr.vacancies.length === 0
      : rr.unitTypes.reduce((s, u) => s + u.unitCount, 0) === 0
  if (empty) return 'The rent roll is empty, so there is no income to underwrite.'
  return null
}

type Driver = [name: string, value: Sourced<unknown>]

/** The assumptions behind each stat, grouped so stats can share them. */
function driverGroups(p: Property, a: UnderwritingAssumptions) {
  const price: Driver[] = [
    ['Purchase price', a.acquisition.purchasePrice],
    // An estimated price is set by the market cap rate.
    ...(isEstimate(a.acquisition.purchasePrice) ? [['Market cap rate', a.acquisition.marketCapRate] as Driver] : []),
  ]
  const yearOneNOI: Driver[] = [
    ...a.operating.expenses.map((e): Driver => [e.label, e.annualAmount]),
    ['General vacancy', a.operating.generalVacancyPct],
    ['Credit loss', a.operating.creditLossPct],
    ['Management fee', a.operating.managementFeePct],
  ]
  const rollover: Driver[] =
    p.rentRoll.kind === 'commercial'
      ? [
          ['Renewal probability', a.leasing.renewalProbability],
          ['Downtime', a.leasing.downtimeMonths],
          ['New-lease TI', a.leasing.newLease.tiPerSF],
          ['New-lease free rent', a.leasing.newLease.freeRentMonths],
        ]
      : a.multifamily
        ? [
            ['Turnover rate', a.multifamily.turnoverRate],
            ['Turnover cost', a.multifamily.turnoverCostPerUnit],
          ]
        : []
  const noiOverHold: Driver[] = [
    ...yearOneNOI,
    ['Market rent', a.leasing.marketRent],
    ['Market rent growth', a.leasing.marketRentGrowth],
    ['Expense growth', a.operating.expenseGrowth],
    ...rollover,
  ]
  const exitCap: Driver[] = [['Exit cap rate', a.exit.exitCapRate]]
  const sale: Driver[] = [...exitCap, ['Selling costs', a.exit.sellingCostsPct]]
  const basis: Driver[] = [
    ...price,
    ['Closing costs', a.acquisition.closingCostsPct],
    ['Initial capex', a.acquisition.initialCapex],
    ['Hold period', a.acquisition.holdYears],
  ]
  const debt: Driver[] = [
    ['Target levered IRR', a.targetLeveredIRR],
    ['LTV', a.debt.ltv],
    ...(a.debt.rate.type === 'fixed' ? [['Interest rate', a.debt.rate.rate] as Driver] : []),
    ['Amortization', a.debt.amortizationYears],
    ['Interest-only period', a.debt.interestOnlyYears],
    ['Loan fees', a.debt.loanFeesPct],
  ]
  return { price, yearOneNOI, noiOverHold, exitCap, sale, basis, debt }
}

/** EST badge source listing the estimated assumptions behind a value, or undefined if none are. */
function estimatedFrom(...groups: Driver[][]): Sourced<unknown> | undefined {
  const seen = new Set<string>()
  const est = groups.flat().filter(([name, v]) => {
    if (seen.has(name) || !isEstimate(v)) return false
    seen.add(name)
    return true
  })
  if (est.length === 0) return undefined
  return estimate(null, `Driven by estimates: ${est.map(([name]) => name.toLowerCase()).join(', ')}`, {
    notes: est.map(([name, v]) => `${name}: ${v.sourceName}`).join('\n'),
  })
}

export type UnderwritingRun = { status: 'ok'; result: UnderwritingResult } | { status: 'unavailable'; reason: string }

/** Full assumptions, or analyst edits to apply to the defaults. */
export type AssumptionsInput = UnderwritingAssumptions | AssumptionEdits

const isAssumptions = (x: AssumptionsInput): x is UnderwritingAssumptions => 'acquisition' in x && typeof x.acquisition === 'object'

/** Last run per assumptions object, so views sharing assumptions share one engine run. */
const runCache = new WeakMap<UnderwritingAssumptions, { property: Property; asOf: ISODate; run: UnderwritingRun }>()

/**
 * Runs the engine (base scenario unless the assumptions say otherwise) and
 * checks its headline figures. Returns `unavailable` with a plain reason
 * instead of throwing or producing NaN.
 */
export function runUnderwriting(property: Property, asOf: ISODate, input: AssumptionsInput = {}): UnderwritingRun {
  const missing = missingData(property)
  if (missing) return { status: 'unavailable', reason: missing }

  let a: UnderwritingAssumptions
  try {
    a = isAssumptions(input) ? input : assumptionsFor(property, asOf, input)
  } catch (e) {
    return engineError(e)
  }
  const hit = runCache.get(a)
  if (hit && hit.property === property && hit.asOf === asOf) return hit.run
  const run = checkedRun(property, asOf, a)
  runCache.set(a, { property, asOf, run })
  return run
}

const engineError = (e: unknown): UnderwritingRun => ({
  status: 'unavailable',
  reason: `The underwriting model couldn’t run: ${e instanceof Error ? e.message : String(e)}`,
})

function checkedRun(property: Property, asOf: ISODate, assumptions: UnderwritingAssumptions): UnderwritingRun {
  let result
  try {
    result = underwrite(property, asOf, assumptions)
  } catch (e) {
    return engineError(e)
  }

  const a = result.assumptions
  const m = result.metrics
  const noi1 = result.cashFlows[0]?.netOperatingIncome ?? NaN

  if (!(m.purchasePrice > 0)) {
    return {
      status: 'unavailable',
      reason:
        isEstimate(a.acquisition.purchasePrice) && noi1 <= 0
          ? `Year-1 NOI is negative (${fmt.usd(noi1)}), so the model can’t estimate a price from NOI ÷ market cap. ` +
            'Enter a purchase price in full underwriting.'
          : 'The purchase price must be greater than zero.',
    }
  }

  const headline = [
    noi1,
    m.pricePerSF,
    m.goingInCapRate,
    m.equityMultiple,
    m.unleveredEquityMultiple,
    m.exitNOI,
    m.netSaleProceeds,
    m.unleveredIRR,
    m.leveredIRR,
    m.minimumDSCR,
    m.debtYield,
    m.averageCashOnCash,
  ]
  if (headline.some((x) => x !== null && !Number.isFinite(x))) {
    return {
      status: 'unavailable',
      reason: 'The underwriting model produced invalid figures for this property. Check its rent roll and market data.',
    }
  }
  return { status: 'ok', result }
}

/** EST source listing every estimated assumption behind the results, or undefined if none are. */
export function assumptionEstimates(property: Property, a: UnderwritingAssumptions): Sourced<unknown> | undefined {
  const d = driverGroups(property, a)
  // Every stat's drivers fall within these groups.
  return estimatedFrom(d.basis, d.noiOverHold, d.sale, d.debt)
}

/** Edited assumptions with their defaults, for the "Assumptions changed" chip. */
export function changesFrom(property: Property, asOf: ISODate, a: UnderwritingAssumptions): string[] {
  return assumptionChanges(a, defaultsFor(property, asOf))
}

/** "Max bid at 10% levered IRR": the price, with $/SF, implied cap and the gap to the current price. */
export function maxBidStat(bid: MaxBid): SummaryStat {
  const label = `Max bid at ${fmt.pctShort(bid.target)} levered IRR`
  if (bid.status === 'none') return { label, value: '—', hint: bid.reason }
  return {
    label,
    value: fmt.money(bid.price),
    hint: `${fmt.usd(bid.pricePerSF)}/SF · ${fmt.pct(bid.goingInCapRate, 2)} cap · ${fmt.signedPct(bid.vsCurrentPct)} vs price`,
  }
}

/** Engine warnings as bullets: first sentence shown, full text kept for the tooltip. */
export function summaryWarnings(warnings: string[]): SummaryWarning[] {
  return warnings.map((full) => ({ short: firstSentence(full), full }))
}

/** Runs the engine and maps the result to card stats. */
export function underwritingSummary(property: Property, asOf: ISODate, input?: AssumptionsInput): UnderwritingSummary {
  const run = runUnderwriting(property, asOf, input)
  if (run.status === 'unavailable') return run
  const result = run.result
  const a = result.assumptions
  const m = result.metrics
  const noi1 = result.cashFlows[0].netOperatingIncome
  const priceIsEstimate = isEstimate(a.acquisition.purchasePrice)

  const d = driverGroups(property, a)
  const H = a.acquisition.holdYears.value
  const hold = `${H}-yr hold`
  const lowDSCR = m.minimumDSCR !== null && m.minimumDSCR < DSCR_FLOOR

  const sections: SummarySection[] = [
    {
      title: 'Pricing',
      stats: [
        {
          label: 'Purchase price',
          value: fmt.money(m.purchasePrice),
          hint: priceIsEstimate ? PRICE_ESTIMATE_HINT : a.acquisition.purchasePrice.sourceName,
        },
        maxBidStat(maxBid(property, asOf, a)),
        { label: 'Price / SF', value: `${fmt.usd(m.pricePerSF)}/SF` },
        { label: 'Going-in cap', value: fmt.pct(m.goingInCapRate, 2), src: estimatedFrom(d.price, d.yearOneNOI) },
        { label: 'Year-1 NOI', value: fmt.money(noi1) },
      ],
    },
    {
      title: 'Returns',
      stats: [
        {
          label: 'Unlevered IRR',
          value: pctOrDash(m.unleveredIRR),
          hint: hold,
        },
        {
          label: 'Levered IRR',
          value: pctOrDash(m.leveredIRR),
          hint: hold,
        },
        { label: 'Unlevered multiple', value: multiple(m.unleveredEquityMultiple) },
        { label: 'Levered multiple', value: multiple(m.equityMultiple) },
      ],
    },
    {
      title: 'Debt',
      stats: [
        {
          label: 'Minimum DSCR',
          value: m.minimumDSCR === null ? '—' : multiple(m.minimumDSCR),
          hint: lowDSCR ? `Below ${multiple(DSCR_FLOOR)} lender floor` : undefined,
          tone: lowDSCR ? 'warn' : undefined,
        },
        { label: 'Debt yield', value: pctOrDash(m.debtYield) },
        { label: 'Avg cash-on-cash', value: pctOrDash(m.averageCashOnCash), hint: hold },
      ],
    },
    {
      title: 'Exit',
      stats: [
        {
          label: `Normalized Year-${result.normalizedExitYear.year} NOI`,
          value: fmt.money(m.exitNOI),
          hint: 'General vacancy replaces rollover',
        },
        { label: 'Exit cap', value: fmt.pct(a.exit.exitCapRate.value, 2), src: estimatedFrom(d.exitCap) },
        {
          label: 'Net sale proceeds',
          value: fmt.money(m.netSaleProceeds),
          hint: `After ${fmt.pct(a.exit.sellingCostsPct.value, 0)} selling costs`,
        },
      ],
    },
  ]

  return {
    status: 'ok',
    isSample: property.isSample,
    importedFrom: property.importedFrom,
    scenario: a.scenario,
    holdYears: H,
    estimates: assumptionEstimates(property, a),
    changes: changesFrom(property, asOf, a),
    sections,
    warnings: summaryWarnings(result.warnings),
    noiByYear: result.cashFlows.map((c) => {
      const lost = c.absorptionTurnoverVacancy + c.freeRent
      return {
        year: c.year,
        noi: c.netOperatingIncome,
        lostToRollover: lost,
        tooltip: `Year ${c.year}: NOI ${fmt.money(c.netOperatingIncome)}${lost > 0 ? ` · lost to rollover ${fmt.money(lost)}` : ''}`,
      }
    }),
  }
}
