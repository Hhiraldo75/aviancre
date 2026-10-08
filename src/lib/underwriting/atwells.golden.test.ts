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
import { SAMPLE_PROPERTIES } from '../../data/sampleProperties'
import { useAppStore } from '../../store/useAppStore'
import fixture from './__fixtures__/atwells-benchmark.csv?raw'
import { assumptionsFor } from './edits'
import { goldenChecks } from './goldenChecks'
import { underwrite } from './underwrite'

const AS_OF = '2026-10-04'

const ATWELLS = SAMPLE_PROPERTIES.find((p) => p.id === 'sample-atwells-retail-row')
if (!ATWELLS) throw new Error('missing sample-atwells-retail-row')
const defaultRun = underwrite(ATWELLS, AS_OF)

describe('Atwells golden benchmark', () => {
  goldenChecks(defaultRun, fixture)
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
  goldenChecks(reset, fixture)
})
