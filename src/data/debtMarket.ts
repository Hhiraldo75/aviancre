import type { BenchmarkType, Bps, ISODate, Pct } from '../types'

/**
 * Default loan terms. The fixed rate is the 10-year Treasury plus the average
 * CMBS spread for the asset type, rounded to 0.05%; the other terms are
 * typical of current quotes. Everything stays an estimate (EST) until a
 * lender term sheet replaces it.
 */

export const TREASURY_10Y: Pct = 0.0496
export const TREASURY_SOURCE = 'FRED DGS10 (10-year Treasury), Oct 22, 2026'
export const SPREAD_SOURCE = 'CRED iQ loan spreads via Commercial Observer, Mar 31, 2026'
export const DEBT_QUOTES = 'Consistent with Northmarq quotes, Oct 2026'
export const DEBT_AS_OF: ISODate = '2026-10-22'

export const LOAN_SPREAD_BPS: Record<BenchmarkType, Bps> = {
  multifamily: 154,
  industrial: 162,
  retail: 176,
  office: 220,
}

/** 4.96% + spread, rounded to 0.05%. */
export const DEBT_RATE: Record<BenchmarkType, Pct> = {
  multifamily: 0.065,
  industrial: 0.066,
  retail: 0.067,
  office: 0.0715,
}

export const LOAN_TERMS = {
  ltv: 0.6,
  amortizationYears: 30,
  interestOnlyYears: 2,
  loanFeesPct: 0.01,
} as const
