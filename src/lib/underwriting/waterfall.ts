import type { ISODate, OperatingAssumptions, Property, UnderwritingAssumptions } from '../../types'
import { commercialMonths } from './commercial'
import { multifamilyYears } from './multifamily'

/**
 * Annual revenue and cost lines before the waterfall percentages are applied.
 * Losses (vacancy, free rent) and costs are positive amounts.
 */
export interface OperatingInputs {
  occupancy: number
  grossPotentialRent: number
  absorptionTurnoverVacancy: number
  freeRent: number
  expenseRecoveries: number
  otherIncome: number
  /** Operating expenses before the management fee. */
  propertyExpenses: number
  tenantImprovements: number
  leasingCommissions: number
  capitalReserves: number
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
 * rollover and lease-up vacancy didn't already account for.
 */
export function generalVacancy(rate: number, potentialRevenue: number, modeledVacancy: number): number {
  return Math.max(0, rate * potentialRevenue - modeledVacancy)
}

/** Applies vacancy, credit loss and management fee to one year of inputs. */
export function applyWaterfall(year: number, x: OperatingInputs, op: OperatingAssumptions): OperatingYear {
  const potential = x.grossPotentialRent + x.expenseRecoveries + x.otherIncome
  const gv = generalVacancy(op.generalVacancyPct.value, potential, x.absorptionTurnoverVacancy)
  const beforeCredit = potential - x.absorptionTurnoverVacancy - x.freeRent - gv
  const creditLoss = op.creditLossPct.value * beforeCredit
  const egi = beforeCredit - creditLoss
  const managementFee = op.managementFeePct.value * egi
  const operatingExpenses = x.propertyExpenses + managementFee
  const noi = egi - operatingExpenses
  return {
    ...x,
    year,
    generalVacancy: gv,
    creditLoss,
    effectiveGrossIncome: egi,
    managementFee,
    operatingExpenses,
    netOperatingIncome: noi,
    cashFlowBeforeDebt: noi - x.tenantImprovements - x.leasingCommissions - x.capitalReserves,
  }
}

/**
 * Stabilizes a year for valuation: drops absorption/turnover vacancy and free
 * rent, so the full general vacancy rate applies instead. A buyer capitalizes
 * a normal year, not one that happens to have a lease in downtime.
 */
export function normalizeForExit(y: OperatingYear, op: OperatingAssumptions): OperatingYear {
  return applyWaterfall(y.year, { ...y, absorptionTurnoverVacancy: 0, freeRent: 0 }, op)
}

export interface OperatingResult {
  /** Years 1..hold+1. */
  years: OperatingYear[]
  /** SF rolling in each year (commercial only; zeros for multifamily). */
  expiringSFByYear: number[]
}

/** Property-level cash flows before debt for every year of the hold plus the forward year. */
export function operatingCashFlows(property: Property, a: UnderwritingAssumptions, asOf: ISODate): OperatingResult {
  const holdYears = a.acquisition.holdYears.value
  if (property.rentRoll.kind === 'multifamily') {
    const years = multifamilyYears(property, a).map((x, i) => applyWaterfall(i + 1, x, a.operating))
    return { years, expiringSFByYear: Array.from({ length: holdYears + 1 }, () => 0) }
  }

  const { months, expiringSFByYear } = commercialMonths(property, a, asOf)
  const rsf = property.physical.rentableSF.value
  const reserves = a.operating.capitalReservesPerYear.value * rsf
  const years = Array.from({ length: holdYears + 1 }, (_, i) => {
    const slice = months.slice(i * 12, i * 12 + 12)
    const sum = (k: keyof (typeof months)[number]) => slice.reduce((s, r) => s + r[k], 0)
    const inputs: OperatingInputs = {
      occupancy: rsf ? sum('occupiedSF') / 12 / rsf : 0,
      grossPotentialRent: sum('grossPotentialRent'),
      absorptionTurnoverVacancy: sum('absorptionTurnoverVacancy'),
      freeRent: sum('freeRent'),
      expenseRecoveries: sum('expenseRecoveries'),
      otherIncome: 0,
      propertyExpenses: sum('totalExpenses'),
      tenantImprovements: sum('tenantImprovements'),
      leasingCommissions: sum('leasingCommissions'),
      capitalReserves: reserves,
    }
    return applyWaterfall(i + 1, inputs, a.operating)
  })
  return { years, expiringSFByYear }
}
