/** Time-value-of-money helpers. Cash flows are indexed by period, t = 0 first. */

/** Internal rate of return via bisection. Returns null if there's no sign change. */
export function irr(cashFlows: number[], lo = -0.99, hi = 1): number | null {
  let fLo = npv(lo, cashFlows)
  if (fLo * npv(hi, cashFlows) > 0) return null
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    const fMid = npv(mid, cashFlows)
    if (Math.abs(fMid) < 1e-7) return mid
    if (fLo * fMid < 0) hi = mid
    else {
      lo = mid
      fLo = fMid
    }
  }
  return (lo + hi) / 2
}

/** Net present value, with cashFlows[0] undiscounted (Excel: CF0 + NPV(rate, CF1..n)). */
export function npv(rate: number, cashFlows: number[]): number {
  return cashFlows.reduce((s, cf, t) => s + cf / Math.pow(1 + rate, t), 0)
}

/** Level payment per period that amortizes `principal` over `periods` (Excel: −PMT). */
export function payment(principal: number, ratePerPeriod: number, periods: number): number {
  if (ratePerPeriod === 0) return principal / periods
  return (principal * ratePerPeriod) / (1 - Math.pow(1 + ratePerPeriod, -periods))
}

export interface LoanMonth {
  /** 1-based month of the loan. */
  month: number
  interest: number
  principal: number
  payment: number
  /** Balance after this month's payment. */
  endingBalance: number
}

/**
 * Monthly schedule for a fixed-rate loan: interest-only for `interestOnlyMonths`,
 * then a level payment that amortizes the full balance over `amortizationMonths`.
 */
export function loanSchedule(
  principal: number,
  annualRate: number,
  amortizationMonths: number,
  interestOnlyMonths: number,
  months: number,
): LoanMonth[] {
  const r = annualRate / 12
  const amortizingPayment = payment(principal, r, amortizationMonths)
  const rows: LoanMonth[] = []
  let balance = principal
  for (let m = 1; m <= months; m++) {
    const interest = balance * r
    const pay = m <= interestOnlyMonths ? interest : Math.min(amortizingPayment, balance + interest)
    const principalPaid = pay - interest
    balance -= principalPaid
    rows.push({ month: m, interest, principal: principalPaid, payment: pay, endingBalance: balance })
  }
  return rows
}
