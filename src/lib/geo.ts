import type { Feature, FeatureCollection, Polygon } from 'geojson'
import type { ISODate, Property } from '../types'
import { occupancy, occupancyColor } from './metrics'

const SQFT_TO_SQM = 0.092903
const METERS_PER_DEG_LAT = 111_320
const METERS_PER_FT = 0.3048
/** Typical floor-to-floor height when the real building height is unknown. */
const METERS_PER_FLOOR = 4

export interface PropertyFeatureProps {
  id: string
  name: string
  assetType: string
  occupancy: number
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

export function propertiesToGeoJSON(
  properties: Property[],
  asOf: ISODate,
): FeatureCollection<Polygon, PropertyFeatureProps> {
  return {
    type: 'FeatureCollection',
    features: properties.map((p): Feature<Polygon, PropertyFeatureProps> => {
      const floors = Math.max(1, p.physical.floors.value)
      const occ = occupancy(p, asOf)
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
          color: occupancyColor(occ),
          heightM: p.physical.heightFt ? p.physical.heightFt.value * METERS_PER_FT : floors * METERS_PER_FLOOR,
        },
      }
    }),
  }
}
