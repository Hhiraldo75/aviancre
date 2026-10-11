import { describe, expect, it } from 'vitest'
import type { Property } from '../types'
import { SAMPLE_PROPERTIES } from '../data/sampleProperties'
import {
  activeFilterChips,
  EMPTY_FILTERS,
  filterProperties,
  filtersFromQuery,
  filtersToQuery,
  hasActiveFilters,
  OCCUPANCY_PRESETS,
  pctFromInput,
  pctToInput,
  propertyView,
  sortProperties,
  underwritingFacts,
  underwritingFactsById,
  underwritingNeeds,
  withoutFilter,
  type FactsById,
  type PropertyFilters,
} from './filters'
import { addYears, expiringShare, occupancy, occupancyColor } from './metrics'
import { assumptionsFor } from './underwriting/edits'
import { maxBid } from './underwriting/maxBid'
import { runUnderwriting } from './underwriting/summary'

const AS_OF = '2026-10-04'
const ALL = SAMPLE_PROPERTIES
const byId = (id: string) => {
  const p = ALL.find((x) => x.id === id)
  if (!p) throw new Error(`missing ${id}`)
  return p
}
const ATWELLS = byId('sample-atwells-retail-row')
const INNOVATION = byId('sample-innovation-lab')

const filters = (patch: Partial<PropertyFilters>): PropertyFilters => ({ ...EMPTY_FILTERS, ...patch })
const ids = (f: PropertyFilters, facts: FactsById = {}, properties: Property[] = ALL) =>
  filterProperties(properties, f, AS_OF, facts)
    .map((p) => p.id.replace('sample-', ''))
    .sort()

/** Hand-built engine facts, so the filter logic is tested apart from the engine. */
const FACTS: FactsById = {
  'sample-westminster-tower': { leveredIRR: 0.067, maxBidBelowPrice: true },
  'sample-weybosset-commons': { leveredIRR: null, maxBidBelowPrice: null },
  'sample-thayer-shops': { leveredIRR: 0.1, maxBidBelowPrice: false },
  'sample-allens-ave-flex': { leveredIRR: 0.135, maxBidBelowPrice: false },
  'sample-jewelry-lofts': { leveredIRR: 0.098, maxBidBelowPrice: true },
}

describe('filterProperties: each filter alone', () => {
  it('returns every property with no filters set', () => {
    expect(ids(EMPTY_FILTERS)).toHaveLength(11)
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false)
  })

  it('filters by asset type (any of the chosen types)', () => {
    expect(ids(filters({ assetTypes: ['office'] }))).toEqual([
      'capital-center-plaza',
      'innovation-lab',
      'westminster-tower',
      'weybosset-commons',
    ])
    expect(ids(filters({ assetTypes: ['retail', 'industrial'] }))).toEqual([
      'allens-ave-flex',
      'atwells-retail-row',
      'olneyville-distribution',
      'thayer-shops',
    ])
  })

  it('filters by submarket (any of the chosen submarkets)', () => {
    expect(ids(filters({ submarkets: ['federal-hill'] }))).toEqual(['atwells-retail-row', 'federal-hill-apartments'])
    expect(ids(filters({ submarkets: ['federal-hill', 'jewelry-district'] }))).toHaveLength(4)
    expect(ids(filters({ submarkets: ['valley'] }))).toEqual([])
  })

  it('filters by rentable SF range', () => {
    expect(ids(filters({ minSF: 30_000, maxSF: 52_400 }))).toEqual([
      'allens-ave-flex',
      'innovation-lab',
      'jewelry-lofts',
      'olneyville-distribution',
    ])
    expect(ids(filters({ minSF: 200_000 }))).toEqual(['westminster-tower', 'weybosset-commons'])
    expect(ids(filters({ maxSF: 15_000 }))).toEqual(['atwells-retail-row', 'thayer-shops'])
  })

  it('splits the portfolio into the three occupancy presets, matching the map colors', () => {
    const groups = OCCUPANCY_PRESETS.map((o) => filterProperties(ALL, filters({ minOccupancy: o.min, maxOccupancy: o.max }), AS_OF, {}))
    expect(groups.map((g) => g.length)).toEqual([3, 4, 4])
    expect(groups.flat()).toHaveLength(11)
    groups.forEach((g) => expect(new Set(g.map((p) => occupancyColor(occupancy(p, AS_OF)))).size).toBe(1))
  })

  it('filters by share of SF expiring within N years', () => {
    expect(ids(filters({ expiring: { years: 2, minShare: 0.5 } }))).toEqual(['allens-ave-flex', 'weybosset-commons'])
    expect(ids(filters({ expiring: { years: 3, minShare: 0.5 } }))).toEqual([
      'allens-ave-flex',
      'atwells-retail-row',
      'olneyville-distribution',
      'weybosset-commons',
    ])
    // Setting only the window, with no threshold, filters nothing.
    expect(ids(filters({ expiring: { years: 5, minShare: null } }))).toHaveLength(11)
  })

  it('filters by levered IRR at or above the threshold', () => {
    expect(ids(filters({ minLeveredIRR: 0.1 }), FACTS)).toEqual(['allens-ave-flex', 'thayer-shops'])
  })

  it('filters to properties whose max bid is below the current price', () => {
    expect(ids(filters({ maxBidBelowPrice: true }), FACTS)).toEqual(['jewelry-lofts', 'westminster-tower'])
  })
})

describe('filterProperties: bounds and edge cases', () => {
  it('includes a property sitting exactly on either end of the size range', () => {
    expect(ids(filters({ minSF: 52_400 }))).toContain('innovation-lab')
    expect(ids(filters({ maxSF: 52_400 }))).toContain('innovation-lab')
    expect(ids(filters({ minSF: 52_400, maxSF: 52_400 }))).toEqual(['innovation-lab'])
    expect(ids(filters({ minSF: 52_401 }))).not.toContain('innovation-lab')
  })

  it('includes occupancy at the minimum and excludes it at the maximum', () => {
    const occ = occupancy(ATWELLS, AS_OF)
    expect(occ).toBe(0.75)
    expect(ids(filters({ minOccupancy: occ }))).toContain('atwells-retail-row')
    expect(ids(filters({ maxOccupancy: occ }))).not.toContain('atwells-retail-row')
    expect(ids(filters({ minOccupancy: occ, maxOccupancy: occ }))).toEqual([])
  })

  it('keeps 100%-leased buildings in 90%+ and treats a 100% max as no cap', () => {
    expect(occupancy(byId('sample-olneyville-distribution'), AS_OF)).toBe(1)
    expect(ids(filters({ minOccupancy: 0.9 }))).toContain('olneyville-distribution')
    expect(ids(filters({ minOccupancy: 0.9, maxOccupancy: 1 }))).toContain('olneyville-distribution')
  })

  it('includes a property whose expiring share equals the threshold', () => {
    const share = expiringShare(ATWELLS, AS_OF, 2)!
    expect(ids(filters({ expiring: { years: 2, minShare: share } }))).toContain('atwells-retail-row')
    expect(ids(filters({ expiring: { years: 2, minShare: share + 1e-9 } }))).not.toContain('atwells-retail-row')
  })

  it('counts a lease expiring exactly N years out, but not a day later', () => {
    if (ATWELLS.rentRoll.kind !== 'commercial') throw new Error('not commercial')
    const lease = ATWELLS.rentRoll.leases.find((l) => l.commencementDate <= AS_OF && l.expirationDate >= AS_OF)!
    const withExpiry = (expirationDate: string): Property => ({
      ...ATWELLS,
      rentRoll: { ...ATWELLS.rentRoll, kind: 'commercial', leases: [{ ...lease, expirationDate }], vacancies: [] },
    })
    const share = lease.leasedSF / ATWELLS.physical.rentableSF.value
    // 2026-10-04 → 2028-10-04 spans Feb 29, 2028; the cutoff is a calendar date, not 2 × 365.25 days.
    expect(addYears(AS_OF, 2)).toBe('2028-10-04')
    expect(expiringShare(withExpiry('2028-10-04'), AS_OF, 2)).toBe(share)
    expect(expiringShare(withExpiry('2028-10-05'), AS_OF, 2)).toBe(0)
  })

  it('handles Feb 29 when adding years', () => {
    expect(addYears('2028-02-29', 1)).toBe('2029-02-28')
    expect(addYears('2028-02-29', 4)).toBe('2032-02-29')
  })

  it('leaves multifamily out of the expiration filter (no lease schedule)', () => {
    const commercial = ALL.filter((p) => p.rentRoll.kind === 'commercial').length
    const result = ids(filters({ expiring: { years: 1, minShare: 0 } }))
    expect(result).toHaveLength(commercial)
    expect(result).not.toContain('jewelry-lofts')
  })

  it('excludes properties without engine figures from the underwriting filters', () => {
    expect(ids(filters({ minLeveredIRR: 0 }), FACTS)).not.toContain('weybosset-commons')
    expect(ids(filters({ minLeveredIRR: 0 }), {})).toEqual([])
    expect(ids(filters({ maxBidBelowPrice: true }), {})).toEqual([])
  })

  it('includes a levered IRR exactly at the threshold', () => {
    expect(ids(filters({ minLeveredIRR: 0.135 }), FACTS)).toEqual(['allens-ave-flex'])
    expect(ids(filters({ minLeveredIRR: 0.1351 }), FACTS)).toEqual([])
  })
})

describe('filterProperties: combined', () => {
  it('requires every active filter to match', () => {
    const f = filters({ assetTypes: ['office'], maxOccupancy: 0.8, expiring: { years: 2, minShare: 0.25 } })
    expect(ids(f)).toEqual(['westminster-tower', 'weybosset-commons'])
    expect(ids({ ...f, minSF: 300_000 })).toEqual(['westminster-tower'])
    expect(ids({ ...f, maxBidBelowPrice: true }, FACTS)).toEqual(['westminster-tower'])
    expect(ids({ ...f, submarkets: ['capital-center'] })).toEqual([])
  })

  it('combines types and submarkets as an intersection', () => {
    expect(ids(filters({ assetTypes: ['multifamily'], submarkets: ['jewelry-district'] }))).toEqual(['jewelry-lofts'])
  })
})

describe('sortProperties', () => {
  const sorted = (key: Parameters<typeof sortProperties>[1], facts: FactsById = {}) =>
    sortProperties(ALL, key, AS_OF, facts).map((p) => p.id.replace('sample-', ''))

  it('sorts by name A–Z', () => {
    const names = sortProperties(ALL, 'name', AS_OF, {}).map((p) => p.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it('sorts by size and occupancy, highest first', () => {
    expect(sorted('size').slice(0, 2)).toEqual(['westminster-tower', 'weybosset-commons'])
    expect(sorted('size').at(-1)).toBe('thayer-shops')
    expect(sorted('occupancy')[0]).toBe('olneyville-distribution')
    expect(sorted('occupancy').at(-1)).toBe('weybosset-commons')
  })

  it('sorts by levered IRR, highest first, with missing values last', () => {
    const order = sorted('irr', FACTS)
    expect(order.slice(0, 4)).toEqual(['allens-ave-flex', 'thayer-shops', 'jewelry-lofts', 'westminster-tower'])
    expect(order.slice(4)).toContain('weybosset-commons')
  })

  it('does not reorder the input array', () => {
    const before = ALL.map((p) => p.id)
    sortProperties(ALL, 'size', AS_OF, {})
    expect(ALL.map((p) => p.id)).toEqual(before)
  })
})

describe('propertyView', () => {
  it('returns the sorted matching set, its ids and the total', () => {
    const v = propertyView(ALL, filters({ assetTypes: ['industrial'] }), 'size', AS_OF, {})
    expect(v.matching.map((p) => p.id)).toEqual(['sample-olneyville-distribution', 'sample-allens-ave-flex'])
    expect([...v.matchIds].sort()).toEqual(['sample-allens-ave-flex', 'sample-olneyville-distribution'])
    expect(v.total).toBe(11)
  })
})

describe('active filter chips', () => {
  const all = filters({
    assetTypes: ['office', 'retail'],
    submarkets: ['downtown'],
    minSF: 50_000,
    minOccupancy: 0.8,
    maxOccupancy: 0.9,
    expiring: { years: 1, minShare: 0.2 },
    minLeveredIRR: 0.12,
    maxBidBelowPrice: true,
  })

  it('lists one chip per active filter', () => {
    expect(activeFilterChips(all).map((c) => c.label)).toEqual([
      'Office',
      'Retail',
      '≥ 50K SF',
      '80%–90% leased',
      '≥ 20% of SF expiring in 1 yr',
      'Downtown',
      'Levered IRR ≥ 12%',
      'Max bid below price',
    ])
    expect(activeFilterChips(filters({ maxOccupancy: 0.8 }))[0].label).toBe('Under 80% leased')
    expect(activeFilterChips(filters({ minOccupancy: 0.9, maxOccupancy: 1 }))[0].label).toBe('90%+ leased')
    expect(activeFilterChips(filters({ maxOccupancy: 1 }))).toEqual([])
  })

  it('removes only the chip’s own filter', () => {
    const chips = activeFilterChips(all)
    for (const chip of chips) {
      const rest = activeFilterChips(withoutFilter(all, chip.key))
      expect(rest.map((c) => c.key)).toEqual(chips.filter((c) => c.key !== chip.key).map((c) => c.key))
    }
    const cleared = chips.reduce((f, c) => withoutFilter(f, c.key), all)
    expect(hasActiveFilters(cleared)).toBe(false)
  })
})

describe('URL query string', () => {
  it('writes nothing for empty filters and the default sort', () => {
    expect(filtersToQuery(EMPTY_FILTERS, 'name')).toBe('')
    expect(filtersFromQuery('')).toEqual({ filters: EMPTY_FILTERS, sort: 'name' })
  })

  it('round-trips every filter and the sort', () => {
    const f = filters({
      assetTypes: ['office', 'industrial'],
      submarkets: ['downtown', 'olneyville'],
      minSF: 10_000,
      maxSF: null,
      minOccupancy: 0.8,
      maxOccupancy: 0.9,
      expiring: { years: 3, minShare: 0.25 },
      minLeveredIRR: 0.07,
      maxBidBelowPrice: true,
    })
    const q = filtersToQuery(f, 'irr')
    expect(q).toBe('type=office,industrial&sub=downtown,olneyville&sf=10000-&occ=80-90&exp=3:25&irr=7&belowbid=1&sort=irr')
    expect(filtersFromQuery(`?${q}`)).toEqual({ filters: f, sort: 'irr' })
  })

  it('ignores unknown and malformed values', () => {
    const { filters: f, sort } = filtersFromQuery(
      '?type=office,castle,office&sub=atlantis&sf=abc-&occ=1-2-3&exp=4:20&irr=-5&belowbid=yes&sort=price',
    )
    expect(f).toEqual(filters({ assetTypes: ['office'] }))
    expect(sort).toBe('name')
  })
})

describe('percent inputs', () => {
  it('converts whole-percent text to a decimal and back', () => {
    expect(pctFromInput('12.5')).toBe(0.125)
    expect(pctFromInput(' 7 % ')).toBe(0.07)
    expect(pctFromInput('')).toBeNull()
    expect(pctFromInput('-3')).toBeNull()
    expect(pctToInput(0.07)).toBe('7')
    expect(pctToInput(null)).toBe('')
  })
})

describe('underwriting facts from the engine', () => {
  it('asks the engine only for what the filters and sort use', () => {
    expect(underwritingNeeds(EMPTY_FILTERS, 'name')).toEqual({ irr: false, maxBid: false })
    expect(underwritingNeeds(EMPTY_FILTERS, 'irr')).toEqual({ irr: true, maxBid: false })
    expect(underwritingNeeds(filters({ maxBidBelowPrice: true }), 'name')).toEqual({ irr: false, maxBid: true })
    expect(underwritingFactsById(ALL, AS_OF, {}, { irr: false, maxBid: false })).toEqual({})
  })

  it('matches the engine run and max bid at current assumptions', () => {
    const edits = { 'exit.exitCapRate': 0.08 }
    for (const input of [undefined, edits]) {
      const facts = underwritingFacts(ATWELLS, AS_OF, input, { irr: true, maxBid: true })
      const run = runUnderwriting(ATWELLS, AS_OF, input)
      const bid = maxBid(ATWELLS, AS_OF, assumptionsFor(ATWELLS, AS_OF, input))
      if (run.status !== 'ok' || bid.status !== 'ok') throw new Error('engine unavailable')
      expect(facts.leveredIRR).toBe(run.result.metrics.leveredIRR)
      expect(facts.maxBidBelowPrice).toBe(bid.vsCurrentPct < 0)
    }
  })

  it('reports no figures when the engine can’t run, and skips the max bid unless asked', () => {
    const weybosset = byId('sample-weybosset-commons')
    expect(runUnderwriting(weybosset, AS_OF).status).toBe('unavailable')
    expect(underwritingFacts(weybosset, AS_OF, undefined, { irr: true, maxBid: true })).toEqual({
      leveredIRR: null,
      maxBidBelowPrice: null,
    })
    expect(underwritingFacts(INNOVATION, AS_OF, undefined, { irr: true, maxBid: false }).maxBidBelowPrice).toBeNull()
  })
})
