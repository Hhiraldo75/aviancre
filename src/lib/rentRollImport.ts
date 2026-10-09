import type {
  AssetType,
  BuildingClass,
  Escalation,
  ISODate,
  Lease,
  LeaseType,
  Property,
  Recovery,
  RenewalOption,
  RentStep,
  SubmarketId,
  VacantSpace,
} from '../types'
import { SUBMARKETS } from '../data/submarkets'
import { marketViewFor } from './marketView'
import { estimate, fromImport } from './sourced'

/**
 * Rent roll import: reads the format `rentRollCSV` exports (title, rentable SF,
 * property block, leases table, vacant suites table) back into a Property,
 * validating every row first. Pure: the caller turns a CSV or .xlsx file into
 * a grid of cells (see rentRollFile.ts) and decides what to do with the result.
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

/** What sets the market defaults: from the file's property block, a picker, or CLI flags. */
export interface DealDetails {
  assetType?: AssetType
  buildingClass?: BuildingClass
  submarket?: SubmarketId
  address?: string
}

export interface RentRollSummary {
  name: string
  rentableSF: number | null
  leases: number
  vacancies: number
  leasedSF: number
  vacantSF: number
}

export interface RentRollImport {
  /** Null when there is any error: bad data never loads. */
  property: Property | null
  issues: ImportIssue[]
  /** The details as the file states them, before any overrides. */
  fileDetails: DealDetails
  summary: RentRollSummary
}

export interface ImportOptions {
  fileName: string
  /** Analysis date, for the expired-lease warning. */
  asOf: ISODate
  /** Overrides for the file's property block (the app's pickers, the CLI flags). */
  details?: DealDetails
  importedAt?: ISODate
}

/** Commercial asset types only; multifamily rent rolls are by unit type and use another format. */
export const IMPORT_ASSET_TYPES: AssetType[] = ['office', 'retail', 'industrial', 'mixed-use']
export const BUILDING_CLASSES: BuildingClass[] = ['A', 'B', 'C']

/** Lowercase, without parenthesized units, single-spaced: "Starting rent ($/SF/yr)" → "starting rent". */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const text = (c: Cell) => (c === null || c === undefined ? '' : String(c).trim())

const isBlank = (row: Cell[] | undefined) => !row || row.every((c) => text(c) === '')

interface ColumnSpec {
  label: string
  required: boolean
}

const LEASE_COLUMNS = {
  tenant: { label: 'Tenant', required: true },
  suite: { label: 'Suite', required: true },
  sf: { label: 'SF', required: true },
  start: { label: 'Start', required: true },
  end: { label: 'End', required: true },
  rent: { label: 'Starting rent ($/SF/yr)', required: true },
  escType: { label: 'Escalation type', required: true },
  escValue: { label: 'Escalation value', required: true },
  leaseType: { label: 'Lease type', required: true },
  recovery: { label: 'Recovery method', required: true },
  adminFee: { label: 'Admin fee', required: false },
  freeRent: { label: 'Free rent (months)', required: false },
  renewalRent: { label: 'Renewal option rent ($/SF/yr)', required: false },
  baseYearAmount: { label: 'Base-year expense amount ($/yr)', required: false },
} satisfies Record<string, ColumnSpec>

const VACANT_COLUMNS = {
  suite: { label: 'Suite', required: true },
  sf: { label: 'SF', required: true },
  leaseUp: { label: 'Expected lease-up (months)', required: false },
  asking: { label: 'Asking rent ($/SF/yr)', required: false },
} satisfies Record<string, ColumnSpec>

const ESCALATION_TYPES: Record<string, Escalation['type']> = {
  'fixed % per year': 'fixed-percent',
  'fixed-percent': 'fixed-percent',
  'fixed $/sf per year': 'fixed-amount',
  'fixed-amount': 'fixed-amount',
  steps: 'steps',
  none: 'none',
}

const LEASE_TYPES: Record<string, LeaseType> = {
  nnn: 'NNN',
  'modified-gross': 'modified-gross',
  'full-service-gross': 'full-service-gross',
}

const PROPERTY_FIELDS = ['asset type', 'building class', 'submarket', 'address'] as const
const DETAIL_KEYS: Record<(typeof PROPERTY_FIELDS)[number], keyof DealDetails> = {
  'asset type': 'assetType',
  'building class': 'buildingClass',
  submarket: 'submarket',
  address: 'address',
}

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

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'rent-roll'
  )
}

/** The id an imported deal gets: "deal-" + its name. Private deals are recognized by this prefix. */
export const dealId = (name: string) => `deal-${slug(name)}`

export const isImportedDealId = (id: string) => id.startsWith('deal-')

function submarketFrom(s: string): SubmarketId | undefined {
  const n = s.toLowerCase().trim()
  return Object.values(SUBMARKETS).find((m) => m.id === n || m.name.toLowerCase() === n)?.id
}

const SAMPLE_SUFFIX = /\s*\(fictional sample data\)\s*$/i

export function parseRentRoll(grid: Cell[][], opts: ImportOptions): RentRollImport {
  const issues: ImportIssue[] = []
  const error = (message: string, row?: number, column?: string) => issues.push({ severity: 'error', row, column, message })
  const warn = (message: string, row?: number, column?: string) => issues.push({ severity: 'warning', row, column, message })
  const firstCell = (i: number) => norm(text(grid[i]?.[0]))

  // ---- sections ----
  const leasesAt = grid.findIndex((_, i) => firstCell(i) === 'leases')
  const vacantAt = grid.findIndex((_, i) => firstCell(i) === 'vacant suites')
  const headEnd = leasesAt >= 0 ? leasesAt : vacantAt >= 0 ? vacantAt : grid.length
  if (leasesAt < 0) error('No "Leases" section. The file needs a row reading "Leases" above the leases table.')
  if (vacantAt < 0) error('No "Vacant suites" section. The file needs a row reading "Vacant suites" above that table (it may be empty).')

  // ---- title and rentable SF ----
  const titleRow = grid.findIndex((row) => !isBlank(row))
  const titleText = titleRow >= 0 && titleRow < headEnd ? text(grid[titleRow][0]) : ''
  const isTitle = titleText && !/^rentable sf/i.test(titleText) && !PROPERTY_FIELDS.some((f) => norm(titleText) === f)
  const isSample = isTitle ? SAMPLE_SUFFIX.test(titleText) : false
  const name = isTitle ? titleText.replace(SAMPLE_SUFFIX, '').replace(/:\s*rent roll\s*$/i, '').trim() : ''
  if (!name) error('No property name. The first row should read "<Property name>: rent roll".', 1)

  let rentableSF: number | null = null
  const rsfRow = grid.slice(0, headEnd).findIndex((row) => /^rentable sf/i.test(text(row[0])))
  if (rsfRow < 0) {
    error('No rentable SF. Add a row reading "Rentable SF <number>" above the leases table.')
  } else {
    const inline = /^rentable sf\b[:\s]*([\d,]+(?:\.\d+)?)/i.exec(text(grid[rsfRow][0]))
    const n = inline ? parseNumber(inline[1]) : parseNumber(grid[rsfRow][1])
    if (n === null || !Number.isFinite(n) || n <= 0) {
      error(`Rentable SF must be a positive number, got "${inline?.[1] ?? text(grid[rsfRow][1])}".`, rsfRow + 1, 'Rentable SF')
    } else rentableSF = n
  }

  // ---- property block ----
  const fileDetails: DealDetails = {}
  const fieldRows: Partial<Record<(typeof PROPERTY_FIELDS)[number], number>> = {}
  grid.slice(0, headEnd).forEach((row, i) => {
    const field = PROPERTY_FIELDS.find((f) => firstCell(i) === f)
    if (!field) return
    fieldRows[field] = i + 1
    const value = text(row[1])
    // An explicit choice (picker or CLI flag) replaces the file's value, valid or not.
    if (!value || opts.details?.[DETAIL_KEYS[field]]) return
    if (field === 'asset type') {
      const v = value.toLowerCase()
      if (v === 'multifamily') error('Multifamily rent rolls are by unit type and can\'t be imported in this format.', i + 1, 'Asset type')
      else if ((IMPORT_ASSET_TYPES as string[]).includes(v)) fileDetails.assetType = v as AssetType
      else error(`Unknown asset type "${value}". Use one of: ${IMPORT_ASSET_TYPES.join(', ')}.`, i + 1, 'Asset type')
    } else if (field === 'building class') {
      const v = value.toUpperCase()
      if ((BUILDING_CLASSES as string[]).includes(v)) fileDetails.buildingClass = v as BuildingClass
      else error(`Unknown building class "${value}". Use A, B or C.`, i + 1, 'Building class')
    } else if (field === 'submarket') {
      const id = submarketFrom(value)
      if (id) fileDetails.submarket = id
      else error(`Unknown submarket "${value}". Use one of: ${Object.keys(SUBMARKETS).join(', ')}.`, i + 1, 'Submarket')
    } else fileDetails.address = value
  })
  const details: DealDetails = { ...fileDetails, ...definedOnly(opts.details) }
  const missing = (label: string, field: (typeof PROPERTY_FIELDS)[number]) =>
    error(`${label} is missing. Add the "${label}" row to the property block, or choose one when importing.`, fieldRows[field], label)
  if (!details.assetType && !issues.some((x) => x.column === 'Asset type')) missing('Asset type', 'asset type')
  if (!details.buildingClass && !issues.some((x) => x.column === 'Building class')) missing('Building class', 'building class')
  if (!details.submarket && !issues.some((x) => x.column === 'Submarket')) missing('Submarket', 'submarket')
  if (details.assetType && details.submarket) {
    const lookup = details.assetType === 'mixed-use' ? 'office' : details.assetType
    if (!SUBMARKETS[details.submarket].benchmarks[lookup]) {
      error(
        `${SUBMARKETS[details.submarket].name} has no ${lookup} market benchmark yet. Choose another submarket or asset type.`,
        fieldRows.submarket,
        'Submarket',
      )
    }
  }

  // ---- tables ----
  const id = dealId(name)
  const sourceName = `Imported rent roll (${opts.fileName})`
  const leaseTable = leasesAt >= 0 ? readTable(grid, leasesAt, LEASE_COLUMNS, 'Leases', error, warn) : null
  const vacantTable = vacantAt >= 0 ? readTable(grid, vacantAt, VACANT_COLUMNS, 'Vacant suites', error, warn) : null

  const leases: Lease[] = []
  for (const { row, get } of leaseTable?.rows ?? []) {
    const lease = parseLease(row, get, `${id}-L${leases.length + 1}`, sourceName, error, warn)
    if (lease) leases.push(lease)
  }
  const vacancies: VacantSpace[] = []
  for (const { row, get } of vacantTable?.rows ?? []) {
    const space = parseVacant(row, get, `${id}-V${vacancies.length + 1}`, sourceName, opts.importedAt, error)
    if (space) vacancies.push(space)
  }
  if (leaseTable && !leaseTable.rows.length && vacantTable && !vacantTable.rows.length) {
    error('The rent roll has no leases and no vacant suites.', leasesAt + 1)
  }

  // ---- cross-row checks ----
  const suites = new Map<string, number>()
  for (const { row, get } of [...(leaseTable?.rows ?? []), ...(vacantTable?.rows ?? [])]) {
    const suite = text(get('suite'))
    if (!suite) continue
    const first = suites.get(suite)
    if (first !== undefined) warn(`Suite "${suite}" also appears on row ${first}.`, row, 'Suite')
    else suites.set(suite, row)
  }
  for (const { row, get } of leaseTable?.rows ?? []) {
    const end = parseDate(get('end'))
    if (end && end < opts.asOf) {
      warn(`Lease expired on ${end}, before the analysis date (${opts.asOf}); the suite is treated as rolling over.`, row, 'End')
    }
  }
  // Totals from every row's SF cell, so a row with an error elsewhere still counts.
  const sumSF = (rows: TableRow<'sf'>[] = []) =>
    rows.reduce((s, { get }) => {
      const n = parseNumber(get('sf'))
      return n !== null && Number.isFinite(n) && n > 0 ? s + n : s
    }, 0)
  const leasedSF = sumSF(leaseTable?.rows)
  const vacantSF = sumSF(vacantTable?.rows)
  if (rentableSF !== null && Math.abs(leasedSF + vacantSF - rentableSF) > 0.5) {
    const f = (n: number) => n.toLocaleString('en-US')
    warn(
      `Leased (${f(leasedSF)} SF) + vacant (${f(vacantSF)} SF) = ${f(leasedSF + vacantSF)} SF, but rentable SF is ${f(rentableSF)}. ` +
        'Occupancy and per-SF figures use rentable SF.',
      rsfRow + 1,
      'Rentable SF',
    )
  }
  if (!details.address) {
    const where = details.submarket ? SUBMARKETS[details.submarket].name : 'its submarket'
    warn(`No address. The deal is placed at the center of ${where} on the map (approximate).`, fieldRows.address, 'Address')
  }

  const summary: RentRollSummary = {
    name,
    rentableSF,
    leases: leaseTable?.rows.length ?? 0,
    vacancies: vacantTable?.rows.length ?? 0,
    leasedSF,
    vacantSF,
  }
  issues.sort((a, b) => (a.row ?? 0) - (b.row ?? 0))
  if (issues.some((x) => x.severity === 'error')) return { property: null, issues, fileDetails, summary }

  const { assetType, buildingClass, submarket } = details as Required<Pick<DealDetails, 'assetType' | 'buildingClass' | 'submarket'>>
  const importedAt = opts.importedAt ?? opts.asOf
  const notInRentRoll = (what: string) => `Not in rent roll – replace with ${what}`
  const [lng, lat] = SUBMARKETS[submarket].center
  const property: Property = {
    id,
    name,
    assetType,
    buildingClass,
    location: {
      address: details.address ?? `${SUBMARKETS[submarket].name} (location approximate)`,
      city: 'Providence',
      state: 'RI',
      lng,
      lat,
      submarket,
      isApproximate: true,
    },
    physical: {
      grossBuildingSF: estimate(rentableSF!, notInRentRoll('building records (rentable SF used)')),
      rentableSF: fromImport(rentableSF!, sourceName, importedAt),
      floors: estimate(1, notInRentRoll('building records')),
    },
    zoning: { district: estimate('Unknown', notInRentRoll('the Providence zoning map')) },
    valuation: {},
    market: marketViewFor(submarket, assetType, buildingClass),
    rentRoll: { kind: 'commercial', leases, vacancies },
    isSample,
    importedFrom: { fileName: opts.fileName, importedAt },
  }
  return { property, issues, fileDetails, summary }
}

function definedOnly(d: DealDetails | undefined): DealDetails {
  return Object.fromEntries(Object.entries(d ?? {}).filter(([, v]) => v !== undefined && v !== '')) as DealDetails
}

type Report = (message: string, row?: number, column?: string) => void

interface TableRow<K extends string> {
  /** 1-based row number. */
  row: number
  get: (key: K) => Cell
}

/**
 * The table under a section title: its header row (the next non-blank row),
 * then data rows up to the first blank row or the next section.
 */
function readTable<K extends string>(
  grid: Cell[][],
  titleAt: number,
  columns: Record<K, ColumnSpec>,
  section: string,
  error: Report,
  warn: Report,
): { rows: TableRow<K>[] } | null {
  let headerAt = titleAt + 1
  while (headerAt < grid.length && isBlank(grid[headerAt])) headerAt++
  const header = (grid[headerAt] ?? []).map((c) => norm(text(c)))
  if (headerAt >= grid.length || ['leases', 'vacant suites'].includes(header[0])) {
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
    if (isBlank(r) || ['leases', 'vacant suites'].includes(norm(text(r[0])))) break
    rows.push({ row: i + 1, get: (key) => (index[key] >= 0 ? r[index[key]] : undefined) })
  }
  return { rows }
}

type LeaseKey = keyof typeof LEASE_COLUMNS
type VacantKey = keyof typeof VACANT_COLUMNS

/** Reads an optional number cell; reports and returns NaN when it isn't a number ≥ min. */
function optionalNumber(c: Cell, column: string, row: number, error: Report, min = 0): number | undefined {
  const n = parseNumber(c)
  if (n === null) return undefined
  if (!Number.isFinite(n) || n < min) {
    error(`${column} must be a number of at least ${min}, got "${text(c)}".`, row, column)
    return NaN
  }
  return n
}

/** Rates are decimals; a value of 1 or more was almost certainly typed as a whole percent. */
function checkRate(n: number, column: string, row: number, error: Report): boolean {
  if (n >= 1) {
    error(`${column} ${n} looks like a whole percent. Percentages are decimals: use ${n / 100} for ${n}%.`, row, column)
    return false
  }
  return true
}

function parseLease(
  row: number,
  get: (key: LeaseKey) => Cell,
  id: string,
  sourceName: string,
  error: Report,
  warn: Report,
): Lease | null {
  let errors = 0
  const fail: Report = (message, r, column) => {
    errors++
    error(message, r, column)
  }
  const col = (k: LeaseKey) => LEASE_COLUMNS[k].label

  const tenantName = text(get('tenant'))
  if (!tenantName) fail('Tenant is blank.', row, col('tenant'))
  const suite = text(get('suite'))

  const sf = parseNumber(get('sf'))
  if (sf === null || !Number.isFinite(sf) || sf <= 0) fail(`SF must be a positive number, got "${text(get('sf'))}".`, row, col('sf'))

  const start = parseDate(get('start'))
  const end = parseDate(get('end'))
  if (!start) fail(`Start "${text(get('start'))}" is not a valid date. Use YYYY-MM-DD.`, row, col('start'))
  if (!end) fail(`End "${text(get('end'))}" is not a valid date. Use YYYY-MM-DD.`, row, col('end'))
  if (start && end && end <= start) fail(`End (${end}) must be after Start (${start}).`, row, col('end'))

  const rent = parseNumber(get('rent'))
  if (rent === null || !Number.isFinite(rent) || rent < 0) {
    fail(`Starting rent must be a number of at least 0, got "${text(get('rent'))}".`, row, col('rent'))
  }

  const escalation = parseEscalation(get('escType'), get('escValue'), row, fail)

  const leaseTypeText = text(get('leaseType'))
  const leaseType = LEASE_TYPES[leaseTypeText.toLowerCase().replace(/\s+/g, '-')]
  if (!leaseType) {
    fail(`Unknown lease type "${leaseTypeText}". Use one of: NNN, modified-gross, full-service-gross.`, row, col('leaseType'))
  }

  const recovery = parseRecovery(get('recovery'), row, fail)
  const adminFee = optionalNumber(get('adminFee'), col('adminFee'), row, fail)
  if (adminFee !== undefined && Number.isFinite(adminFee) && checkRate(adminFee, col('adminFee'), row, fail) && recovery) {
    if (recovery.method === 'net') recovery.adminFeePct = adminFee
    else warn(`Admin fee applies only to net recoveries; ignored for "${text(get('recovery'))}".`, row, col('adminFee'))
  }
  const baseYearAmount = optionalNumber(get('baseYearAmount'), col('baseYearAmount'), row, fail)
  if (baseYearAmount !== undefined && Number.isFinite(baseYearAmount) && recovery) {
    if (recovery.method === 'base-year') recovery.baseYearExpenses = baseYearAmount
    else warn(`Base-year expense amount applies only to base-year recoveries; ignored for "${text(get('recovery'))}".`, row, col('baseYearAmount'))
  }

  const freeRentMonths = optionalNumber(get('freeRent'), col('freeRent'), row, fail)
  const renewalOptions = parseRenewalOption(get('renewalRent'), row, fail)

  if (errors) return null
  return {
    id,
    tenantName,
    suite,
    leasedSF: sf!,
    commencementDate: start!,
    expirationDate: end!,
    startingRentPerSF: rent!,
    escalation: escalation!,
    leaseType,
    recovery: recovery!,
    freeRentMonths,
    renewalOptions,
    source: 'imported',
    sourceName,
  }
}

function parseEscalation(typeCell: Cell, valueCell: Cell, row: number, fail: Report): Escalation | null {
  const typeCol = LEASE_COLUMNS.escType.label
  const valueCol = LEASE_COLUMNS.escValue.label
  const type = ESCALATION_TYPES[text(typeCell).toLowerCase().replace(/\s+/g, ' ')]
  if (!type) {
    fail(`Unknown escalation type "${text(typeCell)}". Use one of: fixed % per year, fixed $/SF per year, steps, none.`, row, typeCol)
    return null
  }
  if (type === 'none') return { type }
  if (type === 'steps') {
    const steps: RentStep[] = []
    for (const part of text(valueCell).split(';').filter((p) => p.trim())) {
      const m = /^\s*([^:]+?)\s*:\s*(\$?[\d,]*\.?\d+)\s*$/.exec(part)
      const date = m ? parseDate(m[1]) : null
      const rent = m ? parseNumber(m[2]) : null
      if (!date || rent === null || !Number.isFinite(rent)) {
        fail(`Rent step "${part.trim()}" should read "YYYY-MM-DD: $25.00".`, row, valueCol)
        return null
      }
      steps.push({ effectiveDate: date, annualRentPerSF: rent })
    }
    if (!steps.length) {
      fail('Escalation type "steps" needs the steps, e.g. "2027-01-01: $25.00; 2028-01-01: $26.00".', row, valueCol)
      return null
    }
    return { type, steps }
  }
  const value = parseNumber(valueCell)
  if (value === null || !Number.isFinite(value) || value < 0) {
    fail(`Escalation value must be a number of at least 0, got "${text(valueCell)}".`, row, valueCol)
    return null
  }
  if (type === 'fixed-percent') return checkRate(value, valueCol, row, fail) ? { type, annualPct: value } : null
  return { type, annualPerSF: value }
}

function parseRecovery(cell: Cell, row: number, fail: Report): Recovery | null {
  const column = LEASE_COLUMNS.recovery.label
  const s = text(cell).toLowerCase()
  if (s === 'net') return { method: 'net' }
  if (s === 'none') return { method: 'none' }
  const baseYear = /^base[- ]year\s*\(?\s*(\d{4})?\s*\)?$/.exec(s)
  if (baseYear) {
    if (!baseYear[1]) {
      fail('Recovery method base-year needs the year, e.g. "base-year (2019)".', row, column)
      return null
    }
    return { method: 'base-year', baseYear: Number(baseYear[1]) }
  }
  const stop = /^expense[- ]stop\s*\(?\s*\$?([\d,]*\.?\d+)\s*(\/\s*sf)?\s*\)?$/.exec(s)
  if (stop) return { method: 'expense-stop', stopPerSF: parseNumber(stop[1])! }
  fail(`Unknown recovery method "${text(cell)}". Use one of: net, none, base-year (YYYY), expense-stop ($X/SF).`, row, column)
  return null
}

/** The engine prices the first option only, as the export writes it. Term: a 5-year default. */
function parseRenewalOption(cell: Cell, row: number, fail: Report): RenewalOption[] | undefined {
  const column = LEASE_COLUMNS.renewalRent.label
  const s = text(cell)
  if (!s) return undefined
  const ofMarket = /^(\d+(?:\.\d+)?)\s*%\s*of\s*market$/i.exec(s)
  if (ofMarket) return [{ termMonths: 60, rentBasis: 'percent-of-market', value: Number(ofMarket[1]) / 100 }]
  const n = parseNumber(cell)
  if (n === null || !Number.isFinite(n) || n <= 0) {
    fail(`Renewal option rent must be a $/SF number or "N% of market", got "${s}".`, row, column)
    return undefined
  }
  return [{ termMonths: 60, rentBasis: 'fixed', value: n }]
}

function parseVacant(
  row: number,
  get: (key: VacantKey) => Cell,
  id: string,
  sourceName: string,
  importedAt: ISODate | undefined,
  error: Report,
): VacantSpace | null {
  let errors = 0
  const fail: Report = (message, r, column) => {
    errors++
    error(message, r, column)
  }
  const suite = text(get('suite'))
  if (!suite) fail('Suite is blank.', row, VACANT_COLUMNS.suite.label)
  const sf = parseNumber(get('sf'))
  if (sf === null || !Number.isFinite(sf) || sf <= 0) fail(`SF must be a positive number, got "${text(get('sf'))}".`, row, VACANT_COLUMNS.sf.label)
  const expectedLeaseUpMonths = optionalNumber(get('leaseUp'), VACANT_COLUMNS.leaseUp.label, row, fail)
  const askingText = text(get('asking'))
  let askingRentPerSF: VacantSpace['askingRentPerSF']
  if (askingText && !/^none\b|market/i.test(askingText)) {
    const n = parseNumber(get('asking'))
    if (n === null || !Number.isFinite(n) || n <= 0) {
      fail(`Asking rent must be a positive $/SF number or "none (market rent)", got "${askingText}".`, row, VACANT_COLUMNS.asking.label)
    } else askingRentPerSF = fromImport(n, sourceName, importedAt)
  }
  if (errors) return null
  return { id, suite, sf: sf!, expectedLeaseUpMonths, askingRentPerSF }
}
