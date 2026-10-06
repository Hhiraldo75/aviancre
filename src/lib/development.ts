import type { Property } from '../types'

/** Typical floor-to-floor heights used when no measured height exists. */
const FT_PER_FLOOR: Record<Property['assetType'], number> = {
  office: 13,
  'mixed-use': 12,
  multifamily: 10.5,
  retail: 16,
  industrial: 28,
}

export interface DevelopmentCapacity {
  heightFt: number
  heightIsEstimate: boolean
  maxHeightFt: number | null
  heightHeadroomFt: number | null
  existingFAR: number | null
  maxFAR: number | null
  maxBuildableSF: number | null
  /** Positive = unused development rights; negative = exceeds current zoning (legal non-conforming). */
  additionalBuildableSF: number | null
}

export function developmentCapacity(p: Property): DevelopmentCapacity {
  const measured = p.physical.heightFt?.value
  const heightFt = measured ?? p.physical.floors.value * FT_PER_FLOOR[p.assetType]
  const land = p.physical.landAreaSF?.value ?? null
  const gross = p.physical.grossBuildingSF.value
  const maxFAR = p.zoning.maxFAR?.value ?? null
  const maxHeightFt = p.zoning.maxHeightFt?.value ?? null

  const existingFAR = land ? gross / land : null
  const maxBuildableSF = land && maxFAR !== null ? land * maxFAR : null

  return {
    heightFt,
    heightIsEstimate: measured === undefined,
    maxHeightFt,
    heightHeadroomFt: maxHeightFt !== null ? maxHeightFt - heightFt : null,
    existingFAR,
    maxFAR,
    maxBuildableSF,
    additionalBuildableSF: maxBuildableSF !== null ? maxBuildableSF - gross : null,
  }
}
