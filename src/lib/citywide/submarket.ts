import type { LngLat, SubmarketId } from '../../types'
import { SUBMARKETS } from '../../data/submarkets'
import { haversineM } from '../../services/providenceOpenData'

/**
 * Which submarket a parcel is priced in, from the city's official neighborhood
 * (City of Providence ArcGIS Online, Providence_Neighborhoods). Neighborhoods
 * that match a submarket map to it; the Downtown neighborhood holds three
 * submarkets and is split by the nearest submarket center; every other
 * neighborhood is priced at the metro figures.
 */
export const NEIGHBORHOOD_SUBMARKETS: Record<string, SubmarketId | SubmarketId[]> = {
  Downtown: ['downtown', 'capital-center', 'jewelry-district'],
  'Federal Hill': 'federal-hill',
  'Fox Point': 'fox-point',
  'College Hill': 'college-hill',
  Olneyville: 'olneyville',
  Valley: 'valley',
  // The Port of Providence and Allens Ave run through Lower South Providence.
  'Lower South Providence': 'port-allens-ave',
}

export interface MarketAssignment {
  /** Null: priced at the metro figures. */
  submarket: SubmarketId | null
  /** How it was assigned, in plain words. */
  method: string
}

export function submarketFor(neighborhood: string | undefined, point: LngLat): MarketAssignment {
  if (!neighborhood) return { submarket: null, method: 'Not in a city neighborhood: metro figures' }
  const match = NEIGHBORHOOD_SUBMARKETS[neighborhood]
  if (!match) return { submarket: null, method: `${neighborhood} neighborhood has no submarket: metro figures` }
  if (typeof match === 'string') return { submarket: match, method: `${neighborhood} neighborhood → ${SUBMARKETS[match].name}` }

  const nearest = match
    .map((id) => ({ id, d: haversineM(point[0], point[1], ...SUBMARKETS[id].center) }))
    .reduce((a, b) => (b.d < a.d ? b : a))
  const names = match.map((id) => SUBMARKETS[id].name).join(', ')
  return {
    submarket: nearest.id,
    method: `${neighborhood} neighborhood, nearest of the ${names} centers: ${SUBMARKETS[nearest.id].name} (${Math.round(nearest.d)} m)`,
  }
}
