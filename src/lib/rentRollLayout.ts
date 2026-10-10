import type { ISODate } from '../types'
import { norm, text, type Cell } from './rentRollCells'

/**
 * Shared vocabulary for converting other rent roll layouts (rentRollYardi.ts,
 * rentRollGeneric.ts) into our unit rent roll: the fields a layout can map,
 * how a column got mapped, and what a layout reader hands back to
 * `convertRentRoll` (rentRollConvert.ts).
 */

export type FieldKey =
  | 'unit'
  | 'unitType'
  | 'sf'
  | 'status'
  | 'resident'
  | 'market'
  | 'inPlace'
  | 'chargeCode'
  | 'amount'
  | 'otherIncome'
  | 'moveIn'
  | 'leaseEnd'
  | 'moveOut'
  | 'balance'
  | 'preLeased'
  | 'futureRent'

export interface FieldSpec {
  key: FieldKey
  label: string
  required?: boolean
  /** Header texts that map to this field, compared after `headerKey`. */
  synonyms: string[]
}

/** How a column was chosen: matched the layout's known header, matched a synonym, came from a saved preset, or the user picked it. */
export type Provenance = 'detected' | 'synonym' | 'preset' | 'user'

export interface FieldMapping {
  key: FieldKey
  label: string
  required: boolean
  /** 0-based column index, or null when not in the file. */
  column: number | null
  provenance: Provenance | null
}

/** What a Yardi charge code counts as. */
export type ChargeUse = 'rent' | 'other' | 'excluded'
/** What a status value (or a Yardi resident marker such as MODEL) means. */
export type StatusChoice = 'occupied' | 'vacant' | 'vacant-pre-leased' | 'occupied-pre-leased'

export const STATUS_CHOICES: { value: StatusChoice; label: string }[] = [
  { value: 'occupied', label: 'Occupied' },
  { value: 'vacant', label: 'Vacant' },
  { value: 'vacant-pre-leased', label: 'Vacant, pre-leased' },
  { value: 'occupied-pre-leased', label: 'Occupied, pre-leased' },
]

/** A layout's header: its column labels and the fields it recognized. */
export interface Layout {
  columns: string[]
  /** 0-based index of the (first) header row; title rows are above it. */
  headerStart: number
  /** 0-based index of the last header row; data starts below it. */
  headerEnd: number
  /** Normalized column labels: what a preset is matched on. */
  signature: string
  detected: Partial<Record<FieldKey, { column: number; provenance: Provenance }>>
}

/** One unit as read from the file, before floor plans are grouped. */
export interface RawUnit {
  unit: string
  /** 1-based row number in the file. */
  sourceRow: number
  sf: number | null
  market: number | null
  occupied: boolean
  inPlace: number
  otherIncome: number
  moveIn?: ISODate
  leaseEnd?: ISODate
  balance: number
  preLeased: boolean
  /** The future resident's rent, $/month, when the file gives one. */
  futureRent?: number
  unitType?: string
  notes: string[]
  /** Output columns whose value was inferred rather than read. */
  inferred: ('status' | 'leaseEnd' | 'preLeased')[]
}

/** Totals the file states about itself, for the totals check. Absent when the file doesn't say. */
export interface FileTotals {
  units?: number
  occupied?: number
  vacant?: number
  sf?: number
  totalMarket?: number
  occupiedMarket?: number
  vacantMarket?: number
  occupiedRent?: number
  otherIncome?: number
}

export interface ChargeCodeRow {
  code: string
  /** Monthly total over occupied units. */
  total: number
  use: ChargeUse
  provenance: Provenance
}

export interface StatusValueRow {
  value: string
  count: number
  choice: StatusChoice | null
  provenance: Provenance | null
}

export interface Choices {
  chargeCodes?: Record<string, ChargeUse>
  statusValues?: Record<string, StatusChoice>
}

/** What a layout reader extracts once the columns are mapped. */
export interface Extracted {
  units: RawUnit[]
  fileTotals: FileTotals
  chargeCodes: ChargeCodeRow[]
  statusValues: StatusValueRow[]
  flags: string[]
  blockers: string[]
  name: string
  asOf: ISODate | null
}

/** A header cell for matching: lowercase, no parenthesized units, punctuation as spaces ("Unit #" → "unit", "Move-In" → "move in"). */
export const headerKey = (c: Cell) =>
  norm(text(c))
    .replace(/[#.:*$_\-/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Column index per field: the user's pick, else the preset's column (by label), else what the layout detected. */
export function resolveFields(
  specs: FieldSpec[],
  layout: Layout,
  preset?: Partial<Record<FieldKey, string>>,
  user?: Partial<Record<FieldKey, number | null>>,
): FieldMapping[] {
  return specs.map(({ key, label, required }) => {
    const base = { key, label, required: Boolean(required) }
    if (user && Object.hasOwn(user, key)) {
      const column = user[key] ?? null
      return { ...base, column: column !== null && column >= 0 && column < layout.columns.length ? column : null, provenance: 'user' }
    }
    const presetLabel = preset?.[key]
    if (presetLabel !== undefined) {
      const column = layout.columns.indexOf(presetLabel)
      if (column >= 0) return { ...base, column, provenance: 'preset' }
    }
    const found = layout.detected[key]
    return found ? { ...base, column: found.column, provenance: found.provenance } : { ...base, column: null, provenance: null }
  })
}

export const columnOf = (fields: FieldMapping[], key: FieldKey) => fields.find((f) => f.key === key)?.column ?? null

/** "As Of = 10/16/2019", "As of: 2026-09-30" → the date text. */
export const AS_OF_PATTERN = /^\s*as\s*of\b\s*[=:]?\s*(.+)$/i

export const SAMPLE_SUFFIX = /\s*\(fictional sample data\)\s*$/i
