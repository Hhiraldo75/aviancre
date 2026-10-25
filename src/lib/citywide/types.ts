import type { ISODate, LngLat } from '../../types'
import type { CoverageReport } from './coverage'

/**
 * One commercial lot in the citywide snapshot (`public/data/citywide/`): the
 * public inputs only, as `npm run citywide:refresh` pulled them. Estimates are
 * computed from these in the app, so a benchmark update needs no new pull.
 * Missing figures are left out rather than written as null.
 */
export interface CitywideParcel {
  /** City parcel PIN: plat × 10,000 + lot. */
  pin: string
  plat: string
  lot: string
  address: string
  /** Tax-roll class of the lot's main record, e.g. "6" or "03-11+" (see `decodeLandUse`). */
  landUseCode: string
  /** 2025 tax roll total assessment, summed over the lot's commercial records. */
  assessed?: number
  /** City gross building area, summed over condo units. */
  gba?: number
  landSF?: number
  yearBuilt?: number
  /** City record's unit count, summed over condo units; apartments and mixed use only. */
  units?: number
  floors?: number
  /** Official city neighborhood the parcel's point falls in. */
  neighborhood?: string
  /** A point inside the parcel outline (else the tax roll's point). */
  point: LngLat
  /** OpenStreetMap features inside the parcel: offices vs shops, restaurants and banks. */
  osm: { office: number; retail: number }
  /** Tax-roll records on the lot: more than 1 for condominiums. */
  records: number
}

export interface SnapshotSource {
  name: string
  url: string
}

export interface CitywideSnapshot {
  meta: {
    generatedAt: ISODate
    sources: SnapshotSource[]
    coverage: CoverageReport
  }
  parcels: CitywideParcel[]
}

/** Simplified parcel outlines by PIN, GeoJSON coordinates (a polygon's rings, or a multipolygon's polygons). */
export type CitywideOutlines = Record<string, { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] }>
