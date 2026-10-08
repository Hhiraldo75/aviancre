import type { ISODate, Lease, Property, Recovery, UnderwritingAssumptions } from '../../types'
import { activeLeases, currentRentPerSF } from '../metrics'
import { monthlyRecovery } from './recoveries'
import { blendTerms, marketRentInYear, overlap, termsOf } from './rollover'
import { analysisYear, calendarYear, monthAfter, monthStart } from './timeline'

/** One month of commercial revenue and leasing cost, summed across all spaces. */
export interface MonthRow {
  grossPotentialRent: number
  absorptionTurnoverVacancy: number
  freeRent: number
  expenseRecoveries: number
  tenantImprovements: number
  leasingCommissions: number
  /** Building-wide recoverable expenses this month (before recoveries). */
  recoverableExpenses: number
  /** Building-wide expenses this month, recoverable or not. */
  totalExpenses: number
  /** SF covered by a lease or vacant space (should equal rentable SF). */
  potentialSF: number
  /** SF actually occupied this month (fractional months count partially). */
  occupiedSF: number
}

/** A fixed renewal option priced above market when the lease expires (the tenant won't exercise it). */
export interface AboveMarketOption {
  tenant: string
  suite: string
  expirationDate: ISODate
  optionRentPerSF: number
  marketRentPerSF: number
}

export interface CommercialMonths {
  months: MonthRow[]
  /** SF whose lease ends in each analysis year (index 0 = year 1), in-place and speculative. */
  expiringSFByYear: number[]
  /** Fixed renewal options above market at expiration, within the modeled horizon. */
  aboveMarketOptions: AboveMarketOption[]
}

const emptyRow = (): MonthRow => ({
  grossPotentialRent: 0,
  absorptionTurnoverVacancy: 0,
  freeRent: 0,
  expenseRecoveries: 0,
  tenantImprovements: 0,
  leasingCommissions: 0,
  recoverableExpenses: 0,
  totalExpenses: 0,
  potentialSF: 0,
  occupiedSF: 0,
})

/** Index of the first month whose 1st falls on or after `date`. */
function firstMonthOnOrAfter(start: ISODate, date: ISODate): number {
  return monthAfter(start, date) - (date.endsWith('-01') ? 1 : 0)
}

/**
 * Monthly lease-by-lease cash flows for a commercial property: in-place leases
 * to expiration, then a chain of blended speculative leases; vacant suites
 * lease up on new-tenant terms and then roll the same way.
 */
export function commercialMonths(property: Property, a: UnderwritingAssumptions, asOf: ISODate): CommercialMonths {
  if (property.rentRoll.kind !== 'commercial') throw new Error(`${property.id} is not commercial`)
  const start = a.acquisition.analysisStartDate
  const holdYears = a.acquisition.holdYears.value
  const N = (holdYears + 1) * 12
  const rsf = property.physical.rentableSF.value
  const startCalYear = calendarYear(start)
  const { leasing, operating } = a
  const growth = operating.expenseGrowth.value
  const newTerms = termsOf(leasing.newLease)
  const renewalTerms = termsOf(leasing.renewal)
  const escalation = leasing.newLeaseEscalationPct.value

  const recoverableYear1 = operating.expenses.filter((e) => e.recoverable).reduce((s, e) => s + e.annualAmount.value, 0)
  const totalYear1 = operating.expenses.reduce((s, e) => s + e.annualAmount.value, 0)
  const growthFactor = (m: number) => Math.pow(1 + growth, analysisYear(m) - 1)
  /** Monthly recoverable expenses in a calendar base year (calendar year Y ≙ analysis year Y − startCalYear + 1). */
  const baseYearMonthly = (baseYear: number) => (recoverableYear1 / 12) * Math.pow(1 + growth, baseYear - startCalYear)

  const months: MonthRow[] = Array.from({ length: N }, (_, m) => ({
    ...emptyRow(),
    recoverableExpenses: (recoverableYear1 / 12) * growthFactor(m),
    totalExpenses: (totalYear1 / 12) * growthFactor(m),
  }))
  const expiringSFByYear = Array.from({ length: holdYears + 1 }, () => 0)
  const aboveMarketOptions: AboveMarketOption[] = []
  const recordExpiration = (endMonth: number, sf: number) => {
    // endMonth is the first month no longer covered; the lease's last month is endMonth − 1.
    if (endMonth >= 1 && endMonth <= N) expiringSFByYear[analysisYear(endMonth - 1) - 1] += sf
  }
  const recoveryFor = (recovery: Recovery, sf: number, m: number) => {
    const base = recovery.method === 'base-year' ? baseYearMonthly(recovery.baseYear) : 0
    return monthlyRecovery(recovery, sf, rsf, months[m].recoverableExpenses, base)
  }

  /**
   * Speculative leases from continuous month `s` until the grid ends.
   * The first lease may use lease-up terms (vacant suite) or the expiring
   * tenant's renewal option.
   */
  const rollChain = (
    sf: number,
    s: number,
    recovery: Recovery,
    first: {
      downtimeMonths: number
      renewalProbability: number
      rentPerSF?: number
      renewalRentPerSF?: number
      /** Escalation of the renewal leg for the LC calculation; defaults to the new-lease rate. */
      renewalEscalationPct?: number
    },
  ) => {
    let next = first
    while (s < N) {
      // Blended downtime: renewals have none, new tenants have the full downtime.
      const occStart = s + (1 - next.renewalProbability) * next.downtimeMonths
      const marketRent = marketRentInYear(leasing, analysisYear(Math.floor(occStart)))
      const newRent = next.rentPerSF ?? marketRent
      const lease = blendTerms(
        next.renewalProbability,
        next.downtimeMonths,
        newTerms,
        renewalTerms,
        newRent,
        next.renewalRentPerSF ?? newRent,
        escalation,
        next.renewalEscalationPct,
      )
      if (lease.termMonths < 1) break
      const occEnd = occStart + lease.termMonths
      const leaseRecovery: Recovery =
        recovery.method === 'base-year'
          ? { method: 'base-year', baseYear: startCalYear + analysisYear(Math.floor(occStart)) - 1 }
          : recovery

      const firstOccupied = Math.floor(occStart)
      if (firstOccupied < N) {
        months[firstOccupied].tenantImprovements += lease.tiPerSF * sf
        months[firstOccupied].leasingCommissions += lease.lcPerSF * sf
      }
      for (let m = Math.floor(s); m < Math.min(N, Math.ceil(occEnd)); m++) {
        const potential = overlap(m, m + 1, s, occEnd)
        const occupied = overlap(m, m + 1, occStart, occEnd)
        const free = overlap(m, m + 1, occStart, occStart + lease.freeRentMonths)
        const leaseYear = Math.floor(Math.max(0, Math.max(m, occStart) - occStart) / 12)
        const monthlyRent = (lease.rentPerSF * Math.pow(1 + escalation, leaseYear) * sf) / 12
        const row = months[m]
        row.grossPotentialRent += potential * monthlyRent
        row.absorptionTurnoverVacancy += (potential - occupied) * monthlyRent
        row.freeRent += free * monthlyRent
        row.expenseRecoveries += occupied * recoveryFor(leaseRecovery, sf, m)
        row.potentialSF += potential * sf
        row.occupiedSF += occupied * sf
      }
      recordExpiration(Math.ceil(occEnd), sf)
      s = occEnd
      next = { downtimeMonths: leasing.downtimeMonths.value, renewalProbability: leasing.renewalProbability.value }
    }
  }

  for (const lease of activeLeases(property, asOf)) {
    const endMonth = Math.min(N, monthAfter(start, lease.expirationDate))
    const freeEnd = firstMonthOnOrAfter(start, lease.commencementDate) + (lease.freeRentMonths ?? 0)
    for (let m = 0; m < endMonth; m++) {
      const rent = (currentRentPerSF(lease, monthStart(start, m)) * lease.leasedSF) / 12
      const row = months[m]
      row.grossPotentialRent += rent
      if (m < freeEnd) row.freeRent += rent
      row.expenseRecoveries += recoveryFor(lease.recovery, lease.leasedSF, m)
      row.potentialSF += lease.leasedSF
      row.occupiedSF += lease.leasedSF
    }
    recordExpiration(endMonth, lease.leasedSF)
    const option = renewalOption(lease, leasing, analysisYear(endMonth))
    if (option?.aboveMarket && endMonth < N) {
      aboveMarketOptions.push({
        tenant: lease.tenantName,
        suite: lease.suite,
        expirationDate: lease.expirationDate,
        optionRentPerSF: option.optionRentPerSF,
        marketRentPerSF: option.marketRentPerSF,
      })
    }
    rollChain(lease.leasedSF, endMonth, lease.recovery, {
      downtimeMonths: leasing.downtimeMonths.value,
      renewalProbability: leasing.renewalProbability.value,
      renewalRentPerSF: option?.rentPerSF,
      renewalEscalationPct: option?.escalationPct,
    })
  }

  // rollChain resets a base year to the lease's start year, so startCalYear is only a placeholder here.
  const vacantRecovery: Recovery =
    leasing.vacantSpaceRecovery === 'base-year'
      ? { method: 'base-year', baseYear: startCalYear }
      : { method: leasing.vacantSpaceRecovery }
  for (const v of property.rentRoll.vacancies) {
    rollChain(v.sf, 0, vacantRecovery, {
      downtimeMonths: v.expectedLeaseUpMonths ?? leasing.downtimeMonths.value,
      renewalProbability: 0,
      rentPerSF: v.askingRentPerSF?.value,
    })
  }

  return { months, expiringSFByYear, aboveMarketOptions }
}

export interface RenewalOptionTerms {
  /** Renewal rent the model uses. */
  rentPerSF: number
  /** Escalation of the renewal leg; undefined = the normal new-lease rate. */
  escalationPct?: number
  optionRentPerSF: number
  marketRentPerSF: number
  aboveMarket: boolean
}

/**
 * Renewal terms from the expiring lease's first renewal option, if it has one.
 * A fixed option is exercised only when it's at or below market; then it is
 * flat unless the option says it escalates. Above market, the tenant renews at
 * market like any other renewal.
 */
export function renewalOption(
  lease: Lease,
  leasing: UnderwritingAssumptions['leasing'],
  year: number,
): RenewalOptionTerms | undefined {
  const option = lease.renewalOptions?.[0]
  if (!option) return undefined
  const market = marketRentInYear(leasing, year)
  if (option.rentBasis === 'percent-of-market') {
    const rent = option.value * market
    return { rentPerSF: rent, optionRentPerSF: rent, marketRentPerSF: market, aboveMarket: false }
  }
  const aboveMarket = option.value > market
  return aboveMarket
    ? { rentPerSF: market, optionRentPerSF: option.value, marketRentPerSF: market, aboveMarket }
    : {
        rentPerSF: option.value,
        escalationPct: option.annualEscalationPct ?? 0,
        optionRentPerSF: option.value,
        marketRentPerSF: market,
        aboveMarket,
      }
}
