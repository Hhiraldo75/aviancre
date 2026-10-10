import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type Feature,
  type FeatureCollection,
  LAYERS,
  PVD_PARCELS_SERVICE,
  RIGIS_FLOOD_LAYER,
  SUGGEST_ROWS,
  addressSuggestUrl,
  lookupParcelAt,
  parcelByPinUrl,
  parcelPointByPin,
  parseOverlays,
  parseParcelFeature,
  pointQueryUrl,
  pvdLayer,
  searchParcelAddresses,
} from './providenceGis'
import { parseAddressQuery } from '../lib/addressSearch'
import { normalizeZoningCode, parcelMetrics } from '../lib/parcelMetrics'

/** Shape of a parcel feature as the city's ArcGIS Online layer returns it with f=geojson. */
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
    const url = pointQueryUrl(pvdLayer(LAYERS.parcels), -71.41, 41.82, ['PIN', 'Owner1'], true)
    const q = new URLSearchParams(url.split('?')[1])
    expect(url.startsWith(`${PVD_PARCELS_SERVICE}/0/query?`)).toBe(true)
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
  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }

  it('reads zoning, flood and historic layers, tolerating failed ones', () => {
    const o = parseOverlays({
      zoning: fc({ Code: 'D-1', District: 'Downtown' }),
      flood: fc({ FLD_ZONE: 'AE', ZONE_SUBTY: ' ', STATIC_BFE: 14, V_DATUM: 'NAVD88', LEN_UNIT: 'Feet' }),
      historic: null,
      overlays: [null, empty],
    })
    expect(o.baseZoning?.value).toBe('D-1')
    expect(o.baseZoning?.sourceName).toMatch(/ArcGIS Online.*Parcel_Zoning_FL/)
    expect(o.baseZoningDistrict?.value).toBe('Downtown')
    expect(o.floodZone?.value).toBe('AE')
    expect(o.floodZone?.sourceName).toMatch(/RIGIS/)
    expect(o.floodZoneSubtype).toBe(undefined)
    expect(o.baseFloodElevation?.value).toBe(14)
    expect(o.baseFloodElevation?.notes).toBe('Static BFE, feet above NAVD88')
    expect(o.historicDistrict).toBe(undefined)
    expect(o.overlayDistricts).toEqual([])
  })

  it("lists each overlay district once, and drops FEMA's -9999 elevation", () => {
    const o = parseOverlays({
      zoning: null,
      flood: fc({ FLD_ZONE: 'X', ZONE_SUBTY: 'AREA WITH REDUCED FLOOD RISK DUE TO LEVEE', STATIC_BFE: -9999, V_DATUM: ' ', LEN_UNIT: ' ' }),
      historic: fc({ ZONE: 'HD', DISTRICT: 'Historic Overlay District' }),
      overlays: [fc({ ZONE: 'DD', DISTRICT: 'Downcity Overlay District' }), fc({ ZONE: 'TOD', DISTRICT: null }), fc({ ZONE: 'DD', DISTRICT: 'Downcity Overlay District' })],
    })
    expect(o.overlayDistricts?.map((d) => d.value)).toEqual(['Downcity Overlay District', 'TOD'])
    expect(o.floodZoneSubtype?.value).toBe('Area with reduced flood risk due to levee')
    expect(o.baseFloodElevation).toBe(undefined)
    expect(o.historicDistrict?.value).toBe('Historic Overlay District')
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

describe('lookupParcelAt', () => {
  afterEach(() => vi.unstubAllGlobals())

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
  const one = (props: Record<string, unknown>, geometry: Feature['geometry'] = null) => ({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry, properties: props }],
  })

  /** Answers by layer URL; anything not listed fails like a dropped connection. */
  function stubLayers(answers: Record<string, () => Response>) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const layer = String(input).split('/query?')[0]
      const answer = answers[layer]
      if (!answer) throw new TypeError('Failed to fetch')
      return answer()
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('queries the city ArcGIS Online layers and RIGIS flood directly, keeping what answers', async () => {
    const fetchMock = stubLayers({
      [pvdLayer(0)]: () => json(one(FIXTURE.properties!, FIXTURE.geometry)),
      [pvdLayer(12)]: () => json(one({ Code: 'D-1-120', District: 'Downtown/Mixed Use' })),
      [pvdLayer(3)]: () => json(one({ ZONE: 'DD', DISTRICT: 'Downcity Overlay District' })),
      [pvdLayer(4)]: () => json({ type: 'FeatureCollection', features: [] }),
      [RIGIS_FLOOD_LAYER]: () => json({ error: { code: 500, message: 'busy' } }),
    })
    const r = await lookupParcelAt(-71.4128, 41.824)

    const layers = fetchMock.mock.calls.map(([u]) => String(u).split('/query?')[0]).sort()
    expect(layers).toEqual([...[0, 3, 4, 5, 6, 7, 8, 12].map(pvdLayer), RIGIS_FLOOD_LAYER].sort())
    for (const [u] of fetchMock.mock.calls) expect(new URL(String(u)).searchParams.get('f')).toBe('geojson')

    expect(r.parcel?.pin).toBe('020-0123-0000')
    expect(r.parcel?.geometry?.type).toBe('Polygon')
    expect(r.overlays.baseZoning?.value).toBe('D-1-120')
    expect(r.overlays.overlayDistricts?.map((d) => d.value)).toEqual(['Downcity Overlay District'])
    expect(r.overlays.floodZone).toBe(undefined)
    expect(r.overlays.historicDistrict).toBe(undefined)
  })

  it("fails with the service's own message when the parcel layer errors", async () => {
    stubLayers({ [pvdLayer(0)]: () => json({ error: { code: 400, message: 'Invalid query parameters' } }) })
    await expect(lookupParcelAt(-71.41, 41.82)).rejects.toThrow('Invalid query parameters')
  })

  it('falls back to the HTTP status when the error body has no explanation', async () => {
    stubLayers({ [pvdLayer(0)]: () => new Response('<html>Bad gateway</html>', { status: 502 }) })
    await expect(lookupParcelAt(-71.41, 41.82)).rejects.toThrow('GIS service returned HTTP 502')
  })
})

describe('address search queries', () => {
  afterEach(() => vi.unstubAllGlobals())

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

  it('asks the parcel layer for matching addresses, attributes only', () => {
    const url = addressSuggestUrl(parseAddressQuery('100 Westminster Street')!)
    const q = new URLSearchParams(url.split('?')[1])
    expect(url.startsWith(`${PVD_PARCELS_SERVICE}/0/query?`)).toBe(true)
    expect(q.get('where')).toBe("UPPER(ParcAddress) LIKE '100 WESTMINSTER%' OR UPPER(ParcAddress) LIKE '100-% WESTMINSTER%'")
    expect(q.get('outFields')).toBe('PIN,ParcAddress')
    expect(q.get('returnGeometry')).toBe('false')
    expect(q.get('resultRecordCount')).toBe(String(SUGGEST_ROWS))
    expect(q.get('f')).toBe('json')
  })

  it('asks for one parcel outline by PIN, quoting it safely', () => {
    const q = new URLSearchParams(parcelByPinUrl("29'0062").split('?')[1])
    expect(q.get('where')).toBe("PIN='29''0062'")
    expect(q.get('returnGeometry')).toBe('true')
    expect(q.get('outSR')).toBe('4326')
    expect(q.get('f')).toBe('geojson')
  })

  it('groups condo units into one suggestion', async () => {
    const fetchMock = vi.fn(async () =>
      json({
        features: [
          { attributes: { PIN: '290062', ParcAddress: '1029 Westminster St Unit 1A' } },
          { attributes: { PIN: '290062', ParcAddress: '1029 Westminster St Unit 1B' } },
          { attributes: { PIN: '290558', ParcAddress: '1000 Westminster St' } },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const s = await searchParcelAddresses('Westminster st')
    expect(s).toEqual([
      { pin: '290558', address: '1000 Westminster St', units: 0 },
      { pin: '290062', address: '1029 Westminster St', units: 2 },
    ])
  })

  it("doesn't call the service for under 3 characters", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await searchParcelAddresses('10')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects with the service's message on an error body", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 400, message: 'Unable to perform query' } })))
    await expect(searchParcelAddresses('100 Main')).rejects.toThrow('Unable to perform query')
  })

  it('returns a point inside the parcel, or fails when it has no outline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ type: 'FeatureCollection', features: [FIXTURE] })))
    const [lng, lat] = await parcelPointByPin('020-0123-0000')
    expect(lng).toBeCloseTo(-71.41125, 6)
    expect(lat).toBeCloseTo(41.8247, 6)

    vi.stubGlobal('fetch', vi.fn(async () => json({ type: 'FeatureCollection', features: [] })))
    await expect(parcelPointByPin('nope')).rejects.toThrow('no outline')
  })
})
