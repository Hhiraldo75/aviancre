import { describe, expect, it } from 'vitest'
import fernhillDoc from '../../docs/samples/fernhill-commons-unit-rent-roll.csv?raw'
import type { Property } from '../types'
import { parseCSV } from '../lib/csv'
import { parseRentRoll } from '../lib/rentRollImport'
import { defaultAssumptions } from '../lib/underwriting/defaults'
import { operatingCashFlows } from '../lib/underwriting/waterfall'
import { SAMPLE_FOOTPRINTS } from './sampleFootprints'
import { SAMPLE_PROPERTIES } from './sampleProperties'

const AS_OF = '2026-10-04'

/** Every { value, source } object in a property, with its path. */
function sourcedFigures(x: unknown, path = ''): [string, string][] {
  if (typeof x !== 'object' || x === null) return []
  if ('value' in x && 'source' in x && typeof x.source === 'string') return [[path, x.source]]
  return Object.entries(x).flatMap(([k, v]) => sourcedFigures(v, `${path}.${k}`))
}

describe('Fernhill Commons built-in sample', () => {
  const p = SAMPLE_PROPERTIES.find((x) => x.id === 'sample-fernhill-commons')!
  const imported = parseRentRoll(parseCSV(fernhillDoc), { fileName: 'fernhill.csv', asOf: AS_OF }).property!
  const rr = p.rentRoll
  const irr = imported.rentRoll
  if (rr.kind !== 'multifamily' || irr.kind !== 'multifamily') throw new Error('expected multifamily')

  it('is a sample on a real parcel, not an imported deal', () => {
    expect(p).toMatchObject({ name: 'Fernhill Commons (Sample)', assetType: 'multifamily', buildingClass: 'B', isSample: true })
    expect(p.location).toMatchObject({ address: '91 Hartford Ave', submarket: 'olneyville', parcelId: '105-0464-0000', isApproximate: false })
    expect(p.importedFrom).toBeUndefined()
    expect(p.id.startsWith('deal-')).toBe(false)
  })

  it('says the rent roll is fictional and gives the real building\'s unit count', () => {
    expect(p.physical.unitCount?.notes).toMatch(/^Fictional rent roll\b.*\b102 units\b/)
  })

  it('has the same units as the CSV import, unchanged', () => {
    expect(rr.units).toEqual(irr.units)
    expect(rr.units).toHaveLength(120)
    expect(p.physical.rentableSF.value).toBe(95_040)
    expect(p.physical.unitCount?.value).toBe(120)
  })

  it('has the same unit mix, other income and market rent as the import, labeled as sample estimates', () => {
    const values = (r: typeof rr) =>
      r.unitTypes.map((u) => ({ ...u, marketRentMonthly: u.marketRentMonthly.value, inPlaceRentMonthly: u.inPlaceRentMonthly?.value }))
    expect(values(rr)).toEqual(values(irr))
    expect(rr.otherIncomePerUnitMonthly?.value).toBe(irr.otherIncomePerUnitMonthly?.value)
    expect(p.market.marketRent.value).toBe(imported.market.marketRent.value)
    const figures = sourcedFigures(p)
    expect(figures.length).toBeGreaterThan(10)
    expect(figures.filter(([, source]) => source === 'imported')).toEqual([])
  })

  it('sizes gross SF from the OSM footprint × floors', () => {
    const fp = SAMPLE_FOOTPRINTS[p.id]
    expect(fp.osmWayId).toBe(486872066)
    expect(p.physical.floors.value).toBe(4)
    expect(p.physical.grossBuildingSF.value).toBe(Math.round((fp.footprintSF * 4) / 100) * 100)
  })

  it('runs the unit-level model, with the same operating cash flows as the import', () => {
    const a = defaultAssumptions(p, AS_OF)
    expect(a.multifamily?.leaseUpUnitsPerMonth?.value).toBeGreaterThan(0)
    expect(a.multifamily?.maxRenewalIncreasePct).toBeDefined()
    const ops = (x: Property) => operatingCashFlows(x, defaultAssumptions(x, AS_OF), AS_OF).years
    const years = ops(p)
    expect(years[0].absorptionTurnoverVacancy).toBeGreaterThan(0)
    expect(years).toEqual(ops(imported))
  })
})
