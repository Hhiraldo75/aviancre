import { describe, expect, it } from 'vitest'
import type { Polygon } from 'geojson'
import type { Feature } from '../../services/providenceGis'
import { coverageLines, coverageReport } from './coverage'
import { estimateParcel } from './estimate'
import { joinParcels, osmKind, platLotToPin, type TaxRollRow } from './join'
import { simplifyRing } from './outline'

const square = (x: number, y: number, d = 0.001): Polygon => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]],
})

const tax = (plat: number, lot: number, cls: string, assessed: number, extra: Partial<TaxRollRow> = {}): TaxRollRow => ({
  plat: String(plat),
  lot: String(lot),
  class: cls,
  total_assmt: String(assessed),
  formated_address: `${lot} Test St`,
  ...extra,
})

const gis = (pin: string, props: Record<string, string>, geometry: Polygon | null = square(-71.44, 41.82)): Feature => ({
  type: 'Feature',
  properties: { PIN: pin, ...props },
  geometry,
})

const hood = { name: 'Olneyville', geometry: square(-71.45, 41.81, 0.05) }

describe('joinParcels', () => {
  const taxRows = [
    // A commercial condo: two commercial units on plat 20 lot 38, plus a third the roll classes otherwise.
    tax(20, 38, '24', 400_000, { unit: '0001' }),
    tax(20, 38, '24', 600_000, { unit: '0002' }),
    // An industrial lot with a duplicated city row and an OSM shop.
    tax(21, 5, '7', 900_000),
    // On the roll but missing from the city parcel layer: placed at its tax-roll point.
    tax(22, 9, '6', 300_000, { property_location: { coordinates: [-71.43, 41.83] } }),
    // Not commercial: ignored.
    tax(23, 1, '1', 500_000),
    tax(24, 1, '6', 700_000),
  ]
  const gisFeatures = [
    gis('200038', { UnitNum: '1', GrBldgArea: '3000.00000', YearBuilt: '1920', AreaAC: '0.5', MuniUseCode: '24' }),
    gis('200038', { UnitNum: '2', GrBldgArea: '2000.00000', YearBuilt: '1925', AreaAC: '0.5', MuniUseCode: '24' }),
    gis('200038', { UnitNum: '3', GrBldgArea: '27000.00000', YearBuilt: '1925', AreaAC: '0.5', MuniUseCode: '12' }),
    // No unit numbers on the roll: the layer's commercial use code decides.
    gis('240001', { UnitNum: '1', GrBldgArea: '4000.00000', MuniUseCode: '06' }, square(-71.42, 41.82)),
    gis('240001', { UnitNum: '2', GrBldgArea: '9000.00000', MuniUseCode: '23' }, square(-71.42, 41.82)),
    gis('210005', { UnitNum: '', GrBldgArea: '12000.00000', NumFloors: '2', MuniUseCode: '07' }, square(-71.43, 41.82)),
    gis('210005', { UnitNum: '', GrBldgArea: '12000.00000', NumFloors: '2', MuniUseCode: '07' }, square(-71.43, 41.82)),
  ]
  const osm = [
    { point: [-71.4295, 41.8205] as [number, number], kind: 'retail' as const },
    { point: [-71.5, 41.9] as [number, number], kind: 'office' as const },
  ]
  const { parcels, outlines, stats } = joinParcels({ taxRows, gisFeatures, neighborhoods: [hood], osm })
  const byPin = Object.fromEntries(parcels.map((p) => [p.pin, p]))

  it('collapses a condo lot to one parcel: assessments and commercial unit areas summed', () => {
    expect(byPin['200038']).toMatchObject({ plat: '20', lot: '38', landUseCode: '24', assessed: 1_000_000, gba: 5_000, yearBuilt: 1920, records: 2 })
    expect(byPin['200038'].landSF).toBe(21_780)
    expect(byPin['240001'].gba).toBe(4_000)
  })

  it('counts a repeated city row once, and OSM features inside the parcel', () => {
    expect(byPin['210005']).toMatchObject({ gba: 12_000, floors: 2, neighborhood: 'Olneyville', osm: { office: 0, retail: 1 } })
    expect(outlines['210005']).toBeDefined()
  })

  it('falls back to the tax-roll point without a city parcel, leaving unknowns out', () => {
    expect(byPin['220009'].point).toEqual([-71.43, 41.83])
    expect(byPin['220009']).not.toHaveProperty('gba')
    expect(outlines['220009']).toBeUndefined()
  })

  it('reports what it joined', () => {
    expect(parcels.map((p) => p.pin)).toEqual(['200038', '210005', '220009', '240001'])
    expect(stats).toEqual({
      taxRollRecords: 6,
      commercialLots: 4,
      byLandUse: { 'Commercial condo': 1, Industrial: 1, 'Commercial (class II)': 2 },
      noCityParcel: 1,
      noLocation: 0,
    })
  })

  it('builds the coverage report from the join and the estimates', () => {
    const report = coverageReport(stats, parcels, parcels.map(estimateParcel))
    expect(report).toMatchObject({
      inSnapshot: 4,
      withBuildingArea: 3,
      estimated: 3,
      skipped: { 'no-building-area': 1, 'vacant-land': 0, utility: 0, 'not-commercial': 0, 'no-income': 0 },
      officeRetail: { office: 0, retail: 0, blend: 2 },
      inSubmarket: 3,
      atMetro: 0,
    })
    expect(Object.fromEntries(Object.entries(report.medianRatio).map(([t, m]) => [t, m.count]))).toEqual({ commercial: 2, industrial: 1 })
    expect(Object.values(report.peerBands).reduce((a, b) => a + b, 0)).toBe(3)
    expect(report.peerBands.near).toBeGreaterThanOrEqual(1) // the lone industrial lot is its own median
    const lines = coverageLines(report)
    expect(lines).toContain('| **Estimated** | **3** (75%) |')
    expect(lines).toContain('| Skipped: The city record has no building area | 1 |')
  })
})

describe('osmKind', () => {
  it('counts offices, shops, storefront amenities and retail buildings', () => {
    expect(osmKind({ office: 'company' })).toBe('office')
    expect(osmKind({ building: 'office', shop: 'bakery' })).toBe('office')
    expect(osmKind({ shop: 'bakery' })).toBe('retail')
    expect(osmKind({ amenity: 'restaurant' })).toBe('retail')
    expect(osmKind({ building: 'retail' })).toBe('retail')
    expect(osmKind({ amenity: 'school' })).toBeNull()
    expect(osmKind({ building: 'yes' })).toBeNull()
  })
})

describe('outline helpers', () => {
  it('turns a plat and lot into the city PIN', () => {
    expect(platLotToPin(20, 38)).toBe('200038')
    expect(platLotToPin(4, 261)).toBe('40261')
  })

  it('drops points within the tolerance and keeps corners', () => {
    const ring = [[-71.44, 41.82], [-71.43995, 41.820001], [-71.4399, 41.82], [-71.4399, 41.8201], [-71.44, 41.8201], [-71.44, 41.82]]
    expect(simplifyRing(ring, 0.5)).toEqual([[-71.44, 41.82], [-71.4399, 41.82], [-71.4399, 41.8201], [-71.44, 41.8201], [-71.44, 41.82]])
  })
})
