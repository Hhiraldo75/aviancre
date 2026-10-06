import type { ParcelRecord } from '../types'
import { ZONING_LIMITS } from '../data/zoning'

export interface ParcelMetrics {
  assessedPerBuildingSF: number | null
  existingFAR: number | null
  /** From the placeholder zoning table; null when the code isn't in it. */
  placeholderMaxFAR: number | null
  additionalBuildableSF: number | null
}

/** Normalizes zoning codes like "d1", "D 1" or "D-1 " to "D-1". */
export function normalizeZoningCode(code: string | undefined): string | undefined {
  if (!code) return undefined
  const m = code.trim().toUpperCase().match(/^([A-Z]+)[\s-]*(\d+[A-Z]?)?$/)
  if (!m) return code.trim().toUpperCase()
  return m[2] ? `${m[1]}-${m[2]}` : m[1]
}

export function parcelMetrics(p: ParcelRecord, zoningCode: string | undefined): ParcelMetrics {
  const gba = p.grossBuildingSF?.value ?? null
  const land = p.landAreaSF?.value ?? null
  const value = p.assessedValue?.value ?? null
  const limits = ZONING_LIMITS[normalizeZoningCode(zoningCode) ?? '']
  const placeholderMaxFAR = limits ? limits.maxFAR : null

  return {
    assessedPerBuildingSF: value !== null && gba ? value / gba : null,
    existingFAR: gba !== null && land ? gba / land : null,
    placeholderMaxFAR,
    additionalBuildableSF: placeholderMaxFAR !== null && land ? land * placeholderMaxFAR - (gba ?? 0) : null,
  }
}
