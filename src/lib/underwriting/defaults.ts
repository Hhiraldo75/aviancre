import type { ISODate, LeasingTerms, MarketLeasingAssumptions, Property, Sourced, UnderwritingAssumptions } from '../../types'
import { estimate, fromImport } from '../sourced'
import { analysisStartFor } from './timeline'
import { operatingCashFlows } from './waterfall'

/**
 * Default underwriting assumptions, one set per asset type. Every value is
 * Sourced and says what should replace it, so the UI can badge it "EST".
 */

export const RULE_OF_THUMB = 'Industry rule of thumb – replace with market report'
export const LENDER_PLACEHOLDER = 'Placeholder – replace with lender term sheet'
export const INVESTOR_TARGET = 'Placeholder – replace with investor return target'
export const ANALYST_INPUT = 'Analyst input'

type CommercialType = 'office' | 'retail' | 'industrial'

interface CommercialDefaults {
  renewalProbability: number
  downtimeMonths: number
  newTermYears: number
  renewalTermYears: number
  /** [new, renewal] */
  freeRentMonths: [number, number]
  /** [new, renewal], $/SF */
  tiPerSF: [number, number]
  marketRentGrowth: number
  reservesPerSF: number
  vacantSpaceRecovery: MarketLeasingAssumptions['vacantSpaceRecovery']
}

export const COMMERCIAL_DEFAULTS: Record<CommercialType, CommercialDefaults> = {
  office: {
    renewalProbability: 0.65,
    downtimeMonths: 9,
    newTermYears: 7,
    renewalTermYears: 5,
    freeRentMonths: [6, 2],
    tiPerSF: [60, 20],
    marketRentGrowth: 0.015,
    reservesPerSF: 0.25,
    vacantSpaceRecovery: 'base-year',
  },
  retail: {
    renewalProbability: 0.7,
    downtimeMonths: 9,
    newTermYears: 10,
    renewalTermYears: 5,
    freeRentMonths: [3, 1],
    tiPerSF: [30, 10],
    marketRentGrowth: 0.02,
    reservesPerSF: 0.25,
    vacantSpaceRecovery: 'net',
  },
  industrial: {
    renewalProbability: 0.7,
    downtimeMonths: 4,
    newTermYears: 5,
    renewalTermYears: 5,
    freeRentMonths: [2, 0],
    tiPerSF: [5, 2],
    marketRentGrowth: 0.035,
    reservesPerSF: 0.15,
    vacantSpaceRecovery: 'net',
  },
}

export const SHARED_DEFAULTS = {
  leasingCommissionNew: 0.06,
  leasingCommissionRenewal: 0.03,
  newLeaseEscalationPct: 0.03,
  generalVacancyPct: 0.05,
  creditLossPct: 0.01,
  expenseGrowth: 0.03,
  managementFeePct: 0.03,
  closingCostsPct: 0.015,
  ltv: 0.6,
  interestRate: 0.065,
  amortizationYears: 30,
  interestOnlyYears: 2,
  loanFeesPct: 0.01,
  holdYears: 10,
  exitCapSpread: 0.0025,
  sellingCostsPct: 0.02,
  discountRate: 0.08,
  targetLeveredIRR: 0.1,
} as const

export const MULTIFAMILY_DEFAULTS = {
  marketRentGrowth: 0.03,
  reservesPerUnit: 300,
  turnoverRate: 0.5,
  turnoverCostPerUnit: 1000,
} as const

const rot = (value: number) => estimate(value, RULE_OF_THUMB)
const lender = (value: number) => estimate(value, LENDER_PLACEHOLDER)
const NOT_USED = 'Not used for multifamily'

function terms(termMonths: number, freeRentMonths: number, tiPerSF: number, lcPct: number): LeasingTerms {
  return {
    termMonths: rot(termMonths),
    freeRentMonths: rot(freeRentMonths),
    tiPerSF: rot(tiPerSF),
    leasingCommissionPct: rot(lcPct),
  }
}

function unusedTerms(): LeasingTerms {
  const n = () => estimate(0, NOT_USED)
  return { termMonths: n(), freeRentMonths: n(), tiPerSF: n(), leasingCommissionPct: n() }
}

/**
 * Default assumptions for a property. The purchase price defaults to
 * year-1 NOI ÷ market cap rate at these defaults, so this runs the operating
 * cash flows once.
 */
export function defaultAssumptions(property: Property, asOf: ISODate): UnderwritingAssumptions {
  const s = SHARED_DEFAULTS
  const isMF = property.rentRoll.kind === 'multifamily'
  const commercialType: CommercialType =
    property.assetType === 'retail' || property.assetType === 'industrial' ? property.assetType : 'office'
  const c = COMMERCIAL_DEFAULTS[commercialType]
  const marketCap = property.market.marketCapRate

  const sizeBasis = isMF ? units(property) : property.physical.rentableSF.value
  const opex = property.market.opexPerYear

  const assumptions: UnderwritingAssumptions = {
    scenario: 'base',
    acquisition: {
      purchasePrice: estimate(0, 'Pending: year-1 NOI ÷ market cap rate'),
      marketCapRate: marketCap,
      closingCostsPct: rot(s.closingCostsPct),
      analysisStartDate: analysisStartFor(asOf),
      holdYears: estimate(s.holdYears, INVESTOR_TARGET),
      initialCapex: estimate(0, 'Placeholder – replace with capital plan'),
    },
    leasing: isMF
      ? {
          marketRent: property.market.marketRent,
          marketRentGrowth: rot(MULTIFAMILY_DEFAULTS.marketRentGrowth),
          renewalProbability: estimate(0, NOT_USED),
          downtimeMonths: estimate(0, NOT_USED),
          newLease: unusedTerms(),
          renewal: unusedTerms(),
          newLeaseEscalationPct: estimate(0, NOT_USED),
          vacantSpaceRecovery: 'none',
        }
      : {
          marketRent: property.market.marketRent,
          marketRentGrowth: rot(c.marketRentGrowth),
          renewalProbability: rot(c.renewalProbability),
          downtimeMonths: rot(c.downtimeMonths),
          newLease: terms(c.newTermYears * 12, c.freeRentMonths[0], c.tiPerSF[0], s.leasingCommissionNew),
          renewal: terms(c.renewalTermYears * 12, c.freeRentMonths[1], c.tiPerSF[1], s.leasingCommissionRenewal),
          newLeaseEscalationPct: rot(s.newLeaseEscalationPct),
          vacantSpaceRecovery: c.vacantSpaceRecovery,
        },
    operating: {
      generalVacancyPct: rot(s.generalVacancyPct),
      creditLossPct: rot(s.creditLossPct),
      expenses: [
        {
          label: isMF ? 'Operating expenses' : 'Operating expenses (taxes, insurance, CAM)',
          annualAmount: estimate(opex.value * sizeBasis, `${opex.sourceName} × ${isMF ? 'units' : 'rentable SF'}`),
          recoverable: !isMF,
        },
      ],
      expenseGrowth: rot(s.expenseGrowth),
      managementFeePct: rot(s.managementFeePct),
      capitalReservesPerYear: rot(isMF ? MULTIFAMILY_DEFAULTS.reservesPerUnit : c.reservesPerSF),
    },
    multifamily: isMF
      ? {
          turnoverRate: rot(MULTIFAMILY_DEFAULTS.turnoverRate),
          turnoverCostPerUnit: rot(MULTIFAMILY_DEFAULTS.turnoverCostPerUnit),
        }
      : undefined,
    debt: {
      enabled: true,
      ltv: lender(s.ltv),
      rate: { type: 'fixed', rate: lender(s.interestRate) },
      amortizationYears: lender(s.amortizationYears),
      interestOnlyYears: lender(s.interestOnlyYears),
      loanFeesPct: lender(s.loanFeesPct),
    },
    exit: {
      exitCapRate: estimate(
        marketCap.value + s.exitCapSpread,
        'Market cap rate + 25 bps – rule of thumb, replace with broker opinion of value',
      ),
      sellingCostsPct: rot(s.sellingCostsPct),
      capForwardNOI: true,
    },
    discountRate: estimate(s.discountRate, INVESTOR_TARGET),
    targetLeveredIRR: estimate(s.targetLeveredIRR, INVESTOR_TARGET),
  }

  assumptions.acquisition.purchasePrice = estimatedPrice(property, assumptions, asOf)
  return assumptions
}

/**
 * Estimated purchase price: year-1 NOI under the default assumptions ÷ the
 * market cap rate. Anchored to defaults, so editing other assumptions moves
 * the going-in cap and returns rather than the price.
 */
export function estimatedPrice(
  property: Property,
  defaults: UnderwritingAssumptions,
  asOf: ISODate,
  marketCap: Sourced<number> = defaults.acquisition.marketCapRate,
): Sourced<number> {
  const noi1 = operatingCashFlows(property, defaults, asOf).years[0].netOperatingIncome
  const capSource = marketCap.sourceName === ANALYST_INPUT ? '(analyst input)' : `from ${marketCap.sourceName}`
  return estimate(noi1 / marketCap.value, 'Default year-1 NOI ÷ market cap rate', {
    notes: `Market cap rate ${(marketCap.value * 100).toFixed(2)}% ${capSource}`,
  })
}

/** Replaces the purchase price with an analyst's figure. */
export function withPurchasePrice(a: UnderwritingAssumptions, price: number): UnderwritingAssumptions {
  return { ...a, acquisition: { ...a.acquisition, purchasePrice: fromImport(price, ANALYST_INPUT) } }
}

function units(property: Property): number {
  const rr = property.rentRoll
  return rr.kind === 'multifamily' ? rr.unitTypes.reduce((s, u) => s + u.unitCount, 0) : 0
}

/** True when a value is still a model default rather than an input. */
export function isEstimate(v: Sourced<unknown>): boolean {
  return v.source === 'estimated'
}
