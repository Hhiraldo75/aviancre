import { describe, expect, it } from 'vitest'
import fernhillT12 from '../../docs/samples/fernhill-commons-t12.csv?raw'
import { SAMPLE_PROPERTIES } from '../data/sampleProperties'
import { parseCSV } from './csv'
import {
  categoryTotals,
  growthYears,
  isT12Statement,
  parseT12File,
  periodLabel,
  t12ExpenseLines,
  t12File,
  t12OtherIncomeYear1,
  t12Summary,
  withoutT12,
  withT12,
} from './t12'
import { readT12, statementFrom } from './t12Read'

const read = (kind: 'multifamily' | 'commercial') =>
  statementFrom(readT12(parseCSV(fernhillT12), { kind }), { fileName: 'fernhill-commons-t12.csv', importedAt: '2026-10-24' })
const T12 = read('multifamily')
const START = '2026-11-01'
/** 13 months from Oct 2025 to Nov 2026, at 3%. */
const GROWTH = Math.pow(1.03, 13 / 12)

describe('T-12 totals', () => {
  it('sums each category as mapped', () => {
    const by = categoryTotals(T12)
    expect(by['rental-income']).toBe(2_203_800)
    expect(by['vacancy-concessions']).toBe(-147_800)
    expect(by['other-income']).toBe(88_800)
    expect(by['property-taxes']).toBe(231_600)
    expect(by['repairs-maintenance']).toBe(99_600)
    expect(by['management-fee']).toBe(85_792)
    expect(by.capex).toBe(144_200)
  })
  it('keeps capex and make-ready out of NOI and says what moved', () => {
    const t = t12Summary(T12)
    expect(t.effectiveGrossIncome).toBe(2_144_800)
    expect(t.operatingExpenses).toBe(826_192)
    expect(t.netOperatingIncome).toBe(1_318_608)
    expect(t.belowNOI.map((x) => [x.label, x.amount])).toEqual([
      ['Make Ready / Turnover', 34_200],
      ['Roof Repair', 46_000],
      ['Unit Renovations', 64_000],
    ])
    expect(t.movedBelowNOI.map((x) => x.label)).toEqual(['Make Ready / Turnover'])
  })
  it('names the period', () => {
    expect(periodLabel(T12)).toBe('Oct 2025 – Sep 2026')
    expect(periodLabel({ ...T12, periodStart: '2026-01-01' })).toBe('Jan 2026 – Dec 2026')
  })
})

describe('Year-1 lines from the T-12', () => {
  it('grows from the T-12’s midpoint to Year 1’s', () => {
    expect(growthYears('2025-10-01', START)).toBeCloseTo(13 / 12, 12)
    expect(growthYears('2026-11-01', START)).toBe(0)
  })
  it('makes one expense line per operating category, grown at expense growth, marked ACT', () => {
    const lines = t12ExpenseLines(T12, 0.03, START, false)
    expect(lines.map((l) => l.label)).toEqual([
      'Property taxes',
      'Insurance',
      'Utilities',
      'Repairs & maintenance',
      'Payroll',
      'Admin & marketing',
      'Other operating expenses',
    ])
    expect(lines[0].annualAmount.value).toBeCloseTo(231_600 * GROWTH, 2)
    expect(lines[0]).toMatchObject({ recoverable: false, t12Category: 'property-taxes' })
    expect(lines[0].annualAmount).toMatchObject({ source: 'imported', sourceName: 'T-12 actual, Oct 2025 – Sep 2026 (fernhill-commons-t12.csv)' })
    expect(lines[0].annualAmount.notes).toBe('$231,600 over the T-12, grown 1.08 yrs at 3%/yr expense growth to Year 1')
    // No management fee (the model's % of EGI) and no make-ready (below NOI).
    expect(lines.reduce((s, l) => s + l.annualAmount.value, 0)).toBeCloseTo((826_192 - 85_792) * GROWTH, 1)
  })
  it('splits a category with recoverable and non-recoverable lines for commercial', () => {
    const t12 = read('commercial')
    t12.lines.find((l) => l.label === 'Snow Removal')!.recoverable = false
    const lines = t12ExpenseLines(t12, 0.03, START, true)
    const rm = lines.filter((l) => l.t12Category === 'repairs-maintenance')
    expect(rm.map((l) => [l.label, l.recoverable])).toEqual([
      ['Repairs & maintenance', true],
      ['Repairs & maintenance (not recoverable)', false],
    ])
    expect(rm[1].annualAmount.value).toBeCloseTo(12_600 * GROWTH, 2)
    expect(lines.find((l) => l.t12Category === 'payroll')!.recoverable).toBe(false)
  })
  it('grows other income at rent growth', () => {
    expect(t12OtherIncomeYear1(T12, 0.03, START).value).toBeCloseTo(88_800 * GROWTH, 2)
    expect(t12OtherIncomeYear1({ ...T12, lines: T12.lines.filter((l) => l.category !== 'other-income') }, 0.03, START).value).toBe(0)
  })
})

describe('attaching and saving', () => {
  const fernhill = SAMPLE_PROPERTIES.find((p) => p.id === 'sample-fernhill-commons')!
  it('attaches to a copy and strips back to the same object every time', () => {
    const p = withT12(fernhill, T12)
    expect(p).not.toBe(fernhill)
    expect(p.t12).toBe(T12)
    expect(withoutT12(p)).toBe(withoutT12(p))
    expect(withoutT12(p).t12).toBeUndefined()
    expect(withoutT12(fernhill)).toBe(fernhill)
  })
  it('round-trips through the saved file for its property only', () => {
    const file = JSON.parse(JSON.stringify(t12File(fernhill.id, T12)))
    expect(parseT12File(file, fernhill.id)).toEqual({ statement: T12 })
    expect(parseT12File(file, 'deal-other')).toEqual({ error: 'This T-12 is for "sample-fernhill-commons", not deal-other.' })
    expect(parseT12File({ ...file, version: 2 }, fernhill.id)).toEqual({ error: 'Unsupported T-12 file version 2.' })
    expect(parseT12File({ format: 'x' }, fernhill.id)).toEqual({ error: 'Not an AVIANCRE T-12 file.' })
  })
  it('rejects a damaged statement', () => {
    expect(isT12Statement(T12)).toBe(true)
    expect(isT12Statement({ ...T12, lines: [{ ...T12.lines[0], months: [1, 2] }] })).toBe(false)
    expect(isT12Statement({ ...T12, lines: [{ ...T12.lines[0], category: 'rent' }] })).toBe(false)
    expect(isT12Statement({ ...T12, periodStart: '2025-10-15' })).toBe(false)
  })
})
