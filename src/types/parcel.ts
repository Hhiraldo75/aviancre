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
  /** Meters from the clicked point (0 when a plat/lot match has no location). */
  distanceM: number
  /** How the record was found: the city parcel's plat and lot (PIN), or nearest to the click. */
  matchedBy: 'plat-lot' | 'distance'
  /** Condo / multi-unit lots: every record sharing this plat + lot. */
  unitCount: number
  /** Sum of assessed values across those units. */
  totalAssessedAllUnits?: USD
}

/**
 * A real parcel from the City of Providence's ArcGIS Online parcel layer
 * (Parcel_Zoning_FL: assessor data + outline). Adds what the tax roll lacks.
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

/** Layers that overlap the clicked point (zoning, overlay districts, flood, historic). */
export interface ParcelOverlays {
  baseZoning?: Sourced<string>
  baseZoningDistrict?: Sourced<string>
  /** Zoning overlay districts, e.g. "Downcity Overlay District"; empty when none. */
  overlayDistricts?: Sourced<string>[]
  /** FEMA flood zone, e.g. "X", "AE". */
  floodZone?: Sourced<string>
  /** FEMA zone subtype, e.g. "Area with reduced flood risk due to levee". */
  floodZoneSubtype?: Sourced<string>
  /** Static base flood elevation in feet; datum in `notes`. */
  baseFloodElevation?: Sourced<number>
  historicDistrict?: Sourced<string>
}

/** Optional enrichment from the ArcGIS Online parcel, zoning and flood layers. */
export type GisDetails =
  | { status: 'loading' }
  | { status: 'unavailable'; reason: string }
  | { status: 'none' }
  | { status: 'ok'; parcel: ParcelRecord; overlays: ParcelOverlays }

/** A parcel picked from the address search: its city PIN and `ParcAddress` (without a unit). */
export interface PickedParcel {
  pin: string
  address: string
}

/** `picked` is set when the lookup came from the address search rather than a map click. */
export type ParcelLookup =
  | { status: 'idle' }
  | { status: 'loading'; lng: number; lat: number; picked?: PickedParcel }
  | { status: 'not-found'; lng: number; lat: number; picked?: PickedParcel }
  | { status: 'error'; lng: number; lat: number; message: string; picked?: PickedParcel }
  | { status: 'loaded'; lng: number; lat: number; record: TaxRecord | null; gis: GisDetails; picked?: PickedParcel }
