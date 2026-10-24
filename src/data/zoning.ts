import type { Pct } from '../types'

/**
 * Dimensional limits by base zoning district, from the Providence Zoning Ordinance
 * (Ch. 2014-39 No. 513, consolidated through Ord. 2026-35 No. 305, approved July 22, 2026):
 * https://www.providenceri.gov/wp-content/uploads/2026/10/26.07.22-Official-Zoning-Ordinance.pdf
 *
 * The ordinance sets no floor area ratio for any district. Bulk is controlled by height
 * and, in the residential districts only, by maximum building coverage.
 *
 * Keys are spelled as the city's zoning map (Parcel_Zoning_FL layer 12) returns them.
 * Overlay districts (e.g. the TOD Overlay's 70 ft limit, Table 11-2) and height bonuses
 * are not applied.
 */
export const ZONING_SOURCE = 'Providence Zoning Ordinance (amended through July 22, 2026)'

export interface ZoningLimits {
  description: string
  /** null where the ordinance sets no dimensional standards (CD). */
  maxHeightFt: number | null
  maxStories?: number
  /** Maximum building coverage for multi-family and non-residential buildings; absent where the ordinance sets none. */
  maxCoverage?: Pct
  /** Table 4-1: lots of 2,500 sf or less (except rowhouses) get a lower height limit. */
  smallLot?: { maxLotSF: number; maxHeightFt: number; maxStories: number }
  /** Where the height and coverage come from, e.g. "Table 4-1". */
  section: string
  note?: string
}

const SMALL_LOT = { maxLotSF: 2_500, maxHeightFt: 32, maxStories: 2 }

const residential = (description: string, maxHeightFt: number, maxCoverage: Pct, maxStories?: number): ZoningLimits => ({
  description,
  maxHeightFt,
  maxStories,
  maxCoverage,
  smallLot: SMALL_LOT,
  section: 'Table 4-1',
})

const downtown = (maxHeightFt: number): ZoningLimits => ({
  description: 'Downtown',
  maxHeightFt,
  section: '§602.B',
  note: 'Height bonuses of up to 30% are available through Downtown Design Review (§603.D)',
})

const SLIDING_SCALE = 'Lower height near residential districts: 30–40 ft at the lot line, rising 1 ft per 1 ft of setback'

export const ZONING_LIMITS: Record<string, ZoningLimits> = {
  'R-1A': residential('Low density residential', 40, 0.35, 3),
  'R-1': residential('Low density residential', 40, 0.45, 3),
  'R-3': residential('Medium density residential', 45, 0.45, 3),
  'R-4': residential('High density residential', 45, 0.55),
  'R-P': residential('Residential professional', 45, 0.55),
  'C-2': { description: 'General commercial', maxHeightFt: 50, maxStories: 4, section: 'Table 5-1' },
  'C-3': { description: 'Heavy commercial', maxHeightFt: 50, maxStories: 4, section: 'Table 5-1' },
  'D-1-45': downtown(45),
  'D-1-75': downtown(75),
  'D-1-100': downtown(100),
  'D-1-120': downtown(120),
  'D-1-150': downtown(150),
  'D-1-200': downtown(200),
  'D-1-300': downtown(300),
  'D-1-600': downtown(600),
  'I-1-75': { description: 'Healthcare institutional', maxHeightFt: 75, section: 'Table 7-1', note: SLIDING_SCALE },
  'I-1-200': { description: 'Healthcare institutional', maxHeightFt: 200, section: 'Table 7-1', note: SLIDING_SCALE },
  'I-2': { description: 'Educational institutional', maxHeightFt: 75, section: 'Table 7-1', note: SLIDING_SCALE },
  'M-MU-75': { description: 'Mixed-use industrial', maxHeightFt: 75, section: 'Table 8-1' },
  'M-MU-90': { description: 'Mixed-use industrial', maxHeightFt: 90, section: 'Table 8-1' },
  'M-1': { description: 'Light industrial', maxHeightFt: 75, section: 'Table 8-1' },
  'M-2': { description: 'General industrial', maxHeightFt: 90, section: 'Table 8-1' },
  'W-2': { description: 'Mixed-use waterfront', maxHeightFt: 75, section: 'Table 9-1' },
  'W-3': { description: 'Port / maritime industrial waterfront', maxHeightFt: 90, section: 'Table 9-1' },
  OS: { description: 'Open space', maxHeightFt: 50, section: 'Table 10-1' },
  PS: { description: 'Public space', maxHeightFt: 50, section: 'Table 10-1' },
  CD: { description: 'Conservation', maxHeightFt: null, section: '§1002', note: 'No dimensional standards; managed by a Board of Park Commissioners plan (§1003)' },
}
