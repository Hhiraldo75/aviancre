import type { ParcelRecord } from '../types'
import { ZONING_LIMITS, type ZoningLimits } from '../data/zoning'

export interface ParcelMetrics {
  assessedPerBuildingSF: number | null
  existingFAR: number | null
  /** Ordinance limits for the district; undefined when the code isn't in the table. */
  limits: ZoningLimits | undefined
}

/** Normalizes zoning codes like "d1", "D 1" or "D-1 " to "D-1". Codes with more parts ("D-1-100") pass through upper-cased. */
export function normalizeZoningCode(code: string | undefined): string | undefined {
  if (!code) return undefined
  const m = code.trim().toUpperCase().match(/^([A-Z]+)[\s-]*(\d+[A-Z]?)?$/)
  if (!m) return code.trim().toUpperCase()
  return m[2] ? `${m[1]}-${m[2]}` : m[1]
}

/** The ordinance writes "RP"; the zoning map writes "R-P". */
const ALIASES: Record<string, string> = { RP: 'R-P' }

/** Ordinance limits for a zoning code as the map, the parcel record or a sample spells it. */
export function zoningLimitsFor(code: string | undefined): ZoningLimits | undefined {
  const c = normalizeZoningCode(code)
  return c === undefined ? undefined : ZONING_LIMITS[ALIASES[c] ?? c]
}

export function parcelMetrics(p: ParcelRecord, zoningCode: string | undefined): ParcelMetrics {
  const gba = p.grossBuildingSF?.value ?? null
  const land = p.landAreaSF?.value ?? null
  const value = p.assessedValue?.value ?? null

  return {
    assessedPerBuildingSF: value !== null && gba ? value / gba : null,
    existingFAR: gba !== null && land ? gba / land : null,
    limits: zoningLimitsFor(zoningCode),
  }
}

/** "50 ft · 4 stories"; "None set" where the ordinance sets no height (CD). */
export function maxHeightLabel(limits: ZoningLimits): string {
  if (limits.maxHeightFt === null) return 'None set'
  return limits.maxStories ? `${limits.maxHeightFt} ft · ${limits.maxStories} stories` : `${limits.maxHeightFt} ft`
}

/** The panel line explaining why there's no FAR: the ordinance controls bulk by height (and coverage). */
export function noFarNote(code: string, limits: ZoningLimits | undefined): string {
  if (!limits) return `${code} isn't in AVIANCRE's zoning table, so no limits are shown.`
  if (limits.maxHeightFt === null) return `The Providence Zoning Ordinance sets no FAR or other dimensional standards for ${code} (${limits.section}).`
  const by = limits.maxCoverage !== undefined ? 'height and building coverage' : 'height'
  return `The Providence Zoning Ordinance sets no FAR for ${code}; development is limited by ${by} (${limits.section}).`
}
