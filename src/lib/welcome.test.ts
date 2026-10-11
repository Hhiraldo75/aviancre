import { describe, expect, it } from 'vitest'
import { SAMPLE_PROPERTIES } from '../data/sampleProperties'
import { fmt } from './format'
import { maxBid } from './underwriting/maxBid'
import { runUnderwriting } from './underwriting/summary'
import { FEATURED_PROPERTY_ID, featuredDeal, shouldShowWelcome } from './welcome'

describe('shouldShowWelcome', () => {
  it('shows on a first visit with a plain link', () => {
    expect(shouldShowWelcome('', false)).toBe(true)
    expect(shouldShowWelcome('?', false)).toBe(true)
  })

  it('never shows once seen', () => {
    expect(shouldShowWelcome('', true)).toBe(false)
  })

  it('stays hidden when the link sets filters or a sort', () => {
    expect(shouldShowWelcome('?type=retail', false)).toBe(false)
    expect(shouldShowWelcome('?sf=10000-50000&occ=80-90', false)).toBe(false)
    expect(shouldShowWelcome('?sort=irr', false)).toBe(false)
  })

  it('ignores unknown or malformed parameters', () => {
    expect(shouldShowWelcome('?utm_source=x&type=castle&sf=abc', false)).toBe(true)
  })
})

describe('featuredDeal', () => {
  const AS_OF = '2026-10-04'
  const tower = SAMPLE_PROPERTIES.find((p) => p.id === FEATURED_PROPERTY_ID)!

  it('shows Westminster Office Tower with the engine’s price, levered IRR, min DSCR and max bid', () => {
    const deal = featuredDeal(tower, AS_OF)
    const run = runUnderwriting(tower, AS_OF)
    if (deal.status !== 'ok' || run.status !== 'ok') throw new Error('expected an underwriting run')
    const m = run.result.metrics
    const bid = maxBid(tower, AS_OF, run.result.assumptions)
    if (bid.status !== 'ok') throw new Error('expected a max bid')

    expect(deal.name).toBe('Westminster Office Tower')
    expect(deal.stats.map((s) => [s.label, s.value])).toEqual([
      ['Model price', fmt.money(m.purchasePrice)],
      ['Levered IRR', fmt.pct(m.leveredIRR!, 1)],
      ['Min DSCR', fmt.multiple(m.minimumDSCR!)],
      ['Max bid', fmt.money(bid.price)],
    ])
  })

  it('follows assumption edits', () => {
    const base = featuredDeal(tower, AS_OF)
    const edited = featuredDeal(tower, AS_OF, { 'acquisition.purchasePrice': 30_000_000 })
    if (base.status !== 'ok' || edited.status !== 'ok') throw new Error('expected underwriting runs')
    expect(edited.stats[0].value).toBe('$30.00M')
    expect(edited.stats[1].value).not.toBe(base.stats[1].value)
  })
})
