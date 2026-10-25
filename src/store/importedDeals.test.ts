import { describe, expect, it } from 'vitest'
import atwellsDoc from '../../docs/atwells-rent-roll.csv?raw'
import fernhillT12 from '../../docs/samples/fernhill-commons-t12.csv?raw'
import { SAMPLE_PROPERTIES } from '../data/sampleProperties'
import { parseCSV } from '../lib/csv'
import type { Polygon } from 'geojson'
import { developmentCapacity } from '../lib/development'
import { noFarNote } from '../lib/parcelMetrics'
import { SUBMARKETS } from '../data/submarkets'
import {
  dealFile,
  hasFileAddress,
  isImportedDeal,
  parcelFacts,
  propertyFromDealFile,
  withoutPlacement,
  withPlacement,
  withValidPlacement,
} from '../lib/importedDeals'
import { parseRentRoll } from '../lib/rentRollImport'
import { readT12, statementFrom } from '../lib/t12Read'
import { fromPublic } from '../lib/sourced'
import { analystExport } from '../lib/underwriting/analystExport'
import { underwrite } from '../lib/underwriting/underwrite'
import type { DealPlacement, LngLat, ParcelOverlays, ParcelRecord, Property } from '../types'
import { useAppStore, type PlacementRequest } from './useAppStore'

const AS_OF = '2026-10-04'
const deal = parseRentRoll(parseCSV(atwellsDoc), { fileName: 'atwells.csv', asOf: AS_OF }).property!

describe('imported deals in the store', () => {
  const store = useAppStore.getState()

  it('adds a deal after the samples and selects it', () => {
    expect(store.importDeal(deal)).toBe(true)
    const s = useAppStore.getState()
    expect(s.properties).toHaveLength(SAMPLE_PROPERTIES.length + 1)
    expect(s.properties.at(-1)).toBe(deal)
    expect(s.selectedId).toBe(deal.id)
  })
  it('replaces a re-imported deal and drops its old edits', () => {
    useAppStore.getState().setAssumption(deal.id, 'exit.exitCapRate', 0.08)
    useAppStore.getState().importDeal({ ...deal, name: 'Atwells, re-imported' })
    const s = useAppStore.getState()
    expect(s.properties.filter((p) => p.id === deal.id).map((p) => p.name)).toEqual(['Atwells, re-imported'])
    expect(s.assumptionEdits[deal.id]).toBeUndefined()
  })
  it('removes the deal, its edits and its selection', () => {
    useAppStore.getState().setAssumption(deal.id, 'exit.exitCapRate', 0.08)
    useAppStore.getState().removeImportedDeal(deal.id)
    const s = useAppStore.getState()
    expect(s.properties).toEqual(SAMPLE_PROPERTIES)
    expect(s.assumptionEdits[deal.id]).toBeUndefined()
    expect(s.selectedId).toBeNull()
  })
  it('never removes a sample property', () => {
    useAppStore.getState().removeImportedDeal(SAMPLE_PROPERTIES[0].id)
    expect(useAppStore.getState().properties).toEqual(SAMPLE_PROPERTIES)
  })
  it('refuses a property that was not imported', () => {
    expect(() => useAppStore.getState().importDeal(SAMPLE_PROPERTIES[0])).toThrow(/not an imported deal/)
  })
})

describe('stored deals', () => {
  it('round-trip through JSON', () => {
    const stored: unknown = JSON.parse(JSON.stringify(dealFile(deal)))
    expect(propertyFromDealFile(stored)).toEqual(JSON.parse(JSON.stringify(deal)))
  })
  it('reject samples, other formats and malformed entries', () => {
    expect(isImportedDeal(SAMPLE_PROPERTIES[0])).toBe(false)
    expect(isImportedDeal({ ...deal, rentRoll: { kind: 'commercial' } })).toBe(false)
    expect(propertyFromDealFile({ format: 'aviancre-deal', version: 2, property: deal })).toBeNull()
    expect(propertyFromDealFile(deal)).toBeNull()
  })
})

describe("an imported deal's assumption sets", () => {
  it('stay with the deal when it is re-imported and go when it is removed', () => {
    const s = () => useAppStore.getState()
    s().importDeal(deal)
    s().saveAssumptionSet(deal.id, { name: 'Base', savedAt: AS_OF, edits: { 'exit.exitCapRate': 0.08 } })
    expect(s().assumptionEdits[deal.id]).toEqual({ 'exit.exitCapRate': 0.08 })
    s().importDeal(deal)
    expect(s().assumptionSets[deal.id]?.map((x) => x.name)).toEqual(['Base'])
    expect(s().assumptionEdits[deal.id]).toBeUndefined()
    s().removeImportedDeal(deal.id)
    expect(s().assumptionSets[deal.id]).toBeUndefined()
  })
})

describe('assumption sets in the store', () => {
  const id = SAMPLE_PROPERTIES[1].id
  const s = () => useAppStore.getState()
  it('replace a set saved under the same name, and delete without touching the current edits', () => {
    s().saveAssumptionSet(id, { name: 'Base', savedAt: AS_OF, edits: { 'debt.ltv': 0.5 } })
    s().saveAssumptionSet(id, { name: 'Base', savedAt: AS_OF, edits: { 'debt.ltv': 0.55 } })
    expect(s().assumptionSets[id]).toEqual([{ name: 'Base', savedAt: AS_OF, edits: { 'debt.ltv': 0.55 } }])
    s().deleteAssumptionSet(id, 'Base')
    expect(s().assumptionSets[id]).toBeUndefined()
    expect(s().activeSets[id]).toBeUndefined()
    expect(s().assumptionEdits[id]).toEqual({ 'debt.ltv': 0.55 })
    s().resetAssumptions(id)
  })
  it('ignore a set name that does not exist', () => {
    s().applyAssumptionSet(id, 'Nope')
    expect(s().assumptionEdits[id]).toBeUndefined()
  })
})

describe('T-12s in the store', () => {
  const s = () => useAppStore.getState()
  const fernhill = SAMPLE_PROPERTIES.find((p) => p.id === 'sample-fernhill-commons')!
  const t12 = statementFrom(readT12(parseCSV(fernhillT12), { kind: 'multifamily' }), { fileName: 'fernhill-commons-t12.csv', importedAt: AS_OF })
  const current = (id: string) => s().properties.find((p) => p.id === id)!

  it('attach to the property, drop expense edits made on the old lines with a notice, and come off again', () => {
    s().setAssumption(fernhill.id, 'operating.expenses.0.annualAmount', 800_000)
    s().setAssumption(fernhill.id, 'exit.exitCapRate', 0.08)
    expect(s().loadT12(fernhill.id, t12)).toBe(true)
    expect(current(fernhill.id).t12).toBe(t12)
    expect(s().assumptionEdits[fernhill.id]).toEqual({ 'exit.exitCapRate': 0.08 })
    expect(s().assumptionNotices[fernhill.id]).toMatch(/^Dropped 1 operating expense edit: it was made on the single benchmark line/)
    s().dismissAssumptionNotice(fernhill.id)
    expect(s().assumptionNotices[fernhill.id]).toBeUndefined()

    s().setAssumption(fernhill.id, 'operating.expenses.2.annualAmount', 150_000)
    s().removeT12(fernhill.id)
    expect(current(fernhill.id)).toEqual(fernhill)
    expect(s().t12s[fernhill.id]).toBeUndefined()
    expect(s().assumptionEdits[fernhill.id]).toEqual({ 'exit.exitCapRate': 0.08 })
    expect(s().assumptionNotices[fernhill.id]).toMatch(/made on 7 T-12 lines/)
    s().dismissAssumptionNotice(fernhill.id)
    s().resetAssumptions(fernhill.id)
  })
  it('record the T-12 lines on a set saved with a T-12, and drop its expense edits when applied without one', () => {
    s().loadT12(fernhill.id, t12)
    s().saveAssumptionSet(fernhill.id, { name: 'T-12 case', savedAt: AS_OF, edits: { 'operating.expenses.0.annualAmount': 240_000, 'debt.ltv': 0.6 } })
    expect(s().assumptionSets[fernhill.id]?.[0].expenseLines).toHaveLength(7)
    s().removeT12(fernhill.id)
    s().applyAssumptionSet(fernhill.id, 'T-12 case')
    expect(s().assumptionEdits[fernhill.id]).toEqual({ 'debt.ltv': 0.6 })
    expect(s().assumptionNotices[fernhill.id]).toMatch(/^Dropped 1 operating expense edit from “T-12 case”/)
    s().deleteAssumptionSet(fernhill.id, 'T-12 case')
    s().dismissAssumptionNotice(fernhill.id)
    s().resetAssumptions(fernhill.id)
  })
  it('stay with a re-imported deal and go when the deal is removed', () => {
    s().importDeal(deal)
    s().loadT12(deal.id, t12)
    s().importDeal({ ...deal, name: 'Atwells, re-imported' })
    expect(current(deal.id).t12).toBe(t12)
    expect(current(deal.id).name).toBe('Atwells, re-imported')
    s().removeImportedDeal(deal.id)
    expect(s().t12s[deal.id]).toBeUndefined()
  })
})

describe('placing a deal on its real building', () => {
  const s = () => useAppStore.getState()
  const lot: Polygon = { type: 'Polygon', coordinates: [[[-71.43, 41.82], [-71.429, 41.82], [-71.429, 41.821], [-71.43, 41.821], [-71.43, 41.82]]] }
  const building: LngLat[] = [[-71.4297, 41.8203], [-71.4293, 41.8203], [-71.4293, 41.8207], [-71.4297, 41.8207], [-71.4297, 41.8203]]
  const placement: DealPlacement = { pin: '028-0361', cityAddress: '245 ATWELLS AVE', method: 'address', placedAt: AS_OF, outlineFrom: 'osm', heightM: 12 }
  const GIS = 'City of Providence ArcGIS Online'
  const record: ParcelRecord = {
    pin: '028-0361',
    landAreaSF: fromPublic(10_000, GIS),
    grossBuildingSF: fromPublic(9_000, GIS),
    parcelZoning: fromPublic('C2', GIS),
    geometry: lot,
  }
  const overlays: ParcelOverlays = { baseZoning: fromPublic('R-3', `${GIS} – Base Zoning`), floodZone: fromPublic('AE', 'FEMA') }
  const facts = parcelFacts(record, overlays)
  const placed = withPlacement(deal, placement, [-71.4295, 41.8205], fromPublic(building, 'OSM', AS_OF), facts)
  const request = (dealId = deal.id): PlacementRequest => ({
    dealId,
    pin: '028-0361',
    cityAddress: '245 ATWELLS AVE',
    method: 'click',
    point: [-71.4295, 41.8205],
    parcel: lot,
    facts,
  })
  /** Engine output without its timestamp. */
  const run = (p: Property) => {
    const { generatedAt: _at, ...rest } = underwrite(p, AS_OF)
    return rest
  }
  const exported = (p: Property) => {
    const { meta, ...rest } = analystExport(p, AS_OF, underwrite(p, AS_OF))
    const { generatedAt: _at, ...stamped } = meta
    return { meta: stamped, ...rest }
  }

  it('changes no underwriting number', () => {
    expect(run(placed)).toEqual(run(deal))
    expect(exported(placed)).toEqual(exported(deal))
  })
  it('moves the deal and takes the parcel’s zoning, lot and building area; nothing else changes', () => {
    expect(placed.location).toMatchObject({ lng: -71.4295, lat: 41.8205, parcelId: '028-0361', isApproximate: false, placement })
    expect(placed.location.address).toBe('245 Atwells Ave')
    expect({ ...placed, location: deal.location, physical: deal.physical, zoning: deal.zoning }).toEqual(deal)
    const { footprint: _f, landAreaSF, grossBuildingSF, ...rest } = placed.physical
    expect([landAreaSF?.value, grossBuildingSF.value]).toEqual([10_000, 9_000])
    expect({ ...rest, grossBuildingSF: deal.physical.grossBuildingSF }).toEqual(deal.physical)
  })

  it('gives the Developer view the parcel’s real zoning, as for a clicked parcel', () => {
    // The base zoning map wins over the zoning recorded on the parcel.
    expect(placed.zoning).toEqual({
      district: fromPublic('R-3', `${GIS} – Base Zoning`),
      maxHeightFt: fromPublic(45, 'Providence Zoning Ordinance (amended through July 22, 2026), Table 4-1'),
      maxCoverage: fromPublic(0.45, 'Providence Zoning Ordinance (amended through July 22, 2026), Table 4-1'),
      floodZone: fromPublic('AE', 'FEMA'),
    })
    const d = developmentCapacity(placed)
    expect(d.limits?.description).toBe('Medium density residential')
    // 10,000 sf × 45% × 3 stories (45 ft ÷ 12) = 13,500 sf, against the city's 9,000 sf building.
    expect(d.envelope?.sf.value).toBe(13_500)
    expect(d.additionalEnvelopeSF).toBe(4_500)
    expect(d.existingFAR).toBe(0.9)
    expect(noFarNote(placed.zoning.district.value, d.limits)).toMatch(/sets no FAR for R-3; development is limited by height and building coverage/)

    const crowded = withPlacement(deal, placement, [0, 0], fromPublic(building, 'OSM'), parcelFacts({ ...record, grossBuildingSF: fromPublic(20_000, GIS) }, overlays))
    expect(developmentCapacity(crowded).additionalEnvelopeSF).toBe(-6_500)
  })
  it('falls back to the parcel’s own zoning, and to “Unknown” when the city records none', () => {
    const c2 = parcelFacts(record, {}).zoning
    expect(c2.district.value).toBe('C-2')
    expect(c2.maxHeightFt?.value).toBe(50)
    expect(c2.maxCoverage).toBeUndefined()
    const none = parcelFacts({ ...record, parcelZoning: undefined, grossBuildingSF: undefined }, { floodZone: fromPublic('X', 'FEMA') })
    expect(none.zoning).toEqual({ ...deal.zoning, floodZone: fromPublic('X', 'FEMA') })
    expect(none.grossBuildingSF).toBeUndefined()
  })
  it('keeps “Unknown” zoning for an approximate deal', () => {
    expect(deal.zoning.district).toMatchObject({ value: 'Unknown', source: 'estimated' })
    expect(developmentCapacity(deal).limits).toBeUndefined()
    expect(withoutPlacement(placed).zoning).toEqual(deal.zoning)
  })
  it('resets to the approximate pin exactly as imported', () => {
    expect(withoutPlacement(placed)).toEqual(deal)
    expect(deal.location.isApproximate).toBe(true)
    expect([deal.location.lng, deal.location.lat]).toEqual(SUBMARKETS[deal.location.submarket].center)
  })
  it('knows whether the rent roll named an address', () => {
    expect(hasFileAddress(deal)).toBe(true)
    const noAddress = parseRentRoll(parseCSV(atwellsDoc.replace('Address,245 Atwells Ave\n', '')), { fileName: 'a.csv', asOf: AS_OF }).property!
    expect(noAddress.location.address).toBe('Federal Hill (location approximate)')
    expect(hasFileAddress(noAddress)).toBe(false)
  })
  it('loads a stored deal with a malformed placement as approximate instead of dropping it', () => {
    const broken = JSON.parse(JSON.stringify(placed)) as Property
    ;(broken.location.placement as unknown as Record<string, unknown>).method = 'teleport'
    expect(isImportedDeal(broken)).toBe(true)
    expect(withValidPlacement(broken)).toEqual(JSON.parse(JSON.stringify(deal)))
    expect(withValidPlacement(placed)).toBe(placed)
    expect(withValidPlacement(deal)).toBe(deal)
  })

  it('places the deal on the OSM building, or else the parcel outline, and resets it', () => {
    s().importDeal(deal)
    s().startPlacing(deal.id)
    useAppStore.setState({ placementRequest: request() })
    expect(s().completePlacement(s().placementRequest!, { ring: building, heightM: 12 })).toBe(true)
    let p = s().properties.find((x) => x.id === deal.id)!
    expect(p.location.placement).toMatchObject({ pin: '028-0361', method: 'click', outlineFrom: 'osm', heightM: 12 })
    expect(p.physical.footprint?.value).toEqual(building)
    expect(s()).toMatchObject({ selectedId: deal.id, placing: null, placementRequest: null })

    useAppStore.setState({ placementRequest: request() })
    s().completePlacement(s().placementRequest!, null)
    p = s().properties.find((x) => x.id === deal.id)!
    expect(p.location.placement).toMatchObject({ outlineFrom: 'parcel' })
    expect(p.location.placement).not.toHaveProperty('heightM')
    expect(p.physical.footprint?.value).toEqual(lot.coordinates[0])

    expect(s().resetDealLocation(deal.id)).toBe(true)
    expect(s().properties.find((x) => x.id === deal.id)).toEqual(deal)
    s().removeImportedDeal(deal.id)
  })
  it('ignores a placement a newer request or a cancel replaced', () => {
    s().importDeal(deal)
    const stale = request()
    useAppStore.setState({ placementRequest: stale })
    s().cancelPlacing()
    s().completePlacement(stale, null)
    expect(s().properties.find((x) => x.id === deal.id)).toBe(deal)
    s().removeImportedDeal(deal.id)
  })
  it('keeps the placement through a re-import of the same address, not a new one', () => {
    s().importDeal(deal)
    useAppStore.setState({ placementRequest: request() })
    s().completePlacement(s().placementRequest!, { ring: building })
    s().importDeal({ ...deal, name: 'Atwells, re-imported' })
    const kept = s().properties.find((x) => x.id === deal.id)!
    expect(kept.location.placement?.pin).toBe('028-0361')
    expect([kept.zoning.district.value, kept.physical.landAreaSF?.value, kept.physical.grossBuildingSF.value]).toEqual(['R-3', 10_000, 9_000])
    s().importDeal({ ...deal, location: { ...deal.location, address: '9 Spruce St' } })
    expect(s().properties.find((x) => x.id === deal.id)?.location.isApproximate).toBe(true)
    s().removeImportedDeal(deal.id)
  })
})
