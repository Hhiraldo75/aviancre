import type { ISODate, OperatingAssumptions, Property, UnderwritingAssumptions, ValueAddPlan } from '../../types'
import { commercialMonths, type AboveMarketOption } from './commercial'
import { multifamilyYears } from './multifamily'

/**
 * Annual revenue and cost lines before the waterfall percentages are applied.
 * Losses (vacancy, free rent) and costs are positive amounts.
 */
export interface OperatingInputs {
  occupancy: number
  grossPotentialRent: number
  /** Market minus in-place rent on leased units (multifamily; 0 for commercial). */
  lossToLease: number
  absorptionTurnoverVacancy: number
  freeRent: number
  expenseRecoveries: number
  otherIncome: number
  /** Operating expenses before the management fee. */
  propertyExpenses: number
  tenantImprovements: number
  leasingCommissions: number
  capitalReserves: number
  /** Value-add plan on only: renovation downtime, already in absorptionTurnoverVacancy; it comes on top of the general vacancy floor. */
  renovationDowntime?: number
  /** Value-add plan on only: renovation cost (below NOI), the same amount drawn from the reserve, and renovations started. */
  renovationCapex?: number
  renovationReserveDraw?: number
  unitsRenovated?: number
}

export interface OperatingYear extends OperatingInputs {
  year: number
  generalVacancy: number
  creditLoss: number
  effectiveGrossIncome: number
  managementFee: number
  operatingExpenses: number
  netOperatingIncome: number
  cashFlowBeforeDebt: number
}

/**
 * General vacancy is a floor on total vacancy: the line only adds what the
 * rollover and lease-up vacancy didn't already account for. Value-add
 * renovation downtime comes on top: callers leave it out of `modeledVacancy`.
 */
export function generalVacancy(rate: number, potentialRevenue: number, modeledVacancy: number): number {
  return Math.max(0, rate * potentialRevenue - modeledVacancy)
}

/** Applies vacancy, credit loss and management fee to one year of inputs. */
export function applyWaterfall(year: number, x: OperatingInputs, op: OperatingAssumptions): OperatingYear {
  const potential = x.grossPotentialRent - x.lossToLease + x.expenseRecoveries + x.otherIncome
  const gv = generalVacancy(op.generalVacancyPct.value, potential, x.absorptionTurnoverVacancy - (x.renovationDowntime ?? 0))
  const beforeCredit = potential - x.absorptionTurnoverVacancy - x.freeRent - gv
  const creditLoss = op.creditLossPct.value * beforeCredit
  const egi = beforeCredit - creditLoss
  const managementFee = op.managementFeePct.value * egi
  const operatingExpenses = x.propertyExpenses + managementFee
  const noi = egi - operatingExpenses
  // Renovations are paid from the reserve, so they net to zero here.
  const renovation = (x.renovationCapex ?? 0) - (x.renovationReserveDraw ?? 0)
  return {
    ...x,
    year,
    generalVacancy: gv,
    creditLoss,
    effectiveGrossIncome: egi,
    managementFee,
    operatingExpenses,
    netOperatingIncome: noi,
    cashFlowBeforeDebt: noi - x.tenantImprovements - x.leasingCommissions - x.capitalReserves - renovation,
  }
}

/**
 * Stabilizes a year for valuation: drops absorption/turnover vacancy and free
 * rent, so the full general vacancy rate applies instead. A buyer capitalizes
 * a normal year, not one that happens to have a lease in downtime.
 */
export function normalizeForExit(y: OperatingYear, op: OperatingAssumptions): OperatingYear {
  return applyWaterfall(y.year, { ...y, absorptionTurnoverVacancy: 0, freeRent: 0, ...(y.renovationDowntime === undefined ? {} : { renovationDowntime: 0 }) }, op)
}

export interface OperatingResult {
  /** Years 1..hold+1. */
  years: OperatingYear[]
  /** SF rolling in each year (commercial only; zeros for multifamily). */
  expiringSFByYear: number[]
  /** The in-place leases' share of `expiringSFByYear`. */
  inPlaceExpiringSFByYear: number[]
  aboveMarketOptions: AboveMarketOption[]
  /** Present when the value-add plan is on. */
  valueAdd?: ValueAddPlan
}

/** Property-level cash flows before debt for every year of the hold plus the forward year. */
export function operatingCashFlows(property: Property, a: UnderwritingAssumptions, asOf: ISODate): OperatingResult {
  const holdYears = a.acquisition.holdYears.value
  if (property.rentRoll.kind === 'multifamily') {
    const mf = multifamilyYears(property, a)
    const years = mf.years.map((x, i) => applyWaterfall(i + 1, x, a.operating))
    const zeros = () => Array.from({ length: holdYears + 1 }, () => 0)
    return { years, expiringSFByYear: zeros(), inPlaceExpiringSFByYear: zeros(), aboveMarketOptions: [], ...(mf.valueAdd ? { valueAdd: mf.valueAdd } : {}) }
  }

  const { months, expiringSFByYear, inPlaceExpiringSFByYear, aboveMarketOptions } = commercialMonths(property, a, asOf)
  const rsf = property.physical.rentableSF.value
  const reserves = a.operating.capitalReservesPerYear.value * rsf
  const otherIncomeYear1 = a.operating.otherIncomeYear1?.value ?? 0
  const rentGrowth = a.leasing.marketRentGrowth.value
  const years = Array.from({ length: holdYears + 1 }, (_, i) => {
    const slice = months.slice(i * 12, i * 12 + 12)
    const sum = (k: keyof (typeof months)[number]) => slice.reduce((s, r) => s + r[k], 0)
    const inputs: OperatingInputs = {
      occupancy: rsf ? sum('occupiedSF') / 12 / rsf : 0,
      grossPotentialRent: sum('grossPotentialRent'),
      lossToLease: 0,
      absorptionTurnoverVacancy: sum('absorptionTurnoverVacancy'),
      freeRent: sum('freeRent'),
      expenseRecoveries: sum('expenseRecoveries'),
      otherIncome: otherIncomeYear1 * Math.pow(1 + rentGrowth, i),
      propertyExpenses: sum('totalExpenses'),
      tenantImprovements: sum('tenantImprovements'),
      leasingCommissions: sum('leasingCommissions'),
      capitalReserves: reserves,
    }
    return applyWaterfall(i + 1, inputs, a.operating)
  })
  return { years, expiringSFByYear, inPlaceExpiringSFByYear, aboveMarketOptions }
}
