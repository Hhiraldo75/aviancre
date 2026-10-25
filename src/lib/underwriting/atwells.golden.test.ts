/**
 * Golden test: Atwells Retail Row, base scenario.
 *
 * These values were independently validated against the Excel benchmark
 * (AVIANCRE_Atwells_Underwriting_Benchmark_v2.xlsx, matched to the cent on
 * Oct 8, 2026). The run uses the assumptions Excel was matched at
 * (__fixtures__/atwells-validation.assumptions.json), not the app's current
 * market-based defaults. Only update __fixtures__/atwells-benchmark.csv or the
 * validation set on purpose when an assumption or method changes, and re-check
 * against Excel when you do. No script writes to the fixtures; `npm run underwrite`
 * writes to docs/ instead.
 */
import { describe, expect, it } from 'vitest'
import { SAMPLE_PROPERTIES } from '../../data/sampleProperties'
import { useAppStore } from '../../store/useAppStore'
import fixture from './__fixtures__/atwells-benchmark.csv?raw'
import validation from './__fixtures__/atwells-validation.assumptions.json'
import { assumptionsFor } from './edits'
import { goldenChecks, validationSet } from './goldenChecks'
import { underwrite } from './underwrite'

const AS_OF = '2026-10-04'

const ATWELLS = SAMPLE_PROPERTIES.find((p) => p.id === 'sample-atwells-retail-row')
if (!ATWELLS) throw new Error('missing sample-atwells-retail-row')
const VALIDATION = validationSet(validation, ATWELLS, AS_OF)
const validationRun = underwrite(ATWELLS, AS_OF, assumptionsFor(ATWELLS, AS_OF, VALIDATION.edits))
const defaultRun = underwrite(ATWELLS, AS_OF)

describe('Atwells golden benchmark', () => {
  goldenChecks(validationRun, fixture)
})

/** Runs the engine on Atwells with whatever edits the store holds, as the UI does. */
const runFromStore = () => underwrite(ATWELLS, AS_OF, assumptionsFor(ATWELLS, AS_OF, useAppStore.getState().assumptionEdits[ATWELLS.id]))
const store = useAppStore.getState()
const withoutTimestamp = ({ generatedAt: _g, ...rest }: typeof validationRun) => rest

describe('Atwells with an edited exit cap', () => {
  store.saveAssumptionSet(ATWELLS.id, VALIDATION)
  store.setAssumption(ATWELLS.id, 'exit.exitCapRate', 0.075)
  const edited = runFromStore()

  it('starts from a 7.25% exit cap', () => {
    expect(validationRun.assumptions.exit.exitCapRate.value).toBeCloseTo(0.0725, 12)
    expect(edited.assumptions.exit.exitCapRate).toMatchObject({ value: 0.075, source: 'imported', sourceName: 'Analyst input' })
  })
  it('lowers both IRRs at 7.50%', () => {
    expect(edited.metrics.unleveredIRR!).toBeLessThan(validationRun.metrics.unleveredIRR!)
    expect(edited.metrics.leveredIRR!).toBeLessThan(validationRun.metrics.leveredIRR!)
  })
  it('changes only the sale, not the price or operations', () => {
    expect(edited.metrics.purchasePrice).toBe(validationRun.metrics.purchasePrice)
    expect(edited.cashFlows.map((c) => c.netOperatingIncome)).toEqual(validationRun.cashFlows.map((c) => c.netOperatingIncome))
    expect(edited.metrics.exitValue).toBeLessThan(validationRun.metrics.exitValue)
  })
})

describe('Atwells golden benchmark after Reset', () => {
  store.applyAssumptionSet(ATWELLS.id, VALIDATION.name)
  store.setAssumption(ATWELLS.id, 'exit.exitCapRate', 0.075)
  store.setAssumption(ATWELLS.id, 'operating.generalVacancyPct', 0.07)
  store.resetAssumption(ATWELLS.id, 'operating.generalVacancyPct')
  store.resetAssumptions(ATWELLS.id)
  const reset = runFromStore()
  const editsAfterReset = useAppStore.getState().assumptionEdits[ATWELLS.id]
  store.applyAssumptionSet(ATWELLS.id, VALIDATION.name)
  const reapplied = runFromStore()

  it('clears every edit', () => {
    expect(editsAfterReset).toBeUndefined()
  })
  it('restores the default results exactly', () => {
    expect(withoutTimestamp(reset)).toEqual(withoutTimestamp(defaultRun))
  })
  it('reapplying the validation set reproduces its results exactly', () => {
    expect(withoutTimestamp(reapplied)).toEqual(withoutTimestamp(validationRun))
  })
  goldenChecks(reapplied, fixture)
})

describe('Atwells with saved assumption sets', () => {
  store.applyAssumptionSet(ATWELLS.id, VALIDATION.name)
  store.setAssumption(ATWELLS.id, 'exit.exitCapRate', 0.075)
  store.setAssumption(ATWELLS.id, 'operating.generalVacancyPct', 0.07)
  store.setAssumption(ATWELLS.id, 'acquisition.marketCapRate', 0.0725)
  store.saveAssumptionSet(ATWELLS.id, { name: 'My case', savedAt: AS_OF, edits: useAppStore.getState().assumptionEdits[ATWELLS.id] })
  const saved = runFromStore()
  store.setAssumption(ATWELLS.id, 'debt.ltv', 0.5) // an unsaved change on top
  const unsaved = runFromStore()
  store.applyAssumptionSet(ATWELLS.id, 'Defaults')
  const atDefaults = runFromStore()
  store.applyAssumptionSet(ATWELLS.id, 'My case')
  const reapplied = runFromStore()
  const activeAfterReapply = useAppStore.getState().activeSets[ATWELLS.id]
  store.applyAssumptionSet(ATWELLS.id, VALIDATION.name)
  const atValidation = runFromStore()
  store.applyAssumptionSet(ATWELLS.id, 'Defaults')
  const activeAtEnd = useAppStore.getState().activeSets[ATWELLS.id]

  it('reapplying a saved set reproduces its results exactly', () => {
    expect(withoutTimestamp(reapplied)).toEqual(withoutTimestamp(saved))
    expect(withoutTimestamp(unsaved)).not.toEqual(withoutTimestamp(saved))
    expect(activeAfterReapply).toBe('My case')
  })
  it('Defaults restores the default results exactly', () => {
    expect(withoutTimestamp(atDefaults)).toEqual(withoutTimestamp(defaultRun))
    expect(activeAtEnd).toBeUndefined()
  })
  it('keeps the saved sets after switching to Defaults', () => {
    expect(useAppStore.getState().assumptionSets[ATWELLS.id]?.map((x) => x.name)).toEqual([VALIDATION.name, 'My case'])
  })
  describe('golden benchmark at the validation set', () => goldenChecks(atValidation, fixture))
})
