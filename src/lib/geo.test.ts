import { describe, expect, it } from 'vitest'
import { SAMPLE_FOOTPRINTS } from '../data/sampleFootprints'
import { SAMPLE_PROPERTIES } from '../data/sampleProperties'
import type { LngLat } from '../types'
import { featureBounds, offsetRing, OSM_DEFAULT_HEIGHT_M, OUTLINE_CLEARANCE_M, propertiesToGeoJSON, ROOF_CLEARANCE_M } from './geo'

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

  it('leaves a building without a saved outline (an imported deal) as it was', () => {
    const p = SAMPLE_PROPERTIES[0]
    const placeholder = { ...p, physical: { ...p.physical, footprint: undefined, heightFt: undefined } }
    const f = propertiesToGeoJSON([placeholder], AS_OF).features[0]
    expect(f.properties.heightM).toBe(Math.max(1, p.physical.floors.value) * 4)
  })
})
