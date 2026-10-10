import { describe, expect, it } from 'vitest'
import fernhillDoc from '../../docs/samples/fernhill-commons-unit-rent-roll.csv?raw'
import type { Property } from '../types'
import { parseCSV } from './csv'
import { dealFile, isImportedDeal, propertyFromDealFile } from './importedDeals'
import { averageInPlaceRent, occupancy } from './metrics'
import { parseRentRoll, type DealDetails, type ImportIssue } from './rentRollImport'
import { estimate } from './sourced'
import { defaultAssumptions } from './underwriting/defaults'
import { rentRollView } from './underwriting/fullView'
import { cashFlowRows, MF_OCCUPANCY_LABEL, toTable } from './underwriting/report'
import { sensitivityGrids } from './underwriting/sensitivity'
import { underwrite } from './underwriting/underwrite'
import { operatingCashFlows } from './underwriting/waterfall'

const AS_OF = '2026-10-04'
const DETAILS: DealDetails = { buildingClass: 'B', submarket: 'olneyville' }

const importCSV = (csv: string, details: DealDetails = {}) => parseRentRoll(parseCSV(csv), { fileName: 'test.csv', asOf: AS_OF, details })
const loaded = (r: ReturnType<typeof parseRentRoll>): Property => {
  if (!r.property) throw new Error(`import failed: ${JSON.stringify(r.issues.filter((i) => i.severity === 'error'))}`)
  return r.property
}
const matching = (issues: ImportIssue[], re: RegExp) => issues.filter((i) => re.test(i.message))

describe('Fernhill Commons unit rent roll (sample)', () => {
  const r = importCSV(fernhillDoc, DETAILS)
  const p = loaded(r)
  const rr = p.rentRoll

  it('imports with warnings only', () => {
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(r.fileDetails).toEqual({ assetType: 'multifamily' })
    expect(p).toMatchObject({ id: 'deal-fernhill-commons-apartments', name: 'Fernhill Commons Apartments', assetType: 'multifamily', isSample: true })
    expect(r.summary).toEqual({ kind: 'multifamily', name: p.name, rentableSF: 95_040, units: 120, occupiedUnits: 110, floorPlans: 4 })
  })

  it('aggregates 120 units into 4 floor plans', () => {
    if (rr.kind !== 'multifamily') throw new Error('expected multifamily')
    expect(rr.units).toHaveLength(120)
    expect(rr.unitTypes.map((u) => [u.label, u.unitCount, u.occupiedUnits, u.avgSF])).toEqual([
      ['735 SF', 48, 44, 735],
      ['560 SF', 30, 28, 560],
      ['960 SF', 30, 27, 960],
      ['1180 SF', 12, 11, 1180],
    ])
    expect(occupancy(p, AS_OF)).toBeCloseTo(110 / 120, 10)
    expect(p.physical.unitCount?.value).toBe(120)
    expect(rr.unitTypes.every((u) => u.marketRentMonthly.source === 'imported')).toBe(true)
    expect(rr.units?.filter((u) => u.preLeased).map((u) => [u.unit, u.occupied])).toEqual([
      ['117', false],
      ['214', true],
      ['305', false],
      ['427', false],
    ])
  })

  it('averages $1,566.45 in place on occupied units against $1,620.25 market', () => {
    expect(averageInPlaceRent(p, AS_OF)).toBeCloseTo(1566.45, 2)
    expect(p.market.marketRent.value).toBe(1620.25)
    expect(p.market.marketRent.source).toBe('imported')
    const result = underwrite(p, AS_OF)
    expect(result.metrics.inPlaceRent).toBeCloseTo(1566.45, 2)
    expect(result.metrics.marketRent).toBe(1620.25)
  })

  it('warns on balances owed and month-to-month leases', () => {
    expect(matching(r.issues, /before move-in/)).toEqual([])
    expect(matching(r.issues, /^Balance owed/).map((i) => i.row)).toEqual([21, 64, 105])
    expect(matching(r.issues, /^Balance owed \$1,260\.00/)[0]).toMatchObject({ row: 64, column: 'Balance owed ($)' })
    expect(matching(r.issues, /^Lease ended on 2026-07-31.* month-to-month/).map((i) => i.row)).toEqual([39])
    expect(matching(r.issues, /^No lease end/).map((i) => i.row)).toEqual([96])
  })

  it('models other income, lease-up and turnover', () => {
    const a = defaultAssumptions(p, AS_OF)
    expect(a.multifamily?.leaseUpUnitsPerMonth).toMatchObject({ value: 8, source: 'estimated' })
    const years = operatingCashFlows(p, a, AS_OF).years
    expect(years[0].otherIncome).toBeCloseTo(3_262 * 12, 6)
    expect(years[0].absorptionTurnoverVacancy).toBeGreaterThan(0)
    expect(years[1].absorptionTurnoverVacancy).toBe(0)
    expect(years[0].tenantImprovements).toBeGreaterThan(0)
    expect(years[1].occupancy).toBe(1)
  })

  it('moves unit 214 (on notice, future resident signed) straight to the new lease at its move-out', () => {
    if (rr.kind !== 'multifamily') throw new Error('expected multifamily')
    const u214 = rr.units!.find((u) => u.unit === '214')!
    // In place $1,260 against $1,295 market; moves out 2026-10-31, so the new lease starts in month 1 (Nov 2026).
    expect(u214).toMatchObject({ occupied: true, preLeased: true, inPlaceRentMonthly: 1260, marketRentMonthly: 1295, leaseEndDate: '2026-10-31' })
    const only = (unit: typeof u214): Property => ({ ...p, rentRoll: { ...rr, units: [unit] } })
    // No renewal cap, so a renewal would stay below market and the two paths differ.
    const a = defaultAssumptions(p, AS_OF)
    a.multifamily!.maxRenewalIncreasePct = estimate(0, 'test')
    const t = a.multifamily!.turnoverRate.value
    const cost = a.multifamily!.turnoverCostPerUnit.value
    const g = a.leasing.marketRentGrowth.value
    const costG = a.operating.expenseGrowth.value
    const years = (unit: typeof u214) => operatingCashFlows(only(unit), a, AS_OF).years

    const [y1, y2] = years(u214)
    expect(y1.lossToLease).toBe(0)
    expect(y1.tenantImprovements).toBe(cost)
    expect(y1.absorptionTurnoverVacancy).toBe(0)
    expect(y1.occupancy).toBe(1)
    // A year later it rolls like any lease: the turnover blend, at turnover rate × cost.
    const m2 = 1295 * (1 + g)
    expect(y2.lossToLease).toBeCloseTo((m2 - (t * m2 + (1 - t) * 1295)) * 12, 6)
    expect(y2.tenantImprovements).toBeCloseTo(t * cost * (1 + costG), 6)

    // Without the future resident, the lease end is a renewal-or-turnover blend.
    const [n1] = years({ ...u214, preLeased: false })
    expect(n1.lossToLease).toBeCloseTo((1295 - (t * 1295 + (1 - t) * 1260)) * 12, 6)
    expect(n1.tenantImprovements).toBe(t * cost)

    // At the future lease rent when the file gives one.
    const [f1] = years({ ...u214, futureRentMonthly: 1250 })
    expect(f1.lossToLease).toBeCloseTo(45 * 12, 6)
    expect(f1.tenantImprovements).toBe(cost)
  })

  it('defaults the max renewal increase to an EST 5%, so loss to lease burns off over several years', () => {
    const a = defaultAssumptions(p, AS_OF)
    expect(a.multifamily?.maxRenewalIncreasePct).toMatchObject({ value: 0.05, source: 'estimated' })
    const ltl = operatingCashFlows(p, a, AS_OF).years.map((y) => y.lossToLease)
    expect(ltl[0]).toBeGreaterThan(ltl[1])
    expect(ltl[1]).toBeGreaterThan(ltl[2])
    expect(ltl[2]).toBeGreaterThan(ltl[3])
  })

  it('shows GPR at market, then loss to lease, with physical occupancy labeled', () => {
    const r = underwrite(p, AS_OF)
    expect(cashFlowRows(r).slice(0, 3).map((x) => x.label)).toEqual([MF_OCCUPANCY_LABEL, 'Gross potential rent (at market)', 'Less: loss to lease'])
    expect(toTable(r)).toContain(MF_OCCUPANCY_LABEL)
    for (const c of r.cashFlows) {
      const egi = c.grossPotentialRent - c.lossToLease - c.absorptionTurnoverVacancy + c.otherIncome - c.generalVacancy - c.creditLoss
      expect(c.effectiveGrossIncome).toBeCloseTo(egi, 6)
    }
  })

  it('warns that the levered IRR swings across rent growth', () => {
    const r = underwrite(p, AS_OF)
    expect(sensitivityGrids(p, AS_OF, r.assumptions).warnings).toContainEqual(expect.stringMatching(/^Levered IRR swings [\d.]+ points across the rent-growth cases/))
  })

  it('underwrites to finite returns', () => {
    const m = underwrite(p, AS_OF).metrics
    expect(m.purchasePrice).toBeGreaterThan(0)
    expect(Number.isFinite(m.unleveredIRR)).toBe(true)
    expect(Number.isFinite(m.leveredIRR)).toBe(true)
  })

  it('shows loss to lease per floor plan', () => {
    const view = rentRollView(p, underwrite(p, AS_OF), AS_OF)
    if (view.kind !== 'unit-mix') throw new Error('expected unit mix')
    expect(view.byUnit).toBe(true)
    expect(view.source.source).toBe('imported')
    const b = view.rows.find((x) => x.floorPlan === '735 SF')!
    expect(b).toMatchObject({ units: '48', occupied: '44', vacant: '4', preLeased: '1', market: '$1,525.00', inPlace: '$1,451.93' })
    expect(b.lossToLease).toBe('$73.07')
    expect(view.rows.find((x) => x.floorPlan === '960 SF')).toMatchObject({ lossToLease: '$45.56', lossToLeasePct: '2.5%', lossToLeaseAnnual: '$14,760' })
    expect(view.totals).toMatchObject({ lossToLease: '$51.27', lossToLeasePct: '3.2%', lossToLeaseAnnual: '$67,680' })
    expect(view.totals).toMatchObject({ units: '120', occupied: '110', vacant: '10', preLeased: '3', market: '$1,620.25', inPlace: '$1,566.45' })
  })

  it('round-trips as a stored deal', () => {
    const stored: unknown = JSON.parse(JSON.stringify(dealFile(p)))
    expect(isImportedDeal(p)).toBe(true)
    expect(propertyFromDealFile(stored)).toEqual(JSON.parse(JSON.stringify(p)))
  })
})

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
  it('leases a pre-leased vacant unit at its future lease rent when the file gives one', () => {
    if (p.rentRoll.kind !== 'multifamily') throw new Error('expected multifamily')
    const units = p.rentRoll.units!.map((u) => (u.unit === '103' ? { ...u, futureRentMonthly: 1450 } : u))
    const [f1] = operatingCashFlows({ ...p, rentRoll: { ...p.rentRoll, units } }, a, AS_OF).years
    expect(f1.lossToLease).toBeCloseTo(y1.lossToLease + 50 * 12, 6)
    expect(f1.tenantImprovements).toBe(y1.tenantImprovements)
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

describe('future lease rent', () => {
  /** TINY with a Future lease rent column; one value per unit (101 occupied, 102 vacant, 103 vacant pre-leased). */
  const withFuture = (values: [string, string, string]) =>
    TINY.split('\n')
      .map((line, i) => (i === 10 ? `${line},Future lease rent ($/mo)` : i >= 11 && i <= 13 ? `${line},${values[i - 11]}` : line))
      .join('\n')
  const unit = (csv: string, id: string) => {
    const rr = loaded(importCSV(csv)).rentRoll
    return rr.kind === 'multifamily' ? rr.units?.find((u) => u.unit === id) : undefined
  }

  it('keeps the future rent on a pre-leased unit; without the column there is none', () => {
    expect(importCSV(withFuture(['', '', '1450'])).issues).toEqual([])
    expect(unit(withFuture(['', '', '1450']), '103')?.futureRentMonthly).toBe(1450)
    expect(unit(TINY, '103')).not.toHaveProperty('futureRentMonthly')
  })
  it('warns and ignores it on a unit that isn\'t pre-leased', () => {
    const csv = withFuture(['950', '', ''])
    expect(importCSV(csv).issues).toEqual([
      expect.objectContaining({ severity: 'warning', row: ROW.u101, column: 'Future lease rent ($/mo)', message: expect.stringMatching(/^Future lease rent \$950\.00 on a unit that isn't pre-leased is ignored/) }),
    ])
    expect(unit(csv, '101')).not.toHaveProperty('futureRentMonthly')
  })
  it('rejects a rent that isn\'t positive', () => {
    expect(importCSV(withFuture(['', '', '0'])).issues).toEqual([
      expect.objectContaining({ severity: 'error', row: ROW.u103, message: expect.stringMatching(/^Future lease rent must be a positive/) }),
    ])
  })
})
