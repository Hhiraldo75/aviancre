import type { ISODate, Property, Sourced, UnderwritingAssumptions } from '../../types'
import { fmt } from '../format'
import { estimate } from '../sourced'
import { defaultAssumptions, isEstimate } from './defaults'
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
      scenario: UnderwritingAssumptions['scenario']
      holdYears: number
      /** Set when any result depends on an estimated assumption; lists them. */
      estimates?: Sourced<unknown>
      sections: SummarySection[]
      warnings: SummaryWarning[]
      /** NOI by hold year, for the projection chart. */
      noiByYear: NOIYear[]
    }
  | { status: 'unavailable'; reason: string }

export const PRICE_ESTIMATE_HINT = 'Model estimate: Year-1 NOI ÷ market cap'

const unavailable = (reason: string): UnderwritingSummary => ({ status: 'unavailable', reason })

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
  const price: Driver[] = [['Purchase price', a.acquisition.purchasePrice]]
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

/**
 * Runs the engine (base scenario unless `assumptions` says otherwise) and
 * maps the result to card stats. Returns `unavailable` with a plain reason
 * instead of throwing or producing NaN.
 */
export function underwritingSummary(
  property: Property,
  asOf: ISODate,
  assumptions?: UnderwritingAssumptions,
): UnderwritingSummary {
  const missing = missingData(property)
  if (missing) return unavailable(missing)

  let result
  try {
    result = underwrite(property, asOf, assumptions ?? defaultAssumptions(property, asOf))
  } catch (e) {
    return unavailable(`The underwriting model couldn’t run: ${e instanceof Error ? e.message : String(e)}`)
  }

  const a = result.assumptions
  const m = result.metrics
  const noi1 = result.cashFlows[0]?.netOperatingIncome ?? NaN
  const priceIsEstimate = isEstimate(a.acquisition.purchasePrice)

  if (!(m.purchasePrice > 0)) {
    return unavailable(
      priceIsEstimate && noi1 <= 0
        ? `Year-1 NOI is negative (${fmt.usd(noi1)}), so the model can’t estimate a price from NOI ÷ market cap. ` +
            'Enter a purchase price in full underwriting.'
        : 'The purchase price must be greater than zero.',
    )
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
    return unavailable('The underwriting model produced invalid figures for this property. Check its rent roll and market data.')
  }

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
    scenario: a.scenario,
    holdYears: H,
    // Every stat's drivers fall within these groups.
    estimates: estimatedFrom(d.basis, d.noiOverHold, d.sale, d.debt),
    sections,
    warnings: result.warnings.map((full) => ({ short: firstSentence(full), full })),
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
