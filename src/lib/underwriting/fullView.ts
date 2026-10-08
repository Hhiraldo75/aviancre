import type {
  Escalation,
  ISODate,
  Lease,
  MultifamilyRentRoll,
  Property,
  Recovery,
  Sourced,
  UnderwritingAssumptions,
  UnderwritingResult,
} from '../../types'
import { fmt } from '../format'
import { activeLeases, currentRentPerSF, occupancy, yearsBetween } from '../metrics'
import { cashFlowRows, type LineKey } from './report'
import {
  PRICE_ESTIMATE_HINT,
  assumptionEstimates,
  runUnderwriting,
  summaryWarnings,
  type SummaryStat,
  type SummaryWarning,
} from './summary'
import { DSCR_FLOOR } from './underwrite'

/**
 * Display-ready tables for the full underwriting view. Like the summary, this
 * formats engine output and adds no new financial math.
 */

export interface TableRow {
  label: string
  /** Engine values in report convention: losses and costs are positive amounts. */
  values: (number | null)[]
  cells: string[]
}

export interface CashFlowRow extends TableRow {
  key: LineKey
  kind: 'line' | 'subtotal' | 'detail'
}

export interface CashFlowTable {
  columns: string[]
  rows: CashFlowRow[]
}

export interface RentRollRow {
  id: string
  vacant: boolean
  suite: string
  tenant: string
  sf: string
  pctOfBuilding: string
  start: string
  end: string
  /** Remaining term for a lease; lease-up months for a vacant suite. */
  remaining: string
  rent: string
  market: string
  vsMarket: string
  vsMarketTone?: 'above' | 'below'
  escalation: string
  recovery: string
  renewalOption: string
}

export interface ExpirationRow {
  year: string
  inPlaceSF: string
  inPlacePct: string
  totalSF: string
  totalPct: string
}

export type RentRollView =
  | {
      kind: 'commercial'
      rows: RentRollRow[]
      totals: { sf: string; pctOfBuilding: string; occupancy: string; walt: string; rent: string; market: string; vsMarket: string }
      expirations: ExpirationRow[]
    }
  | { kind: 'unit-mix'; rentRoll: MultifamilyRentRoll }

export interface LineItem {
  label: string
  value: string
  kind?: 'deduction' | 'total'
}

export interface ReturnsView {
  sources: LineItem[]
  uses: LineItem[]
  debt: SummaryStat[]
  /** Debt service, DSCR and cash-on-cash by hold year. */
  debtByYear: { columns: string[]; rows: { label: string; cells: string[] }[] }
  sale: LineItem[]
  returns: SummaryStat[]
  /** Unlevered and levered IRR streams, Year 0..N. */
  cashFlows: { columns: string[]; rows: TableRow[] }
}

export interface AssumptionItem {
  label: string
  value: string
  /** Absent for plain model settings, which carry no source badge. */
  src?: Sourced<unknown>
  note: string
}

export interface AssumptionGroup {
  title: 'Acquisition' | 'Leasing' | 'Operating' | 'Debt' | 'Exit'
  items: AssumptionItem[]
}

export type FullUnderwriting =
  | {
      status: 'ok'
      result: UnderwritingResult
      header: {
        name: string
        scenario: UnderwritingAssumptions['scenario']
        isSample: boolean
        estimates?: Sourced<unknown>
        metrics: SummaryStat[]
        warnings: SummaryWarning[]
        /** Footnotes, e.g. that the price is a model estimate. */
        notes: string[]
      }
      cashFlow: CashFlowTable
      rentRoll: RentRollView
      returns: ReturnsView
      assumptions: AssumptionGroup[]
    }
  | { status: 'unavailable'; reason: string }

const SUBTOTALS: LineKey[] = ['effectiveGrossIncome', 'netOperatingIncome', 'cashFlowBeforeDebt', 'cashFlowAfterDebt']
/** Lines shown in parentheses: the engine reports them as positive amounts. */
const DEDUCTIONS: LineKey[] = [
  'absorptionTurnoverVacancy',
  'freeRent',
  'generalVacancy',
  'creditLoss',
  'operatingExpenses',
  'managementFee',
  'tenantImprovements',
  'leasingCommissions',
  'capitalReserves',
  'debtService',
  'loanPayoff',
]

const cell = (key: LineKey, v: number | null) => (v === null ? '' : fmt.accounting(DEDUCTIONS.includes(key) ? -v : v))
const pctOrDash = (x: number | null, digits = 2) => (x === null ? '—' : fmt.pct(x, digits))
/** Percent with trailing zeros dropped: 1.5%, 6.5%, 7.25%. */
const pctShort = (x: number) => `${Number((x * 100).toFixed(2))}%`

/** Runs the engine and maps the result to the four tabs. */
export function fullUnderwriting(property: Property, asOf: ISODate, assumptions?: UnderwritingAssumptions): FullUnderwriting {
  const run = runUnderwriting(property, asOf, assumptions)
  if (run.status === 'unavailable') return run
  const r = run.result
  const a = r.assumptions
  const m = r.metrics
  const lowDSCR = m.minimumDSCR !== null && m.minimumDSCR < DSCR_FLOOR

  return {
    status: 'ok',
    result: r,
    header: {
      name: property.name,
      scenario: a.scenario,
      isSample: property.isSample,
      estimates: assumptionEstimates(property, a),
      metrics: [
        {
          label: 'Purchase price',
          value: fmt.money(m.purchasePrice),
          hint: a.acquisition.purchasePrice.source === 'estimated' ? PRICE_ESTIMATE_HINT : a.acquisition.purchasePrice.sourceName,
        },
        { label: 'Going-in cap', value: fmt.pct(m.goingInCapRate, 2) },
        { label: 'Unlevered IRR', value: pctOrDash(m.unleveredIRR) },
        { label: 'Levered IRR', value: pctOrDash(m.leveredIRR) },
        {
          label: 'Minimum DSCR',
          value: m.minimumDSCR === null ? '—' : fmt.multiple(m.minimumDSCR),
          hint: lowDSCR ? `Below ${fmt.multiple(DSCR_FLOOR)} lender floor` : undefined,
          tone: lowDSCR ? 'warn' : undefined,
        },
      ],
      warnings: summaryWarnings(r.warnings),
      notes: r.notes,
    },
    cashFlow: cashFlowTable(r),
    rentRoll: rentRollView(property, r, asOf),
    returns: returnsView(r),
    assumptions: assumptionGroups(a),
  }
}

/** Years 1..N, the raw forward year and the normalized exit year; GPR through cash flow after debt. */
export function cashFlowTable(r: UnderwritingResult): CashFlowTable {
  const H = r.cashFlows.length
  const all = cashFlowRows(r)
  const last = all.findIndex((row) => row.key === 'cashFlowAfterDebt')
  const rows = all.slice(0, last + 1).flatMap((row): CashFlowRow[] => {
    const key = row.key
    if (!key) return []
    const values = row.values.slice(1) // drop Year 0
    return [
      {
        label: row.label.trim(),
        key,
        kind: SUBTOTALS.includes(key) ? 'subtotal' : key === 'managementFee' ? 'detail' : 'line',
        values,
        cells: values.map((v) => cell(key, v)),
      },
    ]
  })
  return {
    columns: [...r.cashFlows.map((c) => `Year ${c.year}`), `Year ${H + 1} raw`, `Year ${r.normalizedExitYear.year} normalized`],
    rows,
  }
}

function escalationText(e: Escalation): string {
  switch (e.type) {
    case 'fixed-percent':
      return `${pctShort(e.annualPct)}/yr`
    case 'fixed-amount':
      return `${fmt.usdCents(e.annualPerSF)}/SF/yr`
    case 'steps':
      return `${e.steps.length} steps`
    case 'none':
      return 'Flat'
  }
}

function recoveryText(r: Recovery): string {
  switch (r.method) {
    case 'net':
      return r.adminFeePct ? `Net + ${pctShort(r.adminFeePct)} admin` : 'Net'
    case 'base-year':
      return `Base year ${r.baseYear}`
    case 'expense-stop':
      return `Stop ${fmt.usdCents(r.stopPerSF)}/SF`
    case 'none':
      return 'None'
  }
}

function renewalOptionText(l: Lease): string {
  const [o, ...more] = l.renewalOptions ?? []
  if (!o) return '—'
  const rent = o.rentBasis === 'fixed' ? `${fmt.usdCents(o.value)}/SF` : `${pctShort(o.value)} of market`
  return `${o.termMonths / 12} yr at ${rent}${more.length ? ` (+${more.length} more)` : ''}`
}

const bySuite = (x: { suite: string }, y: { suite: string }) => x.suite.localeCompare(y.suite, 'en', { numeric: true })

export function rentRollView(property: Property, r: UnderwritingResult, asOf: ISODate): RentRollView {
  const rr = property.rentRoll
  if (rr.kind === 'multifamily') return { kind: 'unit-mix', rentRoll: rr }
  const m = r.metrics
  const rsf = property.physical.rentableSF.value
  const market = r.assumptions.leasing.marketRent.value
  const share = (sf: number) => fmt.pct(sf / rsf, 1)
  const leases = activeLeases(property, asOf)

  const leaseRows = leases.map((l): RentRollRow => {
    const rent = currentRentPerSF(l, asOf)
    const vs = rent / market - 1
    return {
      id: l.id,
      vacant: false,
      suite: l.suite,
      tenant: l.tenantName,
      sf: fmt.int(l.leasedSF),
      pctOfBuilding: share(l.leasedSF),
      start: fmt.monthYear(l.commencementDate),
      end: fmt.monthYear(l.expirationDate),
      remaining: fmt.years(yearsBetween(asOf, l.expirationDate)),
      rent: fmt.usdCents(rent),
      market: fmt.usdCents(market),
      vsMarket: fmt.signedPct(vs),
      vsMarketTone: vs > 0 ? 'above' : vs < 0 ? 'below' : undefined,
      escalation: escalationText(l.escalation),
      recovery: `${l.leaseType === 'NNN' ? 'NNN' : fmt.label(l.leaseType)} · ${recoveryText(l.recovery)}`,
      renewalOption: renewalOptionText(l),
    }
  })
  const vacantRows = rr.vacancies.map(
    (v): RentRollRow => ({
      id: v.id,
      vacant: true,
      suite: v.suite,
      tenant: 'Vacant',
      sf: fmt.int(v.sf),
      pctOfBuilding: share(v.sf),
      start: '—',
      end: '—',
      remaining: `Lease-up ${v.expectedLeaseUpMonths ?? r.assumptions.leasing.downtimeMonths.value} mo`,
      rent: v.askingRentPerSF ? `${fmt.usdCents(v.askingRentPerSF.value)} ask` : '—',
      market: fmt.usdCents(market),
      vsMarket: '—',
      escalation: '—',
      recovery: '—',
      renewalOption: '—',
    }),
  )

  const totalSF = leases.reduce((s, l) => s + l.leasedSF, 0) + rr.vacancies.reduce((s, v) => s + v.sf, 0)
  return {
    kind: 'commercial',
    rows: [...leaseRows, ...vacantRows].sort(bySuite),
    totals: {
      sf: fmt.int(totalSF),
      pctOfBuilding: share(totalSF),
      occupancy: fmt.pct(occupancy(property, asOf), 1),
      walt: m.walt === null ? '—' : fmt.years(m.walt),
      rent: m.inPlaceRent === null ? '—' : fmt.usdCents(m.inPlaceRent),
      market: fmt.usdCents(m.marketRent),
      vsMarket: m.inPlaceVsMarket === null ? '—' : fmt.signedPct(m.inPlaceVsMarket),
    },
    expirations: r.expirations.totalSF.map((total, i) => {
      const inPlace = r.expirations.inPlaceSF[i]
      return {
        year: `Year ${i + 1}`,
        inPlaceSF: inPlace ? fmt.int(inPlace) : '–',
        inPlacePct: inPlace ? share(inPlace) : '–',
        totalSF: total ? fmt.int(total) : '–',
        totalPct: total ? share(total) : '–',
      }
    }),
  }
}

export function returnsView(r: UnderwritingResult): ReturnsView {
  const a = r.assumptions
  const m = r.metrics
  const H = r.cashFlows.length
  const hasDebt = m.loanAmount > 0
  const usd = fmt.usd
  /** Deductions in parentheses, like the cash flow table. */
  const neg = (x: number) => `(${usd(x)})`
  const exitYear = r.normalizedExitYear.year
  const rate = a.debt.rate.type === 'fixed' ? fmt.pct(a.debt.rate.rate.value, 2) : 'Floating'
  const streams = cashFlowRows(r).filter((row) => row.key === 'unleveredCashFlow' || row.key === 'leveredCashFlow')

  return {
    sources: [
      { label: `Loan (${pctShort(hasDebt ? a.debt.ltv.value : 0)} LTV)`, value: usd(m.loanAmount) },
      { label: 'Equity', value: usd(m.equityRequired) },
      { label: 'Total sources', value: usd(m.loanAmount + m.equityRequired), kind: 'total' },
    ],
    uses: [
      { label: 'Purchase price', value: usd(m.purchasePrice) },
      { label: `Closing costs (${pctShort(a.acquisition.closingCostsPct.value)})`, value: usd(m.closingCosts) },
      { label: 'Initial capex', value: usd(a.acquisition.initialCapex.value) },
      { label: `Loan fee (${pctShort(hasDebt ? a.debt.loanFeesPct.value : 0)})`, value: usd(m.loanFee) },
      { label: 'Total uses', value: usd(m.totalCost + m.loanFee), kind: 'total' },
    ],
    debt: [
      { label: 'Loan amount', value: hasDebt ? usd(m.loanAmount) : 'No debt' },
      { label: 'Interest rate', value: hasDebt ? rate : '—' },
      { label: 'Interest-only', value: hasDebt ? `${a.debt.interestOnlyYears.value} yrs` : '—' },
      { label: 'Amortization', value: hasDebt ? `${a.debt.amortizationYears.value} yrs` : '—' },
      { label: 'Debt yield', value: pctOrDash(m.debtYield), hint: 'Year-1 NOI ÷ loan' },
      { label: 'Loan constant', value: pctOrDash(m.loanConstant), hint: 'Amortizing debt service ÷ loan' },
    ],
    debtByYear: {
      columns: r.cashFlows.map((c) => `Year ${c.year}`),
      rows: [
        { label: 'Debt service', cells: r.cashFlows.map((c) => (hasDebt ? fmt.accounting(-c.debtService) : '—')) },
        { label: 'DSCR', cells: r.cashFlows.map((_, i) => (hasDebt ? fmt.multiple(m.dscrByYear[i]) : '—')) },
        { label: 'Cash-on-cash', cells: m.cashOnCashByYear.map((x) => fmt.pct(x, 1)) },
      ],
    },
    sale: [
      { label: `Year-${exitYear} NOI (raw)`, value: usd(m.exitNOIRaw) },
      { label: `Year-${exitYear} NOI (normalized, used for sale)`, value: usd(m.exitNOI) },
      { label: 'Exit cap rate', value: fmt.pct(a.exit.exitCapRate.value, 2) },
      { label: 'Gross sale value', value: usd(m.exitValue) },
      { label: `Less: selling costs (${pctShort(a.exit.sellingCostsPct.value)})`, value: neg(m.sellingCosts), kind: 'deduction' },
      { label: 'Net sale proceeds', value: usd(m.netSaleProceeds), kind: 'total' },
      { label: 'Less: loan payoff', value: hasDebt ? neg(m.loanPayoff) : '—', kind: 'deduction' },
    ],
    returns: [
      { label: 'Unlevered IRR', value: pctOrDash(m.unleveredIRR) },
      { label: 'Levered IRR', value: pctOrDash(m.leveredIRR) },
      { label: 'Unlevered multiple', value: fmt.multiple(m.unleveredEquityMultiple) },
      { label: 'Levered multiple', value: fmt.multiple(m.equityMultiple) },
      { label: `NPV @ ${fmt.pct(a.discountRate.value, 2)}`, value: usd(m.npv), hint: 'Unlevered cash flows' },
    ],
    cashFlows: {
      columns: Array.from({ length: H + 1 }, (_, i) => `Year ${i}`),
      rows: streams.map((row) => {
        const values = row.values.slice(0, H + 1)
        return { label: row.label, values, cells: values.map((v) => (v === null ? '' : fmt.accounting(v))) }
      }),
    },
  }
}

const note = (s: Sourced<unknown>) => [s.sourceName, s.notes].filter(Boolean).join(' · ')
const sourced = (label: string, s: Sourced<number>, format: (x: number) => string): AssumptionItem => ({
  label,
  value: format(s.value),
  src: s,
  note: note(s),
})
const setting = (label: string, value: string): AssumptionItem => ({ label, value, note: 'Model setting' })
const months = (x: number) => `${Number(x.toFixed(1))} mo`
const years = (x: number) => `${x} yrs`

/** Every assumption the engine reads, grouped for the read-only Assumptions tab. */
export function assumptionGroups(a: UnderwritingAssumptions): AssumptionGroup[] {
  const isMF = a.multifamily !== undefined
  const rent = (x: number) => (isMF ? fmt.rentPerUnit(x) : `${fmt.usdCents(x)}/SF/yr`)
  const { acquisition: acq, leasing: l, operating: op, debt, exit } = a

  const leasing: AssumptionItem[] = [
    sourced('Market rent (Year 1)', l.marketRent, rent),
    sourced('Market rent growth', l.marketRentGrowth, pctShort),
  ]
  if (a.multifamily) {
    leasing.push(
      sourced('Turnover rate', a.multifamily.turnoverRate, pctShort),
      sourced('Turnover cost', a.multifamily.turnoverCostPerUnit, (x) => `${fmt.usd(x)}/move-out`),
    )
  } else {
    const terms = (who: string, t: typeof l.newLease): AssumptionItem[] => [
      sourced(`${who} term`, t.termMonths, (x) => years(x / 12)),
      sourced(`${who} free rent`, t.freeRentMonths, months),
      sourced(`${who} TI`, t.tiPerSF, (x) => `${fmt.usdCents(x)}/SF`),
      sourced(`${who} leasing commission`, t.leasingCommissionPct, pctShort),
    ]
    leasing.push(
      sourced('New-lease escalation', l.newLeaseEscalationPct, (x) => `${pctShort(x)}/yr`),
      sourced('Renewal probability', l.renewalProbability, pctShort),
      sourced('Downtime (new tenant)', l.downtimeMonths, months),
      ...terms('New lease', l.newLease),
      ...terms('Renewal', l.renewal),
      setting('Vacant space recovery', fmt.label(l.vacantSpaceRecovery)),
    )
  }

  return [
    {
      title: 'Acquisition',
      items: [
        sourced('Purchase price', acq.purchasePrice, fmt.usd),
        sourced('Closing costs', acq.closingCostsPct, pctShort),
        sourced('Initial capex', acq.initialCapex, fmt.usd),
        sourced('Hold period', acq.holdYears, years),
        setting('Analysis start', fmt.monthYear(acq.analysisStartDate)),
      ],
    },
    { title: 'Leasing', items: leasing },
    {
      title: 'Operating',
      items: [
        sourced('General vacancy', op.generalVacancyPct, pctShort),
        sourced('Credit loss', op.creditLossPct, pctShort),
        ...op.expenses.map((e) => ({
          ...sourced(e.label, e.annualAmount, (x) => `${fmt.usd(x)}/yr`),
          note: `${note(e.annualAmount)} · ${e.recoverable ? 'recoverable' : 'not recoverable'}`,
        })),
        sourced('Expense growth', op.expenseGrowth, pctShort),
        sourced('Management fee (% of EGI)', op.managementFeePct, pctShort),
        sourced('Capital reserves', op.capitalReservesPerYear, (x) => (isMF ? `${fmt.usd(x)}/unit/yr` : `${fmt.usdCents(x)}/SF/yr`)),
      ],
    },
    {
      title: 'Debt',
      items: [
        setting('Debt', debt.enabled ? 'On' : 'Off'),
        sourced('Loan-to-value', debt.ltv, pctShort),
        debt.rate.type === 'fixed'
          ? sourced('Interest rate (fixed)', debt.rate.rate, (x) => fmt.pct(x, 2))
          : sourced(`Spread over ${debt.rate.index}`, debt.rate.spreadBps, (x) => `${x} bps`),
        sourced('Amortization', debt.amortizationYears, years),
        sourced('Interest-only period', debt.interestOnlyYears, years),
        sourced('Loan fees', debt.loanFeesPct, pctShort),
      ],
    },
    {
      title: 'Exit',
      items: [
        sourced('Exit cap rate', exit.exitCapRate, (x) => fmt.pct(x, 2)),
        sourced('Selling costs', exit.sellingCostsPct, pctShort),
        setting('Exit NOI', exit.capForwardNOI ? 'Forward year (hold + 1)' : 'Final hold year'),
        sourced('Discount rate (NPV)', a.discountRate, pctShort),
      ],
    },
  ]
}
