import { describe, expect, it } from 'vitest'
import type { Property } from '../types'
import { parseCSV } from './csv'
import { occupancy } from './metrics'
import { parseRentRoll, type DealDetails, type ImportIssue } from './rentRollImport'
import { estimate } from './sourced'
import { defaultAssumptions } from './underwriting/defaults'
import { operatingCashFlows } from './underwriting/waterfall'

const AS_OF = '2026-10-04'
const DETAILS: DealDetails = { buildingClass: 'B', submarket: 'olneyville' }

const importCSV = (csv: string, details: DealDetails = {}) => parseRentRoll(parseCSV(csv), { fileName: 'test.csv', asOf: AS_OF, details })
const loaded = (r: ReturnType<typeof parseRentRoll>): Property => {
  if (!r.property) throw new Error(`import failed: ${JSON.stringify(r.issues.filter((i) => i.severity === 'error'))}`)
  return r.property
}
const matching = (issues: ImportIssue[], re: RegExp) => issues.filter((i) => re.test(i.message))

const TINY = `Tiny Flats: unit rent roll
Property
Asset type,multifamily
Units,3
Rentable SF,2100
Class,B
Submarket,olneyville
Address,1 Test St

Units
Unit,Floor plan,SF,Status,Market rent ($/mo),In-place rent ($/mo),Other income ($/mo),Move-in,Lease end,Balance owed ($),Pre-leased (applicant)
101,1BR,700,Occupied,1000,900,25,2026-04-01,2027-03-31,0,
102,1BR,700,Vacant,1000,0,0,,,0,
103,2BR,700,Vacant,1500,0,0,,,0,A. Applicant
`
const ROW = { u101: 12, u102: 13, u103: 14 }
const COLS = TINY.split('\n')[10].split(',')
const edit = (row: number, column: string, value: string) => {
  const g = parseCSV(TINY)
  g[row - 1][COLS.indexOf(column)] = value
  return g.map((r) => r.join(',')).join('\n')
}
const issuesOf = (csv: string) => importCSV(csv).issues

describe('unit rent roll model', () => {
  const p = loaded(importCSV(TINY))
  const a = defaultAssumptions(p, AS_OF)
  a.multifamily!.leaseUpUnitsPerMonth = estimate(1, 'test')
  const [y1, y2] = operatingCashFlows(p, a, AS_OF).years
  const g = a.leasing.marketRentGrowth.value

  it('imports cleanly and keeps no applicant name', () => {
    expect(importCSV(TINY).issues).toEqual([])
    expect(JSON.stringify(p)).not.toMatch(/Applicant/)
  })
  it('leases pre-leased vacant units first, then at the lease-up pace', () => {
    // Pace 1: 103 (pre-leased) leases in month 1, 102 in month 2.
    expect(y1.absorptionTurnoverVacancy).toBe(1000)
    expect(y1.occupancy).toBeCloseTo((12 + 11 + 12) / 36, 10)
  })
  it('shows GPR at market and loss to lease on leased units', () => {
    expect(y1.grossPotentialRent).toBeCloseTo((1000 + 1000 + 1500) * 12, 6)
    expect(y2.grossPotentialRent).toBeCloseTo((1000 + 1000 + 1500) * (1 + g) * 12, 6)
  })
  it('renews at the lower of market and in-place + max increase; the turnover share re-leases at market', () => {
    const t = a.multifamily!.turnoverRate.value
    const cap = a.multifamily!.maxRenewalIncreasePct!.value
    // 101 ends 2027-03-31: 5 months at $900 (Nov–Mar), then the blend; it rolls again 12 months later.
    const r1 = t * 1000 + (1 - t) * Math.min(1000, 900 * (1 + cap))
    const r2 = t * 1000 * (1 + g) + (1 - t) * Math.min(1000 * (1 + g), r1 * (1 + cap))
    expect(r1).toBe(972.5) // 50% at $1,000 + 50% renewing at $945
    expect(y1.lossToLease).toBeCloseTo((1000 - 900) * 5 + (1000 - r1) * 7, 6)
    // Year 2: 101 at r1 for 5 months, then r2; 102 (leased at $1,000 in month 2) pays year-1 rent until its month-14 roll; 103 renews at market.
    const m2 = 1000 * (1 + g)
    expect(y2.lossToLease).toBeCloseTo((m2 - r1) * 5 + (m2 - r2) * 7 + (m2 - 1000), 6)
    expect(y2.lossToLease).toBeGreaterThan(0)
  })
  it('marks to market at the first roll with 100% turnover', () => {
    const all = structuredClone(a)
    all.multifamily!.turnoverRate = estimate(1, 'test')
    const [z1, z2] = operatingCashFlows(p, all, AS_OF).years
    expect(z1.lossToLease).toBeCloseTo(100 * 5, 6)
    expect(z2.lossToLease).toBeCloseTo((1000 * (1 + g) - 1000) * 6, 6)
  })
  it('charges turnover at each roll, not at lease-up', () => {
    const cost = a.multifamily!.turnoverRate.value * a.multifamily!.turnoverCostPerUnit.value
    expect(y1.tenantImprovements).toBeCloseTo(cost, 6)
    expect(y2.tenantImprovements).toBeCloseTo(3 * cost * (1 + a.operating.expenseGrowth.value), 6)
  })
  it('counts other income as Other income', () => {
    expect(y1.otherIncome).toBe(25 * 12)
  })
})

describe('unit rent roll validation', () => {
  const errors = (csv: string) => issuesOf(csv).filter((i) => i.severity === 'error')
  const only = (issues: ImportIssue[], expected: Omit<Partial<ImportIssue>, 'message'> & { message: RegExp }) => {
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ severity: 'error', ...expected })
  }

  it('a missing rent or SF', () => {
    only(errors(edit(ROW.u101, 'Market rent ($/mo)', '')), { row: ROW.u101, column: 'Market rent ($/mo)', message: /Market rent must be a positive/ })
    only(errors(edit(ROW.u101, 'In-place rent ($/mo)', '')), { row: ROW.u101, message: /In-place rent is missing for an occupied unit/ })
    only(errors(edit(ROW.u102, 'SF', '')), { row: ROW.u102, column: 'SF', message: /SF must be a positive number/ })
  })
  it('an occupied unit with zero rent', () => {
    only(errors(edit(ROW.u101, 'In-place rent ($/mo)', '0')), { row: ROW.u101, message: /Occupied with zero rent/ })
  })
  it('an unknown status or a bad date', () => {
    only(errors(edit(ROW.u102, 'Status', 'Model')), { row: ROW.u102, message: /Unknown status "Model"/ })
    only(errors(edit(ROW.u101, 'Lease end', 'soon')), { row: ROW.u101, message: /Lease end "soon" is not a valid date/ })
  })
  it('a missing Units column', () => {
    const csv = TINY.replace('Floor plan,', 'Plan,')
    expect(errors(csv).map((e) => e.message)).toEqual([expect.stringMatching(/Units: missing required column "Floor plan"/)])
  })
  it('a commercial asset type on a unit rent roll, or multifamily on a lease rent roll', () => {
    only(errors(TINY.replace('Asset type,multifamily', 'Asset type,office')), { row: 3, message: /A unit rent roll is multifamily, not "office"/ })
    const override = importCSV(TINY, { assetType: 'retail' }).issues.filter((i) => i.severity === 'error')
    only(override, { row: 3, column: 'Asset type', message: /A unit rent roll is multifamily, not retail/ })
  })
})

describe('unit rent roll warnings still allow the import', () => {
  const warned = (csv: string) => {
    const r = importCSV(csv)
    expect(r.property).not.toBeNull()
    return r.issues
  }
  it('a lease end before move-in, used as given', () => {
    const issues = warned(edit(ROW.u101, 'Move-in', '2027-06-01'))
    expect(issues).toEqual([expect.objectContaining({ severity: 'warning', row: ROW.u101, message: expect.stringMatching(/Lease end \(2027-03-31\) is before move-in \(2027-06-01\)/) })])
  })
  it('an expired or missing lease end: month-to-month', () => {
    expect(warned(edit(ROW.u101, 'Lease end', '2026-08-31'))).toEqual([
      expect.objectContaining({ severity: 'warning', message: expect.stringMatching(/Lease ended on 2026-08-31.*month-to-month/) }),
    ])
    expect(warned(edit(ROW.u101, 'Lease end', ''))).toEqual([expect.objectContaining({ severity: 'warning', message: expect.stringMatching(/No lease end/) })])
  })
  it('a balance owed, but not a credit', () => {
    expect(warned(edit(ROW.u101, 'Balance owed ($)', '250'))).toEqual([
      expect.objectContaining({ severity: 'warning', row: ROW.u101, message: expect.stringMatching(/Balance owed \$250\.00/) }),
    ])
    expect(warned(edit(ROW.u101, 'Balance owed ($)', '-250'))).toEqual([])
  })
  it('a unit count or SF total that differs from the table', () => {
    expect(warned(TINY.replace('Units,3', 'Units,4')).map((i) => i.message)).toEqual([expect.stringMatching(/says 4 units, but the Units table has 3/)])
    expect(warned(TINY.replace('Rentable SF,2100', 'Rentable SF,2500')).map((i) => i.message)).toEqual([
      expect.stringMatching(/units total 2,100 SF, but rentable SF is 2,500/),
    ])
  })
})
