import type { ISODate, T12Category, T12Line, T12Side, T12Statement } from '../types'
import { text, type Cell } from './rentRollCells'
import { headerKey, SAMPLE_SUFFIX, type Provenance } from './rentRollLayout'
import { isoMonthStart } from './underwriting/timeline'

/**
 * Reads a trailing-12-month operating statement (T-12) from a grid of cells:
 * one row per line item, 12 monthly columns and an optional total. Finds the
 * month header in Yardi "12 Month Statement", AppFolio "Twelve-Month Income
 * Statement" and plain-table layouts, maps each line to a category from its
 * label and section, and checks the result against the file's own totals.
 * The mapping screen (T12Mapping.tsx) lets the analyst change every choice.
 */

export type T12Format = 'yardi' | 'appfolio' | 'generic' | 'unknown'

export const T12_FORMAT_LABELS: Record<T12Format, string> = {
  yardi: 'Yardi 12 Month Statement',
  appfolio: 'AppFolio Twelve-Month Income Statement',
  generic: 'Table of line items × 12 months',
  unknown: 'Unknown layout',
}

export type T12ColumnKey = 'label' | 'code' | 'firstMonth' | 'total'

export const T12_COLUMN_LABELS: Record<T12ColumnKey, string> = {
  label: 'Line item',
  code: 'Account code',
  firstMonth: 'First month',
  total: 'Total',
}

export interface T12Options {
  /** Sets the recoverable defaults (commercial) and how reimbursement income reads. */
  kind: 'multifamily' | 'commercial'
  /** Columns the analyst picked (0-based; null = not in the file). */
  columns?: Partial<Record<T12ColumnKey, number | null>>
  /** The first month (YYYY-MM-01), when the month headers don't give a year. */
  periodStart?: ISODate
  /** Category per line, by 1-based row. */
  categories?: Record<number, T12Category>
  /** Recoverable per line, by 1-based row (commercial). */
  recoverable?: Record<number, boolean>
}

export type LineProvenance = 'detected' | 'section' | 'user'

export interface T12ReadLine extends T12Line {
  provenance: LineProvenance
  /** A subtotal or total row: shown, never counted. */
  isSubtotal: boolean
  /** The file's Total column for the row, when it has one. */
  fileTotal?: number
  /** The section heading the row sits under. */
  group?: string
}

export interface T12TotalCheck {
  label: string
  mapped: number
  file: number | null
  /** null when the file doesn't state this total. */
  match: boolean | null
}

export interface T12Reading {
  format: T12Format
  /** 1-based row of the month header, or null when none was found. */
  headerRow: number | null
  /** Header cells as text, for the column dropdowns. */
  columns: string[]
  mapping: Record<T12ColumnKey, { column: number | null; provenance: Provenance | null }>
  periodStart: ISODate | null
  monthLabels: string[]
  lines: T12ReadLine[]
  fileTotals: T12Statement['fileTotals']
  totals: T12TotalCheck[]
  /** Worth checking; loading is allowed. */
  flags: string[]
  /** Must be fixed before loading. */
  blockers: string[]
  name: string
  isSample: boolean
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const HEADER_SEARCH_ROWS = 40

interface MonthCell {
  /** 0-based month. */
  m: number
  y?: number
}

const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y))

/** A month header: "Oct 2025", "Oct-25", "October 2025", "10/2025", "2025-10", "10/31/2025", an ISO or Excel date, or "Oct" alone. */
export function parseMonth(c: Cell): MonthCell | null {
  if (typeof c === 'number') {
    // Excel date serials for 2000–2099; anything else in a header row isn't a month.
    if (c < 36_526 || c > 73_050) return null
    const d = new Date(Math.round((c - 25_569) * 86_400_000))
    return { m: d.getUTCMonth(), y: d.getUTCFullYear() }
  }
  const s = text(c)
    .toLowerCase()
    .replace(/\b(actuals?|act|month|period)\b/g, '')
    .trim()
  if (!s) return null
  let x = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(s)
  if (x && +x[2] >= 1 && +x[2] <= 12) return { m: +x[2] - 1, y: +x[1] }
  x = /^(\d{1,2})[/-](?:\d{1,2}[/-])?(\d{2}|\d{4})$/.exec(s)
  if (x && +x[1] >= 1 && +x[1] <= 12) return { m: +x[1] - 1, y: fullYear(x[2]) }
  x = /^([a-z]{3,9})\.?[\s\-'’/]*(\d{2}|\d{4})?$/.exec(s)
  if (x) {
    const m = MONTH_NAMES.indexOf(x[1].slice(0, 3))
    const name = x[1]
    // "sept" and full names only; "marketing" is not March.
    if (m >= 0 && (name.length === 3 || name === 'sept' || 'january february march april may june july august september october november december'.split(' ').includes(name))) {
      return x[2] ? { m, y: fullYear(x[2]) } : { m }
    }
  }
  return null
}

/** The first run of 12 consecutive months in a row, or null. */
function monthRun(row: Cell[]): { start: number; months: MonthCell[] } | null {
  const parsed = row.map(parseMonth)
  for (let i = 0; i + 12 <= parsed.length; i++) {
    const run = parsed.slice(i, i + 12)
    if (run.every((p, k) => p && (k === 0 || consecutive(run[k - 1]!, p)))) return { start: i, months: run as MonthCell[] }
  }
  return null
}

function consecutive(a: MonthCell, b: MonthCell): boolean {
  if (b.m !== (a.m + 1) % 12) return false
  if (a.y === undefined || b.y === undefined) return a.y === b.y
  return b.y === a.y + (a.m === 11 ? 1 : 0)
}

/** An amount cell: 1,234 · $1,234.50 · (1,234) and -1,234 for negatives · "-" or blank for nothing. NaN when not a number. */
export function amount(c: Cell): number | null {
  if (typeof c === 'number') return c
  const s = text(c).replace(/[$,\s]/g, '')
  if (!s || /^[-–—]+$/.test(s)) return null
  const paren = /^\((.*)\)$/.exec(s)
  const t = paren ? paren[1] : s
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN
  return paren ? -Number(t) : Number(t)
}

const key = (s: string) => headerKey(s).replace(/&/g, ' and ').replace(/\s+/g, ' ')

const SUBTOTAL = /^(total|subtotal|sub total)\b|net operating income|^noi\b|^net income|^net (loss|profit)|cash flow|^effective gross income|^egi\b|gross operating income|^net rental income/
const TOTAL_INCOME = /^total (operating )?(income|revenues?|receipts)$|^effective gross income$|^egi$|^gross operating income$/
const TOTAL_EXPENSES = /^total (operating )?expenses?$/
const NOI = /net operating income|^noi\b/

/** Section a heading opens, or null for a sub-heading (keeps the current section). */
function sectionOf(label: string): T12Side | null {
  const k = key(label)
  if (/\b(capital|capex|non recurring|nonrecurring|replacements?|below noi|other items|debt service|financing|partnership)\b/.test(k)) return 'below'
  if (/\bexpenses?\b|\bexpenditures?\b/.test(k)) return 'expense'
  if (/\b(income|revenues?|receipts)\b/.test(k)) return 'income'
  return null
}

const MAKE_READY = /make ready|\bturnover\b|unit turns?|\bturns?\b/
const VACANCY = /vacan|concession|bad debt|write off|writeoff|credit loss|delinquen|model unit|employee unit|admin unit|down unit|non revenue unit|collection loss|free rent/
const RECOVERY = /reimburs|recover|\bcam\b|escalation|pass through|passthrough|\bret\b|tax recapture/
const OTHER_INCOME =
  /parking|garage|laundry|vending|\bpet\b|pets|late|fees?\b|application|storage|antenna|cell tower|billboard|signage|\bsign\b|interest income|misc|other|utilit|rubs|cable|internet|amenit|damage|forfeit|termination|lease break/
const RENTAL = /\brent|gross potential|\bgpr\b|loss to lease|gain to lease|subsid|section 8|\bhap\b|housing assistance|\blease\b/
const PAYROLL = /payroll|salar|wage|benefit|employee|staff|worker|personnel|superintendent|leasing agent|bonus|health/
const TAXES = /real estate tax|property tax|\btax(es)?\b|\bpilot\b|assessment/
const UTILITIES = /utilit|electric(?! repair)|\bgas\b|heat|fuel|\boil\b|water|sewer|trash|refuse|garbage|rubbish|waste/
const REPAIRS =
  /repair|maint|\br and m\b|\brm\b|landscap|grounds|snow|pest|exterminat|elevator|hvac|plumb|janitor|clean|contract service|supplies|paint|carpet|appliance|security|fire|alarm/
const ADMIN =
  /admin|office|marketing|advertis|promot|legal|accounting|audit|professional|telephone|phone|internet|software|computer|bank|licens|permit|dues|subscription|postage|travel|training|resident event|retention/
const CAPEX = /capital|capex|replacement|renovat|improvement|non recurring|nonrecurring/
const BELOW_NOT_USED = /interest|mortgage|debt|principal|loan|depreciat|amortiz|distribution|partner|owner|asset management|income tax|franchise tax|escrow/

/** Recoverable by default (commercial): taxes, insurance and CAM-type lines. */
export const RECOVERABLE_BY_DEFAULT: T12Category[] = ['property-taxes', 'insurance', 'utilities', 'repairs-maintenance']

/** Category for a line from its label (then its section heading) and where it sits in the file. */
export function categorize(label: string, side: T12Side, group: string | undefined, kind: T12Options['kind']): { category: T12Category; provenance: LineProvenance } {
  for (const k of [key(label), group ? key(group) : '']) {
    if (!k) continue
    const c = categoryFor(k, side, kind)
    if (c) return { category: c, provenance: 'detected' }
  }
  const fallback: Record<T12Side, T12Category> = { income: 'other-income', expense: 'other-opex', below: 'capex' }
  return { category: fallback[side], provenance: 'section' }
}

function categoryFor(k: string, side: T12Side, kind: T12Options['kind']): T12Category | null {
  if (side === 'income') {
    if (VACANCY.test(k)) return 'vacancy-concessions'
    if (kind === 'commercial' && RECOVERY.test(k)) return 'recoveries'
    if (OTHER_INCOME.test(k)) return 'other-income'
    if (RENTAL.test(k)) return 'rental-income'
    return null
  }
  if (side === 'below') {
    if (BELOW_NOT_USED.test(k)) return 'not-used'
    if (CAPEX.test(k) || MAKE_READY.test(k) || REPAIRS.test(k)) return 'capex'
    return null
  }
  if (MAKE_READY.test(k)) return 'capex'
  if (/management fee|mgmt fee|management fees|property management|\bmanagement\b/.test(k) && !PAYROLL.test(k)) return 'management-fee'
  if (PAYROLL.test(k)) return 'payroll'
  if (/insurance/.test(k)) return 'insurance'
  if (TAXES.test(k)) return 'property-taxes'
  if (UTILITIES.test(k)) return 'utilities'
  if (REPAIRS.test(k)) return 'repairs-maintenance'
  if (ADMIN.test(k)) return 'admin-marketing'
  if (CAPEX.test(k)) return 'capex'
  return null
}

const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100
const lineTotal = (l: T12Line) => sum(l.months)
const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`
/** Totals agree to the dollar, or to 0.01% on large totals (cents rounded line by line). */
const agrees = (x: number, y: number) => Math.abs(x - y) <= Math.max(2, Math.abs(y) * 0.0001)

const CODE = /^\d{3,}([-.]\d+)*$/

const LABEL_HEADERS = ['description', 'account name', 'account description', 'line item', 'item', 'name', 'category', 'gl account name']

/** Where the header and columns are, before any line is read. */
function findLayout(grid: Cell[][], opts: T12Options) {
  let headerAt = -1
  let run: ReturnType<typeof monthRun> = null
  for (let r = 0; r < Math.min(HEADER_SEARCH_ROWS, grid.length); r++) {
    run = monthRun(grid[r] ?? [])
    if (run) {
      headerAt = r
      break
    }
  }
  const user = opts.columns ?? {}
  const userFirst = Object.hasOwn(user, 'firstMonth') ? (user.firstMonth ?? null) : undefined
  if (headerAt < 0 && userFirst === undefined) return null
  if (headerAt < 0) headerAt = 0
  const header = grid[headerAt] ?? []
  const width = Math.max(...grid.slice(headerAt, headerAt + 200).map((r) => r?.length ?? 0), header.length)
  const columns = Array.from({ length: width }, (_, i) => text(header[i]))

  const detected: Record<T12ColumnKey, number | null> = { label: null, code: null, firstMonth: run?.start ?? null, total: null }
  const first = userFirst !== undefined ? userFirst : detected.firstMonth
  if (first !== null) {
    const after = columns.findIndex((c, i) => i >= first + 12 && /^(total|ytd|t 12|t12|ttm|annual|year total|12 month total|twelve month total)/.test(key(c)))
    detected.total = after >= 0 ? after : null
    const data = grid.slice(headerAt + 1, headerAt + 200)
    const left = Array.from({ length: first }, (_, i) => i)
    const codeScore = (i: number) => data.filter((r) => CODE.test(text(r?.[i]))).length
    const textScore = (i: number) => data.filter((r) => /[a-z]/i.test(text(r?.[i]))).length
    detected.code = left.find((i) => codeScore(i) >= 3 && codeScore(i) >= textScore(i)) ?? null
    const named = left.find((i) => i !== detected.code && LABEL_HEADERS.includes(key(columns[i])))
    const busiest = left.filter((i) => i !== detected.code).sort((x, y) => textScore(y) - textScore(x))[0]
    detected.label = named ?? (busiest !== undefined && textScore(busiest) > 0 ? busiest : null)
  }

  const mapping = {} as T12Reading['mapping']
  for (const k of Object.keys(T12_COLUMN_LABELS) as T12ColumnKey[]) {
    if (Object.hasOwn(user, k)) {
      const c = user[k] ?? null
      mapping[k] = { column: c !== null && c >= 0 && c < width ? c : null, provenance: 'user' }
    } else mapping[k] = { column: detected[k], provenance: detected[k] === null ? null : 'detected' }
  }
  return { headerAt, columns, mapping, run: userFirst === undefined ? run : null }
}

/** "Period = Oct 2025-Sep 2026", "Oct 2025 - Sep 2026", "12 months ending Sep 30, 2026" in the title rows → the first month. */
function periodFromTitle(rows: Cell[][]): MonthCell | null {
  for (const row of rows) {
    const s = row.map(text).join(' ')
    const range = /([a-z]{3,9})\.?\s*'?(\d{4}|\d{2})\s*(?:-|–|to|through|thru)\s*([a-z]{3,9})/i.exec(s)
    if (range) {
      const m = parseMonth(`${range[1]} ${range[2]}`)
      if (m?.y !== undefined) return m
    }
    const ending = /(?:ending|ended)\s+([a-z]{3,9})\.?\s*(?:\d{1,2},?\s*)?(\d{4})/i.exec(s)
    if (ending) {
      const m = parseMonth(`${ending[1]} ${ending[2]}`)
      if (m?.y !== undefined) return m.m === 11 ? { m: 0, y: m.y } : { m: m.m + 1, y: m.y - 1 }
    }
  }
  return null
}

export function readT12(grid: Cell[][], opts: T12Options): T12Reading {
  const empty: T12Reading = {
    format: 'unknown',
    headerRow: null,
    columns: [],
    mapping: { label: { column: null, provenance: null }, code: { column: null, provenance: null }, firstMonth: { column: null, provenance: null }, total: { column: null, provenance: null } },
    periodStart: null,
    monthLabels: [],
    lines: [],
    fileTotals: {},
    totals: [],
    flags: [],
    blockers: [],
    name: '',
    isSample: false,
  }
  const layout = findLayout(grid, opts)
  if (!layout) {
    return {
      ...empty,
      blockers: [
        `No row of 12 consecutive month headers ("Oct 2025", "10/2025", "Jan"…) in the first ${HEADER_SEARCH_ROWS} rows. ` +
          'A T-12 needs one row per line item and one column per month.',
      ],
    }
  }
  const { headerAt, columns, mapping } = layout
  const blockers: string[] = []
  const flags: string[] = []
  const title = grid.slice(0, headerAt).map((r) => (r ?? []).map(text).filter(Boolean).join(' ')).filter(Boolean)
  const titleText = title.join(' ').toLowerCase()
  const format: T12Format =
    /12 month statement|period\s*=/.test(titleText) || grid.slice(headerAt + 1).some((r) => (r ?? []).some((c) => /^\d{4}-\d{4}$/.test(text(c))))
      ? 'yardi'
      : /twelve.month|appfolio/.test(titleText) || columns.some((c) => key(c) === 'account name')
        ? 'appfolio'
        : 'generic'
  const rawName = title[0] ?? ''
  const isSample = SAMPLE_SUFFIX.test(rawName)
  const name = rawName.replace(SAMPLE_SUFFIX, '').trim()

  const first = mapping.firstMonth.column
  const labelCol = mapping.label.column
  if (first === null) blockers.push('Choose the column of the first month.')
  else if (first + 12 > columns.length) blockers.push('There are fewer than 12 columns from the first month on.')
  if (labelCol === null) blockers.push('Choose the column with the line item names.')
  if (blockers.length) return { ...empty, format, headerRow: headerAt + 1, columns, mapping, blockers, name, isSample }

  // The period: from the headers, or the title, or the analyst.
  const header = grid[headerAt] ?? []
  const months = Array.from({ length: 12 }, (_, i) => parseMonth(header[first! + i]))
  const monthLabels = Array.from({ length: 12 }, (_, i) => text(header[first! + i]) || `Month ${i + 1}`)
  let periodStart: ISODate | null = null
  if (opts.periodStart && /^\d{4}-\d{2}-01$/.test(opts.periodStart)) periodStart = opts.periodStart
  else if (months[0]?.y !== undefined) periodStart = isoMonthStart(months[0].y, months[0].m)
  else {
    const fromTitle = periodFromTitle(grid.slice(0, headerAt))
    if (fromTitle && (!months[0] || months[0].m === fromTitle.m)) periodStart = isoMonthStart(fromTitle.y!, fromTitle.m)
  }
  if (!periodStart) blockers.push('The month headers have no year. Enter the first month of the statement.')
  else if (months.some((m) => !m)) flags.push('Some month headers aren’t dates; the months are read in column order from the first month.')

  // Lines.
  const codeCol = mapping.code.column
  const totalCol = mapping.total.column
  const lines: T12ReadLine[] = []
  const fileTotals: T12Statement['fileTotals'] = {}
  let side: T12Side | null = null
  let group: string | undefined
  let afterNOI = false
  for (let r = headerAt + 1; r < grid.length; r++) {
    const row = grid[r] ?? []
    const code = codeCol !== null ? text(row[codeCol]) : ''
    let label = text(row[labelCol!])
    if (!label && code && !CODE.test(code)) label = code
    const cells = Array.from({ length: 12 }, (_, i) => amount(row[first! + i]))
    const numbers = cells.filter((x): x is number => x !== null && Number.isFinite(x))
    if (!numbers.length) {
      if (!label) continue
      // A heading: opens a section or names a group of lines.
      const s = sectionOf(label)
      if (s && !afterNOI) side = s
      else if (s === 'below') side = 'below'
      group = label
      continue
    }
    if (cells.some((x) => Number.isNaN(x))) {
      flags.push(`Row ${r + 1} (“${label || code}”) has text in a month column; those months are read as 0.`)
    }
    const k = key(label)
    const isSubtotal = SUBTOTAL.test(k)
    const ft = totalCol !== null ? amount(row[totalCol]) : null
    const values = cells.map((x) => (x === null || Number.isNaN(x) ? 0 : x))
    if (isSubtotal) {
      const t = ft !== null && Number.isFinite(ft) ? ft : sum(values)
      if (TOTAL_INCOME.test(k) && fileTotals.income === undefined) fileTotals.income = t
      else if (TOTAL_EXPENSES.test(k) && fileTotals.expenses === undefined) fileTotals.expenses = t
      else if (NOI.test(k) && fileTotals.noi === undefined) fileTotals.noi = t
      if (NOI.test(k)) afterNOI = true
    }
    const lineSide: T12Side = afterNOI && !NOI.test(k) ? 'below' : (side ?? (isSubtotal ? 'income' : guessSide(k)))
    const auto = isSubtotal ? { category: 'not-used' as const, provenance: 'detected' as const } : categorize(label || code, lineSide, group, opts.kind)
    const userCategory = opts.categories?.[r + 1]
    const category = userCategory ?? auto.category
    const userRecoverable = opts.recoverable?.[r + 1]
    lines.push({
      row: r + 1,
      ...(code && code !== label ? { code } : {}),
      label: label || code || `Row ${r + 1}`,
      side: lineSide,
      months: values,
      category,
      recoverable: opts.kind === 'commercial' && (userRecoverable ?? RECOVERABLE_BY_DEFAULT.includes(category)),
      provenance: userCategory ? 'user' : auto.provenance,
      isSubtotal,
      ...(ft !== null && Number.isFinite(ft) ? { fileTotal: ft } : {}),
      ...(group ? { group } : {}),
    })
  }

  normalizeSigns(lines, fileTotals, flags)

  // Row-level check: the months against the row's own Total.
  const offRows = lines.filter((l) => l.fileTotal !== undefined && !agrees(lineTotal(l), l.fileTotal))
  if (offRows.length) {
    flags.push(
      `${offRows.length} row${offRows.length === 1 ? '' : 's'} whose months don’t add to the Total column: ` +
        offRows.slice(0, 6).map((l) => `row ${l.row} (${usd(lineTotal(l))} vs ${usd(l.fileTotal!)})`).join(', ') +
        (offRows.length > 6 ? '…' : '') + '. The months are used.',
    )
  }

  // Counted as the statement will count them: subtotals are "not used" unless the analyst maps one.
  const counted = (s: T12Side) => lines.filter((l) => l.side === s && l.category !== 'not-used')
  const income = sum(counted('income').map(lineTotal))
  const expenses = sum(counted('expense').map(lineTotal))
  const check = (label: string, mapped: number, file: number | undefined): T12TotalCheck => ({
    label,
    mapped,
    file: file ?? null,
    match: file === undefined ? null : agrees(mapped, file),
  })
  const totals = [
    check('Total income', income, fileTotals.income),
    check('Total operating expenses', expenses, fileTotals.expenses),
    check('Net operating income', sum([income, -expenses]), fileTotals.noi),
  ]
  if (totals.every((t) => t.file === null)) flags.push('The file states no Total income, Total operating expenses or NOI row; check the lines against the source report.')

  for (const l of lines) {
    if (l.isSubtotal || l.provenance === 'user') continue
    if (l.side === 'expense' && l.category === 'capex' && MAKE_READY.test(key(l.label))) {
      flags.push(
        `Row ${l.row} “${l.label}” (${usd(lineTotal(l))}) looks like make-ready/turnover and is mapped to Capex / non-recurring, below NOI: ` +
          'the model already charges turnover cost per move-out below NOI. Map it to Repairs & maintenance if it isn’t make-ready.',
      )
    } else if (l.side === 'expense' && l.category === 'capex') {
      flags.push(`Row ${l.row} “${l.label}” (${usd(lineTotal(l))}) sits in operating expenses but reads as capital; it is mapped to Capex / non-recurring, below NOI.`)
    }
  }
  if (!lines.some((l) => !l.isSubtotal && l.side === 'expense')) blockers.push('No operating expense lines found. Check the line item column.')

  return {
    format,
    headerRow: headerAt + 1,
    columns,
    mapping,
    periodStart,
    monthLabels,
    lines,
    fileTotals,
    totals,
    flags,
    blockers,
    name,
    isSample,
  }
}

/** A line with no section heading above it (a plain table): its side from the label. */
function guessSide(k: string): T12Side {
  if (VACANCY.test(k) || RENTAL.test(k) || /income|revenue/.test(k)) return 'income'
  return 'expense'
}

/**
 * Signs as the statement stores them: income positive, revenue deductions
 * negative, expenses positive. Files that show vacancy as a positive deduction
 * or expenses as negatives are turned around, and the flag says so.
 */
function normalizeSigns(lines: T12ReadLine[], totals: T12Statement['fileTotals'], flags: string[]) {
  const flip = (ls: T12ReadLine[]) => {
    for (const l of ls) {
      l.months = l.months.map((x) => (x ? -x : 0))
      if (l.fileTotal !== undefined) l.fileTotal = -l.fileTotal
    }
  }
  const vacancy = lines.filter((l) => l.side === 'income' && !l.isSubtotal && l.category === 'vacancy-concessions')
  if (vacancy.length && sum(vacancy.flatMap((l) => l.months)) > 0) {
    flip(vacancy)
    flags.push('Vacancy and concession lines are positive in the file; they are read as deductions from income. Check Total income below.')
  }
  const expense = lines.filter((l) => l.side === 'expense')
  if (sum(expense.filter((l) => !l.isSubtotal).flatMap((l) => l.months)) < 0) {
    flip(expense)
    if (totals.expenses !== undefined && totals.expenses < 0) totals.expenses = -totals.expenses
    flags.push('Expenses are negative in the file; they are read as positive costs.')
  }
  const below = lines.filter((l) => l.side === 'below' && !l.isSubtotal)
  if (sum(below.flatMap((l) => l.months)) < 0) flip(below)
}

/** Ready to load: nothing blocks, and any totals mismatch has been acknowledged. */
export function t12ReadyToLoad(r: T12Reading, mismatchOK: boolean): boolean {
  return !r.blockers.length && (mismatchOK || r.totals.every((t) => t.match !== false))
}

/** The statement the store and the engine keep: the mapped lines, without the screen's bookkeeping. */
export function statementFrom(r: T12Reading, meta: { fileName: string; importedAt: ISODate }): T12Statement {
  if (!r.periodStart) throw new Error('The T-12 has no period')
  return {
    fileName: meta.fileName,
    importedAt: meta.importedAt,
    ...(r.name ? { name: r.name } : {}),
    isSample: r.isSample,
    periodStart: r.periodStart,
    lines: r.lines.map(({ row, code, label, side, months, category, recoverable }) => ({
      row,
      ...(code ? { code } : {}),
      label,
      side,
      months,
      category,
      recoverable,
    })),
    fileTotals: r.fileTotals,
  }
}
