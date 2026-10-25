/**
 * Golden test: Fernhill Commons with the value-add plan on (convention 19).
 *
 * These values were independently validated against an Excel model built only
 * from the written rules and inputs (docs/validation/Fernhill-ValueAdd-Excel-Check.xlsx,
 * matched on Oct 25, 2026: all 228 annual values, all 60 schedule rows and every
 * return metric). The run is the Fernhill validation set
 * (__fixtures__/fernhill-validation.assumptions.json) with the plan on at the
 * inputs below, pinned here so the plan's defaults can move. Only update
 * __fixtures__/fernhill-value-add-benchmark.csv or fernhill-value-add-schedule.csv
 * on purpose when an assumption or method changes, and re-check against Excel
 * when you do. No script writes to the fixtures.
 */
import { describe, expect, it } from 'vitest'
import { SAMPLE_PROPERTIES } from '../../data/sampleProperties'
import { parseCSV } from '../csv'
import asIsFixture from './__fixtures__/fernhill-benchmark.csv?raw'
import fixture from './__fixtures__/fernhill-value-add-benchmark.csv?raw'
import scheduleFixture from './__fixtures__/fernhill-value-add-schedule.csv?raw'
import validation from './__fixtures__/fernhill-validation.assumptions.json'
import { assumptionsFor, VALUE_ADD_KEY } from './edits'
import { goldenChecks, validationSet } from './goldenChecks'
import { underwrite } from './underwrite'

const AS_OF = '2026-10-04'
const CENT = 0.01

/** The value-add inputs Excel was matched at (inputs.md): N, S, P, C, R, D. */
const PLAN = {
  'valueAdd.unitCount': 60,
  'valueAdd.startMonth': 1,
  'valueAdd.maxPerMonth': 4,
  'valueAdd.costPerUnit': 12_500,
  'valueAdd.premiumMonthly': 175,
  'valueAdd.downtimeMonths': 1,
}

const FERNHILL = SAMPLE_PROPERTIES.find((p) => p.id === 'sample-fernhill-commons')
if (!FERNHILL) throw new Error('missing sample-fernhill-commons')
const VALIDATION = validationSet(validation, FERNHILL, AS_OF)
const r = underwrite(FERNHILL, AS_OF, assumptionsFor(FERNHILL, AS_OF, { ...VALIDATION.edits, [VALUE_ADD_KEY]: 1, ...PLAN }))
const plan = r.valueAdd!

const rows = parseCSV(fixture)
const metric = (label: string) => rows.find((x) => x[0] === label && x.length === 2)?.[1]

describe('Fernhill value-add golden benchmark', () => {
  it('runs with the plan on at the pinned inputs, which the fixture shows', () => {
    expect(r.assumptions.valueAdd?.enabled).toBe(true)
    for (const [path, value] of Object.entries(PLAN)) {
      expect(Number(rows.find((x) => x[0] === path && x.length === 4)?.[1]), path).toBe(value)
    }
  })

  goldenChecks(r, fixture)

  it('keeps the as-is purchase price', () => {
    const price = (csv: string) => Number(parseCSV(csv).find((x) => x[0] === 'acquisition.purchasePrice')?.[1])
    expect(price(fixture)).toBe(price(asIsFixture))
  })

  it('matches the plan totals', () => {
    expect(metric('Units renovated')).toBe(`${plan.renovated} of ${plan.target}`)
    expect(metric('Renovation reserve (in total cost)')).toBe('$750,000')
    expect(plan.reserve).toBe(750_000)
    expect(metric('Renovation spend (drawn)')).toBe('$750,000')
    expect(plan.spent).toBe(750_000)
    expect(metric('Unspent reserve returned at sale')).toBe('$0')
    expect(plan.unspent).toBe(0)
    expect(metric('Program finishes (last re-lease)')).toBe(`month ${plan.finishMonth}`)
  })

  it('matches every schedule row: unit, order, months, re-lease rent and costs', () => {
    const [header, ...schedule] = parseCSV(scheduleFixture).filter((x) => x.length > 1)
    expect(header).toEqual(['Unit', 'Floor plan', 'Status', 'Renovation month', 'Re-lease month', 'Re-lease rent ($/mo)', 'Renovation cost', 'Move-out cost', 'Rolls passed over (pace)'])
    expect(schedule).toHaveLength(60)
    expect(plan.renovations).toHaveLength(schedule.length)
    schedule.forEach(([unit, floorPlan, status, month, release, rent, cost, moveOut, passedOver], i) => {
      const x = plan.renovations[i]
      const at = `row ${i + 1} (unit ${unit})`
      expect([x.unit, x.floorPlan, x.status], at).toEqual([unit, floorPlan, status])
      expect([x.month, x.releaseMonth, x.passedOver], at).toEqual([Number(month), Number(release), Number(passedOver)])
      expect(Math.abs(x.releaseRent - Number(rent)), `${at} re-lease rent`).toBeLessThanOrEqual(CENT)
      expect(Math.abs(x.cost - Number(cost)), `${at} cost`).toBeLessThanOrEqual(CENT)
      expect(Math.abs(x.moveOutCost - Number(moveOut)), `${at} move-out cost`).toBeLessThanOrEqual(CENT)
    })
  })
})
