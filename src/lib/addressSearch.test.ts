import { describe, expect, it } from 'vitest'
import { SAMPLE_PROPERTIES } from '../data/sampleProperties'
import type { Property } from '../types'
import {
  addressWhereClause,
  exactAddressMatch,
  matchLocalProperties,
  normalizeAddress,
  parseAddressQuery,
  rankParcelSuggestions,
  type AddressQuery,
} from './addressSearch'

const query = (text: string): AddressQuery => {
  const q = parseAddressQuery(text)
  if (!q) throw new Error(`"${text}" should parse`)
  return q
}

describe('normalizeAddress', () => {
  it('treats suffix spellings and case alike', () => {
    for (const s of ['100 Westminster Street', '100 WESTMINSTER ST', '100 westminster st.', '  100  Westminster   St ']) {
      expect(normalizeAddress(s)).toBe('100 WESTMINSTER ST')
    }
    expect(normalizeAddress('245 Atwells Avenue')).toBe('245 ATWELLS AVE')
    expect(normalizeAddress('245 atwells av')).toBe('245 ATWELLS AVE')
    expect(normalizeAddress('1 Financial Plaza')).toBe('1 FINANCIAL PLZ')
  })

  it('drops unit numbers', () => {
    expect(normalizeAddress('1029 Westminster St Unit 1A')).toBe('1029 WESTMINSTER ST')
    expect(normalizeAddress('1029 Westminster St #2')).toBe('1029 WESTMINSTER ST')
    expect(normalizeAddress('1029 Westminster Street Apt. 3')).toBe('1029 WESTMINSTER ST')
    expect(normalizeAddress('50 Kennedy Plaza, Suite 1200')).toBe('50 KENNEDY PLZ')
  })

  it('drops the city, state and ZIP', () => {
    expect(normalizeAddress('10 Dorrance St, Providence, RI 02903')).toBe('10 DORRANCE ST')
    expect(normalizeAddress('10 Dorrance Street Providence RI 02903-1234')).toBe('10 DORRANCE ST')
    expect(normalizeAddress('10 Dorrance St Providence Rhode Island')).toBe('10 DORRANCE ST')
  })

  it('spells out a leading direction, as the city records do', () => {
    expect(normalizeAddress('800 N Main St')).toBe('800 NORTH MAIN ST')
    expect(normalizeAddress('800 N. Main')).toBe('800 NORTH MAIN')
  })

  it('only abbreviates the last word, so street names stay intact', () => {
    expect(normalizeAddress('12 Court Street')).toBe('12 COURT ST')
    expect(normalizeAddress('12 Court')).toBe('12 COURT')
  })
})

describe('parseAddressQuery', () => {
  it('needs at least 3 characters', () => {
    expect(parseAddressQuery('')).toBe(null)
    expect(parseAddressQuery(' 1 ')).toBe(null)
    expect(parseAddressQuery('10 ')).toBe(null)
    expect(parseAddressQuery('100')).toEqual({ text: '100', number: '100', words: [], suffix: undefined })
  })

  it('splits number, street name and suffix', () => {
    expect(query('100 Westminster Street')).toEqual({ text: '100 WESTMINSTER ST', number: '100', words: ['WESTMINSTER'], suffix: 'ST' })
    expect(query('131-135 Brown')).toMatchObject({ number: '131-135', words: ['BROWN'], suffix: undefined })
    expect(query('Westminster')).toMatchObject({ number: undefined, words: ['WESTMINSTER'] })
  })

  it('sets aside a partly typed suffix', () => {
    expect(query('100 Westminster Stre')).toMatchObject({ words: ['WESTMINSTER'], suffix: 'STRE' })
    expect(query('100 Westminster S')).toMatchObject({ words: ['WESTMINSTER'], suffix: 'S' })
    expect(query('100 North Main St')).toMatchObject({ words: ['NORTH', 'MAIN'], suffix: 'ST' })
  })
})

describe('addressWhereClause', () => {
  it('matches the house number, alone or starting a range, then the street name', () => {
    expect(addressWhereClause(query('100 Westminster Street'))).toBe(
      "UPPER(ParcAddress) LIKE '100 WESTMINSTER%' OR UPPER(ParcAddress) LIKE '100-% WESTMINSTER%'",
    )
    expect(addressWhereClause(query('131-135 Brown St'))).toBe("UPPER(ParcAddress) LIKE '131-135 BROWN%'")
    expect(addressWhereClause(query('1000'))).toBe("UPPER(ParcAddress) LIKE '1000 %' OR UPPER(ParcAddress) LIKE '1000-% %'")
  })

  it('matches a street name at the start of any word when there is no number', () => {
    expect(addressWhereClause(query('north main'))).toBe(
      "UPPER(ParcAddress) LIKE 'NORTH MAIN%' OR UPPER(ParcAddress) LIKE '% NORTH MAIN%'",
    )
  })

  it('escapes quotes and never passes wildcards through', () => {
    expect(addressWhereClause(query("12 O'Connell St"))).toContain("LIKE '12 O''CONNELL%'")
    const where = addressWhereClause({ text: 'X', number: undefined, words: ["50%_OFF'; DROP"] })
    expect(where).toBe("UPPER(ParcAddress) LIKE '50OFF'' DROP%' OR UPPER(ParcAddress) LIKE '% 50OFF'' DROP%'")
  })
})

describe('rankParcelSuggestions', () => {
  const rows = [
    { PIN: '290062', ParcAddress: '1029 Westminster St Unit 1A' },
    { PIN: '290062', ParcAddress: '1029 Westminster St Unit 1B' },
    { PIN: '290062', ParcAddress: '1029 Westminster St Unit 2A' },
    { PIN: '290558', ParcAddress: '1000 Westminster St' },
    { PIN: '200124', ParcAddress: '102 Westminster St' },
    { PIN: '100001', ParcAddress: '102 Westminster Ct' },
    { PIN: '', ParcAddress: '5 Nowhere St' },
    { PIN: '100002', ParcAddress: null },
  ]

  it('gives one suggestion per parcel, with its condo unit count', () => {
    const s = rankParcelSuggestions(rows, query('Westminster'))
    expect(s.find((x) => x.pin === '290062')).toEqual({ pin: '290062', address: '1029 Westminster St', units: 3 })
    expect(s.find((x) => x.pin === '290558')?.units).toBe(0)
    expect(s).toHaveLength(4)
  })

  it('puts the exact address first, then by street and house number', () => {
    expect(rankParcelSuggestions(rows, query('102 westminster street')).map((x) => x.address)).toEqual([
      '102 Westminster St',
      '102 Westminster Ct',
      '1000 Westminster St',
      '1029 Westminster St',
    ])
    expect(rankParcelSuggestions(rows, query('Westminster')).map((x) => x.address)).toEqual([
      '102 Westminster Ct',
      '102 Westminster St',
      '1000 Westminster St',
      '1029 Westminster St',
    ])
  })

  it('stops at the limit', () => {
    expect(rankParcelSuggestions(rows, query('Westminster'), 2)).toHaveLength(2)
  })
})

describe('exactAddressMatch', () => {
  const parcel = (pin: string, address: string) => ({ pin, address, units: 0 })

  it('finds the one parcel at the rent roll address, however it is spelled', () => {
    const rows = [parcel('1', '245 Atwells Ave'), parcel('2', '247 Atwells Ave')]
    expect(exactAddressMatch(rows, '245 atwells avenue, Providence, RI 02903')).toEqual(rows[0])
    expect(exactAddressMatch(rows, '245 Atwells Ave Unit 2')).toEqual(rows[0])
  })
  it('does not take a range for one of its numbers', () => {
    expect(exactAddressMatch([parcel('1', '131-135 Brown St')], '131 Brown St')).toBeNull()
  })
  it('gives up when no parcel or several parcels have the address', () => {
    expect(exactAddressMatch([parcel('1', '245 Atwells Ave')], '9 Atwells Ave')).toBeNull()
    expect(exactAddressMatch([parcel('1', '245 Atwells Ave'), parcel('2', '245 Atwells Ave')], '245 Atwells Ave')).toBeNull()
  })
})

describe('matchLocalProperties', () => {
  const imported = {
    ...SAMPLE_PROPERTIES[0],
    id: 'deal-test',
    name: 'Test Deal',
    location: { ...SAMPLE_PROPERTIES[0].location, address: '77 Example Street' },
    importedFrom: { fileName: 'x.csv', importedAt: '2026-10-01' },
  } satisfies Property
  const properties = [...SAMPLE_PROPERTIES, imported]

  it('matches addresses however they are typed', () => {
    for (const s of ['245 atwells', '245 Atwells Avenue', '245 ATWELLS AVE #3', '245 Atwells Ave, Providence']) {
      expect(matchLocalProperties(properties, s).map((p) => p.location.address)).toEqual(['245 Atwells Ave'])
    }
    expect(matchLocalProperties(properties, '77 example st').map((p) => p.id)).toEqual(['deal-test'])
  })

  it('matches names at the start of a word', () => {
    expect(matchLocalProperties(properties, 'thayer').map((p) => p.name)).toEqual(['Thayer Street Shops (Sample)'])
    expect(matchLocalProperties(properties, 'hill apart').map((p) => p.name)).toEqual(['Federal Hill Apartments (Sample)'])
    expect(matchLocalProperties(properties, 'ayer')).toEqual([])
  })

  it('needs 3 characters and stops at the limit', () => {
    expect(matchLocalProperties(properties, 'th')).toEqual([])
    expect(matchLocalProperties(properties, 'sample', 2)).toHaveLength(2)
  })
})
