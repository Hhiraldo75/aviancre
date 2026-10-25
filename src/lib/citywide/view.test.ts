import { describe, expect, it } from 'vitest'
import { SUBMARKETS } from '../../data/submarkets'
import { median } from './peers'
import type { CitywideParcel } from './types'
import { DEFAULT_CITYWIDE_SORT, EMPTY_CITYWIDE_FILTERS, matchesCitywide, outlinesGeoJSON, pointsGeoJSON, screeningRows, sortRows, type CitywideFilters } from './view'

const parcel = (pin: string, over: Partial<CitywideParcel>): CitywideParcel => ({
  pin,
  plat: '1',
  lot: pin,
  address: `${pin} Test St`,
  landUseCode: '7',
  assessed: 1_000_000,
  gba: 10_000,
  neighborhood: 'Olneyville',
  point: SUBMARKETS.olneyville.center,
  osm: { office: 0, retail: 0 },
  records: 1,
  ...over,
})

const rows = screeningRows([
  parcel('1', {}), // industrial, Olneyville, ~1.07×
  parcel('2', { gba: 40_000, assessed: 2_000_000 }), // ~2.14×: twice parcel 1
  parcel('3', { landUseCode: '03-610', units: 8, gba: 8_000, assessed: 5_000_000, neighborhood: 'Elmwood', point: [-71.42, 41.8] }), // metro apartments, low but alone in its type
  parcel('4', { landUseCode: '14', gba: undefined }), // vacant land
  parcel('5', { landUseCode: '6', gba: undefined }), // no building area
])
const pins = (rs: typeof rows) => rs.map((r) => r.parcel.pin)
const only = (f: Partial<CitywideFilters>) => pins(rows.filter((r) => matchesCitywide(r, { ...EMPTY_CITYWIDE_FILTERS, ...f })))

describe('screening rows', () => {
  it('carries type, market and band for estimates and skips', () => {
    expect(rows.map((r) => [r.type, r.market, r.band])).toEqual([
      ['industrial', 'olneyville', 'well-below'],
      ['industrial', 'olneyville', 'well-above'],
      ['multifamily', 'metro', 'near'],
      [undefined, 'olneyville', 'skipped'],
      ['commercial', 'olneyville', 'skipped'],
    ])
  })

  it('colors by the ratio vs the median for the property type, keeping the absolute ratio', () => {
    const [a, b, c] = rows
    // Industrial median: the average of the two middle values.
    expect(a.peerMedian).toEqual({ median: (a.ratio! + b.ratio!) / 2, count: 2 })
    expect(a.peerRatio).toBeCloseTo(2 / 3, 9)
    expect(b.peerRatio).toBeCloseTo(4 / 3, 9)
    expect(b.ratio).toBeCloseTo(2 * a.ratio!, 9)
    // Alone in its type: its own median, however far from the assessment.
    expect(c.ratio).toBeLessThan(0.75)
    expect(c.peerRatio).toBe(1)
    expect(rows[3].peerRatio).toBeUndefined()
  })

  it('filters by type, market, size, band and status; empty means any', () => {
    expect(only({})).toEqual(['1', '2', '3', '4', '5'])
    expect(only({ types: ['industrial'] })).toEqual(['1', '2'])
    expect(only({ markets: ['metro'] })).toEqual(['3'])
    expect(only({ minSF: 10_000, maxSF: 10_000 })).toEqual(['1'])
    expect(only({ bands: ['well-above'] })).toEqual(['2'])
    expect(only({ status: 'skipped' })).toEqual(['4', '5'])
    expect(only({ status: 'estimated' })).toEqual(['1', '2', '3'])
  })

  it('sorts either way with missing figures last', () => {
    expect(pins(sortRows(rows, DEFAULT_CITYWIDE_SORT))).toEqual(['2', '3', '1', '4', '5'])
    expect(pins(sortRows(rows, { key: 'ratio', dir: 'desc' })).slice(0, 2)).toEqual(['2', '1'])
    expect(pins(sortRows(rows, { key: 'ratio', dir: 'desc' })).slice(-2)).toEqual(['4', '5'])
    expect(pins(sortRows(rows, { key: 'gba', dir: 'asc' }))).toEqual(['3', '1', '2', '4', '5'])
    expect(pins(sortRows(rows, { key: 'address', dir: 'desc' }))).toEqual(['5', '4', '3', '2', '1'])
  })

  it('draws estimates and skipped buildings, not vacant land; faint outside the filters', () => {
    const outline = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }
    const points = pointsGeoJSON(rows, { ...EMPTY_CITYWIDE_FILTERS, types: ['industrial'] }, { '2': outline })
    expect(points.features.map((f) => f.properties)).toEqual([
      { pin: '1', band: 'well-below', match: true, outlined: false },
      { pin: '2', band: 'well-above', match: true, outlined: true },
      { pin: '3', band: 'near', match: false, outlined: false },
      { pin: '5', band: 'skipped', match: false, outlined: false },
    ])
    expect(outlinesGeoJSON(rows, { '2': outline, '4': outline }, EMPTY_CITYWIDE_FILTERS).features.map((f) => f.properties?.pin)).toEqual(['2'])
  })
})

describe('median', () => {
  it('takes the middle value, or the average of the two middle values', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeUndefined()
  })
})
