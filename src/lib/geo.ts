import type { Feature, FeatureCollection, Polygon } from 'geojson'
import type { ISODate, Property } from '../types'
import { occupancy, occupancyColor } from './metrics'

const SQFT_TO_SQM = 0.092903
const METERS_PER_DEG_LAT = 111_320
const METERS_PER_FT = 0.3048
/** Typical floor-to-floor height when the real building height is unknown. */
const METERS_PER_FLOOR = 4
/** Sample buildings outside the current filters: still visible, but faded. */
export const FILTERED_OUT_COLOR = '#e5e7eb'

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

/** South-west and north-east corners around every feature's outline; null when there are none. */
export function featureBounds(features: Feature<Polygon>[]): [[number, number], [number, number]] | null {
  const points = features.flatMap((f) => f.geometry.coordinates.flat())
  if (points.length === 0) return null
  const lngs = points.map((p) => p[0])
  const lats = points.map((p) => p[1])
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ]
}

/** `matchIds` is the filtered set; without it every building matches. */
export function propertiesToGeoJSON(
  properties: Property[],
  asOf: ISODate,
  matchIds?: Set<string>,
): FeatureCollection<Polygon, PropertyFeatureProps> {
  return {
    type: 'FeatureCollection',
    features: properties.map((p): Feature<Polygon, PropertyFeatureProps> => {
      const floors = Math.max(1, p.physical.floors.value)
      const occ = occupancy(p, asOf)
      const matches = !matchIds || matchIds.has(p.id)
      return {
        type: 'Feature',
        geometry: p.physical.footprint
          ? { type: 'Polygon', coordinates: [p.physical.footprint.value] }
          : squareFootprint(p.location.lng, p.location.lat, p.physical.grossBuildingSF.value / floors),
        properties: {
          id: p.id,
          name: p.name,
          assetType: p.assetType,
          occupancy: occ,
          matches,
          color: matches ? occupancyColor(occ) : FILTERED_OUT_COLOR,
          heightM: p.physical.heightFt ? p.physical.heightFt.value * METERS_PER_FT : floors * METERS_PER_FLOOR,
        },
      }
    }),
  }
}
