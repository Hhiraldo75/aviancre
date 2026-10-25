import type { CitywideOutlines, CitywideSnapshot } from '../lib/citywide/types'

/**
 * The citywide screening snapshot, a static file in `public/` written by
 * `npm run citywide:refresh`. Fetched only when the layer is first turned on;
 * outlines only when the map is first zoomed in far enough to draw them.
 */
export const CITYWIDE_PARCELS_URL = '/data/citywide/parcels.json'
export const CITYWIDE_OUTLINES_URL = '/data/citywide/outlines.json'

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`The citywide snapshot returned HTTP ${res.status}`)
  return (await res.json()) as T
}

export async function loadCitywideSnapshot(): Promise<CitywideSnapshot> {
  const snapshot = await getJSON<CitywideSnapshot>(CITYWIDE_PARCELS_URL)
  if (!Array.isArray(snapshot.parcels) || !snapshot.meta) throw new Error('The citywide snapshot is not in the expected format')
  return snapshot
}

export const loadCitywideOutlines = () => getJSON<CitywideOutlines>(CITYWIDE_OUTLINES_URL)
