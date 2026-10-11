import { describe, expect, it } from 'vitest'
import {
  haversineM,
  isOnPin,
  nearbyQueryUrl,
  nearestRecord,
  ownerName,
  pinToPlatLot,
  platLotQueryUrl,
  platLotRecord,
} from './providenceOpenData'

/** Rows shaped exactly like the portal's JSON (all values arrive as strings). */
const row = (over: Record<string, unknown>) => ({
  plat: '20',
  lot: '100',
  unit: '0000',
  tax_map: '020-0100-0000',
  class: '31',
  short_desc: 'Commercial Office',
  formated_address: '1 Example Plaza',
  company: 'Example Plaza LLC',
  total_assmt: '12500000',
  total_exempt: '0',
  total_taxes: '458000.00',
  property_location: { type: 'Point', coordinates: [-71.4112, 41.8246] as [number, number] },
  ...over,
})

describe('nearbyQueryUrl', () => {
  it('builds a within_circle query (lat before lng, radius in meters)', () => {
    const q = new URLSearchParams(nearbyQueryUrl(-71.41, 41.82, 50).split('?')[1])
    expect(q.get('$where')).toBe('within_circle(property_location, 41.82, -71.41, 50)')
  })
})

describe('haversineM', () => {
  it('measures ~111 m per 0.001° of latitude', () => {
    expect(Math.round(haversineM(-71.41, 41.82, -71.41, 41.821))).toBe(111)
  })
})

describe('ownerName', () => {
  it('prefers the company, else title-cases the person', () => {
    expect(ownerName(row({}))).toBe('Example Plaza LLC')
    expect(ownerName(row({ company: undefined, first_name: 'JANE', last_name: 'DOE' }))).toBe('Jane Doe')
  })
})

describe('nearestRecord', () => {
  it('picks the closest record and parses public values', () => {
    const near = row({})
    const far = row({ lot: '200', formated_address: 'Far St', property_location: { type: 'Point', coordinates: [-71.4105, 41.8250] } })
    const r = nearestRecord([far, near], -71.4112, 41.8246)
    expect(r?.address?.value).toBe('1 Example Plaza')
    expect(r?.address?.source).toBe('public')
    expect(r?.assessedValue?.value).toBe(12_500_000)
    expect(r?.annualTaxes?.value).toBe(458_000)
    expect(r?.landUse?.value).toBe('Commercial Office')
    expect(Math.round(r?.distanceM ?? -1)).toBe(0)
    expect(r?.matchedBy).toBe('distance')
  })
  it('groups condo units on the same plat and lot', () => {
    const units = [1, 2, 3].map((u) =>
      row({ unit: `000${u}`, short_desc: 'Residential Condo', total_assmt: '300000', company: undefined, first_name: 'A', last_name: 'B' }),
    )
    const r = nearestRecord(units, -71.4112, 41.8246)
    expect(r?.unitCount).toBe(3)
    expect(r?.totalAssessedAllUnits).toBe(900_000)
  })
  it('ignores records without coordinates and anything too far away', () => {
    const noCoords = row({ property_location: undefined })
    const distant = row({ property_location: { type: 'Point', coordinates: [-71.43, 41.80] } })
    expect(nearestRecord([noCoords, distant], -71.4112, 41.8246)).toBe(null)
  })
})

describe('matching by PIN (plat and lot)', () => {
  it('splits the city PIN into the tax roll\'s plat and lot', () => {
    expect(pinToPlatLot('200038')).toEqual({ plat: '20', lot: '38' })
    expect(pinToPlatLot('1290001')).toEqual({ plat: '129', lot: '1' })
    expect(pinToPlatLot('')).toBe(null)
    expect(pinToPlatLot('unknown')).toBe(null)
  })
  it('queries the roll by plat and lot as numbers', () => {
    const q = new URLSearchParams(platLotQueryUrl({ plat: '20', lot: '38' }).split('?')[1])
    expect(q.get('$where')).toBe('plat=20 AND lot=38')
  })
  it('takes the record on the PIN\'s lot even when another record is closer to the point', () => {
    const click: [number, number] = [-71.4112, 41.8246]
    // The lot next door files its point right at the click; the searched lot's point is ~40 m off.
    const neighbor = row({ lot: '39', tax_map: '020-0039-0000', formated_address: '20 Washington St' })
    const onLot = row({
      lot: '38',
      tax_map: '020-0038-0000',
      formated_address: '25 Dorrance St',
      property_location: { type: 'Point', coordinates: [-71.4115, 41.825] },
    })
    expect(nearestRecord([neighbor, onLot], ...click)?.address?.value).toBe('20 Washington St')

    const r = platLotRecord([neighbor, onLot], pinToPlatLot('200038')!, ...click)
    expect(r?.address?.value).toBe('25 Dorrance St')
    expect(r?.taxMap).toBe('020-0038-0000')
    expect(r?.matchedBy).toBe('plat-lot')
    expect(r?.unitCount).toBe(1)
    expect(isOnPin(r!, '200038')).toBe(true)
    expect(isOnPin(r!, '200039')).toBe(false)
  })
  it('keeps a lot record without a location, placed at the point, and finds nothing for another lot', () => {
    const unplaced = row({ lot: '38', property_location: undefined })
    const r = platLotRecord([unplaced], { plat: '20', lot: '38' }, -71.41, 41.82)
    expect([r?.lng, r?.lat, r?.matchedBy]).toEqual([-71.41, 41.82, 'plat-lot'])
    expect(platLotRecord([unplaced], { plat: '20', lot: '40' }, -71.41, 41.82)).toBe(null)
  })
})
