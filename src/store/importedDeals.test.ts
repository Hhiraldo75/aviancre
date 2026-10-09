import { describe, expect, it } from 'vitest'
import atwellsDoc from '../../docs/atwells-rent-roll.csv?raw'
import { SAMPLE_PROPERTIES } from '../data/sampleProperties'
import { parseCSV } from '../lib/csv'
import { dealFile, isImportedDeal, propertyFromDealFile } from '../lib/importedDeals'
import { parseRentRoll } from '../lib/rentRollImport'
import { useAppStore } from './useAppStore'

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
