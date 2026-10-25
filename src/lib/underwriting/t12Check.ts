import type { ISODate, Property, Sourced, T12Category, TaxRecord, UnderwritingAssumptions } from '../../types'
import { fmt } from '../format'
import { categoryLabel, growthYears, INCOME_CATEGORIES, OPEX_CATEGORIES, periodLabel, t12Source, t12Summary, withoutT12 } from '../t12'
import { expenseLineLabels, reconcileExpenseEdits } from './assumptionSets'
import { withPurchasePrice } from './defaults'
import { assumptionsFor, defaultsFor, isEdited, type AssumptionEdits } from './edits'
import { underwrite } from './underwrite'

/**
 * The T-12 against the underwriting, for the Investment view, the analyst
 * export and the CLI: T-12 NOI vs underwritten Year-1 NOI line by line,
 * property taxes vs the city tax roll, the expense ratio and $/unit (or $/SF)
 * vs the benchmark, and what loading the T-12 did to price and returns.
 * Every figure comes with its display string; the views add no math.
 */

/** Underwritten Year-1 NOI this far from the T-12's flags the gap. */
export const T12_NOI_GAP = 0.1
/** T-12 property taxes this far from the tax roll's flags the gap. */
export const T12_TAX_GAP = 0.1
/** T-12 opex per unit (or SF) this far from the benchmark flags the gap. */
export const T12_BENCHMARK_GAP = 0.2

export interface Fig {
  value: number | null
  display: string
  /** In $000s for narrow tables, as the cash flow shows them: "2,203.8", "(147.8)", "+89.3". Bridge rows only. */
  k?: string
}

export interface T12Row {
  key: string
  label: string
  kind: 'revenue' | 'expense' | 'total'
  t12: Fig
  underwritten: Fig
  /** What the underwritten figure does to NOI against the T-12: revenue UW − T-12, expenses T-12 − UW. */
  noiEffect: Fig
  /** Why the underwritten figure differs, in words. */
  why: string
}

export type TaxCheck =
  | { status: 'ok'; t12: Fig; taxRoll: Fig; difference: Fig; differencePct: Fig; source: string; note: string }
  | { status: 'unavailable'; reason: string }

export interface T12Check {
  source: string
  fileName: string
  period: string
  isSample: boolean
  /** "1.08 yrs from the T-12's midpoint to Year 1's". */
  growth: string
  rows: T12Row[]
  noi: { t12: Fig; underwritten: Fig; difference: Fig; differencePct: Fig }
  /** The file's own NOI line and why mapped NOI differs from it, when it does. */
  reportedNOI: { value: Fig; note: string | null } | null
  belowNOI: { t12: { label: string; amount: Fig }[]; underwritten: { label: string; amount: Fig }[] }
  otherIncome: { t12Year1: Fig; rentRoll: Fig; note: string }
  managementFee: { t12: Fig; t12PctOfEGI: Fig; modelPct: Fig; underwritten: Fig }
  tax: TaxCheck
  expenseRatio: { t12: Fig; underwritten: Fig; benchmark: Fig; note: string }
  perBasis: { basis: string; t12: Fig; underwritten: Fig; benchmark: Fig; benchmarkSource: string; note: string }
  /** Without vs with the T-12, at the same assumption edits. */
  effect: { label: string; without: Fig; with: Fig; change: Fig }[]
  effectNote: string
  flags: string[]
}

const fig = (value: number | null, display: string): Fig => ({ value, display })
const usd = (x: number) => fig(Math.round(x), money(x))
const money = (x: number) => (Math.round(x) < 0 ? `−${fmt.usd(-x)}` : fmt.usd(x))
const signedUsd = (x: number) => fig(Math.round(x), Math.round(x) === 0 ? '$0' : `${x > 0 ? '+' : '−'}${fmt.usd(Math.abs(x))}`)
const thousands = (x: number) => (x / 1000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
/** A bridge figure: whole dollars plus $000s. */
const rowUsd = (x: number): Fig => ({ ...usd(x), k: Math.abs(x) < 50 ? '–' : x < 0 ? `(${thousands(-x)})` : thousands(x) })
const rowSigned = (x: number): Fig => ({ ...signedUsd(x), k: Math.abs(x) < 50 ? '0.0' : `${x > 0 ? '+' : '−'}${thousands(Math.abs(x))}` })
const pct = (x: number | null, digits = 1) => fig(x, x === null ? '—' : fmt.pct(x, digits))
const signedPct = (x: number | null) => fig(x, x === null ? '—' : fmt.signedPct(x))
const ratio = (x: number, y: number) => (y ? x / y : null)
const aboveBelow = (x: number) => `${fmt.pct(Math.abs(x), 1)} ${x >= 0 ? 'above' : 'below'}`

/** The rent roll's Year-1 other income: what the T-12 replaces for multifamily (the engine's own formula at Year 1). */
export function rentRollOtherIncome(p: Property): number {
  const rr = p.rentRoll
  if (rr.kind !== 'multifamily') return 0
  if (rr.units) return rr.units.reduce((s, u) => s + u.otherIncomeMonthly, 0) * 12
  return (rr.otherIncomePerUnitMonthly?.value ?? 0) * rr.unitTypes.reduce((s, u) => s + u.unitCount, 0) * 12
}

const sizeOf = (p: Property) =>
  p.rentRoll.kind === 'multifamily' ? p.rentRoll.unitTypes.reduce((s, u) => s + u.unitCount, 0) : p.physical.rentableSF.value

const lineWhy = (v: Sourced<number>) => (isEdited(v) ? `Your input ${fmt.usd(v.value)}` : (v.notes ?? v.sourceName))

/** The placed deal's tax roll lookup, or why there is none (e.g. on the command line). */
export type TaxLookup = { record: TaxRecord | null; loading?: boolean } | { reason: string }

/**
 * `edits` are the property's current Base edits; the check is always at Base.
 * `tax` is the parcel's tax roll record when the deal is placed and looked up.
 */
export function t12Check(
  property: Property,
  asOf: ISODate,
  edits: AssumptionEdits = {},
  tax?: TaxLookup,
): T12Check | null {
  const s = property.t12
  if (!s) return null
  const a = assumptionsFor(property, asOf, edits)
  const r = underwrite(property, asOf, a)
  const y = r.cashFlows[0]
  const t = t12Summary(s)
  const isMF = property.rentRoll.kind === 'multifamily'
  const op = a.operating
  const by = t.byCategory

  // ---- NOI bridge ----
  const rows: T12Row[] = []
  const revenue = (key: string, label: string, t12: number, uw: number, why: string) =>
    rows.push({ key, label, kind: 'revenue', t12: rowUsd(t12), underwritten: rowUsd(uw), noiEffect: rowSigned(uw - t12), why })
  const expense = (key: string, label: string, t12: number, uw: number, why: string) =>
    rows.push({ key, label, kind: 'expense', t12: rowUsd(t12), underwritten: rowUsd(uw), noiEffect: rowSigned(t12 - uw), why })
  const total = (key: string, label: string, t12: number, uw: number, effect: number) =>
    rows.push({ key, label, kind: 'total', t12: rowUsd(t12), underwritten: rowUsd(uw), noiEffect: rowSigned(effect), why: '' })

  revenue(
    'rental-income',
    categoryLabel('rental-income'),
    by['rental-income'],
    y.grossPotentialRent - y.lossToLease - y.freeRent,
    isMF ? 'Rent roll: every unit at market less loss to lease' : 'Rent roll leases in Year 1, less free rent',
  )
  const vacancyParts = [`${fmt.pctShort(op.generalVacancyPct.value)} general vacancy`, `${fmt.pctShort(op.creditLossPct.value)} credit loss`]
  if (y.absorptionTurnoverVacancy > 0.5) vacancyParts.unshift('lease-up and rollover vacancy')
  revenue('vacancy-concessions', categoryLabel('vacancy-concessions'), by['vacancy-concessions'], -(y.absorptionTurnoverVacancy + y.generalVacancy + y.creditLoss), `Model: ${vacancyParts.join(' + ')}`)
  if (!isMF || by.recoveries) {
    revenue('recoveries', categoryLabel('recoveries'), by.recoveries, y.expenseRecoveries, 'Modeled from each lease’s recovery terms on the recoverable lines')
  }
  const oi = op.otherIncomeYear1
  const rrOther = rentRollOtherIncome(property)
  revenue(
    'other-income',
    categoryLabel('other-income'),
    by['other-income'],
    y.otherIncome,
    oi ? `${lineWhy(oi)}${isMF ? `; replaces the rent roll’s ${fmt.usd(rrOther)}` : ''}` : 'Rent roll',
  )
  const t12Revenue = INCOME_CATEGORIES.reduce((sum, c) => sum + by[c], 0)
  total('egi', 'Effective gross income', t12Revenue, y.effectiveGrossIncome, y.effectiveGrossIncome - t12Revenue)

  const uwByCategory = new Map<T12Category, { amount: number; lines: UnderwritingAssumptions['operating']['expenses'] }>()
  for (const e of op.expenses) {
    if (!e.t12Category) continue
    const x = uwByCategory.get(e.t12Category) ?? { amount: 0, lines: [] }
    uwByCategory.set(e.t12Category, { amount: x.amount + e.annualAmount.value, lines: [...x.lines, e] })
  }
  for (const c of OPEX_CATEGORIES) {
    const uw = uwByCategory.get(c)
    if (!uw && !by[c]) continue
    const why = uw ? uw.lines.map((e) => lineWhy(e.annualAmount) + (!isMF ? ` · ${e.recoverable ? 'recoverable' : 'not recoverable'}` : '')).join('; ') : 'Not in the underwriting'
    expense(c, categoryLabel(c), by[c], uw?.amount ?? 0, why)
  }
  const t12EGIForFee = t.effectiveGrossIncome
  expense(
    'management-fee',
    categoryLabel('management-fee'),
    by['management-fee'],
    y.managementFee,
    `Model ${fmt.pctShort(op.managementFeePct.value)} of EGI; the T-12 fee is ${t12EGIForFee ? fmt.pct(by['management-fee'] / t12EGIForFee, 1) : '—'} of T-12 EGI`,
  )
  total('opex', 'Operating expenses', t.operatingExpenses, y.operatingExpenses, t.operatingExpenses - y.operatingExpenses)
  const noiDiff = y.netOperatingIncome - t.netOperatingIncome
  total('noi', 'Net operating income', t.netOperatingIncome, y.netOperatingIncome, noiDiff)

  const moved = t.movedBelowNOI.reduce((sum, x) => sum + x.amount, 0)
  const reportedNOI =
    s.fileTotals.noi === undefined
      ? null
      : {
          value: usd(s.fileTotals.noi),
          note:
            Math.abs(s.fileTotals.noi - t.netOperatingIncome) < 1
              ? null
              : moved
                ? `The file reports NOI of ${money(s.fileTotals.noi)}; ${money(moved)} of ${t.movedBelowNOI.map((x) => x.label).join(', ')} is mapped below NOI, so the mapped T-12 NOI is ${money(t.netOperatingIncome)}.`
                : `The file reports NOI of ${money(s.fileTotals.noi)}; the lines as mapped give ${money(t.netOperatingIncome)}.`,
        }

  const below = [
    ...(y.tenantImprovements ? [{ label: isMF ? 'Turnover costs (make-ready)' : 'Tenant improvements', amount: usd(y.tenantImprovements) }] : []),
    ...(y.leasingCommissions ? [{ label: 'Leasing commissions', amount: usd(y.leasingCommissions) }] : []),
    { label: 'Capital reserves', amount: usd(y.capitalReserves) },
  ]

  // ---- taxes, ratios, benchmark ----
  const taxCheck = taxComparison(property, by['property-taxes'], s, tax)
  const size = sizeOf(property)
  const basis = isMF ? '/unit/yr' : '/SF/yr'
  const perBasis = (x: number) => fig(size ? x / size : null, size ? `${isMF ? fmt.usd(x / size) : fmt.usdCents(x / size)}${basis}` : '—')
  const t12OpexExMgmt = t.operatingExpenses - by['management-fee']
  const uwOpexExMgmt = y.operatingExpenses - y.managementFee
  const bench = property.market.opexPerYear
  const benchTotal = bench.value * size
  const benchRatio = ratio(benchTotal + op.managementFeePct.value * y.effectiveGrossIncome, y.effectiveGrossIncome)

  // ---- price and returns, without vs with ----
  const stripped = withoutT12(property)
  const strippedEdits = reconcileExpenseEdits(stripped, asOf, edits, expenseLineLabels(defaultsFor(property, asOf))).edits
  const before = underwrite(stripped, asOf, assumptionsFor(stripped, asOf, strippedEdits))
  const estimated = a.acquisition.purchasePrice.source === 'estimated'
  const atOldPrice = estimated ? underwrite(property, asOf, withPurchasePrice(a, before.metrics.purchasePrice)) : null
  const irr = (x: number | null) => pct(x, 2)
  const irrChange = (x: number | null, y0: number | null) => (x === null || y0 === null ? fig(null, '—') : fig(x - y0, `${x - y0 >= 0 ? '+' : '−'}${Math.abs(Math.round((x - y0) * 10_000))} bps`))
  const effect = [
    { label: 'Year-1 NOI', without: usd(before.cashFlows[0].netOperatingIncome), with: usd(y.netOperatingIncome), change: signedUsd(y.netOperatingIncome - before.cashFlows[0].netOperatingIncome) },
    { label: estimated ? 'Purchase price (estimate)' : 'Purchase price (your input)', without: usd(before.metrics.purchasePrice), with: usd(r.metrics.purchasePrice), change: signedUsd(r.metrics.purchasePrice - before.metrics.purchasePrice) },
    { label: 'Going-in cap rate', without: pct(before.metrics.goingInCapRate, 2), with: pct(r.metrics.goingInCapRate, 2), change: irrChange(r.metrics.goingInCapRate, before.metrics.goingInCapRate) },
    { label: 'Levered IRR', without: irr(before.metrics.leveredIRR), with: irr(r.metrics.leveredIRR), change: irrChange(r.metrics.leveredIRR, before.metrics.leveredIRR) },
    ...(atOldPrice
      ? [
          {
            label: `Levered IRR at ${fmt.money(before.metrics.purchasePrice)}`,
            without: irr(before.metrics.leveredIRR),
            with: irr(atOldPrice.metrics.leveredIRR),
            change: irrChange(atOldPrice.metrics.leveredIRR, before.metrics.leveredIRR),
          },
        ]
      : []),
  ]
  const effectNote = estimated
    ? `The estimated price follows Year-1 NOI (÷ the ${fmt.pct(a.acquisition.marketCapRate.value, 2)} market cap rate), so loading the T-12 moved it from ${fmt.usd(before.metrics.purchasePrice)} to ${fmt.usd(r.metrics.purchasePrice)}. The last row holds the price where it was without the T-12.`
    : 'The purchase price is your input, so the T-12 changes returns only.'

  // ---- flags ----
  const flags: string[] = []
  const noiGap = ratio(noiDiff, t.netOperatingIncome)
  if (noiGap !== null && Math.abs(noiGap) > T12_NOI_GAP) {
    const big = [...rows].filter((x) => x.kind !== 'total' && x.noiEffect.value !== null).sort((x, z) => Math.abs(z.noiEffect.value!) - Math.abs(x.noiEffect.value!)).slice(0, 2)
    flags.push(
      `Underwritten Year-1 NOI is ${aboveBelow(noiGap)} the T-12 NOI (${money(y.netOperatingIncome)} vs ${money(t.netOperatingIncome)}); ` +
        `the largest differences are ${big.map((x) => `${x.label.toLowerCase()} (${x.noiEffect.display})`).join(' and ')}.`,
    )
  }
  if (taxCheck.status === 'ok' && taxCheck.differencePct.value !== null && Math.abs(taxCheck.differencePct.value) > T12_TAX_GAP) {
    flags.push(`T-12 property taxes are ${aboveBelow(taxCheck.differencePct.value)} the city tax roll’s annual taxes (${taxCheck.t12.display} vs ${taxCheck.taxRoll.display}).`)
  }
  const benchGap = size && bench.value ? t12OpexExMgmt / size / bench.value - 1 : null
  if (benchGap !== null && Math.abs(benchGap) > T12_BENCHMARK_GAP) {
    flags.push(`T-12 operating expenses (before the management fee) are ${aboveBelow(benchGap)} the benchmark ${perBasis(t12OpexExMgmt).display} vs ${perBasis(benchTotal).display}; the benchmark is an estimate.`)
  }
  const feePct = ratio(by['management-fee'], t12EGIForFee)
  if (feePct !== null && feePct - op.managementFeePct.value > 0.005) {
    flags.push(`The T-12 management fee is ${fmt.pct(feePct, 1)} of T-12 EGI; the model charges ${fmt.pctShort(op.managementFeePct.value)}. A buyer’s manager may cost more than the model assumes.`)
  }

  const years = growthYears(s.periodStart, a.acquisition.analysisStartDate)
  return {
    source: t12Source(s),
    fileName: s.fileName,
    period: periodLabel(s),
    isSample: s.isSample,
    growth: `${years.toFixed(2)} yrs from the T-12’s midpoint to Year 1’s, at ${fmt.pctShort(op.expenseGrowth.value)}/yr expense growth (other income at ${fmt.pctShort(a.leasing.marketRentGrowth.value)}/yr rent growth)`,
    rows,
    noi: {
      t12: usd(t.netOperatingIncome),
      underwritten: usd(y.netOperatingIncome),
      difference: signedUsd(noiDiff),
      differencePct: signedPct(noiGap),
    },
    reportedNOI,
    belowNOI: { t12: t.belowNOI.map((x) => ({ label: x.label, amount: usd(x.amount) })), underwritten: below },
    otherIncome: {
      t12Year1: usd(oi?.value ?? 0),
      rentRoll: usd(rrOther),
      note: isMF
        ? `Year 1 uses the T-12’s ${fmt.usd(oi?.value ?? 0)} (grown); the rent roll’s ${fmt.usd(rrOther)} is replaced.`
        : `Year 1 uses the T-12’s ${fmt.usd(oi?.value ?? 0)} (grown); without a T-12 the model has no other income for commercial.`,
    },
    managementFee: {
      t12: usd(by['management-fee']),
      t12PctOfEGI: pct(feePct),
      modelPct: pct(op.managementFeePct.value),
      underwritten: usd(y.managementFee),
    },
    tax: taxCheck,
    expenseRatio: {
      t12: pct(ratio(t.operatingExpenses, t.effectiveGrossIncome)),
      underwritten: pct(ratio(y.operatingExpenses, y.effectiveGrossIncome)),
      benchmark: pct(benchRatio),
      note: `Operating expenses incl. management ÷ EGI. Benchmark: ${bench.sourceName} × ${isMF ? 'units' : 'rentable SF'}, plus the model fee, over underwritten Year-1 EGI. The benchmark is an estimate (EST), not a market fact.`,
    },
    perBasis: {
      basis,
      t12: perBasis(t12OpexExMgmt),
      underwritten: perBasis(uwOpexExMgmt),
      benchmark: perBasis(benchTotal),
      benchmarkSource: bench.sourceName,
      note: `Before the management fee. Compared against an estimate: ${bench.sourceName} (${bench.source === 'estimated' ? 'EST' : bench.source}).`,
    },
    effect,
    effectNote,
    flags,
  }
}

function taxComparison(property: Property, t12Taxes: number, s: NonNullable<Property['t12']>, tax?: TaxLookup): TaxCheck {
  if (!property.location.placement) {
    return {
      status: 'unavailable',
      reason: property.importedFrom
        ? 'Place the deal on its parcel to compare with the city tax roll.'
        : 'Shown for imported deals placed on their parcel.',
    }
  }
  if (tax && 'reason' in tax) return { status: 'unavailable', reason: tax.reason }
  if (!tax || tax.loading) return { status: 'unavailable', reason: 'Looking up the city tax roll for this parcel…' }
  const taxes = tax.record?.annualTaxes
  if (!taxes) return { status: 'unavailable', reason: 'The city tax roll has no annual taxes for this parcel.' }
  const diff = t12Taxes - taxes.value
  return {
    status: 'ok',
    t12: usd(t12Taxes),
    taxRoll: usd(taxes.value),
    difference: signedUsd(diff),
    differencePct: signedPct(ratio(diff, taxes.value)),
    source: taxes.sourceName,
    note: `Tax roll: ${taxes.sourceName} (PUB), plat ${tax.record!.plat} lot ${tax.record!.lot}. The T-12 covers ${periodLabel(s)}, which can straddle tax years.`,
  }
}
