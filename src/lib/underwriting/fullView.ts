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
import { bySF } from '../unitRentRoll'
import { activeLeases, currentRentPerSF, occupancy, yearsBetween } from '../metrics'
import { RULE_OF_THUMB } from './defaults'
import { defaultsFor, editableFields, fieldValue, formatInput, isEdited, type AssumptionField, type AssumptionGroupTitle } from './edits'
import { cashFlowRows, type LineKey } from './report'
import { maxBid, type MaxBid } from './maxBid'
import { marketRentInYear } from './rollover'
import {
  PRICE_ESTIMATE_HINT,
  assumptionEstimates,
  changesFrom,
  maxBidStat,
  runUnderwriting,
  summaryWarnings,
  type AssumptionsInput,
  type SummaryStat,
  type SummaryWarning,
} from './summary'
import { analysisYear, monthAfter } from './timeline'
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
  /** The year after the hold, shown raw and normalized. */
  exitYear: number
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
  /** Remaining term from the analysis start for a lease; lease-up months for a vacant suite. */
  remaining: string
  rent: string
  /** Market rent in the year the lease expires (the lease-up year for a vacant suite). */
  marketAtExpiration: string
  vsMarket: string
  vsMarketTone?: 'above' | 'below'
  escalation: string
  recovery: string
  renewalOption: string
}

/** One floor plan of an apartment rent roll; rents are $/unit/month. */
export interface UnitMixRow {
  id: string
  floorPlan: string
  units: string
  occupied: string
  vacant: string
  /** Vacant units with a signed applicant ("—" without a unit rent roll). */
  preLeased: string
  avgSF: string
  /** Average over all units. */
  market: string
  /** Average over occupied units. */
  inPlace: string
  /** Market − in-place per occupied unit, its share of their market rent, and the yearly total. */
  lossToLease: string
  lossToLeasePct: string
  lossToLeaseAnnual: string
}

export interface ExpirationRow {
  year: string
  inPlaceSF: string
  inPlacePct: string
  totalSF: string
  totalPct: string
}

/** SF expiring in a hold year, for the lease expirations chart. */
export interface ExpirationBar {
  year: number
  inPlaceSF: number
  /** Modeled re-leased space that rolls again within the hold. */
  releasedSF: number
  /** e.g. "Year 3: 12,400 SF expiring (24.8% of building) · in-place 10,000 SF (20.0%) · re-leased 2,400 SF (4.8%)" */
  tooltip: string
}

export type RentRollView =
  | {
      kind: 'commercial'
      /** Where the leases came from: ACT for an imported rent roll, EST for a sample. */
      source: Pick<Sourced<unknown>, 'source' | 'sourceName'>
      rows: RentRollRow[]
      totals: {
        sf: string
        pctOfBuilding: string
        occupancy: string
        walt: string
        rent: string
        /** Year-1 market rent, which "vs market" compares against. */
        market: string
        vsMarket: string
      }
      expirations: ExpirationRow[]
      expirationChart: ExpirationBar[]
    }
  | {
      kind: 'unit-mix'
      /** ACT for an imported rent roll, EST for a sample. */
      source: Pick<Sourced<unknown>, 'source' | 'sourceName'>
      /** True for a unit rent roll, which knows which vacant units are pre-leased. */
      byUnit: boolean
      rows: UnitMixRow[]
      totals: UnitMixRow
    }

export interface LineItem {
  label: string
  value: string
  kind?: 'deduction' | 'total'
}

export interface CashFlowBar {
  year: number
  noi: number
  beforeDebt: number
  afterDebt: number
  /** e.g. "Year 3: NOI $302,232 · before debt $281,000 · after debt $95,400" */
  tooltip: string
}

export interface DSCRPoint {
  year: number
  dscr: number
  belowFloor: boolean
  tooltip: string
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
  /** NOI and cash flow before and after debt, by hold year. */
  cashFlowChart: CashFlowBar[]
  /** DSCR by hold year against the lender floor; null without debt. */
  dscrChart: { floor: number; points: DSCRPoint[] } | null
}

export interface AssumptionEdit {
  field: AssumptionField
  /** Current engine value. */
  value: number
  defaultValue: number
  /** What the input box shows for the current value. */
  input: string
  /** e.g. "default 7.25%" */
  defaultText: string
  edited: boolean
}

export interface AssumptionItem {
  label: string
  value: string
  /** Absent for plain model settings, which carry no source badge. */
  src?: Sourced<unknown>
  /** Source note; empty when the legend or the group note already says it. */
  note: string
  /** Present for editable numeric assumptions. */
  edit?: AssumptionEdit
}

export interface AssumptionGroup {
  title: AssumptionGroupTitle
  /** A source note shared by several items in the group, shown once. */
  note?: string
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
        /** Set for a deal imported from a rent roll file. */
        importedFrom?: Property['importedFrom']
        estimates?: Sourced<unknown>
        /** Edited assumptions with their defaults; empty at defaults. */
        changes: string[]
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
  'lossToLease',
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
const pctShort = fmt.pctShort

/** Runs the engine (defaults plus any analyst edits) and maps the result to the four tabs. */
export function fullUnderwriting(property: Property, asOf: ISODate, input?: AssumptionsInput): FullUnderwriting {
  const run = runUnderwriting(property, asOf, input)
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
      importedFrom: property.importedFrom,
      estimates: assumptionEstimates(property, a),
      changes: changesFrom(property, asOf, a),
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
    returns: returnsView(r, maxBid(property, asOf, a)),
    assumptions: assumptionGroups(a, defaultsFor(property, asOf)),
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
    exitYear: H + 1,
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
      return r.baseYearExpenses === undefined
        ? `Base year ${r.baseYear}`
        : `Base year ${r.baseYear} (${fmt.usdCompact(r.baseYearExpenses)})`
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
  if (rr.kind === 'multifamily') return unitMixView(rr)
  const m = r.metrics
  const { leasing, acquisition } = r.assumptions
  const start = acquisition.analysisStartDate
  const rsf = property.physical.rentableSF.value
  const market = leasing.marketRent.value
  const share = (sf: number) => fmt.pct(sf / rsf, 1)
  const leases = activeLeases(property, asOf)
  /** Market rent in the analysis year of month m, as the engine prices rollover. */
  const marketInMonth = (m: number) => fmt.usdCents(marketRentInYear(leasing, analysisYear(Math.max(0, Math.floor(m)))))

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
      remaining: fmt.years(Math.max(0, yearsBetween(start, l.expirationDate))),
      rent: fmt.usdCents(rent),
      // The first month the lease no longer covers: when the space re-leases.
      marketAtExpiration: marketInMonth(monthAfter(start, l.expirationDate)),
      vsMarket: fmt.signedPct(vs),
      vsMarketTone: vs > 0 ? 'above' : vs < 0 ? 'below' : undefined,
      escalation: escalationText(l.escalation),
      recovery: `${l.leaseType === 'NNN' ? 'NNN' : fmt.label(l.leaseType)} · ${recoveryText(l.recovery)}`,
      renewalOption: renewalOptionText(l),
    }
  })
  const vacantRows = rr.vacancies.map((v): RentRollRow => {
    const leaseUp = v.expectedLeaseUpMonths ?? leasing.downtimeMonths.value
    return {
      id: v.id,
      vacant: true,
      suite: v.suite,
      tenant: 'Vacant',
      sf: fmt.int(v.sf),
      pctOfBuilding: share(v.sf),
      start: '—',
      end: '—',
      remaining: `Lease-up ${leaseUp} mo`,
      rent: v.askingRentPerSF ? `${fmt.usdCents(v.askingRentPerSF.value)} ask` : '—',
      marketAtExpiration: marketInMonth(leaseUp),
      vsMarket: '—',
      escalation: '—',
      recovery: '—',
      renewalOption: '—',
    }
  })

  const totalSF = leases.reduce((s, l) => s + l.leasedSF, 0) + rr.vacancies.reduce((s, v) => s + v.sf, 0)
  const first = rr.leases[0]
  return {
    kind: 'commercial',
    source: first ? { source: first.source, sourceName: first.sourceName } : property.physical.rentableSF,
    rows: [...leaseRows, ...vacantRows].sort(bySuite),
    totals: {
      sf: fmt.int(totalSF),
      pctOfBuilding: share(totalSF),
      occupancy: fmt.pct(occupancy(property, asOf), 1),
      walt: m.walt === null ? '—' : fmt.years(m.walt),
      rent: m.inPlaceRent === null ? '—' : fmt.usdCents(m.inPlaceRent),
      market: `Yr 1 ${fmt.usdCents(m.marketRent)}`,
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
    expirationChart: r.expirations.totalSF.map((total, i) => {
      const inPlace = r.expirations.inPlaceSF[i]
      const released = total - inPlace
      const sfShare = (sf: number) => `${fmt.int(sf)} SF (${share(sf)})`
      const kind =
        inPlace && released
          ? [`in-place ${sfShare(inPlace)}`, `re-leased ${sfShare(released)}`]
          : [inPlace ? 'in-place leases' : 're-leased space']
      const parts = [`${fmt.int(total)} SF expiring (${share(total)} of building)`, ...kind]
      return {
        year: i + 1,
        inPlaceSF: inPlace,
        releasedSF: released,
        tooltip: `Year ${i + 1}: ${total ? parts.join(' · ') : 'no leases expire'}`,
      }
    }),
  }
}

interface PlanTotals {
  units: number
  occupied: number
  /** Pre-leased units: vacant with a signed applicant, or on notice with the next resident signed. */
  preLeasedVacant: number
  onNotice: number
  sf: number
  market: number
  /** Sums over occupied units. */
  occupiedMarket: number
  inPlace: number
  /** Occupied units with an in-place rent. */
  rented: number
}

/**
 * The unit mix with loss to lease per floor plan. A unit rent roll is summed
 * unit by unit; a unit-type rent roll uses each type's averages (in-place
 * assumed at market when missing, so no loss to lease).
 */
/** "4 (3 vacant, 1 on notice)": every pre-leased unit, like the import's totals check. */
function preLeasedCount(t: PlanTotals): string {
  const parts = [
    ...(t.preLeasedVacant ? [`${fmt.int(t.preLeasedVacant)} vacant`] : []),
    ...(t.onNotice ? [`${fmt.int(t.onNotice)} on notice`] : []),
  ]
  const total = fmt.int(t.preLeasedVacant + t.onNotice)
  return parts.length ? `${total} (${parts.join(', ')})` : total
}

function unitMixView(rr: MultifamilyRentRoll): RentRollView {
  // Sorted here too, for deals saved before the import sorted them.
  const plans = bySF(rr.unitTypes).map((u): [string, string, PlanTotals] => {
    const units = rr.units?.filter((x) => x.floorPlan === u.id)
    const occupied = units?.filter((x) => x.occupied)
    const market = u.marketRentMonthly.value
    const inPlace = u.inPlaceRentMonthly?.value
    const totals: PlanTotals = units
      ? {
          units: units.length,
          occupied: occupied!.length,
          preLeasedVacant: units.filter((x) => !x.occupied && x.preLeased).length,
          onNotice: occupied!.filter((x) => x.preLeased).length,
          sf: units.reduce((s, x) => s + x.sf, 0),
          market: units.reduce((s, x) => s + x.marketRentMonthly, 0),
          occupiedMarket: occupied!.reduce((s, x) => s + x.marketRentMonthly, 0),
          inPlace: occupied!.reduce((s, x) => s + x.inPlaceRentMonthly, 0),
          rented: occupied!.length,
        }
      : {
          units: u.unitCount,
          occupied: u.occupiedUnits,
          preLeasedVacant: 0,
          onNotice: 0,
          sf: u.avgSF * u.unitCount,
          market: market * u.unitCount,
          occupiedMarket: market * u.occupiedUnits,
          inPlace: (inPlace ?? market) * u.occupiedUnits,
          rented: inPlace === undefined ? 0 : u.occupiedUnits,
        }
    return [u.id, u.label, totals]
  })
  const byUnit = rr.units !== undefined
  /** Negative (in-place above market) in parentheses, like the percent. */
  const signed = (x: number, f: (n: number) => string) => (x < -0.005 ? `(${f(-x)})` : f(Math.max(0, x)))
  const row = (id: string, floorPlan: string, t: PlanTotals): UnitMixRow => {
    const loss = t.occupiedMarket - t.inPlace
    const hasLoss = t.rented > 0
    return {
      id,
      floorPlan,
      units: fmt.int(t.units),
      occupied: fmt.int(t.occupied),
      vacant: fmt.int(t.units - t.occupied),
      preLeased: byUnit ? preLeasedCount(t) : '—',
      avgSF: t.units ? fmt.int(t.sf / t.units) : '—',
      market: t.units ? fmt.usdCents(t.market / t.units) : '—',
      inPlace: t.occupied ? fmt.usdCents(t.inPlace / t.occupied) : '—',
      lossToLease: hasLoss ? signed(loss / t.occupied, fmt.usdCents) : '—',
      lossToLeasePct: hasLoss && t.occupiedMarket ? fmt.pct(loss / t.occupiedMarket, 1) : '—',
      lossToLeaseAnnual: hasLoss ? signed(loss * 12, fmt.usd) : '—',
    }
  }
  const all = plans.reduce<PlanTotals>(
    (s, [, , t]) => {
      for (const k of Object.keys(s) as (keyof PlanTotals)[]) s[k] += t[k]
      return s
    },
    { units: 0, occupied: 0, preLeasedVacant: 0, onNotice: 0, sf: 0, market: 0, occupiedMarket: 0, inPlace: 0, rented: 0 },
  )
  const first = rr.unitTypes[0]?.marketRentMonthly
  return {
    kind: 'unit-mix',
    source: first ? { source: first.source, sourceName: first.sourceName } : { source: 'estimated', sourceName: 'No units' },
    byUnit,
    rows: plans.map(([id, label, t]) => row(id, label, t)),
    totals: row('total', 'Total', all),
  }
}

export function returnsView(r: UnderwritingResult, bid: MaxBid): ReturnsView {
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
      { label: 'Net proceeds to equity', value: usd(m.netSaleProceeds - m.loanPayoff), kind: 'total' },
    ],
    returns: [
      { label: 'Unlevered IRR', value: pctOrDash(m.unleveredIRR) },
      { label: 'Levered IRR', value: pctOrDash(m.leveredIRR) },
      { label: 'Unlevered multiple', value: fmt.multiple(m.unleveredEquityMultiple) },
      { label: 'Levered multiple', value: fmt.multiple(m.equityMultiple) },
      { label: `NPV @ ${fmt.pct(a.discountRate.value, 2)}`, value: usd(m.npv), hint: 'Unlevered cash flows' },
      maxBidStat(bid),
    ],
    cashFlows: {
      columns: Array.from({ length: H + 1 }, (_, i) => `Year ${i}`),
      rows: streams.map((row) => {
        const values = row.values.slice(0, H + 1)
        return { label: row.label, values, cells: values.map((v) => (v === null ? '' : fmt.accounting(v))) }
      }),
    },
    cashFlowChart: r.cashFlows.map((c) => ({
      year: c.year,
      noi: c.netOperatingIncome,
      beforeDebt: c.cashFlowBeforeDebt,
      afterDebt: c.cashFlowAfterDebt,
      tooltip:
        `Year ${c.year}: NOI ${fmt.money(c.netOperatingIncome)} · before debt ${fmt.money(c.cashFlowBeforeDebt)}` +
        ` · after debt ${fmt.money(c.cashFlowAfterDebt)}`,
    })),
    dscrChart: hasDebt
      ? {
          floor: DSCR_FLOOR,
          points: m.dscrByYear.map((dscr, i) => {
            const belowFloor = dscr < DSCR_FLOOR
            return {
              year: i + 1,
              dscr,
              belowFloor,
              tooltip: `Year ${i + 1}: DSCR ${fmt.multiple(dscr)}${belowFloor ? ` · below ${fmt.multiple(DSCR_FLOOR)}` : ''}`,
            }
          }),
        }
      : null,
  }
}

const note = (s: Sourced<unknown>) => [s.sourceName, s.notes].filter(Boolean).join(' · ')
const setting = (label: string, value: string): AssumptionItem => ({ label, value, note: 'Model setting' })

/**
 * Every assumption the engine reads, grouped for the Assumptions tab. Numeric
 * ones carry what the input needs; notes come from the defaults so they don't
 * shift while editing. Rule-of-thumb notes are left to the tab's legend, and a
 * note several items in a group share moves to the group.
 */
export function assumptionGroups(a: UnderwritingAssumptions, defaults: UnderwritingAssumptions = a): AssumptionGroup[] {
  const groups: AssumptionGroup[] = (['Acquisition', 'Leasing', 'Operating', 'Debt', 'Exit'] as const).map((title) => ({
    title,
    items: [],
  }))
  const group = (title: AssumptionGroupTitle) => groups.find((g) => g.title === title)!

  for (const f of editableFields(a)) {
    const src = fieldValue(a, f.key)
    const dflt = fieldValue(defaults, f.key)
    let n = note(dflt)
    const expense = /^operating\.expenses\.(\d+)\./.exec(f.key)
    if (expense) n += ` · ${a.operating.expenses[Number(expense[1])].recoverable ? 'recoverable' : 'not recoverable'}`
    group(f.group).items.push({
      label: f.label,
      value: f.format(src.value),
      src,
      note: n,
      edit: {
        field: f,
        value: src.value,
        defaultValue: dflt.value,
        input: formatInput(f, src.value),
        defaultText: `default ${f.format(dflt.value)}`,
        edited: isEdited(src),
      },
    })
  }

  group('Acquisition').items.push(setting('Analysis start', fmt.monthYear(a.acquisition.analysisStartDate)))
  if (!a.multifamily) group('Leasing').items.push(setting('Vacant space recovery', fmt.label(a.leasing.vacantSpaceRecovery)))
  group('Debt').items.unshift(setting('Debt', a.debt.enabled ? 'On' : 'Off'))
  const exit = group('Exit').items
  exit.splice(2, 0, setting('Exit NOI', a.exit.capForwardNOI ? 'Forward year (hold + 1)' : 'Final hold year'))

  for (const g of groups) {
    for (const x of g.items) if (x.note === RULE_OF_THUMB) x.note = ''
    const counts = new Map<string, number>()
    for (const x of g.items) if (x.note) counts.set(x.note, (counts.get(x.note) ?? 0) + 1)
    const shared = [...counts].filter(([, c]) => c > 1).map(([n]) => n)
    if (shared.length) {
      g.note = shared.join(' · ')
      for (const x of g.items) if (shared.includes(x.note)) x.note = ''
    }
  }
  return groups
}
