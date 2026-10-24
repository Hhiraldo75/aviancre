/**
 * Golden test: Fernhill Commons, base scenario (the multifamily unit rent roll model).
 *
 * These values were independently validated against an Excel model built only
 * from the written inputs, rules and rent roll (docs/validation/Fernhill-Excel-Check.xlsx,
 * matched on Oct 24, 2026: all 185 annual values, all 1,140 monthly values and
 * every return metric). Only update __fixtures__/fernhill-benchmark.csv and
 * fernhill-benchmark.json on purpose when an assumption or method changes, and
 * re-check against Excel when you do. No script writes to the fixtures.
 */
import { describe, expect, it } from 'vitest'
import { SAMPLE_PROPERTIES } from '../../data/sampleProperties'
import type { UnderwritingMetrics } from '../../types'
import fixture from './__fixtures__/fernhill-benchmark.csv?raw'
import frozen from './__fixtures__/fernhill-benchmark.json'
import { loanSchedule } from './finance'
import { goldenChecks } from './goldenChecks'
import { underwrite } from './underwrite'

const AS_OF = '2026-10-04'
/** The loan schedule is frozen at full precision, so it is held to the cent. */
const CENT = 0.01
/** The summary JSON gives dollar metrics in whole dollars. */
const DOLLARS = 1
/** Rates, multiples and DSCRs are frozen at full precision. */
const RATIO = 1e-6

const FERNHILL = SAMPLE_PROPERTIES.find((p) => p.id === 'sample-fernhill-commons')
if (!FERNHILL) throw new Error('missing sample-fernhill-commons')
const r = underwrite(FERNHILL, AS_OF)

describe('Fernhill golden benchmark', () => {
  goldenChecks(r, fixture)

  it('runs the unit-level model from the same start date', () => {
    expect(FERNHILL.rentRoll.kind === 'multifamily' && FERNHILL.rentRoll.units?.length).toBe(120)
    expect(r.assumptions.acquisition.analysisStartDate).toBe(frozen.analysisStartDate)
  })

  it('matches the monthly loan schedule, totaled by year, to the cent', () => {
    const a = r.assumptions
    const H = a.acquisition.holdYears.value
    const months = loanSchedule(r.metrics.loanAmount, a.debt.rate.type === 'fixed' ? a.debt.rate.rate.value : NaN, a.debt.amortizationYears.value * 12, a.debt.interestOnlyYears.value * 12, H * 12)
    expect(frozen.loanScheduleByYear).toHaveLength(H)
    const totals = { interest: 0, principal: 0, payment: 0 }
    for (const y of frozen.loanScheduleByYear) {
      const slice = months.slice((y.year - 1) * 12, y.year * 12)
      const sum = (k: 'interest' | 'principal' | 'payment') => slice.reduce((s, m) => s + m[k], 0)
      for (const k of ['interest', 'principal', 'payment'] as const) {
        expect(Math.abs(sum(k) - y[k]), `year ${y.year} ${k}`).toBeLessThanOrEqual(CENT)
        totals[k] += sum(k)
      }
      expect(Math.abs(slice[11].endingBalance - y.endingBalance), `year ${y.year} ending balance`).toBeLessThanOrEqual(CENT)
      expect(Math.abs(r.cashFlows[y.year - 1].debtService - y.payment), `year ${y.year} debt service`).toBeLessThanOrEqual(CENT)
    }
    for (const k of ['interest', 'principal', 'payment'] as const) {
      expect(Math.abs(totals[k] - frozen.loanScheduleTotal[k]), `total ${k}`).toBeLessThanOrEqual(CENT)
    }
  })

  it('matches every return metric', () => {
    const dollars = new Set(['purchasePrice', 'totalCost', 'loanAmount', 'equityRequired', 'npv', 'exitNOIRaw', 'exitNOI', 'exitValue', 'sellingCosts', 'netSaleProceeds', 'loanPayoff'])
    for (const [key, expected] of Object.entries(frozen.metrics)) {
      const actual = r.metrics[key as keyof UnderwritingMetrics]
      const tolerance = dollars.has(key) ? DOLLARS : RATIO
      if (Array.isArray(expected)) {
        expect(actual, key).toHaveLength(expected.length)
        expected.forEach((x, i) => expect(Math.abs((actual as number[])[i] - x), `${key} year ${i + 1}`).toBeLessThanOrEqual(tolerance))
      } else {
        expect(Math.abs((actual as number) - expected), key).toBeLessThanOrEqual(tolerance)
      }
    }
  })
})
