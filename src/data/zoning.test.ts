import { describe, expect, it } from 'vitest'
import { buildableEnvelope } from '../lib/development'
import { maxHeightLabel, noFarNote, zoningLimitsFor } from '../lib/parcelMetrics'
import { SAMPLE_PROPERTIES } from './sampleProperties'
import { ZONING_LIMITS } from './zoning'

/**
 * Every base zoning code on the city map (Parcel_Zoning_FL layer 12), pulled 2026-10-23 with
 * `query?where=1=1&groupByFieldsForStatistics=Code&outStatistics=[{count of OBJECTID}]`.
 * If the map gains a code, add it here and to zoning.ts.
 */
const MAP_DISTRICTS = [
  'C-2', 'C-3', 'CD',
  'D-1-45', 'D-1-75', 'D-1-100', 'D-1-120', 'D-1-150', 'D-1-200', 'D-1-300',
  'I-1-75', 'I-1-200', 'I-2',
  'M-1', 'M-2', 'M-MU-75', 'M-MU-90',
  'OS', 'PS',
  'R-1', 'R-1A', 'R-3', 'R-4', 'R-P',
  'W-2', 'W-3',
]

describe('zoning table', () => {
  it.each(MAP_DISTRICTS)('covers %s with a cited ordinance limit and no FAR', (code) => {
    const z = zoningLimitsFor(code)
    expect(z).toBeDefined()
    expect(z!.section).toMatch(/^(Table \d+-\d+|§\d+(\.[A-Z])?)$/)
    expect('maxFAR' in z!).toBe(false)
    if (code === 'CD') expect(z!.maxHeightFt).toBe(null)
    else expect(z!.maxHeightFt).toBeGreaterThan(0)
  })

  it('gives each height sub-district the height in its code', () => {
    for (const code of Object.keys(ZONING_LIMITS).filter((c) => /^(D-1|I-1|M-MU)-\d+$/.test(c))) {
      expect(ZONING_LIMITS[code].maxHeightFt).toBe(Number(code.split('-').pop()))
    }
  })

  it('has only map districts, plus D-1-600 which the ordinance defines but the map does not use yet', () => {
    expect(Object.keys(ZONING_LIMITS).sort()).toEqual([...MAP_DISTRICTS, 'D-1-600'].sort())
  })

  it('sets coverage only in the residential districts (Table 4-1)', () => {
    const withCoverage = Object.entries(ZONING_LIMITS).filter(([, z]) => z.maxCoverage !== undefined)
    expect(withCoverage.map(([c]) => c).sort()).toEqual(['R-1', 'R-1A', 'R-3', 'R-4', 'R-P'])
    expect(withCoverage.every(([, z]) => z.section === 'Table 4-1')).toBe(true)
  })

  it('resolves the ordinance spelling RP and loosely typed codes', () => {
    expect(zoningLimitsFor('RP')).toBe(ZONING_LIMITS['R-P'])
    expect(zoningLimitsFor(' d-1-100 ')).toBe(ZONING_LIMITS['D-1-100'])
    expect(zoningLimitsFor('c2')).toBe(ZONING_LIMITS['C-2'])
    expect(zoningLimitsFor('D-1')).toBe(undefined)
    expect(zoningLimitsFor(undefined)).toBe(undefined)
  })

  it("gives every sample property its district's ordinance height", () => {
    for (const p of SAMPLE_PROPERTIES.filter((x) => x.isSample)) {
      const z = zoningLimitsFor(p.zoning.district.value)
      expect(z, p.id).toBeDefined()
      expect(p.zoning.maxHeightFt?.value, p.id).toBe(z!.maxHeightFt)
      expect(p.zoning.maxHeightFt?.sourceName, p.id).toMatch(/Zoning Ordinance.*(Table|§)/)
    }
  })
})

describe('buildableEnvelope', () => {
  it('multiplies lot area by coverage and the stories the height allows', () => {
    const e = buildableEnvelope(ZONING_LIMITS['R-3'], 5_000)
    expect(e?.stories).toBe(3)
    expect(e?.sf.value).toBe(6_750)
    expect(e?.sf.source).toBe('estimated')
    expect(e?.sf.notes).toBe('5,000 sf lot × 45% max coverage × 3 stories (45 ft ÷ 12 ft per story); Table 4-1')
    expect(buildableEnvelope(ZONING_LIMITS['R-1A'], 10_000)?.sf.value).toBe(10_500)
  })
  it('uses the 32 ft small-lot height on lots of 2,500 sf or less', () => {
    const e = buildableEnvelope(ZONING_LIMITS['R-1'], 2_400)
    expect(e?.heightFt).toBe(32)
    expect(e?.stories).toBe(2)
    expect(e?.sf.value).toBe(2_160)
    expect(e?.sf.notes).toMatch(/32 ft \(lot of 2,500 sf or less\)/)
  })
  it('is null without a coverage limit, a height limit or a lot area', () => {
    expect(buildableEnvelope(ZONING_LIMITS['C-2'], 5_000)).toBe(null)
    expect(buildableEnvelope(ZONING_LIMITS['D-1-300'], 5_000)).toBe(null)
    expect(buildableEnvelope(ZONING_LIMITS.CD, 5_000)).toBe(null)
    expect(buildableEnvelope(ZONING_LIMITS['R-3'], null)).toBe(null)
    expect(buildableEnvelope(undefined, 5_000)).toBe(null)
  })
})

describe('zoning panel text', () => {
  it('says the ordinance sets no FAR, citing the section', () => {
    expect(noFarNote('C-2', ZONING_LIMITS['C-2'])).toBe(
      'The Providence Zoning Ordinance sets no FAR for C-2; development is limited by height (Table 5-1).',
    )
    expect(noFarNote('R-3', ZONING_LIMITS['R-3'])).toMatch(/limited by height and building coverage \(Table 4-1\)/)
    expect(noFarNote('CD', ZONING_LIMITS.CD)).toMatch(/no FAR or other dimensional standards for CD \(§1002\)/)
    expect(noFarNote('Z-9', undefined)).toMatch(/isn't in AVIANCRE's zoning table/)
  })
  it('labels the height limit', () => {
    expect(maxHeightLabel(ZONING_LIMITS['C-2'])).toBe('50 ft · 4 stories')
    expect(maxHeightLabel(ZONING_LIMITS['D-1-150'])).toBe('150 ft')
    expect(maxHeightLabel(ZONING_LIMITS.CD)).toBe('None set')
  })
})
