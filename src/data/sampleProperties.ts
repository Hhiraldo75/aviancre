import type {
  AssetType,
  BuildingClass,
  Escalation,
  Lease,
  LeaseType,
  Property,
  Recovery,
  SubmarketId,
  TenantCredit,
  UnitType,
  VacantSpace,
} from '../types'
import { estimate, estimateWithBand } from '../lib/sourced'
import { marketViewFor } from '../lib/marketView'
import { ZONING_LIMITS, ZONING_SOURCE } from './zoning'

/**
 * SAMPLE DATASET – for development and demos only.
 *
 * - Property names, tenants and every financial figure are fictional.
 * - Locations are approximate points inside real Providence submarkets, not
 *   geocoded addresses. Next step: replace them with real parcels from the
 *   Providence assessor / RIGIS and keep these as "sample" overlays.
 * - Zoning districts are plausible guesses and must be verified against the
 *   City of Providence zoning map.
 */

const SAMPLE = 'Sample placeholder'
const SAMPLE_RENT_ROLL = 'Sample rent roll (fictional tenants)'

// ---------- small builders to keep the dataset readable ----------

interface LeaseInput {
  tenant: string
  suite: string
  sf: number
  start: string
  end: string
  rent: number
  esc: Escalation
  type: LeaseType
  recovery: Recovery
  credit?: TenantCredit
  industry?: string
  freeRentMonths?: number
  tiPerSF?: number
  renewalOptions?: Lease['renewalOptions']
  floors?: number[]
}

function lease(propertyId: string, i: number, l: LeaseInput): Lease {
  return {
    id: `${propertyId}-L${i + 1}`,
    tenantName: l.tenant,
    suite: l.suite,
    leasedSF: l.sf,
    floors: l.floors,
    industry: l.industry,
    commencementDate: l.start,
    expirationDate: l.end,
    startingRentPerSF: l.rent,
    escalation: l.esc,
    leaseType: l.type,
    recovery: l.recovery,
    freeRentMonths: l.freeRentMonths,
    tiPerSF: l.tiPerSF,
    renewalOptions: l.renewalOptions,
    credit: l.credit,
    source: 'estimated',
    sourceName: SAMPLE_RENT_ROLL,
  }
}

function leases(propertyId: string, list: LeaseInput[]): Lease[] {
  return list.map((l, i) => lease(propertyId, i, l))
}

function vacant(
  propertyId: string,
  i: number,
  suite: string,
  sf: number,
  leaseUpMonths = 12,
  floors?: number[],
): VacantSpace {
  return { id: `${propertyId}-V${i + 1}`, suite, sf, floors, expectedLeaseUpMonths: leaseUpMonths }
}

const pct = (annualPct: number): Escalation => ({ type: 'fixed-percent', annualPct })
const perSF = (annualPerSF: number): Escalation => ({ type: 'fixed-amount', annualPerSF })
const baseYear = (year: number): Recovery => ({ method: 'base-year', baseYear: year })
const NET: Recovery = { method: 'net', adminFeePct: 0.1 }

interface PropertyInput {
  id: string
  name: string
  assetType: AssetType
  cls: BuildingClass
  submarket: SubmarketId
  lng: number
  lat: number
  grossSF: number
  rentableSF: number
  yearBuilt: number
  yearRenovated?: number
  floors: number
  zoning: string
  landAreaSF: number
  assessedValue: number
  floodZone?: string
  extras?: Partial<Property['physical']>
  rentRoll: Property['rentRoll']
  locationContext?: Property['locationContext']
  tags?: string[]
  /** Multifamily: weighted average market rent per unit, overrides the benchmark. */
  marketRentOverride?: number
}

function property(p: PropertyInput): Property {
  const market = marketViewFor(p.submarket, p.assetType, p.cls)
  if (p.marketRentOverride !== undefined) {
    market.marketRent = estimateWithBand(p.marketRentOverride, 'Weighted average of unit-type market rents', 0.1)
  }

  return {
    id: p.id,
    name: p.name,
    assetType: p.assetType,
    buildingClass: p.cls,
    location: {
      address: `Sample location – ${p.submarket.replace(/-/g, ' ')}`,
      city: 'Providence',
      state: 'RI',
      lng: p.lng,
      lat: p.lat,
      submarket: p.submarket,
      isApproximate: true,
    },
    physical: {
      grossBuildingSF: estimate(p.grossSF, SAMPLE),
      rentableSF: estimate(p.rentableSF, SAMPLE),
      yearBuilt: estimate(p.yearBuilt, SAMPLE),
      yearRenovated: p.yearRenovated !== undefined ? estimate(p.yearRenovated, SAMPLE) : undefined,
      floors: estimate(p.floors, SAMPLE),
      landAreaSF: estimate(p.landAreaSF, SAMPLE),
      ...p.extras,
    },
    zoning: {
      district: estimate(p.zoning, SAMPLE, { notes: 'Verify against Providence zoning map' }),
      maxHeightFt: zoningLimit(p.zoning, 'maxHeightFt'),
      maxFAR: zoningLimit(p.zoning, 'maxFAR'),
      floodZone: p.floodZone !== undefined ? estimate(p.floodZone, SAMPLE, { notes: 'Verify against FEMA NFHL' }) : undefined,
    },
    valuation: {
      assessedValue: estimateWithBand(p.assessedValue, SAMPLE, 0.15),
    },
    market,
    rentRoll: p.rentRoll,
    locationContext: p.locationContext,
    tags: p.tags,
    isSample: true,
  }
}

function zoningLimit(district: string, key: 'maxHeightFt' | 'maxFAR') {
  const limits = ZONING_LIMITS[district]
  return limits ? estimate(limits[key], ZONING_SOURCE, { notes: limits.description }) : undefined
}

/** Builds placeholder traffic + demographic context; replace with RIDOT counts and Census ACS. */
function context(
  traffic: [road: string, aadt: number, distanceFt: number][],
  rings: [miles: number, population: number, households: number, medianIncome: number, growth5Yr: number][],
  walkScore: number,
): Property['locationContext'] {
  const TRAFFIC_SRC = 'Placeholder – replace with RIDOT traffic counts'
  const ACS_SRC = 'Placeholder – replace with Census ACS 5-year estimates'
  return {
    trafficCounts: traffic.map(([road, aadt, distanceFt]) => ({ road, aadt: estimate(aadt, TRAFFIC_SRC), distanceFt })),
    demographics: rings.map(([radiusMiles, pop, hh, inc, growth]) => ({
      radiusMiles,
      population: estimate(pop, ACS_SRC),
      households: estimate(hh, ACS_SRC),
      medianHouseholdIncome: estimate(inc, ACS_SRC),
      populationGrowth5Yr: estimate(growth, ACS_SRC),
    })),
    walkScore: estimate(walkScore, 'Placeholder – replace with Walk Score API'),
  }
}

function unitType(
  id: string,
  label: string,
  unitCount: number,
  occupiedUnits: number,
  avgSF: number,
  marketRent: number,
  inPlaceRent: number,
): UnitType {
  return {
    id,
    label,
    unitCount,
    occupiedUnits,
    avgSF,
    marketRentMonthly: estimateWithBand(marketRent, SAMPLE, 0.1),
    inPlaceRentMonthly: estimate(inPlaceRent, SAMPLE_RENT_ROLL),
  }
}

// ---------- the dataset ----------

export const SAMPLE_PROPERTIES: Property[] = [
  // ---------------- OFFICE ----------------
  property({
    id: 'sample-westminster-tower',
    name: 'Westminster Office Tower (Sample)',
    assetType: 'office',
    cls: 'A',
    submarket: 'downtown',
    lng: -71.4112,
    lat: 41.8246,
    grossSF: 345_000,
    rentableSF: 320_000,
    yearBuilt: 1985,
    yearRenovated: 2016,
    floors: 20,
    zoning: 'D-1',
    landAreaSF: 21_000,
    assessedValue: 38_000_000,
    extras: { parkingSpaces: estimate(180, SAMPLE) },
    tags: ['multi-tenant', 'full-service'],
    rentRoll: {
      kind: 'commercial',
      leases: leases('sample-westminster-tower', [
        { tenant: 'Weybridge Insurance Services', suite: 'Fl 14–18', floors: [14, 15, 16, 17, 18], sf: 95_000, start: '2019-01-01', end: '2029-12-31', rent: 26.0, esc: pct(0.025), type: 'full-service-gross', recovery: baseYear(2019), credit: 'national', industry: 'Insurance' },
        { tenant: 'Meridian Health Administration', suite: 'Fl 5–7', floors: [5, 6, 7], sf: 55_000, start: '2020-01-01', end: '2028-03-31', rent: 25.5, esc: pct(0.025), type: 'full-service-gross', recovery: baseYear(2020), credit: 'national', industry: 'Healthcare' },
        { tenant: 'Harborline Legal Partners', suite: 'Fl 19–20', floors: [19, 20], sf: 42_000, start: '2021-06-01', end: '2031-05-31', rent: 27.5, esc: pct(0.025), type: 'full-service-gross', recovery: baseYear(2021), credit: 'regional', industry: 'Legal', freeRentMonths: 6, tiPerSF: 60 },
        { tenant: 'Kestrel Analytics', suite: 'Fl 10–11', floors: [10, 11], sf: 28_500, start: '2018-03-01', end: '2027-02-28', rent: 24.0, esc: perSF(0.5), type: 'full-service-gross', recovery: baseYear(2018), credit: 'local', industry: 'Technology' },
        { tenant: 'Larkfield Architects', suite: 'Fl 2', floors: [2], sf: 16_000, start: '2023-09-01', end: '2030-08-31', rent: 27.0, esc: pct(0.03), type: 'full-service-gross', recovery: baseYear(2023), credit: 'local', industry: 'Professional services', freeRentMonths: 4, tiPerSF: 45 },
        { tenant: 'Cobblestone Community Bank', suite: 'Ground', floors: [1], sf: 12_000, start: '2016-07-01', end: '2026-12-31', rent: 30.0, esc: pct(0.02), type: 'full-service-gross', recovery: baseYear(2016), credit: 'regional', industry: 'Banking' },
      ]),
      vacancies: [
        vacant('sample-westminster-tower', 0, 'Fl 3–4', 24_000, 18, [3, 4]),
        vacant('sample-westminster-tower', 1, 'Fl 8–9', 24_000, 15, [8, 9]),
        vacant('sample-westminster-tower', 2, 'Fl 12–13', 23_500, 12, [12, 13]),
      ],
    },
  }),

  property({
    id: 'sample-weybosset-commons',
    name: 'Weybosset Commons (Sample)',
    assetType: 'office',
    cls: 'B',
    submarket: 'downtown',
    lng: -71.4138,
    lat: 41.8227,
    grossSF: 92_000,
    rentableSF: 85_000,
    yearBuilt: 1925,
    yearRenovated: 2008,
    floors: 8,
    zoning: 'D-1',
    landAreaSF: 12_000,
    assessedValue: 7_200_000,
    tags: ['multi-tenant', 'historic', 'value-add'],
    rentRoll: {
      kind: 'commercial',
      leases: leases('sample-weybosset-commons', [
        { tenant: 'Fieldstone Engineering', suite: '500–600', floors: [5, 6], sf: 22_000, start: '2020-05-01', end: '2027-04-30', rent: 21.0, esc: pct(0.025), type: 'full-service-gross', recovery: baseYear(2020), credit: 'local', industry: 'Engineering' },
        { tenant: 'Granite Row Software', suite: '700–800', floors: [7, 8], sf: 18_000, start: '2021-10-01', end: '2026-12-31', rent: 19.75, esc: pct(0.025), type: 'full-service-gross', recovery: baseYear(2021), credit: 'local', industry: 'Technology' },
        { tenant: 'Tidewater Staffing', suite: '200', floors: [2], sf: 9_500, start: '2022-02-01', end: '2027-01-31', rent: 20.5, esc: pct(0.03), type: 'full-service-gross', recovery: baseYear(2022), credit: 'local', industry: 'Staffing' },
        { tenant: 'Bridgeway Counseling Associates', suite: '400', floors: [4], sf: 7_800, start: '2024-01-01', end: '2029-12-31', rent: 22.0, esc: pct(0.03), type: 'full-service-gross', recovery: baseYear(2024), credit: 'local', industry: 'Healthcare', freeRentMonths: 3, tiPerSF: 30 },
        { tenant: 'Mainline Title Co.', suite: '100', floors: [1], sf: 6_200, start: '2019-08-01', end: '2028-07-31', rent: 20.0, esc: perSF(0.5), type: 'full-service-gross', recovery: baseYear(2019), credit: 'regional', industry: 'Real estate services' },
      ]),
      vacancies: [
        vacant('sample-weybosset-commons', 0, '300', 11_000, 12, [3]),
        vacant('sample-weybosset-commons', 1, '450', 10_500, 15, [4]),
      ],
    },
  }),

  property({
    id: 'sample-capital-center-plaza',
    name: 'Capital Center Plaza (Sample)',
    assetType: 'office',
    cls: 'A',
    submarket: 'capital-center',
    lng: -71.4142,
    lat: 41.8296,
    grossSF: 196_000,
    rentableSF: 180_000,
    yearBuilt: 2004,
    floors: 12,
    zoning: 'D-1',
    landAreaSF: 45_000,
    assessedValue: 42_000_000,
    extras: { parkingSpaces: estimate(320, SAMPLE) },
    tags: ['multi-tenant', 'trophy'],
    rentRoll: {
      kind: 'commercial',
      leases: leases('sample-capital-center-plaza', [
        {
          tenant: 'Atlantic Coast Insurance Holdings', suite: 'Fl 2–6', floors: [2, 3, 4, 5, 6], sf: 70_000, start: '2017-01-01', end: '2032-12-31', rent: 31.0, esc: pct(0.0225), type: 'full-service-gross', recovery: baseYear(2017), credit: 'investment-grade', industry: 'Insurance',
          renewalOptions: [
            { termMonths: 60, rentBasis: 'percent-of-market', value: 0.95, noticeMonths: 12 },
            { termMonths: 60, rentBasis: 'percent-of-market', value: 0.95, noticeMonths: 12 },
          ],
        },
        { tenant: 'Halsey & Ward LLP', suite: 'Fl 10–11', floors: [10, 11], sf: 38_000, start: '2022-04-01', end: '2032-03-31', rent: 33.0, esc: pct(0.025), type: 'full-service-gross', recovery: baseYear(2022), credit: 'regional', industry: 'Legal', freeRentMonths: 8, tiPerSF: 75 },
        { tenant: 'Northgate Consulting', suite: 'Fl 7', floors: [7], sf: 24_000, start: '2019-09-01', end: '2027-08-31', rent: 30.5, esc: pct(0.025), type: 'full-service-gross', recovery: baseYear(2019), credit: 'national', industry: 'Consulting' },
        { tenant: 'Capstone Wealth Partners', suite: 'Fl 12', floors: [12], sf: 15_000, start: '2021-01-01', end: '2028-12-31', rent: 32.0, esc: pct(0.0275), type: 'full-service-gross', recovery: baseYear(2021), credit: 'regional', industry: 'Financial services' },
      ]),
      vacancies: [
        vacant('sample-capital-center-plaza', 0, 'Fl 9', 18_000, 12, [9]),
        vacant('sample-capital-center-plaza', 1, 'Fl 8', 15_000, 9, [8]),
      ],
    },
  }),

  property({
    id: 'sample-innovation-lab',
    name: 'Innovation Lab Building (Sample)',
    assetType: 'office',
    cls: 'A',
    submarket: 'jewelry-district',
    lng: -71.4079,
    lat: 41.8178,
    grossSF: 132_000,
    rentableSF: 120_000,
    yearBuilt: 2019,
    floors: 6,
    zoning: 'D-1',
    landAreaSF: 30_000,
    assessedValue: 48_000_000,
    tags: ['life-science', 'NNN'],
    rentRoll: {
      kind: 'commercial',
      leases: leases('sample-innovation-lab', [
        { tenant: 'Helix Therapeutics', suite: 'Fl 1–3', floors: [1, 2, 3], sf: 52_000, start: '2020-07-01', end: '2030-06-30', rent: 38.0, esc: pct(0.03), type: 'NNN', recovery: NET, credit: 'national', industry: 'Life science', tiPerSF: 150 },
        { tenant: 'Coastal Robotics Lab', suite: 'Fl 5', floors: [5], sf: 26_000, start: '2022-01-01', end: '2029-12-31', rent: 36.5, esc: pct(0.03), type: 'NNN', recovery: NET, credit: 'regional', industry: 'Robotics', tiPerSF: 90 },
        { tenant: 'Vireo Diagnostics', suite: 'Fl 6', floors: [6], sf: 18_000, start: '2023-05-01', end: '2028-04-30', rent: 39.0, esc: pct(0.03), type: 'NNN', recovery: NET, credit: 'local', industry: 'Life science', freeRentMonths: 6, tiPerSF: 120 },
      ]),
      vacancies: [vacant('sample-innovation-lab', 0, 'Fl 4', 24_000, 15, [4])],
    },
  }),

  // ---------------- RETAIL ----------------
  property({
    id: 'sample-atwells-retail-row',
    name: 'Atwells Retail Row (Sample)',
    assetType: 'retail',
    cls: 'B',
    submarket: 'federal-hill',
    lng: -71.4262,
    lat: 41.8236,
    grossSF: 19_500,
    rentableSF: 18_000,
    yearBuilt: 1910,
    yearRenovated: 2014,
    floors: 3,
    zoning: 'C-2',
    landAreaSF: 7_500,
    assessedValue: 4_300_000,
    tags: ['street retail', 'restaurant'],
    locationContext: context(
      [['Atwells Ave', 12_000, 0], ['Broadway', 9_500, 900], ['Route 6 / 10 connector', 98_000, 2_600]],
      [[1, 41_000, 16_500, 52_000, 0.021], [3, 205_000, 78_000, 61_000, 0.018], [5, 385_000, 148_000, 68_000, 0.015]],
      94,
    ),
    rentRoll: {
      kind: 'commercial',
      leases: leases('sample-atwells-retail-row', [
        {
          tenant: 'Casa Lucenti Trattoria', suite: '101', sf: 4_200, start: '2015-03-01', end: '2030-02-28', rent: 24.0, esc: pct(0.03), type: 'NNN', recovery: NET, credit: 'local', industry: 'Restaurant',
          renewalOptions: [{ termMonths: 60, rentBasis: 'fixed', value: 30.0, noticeMonths: 9 }],
        },
        { tenant: 'Hill Street Wine & Spirits', suite: '103', sf: 3_500, start: '2021-01-01', end: '2027-12-31', rent: 21.0, esc: pct(0.03), type: 'NNN', recovery: NET, credit: 'local', industry: 'Retail' },
        { tenant: 'Cobblestone Community Bank', suite: '105', sf: 3_000, start: '2018-04-01', end: '2028-03-31', rent: 26.0, esc: pct(0.02), type: 'NNN', recovery: NET, credit: 'regional', industry: 'Banking' },
        { tenant: 'Bellamonte Bakery', suite: '102', sf: 2_800, start: '2019-06-01', end: '2029-05-31', rent: 23.0, esc: perSF(0.5), type: 'NNN', recovery: NET, credit: 'local', industry: 'Food & beverage' },
      ]),
      vacancies: [vacant('sample-atwells-retail-row', 0, '200', 4_500, 9)],
    },
  }),

  property({
    id: 'sample-thayer-shops',
    name: 'Thayer Street Shops (Sample)',
    assetType: 'retail',
    cls: 'B',
    submarket: 'college-hill',
    lng: -71.4010,
    lat: 41.8284,
    grossSF: 13_500,
    rentableSF: 12_500,
    yearBuilt: 1948,
    yearRenovated: 2011,
    floors: 2,
    zoning: 'C-1',
    landAreaSF: 8_000,
    assessedValue: 4_600_000,
    tags: ['street retail', 'student-driven'],
    locationContext: context(
      [['Thayer St', 8_500, 0], ['Angell St', 11_000, 300], ['I-195', 120_000, 4_200]],
      [[1, 36_000, 11_800, 71_000, 0.012], [3, 198_000, 76_000, 64_000, 0.016], [5, 372_000, 145_000, 70_000, 0.014]],
      96,
    ),
    rentRoll: {
      kind: 'commercial',
      leases: leases('sample-thayer-shops', [
        { tenant: 'Campus Outfitters', suite: 'A', sf: 4_000, start: '2017-08-01', end: '2027-07-31', rent: 30.0, esc: pct(0.025), type: 'NNN', recovery: NET, credit: 'regional', industry: 'Apparel' },
        { tenant: 'Northbound Coffee Co.', suite: 'B', sf: 2_500, start: '2020-09-01', end: '2030-08-31', rent: 38.0, esc: pct(0.02), type: 'NNN', recovery: NET, credit: 'national', industry: 'Food & beverage' },
        { tenant: 'Lotus Noodle House', suite: 'C', sf: 2_200, start: '2022-03-01', end: '2032-02-29', rent: 34.0, esc: pct(0.03), type: 'NNN', recovery: NET, credit: 'local', industry: 'Restaurant', freeRentMonths: 3 },
        { tenant: 'Brightside Optometry', suite: 'D', sf: 1_800, start: '2021-05-01', end: '2026-11-30', rent: 31.0, esc: pct(0.03), type: 'NNN', recovery: NET, credit: 'local', industry: 'Medical retail' },
      ]),
      vacancies: [vacant('sample-thayer-shops', 0, 'E', 2_000, 6)],
    },
  }),

  // ---------------- INDUSTRIAL ----------------
  property({
    id: 'sample-olneyville-distribution',
    name: 'Olneyville Distribution Center (Sample)',
    assetType: 'industrial',
    cls: 'B',
    submarket: 'olneyville',
    lng: -71.4448,
    lat: 41.8178,
    grossSF: 145_000,
    rentableSF: 145_000,
    yearBuilt: 1968,
    yearRenovated: 2005,
    floors: 1,
    zoning: 'M-1',
    landAreaSF: 392_000,
    assessedValue: 15_200_000,
    extras: {
      clearHeightFt: estimate(24, SAMPLE),
      loadingDocks: estimate(14, SAMPLE),
    },
    tags: ['single-tenant', 'below-market lease'],
    rentRoll: {
      kind: 'commercial',
      leases: leases('sample-olneyville-distribution', [
        {
          tenant: 'Mill River Logistics', suite: 'Entire', sf: 145_000, start: '2019-01-01', end: '2028-12-31', rent: 7.25, esc: pct(0.03), type: 'NNN', recovery: NET, credit: 'national', industry: 'Logistics',
          renewalOptions: [{ termMonths: 60, rentBasis: 'percent-of-market', value: 0.95, noticeMonths: 12 }],
        },
      ]),
      vacancies: [],
    },
  }),

  property({
    id: 'sample-allens-ave-flex',
    name: 'Allens Ave Flex Industrial (Sample)',
    assetType: 'industrial',
    cls: 'B',
    submarket: 'port-allens-ave',
    lng: -71.4048,
    lat: 41.8031,
    grossSF: 62_000,
    rentableSF: 62_000,
    yearBuilt: 1985,
    floors: 1,
    zoning: 'W-3',
    landAreaSF: 165_000,
    floodZone: 'AE',
    assessedValue: 6_000_000,
    extras: {
      clearHeightFt: estimate(20, SAMPLE),
      loadingDocks: estimate(6, SAMPLE),
    },
    tags: ['multi-tenant', 'flex', 'waterfront'],
    rentRoll: {
      kind: 'commercial',
      leases: leases('sample-allens-ave-flex', [
        { tenant: 'Harbor Marine Supply', suite: '1', sf: 28_000, start: '2018-06-01', end: '2027-05-31', rent: 8.0, esc: perSF(0.25), type: 'NNN', recovery: NET, credit: 'regional', industry: 'Marine distribution' },
        { tenant: 'Ironbound Fabrication', suite: '2', sf: 18_000, start: '2021-03-01', end: '2026-12-31', rent: 8.75, esc: pct(0.03), type: 'NNN', recovery: NET, credit: 'local', industry: 'Manufacturing' },
        { tenant: 'Quayside Brewing Co.', suite: '3', sf: 9_000, start: '2023-01-01', end: '2032-12-31', rent: 9.5, esc: pct(0.03), type: 'NNN', recovery: NET, credit: 'local', industry: 'Food & beverage', freeRentMonths: 4, tiPerSF: 15 },
      ]),
      vacancies: [vacant('sample-allens-ave-flex', 0, '4', 7_000, 6)],
    },
  }),

  // ---------------- MULTIFAMILY ----------------
  property({
    id: 'sample-jewelry-lofts',
    name: 'Jewelry District Lofts (Sample)',
    assetType: 'multifamily',
    cls: 'A',
    submarket: 'jewelry-district',
    lng: -71.4098,
    lat: 41.8193,
    grossSF: 132_000,
    rentableSF: 113_000,
    yearBuilt: 1910,
    yearRenovated: 2015,
    floors: 6,
    zoning: 'D-1',
    landAreaSF: 24_000,
    assessedValue: 36_000_000,
    extras: { unitCount: estimate(140, SAMPLE), parkingSpaces: estimate(90, SAMPLE) },
    tags: ['loft conversion', 'historic tax credits'],
    marketRentOverride: 2343,
    rentRoll: {
      kind: 'multifamily',
      unitTypes: [
        unitType('studio', 'Studio', 30, 28, 550, 1750, 1680),
        unitType('1br', '1BR / 1BA', 70, 67, 750, 2250, 2150),
        unitType('2br', '2BR / 2BA', 40, 38, 1100, 2950, 2850),
      ],
      otherIncomePerUnitMonthly: estimate(85, SAMPLE, { notes: 'Parking, pet, storage' }),
    },
  }),

  property({
    id: 'sample-federal-hill-apartments',
    name: 'Federal Hill Apartments (Sample)',
    assetType: 'multifamily',
    cls: 'B',
    submarket: 'federal-hill',
    lng: -71.4291,
    lat: 41.8219,
    grossSF: 42_000,
    rentableSF: 35_700,
    yearBuilt: 1925,
    yearRenovated: 2012,
    floors: 4,
    zoning: 'R-3',
    landAreaSF: 14_000,
    assessedValue: 7_400_000,
    extras: { unitCount: estimate(48, SAMPLE) },
    tags: ['walk-up', 'loss-to-lease'],
    marketRentOverride: 1800,
    rentRoll: {
      kind: 'multifamily',
      unitTypes: [
        unitType('1br', '1BR / 1BA', 30, 29, 650, 1650, 1525),
        unitType('2br', '2BR / 1BA', 18, 17, 900, 2050, 1925),
      ],
      otherIncomePerUnitMonthly: estimate(40, SAMPLE, { notes: 'Laundry, storage' }),
    },
  }),
]
