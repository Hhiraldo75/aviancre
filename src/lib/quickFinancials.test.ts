import { describe, expect, it } from 'vitest'
import { SAMPLE_PROPERTIES } from '../data/sampleProperties'
import { developmentCapacity } from './development'
import { irr, quickFinancials, yearOneNOI } from './quickFinancials'
import { stackingPlan } from './stacking'

const AS_OF = '2026-10-04'
const byId = (id: string) => {
  const p = SAMPLE_PROPERTIES.find((x) => x.id === id)
  if (!p) throw new Error(`missing ${id}`)
  return p
}

describe('irr', () => {
  it('matches a hand-checked bond-like cash flow', () => {
    expect(irr([-100, 10, 10, 110])).toBeCloseTo(0.1, 6)
  })
  it('returns null when there is no sign change', () => {
    expect(irr([100, 10, 10])).toBe(null)
  })
})

describe('yearOneNOI', () => {
  it('passes all opex through on a fully leased NNN building', () => {
    // NOI = rent × (1 − 3% management); landlord opex is zero.
    const y1 = yearOneNOI(byId('sample-olneyville-distribution'), AS_OF)
    expect(y1.landlordOpex).toBe(0)
    expect(y1.noi).toBeCloseTo(145_000 * 7.25 * Math.pow(1.03, 7) * 0.97, 2)
  })
  it('makes the landlord carry opex on full-service and vacant space', () => {
    const y1 = yearOneNOI(byId('sample-westminster-tower'), AS_OF)
    expect(y1.landlordOpex).toBeCloseTo(320_000 * 10.5, 2)
  })
})

describe('quickFinancials', () => {
  it('values the property at NOI ÷ market cap rate', () => {
    const p = byId('sample-capital-center-plaza')
    const q = quickFinancials(p, AS_OF)
    expect(q.impliedValue).toBeCloseTo(q.noi / p.market.marketCapRate.value, 2)
    expect(q.goingInCapRate).toBeCloseTo(p.market.marketCapRate.value, 9)
  })
  it('earns a higher IRR when bought below implied value', () => {
    const p = byId('sample-olneyville-distribution')
    const atMarket = quickFinancials(p, AS_OF, 'implied-value').unleveredIRR ?? 0
    const atAssessed = quickFinancials(p, AS_OF, 'assessed-value').unleveredIRR ?? 0
    expect(atAssessed > atMarket).toBe(true)
  })
})

describe('stackingPlan', () => {
  it('accounts for every rentable SF and lists floors top-down', () => {
    const plan = stackingPlan(byId('sample-westminster-tower'), AS_OF)
    if (!plan) throw new Error('no plan')
    expect(plan.length).toBe(20)
    expect(plan[0].floor).toBe(20)
    expect(plan.reduce((s, f) => s + f.totalSF, 0)).toBeCloseTo(320_000, 4)
    expect(plan[plan.length - 1].segments[0].label).toBe('Cobblestone Community Bank')
  })
  it('returns null for buildings without floor data', () => {
    expect(stackingPlan(byId('sample-thayer-shops'), AS_OF)).toBe(null)
  })
})

describe('developmentCapacity', () => {
  it('computes unused FAR for an underbuilt industrial site', () => {
    const d = developmentCapacity(byId('sample-olneyville-distribution'))
    expect(d.existingFAR).toBeCloseTo(145_000 / 392_000, 6)
    expect(d.additionalBuildableSF).toBeCloseTo(392_000 * 2 - 145_000, 6)
  })
  it('flags buildings that exceed current zoning as negative capacity', () => {
    expect((developmentCapacity(byId('sample-westminster-tower')).additionalBuildableSF ?? 0) < 0).toBe(true)
  })
})
