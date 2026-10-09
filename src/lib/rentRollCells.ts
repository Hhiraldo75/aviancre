import type { ISODate } from '../types'

/**
 * Cell-level helpers shared by the commercial (rentRollImport.ts) and unit
 * (unitRentRoll.ts) rent roll readers: parsing cells, and reading a table
 * under a section title with row numbers for every issue.
 */

/** One spreadsheet cell: text, a number, or empty. Dates arrive as ISO text or Excel serial numbers. */
export type Cell = string | number | null | undefined

export interface ImportIssue {
  severity: 'error' | 'warning'
  /** 1-based row number, as Excel and text editors show it. */
  row?: number
  column?: string
  message: string
}

export type Report = (message: string, row?: number, column?: string) => void

/** Lowercase, without parenthesized units, single-spaced: "Starting rent ($/SF/yr)" → "starting rent". */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()

export const text = (c: Cell) => (c === null || c === undefined ? '' : String(c).trim())

export const isBlank = (row: Cell[] | undefined) => !row || row.every((c) => text(c) === '')

/** Excel's 1900 date system: serial 25569 is 1970-01-01. */
export function excelSerialToISO(serial: number): ISODate {
  return new Date(Math.round((serial - 25569) * 86_400_000)).toISOString().slice(0, 10)
}

function isoDate(y: number, m: number, d: number): ISODate | null {
  const t = new Date(Date.UTC(y, m - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null
  return t.toISOString().slice(0, 10)
}

/** YYYY-MM-DD, M/D/YYYY or M/D/YY (as Excel re-saves a CSV), or an Excel date serial. Null when invalid. */
export function parseDate(c: Cell): ISODate | null {
  if (typeof c === 'number') return c >= 1 && c < 110_000 ? excelSerialToISO(c) : null
  const s = text(c)
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  if (m) return isoDate(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s)
  if (m) {
    const y = m[3].length === 2 ? (+m[3] < 70 ? 2000 : 1900) + +m[3] : +m[3]
    return isoDate(y, +m[1], +m[2])
  }
  return null
}

/** A number, allowing "$", thousands commas and a trailing "%" (3% → 0.03). Null when blank, NaN when not a number. */
export function parseNumber(c: Cell): number | null {
  if (typeof c === 'number') return c
  const s = text(c)
  if (!s) return null
  const percent = s.endsWith('%')
  const t = s.replace(/[$,\s]/g, '').replace(/%$/, '')
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN
  return percent ? Number(t) / 100 : Number(t)
}

export interface ColumnSpec {
  label: string
  required: boolean
}

export interface TableRow<K extends string> {
  /** 1-based row number. */
  row: number
  get: (key: K) => Cell
}

/**
 * The table under a section title: its header row (the next non-blank row),
 * then data rows up to the first blank row or the next section (`sections`
 * are the normalized titles that end a table).
 */
export function readTable<K extends string>(
  grid: Cell[][],
  titleAt: number,
  columns: Record<K, ColumnSpec>,
  section: string,
  sections: string[],
  error: Report,
  warn: Report,
): { rows: TableRow<K>[] } | null {
  let headerAt = titleAt + 1
  while (headerAt < grid.length && isBlank(grid[headerAt])) headerAt++
  const header = (grid[headerAt] ?? []).map((c) => norm(text(c)))
  if (headerAt >= grid.length || sections.includes(header[0])) {
    error(`The ${section} section has no header row.`, titleAt + 1)
    return null
  }
  const index = {} as Record<K, number>
  const missing: string[] = []
  for (const [key, spec] of Object.entries(columns) as [K, ColumnSpec][]) {
    index[key] = header.indexOf(norm(spec.label))
    if (index[key] < 0 && spec.required) missing.push(spec.label)
  }
  if (missing.length) {
    error(`${section}: missing required column${missing.length > 1 ? 's' : ''} ${missing.map((m) => `"${m}"`).join(', ')}.`, headerAt + 1)
    return null
  }
  const known = new Set(Object.values<ColumnSpec>(columns).map((c) => norm(c.label)))
  grid[headerAt].forEach((c, i) => {
    if (text(c) && !known.has(header[i])) warn(`${section}: column "${text(c)}" isn't used and was ignored.`, headerAt + 1, text(c))
  })

  const rows: TableRow<K>[] = []
  for (let i = headerAt + 1; i < grid.length; i++) {
    const r = grid[i]
    if (isBlank(r) || sections.includes(norm(text(r[0])))) break
    rows.push({ row: i + 1, get: (key) => (index[key] >= 0 ? r[index[key]] : undefined) })
  }
  return { rows }
}

/** Reads an optional number cell; reports and returns NaN when it isn't a number ≥ min. */
export function optionalNumber(c: Cell, column: string, row: number, error: Report, min = 0): number | undefined {
  const n = parseNumber(c)
  if (n === null) return undefined
  if (!Number.isFinite(n) || n < min) {
    error(`${column} must be a number of at least ${min}, got "${text(c)}".`, row, column)
    return NaN
  }
  return n
}
