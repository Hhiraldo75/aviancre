import { describe, expect, it } from 'vitest'
import { SAMPLE_PROPERTIES } from '../../data/sampleProperties'
import { AI_LABEL_SAMPLE, analystExport } from './analystExport'
import { assumptionsFor, editableFields } from './edits'
import { maxBid } from './maxBid'
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
    expect(x.returns.leveredIRR.display).toBe('6.78%')
    expect(x.returns.leveredIRRVsTarget).toEqual({ value: -322, display: '−322 bps' })
    expect(x.returns.exit.goingInVsExitCapSpread).toEqual({ value: 25, display: '+25 bps' })
    expect(x.returns.exit.normalizationDifference.value).toBe(Math.round(m.exitNOI - m.exitNOIRaw))
    expect(x.debt.negativeLeverage).toBe(true)
    expect(x.debt.debtYieldFloor.display).toBe('9%')
    expect(x.debt.minimumDSCR.display).toBe('1.60x')
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
      expect(Number.parseFloat(g.low!.display)).toBeLessThanOrEqual(Number.parseFloat(g.center.display))
      expect(Number.parseFloat(g.high!.display)).toBeGreaterThanOrEqual(Number.parseFloat(g.center.display))
    }
    expect(x.sensitivity.grids[0].center).toMatchObject({ row: 'Exit cap 7.25% (Current)', column: 'Rent growth 2.0% (Current)' })
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
})
