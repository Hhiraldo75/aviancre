import type {
  ISODate,
  Property,
  SensitivityAxis,
  SensitivityGrid,
  SensitivityMetric,
  SensitivityVariable,
  UnderwritingAssumptions,
} from '../../types'
import { fmt } from '../format'
import { sameValue } from './edits'
import { runUnderwriting } from './summary'
import { operatingCashFlows } from './waterfall'

/**
 * Two-way sensitivity grids. Every cell is a full engine run on the current
 * assumptions (edits included) with only its row and column inputs changed.
 * The center cell passes the current assumptions object itself, so it is the
 * same run the rest of the view shows.
 */

export const EXIT_CAP_SHIFTS_BPS = [-50, -25, 0, 25, 50]
/** Percentage points; shifted growth is floored at 0%. */
export const RENT_GROWTH_SHIFTS = [-0.02, -0.01, 0, 0.01, 0.02]
export const PRICE_SHIFTS = [-0.1, -0.05, 0, 0.05, 0.1]

export const SENSITIVITY_CAPTION = 'Each cell re-runs the full model with only these two inputs changed.'

/** Levered IRR range across the rent-growth cases (at the current exit cap) above which a warning is shown. */
export const RENT_GROWTH_IRR_SWING = 0.05

type Variable = Extract<SensitivityVariable, 'exitCapRate' | 'marketRentGrowth' | 'purchasePrice'>
type Inputs = Partial<Record<Variable, number>>

const VARIABLES: Variable[] = ['exitCapRate', 'marketRentGrowth', 'purchasePrice']

export function currentValue(a: UnderwritingAssumptions, v: Variable): number {
  switch (v) {
    case 'exitCapRate':
      return a.exit.exitCapRate.value
    case 'marketRentGrowth':
      return a.leasing.marketRentGrowth.value
    case 'purchasePrice':
      return a.acquisition.purchasePrice.value
  }
}

/** The assumptions with only these inputs changed (Sourced labels kept); `a` itself when none differ. */
export function withInputs(a: UnderwritingAssumptions, inputs: Inputs): UnderwritingAssumptions {
  const changed = (v: Variable) => inputs[v] !== undefined && inputs[v] !== currentValue(a, v)
  if (!VARIABLES.some(changed)) return a
  const out = { ...a }
  if (changed('exitCapRate')) out.exit = { ...a.exit, exitCapRate: { ...a.exit.exitCapRate, value: inputs.exitCapRate! } }
  if (changed('marketRentGrowth')) {
    out.leasing = { ...a.leasing, marketRentGrowth: { ...a.leasing.marketRentGrowth, value: inputs.marketRentGrowth! } }
  }
  if (changed('purchasePrice')) {
    out.acquisition = { ...a.acquisition, purchasePrice: { ...a.acquisition.purchasePrice, value: inputs.purchasePrice! } }
  }
  return out
}

function exitCapAxis(a: UnderwritingAssumptions): SensitivityAxis[] {
  const base = a.exit.exitCapRate.value
  return EXIT_CAP_SHIFTS_BPS.map((bps) => ({ value: base + bps / 10_000, delta: bps / 10_000 }))
}

/**
 * Rent growth ± the shifts, floored at 0% (or at the current growth when that
 * is already negative, so the center never moves). Values the floor makes
 * equal are shown once.
 */
export function rentGrowthAxis(a: UnderwritingAssumptions): SensitivityAxis[] {
  const base = a.leasing.marketRentGrowth.value
  const floor = Math.min(0, base)
  const values = RENT_GROWTH_SHIFTS.map((d) => (d === 0 ? base : Math.max(floor, base + d)))
  return values
    .filter((v, i) => values.findIndex((x) => sameValue(x, v)) === i)
    .map((value) => ({ value, delta: value - base }))
}

function priceAxis(a: UnderwritingAssumptions): SensitivityAxis[] {
  const base = a.acquisition.purchasePrice.value
  return PRICE_SHIFTS.map((d) => ({ value: base * (1 + d), delta: d }))
}

function grid(
  property: Property,
  asOf: ISODate,
  a: UnderwritingAssumptions,
  [rowVariable, rows]: [Variable, SensitivityAxis[]],
  [columnVariable, columns]: [Variable, SensitivityAxis[]],
): SensitivityGrid {
  const cells = rows.map((r) =>
    columns.map((c) => {
      const run = runUnderwriting(property, asOf, withInputs(a, { [rowVariable]: r.value, [columnVariable]: c.value }))
      const m = run.status === 'ok' ? run.result.metrics : null
      return {
        center: r.delta === 0 && c.delta === 0,
        metrics: {
          leveredIRR: m?.leveredIRR ?? null,
          unleveredIRR: m?.unleveredIRR ?? null,
          equityMultiple: m?.equityMultiple ?? null,
        },
      }
    }),
  )
  return { rowVariable, columnVariable, rows, columns, cells }
}

export interface SensitivityGrids {
  /** Rows: exit cap; columns: market rent growth. */
  exitCapByRentGrowth: SensitivityGrid
  /** Rows: purchase price; columns: exit cap. */
  priceByExitCap: SensitivityGrid
  /** Plain-language warnings about the rent-growth cases. */
  warnings: string[]
}

/** Grids per assumptions object, so revisiting the tab or re-rendering doesn't re-run them. */
const gridCache = new WeakMap<UnderwritingAssumptions, { property: Property; asOf: ISODate; grids: SensitivityGrids }>()

/** Both grids for the current assumptions (one engine run per cell). */
export function sensitivityGrids(property: Property, asOf: ISODate, a: UnderwritingAssumptions): SensitivityGrids {
  const hit = gridCache.get(a)
  if (hit && hit.property === property && hit.asOf === asOf) return hit.grids
  const exitCap = exitCapAxis(a)
  const exitCapByRentGrowth = grid(property, asOf, a, ['exitCapRate', exitCap], ['marketRentGrowth', rentGrowthAxis(a)])
  const grids = {
    exitCapByRentGrowth,
    priceByExitCap: grid(property, asOf, a, ['purchasePrice', priceAxis(a)], ['exitCapRate', exitCap]),
    warnings: sensitivityWarnings(property, asOf, a, exitCapByRentGrowth),
  }
  gridCache.set(a, { property, asOf, grids })
  return grids
}

/** Years as "4", "4 and 6" or "4–10, 12". */
function yearList(years: number[]): string {
  const runs: [number, number][] = []
  for (const y of years) {
    const last = runs[runs.length - 1]
    if (last && y === last[1] + 1) last[1] = y
    else runs.push([y, y])
  }
  const parts = runs.map(([s, e]) => (s === e ? String(s) : `${s}–${e}`))
  return parts.length === 2 ? parts.join(' and ') : parts.join(', ')
}

/**
 * Warnings from the exit cap × rent growth grid: NOI falling during the hold
 * in a rent-growth case below expense growth, and a levered IRR range across
 * the rent-growth cases (current exit cap) wider than 5 points.
 */
export function sensitivityWarnings(property: Property, asOf: ISODate, a: UnderwritingAssumptions, g: SensitivityGrid): string[] {
  const out: string[] = []
  const H = a.acquisition.holdYears.value
  const expenseGrowth = a.operating.expenseGrowth.value
  const growthText = (x: number) => fmt.pct(x, 1)

  const falling = g.columns.flatMap(({ value }) => {
    if (value >= expenseGrowth) return []
    const noi = operatingCashFlows(property, withInputs(a, { marketRentGrowth: value }), asOf)
      .years.slice(0, H)
      .map((y) => y.netOperatingIncome)
    const down = noi.flatMap((x, i) => (i > 0 && x < noi[i - 1] ? [i + 1] : []))
    if (!down.length) return []
    const peak = noi.indexOf(Math.max(...noi))
    return [{ value, down, peak, noi }]
  })
  if (falling.length) {
    const worst = falling[0]
    const at = `At ${growthText(worst.value)}, NOI falls in year${worst.down.length > 1 ? 's' : ''} ${yearList(worst.down)}`
    const level = `Year-${H} NOI ${fmt.money(worst.noi[H - 1])} vs a peak of ${fmt.money(worst.noi[worst.peak])} in year ${worst.peak + 1}`
    out.push(
      `NOI falls during the hold at ${falling.map((c) => growthText(c.value)).join(', ')} rent growth (sensitivity case` +
        `${falling.length > 1 ? 's' : ''}): expenses grow ${growthText(expenseGrowth)}/yr, faster than rents. ${at}; ${level}.`,
    )
  }

  const center = g.rows.findIndex((r) => r.delta === 0)
  const irrs = (g.cells[center] ?? []).flatMap((c, j) => (c.metrics.leveredIRR === null ? [] : [{ irr: c.metrics.leveredIRR, growth: g.columns[j].value }]))
  if (irrs.length > 1) {
    const low = irrs.reduce((x, y) => (y.irr < x.irr ? y : x))
    const high = irrs.reduce((x, y) => (y.irr > x.irr ? y : x))
    const swing = high.irr - low.irr
    if (swing > RENT_GROWTH_IRR_SWING) {
      out.push(
        `Levered IRR swings ${Number((swing * 100).toFixed(1))} points across the rent-growth cases at the current exit cap, ` +
          `from ${fmt.pct(low.irr, 2)} at ${growthText(low.growth)} to ${fmt.pct(high.irr, 2)} at ${growthText(high.growth)} rent growth. ` +
          'Returns depend heavily on the rent growth assumption.',
      )
    }
  }
  return out
}

// ---- display ----

export const METRIC_LABELS: Record<SensitivityMetric, string> = {
  leveredIRR: 'Levered IRR',
  unleveredIRR: 'Unlevered IRR',
  equityMultiple: 'Levered equity multiple',
}

const VARIABLE_LABELS: Record<Variable, string> = {
  exitCapRate: 'Exit cap',
  marketRentGrowth: 'Rent growth',
  purchasePrice: 'Purchase price',
}

export interface SensitivityAxisLabel {
  value: string
  /** e.g. "−25 bps", "+1 pt", "−5%"; "Current" for the center. */
  delta: string
}

export interface SensitivityCellView {
  text: string
  center: boolean
  /** Compared with the center cell; absent when equal or not computable. */
  tone?: 'better' | 'worse'
  /** 0..1: distance from the center ÷ the largest distance in the grid. */
  intensity: number
  /** e.g. "Exit cap 7.00%, rent growth 1.5%: Levered IRR 9.12%" */
  title: string
}

export interface SensitivityView {
  rowTitle: string
  columnTitle: string
  rows: SensitivityAxisLabel[]
  columns: SensitivityAxisLabel[]
  cells: SensitivityCellView[][]
}

function axisLabel(v: Variable, x: SensitivityAxis): SensitivityAxisLabel {
  switch (v) {
    case 'exitCapRate':
      return { value: fmt.pct(x.value, 2), delta: deltaText(x.delta, `${Math.round(Math.abs(x.delta) * 10_000)} bps`) }
    case 'marketRentGrowth': {
      const pts = Number(Math.abs(x.delta * 100).toFixed(2))
      return { value: fmt.pct(x.value, 1), delta: deltaText(x.delta, `${pts} ${pts === 1 ? 'pt' : 'pts'}`) }
    }
    case 'purchasePrice':
      return { value: fmt.money(x.value), delta: deltaText(x.delta, `${Math.round(Math.abs(x.delta) * 100)}%`) }
  }
}

const deltaText = (delta: number, magnitude: string) =>
  Math.abs(delta) < 1e-12 ? 'Current' : `${delta > 0 ? '+' : '−'}${magnitude}`

const metricText = (metric: SensitivityMetric, x: number | null) =>
  x === null ? '—' : metric === 'equityMultiple' ? fmt.multiple(x) : fmt.pct(x, 2)

/** Display strings and shading for one metric of a grid. */
export function sensitivityView(g: SensitivityGrid, metric: SensitivityMetric): SensitivityView {
  const rowVar = g.rowVariable as Variable
  const colVar = g.columnVariable as Variable
  const rows = g.rows.map((r) => axisLabel(rowVar, r))
  const columns = g.columns.map((c) => axisLabel(colVar, c))
  const center = g.cells.flat().find((c) => c.center)?.metrics[metric] ?? null
  const diff = (x: number | null) => (x === null || center === null ? 0 : x - center)
  const maxDiff = Math.max(0, ...g.cells.flat().map((c) => Math.abs(diff(c.metrics[metric]))))

  return {
    rowTitle: VARIABLE_LABELS[rowVar],
    columnTitle: VARIABLE_LABELS[colVar],
    rows,
    columns,
    cells: g.cells.map((row, i) =>
      row.map((c, j) => {
        const x = c.metrics[metric]
        const d = diff(x)
        const text = metricText(metric, x)
        return {
          text,
          center: c.center,
          tone: d > 1e-12 ? 'better' : d < -1e-12 ? 'worse' : undefined,
          intensity: maxDiff > 0 ? Math.abs(d) / maxDiff : 0,
          title: `${VARIABLE_LABELS[rowVar]} ${rows[i].value}, ${VARIABLE_LABELS[colVar].toLowerCase()} ${columns[j].value}: ${METRIC_LABELS[metric]} ${text}`,
        }
      }),
    ),
  }
}
