import { describe, expect, it } from 'vitest'
import { SAMPLE_PROPERTIES } from '../../data/sampleProperties'
import { AI_LABEL_SAMPLE, analystExport } from './analystExport'
import { assumptionsFor, editableFields } from './edits'
import { maxBid } from './maxBid'
import { withScenario } from './scenarios'
import { runUnderwriting } from './summary'
import { underwrite } from './underwrite'

const AS_OF = '2026-10-04'
const byId = (id: string) => {
  const p = SAMPLE_PROPERTIES.find((x) => x.id === id)
  if (!p) throw new Error(`missing ${id}`)
  return p
}
const ATWELLS = byId('sample-atwells-retail-row')
const FEDERAL_HILL = byId('sample-federal-hill-apartments')

const r = underwrite(ATWELLS, AS_OF)
const x = analystExport(ATWELLS, AS_OF, r)
/** "6.78%" → 6.78, "(0.95%)" → −0.95 */
const pctValue = (display: string) => (display.startsWith('(') ? -1 : 1) * Number.parseFloat(display.replace(/[()]/g, ''))

describe('analyst JSON export (Atwells)', () => {
  it('carries the AI label and run dates', () => {
    expect(x.meta).toMatchObject({ label: AI_LABEL_SAMPLE, asOf: AS_OF, analysisStart: '2026-11-01', holdYears: 10, isSample: true })
  })

  it('holds only finite numbers, so the JSON round-trips unchanged', () => {
    const walk = (node: unknown, path: string): void => {
      if (typeof node === 'number') expect(Number.isFinite(node), path).toBe(true)
      else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`)
    }
    walk(x, 'export')
    expect(JSON.parse(JSON.stringify(x))).toEqual(x)
    expect(JSON.stringify(x)).not.toMatch(/NaN|Infinity|undefined/)
  })

  it('lists every editable assumption with its source label', () => {
    expect(x.assumptions.items.map((a) => a.key)).toEqual(editableFields(r.assumptions).map((f) => f.key))
    for (const a of x.assumptions.items) expect(a.sourceName, a.key).toBeTruthy()
    expect(x.assumptions.items.find((a) => a.key === 'targetLeveredIRR')).toMatchObject({
      display: '10%',
      isEstimate: true,
      sourceName: 'Placeholder – replace with investor return target',
    })
    expect(x.assumptions.estimated).toContain('Exit cap rate')
    expect(x.assumptions.edited).toEqual([])
  })

  it('has Year 0, every hold year and both Year-11 columns', () => {
    expect(x.cashFlows.columns).toHaveLength(r.cashFlows.length + 3)
    for (const row of x.cashFlows.rows) expect(row.values, row.label).toHaveLength(r.cashFlows.length + 3)
    const noi = x.cashFlows.rows.find((row) => row.label === 'Net operating income')!
    expect(noi.values[1]).toBe(Math.round(r.cashFlows[0].netOperatingIncome))
  })

  it('pre-computes the figures the review checklist needs', () => {
    const m = r.metrics
    expect(x.returns.leveredIRR.display).toBe('7.36%')
    expect(x.returns.leveredIRRVsTarget).toEqual({ value: -264, display: '−264 bps' })
    expect(x.returns.exit.goingInVsExitCapSpread).toEqual({ value: 25, display: '+25 bps' })
    expect(x.returns.exit.normalizationDifference.value).toBe(Math.round(m.exitNOI - m.exitNOIRaw))
    expect(x.debt.negativeLeverage).toBe(true)
    expect(x.debt.debtYieldFloor.display).toBe('9%')
    expect(x.debt.minimumDSCR.display).toBe('1.67x')
    expect(x.debt.minimumDSCRYear).toBe(4)
    const rr = x.rentRoll
    if (rr.kind !== 'commercial') throw new Error('expected commercial')
    expect(rr.largestRollover).toMatchObject({ year: 2, yearsAboveThreshold: [2] })
    expect(rr.largestRollover.shareOfBuilding.display).toBe('36.1%')
    expect(rr.aboveMarketRenewalOptions).toEqual([
      expect.objectContaining({ tenant: 'Casa Lucenti Trattoria', optionRent: '$30.00/SF', projectedMarketRent: '$23.35/SF' }),
    ])
    expect(x.warnings).toEqual(r.warnings)
  })

  it('exports both levered IRR grids, centered on the headline result', () => {
    expect(x.sensitivity.grids.map((g) => g.title)).toEqual(['Exit cap × rent growth', 'Purchase price × exit cap'])
    for (const g of x.sensitivity.grids) {
      expect(g.metric).toBe('Levered IRR')
      expect(g.center.display).toBe(x.returns.leveredIRR.display)
      expect(g.cells).toHaveLength(g.rows.length)
      expect(pctValue(g.low!.display)).toBeLessThanOrEqual(pctValue(g.center.display))
      expect(pctValue(g.high!.display)).toBeGreaterThanOrEqual(pctValue(g.center.display))
    }
    expect(x.sensitivity.grids[0].center).toMatchObject({ row: 'Exit cap 7.70% (Current)', column: 'Rent growth 2.0% (Current)' })
  })

  it('includes the max bid from the solver', () => {
    const bid = maxBid(ATWELLS, AS_OF, r.assumptions)
    if (bid.status !== 'ok') throw new Error(bid.reason)
    expect(x.maxBid).toMatchObject({
      label: 'Max bid at 10% levered IRR',
      status: 'ok',
      price: { value: Math.round(bid.price) },
      leveredIRR: { display: '10.00%' },
    })
  })

  it('reflects analyst edits', () => {
    const edited = assumptionsFor(ATWELLS, AS_OF, { targetLeveredIRR: 0.12 })
    const e = analystExport(ATWELLS, AS_OF, underwrite(ATWELLS, AS_OF, edited))
    expect(e.maxBid.label).toBe('Max bid at 12% levered IRR')
    expect(e.assumptions.edited).toEqual(['Target levered IRR 12% (default 10%)'])
  })

  it('exports a multifamily property with its unit mix', () => {
    const run = runUnderwriting(FEDERAL_HILL, AS_OF)
    if (run.status !== 'ok') throw new Error(run.reason)
    const mf = analystExport(FEDERAL_HILL, AS_OF, run.result)
    expect(mf.rentRoll.kind).toBe('multifamily')
    if (mf.rentRoll.kind === 'multifamily') expect(mf.rentRoll.unitMix.length).toBeGreaterThan(0)
    expect(JSON.stringify(mf)).not.toMatch(/NaN|Infinity/)
  })

  it('compares Base, Downside and Upside at the Base price', () => {
    const sc = x.scenarios
    if (sc.status !== 'ok') throw new Error(sc.reason)
    expect(sc).toMatchObject({ viewed: 'base', columns: ['Base', 'Downside', 'Upside'], purchasePrice: x.returns.purchasePrice })
    const irr = sc.rows.find((row) => row.key === 'leveredIRR')!
    expect(irr.base.display).toBe(x.returns.leveredIRR.display)
    expect(irr.downside.vsBase?.display).toMatch(/^−\d+ bps$/)
    const noi = sc.rows.find((row) => row.key === 'year1NOI')!
    expect(noi.base.value).toBe(x.returns.year1NOI.value)
    expect(sc.presets.downside.find((p) => p.label === 'Exit cap')).toMatchObject({
      change: '+50 bps',
      isEstimate: true,
      applied: '7.70% → 8.20%',
    })
  })

  it('exports a Downside run of a set, with the set’s changes measured on Base', () => {
    const edits = { 'exit.exitCapRate': 0.075 }
    const down = withScenario(assumptionsFor(ATWELLS, AS_OF, edits), 'downside', edits)
    const e = analystExport(ATWELLS, AS_OF, underwrite(ATWELLS, AS_OF, down), { name: 'My case', edits })
    expect(e.meta.scenario).toBe('downside')
    expect(e.meta.assumptionSet.changes).toEqual(['Exit cap rate 7.50% (default 7.70%)'])
    expect(e.returns.exit.exitCapRate.display).toBe('8.00%')
    if (e.scenarios.status !== 'ok') throw new Error(e.scenarios.reason)
    expect(e.scenarios.viewed).toBe('downside')
    const irr = e.scenarios.rows.find((row) => row.key === 'leveredIRR')!
    expect(irr.downside.display).toBe(e.returns.leveredIRR.display)
  })
})
