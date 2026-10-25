import type { DealPlacement, LngLat, ParcelOverlays, ParcelRecord, Property, SF, Sourced, ZoningInfo } from '../types'
import { SUBMARKETS } from '../data/submarkets'
import { ZONING_SOURCE } from '../data/zoning'
import { normalizeAddress } from './addressSearch'
import { normalizeZoningCode, zoningLimitsFor } from './parcelMetrics'
import { ringAreaSF } from './geo'
import { fmt } from './format'
import { approximateAddress, isImportedDealId, rentRollFloors, rentRollGrossSF, rentRollZoning } from './rentRollImport'
import { estimate, fromPublic } from './sourced'

/**
 * Imported deals at rest: browser local storage in the app, private-deals/<id>.json
 * on the command line. Both hold Properties built by `parseRentRoll`; this checks
 * a stored one still has the shape the engine needs before it is loaded.
 */

export const DEAL_FILE_FORMAT = 'aviancre-deal'
export const DEAL_FILE_VERSION = 1

/** private-deals/<id>.json */
export interface DealFile {
  format: typeof DEAL_FILE_FORMAT
  version: typeof DEAL_FILE_VERSION
  property: Property
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null

const isSourcedNumber = (x: unknown) => isObject(x) && typeof x.value === 'number' && typeof x.source === 'string'

/** A structural check, not a full schema: enough to reject stale or hand-edited entries. */
export function isImportedDeal(x: unknown): x is Property {
  if (!isObject(x) || typeof x.id !== 'string' || !isImportedDealId(x.id) || typeof x.name !== 'string') return false
  if (!isObject(x.importedFrom) || !isObject(x.location) || !isObject(x.physical) || !isObject(x.market)) return false
  if (!isSourcedNumber(x.physical.rentableSF) || !isSourcedNumber(x.market.marketRent) || !isSourcedNumber(x.market.marketCapRate)) return false
  const rr = x.rentRoll
  if (!isObject(rr)) return false
  if (rr.kind === 'multifamily') return Array.isArray(rr.unitTypes) && (rr.units === undefined || Array.isArray(rr.units))
  return rr.kind === 'commercial' && Array.isArray(rr.leases) && Array.isArray(rr.vacancies)
}

export function dealFile(property: Property): DealFile {
  return { format: DEAL_FILE_FORMAT, version: DEAL_FILE_VERSION, property }
}

/** The property in a parsed private-deals/<id>.json, or null when the file isn't a deal. */
export function propertyFromDealFile(x: unknown): Property | null {
  if (!isObject(x) || x.format !== DEAL_FILE_FORMAT || x.version !== DEAL_FILE_VERSION) return null
  return isImportedDeal(x.property) ? x.property : null
}

// ---------- placement on a real building ----------

/** Where a placed deal's outline comes from when it is the OSM building in the map's own tiles. */
export const OSM_TILES_SOURCE = 'OpenStreetMap contributors (ODbL), via OpenFreeMap map tiles'

const PLACEMENT_METHODS: DealPlacement['method'][] = ['address', 'search', 'click']

function isPlacement(x: unknown): x is DealPlacement {
  if (!isObject(x) || typeof x.pin !== 'string' || typeof x.cityAddress !== 'string' || typeof x.placedAt !== 'string') return false
  if (!PLACEMENT_METHODS.includes(x.method as DealPlacement['method'])) return false
  return (x.outlineFrom === 'osm' || x.outlineFrom === 'parcel') && (x.heightM === undefined || typeof x.heightM === 'number')
}

const isRing = (x: unknown) =>
  Array.isArray(x) && x.length >= 4 && x.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every((n) => typeof n === 'number'))

/** The rent roll named an address (rather than getting its submarket's placeholder). */
export const hasFileAddress = (p: Property) => p.location.address !== approximateAddress(p.location.submarket)

/** What a placed deal takes from its parcel's public record, in place of the rent roll's "unknown". */
export interface ParcelFacts {
  /** The zoning map's district with its ordinance limits, and the flood zone. */
  zoning: ZoningInfo
  landAreaSF?: Sourced<SF>
  /** Only from the city's building records (never the rent roll's estimate). */
  grossBuildingSF?: Sourced<SF>
}

/**
 * The parcel's zoning (base zoning map first, else the zoning recorded on the
 * parcel), its ordinance height and coverage limits, flood zone, lot area and
 * building area, as the clicked-parcel panel reads them.
 */
export function parcelFacts(parcel: ParcelRecord, overlays: ParcelOverlays): ParcelFacts {
  const mapped = overlays.baseZoning ?? parcel.parcelZoning
  const code = normalizeZoningCode(mapped?.value)
  const limits = zoningLimitsFor(code)
  const ordinance = limits && `${ZONING_SOURCE}, ${limits.section}`
  const flood = overlays.floodZone ? { floodZone: overlays.floodZone } : {}
  const zoning: ZoningInfo =
    mapped && code
      ? {
          district: fromPublic(code, mapped.sourceName, mapped.asOf),
          ...(limits && ordinance && limits.maxHeightFt !== null ? { maxHeightFt: fromPublic(limits.maxHeightFt, ordinance) } : {}),
          ...(limits && ordinance && limits.maxCoverage !== undefined ? { maxCoverage: fromPublic(limits.maxCoverage, ordinance) } : {}),
          ...flood,
        }
      : { ...rentRollZoning(), ...flood }
  return { zoning, landAreaSF: parcel.landAreaSF, grossBuildingSF: parcel.grossBuildingSF }
}

/**
 * Floors = city gross building area ÷ the OpenStreetMap building's outline area, at least 1.
 * Null without both: a parcel outline is the lot, not the building, and the rent roll's
 * gross SF is only its rentable SF.
 */
export function estimateFloors(placement: DealPlacement, footprint: Sourced<LngLat[]>, gross: Sourced<SF> | undefined): Sourced<number> | null {
  if (placement.outlineFrom !== 'osm' || gross?.source !== 'public') return null
  const outlineSF = ringAreaSF(footprint.value)
  if (!(outlineSF > 0) || !(gross.value > 0)) return null
  const floors = Math.max(1, Math.round(gross.value / outlineSF))
  const notes = `${fmt.int(gross.value)} sf gross building area (city records) ÷ ${fmt.int(outlineSF)} sf building outline (OpenStreetMap), rounded, at least 1`
  return estimate(floors, 'Gross building area ÷ building outline area', { notes })
}

/**
 * The deal on a real parcel: its point, PIN, building outline, and the parcel's
 * zoning, lot and building area. Nothing the underwriting reads changes (rent
 * roll, market, rentable SF, submarket).
 */
export function withPlacement(
  p: Property,
  placement: DealPlacement,
  [lng, lat]: LngLat,
  footprint: Sourced<LngLat[]>,
  facts: ParcelFacts,
): Property {
  const floors = estimateFloors(placement, footprint, facts.grossBuildingSF)
  return {
    ...p,
    location: { ...p.location, lng, lat, parcelId: placement.pin, isApproximate: false, placement },
    physical: {
      ...p.physical,
      footprint,
      floors: floors ?? rentRollFloors(),
      ...(facts.landAreaSF ? { landAreaSF: facts.landAreaSF } : {}),
      ...(facts.grossBuildingSF ? { grossBuildingSF: facts.grossBuildingSF } : {}),
    },
    zoning: facts.zoning,
  }
}

/** Back to the approximate pin at the submarket's center, with the rent roll's zoning and sizes, exactly as imported. */
export function withoutPlacement(p: Property): Property {
  const { placement: _placement, parcelId: _parcelId, ...location } = p.location
  const { footprint: _footprint, landAreaSF: _land, ...physical } = p.physical
  const [lng, lat] = SUBMARKETS[p.location.submarket].center
  return {
    ...p,
    location: { ...location, lng, lat, isApproximate: true },
    physical: { ...physical, grossBuildingSF: rentRollGrossSF(p.physical.rentableSF.value), floors: rentRollFloors() },
    zoning: rentRollZoning(),
  }
}

/**
 * A stored deal whose placement is malformed loads as approximate: dropping
 * the whole deal would lose it from storage on the next save.
 */
export function withValidPlacement(p: Property): Property {
  const { placement } = p.location
  if (placement === undefined && p.location.isApproximate && !p.physical.footprint) return p
  return isPlacement(placement) && isRing(p.physical.footprint?.value) ? p : withoutPlacement(p)
}

/** A re-imported deal stays on its building unless the rent roll's address changed. */
export function carryPlacement(previous: Property | undefined, next: Property): Property {
  const placement = previous?.location.placement
  if (!placement || !previous.physical.footprint) return next
  if (normalizeAddress(previous.location.address) !== normalizeAddress(next.location.address)) return next
  const gross = previous.physical.grossBuildingSF
  return withPlacement(next, placement, [previous.location.lng, previous.location.lat], previous.physical.footprint, {
    zoning: previous.zoning,
    landAreaSF: previous.physical.landAreaSF,
    grossBuildingSF: gross.source === 'public' ? gross : undefined,
  })
}
