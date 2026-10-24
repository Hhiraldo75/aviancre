import type { Pct, Property, Sourced } from '../types'
import { ZONING_SOURCE, type ZoningLimits } from '../data/zoning'
import { fmt } from './format'
import { zoningLimitsFor } from './parcelMetrics'
import { estimate } from './sourced'

/** Typical floor-to-floor heights used when no measured height exists. */
const FT_PER_FLOOR: Record<Property['assetType'], number> = {
  office: 13,
  'mixed-use': 12,
  multifamily: 10.5,
  retail: 16,
  industrial: 28,
}

/** Story height used to turn a height limit into a story count for the envelope. */
export const ENVELOPE_FT_PER_STORY = 12

export interface BuildableEnvelope {
  /** Lot area × max coverage × stories; EST, with the formula as its note. */
  sf: Sourced<number>
  coverage: Pct
  stories: number
  heightFt: number
}

/**
 * Rough by-right envelope where the ordinance caps building coverage (the residential districts):
 * lot area × max coverage × floor(max height ÷ 12 ft). Null where it sets no coverage limit.
 */
export function buildableEnvelope(limits: ZoningLimits | undefined, landSF: number | null | undefined): BuildableEnvelope | null {
  if (!limits || limits.maxCoverage === undefined || limits.maxHeightFt === null || !landSF) return null
  const small = limits.smallLot && landSF <= limits.smallLot.maxLotSF ? limits.smallLot : undefined
  const heightFt = small ? small.maxHeightFt : limits.maxHeightFt
  const stories = Math.floor(heightFt / ENVELOPE_FT_PER_STORY)
  const coverage = limits.maxCoverage
  const smallNote = small ? ` (lot of ${fmt.int(small.maxLotSF)} sf or less)` : ''
  const notes =
    `${fmt.int(landSF)} sf lot × ${fmt.pct(coverage, 0)} max coverage × ${stories} stories ` +
    `(${heightFt} ft${smallNote} ÷ ${ENVELOPE_FT_PER_STORY} ft per story); ${limits.section}`
  return {
    sf: estimate(landSF * coverage * stories, `${ZONING_SOURCE}, ${limits.section}`, { notes }),
    coverage,
    stories,
    heightFt,
  }
}

export interface DevelopmentCapacity {
  heightFt: number
  heightIsEstimate: boolean
  maxHeightFt: number | null
  heightHeadroomFt: number | null
  existingFAR: number | null
  limits: ZoningLimits | undefined
  envelope: BuildableEnvelope | null
  /** Positive = room left in the envelope; negative = exceeds it (likely legal non-conforming). */
  additionalEnvelopeSF: number | null
}

export function developmentCapacity(p: Property): DevelopmentCapacity {
  const measured = p.physical.heightFt?.value
  const heightFt = measured ?? p.physical.floors.value * FT_PER_FLOOR[p.assetType]
  const land = p.physical.landAreaSF?.value ?? null
  const gross = p.physical.grossBuildingSF.value
  const maxHeightFt = p.zoning.maxHeightFt?.value ?? null
  const limits = zoningLimitsFor(p.zoning.district.value)
  const envelope = buildableEnvelope(limits, land)

  return {
    heightFt,
    heightIsEstimate: measured === undefined,
    maxHeightFt,
    heightHeadroomFt: maxHeightFt !== null ? maxHeightFt - heightFt : null,
    existingFAR: land ? gross / land : null,
    limits,
    envelope,
    additionalEnvelopeSF: envelope ? envelope.sf.value - gross : null,
  }
}

/** Shown instead of negative headroom when the building is taller than today's height limit; null otherwise. */
export function heightExceedanceNote(headroomFt: number | null): string | null {
  if (headroomFt === null || headroomFt >= 0) return null
  return `Exceeds current height limit by ${Math.round(-headroomFt)} ft — likely an older building that predates the ordinance (legally nonconforming)`
}
