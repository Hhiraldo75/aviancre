import type { LeasingTerms, MarketLeasingAssumptions } from '../../types'

/**
 * Argus-style rollover: when a lease expires, the next lease is a probability
 * weighted blend of "the tenant renews" and "a new tenant signs".
 */

/** Plain-number leasing terms (the engine works on values, not Sourced wrappers). */
export interface Terms {
  termMonths: number
  freeRentMonths: number
  tiPerSF: number
  leasingCommissionPct: number
}

export function termsOf(t: LeasingTerms): Terms {
  return {
    termMonths: t.termMonths.value,
    freeRentMonths: t.freeRentMonths.value,
    tiPerSF: t.tiPerSF.value,
    leasingCommissionPct: t.leasingCommissionPct.value,
  }
}

export interface BlendedLease {
  /** Months vacant before the next tenant occupies (may be fractional). */
  downtimeMonths: number
  /** Months of abated base rent once occupied (may be fractional). */
  freeRentMonths: number
  /** Starting annual base rent per SF. */
  rentPerSF: number
  /** Whole months of lease term after downtime. */
  termMonths: number
  tiPerSF: number
  /** Leasing commission in dollars per SF of space. */
  lcPerSF: number
}

/**
 * Total scheduled base rent per SF over a lease term (before free rent), with
 * the rent stepping up by `escalationPct` on each anniversary.
 */
export function leaseValuePerSF(rentPerSF: number, termMonths: number, escalationPct: number): number {
  let total = 0
  for (let i = 0; i < termMonths; i++) total += (rentPerSF * Math.pow(1 + escalationPct, Math.floor(i / 12))) / 12
  return total
}

/**
 * Weighted-average terms for the lease that follows an expiration.
 * Downtime, free rent, TI and rent are blended directly; leasing commissions
 * are blended in dollars because new and renewal leases have different values.
 */
export function blendTerms(
  renewalProbability: number,
  downtimeMonths: number,
  newLease: Terms,
  renewal: Terms,
  newRentPerSF: number,
  renewalRentPerSF: number,
  escalationPct: number,
): BlendedLease {
  const p = renewalProbability
  const w = (renewalValue: number, newValue: number) => p * renewalValue + (1 - p) * newValue
  const newLC = newLease.leasingCommissionPct * leaseValuePerSF(newRentPerSF, newLease.termMonths, escalationPct)
  const renewalLC = renewal.leasingCommissionPct * leaseValuePerSF(renewalRentPerSF, renewal.termMonths, escalationPct)
  return {
    downtimeMonths: w(0, downtimeMonths),
    freeRentMonths: w(renewal.freeRentMonths, newLease.freeRentMonths),
    rentPerSF: w(renewalRentPerSF, newRentPerSF),
    termMonths: Math.round(w(renewal.termMonths, newLease.termMonths)),
    tiPerSF: w(renewal.tiPerSF, newLease.tiPerSF),
    lcPerSF: w(renewalLC, newLC),
  }
}

/** Market rent in a given analysis year (1-based), grown annually from year 1. */
export function marketRentInYear(leasing: MarketLeasingAssumptions, year: number): number {
  return leasing.marketRent.value * Math.pow(1 + leasing.marketRentGrowth.value, year - 1)
}

/** Length of the overlap between [a0, a1) and [b0, b1). */
export function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}
