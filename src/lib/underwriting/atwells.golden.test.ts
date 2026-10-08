/**
 * Golden test: Atwells Retail Row, base scenario.
 *
 * These values were independently validated against the Excel benchmark
 * (AVIANCRE_Atwells_Underwriting_Benchmark_v2.xlsx, matched to the cent on
 * Oct 8, 2026). Only update __fixtures__/atwells-benchmark.csv on purpose when
 * an assumption or method changes, and re-check against Excel when you do.
 * No script writes to the fixture; `npm run underwrite` writes to docs/ instead.
 */
import { describe, expect, it } from 'vitest'
import type { AnnualCashFlow, UnderwritingResult } from '../../types'
import { SAMPLE_PROPERTIES } from '../../data/sampleProperties'
import { useAppStore } from '../../store/useAppStore'
import fixture from './__fixtures__/atwells-benchmark.csv?raw'
import { assumptionsFor } from './edits'
import { underwrite } from './underwrite'

const AS_OF = '2026-10-04'
const DOLLARS = 1
const RATE = 0.0001
const DSCR = 0.01

const ATWELLS = SAMPLE_PROPERTIES.find((p) => p.id === 'sample-atwells-retail-row')
if (!ATWELLS) throw new Error('missing sample-atwells-retail-row')
const defaultRun = underwrite(ATWELLS, AS_OF)

/** Minimal CSV parser: commas, double-quoted cells, "" escapes. */
function parseCSV(text: string): string[][] {
  return text
    .trimEnd()
    .split('\n')
    .map((line) => {
      const cells: string[] = []
      let cell = ''
      let quoted = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (quoted) {
          if (ch === '"' && line[i + 1] === '"') (cell += '"'), i++
          else if (ch === '"') quoted = false
          else cell += ch
        } else if (ch === '"') quoted = true
        else if (ch === ',') cells.push(cell), (cell = '')
        else cell += ch
      }
      cells.push(cell)
      return cells
    })
}

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

/** Fixture line label → engine field. */
const LINES: Record<string, keyof Omit<AnnualCashFlow, 'year'>> = {
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

/** Engine value for a fixture column: Year 0, Years 1–10, then both Year-11 columns. */
function engineValue(r: UnderwritingResult, key: keyof Omit<AnnualCashFlow, 'year'>, column: number): number | null {
  if (column === 0) {
    if (key === 'unleveredCashFlow') return -r.metrics.totalCost
    if (key === 'leveredCashFlow') return -r.metrics.equityRequired
    return null
  }
  if (column <= r.cashFlows.length) return r.cashFlows[column - 1][key]
  return (column === r.cashFlows.length + 1 ? r.forwardYear : r.normalizedExitYear)[key]
}

/** Every fixture check, against one engine result. */
function goldenChecks(r: UnderwritingResult) {
  it('has the expected fixture shape', () => {
    expect(header).toEqual([
      'Line',
      'Year 0',
      ...Array.from({ length: 10 }, (_, i) => `Year ${i + 1}`),
      'Year 11 (forward, raw)',
      'Year 11 (normalized for sale)',
    ])
    expect(cashFlowRows.map((row) => row[0])).toEqual(Object.keys(LINES))
    expect(r.cashFlows).toHaveLength(10)
    expect(r.normalizedExitYear.year).toBe(11)
  })

  for (const row of cashFlowRows) {
    const [label, ...cells] = row
    const key = LINES[label]
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
}

describe('Atwells golden benchmark', () => {
  goldenChecks(defaultRun)
})

/** Runs the engine on Atwells with whatever edits the store holds, as the UI does. */
const runFromStore = () => underwrite(ATWELLS, AS_OF, assumptionsFor(ATWELLS, AS_OF, useAppStore.getState().assumptionEdits[ATWELLS.id]))
const store = useAppStore.getState()

describe('Atwells with an edited exit cap', () => {
  store.setAssumption(ATWELLS.id, 'exit.exitCapRate', 0.075)
  const edited = runFromStore()

  it('starts from a 7.25% exit cap', () => {
    expect(defaultRun.assumptions.exit.exitCapRate.value).toBeCloseTo(0.0725, 12)
    expect(edited.assumptions.exit.exitCapRate).toMatchObject({ value: 0.075, source: 'imported', sourceName: 'Analyst input' })
  })
  it('lowers both IRRs at 7.50%', () => {
    expect(edited.metrics.unleveredIRR!).toBeLessThan(defaultRun.metrics.unleveredIRR!)
    expect(edited.metrics.leveredIRR!).toBeLessThan(defaultRun.metrics.leveredIRR!)
  })
  it('changes only the sale, not the price or operations', () => {
    expect(edited.metrics.purchasePrice).toBe(defaultRun.metrics.purchasePrice)
    expect(edited.cashFlows.map((c) => c.netOperatingIncome)).toEqual(defaultRun.cashFlows.map((c) => c.netOperatingIncome))
    expect(edited.metrics.exitValue).toBeLessThan(defaultRun.metrics.exitValue)
  })
})

describe('Atwells golden benchmark after Reset', () => {
  store.setAssumption(ATWELLS.id, 'exit.exitCapRate', 0.075)
  store.setAssumption(ATWELLS.id, 'operating.generalVacancyPct', 0.07)
  store.resetAssumption(ATWELLS.id, 'operating.generalVacancyPct')
  store.resetAssumptions(ATWELLS.id)
  const reset = runFromStore()

  it('clears every edit', () => {
    expect(useAppStore.getState().assumptionEdits[ATWELLS.id]).toBeUndefined()
  })
  it('restores the default results exactly', () => {
    const { generatedAt: _a, ...expected } = defaultRun
    const { generatedAt: _b, ...actual } = reset
    expect(actual).toEqual(expected)
  })
  goldenChecks(reset)
})
