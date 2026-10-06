import type { Feature, FeatureCollection, Polygon } from 'geojson'
import type { ISODate, Property } from '../types'
import { occupancy, occupancyColor } from './metrics'

const SQFT_TO_SQM = 0.092903
const METERS_PER_DEG_LAT = 111_320
/** Typical floor-to-floor height for the placeholder massing. */
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
 * Placeholder massing: a square footprint sized from gross SF ÷ floors,
 * centered on the property's point and extruded by floor count.
 * Replace with real parcel or building footprints once those are loaded.
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
        geometry: squareFootprint(p.location.lng, p.location.lat, p.physical.grossBuildingSF.value / floors),
        properties: {
          id: p.id,
          name: p.name,
          assetType: p.assetType,
          occupancy: occ,
          color: occupancyColor(occ),
          heightM: floors * METERS_PER_FLOOR,
        },
      }
    }),
  }
}
