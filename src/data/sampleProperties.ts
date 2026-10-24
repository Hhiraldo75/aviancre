import type {
  ApartmentUnit,
  AssetType,
  BuildingClass,
  Escalation,
  Lease,
  LeaseType,
  MultifamilyRentRoll,
  Property,
  Recovery,
  SubmarketId,
  TenantCredit,
  UnitType,
  VacantSpace,
} from '../types'
import fernhillCsv from '../../docs/samples/fernhill-commons-unit-rent-roll.csv?raw'
import { parseCSV } from '../lib/csv'
import { estimate, estimateWithBand, fromPublic } from '../lib/sourced'
import { marketViewFor } from '../lib/marketView'
import { parseRentRoll } from '../lib/rentRollImport'
import { OSM_AS_OF, OSM_SOURCE, SAMPLE_FOOTPRINTS } from './sampleFootprints'
import { ZONING_LIMITS, ZONING_SOURCE } from './zoning'

/**
 * SAMPLE DATASET – for development and demos only.
 *
 * - Each sample sits on a REAL Providence parcel: address, ZIP, tax map and
 *   coordinates come from the Providence Open Data 2025 Property Tax Roll.
 * - Everything else is fictional: property names, tenants, leases, rents,
 *   market figures, building size, floors, year built and assessed value.
 *   They do not describe the real building at that address. Names are
 *   invented and never use the real owner's name.
 * - Building outline, floors and height come from OpenStreetMap when OSM has
 *   them (see sampleFootprints.ts). Gross SF is the OSM footprint × floors;
 *   rentable SF and every lease, vacancy and unit count were rescaled from the
 *   original sample to fit that size. Fernhill Commons is the exception: its
 *   units come from the public sample rent roll in docs/samples, unchanged,
 *   so its rentable SF is the units' total.
 * - Zoning districts are the city zoning map's code at each point (checked
 *   2026-10-23); height and coverage limits come from the ordinance via zoning.ts.
 */

const SAMPLE = 'Sample placeholder'
const OSM_SIZE = 'Estimated: OpenStreetMap footprint × floors'
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
  /** Real address, ZIP, tax map and point from the 2025 tax roll. */
  address: string
  zip: string
  parcelId: string
  lng: number
  lat: number
  grossSF: number
  rentableSF: number
  /** Where rentable SF comes from, when not the OSM footprint (or a placeholder). */
  rentableSFSource?: string
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
  const fp = SAMPLE_FOOTPRINTS[p.id]
  if (fp?.levels !== undefined && fp.levels !== p.floors) {
    throw new Error(`${p.id}: floors (${p.floors}) must match OpenStreetMap levels (${fp.levels})`)
  }
  const osmSource = fp ? `${OSM_SOURCE} – way ${fp.osmWayId}` : OSM_SOURCE
  if (p.marketRentOverride !== undefined) {
    market.marketRent = estimateWithBand(p.marketRentOverride, 'Weighted average of unit-type market rents', 0.1)
  }

  return {
    id: p.id,
    name: p.name,
    assetType: p.assetType,
    buildingClass: p.cls,
    location: {
      address: p.address,
      city: 'Providence',
      state: 'RI',
      zip: p.zip,
      lng: p.lng,
      lat: p.lat,
      submarket: p.submarket,
      parcelId: p.parcelId,
      isApproximate: false,
    },
    physical: {
      grossBuildingSF: estimate(p.grossSF, fp ? OSM_SIZE : SAMPLE),
      rentableSF: estimate(p.rentableSF, p.rentableSFSource ?? (fp ? `${OSM_SIZE}, × sample efficiency ratio` : SAMPLE)),
      yearBuilt: estimate(p.yearBuilt, SAMPLE),
      yearRenovated: p.yearRenovated !== undefined ? estimate(p.yearRenovated, SAMPLE) : undefined,
      floors: fp?.levels !== undefined ? fromPublic(fp.levels, osmSource, OSM_AS_OF) : estimate(p.floors, SAMPLE),
      heightFt: fp?.heightM !== undefined ? fromPublic(Math.round(fp.heightM * 3.28084), osmSource, OSM_AS_OF) : undefined,
      landAreaSF: estimate(p.landAreaSF, SAMPLE),
      footprint: fp ? fromPublic(fp.ring, osmSource, OSM_AS_OF) : undefined,
      ...p.extras,
    },
    zoning: {
      district: estimate(p.zoning, SAMPLE, { notes: 'Matches the city zoning map at this point (checked 2026-10-23)' }),
      maxHeightFt: zoningLimit(p.zoning, 'maxHeightFt'),
      maxCoverage: zoningLimit(p.zoning, 'maxCoverage'),
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

function zoningLimit(district: string, key: 'maxHeightFt' | 'maxCoverage') {
  const limits = ZONING_LIMITS[district]
  const value = limits?.[key]
  return limits && value != null ? fromPublic(value, `${ZONING_SOURCE}, ${limits.section}`) : undefined
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

type UnitRentRoll = MultifamilyRentRoll & { units: ApartmentUnit[] }

/**
 * A unit-level rent roll read from a CSV in the unit rent roll format, with
 * the import's own parser. Every unit keeps its lease dates and rents, so the
 * engine models it unit by unit; the unit mix is relabeled as sample figures,
 * like `unitType()`, since the rents are invented, not imported.
 */
function sampleUnitRentRoll(csv: string, fileName: string, asOf: string): UnitRentRoll {
  const { property, issues } = parseRentRoll(parseCSV(csv), { fileName, asOf })
  const rr = property?.rentRoll
  if (rr?.kind !== 'multifamily' || !rr.units) {
    const errors = issues.filter((i) => i.severity === 'error').map((i) => i.message)
    throw new Error(`${fileName} is not a valid unit rent roll: ${errors.join(' ') || 'no units'}`)
  }
  return {
    kind: 'multifamily',
    unitTypes: rr.unitTypes.map((u) => ({
      ...u,
      marketRentMonthly: estimateWithBand(u.marketRentMonthly.value, SAMPLE, 0.1),
      inPlaceRentMonthly: u.inPlaceRentMonthly && estimate(u.inPlaceRentMonthly.value, SAMPLE_RENT_ROLL),
    })),
    units: rr.units,
    otherIncomePerUnitMonthly: rr.otherIncomePerUnitMonthly && estimate(rr.otherIncomePerUnitMonthly.value, SAMPLE_RENT_ROLL),
  }
}

/** Average market rent per unit, to the cent, as the import computes it. */
const averageMarketRent = (units: ApartmentUnit[]) => Math.round((units.reduce((s, u) => s + u.marketRentMonthly, 0) / units.length) * 100) / 100

const FERNHILL_FILE = 'docs/samples/fernhill-commons-unit-rent-roll.csv'
// As of the file's own date; it only matters for the import's expired-lease warnings, which are ignored here.
const FERNHILL = sampleUnitRentRoll(fernhillCsv, FERNHILL_FILE, '2026-09-30')
const FERNHILL_RSF = FERNHILL.units.reduce((s, u) => s + u.sf, 0)

// ---------- the dataset ----------

export const SAMPLE_PROPERTIES: Property[] = [
  // ---------------- OFFICE ----------------
  property({
    id: 'sample-westminster-tower',
    name: 'Westminster Office Tower (Sample)',
    assetType: 'office',
    cls: 'A',
    submarket: 'downtown',
    address: '1 Financial Plaza',
    zip: '02903',
    parcelId: '020-0005-0000',
    lng: -71.40968,
    lat: 41.82505,
    grossSF: 383_700,
    rentableSF: 355_900,
    yearBuilt: 1985,
    yearRenovated: 2016,
    floors: 28,
    zoning: 'D-1-300',
    landAreaSF: 21_000,
    assessedValue: 42_300_000,
    extras: { parkingSpaces: estimate(180, SAMPLE) },
    tags: ['multi-tenant', 'full-service'],
    rentRoll: {
      kind: 'commercial',
      leases: leases('sample-westminster-tower', [
        { tenant: 'Weybridge Insurance Services', suite: 'Fl 19–25', floors: [19, 20, 21, 22, 23, 24, 25], sf: 105_700, start: '2019-01-01', end: '2029-12-31', rent: 26.0, esc: pct(0.025), type: 'full-service-gross', recovery: baseYear(2019), credit: 'national', industry: 'Insurance' },
        { tenant: 'Meridian Health Administration', suite: 'Fl 7–10', floors: [7, 8, 9, 10], sf: 61_200, start: '2020-01-01', end: '2028-03-31', rent: 25.5, esc: pct(0.025), type: 'full-service-gross', recovery: baseYear(2020), credit: 'national', industry: 'Healthcare' },
        { tenant: 'Harborline Legal Partners', suite: 'Fl 26–28', floors: [26, 27, 28], sf: 46_700, start: '2021-06-01', end: '2031-05-31', rent: 27.5, esc: pct(0.025), type: 'full-service-gross', recovery: baseYear(2021), credit: 'regional', industry: 'Legal', freeRentMonths: 6, tiPerSF: 60 },
        { tenant: 'Kestrel Analytics', suite: 'Fl 14–15', floors: [14, 15], sf: 31_700, start: '2018-03-01', end: '2027-02-28', rent: 24.0, esc: perSF(0.5), type: 'full-service-gross', recovery: baseYear(2018), credit: 'local', industry: 'Technology' },
        { tenant: 'Larkfield Architects', suite: 'Fl 2–3', floors: [2, 3], sf: 17_800, start: '2023-09-01', end: '2030-08-31', rent: 27.0, esc: pct(0.03), type: 'full-service-gross', recovery: baseYear(2023), credit: 'local', industry: 'Professional services', freeRentMonths: 4, tiPerSF: 45 },
        { tenant: 'Cobblestone Community Bank', suite: 'Ground', floors: [1], sf: 13_300, start: '2016-07-01', end: '2026-12-31', rent: 30.0, esc: pct(0.02), type: 'full-service-gross', recovery: baseYear(2016), credit: 'regional', industry: 'Banking' },
      ]),
      vacancies: [
        vacant('sample-westminster-tower', 0, 'Fl 4–6', 26_700, 18, [4, 5, 6]),
        vacant('sample-westminster-tower', 1, 'Fl 11–13', 26_700, 15, [11, 12, 13]),
        vacant('sample-westminster-tower', 2, 'Fl 16–18', 26_100, 12, [16, 17, 18]),
      ],
    },
  }),

  property({
    id: 'sample-weybosset-commons',
    name: 'Dorrance Street Offices (Sample)',
    assetType: 'office',
    cls: 'B',
    submarket: 'downtown',
    address: '10 Dorrance St',
    zip: '02903',
    parcelId: '020-0018-0000',
    lng: -71.41212,
    lat: 41.82401,
    grossSF: 281_100,
    rentableSF: 259_700,
    yearBuilt: 1925,
    yearRenovated: 2008,
    floors: 10,
    zoning: 'D-1-300',
    landAreaSF: 28_200,
    assessedValue: 22_000_000,
    tags: ['multi-tenant', 'historic', 'value-add'],
    rentRoll: {
      kind: 'commercial',
      leases: leases('sample-weybosset-commons', [
        { tenant: 'Fieldstone Engineering', suite: '600–800', floors: [6, 7, 8], sf: 67_200, start: '2020-05-01', end: '2027-04-30', rent: 21.0, esc: pct(0.025), type: 'full-service-gross', recovery: baseYear(2020), credit: 'local', industry: 'Engineering' },
        { tenant: 'Granite Row Software', suite: '900–1000', floors: [9, 10], sf: 55_000, start: '2021-10-01', end: '2026-12-31', rent: 19.75, esc: pct(0.025), type: 'full-service-gross', recovery: baseYear(2021), credit: 'local', industry: 'Technology' },
        { tenant: 'Tidewater Staffing', suite: '200', floors: [2], sf: 29_000, start: '2022-02-01', end: '2027-01-31', rent: 20.5, esc: pct(0.03), type: 'full-service-gross', recovery: baseYear(2022), credit: 'local', industry: 'Staffing' },
        { tenant: 'Bridgeway Counseling Associates', suite: '500', floors: [5], sf: 23_800, start: '2024-01-01', end: '2029-12-31', rent: 22.0, esc: pct(0.03), type: 'full-service-gross', recovery: baseYear(2024), credit: 'local', industry: 'Healthcare', freeRentMonths: 3, tiPerSF: 30 },
        { tenant: 'Mainline Title Co.', suite: '100', floors: [1], sf: 18_900, start: '2019-08-01', end: '2028-07-31', rent: 20.0, esc: perSF(0.5), type: 'full-service-gross', recovery: baseYear(2019), credit: 'regional', industry: 'Real estate services' },
      ]),
      vacancies: [
        vacant('sample-weybosset-commons', 0, '300–400', 33_700, 12, [3, 4]),
        vacant('sample-weybosset-commons', 1, '550', 32_100, 15, [5]),
      ],
    },
  }),

  property({
    id: 'sample-capital-center-plaza',
    name: 'Capital Center Plaza (Sample)',
    assetType: 'office',
    cls: 'A',
    submarket: 'capital-center',
    address: '1 Citizens Plz',
    zip: '02903',
    parcelId: '019-0103-0000',
    lng: -71.41116,
    lat: 41.82765,
    grossSF: 196_000,
    rentableSF: 180_000,
    yearBuilt: 2004,
    floors: 13,
    zoning: 'D-1-200',
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
        { tenant: 'Halsey & Ward LLP', suite: 'Fl 11–12', floors: [11, 12], sf: 38_000, start: '2022-04-01', end: '2032-03-31', rent: 33.0, esc: pct(0.025), type: 'full-service-gross', recovery: baseYear(2022), credit: 'regional', industry: 'Legal', freeRentMonths: 8, tiPerSF: 75 },
        { tenant: 'Northgate Consulting', suite: 'Fl 7–8', floors: [7, 8], sf: 24_000, start: '2019-09-01', end: '2027-08-31', rent: 30.5, esc: pct(0.025), type: 'full-service-gross', recovery: baseYear(2019), credit: 'national', industry: 'Consulting' },
        { tenant: 'Capstone Wealth Partners', suite: 'Fl 13', floors: [13], sf: 15_000, start: '2021-01-01', end: '2028-12-31', rent: 32.0, esc: pct(0.0275), type: 'full-service-gross', recovery: baseYear(2021), credit: 'regional', industry: 'Financial services' },
      ]),
      vacancies: [
        vacant('sample-capital-center-plaza', 0, 'Fl 10', 18_000, 12, [10]),
        vacant('sample-capital-center-plaza', 1, 'Fl 9', 15_000, 9, [9]),
      ],
    },
  }),

  property({
    id: 'sample-innovation-lab',
    name: 'Innovation Lab Building (Sample)',
    assetType: 'office',
    cls: 'A',
    submarket: 'jewelry-district',
    address: '1 Davol Sq',
    // Tax roll lists 02901 (a PO-box ZIP); 02903 per OpenStreetMap address tags.
    zip: '02903',
    parcelId: '021-0441-0000',
    lng: -71.40593,
    lat: 41.81765,
    grossSF: 57_600,
    rentableSF: 52_400,
    yearBuilt: 2019,
    floors: 4,
    zoning: 'D-1-100',
    landAreaSF: 30_000,
    assessedValue: 20_900_000,
    tags: ['life-science', 'NNN'],
    rentRoll: {
      kind: 'commercial',
      leases: leases('sample-innovation-lab', [
        { tenant: 'Helix Therapeutics', suite: 'Fl 1–2', floors: [1, 2], sf: 22_700, start: '2020-07-01', end: '2030-06-30', rent: 38.0, esc: pct(0.03), type: 'NNN', recovery: NET, credit: 'national', industry: 'Life science', tiPerSF: 150 },
        { tenant: 'Coastal Robotics Lab', suite: 'Fl 4', floors: [4], sf: 11_400, start: '2022-01-01', end: '2029-12-31', rent: 36.5, esc: pct(0.03), type: 'NNN', recovery: NET, credit: 'regional', industry: 'Robotics', tiPerSF: 90 },
        { tenant: 'Vireo Diagnostics', suite: 'Fl 4', floors: [4], sf: 7_900, start: '2023-05-01', end: '2028-04-30', rent: 39.0, esc: pct(0.03), type: 'NNN', recovery: NET, credit: 'local', industry: 'Life science', freeRentMonths: 6, tiPerSF: 120 },
      ]),
      vacancies: [vacant('sample-innovation-lab', 0, 'Fl 3', 10_400, 15, [3])],
    },
  }),

  // ---------------- RETAIL ----------------
  property({
    id: 'sample-atwells-retail-row',
    name: 'Atwells Retail Row (Sample)',
    assetType: 'retail',
    cls: 'B',
    submarket: 'federal-hill',
    address: '245 Atwells Ave',
    zip: '02909',
    parcelId: '028-0361-0000',
    lng: -71.42628,
    lat: 41.82379,
    grossSF: 15_600,
    rentableSF: 14_400,
    yearBuilt: 1910,
    yearRenovated: 2014,
    floors: 3,
    zoning: 'C-2',
    landAreaSF: 7_500,
    assessedValue: 3_400_000,
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
          tenant: 'Casa Lucenti Trattoria', suite: '101', sf: 3_400, start: '2015-03-01', end: '2030-02-28', rent: 24.0, esc: pct(0.03), type: 'NNN', recovery: NET, credit: 'local', industry: 'Restaurant',
          renewalOptions: [{ termMonths: 60, rentBasis: 'fixed', value: 30.0, noticeMonths: 9 }],
        },
        { tenant: 'Hill Street Wine & Spirits', suite: '103', sf: 2_800, start: '2021-01-01', end: '2027-12-31', rent: 21.0, esc: pct(0.03), type: 'NNN', recovery: NET, credit: 'local', industry: 'Retail' },
        { tenant: 'Cobblestone Community Bank', suite: '105', sf: 2_400, start: '2018-04-01', end: '2028-03-31', rent: 26.0, esc: pct(0.02), type: 'NNN', recovery: NET, credit: 'regional', industry: 'Banking' },
        { tenant: 'Bellamonte Bakery', suite: '102', sf: 2_200, start: '2019-06-01', end: '2029-05-31', rent: 23.0, esc: perSF(0.5), type: 'NNN', recovery: NET, credit: 'local', industry: 'Food & beverage' },
      ]),
      vacancies: [vacant('sample-atwells-retail-row', 0, '200', 3_600, 9)],
    },
  }),

  property({
    id: 'sample-thayer-shops',
    name: 'Thayer Street Shops (Sample)',
    assetType: 'retail',
    cls: 'B',
    submarket: 'college-hill',
    address: '249 Thayer St',
    zip: '02906',
    parcelId: '013-0049-0000',
    lng: -71.40069,
    lat: 41.82847,
    grossSF: 7_100,
    rentableSF: 6_600,
    yearBuilt: 1948,
    yearRenovated: 2011,
    floors: 2,
    zoning: 'C-2',
    landAreaSF: 8_000,
    assessedValue: 2_400_000,
    tags: ['street retail', 'student-driven'],
    locationContext: context(
      [['Thayer St', 8_500, 0], ['Angell St', 11_000, 300], ['I-195', 120_000, 4_200]],
      [[1, 36_000, 11_800, 71_000, 0.012], [3, 198_000, 76_000, 64_000, 0.016], [5, 372_000, 145_000, 70_000, 0.014]],
      96,
    ),
    rentRoll: {
      kind: 'commercial',
      leases: leases('sample-thayer-shops', [
        { tenant: 'Campus Outfitters', suite: 'A', sf: 2_100, start: '2017-08-01', end: '2027-07-31', rent: 30.0, esc: pct(0.025), type: 'NNN', recovery: NET, credit: 'regional', industry: 'Apparel' },
        { tenant: 'Northbound Coffee Co.', suite: 'B', sf: 1_300, start: '2020-09-01', end: '2030-08-31', rent: 38.0, esc: pct(0.02), type: 'NNN', recovery: NET, credit: 'national', industry: 'Food & beverage' },
        { tenant: 'Lotus Noodle House', suite: 'C', sf: 1_200, start: '2022-03-01', end: '2032-02-29', rent: 34.0, esc: pct(0.03), type: 'NNN', recovery: NET, credit: 'local', industry: 'Restaurant', freeRentMonths: 3 },
        { tenant: 'Brightside Optometry', suite: 'D', sf: 1_000, start: '2021-05-01', end: '2026-11-30', rent: 31.0, esc: pct(0.03), type: 'NNN', recovery: NET, credit: 'local', industry: 'Medical retail' },
      ]),
      vacancies: [vacant('sample-thayer-shops', 0, 'E', 1_000, 6)],
    },
  }),

  // ---------------- INDUSTRIAL ----------------
  property({
    id: 'sample-olneyville-distribution',
    name: 'Olneyville Distribution Center (Sample)',
    assetType: 'industrial',
    cls: 'B',
    submarket: 'olneyville',
    address: '141 Hartford Ave',
    zip: '02909',
    parcelId: '105-0001-0000',
    lng: -71.44764,
    lat: 41.81707,
    grossSF: 41_900,
    rentableSF: 41_900,
    yearBuilt: 1968,
    yearRenovated: 2005,
    floors: 1,
    zoning: 'M-MU-75',
    landAreaSF: 392_000,
    assessedValue: 3_800_000,
    extras: {
      clearHeightFt: estimate(24, SAMPLE),
      loadingDocks: estimate(14, SAMPLE),
    },
    tags: ['single-tenant', 'below-market lease'],
    rentRoll: {
      kind: 'commercial',
      leases: leases('sample-olneyville-distribution', [
        {
          tenant: 'Mill River Logistics', suite: 'Entire', sf: 41_900, start: '2019-01-01', end: '2028-12-31', rent: 7.25, esc: pct(0.03), type: 'NNN', recovery: NET, credit: 'national', industry: 'Logistics',
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
    address: '338 Allens Ave',
    zip: '02905',
    parcelId: '047-0368-0000',
    lng: -71.40006,
    lat: 41.80472,
    grossSF: 21_500,
    rentableSF: 21_500,
    yearBuilt: 1985,
    floors: 1,
    zoning: 'W-3',
    landAreaSF: 165_000,
    floodZone: 'AE',
    assessedValue: 3_100_000,
    extras: {
      clearHeightFt: estimate(20, SAMPLE),
      loadingDocks: estimate(6, SAMPLE),
    },
    tags: ['multi-tenant', 'flex', 'waterfront'],
    rentRoll: {
      kind: 'commercial',
      leases: leases('sample-allens-ave-flex', [
        { tenant: 'Harbor Marine Supply', suite: '1', sf: 9_700, start: '2018-06-01', end: '2027-05-31', rent: 8.0, esc: perSF(0.25), type: 'NNN', recovery: NET, credit: 'regional', industry: 'Marine distribution' },
        { tenant: 'Ironbound Fabrication', suite: '2', sf: 6_300, start: '2021-03-01', end: '2026-12-31', rent: 8.75, esc: pct(0.03), type: 'NNN', recovery: NET, credit: 'local', industry: 'Manufacturing' },
        { tenant: 'Quayside Brewing Co.', suite: '3', sf: 3_100, start: '2023-01-01', end: '2032-12-31', rent: 9.5, esc: pct(0.03), type: 'NNN', recovery: NET, credit: 'local', industry: 'Food & beverage', freeRentMonths: 4, tiPerSF: 15 },
      ]),
      vacancies: [vacant('sample-allens-ave-flex', 0, '4', 2_400, 6)],
    },
  }),

  // ---------------- MULTIFAMILY ----------------
  property({
    id: 'sample-jewelry-lofts',
    name: 'Jewelry District Lofts (Sample)',
    assetType: 'multifamily',
    cls: 'A',
    submarket: 'jewelry-district',
    address: '44 Hospital St',
    zip: '02905',
    parcelId: '021-0426-0000',
    lng: -71.41014,
    lat: 41.81657,
    grossSF: 45_100,
    rentableSF: 38_900,
    yearBuilt: 1910,
    yearRenovated: 2015,
    floors: 6,
    zoning: 'D-1-100',
    landAreaSF: 24_000,
    assessedValue: 12_300_000,
    extras: { unitCount: estimate(48, SAMPLE), parkingSpaces: estimate(31, SAMPLE) },
    tags: ['loft conversion', 'historic tax credits'],
    marketRentOverride: 2350,
    rentRoll: {
      kind: 'multifamily',
      unitTypes: [
        unitType('studio', 'Studio', 10, 10, 550, 1750, 1680),
        unitType('1br', '1BR / 1BA', 24, 23, 750, 2250, 2150),
        unitType('2br', '2BR / 2BA', 14, 13, 1100, 2950, 2850),
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
    address: '18 Spruce St',
    // Tax roll lists 02901 (a PO-box ZIP); 02903 per US Census geocoder.
    zip: '02903',
    parcelId: '026-0387-0000',
    lng: -71.42396,
    lat: 41.8241,
    grossSF: 33_400,
    rentableSF: 28_200,
    yearBuilt: 1925,
    yearRenovated: 2012,
    floors: 4,
    zoning: 'C-2',
    landAreaSF: 14_000,
    assessedValue: 5_900_000,
    extras: { unitCount: estimate(38, SAMPLE) },
    tags: ['walk-up', 'loss-to-lease'],
    marketRentOverride: 1797,
    rentRoll: {
      kind: 'multifamily',
      unitTypes: [
        unitType('1br', '1BR / 1BA', 24, 23, 650, 1650, 1525),
        unitType('2br', '2BR / 1BA', 14, 14, 900, 2050, 1925),
      ],
      otherIncomePerUnitMonthly: estimate(40, SAMPLE, { notes: 'Laundry, storage' }),
    },
  }),

  // The rent roll is fictional: 120 invented units and rents from the public
  // sample file. The real building on this parcel has 102 units in the city's
  // assessor records (CAMA fields of Parcel_Zoning_FL; the Open Data tax roll
  // itself has no unit count).
  property({
    id: 'sample-fernhill-commons',
    name: 'Fernhill Commons (Sample)',
    assetType: 'multifamily',
    cls: 'B',
    submarket: 'olneyville',
    address: '91 Hartford Ave',
    zip: '02909',
    parcelId: '105-0464-0000',
    lng: -71.4467,
    lat: 41.817,
    grossSF: 144_200,
    rentableSF: FERNHILL_RSF,
    rentableSFSource: `Sample rent roll: total of unit SF (${FERNHILL_FILE})`,
    yearBuilt: 1898,
    yearRenovated: 2014,
    floors: 4,
    zoning: 'M-MU-75',
    landAreaSF: 96_000,
    assessedValue: 14_400_000,
    floodZone: 'X',
    extras: {
      unitCount: estimate(FERNHILL.units.length, SAMPLE_RENT_ROLL, {
        notes: 'Fictional rent roll with invented units and rents. The real building at 91 Hartford Ave has 102 units in the City of Providence assessor records.',
      }),
    },
    tags: ['mill conversion', 'loss-to-lease', 'lease-up'],
    marketRentOverride: averageMarketRent(FERNHILL.units),
    rentRoll: FERNHILL,
  }),
]
