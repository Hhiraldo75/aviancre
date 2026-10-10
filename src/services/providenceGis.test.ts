import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Feature, type FeatureCollection, LAYERS, lookupParcelAt, parseOverlays, parseParcelFeature, pointQueryUrl } from './providenceGis'
import { normalizeZoningCode, parcelMetrics } from '../lib/parcelMetrics'

/** Shape of a parcel feature as the city's ArcGIS server returns it with f=geojson. */
const FIXTURE: Feature = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[[-71.4115, 41.8245], [-71.4110, 41.8245], [-71.4110, 41.8249], [-71.4115, 41.8249], [-71.4115, 41.8245]]],
  },
  properties: {
    PIN: '020-0123-0000',
    ParcAddress: ' 100 EXAMPLE ST ',
    Owner1: 'EXAMPLE HOLDINGS LLC',
    AssessedValueTotal: 12500000,
    YearBuilt: 1925,
    GrBldgArea: 50000,
    StateUse: '31',
    MuniUseCode: 'C',
    AreaAC: 0.5,
    ZONING: 'D1',
  },
}

describe('pointQueryUrl', () => {
  it('asks for a WGS84 point intersect as GeoJSON', () => {
    const url = pointQueryUrl(LAYERS.parcels, -71.41, 41.82, ['PIN', 'Owner1'], true)
    const q = new URLSearchParams(url.split('?')[1])
    expect(url.includes('/14/query?')).toBe(true)
    expect(q.get('geometry')).toBe('-71.41,41.82')
    expect(q.get('inSR')).toBe('4326')
    expect(q.get('outSR')).toBe('4326')
    expect(q.get('f')).toBe('geojson')
    expect(q.get('outFields')).toBe('PIN,Owner1')
    expect(q.get('returnGeometry')).toBe('true')
  })
})

describe('parseParcelFeature', () => {
  it('maps assessor fields to public-sourced values', () => {
    const p = parseParcelFeature(FIXTURE)
    expect(p.pin).toBe('020-0123-0000')
    expect(p.address?.value).toBe('100 EXAMPLE ST')
    expect(p.address?.source).toBe('public')
    expect(p.assessedValue?.value).toBe(12_500_000)
    expect(p.landAreaSF?.value).toBe(21_780)
    expect(p.geometry?.type).toBe('Polygon')
  })
  it('treats zeros, blanks and junk as missing instead of guessing', () => {
    const p = parseParcelFeature({
      type: 'Feature',
      geometry: null,
      properties: { PIN: '1', YearBuilt: 0, GrBldgArea: 0, AreaAC: null, Owner1: '  ', AssessedValueTotal: '$1,200,000' },
    })
    expect(p.yearBuilt).toBe(undefined)
    expect(p.grossBuildingSF).toBe(undefined)
    expect(p.landAreaSF).toBe(undefined)
    expect(p.owner).toBe(undefined)
    expect(p.assessedValue?.value).toBe(1_200_000)
    expect(p.geometry).toBe(null)
  })
})

describe('parseOverlays', () => {
  const fc = (props: Record<string, unknown>): FeatureCollection => ({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: null, properties: props }],
  })
  it('reads zoning, flood and historic layers, tolerating failed ones', () => {
    const o = parseOverlays(fc({ Code: 'D-1', District: 'Downtown' }), fc({ FLD_ZONE: 'AE' }), null)
    expect(o.baseZoning?.value).toBe('D-1')
    expect(o.baseZoningDistrict?.value).toBe('Downtown')
    expect(o.floodZone?.value).toBe('AE')
    expect(o.historicDistrict).toBe(undefined)
  })
})

describe('parcelMetrics', () => {
  it('normalizes zoning codes', () => {
    expect(normalizeZoningCode('d1')).toBe('D-1')
    expect(normalizeZoningCode('C 2')).toBe('C-2')
    expect(normalizeZoningCode('W-3 ')).toBe('W-3')
  })
  it('derives $/SF, FAR and capacity from the record', () => {
    const m = parcelMetrics(parseParcelFeature(FIXTURE), 'D1')
    expect(m.assessedPerBuildingSF).toBe(250)
    expect(m.existingFAR).toBeCloseTo(50_000 / 21_780, 6)
    expect(m.placeholderMaxFAR).toBe(8)
    expect(m.additionalBuildableSF).toBe(21_780 * 8 - 50_000)
  })
  it('returns nulls when inputs are missing', () => {
    const m = parcelMetrics(parseParcelFeature({ type: 'Feature', geometry: null, properties: { PIN: 'x' } }), 'Z-9')
    expect(m.existingFAR).toBe(null)
    expect(m.placeholderMaxFAR).toBe(null)
  })
})

describe('lookupParcelAt errors', () => {
  afterEach(() => vi.unstubAllGlobals())

  it("passes on the relay's explanation of a failed upstream call", async () => {
    const message = 'City GIS server timed out: could not connect after 10.0 s (UND_ERR_CONNECT_TIMEOUT)'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message } }), { status: 504 })))
    await expect(lookupParcelAt(-71.41, 41.82)).rejects.toThrow(message)
  })

  it('falls back to the HTTP status when the body has no explanation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 })))
    await expect(lookupParcelAt(-71.41, 41.82)).rejects.toThrow('City GIS returned HTTP 502')
  })
})
