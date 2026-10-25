import type { Renovation, ValueAddAssumptions, ValueAddPlan } from '../../types'

/**
 * Which units the value-add plan renovates, and in which month. Worked out
 * before the cash flows: until it is renovated, a unit rolls where the unit
 * model has it (first roll, then every 12 months), so the schedule only needs
 * each unit's first roll. Months are 0-based here (m = 0 is analysis month 1).
 */

export interface RollingUnit {
  /** 0-based month of the first roll: an occupied unit's lease end, a vacant unit's first lease. */
  firstRoll: number
  /** The first roll is a signed lease (pre-leased), so it can't be renovated. */
  signed: boolean
}

export interface ScheduledRenovation {
  /** 0-based start month; null when the unit isn't renovated. */
  month: number | null
  /** Eligible rolls passed over because the month's pace was full. */
  passedOver: number
}

/**
 * Walks the months from the start month through the last hold month. Within a
 * month, units are taken in rent-roll order; a unit rolling there is renovated
 * while fewer than the pace have started that month and the target isn't
 * reached. A unit passed over renews normally and waits for its next roll.
 */
export function renovationSchedule(units: RollingUnit[], va: ValueAddAssumptions, holdYears: number): ScheduledRenovation[] {
  const out: ScheduledRenovation[] = units.map(() => ({ month: null, passedOver: 0 }))
  const target = targetUnits(va)
  const end = holdYears * 12
  let total = 0
  for (let m = Math.max(0, va.startMonth.value - 1); m < end && total < target; m++) {
    let started = 0
    for (let i = 0; i < units.length && total < target; i++) {
      const u = units[i]
      const k = m - u.firstRoll
      if (out[i].month !== null || k < 0 || k % 12 !== 0 || (k === 0 && u.signed)) continue
      if (started < va.maxPerMonth.value) {
        out[i].month = m
        started++
        total++
      } else {
        out[i].passedOver++
      }
    }
  }
  return out
}

/** Units to renovate, never more than the rent roll has. */
export const targetUnits = (va: ValueAddAssumptions) => Math.min(va.unitCount.value, va.units)

/** The plan's totals: the reserve is the full budget; whatever isn't drawn returns at sale. */
export function valueAddPlan(va: ValueAddAssumptions, renovations: Renovation[]): ValueAddPlan {
  const target = targetUnits(va)
  const cost = va.costPerUnit.value
  const reserve = target * cost
  const spent = renovations.length * cost
  const done = renovations.length === target && target > 0
  return {
    target,
    renovated: renovations.length,
    reserve,
    spent,
    unspent: reserve - spent,
    finishMonth: done ? Math.max(...renovations.map((r) => r.releaseMonth)) : null,
    renovations,
  }
}
