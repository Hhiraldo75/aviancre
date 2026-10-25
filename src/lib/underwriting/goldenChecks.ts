/**
 * Shared checks for the golden benchmark tests (*.golden.test.ts): compare an
 * engine run against a frozen `npm run underwrite` CSV in __fixtures__/.
 * Test-only; nothing in the app imports this.
 */
import { expect, it } from 'vitest'
import type { AnnualCashFlow, ISODate, Property, UnderwritingResult } from '../../types'
import { parseCSV } from '../csv'
import { parseAssumptionSetFile, type SavedAssumptionSet } from './assumptionSets'

const DOLLARS = 1
const RATE = 0.0001
const DSCR = 0.01
/** Years. WALT runs from the analysis start (Nov 1, 2026), not the Oct 4 analysis date. */
const WALT = 0.01

/**
 * A golden fixture's validation assumption set (__fixtures__/*-validation.assumptions.json):
 * every Base assumption pinned at the value the Excel match used, so the
 * benchmark stays true when the app's market-based defaults move. Throws if
 * the file no longer loads for the property.
 */
export function validationSet(json: unknown, property: Property, asOf: ISODate): SavedAssumptionSet {
  const { set, errors } = parseAssumptionSetFile(json, property, asOf)
  if (!set) throw new Error(`${property.id} validation set: ${errors.join(' ')}`)
  return set
}

type LineField = keyof Omit<AnnualCashFlow, 'year'>

/** Fixture line label → engine field, in report order (commercial). */
const LINES: Record<string, LineField> = {
  Occupancy: 'occupancy',
  'Gross potential rent': 'grossPotentialRent',
  'Less: absorption & turnover vacancy': 'absorptionTurnoverVacancy',
  'Less: free rent': 'freeRent',
  'Expense recoveries': 'expenseRecoveries',
  'Other income': 'otherIncome',
  'Less: general vacancy': 'generalVacancy',
  'Less: credit loss': 'creditLoss',
  'Effective gross income': 'effectiveGrossIncome',
  'Operating expenses (incl. mgmt)': 'operatingExpenses',
  '  of which management fee': 'managementFee',
  'Net operating income': 'netOperatingIncome',
  'Tenant improvements': 'tenantImprovements',
  'Leasing commissions': 'leasingCommissions',
  'Capital reserves': 'capitalReserves',
  'Cash flow before debt': 'cashFlowBeforeDebt',
  'Debt service': 'debtService',
  'Cash flow after debt': 'cashFlowAfterDebt',
  'Net sale proceeds': 'saleProceeds',
  'Loan payoff': 'loanPayoff',
  'Unlevered cash flow': 'unleveredCashFlow',
  'Levered cash flow': 'leveredCashFlow',
}

/** Multifamily report order: physical occupancy, rent at market, then loss to lease; turnover costs in place of TI. */
const MULTIFAMILY_LINES: Record<string, LineField> = Object.fromEntries(
  Object.entries(LINES).flatMap(([label, key]): [string, LineField][] => {
    if (key === 'occupancy') return [['Physical occupancy (before general vacancy)', key]]
    if (key === 'grossPotentialRent') return [['Gross potential rent (at market)', key], ['Less: loss to lease', 'lossToLease']]
    if (key === 'tenantImprovements') return [['Turnover costs', key]]
    return [[label, key]]
  }),
)

/** Engine value for a fixture column: Year 0, Years 1–10, then both Year-11 columns. */
function engineValue(r: UnderwritingResult, key: LineField, column: number): number | null {
  if (column === 0) {
    if (key === 'unleveredCashFlow') return -r.metrics.totalCost
    if (key === 'leveredCashFlow') return -r.metrics.equityRequired
    return null
  }
  if (column <= r.cashFlows.length) return r.cashFlows[column - 1][key]
  return (column === r.cashFlows.length + 1 ? r.forwardYear : r.normalizedExitYear)[key]
}

/**
 * Every fixture check, against one engine result: each cash-flow line in every
 * year (both Year-11 columns included) within $1, price, loan, equity, sale and
 * payoff within $1, IRRs within 0.0001, minimum DSCR within 0.01, WALT within 0.01 years
 * (multifamily has no WALT: the fixture's "n/a" must stay n/a).
 */
export function goldenChecks(r: UnderwritingResult, fixture: string) {
  const lines = r.assumptions.multifamily ? MULTIFAMILY_LINES : LINES
  const rows = parseCSV(fixture)
  const headerAt = rows.findIndex((row) => row[0] === 'Line')
  const header = rows[headerAt]
  const blockEnd = rows.findIndex((row, i) => i > headerAt && row.length === 1 && row[0] === '')
  const cashFlowRows = rows.slice(headerAt + 1, blockEnd)
  const metricValue = (label: string) => {
    const row = rows.find((x) => x[0] === label && x.length === 2)
    if (!row) throw new Error(`fixture has no metric "${label}"`)
    return row[1]
  }
  const assumptionValue = (path: string) => {
    const row = rows.find((x) => x[0] === path && x.length === 4)
    if (!row) throw new Error(`fixture has no assumption "${path}"`)
    return Number(row[1])
  }
  const dollars = (s: string) => Number(s.replace(/[$,]/g, ''))
  const percent = (s: string) => Number(s.replace('%', '')) / 100
  const cashFlowCell = (label: string, column: string) => {
    const row = cashFlowRows.find((x) => x[0] === label)
    if (!row) throw new Error(`fixture has no line "${label}"`)
    return Number(row[header.indexOf(column)])
  }

  it('has the expected fixture shape', () => {
    expect(header).toEqual([
      'Line',
      'Year 0',
      ...Array.from({ length: 10 }, (_, i) => `Year ${i + 1}`),
      'Year 11 (forward, raw)',
      'Year 11 (normalized for sale)',
    ])
    expect(cashFlowRows.map((row) => row[0])).toEqual(Object.keys(lines))
    expect(r.cashFlows).toHaveLength(10)
    expect(r.normalizedExitYear.year).toBe(11)
  })

  for (const row of cashFlowRows) {
    const [label, ...cells] = row
    const key = lines[label]
    const tolerance = key === 'occupancy' ? RATE : DOLLARS
    it(`matches "${label.trim()}" in every year`, () => {
      let compared = 0
      cells.forEach((cell, column) => {
        if (cell === '') return // not applicable in this column (e.g. debt lines in year 11)
        const actual = engineValue(r, key, column)
        expect(actual, `${label.trim()}, ${header[column + 1]}`).not.toBeNull()
        expect(Math.abs(actual! - Number(cell)), `${label.trim()}, ${header[column + 1]}`).toBeLessThanOrEqual(tolerance)
        compared++
      })
      expect(compared).toBeGreaterThanOrEqual(10)
    })
  }

  it('matches both Year-11 NOI columns', () => {
    expect(Math.abs(r.forwardYear.netOperatingIncome - cashFlowCell('Net operating income', 'Year 11 (forward, raw)'))).toBeLessThanOrEqual(DOLLARS)
    expect(
      Math.abs(r.normalizedExitYear.netOperatingIncome - cashFlowCell('Net operating income', 'Year 11 (normalized for sale)')),
    ).toBeLessThanOrEqual(DOLLARS)
  })

  it('matches purchase price, loan, equity, sale proceeds and payoff within $1', () => {
    const m = r.metrics
    expect(Math.abs(m.purchasePrice - assumptionValue('acquisition.purchasePrice'))).toBeLessThanOrEqual(DOLLARS)
    expect(Math.abs(m.loanAmount - dollars(metricValue('Loan amount')))).toBeLessThanOrEqual(DOLLARS)
    expect(Math.abs(m.equityRequired + cashFlowCell('Levered cash flow', 'Year 0'))).toBeLessThanOrEqual(DOLLARS)
    expect(Math.abs(m.netSaleProceeds - cashFlowCell('Net sale proceeds', 'Year 10'))).toBeLessThanOrEqual(DOLLARS)
    expect(Math.abs(m.loanPayoff - cashFlowCell('Loan payoff', 'Year 10'))).toBeLessThanOrEqual(DOLLARS)
  })

  it('matches IRRs within 0.0001 and minimum DSCR within 0.01', () => {
    const m = r.metrics
    expect(Math.abs(m.unleveredIRR! - percent(metricValue('Unlevered IRR')))).toBeLessThanOrEqual(RATE)
    expect(Math.abs(m.leveredIRR! - percent(metricValue('Levered IRR')))).toBeLessThanOrEqual(RATE)
    expect(Math.abs(m.minimumDSCR! - Number(metricValue('Minimum DSCR').replace('x', '')))).toBeLessThanOrEqual(DSCR)
  })

  it('matches WALT within 0.01 years, measured from the analysis start', () => {
    expect(r.assumptions.acquisition.analysisStartDate).toBe('2026-11-01')
    const walt = metricValue('WALT (years)')
    if (walt === 'n/a') expect(r.metrics.walt).toBeNull()
    else expect(Math.abs(r.metrics.walt! - Number(walt))).toBeLessThanOrEqual(WALT)
  })
}
