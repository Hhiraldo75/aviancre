import { describe, expect, it } from 'vitest'
import type { UnderwritingAssumptions } from '../../types'
import { SAMPLE_PROPERTIES } from '../../data/sampleProperties'
import { withPurchasePrice } from './defaults'
import { assumptionsFor } from './edits'
import { maxBid, type MaxBid } from './maxBid'
import { runUnderwriting } from './summary'
import { underwrite } from './underwrite'

const AS_OF = '2026-10-04'
const RATE = 0.0001

const ATWELLS = SAMPLE_PROPERTIES.find((p) => p.id === 'sample-atwells-retail-row')
if (!ATWELLS) throw new Error('missing sample-atwells-retail-row')
const defaults = assumptionsFor(ATWELLS, AS_OF)

const ok = (bid: MaxBid) => {
  if (bid.status !== 'ok') throw new Error(bid.reason)
  return bid
}
const withTarget = (a: UnderwritingAssumptions, target: number): UnderwritingAssumptions => ({
  ...a,
  targetLeveredIRR: { ...a.targetLeveredIRR, value: target },
})
/** Levered IRR when the bid is entered as the purchase price. */
const irrAt = (a: UnderwritingAssumptions, price: number) => underwrite(ATWELLS, AS_OF, withPurchasePrice(a, price)).metrics.leveredIRR!

describe('max bid at target levered IRR', () => {
  it('defaults the target to 10%, labeled as a placeholder', () => {
    expect(defaults.targetLeveredIRR).toMatchObject({
      value: 0.1,
      source: 'estimated',
      sourceName: 'Placeholder – replace with investor return target',
    })
  })

  it('returns a price that gives the target IRR when plugged back in', () => {
    const bid = ok(maxBid(ATWELLS, AS_OF, defaults))
    expect(Math.abs(irrAt(defaults, bid.price) - 0.1)).toBeLessThanOrEqual(RATE)
    expect(Math.abs(bid.leveredIRR! - 0.1)).toBeLessThanOrEqual(RATE)
  })

  it('solves an edited target too', () => {
    const edited = assumptionsFor(ATWELLS, AS_OF, { targetLeveredIRR: 0.12 })
    const bid = ok(maxBid(ATWELLS, AS_OF, edited))
    expect(Math.abs(irrAt(edited, bid.price) - 0.12)).toBeLessThanOrEqual(RATE)
    expect(bid.price).toBeLessThan(ok(maxBid(ATWELLS, AS_OF, defaults)).price)
  })

  it('returns about the current price when the target is the current levered IRR', () => {
    const current = underwrite(ATWELLS, AS_OF, defaults).metrics
    const bid = ok(maxBid(ATWELLS, AS_OF, withTarget(defaults, current.leveredIRR!)))
    expect(Math.abs(bid.price - current.purchasePrice)).toBeLessThan(100)
    expect(Math.abs(bid.vsCurrentPct)).toBeLessThan(1e-4)
  })

  it('reports $/SF, going-in cap and % vs price from the engine run at the bid', () => {
    const bid = ok(maxBid(ATWELLS, AS_OF, defaults))
    const m = underwrite(ATWELLS, AS_OF, withPurchasePrice(defaults, bid.price)).metrics
    expect(bid.pricePerSF).toBeCloseTo(m.pricePerSF, 9)
    expect(bid.goingInCapRate).toBeCloseTo(m.goingInCapRate, 12)
    expect(bid.vsCurrentPct).toBeCloseTo(bid.price / defaults.acquisition.purchasePrice.value - 1, 12)
  })

  it('leaves the assumptions and the base run unchanged', () => {
    const before = underwrite(ATWELLS, AS_OF, defaults).metrics
    maxBid(ATWELLS, AS_OF, withTarget(defaults, 0.11))
    expect(defaults.acquisition.purchasePrice.source).toBe('estimated')
    expect(underwrite(ATWELLS, AS_OF, defaults).metrics).toEqual(before)
  })

  it('reports no solution when the target is out of range', () => {
    const tooHigh = maxBid(ATWELLS, AS_OF, withTarget(defaults, 5))
    expect(tooHigh).toMatchObject({ status: 'none', target: 5, reason: expect.stringMatching(/below 500\.0% even at .*25% of the current price/) })
    // Nearly unlevered, so the cash flows stay conventional even at 4× the price.
    const lightDebt = { ...defaults, debt: { ...defaults.debt, ltv: { ...defaults.debt.ltv, value: 0.01 } } }
    const tooLow = maxBid(ATWELLS, AS_OF, withTarget(lightDebt, -0.3))
    expect(tooLow).toMatchObject({ status: 'none', reason: expect.stringMatching(/still above \(30\.0%\) at .*4× the current price/) })
  })

  it('reports no solution without debt', () => {
    const noDebt = { ...defaults, debt: { ...defaults.debt, enabled: false } }
    expect(maxBid(ATWELLS, AS_OF, noDebt)).toMatchObject({ status: 'none', reason: expect.stringMatching(/Debt is off/) })
  })

  it('solves every sample property the engine can run', () => {
    for (const p of SAMPLE_PROPERTIES) {
      const run = runUnderwriting(p, AS_OF)
      if (run.status !== 'ok') continue
      const a = run.result.assumptions
      const bid = maxBid(p, AS_OF, a)
      if (bid.status === 'none') continue
      const irr = underwrite(p, AS_OF, withPurchasePrice(a, bid.price)).metrics.leveredIRR!
      expect(Math.abs(irr - a.targetLeveredIRR.value), p.id).toBeLessThanOrEqual(RATE)
    }
  })
})
