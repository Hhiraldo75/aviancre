import { describe, expect, it } from 'vitest'
import type { SensitivityGrid, SensitivityMetric } from '../../types'
import { SAMPLE_PROPERTIES } from '../../data/sampleProperties'
import { assumptionsFor, type AssumptionEdits } from './edits'
import { rentGrowthAxis, sensitivityGrids, sensitivityView, withInputs } from './sensitivity'
import { runUnderwriting } from './summary'
import { underwrite } from './underwrite'

const AS_OF = '2026-10-04'
const METRICS: SensitivityMetric[] = ['leveredIRR', 'unleveredIRR', 'equityMultiple']
const byId = (id: string) => {
  const p = SAMPLE_PROPERTIES.find((x) => x.id === id)
  if (!p) throw new Error(`missing ${id}`)
  return p
}
const ATWELLS = byId('sample-atwells-retail-row')

/** Every sample property the engine can run, at defaults. */
const RUNNABLE = SAMPLE_PROPERTIES.filter((p) => runUnderwriting(p, AS_OF).status === 'ok')

function baseRun(p = ATWELLS, edits: AssumptionEdits = {}) {
  const run = runUnderwriting(p, AS_OF, edits)
  if (run.status !== 'ok') throw new Error(run.reason)
  return run.result
}

const metric = (g: SensitivityGrid, i: number, j: number, m: SensitivityMetric) => {
  const x = g.cells[i][j].metrics[m]
  if (x === null) throw new Error(`null ${m} at ${i},${j}`)
  return x
}
const centerOf = (g: SensitivityGrid) => {
  const at = g.cells.flatMap((row, i) => row.flatMap((c, j) => (c.center ? [[i, j]] : [])))
  expect(at).toHaveLength(1)
  return at[0]
}

describe('sensitivity grids', () => {
  it('runs every sample property', () => {
    expect(RUNNABLE.length).toBeGreaterThanOrEqual(8)
  })

  const EDIT_CASES: AssumptionEdits[] = [{}, { 'exit.exitCapRate': 0.0775, 'leasing.marketRentGrowth': 0.025, 'debt.ltv': 0.55 }]
  for (const edits of EDIT_CASES) {
    it(`center cells equal the base results exactly (${Object.keys(edits).length ? 'with edits' : 'defaults'})`, () => {
      for (const p of RUNNABLE) {
        const r = baseRun(p, edits)
        const grids = sensitivityGrids(p, AS_OF, r.assumptions)
        for (const g of [grids.exitCapByRentGrowth, grids.priceByExitCap]) {
          const [i, j] = centerOf(g)
          expect(g.rows[i].value).toBe(
            g.rowVariable === 'exitCapRate' ? r.assumptions.exit.exitCapRate.value : r.assumptions.acquisition.purchasePrice.value,
          )
          expect(g.cells[i][j].metrics.leveredIRR, p.id).toBe(r.metrics.leveredIRR)
          expect(g.cells[i][j].metrics.unleveredIRR, p.id).toBe(r.metrics.unleveredIRR)
          expect(g.cells[i][j].metrics.equityMultiple, p.id).toBe(r.metrics.equityMultiple)
        }
      }
    })
  }

  it('is 5 × 5 at defaults with the center in the middle', () => {
    for (const p of RUNNABLE) {
      const grids = sensitivityGrids(p, AS_OF, baseRun(p).assumptions)
      for (const g of [grids.exitCapByRentGrowth, grids.priceByExitCap]) {
        expect(g.cells.map((row) => row.length)).toEqual([5, 5, 5, 5, 5])
        expect(centerOf(g)).toEqual([2, 2])
      }
    }
  })

  it('higher exit cap lowers every metric; higher rent growth and lower price raise it', () => {
    for (const p of RUNNABLE) {
      const { exitCapByRentGrowth: g1, priceByExitCap: g2 } = sensitivityGrids(p, AS_OF, baseRun(p).assumptions)
      for (const m of METRICS) {
        for (let i = 0; i < 5; i++) {
          for (let j = 1; j < 5; j++) {
            // Grid 1: rows are exit cap, columns rent growth.
            expect(metric(g1, j, i, m), `${p.id} ${m} exit cap col ${i}`).toBeLessThan(metric(g1, j - 1, i, m))
            expect(metric(g1, i, j, m), `${p.id} ${m} rent growth row ${i}`).toBeGreaterThan(metric(g1, i, j - 1, m))
            // Grid 2: rows are price, columns exit cap.
            expect(metric(g2, i, j, m), `${p.id} ${m} exit cap row ${i}`).toBeLessThan(metric(g2, i, j - 1, m))
            expect(metric(g2, j, i, m), `${p.id} ${m} price col ${i}`).toBeLessThan(metric(g2, j - 1, i, m))
          }
        }
      }
    }
  })

  it('each cell is a full engine run with only its two inputs changed', () => {
    const r = baseRun(ATWELLS, { 'debt.ltv': 0.55 })
    const g = sensitivityGrids(ATWELLS, AS_OF, r.assumptions).exitCapByRentGrowth
    for (const [i, j] of [
      [0, 4],
      [3, 1],
    ]) {
      const fresh = underwrite(
        ATWELLS,
        AS_OF,
        assumptionsFor(ATWELLS, AS_OF, {
          'debt.ltv': 0.55,
          'exit.exitCapRate': g.rows[i].value,
          'leasing.marketRentGrowth': g.columns[j].value,
        }),
      )
      expect(g.cells[i][j].metrics.leveredIRR).toBe(fresh.metrics.leveredIRR)
      expect(g.cells[i][j].metrics.equityMultiple).toBe(fresh.metrics.equityMultiple)
    }
  })

  it('changes only the requested inputs and leaves the current assumptions untouched', () => {
    const a = baseRun().assumptions
    const before = structuredClone(a)
    expect(withInputs(a, { exitCapRate: a.exit.exitCapRate.value })).toBe(a)
    const b = withInputs(a, { exitCapRate: 0.08, purchasePrice: 3_000_000 })
    expect(b.exit.exitCapRate).toEqual({ ...a.exit.exitCapRate, value: 0.08 })
    expect(b.acquisition.purchasePrice.value).toBe(3_000_000)
    expect(b.leasing).toBe(a.leasing)
    expect(b.debt).toBe(a.debt)
    expect(a).toEqual(before)
  })

  it('reuses the grids for the same assumptions object', () => {
    const a = baseRun().assumptions
    expect(sensitivityGrids(ATWELLS, AS_OF, a)).toBe(sensitivityGrids(ATWELLS, AS_OF, a))
  })
})

describe('rent growth axis', () => {
  const growth = (g: number) => rentGrowthAxis(assumptionsFor(ATWELLS, AS_OF, { 'leasing.marketRentGrowth': g }))

  it('is current ± 1 and 2 points', () => {
    expect(growth(0.03).map((x) => x.value)).toEqual([0.03 - 0.02, 0.03 - 0.01, 0.03, 0.03 + 0.01, 0.03 + 0.02])
  })
  it('floors at 0% and shows a floored value once', () => {
    const axis = growth(0.005)
    expect(axis.map((x) => x.value)).toEqual([0, 0.005, 0.005 + 0.01, 0.005 + 0.02])
    expect(axis.map((x) => x.delta)).toEqual([-0.005, 0, expect.closeTo(0.01, 12), expect.closeTo(0.02, 12)])
  })
  it('never moves a negative current growth, and its center stays exact', () => {
    const axis = growth(-0.01)
    expect(axis.map((x) => x.value)).toEqual([-0.01, -0.01 + 0.01, -0.01 + 0.02])
    const r = baseRun(ATWELLS, { 'leasing.marketRentGrowth': -0.01 })
    const g = sensitivityGrids(ATWELLS, AS_OF, r.assumptions).exitCapByRentGrowth
    const [i, j] = centerOf(g)
    expect([i, j]).toEqual([2, 0])
    expect(g.cells[i][j].metrics.leveredIRR).toBe(r.metrics.leveredIRR)
  })
})

describe('sensitivity view', () => {
  const r = baseRun()
  const grids = sensitivityGrids(ATWELLS, AS_OF, r.assumptions)

  it('labels the axes with values and changes', () => {
    const v = sensitivityView(grids.exitCapByRentGrowth, 'leveredIRR')
    expect(v.rowTitle).toBe('Exit cap')
    expect(v.columnTitle).toBe('Rent growth')
    expect(v.rows.map((x) => x.delta)).toEqual(['−50 bps', '−25 bps', 'Current', '+25 bps', '+50 bps'])
    expect(v.columns.map((x) => x.value)).toEqual(['0.0%', '1.0%', '2.0%', '3.0%', '4.0%'])
    expect(v.columns.map((x) => x.delta)).toEqual(['−2 pts', '−1 pt', 'Current', '+1 pt', '+2 pts'])
    const p = sensitivityView(grids.priceByExitCap, 'equityMultiple')
    expect(p.rows.map((x) => x.delta)).toEqual(['−10%', '−5%', 'Current', '+5%', '+10%'])
  })

  it('shows the center as the headline figure and shades the rest against it', () => {
    const v = sensitivityView(grids.exitCapByRentGrowth, 'leveredIRR')
    const center = v.cells[2][2]
    expect(center.center).toBe(true)
    expect(center.text).toBe(`${(r.metrics.leveredIRR! * 100).toFixed(2)}%`)
    expect(center.tone).toBeUndefined()
    // Lower exit cap and higher growth are better; the far corners are the extremes.
    expect(v.cells[0][4]).toMatchObject({ tone: 'better' })
    expect(v.cells[4][0]).toMatchObject({ tone: 'worse' })
    const intensities = v.cells.flat().map((c) => c.intensity)
    expect(Math.max(...intensities)).toBe(1)
    expect(Math.min(...intensities)).toBe(0)
  })

  it('formats the equity multiple', () => {
    const v = sensitivityView(grids.priceByExitCap, 'equityMultiple')
    expect(v.cells[2][2].text).toBe(`${r.metrics.equityMultiple.toFixed(2)}x`)
  })

  it('shows a dash when levered IRR has no debt to lever', () => {
    const noDebt = baseRun(ATWELLS, { 'debt.ltv': 0 })
    const v = sensitivityView(sensitivityGrids(ATWELLS, AS_OF, noDebt.assumptions).exitCapByRentGrowth, 'leveredIRR')
    expect(v.cells.flat().every((c) => c.text === '—' && !c.tone)).toBe(true)
  })
})
