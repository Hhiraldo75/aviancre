import type { ISODate, Property, UnderwritingAssumptions, UnderwritingResult, ValueAddAssumptions, ValueAddPlan } from '../../types'
import { fmt } from '../format'
import { changeText } from './scenarios'
import { runUnderwriting } from './summary'

/**
 * As-is vs Value-add: the same assumptions run with the plan off and with it
 * on, at the same price. Both are ordinary engine runs; the only figures
 * computed here are the plan's own (return on cost, value created, pace).
 */

/** Year-1 premium × 12 ÷ cost per unit; leaves out downtime and the move-out cost. */
export const returnOnCost = (va: ValueAddAssumptions) => (va.premiumMonthly.value * 12) / va.costPerUnit.value

export interface ValueAddCell {
  value: number | null
  display: string
}

export interface ValueAddRow {
  key: string
  label: string
  kind: 'usd' | 'pct' | 'multiple' | 'text'
  asIs: ValueAddCell
  valueAdd: ValueAddCell
  /** Value-add minus as-is; absent on rows only the plan has. */
  change?: ValueAddCell
}

export interface PaceYear {
  year: number
  /** Renovations started this year. */
  units: number
  spend: number
  cumulativeUnits: number
  /** Cumulative units ÷ target; null for a target of 0. */
  cumulativeShare: number | null
}

export type ValueAddComparison =
  | {
      status: 'ok'
      plan: ValueAddPlan
      asIs: UnderwritingResult
      valueAdd: UnderwritingResult
      rows: ValueAddRow[]
      pace: PaceYear[]
      returnOnCost: number
      /** Exit value uplift − renovation spend. */
      valueCreated: number
      /** "Month 27 (Year 3)", or why the program doesn't finish in the hold. */
      finish: string
      warnings: string[]
      notes: string[]
    }
  | { status: 'unavailable'; reason: string }

const asIsCache = new WeakMap<UnderwritingAssumptions, UnderwritingAssumptions>()

/** The same assumptions with the plan off (same object per input, so runs are cached). */
export function asIsAssumptions(a: UnderwritingAssumptions): UnderwritingAssumptions {
  const hit = asIsCache.get(a)
  if (hit) return hit
  const off = structuredClone(a)
  off.valueAdd!.enabled = false
  asIsCache.set(a, off)
  return off
}

/** "Month 27 (Year 3)"; "Not finished in the hold: 52 of 60 units". */
export function finishText(plan: ValueAddPlan): string {
  if (plan.finishMonth !== null) return `Month ${plan.finishMonth} (Year ${Math.ceil(plan.finishMonth / 12)})`
  return plan.target === 0 ? 'No units to renovate' : `Not finished in the hold: ${plan.renovated} of ${plan.target} units`
}

/** Renovations started, spend and progress by hold year. */
export function paceByYear(r: UnderwritingResult): PaceYear[] {
  const target = r.valueAdd?.target ?? 0
  let cumulative = 0
  return r.cashFlows.map((c) => {
    cumulative += c.unitsRenovated
    return { year: c.year, units: c.unitsRenovated, spend: c.renovationCapex, cumulativeUnits: cumulative, cumulativeShare: target ? cumulative / target : null }
  })
}

const cmpCache = new WeakMap<UnderwritingAssumptions, { property: Property; asOf: ISODate; cmp: ValueAddComparison | null }>()

/** The comparison for assumptions with the plan on; null when the plan is off or the property has none. */
export function valueAddComparison(property: Property, asOf: ISODate, a: UnderwritingAssumptions): ValueAddComparison | null {
  const hit = cmpCache.get(a)
  if (hit && hit.property === property && hit.asOf === asOf) return hit.cmp
  const cmp = a.valueAdd?.enabled ? compare(property, asOf, a) : null
  cmpCache.set(a, { property, asOf, cmp })
  return cmp
}

const text = (display: string): ValueAddCell => ({ value: null, display })
const none = text('—')

function cellOf(kind: ValueAddRow['kind'], x: number | null): ValueAddCell {
  if (x === null) return none
  if (kind === 'usd') return { value: x, display: fmt.money(x) }
  if (kind === 'pct') return { value: x, display: fmt.pct(x, 2) }
  return { value: x, display: fmt.multiple(x) }
}

function compare(property: Property, asOf: ISODate, a: UnderwritingAssumptions): ValueAddComparison {
  const on = runUnderwriting(property, asOf, a)
  if (on.status === 'unavailable') return on
  const off = runUnderwriting(property, asOf, asIsAssumptions(a))
  if (off.status === 'unavailable') return off
  const v = on.result
  const x = off.result
  const plan = v.valueAdd!
  const roc = returnOnCost(a.valueAdd!)
  const uplift = v.metrics.exitValue - x.metrics.exitValue
  const valueCreated = uplift - plan.spent
  const finish = finishText(plan)

  const both = (key: string, label: string, kind: 'usd' | 'pct' | 'multiple', get: (r: UnderwritingResult) => number | null): ValueAddRow => {
    const [p, q] = [get(x), get(v)]
    const row: ValueAddRow = { key, label, kind, asIs: cellOf(kind, p), valueAdd: cellOf(kind, q) }
    if (p === null || q === null) return { ...row, change: none }
    return { ...row, change: { value: q - p, display: changeText(kind, q, p).display } }
  }
  const planOnly = (key: string, label: string, kind: ValueAddRow['kind'], cell: ValueAddCell, asIs: ValueAddCell = none): ValueAddRow => ({
    key,
    label,
    kind,
    asIs,
    valueAdd: cell,
  })
  const zero = cellOf('usd', 0)

  const rows: ValueAddRow[] = [
    both('year1NOI', 'Year-1 NOI', 'usd', (r) => r.cashFlows[0].netOperatingIncome),
    both('stabilizedNOI', `Stabilized NOI (normalized Year ${v.normalizedExitYear.year})`, 'usd', (r) => r.metrics.exitNOI),
    planOnly('programFinish', 'Program finishes (last re-lease)', 'text', text(finish)),
    planOnly('unitsRenovated', 'Units renovated', 'text', text(`${plan.renovated} of ${plan.target}`)),
    planOnly('reserve', 'Renovation reserve (equity at closing)', 'usd', cellOf('usd', plan.reserve), zero),
    planOnly('spend', 'Total renovation spend', 'usd', cellOf('usd', plan.spent), zero),
    planOnly('unspent', 'Unspent reserve returned at sale', 'usd', cellOf('usd', plan.unspent), zero),
    planOnly('returnOnCost', 'Return on cost (premium × 12 ÷ cost)', 'pct', cellOf('pct', roc)),
    both('exitValue', 'Exit value (gross)', 'usd', (r) => r.metrics.exitValue),
    planOnly('valueCreated', 'Value created (exit value uplift − spend)', 'usd', cellOf('usd', valueCreated)),
    both('equityRequired', 'Equity required', 'usd', (r) => r.metrics.equityRequired),
    both('unleveredIRR', 'Unlevered IRR', 'pct', (r) => r.metrics.unleveredIRR),
    both('leveredIRR', 'Levered IRR', 'pct', (r) => r.metrics.leveredIRR),
    both('equityMultiple', 'Levered multiple', 'multiple', (r) => r.metrics.equityMultiple),
    both('minimumDSCR', 'Minimum DSCR', 'multiple', (r) => r.metrics.minimumDSCR),
  ]

  const warnings: string[] = []
  if (valueCreated <= 0) {
    warnings.push(
      `Value-add plan: the exit value rises ${fmt.usd(uplift)} on ${fmt.usd(plan.spent)} of renovations, ` +
        `so the plan creates no value (${fmt.usd(valueCreated)}).`,
    )
  }
  const noi1 = (r: UnderwritingResult) => r.cashFlows[0].netOperatingIncome
  const notes = [`Both cases at the same purchase price (${fmt.money(v.metrics.purchasePrice)}); the as-is case is these assumptions with the plan off.`]
  if (noi1(v) < noi1(x)) notes.push(`Year-1 NOI is ${fmt.usd(noi1(x) - noi1(v))} below as-is: renovation downtime, on top of general vacancy, comes before the premium.`)
  notes.push('Return on cost is the Year-1 premium × 12 ÷ cost per unit; it leaves out downtime and the move-out cost.')

  return { status: 'ok', plan, asIs: x, valueAdd: v, rows, pace: paceByYear(v), returnOnCost: roc, valueCreated, finish, warnings, notes }
}
