import type { ApartmentUnit, MultifamilyAssumptions, Property, Renovation, UnderwritingAssumptions, ValueAddPlan } from '../../types'
import { renovationSchedule, valueAddPlan } from './renovations'
import { analysisYear, monthAfter } from './timeline'
import type { OperatingInputs } from './waterfall'

export interface MultifamilyYears {
  years: OperatingInputs[]
  /** Present when the value-add plan is on. */
  valueAdd?: ValueAddPlan
}

/**
 * Simple unit-type model. In-place rents grow with the market and close the
 * loss-to-lease gap as units turn over; vacant units are carried at market.
 * General vacancy (applied in the waterfall) stands in for physical vacancy.
 * GPR is every unit at market; loss to lease is market minus in-place on
 * occupied units.
 * A unit rent roll (imported) runs the unit-level model instead.
 */
export function multifamilyYears(property: Property, a: UnderwritingAssumptions): MultifamilyYears {
  const rr = property.rentRoll
  if (rr.kind !== 'multifamily') throw new Error(`${property.id} is not multifamily`)
  const mf = a.multifamily
  if (!mf) throw new Error(`${property.id}: multifamily assumptions are missing`)
  if (rr.units) return unitYears(property, rr.units, a, mf)
  const years = a.acquisition.holdYears.value + 1
  const g = a.leasing.marketRentGrowth.value
  const expenseGrowth = a.operating.expenseGrowth.value
  const turnover = mf.turnoverRate.value
  const units = rr.unitTypes.reduce((s, u) => s + u.unitCount, 0)
  const occupied = rr.unitTypes.reduce((s, u) => s + u.occupiedUnits, 0)
  const expensesYear1 = a.operating.expenses.reduce((s, e) => s + e.annualAmount.value, 0)
  // A T-12's other income replaces the rent roll's.
  const otherIncomeYear1 = a.operating.otherIncomeYear1?.value ?? (rr.otherIncomePerUnitMonthly?.value ?? 0) * units * 12

  const inputs = Array.from({ length: years }, (_, i): OperatingInputs => {
    const rentGrowth = Math.pow(1 + g, i)
    const costGrowth = Math.pow(1 + expenseGrowth, i)
    let grossPotentialRent = 0
    let lossToLease = 0
    for (const u of rr.unitTypes) {
      const market1 = u.marketRentMonthly.value
      const inPlace1 = u.inPlaceRentMonthly?.value ?? market1
      const market = market1 * rentGrowth
      const inPlace = market - (market1 - inPlace1) * rentGrowth * Math.pow(1 - turnover, i)
      grossPotentialRent += u.unitCount * market * 12
      lossToLease += u.occupiedUnits * (market - inPlace) * 12
    }
    return {
      occupancy: units ? occupied / units : 0,
      grossPotentialRent,
      lossToLease,
      absorptionTurnoverVacancy: 0,
      freeRent: 0,
      expenseRecoveries: 0,
      otherIncome: otherIncomeYear1 * rentGrowth,
      propertyExpenses: expensesYear1 * costGrowth,
      tenantImprovements: units * turnover * mf.turnoverCostPerUnit.value * costGrowth,
      leasingCommissions: 0,
      capitalReserves: units * a.operating.capitalReservesPerYear.value,
    }
  })
  return { years: inputs }
}

/**
 * Unit-level model for a unit rent roll, month by month. Each occupied unit
 * pays its in-place rent until its lease end (month 1 when month-to-month or
 * expired), then rolls for 12 months at a time. At each roll the turnover
 * share re-leases at that year's market rent and the rest renews at the lower
 * of market and current rent × (1 + max renewal increase), blended like a
 * commercial renewal probability, so loss to lease burns off over several
 * rolls. Every roll costs turnover rate × turnover cost (the general vacancy
 * floor stands in for make-ready downtime). Vacant units lease at market at
 * the lease-up pace, pre-leased first; until then their rent is absorption vacancy.
 * A unit on notice with a future resident (occupied, pre-leased) skips the
 * renewal blend at its lease end: it goes straight to the signed lease, with a
 * full turnover cost and no downtime. A pre-leased unit's next lease is at the
 * file's future lease rent when it gives one, else at market.
 * With the value-add plan on, a scheduled unit's roll becomes its renovation:
 * a full move-out cost (none at a vacant unit's first lease), the downtime as
 * vacancy at the renovated rent (on top of the general vacancy floor), then a new lease at market + premium; later
 * rolls blend on that rent (docs/UNDERWRITING.md, convention 19).
 */
function unitYears(property: Property, units: ApartmentUnit[], a: UnderwritingAssumptions, mf: MultifamilyAssumptions): MultifamilyYears {
  const pace = mf.leaseUpUnitsPerMonth?.value
  if (!pace || pace <= 0) throw new Error(`${property.id}: the lease-up pace must be above 0 units/month`)
  const years = a.acquisition.holdYears.value + 1
  const months = years * 12
  const start = a.acquisition.analysisStartDate
  const g = a.leasing.marketRentGrowth.value
  const expenseGrowth = a.operating.expenseGrowth.value
  const rentGrowth = (m: number) => Math.pow(1 + g, analysisYear(m) - 1)
  const costGrowth = (m: number) => Math.pow(1 + expenseGrowth, analysisYear(m) - 1)
  const turnoverRate = mf.turnoverRate.value
  const turnoverCost = turnoverRate * mf.turnoverCostPerUnit.value
  const maxRenewal = mf.maxRenewalIncreasePct?.value
  if (maxRenewal === undefined || maxRenewal < 0) throw new Error(`${property.id}: the max renewal increase must be 0% or more`)

  const zeros = () => Array.from({ length: months }, () => 0)
  const rent = zeros()
  const lossToLease = zeros()
  const vacancy = zeros()
  const occupiedUnits = zeros()
  const turnover = zeros()
  const vacant = [...units.filter((u) => !u.occupied && u.preLeased), ...units.filter((u) => !u.occupied && !u.preLeased)]
  // The month the unit starts paying (vacant) and the month its lease first rolls to market.
  const leaseUpOf = (u: ApartmentUnit) => (u.occupied ? 0 : Math.floor(vacant.indexOf(u) / pace))
  const firstRollOf = (u: ApartmentUnit) => (u.occupied ? Math.max(0, u.leaseEndDate ? monthAfter(start, u.leaseEndDate) : 0) : leaseUpOf(u))

  // Value-add plan: renovation months are fixed before the cash flows (see renovations.ts).
  const va = a.valueAdd?.enabled ? a.valueAdd : undefined
  const schedule = va && renovationSchedule(units.map((u) => ({ firstRoll: firstRollOf(u), signed: u.preLeased })), va, a.acquisition.holdYears.value)
  const premium = va?.premiumMonthly.value ?? 0
  const downtime = va?.downtimeMonths.value ?? 0
  const capex = zeros()
  const started = zeros()
  const downtimeVacancy = zeros()
  const renovations: { i: number; r: Renovation }[] = []

  units.forEach((u, i) => {
    const leaseUp = leaseUpOf(u)
    let next = firstRollOf(u)
    let current = u.inPlaceRentMonthly
    // On notice with the next resident signed: the first roll is that lease, not a renewal.
    let signed = u.occupied && u.preLeased
    const renovation = schedule?.[i].month ?? null
    /** The renovated unit is offline before this month and leases again in it. */
    let release = -1
    for (let m = 0; m < months; m++) {
      const market = renovation !== null && m >= renovation ? (u.marketRentMonthly + premium) * rentGrowth(m) : u.marketRentMonthly * rentGrowth(m)
      if (m < leaseUp) {
        rent[m] += market
        vacancy[m] += market
        continue
      }
      if (m === renovation) {
        // The resident moves out (full cost per move-out); a unit renovated before its first lease has no one to move out.
        const atLeaseUp = !u.occupied && m === leaseUp
        const moveOutCost = atLeaseUp ? 0 : mf.turnoverCostPerUnit.value * costGrowth(m)
        turnover[m] += moveOutCost
        capex[m] += va!.costPerUnit.value
        started[m]++
        release = next = m + downtime
        renovations.push({
          i,
          r: {
            unit: u.unit,
            floorPlan: u.floorPlan,
            status: atLeaseUp ? 'lease-up' : 'occupied',
            month: m + 1,
            releaseMonth: release + 1,
            releaseRent: (u.marketRentMonthly + premium) * rentGrowth(release),
            cost: va!.costPerUnit.value,
            moveOutCost,
            passedOver: schedule![i].passedOver,
          },
        })
      }
      if (m < release) {
        rent[m] += market
        vacancy[m] += market
        downtimeVacancy[m] += market
        continue
      }
      if (m === next) {
        if (m === release) {
          // Re-leased after renovation at the renovated market rent, with no renewal blend.
          current = market
        } else {
          const firstLease = m === leaseUp && !u.occupied
          const renewal = Math.min(market, current * (1 + maxRenewal))
          current = firstLease || signed ? (u.futureRentMonthly ?? market) : turnoverRate * market + (1 - turnoverRate) * renewal
          if (signed) turnover[m] += mf.turnoverCostPerUnit.value * costGrowth(m)
          else if (!firstLease) turnover[m] += turnoverCost * costGrowth(m)
          signed = false
        }
        next += 12
      }
      rent[m] += market
      lossToLease[m] += market - current
      occupiedUnits[m]++
    }
  })

  const otherIncomeMonthly = units.reduce((s, u) => s + u.otherIncomeMonthly, 0)
  const otherIncomeYear1 = a.operating.otherIncomeYear1?.value ?? otherIncomeMonthly * 12
  const expensesYear1 = a.operating.expenses.reduce((s, e) => s + e.annualAmount.value, 0)
  const inputs = Array.from({ length: years }, (_, i): OperatingInputs => {
    const sum = (xs: number[]) => xs.slice(i * 12, i * 12 + 12).reduce((s, x) => s + x, 0)
    return {
      occupancy: units.length ? sum(occupiedUnits) / 12 / units.length : 0,
      grossPotentialRent: sum(rent),
      lossToLease: sum(lossToLease),
      absorptionTurnoverVacancy: sum(vacancy),
      freeRent: 0,
      expenseRecoveries: 0,
      otherIncome: otherIncomeYear1 * Math.pow(1 + g, i),
      propertyExpenses: expensesYear1 * Math.pow(1 + expenseGrowth, i),
      tenantImprovements: sum(turnover),
      leasingCommissions: 0,
      capitalReserves: units.length * a.operating.capitalReservesPerYear.value,
      ...(va ? { renovationDowntime: sum(downtimeVacancy), renovationCapex: sum(capex), renovationReserveDraw: sum(capex), unitsRenovated: sum(started) } : {}),
    }
  })
  if (!va) return { years: inputs }
  // By start month, then rent-roll order.
  renovations.sort((x, y) => x.r.month - y.r.month || x.i - y.i)
  return { years: inputs, valueAdd: valueAddPlan(va, renovations.map((x) => x.r)) }
}
