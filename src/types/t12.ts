import type { ISODate } from './common'

/**
 * A trailing-12-month operating statement (T-12), as mapped on import. Kept
 * apart from the deal (its own local storage entry in the app,
 * private-deals/<id>/t12.json on the command line) and attached to the
 * property at run time, so it never travels with the rent roll.
 */

/** What a statement line counts as. Revenue still comes from the rent roll; income lines are for comparison except other income. */
export type T12Category =
  | 'rental-income'
  | 'vacancy-concessions'
  | 'other-income'
  | 'recoveries'
  | 'property-taxes'
  | 'insurance'
  | 'utilities'
  | 'repairs-maintenance'
  | 'payroll'
  | 'management-fee'
  | 'admin-marketing'
  | 'other-opex'
  | 'capex'
  | 'not-used'

/** Where the line sits in the file: above NOI as income or expense, or below NOI. Fixed by the file, not by the mapping. */
export type T12Side = 'income' | 'expense' | 'below'

export interface T12Line {
  /** 1-based row number in the file. */
  row: number
  /** Account code, when the file has a code column. */
  code?: string
  label: string
  side: T12Side
  /**
   * The 12 monthly amounts, signed so income is positive, revenue deductions
   * (vacancy, concessions) negative and expenses positive.
   */
  months: number[]
  category: T12Category
  /** Commercial only: tenants reimburse this line under their recovery terms. */
  recoverable: boolean
}

export interface T12Statement {
  fileName: string
  importedAt: ISODate
  /** The property or report name the file states, if any. */
  name?: string
  /** The file says it is fictional sample data. */
  isSample: boolean
  /** The 1st of the statement's first month. */
  periodStart: ISODate
  /** Every line with amounts, including subtotals and lines mapped as not used. */
  lines: T12Line[]
  /** Totals the file states about itself, signed like the lines. */
  fileTotals: { income?: number; expenses?: number; noi?: number }
}
