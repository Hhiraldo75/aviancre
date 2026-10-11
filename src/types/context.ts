import type { AssetType, ISODate, Pct, SF, Sourced, USD } from './common'
import type { SubmarketId } from './market'

/** Annual average daily traffic on a nearby road (RIDOT publishes these counts). */
export interface TrafficCount {
  road: string
  aadt: Sourced<number>
  /** Approximate distance from the property. */
  distanceFt?: number
}

/** Census ACS demographics within a ring around the property. */
export interface DemographicRing {
  radiusMiles: number
  population: Sourced<number>
  households: Sourced<number>
  medianHouseholdIncome: Sourced<USD>
  /** Projected 5-year population growth. */
  populationGrowth5Yr?: Sourced<Pct>
}

/** Location context, most relevant to retail but available for any asset. */
export interface LocationContext {
  trafficCounts: TrafficCount[]
  demographics: DemographicRing[]
  walkScore?: Sourced<number>
}

/** A historical sale used as a comparable. */
export interface SaleComp {
  id: string
  name: string
  assetType: AssetType
  submarket: SubmarketId
  saleDate: ISODate
  price: USD
  /** Rentable SF for commercial; total SF for multifamily. */
  sf: SF
  /** Multifamily only. */
  units?: number
  capRate: Pct
  buyerType?: 'private' | 'institutional' | 'REIT' | 'owner-user'
  source: Sourced<string>
}

/** One year of submarket history for trend charts. */
export interface SubmarketTrendPoint {
  year: number
  /** Same basis as the submarket benchmark (per SF/yr or per unit/mo). */
  marketRent: number
  vacancyRate: Pct
  capRate: Pct
}

/** Dashboard lenses on the same property. */
export type Persona = 'Analyst' | 'Broker' | 'Developer' | 'Investment'

/** Sections of the full underwriting panel. */
export type UnderwritingTab = 'Cash flow' | 'Rent roll' | 'Returns' | 'Assumptions' | 'Analyst memo'
