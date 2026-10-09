import { describe, expect, it } from 'vitest'
import { SAMPLE_PROPERTIES } from '../data/sampleProperties'
import { featureBounds, propertiesToGeoJSON } from './geo'

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
