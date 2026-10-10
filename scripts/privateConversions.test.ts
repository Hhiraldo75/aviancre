import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCSV } from '../src/lib/csv'
import { readRentRollFile } from '../src/lib/rentRollFile'
import { conversionGrid, convertRentRoll, totalsMismatches } from '../src/lib/rentRollConvert'
import { parseRentRoll } from '../src/lib/rentRollImport'
import { PRIVATE_DIR } from './privateDeals'

/**
 * Conversion checks against real rent rolls kept in private-deals/ (never
 * committed). Each private-deals/<folder>/expected-conversion.json names a raw
 * file, its hand-made clean CSV and the totals the raw file states; the
 * expected numbers live there, not here. Skipped when there are none.
 */

interface Expected {
  raw: string
  clean: string
  totals: { units: number; occupied: number; vacant: number; preLeased: number; floorPlans?: number; occupiedRent: number; vacantMarket: number; rentPlusVacantMarket: number; otherIncome: number }
}

const fixtures = existsSync(PRIVATE_DIR)
  ? readdirSync(PRIVATE_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(PRIVATE_DIR, e.name, 'expected-conversion.json')))
      .map((e) => ({ dir: join(PRIVATE_DIR, e.name), expected: JSON.parse(readFileSync(join(PRIVATE_DIR, e.name, 'expected-conversion.json'), 'utf8')) as Expected }))
  : []

const AS_OF = '2026-10-04'
const DETAILS = { buildingClass: 'B', submarket: 'olneyville' } as const

describe.skipIf(!fixtures.length)('private rent roll conversions (skipped: no private-deals/*/expected-conversion.json)', () => {
  for (const { dir, expected } of fixtures) {
    describe(dir, async () => {
      const raw = join(dir, expected.raw)
      const c = convertRentRoll(await readRentRollFile(raw, new Uint8Array(readFileSync(raw))))
      const value = (label: string) => c.totals.find((t) => t.label.startsWith(label))!.converted

      it('converts with no blockers and every file total matching', () => {
        expect(c.blockers).toEqual([])
        expect(totalsMismatches(c)).toEqual([])
      })

      it('gives the expected totals', () => {
        const t = expected.totals
        expect([value('Units'), value('Occupied'), value('Vacant'), value('Pre-leased')]).toEqual([t.units, t.occupied, t.vacant, t.preLeased])
        expect([value('In-place rent'), value('Market rent, vacant'), value('Rent + vacant market'), value('Other income')]).toEqual([
          t.occupiedRent,
          t.vacantMarket,
          t.rentPlusVacantMarket,
          t.otherIncome,
        ])
        if (t.floorPlans !== undefined) expect(c.plans).toHaveLength(t.floorPlans)
      })

      it('matches the clean CSV unit for unit (rent, SF, market, status, pre-leased)', () => {
        const pick = (r: ReturnType<typeof parseRentRoll>) =>
          (r.property?.rentRoll.kind === 'multifamily' ? (r.property.rentRoll.units ?? []) : []).map((u) => ({
            unit: u.unit,
            sf: u.sf,
            occupied: u.occupied,
            market: u.marketRentMonthly,
            rent: u.inPlaceRentMonthly,
            other: u.otherIncomeMonthly,
            preLeased: u.preLeased,
          }))
        const converted = parseRentRoll(conversionGrid(c), { fileName: raw, asOf: AS_OF, details: DETAILS })
        const clean = parseRentRoll(parseCSV(readFileSync(join(dir, expected.clean), 'utf8')), { fileName: expected.clean, asOf: AS_OF, details: DETAILS })
        expect(converted.issues.filter((i) => i.severity === 'error')).toEqual([])
        expect(pick(converted)).toHaveLength(expected.totals.units)
        expect(pick(converted)).toEqual(pick(clean))
      })
    })
  }
})
