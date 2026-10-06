import type { Bps, ISODate, Pct, Sourced, USD } from './common'

export type Scenario = 'base' | 'downside' | 'value-add'

/** Acquisition basis and hold period. */
export interface AcquisitionAssumptions {
  purchasePrice: Sourced<USD>
  closingCostsPct: Pct
  analysisStartDate: ISODate
  holdYears: number
  /** Upfront capital plan (renovations, deferred maintenance). */
  initialCapex: USD
}

/** Terms used when space is re-leased to a new tenant or renewed. */
export interface LeasingTerms {
  termMonths: number
  freeRentMonths: number
  tiPerSF: USD
  /** Leasing commission as a percent of total base rent over the term. */
  leasingCommissionPct: Pct
}

/** Argus-style market leasing assumptions applied when leases roll. */
export interface MarketLeasingAssumptions {
  /** Year-1 market rent (per SF/yr commercial, per unit/mo multifamily). */
  marketRent: Sourced<USD>
  marketRentGrowth: Pct
  /** Probability an expiring tenant renews; blends new and renewal terms. */
  renewalProbability: Pct
  /** Months a suite sits vacant before a new tenant starts. */
  downtimeMonths: number
  newLease: LeasingTerms
  renewal: LeasingTerms
  /** Annual escalation on newly signed leases. */
  newLeaseEscalationPct: Pct
}

/** One line of the operating expense budget. */
export interface ExpenseLine {
  label: string
  annualAmount: Sourced<USD>
  /** Whether tenants reimburse this line under their recovery terms. */
  recoverable: boolean
}

export interface OperatingAssumptions {
  /** General vacancy applied on top of modeled lease-by-lease vacancy. */
  generalVacancyPct: Pct
  creditLossPct: Pct
  expenses: ExpenseLine[]
  expenseGrowth: Pct
  /** Management fee as a percent of effective gross income. */
  managementFeePct: Pct
  /** Ongoing capital reserves per SF (or per unit) per year. */
  capitalReservesPerYear: USD
}

/** Fixed rate, or floating off an index that can be pulled live from FRED. */
export type InterestRate =
  | { type: 'fixed'; rate: Pct }
  | { type: 'index-plus-spread'; index: 'treasury-10y' | 'sofr'; spreadBps: Bps }

export interface DebtAssumptions {
  enabled: boolean
  /** Loan-to-value at acquisition. */
  ltv: Pct
  rate: InterestRate
  amortizationYears: number
  interestOnlyYears: number
  loanFeesPct: Pct
}

export interface ExitAssumptions {
  exitCapRate: Pct
  sellingCostsPct: Pct
  /** Value on forward (year N+1) NOI, which is standard practice. */
  capForwardNOI: boolean
}

export interface UnderwritingAssumptions {
  scenario: Scenario
  acquisition: AcquisitionAssumptions
  leasing: MarketLeasingAssumptions
  operating: OperatingAssumptions
  debt: DebtAssumptions
  exit: ExitAssumptions
  /** Discount rate for NPV. */
  discountRate: Pct
}

/** One year of the cash flow waterfall. All values in USD. */
export interface AnnualCashFlow {
  year: number
  grossPotentialRent: USD
  /** Vacancy from lease rollover downtime and unleased space. */
  absorptionTurnoverVacancy: USD
  freeRent: USD
  expenseRecoveries: USD
  otherIncome: USD
  generalVacancy: USD
  creditLoss: USD
  effectiveGrossIncome: USD
  operatingExpenses: USD
  netOperatingIncome: USD
  tenantImprovements: USD
  leasingCommissions: USD
  capitalReserves: USD
  cashFlowBeforeDebt: USD
  debtService: USD
  cashFlowAfterDebt: USD
}

export interface UnderwritingMetrics {
  goingInCapRate: Pct
  exitValue: USD
  pricePerSF: USD
  unleveredIRR: Pct
  leveredIRR: Pct | null
  equityMultiple: number
  averageCashOnCash: Pct | null
  minimumDSCR: number | null
  /** Year-1 NOI / loan amount. */
  debtYield: Pct | null
  loanAmount: USD
  equityRequired: USD
  npv: USD
  /** Weighted average lease term remaining, in years (commercial only). */
  walt: number | null
}

export interface UnderwritingResult {
  propertyId: string
  assumptions: UnderwritingAssumptions
  cashFlows: AnnualCashFlow[]
  metrics: UnderwritingMetrics
  generatedAt: string
  /** Plain-language flags, e.g. "DSCR below 1.25x in year 3". */
  warnings: string[]
}

/** Variables an analyst can flex in a sensitivity grid. */
export type SensitivityVariable =
  | 'exitCapRate'
  | 'marketRentGrowth'
  | 'purchasePrice'
  | 'renewalProbability'
  | 'interestRate'

export interface SensitivityTable {
  rowVariable: SensitivityVariable
  columnVariable: SensitivityVariable
  rowValues: number[]
  columnValues: number[]
  metric: keyof Pick<UnderwritingMetrics, 'unleveredIRR' | 'leveredIRR' | 'equityMultiple'>
  /** cells[row][column]; null when the metric can't be computed. */
  cells: (number | null)[][]
}
