import type { ISODate } from '../types'
import { fmt } from './format'
import { isBlank, norm, text, type Cell } from './rentRollCells'
import { GENERIC_FIELDS, genericLayout, readGeneric } from './rentRollGeneric'
import {
  resolveFields,
  SAMPLE_SUFFIX,
  type ChargeCodeRow,
  type ChargeUse,
  type FieldKey,
  type FieldMapping,
  type Layout,
  type RawUnit,
  type StatusChoice,
  type StatusValueRow,
} from './rentRollLayout'
import { readYardi, YARDI_FIELDS, yardiLayout } from './rentRollYardi'
import { UNIT_COLUMNS } from './unitRentRoll'
import { csvCell } from './underwriting/report'

/**
 * Converts a rent roll that isn't in our format (a Yardi "Rent Roll with Lease
 * Charges" or a plain table of units) into our unit rent roll, which
 * `parseRentRoll` then validates as usual. Nothing is guessed silently:
 * a required field with no column, or a status value or charge code nobody has
 * classified, is a blocker; anything inferred is flagged. The file's own totals
 * are the cross-check. Pure: the import dialog and `npm run convert` share it.
 */

export type LayoutFormat = 'ours' | 'yardi-lease-charges' | 'generic' | 'unknown'
export type ConvertibleFormat = Extract<LayoutFormat, 'yardi-lease-charges' | 'generic'>

export const FORMAT_LABELS: Record<LayoutFormat, string> = {
  ours: 'AVIANCRE rent roll',
  'yardi-lease-charges': 'Yardi Rent Roll with Lease Charges',
  generic: 'Table of units (header row found)',
  unknown: 'Unrecognized layout',
}

export type { ChargeCodeRow, ChargeUse, FieldKey, FieldMapping, StatusChoice, StatusValueRow }
export { STATUS_CHOICES } from './rentRollLayout'

export interface FloorPlanGroup {
  /** "<SF>|<market rent>": what groups units into a plan. */
  key: string
  sf: number | null
  market: number | null
  defaultName: string
  /** The default, or the user's rename. Plans with the same name merge on import. */
  name: string
  units: number
  /** The file's unit type codes in this plan (kept as notes). */
  codes: string[]
}

export interface ConvertedUnit extends RawUnit {
  planKey: string
  plan: string
}

export interface TotalsCheck {
  label: string
  kind: 'count' | 'sf' | 'usd'
  converted: number
  /** Null when the file doesn't state it. */
  file: number | null
  match: boolean | null
}

/** A confirmed mapping for one layout, applied automatically when the same header comes up again. */
export interface RentRollPreset {
  name: string
  format: ConvertibleFormat
  signature: string
  /** Column label per field. */
  mapping: Partial<Record<FieldKey, string>>
  chargeCodes?: Record<string, ChargeUse>
  statusValues?: Record<string, StatusChoice>
  savedAt?: ISODate
}

export interface ConvertOptions {
  /** The user's column picks (0-based index, or null for "not in file"); they win over presets and detection. */
  mapping?: Partial<Record<FieldKey, number | null>>
  chargeCodes?: Record<string, ChargeUse>
  statusValues?: Record<string, StatusChoice>
  /** Floor plan names by plan key. */
  planNames?: Record<string, string>
  /** Replaces the property name read from the file. */
  name?: string
  presets?: RentRollPreset[]
  /** For the stale as-of warning; omitted, there is no such check. */
  today?: ISODate
}

export interface Conversion {
  format: LayoutFormat
  presetName?: string
  signature: string
  /** 1-based row of the header, as Excel shows it. */
  headerRow: number | null
  columns: string[]
  fields: FieldMapping[]
  chargeCodes: ChargeCodeRow[]
  statusValues: StatusValueRow[]
  units: ConvertedUnit[]
  plans: FloorPlanGroup[]
  flags: string[]
  blockers: string[]
  totals: TotalsCheck[]
  name: string
  isSample: boolean
  asOf: ISODate | null
  rentableSF: number
}

/** Our own format, as `parseRentRoll` recognizes it: a "Units" title over a "Unit" header, or a Leases / Vacant suites section. */
function isOurFormat(grid: Cell[][]): boolean {
  const first = (i: number) => norm(text(grid[i]?.[0]))
  for (let i = 0; i < grid.length; i++) {
    const f = first(i)
    if (f === 'leases' || f === 'vacant suites') return true
    if (f === 'units' && grid[i].slice(1).every((c) => !text(c))) {
      let j = i + 1
      while (j < grid.length && isBlank(grid[j])) j++
      if (first(j) === 'unit') return true
    }
  }
  return false
}

export function detectLayout(grid: Cell[][]): LayoutFormat {
  if (isOurFormat(grid)) return 'ours'
  if (yardiLayout(grid)) return 'yardi-lease-charges'
  if (genericLayout(grid)) return 'generic'
  return 'unknown'
}

const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100

export function convertRentRoll(grid: Cell[][], opts: ConvertOptions = {}): Conversion {
  const format = detectLayout(grid)
  const empty: Conversion = {
    format,
    signature: '',
    headerRow: null,
    columns: [],
    fields: [],
    chargeCodes: [],
    statusValues: [],
    units: [],
    plans: [],
    flags: [],
    blockers: [],
    totals: [],
    name: '',
    isSample: false,
    asOf: null,
    rentableSF: 0,
  }
  if (format === 'ours') return { ...empty, blockers: ['The file is already an AVIANCRE rent roll: import it directly.'] }
  if (format === 'unknown') {
    return {
      ...empty,
      blockers: [
        'No header row found in the first 30 rows (a row naming at least Unit and two of SF, market rent, rent, tenant, status, lease end…). ' +
          'Use /convert-rent-roll in Claude Code for this layout.',
      ],
    }
  }

  const yardi = format === 'yardi-lease-charges'
  const layout = (yardi ? yardiLayout(grid) : genericLayout(grid)) as Layout
  const preset = opts.presets?.find((p) => p.format === format && p.signature === layout.signature)
  const fields = resolveFields(yardi ? YARDI_FIELDS : GENERIC_FIELDS, layout, preset?.mapping, opts.mapping)
  const base = { ...empty, presetName: preset?.name, signature: layout.signature, headerRow: layout.headerStart + 1, columns: layout.columns, fields }

  const missing = fields.filter((f) => f.required && f.column === null)
  if (missing.length) {
    return { ...base, blockers: missing.map((f) => `Map a column to "${f.label}" to continue.`) }
  }

  const choices = {
    chargeCodes: { ...preset?.chargeCodes, ...opts.chargeCodes },
    statusValues: { ...preset?.statusValues, ...opts.statusValues },
  }
  const ex = (yardi ? readYardi : readGeneric)(grid, layout, fields, choices)
  // The readers see one set of choices; credit the preset for the ones it made.
  const fromPreset = (key: string, mine: Record<string, unknown> | undefined, theirs: Record<string, unknown> | undefined) =>
    theirs && Object.hasOwn(theirs, key) && !(mine && Object.hasOwn(mine, key))
  const chargeCodes = ex.chargeCodes.map((c) => (fromPreset(c.code, opts.chargeCodes, preset?.chargeCodes) ? { ...c, provenance: 'preset' as const } : c))
  const statusValues = ex.statusValues.map((s) =>
    fromPreset(s.value, opts.statusValues, preset?.statusValues) ? { ...s, provenance: 'preset' as const } : s,
  )
  const flags = [...ex.flags]
  const blockers = [...ex.blockers]

  // ---- name and as-of date ----
  const rawName = (opts.name ?? ex.name).trim()
  const isSample = SAMPLE_SUFFIX.test(rawName)
  const name = rawName.replace(SAMPLE_SUFFIX, '').trim()
  if (!name) blockers.push('No property name in the file. Enter one under Property name.')
  if (opts.name?.trim() && ex.name && opts.name.trim() !== ex.name) flags.push(`Property name entered by hand (the file says "${ex.name}").`)
  if (ex.asOf && opts.today) {
    const years = (Date.parse(opts.today) - Date.parse(ex.asOf)) / (365.25 * 86_400_000)
    if (years > 1) {
      flags.push(
        `The rent roll is as of ${ex.asOf}, about ${Math.round(years)} year${Math.round(years) === 1 ? '' : 's'} ago: ` +
          'leases that have ended since are treated as month-to-month on import.',
      )
    }
  }

  // ---- missing values ----
  const list = (xs: string[]) => (xs.length > 8 ? `${xs.slice(0, 8).join(', ')} and ${xs.length - 8} more` : xs.join(', '))
  const noSF = ex.units.filter((u) => u.sf === null || u.sf <= 0).map((u) => u.unit)
  const noMarket = ex.units.filter((u) => u.market === null || u.market <= 0).map((u) => u.unit)
  if (noSF.length) blockers.push(`No SF for units ${list(noSF)}.`)
  if (noMarket.length) blockers.push(`No market rent for units ${list(noMarket)}.`)

  // ---- floor plans: one per (SF, market rent) pair ----
  const plans: FloorPlanGroup[] = []
  const planOf = new Map<string, FloorPlanGroup>()
  for (const u of ex.units) {
    const key = `${u.sf ?? ''}|${u.market ?? ''}`
    let plan = planOf.get(key)
    if (!plan) {
      plan = { key, sf: u.sf, market: u.market, defaultName: '', name: '', units: 0, codes: [] }
      planOf.set(key, plan)
      plans.push(plan)
    }
    plan.units++
    if (u.unitType && !plan.codes.includes(u.unitType)) plan.codes.push(u.unitType)
  }
  const bySF = new Map<string, number>()
  for (const p of plans) bySF.set(String(p.sf), (bySF.get(String(p.sf)) ?? 0) + 1)
  let namedByType = 0
  for (const p of plans) {
    const sfName = p.sf === null ? 'Unknown SF' : `${p.sf} SF`
    const byType = !yardi && p.codes.length === 1 && ex.units.every((u) => planOf.get(`${u.sf ?? ''}|${u.market ?? ''}`) !== p || u.unitType)
    if (byType) namedByType++
    p.defaultName = byType ? p.codes[0] : bySF.get(String(p.sf))! > 1 && p.market !== null ? `${sfName} · ${fmt.usd(p.market)}` : sfName
    p.name = opts.planNames?.[p.key]?.trim() || p.defaultName
  }
  const codeCount = new Set(ex.units.map((u) => u.unitType).filter(Boolean)).size
  if (plans.length) {
    flags.push(
      `Floor plans grouped by SF + market rent: ${plans.length} plan${plans.length === 1 ? '' : 's'}` +
        (codeCount ? ` from ${codeCount} unit type code${codeCount === 1 ? '' : 's'} (kept in the Note column)` : '') +
        (namedByType ? `; ${namedByType} named after the file's unit type` : '') +
        '. Rename them under Floor plans; plans given the same name are merged.',
    )
  }
  const units: ConvertedUnit[] = ex.units.map((u) => {
    const plan = planOf.get(`${u.sf ?? ''}|${u.market ?? ''}`)!
    return { ...u, planKey: plan.key, plan: plan.name }
  })

  // ---- totals check ----
  const occupied = units.filter((u) => u.occupied)
  const vacant = units.filter((u) => !u.occupied)
  const rentableSF = sum(units.map((u) => u.sf ?? 0))
  const t = ex.fileTotals
  const check = (label: string, kind: TotalsCheck['kind'], converted: number, file: number | undefined): TotalsCheck => ({
    label,
    kind,
    converted,
    file: file ?? null,
    match: file === undefined ? null : Math.abs(converted - file) < (kind === 'count' ? 0.001 : 0.5),
  })
  const occRent = sum(occupied.map((u) => u.inPlace))
  const vacMarket = sum(vacant.map((u) => u.market ?? 0))
  const totals: TotalsCheck[] = [
    check('Units', 'count', units.length, t.units),
    check('Occupied', 'count', occupied.length, t.occupied),
    check('Vacant', 'count', vacant.length, t.vacant),
    check('Pre-leased', 'count', units.filter((u) => u.preLeased).length, undefined),
    check('Rentable SF', 'sf', rentableSF, t.sf),
    ...(t.totalMarket !== undefined ? [check('Market rent, all units ($/mo)', 'usd', sum(units.map((u) => u.market ?? 0)), t.totalMarket)] : []),
    ...(t.occupiedMarket !== undefined ? [check('Market rent, occupied ($/mo)', 'usd', sum(occupied.map((u) => u.market ?? 0)), t.occupiedMarket)] : []),
    check('Market rent, vacant ($/mo)', 'usd', vacMarket, t.vacantMarket),
    check('In-place rent, occupied ($/mo)', 'usd', occRent, t.occupiedRent),
    check(
      'Rent + vacant market ($/mo)',
      'usd',
      sum([occRent, vacMarket]),
      t.occupiedRent !== undefined && t.vacantMarket !== undefined ? sum([t.occupiedRent, t.vacantMarket]) : undefined,
    ),
    check('Other income ($/mo)', 'usd', sum(occupied.map((u) => u.otherIncome)), t.otherIncome),
  ]
  flags.push(`Rentable SF is the units' total, ${fmt.sf(rentableSF)}.`)

  return { ...base, chargeCodes, statusValues, units, plans, flags, blockers, totals, name, isSample, asOf: ex.asOf, rentableSF }
}

export const totalsMismatches = (c: Conversion) => c.totals.filter((t) => t.match === false)

/** Nothing blocks, and any totals mismatch has been acknowledged. */
export const readyToLoad = (c: Conversion, mismatchOK: boolean) =>
  (c.format === 'yardi-lease-charges' || c.format === 'generic') && !c.blockers.length && (!totalsMismatches(c).length || mismatchOK)

export function formatTotal(kind: TotalsCheck['kind'], n: number): string {
  return kind === 'usd' ? fmt.usdCents(n) : kind === 'sf' ? fmt.sf(n) : fmt.int(n)
}

/** The conversion in our unit rent roll format, for `parseRentRoll`. */
export function conversionGrid(c: Conversion): Cell[][] {
  return [
    [`${c.name}: unit rent roll${c.isSample ? ' (fictional sample data)' : ''}`],
    [`${c.asOf ? `As of ${c.asOf}; ` : ''}rents are monthly $; converted from a ${FORMAT_LABELS[c.format]}`],
    [],
    ['Property'],
    ['Asset type', 'multifamily'],
    ['Units', c.units.length],
    ['Rentable SF', c.rentableSF],
    ['Class', ''],
    ['Submarket', ''],
    ['Address', ''],
    [],
    ['Units'],
    Object.values(UNIT_COLUMNS).map((col) => col.label),
    ...c.units.map((u) => [
      u.unit,
      u.plan,
      u.sf ?? '',
      u.occupied ? 'Occupied' : 'Vacant',
      u.market ?? '',
      u.occupied ? u.inPlace : 0,
      u.otherIncome,
      u.moveIn ?? '',
      u.leaseEnd ?? '',
      u.balance,
      u.preLeased ? 'Yes' : '',
      u.notes.join('; '),
    ]),
  ]
}

export const conversionCSV = (c: Conversion) =>
  conversionGrid(c)
    .map((row) => row.map((cell) => csvCell(cell)).join(','))
    .join('\n') + '\n'

// ---- presets ----

export function presetFrom(c: Conversion, name: string, savedAt?: ISODate): RentRollPreset {
  if (c.format !== 'yardi-lease-charges' && c.format !== 'generic') throw new Error('Only a converted layout can be saved as a preset.')
  const mapping: RentRollPreset['mapping'] = {}
  for (const f of c.fields) if (f.column !== null) mapping[f.key] = c.columns[f.column]
  const chargeCodes = Object.fromEntries(c.chargeCodes.map((x) => [x.code, x.use]))
  const statusValues = Object.fromEntries(c.statusValues.filter((s) => s.choice).map((s) => [s.value, s.choice!]))
  return {
    name: name.trim(),
    format: c.format,
    signature: c.signature,
    mapping,
    ...(c.chargeCodes.length ? { chargeCodes } : {}),
    ...(Object.keys(statusValues).length ? { statusValues } : {}),
    ...(savedAt ? { savedAt } : {}),
  }
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null

export function isRentRollPreset(x: unknown): x is RentRollPreset {
  return (
    isObject(x) &&
    typeof x.name === 'string' &&
    (x.format === 'yardi-lease-charges' || x.format === 'generic') &&
    typeof x.signature === 'string' &&
    isObject(x.mapping)
  )
}

/** A preset for the same layout replaces the old one (same signature), as does one with the same name. */
export function withPreset(presets: RentRollPreset[], preset: RentRollPreset): RentRollPreset[] {
  return [...presets.filter((p) => p.signature !== preset.signature && p.name !== preset.name), preset]
}

export const PRESETS_FILE_FORMAT = 'aviancre-rent-roll-presets'

/** private-deals/rent-roll-presets.json, which `npm run convert` reads. */
export const presetsFile = (presets: RentRollPreset[]) => ({ format: PRESETS_FILE_FORMAT, version: 1, presets })

export function presetsFromFile(x: unknown): RentRollPreset[] | null {
  if (!isObject(x) || x.format !== PRESETS_FILE_FORMAT || !Array.isArray(x.presets)) return null
  return x.presets.filter(isRentRollPreset)
}
