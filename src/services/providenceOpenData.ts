import type { TaxRecord } from '../types'
import { fromPublic } from '../lib/sourced'

/**
 * Client for the City of Providence Open Data portal (Socrata), dataset
 * "2025 Property Tax Roll" (6ub4-iebe). Hosted in the cloud with CORS
 * enabled, so the browser calls it directly from any network.
 */
export const TAX_ROLL_URL = 'https://data.providenceri.gov/resource/6ub4-iebe.json'
export const TAX_ROLL_SOURCE = 'City of Providence Open Data – 2025 Property Tax Roll'

/** Search radius around the click; tax-roll points sit near each parcel's center. */
export const SEARCH_RADIUS_M = 80

type Row = Record<string, unknown> & {
  property_location?: { type?: string; coordinates?: [number, number] }
}

export function nearbyQueryUrl(lng: number, lat: number, radiusM = SEARCH_RADIUS_M): string {
  const params = new URLSearchParams({
    $where: `within_circle(property_location, ${lat}, ${lng}, ${radiusM})`,
    $limit: '200',
  })
  return `${TAX_ROLL_URL}?${params.toString()}`
}

/** Great-circle distance in meters. */
export function haversineM(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6_371_000
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function str(r: Row, key: string): string | undefined {
  const v = r[key]
  if (v === null || v === undefined) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

function num(r: Row, key: string): number | undefined {
  const s = str(r, key)
  if (s === undefined) return undefined
  const n = Number(s.replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
}

/** Company name if present, else "First Last" for individual owners. */
export function ownerName(r: Row): string | undefined {
  const company = str(r, 'company')
  if (company) return company
  const person = [str(r, 'first_name'), str(r, 'last_name')].filter(Boolean).join(' ')
  return person ? titleCase(person) : undefined
}

function lotKey(r: Row): string {
  return `${str(r, 'plat') ?? ''}-${str(r, 'lot') ?? ''}`
}

/**
 * Picks the record nearest the click and folds in any other units on the same
 * plat + lot (condominiums are one record per unit).
 */
export function nearestRecord(rows: Row[], lng: number, lat: number, maxDistanceM = SEARCH_RADIUS_M * 1.25): TaxRecord | null {
  const located = rows
    .map((r) => {
      const c = r.property_location?.coordinates
      return c && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? { r, lng: c[0], lat: c[1], d: haversineM(lng, lat, c[0], c[1]) } : null
    })
    .filter((x): x is { r: Row; lng: number; lat: number; d: number } => x !== null)
    // Never trust the server filter alone: drop anything not actually near the click.
    .filter((x) => x.d <= maxDistanceM)
    .sort((a, b) => a.d - b.d)

  const best = located[0]
  if (!best) return null
  const r = best.r
  const sameLot = rows.filter((x) => lotKey(x) === lotKey(r))
  const unitTotal = sameLot.reduce((s, x) => s + (num(x, 'total_assmt') ?? 0), 0)
  const value = num(r, 'total_assmt')
  const exempt = num(r, 'total_exempt')
  const taxes = num(r, 'total_taxes')
  const address = str(r, 'formated_address')
  const owner = ownerName(r)
  const landUse = str(r, 'short_desc')

  return {
    taxMap: str(r, 'tax_map') ?? lotKey(r),
    plat: str(r, 'plat') ?? '',
    lot: str(r, 'lot') ?? '',
    unit: str(r, 'unit'),
    address: address ? fromPublic(address, TAX_ROLL_SOURCE) : undefined,
    owner: owner ? fromPublic(owner, TAX_ROLL_SOURCE) : undefined,
    landUse: landUse ? fromPublic(landUse, TAX_ROLL_SOURCE) : undefined,
    landUseCode: str(r, 'class'),
    assessedValue: value !== undefined ? fromPublic(value, TAX_ROLL_SOURCE) : undefined,
    exemptValue: exempt !== undefined ? fromPublic(exempt, TAX_ROLL_SOURCE) : undefined,
    annualTaxes: taxes !== undefined ? fromPublic(taxes, TAX_ROLL_SOURCE) : undefined,
    lng: best.lng,
    lat: best.lat,
    distanceM: best.d,
    unitCount: sameLot.length,
    totalAssessedAllUnits: sameLot.length > 1 ? unitTotal : undefined,
  }
}

/** Fallback filter (a lat/lng box) if the portal rejects the circle query. */
export function boxQueryUrl(lng: number, lat: number, radiusM = SEARCH_RADIUS_M): string {
  const dLat = radiusM / 111_320
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180))
  const params = new URLSearchParams({
    $where: `within_box(property_location, ${lat + dLat}, ${lng - dLng}, ${lat - dLat}, ${lng + dLng})`,
    $limit: '200',
  })
  return `${TAX_ROLL_URL}?${params.toString()}`
}

export async function lookupTaxRecord(lng: number, lat: number, signal?: AbortSignal): Promise<TaxRecord | null> {
  let res = await fetch(nearbyQueryUrl(lng, lat), { signal })
  if (res.status === 400) res = await fetch(boxQueryUrl(lng, lat), { signal })
  if (!res.ok) throw new Error(`Providence Open Data returned HTTP ${res.status}`)
  const rows = (await res.json()) as unknown
  if (!Array.isArray(rows)) throw new Error('Unexpected response from Providence Open Data')
  return nearestRecord(rows as Row[], lng, lat)
}
