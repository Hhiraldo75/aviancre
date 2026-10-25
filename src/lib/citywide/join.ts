import type { MultiPolygon, Polygon } from 'geojson'
import type { LngLat } from '../../types'
import { parseParcelFeature, type Feature } from '../../services/providenceGis'
import { pointInPolygon, interiorPoint } from '../geo'
import { decodeLandUse } from '../landUse'
import type { CitywideParcel } from './types'

/**
 * Builds the citywide snapshot's records from the raw public pulls: the 2025
 * tax roll's commercial records (one per condo unit), the city parcel layer's
 * rows for the same lots (building area, units, outline), the official
 * neighborhoods, and OpenStreetMap office/shop features. Pure, so the refresh
 * script and the tests share it.
 */

/** A tax-roll record as the Open Data portal returns it. */
export type TaxRollRow = Record<string, unknown> & { property_location?: { coordinates?: [number, number] } }

export interface Neighborhood {
  name: string
  geometry: Polygon | MultiPolygon
}

export type OsmKind = 'office' | 'retail'

export interface OsmFeature {
  point: LngLat
  kind: OsmKind
}

/** Amenities counted as retail space: places that rent storefronts. */
export const OSM_RETAIL_AMENITIES = ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'bank', 'pharmacy', 'ice_cream'] as const
const OSM_RETAIL_BUILDINGS = ['retail', 'supermarket', 'kiosk']

/** Office if tagged an office; retail if a shop, a storefront amenity or a retail building; else not counted. */
export function osmKind(tags: Record<string, string | undefined>): OsmKind | null {
  if (tags.office || tags.building === 'office') return 'office'
  if (tags.shop || OSM_RETAIL_BUILDINGS.includes(tags.building ?? '') || (OSM_RETAIL_AMENITIES as readonly string[]).includes(tags.amenity ?? ''))
    return 'retail'
  return null
}

export interface JoinStats {
  taxRollRecords: number
  commercialLots: number
  /** Lots by the land use of their main record. */
  byLandUse: Record<string, number>
  /** Lots with no row in the city parcel layer. */
  noCityParcel: number
  /** Lots left out of the snapshot: no outline and no tax-roll point. */
  noLocation: number
}

export interface JoinResult {
  parcels: CitywideParcel[]
  /** Full-detail outlines by PIN, for the parcels that have one. */
  outlines: Record<string, Polygon | MultiPolygon>
  stats: JoinStats
}

function str(r: Record<string, unknown>, key: string): string | undefined {
  const v = r[key]
  if (v === null || v === undefined) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

function num(r: Record<string, unknown>, key: string): number | undefined {
  const s = str(r, key)
  if (s === undefined) return undefined
  const n = Number(s.replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

/** The city parcel layer's PIN for a plat and lot (inverse of `pinToPlatLot`). */
export const platLotToPin = (plat: number, lot: number) => String(plat * 10_000 + lot)

/** Improved commercial records first, then the highest assessment. */
function mainRecord(rows: TaxRollRow[]): TaxRollRow {
  const improved = (r: TaxRollRow) => {
    const c = decodeLandUse(str(r, 'class'))?.category
    return c !== 'vacant land' && c !== 'other'
  }
  return rows.reduce((best, r) => {
    if (improved(r) !== improved(best)) return improved(r) ? r : best
    return (num(r, 'total_assmt') ?? 0) > (num(best, 'total_assmt') ?? 0) ? r : best
  })
}

/** "0002" and "2" are the same unit. */
const unitKey = (u: string | undefined) => (u ?? '').trim().toUpperCase().replace(/^0+(?=.)/, '')

/**
 * The city layer's rows for the lot's commercial records, one per unit: the
 * layer repeats a lot once per condo unit and sometimes twice for the same
 * unit. On a condo lot, only the units the tax roll lists as commercial count
 * (matched by unit number, else by the layer's own use code), so their areas
 * line up with the assessments summed.
 */
function unitRows(features: Feature[], taxUnits: string[]): Record<string, unknown>[] {
  const byUnit = new Map<string, Record<string, unknown>>()
  for (const f of features) {
    const p = (f.properties ?? {}) as Record<string, unknown>
    const key = unitKey(str(p, 'UnitNum'))
    if (!byUnit.has(key)) byUnit.set(key, p)
  }
  const rows = [...byUnit.values()]
  if (rows.length <= 1) return rows
  const listed = new Set(taxUnits.map(unitKey))
  const matched = rows.filter((p) => listed.has(unitKey(str(p, 'UnitNum'))))
  if (matched.length) return matched
  const commercial = rows.filter((p) => decodeLandUse(str(p, 'MuniUseCode'))?.isCommercial)
  return commercial.length ? commercial : rows
}

const positive = (n: number | undefined) => (n !== undefined && n > 0 ? n : undefined)

export function joinParcels(input: {
  taxRows: TaxRollRow[]
  gisFeatures: Feature[]
  neighborhoods: Neighborhood[]
  osm: OsmFeature[]
}): JoinResult {
  const lots = new Map<string, TaxRollRow[]>()
  for (const r of input.taxRows) {
    if (!decodeLandUse(str(r, 'class'))?.isCommercial) continue
    const plat = num(r, 'plat')
    const lot = num(r, 'lot')
    if (plat === undefined || lot === undefined) continue
    const pin = platLotToPin(plat, lot)
    lots.set(pin, [...(lots.get(pin) ?? []), r])
  }

  const gisByPin = new Map<string, Feature[]>()
  for (const f of input.gisFeatures) {
    const pin = str((f.properties ?? {}) as Record<string, unknown>, 'PIN')
    if (pin) gisByPin.set(pin, [...(gisByPin.get(pin) ?? []), f])
  }

  const stats: JoinStats = { taxRollRecords: input.taxRows.length, commercialLots: lots.size, byLandUse: {}, noCityParcel: 0, noLocation: 0 }
  const parcels: CitywideParcel[] = []
  const outlines: Record<string, Polygon | MultiPolygon> = {}

  for (const [pin, rows] of lots) {
    const main = mainRecord(rows)
    const landUseCode = str(main, 'class')!
    const label = decodeLandUse(landUseCode)!.label
    stats.byLandUse[label] = (stats.byLandUse[label] ?? 0) + 1

    const features = gisByPin.get(pin) ?? []
    if (features.length === 0) stats.noCityParcel++
    const units = unitRows(features, rows.map((r) => str(r, 'unit') ?? ''))
    const parsed = features.map(parseParcelFeature)
    const geometry = parsed.find((p) => p.geometry)?.geometry ?? null
    const unitSum = (key: string) => {
      const values = units.map((p) => positive(num(p, key))).filter((n) => n !== undefined)
      return values.length ? values.reduce((s, n) => s + n, 0) : undefined
    }
    const years = parsed.map((p) => p.yearBuilt?.value).filter((y) => y !== undefined)
    const floors = units.map((p) => positive(num(p, 'NumFloors'))).filter((n) => n !== undefined)
    const landSF = parsed.map((p) => p.landAreaSF?.value).filter((n) => n !== undefined)

    const taxPoint = rows.map((r) => r.property_location?.coordinates).find((c) => c && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    const at = geometry ? interiorPoint(geometry) : taxPoint
    // Six decimals is about 0.1 m.
    const point: LngLat | undefined = at && [Math.round(at[0] * 1e6) / 1e6, Math.round(at[1] * 1e6) / 1e6]
    if (!point) {
      stats.noLocation++
      continue
    }
    if (geometry) outlines[pin] = geometry

    const assessed = rows.reduce((s, r) => s + (num(r, 'total_assmt') ?? 0), 0)
    const isHousing = ['multifamily', 'mixed-use'].includes(decodeLandUse(landUseCode)!.category)
    const parcel: CitywideParcel = {
      pin,
      plat: String(num(main, 'plat')),
      lot: String(num(main, 'lot')),
      address: str(main, 'formated_address') ?? parsed.find((p) => p.address)?.address?.value ?? `Plat ${num(main, 'plat')} lot ${num(main, 'lot')}`,
      landUseCode,
      assessed: assessed > 0 ? assessed : undefined,
      gba: unitSum('GrBldgArea') && Math.round(unitSum('GrBldgArea')!),
      landSF: landSF.length ? Math.max(...landSF) : undefined,
      yearBuilt: years.length ? Math.min(...years) : undefined,
      units: isHousing ? unitSum('NumUnits') : undefined,
      floors: floors.length ? Math.max(...floors) : undefined,
      neighborhood: input.neighborhoods.find((n) => pointInPolygon(point, n.geometry))?.name,
      point,
      osm: geometry ? countOsm(geometry, input.osm) : { office: 0, retail: 0 },
      records: rows.length,
    }
    // Leave unknowns out of the file rather than writing them as undefined.
    for (const key of Object.keys(parcel) as (keyof CitywideParcel)[]) if (parcel[key] === undefined) delete parcel[key]
    parcels.push(parcel)
  }

  parcels.sort((a, b) => Number(a.pin) - Number(b.pin))
  return { parcels, outlines, stats }
}

function countOsm(geometry: Polygon | MultiPolygon, osm: OsmFeature[]): CitywideParcel['osm'] {
  const coords = (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates).flatMap((p) => p[0])
  const xs = coords.map((c) => c[0])
  const ys = coords.map((c) => c[1])
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const counts = { office: 0, retail: 0 }
  for (const f of osm) {
    const [x, y] = f.point
    if (x < minX || x > maxX || y < minY || y > maxY) continue
    if (pointInPolygon(f.point, geometry)) counts[f.kind]++
  }
  return counts
}
