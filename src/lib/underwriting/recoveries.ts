import type { Recovery } from '../../types'

/**
 * One month of expense reimbursement from one tenant.
 *
 * @param expenses        this month's recoverable operating expenses for the whole building
 * @param baseYearExpenses monthly recoverable expenses in the lease's base year (base-year leases only)
 */
export function monthlyRecovery(
  recovery: Recovery,
  leasedSF: number,
  rentableSF: number,
  expenses: number,
  baseYearExpenses = 0,
): number {
  const share = rentableSF ? leasedSF / rentableSF : 0
  switch (recovery.method) {
    case 'none':
      return 0
    case 'net':
      return share * expenses * (1 + (recovery.adminFeePct ?? 0))
    case 'base-year':
      return share * Math.max(0, expenses - baseYearExpenses)
    case 'expense-stop': {
      const annualPerSF = rentableSF ? (expenses * 12) / rentableSF : 0
      return (leasedSF * Math.max(0, annualPerSF - recovery.stopPerSF)) / 12
    }
  }
}
