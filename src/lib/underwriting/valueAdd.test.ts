import { describe, expect, it } from 'vitest'
import { SAMPLE_PROPERTIES } from '../../data/sampleProperties'
import type { ApartmentUnit, Property, UnderwritingAssumptions } from '../../types'
import { estimate } from '../sourced'
import validation from './__fixtures__/fernhill-validation.assumptions.json'
import { analystExport } from './analystExport'
import { assumptionSetFile, parseAssumptionSetFile } from './assumptionSets'
import { defaultAssumptions } from './defaults'
import {
  activeEdits,
  assumptionChanges,
  assumptionsFor,
  defaultsFor,
  editableFields,
  parseInput,
  VALUE_ADD_KEY,
  VALUE_ADD_ON,
  valueAddFields,
} from './edits'
import { goldenChecks, validationSet } from './goldenChecks'
import fixture from './__fixtures__/fernhill-benchmark.csv?raw'
import { renovationSchedule } from './renovations'
import { toCSV } from './report'
import { scenarioOverrides, withScenario } from './scenarios'
import { underwrite } from './underwrite'
import { asIsAssumptions, valueAddComparison } from './valueAdd'
import { operatingCashFlows } from './waterfall'

const AS_OF = '2026-10-04' // analysis starts 2026-11-01
const byId = (id: string) => {
  const p = SAMPLE_PROPERTIES.find((x) => x.id === id)
  if (!p) throw new Error(`missing ${id}`)
  return p
}
const FERNHILL = byId('sample-fernhill-commons')

// ---------- a six-unit rent roll worked by hand ----------

const unit = (id: string, over: Partial<ApartmentUnit>): ApartmentUnit => ({
  unit: id,
  floorPlan: 'plan',
  sf: 700,
  occupied: true,
  marketRentMonthly: 1000,
  inPlaceRentMonthly: 900,
  otherIncomeMonthly: 0,
  balanceOwed: 0,
  preLeased: false,
  ...over,
})

/**
 * In rent-roll order. Analysis month 1 is Nov 2026.
 * A rolls in month 1 (lease ends Oct 31), B is month-to-month (month 1), C rolls in month 2,
 * D is on notice with the next resident signed (month 1, a signed lease), E is vacant (first
 * lease in month 1), F is vacant and pre-leased (a signed first lease in month 1).
 */
const UNITS = [
  unit('A', { leaseEndDate: '2026-10-31' }),
  unit('B', {}),
  unit('C', { leaseEndDate: '2026-11-15' }),
  unit('D', { leaseEndDate: '2026-10-31', preLeased: true }),
  unit('E', { occupied: false, inPlaceRentMonthly: 0 }),
  unit('F', { occupied: false, inPlaceRentMonthly: 0, preLeased: true }),
]
const rr = FERNHILL.rentRoll.kind === 'multifamily' ? FERNHILL.rentRoll : null!
const TINY: Property = { ...FERNHILL, id: 'test-tiny', rentRoll: { ...rr, units: UNITS } }

/** Flat rents and costs, so every figure is countable by hand. */
function tinyAssumptions(plan: Partial<Record<'unitCount' | 'startMonth' | 'maxPerMonth' | 'costPerUnit' | 'premiumMonthly' | 'downtimeMonths', number>> = {}, holdYears = 10): UnderwritingAssumptions {
  const a = structuredClone(defaultAssumptions(TINY, AS_OF))
  const set = (x: number) => estimate(x, 'test')
  a.leasing.marketRentGrowth = set(0)
  a.operating.expenseGrowth = set(0)
  a.acquisition.holdYears = set(holdYears)
  a.multifamily!.turnoverRate = set(0.5)
  a.multifamily!.turnoverCostPerUnit = set(1000)
  a.multifamily!.maxRenewalIncreasePct = set(0.05)
  const va = a.valueAdd!
  va.enabled = true
  const v = { unitCount: 4, startMonth: 1, maxPerMonth: 2, costPerUnit: 10_000, premiumMonthly: 100, downtimeMonths: 1, ...plan }
  for (const [k, x] of Object.entries(v)) va[k as keyof typeof v] = set(x)
  return a
}

describe('renovation schedule', () => {
  const r = operatingCashFlows(TINY, tinyAssumptions(), AS_OF)
  const plan = r.valueAdd!
  const [y1, y2] = r.years

  it('takes rolls month by month, in rent-roll order, up to the pace; signed leases are skipped', () => {
    // Month 1: A and B fill the pace of 2 (D and F are signed, E is passed over). Month 2: C.
    // Month 13: D's first unsigned roll comes before E's in rent-roll order and reaches the target of 4.
    expect(plan.renovations.map((x) => [x.unit, x.month, x.releaseMonth, x.status])).toEqual([
      ['A', 1, 2, 'occupied'],
      ['B', 1, 2, 'occupied'],
      ['C', 2, 3, 'occupied'],
      ['D', 13, 14, 'occupied'],
    ])
    expect(plan).toMatchObject({ target: 4, renovated: 4, reserve: 40_000, spent: 40_000, unspent: 0, finishMonth: 14 })
  })
  it('counts the roll a full month passed over', () => {
    const s = renovationSchedule([{ firstRoll: 0, signed: false }, { firstRoll: 0, signed: false }], tinyAssumptions({ maxPerMonth: 1, unitCount: 2 }).valueAdd!, 10)
    // The second unit renews in month 1 and is renovated at its next roll, month 13.
    expect(s).toEqual([{ month: 0, passedOver: 0 }, { month: 12, passedOver: 1 }])
  })
  it('starts no earlier than the start month and no later than the last hold month', () => {
    const va = tinyAssumptions({ startMonth: 6, unitCount: 3 }).valueAdd!
    const s = renovationSchedule([{ firstRoll: 0, signed: false }, { firstRoll: 5, signed: false }, { firstRoll: 12, signed: false }], va, 1)
    expect(s.map((x) => x.month)).toEqual([null, 5, null])
  })
  it('renovates a vacant unit at its first lease with no move-out cost', () => {
    const lease = operatingCashFlows(TINY, tinyAssumptions({ maxPerMonth: 3 }), AS_OF).valueAdd!
    expect(lease.renovations.slice(0, 3).map((x) => [x.unit, x.status, x.moveOutCost])).toEqual([
      ['A', 'occupied', 1000],
      ['B', 'occupied', 1000],
      ['E', 'lease-up', 0],
    ])
  })

  it('carries the renovated unit at market + premium in GPR from its renovation month, offline for the downtime', () => {
    // A, B: 12 × $1,100; C: $1,000 in month 1, then 11 × $1,100; D, E, F at $1,000.
    expect(y1.grossPotentialRent).toBe(13_200 + 13_200 + 13_100 + 3 * 12_000)
    expect(y2.grossPotentialRent).toBe(4 * 13_200 + 2 * 12_000)
    // Downtime: A and B in month 1, C in month 2; D in month 13.
    expect(y1.absorptionTurnoverVacancy).toBe(3 * 1100)
    expect(y2.absorptionTurnoverVacancy).toBe(1100)
    expect(y1.occupancy).toBeCloseTo((11 + 11 + 11 + 12 + 12 + 12) / 72, 12)
  })
  it('puts renovation downtime on top of the general vacancy floor', () => {
    // All of year 1's absorption vacancy is downtime, so none of it offsets the 5% floor.
    expect(y1.renovationDowntime).toBe(3300)
    expect(y1.generalVacancy).toBeCloseTo(0.05 * (75_500 - 100), 9)
    expect(y2.generalVacancy).toBeCloseTo(0.05 * 76_800, 9)
    // Lease-up vacancy still offsets it: hold E back three months with a pace of 1 behind F.
    const a = tinyAssumptions({ unitCount: 0 })
    a.multifamily!.leaseUpUnitsPerMonth = estimate(1, 'test')
    const [z1] = operatingCashFlows(TINY, a, AS_OF).years
    expect(z1.renovationDowntime).toBe(0)
    expect(z1.absorptionTurnoverVacancy).toBe(1000)
    expect(z1.generalVacancy).toBeCloseTo(0.05 * (z1.grossPotentialRent - z1.lossToLease) - 1000, 9)
  })
  it('drops renovation downtime from the normalized exit year', () => {
    // C rolls in month 110 and is offline through month 121, in year 11.
    const r = underwrite(TINY, AS_OF, tinyAssumptions({ startMonth: 110, unitCount: 1, downtimeMonths: 12 }))
    expect(r.forwardYear.renovationDowntime).toBeGreaterThan(0)
    expect(r.normalizedExitYear.renovationDowntime).toBe(0)
    expect(r.normalizedExitYear.absorptionTurnoverVacancy).toBe(0)
  })
  it('re-leases at the renovated rent with no renewal blend, and blends on it afterwards', () => {
    // Only C's month at $900 against $1,000 is loss to lease; renovated units lease at $1,100.
    expect(y1.lossToLease).toBe(100)
    // Year 2: A, B and C roll again; the blend on $1,100 keeps them at $1,100.
    expect(y2.lossToLease).toBe(0)
  })
  it('charges the full move-out cost at renovation and the usual turnover share later', () => {
    // Year 1: A, B, C move out ($1,000 each) and D's signed lease ($1,000, as without the plan).
    expect(y1.tenantImprovements).toBe(4000)
    // Year 2: D moves out for renovation ($1,000); A, B, C, E and F roll at 50% × $1,000.
    expect(y2.tenantImprovements).toBe(1000 + 5 * 500)
  })
  it('spends the renovation cost below NOI, funded from the reserve', () => {
    expect([y1.renovationCapex, y1.renovationReserveDraw, y1.unitsRenovated]).toEqual([30_000, 30_000, 3])
    expect([y2.renovationCapex, y2.renovationReserveDraw, y2.unitsRenovated]).toEqual([10_000, 10_000, 1])
    expect(y1.cashFlowBeforeDebt).toBe(y1.netOperatingIncome - y1.tenantImprovements - y1.capitalReserves)
  })
  it('grows the premium with market rent', () => {
    const a = tinyAssumptions()
    a.leasing.marketRentGrowth = estimate(0.03, 'test')
    const d = operatingCashFlows(TINY, a, AS_OF).valueAdd!.renovations.find((x) => x.unit === 'D')!
    expect(d.releaseRent).toBeCloseTo(1100 * 1.03, 9)
  })
  it('re-leases in the renovation month with no downtime', () => {
    const [z1] = operatingCashFlows(TINY, tinyAssumptions({ downtimeMonths: 0 }), AS_OF).years
    expect(z1.absorptionTurnoverVacancy).toBe(0)
  })

  it('funds the reserve at closing and returns what is not drawn at sale', () => {
    // A one-year hold reaches A, B and C only.
    const a = tinyAssumptions({}, 1)
    const r1 = underwrite(TINY, AS_OF, a)
    const off = underwrite(TINY, AS_OF, asIsAssumptions(a))
    expect(r1.valueAdd).toMatchObject({ renovated: 3, reserve: 40_000, spent: 30_000, unspent: 10_000, finishMonth: null })
    expect(r1.metrics.totalCost - off.metrics.totalCost).toBeCloseTo(40_000, 6)
    expect(r1.metrics.equityRequired - off.metrics.equityRequired).toBeCloseTo(40_000, 6)
    const y = r1.cashFlows[0]
    expect(y.unspentReserveReturned).toBe(10_000)
    expect(y.unleveredCashFlow).toBeCloseTo(y.cashFlowBeforeDebt + y.saleProceeds + 10_000, 6)
    expect(y.leveredCashFlow).toBeCloseTo(y.cashFlowAfterDebt + y.saleProceeds - y.loanPayoff + 10_000, 6)
    expect(r1.warnings.join(' ')).toMatch(/3 of 4 units are renovated within the 1-year hold/)
  })
})

// ---------- Fernhill ----------

const SET = validationSet(validation, FERNHILL, AS_OF).edits
const ON = { ...SET, [VALUE_ADD_KEY]: 1 }

describe('value-add plan on Fernhill', () => {
  const asIs = underwrite(FERNHILL, AS_OF, assumptionsFor(FERNHILL, AS_OF, SET))

  it('is off by default and leaves the golden run untouched', () => {
    expect(defaultsFor(FERNHILL, AS_OF).valueAdd).toMatchObject({ enabled: false, units: 120, unitCount: { value: 60 } })
    expect(asIs.valueAdd).toBeUndefined()
  })
  describe('with inert inputs while off', () => {
    const inert = { ...SET, 'valueAdd.costPerUnit': 20_000, 'valueAdd.premiumMonthly': 300, 'scenarios.downside.valueAdd.premiumMonthly': -0.5 }
    const r = underwrite(FERNHILL, AS_OF, assumptionsFor(FERNHILL, AS_OF, inert))
    goldenChecks(r, fixture)
    it('gives byte-identical CSV and analyst JSON', () => {
      expect(toCSV(r, FERNHILL.name)).toBe(toCSV(asIs, FERNHILL.name))
      const json = (x: typeof r, edits: typeof SET) => {
        const { meta: _meta, ...rest } = analystExport(FERNHILL, AS_OF, x, { name: 'Validation', edits })
        return JSON.stringify(rest)
      }
      expect(json(r, inert)).toBe(json(asIs, SET))
      expect(activeEdits(inert)).toEqual(SET)
      expect(assumptionChanges(r.assumptions, defaultsFor(FERNHILL, AS_OF))).not.toContain(VALUE_ADD_ON)
    })
    it('applies no value-add presets', () => {
      const keys = scenarioOverrides(r.assumptions, 'downside', inert).map((o) => o.key)
      expect(keys.some((k) => k.startsWith('valueAdd.'))).toBe(false)
    })
  })

  describe('when on', () => {
    const a = assumptionsFor(FERNHILL, AS_OF, ON)
    const r = underwrite(FERNHILL, AS_OF, a)
    const cmp = valueAddComparison(FERNHILL, AS_OF, a)!
    if (cmp.status !== 'ok') throw new Error(cmp.reason)
    const plan = r.valueAdd!

    it('keeps the as-is price', () => {
      expect(a.acquisition.purchasePrice.value).toBe(asIs.metrics.purchasePrice)
      // The estimated price is worked out with the plan off.
      expect(assumptionsFor(FERNHILL, AS_OF, { [VALUE_ADD_KEY]: 1 }).acquisition.purchasePrice).toEqual(defaultsFor(FERNHILL, AS_OF).acquisition.purchasePrice)
      const capOnly = { 'acquisition.marketCapRate': 0.07 }
      expect(assumptionsFor(FERNHILL, AS_OF, { ...capOnly, [VALUE_ADD_KEY]: 1 }).acquisition.purchasePrice.value).toBe(
        assumptionsFor(FERNHILL, AS_OF, capOnly).acquisition.purchasePrice.value,
      )
    })
    it('renovates the target within the pace, from the start month, never on a signed lease', () => {
      expect(plan).toMatchObject({ target: 60, renovated: 60, reserve: 750_000, spent: 750_000, unspent: 0 })
      const perMonth = new Map<number, number>()
      for (const x of plan.renovations) perMonth.set(x.month, (perMonth.get(x.month) ?? 0) + 1)
      expect(Math.max(...perMonth.values())).toBeLessThanOrEqual(4)
      expect(new Set(plan.renovations.map((x) => x.unit)).size).toBe(60)
      const months = plan.renovations.map((x) => x.month)
      expect(months).toEqual([...months].sort((x, y) => x - y))
      const signed = rr.units!.filter((u) => u.preLeased).map((u) => u.unit)
      expect(plan.renovations.filter((x) => signed.includes(x.unit) && x.month === 1)).toEqual([])
    })
    it('adds the reserve to total cost and equity, and nothing to the loan', () => {
      expect(r.metrics.totalCost - asIs.metrics.totalCost).toBeCloseTo(750_000, 4)
      expect(r.metrics.equityRequired - asIs.metrics.equityRequired).toBeCloseTo(750_000, 4)
      expect(r.metrics.loanAmount).toBe(asIs.metrics.loanAmount)
      expect(r.cashFlows.reduce((s, c) => s + c.renovationCapex, 0)).toBeCloseTo(750_000, 6)
    })
    it('compares with the as-is case: value created is the exit value uplift less the spend', () => {
      expect(cmp.asIs.metrics.exitValue).toBe(asIs.metrics.exitValue)
      expect(cmp.valueCreated).toBeCloseTo(r.metrics.exitValue - asIs.metrics.exitValue - 750_000, 6)
      expect(cmp.returnOnCost).toBeCloseTo((175 * 12) / 12_500, 12)
      expect(cmp.rows.map((x) => x.key)).toEqual([
        'year1NOI',
        'stabilizedNOI',
        'programFinish',
        'unitsRenovated',
        'reserve',
        'spend',
        'unspent',
        'returnOnCost',
        'exitValue',
        'valueCreated',
        'equityRequired',
        'unleveredIRR',
        'leveredIRR',
        'equityMultiple',
        'minimumDSCR',
      ])
      expect(cmp.pace.reduce((s, y) => s + y.units, 0)).toBe(60)
      expect(cmp.pace.at(-1)!.cumulativeShare).toBe(1)
      // Downtime comes on top of the vacancy floor, so the plan costs Year-1 NOI.
      expect(r.cashFlows[0].netOperatingIncome).toBeLessThan(asIs.cashFlows[0].netOperatingIncome)
    })
    it('lists the plan as a change and its inputs as assumptions', () => {
      const changes = assumptionChanges(a, defaultsFor(FERNHILL, AS_OF))
      expect(changes).toContain(VALUE_ADD_ON)
      expect(editableFields(a).filter((f) => f.group === 'Value-add').map((f) => f.key)).toEqual([
        'valueAdd.unitCount',
        'valueAdd.startMonth',
        'valueAdd.maxPerMonth',
        'valueAdd.costPerUnit',
        'valueAdd.premiumMonthly',
        'valueAdd.downtimeMonths',
      ])
    })
    it('adds the value-add lines to the CSV', () => {
      const csv = toCSV(r, FERNHILL.name)
      for (const line of ['Units renovated (started)', '  of which renovation downtime', 'Renovation capex', 'Funded from renovation reserve', 'Unspent reserve returned']) {
        expect(csv).toContain(`\n${line},`)
      }
      expect(toCSV(asIs, FERNHILL.name)).not.toMatch(/Renovation|valueAdd/)
    })
    it('stresses the premium and cost in Downside only', () => {
      const down = withScenario(a, 'downside', ON)
      expect(down.valueAdd!.premiumMonthly.value).toBeCloseTo(175 * 0.75, 9)
      expect(down.valueAdd!.costPerUnit.value).toBeCloseTo(12_500 * 1.15, 9)
      expect(underwrite(FERNHILL, AS_OF, down).valueAdd!.reserve).toBeCloseTo(60 * 12_500 * 1.15, 6)
      const up = withScenario(a, 'upside', ON)
      expect([up.valueAdd!.premiumMonthly.value, up.valueAdd!.costPerUnit.value]).toEqual([175, 12_500])
    })
  })

  it('round-trips through an assumption set, inputs and presets included', () => {
    const edits = { ...ON, 'valueAdd.unitCount': 45, 'valueAdd.maxPerMonth': 6, 'scenarios.downside.valueAdd.costPerUnit': 0.25 }
    const parsed = parseAssumptionSetFile(assumptionSetFile(FERNHILL.id, { name: 'Plan', savedAt: '2026-10-25', edits }), FERNHILL, AS_OF)
    expect(parsed.errors).toEqual([])
    expect(parsed.set?.edits).toEqual(edits)
    // Off, the inputs still load (kept, inert).
    const { [VALUE_ADD_KEY]: _on, ...off } = edits
    expect(parseAssumptionSetFile(assumptionSetFile(FERNHILL.id, { name: 'Plan', savedAt: '2026-10-25', edits: off }), FERNHILL, AS_OF).errors).toEqual([])
  })

  it('takes the unit count as a whole number or a percent of units, rounded down', () => {
    const f = valueAddFields(defaultsFor(FERNHILL, AS_OF)).find((x) => x.key === 'valueAdd.unitCount')!
    expect(parseInput(f, '50%')).toEqual({ value: 60 })
    expect(parseInput(f, '33%')).toEqual({ value: 39 })
    expect(parseInput(f, '45')).toEqual({ value: 45 })
    expect(parseInput(f, '121')).toHaveProperty('error')
  })

  it('is offered only for unit rent rolls', () => {
    for (const id of ['sample-jewelry-lofts', 'sample-atwells-retail-row']) {
      const p = byId(id)
      expect(defaultsFor(p, AS_OF).valueAdd).toBeUndefined()
      const set = assumptionSetFile(id, { name: 'X', savedAt: '2026-10-25', edits: { [VALUE_ADD_KEY]: 1 } })
      expect(parseAssumptionSetFile(set, p, AS_OF).errors).toEqual([`Unknown assumption "${VALUE_ADD_KEY}" for this property.`])
    }
  })
})
