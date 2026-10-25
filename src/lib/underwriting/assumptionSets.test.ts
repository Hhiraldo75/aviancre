import { describe, expect, it } from 'vitest'
import { SAMPLE_PROPERTIES } from '../../data/sampleProperties'
import { analystExport } from './analystExport'
import {
  appliedSetLabel,
  assumptionSetFile,
  DEFAULTS_SET,
  memoAssumptionSet,
  memoMarker,
  parseAssumptionSetFile,
  sameEdits,
  setFileName,
  setNameError,
  setSummary,
  withoutMarker,
  type SavedAssumptionSet,
} from './assumptionSets'
import { assumptionsFor } from './edits'
import { underwrite } from './underwrite'

const AS_OF = '2026-10-04'
const ATWELLS = SAMPLE_PROPERTIES.find((p) => p.id === 'sample-atwells-retail-row')!
const MY_CASE: SavedAssumptionSet = {
  name: 'My case',
  savedAt: '2026-10-08',
  edits: { 'exit.exitCapRate': 0.075, 'leasing.marketRentGrowth': 0.025, 'acquisition.purchasePrice': 3_900_000 },
}
/** An engine run without its timestamp, for exact comparisons. */
const run = (edits: Record<string, number>) => {
  const { generatedAt: _g, ...rest } = underwrite(ATWELLS, AS_OF, assumptionsFor(ATWELLS, AS_OF, edits))
  return rest
}
/** What a file goes through: written, saved to disk as text, read back. */
const viaFile = (set: SavedAssumptionSet, propertyId = ATWELLS.id): unknown => JSON.parse(JSON.stringify(assumptionSetFile(propertyId, set)))

describe('assumption set files', () => {
  it('hold only the changes, the property id, the set name and the date', () => {
    expect(assumptionSetFile(ATWELLS.id, MY_CASE)).toEqual({
      format: 'aviancre-assumption-set',
      version: 1,
      propertyId: ATWELLS.id,
      name: 'My case',
      savedAt: '2026-10-08',
      changes: MY_CASE.edits,
    })
    expect(setFileName(ATWELLS.id, 'My case (v2)')).toBe('sample-atwells-retail-row--my-case-v2.assumptions.json')
  })

  it('round-trip through export and import', () => {
    expect(parseAssumptionSetFile(viaFile(MY_CASE), ATWELLS, AS_OF)).toEqual({ set: MY_CASE, errors: [] })
  })

  it('reproduce the saved results exactly after the round trip', () => {
    const imported = parseAssumptionSetFile(viaFile(MY_CASE), ATWELLS, AS_OF).set!
    expect(run(imported.edits)).toEqual(run(MY_CASE.edits))
    expect(run(imported.edits)).not.toEqual(run({}))
  })

  it('reject a file for another property, unknown or out-of-range changes, and bad fields', () => {
    expect(parseAssumptionSetFile(viaFile(MY_CASE, 'sample-thayer-shops'), ATWELLS, AS_OF).errors).toEqual([
      'This set is for "sample-thayer-shops", not sample-atwells-retail-row.',
    ])
    const bad = { ...(viaFile(MY_CASE) as object), name: 'defaults', savedAt: 'Oct 8', changes: { 'exit.exitCapRate': 7.5, 'leasing.foo': 1, 'debt.ltv': '0.6' } }
    expect(parseAssumptionSetFile(bad, ATWELLS, AS_OF).errors).toEqual([
      'Set name: "Defaults" is reserved.',
      'Date (savedAt) must be YYYY-MM-DD.',
      'Exit cap rate: 750.00% is out of range (Enter 2–15%).',
      'Unknown assumption "leasing.foo" for this property.',
      'Loan-to-value: value must be a number.',
    ])
    expect(parseAssumptionSetFile({ hello: 1 }, ATWELLS, AS_OF).errors).toEqual(['Not an AVIANCRE assumption set file.'])
    expect(parseAssumptionSetFile({ ...(viaFile(MY_CASE) as object), version: 2 }, ATWELLS, AS_OF).errors).toEqual([
      'Unsupported assumption set version 2.',
    ])
  })

  it('carry edited scenario presets, checked like any other change', () => {
    const withPresets: SavedAssumptionSet = {
      ...MY_CASE,
      edits: { ...MY_CASE.edits, 'scenarios.downside.exit.exitCapRate': 0.0075, 'scenarios.upside.leasing.marketRentGrowth': 0.005 },
    }
    expect(parseAssumptionSetFile(viaFile(withPresets), ATWELLS, AS_OF)).toEqual({ set: withPresets, errors: [] })
    const bad = {
      ...(viaFile(MY_CASE) as object),
      changes: { 'scenarios.downside.exit.exitCapRate': 0.05, 'scenarios.downside.multifamily.turnoverRate': 0.1 },
    }
    expect(parseAssumptionSetFile(bad, ATWELLS, AS_OF).errors).toEqual([
      'Downside exit cap: +500 bps is out of range (Enter −300 bps to 300 bps).',
      'Unknown assumption "scenarios.downside.multifamily.turnoverRate" for this property.',
    ])
  })

  it('validate names', () => {
    expect(setNameError('  ')).toBe('Enter a name')
    expect(setNameError('DEFAULTS')).toBe('"Defaults" is reserved')
    expect(setNameError('x'.repeat(61))).toBe('Use at most 60 characters')
    expect(setNameError('Base')).toBeNull()
  })
})

describe('comparing sets', () => {
  it('treats the same changes as the same set, up to float noise', () => {
    expect(sameEdits({ a: 0.075 }, { a: 0.07500000000000001 })).toBe(true)
    expect(sameEdits({}, undefined)).toBe(true)
    expect(sameEdits({ a: 0.075 }, { a: 0.08 })).toBe(false)
    expect(sameEdits({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })
  it('describes what is applied', () => {
    expect(appliedSetLabel(DEFAULTS_SET, [MY_CASE], {})).toBe('Defaults')
    expect(appliedSetLabel(DEFAULTS_SET, [MY_CASE], { 'exit.exitCapRate': 0.08 })).toBe('unsaved changes')
    expect(appliedSetLabel('My case', [MY_CASE], { ...MY_CASE.edits })).toBe('My case')
    expect(appliedSetLabel('My case', [MY_CASE], {})).toBe('My case with unsaved changes')
  })
})

describe('memos record their assumption set', () => {
  const memo = (marker: string) => `*AI-generated analysis.*\n\n# X: Investment memo\n\nAs of 2026-10-08 · Base scenario\nAssumption set: My case, 3 changes from defaults\n${marker}\n\n## 1. Recommendation\n`

  it('reads the set back from the marker, and hides the marker', () => {
    const md = memo(memoMarker('My case', MY_CASE.edits))
    expect(memoAssumptionSet(md)).toEqual({ name: 'My case', edits: MY_CASE.edits })
    expect(withoutMarker(md)).not.toContain('aviancre-assumption-set')
    expect(withoutMarker(md)).toContain('Assumption set: My case, 3 changes from defaults\n\n## 1. Recommendation')
  })
  it('treats a memo without a marker (or a damaged one) as Defaults', () => {
    expect(memoAssumptionSet(memo(''))).toEqual({ name: DEFAULTS_SET, edits: {} })
    expect(memoAssumptionSet(memo('<!-- aviancre-assumption-set: {broken -->'))).toEqual({ name: DEFAULTS_SET, edits: {} })
  })
  it('gets the header line, changes and marker from the analyst export', () => {
    const r = underwrite(ATWELLS, AS_OF, assumptionsFor(ATWELLS, AS_OF, MY_CASE.edits))
    const set = analystExport(ATWELLS, AS_OF, r, { name: MY_CASE.name, edits: MY_CASE.edits }).meta.assumptionSet
    expect(set.summary).toBe(setSummary('My case', 3))
    expect(set.summary).toBe('Assumption set: My case, 3 changes from defaults')
    expect(set.changes).toEqual([
      'Purchase price $3,900,000 (default $4,147,092)',
      'Market rent growth 2.5% (default 2%)',
      'Exit cap rate 7.50% (default 7.25%)',
    ])
    expect(memoAssumptionSet(memo(set.marker))).toEqual({ name: 'My case', edits: MY_CASE.edits })
    const presets = { ...MY_CASE.edits, 'scenarios.downside.exit.exitCapRate': 0.0075 }
    const withPresets = analystExport(ATWELLS, AS_OF, r, { name: MY_CASE.name, edits: presets }).meta.assumptionSet
    expect(withPresets.summary).toBe('Assumption set: My case, 4 changes from defaults')
    expect(withPresets.changes.at(-1)).toBe('Downside exit cap +75 bps (preset +50 bps)')
    const defaults = analystExport(ATWELLS, AS_OF, underwrite(ATWELLS, AS_OF)).meta.assumptionSet
    expect(defaults).toMatchObject({ name: 'Defaults', summary: 'Assumption set: Defaults, no changes from defaults', changes: [] })
  })
})
