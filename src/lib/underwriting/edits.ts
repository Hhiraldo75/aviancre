import type { ISODate, Property, Sourced, T12Statement, UnderwritingAssumptions } from '../../types'
import { fmt } from '../format'
import { fromImport } from '../sourced'
import { t12ExpenseLines, t12OtherIncomeYear1 } from '../t12'
import { ANALYST_INPUT, defaultAssumptions, estimatedPrice } from './defaults'

/**
 * Analyst edits to the default assumptions. An edit is keyed by its dotted
 * path into UnderwritingAssumptions (e.g. "exit.exitCapRate",
 * "operating.expenses.0.annualAmount") and stored in engine units (Pct as a
 * decimal, months, USD). Edited values become Sourced "Analyst input".
 */

export type AssumptionEdits = Record<string, number>

/**
 * Edits to the Downside/Upside presets share the record, under keys like
 * "scenarios.downside.exit.exitCapRate" (see scenarios.ts), so they travel
 * with assumption sets. Base assumptions ignore them.
 */
export const SCENARIO_KEY_PREFIX = 'scenarios.'
const isBaseKey = (key: string) => !key.startsWith(SCENARIO_KEY_PREFIX)

export type AssumptionGroupTitle = 'Acquisition' | 'Leasing' | 'Operating' | 'Value-add' | 'Debt' | 'Exit'

/**
 * The value-add plan's on/off switch, stored as 1 when on. While it is off the
 * plan's inputs (and its scenario presets) may stay in the edits, inert: they
 * aren't listed as changes and the engine ignores them.
 */
export const VALUE_ADD_KEY = 'valueAdd.enabled'
export const VALUE_ADD_ON = 'Value-add plan On (default Off)'
const VALUE_ADD_INPUT = /^(scenarios\.[a-z]+\.)?valueAdd\./

export interface AssumptionField {
  key: string
  label: string
  group: AssumptionGroupTitle
  /** Display units per engine unit: 100 for percents, 1/12 for terms entered in years. */
  scale: number
  prefix?: string
  suffix: string
  /** Bounds in display units. */
  min: number
  max: number
  /** The minimum itself is not allowed (e.g. a price must be above $0). */
  minExclusive?: boolean
  integer?: boolean
  /** Also accepts a percent of this many, rounded down (e.g. "50%" of the units). */
  percentOf?: number
  /** Formats an engine value for reading, e.g. "7.25%". */
  format: (x: number) => string
}

const TOLERANCE = 1e-9

/** True when two engine values are the same up to float noise. */
export function sameValue(x: number, y: number): boolean {
  return Math.abs(x - y) <= TOLERANCE * Math.max(1, Math.abs(x), Math.abs(y))
}

/** Every numeric assumption the analyst can edit, in display order. */
export function editableFields(a: UnderwritingAssumptions): AssumptionField[] {
  const isMF = a.multifamily !== undefined
  const fields: AssumptionField[] = []
  let group: AssumptionGroupTitle = 'Acquisition'

  const pct = (key: string, label: string, min: number, max: number, format = fmt.pctShort, suffix = '%') =>
    fields.push({ key, label, group, scale: 100, suffix, min, max, format })
  const usd = (key: string, label: string, suffix = '', opts: { aboveZero?: boolean; cents?: boolean } = {}) =>
    fields.push({
      key,
      label,
      group,
      scale: 1,
      prefix: '$',
      suffix,
      min: 0,
      max: Infinity,
      minExclusive: opts.aboveZero,
      format: (x) => `${opts.cents ? fmt.usdCents(x) : fmt.usd(x)}${suffix}`,
    })
  const count = (key: string, label: string, unit: 'mo' | 'yrs', min: number, max: number, integer = false, scale = 1) =>
    fields.push({ key, label, group, scale, suffix: unit, min, max, integer, format: (x) => `${Number((x * scale).toFixed(1))} ${unit}` })

  usd('acquisition.purchasePrice', 'Purchase price', '', { aboveZero: true })
  pct('acquisition.marketCapRate', 'Market cap rate (price estimate)', 2, 15, (x) => fmt.pct(x, 2))
  pct('acquisition.closingCostsPct', 'Closing costs', 0, 10)
  usd('acquisition.initialCapex', 'Initial capex')
  count('acquisition.holdYears', 'Hold period', 'yrs', 1, 20, true)

  group = 'Leasing'
  usd('leasing.marketRent', 'Market rent (Year 1)', isMF ? '/unit/mo' : '/SF/yr', { aboveZero: true, cents: !isMF })
  pct('leasing.marketRentGrowth', 'Market rent growth', -10, 15)
  if (isMF) {
    pct('multifamily.turnoverRate', 'Turnover rate', 0, 100)
    usd('multifamily.turnoverCostPerUnit', 'Turnover cost', '/move-out')
    if (a.multifamily?.leaseUpUnitsPerMonth) {
      const suffix = 'units/mo'
      const format = (x: number) => `${Number(x.toFixed(1))} ${suffix}`
      fields.push({ key: 'multifamily.leaseUpUnitsPerMonth', label: 'Lease-up pace (vacant units)', group, scale: 1, suffix, min: 1, max: 1000, format })
    }
    if (a.multifamily?.maxRenewalIncreasePct) pct('multifamily.maxRenewalIncreasePct', 'Max renewal increase', 0, 50)
  } else {
    pct('leasing.newLeaseEscalationPct', 'New-lease escalation', 0, 10, (x) => `${fmt.pctShort(x)}/yr`, '%/yr')
    pct('leasing.renewalProbability', 'Renewal probability', 0, 100)
    count('leasing.downtimeMonths', 'Downtime (new tenant)', 'mo', 0, 36)
    for (const [who, path] of [
      ['New lease', 'leasing.newLease'],
      ['Renewal', 'leasing.renewal'],
    ] as const) {
      count(`${path}.termMonths`, `${who} term`, 'yrs', 1, 20, false, 1 / 12)
      count(`${path}.freeRentMonths`, `${who} free rent`, 'mo', 0, 24)
      usd(`${path}.tiPerSF`, `${who} TI`, '/SF', { cents: true })
      pct(`${path}.leasingCommissionPct`, `${who} leasing commission`, 0, 15)
    }
  }

  group = 'Operating'
  pct('operating.generalVacancyPct', 'General vacancy', 0, 50)
  pct('operating.creditLossPct', 'Credit loss', 0, 20)
  a.operating.expenses.forEach((e, i) => usd(`operating.expenses.${i}.annualAmount`, e.label, '/yr'))
  if (a.operating.otherIncomeYear1) usd('operating.otherIncomeYear1', 'Other income (Year 1)', '/yr')
  pct('operating.expenseGrowth', 'Expense growth', -10, 15)
  pct('operating.managementFeePct', 'Management fee (% of EGI)', 0, 15)
  usd('operating.capitalReservesPerYear', 'Capital reserves', isMF ? '/unit/yr' : '/SF/yr', { cents: !isMF })

  if (a.valueAdd?.enabled) fields.push(...valueAddInputs(a.valueAdd.units))

  group = 'Debt'
  pct('debt.ltv', 'Loan-to-value', 0, 90)
  if (a.debt.rate.type === 'fixed') pct('debt.rate.rate', 'Interest rate (fixed)', 0.5, 20, (x) => fmt.pct(x, 2))
  count('debt.amortizationYears', 'Amortization', 'yrs', 1, 40, true)
  count('debt.interestOnlyYears', 'Interest-only period', 'yrs', 0, 10, true)
  pct('debt.loanFeesPct', 'Loan fees', 0, 5)

  group = 'Exit'
  pct('exit.exitCapRate', 'Exit cap rate', 2, 15, (x) => fmt.pct(x, 2))
  pct('exit.sellingCostsPct', 'Selling costs', 0, 10)
  pct('discountRate', 'Discount rate (NPV)', 0, 30)
  pct('targetLeveredIRR', 'Target levered IRR', 0, 50)

  return fields
}

/** The value-add plan's inputs (listed with the other assumptions only while the plan is on). */
function valueAddInputs(units: number): AssumptionField[] {
  const group = 'Value-add'
  const whole = (key: string, label: string, suffix: string, min: number, max: number, format: (x: number) => string): AssumptionField => ({
    key,
    label,
    group,
    scale: 1,
    suffix,
    min,
    max,
    integer: true,
    format,
  })
  const usd = (key: string, label: string, suffix: string): AssumptionField => ({
    key,
    label,
    group,
    scale: 1,
    prefix: '$',
    suffix,
    min: 0,
    max: Infinity,
    format: (x) => `${fmt.usd(x)}${suffix}`,
  })
  return [
    { ...whole('valueAdd.unitCount', 'Units to renovate', 'units', 0, units, (x) => `${x} units (${fmt.pctShort(x / units)})`), percentOf: units },
    whole('valueAdd.startMonth', 'Start month', 'month', 1, 240, (x) => `month ${x}`),
    whole('valueAdd.maxPerMonth', 'Max pace', 'units/mo', 1, 1000, (x) => `${x} units/mo`),
    usd('valueAdd.costPerUnit', 'Renovation cost', '/unit'),
    usd('valueAdd.premiumMonthly', 'Rent premium (Year 1)', '/unit/mo'),
    whole('valueAdd.downtimeMonths', 'Renovation downtime', 'mo', 0, 12, (x) => `${x} mo`),
  ]
}

/**
 * Every value-add key a property accepts, on or off: the switch and the
 * inputs. Edits and assumption sets are checked against these, so the inputs
 * can be kept while the plan is off. Empty unless the property has a unit rent roll.
 */
export function valueAddFields(a: UnderwritingAssumptions): AssumptionField[] {
  if (!a.valueAdd) return []
  const toggle: AssumptionField = {
    key: VALUE_ADD_KEY,
    label: 'Value-add plan',
    group: 'Value-add',
    scale: 1,
    suffix: '',
    min: 0,
    max: 1,
    integer: true,
    format: (x) => (x === 1 ? 'On' : 'Off'),
  }
  return [toggle, ...valueAddInputs(a.valueAdd.units)]
}

/** Edits without the plan's inputs and presets while the plan is off (they change nothing then). */
export function activeEdits(edits: AssumptionEdits): AssumptionEdits {
  if (edits[VALUE_ADD_KEY] === 1) return edits
  return Object.fromEntries(Object.entries(edits).filter(([k]) => !VALUE_ADD_INPUT.test(k)))
}

type Node = Record<string, unknown>

function parentOf(a: UnderwritingAssumptions, key: string): [Node, string] {
  const path = key.split('.')
  const last = path.pop()!
  let node = a as unknown as Node
  for (const part of path) {
    node = node[part] as Node
    if (!node) throw new Error(`No assumption at ${key}`)
  }
  return [node, last]
}

/** The Sourced value at an assumption path. */
export function fieldValue(a: UnderwritingAssumptions, key: string): Sourced<number> {
  const [parent, last] = parentOf(a, key)
  const v = parent[last] as Sourced<number> | undefined
  if (!v || typeof v.value !== 'number') throw new Error(`No numeric assumption at ${key}`)
  return v
}

/** Whether a value was entered by the analyst rather than defaulted. */
export const isEdited = (v: Sourced<unknown>) => v.sourceName === ANALYST_INPUT

const display = (f: AssumptionField, x: number) => x * f.scale
const bound = (x: number) => (x < 0 ? `−${-x}` : String(x))

function rangeText(f: AssumptionField): string {
  if (f.max === Infinity) return f.minExclusive ? `Enter an amount above $${f.min}` : `Enter $${f.min} or more`
  const unit = f.suffix.startsWith('%') ? '%' : ` ${f.suffix}`
  const range = f.min < 0 ? `${bound(f.min)}${unit} to ${f.max}${unit}` : `${f.min}–${f.max}${unit}`
  return `Enter ${f.integer ? 'a whole number, ' : ''}${range}`
}

/** A short message when an engine value is out of range, otherwise null. */
export function validateValue(f: AssumptionField, value: number): string | null {
  if (!Number.isFinite(value)) return 'Enter a number'
  const d = display(f, value)
  const eps = TOLERANCE * Math.max(1, Math.abs(d))
  const tooLow = f.minExclusive ? d <= f.min + eps : d < f.min - eps
  if (tooLow || d > f.max + eps) return rangeText(f)
  if (f.integer && Math.abs(d - Math.round(d)) > eps) return rangeText(f)
  return null
}

/** Parses what the analyst typed (display units; commas, $ and % allowed) into an engine value. */
export function parseInput(f: AssumptionField, text: string): { value: number } | { error: string } {
  const cleaned = text.replace(/[,$%\s]/g, '').replace(/^−/, '-')
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return { error: 'Enter a number' }
  const share = f.percentOf !== undefined && text.trim().endsWith('%')
  // Rounded down after a little float slack, so 50% of 120 is 60, never 59.
  const value = share ? Math.floor((Number(cleaned) / 100) * f.percentOf! + 1e-9) : Number(cleaned) / f.scale
  const error = validateValue(f, value)
  return error ? { error } : { value }
}

/** An engine value as the input box shows it, e.g. 0.0725 → "7.25", 4146371.4 → "4,146,371.4". */
export function formatInput(f: AssumptionField, value: number): string {
  return display(f, value).toLocaleString('en-US', { maximumFractionDigits: f.prefix === '$' ? 2 : 4, useGrouping: true })
}

/**
 * Defaults with the edits applied as Analyst input. An unedited purchase price
 * stays anchored to the default year-1 NOI and changes only with the market
 * cap rate. Unknown or out-of-range edits are ignored; the UI only stores valid ones.
 */
function applyEdits(property: Property, asOf: ISODate, defaults: UnderwritingAssumptions, edits: AssumptionEdits) {
  const a = structuredClone(defaults)
  const fields = new Map([...editableFields(defaults), ...valueAddFields(defaults)].map((f) => [f.key, f]))
  for (const [key, value] of Object.entries(edits)) {
    const f = fields.get(key)
    if (!f || validateValue(f, value)) continue
    if (key === VALUE_ADD_KEY) {
      a.valueAdd!.enabled = value === 1
      continue
    }
    const [parent, last] = parentOf(a, key)
    parent[last] = fromImport(value, ANALYST_INPUT)
  }
  if (!('acquisition.purchasePrice' in edits) && 'acquisition.marketCapRate' in edits) {
    a.acquisition.purchasePrice = estimatedPrice(property, defaults, asOf, a.acquisition.marketCapRate)
  }
  if (property.t12) regrowT12(property.t12, a)
  return a
}

/** T-12 lines re-grown to Year 1 at the (possibly edited) growth rates; lines the analyst edited stay as entered. */
function regrowT12(t12: T12Statement, a: UnderwritingAssumptions) {
  const start = a.acquisition.analysisStartDate
  const lines = t12ExpenseLines(t12, a.operating.expenseGrowth.value, start, !a.multifamily)
  a.operating.expenses = a.operating.expenses.map((e, i) => (isEdited(e.annualAmount) || !lines[i] ? e : lines[i]))
  const other = a.operating.otherIncomeYear1
  if (other && !isEdited(other)) a.operating.otherIncomeYear1 = t12OtherIncomeYear1(t12, a.leasing.marketRentGrowth.value, start)
}

export const hasEdits = (edits: AssumptionEdits | undefined) => !!edits && Object.keys(edits).length > 0

// Single-entry caches so the summary card and the full view share one set of
// assumptions (and one engine run) per edit. Keyed weakly; nothing leaks.
const defaultsCache = new WeakMap<Property, { asOf: ISODate; a: UnderwritingAssumptions }>()
const editedCache = new WeakMap<AssumptionEdits, { property: Property; asOf: ISODate; a: UnderwritingAssumptions }>()

/** Default assumptions, computed once per property and date. */
export function defaultsFor(property: Property, asOf: ISODate): UnderwritingAssumptions {
  const hit = defaultsCache.get(property)
  if (hit?.asOf === asOf) return hit.a
  const a = defaultAssumptions(property, asOf)
  defaultsCache.set(property, { asOf, a })
  return a
}

/** Assumptions with edits applied; the defaults object itself when there are none (preset edits don't count). */
export function assumptionsFor(property: Property, asOf: ISODate, edits?: AssumptionEdits): UnderwritingAssumptions {
  const defaults = defaultsFor(property, asOf)
  if (!edits || !Object.keys(edits).some(isBaseKey)) return defaults
  const hit = editedCache.get(edits)
  if (hit && hit.property === property && hit.asOf === asOf) return hit.a
  const a = applyEdits(property, asOf, defaults, edits)
  editedCache.set(edits, { property, asOf, a })
  return a
}

/** Edited assumptions as "Exit cap rate 7.50% (default 7.25%)", for the "Assumptions changed" tooltip. */
export function assumptionChanges(a: UnderwritingAssumptions, defaults: UnderwritingAssumptions): string[] {
  return editableFields(a).flatMap((f) => {
    // The plan's switch heads its inputs.
    const on = f.key === 'valueAdd.unitCount' ? [VALUE_ADD_ON] : []
    const v = fieldValue(a, f.key)
    if (!isEdited(v)) return on
    return [...on, `${f.label} ${f.format(v.value)} (default ${f.format(fieldValue(defaults, f.key).value)})`]
  })
}
