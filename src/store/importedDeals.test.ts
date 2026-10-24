import { describe, expect, it } from 'vitest'
import atwellsDoc from '../../docs/atwells-rent-roll.csv?raw'
import { SAMPLE_PROPERTIES } from '../data/sampleProperties'
import { parseCSV } from '../lib/csv'
import type { Polygon } from 'geojson'
import { SUBMARKETS } from '../data/submarkets'
import {
  dealFile,
  hasFileAddress,
  isImportedDeal,
  propertyFromDealFile,
  withoutPlacement,
  withPlacement,
  withValidPlacement,
} from '../lib/importedDeals'
import { parseRentRoll } from '../lib/rentRollImport'
import { fromPublic } from '../lib/sourced'
import { analystExport } from '../lib/underwriting/analystExport'
import { underwrite } from '../lib/underwriting/underwrite'
import type { DealPlacement, LngLat, Property } from '../types'
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

describe('placing a deal on its real building', () => {
  const s = () => useAppStore.getState()
  const lot: Polygon = { type: 'Polygon', coordinates: [[[-71.43, 41.82], [-71.429, 41.82], [-71.429, 41.821], [-71.43, 41.821], [-71.43, 41.82]]] }
  const building: LngLat[] = [[-71.4297, 41.8203], [-71.4293, 41.8203], [-71.4293, 41.8207], [-71.4297, 41.8207], [-71.4297, 41.8203]]
  const placement: DealPlacement = { pin: '028-0361', cityAddress: '245 ATWELLS AVE', method: 'address', placedAt: AS_OF, outlineFrom: 'osm', heightM: 12 }
  const placed = withPlacement(deal, placement, [-71.4295, 41.8205], fromPublic(building, 'OSM', AS_OF))
  const request = (dealId = deal.id): PlacementRequest => ({
    dealId,
    pin: '028-0361',
    cityAddress: '245 ATWELLS AVE',
    method: 'click',
    point: [-71.4295, 41.8205],
    parcel: lot,
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
  it('only moves the deal: point, parcel, outline and how it was placed', () => {
    expect(placed.location).toMatchObject({ lng: -71.4295, lat: 41.8205, parcelId: '028-0361', isApproximate: false, placement })
    expect(placed.location.address).toBe('245 Atwells Ave')
    expect({ ...placed, location: deal.location, physical: deal.physical }).toEqual(deal)
    expect({ ...placed.physical, footprint: undefined }).toEqual({ ...deal.physical, footprint: undefined })
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
    expect(s().properties.find((x) => x.id === deal.id)?.location.placement?.pin).toBe('028-0361')
    s().importDeal({ ...deal, location: { ...deal.location, address: '9 Spruce St' } })
    expect(s().properties.find((x) => x.id === deal.id)?.location.isApproximate).toBe(true)
    s().removeImportedDeal(deal.id)
  })
})
