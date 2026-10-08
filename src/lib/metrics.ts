import type { ISODate, Lease, Property } from '../types'

/**
 * Pure, testable property metrics. Every function takes an `asOf` date so
 * results are reproducible and the future timeline slider can reuse them.
 */

export function todayISO(): ISODate {
  return new Date().toISOString().slice(0, 10)
}

/** Whole years elapsed from `from` to `to` (floor). Used for annual escalations. */
export function wholeYearsBetween(from: ISODate, to: ISODate): number {
  const a = new Date(from)
  const b = new Date(to)
  let years = b.getUTCFullYear() - a.getUTCFullYear()
  const anniversaryPassed =
    b.getUTCMonth() > a.getUTCMonth() ||
    (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() >= a.getUTCDate())
  if (!anniversaryPassed) years -= 1
  return Math.max(0, years)
}

/** Fractional years between two dates (for WALT). */
export function yearsBetween(from: ISODate, to: ISODate): number {
  return (Date.parse(to) - Date.parse(from)) / (365.25 * 24 * 3600 * 1000)
}

export function isLeaseActive(lease: Lease, asOf: ISODate): boolean {
  return lease.commencementDate <= asOf && lease.expirationDate >= asOf
}

/** Annual base rent per SF in effect on `asOf`, after escalations. */
export function currentRentPerSF(lease: Lease, asOf: ISODate): number {
  const esc = lease.escalation
  const years = wholeYearsBetween(lease.commencementDate, asOf)
  switch (esc.type) {
    case 'none':
      return lease.startingRentPerSF
    case 'fixed-percent':
      return lease.startingRentPerSF * Math.pow(1 + esc.annualPct, years)
    case 'fixed-amount':
      return lease.startingRentPerSF + esc.annualPerSF * years
    case 'steps': {
      const applicable = esc.steps
        .filter((s) => s.effectiveDate <= asOf)
        .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
      return applicable.length ? applicable[applicable.length - 1].annualRentPerSF : lease.startingRentPerSF
    }
  }
}

export function activeLeases(property: Property, asOf: ISODate): Lease[] {
  if (property.rentRoll.kind !== 'commercial') return []
  return property.rentRoll.leases.filter((l) => isLeaseActive(l, asOf))
}

/** Physical occupancy: leased SF / rentable SF, or occupied units / total units. */
export function occupancy(property: Property, asOf: ISODate): number {
  const rr = property.rentRoll
  if (rr.kind === 'multifamily') {
    const units = rr.unitTypes.reduce((s, u) => s + u.unitCount, 0)
    const occupied = rr.unitTypes.reduce((s, u) => s + u.occupiedUnits, 0)
    return units ? occupied / units : 0
  }
  const rsf = property.physical.rentableSF.value
  const leased = activeLeases(property, asOf).reduce((s, l) => s + l.leasedSF, 0)
  return rsf ? leased / rsf : 0
}

/** Annual in-place base rent (commercial) or annualized in-place rent (multifamily). */
export function inPlaceAnnualRent(property: Property, asOf: ISODate): number {
  const rr = property.rentRoll
  if (rr.kind === 'multifamily') {
    return rr.unitTypes.reduce(
      (s, u) => s + u.occupiedUnits * (u.inPlaceRentMonthly?.value ?? u.marketRentMonthly.value) * 12,
      0,
    )
  }
  return activeLeases(property, asOf).reduce((s, l) => s + l.leasedSF * currentRentPerSF(l, asOf), 0)
}

/**
 * Average in-place rent in the same basis as market rent:
 * $/SF/yr for commercial, $/unit/month for multifamily.
 */
export function averageInPlaceRent(property: Property, asOf: ISODate): number | null {
  const rr = property.rentRoll
  if (rr.kind === 'multifamily') {
    const occupied = rr.unitTypes.reduce((s, u) => s + u.occupiedUnits, 0)
    return occupied ? inPlaceAnnualRent(property, asOf) / 12 / occupied : null
  }
  const leasedSF = activeLeases(property, asOf).reduce((s, l) => s + l.leasedSF, 0)
  return leasedSF ? inPlaceAnnualRent(property, asOf) / leasedSF : null
}

/**
 * Mark-to-market: how far market rent sits above (+) or below (−) in-place rent.
 * +0.20 means in-place rents are 20% below market – embedded upside.
 */
export function markToMarket(property: Property, asOf: ISODate): number | null {
  const inPlace = averageInPlaceRent(property, asOf)
  if (!inPlace) return null
  return property.market.marketRent.value / inPlace - 1
}

/**
 * Weighted average lease term remaining, in years, weighted by SF. Commercial only.
 * Leases active on `asOf`; term measured from `from` (e.g. the analysis start), never below zero.
 */
export function walt(property: Property, asOf: ISODate, from: ISODate = asOf): number | null {
  const leases = activeLeases(property, asOf)
  const totalSF = leases.reduce((s, l) => s + l.leasedSF, 0)
  if (!totalSF) return null
  return leases.reduce((s, l) => s + l.leasedSF * Math.max(0, yearsBetween(from, l.expirationDate)), 0) / totalSF
}

export function monthsUntil(asOf: ISODate, date: ISODate): number {
  return yearsBetween(asOf, date) * 12
}

/** Active leases expiring within `months` of `asOf`, soonest first. */
export function expiringWithin(property: Property, asOf: ISODate, months: number): Lease[] {
  return activeLeases(property, asOf)
    .filter((l) => monthsUntil(asOf, l.expirationDate) <= months)
    .sort((a, b) => a.expirationDate.localeCompare(b.expirationDate))
}

/** Map color bucket for occupancy; shared by the map layer and the legend. */
export const OCCUPANCY_BUCKETS = [
  { label: 'Under 80% leased', min: 0, color: '#ef4444' },
  { label: '80–90% leased', min: 0.8, color: '#f59e0b' },
  { label: '90%+ leased', min: 0.9, color: '#22c55e' },
] as const

export function occupancyColor(occ: number): string {
  let color: string = OCCUPANCY_BUCKETS[0].color
  for (const b of OCCUPANCY_BUCKETS) if (occ >= b.min) color = b.color
  return color
}
