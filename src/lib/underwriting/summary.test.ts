import { describe, expect, it } from 'vitest'
import fernhillDoc from '../../../docs/samples/fernhill-commons-unit-rent-roll.csv?raw'
import type { Property } from '../../types'
import { SAMPLE_PROPERTIES } from '../../data/sampleProperties'
import { parseCSV } from '../csv'
import { parseRentRoll } from '../rentRollImport'
import atwellsValidation from './__fixtures__/atwells-validation.assumptions.json'
import { defaultAssumptions, withPurchasePrice } from './defaults'
import { assumptionsFor } from './edits'
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
  /** At the assumptions the Excel benchmark was matched at, so these figures are Excel's. */
  const validation = assumptionsFor(ATWELLS, AS_OF, atwellsValidation.changes)
  const v = underwritingSummary(ATWELLS, AS_OF, validation)

  it('shows the Excel check values at the validation set', () => {
    expect(stat(v, 'Unlevered IRR').value).toBe('6.69%')
    expect(stat(v, 'Levered IRR').value).toBe('6.78%')
    expect(stat(v, 'Minimum DSCR').value).toBe('1.60x')
  })
  it('maps engine metrics without recalculating them', () => {
    const m = underwrite(ATWELLS, AS_OF).metrics
    expect(stat(s, 'Going-in cap').value).toBe(`${(m.goingInCapRate * 100).toFixed(2)}%`)
    expect(stat(s, 'Unlevered multiple').value).toBe(`${m.unleveredEquityMultiple.toFixed(2)}x`)
    expect(stat(s, 'Levered multiple').value).toBe(`${m.equityMultiple.toFixed(2)}x`)
    expect(m.exitNOI).toBeGreaterThan(0)
  })
  it('shows $X.XXM from $1M up and full dollars below', () => {
    expect(stat(v, 'Purchase price').value).toBe('$4.15M')
    expect(stat(v, 'Net sale proceeds').value).toBe('$4.61M')
    expect(stat(v, 'Year-1 NOI').value).toBe('$290,296')
    expect(stat(v, 'Normalized Year-11 NOI').value).toBe('$341,402')
    expect(stat(v, 'Price / SF').value).toBe('$288/SF')
  })
  it('shows the max bid at the target levered IRR next to the price', () => {
    const pricing = ok(s).sections[0].stats.map((x) => x.label)
    expect(pricing.slice(0, 2)).toEqual(['Purchase price', 'Max bid at 10% levered IRR'])
    expect(stat(s, 'Max bid at 10% levered IRR').value).toMatch(/^\$\d\.\d\dM$/)
    expect(stat(s, 'Max bid at 10% levered IRR').hint).toMatch(/cap · \(\d+\.\d%\) vs price$/)
  })
  it('labels the price as a model estimate, not an asking price', () => {
    expect(stat(s, 'Purchase price').hint).toBe(PRICE_ESTIMATE_HINT)
    expect(PRICE_ESTIMATE_HINT).toBe('Model estimate at default assumptions: Year-1 NOI ÷ market cap')
  })
  it('notes estimates once and badges EST only on the cap rates', () => {
    expect(ok(s).estimates?.source).toBe('estimated')
    expect(ok(s).estimates?.notes).toMatch(/Exit cap rate: Market cap rate \+ 25 bps/)
    const badged = stats(s).filter((x) => x.src).map((x) => x.label)
    expect(badged).toEqual(['Going-in cap', 'Exit cap'])
    for (const label of badged) expect(stat(s, label).src?.sourceName).toMatch(/^Driven by estimates: /)
  })
  it('keeps hints neutral; only a low DSCR gets a tone', () => {
    for (const x of stats(s)) expect(x.tone, x.label).toBeUndefined()
  })
  it('shortens engine warnings to their first sentence, keeping the full text', () => {
    expect(ok(s).warnings.map((w) => w.full)).toEqual(underwrite(ATWELLS, AS_OF).warnings)
    expect(ok(v).warnings.map((w) => w.full)).toEqual(underwrite(ATWELLS, AS_OF, validation).warnings)
    expect(ok(v).warnings.map((w) => w.short)).toEqual([
      '36% of rentable SF rolls in year 2.',
      'Negative leverage: the 7.00% going-in cap rate is below the 7.58% loan constant, so debt lowers the yearly cash yield.',
      'In-place rents are 32% above market; income declines as leases roll.',
      'Casa Lucenti Trattoria (suite 101) has a $30.00/SF renewal option, above the projected $23.35/SF market rent at its 2030-02-28 expiration.',
    ])
  })
  it('flags sample data and returns NOI for each hold year', () => {
    expect(ok(s).isSample).toBe(true)
    expect(ok(s).scenario).toBe('base')
    expect(ok(s).noiByYear.map((y) => y.year)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
  it('stacks income lost to rollover on NOI, straight from the engine cash flows', () => {
    const r = underwrite(ATWELLS, AS_OF)
    expect(ok(s).noiByYear.map((y) => y.noi)).toEqual(r.cashFlows.map((c) => c.netOperatingIncome))
    expect(ok(s).noiByYear.map((y) => y.lostToRollover)).toEqual(
      r.cashFlows.map((c) => c.absorptionTurnoverVacancy + c.freeRent),
    )
    expect(ok(v).noiByYear[3].tooltip).toBe('Year 4: NOI $302,232 · lost to rollover $28,444')
    expect(ok(v).noiByYear[4].tooltip).toBe('Year 5: NOI $312,751') // nothing rolls
  })
  it('drops the EST badge on price once an analyst enters it', () => {
    const a = withPurchasePrice(defaultAssumptions(ATWELLS, AS_OF), 4_000_000)
    const priced = underwritingSummary(ATWELLS, AS_OF, a)
    expect(stat(priced, 'Purchase price').value).toBe('$4.00M')
    const small = underwritingSummary(ATWELLS, AS_OF, withPurchasePrice(defaultAssumptions(ATWELLS, AS_OF), 999_999))
    expect(stat(small, 'Purchase price').value).toBe('$999,999')
    expect(stat(priced, 'Purchase price').hint).toBe('Analyst input')
    expect(ok(priced).estimates?.sourceName).not.toMatch(/purchase price/)
    expect(stat(priced, 'Going-in cap').src?.sourceName).not.toMatch(/purchase price/)
  })
})

describe('where the cap rates come from', () => {
  it('names the submarket benchmark behind the price and the exit', () => {
    const s = underwritingSummary(ATWELLS, AS_OF)
    expect(stat(s, 'Going-in cap').from).toBe('Federal Hill retail')
    expect(stat(s, 'Exit cap').from).toBe('Federal Hill retail + 25 bps')
  })

  it('names Fernhill\'s Olneyville benchmark from its property block, and the submarket picked on import', () => {
    const fernhill = (details = {}) =>
      parseRentRoll(parseCSV(fernhillDoc), { fileName: 'fernhill.csv', asOf: AS_OF, details }).property!
    const s = underwritingSummary(fernhill(), AS_OF)
    expect([stat(s, 'Going-in cap').value, stat(s, 'Going-in cap').from]).toEqual(['7.95%', 'Olneyville multifamily'])
    expect([stat(s, 'Exit cap').value, stat(s, 'Exit cap').from]).toEqual(['8.20%', 'Olneyville multifamily + 25 bps'])
    expect(stat(s, 'Purchase price').value).toBe('$16.50M')
    const downtown = underwritingSummary(fernhill({ submarket: 'downtown' }), AS_OF)
    expect([stat(downtown, 'Going-in cap').value, stat(downtown, 'Going-in cap').from]).toEqual(['7.45%', 'Downtown / Downcity multifamily'])
    expect(stat(downtown, 'Purchase price').value).toBe('$17.61M')
  })

  it('says when the analyst set them', () => {
    const priced = underwritingSummary(ATWELLS, AS_OF, withPurchasePrice(defaultAssumptions(ATWELLS, AS_OF), 4_000_000))
    expect(stat(priced, 'Going-in cap').from).toBe('from your price')
    expect(stat(underwritingSummary(ATWELLS, AS_OF, { 'acquisition.marketCapRate': 0.075 }), 'Going-in cap').from).toBe(
      'price at your 7.50% market cap',
    )
    expect(stat(underwritingSummary(ATWELLS, AS_OF, { 'exit.exitCapRate': 0.08 }), 'Exit cap').from).toBe('your input')
  })

  it('shows the benchmark cap the price was set at when other edits move the going-in cap', () => {
    const s = underwritingSummary(ATWELLS, AS_OF, { 'operating.generalVacancyPct': 0.25 })
    expect(stat(s, 'Going-in cap').value).not.toBe('7.45%')
    expect(stat(s, 'Going-in cap').from).toBe('price at Federal Hill retail 7.45%')
  })
})

describe('underwriting summary across samples', () => {
  it('works for multifamily', () => {
    for (const id of ['sample-jewelry-lofts', 'sample-federal-hill-apartments']) {
      const s = underwritingSummary(byId(id), AS_OF)
      expect(s.status, id).toBe('ok')
      expect(stat(s, 'Levered IRR').value).toMatch(/^\d+\.\d{2}%$/)
      expect(ok(s).noiByYear.every((y) => y.lostToRollover === 0), id).toBe(true)
    }
  })
  it('never shows NaN, Infinity or undefined', () => {
    for (const p of SAMPLE_PROPERTIES) {
      const s = underwritingSummary(p, AS_OF)
      if (s.status !== 'ok') continue
      for (const x of stats(s)) expect(`${x.value} ${x.hint ?? ''}`, `${p.id} ${x.label}`).not.toMatch(/NaN|Infinity|undefined/)
      expect(s.noiByYear.every((y) => Number.isFinite(y.noi) && Number.isFinite(y.lostToRollover)), p.id).toBe(true)
      for (const y of s.noiByYear) expect(y.tooltip, p.id).not.toMatch(/NaN|Infinity|undefined/)
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
