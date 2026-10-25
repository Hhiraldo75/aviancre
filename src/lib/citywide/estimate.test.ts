import { describe, expect, it } from 'vitest'
import { SUBMARKETS } from '../../data/submarkets'
import { commercialType, estimateLine, estimateParcel, METRO_NAME, ratioBand, SCREENING_LABEL, unitsFor, type CitywideEstimate } from './estimate'
import type { CitywideParcel } from './types'

const parcel = (over: Partial<CitywideParcel> = {}): CitywideParcel => ({
  pin: '100001',
  plat: '10',
  lot: '1',
  address: '1 Test St',
  landUseCode: '7',
  assessed: 1_000_000,
  gba: 10_000,
  neighborhood: 'Olneyville',
  point: SUBMARKETS.olneyville.center,
  osm: { office: 0, retail: 0 },
  records: 1,
  ...over,
})

const estimated = (p: CitywideParcel): CitywideEstimate => {
  const r = estimateParcel(p)
  if (r.status !== 'estimated') throw new Error(`skipped: ${r.reason}`)
  return r
}

describe('estimateParcel: one benchmark, by hand', () => {
  it('industrial in Olneyville: 95% rentable, NNN, landlord pays opex on the vacant share only', () => {
    // Olneyville industrial: $9.50/SF, 4.3% vacancy, 7.70% cap, $3.25/SF opex; 10,000 SF gross × 95% = 9,500 SF.
    const r = estimated(parcel())
    const [line] = r.components[0].options
    expect([line.rent.value, line.vacancyRate.value, line.capRate.value, line.opex.value]).toEqual([9.5, 0.043, 0.077, 3.25])
    expect(line.area!.gross).toMatchObject({ value: 10_000, source: 'public' })
    expect(line.area!.efficiency).toMatchObject({ value: 0.95, source: 'estimated' })
    expect(line.quantity).toMatchObject({ value: 9_500, source: 'estimated', sourceName: 'Gross building area × 95% rentable' })
    expect(line.potentialIncome).toBeCloseTo(90_250, 6)
    expect(line.vacancyLoss).toBeCloseTo(3_880.75, 6)
    expect(line.landlordOpex).toBeCloseTo(1_327.625, 6) // 9,500 × 4.3% × $3.25
    expect(line.managementFee).toBeCloseTo(2_591.0775, 6) // 3% of $86,369.25
    expect(r.noi.value).toBeCloseTo(82_450.5475, 6)
    expect(r.value.value).toBeCloseTo(1_070_786.33, 1)
    expect(r.ratio).toBeCloseTo(1.070786, 5)
    expect(r.market).toEqual({ submarket: 'olneyville', method: 'Olneyville neighborhood → Olneyville' })
  })

  it('apartments on College Hill from the city unit count: landlord pays opex per unit', () => {
    // College Hill: $2,300/unit/mo, 3.0% vacancy, 7.20% cap, $6,800/unit/yr.
    const r = estimated(parcel({ landUseCode: '03-11+', units: 20, gba: 18_000, neighborhood: 'College Hill', point: SUBMARKETS['college-hill'].center }))
    const [line] = r.components[0].options
    expect(line.quantity).toMatchObject({ value: 20, source: 'public' })
    expect(line.area).toBeUndefined()
    expect(line.potentialIncome).toBeCloseTo(552_000, 6)
    expect(line.landlordOpex).toBeCloseTo(136_000, 6)
    expect(r.noi.value).toBeCloseTo(383_376.8, 6)
    expect(r.value.value).toBeCloseTo(5_324_677.78, 1)
    expect(r.value.confidence).toBe('medium')
  })

  it('office downtown from OpenStreetMap tags: 85% rentable, full-service gross, landlord pays all opex', () => {
    // Downtown office: $21.25/SF, 17% vacancy, 10.75% cap, $10.50/SF; 10,000 SF gross × 85% = 8,500 SF.
    const r = estimated(parcel({ landUseCode: '6', neighborhood: 'Downtown', point: SUBMARKETS.downtown.center, osm: { office: 3, retail: 0 } }))
    expect(r.type).toBe('office')
    expect(r.market.submarket).toBe('downtown')
    const [line] = r.components[0].options
    expect(line.leaseType).toBe('full-service-gross')
    expect(line.quantity.value).toBeCloseTo(8_500, 9)
    expect(line.landlordOpex).toBeCloseTo(89_250, 6)
    expect(r.noi.value).toBeCloseTo(56_171.1875, 6)
    expect(r.value.value).toBeCloseTo(522_522.67, 1)
    expect(r.typeNotes).toContain('OpenStreetMap: 0 shops, restaurants or banks and 3 offices inside the parcel → office')
  })

  it('labels every figure an estimate, as a screening estimate', () => {
    const r = estimated(parcel())
    expect(r.value.source).toBe('estimated')
    expect(r.noi.source).toBe('estimated')
    expect(r.value.notes).toContain(SCREENING_LABEL)
    expect(r.value.notes).toContain('Olneyville neighborhood → Olneyville')
  })
})

describe('estimateParcel: office/retail unknown', () => {
  it('blends office and retail on 87.5% rentable, at the metro figure where the submarket has no office benchmark', () => {
    const r = estimated(parcel({ landUseCode: '6', neighborhood: 'Federal Hill', point: SUBMARKETS['federal-hill'].center }))
    expect(r.type).toBe('commercial')
    const [office, retail] = r.components[0].options
    expect(office.market).toBe(METRO_NAME)
    expect(office.marketNote).toBe('Federal Hill has no office benchmark')
    expect(office.quantity.value).toBe(8_750)
    expect(retail.area!.efficiency.value).toBe(0.875)
    expect(office.value).toBeCloseTo(911_797.65, 1) // metro office: $25, 13.3%, 10.1% cap
    expect(retail.market).toBe('Federal Hill')
    expect(retail.value).toBeCloseTo(2_409_848.66, 1) // Federal Hill retail: $22, 2.9%, 7.45% cap
    expect(r.value.value).toBeCloseTo((911_797.65 + 2_409_848.66) / 2, 1)
    expect(r.value.range!.low).toBeCloseTo(911_797.65, 1)
    expect(r.value.range!.high).toBeCloseTo(2_409_848.66, 1)
    expect(r.value.confidence).toBe('low')
  })

  it('takes a side only with two thirds of the tagged features', () => {
    expect(commercialType({ office: 2, retail: 1 }).type).toBe('office')
    expect(commercialType({ office: 1, retail: 2 }).type).toBe('retail')
    expect(commercialType({ office: 1, retail: 1 }).type).toBe('commercial')
    expect(commercialType({ office: 0, retail: 0 })).toEqual({
      type: 'commercial',
      note: 'No OpenStreetMap office or shop tags inside the parcel: office/retail blend',
    })
  })
})

describe('estimateParcel: units', () => {
  it('derives units from building area when the city record has none (EST)', () => {
    const r = estimated(parcel({ landUseCode: '03-610', gba: 8_400 }))
    const units = r.components[0].options[0].quantity
    expect(units).toMatchObject({ value: 8, source: 'estimated' })
    expect(r.typeNotes).toContain('No unit count on the city record: 8 units from the building area')
    expect(r.value.confidence).toBe('low')
  })

  it("replaces a city unit count that doesn't fit the tax roll class", () => {
    expect(unitsFor('03-11+', 1, 184_000)!.units.value).toBe(184)
    expect(unitsFor('03-11+', 1, 184_000)!.note).toBe("The city record's unit count (1) doesn't fit the tax roll class (11+ units): 184 units from the building area")
    // Kept within the band either way.
    expect(unitsFor('03-610', 40, 5_000)!.units.value).toBe(6)
    expect(unitsFor('03-610', 40, 50_000)!.units.value).toBe(10)
    expect(unitsFor('03-610', 8, 50_000)).toEqual({ units: expect.objectContaining({ value: 8, source: 'public' }) })
    expect(unitsFor('4', undefined, 5_000)).toBeNull()
  })
})

describe('estimateParcel: mixed use split by units', () => {
  it('prices units as apartments and the rest of the building as commercial, 90% rentable', () => {
    const p = parcel({ landUseCode: '04-05U', units: 3, gba: 5_000, neighborhood: 'Fox Point', point: SUBMARKETS['fox-point'].center, osm: { office: 0, retail: 2 } })
    const r = estimated(p)
    expect(r.components.map((c) => c.label)).toEqual(['Apartments', 'Commercial space'])
    const [apartments, commercial] = r.components.map((c) => c.options)
    expect(apartments[0].quantity.value).toBe(3)
    expect(commercial).toHaveLength(1)
    expect(commercial[0].benchmarkType).toBe('retail')
    expect(commercial[0].area!.gross).toMatchObject({ value: 2_000, source: 'estimated' })
    expect(commercial[0].quantity).toMatchObject({ value: 1_800, sourceName: '(Gross building area − 3 units × 1,000 SF) × 90% rentable' })
    const market = { submarket: 'fox-point' as const, method: '' }
    expect(apartments[0].value).toBeCloseTo(estimateLine('multifamily', apartments[0].quantity, market).value, 6)
    expect(apartments[0].value).toBeCloseTo(620_307.0, 0)
    expect(commercial[0].value).toBeCloseTo(583_652.78, 1)
    expect(r.value.value).toBeCloseTo(apartments[0].value + commercial[0].value, 6)
  })

  it('is apartments only when the units fill the building', () => {
    const r = estimated(parcel({ landUseCode: '04-610', units: 8, gba: 7_000 }))
    expect(r.components.map((c) => c.label)).toEqual(['Apartments'])
    expect(r.typeNotes).toContain('Building area is no more than 8 units × 1,000 SF: apartments only')
  })

  it('uses the class band when the city has no unit count, and blends the commercial part', () => {
    const r = estimated(parcel({ landUseCode: '04-05U', gba: 9_000 }))
    const [apartments, commercial] = r.components
    expect(apartments.options[0].quantity.value).toBe(5)
    expect(commercial.options.map((l) => l.benchmarkType)).toEqual(['office', 'retail'])
    // The mixed-use share, not the blend's 87.5%.
    expect(commercial.options[0].quantity.value).toBe(3_600)
    expect(r.value.range).toBeDefined()
  })
})

describe('estimateParcel: metro and skips', () => {
  it('uses the metro figures outside the submarket neighborhoods', () => {
    const r = estimated(parcel({ neighborhood: 'Elmwood', point: [-71.42, 41.8] }))
    expect(r.market).toEqual({ submarket: null, method: 'Elmwood neighborhood has no submarket: metro figures' })
    expect(r.components[0].options[0].market).toBe(METRO_NAME)
    expect(r.components[0].options[0].rent.value).toBe(11)
    expect(r.value.confidence).toBe('low')
  })

  it('skips vacant land, utilities, non-commercial lots and lots with no building area, with the reason', () => {
    expect(estimateParcel(parcel({ landUseCode: '14' }))).toMatchObject({ status: 'skipped', reason: 'vacant-land' })
    expect(estimateParcel(parcel({ landUseCode: '10' }))).toMatchObject({ status: 'skipped', reason: 'utility' })
    expect(estimateParcel(parcel({ landUseCode: '1' }))).toMatchObject({ status: 'skipped', reason: 'not-commercial' })
    expect(estimateParcel(parcel({ landUseCode: '6', gba: undefined }))).toEqual({ status: 'skipped', pin: '100001', type: 'commercial', reason: 'no-building-area' })
  })

  it('has no ratio without an assessment', () => {
    const r = estimated(parcel({ assessed: undefined }))
    expect(r.ratio).toBeUndefined()
  })
})

describe('ratioBand', () => {
  it('bands are [low, high): each edge belongs to the band above', () => {
    expect(ratioBand(0.7499)).toBe('well-below')
    expect(ratioBand(0.75)).toBe('below')
    expect(ratioBand(0.9)).toBe('near')
    expect(ratioBand(1.0999)).toBe('near')
    expect(ratioBand(1.1)).toBe('above')
    expect(ratioBand(1.33)).toBe('well-above')
    expect(ratioBand(undefined)).toBe('no-assessment')
  })
})
