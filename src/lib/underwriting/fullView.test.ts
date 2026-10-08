import { describe, expect, it } from 'vitest'
import type { AnnualCashFlow } from '../../types'
import { SAMPLE_PROPERTIES } from '../../data/sampleProperties'
import { activeLeases, occupancy, yearsBetween } from '../metrics'
import { RULE_OF_THUMB } from './defaults'
import { fullUnderwriting, type FullUnderwriting } from './fullView'
import { maxBid } from './maxBid'
import { maxBidStat } from './summary'
import { underwrite } from './underwrite'

const AS_OF = '2026-10-04'
const byId = (id: string) => {
  const p = SAMPLE_PROPERTIES.find((x) => x.id === id)
  if (!p) throw new Error(`missing ${id}`)
  return p
}
const ATWELLS = byId('sample-atwells-retail-row')
const FEDERAL_HILL = byId('sample-federal-hill-apartments')

function ok(v: FullUnderwriting) {
  if (v.status !== 'ok') throw new Error(`expected ok, got: ${v.reason}`)
  return v
}

const v = ok(fullUnderwriting(ATWELLS, AS_OF))
const r = underwrite(ATWELLS, AS_OF)

describe('full underwriting: cash flow tab (Atwells)', () => {
  const t = v.cashFlow
  const row = (label: string) => {
    const found = t.rows.find((x) => x.label === label)
    if (!found) throw new Error(`missing row ${label}`)
    return found
  }

  it('shows the check values for NOI', () => {
    const noi = row('Net operating income')
    expect(noi.cells[t.columns.indexOf('Year 1')]).toBe('290,296')
    expect(noi.cells[t.columns.indexOf('Year 4')]).toBe('302,232')
    expect(noi.cells[t.columns.indexOf('Year 11 normalized')]).toBe('341,402')
  })
  it('has Years 1-10 plus Year 11 raw and normalized', () => {
    expect(t.columns).toEqual([...Array.from({ length: 10 }, (_, i) => `Year ${i + 1}`), 'Year 11 raw', 'Year 11 normalized'])
    for (const x of t.rows) expect(x.cells, x.label).toHaveLength(12)
    expect(t.exitYear).toBe(11)
  })
  it('follows an edited hold period', () => {
    const short = ok(fullUnderwriting(ATWELLS, AS_OF, { 'acquisition.holdYears': 7 })).cashFlow
    expect(short.columns.slice(-3)).toEqual(['Year 7', 'Year 8 raw', 'Year 8 normalized'])
    expect(short.exitYear).toBe(8)
  })
  it('runs from gross potential rent through cash flow after debt, with the CSV labels', () => {
    expect(t.rows[0].label).toBe('Gross potential rent')
    expect(t.rows.at(-1)?.label).toBe('Cash flow after debt')
    expect(t.rows.map((x) => x.label)).toContain('of which management fee')
    expect(t.rows.map((x) => x.label)).not.toContain('Net sale proceeds')
  })
  it('marks subtotals and the management fee detail', () => {
    expect(t.rows.filter((x) => x.kind === 'subtotal').map((x) => x.label)).toEqual([
      'Effective gross income',
      'Net operating income',
      'Cash flow before debt',
      'Cash flow after debt',
    ])
    expect(row('of which management fee').kind).toBe('detail')
  })
  it('puts costs and losses in parentheses, income without', () => {
    expect(row('Operating expenses (incl. mgmt)').cells[0]).toMatch(/^\(\d[\d,]*\)$/)
    expect(row('Debt service').cells[0]).toMatch(/^\(\d[\d,]*\)$/)
    expect(row('Gross potential rent').cells[0]).toMatch(/^\d[\d,]*$/)
  })
  it('leaves debt lines blank in the Year-11 columns', () => {
    expect(row('Debt service').cells.slice(10)).toEqual(['', ''])
    expect(row('Cash flow after debt').values.slice(10)).toEqual([null, null])
  })
  it('carries engine values unchanged', () => {
    const engineYears = [...r.cashFlows, r.forwardYear, r.normalizedExitYear]
    for (const x of t.rows) {
      x.values.forEach((value, i) => {
        if (value === null) return
        expect(value, `${x.label}, ${t.columns[i]}`).toBe(engineYears[i][x.key as keyof AnnualCashFlow])
      })
    }
  })
})

describe('full underwriting: rent roll tab', () => {
  const rr = v.rentRoll
  if (rr.kind !== 'commercial') throw new Error('expected a commercial rent roll')

  it('has one row per active lease and per vacant suite, in suite order', () => {
    const rentRoll = ATWELLS.rentRoll
    if (rentRoll.kind !== 'commercial') throw new Error('expected commercial')
    expect(rr.rows).toHaveLength(activeLeases(ATWELLS, AS_OF).length + rentRoll.vacancies.length)
    expect(rr.rows.map((x) => x.suite)).toEqual(['101', '102', '103', '105', '200'])
  })
  it('formats a lease row', () => {
    const casa = rr.rows.find((x) => x.suite === '101')!
    expect(casa).toMatchObject({
      tenant: 'Casa Lucenti Trattoria',
      sf: '3,400',
      pctOfBuilding: '23.6%',
      start: 'Mar 2015',
      end: 'Feb 2030',
      remaining: '3.3 yrs', // from the Nov 1, 2026 analysis start, not the Oct 4 analysis date
      marketAtExpiration: '$23.35', // $22.00 grown 2%/yr to Year 4, when the space re-leases
      escalation: '3%/yr',
      recovery: 'NNN · Net + 10% admin',
      renewalOption: '5 yr at $30.00/SF',
      vsMarketTone: 'above',
    })
  })
  it('shows vacant suites with their lease-up months', () => {
    const vacant = rr.rows.find((x) => x.vacant)!
    expect(vacant).toMatchObject({ suite: '200', tenant: 'Vacant', sf: '3,600', remaining: 'Lease-up 9 mo' })
  })
  it('totals occupancy and WALT from the engine', () => {
    expect(rr.totals.sf).toBe('14,400')
    expect(rr.totals.occupancy).toBe(`${(occupancy(ATWELLS, AS_OF) * 100).toFixed(1)}%`)
    expect(rr.totals.walt).toBe(`${r.metrics.walt!.toFixed(1)} yrs`)
    expect(rr.totals.market).toBe('Yr 1 $22.00')
  })
  it('measures WALT from the analysis start', () => {
    const start = r.assumptions.acquisition.analysisStartDate
    expect(start).toBe('2026-11-01')
    const leases = activeLeases(ATWELLS, AS_OF)
    const sf = leases.reduce((s, l) => s + l.leasedSF, 0)
    const expected = leases.reduce((s, l) => s + l.leasedSF * yearsBetween(start, l.expirationDate), 0) / sf
    expect(r.metrics.walt).toBeCloseTo(expected, 10)
    expect(rr.totals.vsMarket).toBe('+31.5%')
  })
  it('schedules expirations for each hold year, matching the rollover warning', () => {
    expect(rr.expirations.map((x) => x.year)).toEqual(Array.from({ length: 10 }, (_, i) => `Year ${i + 1}`))
    expect(rr.expirations[1].totalPct).toBe('36.1%')
    const inPlace = r.expirations.inPlaceSF.reduce((s, x) => s + x, 0)
    expect(inPlace).toBe(activeLeases(ATWELLS, AS_OF).reduce((s, l) => s + l.leasedSF, 0))
  })
  it('charts expirations as in-place plus re-leased SF, with % of building on hover', () => {
    expect(rr.expirationChart.map((x) => x.year)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1))
    rr.expirationChart.forEach((x, i) => {
      expect(x.inPlaceSF).toBe(r.expirations.inPlaceSF[i])
      expect(x.inPlaceSF + x.releasedSF).toBe(r.expirations.totalSF[i])
    })
    expect(rr.expirationChart[0].tooltip).toBe('Year 1: no leases expire')
    expect(rr.expirationChart[1].tooltip).toBe('Year 2: 5,200 SF expiring (36.1% of building) · in-place leases')
    expect(rr.expirationChart[7].tooltip).toBe('Year 8: 2,800 SF expiring (19.4% of building) · re-leased space')
  })
  it('shows the unit mix for apartments', () => {
    expect(ok(fullUnderwriting(FEDERAL_HILL, AS_OF)).rentRoll.kind).toBe('unit-mix')
  })
})

describe('full underwriting: returns tab', () => {
  const ret = v.returns
  const m = r.metrics
  const value = (items: { label: string; value: string }[], label: string) => items.find((x) => x.label.startsWith(label))?.value

  it('balances sources and uses', () => {
    expect(value(ret.sources, 'Total sources')).toBe(value(ret.uses, 'Total uses'))
    expect(m.loanAmount + m.equityRequired).toBeCloseTo(m.totalCost + m.loanFee, 6)
  })
  it('maps engine metrics', () => {
    expect(value(ret.sale, 'Year-11 NOI (normalized')).toBe('$341,402')
    expect(value(ret.sale, 'Less: selling costs')).toBe(`($${Math.round(m.sellingCosts).toLocaleString('en-US')})`)
    expect(value(ret.sale, 'Net sale proceeds')).toBe(`$${Math.round(m.netSaleProceeds).toLocaleString('en-US')}`)
    expect(ret.sale.at(-1)).toEqual({
      label: 'Net proceeds to equity',
      value: `$${Math.round(m.netSaleProceeds - m.loanPayoff).toLocaleString('en-US')}`,
      kind: 'total',
    })
    expect(value(ret.returns, 'Unlevered IRR')).toBe('6.69%')
    expect(value(ret.returns, 'Levered IRR')).toBe('6.78%')
    expect(value(ret.returns, 'NPV @ 8.00%')).toBe('-$391,990')
    expect(value(ret.debt, 'Loan constant')).toBe('7.58%')
    expect(ret.debtByYear.rows.find((x) => x.label === 'DSCR')?.cells[3]).toBe('1.60x')
  })
  it('shows the IRR streams for Year 0 through Year 10', () => {
    expect(ret.cashFlows.columns).toEqual(Array.from({ length: 11 }, (_, i) => `Year ${i}`))
    const [unlevered, levered] = ret.cashFlows.rows
    expect(unlevered.values).toEqual([-m.totalCost, ...r.cashFlows.map((c) => c.unleveredCashFlow)])
    expect(levered.values).toEqual([-m.equityRequired, ...r.cashFlows.map((c) => c.leveredCashFlow)])
    expect(unlevered.cells[0]).toMatch(/^\(/)
  })
  it('charts NOI and cash flow before and after debt for each hold year', () => {
    expect(ret.cashFlowChart).toHaveLength(10)
    ret.cashFlowChart.forEach((x, i) => {
      const c = r.cashFlows[i]
      expect(x).toMatchObject({ year: i + 1, noi: c.netOperatingIncome, beforeDebt: c.cashFlowBeforeDebt, afterDebt: c.cashFlowAfterDebt })
    })
    expect(ret.cashFlowChart[3].tooltip).toMatch(/^Year 4: NOI \$302,232 · before debt -?\$[\d,]+ · after debt -?\$[\d,]+$/)
    expect(ok(fullUnderwriting(ATWELLS, AS_OF, { 'acquisition.holdYears': 7 })).returns.cashFlowChart).toHaveLength(7)
  })
  it('charts DSCR against the 1.25x floor, flagging years below it', () => {
    const dscr = ret.dscrChart!
    expect(dscr.floor).toBe(1.25)
    expect(dscr.points.map((x) => x.dscr)).toEqual(m.dscrByYear)
    for (const x of dscr.points) expect(x.belowFloor).toBe(x.dscr < 1.25)
    expect(dscr.points[3].tooltip).toBe('Year 4: DSCR 1.60x')
    const tight = ok(fullUnderwriting(ATWELLS, AS_OF, { 'debt.ltv': 0.8 })).returns.dscrChart!
    const low = tight.points.find((x) => x.belowFloor)!
    expect(low.tooltip).toBe(`Year ${low.year}: DSCR ${low.dscr.toFixed(2)}x · below 1.25x`)
  })
  it('has no DSCR chart without debt', () => {
    expect(ok(fullUnderwriting(ATWELLS, AS_OF, { 'debt.ltv': 0 })).returns.dscrChart).toBeNull()
  })
  it('shows the max bid at the target levered IRR', () => {
    const bid = ret.returns.find((x) => x.label === 'Max bid at 10% levered IRR')!
    expect(bid).toEqual(maxBidStat(maxBid(ATWELLS, AS_OF, r.assumptions)))
    expect(bid.value).toMatch(/^\$\d\.\d\dM$/)
    expect(bid.hint).toMatch(/^\$[\d,]+\/SF · \d+\.\d\d% cap · \(\d+\.\d%\) vs price$/)
    const twelve = ok(fullUnderwriting(ATWELLS, AS_OF, { targetLeveredIRR: 0.12 })).returns.returns
    expect(twelve.map((x) => x.label)).toContain('Max bid at 12% levered IRR')
    const noDebt = ok(fullUnderwriting(ATWELLS, AS_OF, { 'debt.ltv': 0 })).returns.returns.find((x) => x.label.startsWith('Max bid'))!
    expect(noDebt).toMatchObject({ value: '—', hint: expect.stringMatching(/Debt is off/) })
  })
})

describe('full underwriting: assumptions tab', () => {
  it('groups assumptions in order, each sourced value with its badge and note', () => {
    expect(v.assumptions.map((g) => g.title)).toEqual(['Acquisition', 'Leasing', 'Operating', 'Debt', 'Exit'])
    const price = v.assumptions[0].items.find((x) => x.label === 'Purchase price')!
    expect(price.src?.source).toBe('estimated')
    expect(price.note).toContain('Default year-1 NOI ÷ market cap rate')
  })
  it('leaves rule-of-thumb notes to the legend and lifts shared notes to the group', () => {
    const items = v.assumptions.flatMap((g) => g.items)
    expect(items.some((x) => x.note === RULE_OF_THUMB)).toBe(false)
    const debt = v.assumptions.find((g) => g.title === 'Debt')!
    expect(debt.note).toBe('Placeholder – replace with lender term sheet')
    expect(debt.items.filter((x) => x.src).every((x) => x.note === '')).toBe(true)
    for (const g of v.assumptions) {
      const notes = g.items.map((x) => x.note).filter(Boolean)
      expect(new Set(notes).size, g.title).toBe(notes.length)
    }
  })
  it('makes every sourced number editable, with its default', () => {
    for (const g of v.assumptions) for (const x of g.items) expect(!!x.edit, x.label).toBe(!!x.src)
    const exitCap = v.assumptions.flatMap((g) => g.items).find((x) => x.label === 'Exit cap rate')!.edit!
    expect(exitCap).toMatchObject({ input: '7.25', defaultText: 'default 7.25%', edited: false })
    const edited = ok(fullUnderwriting(ATWELLS, AS_OF, { 'exit.exitCapRate': 0.075 }))
    const item = edited.assumptions.flatMap((g) => g.items).find((x) => x.label === 'Exit cap rate')!
    expect(item.edit).toMatchObject({ input: '7.5', defaultText: 'default 7.25%', edited: true })
    expect(item.src?.sourceName).toBe('Analyst input')
    expect(edited.header.changes).toEqual(['Exit cap rate 7.50% (default 7.25%)'])
    expect(v.header.changes).toEqual([])
  })
  it('lists multifamily turnover instead of commercial leasing terms', () => {
    const items = ok(fullUnderwriting(FEDERAL_HILL, AS_OF)).assumptions.flatMap((g) => g.items)
    expect(items.map((x) => x.label)).toContain('Turnover rate')
    expect(items.some((x) => x.note.startsWith('Not used'))).toBe(false)
  })
})

describe('full underwriting: header', () => {
  it('shows key metrics, warnings and the price footnote', () => {
    expect(v.header.metrics.map((x) => x.label)).toEqual(['Purchase price', 'Going-in cap', 'Unlevered IRR', 'Levered IRR', 'Minimum DSCR'])
    expect(v.header.warnings.some((w) => w.full.startsWith('Purchase price'))).toBe(false)
    expect(v.header.notes).toEqual([expect.stringMatching(/^Purchase price is a model estimate/)])
    expect(v.header.warnings.find((w) => w.full.startsWith('Negative leverage'))?.full).toBe(
      'Negative leverage: the 7.00% going-in cap rate is below the 7.58% loan constant, so debt lowers the yearly cash yield. ' +
        'The levered IRR can still be higher because the sale gain goes to a smaller equity check.',
    )
  })
})
