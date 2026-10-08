import type { Bps, ISODate, Pct, Sourced, USD } from './common'

export type Scenario = 'base' | 'downside' | 'value-add'

/**
 * Every numeric assumption is Sourced so the UI can badge defaults ("EST")
 * versus analyst inputs. The engine reads `.value`.
 */
type S = Sourced<number>

/** Acquisition basis and hold period. */
export interface AcquisitionAssumptions {
  purchasePrice: Sourced<USD>
  closingCostsPct: Sourced<Pct>
  analysisStartDate: ISODate
  holdYears: S
  /** Upfront capital plan (renovations, deferred maintenance). */
  initialCapex: Sourced<USD>
}

/** Terms used when space is re-leased to a new tenant or renewed. */
export interface LeasingTerms {
  termMonths: S
  freeRentMonths: S
  tiPerSF: Sourced<USD>
  /** Leasing commission as a percent of total base rent over the term. */
  leasingCommissionPct: Sourced<Pct>
}

/** Argus-style market leasing assumptions applied when leases roll. */
export interface MarketLeasingAssumptions {
  /** Year-1 market rent (per SF/yr commercial, per unit/mo multifamily). */
  marketRent: Sourced<USD>
  marketRentGrowth: Sourced<Pct>
  /** Probability an expiring tenant renews; blends new and renewal terms. */
  renewalProbability: Sourced<Pct>
  /** Months a suite sits vacant before a new tenant starts. */
  downtimeMonths: S
  newLease: LeasingTerms
  renewal: LeasingTerms
  /** Annual escalation on newly signed leases. */
  newLeaseEscalationPct: Sourced<Pct>
  /** Recovery structure for suites vacant at acquisition once they lease up (base year = lease start). */
  vacantSpaceRecovery: 'net' | 'base-year' | 'none'
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
  generalVacancyPct: Sourced<Pct>
  creditLossPct: Sourced<Pct>
  expenses: ExpenseLine[]
  expenseGrowth: Sourced<Pct>
  /** Management fee as a percent of effective gross income. */
  managementFeePct: Sourced<Pct>
  /** Ongoing capital reserves per SF (or per unit) per year. */
  capitalReservesPerYear: Sourced<USD>
}

/** Unit turnover, multifamily only. */
export interface MultifamilyAssumptions {
  /** Share of units that turn over each year. */
  turnoverRate: Sourced<Pct>
  /** Make-ready cost per move-out, in year-1 dollars. */
  turnoverCostPerUnit: Sourced<USD>
}

/** Fixed rate, or floating off an index that can be pulled live from FRED. */
export type InterestRate =
  | { type: 'fixed'; rate: Sourced<Pct> }
  | { type: 'index-plus-spread'; index: 'treasury-10y' | 'sofr'; spreadBps: Sourced<Bps> }

export interface DebtAssumptions {
  enabled: boolean
  /** Loan-to-value at acquisition. */
  ltv: Sourced<Pct>
  rate: InterestRate
  amortizationYears: S
  interestOnlyYears: S
  loanFeesPct: Sourced<Pct>
}

export interface ExitAssumptions {
  exitCapRate: Sourced<Pct>
  sellingCostsPct: Sourced<Pct>
  /** Value on forward (year N+1) NOI, which is standard practice. */
  capForwardNOI: boolean
}

export interface UnderwritingAssumptions {
  scenario: Scenario
  acquisition: AcquisitionAssumptions
  leasing: MarketLeasingAssumptions
  operating: OperatingAssumptions
  multifamily?: MultifamilyAssumptions
  debt: DebtAssumptions
  exit: ExitAssumptions
  /** Discount rate for NPV. */
  discountRate: Sourced<Pct>
}

/** One year of the cash flow waterfall. All values in USD. */
export interface AnnualCashFlow {
  year: number
  /** Average share of rentable SF (or units) physically occupied. */
  occupancy: Pct
  grossPotentialRent: USD
  /** Vacancy from lease rollover downtime and unleased space. */
  absorptionTurnoverVacancy: USD
  freeRent: USD
  expenseRecoveries: USD
  otherIncome: USD
  generalVacancy: USD
  creditLoss: USD
  effectiveGrossIncome: USD
  /** Included in operatingExpenses. */
  managementFee: USD
  /** Property expenses plus the management fee. */
  operatingExpenses: USD
  netOperatingIncome: USD
  tenantImprovements: USD
  leasingCommissions: USD
  capitalReserves: USD
  cashFlowBeforeDebt: USD
  debtService: USD
  /** Operating cash flow after debt service, before sale proceeds. */
  cashFlowAfterDebt: USD
  /** Sale price net of selling costs (final hold year only). */
  saleProceeds: USD
  /** Loan balance repaid at sale (final hold year only). */
  loanPayoff: USD
  /** Cash flow before debt + sale proceeds: the unlevered IRR stream. */
  unleveredCashFlow: USD
  /** Cash flow after debt + sale proceeds − payoff: the levered IRR stream. */
  leveredCashFlow: USD
}

export interface UnderwritingMetrics {
  purchasePrice: USD
  /** Price + closing costs + initial capex. */
  totalCost: USD
  goingInCapRate: Pct
  /** Gross sale value: forward NOI ÷ exit cap. */
  exitValue: USD
  /** Sale value after selling costs, before loan payoff. */
  netSaleProceeds: USD
  pricePerSF: USD
  unleveredIRR: Pct | null
  leveredIRR: Pct | null
  /** Levered when debt is enabled: total distributions ÷ equity. */
  equityMultiple: number
  unleveredEquityMultiple: number
  /** Levered cash flow ÷ equity, by hold year. */
  cashOnCashByYear: Pct[]
  averageCashOnCash: Pct | null
  /** NOI ÷ debt service, by hold year. */
  dscrByYear: number[]
  minimumDSCR: number | null
  /** Year-1 NOI / loan amount. */
  debtYield: Pct | null
  loanAmount: USD
  /** Loan balance repaid at sale. */
  loanPayoff: USD
  equityRequired: USD
  npv: USD
  /** Weighted average lease term remaining, in years (commercial only). */
  walt: number | null
}

export interface UnderwritingResult {
  propertyId: string
  assumptions: UnderwritingAssumptions
  /** Hold years 1..N. */
  cashFlows: AnnualCashFlow[]
  /** Year N+1, modeled only to value the exit on forward NOI (no debt or sale lines). */
  forwardYear: AnnualCashFlow
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
