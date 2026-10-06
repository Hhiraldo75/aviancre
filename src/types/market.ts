import type { AssetType, BuildingClass, LngLat, Pct, Sourced, USD } from './common'
import type { SubmarketTrendPoint } from './context'

/** Providence submarkets used for benchmarks, filters and heatmaps. */
export type SubmarketId =
  | 'downtown'
  | 'capital-center'
  | 'jewelry-district'
  | 'federal-hill'
  | 'fox-point'
  | 'college-hill'
  | 'olneyville'
  | 'valley'
  | 'port-allens-ave'

/**
 * How a rent figure is quoted. Office/retail/industrial are quoted per SF per
 * year; apartments per unit per month. Always store the basis with the number.
 */
export type RentBasis = 'annual-per-sf' | 'monthly-per-unit'

/** Market benchmarks for one asset type within a submarket. */
export interface SubmarketBenchmark {
  rentBasis: RentBasis
  /** Class B baseline rent; class premiums/discounts are applied on top. */
  marketRent: Sourced<USD>
  /** Multipliers on the class B baseline, e.g. { A: 1.2, B: 1, C: 0.82 }. */
  classAdjustment: Record<BuildingClass, number>
  vacancyRate: Sourced<Pct>
  annualRentGrowth: Sourced<Pct>
  marketCapRate: Sourced<Pct>
  /** Operating expenses per SF per year (or per unit per year for multifamily). */
  opexPerYear: Sourced<USD>
}

export interface Submarket {
  id: SubmarketId
  name: string
  center: LngLat
  benchmarks: Partial<Record<AssetType, SubmarketBenchmark>>
  /** Year-by-year history per asset type, oldest first. */
  trends?: Partial<Record<AssetType, SubmarketTrendPoint[]>>
}

/** Capital-markets inputs that can later be fed live from FRED. */
export interface RateEnvironment {
  treasury10Y: Sourced<Pct>
  sofr: Sourced<Pct>
}
