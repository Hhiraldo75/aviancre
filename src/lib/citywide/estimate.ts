import type { BenchmarkType, Confidence, LeaseType, Pct, Sourced, SubmarketBenchmark } from '../../types'
import { METRO_BENCHMARKS, SUBMARKETS } from '../../data/submarkets'
import { PVD_SOURCE } from '../../services/providenceGis'
import { fmt } from '../format'
import { decodeLandUse } from '../landUse'
import { LANDLORD_OPEX_SHARE, QUICK_ASSUMPTIONS } from '../quickFinancials'
import { estimate, fromPublic } from '../sourced'
import { submarketFor, type MarketAssignment } from './submarket'
import type { CitywideParcel } from './types'

/**
 * SCREENING estimate of value for one commercial parcel, from public data and
 * the market benchmarks: no rents, leases or expenses of the property itself.
 * The year-1 NOI follows the quick financials' rules (`yearOneNOI`): income at
 * the class B benchmark rent, less benchmark vacancy, landlord operating
 * expenses by lease structure and the management fee; value is NOI ÷ the
 * benchmark cap rate. It points an analyst at parcels worth a look; it is not
 * an appraisal.
 */

export const SCREENING_LABEL = 'Screening estimate, not an appraisal'
const ESTIMATE_SOURCE = 'AVIANCRE citywide screening estimate'
export const METRO_NAME = 'Providence-Warwick metro'

/** Gross building area per apartment, common areas included, when the city record has no unit count. */
export const AVG_UNIT_SF = 1_000
/**
 * Rentable share of gross building area (EST): gross area also holds walls,
 * stairs, mechanical rooms and common space. Apartments are priced by unit, so
 * they take none.
 */
export const RENTABLE_EFFICIENCY = {
  office: 0.85,
  retail: 0.9,
  industrial: 0.95,
  /** Office or retail unknown: between the two. */
  commercial: 0.875,
  /** The commercial part of a mixed-use building, whatever its type. */
  mixedUseCommercial: 0.9,
} as const

export type EfficiencyKey = keyof typeof RENTABLE_EFFICIENCY

const EFFICIENCY_LABELS: Record<EfficiencyKey, string> = {
  office: 'office',
  retail: 'retail',
  industrial: 'industrial',
  commercial: 'office or retail, type unknown',
  mixedUseCommercial: 'commercial part of a mixed-use building',
}

/** Share of a parcel's tagged OpenStreetMap features one side needs for the parcel to take that type. */
export const OSM_TYPE_SHARE = 2 / 3

/** Lease structure each benchmark rent is quoted on: office full-service gross, retail and industrial NNN. */
const LEASE_TYPE: Record<Exclude<BenchmarkType, 'multifamily'>, LeaseType> = {
  office: 'full-service-gross',
  retail: 'NNN',
  industrial: 'NNN',
}

/** "commercial" is Providence's office-or-retail code with no OpenStreetMap tags to tell which. */
export type ScreeningType = 'office' | 'retail' | 'commercial' | 'industrial' | 'multifamily' | 'mixed-use'

export const SCREENING_TYPE_LABELS: Record<ScreeningType, string> = {
  office: 'Office',
  retail: 'Retail',
  commercial: 'Office/retail blend',
  industrial: 'Industrial',
  multifamily: 'Apartments',
  'mixed-use': 'Mixed use',
}

export type SkipReason = 'not-commercial' | 'vacant-land' | 'utility' | 'no-building-area' | 'no-income'

export const SKIP_REASONS: Record<SkipReason, string> = {
  'not-commercial': 'Not commercial under the RI class 2 rule',
  'vacant-land': 'Vacant land: no building to rent',
  utility: 'Utility: not priced from market rents',
  'no-building-area': 'The city record has no building area',
  'no-income': "Benchmark income doesn't cover the expenses",
}

export type RatioBandId = 'well-below' | 'below' | 'near' | 'above' | 'well-above' | 'no-assessment'

/**
 * Bands of the ratio "vs peers": a parcel's estimate ÷ assessed divided by the
 * median of that ratio for its property type (see `peers.ts`). Each band runs
 * up to (not including) `below`.
 */
export const RATIO_BANDS: { id: Exclude<RatioBandId, 'no-assessment'>; label: string; below: number }[] = [
  { id: 'well-below', label: 'Well below peers (under 0.75×)', below: 0.75 },
  { id: 'below', label: 'Below peers (0.75–0.90×)', below: 0.9 },
  { id: 'near', label: 'In line with peers (0.90–1.10×)', below: 1.1 },
  { id: 'above', label: 'Above peers (1.10–1.33×)', below: 1.33 },
  { id: 'well-above', label: 'Well above peers (1.33× or more)', below: Infinity },
]

export function ratioBand(ratio: number | undefined): RatioBandId {
  if (ratio === undefined || !Number.isFinite(ratio)) return 'no-assessment'
  return RATIO_BANDS.find((b) => ratio < b.below)!.id
}

/** One benchmark applied to one space: the NOI build from income to value. */
export interface EstimateLine {
  benchmarkType: BenchmarkType
  /** The submarket the benchmark is from, or the metro. */
  market: string
  /** Why the metro was used inside a submarket, when it was. */
  marketNote?: string
  /** Rentable SF, or units for apartments. */
  quantity: Sourced<number>
  /** Space priced by area: the gross area and the rentable share that make `quantity`. */
  area?: { gross: Sourced<number>; efficiency: Sourced<Pct> }
  /** Class B rent: $/SF/yr, or $/unit/mo for apartments. */
  rent: Sourced<number>
  potentialIncome: number
  vacancyRate: Sourced<Pct>
  vacancyLoss: number
  /** $/SF/yr, or $/unit/yr for apartments. */
  opex: Sourced<number>
  leaseType?: LeaseType
  landlordOpex: number
  managementFee: number
  noi: number
  capRate: Sourced<Pct>
  value: number
}

/** A part of the building; with two options (office and retail) it takes their average. */
export interface EstimateComponent {
  label: string
  options: EstimateLine[]
}

export interface CitywideEstimate {
  status: 'estimated'
  pin: string
  type: ScreeningType
  /** Why this type, and how the space was split. */
  typeNotes: string[]
  market: MarketAssignment
  components: EstimateComponent[]
  noi: Sourced<number>
  value: Sourced<number>
  assessed?: number
  /** Estimated ÷ assessed value. */
  ratio?: number
}

export interface CitywideSkip {
  status: 'skipped'
  pin: string
  type?: ScreeningType
  reason: SkipReason
}

export type CitywideResult = CitywideEstimate | CitywideSkip

/** Office, retail or (unknown) a blend, from OpenStreetMap features inside the parcel. */
export function commercialType({ office, retail }: CitywideParcel['osm']): { type: 'office' | 'retail' | 'commercial'; note: string } {
  const total = office + retail
  const counts = `${retail} ${retail === 1 ? 'shop, restaurant or bank' : 'shops, restaurants or banks'} and ${office} ${office === 1 ? 'office' : 'offices'}`
  if (total === 0) return { type: 'commercial', note: 'No OpenStreetMap office or shop tags inside the parcel: office/retail blend' }
  if (office / total >= OSM_TYPE_SHARE) return { type: 'office', note: `OpenStreetMap: ${counts} inside the parcel → office` }
  if (retail / total >= OSM_TYPE_SHARE) return { type: 'retail', note: `OpenStreetMap: ${counts} inside the parcel → retail` }
  return { type: 'commercial', note: `OpenStreetMap: ${counts} inside the parcel, no clear majority: office/retail blend` }
}

function benchmarkIn(market: MarketAssignment, type: BenchmarkType): { benchmark: SubmarketBenchmark; market: string; note?: string } {
  if (!market.submarket) return { benchmark: METRO_BENCHMARKS[type], market: METRO_NAME }
  const sub = SUBMARKETS[market.submarket]
  const benchmark = sub.benchmarks[type]
  return benchmark
    ? { benchmark, market: sub.name }
    : { benchmark: METRO_BENCHMARKS[type], market: METRO_NAME, note: `${sub.name} has no ${type} benchmark` }
}

/** Rentable area from a gross area (public, or the commercial part of one) and the efficiency factor. */
export function rentableArea(gross: Sourced<number>, key: EfficiencyKey): { quantity: Sourced<number>; area: NonNullable<EstimateLine['area']> } {
  const factor = RENTABLE_EFFICIENCY[key]
  const efficiency = estimate(factor, `Rentable share of gross building area, ${EFFICIENCY_LABELS[key]} (assumed)`, {
    notes: 'Gross area also holds walls, stairs, mechanical rooms and common space.',
  })
  const quantity = estimate(gross.value * factor, `${gross.source === 'public' ? 'Gross building area' : `(${gross.sourceName})`} × ${fmt.pctShort(factor)} rentable`, {
    notes: 'Rentable area, assumed from the gross area.',
  })
  return { quantity, area: { gross, efficiency } }
}

/** Year-1 NOI and value for one space, by `yearOneNOI`'s rules; `area` when the space is priced by its rentable area. */
export function estimateLine(
  type: BenchmarkType,
  quantity: Sourced<number>,
  market: MarketAssignment,
  area?: EstimateLine['area'],
): EstimateLine {
  const found = benchmarkIn(market, type)
  const b = found.benchmark
  const classFactor = b.classAdjustment.B
  const rent = estimate(b.marketRent.value * classFactor, `${b.marketRent.sourceName} – ${found.market}, class B (${classFactor}×)`, {
    confidence: b.marketRent.confidence,
    asOf: b.marketRent.asOf,
    range: b.marketRent.range && { low: b.marketRent.range.low * classFactor, high: b.marketRent.range.high * classFactor },
    notes: 'No class on public records: class B baseline.',
  })
  const q = quantity.value
  const vacancy = b.vacancyRate.value
  const opex = b.opexPerYear.value
  const isMF = type === 'multifamily'
  const potentialIncome = isMF ? q * rent.value * 12 : q * rent.value
  const leaseType = isMF ? undefined : LEASE_TYPE[type]
  // Apartments: the landlord pays every unit's opex. Commercial: leased space by lease type, vacant space in full.
  const landlordOpex = leaseType ? q * (1 - vacancy) * opex * LANDLORD_OPEX_SHARE[leaseType] + q * vacancy * opex : q * opex
  const vacancyLoss = potentialIncome * vacancy
  const managementFee = (potentialIncome - vacancyLoss) * QUICK_ASSUMPTIONS.managementFeePct
  const noi = potentialIncome - vacancyLoss - landlordOpex - managementFee
  return {
    benchmarkType: type,
    market: found.market,
    marketNote: found.note,
    quantity,
    area,
    rent,
    potentialIncome,
    vacancyRate: b.vacancyRate,
    vacancyLoss,
    opex: b.opexPerYear,
    leaseType,
    landlordOpex,
    managementFee,
    noi,
    capRate: b.marketCapRate,
    value: noi / b.marketCapRate.value,
  }
}

const unitsText = (n: number) => `${fmt.int(n)} ${n === 1 ? 'unit' : 'units'}`

/** Unit counts a tax-roll class allows, e.g. "03-11+" → 11 or more; null when the code has no band. */
export function unitBand(code: string): { min: number; max: number; label: string } | null {
  const c = code.trim().toUpperCase()
  if (c.endsWith('-610')) return { min: 6, max: 10, label: '6–10 units' }
  if (c.endsWith('-11+')) return { min: 11, max: Infinity, label: '11+ units' }
  if (c.endsWith('-05U')) return { min: 1, max: 5, label: 'up to 5 units' }
  if (/^0?3$/.test(c)) return { min: 6, max: Infinity, label: '6+ units' }
  return null
}

/**
 * The city record's unit count when it fits the tax roll's unit band; else
 * building area ÷ the average unit size, kept within the band (EST). Null for
 * mixed use with neither a count nor a band.
 */
export function unitsFor(code: string, cityUnits: number | undefined, gba: number): { units: Sourced<number>; note?: string } | null {
  const band = unitBand(code)
  if (cityUnits && (!band || (cityUnits >= band.min && cityUnits <= band.max))) return { units: fromPublic(cityUnits, PVD_SOURCE) }
  if (!band) return null
  const n = Math.min(band.max, Math.max(band.min, Math.floor(gba / AVG_UNIT_SF)))
  const why = cityUnits
    ? `The city record's unit count (${fmt.int(cityUnits)}) doesn't fit the tax roll class (${band.label})`
    : 'No unit count on the city record'
  return {
    units: estimate(n, `Gross building area ÷ ${fmt.int(AVG_UNIT_SF)} SF per unit, within the class's ${band.label}`, { notes: `${why}.` }),
    note: `${why}: ${unitsText(n)} from the building area`,
  }
}

const average = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)
const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 }

const skip = (pin: string, reason: SkipReason, type?: ScreeningType): CitywideSkip => ({ status: 'skipped', pin, type, reason })

export function estimateParcel(p: CitywideParcel): CitywideResult {
  const use = decodeLandUse(p.landUseCode)
  if (!use?.isCommercial) return skip(p.pin, 'not-commercial')
  if (use.category === 'vacant land') return skip(p.pin, 'vacant-land')
  // Utilities are the only other commercial category.
  if (use.category === 'other') return skip(p.pin, 'utility')

  const commercial = commercialType(p.osm)
  const type: ScreeningType =
    use.category === 'industrial' || use.category === 'multifamily' || use.category === 'mixed-use' ? use.category : commercial.type
  if (!p.gba) return skip(p.pin, 'no-building-area', type)

  const market = submarketFor(p.neighborhood, p.point)
  const gross = fromPublic(p.gba, PVD_SOURCE)
  const typeNotes = [`Land use: ${use.label} (tax roll class ${use.code})`]
  // Lowered to low when the type or the space split is a guess.
  let guessed = false

  /** Office, retail or both (averaged); `inMixedUse` takes the mixed-use rentable share. */
  const commercialComponent = (label: string, grossArea: Sourced<number>, inMixedUse: boolean): EstimateComponent => {
    typeNotes.push(commercial.note)
    if (commercial.type === 'commercial') guessed = true
    const { quantity, area } = rentableArea(grossArea, inMixedUse ? 'mixedUseCommercial' : commercial.type)
    const types: BenchmarkType[] = commercial.type === 'commercial' ? ['office', 'retail'] : [commercial.type]
    return { label, options: types.map((t) => estimateLine(t, quantity, market, area)) }
  }

  const components: EstimateComponent[] = []
  const units = type === 'multifamily' || type === 'mixed-use' ? unitsFor(p.landUseCode, p.units, p.gba) : null
  if (units?.note) {
    guessed = true
    typeNotes.push(units.note)
  }
  if (type === 'industrial') {
    const { quantity, area } = rentableArea(gross, 'industrial')
    components.push({ label: 'Industrial space', options: [estimateLine('industrial', quantity, market, area)] })
  } else if (type === 'multifamily') {
    components.push({ label: 'Apartments', options: [estimateLine('multifamily', units!.units, market)] })
  } else if (type === 'mixed-use') {
    if (units) {
      const n = units.units.value
      const commercialSF = p.gba - n * AVG_UNIT_SF
      components.push({ label: 'Apartments', options: [estimateLine('multifamily', units.units, market)] })
      if (commercialSF > 0) {
        typeNotes.push(`Split: ${unitsText(n)} × ${fmt.int(AVG_UNIT_SF)} SF as apartments, the other ${fmt.sf(commercialSF)} as commercial`)
        const space = estimate(commercialSF, `Gross building area − ${unitsText(n)} × ${fmt.int(AVG_UNIT_SF)} SF`, {
          notes: 'Commercial share of the building, assumed.',
        })
        components.push(commercialComponent('Commercial space', space, true))
      } else {
        typeNotes.push(`Building area is no more than ${unitsText(n)} × ${fmt.int(AVG_UNIT_SF)} SF: apartments only`)
      }
    } else {
      guessed = true
      typeNotes.push('No unit count on the city record: the whole building priced as commercial')
      components.push(commercialComponent('Commercial space', gross, true))
    }
  } else {
    components.push(commercialComponent(type === 'commercial' ? 'Commercial space' : `${SCREENING_TYPE_LABELS[type]} space`, gross, false))
  }

  const lines = components.flatMap((c) => c.options)
  const noi = sum(components.map((c) => average(c.options.map((l) => l.noi))))
  if (!(noi > 0)) return skip(p.pin, 'no-income', type)
  const value = sum(components.map((c) => average(c.options.map((l) => l.value))))
  const blended = components.some((c) => c.options.length > 1)
  const range = blended
    ? {
        low: sum(components.map((c) => Math.min(...c.options.map((l) => l.value)))),
        high: sum(components.map((c) => Math.max(...c.options.map((l) => l.value)))),
      }
    : undefined

  const inputs = lines.flatMap((l) => [l.rent, l.vacancyRate, l.capRate])
  const lowest = inputs.reduce<Confidence>((c, s) => (RANK[s.confidence ?? 'low'] < RANK[c] ? (s.confidence ?? 'low') : c), 'high')
  const metro = lines.some((l) => l.market === METRO_NAME)
  const confidence: Confidence = guessed || metro ? 'low' : lowest
  const methodNote = `${SCREENING_LABEL}. ${market.method}.`
  const ratio = p.assessed ? value / p.assessed : undefined

  return {
    status: 'estimated',
    pin: p.pin,
    type,
    typeNotes,
    market,
    components,
    noi: estimate(noi, ESTIMATE_SOURCE, { confidence, notes: `Year-1 NOI at benchmark rent, vacancy and expenses. ${methodNote}` }),
    value: estimate(value, ESTIMATE_SOURCE, {
      confidence,
      range,
      notes: `NOI ÷ benchmark cap rate${blended ? '; office/retail unknown, so the average of the two (range: one or the other)' : ''}. ${methodNote}`,
    }),
    assessed: p.assessed,
    ratio,
  }
}
