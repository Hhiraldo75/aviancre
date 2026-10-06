import { describe, expect, it } from 'vitest'
import { SAMPLE_PROPERTIES } from '../data/sampleProperties'
import {
  averageInPlaceRent,
  currentRentPerSF,
  expiringWithin,
  markToMarket,
  occupancy,
  occupancyColor,
  walt,
  wholeYearsBetween,
} from './metrics'

const AS_OF = '2026-10-04'
const byId = (id: string) => {
  const p = SAMPLE_PROPERTIES.find((x) => x.id === id)
  if (!p) throw new Error(`missing ${id}`)
  return p
}
const firstLease = (id: string, tenant: string) => {
  const p = byId(id)
  if (p.rentRoll.kind !== 'commercial') throw new Error('not commercial')
  const l = p.rentRoll.leases.find((x) => x.tenantName === tenant)
  if (!l) throw new Error(`missing ${tenant}`)
  return l
}

describe('wholeYearsBetween', () => {
  it('counts only completed anniversaries', () => {
    expect(wholeYearsBetween('2019-01-01', '2019-12-31')).toBe(0)
    expect(wholeYearsBetween('2019-01-01', '2020-01-01')).toBe(1)
    expect(wholeYearsBetween('2019-01-01', AS_OF)).toBe(7)
  })
})

describe('currentRentPerSF', () => {
  it('compounds fixed-percent escalations', () => {
    // $7.25 × 1.03^7 = $8.9166
    const l = firstLease('sample-olneyville-distribution', 'Mill River Logistics')
    expect(currentRentPerSF(l, AS_OF)).toBeCloseTo(8.9166, 3)
  })
  it('adds fixed-amount escalations', () => {
    // $24.00 + 8 × $0.50 = $28.00
    const l = firstLease('sample-westminster-tower', 'Kestrel Analytics')
    expect(currentRentPerSF(l, AS_OF)).toBeCloseTo(28.0, 6)
  })
})

describe('occupancy', () => {
  it('uses active leases only', () => {
    const p = byId('sample-westminster-tower')
    expect(occupancy(p, AS_OF)).toBeCloseTo(276_400 / 355_900, 6)
    // The bank lease expires 2026-12-31, so it drops out on Jan 1.
    expect(occupancy(p, '2027-01-01')).toBeCloseTo(263_100 / 355_900, 6)
  })
  it('uses occupied units for multifamily', () => {
    expect(occupancy(byId('sample-federal-hill-apartments'), AS_OF)).toBeCloseTo(37 / 38, 6)
  })
})

describe('mark-to-market', () => {
  it('shows below-market industrial lease upside', () => {
    // market $9.50 vs in-place $8.9166
    expect(markToMarket(byId('sample-olneyville-distribution'), AS_OF)).toBeCloseTo(9.5 / 8.9166 - 1, 3)
  })
  it('works per unit for multifamily', () => {
    const p = byId('sample-federal-hill-apartments')
    const inPlace = (23 * 1525 + 14 * 1925) / 37
    expect(averageInPlaceRent(p, AS_OF)).toBeCloseTo(inPlace, 6)
    expect(markToMarket(p, AS_OF)).toBeCloseTo(1797 / inPlace - 1, 6)
  })
})

describe('lease rollover', () => {
  it('computes WALT for a single-tenant building', () => {
    expect(walt(byId('sample-olneyville-distribution'), AS_OF)).toBeCloseTo(2.24, 1)
  })
  it('finds leases expiring within a window, soonest first', () => {
    const names = expiringWithin(byId('sample-westminster-tower'), AS_OF, 6).map((l) => l.tenantName)
    expect(names).toEqual(['Cobblestone Community Bank', 'Kestrel Analytics'])
  })
})

describe('occupancyColor', () => {
  it('buckets by threshold', () => {
    expect(occupancyColor(0.5)).toBe('#ef4444')
    expect(occupancyColor(0.85)).toBe('#f59e0b')
    expect(occupancyColor(0.95)).toBe('#22c55e')
  })
})
