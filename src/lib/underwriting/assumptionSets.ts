import type { ISODate, Property, UnderwritingAssumptions } from '../../types'
import { slug } from '../format'
import { DEFAULT_EXPENSE_LABEL } from './defaults'
import { defaultsFor, editableFields, sameValue, validateValue, valueAddFields, type AssumptionEdits } from './edits'
import { scenarioFields } from './scenarios'

/**
 * Named assumption sets: a property's analyst edits saved under a name
 * ("Base", "My case") so they can be re-applied, shared as a small JSON file,
 * and run by `npm run underwrite -- <id> --assumptions <file>`. A set holds only
 * the changed assumptions, including edited Downside/Upside presets
 * ("scenarios.downside.…" keys); "Defaults" (no changes) is always available.
 */

export const DEFAULTS_SET = 'Defaults'
export const SET_FILE_FORMAT = 'aviancre-assumption-set'
export const SET_FILE_VERSION = 1
export const MAX_SET_NAME = 60

export interface SavedAssumptionSet {
  name: string
  savedAt: ISODate
  /** Only the changed assumptions, keyed by assumption path, in engine units. */
  edits: AssumptionEdits
  /**
   * Labels of the operating expense lines the set was made on: expense edits
   * are keyed by line position, which a loaded or removed T-12 changes.
   * Absent: the default single line.
   */
  expenseLines?: string[]
}

/** The exported file: only the changes, plus property id, set name and date. */
export interface AssumptionSetFile {
  format: typeof SET_FILE_FORMAT
  version: typeof SET_FILE_VERSION
  propertyId: string
  name: string
  savedAt: ISODate
  changes: AssumptionEdits
  /** See SavedAssumptionSet.expenseLines. */
  expenseLines?: string[]
}

/** The same edits: the same keys, with values equal up to float noise. */
export function sameEdits(a: AssumptionEdits = {}, b: AssumptionEdits = {}): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => k in b && sameValue(a[k], b[k]))
}

/** A problem with a proposed set name, or null when it is fine. */
export function setNameError(name: string): string | null {
  const n = name.trim()
  if (!n) return 'Enter a name'
  if (n.toLowerCase() === DEFAULTS_SET.toLowerCase()) return `"${DEFAULTS_SET}" is reserved`
  if (n.length > MAX_SET_NAME) return `Use at most ${MAX_SET_NAME} characters`
  return null
}

export function assumptionSetFile(propertyId: string, set: SavedAssumptionSet): AssumptionSetFile {
  return {
    format: SET_FILE_FORMAT,
    version: SET_FILE_VERSION,
    propertyId,
    name: set.name,
    savedAt: set.savedAt,
    changes: { ...set.edits },
    ...(set.expenseLines ? { expenseLines: [...set.expenseLines] } : {}),
  }
}

// ---------- expense lines ----------

/** Expense edits, Base or preset: "operating.expenses.0.annualAmount", "scenarios.downside.operating.expenses.…". */
const EXPENSE_KEY = /^(scenarios\.[a-z]+\.)?operating\.expenses\./

export const expenseLineLabels = (a: UnderwritingAssumptions) => a.operating.expenses.map((e) => e.label)

/** The lines a set was made on: the recorded ones, or the default single line for a set saved before lines were recorded. */
export function expenseLinesOf(property: Property, recorded: string[] | undefined): string[] {
  return recorded ?? [DEFAULT_EXPENSE_LABEL[property.rentRoll.kind === 'multifamily' ? 'multifamily' : 'commercial']]
}

/** The property's current expense lines when they aren't the default single line (what a set records); undefined otherwise. */
export function recordedExpenseLines(property: Property, asOf: ISODate): string[] | undefined {
  const now = expenseLineLabels(defaultsFor(property, asOf))
  const single = expenseLinesOf(property, undefined)
  return now.length === 1 && now[0] === single[0] ? undefined : now
}

const describeLines = (property: Property, lines: string[]) =>
  lines.length === 1 && lines[0] === expenseLinesOf(property, undefined)[0]
    ? `the single benchmark line “${lines[0]}”`
    : `${lines.length} T-12 lines (${lines.slice(0, 3).join(', ')}${lines.length > 3 ? ', …' : ''})`

/**
 * Edits made on other expense lines than the property has now (a T-12 loaded
 * or removed since) would land on the wrong line, so they are dropped, and the
 * notice says which and why. Other edits are kept as they are.
 */
export function reconcileExpenseEdits(
  property: Property,
  asOf: ISODate,
  edits: AssumptionEdits,
  madeOn: string[] | undefined,
  setName?: string,
): { edits: AssumptionEdits; notice: string | null } {
  const dropped = Object.keys(edits).filter((k) => EXPENSE_KEY.test(k))
  const was = expenseLinesOf(property, madeOn)
  const now = expenseLineLabels(defaultsFor(property, asOf))
  if (!dropped.length || (was.length === now.length && was.every((x, i) => x === now[i]))) return { edits, notice: null }
  const n = dropped.length
  return {
    edits: Object.fromEntries(Object.entries(edits).filter(([k]) => !EXPENSE_KEY.test(k))),
    notice:
      `Dropped ${n} operating expense edit${n === 1 ? '' : 's'}${setName ? ` from “${setName}”` : ''}: ` +
      `${n === 1 ? 'it was' : 'they were'} made on ${describeLines(property, was)}, and this property now has ${describeLines(property, now)}. ` +
      'Re-enter them on the current lines if you still want them.',
  }
}

/** e.g. "sample-atwells-retail-row--my-case.assumptions.json" */
export const setFileName = (propertyId: string, name: string) => `${propertyId}--${slug(name) || 'set'}.assumptions.json`

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/**
 * Reads an exported set for this property, checking every change against the
 * assumptions the property can edit and their allowed ranges. All problems are
 * returned together; a set with any problem is not loaded.
 */
export function parseAssumptionSetFile(
  json: unknown,
  property: Property,
  asOf: ISODate,
): { set: SavedAssumptionSet; errors: []; notices?: string[] } | { set: null; errors: string[] } {
  const errors: string[] = []
  if (!isObject(json) || json.format !== SET_FILE_FORMAT) return { set: null, errors: ['Not an AVIANCRE assumption set file.'] }
  if (json.version !== SET_FILE_VERSION) return { set: null, errors: [`Unsupported assumption set version ${String(json.version)}.`] }
  if (json.propertyId !== property.id) {
    errors.push(`This set is for "${String(json.propertyId)}", not ${property.id}.`)
  }
  const name = typeof json.name === 'string' ? json.name.trim() : ''
  const nameError = setNameError(name)
  if (nameError) errors.push(`Set name: ${nameError}.`)
  const savedAt = typeof json.savedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(json.savedAt) ? json.savedAt : null
  if (!savedAt) errors.push('Date (savedAt) must be YYYY-MM-DD.')
  const lines = json.expenseLines
  const linesOK = lines === undefined || (Array.isArray(lines) && lines.every((x) => typeof x === 'string'))
  if (!linesOK) errors.push('"expenseLines" must be a list of expense line labels.')
  let changes: Record<string, unknown> = {}
  let notice: string | null = null
  if (!isObject(json.changes)) {
    errors.push('"changes" must be an object of assumption → value.')
  } else if (json.propertyId === property.id && linesOK) {
    // Expense edits made on other lines are dropped before the rest is checked.
    const reconciled = reconcileExpenseEdits(property, asOf, json.changes as AssumptionEdits, lines as string[] | undefined, name || undefined)
    changes = reconciled.edits
    notice = reconciled.notice
    const defaults = defaultsFor(property, asOf)
    const fields = new Map([...editableFields(defaults), ...valueAddFields(defaults), ...scenarioFields(defaults)].map((f) => [f.key, f]))
    for (const [key, value] of Object.entries(changes)) {
      const f = fields.get(key)
      if (!f) errors.push(`Unknown assumption "${key}" for this property.`)
      else if (typeof value !== 'number') errors.push(`${f.label}: value must be a number.`)
      else {
        const problem = validateValue(f, value)
        if (problem) errors.push(`${f.label}: ${f.format(value)} is out of range (${problem}).`)
      }
    }
  }
  if (errors.length) return { set: null, errors }
  const expenseLines = recordedExpenseLines(property, asOf)
  return {
    set: { name, savedAt: savedAt!, edits: { ...(changes as AssumptionEdits) }, ...(expenseLines ? { expenseLines } : {}) },
    errors: [],
    ...(notice ? { notices: [notice] } : {}),
  }
}

/** Stored sets (local storage) that still have the right shape. Values are re-validated when applied. */
export function isSavedSet(x: unknown): x is SavedAssumptionSet {
  return (
    isObject(x) &&
    typeof x.name === 'string' &&
    typeof x.savedAt === 'string' &&
    isObject(x.edits) &&
    Object.values(x.edits).every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    (x.expenseLines === undefined || (Array.isArray(x.expenseLines) && x.expenseLines.every((l) => typeof l === 'string')))
  )
}

// ---------- memos ----------

/** "3 changes from defaults", "no changes from defaults". */
export const changesText = (n: number) => (n === 0 ? 'no changes from defaults' : `${n} change${n === 1 ? '' : 's'} from defaults`)

/** "Assumption set: My case, 3 changes from defaults" — the memo's header line. */
export const setSummary = (name: string, changeCount: number) => `Assumption set: ${name}, ${changesText(changeCount)}`

const MARKER = /^<!--\s*aviancre-assumption-set:\s*(\{.*\})\s*-->[ \t]*$/m

/**
 * A hidden line the memo carries so the app can tell which assumptions it was
 * written at. The renderer never shows it.
 */
export function memoMarker(name: string, edits: AssumptionEdits): string {
  return `<!-- aviancre-assumption-set: ${JSON.stringify({ name, changes: edits })} -->`
}

/** The memo's assumption set from its marker; a memo without one was written at Defaults. */
export function memoAssumptionSet(markdown: string): { name: string; edits: AssumptionEdits } {
  const m = MARKER.exec(markdown)
  if (m) {
    try {
      const x: unknown = JSON.parse(m[1])
      if (isObject(x) && typeof x.name === 'string' && isObject(x.changes) && Object.values(x.changes).every((v) => typeof v === 'number')) {
        return { name: x.name, edits: x.changes as AssumptionEdits }
      }
    } catch {
      // A damaged marker reads as Defaults, like a memo without one.
    }
  }
  return { name: DEFAULTS_SET, edits: {} }
}

/** The memo without its marker line, for rendering. */
export function withoutMarker(markdown: string): string {
  return markdown.replace(new RegExp(MARKER.source + '\\n?', 'm'), '')
}

// ---------- what is applied now ----------

/** The active set's saved edits (none for Defaults or a set that no longer exists). */
export function activeSetEdits(activeName: string, sets: SavedAssumptionSet[]): AssumptionEdits {
  return sets.find((x) => x.name === activeName)?.edits ?? {}
}

/** True when the current edits are no longer the active set's. */
export function isModified(activeName: string, sets: SavedAssumptionSet[], edits: AssumptionEdits): boolean {
  return !sameEdits(edits, activeSetEdits(activeName, sets))
}

/** What is applied, in words: "My case", "Defaults", "My case with unsaved changes", "unsaved changes". */
export function appliedSetLabel(activeName: string, sets: SavedAssumptionSet[], edits: AssumptionEdits): string {
  const known = activeName === DEFAULTS_SET || sets.some((x) => x.name === activeName)
  if (known && !isModified(activeName, sets, edits)) return activeName
  return activeName === DEFAULTS_SET || !known ? 'unsaved changes' : `${activeName} with unsaved changes`
}
