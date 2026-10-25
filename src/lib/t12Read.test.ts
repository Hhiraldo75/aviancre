import { describe, expect, it } from 'vitest'
import fernhillT12 from '../../docs/samples/fernhill-commons-t12.csv?raw'
import { parseCSV } from './csv'
import type { Cell } from './rentRollCells'
import { amount, categorize, parseMonth, readT12, statementFrom, t12ReadyToLoad } from './t12Read'

const MONTHS = ['Oct 2025', 'Nov 2025', 'Dec 2025', 'Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026']
const grid = parseCSV(fernhillT12)
const fernhill = readT12(grid, { kind: 'multifamily' })
const line = (label: string, r = fernhill) => r.lines.find((l) => l.label === label)!
const total = (label: string, r = fernhill) => line(label, r).months.reduce((s, x) => s + x, 0)
/** 12 equal months. */
const flat = (perMonth: number) => Array.from({ length: 12 }, () => perMonth)

describe('month headers and amounts', () => {
  it('reads the common month header forms', () => {
    expect(parseMonth('Oct 2025')).toEqual({ m: 9, y: 2025 })
    expect(parseMonth('Oct-25')).toEqual({ m: 9, y: 2025 })
    expect(parseMonth('October 2025')).toEqual({ m: 9, y: 2025 })
    expect(parseMonth('Sept 2026')).toEqual({ m: 8, y: 2026 })
    expect(parseMonth('10/2025')).toEqual({ m: 9, y: 2025 })
    expect(parseMonth('10/31/2025')).toEqual({ m: 9, y: 2025 })
    expect(parseMonth('2025-10')).toEqual({ m: 9, y: 2025 })
    expect(parseMonth('2025-10-31')).toEqual({ m: 9, y: 2025 })
    expect(parseMonth(45961)).toEqual({ m: 9, y: 2025 }) // Excel serial for 2025-10-31
    expect(parseMonth('Oct 2025 Actual')).toEqual({ m: 9, y: 2025 })
    expect(parseMonth('Jan')).toEqual({ m: 0 })
  })
  it('does not read labels or amounts as months', () => {
    for (const x of ['Marketing', 'Total', 'Description', 'Account', '13/2025', 1234, '']) expect(parseMonth(x)).toBeNull()
  })
  it('reads accounting amounts', () => {
    expect(amount('1,234')).toBe(1234)
    expect(amount('$1,234.50')).toBe(1234.5)
    expect(amount('(1,234)')).toBe(-1234)
    expect(amount('-1,234')).toBe(-1234)
    expect(amount('-')).toBeNull()
    expect(amount('')).toBeNull()
    expect(amount(12)).toBe(12)
    expect(amount('n/a')).toBeNaN()
  })
})

describe('the Fernhill sample T-12 (Yardi 12 Month Statement)', () => {
  it('finds the layout, columns and period', () => {
    expect(fernhill.format).toBe('yardi')
    expect(fernhill.headerRow).toBe(6)
    expect(fernhill.mapping.code.column).toBe(0)
    expect(fernhill.mapping.label.column).toBe(1)
    expect(fernhill.mapping.firstMonth.column).toBe(2)
    expect(fernhill.mapping.total.column).toBe(14)
    expect(fernhill.periodStart).toBe('2025-10-01')
    expect(fernhill.name).toBe('Fernhill Commons')
    expect(fernhill.isSample).toBe(true)
    expect(fernhill.blockers).toEqual([])
  })
  it('matches every one of the file’s own totals', () => {
    expect(fernhill.totals).toEqual([
      { label: 'Total income', mapped: 2_144_800, file: 2_144_800, match: true },
      { label: 'Total operating expenses', mapped: 860_392, file: 860_392, match: true },
      { label: 'Net operating income', mapped: 1_284_408, file: 1_284_408, match: true },
    ])
    expect(t12ReadyToLoad(fernhill, false)).toBe(true)
  })
  it('maps each line from its label and section', () => {
    const cat = (label: string) => line(label).category
    expect(cat('Gross Potential Rent')).toBe('rental-income')
    expect(cat('Loss to Lease')).toBe('rental-income')
    expect(cat('Vacancy Loss')).toBe('vacancy-concessions')
    expect(cat('Bad Debt Write-Off')).toBe('vacancy-concessions')
    expect(cat('Utility Reimbursement (RUBS)')).toBe('other-income')
    expect(cat('Real Estate Taxes')).toBe('property-taxes')
    expect(cat('Payroll Taxes & Benefits')).toBe('payroll')
    expect(cat('Gas / Heating')).toBe('utilities')
    expect(cat('Contract Services (Elevator, Pest, Landscaping)')).toBe('repairs-maintenance')
    expect(cat('Management Fees')).toBe('management-fee')
    expect(cat('Legal & Accounting')).toBe('admin-marketing')
    expect(cat('Roof Repair')).toBe('capex')
    expect(cat('Mortgage Interest')).toBe('not-used')
    expect(line('Miscellaneous Operating')).toMatchObject({ category: 'other-opex', provenance: 'section' })
  })
  it('keeps subtotals as lines that are never counted', () => {
    for (const label of ['Total Rental Income', 'Total Utilities', 'TOTAL OPERATING EXPENSES', 'NET OPERATING INCOME', 'NET INCOME']) {
      expect(line(label)).toMatchObject({ isSubtotal: true, category: 'not-used' })
    }
  })
  it('puts lines after NOI below NOI and signs deductions negative', () => {
    expect(line('Roof Repair').side).toBe('below')
    expect(line('Mortgage Interest').side).toBe('below')
    expect(total('Vacancy Loss')).toBe(-112_400)
    expect(total('Real Estate Taxes')).toBe(231_600)
  })
  it('maps make-ready to non-recurring and says why', () => {
    expect(line('Make Ready / Turnover')).toMatchObject({ category: 'capex', side: 'expense' })
    expect(fernhill.flags.join(' ')).toMatch(/Row 35 “Make Ready \/ Turnover” \(\$34,200\) looks like make-ready\/turnover/)
  })
  it('reads reimbursements as recoveries, and sets recoverable defaults, for commercial', () => {
    const c = readT12(grid, { kind: 'commercial' })
    expect(line('Utility Reimbursement (RUBS)', c).category).toBe('recoveries')
    expect(line('Real Estate Taxes', c).recoverable).toBe(true)
    expect(line('Repairs & Maintenance - General', c).recoverable).toBe(true)
    expect(line('Payroll - Salaries', c).recoverable).toBe(false)
    expect(line('Real Estate Taxes').recoverable).toBe(false) // multifamily: no recoveries
  })
  it('applies the analyst’s categories and recoverable choices', () => {
    const r = readT12(grid, { kind: 'commercial', categories: { 35: 'repairs-maintenance' }, recoverable: { 25: false } })
    expect(line('Make Ready / Turnover', r)).toMatchObject({ category: 'repairs-maintenance', provenance: 'user' })
    expect(r.flags.join(' ')).not.toMatch(/make-ready/)
    expect(line('Real Estate Taxes', r).recoverable).toBe(false)
  })
  it('saves the mapped lines without the screen’s bookkeeping', () => {
    const s = statementFrom(fernhill, { fileName: 'fernhill-commons-t12.csv', importedAt: '2026-10-24' })
    expect(s).toMatchObject({ fileName: 'fernhill-commons-t12.csv', periodStart: '2025-10-01', isSample: true, name: 'Fernhill Commons' })
    expect(s.fileTotals).toEqual({ income: 2_144_800, expenses: 860_392, noi: 1_284_408 })
    expect(s.lines[0]).toEqual({ row: 9, code: '4000-0000', label: 'Gross Potential Rent', side: 'income', months: flat(188_500), category: 'rental-income', recoverable: false })
  })
})

describe('other layouts', () => {
  it('reads an AppFolio twelve-month income statement', () => {
    const rows: Cell[][] = [
      ['Twelve-Month Income Statement'],
      ['Properties: 12 Elm St'],
      [],
      ['Account Name', ...MONTHS, 'Total'],
      ['Operating Income & Expense'],
      ['Income'],
      ['Rent Income', ...flat(10_000), 120_000],
      ['Parking', ...flat(500), 6_000],
      ['Total Operating Income', ...flat(10_500), 126_000],
      ['Expense'],
      ['Property Tax', ...flat(1_000), 12_000],
      ['Insurance Expense', ...flat(300), 3_600],
      ['Landscaping', ...flat(200), 2_400],
      ['Total Operating Expense', ...flat(1_500), 18_000],
      ['NOI - Net Operating Income', ...flat(9_000), 108_000],
    ]
    const r = readT12(rows, { kind: 'multifamily' })
    expect(r.format).toBe('appfolio')
    expect(r.mapping.label.column).toBe(0)
    expect(r.mapping.code.column).toBeNull()
    expect(r.totals.map((t) => t.match)).toEqual([true, true, true])
    expect(r.lines.filter((l) => !l.isSubtotal).map((l) => l.category)).toEqual(['rental-income', 'other-income', 'property-taxes', 'insurance', 'repairs-maintenance'])
  })

  it('asks for the year when the months have none, and turns positive vacancy into a deduction', () => {
    const rows: Cell[][] = [
      ['Line item', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      ['Rental income', ...flat(10_000)],
      ['Vacancy', ...flat(500)],
      ['Real estate taxes', ...flat(1_000)],
      ['Electric', ...flat(250)],
    ]
    const noYear = readT12(rows, { kind: 'multifamily' })
    expect(noYear.format).toBe('generic')
    expect(noYear.blockers).toEqual(['The month headers have no year. Enter the first month of the statement.'])
    expect(t12ReadyToLoad(noYear, true)).toBe(false)

    const r = readT12(rows, { kind: 'multifamily', periodStart: '2026-01-01' })
    expect(r.blockers).toEqual([])
    expect(r.periodStart).toBe('2026-01-01')
    expect(r.lines.map((l) => [l.label, l.side, l.category])).toEqual([
      ['Rental income', 'income', 'rental-income'],
      ['Vacancy', 'income', 'vacancy-concessions'],
      ['Real estate taxes', 'expense', 'property-taxes'],
      ['Electric', 'expense', 'utilities'],
    ])
    expect(total('Vacancy', r)).toBe(-6_000)
    expect(r.flags.join(' ')).toMatch(/Vacancy and concession lines are positive in the file; they are read as deductions/)
    expect(r.flags.join(' ')).toMatch(/states no Total income/)
  })

  it('takes the year from a "Period =" title when the headers have none', () => {
    const rows: Cell[][] = [['Period = Jan 2026-Dec 2026'], ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], ['Rent', ...flat(1)], ['Taxes', ...flat(1)]]
    expect(readT12(rows, { kind: 'multifamily' }).periodStart).toBe('2026-01-01')
  })

  it('turns negative expenses into positive costs', () => {
    const rows: Cell[][] = [['Line item', ...MONTHS], ['Income'], ['Rent', ...flat(1_000)], ['Expenses'], ['Insurance', ...flat(-100)], ['Water', ...flat(-50)]]
    const r = readT12(rows, { kind: 'multifamily' })
    expect(total('Insurance', r)).toBe(1_200)
    expect(r.flags.join(' ')).toMatch(/Expenses are negative in the file/)
  })

  it('reports a totals mismatch, which blocks loading until acknowledged, and months that miss their row total', () => {
    const edited = grid.map((row) => [...row])
    edited[24][2] = '20,000' // Real Estate Taxes, Oct 2025: was 19,300
    const r = readT12(edited, { kind: 'multifamily' })
    expect(r.totals.find((t) => t.label === 'Total operating expenses')).toMatchObject({ mapped: 861_092, file: 860_392, match: false })
    expect(r.flags.join(' ')).toMatch(/1 row whose months don’t add to the Total column: row 25 \(\$232,300 vs \$231,600\)/)
    expect(t12ReadyToLoad(r, false)).toBe(false)
    expect(t12ReadyToLoad(r, true)).toBe(true)
  })

  it('lets the analyst move the columns', () => {
    const r = readT12(grid, { kind: 'multifamily', columns: { total: null, code: null } })
    expect(r.mapping.total).toEqual({ column: null, provenance: 'user' })
    expect(line('Real Estate Taxes', r).fileTotal).toBeUndefined()
    expect(line('Real Estate Taxes', r).code).toBeUndefined()
  })

  it('blocks a file with no month header', () => {
    const r = readT12([['Unit', 'Tenant', 'Rent'], ['101', 'A', '1000']], { kind: 'multifamily' })
    expect(r.blockers[0]).toMatch(/No row of 12 consecutive month headers/)
  })
})

describe('categorize', () => {
  it('falls back on the section heading, then the section', () => {
    expect(categorize('Line 7', 'income', 'OTHER INCOME', 'multifamily')).toEqual({ category: 'other-income', provenance: 'detected' })
    expect(categorize('Line 7', 'expense', undefined, 'multifamily')).toEqual({ category: 'other-opex', provenance: 'section' })
    expect(categorize('Line 7', 'below', undefined, 'multifamily')).toEqual({ category: 'capex', provenance: 'section' })
  })
})
