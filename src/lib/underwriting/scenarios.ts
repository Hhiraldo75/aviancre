import type { ISODate, Property, Scenario, Sourced, UnderwritingAssumptions, UnderwritingResult } from '../../types'
import { fmt } from '../format'
import { estimate, fromImport } from '../sourced'
import { ANALYST_INPUT } from './defaults'
import {
  assumptionsFor,
  editableFields,
  fieldValue,
  formatInput,
  sameValue,
  SCENARIO_KEY_PREFIX,
  type AssumptionEdits,
  type AssumptionField,
  type AssumptionGroupTitle,
} from './edits'
import type { AssumptionEdit } from './fullView'
import { maxBid, type MaxBid } from './maxBid'
import { maxBidStat, runUnderwriting, type UnderwritingRun } from './summary'

/**
 * Downside and Upside: preset changes layered on the current assumptions
 * (defaults plus analyst edits). No engine math changes: each scenario is the
 * Base assumptions object with a few values moved, run like any other. The
 * purchase price is copied from Base, so all three cases are priced the same.
 * Preset edits are stored with the analyst's edits under
 * "scenarios.<scenario>.<assumption path>", so they travel with assumption sets.
 */

export type StressScenario = Exclude<Scenario, 'base'>
export const SCENARIOS: readonly Scenario[] = ['base', 'downside', 'upside']
export const STRESS_SCENARIOS: readonly StressScenario[] = ['downside', 'upside']
export const SCENARIO_LABELS: Record<Scenario, string> = { base: 'Base', downside: 'Downside', upside: 'Upside' }

/** pts: percentage points; bps: basis points; relative: a share of the value (−0.05 = −5%). */
type LeverKind = 'pts' | 'bps' | 'months' | 'relative'

interface Lever {
  /** The assumption the lever moves; it applies only where that assumption is editable. */
  key: string
  label: string
  kind: LeverKind
  /** Preset change in engine units. */
  preset: Record<StressScenario, number>
  /** Largest change either way, in display units. */
  limit: number
}

export const LEVERS: readonly Lever[] = [
  { key: 'leasing.marketRent', label: 'Market rent', kind: 'relative', preset: { downside: -0.05, upside: 0 }, limit: 50 },
  { key: 'leasing.marketRentGrowth', label: 'Rent growth', kind: 'pts', preset: { downside: -0.01, upside: 0.01 }, limit: 10 },
  { key: 'leasing.renewalProbability', label: 'Renewal probability', kind: 'pts', preset: { downside: -0.1, upside: 0 }, limit: 100 },
  { key: 'leasing.downtimeMonths', label: 'Downtime', kind: 'months', preset: { downside: 3, upside: 0 }, limit: 36 },
  { key: 'multifamily.turnoverRate', label: 'Turnover', kind: 'pts', preset: { downside: 0.1, upside: 0 }, limit: 100 },
  { key: 'operating.generalVacancyPct', label: 'General vacancy', kind: 'pts', preset: { downside: 0.02, upside: -0.01 }, limit: 20 },
  { key: 'operating.expenseGrowth', label: 'Expense growth', kind: 'pts', preset: { downside: 0, upside: 0 }, limit: 10 },
  { key: 'exit.exitCapRate', label: 'Exit cap', kind: 'bps', preset: { downside: 0.005, upside: -0.0025 }, limit: 300 },
]

/** Upside takes general vacancy no lower than this, and never raises a Base that is already below it. */
export const UPSIDE_VACANCY_FLOOR = 0.03
export const PRESET_SOURCE = 'Scenario preset – rule of thumb, replace with your own downside/upside view'

const SCALE: Record<LeverKind, number> = { pts: 100, bps: 10_000, months: 1, relative: 100 }
const SUFFIX: Record<LeverKind, string> = { pts: 'pts', bps: 'bps', months: 'mo', relative: '%' }

/** "+1.5 pts", "−50 bps", "+3 mo", "−5%", "0 pts". */
export function deltaText(kind: LeverKind, x: number): string {
  const d = Number((Math.abs(x) * SCALE[kind]).toFixed(2))
  const unit = kind === 'pts' ? (d === 1 ? ' pt' : ' pts') : kind === 'relative' ? '%' : ` ${SUFFIX[kind]}`
  return `${d === 0 ? '' : x > 0 ? '+' : '−'}${d}${unit}`
}

/** The edits key of a preset, e.g. "scenarios.downside.exit.exitCapRate". */
export const presetKey = (scenario: StressScenario, leverKey: string) => `${SCENARIO_KEY_PREFIX}${scenario}.${leverKey}`

const fieldMap = (a: UnderwritingAssumptions) => new Map(editableFields(a).map((f) => [f.key, f]))

/** The levers that apply to these assumptions (renewal and downtime for commercial, turnover for multifamily). */
export function applicableLevers(a: UnderwritingAssumptions): Lever[] {
  const fields = fieldMap(a)
  return LEVERS.filter((l) => fields.has(l.key))
}

function leverField(l: Lever, scenario: StressScenario, group: AssumptionGroupTitle): AssumptionField {
  return {
    key: presetKey(scenario, l.key),
    label: `${SCENARIO_LABELS[scenario]} ${l.label.toLowerCase()}`,
    group,
    scale: SCALE[l.kind],
    suffix: SUFFIX[l.kind],
    min: -l.limit,
    max: l.limit,
    format: (x) => deltaText(l.kind, x),
  }
}

/** The preset inputs, shaped like assumption fields so the same parsing and validation apply. */
export function scenarioFields(a: UnderwritingAssumptions): AssumptionField[] {
  const fields = fieldMap(a)
  return applicableLevers(a).flatMap((l) => STRESS_SCENARIOS.map((s) => leverField(l, s, fields.get(l.key)!.group)))
}

/** A preset's change: the analyst's edit, or the rule-of-thumb preset (EST). */
export function presetDelta(scenario: StressScenario, l: Lever, edits: AssumptionEdits = {}): Sourced<number> {
  const key = presetKey(scenario, l.key)
  return key in edits ? fromImport(edits[key], ANALYST_INPUT) : estimate(l.preset[scenario], PRESET_SOURCE)
}

export interface ScenarioOverride {
  key: string
  /** The assumption's label, e.g. "Exit cap rate". */
  label: string
  from: number
  to: number
  /** The Base value as shown, e.g. "7.25%". */
  baseText: string
  /** "7.25% → 7.75%" */
  text: string
  /** The preset change, e.g. "+50 bps". */
  delta: string
  /** Set when a floor or the assumption's allowed range held the value. */
  note?: string
}

/** The values a scenario changes, after the Upside vacancy floor and the assumptions' allowed ranges. */
export function scenarioOverrides(base: UnderwritingAssumptions, scenario: Scenario, edits: AssumptionEdits = {}): ScenarioOverride[] {
  if (scenario === 'base') return []
  const fields = fieldMap(base)
  return applicableLevers(base).flatMap((l): ScenarioOverride[] => {
    const d = presetDelta(scenario, l, edits).value
    if (d === 0) return []
    const f = fields.get(l.key)!
    const from = fieldValue(base, l.key).value
    let to = l.kind === 'relative' ? from * (1 + d) : from + d
    let note: string | undefined
    if (scenario === 'upside' && l.key === 'operating.generalVacancyPct') {
      const floor = Math.min(from, UPSIDE_VACANCY_FLOOR)
      if (to < floor) {
        to = floor
        note = `Upside vacancy floor: not below ${fmt.pctShort(UPSIDE_VACANCY_FLOOR)}`
      }
    }
    const [lo, hi] = [f.min / f.scale, f.max / f.scale]
    if (to < lo) {
      to = lo
      note = `Held at the ${f.format(lo)} minimum`
    } else if (to > hi) {
      to = hi
      note = `Held at the ${f.format(hi)} maximum`
    }
    if (sameValue(to, from)) return []
    const baseText = f.format(from)
    return [{ key: l.key, label: f.label, from, to, baseText, text: `${baseText} → ${f.format(to)}`, delta: deltaText(l.kind, d), ...(note ? { note } : {}) }]
  })
}

function setValue(a: UnderwritingAssumptions, key: string, value: Sourced<number>) {
  const path = key.split('.')
  const last = path.pop()!
  let node = a as unknown as Record<string, unknown>
  for (const part of path) node = node[part] as Record<string, unknown>
  node[last] = value
}

const scenarioCache = new WeakMap<UnderwritingAssumptions, Partial<Record<StressScenario, { edits: AssumptionEdits; a: UnderwritingAssumptions }>>>()

/**
 * The assumptions for a scenario: `base` itself for Base (same object, so the
 * same cached run and the same output); otherwise a copy with the overrides
 * as estimates (EST). The purchase price and market cap rate are never moved.
 */
export function withScenario(base: UnderwritingAssumptions, scenario: Scenario, edits: AssumptionEdits = {}): UnderwritingAssumptions {
  if (scenario === 'base') return base
  const hits = scenarioCache.get(base) ?? {}
  const hit = hits[scenario]
  if (hit && hit.edits === edits) return hit.a
  const a = structuredClone(base)
  a.scenario = scenario
  for (const o of scenarioOverrides(base, scenario, edits)) {
    const preset = presetDelta(scenario, LEVERS.find((l) => l.key === o.key)!, edits)
    const whose = preset.sourceName === ANALYST_INPUT ? 'your preset' : 'preset'
    setValue(a, o.key, estimate(o.to, `${SCENARIO_LABELS[scenario]} scenario: Base ${o.baseText} ${o.delta} (${whose})`, { notes: o.note }))
  }
  hits[scenario] = { edits, a }
  scenarioCache.set(base, hits)
  return a
}

/** The scenario's assumptions from the current edits (Base edits plus preset edits). */
export const scenarioAssumptions = (property: Property, asOf: ISODate, edits: AssumptionEdits, scenario: Scenario) =>
  withScenario(assumptionsFor(property, asOf, edits), scenario, edits)

/** Overrides in words, for the chip tooltip and banner: "Exit cap rate 7.25% → 7.75% (+50 bps)". */
export function scenarioChanges(base: UnderwritingAssumptions, scenario: Scenario, edits: AssumptionEdits = {}): string[] {
  return scenarioOverrides(base, scenario, edits).map((o) => `${o.label} ${o.text} (${o.delta}${o.note ? `; ${o.note}` : ''})`)
}

// ---------- presets for display and editing ----------

export interface PresetItem {
  key: string
  label: string
  delta: Sourced<number>
  /** e.g. "−1.5 pts" */
  display: string
  edited: boolean
  /** What the change does to these assumptions, e.g. "3% → 1.5%"; absent when it changes nothing. */
  applied?: string
  note?: string
}

/** Every applicable lever's preset for a scenario, with what it does to the current assumptions. */
export function presetItems(base: UnderwritingAssumptions, scenario: StressScenario, edits: AssumptionEdits = {}): PresetItem[] {
  const overrides = new Map(scenarioOverrides(base, scenario, edits).map((o) => [o.key, o]))
  return applicableLevers(base).map((l) => {
    const delta = presetDelta(scenario, l, edits)
    const o = overrides.get(l.key)
    return {
      key: presetKey(scenario, l.key),
      label: l.label,
      delta,
      display: deltaText(l.kind, delta.value),
      edited: delta.sourceName === ANALYST_INPUT,
      ...(o ? { applied: o.text } : {}),
      ...(o?.note ? { note: o.note } : {}),
    }
  })
}

export interface PresetInput {
  edit: AssumptionEdit
  src: Sourced<unknown>
}

export interface PresetRow {
  label: string
  /** The assumption it moves now, e.g. "Market rent growth 3%". */
  current: string
  inputs: Record<StressScenario, PresetInput>
}

/** One row per lever with a Downside and an Upside input, for the Assumptions tab. */
export function presetRows(base: UnderwritingAssumptions, edits: AssumptionEdits = {}): PresetRow[] {
  const fields = fieldMap(base)
  return applicableLevers(base).map((l) => {
    const f = fields.get(l.key)!
    const input = (s: StressScenario): PresetInput => {
      const field = leverField(l, s, f.group)
      const delta = presetDelta(s, l, edits)
      return {
        src: delta,
        edit: {
          field,
          value: delta.value,
          defaultValue: l.preset[s],
          input: formatInput(field, delta.value),
          defaultText: `preset ${deltaText(l.kind, l.preset[s])}`,
          edited: delta.sourceName === ANALYST_INPUT,
        },
      }
    }
    return { label: l.label, current: `${f.label} ${f.format(fieldValue(base, l.key).value)}`, inputs: { downside: input('downside'), upside: input('upside') } }
  })
}

/** Labels of the preset edits, e.g. "Downside rent growth −1 pt (preset −1.5 pts)", for the set summary. */
export function presetChanges(base: UnderwritingAssumptions, edits: AssumptionEdits = {}): string[] {
  return STRESS_SCENARIOS.flatMap((s) =>
    applicableLevers(base).flatMap((l) => {
      const key = presetKey(s, l.key)
      if (!(key in edits)) return []
      return [`${SCENARIO_LABELS[s]} ${l.label.toLowerCase()} ${deltaText(l.kind, edits[key])} (preset ${deltaText(l.kind, l.preset[s])})`]
    }),
  )
}

// ---------- comparison ----------

export interface ComparisonCell {
  value: number | null
  display: string
  /** Change from Base; absent in the Base column. `short` drops the dollars from a dollar change ("−6.1%"), for narrow tables. */
  vsBase?: { value: number | null; display: string; short: string }
  tone?: 'better' | 'worse'
  /** Why the value is missing, e.g. a max bid outside the search range. */
  hint?: string
}

export interface ComparisonRow {
  key: string
  label: string
  kind: 'usd' | 'pct' | 'multiple'
  cells: Record<Scenario, ComparisonCell>
}

export interface ScenarioCase {
  scenario: Scenario
  label: string
  assumptions: UnderwritingAssumptions
  run: UnderwritingRun
  overrides: ScenarioOverride[]
}

export type ScenarioComparison =
  | {
      status: 'ok'
      /** The Base purchase price, used in every case. */
      price: { value: number; display: string }
      cases: Record<Scenario, ScenarioCase>
      rows: ComparisonRow[]
      presets: Record<StressScenario, PresetItem[]>
      notes: string[]
    }
  | { status: 'unavailable'; reason: string }

type Kind = 'usd' | 'pct' | 'multiple'

interface MetricDef {
  key: string
  label: string
  kind: Kind
  get: (r: UnderwritingResult, bid: MaxBid) => number | null
  missing?: (bid: MaxBid) => string | undefined
}

const valueText = (kind: Kind, x: number | null) =>
  x === null ? '—' : kind === 'usd' ? fmt.money(x) : kind === 'pct' ? fmt.pct(x, 2) : fmt.multiple(x)

const sign = (x: number) => (x > 0 ? '+' : '−')

/** "−$412,345 (−6.1%)" (short "−6.1%"), "−182 bps", "−0.15x"; "no change" when equal. */
function changeText(kind: Kind, x: number, base: number): { display: string; short: string } {
  const d = x - base
  const same = (display: string) => ({ display, short: display })
  if (Math.abs(d) < (kind === 'usd' ? 0.5 : 5e-7)) return same('no change')
  if (kind === 'pct') return same(`${sign(d)}${Math.abs(Math.round(d * 10_000))} bps`)
  if (kind === 'multiple') return same(`${sign(d)}${Math.abs(d).toFixed(2)}x`)
  const dollars = `${sign(d)}${fmt.money(Math.abs(d))}`
  if (!base) return same(dollars)
  const pct = `${sign(d)}${Math.abs((d / base) * 100).toFixed(1)}%`
  return { display: `${dollars} (${pct})`, short: pct }
}

function metricDefs(H: number, target: number): MetricDef[] {
  return [
    { key: 'year1NOI', label: 'Year-1 NOI', kind: 'usd', get: (r) => r.cashFlows[0].netOperatingIncome },
    { key: 'finalYearNOI', label: `Year-${H} NOI`, kind: 'usd', get: (r) => r.cashFlows[H - 1]?.netOperatingIncome ?? null },
    { key: 'exitValue', label: 'Exit value', kind: 'usd', get: (r) => r.metrics.exitValue },
    { key: 'unleveredIRR', label: 'Unlevered IRR', kind: 'pct', get: (r) => r.metrics.unleveredIRR },
    { key: 'leveredIRR', label: 'Levered IRR', kind: 'pct', get: (r) => r.metrics.leveredIRR },
    { key: 'equityMultiple', label: 'Levered multiple', kind: 'multiple', get: (r) => r.metrics.equityMultiple },
    { key: 'minimumDSCR', label: 'Minimum DSCR', kind: 'multiple', get: (r) => r.metrics.minimumDSCR },
    {
      key: 'maxBid',
      label: `Max bid at ${fmt.pctShort(target)} levered IRR`,
      kind: 'usd',
      get: (_r, bid) => (bid.status === 'ok' ? bid.price : null),
      missing: (bid) => (bid.status === 'none' ? bid.reason : undefined),
    },
  ]
}

const comparisonCache = new WeakMap<AssumptionEdits, { property: Property; asOf: ISODate; cmp: ScenarioComparison }>()

/**
 * Base, Downside and Upside side by side, at the Base price. Every case is a
 * full engine run (and a max bid solve); Base is the same run the rest of the
 * app shows.
 */
export function scenarioComparison(property: Property, asOf: ISODate, edits: AssumptionEdits = {}): ScenarioComparison {
  const hit = comparisonCache.get(edits)
  if (hit && hit.property === property && hit.asOf === asOf) return hit.cmp
  const cmp = compare(property, asOf, edits)
  comparisonCache.set(edits, { property, asOf, cmp })
  return cmp
}

function compare(property: Property, asOf: ISODate, edits: AssumptionEdits): ScenarioComparison {
  const baseRun = runUnderwriting(property, asOf, edits)
  if (baseRun.status === 'unavailable') return baseRun
  const base = baseRun.result.assumptions

  const cases = Object.fromEntries(
    SCENARIOS.map((s) => {
      const a = withScenario(base, s, edits)
      return [s, { scenario: s, label: SCENARIO_LABELS[s], assumptions: a, run: s === 'base' ? baseRun : runUnderwriting(property, asOf, a), overrides: scenarioOverrides(base, s, edits) }]
    }),
  ) as Record<Scenario, ScenarioCase>

  const bids = Object.fromEntries(SCENARIOS.map((s) => [s, cases[s].run.status === 'ok' ? maxBid(property, asOf, cases[s].assumptions) : null])) as Record<Scenario, MaxBid | null>
  const H = base.acquisition.holdYears.value
  const defs = metricDefs(H, base.targetLeveredIRR.value)
  const label = (d: MetricDef) => (d.key === 'maxBid' && bids.base ? maxBidStat(bids.base).label : d.label)

  const rows = defs.map((d): ComparisonRow => {
    const valueOf = (s: Scenario) => {
      const run = cases[s].run
      return run.status === 'ok' ? d.get(run.result, bids[s]!) : null
    }
    const baseValue = valueOf('base')
    const cells = Object.fromEntries(
      SCENARIOS.map((s): [Scenario, ComparisonCell] => {
        const run = cases[s].run
        const value = valueOf(s)
        const hint = run.status === 'unavailable' ? run.reason : value === null && bids[s] ? d.missing?.(bids[s]!) : undefined
        const cell: ComparisonCell = { value, display: valueText(d.kind, value), ...(hint ? { hint } : {}) }
        if (s === 'base') return [s, cell]
        const diff = value === null || baseValue === null ? null : value - baseValue
        const vsBase = { value: diff, ...(diff === null ? { display: '—', short: '—' } : changeText(d.kind, value!, baseValue!)) }
        const tone = diff === null || vsBase.display === 'no change' ? undefined : diff > 0 ? 'better' : 'worse'
        return [s, { ...cell, vsBase, ...(tone ? { tone } : {}) }]
      }),
    ) as Record<Scenario, ComparisonCell>
    return { key: d.key, label: label(d), kind: d.kind, cells }
  })

  const presets = { downside: presetItems(base, 'downside', edits), upside: presetItems(base, 'upside', edits) }
  const price = baseRun.result.metrics.purchasePrice
  const notes = [`Price held at Base: ${fmt.money(price)} in every case.`]
  const upsideExit = cases.upside.assumptions.exit.exitCapRate.value
  const goingIn = baseRun.result.metrics.goingInCapRate
  if (upsideExit < goingIn - 5e-7) {
    notes.push(`The Upside exit cap (${fmt.pct(upsideExit, 2)}) is below the ${fmt.pct(goingIn, 2)} going-in cap, so Upside assumes cap compression.`)
  }
  if ([...presets.downside, ...presets.upside].some((p) => !p.edited && p.delta.value !== 0)) {
    notes.push('Scenario presets are rule-of-thumb estimates (EST) until you edit them.')
  }
  return { status: 'ok', price: { value: price, display: fmt.money(price) }, cases, rows, presets, notes }
}
