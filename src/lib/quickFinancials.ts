import type { ISODate, LeaseType, Property } from '../types'
import { benchmarkFor } from './marketView'
import { activeLeases, inPlaceAnnualRent } from './metrics'
import { irr } from './underwriting/finance'

export { irr }

/**
 * QUICK, SIMPLIFIED financials for the Investment view.
 *
 * This is a stand-in until the full lease-by-lease underwriting engine exists.
 * It deliberately ignores lease rollover, downtime, TI/LC, capex, base-year
 * recovery mechanics and debt. Every output should be labeled "quick estimate".
 */

/** Share of operating expenses the landlord absorbs, by lease structure. */
const LANDLORD_OPEX_SHARE: Record<LeaseType, number> = {
  NNN: 0,
  'modified-gross': 0.5,
  'full-service-gross': 1,
}

export const QUICK_ASSUMPTIONS = {
  managementFeePct: 0.03,
  holdYears: 10,
  exitCapSpread: 0.0025,
  sellingCostsPct: 0.02,
} as const

export type PurchaseBasis = 'implied-value' | 'assessed-value'

export interface YearOneNOI {
  grossRevenue: number
  landlordOpex: number
  managementFee: number
  noi: number
}

/** Stabilized-ish year-1 NOI from the in-place rent roll. */
export function yearOneNOI(p: Property, asOf: ISODate): YearOneNOI {
  const opex = p.market.opexPerYear.value
  const rr = p.rentRoll
  let grossRevenue: number
  let landlordOpex: number

  if (rr.kind === 'multifamily') {
    const units = rr.unitTypes.reduce((s, u) => s + u.unitCount, 0)
    const occupied = rr.unitTypes.reduce((s, u) => s + u.occupiedUnits, 0)
    const otherIncome = (rr.otherIncomePerUnitMonthly?.value ?? 0) * occupied * 12
    grossRevenue = inPlaceAnnualRent(p, asOf) + otherIncome
    landlordOpex = opex * units // per unit per year
  } else {
    const leases = activeLeases(p, asOf)
    const leasedSF = leases.reduce((s, l) => s + l.leasedSF, 0)
    const vacantSF = Math.max(0, p.physical.rentableSF.value - leasedSF)
    grossRevenue = inPlaceAnnualRent(p, asOf)
    landlordOpex =
      leases.reduce((s, l) => s + l.leasedSF * opex * LANDLORD_OPEX_SHARE[l.leaseType], 0) + vacantSF * opex
  }

  const managementFee = grossRevenue * QUICK_ASSUMPTIONS.managementFeePct
  return { grossRevenue, landlordOpex, managementFee, noi: grossRevenue - landlordOpex - managementFee }
}

export interface QuickFinancials extends YearOneNOI {
  marketCapRate: number
  impliedValue: number
  /** Null when unknown; the assessed-value basis then falls back to implied value. */
  assessedValue: number | null
  purchasePrice: number
  goingInCapRate: number
  noiGrowth: number
  exitCapRate: number
  exitValue: number
  unleveredIRR: number | null
  equityMultiple: number
  /** NOI by year 1..hold, for sparklines. */
  noiByYear: number[]
}

export function quickFinancials(p: Property, asOf: ISODate, basis: PurchaseBasis = 'implied-value'): QuickFinancials {
  const y1 = yearOneNOI(p, asOf)
  const marketCapRate = p.market.marketCapRate.value
  const impliedValue = y1.noi / marketCapRate
  const assessedValue = p.valuation.assessedValue?.value ?? null
  const purchasePrice = basis === 'assessed-value' && assessedValue ? assessedValue : impliedValue

  const noiGrowth = benchmarkFor(p.location.submarket, p.assetType)?.benchmark.annualRentGrowth.value ?? 0.02
  const { holdYears, exitCapSpread, sellingCostsPct } = QUICK_ASSUMPTIONS
  const exitCapRate = marketCapRate + exitCapSpread

  const noiByYear = Array.from({ length: holdYears + 1 }, (_, t) => y1.noi * Math.pow(1 + noiGrowth, t))
  const exitValue = (noiByYear[holdYears] / exitCapRate) * (1 - sellingCostsPct)

  const cashFlows = [-purchasePrice, ...noiByYear.slice(0, holdYears)]
  cashFlows[holdYears] += exitValue

  const totalIn = cashFlows.slice(1).reduce((s, c) => s + c, 0)

  return {
    ...y1,
    marketCapRate,
    impliedValue,
    assessedValue,
    purchasePrice,
    goingInCapRate: y1.noi / purchasePrice,
    noiGrowth,
    exitCapRate,
    exitValue,
    unleveredIRR: irr(cashFlows),
    equityMultiple: totalIn / purchasePrice,
    noiByYear: noiByYear.slice(0, holdYears),
  }
}
