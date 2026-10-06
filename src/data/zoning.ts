/**
 * PLACEHOLDER dimensional limits by zoning district.
 *
 * These numbers are illustrative only. Real limits vary by sub-district,
 * overlay and bonus provisions. Replace them with values from the Providence
 * Zoning Ordinance and the city's zoning map before relying on any
 * development-capacity output.
 */
export const ZONING_SOURCE = 'Placeholder – verify against Providence Zoning Ordinance'

export interface ZoningLimits {
  description: string
  maxHeightFt: number
  maxFAR: number
}

export const ZONING_LIMITS: Record<string, ZoningLimits> = {
  'D-1': { description: 'Downtown', maxHeightFt: 150, maxFAR: 8 },
  'C-1': { description: 'Limited commercial', maxHeightFt: 50, maxFAR: 2 },
  'C-2': { description: 'General commercial', maxHeightFt: 70, maxFAR: 3 },
  'M-1': { description: 'Light industrial', maxHeightFt: 75, maxFAR: 2 },
  'W-3': { description: 'Port / maritime industrial waterfront', maxHeightFt: 60, maxFAR: 1.5 },
  'R-3': { description: 'Three-family residential', maxHeightFt: 45, maxFAR: 1.5 },
}
