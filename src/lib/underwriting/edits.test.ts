import { describe, expect, it } from 'vitest'
import { SAMPLE_PROPERTIES } from '../../data/sampleProperties'
import { underwritingSummary } from './summary'
import {
  assumptionsFor,
  defaultsFor,
  editableFields,
  fieldValue,
  formatInput,
  parseInput,
  validateValue,
  type AssumptionField,
} from './edits'
import { underwrite } from './underwrite'

const AS_OF = '2026-10-04'
const byId = (id: string) => {
  const p = SAMPLE_PROPERTIES.find((x) => x.id === id)
  if (!p) throw new Error(`missing ${id}`)
  return p
}
const ATWELLS = byId('sample-atwells-retail-row')
const FEDERAL_HILL = byId('sample-federal-hill-apartments')
const defaults = defaultsFor(ATWELLS, AS_OF)
const field = (key: string): AssumptionField => {
  const f = editableFields(defaults).find((x) => x.key === key)
  if (!f) throw new Error(`no field ${key}`)
  return f
}

describe('editable assumption registry', () => {
  it('points every field at a numeric Sourced value, for every sample property', () => {
    for (const p of SAMPLE_PROPERTIES) {
      const a = defaultsFor(p, AS_OF)
      for (const f of editableFields(a)) {
        const v = fieldValue(a, f.key)
        expect(typeof v.value, `${p.id} ${f.key}`).toBe('number')
        expect(v.sourceName, `${p.id} ${f.key}`).toBeTruthy()
      }
    }
  })
  it('has unique keys and shows commercial or multifamily leasing fields, not both', () => {
    const keys = editableFields(defaults).map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain('leasing.renewal.tiPerSF')
    expect(keys).not.toContain('multifamily.turnoverRate')
    const mf = editableFields(defaultsFor(FEDERAL_HILL, AS_OF)).map((f) => f.key)
    expect(mf).toContain('multifamily.turnoverRate')
    expect(mf).not.toContain('leasing.renewalProbability')
  })
})

describe('validation', () => {
  it('checks ranges in display units', () => {
    const cap = field('exit.exitCapRate')
    expect(validateValue(cap, 0.02)).toBeNull()
    expect(validateValue(cap, 0.15)).toBeNull()
    expect(validateValue(cap, 0.019)).toBe('Enter 2–15%')
    expect(validateValue(cap, 0.151)).toBe('Enter 2–15%')
    expect(validateValue(field('debt.ltv'), 0.9)).toBeNull()
    expect(validateValue(field('debt.ltv'), 0.91)).toBe('Enter 0–90%')
    expect(validateValue(field('leasing.renewalProbability'), 1)).toBeNull()
    expect(validateValue(field('leasing.renewalProbability'), 1.01)).toBe('Enter 0–100%')
    expect(validateValue(field('leasing.marketRentGrowth'), -0.11)).toBe('Enter −10% to 15%')
  })
  it('wants whole years where the engine does', () => {
    expect(validateValue(field('acquisition.holdYears'), 7)).toBeNull()
    expect(validateValue(field('acquisition.holdYears'), 7.5)).toBe('Enter a whole number, 1–20 yrs')
    expect(validateValue(field('acquisition.holdYears'), 0)).toBe('Enter a whole number, 1–20 yrs')
  })
  it('needs a positive price and non-negative costs', () => {
    expect(validateValue(field('acquisition.purchasePrice'), 0)).toBe('Enter an amount above $0')
    expect(validateValue(field('acquisition.initialCapex'), 0)).toBeNull()
    expect(validateValue(field('acquisition.initialCapex'), -1)).toBe('Enter $0 or more')
  })
})

describe('parsing and formatting input', () => {
  it('reads percents, commas, $ and term years', () => {
    expect(parseInput(field('exit.exitCapRate'), '7.5')).toEqual({ value: 0.075 })
    expect(parseInput(field('exit.exitCapRate'), ' 7.5% ')).toEqual({ value: 0.075 })
    expect(parseInput(field('acquisition.purchasePrice'), '$4,250,000')).toEqual({ value: 4_250_000 })
    expect(parseInput(field('leasing.newLease.termMonths'), '7.5')).toEqual({ value: 90 })
    expect(parseInput(field('leasing.marketRentGrowth'), '-1')).toEqual({ value: -0.01 })
  })
  it('rejects text and out-of-range numbers with a short message', () => {
    expect(parseInput(field('exit.exitCapRate'), 'abc')).toEqual({ error: 'Enter a number' })
    expect(parseInput(field('exit.exitCapRate'), '')).toEqual({ error: 'Enter a number' })
    expect(parseInput(field('exit.exitCapRate'), '20')).toEqual({ error: 'Enter 2–15%' })
  })
  it('shows engine values the way they are typed', () => {
    expect(formatInput(field('exit.exitCapRate'), 0.0725)).toBe('7.25')
    expect(formatInput(field('leasing.newLease.termMonths'), 120)).toBe('10')
    expect(formatInput(field('acquisition.purchasePrice'), 4_146_371.429)).toBe('4,146,371.43')
  })
})

describe('applying edits', () => {
  it('returns the defaults object itself when nothing is edited', () => {
    expect(assumptionsFor(ATWELLS, AS_OF)).toBe(defaults)
    expect(assumptionsFor(ATWELLS, AS_OF, {})).toBe(defaults)
  })
  it('reuses the result for the same edits object, so views share one run', () => {
    const edits = { 'exit.exitCapRate': 0.075 }
    expect(assumptionsFor(ATWELLS, AS_OF, edits)).toBe(assumptionsFor(ATWELLS, AS_OF, edits))
  })
  it('marks edited values as Analyst input and leaves the defaults untouched', () => {
    const a = assumptionsFor(ATWELLS, AS_OF, { 'debt.rate.rate': 0.07, 'operating.expenses.0.annualAmount': 100_000 })
    expect(fieldValue(a, 'debt.rate.rate')).toMatchObject({ value: 0.07, source: 'imported', sourceName: 'Analyst input' })
    expect(a.operating.expenses[0].annualAmount.value).toBe(100_000)
    expect(fieldValue(defaults, 'debt.rate.rate').value).toBe(0.065)
    expect(defaults.operating.expenses[0].annualAmount.source).toBe('estimated')
  })
  it('anchors the estimated price to defaults: other edits move the going-in cap, not the price', () => {
    const a = assumptionsFor(ATWELLS, AS_OF, { 'operating.creditLossPct': 0.03 })
    expect(a.acquisition.purchasePrice).toEqual(defaults.acquisition.purchasePrice)
    const base = underwrite(ATWELLS, AS_OF, defaults)
    const r = underwrite(ATWELLS, AS_OF, a)
    expect(base.metrics.goingInCapRate).toBeCloseTo(ATWELLS.market.marketCapRate.value, 10)
    expect(r.metrics.goingInCapRate).toBeLessThan(base.metrics.goingInCapRate)
    expect(r.metrics.unleveredIRR!).toBeLessThan(base.metrics.unleveredIRR!)
  })
  it('re-prices the estimate when the market cap rate is edited', () => {
    const a = assumptionsFor(ATWELLS, AS_OF, { 'acquisition.marketCapRate': 0.075, 'operating.creditLossPct': 0.03 })
    expect(a.acquisition.purchasePrice.source).toBe('estimated')
    // Still the default year-1 NOI, now ÷ 7.5% instead of 7%.
    expect(a.acquisition.purchasePrice.value).toBeCloseTo((defaults.acquisition.purchasePrice.value * 0.07) / 0.075, 4)
    expect(a.acquisition.purchasePrice.notes).toBe('Market cap rate 7.50% (analyst input)')
    expect(underwrite(ATWELLS, AS_OF, assumptionsFor(ATWELLS, AS_OF, { 'acquisition.marketCapRate': 0.075 })).metrics.goingInCapRate).toBeCloseTo(0.075, 10)
  })
  it('keeps an entered price, whatever the market cap rate', () => {
    const a = assumptionsFor(ATWELLS, AS_OF, { 'acquisition.marketCapRate': 0.075, 'acquisition.purchasePrice': 4_000_000 })
    expect(a.acquisition.purchasePrice).toMatchObject({ value: 4_000_000, sourceName: 'Analyst input' })
  })
  it('ignores out-of-range and unknown edits', () => {
    const a = assumptionsFor(ATWELLS, AS_OF, { 'exit.exitCapRate': 0.5, 'not.a.field': 1 })
    expect(a.exit.exitCapRate).toEqual(defaults.exit.exitCapRate)
  })
  it('flows into the summary card, with the change listed for the chip', () => {
    const s = underwritingSummary(ATWELLS, AS_OF, { 'exit.exitCapRate': 0.075 })
    if (s.status !== 'ok') throw new Error(s.reason)
    expect(s.changes).toEqual(['Exit cap rate 7.50% (default 7.25%)'])
    const exitCap = s.sections.flatMap((x) => x.stats).find((x) => x.label === 'Exit cap')!
    expect(exitCap.value).toBe('7.50%')
    expect(exitCap.src).toBeUndefined() // no longer an estimate
  })
})
