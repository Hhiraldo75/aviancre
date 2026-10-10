import { fmt } from './format'
import { isBlank, norm, parseDate, parseNumber, text, type Cell } from './rentRollCells'
import {
  AS_OF_PATTERN,
  columnOf,
  headerKey,
  type ChargeCodeRow,
  type ChargeUse,
  type Choices,
  type Extracted,
  type FieldMapping,
  type FieldSpec,
  type FileTotals,
  type Layout,
  type RawUnit,
  type StatusValueRow,
} from './rentRollLayout'

/**
 * Yardi "Rent Roll with Lease Charges": title rows, a two-row header, one
 * block per unit (a row with the unit, more rows with one charge each, then a
 * Total row), a "Future Residents/Applicants" section, and summary sections
 * whose totals are the cross-check. Rent is the rent charge; other charges are
 * other income; a VACANT resident is vacant at market; a future resident marks
 * the unit pre-leased, and their rent charges, if any, are the future lease rent.
 */

export const YARDI_FIELDS: FieldSpec[] = [
  { key: 'unit', label: 'Unit', required: true, synonyms: ['unit'] },
  { key: 'unitType', label: 'Unit type (kept as a note)', synonyms: ['unit type'] },
  { key: 'sf', label: 'SF', required: true, synonyms: ['unit sq ft', 'sq ft', 'sqft'] },
  { key: 'resident', label: 'Resident (VACANT = vacant)', required: true, synonyms: ['resident'] },
  { key: 'market', label: 'Market rent', required: true, synonyms: ['market rent'] },
  { key: 'chargeCode', label: 'Charge code', required: true, synonyms: ['charge code'] },
  { key: 'amount', label: 'Charge amount', required: true, synonyms: ['amount'] },
  { key: 'moveIn', label: 'Move-in', synonyms: ['move in'] },
  { key: 'leaseEnd', label: 'Lease end', synonyms: ['lease expiration'] },
  { key: 'moveOut', label: 'Move-out (notice)', synonyms: ['move out'] },
  { key: 'balance', label: 'Balance owed', synonyms: ['balance'] },
]

const RENT_CODES = ['rent', 'rnt', 'baserent', 'base rent', 'rentres']

type Section = 'current' | 'future' | 'summary' | 'charges' | null

function sectionOf(first: string): Section | undefined {
  const s = norm(first)
  if (s.startsWith('current')) return 'current'
  if (s.startsWith('future')) return 'future'
  if (s.startsWith('summary groups')) return 'summary'
  if (s.startsWith('summary of charges')) return 'charges'
  return undefined
}

/** The two header rows: a row with Unit, Unit Type and Charge, continued by a row of labels only ("Sq Ft", "Rent", "Code"). */
export function yardiLayout(grid: Cell[][]): Layout | null {
  for (let i = 0; i < Math.min(30, grid.length - 1); i++) {
    const keys = (grid[i] ?? []).map(headerKey)
    if (!keys.includes('unit') || !keys.includes('unit type') || !keys.includes('charge')) continue
    const next = grid[i + 1] ?? []
    const continues = next.some((c) => text(c)) && next.every((c) => typeof c !== 'number')
    const width = Math.max(grid[i].length, continues ? next.length : 0)
    const columns = Array.from({ length: width }, (_, c) =>
      [text(grid[i][c]), continues ? text(next[c]) : ''].filter(Boolean).join(' ').replace(/\s+/g, ' '),
    )
    const colKeys = columns.map(headerKey)
    if (!colKeys.includes('charge code')) return null
    const detected: Layout['detected'] = {}
    for (const spec of YARDI_FIELDS) {
      const column = colKeys.findIndex((k) => spec.synonyms.includes(k))
      if (column >= 0) detected[spec.key] = { column, provenance: 'detected' }
    }
    return { columns, headerStart: i, headerEnd: continues ? i + 1 : i, signature: `yardi|${colKeys.join('|')}`, detected }
  }
  return null
}

interface Block {
  unit: RawUnit
  resident: string
  charges: [code: string, amount: number][]
  total: number | null
  moveOut?: string
}

export function readYardi(grid: Cell[][], layout: Layout, fields: FieldMapping[], choices: Choices): Extracted {
  const col = (k: Parameters<typeof columnOf>[1]) => columnOf(fields, k)
  const [cUnit, cType, cSF, cRes, cMkt, cCode, cAmt, cIn, cEnd, cOut, cBal] = (
    ['unit', 'unitType', 'sf', 'resident', 'market', 'chargeCode', 'amount', 'moveIn', 'leaseEnd', 'moveOut', 'balance'] as const
  ).map(col)
  const at = (row: Cell[], c: number | null) => (c === null ? undefined : row[c])
  const flags: string[] = []
  const blockers: string[] = []

  // ---- title rows: name and as-of date ----
  let name = ''
  let asOf: string | null = null
  for (let i = 0; i < layout.headerStart; i++) {
    const t = text(grid[i]?.[0])
    if (!t) continue
    const m = AS_OF_PATTERN.exec(t)
    if (m) asOf = parseDate(m[1].trim())
    else if (!/^rent roll\b/i.test(t) && !name) name = t
  }

  // ---- unit blocks ----
  const blocks: Block[] = []
  const futureUnits: { unit: string; row: number; charges: [code: string, amount: number][] }[] = []
  const summaryRows: { label: string; row: Cell[] }[] = []
  let summaryHeader: string[] = []
  const chargeSummary = new Map<string, number>()
  let section: Section = null
  let block: Block | null = null
  for (let i = layout.headerEnd + 1; i < grid.length; i++) {
    const row = grid[i] ?? []
    if (isBlank(row)) continue
    const first = text(row[0])
    const next = typeof row[0] === 'string' ? sectionOf(first) : undefined
    // The summary repeats the section names as row labels.
    const inSummary = section === 'summary' || section === 'charges'
    if (next && !(inSummary && (next === 'current' || next === 'future'))) {
      section = next
      block = null
      if (next === 'summary') {
        const below = grid[i + 1] ?? []
        summaryHeader = row.map((c, k) => headerKey(`${text(c)} ${text(below[k])}`))
        i++
      }
      continue
    }
    if (section === 'current') {
      const unit = text(at(row, cUnit))
      const code = text(at(row, cCode))
      const amount = parseNumber(at(row, cAmt) ?? null) ?? 0
      if (unit) {
        const end = parseDate(at(row, cEnd) ?? null) ?? undefined
        block = {
          unit: {
            unit,
            sourceRow: i + 1,
            sf: parseNumber(at(row, cSF) ?? null),
            market: parseNumber(at(row, cMkt) ?? null),
            occupied: true,
            inPlace: 0,
            otherIncome: 0,
            moveIn: parseDate(at(row, cIn) ?? null) ?? undefined,
            leaseEnd: end,
            balance: parseNumber(at(row, cBal) ?? null) ?? 0,
            preLeased: false,
            unitType: text(at(row, cType)) || undefined,
            notes: [],
            inferred: [],
          },
          resident: text(at(row, cRes)),
          charges: [],
          total: null,
          moveOut: parseDate(at(row, cOut) ?? null) ?? undefined,
        }
        blocks.push(block)
        if (code) block.charges.push([code, amount])
        else if (amount) flags.push(`Row ${i + 1}: an amount of ${fmt.usdCents(amount)} with no charge code was ignored.`)
      } else if (block && norm(code) === 'total') {
        block.total = amount
      } else if (block && code) {
        block.charges.push([code, amount])
      }
    } else if (section === 'future') {
      const unit = text(at(row, cUnit))
      const code = text(at(row, cCode))
      const amount = parseNumber(at(row, cAmt) ?? null) ?? 0
      if (unit) futureUnits.push({ unit, row: i + 1, charges: code ? [[code, amount]] : [] })
      else if (futureUnits.length && code && norm(code) !== 'total') futureUnits[futureUnits.length - 1].charges.push([code, amount])
    } else if (section === 'summary') {
      if (first) summaryRows.push({ label: headerKey(first), row })
    } else if (section === 'charges') {
      const code = first
      const amount = row.slice(1).map((c) => parseNumber(c)).find((n) => n !== null && Number.isFinite(n))
      if (code && amount !== undefined && norm(code) !== 'total') chargeSummary.set(code, amount!)
    }
  }
  if (!blocks.length) blockers.push('No units found under "Current/Notice/Vacant Residents".')

  // ---- status: VACANT, a marker without digits (MODEL, ADMIN…) to map, or a resident ----
  const markers = new Map<string, number>()
  for (const b of blocks) {
    if (!/\d/.test(b.resident)) markers.set(b.resident.toUpperCase(), (markers.get(b.resident.toUpperCase()) ?? 0) + 1)
  }
  const statusValues: StatusValueRow[] = [...markers].map(([value, count]) => {
    const chosen = choices.statusValues?.[value]
    if (chosen) return { value, count, choice: chosen, provenance: 'user' }
    if (value === 'VACANT') return { value, count, choice: 'vacant', provenance: 'detected' }
    return { value, count, choice: null, provenance: null }
  })
  for (const s of statusValues) {
    if (!s.choice) blockers.push(`Resident "${s.value || '(blank)'}" on ${s.count} unit${s.count === 1 ? '' : 's'}: choose what it means under Status values.`)
  }

  // ---- charge codes ----
  const codes = new Map<string, number>()
  for (const b of blocks) for (const [c, a] of b.charges) codes.set(c, (codes.get(c) ?? 0) + (statusOf(b, statusValues)?.startsWith('occupied') ? a : 0))
  const chargeCodes: ChargeCodeRow[] = [...codes].map(([code, total]) => {
    const chosen = choices.chargeCodes?.[code]
    if (chosen) return { code, total, use: chosen, provenance: 'user' }
    return { code, total, use: RENT_CODES.includes(code.toLowerCase()) ? 'rent' : 'other', provenance: 'detected' }
  })
  const useOf = new Map(chargeCodes.map((c) => [c.code, c.use]))
  const defaultOther = chargeCodes.filter((c) => c.provenance === 'detected' && c.use === 'other').map((c) => c.code)
  if (defaultOther.length) flags.push(`Charge codes counted as other income: ${defaultOther.join(', ')}. Change any under Charge codes.`)
  if (!chargeCodes.some((c) => c.use === 'rent')) blockers.push('No charge code counts as rent. Set the rent code under Charge codes.')

  // ---- units ----
  const units: RawUnit[] = []
  const mismatchedTotals: string[] = []
  const vacantCharges: string[] = []
  const noRent: string[] = []
  let notices = 0
  for (const b of blocks) {
    const u = b.unit
    const status = statusOf(b, statusValues)
    if (!status) continue
    u.occupied = status.startsWith('occupied')
    u.preLeased = status.endsWith('pre-leased')
    if (u.preLeased) u.inferred.push('preLeased')
    const sum = (use: ChargeUse) => b.charges.filter(([c]) => useOf.get(c) === use).reduce((s, [, a]) => s + a, 0)
    const all = b.charges.reduce((s, [, a]) => s + a, 0)
    if (b.total !== null && Math.abs(all - b.total) > 0.005) mismatchedTotals.push(u.unit)
    if (u.unitType) u.notes.push(`Unit type ${u.unitType}`)
    if (u.occupied) {
      u.inPlace = round2(sum('rent'))
      u.otherIncome = round2(sum('other'))
      if (!u.inPlace) noRent.push(u.unit)
      if (b.moveOut) {
        u.leaseEnd = b.moveOut
        u.inferred.push('leaseEnd')
        u.notes.push(`Notice to vacate: lease end is the move-out date ${b.moveOut}`)
        notices++
      }
    } else {
      if (all) vacantCharges.push(u.unit)
      u.moveIn = undefined
      u.leaseEnd = undefined
    }
    if (b.resident.toUpperCase() !== 'VACANT' && !/\d/.test(b.resident)) {
      u.inferred.push('status')
      u.notes.push(`Resident "${b.resident}" treated as ${status.replace('-', ', ')}`)
    }
    units.push(u)
  }
  const list = (xs: string[]) => (xs.length > 8 ? `${xs.slice(0, 8).join(', ')} and ${xs.length - 8} more` : xs.join(', '))
  if (mismatchedTotals.length) flags.push(`Charges don't add up to the unit's Total row for units ${list(mismatchedTotals)}.`)
  if (vacantCharges.length) flags.push(`Charges on vacant units ${list(vacantCharges)} were ignored (vacant units lease up at market).`)
  if (noRent.length) blockers.push(`Occupied with no rent charge: units ${list(noRent)}. Check the rent code under Charge codes.`)
  if (notices) flags.push(`${notices} notice-to-vacate unit${notices === 1 ? '' : 's'}: lease end set to the move-out date.`)

  // ---- future residents: pre-leased, at their rent charges when there are any ----
  const byUnit = new Map(units.map((u) => [u.unit, u]))
  const unknownFuture: string[] = []
  let futureRents = 0
  for (const f of futureUnits) {
    const u = byUnit.get(f.unit)
    if (!u) {
      unknownFuture.push(`${f.unit} (row ${f.row})`)
      continue
    }
    u.preLeased = true
    // A code only future residents use isn't under Charge codes; the usual rent codes still count.
    const isRent = (c: string) => (useOf.get(c) ?? (RENT_CODES.includes(c.toLowerCase()) ? 'rent' : 'other')) === 'rent'
    const rent = round2(f.charges.filter(([c]) => isRent(c)).reduce((s, [, a]) => s + a, 0))
    if (rent > 0) {
      u.futureRent = rent
      futureRents++
    }
  }
  if (futureRents) flags.push(`${futureRents} future resident${futureRents === 1 ? '' : 's'} with a rent charge: kept as the future lease rent.`)
  if (unknownFuture.length) blockers.push(`Future residents for units not in the current section: ${list(unknownFuture)}.`)

  // ---- the file's own totals ----
  const fileTotals: FileTotals = {}
  let nonRev = { units: 0, market: 0 }
  const sCol = (label: string) => summaryHeader.indexOf(label)
  const num = (row: Cell[], label: string) => {
    const c = sCol(label)
    const n = c >= 0 ? parseNumber(row[c]) : null
    return n !== null && Number.isFinite(n) ? n : undefined
  }
  for (const { label, row } of summaryRows) {
    if (label === 'occupied units') {
      fileTotals.occupied = num(row, 'of units')
      fileTotals.occupiedMarket = num(row, 'market rent')
    } else if (label === 'total vacant units') {
      fileTotals.vacant = num(row, 'of units')
      fileTotals.vacantMarket = num(row, 'market rent')
    } else if (label === 'total non rev units') {
      nonRev = { units: num(row, 'of units') ?? 0, market: num(row, 'market rent') ?? 0 }
    } else if (label === 'totals') {
      fileTotals.units = num(row, 'of units')
      fileTotals.sf = num(row, 'square footage')
      fileTotals.totalMarket = num(row, 'market rent')
    }
  }
  // Yardi counts non-revenue units (models, offices, down units) apart from vacant ones; they convert as whatever their marker was mapped to.
  if (nonRev.units) {
    if (fileTotals.vacant !== undefined) fileTotals.vacant += nonRev.units
    if (fileTotals.vacantMarket !== undefined) fileTotals.vacantMarket += nonRev.market
    flags.push(
      `The file lists ${nonRev.units} non-revenue unit${nonRev.units === 1 ? '' : 's'} (models, offices, down units); ` +
        'the totals check counts them as vacant.',
    )
  }
  if (chargeSummary.size) {
    const byUse = (use: ChargeUse) => [...chargeSummary].filter(([c]) => (useOf.get(c) ?? 'other') === use).reduce((s, [, a]) => s + a, 0)
    fileTotals.occupiedRent = byUse('rent')
    fileTotals.otherIncome = byUse('other')
  }
  if (!summaryRows.length) flags.push('No "Summary Groups" section: unit counts and market rent can\'t be checked against the file.')

  return { units, fileTotals, chargeCodes, statusValues, flags, blockers, name, asOf }
}

function statusOf(b: Block, values: StatusValueRow[]) {
  if (/\d/.test(b.resident)) return 'occupied'
  return values.find((v) => v.value === b.resident.toUpperCase())?.choice ?? null
}

const round2 = (n: number) => Math.round(n * 100) / 100
