import type {
  AssetType,
  BuildingClass,
  ISODate,
  LngLat,
  Pct,
  SF,
  Sourced,
  USD,
} from './common'
import type { LocationContext } from './context'
import type { RentRoll } from './lease'
import type { RentBasis, SubmarketId } from './market'

export interface PropertyLocation {
  address: string
  city: string
  state: string
  zip?: string
  lng: number
  lat: number
  submarket: SubmarketId
  /** Assessor parcel ID (plat/lot in Providence); links to public records. */
  parcelId?: string
  /** True when coordinates are a placeholder, not a geocoded address. */
  isApproximate: boolean
  /** An imported deal placed on a real city parcel; absent = approximate (submarket center). */
  placement?: DealPlacement
}

/** Where an imported deal was put on the map, and how. */
export interface DealPlacement {
  /** City parcel PIN (plat/lot). */
  pin: string
  /** The parcel's address as the city records it, shown so the analyst can confirm the match. */
  cityAddress: string
  /** Matched from the rent roll's address, picked in the search, or clicked on the map. */
  method: 'address' | 'search' | 'click'
  placedAt: ISODate
  /** The OpenStreetMap building on the parcel, or the parcel outline when there was none. */
  outlineFrom: 'osm' | 'parcel'
  /** The OSM building's height from the map tiles; only raises the drawn building. */
  heightM?: number
}

export interface PhysicalCharacteristics {
  grossBuildingSF: Sourced<SF>
  /** Leasable area; the denominator for occupancy and rent per SF. */
  rentableSF: Sourced<SF>
  landAreaSF?: Sourced<SF>
  /** Omitted when unknown (e.g. an imported rent roll). */
  yearBuilt?: Sourced<number>
  yearRenovated?: Sourced<number>
  floors: Sourced<number>
  heightFt?: Sourced<number>
  parkingSpaces?: Sourced<number>
  /** Multifamily only. */
  unitCount?: Sourced<number>
  /** Industrial only. */
  clearHeightFt?: Sourced<number>
  loadingDocks?: Sourced<number>
  /** Real building outline (closed ring of [lng, lat]); the map extrudes this instead of a placeholder square. */
  footprint?: Sourced<LngLat[]>
}

export interface ZoningInfo {
  district: Sourced<string>
  maxHeightFt?: Sourced<number>
  /** Maximum building coverage, where the ordinance sets one (residential districts). */
  maxCoverage?: Sourced<Pct>
  /** FEMA flood zone designation, e.g. "X", "AE". */
  floodZone?: Sourced<string>
  opportunityZone?: Sourced<boolean>
  historicDistrict?: Sourced<boolean>
}

export interface Valuation {
  /** Omitted when unknown (e.g. an imported rent roll). */
  assessedValue?: Sourced<USD>
  assessmentYear?: number
  lastSalePrice?: Sourced<USD>
  lastSaleDate?: Sourced<ISODate>
  owner?: Sourced<string>
}

/** Market-level metrics resolved for this specific property. */
export interface PropertyMarketView {
  rentBasis: RentBasis
  /** Estimated market rent for this building (after class/location adjustments). */
  marketRent: Sourced<USD>
  marketVacancy: Sourced<Pct>
  marketCapRate: Sourced<Pct>
  opexPerYear: Sourced<USD>
}

export interface Property {
  id: string
  name: string
  assetType: AssetType
  buildingClass: BuildingClass
  location: PropertyLocation
  physical: PhysicalCharacteristics
  zoning: ZoningInfo
  valuation: Valuation
  market: PropertyMarketView
  rentRoll: RentRoll
  /** Traffic, demographics and walkability around the site. */
  locationContext?: LocationContext
  tags?: string[]
  /** True for demo data. The UI should badge these clearly. */
  isSample: boolean
  /** Set when the rent roll was imported from a file: a private deal, kept in the browser or private-deals/. */
  importedFrom?: { fileName: string; importedAt: ISODate }
}
