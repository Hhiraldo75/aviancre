import { describe, expect, it } from 'vitest'
import { SAMPLE_PROPERTIES } from '../../data/sampleProperties'
import { ANALYST_INPUT } from './defaults'
import { assumptionsFor, defaultsFor, fieldValue, parseInput } from './edits'
import { maxBid } from './maxBid'
import {
  presetChanges,
  presetKey,
  presetRows,
  scenarioChanges,
  scenarioComparison,
  scenarioFields,
  scenarioOverrides,
  withScenario,
} from './scenarios'
import { runUnderwriting } from './summary'

const AS_OF = '2026-10-04'
const byId = (id: string) => {
  const p = SAMPLE_PROPERTIES.find((x) => x.id === id)
  if (!p) throw new Error(`missing ${id}`)
  return p
}
const ATWELLS = byId('sample-atwells-retail-row')
const WESTMINSTER = byId('sample-westminster-tower')
const FERNHILL = byId('sample-fernhill-commons')
const value = (a: ReturnType<typeof defaultsFor>, key: string) => fieldValue(a, key).value

describe('scenario assumptions', () => {
  const base = defaultsFor(ATWELLS, AS_OF)

  it('leaves Base as the same object, so Base output is unchanged', () => {
    expect(withScenario(base, 'base')).toBe(base)
    expect(withScenario(base, 'base', { [presetKey('downside', 'exit.exitCapRate')]: 0.01 })).toBe(base)
    // Preset edits alone don't change the Base assumptions either.
    expect(assumptionsFor(ATWELLS, AS_OF, { [presetKey('downside', 'exit.exitCapRate')]: 0.01 })).toBe(base)
  })

  it('applies the Downside presets to a commercial property (Atwells, retail)', () => {
    const d = withScenario(base, 'downside')
    expect(d.scenario).toBe('downside')
    expect(value(d, 'leasing.marketRent')).toBeCloseTo(value(base, 'leasing.marketRent') * 0.95, 9)
    expect(value(d, 'leasing.marketRentGrowth')).toBeCloseTo(0.01, 12)
    expect(value(d, 'leasing.renewalProbability')).toBeCloseTo(0.6, 12)
    expect(value(d, 'leasing.downtimeMonths')).toBe(12)
    expect(value(d, 'operating.generalVacancyPct')).toBeCloseTo(0.07, 12)
    // Expense growth is a lever at 0 by default: unchanged, and keeps its Base source.
    expect(fieldValue(d, 'operating.expenseGrowth')).toEqual(fieldValue(base, 'operating.expenseGrowth'))
    expect(scenarioOverrides(base, 'downside').map((o) => o.key)).toEqual([
      'leasing.marketRent',
      'leasing.marketRentGrowth',
      'leasing.renewalProbability',
      'leasing.downtimeMonths',
      'operating.generalVacancyPct',
      'exit.exitCapRate',
    ])
    expect(value(d, 'exit.exitCapRate')).toBeCloseTo(value(base, 'exit.exitCapRate') + 0.005, 12)
    const ec = fieldValue(d, 'exit.exitCapRate')
    expect(ec.source).toBe('estimated')
    expect(ec.sourceName).toBe('Downside scenario: Base 7.70% +50 bps (preset)')
    // Price and market cap are never moved; the input object is untouched.
    expect(d.acquisition.purchasePrice).toEqual(base.acquisition.purchasePrice)
    expect(d.acquisition.marketCapRate).toEqual(base.acquisition.marketCapRate)
    expect(base.scenario).toBe('base')
    expect(value(base, 'leasing.renewalProbability')).toBe(0.7)
  })

  it('uses turnover instead of renewal and downtime for multifamily (Fernhill)', () => {
    const b = defaultsFor(FERNHILL, AS_OF)
    const keys = scenarioOverrides(b, 'downside').map((o) => o.key)
    expect(keys).toContain('multifamily.turnoverRate')
    expect(keys).not.toContain('leasing.renewalProbability')
    expect(keys).not.toContain('leasing.downtimeMonths')
    expect(value(withScenario(b, 'downside'), 'multifamily.turnoverRate')).toBeCloseTo(0.6, 12)
  })

  it('applies the Upside presets, and only those', () => {
    const u = withScenario(base, 'upside')
    expect(scenarioOverrides(base, 'upside').map((o) => o.key)).toEqual(['leasing.marketRentGrowth', 'operating.generalVacancyPct', 'exit.exitCapRate'])
    expect(value(u, 'leasing.marketRentGrowth')).toBeCloseTo(0.03, 12)
    expect(value(u, 'operating.generalVacancyPct')).toBeCloseTo(0.04, 12)
    expect(value(u, 'exit.exitCapRate')).toBeCloseTo(0.0745, 12)
  })

  it('floors Upside vacancy at 3% and never raises a lower Base', () => {
    const at35 = assumptionsFor(ATWELLS, AS_OF, { 'operating.generalVacancyPct': 0.035 })
    expect(value(withScenario(at35, 'upside'), 'operating.generalVacancyPct')).toBeCloseTo(0.03, 12)
    expect(scenarioOverrides(at35, 'upside').find((o) => o.key === 'operating.generalVacancyPct')?.note).toMatch(/floor/)
    const at2 = assumptionsFor(ATWELLS, AS_OF, { 'operating.generalVacancyPct': 0.02 })
    expect(value(withScenario(at2, 'upside'), 'operating.generalVacancyPct')).toBeCloseTo(0.02, 12)
    expect(scenarioOverrides(at2, 'upside').map((o) => o.key)).not.toContain('operating.generalVacancyPct')
  })

  it('holds overrides within the assumption’s allowed range', () => {
    const low = assumptionsFor(ATWELLS, AS_OF, { 'leasing.renewalProbability': 0.05 })
    expect(value(withScenario(low, 'downside'), 'leasing.renewalProbability')).toBe(0)
    expect(scenarioOverrides(low, 'downside').find((o) => o.key === 'leasing.renewalProbability')?.note).toBe('Held at the 0% minimum')
  })

  it('layers on analyst edits: an edited 2.5% rent growth becomes 1.5% in Downside', () => {
    const edited = assumptionsFor(ATWELLS, AS_OF, { 'leasing.marketRentGrowth': 0.025 })
    expect(value(withScenario(edited, 'downside'), 'leasing.marketRentGrowth')).toBeCloseTo(0.015, 12)
  })

  it('uses edited presets, labeled as the analyst’s', () => {
    const edits = { [presetKey('downside', 'exit.exitCapRate')]: 0.01, [presetKey('upside', 'operating.expenseGrowth')]: -0.005 }
    const d = withScenario(base, 'downside', edits)
    expect(value(d, 'exit.exitCapRate')).toBeCloseTo(0.087, 12)
    expect(fieldValue(d, 'exit.exitCapRate').sourceName).toBe('Downside scenario: Base 7.70% +100 bps (your preset)')
    expect(value(withScenario(base, 'upside', edits), 'operating.expenseGrowth')).toBeCloseTo(0.025, 12)
    expect(presetChanges(base, edits)).toEqual([
      'Downside exit cap +100 bps (preset +50 bps)',
      'Upside expense growth −0.5 pts (preset 0 pts)',
    ])
    expect(scenarioChanges(base, 'downside', edits)).toContain('Exit cap rate 7.70% → 8.70% (+100 bps)')
  })

  it('offers preset inputs that parse in display units', () => {
    const fields = scenarioFields(base)
    const exit = fields.find((f) => f.key === presetKey('downside', 'exit.exitCapRate'))!
    expect(parseInput(exit, '75')).toEqual({ value: 0.0075 })
    expect('error' in parseInput(exit, '400')).toBe(true)
    const growth = fields.find((f) => f.key === presetKey('upside', 'leasing.marketRentGrowth'))!
    expect(parseInput(growth, '-0.5')).toEqual({ value: -0.005 })
    const rows = presetRows(base)
    expect(rows.map((r) => r.label)).toEqual([
      'Market rent',
      'Rent growth',
      'Renewal probability',
      'Downtime',
      'General vacancy',
      'Expense growth',
      'Exit cap',
    ])
    expect(rows[1].inputs.downside.edit).toMatchObject({ input: '-1', defaultText: 'preset −1 pt', edited: false })
    expect(rows[1].inputs.downside.src.sourceName).not.toBe(ANALYST_INPUT)
  })
})

describe('scenario comparison', () => {
  for (const p of [ATWELLS, WESTMINSTER, FERNHILL]) {
    it(`${p.name}: Base matches the Base run, the price is held, Downside < Base < Upside`, () => {
      const cmp = scenarioComparison(p, AS_OF)
      if (cmp.status !== 'ok') throw new Error(cmp.reason)
      const baseRun = runUnderwriting(p, AS_OF)
      if (baseRun.status !== 'ok') throw new Error(baseRun.reason)
      expect(cmp.cases.base.run).toBe(baseRun)
      const row = (key: string) => cmp.rows.find((r) => r.key === key)!.cells
      expect(row('leveredIRR').base.value).toBe(baseRun.result.metrics.leveredIRR)
      expect(row('year1NOI').base.value).toBe(baseRun.result.cashFlows[0].netOperatingIncome)
      const bid = maxBid(p, AS_OF, baseRun.result.assumptions)
      expect(row('maxBid').base.value).toBe(bid.status === 'ok' ? bid.price : null)

      for (const s of ['downside', 'upside'] as const) {
        const run = cmp.cases[s].run
        if (run.status !== 'ok') throw new Error(run.reason)
        expect(run.result.metrics.purchasePrice).toBe(baseRun.result.metrics.purchasePrice)
      }
      const irr = row('leveredIRR')
      expect(irr.downside.value!).toBeLessThan(irr.base.value!)
      expect(irr.upside.value!).toBeGreaterThan(irr.base.value!)
      expect(irr.downside.tone).toBe('worse')
      expect(irr.upside.tone).toBe('better')
      expect(irr.downside.vsBase!.display).toMatch(/^−\d+ bps$/)
    })
  }

  it('labels rows for the hold and the target', () => {
    const cmp = scenarioComparison(ATWELLS, AS_OF)
    if (cmp.status !== 'ok') throw new Error(cmp.reason)
    expect(cmp.rows.map((r) => r.label)).toEqual([
      'Year-1 NOI',
      'Year-10 NOI',
      'Exit value',
      'Unlevered IRR',
      'Levered IRR',
      'Levered multiple',
      'Minimum DSCR',
      'Max bid at 10% levered IRR',
    ])
    expect(cmp.notes[0]).toBe(`Price held at Base: ${cmp.price.display} in every case.`)
    expect(cmp.rows[2].cells.downside.vsBase!.display).toMatch(/^−\$[\d.,]+M? \(−\d+\.\d%\)$/)
  })

  it('follows Base edits and preset edits', () => {
    const edits = { 'exit.exitCapRate': 0.08, [presetKey('downside', 'exit.exitCapRate')]: 0 }
    const cmp = scenarioComparison(ATWELLS, AS_OF, edits)
    if (cmp.status !== 'ok') throw new Error(cmp.reason)
    expect(cmp.cases.base.assumptions.exit.exitCapRate.value).toBe(0.08)
    expect(cmp.cases.downside.assumptions.exit.exitCapRate.value).toBe(0.08)
    expect(cmp.cases.upside.assumptions.exit.exitCapRate.value).toBeCloseTo(0.0775, 12)
    expect(cmp.presets.downside.find((x) => x.label === 'Exit cap')).toMatchObject({ display: '0 bps', edited: true })
  })
})
