import type { AssetType, ISODate, Pct, Property, SubmarketId } from '../types'
import { SUBMARKETS } from '../data/submarkets'
import { fmt } from './format'
import { expiringShare, occupancy, OCCUPANCY_BUCKETS } from './metrics'
import type { AssumptionEdits } from './underwriting/edits'
import { maxBid } from './underwriting/maxBid'
import { runUnderwriting } from './underwriting/summary'

/**
 * Portfolio filters shared by the map and the property list. Everything here
 * is pure: underwriting figures come in as precomputed facts from the
 * memoized engine, so the filter itself never runs a model.
 *
 * Bounds: size is inclusive at both ends; occupancy is [min, max) like the
 * map's color buckets, with a max of 100% or more meaning no cap; the
 * expiration share and levered IRR are "at or above".
 */

export const FILTER_ASSET_TYPES: AssetType[] = ['office', 'retail', 'industrial', 'multifamily']
export const EXPIRATION_YEARS = [1, 2, 3, 5] as const
export type ExpirationYears = (typeof EXPIRATION_YEARS)[number]

export interface PropertyFilters {
  /** Empty means any. */
  assetTypes: AssetType[]
  /** Empty means any. */
  submarkets: SubmarketId[]
  minSF: number | null
  maxSF: number | null
  minOccupancy: Pct | null
  /** Exclusive; null or ≥ 100% means no cap. */
  maxOccupancy: Pct | null
  /** Active when `minShare` is set: at least that share of rentable SF expires within `years`. */
  expiring: { years: ExpirationYears; minShare: Pct | null }
  minLeveredIRR: Pct | null
  /** Max bid at the target levered IRR is below the current price. */
  maxBidBelowPrice: boolean
}

export const EMPTY_FILTERS: PropertyFilters = {
  assetTypes: [],
  submarkets: [],
  minSF: null,
  maxSF: null,
  minOccupancy: null,
  maxOccupancy: null,
  expiring: { years: 2, minShare: null },
  minLeveredIRR: null,
  maxBidBelowPrice: false,
}

export const SORT_KEYS = ['name', 'size', 'occupancy', 'irr'] as const
export type SortKey = (typeof SORT_KEYS)[number]
export const SORT_LABELS: Record<SortKey, string> = { name: 'Name', size: 'Size', occupancy: 'Occupancy', irr: 'Levered IRR' }
export const DEFAULT_SORT: SortKey = 'name'

/** Occupancy presets matching the map legend's buckets. */
export const OCCUPANCY_PRESETS = OCCUPANCY_BUCKETS.map((b, i) => ({
  label: b.label.replace(' leased', ''),
  min: i === 0 ? null : (b.min as Pct),
  max: (OCCUPANCY_BUCKETS[i + 1]?.min ?? null) as Pct | null,
}))

// ---------- underwriting facts ----------

/** Engine figures the filters and the IRR sort need; null when the engine can't produce one. */
export interface UnderwritingFacts {
  leveredIRR: Pct | null
  /** Null when the max bid wasn't solved for or has no solution. */
  maxBidBelowPrice: boolean | null
}
export type FactsById = Record<string, UnderwritingFacts | undefined>

export interface UnderwritingNeeds {
  irr: boolean
  maxBid: boolean
}

/** Which engine figures the current filters and sort use; the max bid solve only runs when asked for. */
export function underwritingNeeds(f: PropertyFilters, sort: SortKey): UnderwritingNeeds {
  return { irr: f.minLeveredIRR !== null || sort === 'irr', maxBid: f.maxBidBelowPrice }
}

/** Reads the memoized engine run (and max bid, if needed) at the property's current assumptions. */
export function underwritingFacts(
  property: Property,
  asOf: ISODate,
  edits: AssumptionEdits | undefined,
  needs: UnderwritingNeeds,
): UnderwritingFacts {
  const run = runUnderwriting(property, asOf, edits)
  if (run.status !== 'ok') return { leveredIRR: null, maxBidBelowPrice: null }
  // result.assumptions is the object the Investment card solves with, so the max bid cache is shared.
  const bid = needs.maxBid ? maxBid(property, asOf, run.result.assumptions) : null
  return {
    leveredIRR: run.result.metrics.leveredIRR,
    maxBidBelowPrice: bid?.status === 'ok' ? bid.vsCurrentPct < 0 : null,
  }
}

/** Facts for every property, or none when neither the filters nor the sort use the engine. */
export function underwritingFactsById(
  properties: Property[],
  asOf: ISODate,
  editsById: Record<string, AssumptionEdits | undefined>,
  needs: UnderwritingNeeds,
): FactsById {
  if (!needs.irr && !needs.maxBid) return {}
  return Object.fromEntries(properties.map((p) => [p.id, underwritingFacts(p, asOf, editsById[p.id], needs)]))
}

// ---------- matching and sorting ----------

export function hasActiveFilters(f: PropertyFilters): boolean {
  return activeFilterChips(f).length > 0
}

export function matchesFilters(p: Property, f: PropertyFilters, asOf: ISODate, facts?: UnderwritingFacts): boolean {
  if (f.assetTypes.length && !f.assetTypes.includes(p.assetType)) return false
  if (f.submarkets.length && !f.submarkets.includes(p.location.submarket)) return false

  const rsf = p.physical.rentableSF.value
  if (f.minSF !== null && rsf < f.minSF) return false
  if (f.maxSF !== null && rsf > f.maxSF) return false

  if (f.minOccupancy !== null || f.maxOccupancy !== null) {
    const occ = occupancy(p, asOf)
    if (f.minOccupancy !== null && occ < f.minOccupancy) return false
    if (f.maxOccupancy !== null && f.maxOccupancy < 1 && occ >= f.maxOccupancy) return false
  }

  if (f.expiring.minShare !== null) {
    const share = expiringShare(p, asOf, f.expiring.years)
    if (share === null || share < f.expiring.minShare) return false
  }

  if (f.minLeveredIRR !== null) {
    const irr = facts?.leveredIRR ?? null
    if (irr === null || irr < f.minLeveredIRR) return false
  }
  if (f.maxBidBelowPrice && facts?.maxBidBelowPrice !== true) return false
  return true
}

export function filterProperties(properties: Property[], f: PropertyFilters, asOf: ISODate, facts: FactsById): Property[] {
  return properties.filter((p) => matchesFilters(p, f, asOf, facts[p.id]))
}

/** Name A–Z; size, occupancy and levered IRR highest first. Missing values go last; ties by name. */
export function sortProperties(properties: Property[], key: SortKey, asOf: ISODate, facts: FactsById): Property[] {
  const value = (p: Property): number | null => {
    if (key === 'size') return p.physical.rentableSF.value
    if (key === 'occupancy') return occupancy(p, asOf)
    if (key === 'irr') return facts[p.id]?.leveredIRR ?? null
    return null
  }
  return [...properties].sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    if (va !== vb) {
      if (va === null) return 1
      if (vb === null) return -1
      return vb - va
    }
    return a.name.localeCompare(b.name)
  })
}

export interface PropertyView {
  /** Matching properties, sorted. */
  matching: Property[]
  matchIds: Set<string>
  total: number
  facts: FactsById
}

/** The filtered, sorted set the map and the list both show. */
export function propertyView(
  properties: Property[],
  f: PropertyFilters,
  sort: SortKey,
  asOf: ISODate,
  facts: FactsById,
): PropertyView {
  const matching = sortProperties(filterProperties(properties, f, asOf, facts), sort, asOf, facts)
  return { matching, matchIds: new Set(matching.map((p) => p.id)), total: properties.length, facts }
}

/** Submarkets that have at least one property, in the benchmark table's order. */
export function submarketOptions(properties: Property[]): SubmarketId[] {
  const present = new Set(properties.map((p) => p.location.submarket))
  return (Object.keys(SUBMARKETS) as SubmarketId[]).filter((id) => present.has(id))
}

/** Adds the value if absent, removes it if present. */
export function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value]
}

// ---------- active filter chips ----------

export interface FilterChip {
  key: string
  label: string
}

const sfText = (n: number) => fmt.compact(n)
const yearsText = (n: number) => `${n} yr${n === 1 ? '' : 's'}`

export function occupancyLabel(min: Pct | null, max: Pct | null): string {
  const cap = max !== null && max < 1 ? max : null
  if (min !== null && cap !== null) return `${fmt.pctShort(min)}–${fmt.pctShort(cap)} leased`
  if (min !== null) return `${fmt.pctShort(min)}+ leased`
  return `Under ${fmt.pctShort(cap ?? 1)} leased`
}

/** One removable chip per active filter, in the bar's order. */
export function activeFilterChips(f: PropertyFilters): FilterChip[] {
  const chips: FilterChip[] = []
  for (const t of f.assetTypes) chips.push({ key: `type:${t}`, label: fmt.label(t) })
  if (f.minSF !== null || f.maxSF !== null) {
    const label =
      f.minSF !== null && f.maxSF !== null
        ? `${sfText(f.minSF)}–${sfText(f.maxSF)} SF`
        : f.minSF !== null
          ? `≥ ${sfText(f.minSF)} SF`
          : `≤ ${sfText(f.maxSF!)} SF`
    chips.push({ key: 'sf', label })
  }
  const occCap = f.maxOccupancy !== null && f.maxOccupancy < 1
  if (f.minOccupancy !== null || occCap) chips.push({ key: 'occ', label: occupancyLabel(f.minOccupancy, f.maxOccupancy) })
  if (f.expiring.minShare !== null) {
    chips.push({
      key: 'exp',
      label: `≥ ${fmt.pctShort(f.expiring.minShare)} of SF expiring in ${yearsText(f.expiring.years)}`,
    })
  }
  for (const s of f.submarkets) chips.push({ key: `sub:${s}`, label: fmt.label(s) })
  if (f.minLeveredIRR !== null) chips.push({ key: 'irr', label: `Levered IRR ≥ ${fmt.pctShort(f.minLeveredIRR)}` })
  if (f.maxBidBelowPrice) chips.push({ key: 'belowbid', label: 'Max bid below price' })
  return chips
}

/** The filters with one chip's filter cleared. */
export function withoutFilter(f: PropertyFilters, key: string): PropertyFilters {
  const [kind, value] = key.split(':')
  switch (kind) {
    case 'type':
      return { ...f, assetTypes: f.assetTypes.filter((t) => t !== value) }
    case 'sub':
      return { ...f, submarkets: f.submarkets.filter((s) => s !== value) }
    case 'sf':
      return { ...f, minSF: null, maxSF: null }
    case 'occ':
      return { ...f, minOccupancy: null, maxOccupancy: null }
    case 'exp':
      return { ...f, expiring: { ...f.expiring, minShare: null } }
    case 'irr':
      return { ...f, minLeveredIRR: null }
    case 'belowbid':
      return { ...f, maxBidBelowPrice: false }
    default:
      return f
  }
}

// ---------- text inputs ----------

/** A typed number (commas, %, $ and spaces ignored); blank, negative or invalid → null. */
function parseInput(text: string): number | null {
  const t = text.replace(/[\s,%$]/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Whole-percent text ("12.5") ↔ Pct (0.125); trims float noise like 7.000000000000001. */
const pctToNumber = (x: Pct) => Number((x * 100).toFixed(4))

export const sfFromInput = (text: string): number | null => parseInput(text)
export const sfToInput = (n: number | null): string => (n === null ? '' : String(n))
export const pctFromInput = (text: string): Pct | null => {
  const n = parseInput(text)
  return n === null ? null : n / 100
}
export const pctToInput = (x: Pct | null): string => (x === null ? '' : String(pctToNumber(x)))

// ---------- URL query string ----------

const isAssetType = (s: string): s is AssetType => (FILTER_ASSET_TYPES as string[]).includes(s)
const isSubmarket = (s: string): s is SubmarketId => s in SUBMARKETS
const isSortKey = (s: string): s is SortKey => (SORT_KEYS as readonly string[]).includes(s)
const isYears = (n: number): n is ExpirationYears => (EXPIRATION_YEARS as readonly number[]).includes(n)

const rangeText = (lo: number | null, hi: number | null) => `${lo ?? ''}-${hi ?? ''}`

/** "10000-50000", "10000-" or "-50000" → [lo, hi]; null when malformed. */
function parseRange(text: string): [number | null, number | null] | null {
  const parts = text.split('-')
  if (parts.length !== 2) return null
  const [lo, hi] = parts.map(parseInput)
  if ((parts[0] && lo === null) || (parts[1] && hi === null) || (lo === null && hi === null)) return null
  return [lo, hi]
}

/**
 * Shareable query string, e.g. "type=office,retail&sf=10000-50000&occ=80-90&exp=2:20&irr=12&belowbid=1&sort=irr".
 * Percents are written as whole numbers; defaults are left out; empty filters give "".
 */
export function filtersToQuery(f: PropertyFilters, sort: SortKey): string {
  const parts: string[] = []
  if (f.assetTypes.length) parts.push(`type=${f.assetTypes.join(',')}`)
  if (f.submarkets.length) parts.push(`sub=${f.submarkets.join(',')}`)
  if (f.minSF !== null || f.maxSF !== null) parts.push(`sf=${rangeText(f.minSF, f.maxSF)}`)
  if (f.minOccupancy !== null || f.maxOccupancy !== null) {
    const pct = (x: Pct | null) => (x === null ? null : pctToNumber(x))
    parts.push(`occ=${rangeText(pct(f.minOccupancy), pct(f.maxOccupancy))}`)
  }
  if (f.expiring.minShare !== null) parts.push(`exp=${f.expiring.years}:${pctToNumber(f.expiring.minShare)}`)
  if (f.minLeveredIRR !== null) parts.push(`irr=${pctToNumber(f.minLeveredIRR)}`)
  if (f.maxBidBelowPrice) parts.push('belowbid=1')
  if (sort !== DEFAULT_SORT) parts.push(`sort=${sort}`)
  return parts.join('&')
}

/** Reads filters and sort from a query string; unknown or malformed values are ignored. */
export function filtersFromQuery(search: string): { filters: PropertyFilters; sort: SortKey } {
  const q = new URLSearchParams(search)
  const list = (key: string) => [...new Set((q.get(key) ?? '').split(',').filter(Boolean))]
  const f: PropertyFilters = { ...EMPTY_FILTERS, expiring: { ...EMPTY_FILTERS.expiring } }

  f.assetTypes = list('type').filter(isAssetType)
  f.submarkets = list('sub').filter(isSubmarket)

  const sf = parseRange(q.get('sf') ?? '')
  if (sf) [f.minSF, f.maxSF] = sf
  const occ = parseRange(q.get('occ') ?? '')
  if (occ) [f.minOccupancy, f.maxOccupancy] = occ.map((x) => (x === null ? null : x / 100))

  const [years, share] = (q.get('exp') ?? '').split(':')
  const y = Number(years)
  const minShare = pctFromInput(share ?? '')
  if (isYears(y) && minShare !== null) f.expiring = { years: y, minShare }

  f.minLeveredIRR = pctFromInput(q.get('irr') ?? '')
  f.maxBidBelowPrice = q.get('belowbid') === '1'

  const sort = q.get('sort') ?? ''
  return { filters: f, sort: isSortKey(sort) ? sort : DEFAULT_SORT }
}
