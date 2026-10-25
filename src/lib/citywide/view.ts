import type { FeatureCollection, Point } from 'geojson'
import type { SubmarketId } from '../../types'
import { estimateParcel, RATIO_BANDS, ratioBand, type CitywideResult, type RatioBandId, type ScreeningType } from './estimate'
import { medianRatios, peerRatio, type TypeMedian } from './peers'
import { submarketFor } from './submarket'
import type { CitywideOutlines, CitywideParcel } from './types'

/**
 * The screening list and map layer: one row per snapshot parcel with its
 * estimate, plus pure filters and sorting. Filters: empty lists mean any; size
 * is inclusive at both ends, on gross building area.
 */

export type MarketKey = SubmarketId | 'metro'

export interface ScreeningRow {
  parcel: CitywideParcel
  result: CitywideResult
  /** Unknown only for vacant land, utilities and non-commercial lots. */
  type?: ScreeningType
  market: MarketKey
  value?: number
  /** Estimate ÷ assessed. */
  ratio?: number
  /** `ratio` ÷ the median ratio for the property type: 1.0× is the typical parcel of its type. */
  peerRatio?: number
  /** That median, and how many parcels it is taken over. */
  peerMedian?: TypeMedian
  /** Map color: the band of `peerRatio`, or skipped. */
  band: RatioBandId | 'skipped'
}

/** Band colors: red where the estimate is low for its type relative to the assessment, blue high, gray in line. */
export const BAND_COLORS: Record<RatioBandId, string> = {
  'well-below': '#b0302b',
  below: '#e8746b',
  near: '#d6d4ce',
  above: '#6aa3e6',
  'well-above': '#1d58a8',
  'no-assessment': '#8a8780',
}
/** Skipped parcels: an outline without fill. */
export const SKIPPED_COLOR = '#57534e'

export const BAND_LEGEND = [...RATIO_BANDS.map((b) => ({ id: b.id as RatioBandId, label: b.label })), { id: 'no-assessment' as const, label: 'No assessment' }]

/** Every snapshot parcel with its estimate, ranked against the median for its property type. */
export function screeningRows(parcels: CitywideParcel[]): ScreeningRow[] {
  const results = parcels.map(estimateParcel)
  const medians = medianRatios(results)
  return parcels.map((parcel, i) => {
    const result = results[i]
    const estimated = result.status === 'estimated'
    const peer = peerRatio(result, medians)
    return {
      parcel,
      result,
      type: result.type,
      market: (estimated ? result.market : submarketFor(parcel.neighborhood, parcel.point)).submarket ?? 'metro',
      value: estimated ? result.value.value : undefined,
      ratio: estimated ? result.ratio : undefined,
      peerRatio: peer,
      peerMedian: estimated ? medians[result.type] : undefined,
      band: estimated ? ratioBand(peer) : 'skipped',
    }
  })
}

/** Rows the map draws: every estimate, and skipped buildings (not vacant land or utilities). */
export const isDrawn = (r: ScreeningRow) =>
  r.result.status === 'estimated' || r.result.reason === 'no-building-area' || r.result.reason === 'no-income'

export interface CitywideFilters {
  types: ScreeningType[]
  markets: MarketKey[]
  minSF: number | null
  maxSF: number | null
  bands: RatioBandId[]
  status: 'estimated' | 'skipped' | 'all'
}

export const EMPTY_CITYWIDE_FILTERS: CitywideFilters = { types: [], markets: [], minSF: null, maxSF: null, bands: [], status: 'all' }

export const hasCitywideFilters = (f: CitywideFilters) =>
  f.types.length > 0 || f.markets.length > 0 || f.minSF !== null || f.maxSF !== null || f.bands.length > 0 || f.status !== 'all'

export function matchesCitywide(r: ScreeningRow, f: CitywideFilters): boolean {
  if (f.status === 'estimated' && r.band === 'skipped') return false
  if (f.status === 'skipped' && r.band !== 'skipped') return false
  if (f.types.length && !(r.type && f.types.includes(r.type))) return false
  if (f.markets.length && !f.markets.includes(r.market)) return false
  const sf = r.parcel.gba
  if (f.minSF !== null && !(sf !== undefined && sf >= f.minSF)) return false
  if (f.maxSF !== null && !(sf !== undefined && sf <= f.maxSF)) return false
  if (f.bands.length && !(r.band !== 'skipped' && f.bands.includes(r.band))) return false
  return true
}

export type CitywideSortKey = 'address' | 'type' | 'market' | 'gba' | 'value' | 'assessed' | 'ratio' | 'peer'

export interface CitywideSort {
  key: CitywideSortKey
  dir: 'asc' | 'desc'
}

/** Highest vs peers first: where the estimate most exceeds the assessment for a property of its type. */
export const DEFAULT_CITYWIDE_SORT: CitywideSort = { key: 'peer', dir: 'desc' }

const sortValue = (r: ScreeningRow, key: CitywideSortKey): string | number | undefined => {
  switch (key) {
    case 'address':
      return r.parcel.address
    case 'type':
      return r.type
    case 'market':
      return r.market
    case 'gba':
      return r.parcel.gba
    case 'value':
      return r.value
    case 'assessed':
      return r.parcel.assessed
    case 'ratio':
      return r.ratio
    case 'peer':
      return r.peerRatio
  }
}

/** Sorted copy; rows without the figure go last in either direction. */
export function sortRows(rows: ScreeningRow[], { key, dir }: CitywideSort): ScreeningRow[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = sortValue(a, key)
    const y = sortValue(b, key)
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true })
    return c * sign || a.parcel.address.localeCompare(b.parcel.address, 'en', { numeric: true })
  })
}

type FeatureProps = { pin: string; band: RatioBandId | 'skipped'; match: boolean; outlined: boolean }

/**
 * Dots at each drawn parcel's interior point. `match` is false outside the list
 * filters; `outlined` when its outline is loaded, so the map can hide the dot
 * where the outline takes over.
 */
export function pointsGeoJSON(rows: ScreeningRow[], filters: CitywideFilters, outlines: CitywideOutlines | null): FeatureCollection<Point, FeatureProps> {
  return {
    type: 'FeatureCollection',
    features: rows.filter(isDrawn).map((r) => ({
      type: 'Feature',
      properties: { pin: r.parcel.pin, band: r.band, match: matchesCitywide(r, filters), outlined: !!outlines?.[r.parcel.pin] },
      geometry: { type: 'Point', coordinates: r.parcel.point },
    })),
  }
}

/** Parcel outlines for the drawn parcels that have one. */
export function outlinesGeoJSON(rows: ScreeningRow[], outlines: CitywideOutlines, filters: CitywideFilters): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rows.flatMap((r) => {
      const geometry = outlines[r.parcel.pin]
      return geometry && isDrawn(r)
        ? [{ type: 'Feature' as const, properties: { pin: r.parcel.pin, band: r.band, match: matchesCitywide(r, filters) }, geometry }]
        : []
    }),
  }
}
