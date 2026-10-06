import type { Feature as GeoFeature, FeatureCollection as GeoCollection, Geometry, MultiPolygon, Polygon } from 'geojson'
import type { ParcelOverlays, ParcelRecord, Sourced } from '../types'
import { fromPublic } from '../lib/sourced'

/**
 * Client for the City of Providence public GIS (ArcGIS MapServer "Viewpoint_Base").
 *
 * In development the request goes through Vite's proxy (`/pvdgis` → the city
 * server, see vite.config.ts) so the browser never hits CORS limits. Override
 * the base URL with VITE_PVD_GIS_URL when deploying.
 */
export const PVD_GIS_BASE: string =
  import.meta.env?.VITE_PVD_GIS_URL ?? '/pvdgis/server/rest/services/Viewpoint_Base/MapServer'

export const PVD_SOURCE = 'City of Providence GIS – Parcel Outlines'
const ZONING_SOURCE = 'City of Providence GIS – Base Zoning'
const FLOOD_SOURCE = 'FEMA DFIRM via City of Providence GIS'
const HISTORIC_SOURCE = 'City of Providence GIS – Local Historic Districts'

export const LAYERS = {
  flood: 0,
  baseZoning: 4,
  historicLocal: 12,
  parcels: 14,
} as const

const PARCEL_FIELDS = [
  'PIN',
  'ParcAddress',
  'Owner1',
  'AssessedValueTotal',
  'YearBuilt',
  'GrBldgArea',
  'StateUse',
  'MuniUseCode',
  'AreaAC',
  'ZONING',
] as const

const SQFT_PER_ACRE = 43_560

type Props = Record<string, unknown>
/** ArcGIS returns `geometry: null` when geometry isn't requested. */
export type Feature = GeoFeature<Geometry | null>
export type FeatureCollection = GeoCollection<Geometry | null>

/** Builds an ArcGIS point-intersect query URL returning GeoJSON in WGS84. */
export function pointQueryUrl(layer: number, lng: number, lat: number, outFields: readonly string[] | '*', withGeometry: boolean): string {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: outFields === '*' ? '*' : outFields.join(','),
    returnGeometry: String(withGeometry),
    outSR: '4326',
    f: 'geojson',
  })
  return `${PVD_GIS_BASE}/${layer}/query?${params.toString()}`
}

// ---------- tolerant field readers (the service can return nulls, blanks, or numbers as strings) ----------

function str(p: Props, key: string): string | undefined {
  const v = p[key]
  if (v === null || v === undefined) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

function num(p: Props, key: string): number | undefined {
  const v = p[key]
  if (v === null || v === undefined || v === '') return undefined
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

function pub<T>(value: T | undefined, source: string): Sourced<T> | undefined {
  return value === undefined ? undefined : fromPublic(value, source)
}

/** Converts one parcel GeoJSON feature into a typed, source-labeled record. */
export function parseParcelFeature(f: Feature): ParcelRecord {
  const p = (f.properties ?? {}) as Props
  const year = num(p, 'YearBuilt')
  const gba = num(p, 'GrBldgArea')
  const acres = num(p, 'AreaAC')
  const geom = f.geometry
  const isPolygon = geom && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')

  return {
    pin: str(p, 'PIN') ?? 'unknown',
    address: pub(str(p, 'ParcAddress'), PVD_SOURCE),
    owner: pub(str(p, 'Owner1'), PVD_SOURCE),
    assessedValue: pub(num(p, 'AssessedValueTotal'), PVD_SOURCE),
    // Assessor records use 0 for "unknown" year and area; treat those as missing.
    yearBuilt: pub(year && year > 1600 ? year : undefined, PVD_SOURCE),
    grossBuildingSF: pub(gba && gba > 0 ? gba : undefined, PVD_SOURCE),
    landAreaSF: pub(acres && acres > 0 ? Math.round(acres * SQFT_PER_ACRE) : undefined, PVD_SOURCE),
    stateUseCode: pub(str(p, 'StateUse'), PVD_SOURCE),
    municipalUseCode: pub(str(p, 'MuniUseCode'), PVD_SOURCE),
    parcelZoning: pub(str(p, 'ZONING'), PVD_SOURCE),
    geometry: isPolygon ? (geom as Polygon | MultiPolygon) : null,
  }
}

/** Pulls the overlay attributes out of the zoning / flood / historic responses. */
export function parseOverlays(
  zoning: FeatureCollection | null,
  flood: FeatureCollection | null,
  historic: FeatureCollection | null,
): ParcelOverlays {
  const z = (zoning?.features[0]?.properties ?? null) as Props | null
  const fl = (flood?.features[0]?.properties ?? null) as Props | null
  const h = (historic?.features[0]?.properties ?? null) as Props | null
  return {
    baseZoning: z ? pub(str(z, 'Code'), ZONING_SOURCE) : undefined,
    baseZoningDistrict: z ? pub(str(z, 'District'), ZONING_SOURCE) : undefined,
    floodZone: fl ? pub(str(fl, 'FLD_ZONE'), FLOOD_SOURCE) : undefined,
    historicDistrict: h ? pub(str(h, 'DISTRICT') ?? str(h, 'ZONE'), HISTORIC_SOURCE) : undefined,
  }
}

async function getGeoJSON(url: string, signal?: AbortSignal): Promise<FeatureCollection> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`City GIS returned HTTP ${res.status}`)
  const body = (await res.json()) as FeatureCollection & { error?: { message?: string } }
  if (body.error) throw new Error(body.error.message ?? 'City GIS returned an error')
  if (!Array.isArray(body.features)) throw new Error('Unexpected response from City GIS')
  return body
}

export interface ParcelLookupResult {
  parcel: ParcelRecord | null
  overlays: ParcelOverlays
}

/**
 * Finds the parcel under a point, plus the zoning, flood and historic layers there.
 * The parcel request must succeed; overlay failures just leave those fields empty.
 */
export async function lookupParcelAt(lng: number, lat: number, signal?: AbortSignal): Promise<ParcelLookupResult> {
  const [parcelRes, zoningRes, floodRes, historicRes] = await Promise.allSettled([
    getGeoJSON(pointQueryUrl(LAYERS.parcels, lng, lat, PARCEL_FIELDS, true), signal),
    getGeoJSON(pointQueryUrl(LAYERS.baseZoning, lng, lat, ['Code', 'District'], false), signal),
    getGeoJSON(pointQueryUrl(LAYERS.flood, lng, lat, ['FLD_ZONE'], false), signal),
    getGeoJSON(pointQueryUrl(LAYERS.historicLocal, lng, lat, '*', false), signal),
  ])

  if (parcelRes.status === 'rejected') throw parcelRes.reason
  const ok = (r: PromiseSettledResult<FeatureCollection>) => (r.status === 'fulfilled' ? r.value : null)
  const first = parcelRes.value.features[0]

  return {
    parcel: first ? parseParcelFeature(first) : null,
    overlays: parseOverlays(ok(zoningRes), ok(floodRes), ok(historicRes)),
  }
}
