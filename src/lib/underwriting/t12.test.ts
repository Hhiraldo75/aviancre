import { describe, expect, it } from 'vitest'
import fernhillT12 from '../../../docs/samples/fernhill-commons-t12.csv?raw'
import { SAMPLE_PROPERTIES } from '../../data/sampleProperties'
import type { Property, TaxRecord, UnderwritingAssumptions } from '../../types'
import { parseCSV } from '../csv'
import { fromImport, fromPublic } from '../sourced'
import { withoutT12, withT12 } from '../t12'
import { readT12, statementFrom } from '../t12Read'
import { analystExport } from './analystExport'
import { assumptionSetFile, parseAssumptionSetFile, reconcileExpenseEdits } from './assumptionSets'
import { defaultAssumptions, priceWithoutT12 } from './defaults'
import { assumptionsFor, editableFields } from './edits'
import { rentRollOtherIncome, t12Check } from './t12Check'
import { underwrite } from './underwrite'

const AS_OF = '2026-10-04' // analysis starts 2026-11-01: 13 months after the T-12's first month
const GROWTH = Math.pow(1.03, 13 / 12)
const byId = (id: string) => SAMPLE_PROPERTIES.find((p) => p.id === id)!
const FERNHILL = byId('sample-fernhill-commons') // unit rent roll
const FEDERAL_HILL = byId('sample-federal-hill-apartments') // unit-type rent roll
const ATWELLS = byId('sample-atwells-retail-row') // commercial
const statement = (kind: 'multifamily' | 'commercial') =>
  statementFrom(readT12(parseCSV(fernhillT12), { kind }), { fileName: 'fernhill-commons-t12.csv', importedAt: '2026-10-24' })
const WITH_T12 = withT12(FERNHILL, statement('multifamily'))

/** An engine run without its timestamp and inputs, for exact comparisons of the results. */
const run = (p: Property, a: UnderwritingAssumptions) => {
  const { generatedAt: _g, assumptions: _a, ...rest } = underwrite(p, AS_OF, a)
  return rest
}
const withOtherIncome = (a: UnderwritingAssumptions, value: number): UnderwritingAssumptions => ({
  ...a,
  operating: { ...a.operating, otherIncomeYear1: fromImport(value, 'test') },
})

describe('engine: Year-1 other income', () => {
  it('reproduces the rent roll’s other income exactly when set to it (unit and unit-type rent rolls)', () => {
    for (const p of [FERNHILL, FEDERAL_HILL]) {
      const a = defaultAssumptions(p, AS_OF)
      const year1 = run(p, a).cashFlows[0].otherIncome
      expect(year1).toBe(rentRollOtherIncome(p))
      expect(run(p, withOtherIncome(a, year1))).toEqual(run(p, a))
    }
  })
  it('replaces the rent roll’s figure for multifamily and grows it at rent growth', () => {
    const a = defaultAssumptions(FEDERAL_HILL, AS_OF)
    const r = run(FEDERAL_HILL, withOtherIncome(a, 50_000)).cashFlows
    expect(r[0].otherIncome).toBe(50_000)
    expect(r[1].otherIncome).toBeCloseTo(50_000 * (1 + a.leasing.marketRentGrowth.value), 6)
  })
  it('adds other income for commercial, which has none without it', () => {
    const a = defaultAssumptions(ATWELLS, AS_OF)
    expect(run(ATWELLS, a).cashFlows.every((c) => c.otherIncome === 0)).toBe(true)
    expect(run(ATWELLS, withOtherIncome(a, 0))).toEqual(run(ATWELLS, a))
    const r = run(ATWELLS, withOtherIncome(a, 12_000))
    expect(r.cashFlows[0].otherIncome).toBe(12_000)
    expect(r.cashFlows[2].otherIncome).toBeCloseTo(12_000 * Math.pow(1 + a.leasing.marketRentGrowth.value, 2), 6)
    expect(r.cashFlows[0].netOperatingIncome).toBeGreaterThan(run(ATWELLS, a).cashFlows[0].netOperatingIncome)
  })
})

describe('defaults with a T-12', () => {
  const a = defaultAssumptions(WITH_T12, AS_OF)
  it('take Year-1 expenses and other income from it (ACT), and leave everything else alone', () => {
    expect(a.operating.expenses).toHaveLength(7)
    expect(a.operating.expenses.every((e) => e.annualAmount.source === 'imported')).toBe(true)
    expect(a.operating.otherIncomeYear1!.value).toBeCloseTo(88_800 * GROWTH, 2)
    const plain = defaultAssumptions(FERNHILL, AS_OF)
    expect(plain.operating.otherIncomeYear1).toBeUndefined()
    expect({ ...a, acquisition: null, operating: null }).toEqual({ ...plain, acquisition: null, operating: null })
  })
  it('move the estimated price, and the price says from what', () => {
    const before = defaultAssumptions(FERNHILL, AS_OF).acquisition.purchasePrice.value
    expect(priceWithoutT12(WITH_T12, AS_OF)).toBe(before)
    expect(a.acquisition.purchasePrice.value).toBeGreaterThan(before)
    expect(a.acquisition.purchasePrice.notes).toMatch(/Loading the T-12 \(Oct 2025 – Sep 2026\) moved the estimated price from \$16,498,774 to \$17,749,638$/)
    const notes = underwrite(WITH_T12, AS_OF, a).notes
    expect(notes).toContain('Loading the T-12 (Oct 2025 – Sep 2026) moved the estimated price from $16,498,774 to $17,749,638.')
    expect(notes.join(' ')).toMatch(/Year-1 operating expenses and other income are T-12 actuals/)
    expect(underwrite(FERNHILL, AS_OF, defaultAssumptions(FERNHILL, AS_OF)).notes.join(' ')).not.toMatch(/T-12/)
  })
  it('make other income an editable assumption only when a T-12 sets it', () => {
    expect(editableFields(a).map((f) => f.key)).toContain('operating.otherIncomeYear1')
    expect(editableFields(defaultAssumptions(FERNHILL, AS_OF)).map((f) => f.key)).not.toContain('operating.otherIncomeYear1')
  })
})

describe('edits with a T-12', () => {
  it('re-grow the T-12 lines at an edited expense growth, but keep a line the analyst entered', () => {
    const a = assumptionsFor(WITH_T12, AS_OF, { 'operating.expenseGrowth': 0.05, 'operating.expenses.1.annualAmount': 90_000 })
    expect(a.operating.expenses[0].annualAmount.value).toBeCloseTo(231_600 * Math.pow(1.05, 13 / 12), 2)
    expect(a.operating.expenses[0].annualAmount.notes).toMatch(/at 5%\/yr expense growth/)
    expect(a.operating.expenses[1].annualAmount.value).toBe(90_000)
    expect(a.operating.otherIncomeYear1!.value).toBeCloseTo(88_800 * GROWTH, 2)
  })
  it('re-grow other income at an edited rent growth, unless entered', () => {
    expect(assumptionsFor(WITH_T12, AS_OF, { 'leasing.marketRentGrowth': 0 }).operating.otherIncomeYear1!.value).toBe(88_800)
    expect(assumptionsFor(WITH_T12, AS_OF, { 'leasing.marketRentGrowth': 0, 'operating.otherIncomeYear1': 70_000 }).operating.otherIncomeYear1!.value).toBe(70_000)
  })
})

describe('assumption sets and expense lines', () => {
  const plainSet = { name: 'Plain', savedAt: '2026-10-08', edits: { 'operating.expenses.0.annualAmount': 816_000, 'exit.exitCapRate': 0.08 } }
  it('drop expense edits made on the single benchmark line once a T-12 is loaded, and say so', () => {
    const r = reconcileExpenseEdits(WITH_T12, AS_OF, plainSet.edits, undefined, 'Plain')
    expect(r.edits).toEqual({ 'exit.exitCapRate': 0.08 })
    expect(r.notice).toBe(
      'Dropped 1 operating expense edit from “Plain”: it was made on the single benchmark line “Operating expenses”, and this property now has ' +
        '7 T-12 lines (Property taxes, Insurance, Utilities, …). Re-enter them on the current lines if you still want them.',
    )
    expect(reconcileExpenseEdits(FERNHILL, AS_OF, plainSet.edits, undefined)).toEqual({ edits: plainSet.edits, notice: null })
  })
  it('drop expense edits made on T-12 lines once the T-12 is gone, presets included', () => {
    const lines = defaultAssumptions(WITH_T12, AS_OF).operating.expenses.map((e) => e.label)
    const edits = { 'operating.expenses.3.annualAmount': 1, 'scenarios.downside.operating.expenses.0.annualAmount': 2, 'debt.ltv': 0.6 }
    expect(reconcileExpenseEdits(WITH_T12, AS_OF, edits, lines).notice).toBeNull()
    const r = reconcileExpenseEdits(FERNHILL, AS_OF, edits, lines)
    expect(r.edits).toEqual({ 'debt.ltv': 0.6 })
    expect(r.notice).toMatch(/^Dropped 2 operating expense edits: they were made on 7 T-12 lines/)
  })
  it('record the T-12 lines in an imported file and load an old file with its expense edit dropped', () => {
    const parsed = parseAssumptionSetFile(assumptionSetFile(FERNHILL.id, plainSet), WITH_T12, AS_OF)
    expect(parsed.set?.edits).toEqual({ 'exit.exitCapRate': 0.08 })
    expect(parsed.set?.expenseLines).toHaveLength(7)
    expect(parsed.set ? parsed.notices : null).toEqual([expect.stringMatching(/^Dropped 1 operating expense edit from “Plain”/)])
    // Without a T-12 nothing is recorded or dropped: files stay as they were.
    expect(parseAssumptionSetFile(assumptionSetFile(FERNHILL.id, plainSet), FERNHILL, AS_OF)).toEqual({ set: plainSet, errors: [] })
  })
})

describe('the T-12 check', () => {
  const check = t12Check(WITH_T12, AS_OF)!
  const row = (key: string) => check.rows.find((r) => r.key === key)!
  it('is null without a T-12', () => {
    expect(t12Check(FERNHILL, AS_OF)).toBeNull()
  })
  it('compares T-12 NOI with underwritten Year-1 NOI', () => {
    const y1 = underwrite(WITH_T12, AS_OF, assumptionsFor(WITH_T12, AS_OF)).cashFlows[0]
    expect(check.noi.t12).toEqual({ value: 1_318_608, display: '$1,318,608' })
    expect(check.noi.underwritten.value).toBe(Math.round(y1.netOperatingIncome))
    expect(check.reportedNOI).toEqual({
      value: { value: 1_284_408, display: '$1,284,408' },
      note: 'The file reports NOI of $1,284,408; $34,200 of Make Ready / Turnover is mapped below NOI, so the mapped T-12 NOI is $1,318,608.',
    })
  })
  it('explains the whole NOI difference by line', () => {
    const lines = check.rows.filter((r) => r.kind !== 'total')
    const sum = lines.reduce((s, r) => s + r.noiEffect.value!, 0)
    expect(Math.abs(sum - check.noi.difference.value!)).toBeLessThanOrEqual(lines.length)
    expect(row('property-taxes')).toMatchObject({ t12: { value: 231_600 }, why: '$231,600 over the T-12, grown 1.08 yrs at 3%/yr expense growth to Year 1' })
    expect(row('property-taxes').noiEffect.value).toBe(-Math.round(231_600 * (GROWTH - 1)))
    expect(row('management-fee').why).toBe('Model 3% of EGI; the T-12 fee is 4.0% of T-12 EGI')
    expect(row('other-income').why).toMatch(/; replaces the rent roll’s \$39,144$/)
    expect(check.rows.map((r) => r.key)).toEqual([
      'rental-income',
      'vacancy-concessions',
      'other-income',
      'egi',
      'property-taxes',
      'insurance',
      'utilities',
      'repairs-maintenance',
      'payroll',
      'admin-marketing',
      'other-opex',
      'management-fee',
      'opex',
      'noi',
    ])
  })
  it('shows other income side by side and lists below-NOI items separately', () => {
    expect(check.otherIncome.rentRoll).toEqual({ value: 39_144, display: '$39,144' })
    expect(check.otherIncome.t12Year1.value).toBe(Math.round(88_800 * GROWTH))
    expect(check.belowNOI.t12.map((x) => x.label)).toEqual(['Make Ready / Turnover', 'Roof Repair', 'Unit Renovations'])
    expect(check.belowNOI.underwritten.map((x) => x.label)).toEqual(['Turnover costs (make-ready)', 'Capital reserves'])
  })
  it('compares opex with the benchmark, labeled as an estimate', () => {
    expect(check.perBasis.t12).toEqual({ value: (826_192 - 85_792) / 120, display: '$6,170/unit/yr' })
    expect(check.perBasis.benchmark.display).toBe('$6,800/unit/yr')
    expect(check.perBasis.note).toMatch(/Compared against an estimate: .*\(EST\)/)
    expect(check.expenseRatio.t12.display).toBe('38.5%')
  })
  it('shows what the T-12 did to price and returns', () => {
    expect(check.effect.map((e) => e.label)).toEqual(['Year-1 NOI', 'Purchase price (estimate)', 'Going-in cap rate', 'Levered IRR', 'Levered IRR at $16.50M'])
    expect(check.effect[1]).toMatchObject({ without: { display: '$16,498,774' }, with: { display: '$17,749,638' } })
    expect(check.effectNote).toMatch(/loading the T-12 moved it from \$16,498,774 to \$17,749,638/)
    const priced = t12Check(WITH_T12, AS_OF, { 'acquisition.purchasePrice': 16_000_000 })!
    expect(priced.effect.map((e) => e.label)).toEqual(['Year-1 NOI', 'Purchase price (your input)', 'Going-in cap rate', 'Levered IRR'])
    expect(priced.effectNote).toBe('The purchase price is your input, so the T-12 changes returns only.')
  })
  it('flags a management fee above the model’s', () => {
    expect(check.flags).toEqual(['The T-12 management fee is 4.0% of T-12 EGI; the model charges 3%. A buyer’s manager may cost more than the model assumes.'])
  })
  it('compares property taxes with the tax roll only for a placed deal', () => {
    expect(check.tax).toEqual({ status: 'unavailable', reason: 'Shown for imported deals placed on their parcel.' })
    const placed = withT12(
      { ...FERNHILL, location: { ...FERNHILL.location, placement: { pin: '105-0464-0000', cityAddress: '91 Hartford Ave', method: 'address', placedAt: AS_OF, outlineFrom: 'osm' } } },
      statement('multifamily'),
    )
    const record = { plat: '105', lot: '464', annualTaxes: fromPublic(200_000, 'City of Providence Open Data – 2025 Property Tax Roll') } as TaxRecord
    expect(t12Check(placed, AS_OF, {}, { record, loading: true })!.tax).toEqual({ status: 'unavailable', reason: 'Looking up the city tax roll for this parcel…' })
    const tax = t12Check(placed, AS_OF, {}, { record })!
    expect(tax.tax).toMatchObject({ status: 'ok', t12: { display: '$231,600' }, taxRoll: { display: '$200,000' }, difference: { display: '+$31,600' }, differencePct: { display: '+15.8%' } })
    expect(tax.flags).toContain('T-12 property taxes are 15.8% above the city tax roll’s annual taxes ($231,600 vs $200,000).')
  })
})

describe('the analyst export', () => {
  it('includes the T-12 check when one is loaded, and null otherwise', () => {
    const r = underwrite(WITH_T12, AS_OF, assumptionsFor(WITH_T12, AS_OF))
    const x = analystExport(WITH_T12, AS_OF, r)
    expect(x.t12).toMatchObject({ period: 'Oct 2025 – Sep 2026', noi: { t12: { display: '$1,318,608' } }, thresholds: { noiGap: { display: '10%' } } })
    expect(x.t12?.tax).toEqual({ status: 'unavailable', reason: 'Shown for imported deals placed on their parcel.' })
    expect(x.assumptions.estimated).not.toContain('Property taxes')
    const plain = withoutT12(WITH_T12)
    expect(analystExport(plain, AS_OF, underwrite(plain, AS_OF, assumptionsFor(plain, AS_OF))).t12).toBeNull()
  })
})
