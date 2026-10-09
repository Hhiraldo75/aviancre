import type { AnnualCashFlow, Escalation, Lease, Property, UnderwritingAssumptions, UnderwritingResult } from '../../types'

/** Plain-text and CSV renderings of an underwriting result, for the CLI and Excel checks. */

export type LineKey = Exclude<keyof AnnualCashFlow, 'year' | 'occupancy'>

/** Waterfall lines in report order. Losses and costs are positive amounts. */
function lines(isMultifamily: boolean): [label: string, key: LineKey][] {
  return [
    ['Gross potential rent', 'grossPotentialRent'],
    ['Less: absorption & turnover vacancy', 'absorptionTurnoverVacancy'],
    ['Less: free rent', 'freeRent'],
    ['Expense recoveries', 'expenseRecoveries'],
    ['Other income', 'otherIncome'],
    ['Less: general vacancy', 'generalVacancy'],
    ['Less: credit loss', 'creditLoss'],
    ['Effective gross income', 'effectiveGrossIncome'],
    ['Operating expenses (incl. mgmt)', 'operatingExpenses'],
    ['  of which management fee', 'managementFee'],
    ['Net operating income', 'netOperatingIncome'],
    [isMultifamily ? 'Turnover costs' : 'Tenant improvements', 'tenantImprovements'],
    ['Leasing commissions', 'leasingCommissions'],
    ['Capital reserves', 'capitalReserves'],
    ['Cash flow before debt', 'cashFlowBeforeDebt'],
    ['Debt service', 'debtService'],
    ['Cash flow after debt', 'cashFlowAfterDebt'],
    ['Net sale proceeds', 'saleProceeds'],
    ['Loan payoff', 'loanPayoff'],
    ['Unlevered cash flow', 'unleveredCashFlow'],
    ['Levered cash flow', 'leveredCashFlow'],
  ]
}

/** Year-0 values: only the two IRR streams have one. */
function yearZero(r: UnderwritingResult, key: LineKey): number | null {
  if (key === 'unleveredCashFlow') return -r.metrics.totalCost
  if (key === 'leveredCashFlow') return -r.metrics.equityRequired
  return null
}

export interface ReportRow {
  label: string
  /** The cash flow field; undefined for the occupancy row. */
  key?: LineKey
  /** Year 0, years 1..N, the forward year, then the normalized exit year. */
  values: (number | null)[]
}

export function cashFlowRows(r: UnderwritingResult): ReportRow[] {
  const isMF = r.assumptions.multifamily !== undefined
  const occupancy: ReportRow = {
    label: 'Occupancy',
    values: [null, ...r.cashFlows.map((c) => c.occupancy), r.forwardYear.occupancy, null],
  }
  return [
    occupancy,
    ...lines(isMF).map(([label, key]) => ({
      label,
      key,
      values: [
        yearZero(r, key),
        ...r.cashFlows.map((c) => c[key]),
        forwardValue(r.forwardYear, key),
        forwardValue(r.normalizedExitYear, key),
      ],
    })),
  ]
}

/** The forward and normalized exit years have no debt or sale lines. */
function forwardValue(year: AnnualCashFlow, key: LineKey): number | null {
  const noDebt: LineKey[] = ['debtService', 'cashFlowAfterDebt', 'saleProceeds', 'loanPayoff', 'unleveredCashFlow', 'leveredCashFlow']
  return noDebt.includes(key) ? null : year[key]
}

const pct = (x: number | null, digits = 2) => (x === null ? 'n/a' : `${(x * 100).toFixed(digits)}%`)
const usd = (x: number) => `$${Math.round(x).toLocaleString('en-US')}`
const times = (x: number | null) => (x === null ? 'n/a' : `${x.toFixed(2)}x`)

export function metricRows(r: UnderwritingResult): [label: string, value: string][] {
  const m = r.metrics
  const byYear = (xs: number[], f: (x: number) => string) => (xs.length ? xs.map(f).join(' | ') : 'n/a')
  return [
    ['Purchase price', usd(m.purchasePrice)],
    ['Price per SF', usd(m.pricePerSF)],
    ['Total cost (incl. closing, capex)', usd(m.totalCost)],
    ['Going-in cap rate', pct(m.goingInCapRate)],
    ['Loan amount', usd(m.loanAmount)],
    ['Equity required', usd(m.equityRequired)],
    [`Year-${r.normalizedExitYear.year} NOI (raw)`, usd(m.exitNOIRaw)],
    [`Year-${r.normalizedExitYear.year} NOI (normalized, used for sale)`, usd(m.exitNOI)],
    ['Exit value (gross)', usd(m.exitValue)],
    ['Net sale proceeds', usd(m.netSaleProceeds)],
    ['Loan payoff at sale', usd(m.loanPayoff)],
    ['Unlevered IRR', pct(m.unleveredIRR)],
    ['Levered IRR', pct(m.leveredIRR)],
    ['Unlevered equity multiple', times(m.unleveredEquityMultiple)],
    ['Levered equity multiple', times(m.equityMultiple)],
    ['NPV (unlevered)', usd(m.npv)],
    ['Debt yield (year-1 NOI / loan)', pct(m.debtYield)],
    ['Minimum DSCR', times(m.minimumDSCR)],
    ['DSCR by year', byYear(m.dscrByYear, (x) => x.toFixed(2))],
    ['Average cash-on-cash', pct(m.averageCashOnCash)],
    ['Cash-on-cash by year', byYear(m.cashOnCashByYear, (x) => pct(x, 1))],
    ['WALT (years)', m.walt === null ? 'n/a' : m.walt.toFixed(2)],
    ['In-place vs market rent', inPlaceVsMarket(r)],
  ]
}

function inPlaceVsMarket(r: UnderwritingResult): string {
  const m = r.metrics
  if (m.inPlaceRent === null || m.inPlaceVsMarket === null) return 'n/a'
  const basis = r.assumptions.multifamily ? '/unit/mo' : '/SF/yr'
  const money = (x: number) => `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const sign = m.inPlaceVsMarket >= 0 ? '+' : '−'
  return `${money(m.inPlaceRent)} vs ${money(m.marketRent)}${basis} (${sign}${pct(Math.abs(m.inPlaceVsMarket), 1)})`
}

export interface AssumptionRow {
  path: string
  value: string | number | boolean
  sourceName?: string
  source?: string
}

/**
 * Flattens assumptions to one row per leaf. Sourced values become a single row
 * carrying their source label; plain fields (scenario, dates, flags) have none.
 */
export function assumptionRows(assumptions: UnderwritingAssumptions): AssumptionRow[] {
  const out: AssumptionRow[] = []
  const walk = (node: unknown, path: string) => {
    if (node === undefined || node === null) return
    if (typeof node !== 'object') {
      out.push({ path, value: node as string | number | boolean })
      return
    }
    if ('value' in node && 'sourceName' in node && 'source' in node) {
      const s = node as { value: number; sourceName: string; source: string }
      out.push({ path, value: s.value, sourceName: s.sourceName, source: s.source })
      return
    }
    if (Array.isArray(node)) {
      node.forEach((child, i) => {
        const label = (child as { label?: string })?.label
        walk(child, `${path}[${label ?? i}]`)
      })
      return
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'label') continue
      walk(v, path ? `${path}.${k}` : k)
    }
  }
  walk(assumptions, '')
  return out
}

/** Terminal table: dollars in thousands, occupancy as a percent. */
export function toTable(r: UnderwritingResult): string {
  const rows = cashFlowRows(r)
  const H = r.cashFlows.length
  const labelWidth = 36
  const colWidth = 9
  const header =
    '$000s'.padEnd(labelWidth) +
    ['Yr 0', ...r.cashFlows.map((c) => `Yr ${c.year}`), `Yr ${H + 1}*`, `Norm.**`].map((h) => h.padStart(colWidth)).join('')
  const body = rows.map((row) => {
    const isOcc = row.label === 'Occupancy'
    const cells = row.values.map((v) => {
      if (v === null) return ''
      if (isOcc) return `${(v * 100).toFixed(1)}%`
      const k = v / 1000
      return Math.abs(k) < 0.05 ? '-' : k.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    })
    return row.label.padEnd(labelWidth) + cells.map((c) => c.padStart(colWidth)).join('')
  })
  const rule = '-'.repeat(labelWidth + colWidth * (H + 3))
  return [
    header,
    rule,
    ...body,
    rule,
    `* Year ${H + 1} is modeled only to value the exit on forward NOI.`,
    `** Year ${r.normalizedExitYear.year} normalized: rollover vacancy and free rent replaced by general vacancy. The sale uses this NOI.`,
  ].join('\n')
}

function csvCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1e4) / 1e4) : ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV with three blocks: annual cash flows (full precision), metrics, and assumptions with sources. */
export function toCSV(r: UnderwritingResult, propertyName: string): string {
  const H = r.cashFlows.length
  const out: (string | number | boolean | null | undefined)[][] = []
  out.push([`AVIANCRE underwriting: ${propertyName}`])
  out.push([`Analysis start ${r.assumptions.acquisition.analysisStartDate}; losses and costs are positive amounts`])
  out.push([])
  out.push([
    'Line',
    'Year 0',
    ...r.cashFlows.map((c) => `Year ${c.year}`),
    `Year ${H + 1} (forward, raw)`,
    `Year ${r.normalizedExitYear.year} (normalized for sale)`,
  ])
  for (const row of cashFlowRows(r)) out.push([row.label, ...row.values])
  out.push([])
  out.push(['Metric', 'Value'])
  for (const [label, value] of metricRows(r)) out.push([label, value])
  out.push([])
  out.push(['Warning'])
  for (const w of r.warnings) out.push([w])
  out.push([])
  out.push(['Note'])
  for (const n of r.notes) out.push([n])
  out.push([])
  out.push(['Assumption', 'Value', 'Source', 'Source type'])
  for (const a of assumptionRows(r.assumptions)) out.push([a.path, a.value, a.sourceName, a.source])
  return out.map((cells) => cells.map(csvCell).join(',')).join('\n') + '\n'
}

function escalationCells(e: Escalation): [type: string, value: string | number] {
  switch (e.type) {
    case 'fixed-percent':
      return ['fixed % per year', e.annualPct]
    case 'fixed-amount':
      return ['fixed $/SF per year', e.annualPerSF]
    case 'steps':
      return ['steps', e.steps.map((s) => `${s.effectiveDate}: $${s.annualRentPerSF.toFixed(2)}`).join('; ')]
    case 'none':
      return ['none', '']
  }
}

function recoveryCell(l: Lease): string {
  const r = l.recovery
  if (r.method === 'base-year') return `base-year (${r.baseYear})`
  if (r.method === 'expense-stop') return `expense-stop ($${r.stopPerSF}/SF)`
  return r.method
}

/** The option the engine prices at renewal: a fixed $/SF, or a share of market. */
function renewalOptionCell(l: Lease): string | number {
  const o = l.renewalOptions?.[0]
  if (!o) return ''
  return o.rentBasis === 'fixed' ? o.value : `${Math.round(o.value * 100)}% of market`
}

/**
 * Rent roll as CSV: every lease and vacant-suite field the underwriting engine
 * reads, so an Excel model can be built from the same inputs. The property
 * block carries what sets the market defaults (asset type, class, submarket).
 * `parseRentRoll` (src/lib/rentRollImport.ts) reads this format back.
 */
export function rentRollCSV(property: Property): string {
  const rr = property.rentRoll
  if (rr.kind !== 'commercial') throw new Error(`${property.id} is not a commercial rent roll`)
  const out: (string | number | boolean | null | undefined)[][] = [
    [`${property.name}: rent roll${property.isSample ? ' (fictional sample data)' : ''}`],
    [`Rentable SF ${property.physical.rentableSF.value}; rents are annual $/SF; percentages are decimals`],
    [],
    ['Property'],
    ['Asset type', property.assetType],
    ['Building class', property.buildingClass],
    ['Submarket', property.location.submarket],
    ['Address', property.location.address],
    [],
    ['Leases'],
    [
      'Tenant',
      'Suite',
      'SF',
      'Start',
      'End',
      'Starting rent ($/SF/yr)',
      'Escalation type',
      'Escalation value',
      'Lease type',
      'Recovery method',
      'Admin fee',
      'Free rent (months)',
      'Renewal option rent ($/SF/yr)',
      'Base-year expense amount ($/yr)',
    ],
  ]
  for (const l of rr.leases) {
    const [escType, escValue] = escalationCells(l.escalation)
    out.push([
      l.tenantName,
      l.suite,
      l.leasedSF,
      l.commencementDate,
      l.expirationDate,
      l.startingRentPerSF,
      escType,
      escValue,
      l.leaseType,
      recoveryCell(l),
      l.recovery.method === 'net' ? l.recovery.adminFeePct : undefined,
      l.freeRentMonths,
      renewalOptionCell(l),
      l.recovery.method === 'base-year' ? l.recovery.baseYearExpenses : undefined,
    ])
  }
  out.push([], ['Vacant suites'], ['Suite', 'SF', 'Expected lease-up (months)', 'Asking rent ($/SF/yr)'])
  for (const v of rr.vacancies) {
    out.push([v.suite, v.sf, v.expectedLeaseUpMonths, v.askingRentPerSF?.value ?? 'none (market rent)'])
  }
  return out.map((cells) => cells.map(csvCell).join(',')).join('\n') + '\n'
}
