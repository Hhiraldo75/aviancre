import { isBlank, parseDate, parseNumber, text, type Cell } from './rentRollCells'
import {
  AS_OF_PATTERN,
  columnOf,
  headerKey,
  type Choices,
  type Extracted,
  type FieldKey,
  type FieldMapping,
  type FieldSpec,
  type FileTotals,
  type Layout,
  type RawUnit,
  type StatusChoice,
  type StatusValueRow,
} from './rentRollLayout'

/**
 * A plain table of units: the header row is found anywhere in the first 30
 * rows (or two rows read together) and columns are mapped by header synonyms.
 * A row starting with "Total" ends the table and gives the file's totals.
 */

export const GENERIC_FIELDS: FieldSpec[] = [
  { key: 'unit', label: 'Unit', required: true, synonyms: ['unit', 'unit number', 'unit no', 'apt', 'apt no', 'apartment', 'bldg unit'] },
  { key: 'unitType', label: 'Unit type (kept as a note)', synonyms: ['floor plan', 'floorplan', 'unit type', 'type', 'plan', 'bed bath', 'bd ba'] },
  { key: 'sf', label: 'SF', required: true, synonyms: ['sq ft', 'sqft', 'sf', 'square feet', 'square footage', 'area', 'size', 'rsf', 'unit sf', 'unit sq ft'] },
  { key: 'status', label: 'Status', synonyms: ['status', 'unit status', 'occupancy', 'occupancy status', 'lease status'] },
  { key: 'resident', label: 'Tenant / resident', synonyms: ['tenant', 'resident', 'name', 'resident name', 'tenant name', 'lessee', 'occupant'] },
  { key: 'market', label: 'Market rent ($/mo)', required: true, synonyms: ['market', 'market rent', 'mkt rent', 'mkt', 'asking rent', 'market rate'] },
  {
    key: 'inPlace',
    label: 'In-place rent ($/mo)',
    required: true,
    synonyms: ['rent', 'actual rent', 'lease rent', 'current rent', 'contract rent', 'in place rent', 'monthly rent', 'scheduled rent'],
  },
  { key: 'otherIncome', label: 'Other income ($/mo)', synonyms: ['other income', 'other charges', 'other', 'fees', 'other fees'] },
  { key: 'moveIn', label: 'Move-in', synonyms: ['move in', 'move in date', 'lease start', 'start', 'start date', 'lease from'] },
  { key: 'leaseEnd', label: 'Lease end', synonyms: ['lease exp', 'lease expiration', 'expiration', 'lease end', 'end', 'end date', 'exp date', 'lease to', 'expires'] },
  { key: 'moveOut', label: 'Move-out (notice)', synonyms: ['move out', 'move out date'] },
  { key: 'balance', label: 'Balance owed', synonyms: ['balance', 'balance owed', 'past due', 'amount owed', 'ar balance', 'delinquent'] },
  { key: 'preLeased', label: 'Pre-leased', synonyms: ['pre leased', 'preleased', 'pre lease', 'applicant', 'future resident'] },
]

/** Status values every rent roll uses; anything else is the user's call. */
const KNOWN_STATUS: Record<string, StatusChoice> = {
  occupied: 'occupied',
  occ: 'occupied',
  o: 'occupied',
  current: 'occupied',
  leased: 'occupied',
  'occupied no notice': 'occupied',
  notice: 'occupied',
  'notice unrented': 'occupied',
  'notice rented': 'occupied-pre-leased',
  'notice leased': 'occupied-pre-leased',
  vacant: 'vacant',
  vac: 'vacant',
  v: 'vacant',
  'vacant unrented': 'vacant',
  'vacant ready': 'vacant',
  'vacant not ready': 'vacant',
  'vacant rented': 'vacant-pre-leased',
  'vacant leased': 'vacant-pre-leased',
  'vacant pre leased': 'vacant-pre-leased',
  'pre leased': 'vacant-pre-leased',
}

const TOTAL_ROW = /^(grand\s+)?totals?\b/i

/** Which field each header cell names; a field takes the first column that names it. */
function match(keys: string[]): Layout['detected'] {
  const detected: Layout['detected'] = {}
  keys.forEach((k, column) => {
    if (!k) return
    const spec = GENERIC_FIELDS.find((s) => !detected[s.key] && s.synonyms.includes(k))
    if (spec) detected[spec.key] = { column, provenance: 'synonym' }
  })
  return detected
}

/** The best header in the first 30 rows: the most fields named, at least 3 including Unit. */
export function genericLayout(grid: Cell[][]): Layout | null {
  let best: Layout | null = null
  let bestScore = 0
  for (let i = 0; i < Math.min(30, grid.length); i++) {
    const row = grid[i] ?? []
    const below = grid[i + 1] ?? []
    const candidates: { columns: string[]; headerEnd: number }[] = [{ columns: row.map((c) => text(c)), headerEnd: i }]
    if (below.some((c) => text(c)) && below.every((c) => typeof c !== 'number')) {
      const width = Math.max(row.length, below.length)
      const merged = Array.from({ length: width }, (_, c) => [text(row[c]), text(below[c])].filter(Boolean).join(' '))
      candidates.push({ columns: merged, headerEnd: i + 1 })
    }
    for (const { columns, headerEnd } of candidates) {
      const keys = columns.map(headerKey)
      const detected = match(keys)
      const score = Object.keys(detected).length
      if (!detected.unit || score < 3 || score <= bestScore) continue
      best = { columns, headerStart: i, headerEnd, signature: `generic|${keys.join('|')}`, detected }
      bestScore = score
    }
  }
  return best
}

export function readGeneric(grid: Cell[][], layout: Layout, fields: FieldMapping[], choices: Choices): Extracted {
  const col = (k: FieldKey) => columnOf(fields, k)
  const get = (row: Cell[], k: FieldKey) => {
    const c = col(k)
    return c === null ? undefined : row[c]
  }
  const flags: string[] = []
  const blockers: string[] = []

  // ---- title rows above the header ----
  let name = ''
  let asOf: string | null = null
  for (let i = 0; i < layout.headerStart; i++) {
    const t = (grid[i] ?? []).map((c) => text(c)).find(Boolean)
    if (!t) continue
    const m = AS_OF_PATTERN.exec(t)
    if (m) asOf = parseDate(m[1].trim())
    else if (!/^(unit\s+)?rent roll\b/i.test(t) && !name) name = t
  }

  // ---- data rows ----
  const headerKeys = layout.columns.map(headerKey).join('|')
  type Row = { row: Cell[]; n: number }
  const rows: Row[] = []
  let totalsRow: Cell[] | null = null
  let skipped = 0
  for (let i = layout.headerEnd + 1; i < grid.length; i++) {
    const row = grid[i] ?? []
    if (isBlank(row)) continue
    const first = row.map((c) => text(c)).find(Boolean) ?? ''
    if (TOTAL_ROW.test(first)) {
      totalsRow = row
      break
    }
    if (row.map(headerKey).join('|') === headerKeys) continue
    const unit = text(get(row, 'unit'))
    if (!unit || (text(get(row, 'sf')) === '' && text(get(row, 'market')) === '')) {
      if (row.some((c) => typeof c === 'number' || parseNumber(c) !== null)) skipped++
      continue
    }
    rows.push({ row, n: i + 1 })
  }
  if (!rows.length) blockers.push('No unit rows found below the header.')
  if (skipped) flags.push(`${skipped} row${skipped === 1 ? '' : 's'} with numbers but no unit (or no SF and market rent) were skipped, e.g. subtotals.`)

  // ---- status ----
  const statusCol = col('status')
  const statusValues: StatusValueRow[] = []
  if (statusCol !== null) {
    const counts = new Map<string, number>()
    for (const { row } of rows) {
      const v = text(row[statusCol])
      counts.set(v, (counts.get(v) ?? 0) + 1)
    }
    for (const [value, count] of counts) {
      const chosen = choices.statusValues?.[value]
      const known = KNOWN_STATUS[headerKey(value)]
      if (chosen) statusValues.push({ value, count, choice: chosen, provenance: 'user' })
      else if (known) statusValues.push({ value, count, choice: known, provenance: 'detected' })
      else {
        statusValues.push({ value, count, choice: null, provenance: null })
        blockers.push(`Status "${value || '(blank)'}" on ${count} unit${count === 1 ? '' : 's'}: choose what it means under Status values.`)
      }
    }
  }
  const residentCol = col('resident')
  if (statusCol === null && residentCol === null) blockers.push('Map a column to "Status" or "Tenant / resident" to continue.')
  const choiceOf = new Map(statusValues.map((s) => [s.value, s.choice]))

  // ---- units ----
  const units: RawUnit[] = []
  const noRent: string[] = []
  let fromResident = 0
  let notices = 0
  for (const { row, n } of rows) {
    const unit = text(get(row, 'unit'))
    const inferred: RawUnit['inferred'] = []
    let status: StatusChoice | null = null
    if (statusCol !== null) status = choiceOf.get(text(row[statusCol])) ?? null
    else if (residentCol !== null) {
      const r = text(row[residentCol])
      status = !r || /vacant/i.test(r) ? 'vacant' : 'occupied'
      inferred.push('status')
      fromResident++
    }
    if (!status) continue
    const occupied = status.startsWith('occupied')
    const preLeasedCell = text(get(row, 'preLeased')).toLowerCase()
    const preLeased = status.endsWith('pre-leased') || (preLeasedCell !== '' && !['no', 'n', 'false', '0'].includes(preLeasedCell))
    const num = (k: FieldKey) => {
      const v = parseNumber(get(row, k) ?? null)
      return v !== null && Number.isFinite(v) ? v : null
    }
    const date = (k: FieldKey) => parseDate(get(row, k) ?? null) ?? undefined
    const unitType = text(get(row, 'unitType')) || undefined
    const notes = unitType ? [`Unit type ${unitType}`] : []
    let leaseEnd = occupied ? date('leaseEnd') : undefined
    const moveOut = date('moveOut')
    if (occupied && moveOut) {
      leaseEnd = moveOut
      inferred.push('leaseEnd')
      notes.push(`Notice to vacate: lease end is the move-out date ${moveOut}`)
      notices++
    }
    if (inferred.includes('status')) notes.push(`Status from the tenant column: ${occupied ? 'occupied' : 'vacant'}`)
    const inPlace = occupied ? (num('inPlace') ?? 0) : 0
    if (occupied && !inPlace) noRent.push(unit)
    units.push({
      unit,
      sourceRow: n,
      sf: num('sf'),
      market: num('market'),
      occupied,
      inPlace,
      otherIncome: occupied ? (num('otherIncome') ?? 0) : 0,
      moveIn: occupied ? date('moveIn') : undefined,
      leaseEnd,
      balance: num('balance') ?? 0,
      preLeased,
      unitType,
      notes,
      inferred,
    })
  }
  const list = (xs: string[]) => (xs.length > 8 ? `${xs.slice(0, 8).join(', ')} and ${xs.length - 8} more` : xs.join(', '))
  if (fromResident) flags.push(`No status column: ${fromResident} units' status inferred from the tenant column (blank or "vacant" = vacant).`)
  if (noRent.length) blockers.push(`Occupied with no rent: units ${list(noRent)}. Check the In-place rent column, or the status of these units.`)
  if (notices) flags.push(`${notices} notice-to-vacate unit${notices === 1 ? '' : 's'}: lease end set to the move-out date.`)

  // ---- the file's totals row ----
  const fileTotals: FileTotals = {}
  if (totalsRow) {
    const total = (k: FieldKey) => {
      const c = col(k)
      const v = c === null ? null : parseNumber(totalsRow![c])
      return v !== null && Number.isFinite(v) ? v : undefined
    }
    fileTotals.sf = total('sf')
    fileTotals.totalMarket = total('market')
    fileTotals.occupiedRent = total('inPlace')
    fileTotals.otherIncome = total('otherIncome')
  } else flags.push('No totals row: the conversion can\'t be checked against the file\'s own totals.')

  return { units, fileTotals, chargeCodes: [], statusValues, flags, blockers, name, asOf }
}
