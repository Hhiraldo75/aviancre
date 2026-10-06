import type { Polygon, MultiPolygon } from 'geojson'
import type { SF, Sourced, USD } from './common'

/**
 * A property record from the City of Providence tax roll (Open Data portal).
 * Reachable from anywhere; has no building size, year built or outline.
 */
export interface TaxRecord {
  /** Plat-lot-unit, e.g. "043-0586-0000". */
  taxMap: string
  plat: string
  lot: string
  unit?: string
  address?: Sourced<string>
  owner?: Sourced<string>
  /** Assessor land-use description, e.g. "Single Family", "CI Vacant Land". */
  landUse?: Sourced<string>
  landUseCode?: string
  assessedValue?: Sourced<USD>
  exemptValue?: Sourced<USD>
  annualTaxes?: Sourced<USD>
  lng: number
  lat: number
  /** Meters from the clicked point. */
  distanceM: number
  /** Condo / multi-unit lots: every record sharing this plat + lot. */
  unitCount: number
  /** Sum of assessed values across those units. */
  totalAssessedAllUnits?: USD
}

/**
 * A real parcel from the City of Providence GIS server (assessor + geometry).
 * Richer than the tax roll but not reachable from every network.
 */
export interface ParcelRecord {
  /** City parcel identifier (plat/lot based). */
  pin: string
  address?: Sourced<string>
  owner?: Sourced<string>
  assessedValue?: Sourced<USD>
  yearBuilt?: Sourced<number>
  grossBuildingSF?: Sourced<SF>
  landAreaSF?: Sourced<SF>
  stateUseCode?: Sourced<string>
  municipalUseCode?: Sourced<string>
  /** Zoning as recorded on the parcel. */
  parcelZoning?: Sourced<string>
  geometry: Polygon | MultiPolygon | null
}

/** Layers that overlap the clicked point (zoning, flood, historic). */
export interface ParcelOverlays {
  baseZoning?: Sourced<string>
  baseZoningDistrict?: Sourced<string>
  floodZone?: Sourced<string>
  historicDistrict?: Sourced<string>
}

/** Optional enrichment from the city GIS server. */
export type GisDetails =
  | { status: 'loading' }
  | { status: 'unavailable'; reason: string }
  | { status: 'none' }
  | { status: 'ok'; parcel: ParcelRecord; overlays: ParcelOverlays }

export type ParcelLookup =
  | { status: 'idle' }
  | { status: 'loading'; lng: number; lat: number }
  | { status: 'not-found'; lng: number; lat: number }
  | { status: 'error'; lng: number; lat: number; message: string }
  | { status: 'loaded'; lng: number; lat: number; record: TaxRecord | null; gis: GisDetails }
