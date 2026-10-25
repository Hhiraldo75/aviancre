import type { CitywideResult, ScreeningType } from './estimate'

/**
 * "Vs peers": a parcel's estimate ÷ assessed divided by the median of that
 * ratio for its property type. The estimate runs systematically high or low
 * for some types (benchmark rents, gross vs rentable area), so the map and the
 * list rank each parcel against similar properties; 1.0× is the median one.
 */

export function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export interface TypeMedian {
  median: number
  /** Parcels with both an estimate and an assessment. */
  count: number
}

/** The median estimate ÷ assessed for each property type, over the parcels with both. */
export function medianRatios(results: CitywideResult[]): Partial<Record<ScreeningType, TypeMedian>> {
  const byType: Partial<Record<ScreeningType, number[]>> = {}
  for (const r of results) if (r.status === 'estimated' && r.ratio !== undefined) (byType[r.type] ??= []).push(r.ratio)
  return Object.fromEntries(
    Object.entries(byType).map(([type, ratios]) => [type, { median: median(ratios)!, count: ratios.length }]),
  ) as Partial<Record<ScreeningType, TypeMedian>>
}

/** The parcel's ratio relative to its type's median; undefined without a ratio. */
export function peerRatio(r: CitywideResult, medians: Partial<Record<ScreeningType, TypeMedian>>): number | undefined {
  if (r.status !== 'estimated' || r.ratio === undefined) return undefined
  const m = medians[r.type]?.median
  return m ? r.ratio / m : undefined
}
