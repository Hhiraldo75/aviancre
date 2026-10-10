import type { ApartmentUnit, ISODate, UnitType } from '../types'
import { fmt, slug } from './format'
import { optionalNumber, parseDate, parseNumber, readTable, text, type Cell, type Report, type TableRow } from './rentRollCells'
import { fromImport } from './sourced'

/**
 * The Units table of a multifamily (unit-level) rent roll: one row per
 * apartment, rents per month. `parseRentRoll` reads the title and property
 * block and calls this for the table; `unitMix` groups the units by floor plan
 * into the engine's unit mix.
 */

export const UNIT_COLUMNS = {
  unit: { label: 'Unit', required: true },
  floorPlan: { label: 'Floor plan', required: true },
  sf: { label: 'SF', required: true },
  status: { label: 'Status', required: true },
  market: { label: 'Market rent ($/mo)', required: true },
  inPlace: { label: 'In-place rent ($/mo)', required: true },
  otherIncome: { label: 'Other income ($/mo)', required: false },
  moveIn: { label: 'Move-in', required: false },
  leaseEnd: { label: 'Lease end', required: false },
  balance: { label: 'Balance owed ($)', required: false },
  preLeased: { label: 'Pre-leased (applicant)', required: false },
  futureRent: { label: 'Future lease rent ($/mo)', required: false },
  /** Free text for the analyst (e.g. what a converter inferred); the engine ignores it. */
  note: { label: 'Note', required: false },
}

type UnitKey = keyof typeof UNIT_COLUMNS

export interface FloorPlan {
  id: string
  label: string
}

export interface UnitTable {
  /** Every data row, including rows with errors. */
  rows: TableRow<UnitKey>[]
  /** Rows without errors. */
  units: ApartmentUnit[]
  floorPlans: FloorPlan[]
  /** From every row's cells, so a row with an error elsewhere still counts. */
  occupiedRows: number
  totalSF: number
}

const col = (k: UnitKey) => UNIT_COLUMNS[k].label

/** Any mark except an explicit no; the applicant's name, if given, is not kept. */
const isPreLeased = (c: Cell) => {
  const s = text(c).toLowerCase()
  return s !== '' && !['no', 'n', 'false', '0'].includes(s)
}

const statusOf = (c: Cell) => {
  const s = text(c).toLowerCase()
  return s === 'occupied' || s === 'vacant' ? s : null
}

export function readUnits(grid: Cell[][], unitsAt: number, sections: string[], asOf: ISODate, error: Report, warn: Report): UnitTable | null {
  const table = readTable(grid, unitsAt, UNIT_COLUMNS, 'Units', sections, error, warn)
  if (!table) return null

  const floorPlans: FloorPlan[] = []
  const planId = (label: string) => {
    const found = floorPlans.find((p) => p.label === label)
    if (found) return found.id
    const base = slug(label) || 'plan'
    let id = base
    for (let n = 2; floorPlans.some((p) => p.id === id); n++) id = `${base}-${n}`
    floorPlans.push({ id, label })
    return id
  }

  const units: ApartmentUnit[] = []
  const seen = new Map<string, number>()
  let occupiedRows = 0
  let totalSF = 0
  for (const { row, get } of table.rows) {
    let errors = 0
    const fail: Report = (message, r, column) => {
      errors++
      error(message, r, column)
    }

    const unit = text(get('unit'))
    if (!unit) fail('Unit is blank.', row, col('unit'))
    else if (seen.has(unit)) warn(`Unit "${unit}" also appears on row ${seen.get(unit)}.`, row, col('unit'))
    else seen.set(unit, row)
    const plan = text(get('floorPlan'))
    if (!plan) fail('Floor plan is blank.', row, col('floorPlan'))

    const sf = parseNumber(get('sf'))
    if (sf === null || !Number.isFinite(sf) || sf <= 0) fail(`SF must be a positive number, got "${text(get('sf'))}".`, row, col('sf'))
    else totalSF += sf

    const status = statusOf(get('status'))
    if (!status) fail(`Unknown status "${text(get('status'))}". Use Occupied or Vacant.`, row, col('status'))
    const occupied = status === 'occupied'
    if (occupied) occupiedRows++

    const market = parseNumber(get('market'))
    if (market === null || !Number.isFinite(market) || market <= 0) {
      fail(`Market rent must be a positive $/month number, got "${text(get('market'))}".`, row, col('market'))
    }

    const inPlace = parseNumber(get('inPlace'))
    if (inPlace !== null && (!Number.isFinite(inPlace) || inPlace < 0)) {
      fail(`In-place rent must be a $/month number of at least 0, got "${text(get('inPlace'))}".`, row, col('inPlace'))
    } else if (occupied && inPlace === null) {
      fail('In-place rent is missing for an occupied unit.', row, col('inPlace'))
    } else if (occupied && inPlace === 0) {
      fail('Occupied with zero rent. Enter the lease rent, or mark the unit Vacant.', row, col('inPlace'))
    } else if (status === 'vacant' && inPlace) {
      warn(`In-place rent ${fmt.usdCents(inPlace)} on a vacant unit is ignored; the unit leases up at market.`, row, col('inPlace'))
    }

    const otherIncome = optionalNumber(get('otherIncome'), col('otherIncome'), row, fail)

    const date = (key: 'moveIn' | 'leaseEnd') => {
      if (!text(get(key))) return undefined
      const d = parseDate(get(key))
      if (!d) fail(`${col(key)} "${text(get(key))}" is not a valid date. Use YYYY-MM-DD.`, row, col(key))
      return d ?? undefined
    }
    const moveIn = date('moveIn')
    const leaseEnd = date('leaseEnd')
    if (occupied) {
      if (!text(get('leaseEnd'))) {
        warn('No lease end: treated as month-to-month, rolling to market in month 1.', row, col('leaseEnd'))
      } else if (leaseEnd && moveIn && leaseEnd < moveIn) {
        warn(`Lease end (${leaseEnd}) is before move-in (${moveIn}); the lease end is used as given.`, row, col('leaseEnd'))
      }
      if (leaseEnd && leaseEnd < asOf) {
        warn(`Lease ended on ${leaseEnd}, before the analysis date (${asOf}): month-to-month, rolling to market in month 1.`, row, col('leaseEnd'))
      }
    }

    const balance = parseNumber(get('balance'))
    if (balance !== null && !Number.isFinite(balance)) {
      fail(`Balance owed must be a $ number, got "${text(get('balance'))}".`, row, col('balance'))
    } else if (balance !== null && balance > 0) {
      warn(`Balance owed ${fmt.usdCents(balance)}. Not modeled: check collections and the credit loss assumption.`, row, col('balance'))
    }

    const preLeased = isPreLeased(get('preLeased'))
    const futureRent = parseNumber(get('futureRent'))
    if (futureRent !== null && (!Number.isFinite(futureRent) || futureRent <= 0)) {
      fail(`Future lease rent must be a positive $/month number, got "${text(get('futureRent'))}".`, row, col('futureRent'))
    } else if (futureRent !== null && !preLeased) {
      warn(`Future lease rent ${fmt.usdCents(futureRent)} on a unit that isn't pre-leased is ignored.`, row, col('futureRent'))
    }

    if (errors) continue
    units.push({
      unit,
      floorPlan: planId(plan),
      sf: sf!,
      occupied,
      marketRentMonthly: market!,
      inPlaceRentMonthly: occupied ? inPlace! : 0,
      otherIncomeMonthly: otherIncome ?? 0,
      moveInDate: moveIn,
      leaseEndDate: occupied ? leaseEnd : undefined,
      balanceOwed: balance ?? 0,
      preLeased,
      ...(preLeased && futureRent !== null ? { futureRentMonthly: futureRent } : {}),
    })
  }
  return { rows: table.rows, units, floorPlans, occupiedRows, totalSF }
}

/**
 * The engine's unit mix, one type per floor plan in file order: averages of
 * SF and market rent over all units, in-place rent over occupied units.
 */
export function unitMix(units: ApartmentUnit[], floorPlans: FloorPlan[], sourceName: string, importedAt?: ISODate): UnitType[] {
  return floorPlans.flatMap(({ id, label }) => {
    const all = units.filter((u) => u.floorPlan === id)
    if (!all.length) return []
    const occupied = all.filter((u) => u.occupied)
    const avg = (xs: ApartmentUnit[], f: (u: ApartmentUnit) => number) => xs.reduce((s, u) => s + f(u), 0) / xs.length
    return [
      {
        id,
        label,
        unitCount: all.length,
        occupiedUnits: occupied.length,
        avgSF: avg(all, (u) => u.sf),
        marketRentMonthly: fromImport(avg(all, (u) => u.marketRentMonthly), sourceName, importedAt),
        inPlaceRentMonthly: occupied.length ? fromImport(avg(occupied, (u) => u.inPlaceRentMonthly), sourceName, importedAt) : undefined,
      },
    ]
  })
}
