import { describe, expect, it } from 'vitest'
import { decodeLandUse } from './landUse'

/** Every `class` in the 2025 tax roll (6ub4-iebe) as of October 2026. */
const TAX_ROLL_CODES = [
  '1', '2', '23', '13', '6', '14', '04-05U', '12', '78', '79', '72', '24', '03-610', '71', '7',
  '80', '75', '83', '03-11+', '04-610', '10', '84', '04-11+', '82', '70', '74', '76', '5', '73', '33',
]

/** Every `MuniUseCode` on the city GIS parcel layer. */
const GIS_CODES = [
  '01', '02', '03', '04', '05', '06', '07', '10', '12', '13', '14', '23', '24', '33', '70',
  '71', '72', '73', '74', '75', '76', '78', '79', '80', '82', '83', '84',
]

describe('decodeLandUse', () => {
  it('recognizes every tax-roll and GIS code in use', () => {
    for (const code of [...TAX_ROLL_CODES, ...GIS_CODES]) {
      expect(decodeLandUse(code)?.recognized, code).toBe(true)
    }
  })

  it('reads zero-padded GIS codes like the tax roll', () => {
    expect(decodeLandUse('01')).toMatchObject({ code: '01', label: 'Single-family home', category: 'residential' })
    expect(decodeLandUse('06')).toMatchObject({ category: 'commercial', isCommercial: true })
    expect(decodeLandUse('14')).toMatchObject({ category: 'vacant land', isCommercial: true })
    expect(decodeLandUse('03')).toMatchObject({ category: 'multifamily', isCommercial: true })
    expect(decodeLandUse('04')).toMatchObject({ category: 'mixed-use', isCommercial: true })
  })

  it('flags commercial property by Rhode Island Class 2', () => {
    const cases: [string, string, boolean][] = [
      ['6', 'commercial', true],
      ['24', 'commercial', true],
      ['7', 'industrial', true],
      ['03-11+', 'multifamily', true],
      ['04-05U', 'mixed-use', true],
      ['14', 'vacant land', true],
      ['1', 'residential', false],
      ['2', 'residential', false],
      ['13', 'vacant land', false],
      ['79', 'exempt', false],
      ['83', 'other', false],
    ]
    for (const [code, category, isCommercial] of cases) {
      expect(decodeLandUse(code), code).toMatchObject({ category, isCommercial })
    }
  })

  it('keeps an unknown code with "Unrecognized code"', () => {
    expect(decodeLandUse('ZZ')).toEqual({ code: 'ZZ', label: 'Unrecognized code', category: 'other', isCommercial: false, recognized: false })
    expect(decodeLandUse('99')?.recognized).toBe(false)
  })

  it('tolerates whitespace and case, and ignores a missing code', () => {
    expect(decodeLandUse(' 04-05u ')).toMatchObject({ code: '04-05u', category: 'mixed-use' })
    expect(decodeLandUse(undefined)).toBeUndefined()
    expect(decodeLandUse('  ')).toBeUndefined()
  })
})
