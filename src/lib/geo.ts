import type { Feature, FeatureCollection, Point, Polygon } from 'geojson'
import type { ISODate, LngLat, Property } from '../types'
import { occupancy, occupancyColor } from './metrics'

const SQFT_TO_SQM = 0.092903
const METERS_PER_DEG_LAT = 111_320
const METERS_PER_FT = 0.3048
/** Typical floor-to-floor height when the real building height is unknown. */
const METERS_PER_FLOOR = 4
/** Sample buildings outside the current filters: still visible, but faded. */
export const FILTERED_OUT_COLOR = '#e5e7eb'

/*
 * A colored building with a saved outline was traced from an OpenStreetMap
 * building, which the gray context layer draws too: 5 m tall when OSM has no
 * height or levels. That copy can't be filtered out on its own, because the
 * tiles merge neighboring buildings into one feature (thousands in Olneyville).
 * So the colored building encloses it instead: drawn a little outside the
 * outline and a little above it, or the copy hides a 1-floor building (4 m)
 * and z-fights with walls and roofs of the same size.
 */
export const OSM_DEFAULT_HEIGHT_M = 5
export const ROOF_CLEARANCE_M = 0.5
export const OUTLINE_CLEARANCE_M = 0.4

export interface PropertyFeatureProps {
  id: string
  name: string
  assetType: string
  occupancy: number
  /** False when the building is outside the current filters (drawn faded, clicks fall through to public records). */
  matches: boolean
  color: string
  heightM: number
}

/**
 * Fallback massing when no real outline is saved: a square footprint sized
 * from gross SF ÷ floors, centered on the property's point.
 */
function squareFootprint(lng: number, lat: number, footprintSqFt: number): Polygon {
  const sideM = Math.sqrt(footprintSqFt * SQFT_TO_SQM)
  const dLat = sideM / 2 / METERS_PER_DEG_LAT
  const dLng = sideM / 2 / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180))
  return {
    type: 'Polygon',
    coordinates: [[
      [lng - dLng, lat - dLat],
      [lng + dLng, lat - dLat],
      [lng + dLng, lat + dLat],
      [lng - dLng, lat + dLat],
      [lng - dLng, lat - dLat],
    ]],
  }
}

/**
 * The outline pushed out by `metres` on every side (mitred corners, capped on
 * very sharp ones), whichever way the ring winds.
 */
export function offsetRing(ring: LngLat[], metres: number): LngLat[] {
  // Local flat metres around the first vertex: plenty accurate at building scale.
  const [lng0, lat0] = ring[0]
  const mPerLng = METERS_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180)
  const closed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
  const pts = (closed ? ring.slice(0, -1) : ring).map(([lng, lat]) => [(lng - lng0) * mPerLng, (lat - lat0) * METERS_PER_DEG_LAT])
  const n = pts.length
  let area2 = 0
  for (let i = 0; i < n; i++) area2 += pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1]
  const side = area2 > 0 ? 1 : -1 // counter-clockwise: outward is to the right of each edge
  const normal = (a: number[], b: number[]) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    return [(side * (b[1] - a[1])) / len, (-side * (b[0] - a[0])) / len]
  }
  const out = pts.map((p, i) => {
    const n1 = normal(pts[(i - 1 + n) % n], p)
    const n2 = normal(p, pts[(i + 1) % n])
    // Where the two offset edges meet; a near-reversal would shoot off, so cap the miter at 4×.
    const k = Math.min(4, 1 / Math.max(0.0625, (1 + n1[0] * n2[0] + n1[1] * n2[1]) / 2)) / 2
    const [x, y] = [p[0] + metres * k * (n1[0] + n2[0]), p[1] + metres * k * (n1[1] + n2[1])]
    return [lng0 + x / mPerLng, lat0 + y / METERS_PER_DEG_LAT] as LngLat
  })
  return [...out, out[0]]
}

/** South-west and north-east corners around every outline and pin; null when there are none. */
export function featureBounds(features: Feature<Polygon | Point>[]): [[number, number], [number, number]] | null {
  const points = features.flatMap((f) => (f.geometry.type === 'Point' ? [f.geometry.coordinates] : f.geometry.coordinates.flat()))
  if (points.length === 0) return null
  const lngs = points.map((p) => p[0])
  const lats = points.map((p) => p[1])
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ]
}

/**
 * An imported deal with no address sits at its submarket's center: drawn as a
 * pin, not a made-up building over the real ones there.
 */
export const isApproximatePin = (p: Property) => p.location.isApproximate && !p.physical.footprint

/** Pins sharing a point are spread on a ring this wide, so each stays clickable. */
export const PIN_SPREAD_M = 25

/** `matchIds` is the filtered set; without it every building matches. */
export function propertiesToGeoJSON(
  properties: Property[],
  asOf: ISODate,
  matchIds?: Set<string>,
): FeatureCollection<Polygon, PropertyFeatureProps> {
  return {
    type: 'FeatureCollection',
    features: properties.filter((p) => !isApproximatePin(p)).map((p): Feature<Polygon, PropertyFeatureProps> => {
      const floors = Math.max(1, p.physical.floors.value)
      const occ = occupancy(p, asOf)
      const matches = !matchIds || matchIds.has(p.id)
      const traced = p.physical.footprint?.value
      const heightM = p.physical.heightFt ? p.physical.heightFt.value * METERS_PER_FT : floors * METERS_PER_FLOOR
      return {
        type: 'Feature',
        geometry: traced
          ? { type: 'Polygon', coordinates: [offsetRing(traced, OUTLINE_CLEARANCE_M)] }
          : squareFootprint(p.location.lng, p.location.lat, p.physical.grossBuildingSF.value / floors),
        properties: {
          id: p.id,
          name: p.name,
          assetType: p.assetType,
          occupancy: occ,
          matches,
          color: matches ? occupancyColor(occ) : FILTERED_OUT_COLOR,
          heightM: traced ? Math.max(heightM, OSM_DEFAULT_HEIGHT_M) + ROOF_CLEARANCE_M : heightM,
        },
      }
    }),
  }
}

/** Deals without a known location, as pins colored by occupancy (`isApproximatePin`). */
export function approximatePinsGeoJSON(
  properties: Property[],
  asOf: ISODate,
  matchIds?: Set<string>,
): FeatureCollection<Point, PropertyFeatureProps> {
  const pins = properties.filter(isApproximatePin)
  const at = (p: Property) => `${p.location.lng},${p.location.lat}`
  return {
    type: 'FeatureCollection',
    features: pins.map((p): Feature<Point, PropertyFeatureProps> => {
      const occ = occupancy(p, asOf)
      const matches = !matchIds || matchIds.has(p.id)
      const shared = pins.filter((x) => at(x) === at(p))
      const { lng, lat } = p.location
      let coordinates: LngLat = [lng, lat]
      if (shared.length > 1) {
        const angle = (2 * Math.PI * shared.indexOf(p)) / shared.length
        coordinates = [
          lng + (PIN_SPREAD_M * Math.sin(angle)) / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)),
          lat + (PIN_SPREAD_M * Math.cos(angle)) / METERS_PER_DEG_LAT,
        ]
      }
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates },
        properties: {
          id: p.id,
          name: p.name,
          assetType: p.assetType,
          occupancy: occ,
          matches,
          color: matches ? occupancyColor(occ) : FILTERED_OUT_COLOR,
          heightM: 0,
        },
      }
    }),
  }
}
