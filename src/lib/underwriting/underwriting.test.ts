import { describe, expect, it } from 'vitest'
import type { Escalation, Lease, Property, VacantSpace } from '../../types'
import { SAMPLE_PROPERTIES } from '../../data/sampleProperties'
import { estimate } from '../sourced'
import { commercialMonths } from './commercial'
import { defaultAssumptions, withPurchasePrice } from './defaults'
import { irr, loanSchedule, npv, payment } from './finance'
import { monthlyRecovery } from './recoveries'
import { assumptionRows, toCSV } from './report'
import { blendTerms, leaseValuePerSF } from './rollover'
import { analysisStartFor, monthAfter } from './timeline'
import { saleProceeds, underwrite } from './underwrite'
import { applyWaterfall, generalVacancy, normalizeForExit } from './waterfall'

const AS_OF = '2026-10-04' // analysis starts 2026-11-01
const byId = (id: string) => {
  const p = SAMPLE_PROPERTIES.find((x) => x.id === id)
  if (!p) throw new Error(`missing ${id}`)
  return p
}
const ATWELLS = byId('sample-atwells-retail-row')

/** Atwells with its rent roll replaced, for isolated single-space tests. */
function withRentRoll(leases: Lease[], vacancies: VacantSpace[], rsf: number): Property {
  return {
    ...ATWELLS,
    physical: { ...ATWELLS.physical, rentableSF: { ...ATWELLS.physical.rentableSF, value: rsf } },
    rentRoll: { kind: 'commercial', leases, vacancies },
  }
}

function testLease(escalation: Escalation, over: Partial<Lease> = {}): Lease {
  return {
    id: 'T1',
    tenantName: 'Test',
    suite: '1',
    leasedSF: 1_200,
    commencementDate: '2020-01-01',
    expirationDate: '2040-12-31',
    startingRentPerSF: 20,
    escalation,
    leaseType: 'NNN',
    recovery: { method: 'none' },
    source: 'estimated',
    sourceName: 'test',
    ...over,
  }
}

function monthsFor(p: Property) {
  return commercialMonths(p, defaultAssumptions(p, AS_OF), AS_OF).months
}

describe('timeline', () => {
  it('starts the analysis on the 1st of the following month', () => {
    expect(analysisStartFor(AS_OF)).toBe('2026-11-01')
    expect(analysisStartFor('2026-12-15')).toBe('2027-01-01')
  })
  it('finds the first month a lease no longer covers', () => {
    // m0 = Nov 2026, so Dec 2027 is m13 and the lease is gone from m14.
    expect(monthAfter('2026-11-01', '2027-12-31')).toBe(14)
    expect(monthAfter('2026-11-01', '2026-10-31')).toBe(0)
  })
})

describe('escalations (monthly rent from in-place leases)', () => {
  // 1,200 SF → monthly rent = $/SF × 100. Commenced 2020-01-01, so 6 bumps by Nov 2026, the 7th in Jan 2027 (m2).
  it('fixed percent bumps on each anniversary', () => {
    const m = monthsFor(withRentRoll([testLease({ type: 'fixed-percent', annualPct: 0.03 })], [], 1_200))
    expect(m[0].grossPotentialRent).toBeCloseTo(20 * 1.03 ** 6 * 100, 6)
    expect(m[1].grossPotentialRent).toBeCloseTo(20 * 1.03 ** 6 * 100, 6)
    expect(m[2].grossPotentialRent).toBeCloseTo(20 * 1.03 ** 7 * 100, 6)
  })
  it('fixed $/SF adds the same amount each year', () => {
    const m = monthsFor(withRentRoll([testLease({ type: 'fixed-amount', annualPerSF: 0.5 })], [], 1_200))
    expect(m[0].grossPotentialRent).toBeCloseTo(23 * 100, 6)
    expect(m[2].grossPotentialRent).toBeCloseTo(23.5 * 100, 6)
  })
  it('steps switch on their effective dates', () => {
    const steps: Escalation = {
      type: 'steps',
      steps: [
        { effectiveDate: '2025-01-01', annualRentPerSF: 22 },
        { effectiveDate: '2027-03-01', annualRentPerSF: 24 },
      ],
    }
    const m = monthsFor(withRentRoll([testLease(steps)], [], 1_200))
    expect(m[3].grossPotentialRent).toBeCloseTo(22 * 100, 6) // Feb 2027
    expect(m[4].grossPotentialRent).toBeCloseTo(24 * 100, 6) // Mar 2027
  })
})

describe('rollover blending', () => {
  const newLease = { termMonths: 120, freeRentMonths: 3, tiPerSF: 30, leasingCommissionPct: 0.06 }
  const renewal = { termMonths: 60, freeRentMonths: 1, tiPerSF: 10, leasingCommissionPct: 0.03 }

  it('weights each term by renewal probability (retail defaults, flat $20 rent)', () => {
    const b = blendTerms(0.7, 9, newLease, renewal, 20, 20, 0)
    expect(b.downtimeMonths).toBeCloseTo(2.7, 9) // 0.3 × 9
    expect(b.freeRentMonths).toBeCloseTo(1.6, 9) // 0.7 × 1 + 0.3 × 3
    expect(b.tiPerSF).toBeCloseTo(16, 9) // 0.7 × 10 + 0.3 × 30
    expect(b.termMonths).toBe(78) // 0.7 × 60 + 0.3 × 120
    // LC $: renewal 3% × $100 = $3; new 6% × $200 = $12; 0.7 × 3 + 0.3 × 12 = $5.70/SF
    expect(b.lcPerSF).toBeCloseTo(5.7, 9)
  })
  it('blends renewal and new rents', () => {
    expect(blendTerms(0.7, 9, newLease, renewal, 20, 30, 0).rentPerSF).toBeCloseTo(27, 9)
  })
  it('values a lease with annual escalations', () => {
    expect(leaseValuePerSF(20, 24, 0.03)).toBeCloseTo(20 + 20.6, 9)
  })
  it('treats fractional lease-up and free rent as partial months', () => {
    // 1,000 SF vacant, leases up after 2.5 months on new retail terms (3 months free).
    const p = withRentRoll([], [{ id: 'V', suite: 'V', sf: 1_000, expectedLeaseUpMonths: 2.5 }], 1_000)
    const m = monthsFor(p)
    const monthlyRent = (ATWELLS.market.marketRent.value * 1_000) / 12
    expect(m[1].occupiedSF).toBe(0)
    expect(m[2].occupiedSF).toBeCloseTo(500, 9)
    expect(m[2].absorptionTurnoverVacancy).toBeCloseTo(monthlyRent / 2, 6)
    // Free rent runs from month 2.5 to 5.5.
    expect(m[2].freeRent).toBeCloseTo(monthlyRent / 2, 6)
    expect(m[4].freeRent).toBeCloseTo(monthlyRent, 6)
    expect(m[5].freeRent).toBeCloseTo(monthlyRent / 2, 6)
    expect(m[6].freeRent).toBe(0)
    // TI ($30) and LC are booked in the first occupied month.
    expect(m[2].tenantImprovements).toBeCloseTo(30 * 1_000, 6)
  })
})

describe('expense recoveries', () => {
  // 1,000 of 10,000 SF (10% share); $5,000/month of recoverable expenses.
  it('net: pro-rata share plus admin fee', () => {
    expect(monthlyRecovery({ method: 'net', adminFeePct: 0.1 }, 1_000, 10_000, 5_000)).toBeCloseTo(550, 9)
  })
  it('base year: only increases over the base year', () => {
    expect(monthlyRecovery({ method: 'base-year', baseYear: 2020 }, 1_000, 10_000, 5_000, 4_000)).toBeCloseTo(100, 9)
    expect(monthlyRecovery({ method: 'base-year', baseYear: 2020 }, 1_000, 10_000, 5_000, 6_000)).toBe(0)
  })
  it('expense stop: excess over the $/SF stop', () => {
    // $60,000/yr ÷ 10,000 SF = $6/SF; stop $5 → $1 × 1,000 SF ÷ 12
    expect(monthlyRecovery({ method: 'expense-stop', stopPerSF: 5 }, 1_000, 10_000, 5_000)).toBeCloseTo(1_000 / 12, 9)
  })
  it('full-service gross with no recovery pays nothing', () => {
    expect(monthlyRecovery({ method: 'none' }, 1_000, 10_000, 5_000)).toBe(0)
  })
})

describe('general vacancy floor', () => {
  it('adds nothing when modeled vacancy already exceeds the floor', () => {
    expect(generalVacancy(0.05, 1_000_000, 70_000)).toBe(0)
  })
  it('tops up to exactly the floor otherwise', () => {
    expect(generalVacancy(0.05, 1_000_000, 20_000)).toBe(30_000)
  })
  it('runs through the waterfall: credit loss and management fee on the right base', () => {
    const op = defaultAssumptions(ATWELLS, AS_OF).operating
    const y = applyWaterfall(
      1,
      {
        occupancy: 1,
        grossPotentialRent: 900_000,
        absorptionTurnoverVacancy: 20_000,
        freeRent: 10_000,
        expenseRecoveries: 100_000,
        otherIncome: 0,
        propertyExpenses: 150_000,
        tenantImprovements: 0,
        leasingCommissions: 0,
        capitalReserves: 0,
      },
      op,
    )
    expect(y.generalVacancy).toBe(30_000) // 5% × 1,000,000 − 20,000
    expect(y.creditLoss).toBeCloseTo(0.01 * 940_000, 6)
    expect(y.effectiveGrossIncome).toBeCloseTo(940_000 * 0.99, 6)
    expect(y.managementFee).toBeCloseTo(940_000 * 0.99 * 0.03, 6)
    expect(y.netOperatingIncome).toBeCloseTo(940_000 * 0.99 * 0.97 - 150_000, 6)
  })
})

describe('exit normalization', () => {
  it('swaps rollover vacancy and free rent for the general vacancy rate', () => {
    const op = defaultAssumptions(ATWELLS, AS_OF).operating
    const raw = applyWaterfall(
      11,
      {
        occupancy: 0.9,
        grossPotentialRent: 900_000,
        absorptionTurnoverVacancy: 60_000,
        freeRent: 25_000,
        expenseRecoveries: 100_000,
        otherIncome: 0,
        propertyExpenses: 150_000,
        tenantImprovements: 80_000,
        leasingCommissions: 40_000,
        capitalReserves: 3_600,
      },
      op,
    )
    const n = normalizeForExit(raw, op)
    expect(n.absorptionTurnoverVacancy).toBe(0)
    expect(n.freeRent).toBe(0)
    expect(n.generalVacancy).toBeCloseTo(50_000, 9) // 5% × (900,000 + 100,000)
    // EGI = 950,000 × 0.99 (credit loss); NOI = EGI × 0.97 (mgmt) − 150,000
    expect(n.netOperatingIncome).toBeCloseTo(950_000 * 0.99 * 0.97 - 150_000, 6)
    // Raw: 60,000 rollover vacancy already exceeds the 50,000 floor, so no general vacancy.
    expect(raw.netOperatingIncome).toBeCloseTo(915_000 * 0.99 * 0.97 - 150_000, 6)
  })
})

describe('loan amortization', () => {
  it('matches the PMT formula: $1M, 6.5%, 30 years', () => {
    expect(payment(1_000_000, 0.065 / 12, 360)).toBeCloseTo(6_320.68, 2)
  })
  it('pays interest only, then amortizes', () => {
    const s = loanSchedule(1_000_000, 0.065, 360, 24, 120)
    expect(s[0].payment).toBeCloseTo(5_416.67, 2)
    expect(s[23].endingBalance).toBe(1_000_000)
    expect(s[24].payment).toBeCloseTo(6_320.68, 2)
    expect(s[24].principal).toBeCloseTo(904.01, 2)
    // After 96 amortizing payments the balance matches the closed form.
    const r = 0.065 / 12
    const pmt = payment(1_000_000, r, 360)
    expect(s[119].endingBalance).toBeCloseTo(1_000_000 * (1 + r) ** 96 - (pmt * ((1 + r) ** 96 - 1)) / r, 4)
  })
})

describe('IRR and NPV', () => {
  it('matches a hand-checked bond-like cash flow', () => {
    expect(irr([-100, 10, 10, 110])).toBeCloseTo(0.1, 6)
  })
  it('returns null when there is no sign change', () => {
    expect(irr([100, 10, 10])).toBe(null)
  })
  it('discounts from t = 1', () => {
    expect(npv(0.08, [-100, 0, 116.64])).toBeCloseTo(0, 9)
    expect(npv(0.1, [-100, 55, 60.5])).toBeCloseTo(0, 9)
  })
})

describe('sale', () => {
  it('capitalizes forward NOI and deducts selling costs', () => {
    const s = saleProceeds(700_000, 0.0725, 0.02)
    expect(s.gross).toBeCloseTo(9_655_172.41, 2)
    expect(s.net).toBeCloseTo(9_462_068.97, 2)
  })
})

describe('defaults', () => {
  it('tags every numeric assumption with a source label', () => {
    for (const p of SAMPLE_PROPERTIES) {
      for (const row of assumptionRows(defaultAssumptions(p, AS_OF))) {
        if (typeof row.value === 'number') {
          expect(row.sourceName, `${p.id} ${row.path}`).toBeTruthy()
        }
      }
    }
  })
  it('uses the retail set for Atwells', () => {
    const a = defaultAssumptions(ATWELLS, AS_OF)
    expect(a.leasing.renewalProbability.value).toBe(0.7)
    expect(a.leasing.newLease.termMonths.value).toBe(120)
    expect(a.leasing.renewalProbability.sourceName).toMatch(/replace with/)
    expect(a.exit.exitCapRate.value).toBeCloseTo(ATWELLS.market.marketCapRate.value + 0.0025, 12)
  })
  it('marks an analyst price as an input, not an estimate', () => {
    const a = withPurchasePrice(defaultAssumptions(ATWELLS, AS_OF), 4_000_000)
    expect(a.acquisition.purchasePrice.source).toBe('imported')
    expect(a.acquisition.purchasePrice.sourceName).toBe('Analyst input')
  })
})

describe('underwrite (integration)', () => {
  const r = underwrite(ATWELLS, AS_OF)
  /** Normalized year-11 NOI rebuilt by hand from the raw forward-year lines. */
  const handNormalizedNOI = () => {
    const f = r.forwardYear
    const op = r.assumptions.operating
    const potential = f.grossPotentialRent + f.expenseRecoveries + f.otherIncome
    const egi = potential * (1 - op.generalVacancyPct.value) * (1 - op.creditLossPct.value)
    return egi * (1 - op.managementFeePct.value) - (f.operatingExpenses - f.managementFee)
  }

  it('accounts for every rentable SF in every month', () => {
    for (const row of monthsFor(ATWELLS)) expect(row.potentialSF).toBeCloseTo(14_400, 6)
  })
  it('prices at market cap by default', () => {
    expect(r.metrics.goingInCapRate).toBeCloseTo(ATWELLS.market.marketCapRate.value, 9)
    expect(r.cashFlows[0].netOperatingIncome).toBeGreaterThan(0)
  })
  it('ties the waterfall together', () => {
    for (const c of r.cashFlows) {
      const egi =
        c.grossPotentialRent - c.absorptionTurnoverVacancy - c.freeRent + c.expenseRecoveries + c.otherIncome -
        c.generalVacancy - c.creditLoss
      expect(c.effectiveGrossIncome).toBeCloseTo(egi, 6)
      expect(c.netOperatingIncome).toBeCloseTo(c.effectiveGrossIncome - c.operatingExpenses, 6)
      expect(c.cashFlowBeforeDebt).toBeCloseTo(
        c.netOperatingIncome - c.tenantImprovements - c.leasingCommissions - c.capitalReserves,
        6,
      )
    }
  })
  it('sells on normalized year-11 NOI and repays the loan', () => {
    const a = r.assumptions
    expect(r.metrics.exitNOIRaw).toBeCloseTo(r.forwardYear.netOperatingIncome, 6)
    expect(r.metrics.exitNOI).toBeCloseTo(handNormalizedNOI(), 6)
    // Atwells has space in downtime in year 11, so normalizing raises NOI.
    expect(r.metrics.exitNOI).toBeGreaterThan(r.metrics.exitNOIRaw)
    expect(r.metrics.exitValue).toBeCloseTo(r.metrics.exitNOI / a.exit.exitCapRate.value, 6)
    const sale = saleProceeds(r.metrics.exitNOI, a.exit.exitCapRate.value, a.exit.sellingCostsPct.value)
    const y10 = r.cashFlows[9]
    expect(y10.saleProceeds).toBeCloseTo(sale.net, 6)
    expect(y10.leveredCashFlow).toBeCloseTo(y10.cashFlowAfterDebt + sale.net - r.metrics.loanPayoff, 6)
    expect(r.metrics.loanAmount).toBeCloseTo(0.6 * r.metrics.purchasePrice, 6)
  })
  it('compares in-place rent to market and warns when they differ by more than 10%', () => {
    // Atwells in-place leases average well above the $22 market rent.
    expect(r.metrics.inPlaceVsMarket).toBeCloseTo((r.metrics.inPlaceRent ?? 0) / r.metrics.marketRent - 1, 12)
    const pctAbove = Math.round((r.metrics.inPlaceVsMarket ?? 0) * 100)
    expect(r.warnings).toContain(`In-place rents are ${pctAbove}% above market; income declines as leases roll.`)

    const withMarket = (rent: number) => ({
      ...r.assumptions,
      leasing: { ...r.assumptions.leasing, marketRent: estimate(rent, 'test') },
    })
    const below = underwrite(ATWELLS, AS_OF, withMarket(40)).warnings
    expect(below.some((w) => /^In-place rents are \d+% below market; income rises as leases roll\.$/.test(w))).toBe(true)
    const atMarket = underwrite(ATWELLS, AS_OF, withMarket(r.metrics.inPlaceRent ?? 0)).warnings
    expect(atMarket.some((w) => w.startsWith('In-place rents'))).toBe(false)
  })
  it('flags a below-1.25x DSCR with a plain-language warning', () => {
    const tight = withPurchasePrice(r.assumptions, r.metrics.purchasePrice * 1.6)
    const w = underwrite(ATWELLS, AS_OF, tight).warnings
    expect(w.some((x) => x.startsWith('DSCR is below 1.25x'))).toBe(true)
  })
  it('runs every sample property, including multifamily', () => {
    for (const p of SAMPLE_PROPERTIES) {
      const res = underwrite(p, AS_OF)
      expect(res.cashFlows.length).toBe(10)
      expect(Number.isFinite(res.metrics.npv)).toBe(true)
    }
  })
  it('models multifamily rent by unit type (hand-checked year 1)', () => {
    const res = underwrite(byId('sample-federal-hill-apartments'), AS_OF)
    // (23 × $1,525 + 1 vacant × $1,650 + 14 × $1,925) × 12
    expect(res.cashFlows[0].grossPotentialRent).toBeCloseTo(764_100, 6)
    // 38 units × 50% turnover × $1,000
    expect(res.cashFlows[0].tenantImprovements).toBeCloseTo(19_000, 6)
  })
  it('writes a CSV with cash flows, metrics and sourced assumptions', () => {
    const csv = toCSV(r, ATWELLS.name)
    expect(csv).toContain('Net operating income,')
    expect(csv).toContain('Unlevered IRR,')
    expect(csv).toContain('Industry rule of thumb – replace with market report')
  })
})
