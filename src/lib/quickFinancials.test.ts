import { describe, expect, it } from 'vitest'
import { SAMPLE_PROPERTIES } from '../data/sampleProperties'
import type { Property } from '../types'
import { developmentCapacity, heightExceedanceNote } from './development'
import { estimate } from './sourced'
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
    expect(y1.noi).toBeCloseTo(41_900 * 7.25 * Math.pow(1.03, 7) * 0.97, 2)
  })
  it('makes the landlord carry opex on full-service and vacant space', () => {
    const y1 = yearOneNOI(byId('sample-westminster-tower'), AS_OF)
    expect(y1.landlordOpex).toBeCloseTo(355_900 * 10.5, 2)
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
    expect(plan.length).toBe(28)
    expect(plan[0].floor).toBe(28)
    expect(plan.reduce((s, f) => s + f.totalSF, 0)).toBeCloseTo(355_900, 4)
    expect(plan[plan.length - 1].segments[0].label).toBe('Cobblestone Community Bank')
  })
  it('returns null for buildings without floor data', () => {
    expect(stackingPlan(byId('sample-thayer-shops'), AS_OF)).toBe(null)
  })
})

describe('developmentCapacity', () => {
  /** A sample re-zoned and re-sized, to exercise the coverage envelope (no sample sits in a residential district). */
  const rezoned = (id: string, district: string, landSF: number, grossSF: number): Property => {
    const p = byId(id)
    return {
      ...p,
      zoning: { ...p.zoning, district: estimate(district, 'test') },
      physical: { ...p.physical, landAreaSF: estimate(landSF, 'test'), grossBuildingSF: estimate(grossSF, 'test') },
    }
  }

  it('gives no envelope where the ordinance sets no coverage, only the height limit', () => {
    const d = developmentCapacity(byId('sample-olneyville-distribution'))
    expect(d.existingFAR).toBeCloseTo(41_900 / 392_000, 6)
    expect(d.maxHeightFt).toBe(75)
    expect(d.limits?.section).toBe('Table 8-1')
    expect(d.envelope).toBe(null)
    expect(d.additionalEnvelopeSF).toBe(null)
  })
  it("uses the downtown height sub-district's limit for headroom", () => {
    const d = developmentCapacity(byId('sample-westminster-tower'))
    expect(d.maxHeightFt).toBe(300)
    expect(d.heightHeadroomFt).toBe(300 - d.heightFt)
    expect(d.envelope).toBe(null)
  })
  it('describes a building taller than the limit instead of showing negative headroom', () => {
    expect(heightExceedanceNote(-110)).toBe(
      'Exceeds current height limit by 110 ft — likely an older building that predates the ordinance (legally nonconforming)',
    )
    expect(heightExceedanceNote(25)).toBe(null)
    expect(heightExceedanceNote(0)).toBe(null)
    expect(heightExceedanceNote(null)).toBe(null)
  })
  it('estimates room left in a residential envelope: lot × coverage × floor(height ÷ 12)', () => {
    const d = developmentCapacity(rezoned('sample-federal-hill-apartments', 'R-4', 10_000, 12_000))
    expect(d.envelope?.stories).toBe(3)
    expect(d.envelope?.coverage).toBe(0.55)
    expect(d.envelope?.sf.value).toBe(10_000 * 0.55 * 3)
    expect(d.envelope?.sf.source).toBe('estimated')
    expect(d.additionalEnvelopeSF).toBe(16_500 - 12_000)
  })
  it('shows a negative envelope for buildings larger than it', () => {
    expect(developmentCapacity(rezoned('sample-federal-hill-apartments', 'R-3', 10_000, 20_000)).additionalEnvelopeSF).toBe(13_500 - 20_000)
  })
})
