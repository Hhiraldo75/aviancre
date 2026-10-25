import type { ExpenseLine, ISODate, Property, Sourced, T12Category, T12Line, T12Statement } from '../types'
import { fmt } from './format'
import { fromImport } from './sourced'

/**
 * A loaded T-12 in the underwriting: totals by category, the Year-1 expense
 * lines and other income it sets (actuals grown to Year 1), the file it is
 * saved as, and attaching it to a property. Pure functions; the comparison
 * with the underwritten Year 1 is in underwriting/t12Check.ts.
 */

export const T12_CATEGORIES: { key: T12Category; label: string }[] = [
  { key: 'rental-income', label: 'Rental income' },
  { key: 'vacancy-concessions', label: 'Vacancy, concessions & bad debt' },
  { key: 'other-income', label: 'Other income' },
  { key: 'recoveries', label: 'Expense recoveries' },
  { key: 'property-taxes', label: 'Property taxes' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'utilities', label: 'Utilities' },
  { key: 'repairs-maintenance', label: 'Repairs & maintenance' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'management-fee', label: 'Management fee' },
  { key: 'admin-marketing', label: 'Admin & marketing' },
  { key: 'other-opex', label: 'Other operating expenses' },
  { key: 'capex', label: 'Capex / non-recurring' },
  { key: 'not-used', label: 'Not used (subtotal, below NOI)' },
]

export const categoryLabel = (c: T12Category) => T12_CATEGORIES.find((x) => x.key === c)!.label

/** Operating expense categories that become Year-1 expense lines (the management fee stays the model's % of EGI). */
export const OPEX_CATEGORIES: T12Category[] = [
  'property-taxes',
  'insurance',
  'utilities',
  'repairs-maintenance',
  'payroll',
  'admin-marketing',
  'other-opex',
]

export const INCOME_CATEGORIES: T12Category[] = ['rental-income', 'vacancy-concessions', 'other-income', 'recoveries']

const round2 = (x: number) => Math.round(x * 100) / 100
export const lineTotal = (l: T12Line) => round2(l.months.reduce((s, x) => s + x, 0))

/** T-12 totals by category, as mapped. */
export function categoryTotals(s: T12Statement): Record<T12Category, number> {
  const out = Object.fromEntries(T12_CATEGORIES.map((c) => [c.key, 0])) as Record<T12Category, number>
  for (const l of s.lines) out[l.category] = round2(out[l.category] + lineTotal(l))
  return out
}

export interface T12Summary {
  byCategory: Record<T12Category, number>
  /** Income lines as mapped (rental, vacancy, other income, recoveries). */
  effectiveGrossIncome: number
  /** Operating expense categories plus the management fee; capex excluded. */
  operatingExpenses: number
  /** EGI − operating expenses, as mapped. */
  netOperatingIncome: number
  /** Capex / non-recurring lines, listed separately and kept out of NOI. */
  belowNOI: { row: number; label: string; amount: number }[]
  /** Lines in the file's operating expenses mapped below NOI (make-ready…): why mapped NOI can differ from the file's. */
  movedBelowNOI: { row: number; label: string; amount: number }[]
}

export function t12Summary(s: T12Statement): T12Summary {
  const byCategory = categoryTotals(s)
  const egi = round2(INCOME_CATEGORIES.reduce((sum, c) => sum + byCategory[c], 0))
  const opex = round2([...OPEX_CATEGORIES, 'management-fee' as const].reduce((sum, c) => sum + byCategory[c], 0))
  const item = (l: T12Line) => ({ row: l.row, label: l.label, amount: lineTotal(l) })
  return {
    byCategory,
    effectiveGrossIncome: egi,
    operatingExpenses: opex,
    netOperatingIncome: round2(egi - opex),
    belowNOI: s.lines.filter((l) => l.category === 'capex').map(item),
    movedBelowNOI: s.lines.filter((l) => l.category === 'capex' && l.side === 'expense').map(item),
  }
}

/** "Oct 2025 – Sep 2026" */
export function periodLabel(s: T12Statement): string {
  const [y, m] = s.periodStart.split('-').map(Number)
  const end = `${y + (m === 1 ? 0 : 1)}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}-01`
  return `${fmt.monthYear(s.periodStart)} – ${fmt.monthYear(end)}`
}

/** Years from the T-12's midpoint to Year 1's midpoint: the months from its first month to the analysis start, ÷ 12. */
export function growthYears(periodStart: ISODate, analysisStart: ISODate): number {
  const [y0, m0] = periodStart.split('-').map(Number)
  const [y1, m1] = analysisStart.split('-').map(Number)
  return (y1 * 12 + m1 - (y0 * 12 + m0)) / 12
}

export const t12Source = (s: T12Statement) => `T-12 actual, ${periodLabel(s)} (${s.fileName})`

function grown(s: T12Statement, actual: number, rate: number, analysisStart: ISODate, what: string): Sourced<number> {
  const years = growthYears(s.periodStart, analysisStart)
  const value = round2(actual * Math.pow(1 + rate, years))
  return fromImport(value, t12Source(s), s.importedAt, `${fmt.usd(actual)} over the T-12, grown ${years.toFixed(2)} yrs at ${fmt.pctShort(rate)}/yr ${what} to Year 1`)
}

/**
 * Year-1 operating expense lines: one per category in OPEX_CATEGORIES order,
 * grown at expense growth. For commercial, a category with both recoverable
 * and non-recoverable lines is split in two.
 */
export function t12ExpenseLines(s: T12Statement, expenseGrowth: number, analysisStart: ISODate, commercial: boolean): ExpenseLine[] {
  const out: ExpenseLine[] = []
  for (const category of OPEX_CATEGORIES) {
    const lines = s.lines.filter((l) => l.category === category)
    if (!lines.length) continue
    const parts = commercial ? [true, false].map((r) => lines.filter((l) => l.recoverable === r)) : [lines]
    const mixed = parts.filter((p) => p.length).length > 1
    parts.forEach((part, i) => {
      if (!part.length) return
      const recoverable = commercial && i === 0
      const actual = round2(part.reduce((sum, l) => sum + lineTotal(l), 0))
      out.push({
        label: `${categoryLabel(category)}${mixed && !recoverable ? ' (not recoverable)' : ''}`,
        annualAmount: grown(s, actual, expenseGrowth, analysisStart, 'expense growth'),
        recoverable,
        t12Category: category,
      })
    })
  }
  return out
}

/** Year-1 other income from the T-12, grown at market rent growth (0 when the T-12 has none). */
export function t12OtherIncomeYear1(s: T12Statement, rentGrowth: number, analysisStart: ISODate): Sourced<number> {
  return grown(s, categoryTotals(s)['other-income'], rentGrowth, analysisStart, 'rent growth')
}

/** The property with a T-12 attached (a new object, so cached engine runs don't mix). */
export const withT12 = (p: Property, s: T12Statement): Property => ({ ...p, t12: s })

const strippedCache = new WeakMap<Property, Property>()

/** The property without its T-12; the same object each time for the same property, so engine caches hit. */
export function withoutT12(p: Property): Property {
  if (!p.t12) return p
  const hit = strippedCache.get(p)
  if (hit) return hit
  const { t12: _t12, ...rest } = p
  strippedCache.set(p, rest)
  return rest
}

// ---------- the saved file (private-deals/<id>/t12.json) and local storage ----------

export const T12_FILE_FORMAT = 'aviancre-t12'
export const T12_FILE_VERSION = 1

export interface T12File {
  format: typeof T12_FILE_FORMAT
  version: typeof T12_FILE_VERSION
  propertyId: string
  statement: T12Statement
}

export const t12File = (propertyId: string, statement: T12Statement): T12File => ({
  format: T12_FILE_FORMAT,
  version: T12_FILE_VERSION,
  propertyId,
  statement,
})

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const CATEGORY_KEYS = new Set<string>(T12_CATEGORIES.map((c) => c.key))

/** A structural check, enough to reject stale or hand-edited entries. */
export function isT12Statement(x: unknown): x is T12Statement {
  return (
    isObject(x) &&
    typeof x.fileName === 'string' &&
    typeof x.importedAt === 'string' &&
    typeof x.periodStart === 'string' &&
    /^\d{4}-\d{2}-01$/.test(x.periodStart) &&
    isObject(x.fileTotals) &&
    Array.isArray(x.lines) &&
    x.lines.every(
      (l: unknown) =>
        isObject(l) &&
        typeof l.label === 'string' &&
        typeof l.row === 'number' &&
        ['income', 'expense', 'below'].includes(l.side as string) &&
        CATEGORY_KEYS.has(l.category as string) &&
        typeof l.recoverable === 'boolean' &&
        Array.isArray(l.months) &&
        l.months.length === 12 &&
        l.months.every((m: unknown) => typeof m === 'number' && Number.isFinite(m)),
    )
  )
}

/** Reads a saved T-12 file for this property. */
export function parseT12File(json: unknown, propertyId: string): { statement: T12Statement } | { error: string } {
  if (!isObject(json) || json.format !== T12_FILE_FORMAT) return { error: 'Not an AVIANCRE T-12 file.' }
  if (json.version !== T12_FILE_VERSION) return { error: `Unsupported T-12 file version ${String(json.version)}.` }
  if (json.propertyId !== propertyId) return { error: `This T-12 is for "${String(json.propertyId)}", not ${propertyId}.` }
  if (!isT12Statement(json.statement)) return { error: 'The T-12 file is damaged (lines or period missing).' }
  return { statement: json.statement }
}
