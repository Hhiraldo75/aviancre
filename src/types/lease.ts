import type { DataSource, ISODate, Pct, SF, Sourced, USD } from './common'

/**
 * Commercial lease structure. Determines who pays operating expenses.
 * - NNN:                 tenant pays its pro-rata share of taxes, insurance and CAM
 * - modified-gross:      landlord pays expenses up to a base year or stop, tenant pays the excess
 * - full-service-gross:  landlord pays all operating expenses (typical for multi-tenant office)
 */
export type LeaseType = 'NNN' | 'modified-gross' | 'full-service-gross'

/**
 * How operating expenses are passed through to the tenant.
 * - net:          tenant reimburses its pro-rata share of all recoverable expenses
 * - base-year:    tenant reimburses increases over the expenses in its base year
 * - expense-stop: tenant reimburses expenses above a fixed $/SF stop
 * - none:         landlord absorbs everything
 */
export type Recovery =
  | { method: 'none' }
  | { method: 'net'; adminFeePct?: Pct }
  | {
      method: 'base-year'
      baseYear: number
      /**
       * Building-wide recoverable expenses in the base year, $/yr, from the lease
       * abstract. Omitted = estimated from year-1 expenses grown at expense growth.
       */
      baseYearExpenses?: USD
    }
  | { method: 'expense-stop'; stopPerSF: USD }

/** A scheduled rent change on a specific date. */
export interface RentStep {
  effectiveDate: ISODate
  /** Annual base rent per SF from this date forward. */
  annualRentPerSF: USD
}

/** How base rent grows during the lease term. */
export type Escalation =
  | { type: 'none' }
  | { type: 'fixed-percent'; annualPct: Pct }
  | { type: 'fixed-amount'; annualPerSF: USD }
  | { type: 'steps'; steps: RentStep[] }

export interface RenewalOption {
  termMonths: number
  /** fixed = a set $/SF; percent-of-market = e.g. 0.95 of market rent at renewal. */
  rentBasis: 'fixed' | 'percent-of-market'
  value: number
  /** Annual escalation during the option term for a fixed option; omitted = flat rent. */
  annualEscalationPct?: Pct
  noticeMonths?: number
}

/** Rough tenant credit quality, used for credit-loss and renewal assumptions. */
export type TenantCredit = 'investment-grade' | 'national' | 'regional' | 'local'

/** One in-place commercial lease (one row of a rent roll). */
export interface Lease {
  id: string
  tenantName: string
  suite: string
  leasedSF: SF
  /** Floors the lease occupies (1 = ground). Drives the stacking plan; SF is split evenly. */
  floors?: number[]
  /** Optional industry tag for tenant-mix analysis. */
  industry?: string
  commencementDate: ISODate
  expirationDate: ISODate
  /** Annual base rent per SF at commencement (before escalations). */
  startingRentPerSF: USD
  escalation: Escalation
  leaseType: LeaseType
  recovery: Recovery
  freeRentMonths?: number
  tiPerSF?: USD
  renewalOptions?: RenewalOption[]
  credit?: TenantCredit
  /** Provenance for the whole row (an imported rent roll vs. a placeholder). */
  source: DataSource
  sourceName: string
}

/** A vacant suite available for lease. */
export interface VacantSpace {
  id: string
  suite: string
  sf: SF
  /** Floors the vacant space sits on (1 = ground). */
  floors?: number[]
  /** Asking rent, if marketed; otherwise the underwriting uses market rent. */
  askingRentPerSF?: Sourced<USD>
  /** Months until expected lease-up (absorption assumption). */
  expectedLeaseUpMonths?: number
}

export interface CommercialRentRoll {
  kind: 'commercial'
  leases: Lease[]
  vacancies: VacantSpace[]
}

/** A group of identical apartments (e.g. all 1BR/1BA units). */
export interface UnitType {
  id: string
  label: string
  unitCount: number
  occupiedUnits: number
  avgSF: SF
  marketRentMonthly: Sourced<USD>
  /** Average in-place rent; when missing, underwriting assumes market. */
  inPlaceRentMonthly?: Sourced<USD>
}

/** One apartment from a unit-level rent roll (imported deals). Rents are $/month. */
export interface ApartmentUnit {
  unit: string
  /** The UnitType id this unit is grouped under. */
  floorPlan: string
  sf: SF
  occupied: boolean
  marketRentMonthly: USD
  /** 0 when vacant. */
  inPlaceRentMonthly: USD
  otherIncomeMonthly: USD
  moveInDate?: ISODate
  /** Omitted for a vacant unit or a month-to-month tenant. */
  leaseEndDate?: ISODate
  /** Delinquent balance (+) or prepaid credit (−); reported, not modeled. */
  balanceOwed: USD
  /** A vacant unit with a signed applicant, or an occupied unit on notice whose next resident has signed. */
  preLeased: boolean
  /** The signed future lease's rent, $/month, when the file gives one (pre-leased units only); otherwise the next lease is at market. */
  futureRentMonthly?: USD
}

export interface MultifamilyRentRoll {
  kind: 'multifamily'
  unitTypes: UnitType[]
  /** Unit by unit, when imported from a unit rent roll; the engine then rolls each lease at its lease end. */
  units?: ApartmentUnit[]
  /** Parking, laundry, pet fees, etc., per occupied unit per month. */
  otherIncomePerUnitMonthly?: Sourced<USD>
}

/**
 * Discriminated union: check `rentRoll.kind` to know which shape you have.
 * Commercial assets are underwritten lease-by-lease; multifamily by unit type.
 */
export type RentRoll = CommercialRentRoll | MultifamilyRentRoll
