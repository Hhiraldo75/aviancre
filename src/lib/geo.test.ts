import type { MultiPolygon, Polygon } from 'geojson'
import { describe, expect, it } from 'vitest'
import { SAMPLE_FOOTPRINTS } from '../data/sampleFootprints'
import { SAMPLE_PROPERTIES } from '../data/sampleProperties'
import type { LngLat, Property } from '../types'
import {
  approximatePinsGeoJSON,
  buildingOutlineIn,
  featureBounds,
  interiorPoint,
  pointInRing,
  FILTERED_OUT_COLOR,
  offsetRing,
  OSM_DEFAULT_HEIGHT_M,
  OUTLINE_CLEARANCE_M,
  parcelOutline,
  PIN_SPREAD_M,
  propertiesToGeoJSON,
  ROOF_CLEARANCE_M,
} from './geo'
import { occupancy, occupancyColor } from './metrics'

const AS_OF = '2026-10-04'

describe('featureBounds', () => {
  const { features } = propertiesToGeoJSON(SAMPLE_PROPERTIES, AS_OF)

  it('returns null for no features', () => {
    expect(featureBounds([])).toBeNull()
  })

  it('encloses every vertex of every outline', () => {
    const [[west, south], [east, north]] = featureBounds(features)!
    for (const [lng, lat] of features.flatMap((f) => f.geometry.coordinates.flat())) {
      expect(lng).toBeGreaterThanOrEqual(west)
      expect(lng).toBeLessThanOrEqual(east)
      expect(lat).toBeGreaterThanOrEqual(south)
      expect(lat).toBeLessThanOrEqual(north)
    }
  })

  it('fits a subset inside the full bounds, around its own buildings only', () => {
    const matchIds = new Set(['sample-olneyville-distribution'])
    const matching = propertiesToGeoJSON(SAMPLE_PROPERTIES, AS_OF, matchIds).features.filter((f) => f.properties.matches)
    expect(matching.map((f) => f.properties.id)).toEqual(['sample-olneyville-distribution'])
    const [[w, s], [e, n]] = featureBounds(matching)!
    const [[west, south], [east, north]] = featureBounds(features)!
    expect(w).toBeGreaterThanOrEqual(west)
    expect(e).toBeLessThanOrEqual(east)
    expect(s).toBeGreaterThanOrEqual(south)
    expect(n).toBeLessThanOrEqual(north)
    expect(e - w).toBeLessThan(0.01)
  })
})

describe('colored buildings enclose their gray OpenStreetMap copy', () => {
  const LAT = 41.82
  const kLng = 111_320 * Math.cos((LAT * Math.PI) / 180)
  /** [x, y] metres from a corner → [lng, lat]. */
  const at = (x: number, y: number): LngLat => [-71.45 + x / kLng, LAT + y / 111_320]
  const metres = ([lng, lat]: LngLat) => [(lng + 71.45) * kLng, (lat - LAT) * 111_320]
  /** Ray casting, independent of the code under test. */
  const contains = (ring: LngLat[], [x, y]: LngLat) => {
    let hit = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
    }
    return hit
  }
  const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 2))

  it('pushes an outline out on every side, whichever way it winds', () => {
    const ccw = [at(0, 0), at(30, 0), at(30, 12), at(0, 12), at(0, 0)]
    for (const ring of [ccw, [...ccw].reverse()]) {
      const out = offsetRing(ring, 0.5).map(metres)
      expect(out).toHaveLength(5)
      for (const [x, y] of out.slice(0, 4)) {
        expect([-0.5, 30.5]).toContainEqual(Number(x.toFixed(3)))
        expect([-0.5, 12.5]).toContainEqual(Number(y.toFixed(3)))
      }
    }
  })

  it('moves the inside corner of an L-shape outward too', () => {
    const L = [at(0, 0), at(40, 0), at(40, 12), at(12, 12), at(12, 40), at(0, 40), at(0, 0)]
    const out = offsetRing(L, 0.5)
    close(metres(out[3]), [12.5, 12.5])
    for (const v of L) expect(contains(out, v)).toBe(true)
  })

  it('draws a 1-floor sample above OSM\'s 5 m copy, around a slightly larger outline', () => {
    const dc = propertiesToGeoJSON(SAMPLE_PROPERTIES, AS_OF).features.find((f) => f.properties.id === 'sample-olneyville-distribution')!
    const ring = SAMPLE_PROPERTIES.find((p) => p.id === 'sample-olneyville-distribution')!.physical.footprint!.value
    expect(dc.properties.heightM).toBe(OSM_DEFAULT_HEIGHT_M + ROOF_CLEARANCE_M)
    for (const v of ring) expect(contains(dc.geometry.coordinates[0] as LngLat[], v)).toBe(true)
    expect(OUTLINE_CLEARANCE_M).toBeGreaterThan(0)
  })

  it('stays above every OSM copy, whose height is OSM\'s height, else levels × 3.66 m, else 5 m', () => {
    const features = propertiesToGeoJSON(SAMPLE_PROPERTIES, AS_OF).features
    for (const [id, fp] of Object.entries(SAMPLE_FOOTPRINTS)) {
      const copy = fp.heightM ?? (fp.levels ? Math.ceil(fp.levels * 3.66) : OSM_DEFAULT_HEIGHT_M)
      const drawn = features.find((f) => f.properties.id === id)!.properties.heightM
      expect(drawn - copy, id).toBeGreaterThanOrEqual(0.3)
    }
  })

  it('leaves a building without a saved outline at a known location as it was', () => {
    const p = SAMPLE_PROPERTIES[0]
    const placeholder = { ...p, physical: { ...p.physical, footprint: undefined, heightFt: undefined } }
    const f = propertiesToGeoJSON([placeholder], AS_OF).features[0]
    expect(f.properties.heightM).toBe(Math.max(1, p.physical.floors.value) * 4)
  })
})

describe('deals without a known location are pins', () => {
  /** Like an imported deal with no address: at its submarket's center, no outline. */
  const approximate = (id: string, i = 0): Property => {
    const p = SAMPLE_PROPERTIES[i]
    return { ...p, id, location: { ...p.location, lng: -71.44, lat: 41.82, isApproximate: true }, physical: { ...p.physical, footprint: undefined } }
  }

  it('draws a pin colored by occupancy instead of a building', () => {
    const deal = approximate('deal-a')
    expect(propertiesToGeoJSON([deal], AS_OF).features).toEqual([])
    const [pin] = approximatePinsGeoJSON([deal], AS_OF).features
    expect(pin.geometry.coordinates).toEqual([-71.44, 41.82])
    expect(pin.properties).toMatchObject({ id: 'deal-a', matches: true, color: occupancyColor(occupancy(deal, AS_OF)) })
  })

  it('keeps a deal with a real outline as a building', () => {
    const p = SAMPLE_PROPERTIES[0]
    const traced = { ...p, location: { ...p.location, isApproximate: true } }
    expect(propertiesToGeoJSON([traced], AS_OF).features).toHaveLength(1)
    expect(approximatePinsGeoJSON([traced], AS_OF).features).toEqual([])
    expect(approximatePinsGeoJSON(SAMPLE_PROPERTIES, AS_OF).features).toEqual([])
  })

  it('spreads deals sharing a point so each can be clicked', () => {
    const pins = approximatePinsGeoJSON([approximate('deal-a'), approximate('deal-b', 1), approximate('deal-c', 2)], AS_OF).features
    const [x, y] = pins.map((f) => f.geometry.coordinates)
    expect(new Set(pins.map((f) => f.geometry.coordinates.join())).size).toBe(3)
    const apartM = Math.hypot((x[0] - y[0]) * 111_320 * Math.cos((41.82 * Math.PI) / 180), (x[1] - y[1]) * 111_320)
    expect(apartM).toBeCloseTo(PIN_SPREAD_M * Math.sqrt(3), 1)
  })

  it('fades a pin outside the filters, and zooms to it with the buildings', () => {
    const [pin] = approximatePinsGeoJSON([approximate('deal-a')], AS_OF, new Set()).features
    expect(pin.properties).toMatchObject({ matches: false, color: FILTERED_OUT_COLOR })
    const [[west, south], [east, north]] = featureBounds([...propertiesToGeoJSON(SAMPLE_PROPERTIES, AS_OF).features, pin])!
    expect(west).toBeLessThanOrEqual(-71.44)
    expect(east).toBeGreaterThanOrEqual(-71.44)
    expect(south).toBeLessThanOrEqual(41.82)
    expect(north).toBeGreaterThanOrEqual(41.82)
  })
})

describe('interiorPoint', () => {
  const rect: Polygon = { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 2], [0, 2], [0, 0]]] }
  // An L whose box center (2, 2) is outside: the corner block is missing.
  const ell: Polygon = { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4], [0, 0]]] }

  it('uses the box center when it is inside', () => {
    expect(interiorPoint(rect)).toEqual([2, 1])
  })

  it('finds a point inside an L-shaped parcel', () => {
    const p = interiorPoint(ell)
    expect(pointInRing([2, 2], ell.coordinates[0])).toBe(false)
    expect(pointInRing(p, ell.coordinates[0])).toBe(true)
    expect(p).toEqual([0.5, 2])
  })

  it('takes the largest part of a multipolygon', () => {
    const small = [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]]
    expect(interiorPoint({ type: 'MultiPolygon', coordinates: [small, rect.coordinates] })).toEqual([2, 1])
  })

  it('stays out of holes', () => {
    const donut: Polygon = {
      type: 'Polygon',
      coordinates: [rect.coordinates[0], [[1, 0.5], [3, 0.5], [3, 1.5], [1, 1.5], [1, 0.5]]],
    }
    expect(interiorPoint(donut)).toEqual([0.5, 1])
  })
})

describe('buildingOutlineIn', () => {
  // A 10 × 6 lot; buildings are squares around a center point.
  const lot: Polygon = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 6], [0, 6], [0, 0]]] }
  const square = (x: number, y: number, r: number) => [[[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r], [x - r, y - r]]]
  const tile = (coordinates: number[][][][], render_height?: number) => ({
    geometry: { type: 'MultiPolygon', coordinates } as MultiPolygon,
    properties: { render_height },
  })

  it('picks the building under the lot from a feature the tiles merged with its neighbors', () => {
    const merged = tile([square(-5, 3, 2), square(5, 3, 2), square(15, 3, 2)], 22)
    expect(buildingOutlineIn([merged], lot)).toEqual({ ring: square(5, 3, 2)[0], heightM: 22 })
  })
  it('prefers the building holding the lot center over a bigger one off to the side', () => {
    const shed = tile([square(1.5, 1.5, 1)])
    const main = tile([square(5, 3, 1.4)])
    const garage = tile([square(8, 3, 1.5)])
    expect(buildingOutlineIn([shed, garage, main], lot)?.ring).toEqual(square(5, 3, 1.4)[0])
    expect(buildingOutlineIn([shed, garage], lot)?.ring).toEqual(square(8, 3, 1.5)[0])
  })
  it('rejects a building bigger than the lot, and finds none on an empty lot', () => {
    expect(buildingOutlineIn([tile([square(5, 3, 5)])], lot)).toBeNull()
    expect(buildingOutlineIn([tile([square(20, 3, 1)])], lot)).toBeNull()
    expect(buildingOutlineIn([], lot)).toBeNull()
  })
  it('closes an open ring, and leaves the height out when the tiles have none', () => {
    const open = { geometry: { type: 'Polygon', coordinates: [[[4, 2], [6, 2], [6, 4], [4, 4]]] } as Polygon, properties: {} }
    expect(buildingOutlineIn([open], lot)).toEqual({ ring: [[4, 2], [6, 2], [6, 4], [4, 4], [4, 2]], heightM: undefined })
  })
  it('falls back to the largest part of the parcel', () => {
    const parcel: MultiPolygon = { type: 'MultiPolygon', coordinates: [square(0, 0, 1), square(5, 5, 2)] }
    expect(parcelOutline(parcel)).toEqual(square(5, 5, 2)[0])
  })
})

describe('a deal placed on a real building', () => {
  const p = SAMPLE_PROPERTIES[0]
  const placed: Property = {
    ...p,
    id: 'deal-placed',
    location: {
      ...p.location,
      placement: { pin: '1', cityAddress: '1 Main St', method: 'click', placedAt: AS_OF, outlineFrom: 'osm', heightM: 300 },
    },
  }

  it('is a building, not a pin, raised to the OSM building drawn there', () => {
    expect(approximatePinsGeoJSON([placed], AS_OF).features).toEqual([])
    const [f] = propertiesToGeoJSON([placed], AS_OF).features
    expect(f.properties.heightM).toBe(300 + ROOF_CLEARANCE_M)
  })
})
