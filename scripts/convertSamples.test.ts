import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCSV } from '../src/lib/csv'
import { readRentRollFile } from '../src/lib/rentRollFile'
import { conversionGrid, convertRentRoll, totalsMismatches } from '../src/lib/rentRollConvert'
import { parseRentRoll } from '../src/lib/rentRollImport'

/** The public sample: the Yardi-style raw .xlsx must convert to exactly the units in its clean CSV. */

const AS_OF = '2026-10-04'
const DETAILS = { buildingClass: 'B', submarket: 'olneyville' } as const
const RAW = 'docs/samples/fernhill-commons-raw.xlsx'
const CLEAN = 'docs/samples/fernhill-commons-unit-rent-roll.csv'

const grid = await readRentRollFile(RAW, new Uint8Array(readFileSync(RAW)))
const c = convertRentRoll(grid, { today: '2026-10-09' })
// Same file name for both, so the deals compare whole (it ends up in source labels).
const opts = { fileName: 'fernhill-commons.xlsx', asOf: AS_OF, details: DETAILS, importedAt: AS_OF }
const converted = parseRentRoll(conversionGrid(c), opts)
const clean = parseRentRoll(parseCSV(readFileSync(CLEAN, 'utf8')), opts)
const unitsOf = (r: typeof clean) => (r.property?.rentRoll.kind === 'multifamily' ? (r.property.rentRoll.units ?? []) : [])

describe('converting the Fernhill Commons raw rent roll', () => {
  it('detects the Yardi layout and needs nothing from the user', () => {
    expect(c).toMatchObject({ format: 'yardi-lease-charges', name: 'Fernhill Commons Apartments', isSample: true, asOf: '2026-09-30', blockers: [] })
  })

  it('gives 120 units, 110 occupied, 10 vacant, 4 pre-leased, in 4 floor plans', () => {
    expect(c.totals.slice(0, 4).map((t) => [t.label, t.converted])).toEqual([
      ['Units', 120],
      ['Occupied', 110],
      ['Vacant', 10],
      ['Pre-leased', 4],
    ])
    expect(c.plans.map((p) => [p.name, p.units])).toEqual([
      ['735 SF', 48],
      ['560 SF', 30],
      ['960 SF', 30],
      ['1180 SF', 12],
    ])
  })

  it('matches every total in the file: $172,310 rent + $16,480 vacant market, $3,262 other income', () => {
    expect(totalsMismatches(c)).toEqual([])
    const value = (label: string) => c.totals.find((t) => t.label.startsWith(label))!.converted
    expect([value('In-place rent'), value('Market rent, vacant'), value('Rent + vacant market'), value('Other income')]).toEqual([172_310, 16_480, 188_790, 3_262])
  })

  it('matches the clean CSV unit for unit, every field', () => {
    expect(converted.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(converted.issues.map((i) => i.message)).toEqual(clean.issues.map((i) => i.message))
    expect(unitsOf(converted)).toHaveLength(120)
    expect(unitsOf(converted)).toEqual(unitsOf(clean))
    expect(converted.summary).toEqual(clean.summary)
    expect(converted.property).toEqual(clean.property)
  })
})
