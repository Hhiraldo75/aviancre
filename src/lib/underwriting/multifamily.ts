import type { Property, UnderwritingAssumptions } from '../../types'
import type { OperatingInputs } from './waterfall'

/**
 * Simple unit-type model. In-place rents grow with the market and close the
 * loss-to-lease gap as units turn over; vacant units are carried at market.
 * General vacancy (applied in the waterfall) stands in for physical vacancy.
 */
export function multifamilyYears(property: Property, a: UnderwritingAssumptions): OperatingInputs[] {
  const rr = property.rentRoll
  if (rr.kind !== 'multifamily') throw new Error(`${property.id} is not multifamily`)
  const mf = a.multifamily
  if (!mf) throw new Error(`${property.id}: multifamily assumptions are missing`)
  const years = a.acquisition.holdYears.value + 1
  const g = a.leasing.marketRentGrowth.value
  const expenseGrowth = a.operating.expenseGrowth.value
  const turnover = mf.turnoverRate.value
  const units = rr.unitTypes.reduce((s, u) => s + u.unitCount, 0)
  const occupied = rr.unitTypes.reduce((s, u) => s + u.occupiedUnits, 0)
  const expensesYear1 = a.operating.expenses.reduce((s, e) => s + e.annualAmount.value, 0)

  return Array.from({ length: years }, (_, i) => {
    const rentGrowth = Math.pow(1 + g, i)
    const costGrowth = Math.pow(1 + expenseGrowth, i)
    let grossPotentialRent = 0
    for (const u of rr.unitTypes) {
      const market1 = u.marketRentMonthly.value
      const inPlace1 = u.inPlaceRentMonthly?.value ?? market1
      const market = market1 * rentGrowth
      const inPlace = market - (market1 - inPlace1) * rentGrowth * Math.pow(1 - turnover, i)
      grossPotentialRent += (u.occupiedUnits * inPlace + (u.unitCount - u.occupiedUnits) * market) * 12
    }
    return {
      occupancy: units ? occupied / units : 0,
      grossPotentialRent,
      absorptionTurnoverVacancy: 0,
      freeRent: 0,
      expenseRecoveries: 0,
      otherIncome: (rr.otherIncomePerUnitMonthly?.value ?? 0) * units * 12 * rentGrowth,
      propertyExpenses: expensesYear1 * costGrowth,
      tenantImprovements: units * turnover * mf.turnoverCostPerUnit.value * costGrowth,
      leasingCommissions: 0,
      capitalReserves: units * a.operating.capitalReservesPerYear.value,
    }
  })
}
