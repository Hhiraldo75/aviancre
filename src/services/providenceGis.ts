import type { Feature as GeoFeature, FeatureCollection as GeoCollection, Geometry, MultiPolygon, Polygon } from 'geojson'
import type { ParcelOverlays, ParcelRecord, Sourced } from '../types'
import { fromPublic } from '../lib/sourced'

/**
 * Client for the public parcel, zoning and flood layers, all hosted on ArcGIS Online:
 * - the City of Providence's own `Parcel_Zoning_FL` feature service (parcels with
 *   assessor data, base zoning, overlay and local historic districts), and
 * - RIGIS's statewide FEMA DFIRM flood hazard areas (2022).
 * Both allow cross-site requests (`Access-Control-Allow-Origin: *`), so the browser
 * calls them directly. (The city's own webgis.providenceri.gov server drops
 * connections from outside the US, including Vercel's servers, so it isn't used.)
 */
export const PVD_PARCELS_SERVICE =
  'https://services6.arcgis.com/wv9mHoqblhTsnqdG/arcgis/rest/services/Parcel_Zoning_FL/FeatureServer'
export const RIGIS_FLOOD_LAYER =
  'https://services2.arcgis.com/S8zZg9pg23JUEexQ/arcgis/rest/services/PLAN_DFIRM_Statewide_Flood_Hazard_Areas_2022/FeatureServer/1'

const PVD_AGOL = 'City of Providence ArcGIS Online'
export const PVD_SOURCE = `${PVD_AGOL} – Parcels with CAMA (Parcel_Zoning_FL)`
const ZONING_SOURCE = `${PVD_AGOL} – Base Zoning (Parcel_Zoning_FL)`
const OVERLAY_SOURCE = `${PVD_AGOL} – Overlay Districts (Parcel_Zoning_FL)`
const HISTORIC_SOURCE = `${PVD_AGOL} – Local Historic Districts (Parcel_Zoning_FL)`
const FLOOD_SOURCE = 'FEMA DFIRM via RIGIS – Statewide Flood Hazard Areas 2022'

/** Layer ids in Parcel_Zoning_FL. */
export const LAYERS = {
  parcels: 0,
  /** Downcity, Transit-Oriented Development, Eastside I-195, Educational and Healthcare Institutional. */
  overlays: [3, 4, 5, 6, 7],
  historicLocal: 8,
  baseZoning: 12,
} as const

/** URL of one Parcel_Zoning_FL layer. */
export const pvdLayer = (id: number): string => `${PVD_PARCELS_SERVICE}/${id}`

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

const FLOOD_FIELDS = ['FLD_ZONE', 'ZONE_SUBTY', 'SFHA_TF', 'STATIC_BFE', 'V_DATUM', 'LEN_UNIT'] as const

const SQFT_PER_ACRE = 43_560
/** FEMA's "no value" for numeric fields such as STATIC_BFE. */
const FEMA_NULL = -9999

type Props = Record<string, unknown>
/** ArcGIS returns `geometry: null` when geometry isn't requested. */
export type Feature = GeoFeature<Geometry | null>
export type FeatureCollection = GeoCollection<Geometry | null>

/** Builds an ArcGIS point-intersect query URL for a layer, returning GeoJSON in WGS84. */
export function pointQueryUrl(layerUrl: string, lng: number, lat: number, outFields: readonly string[] | '*', withGeometry: boolean): string {
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
  return `${layerUrl}/query?${params.toString()}`
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

/** "AREA WITH REDUCED FLOOD RISK DUE TO LEVEE" → "Area with reduced flood risk due to levee". */
function sentenceCase(s: string | undefined): string | undefined {
  return s && s.charAt(0) + s.slice(1).toLowerCase()
}

const props = (fc: FeatureCollection | null): Props[] => (fc?.features ?? []).map((f) => (f.properties ?? {}) as Props)

export interface OverlayResponses {
  zoning: FeatureCollection | null
  flood: FeatureCollection | null
  historic: FeatureCollection | null
  /** One response per overlay-district layer; null where that request failed. */
  overlays: (FeatureCollection | null)[]
}

/** Pulls the overlay attributes out of the zoning / flood / historic / overlay-district responses. */
export function parseOverlays({ zoning, flood, historic, overlays }: OverlayResponses): ParcelOverlays {
  const z = props(zoning)[0]
  const fl = props(flood)[0]
  const h = props(historic)[0]
  const districts = [...new Set(overlays.flatMap(props).map((p) => str(p, 'DISTRICT') ?? str(p, 'ZONE')).filter((d) => d !== undefined))]
  const bfe = fl ? num(fl, 'STATIC_BFE') : undefined
  const unit = fl && str(fl, 'LEN_UNIT')
  const datum = fl && str(fl, 'V_DATUM')
  return {
    baseZoning: z ? pub(str(z, 'Code'), ZONING_SOURCE) : undefined,
    baseZoningDistrict: z ? pub(str(z, 'District'), ZONING_SOURCE) : undefined,
    overlayDistricts: districts.map((d) => fromPublic(d, OVERLAY_SOURCE)),
    floodZone: fl ? pub(str(fl, 'FLD_ZONE'), FLOOD_SOURCE) : undefined,
    floodZoneSubtype: fl ? pub(sentenceCase(str(fl, 'ZONE_SUBTY')), FLOOD_SOURCE) : undefined,
    baseFloodElevation:
      bfe !== undefined && bfe !== FEMA_NULL && bfe > 0
        ? { ...fromPublic(bfe, FLOOD_SOURCE), notes: unit && datum ? `Static BFE, ${unit.toLowerCase()} above ${datum}` : 'Static BFE' }
        : undefined,
    historicDistrict: h ? pub(str(h, 'DISTRICT') ?? str(h, 'ZONE'), HISTORIC_SOURCE) : undefined,
  }
}

async function getGeoJSON(url: string, signal?: AbortSignal): Promise<FeatureCollection> {
  const res = await fetch(url, { signal })
  const body = (await res.json().catch(() => ({}))) as Partial<FeatureCollection> & { error?: { message?: string } }
  if (!res.ok) throw new Error(body.error?.message ?? `GIS service returned HTTP ${res.status}`)
  // ArcGIS reports query errors as HTTP 200 with an {"error": …} body.
  if (body.error) throw new Error(body.error.message ?? 'GIS service returned an error')
  if (!Array.isArray(body.features)) throw new Error('Unexpected response from GIS service')
  return body as FeatureCollection
}

export interface ParcelLookupResult {
  parcel: ParcelRecord | null
  overlays: ParcelOverlays
}

/**
 * Finds the parcel under a point, plus the zoning, overlay, historic and flood layers there.
 * The parcel request must succeed; overlay failures just leave those fields empty.
 */
export async function lookupParcelAt(lng: number, lat: number, signal?: AbortSignal): Promise<ParcelLookupResult> {
  const query = (layerUrl: string, fields: readonly string[] | '*', withGeometry = false) =>
    getGeoJSON(pointQueryUrl(layerUrl, lng, lat, fields, withGeometry), signal)
  const [parcelRes, zoningRes, floodRes, historicRes, ...overlayRes] = await Promise.allSettled([
    query(pvdLayer(LAYERS.parcels), PARCEL_FIELDS, true),
    query(pvdLayer(LAYERS.baseZoning), ['Code', 'District']),
    query(RIGIS_FLOOD_LAYER, FLOOD_FIELDS),
    query(pvdLayer(LAYERS.historicLocal), ['ZONE', 'DISTRICT']),
    ...LAYERS.overlays.map((id) => query(pvdLayer(id), ['ZONE', 'DISTRICT'])),
  ])

  if (parcelRes.status === 'rejected') throw parcelRes.reason
  const ok = (r: PromiseSettledResult<FeatureCollection>) => (r.status === 'fulfilled' ? r.value : null)
  const first = parcelRes.value.features[0]

  return {
    parcel: first ? parseParcelFeature(first) : null,
    overlays: parseOverlays({ zoning: ok(zoningRes), flood: ok(floodRes), historic: ok(historicRes), overlays: overlayRes.map(ok) }),
  }
}
