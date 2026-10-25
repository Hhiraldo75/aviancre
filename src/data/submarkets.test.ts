import { describe, expect, it } from 'vitest'
import type { BenchmarkType, SubmarketBenchmark } from '../types'
import { benchmarkFor, marketViewFor } from '../lib/marketView'
import { defaultAssumptions } from '../lib/underwriting/defaults'
import { SAMPLE_PROPERTIES } from './sampleProperties'
import { METRO_TRENDS, SUBMARKETS } from './submarkets'

const AS_OF = '2026-10-04'

const rowsOf = (type: BenchmarkType): SubmarketBenchmark[] =>
  Object.values(SUBMARKETS).flatMap((m) => (m.benchmarks[type] ? [m.benchmarks[type]] : []))
const average = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length

describe('market benchmarks anchored to metro figures', () => {
  // [type, cap rate, rent (null = kept), vacancy]
  const anchors: [BenchmarkType, number, number | null, number][] = [
    ['office', 0.101, 25, 0.133],
    ['retail', 0.078, null, 0.036],
    ['industrial', 0.078, null, 0.048],
    ['multifamily', 0.075, 2058, 0.045],
  ]
  for (const [type, cap, rent, vacancy] of anchors) {
    it(`averages ${type} submarkets to the metro figure, within rounding`, () => {
      const rows = rowsOf(type)
      // Rounding each row to 0.05% can leave the average up to half a step off.
      expect(Math.abs(average(rows.map((b) => b.marketCapRate.value)) - cap)).toBeLessThanOrEqual(0.00025 + 1e-12)
      expect(Math.abs(average(rows.map((b) => b.vacancyRate.value)) - vacancy)).toBeLessThanOrEqual(0.0005 + 1e-12)
      if (rent !== null) expect(Math.abs(average(rows.map((b) => b.marketRent.value)) / rent - 1)).toBeLessThan(0.005)
    })
  }

  it('keeps the submarket differences in cap rates', () => {
    const office = (id: 'downtown' | 'capital-center' | 'jewelry-district') => SUBMARKETS[id].benchmarks.office!.marketCapRate.value
    expect(office('downtown')).toBe(0.1075)
    expect(office('capital-center')).toBe(0.1)
    expect(office('jewelry-district')).toBe(0.095)
  })

  it('keeps the urban street retail rents, with the metro $20 as context only', () => {
    expect(rowsOf('retail').map((b) => b.marketRent.value)).toEqual([20, 24, 22, 22, 26, 32, 16, 18])
    for (const b of rowsOf('retail')) {
      expect(b.marketRent).toMatchObject({ source: 'estimated', confidence: 'low' })
      expect(b.marketRent.range).toEqual({ low: b.marketRent.value * 0.85, high: b.marketRent.value * 1.15 })
      expect(b.marketRent.notes).toMatch(/metro average of \$20\/SF.*suburban strip retail.*context only/)
    }
  })

  it('keeps industrial rents, citing both sources as the range', () => {
    expect(rowsOf('industrial').map((b) => b.marketRent.value)).toEqual([9.5, 10, 9])
    for (const b of rowsOf('industrial')) {
      expect(b.marketRent.range).toEqual({ low: 7.5, high: 11 })
      expect(b.marketRent.sourceName).toMatch(/Cushman & Wakefield Providence Industrial MarketBeat Q4 2025.*NAR/)
    }
  })

  it('labels every market figure EST with its source, date, method and medium confidence', () => {
    for (const type of ['office', 'retail', 'industrial', 'multifamily'] as const) {
      for (const b of rowsOf(type)) {
        const rent = type === 'retail' ? [] : [b.marketRent]
        for (const s of [b.marketCapRate, b.vacancyRate, ...rent, b.trailingRentGrowth]) {
          expect(s).toMatchObject({ source: 'estimated', confidence: 'medium' })
          expect(s.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/)
          expect(s.sourceName).toMatch(/NAR|Cushman/)
        }
        expect(b.marketCapRate.notes).toMatch(/shifted by a constant/)
        expect(b.opexPerYear.sourceName).toMatch(/^Placeholder/)
      }
    }
    expect(rowsOf('office')[0].vacancyRate.sourceName).toMatch(/^Cushman & Wakefield Providence Office MarketBeat Q3 2026/)
    expect(rowsOf('office')[0].vacancyRate.notes).toMatch(/6\.9%/)
  })

  it('keeps long-run rent growth for underwriting and shows trailing growth as context', () => {
    expect(rowsOf('office').map((b) => [b.annualRentGrowth.value, b.trailingRentGrowth.value])[0]).toEqual([0.015, 0.029])
    expect(rowsOf('retail')[0].trailingRentGrowth.value).toBe(0.001)
    expect(rowsOf('industrial')[0].trailingRentGrowth.value).toBe(0.052)
    expect(rowsOf('multifamily')[0].trailingRentGrowth.value).toBe(0.027)
  })

  it('has the reported Q1 2025 and Q1 2026 metro points in the trend history', () => {
    for (const points of Object.values(METRO_TRENDS)) expect(points.map((t) => t.period)).toEqual(['Q1 2025', 'Q1 2026'])
    expect(METRO_TRENDS.office).toEqual([
      { period: 'Q1 2025', marketRent: 24, vacancyRate: 0.059, capRate: 0.105 },
      { period: 'Q1 2026', marketRent: 25, vacancyRate: 0.069, capRate: 0.101 },
    ])
    expect(METRO_TRENDS.multifamily[0]).toEqual({ period: 'Q1 2025', marketRent: 2004, vacancyRate: 0.033, capRate: 0.074 })
  })
  it('keeps the latest trend point in line with the metro anchors', () => {
    expect(METRO_TRENDS.retail[1].capRate).toBe(0.078)
    expect(METRO_TRENDS.industrial[1].vacancyRate).toBe(0.048)
    expect(METRO_TRENDS.multifamily[1].marketRent).toBe(2058)
  })
})

describe('benchmark lookup', () => {
  it('prices mixed-use from office, or retail where a submarket has no office row', () => {
    expect(benchmarkFor('downtown', 'mixed-use')?.type).toBe('office')
    expect(benchmarkFor('federal-hill', 'mixed-use')?.type).toBe('retail')
    expect(() => marketViewFor('federal-hill', 'mixed-use', 'B')).not.toThrow()
    expect(marketViewFor('federal-hill', 'mixed-use', 'B').marketCapRate).toBe(SUBMARKETS['federal-hill'].benchmarks.retail!.marketCapRate)
  })
  it('reports a submarket with neither', () => {
    expect(benchmarkFor('port-allens-ave', 'mixed-use')).toBeNull()
    expect(() => marketViewFor('port-allens-ave', 'mixed-use', 'B')).toThrow(/No office or retail benchmark/)
  })
  it('carries the benchmark source through the class adjustment', () => {
    const v = marketViewFor('downtown', 'office', 'A')
    expect(v.marketRent.value).toBe(Math.round(SUBMARKETS.downtown.benchmarks.office!.marketRent.value * 1.25 * 100) / 100)
    expect(v.marketRent).toMatchObject({ confidence: 'medium', asOf: '2026-03-31' })
    expect(v.marketRent.sourceName).toMatch(/^Submarket benchmark × class A \(1\.25×\) – NAR/)
  })
})

describe('default debt by asset type', () => {
  const rate = (id: string) => {
    const a = defaultAssumptions(SAMPLE_PROPERTIES.find((p) => p.id === id)!, AS_OF)
    if (a.debt.rate.type !== 'fixed') throw new Error('expected fixed')
    return a.debt.rate.rate
  }
  it('is the 10-year Treasury plus the asset type’s spread', () => {
    expect(rate('sample-fernhill-commons').value).toBe(0.065)
    expect(rate('sample-olneyville-distribution').value).toBe(0.066)
    expect(rate('sample-atwells-retail-row').value).toBe(0.067)
    expect(rate('sample-westminster-tower').value).toBe(0.0715)
    expect(rate('sample-westminster-tower')).toMatchObject({ source: 'estimated', confidence: 'medium', asOf: '2026-10-22' })
    expect(rate('sample-westminster-tower').sourceName).toMatch(/4\.96%.*220 bps office spread/)
  })
  it('keeps 60% LTV, 30-year amortization, 2 years interest-only and a 1% fee', () => {
    const a = defaultAssumptions(SAMPLE_PROPERTIES[0], AS_OF)
    expect([a.debt.ltv.value, a.debt.amortizationYears.value, a.debt.interestOnlyYears.value, a.debt.loanFeesPct.value]).toEqual([0.6, 30, 2, 0.01])
    expect(a.debt.ltv.sourceName).toMatch(/^Consistent with Northmarq quotes, Oct 2026/)
  })
  it('keeps the exit cap at market + 25 bps', () => {
    const a = defaultAssumptions(SAMPLE_PROPERTIES[0], AS_OF)
    expect(a.exit.exitCapRate.value).toBeCloseTo(a.acquisition.marketCapRate.value + 0.0025, 12)
  })
})
