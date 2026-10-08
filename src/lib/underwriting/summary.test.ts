import { describe, expect, it } from 'vitest'
import type { Property } from '../../types'
import { SAMPLE_PROPERTIES } from '../../data/sampleProperties'
import { defaultAssumptions, withPurchasePrice } from './defaults'
import { PRICE_ESTIMATE_HINT, underwritingSummary, type SummaryStat, type UnderwritingSummary } from './summary'
import { underwrite } from './underwrite'

const AS_OF = '2026-10-04'
const byId = (id: string) => {
  const p = SAMPLE_PROPERTIES.find((x) => x.id === id)
  if (!p) throw new Error(`missing ${id}`)
  return p
}
const ATWELLS = byId('sample-atwells-retail-row')

function ok(s: UnderwritingSummary) {
  if (s.status !== 'ok') throw new Error(`expected ok, got: ${s.reason}`)
  return s
}
const stats = (s: UnderwritingSummary): SummaryStat[] => ok(s).sections.flatMap((x) => x.stats)
const stat = (s: UnderwritingSummary, label: string) => {
  const found = stats(s).find((x) => x.label === label)
  if (!found) throw new Error(`missing stat ${label}`)
  return found
}
const reason = (s: UnderwritingSummary) => (s.status === 'unavailable' ? s.reason : '')

describe('underwriting summary (Atwells, base scenario)', () => {
  const s = underwritingSummary(ATWELLS, AS_OF)

  it('shows the check values', () => {
    expect(stat(s, 'Unlevered IRR').value).toBe('6.69%')
    expect(stat(s, 'Levered IRR').value).toBe('6.78%')
    expect(stat(s, 'Minimum DSCR').value).toBe('1.60x')
  })
  it('maps engine metrics without recalculating them', () => {
    const m = underwrite(ATWELLS, AS_OF).metrics
    expect(stat(s, 'Going-in cap').value).toBe(`${(m.goingInCapRate * 100).toFixed(2)}%`)
    expect(stat(s, 'Unlevered multiple').value).toBe(`${m.unleveredEquityMultiple.toFixed(2)}x`)
    expect(stat(s, 'Levered multiple').value).toBe(`${m.equityMultiple.toFixed(2)}x`)
    expect(stat(s, 'Year-1 NOI').value).toBe('$290,296')
    expect(stat(s, 'Normalized Year-11 NOI').value).toBe(`$${Math.round(m.exitNOI).toLocaleString('en-US')}`)
  })
  it('labels the price as a model estimate, not an asking price', () => {
    expect(stat(s, 'Purchase price').hint).toBe(PRICE_ESTIMATE_HINT)
    expect(PRICE_ESTIMATE_HINT).toBe('Model estimate: Year-1 NOI ÷ market cap')
  })
  it('badges every stat EST while all assumptions are defaults', () => {
    for (const x of stats(s)) {
      expect(x.src?.source, x.label).toBe('estimated')
      expect(x.src?.sourceName, x.label).toMatch(/^Driven by estimates: /)
    }
    expect(stat(s, 'Exit cap').src?.notes).toMatch(/^Exit cap rate: Market cap rate \+ 25 bps/)
  })
  it('passes the engine warnings through unchanged', () => {
    expect(ok(s).warnings).toEqual(underwrite(ATWELLS, AS_OF).warnings)
    expect(ok(s).warnings.length).toBeGreaterThan(0)
  })
  it('flags sample data and returns NOI for each hold year', () => {
    expect(ok(s).isSample).toBe(true)
    expect(ok(s).scenario).toBe('base')
    expect(ok(s).noiByYear).toHaveLength(10)
  })
  it('drops the EST badge on price once an analyst enters it', () => {
    const a = withPurchasePrice(defaultAssumptions(ATWELLS, AS_OF), 4_000_000)
    const priced = underwritingSummary(ATWELLS, AS_OF, a)
    expect(stat(priced, 'Purchase price').value).toBe('$4M')
    expect(stat(priced, 'Purchase price').src).toBeUndefined()
    expect(stat(priced, 'Purchase price').hint).toBe('Analyst input')
    expect(stat(priced, 'Price / SF').src).toBeUndefined()
    expect(stat(priced, 'Unlevered IRR').src?.source).toBe('estimated')
  })
})

describe('underwriting summary across samples', () => {
  it('works for multifamily', () => {
    for (const id of ['sample-jewelry-lofts', 'sample-federal-hill-apartments']) {
      const s = underwritingSummary(byId(id), AS_OF)
      expect(s.status, id).toBe('ok')
      expect(stat(s, 'Levered IRR').value).toMatch(/^\d+\.\d{2}%$/)
    }
  })
  it('never shows NaN, Infinity or undefined', () => {
    for (const p of SAMPLE_PROPERTIES) {
      const s = underwritingSummary(p, AS_OF)
      if (s.status !== 'ok') continue
      for (const x of stats(s)) expect(`${x.value} ${x.hint ?? ''}`, `${p.id} ${x.label}`).not.toMatch(/NaN|Infinity|undefined/)
      expect(s.noiByYear.every(Number.isFinite), p.id).toBe(true)
    }
  })
})

describe('underwriting summary when data is missing', () => {
  it('explains a negative year-1 NOI instead of pricing below zero (Dorrance Street)', () => {
    const s = underwritingSummary(byId('sample-weybosset-commons'), AS_OF)
    expect(s.status).toBe('unavailable')
    expect(reason(s)).toMatch(/Year-1 NOI is negative/)
  })
  it('needs rentable SF', () => {
    const p: Property = { ...ATWELLS, physical: { ...ATWELLS.physical, rentableSF: { ...ATWELLS.physical.rentableSF, value: 0 } } }
    expect(reason(underwritingSummary(p, AS_OF))).toMatch(/rentable SF/)
  })
  it('needs a market cap rate', () => {
    const p: Property = { ...ATWELLS, market: { ...ATWELLS.market, marketCapRate: { ...ATWELLS.market.marketCapRate, value: 0 } } }
    expect(reason(underwritingSummary(p, AS_OF))).toMatch(/market cap rate/)
  })
  it('needs a rent roll', () => {
    const commercial: Property = { ...ATWELLS, rentRoll: { kind: 'commercial', leases: [], vacancies: [] } }
    expect(reason(underwritingSummary(commercial, AS_OF))).toMatch(/rent roll is empty/)
    const lofts = byId('sample-jewelry-lofts')
    const mf: Property = { ...lofts, rentRoll: { kind: 'multifamily', unitTypes: [] } }
    expect(reason(underwritingSummary(mf, AS_OF))).toMatch(/rent roll is empty/)
  })
  it('turns an engine error into a message', () => {
    const lofts = byId('sample-jewelry-lofts')
    const a = { ...defaultAssumptions(lofts, AS_OF), multifamily: undefined }
    expect(reason(underwritingSummary(lofts, AS_OF, a))).toMatch(/couldn’t run: .*multifamily assumptions are missing/)
  })
})
