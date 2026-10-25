import type {
  AnnualCashFlow,
  ISODate,
  Property,
  UnderwritingAssumptions,
  UnderwritingMetrics,
  UnderwritingResult,
} from '../../types'
import { averageInPlaceRent, walt } from '../metrics'
import { periodLabel } from '../t12'
import type { AboveMarketOption } from './commercial'
import { defaultAssumptions, t12PriceNote } from './defaults'
import { irr, loanSchedule, npv, payment } from './finance'
import { normalizeForExit, operatingCashFlows, type OperatingResult, type OperatingYear } from './waterfall'

export const DSCR_FLOOR = 1.25
export const ROLLOVER_CONCENTRATION = 0.25
export const LOW_OCCUPANCY = 0.8
export const MARK_TO_MARKET_THRESHOLD = 0.1
/** Minimum year-1 debt yield most lenders look for; reported, not warned on. */
export const DEBT_YIELD_FLOOR = 0.09

/** Net sale proceeds: exit-year NOI ÷ exit cap, less selling costs. */
export function saleProceeds(exitNOI: number, exitCapRate: number, sellingCostsPct: number) {
  const gross = exitNOI / exitCapRate
  return { gross, net: gross * (1 - sellingCostsPct) }
}

/**
 * Full 10-year underwriting: operating cash flows, purchase, loan, sale,
 * returns and plain-language warnings. Operating cash flows don't depend on
 * the price, so a caller varying only the price can pass them in once.
 */
export function underwrite(
  property: Property,
  asOf: ISODate,
  assumptions: UnderwritingAssumptions = defaultAssumptions(property, asOf),
  operating: OperatingResult = operatingCashFlows(property, assumptions, asOf),
): UnderwritingResult {
  const a = assumptions
  const H = a.acquisition.holdYears.value
  const { years, expiringSFByYear, inPlaceExpiringSFByYear, aboveMarketOptions } = operating
  const hold = years.slice(0, H)
  const forward = years[H]

  // ---- acquisition ----
  const price = a.acquisition.purchasePrice.value
  const closingCosts = price * a.acquisition.closingCostsPct.value
  const totalCost = price + closingCosts + a.acquisition.initialCapex.value

  // ---- debt ----
  if (a.debt.rate.type !== 'fixed') throw new Error('Floating-rate debt is not supported yet')
  const rate = a.debt.rate.rate.value
  const loanAmount = a.debt.enabled ? a.debt.ltv.value * price : 0
  const loanFee = loanAmount * a.debt.loanFeesPct.value
  const amortMonths = a.debt.amortizationYears.value * 12
  const schedule = loanSchedule(loanAmount, rate, amortMonths, a.debt.interestOnlyYears.value * 12, H * 12)
  const debtService = hold.map((_, i) => schedule.slice(i * 12, i * 12 + 12).reduce((s, r) => s + r.payment, 0))
  const loanPayoff = loanAmount ? schedule[H * 12 - 1].endingBalance : 0
  const equity = totalCost - loanAmount + loanFee

  // ---- sale ----
  const exitYear = a.exit.capForwardNOI ? forward : hold[H - 1]
  const normalizedExit = normalizeForExit(exitYear, a.operating)
  const sale = saleProceeds(normalizedExit.netOperatingIncome, a.exit.exitCapRate.value, a.exit.sellingCostsPct.value)

  const cashFlows: AnnualCashFlow[] = hold.map((y, i) => {
    const isExit = i === H - 1
    const proceeds = isExit ? sale.net : 0
    const payoff = isExit ? loanPayoff : 0
    const afterDebt = y.cashFlowBeforeDebt - debtService[i]
    return annual(y, {
      debtService: debtService[i],
      cashFlowAfterDebt: afterDebt,
      saleProceeds: proceeds,
      loanPayoff: payoff,
      unleveredCashFlow: y.cashFlowBeforeDebt + proceeds,
      leveredCashFlow: afterDebt + proceeds - payoff,
    })
  })
  const noDebt = (y: OperatingYear) =>
    annual(y, {
      debtService: 0,
      cashFlowAfterDebt: y.cashFlowBeforeDebt,
      saleProceeds: 0,
      loanPayoff: 0,
      unleveredCashFlow: 0,
      leveredCashFlow: 0,
    })
  const forwardYear = noDebt(forward)
  const normalizedExitYear = noDebt(normalizedExit)

  // ---- returns ----
  const unlevered = [-totalCost, ...cashFlows.map((c) => c.unleveredCashFlow)]
  const levered = [-equity, ...cashFlows.map((c) => c.leveredCashFlow)]
  const sumFrom1 = (xs: number[]) => xs.slice(1).reduce((s, x) => s + x, 0)
  const hasDebt = loanAmount > 0
  const noi1 = hold[0].netOperatingIncome
  const dscrByYear = hasDebt ? cashFlows.map((c) => c.netOperatingIncome / c.debtService) : []
  const cashOnCashByYear = cashFlows.map((c) => c.cashFlowAfterDebt / equity)

  const loanConstant = hasDebt ? payment(1, rate / 12, amortMonths) * 12 : null
  const inPlaceRent = averageInPlaceRent(property, asOf)
  const marketRent = a.leasing.marketRent.value

  const metrics: UnderwritingMetrics = {
    purchasePrice: price,
    totalCost,
    closingCosts,
    loanFee,
    goingInCapRate: noi1 / price,
    exitNOIRaw: exitYear.netOperatingIncome,
    exitNOI: normalizedExit.netOperatingIncome,
    exitValue: sale.gross,
    sellingCosts: sale.gross - sale.net,
    netSaleProceeds: sale.net,
    pricePerSF: price / property.physical.rentableSF.value,
    unleveredIRR: irr(unlevered),
    leveredIRR: hasDebt ? irr(levered) : null,
    equityMultiple: sumFrom1(levered) / equity,
    unleveredEquityMultiple: sumFrom1(unlevered) / totalCost,
    cashOnCashByYear,
    averageCashOnCash: cashOnCashByYear.reduce((s, x) => s + x, 0) / cashOnCashByYear.length,
    dscrByYear,
    minimumDSCR: hasDebt ? Math.min(...dscrByYear) : null,
    debtYield: hasDebt ? noi1 / loanAmount : null,
    loanConstant,
    loanAmount,
    loanPayoff,
    equityRequired: equity,
    npv: npv(a.discountRate.value, unlevered),
    walt: walt(property, asOf, a.acquisition.analysisStartDate),
    inPlaceRent,
    marketRent,
    inPlaceVsMarket: inPlaceRent !== null && marketRent ? inPlaceRent / marketRent - 1 : null,
  }

  const warnings = buildWarnings(property, metrics, cashFlows, expiringSFByYear, aboveMarketOptions)

  return {
    propertyId: property.id,
    assumptions: a,
    cashFlows,
    forwardYear,
    normalizedExitYear,
    metrics,
    generatedAt: new Date().toISOString(),
    warnings,
    notes: buildNotes(property, asOf, a),
    expirations: { inPlaceSF: inPlaceExpiringSFByYear.slice(0, H), totalSF: expiringSFByYear.slice(0, H) },
  }
}

function annual(
  y: OperatingYear,
  debt: Pick<
    AnnualCashFlow,
    'debtService' | 'cashFlowAfterDebt' | 'saleProceeds' | 'loanPayoff' | 'unleveredCashFlow' | 'leveredCashFlow'
  >,
): AnnualCashFlow {
  return {
    year: y.year,
    occupancy: y.occupancy,
    grossPotentialRent: y.grossPotentialRent,
    lossToLease: y.lossToLease,
    absorptionTurnoverVacancy: y.absorptionTurnoverVacancy,
    freeRent: y.freeRent,
    expenseRecoveries: y.expenseRecoveries,
    otherIncome: y.otherIncome,
    generalVacancy: y.generalVacancy,
    creditLoss: y.creditLoss,
    effectiveGrossIncome: y.effectiveGrossIncome,
    managementFee: y.managementFee,
    operatingExpenses: y.operatingExpenses,
    netOperatingIncome: y.netOperatingIncome,
    tenantImprovements: y.tenantImprovements,
    leasingCommissions: y.leasingCommissions,
    capitalReserves: y.capitalReserves,
    cashFlowBeforeDebt: y.cashFlowBeforeDebt,
    ...debt,
  }
}

const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`

function buildWarnings(
  property: Property,
  m: UnderwritingMetrics,
  cashFlows: AnnualCashFlow[],
  expiringSFByYear: number[],
  aboveMarketOptions: AboveMarketOption[],
): string[] {
  const out: string[] = []

  if (m.minimumDSCR !== null && m.minimumDSCR < DSCR_FLOOR) {
    const low = m.dscrByYear.flatMap((d, i) => (d < DSCR_FLOOR ? [i + 1] : []))
    const worst = m.dscrByYear.indexOf(m.minimumDSCR) + 1
    out.push(
      `DSCR is below ${DSCR_FLOOR.toFixed(2)}x in year${low.length > 1 ? 's' : ''} ${low.join(', ')} ` +
        `(low of ${m.minimumDSCR.toFixed(2)}x in year ${worst}). Most lenders size loans to at least ${DSCR_FLOOR.toFixed(2)}x.`,
    )
  }

  const rsf = property.physical.rentableSF.value
  if (property.rentRoll.kind === 'commercial' && rsf) {
    expiringSFByYear.slice(0, cashFlows.length).forEach((sf, i) => {
      if (sf / rsf > ROLLOVER_CONCENTRATION) {
        out.push(`${pct(sf / rsf, 0)} of rentable SF rolls in year ${i + 1}. That year's cash flow depends on renewals.`)
      }
    })
  }

  if (m.loanConstant !== null && m.goingInCapRate < m.loanConstant) {
    out.push(
      `Negative leverage: the ${pct(m.goingInCapRate, 2)} going-in cap rate is below the ${pct(m.loanConstant, 2)} ` +
        'loan constant, so debt lowers the yearly cash yield. ' +
        'The levered IRR can still be higher because the sale gain goes to a smaller equity check.',
    )
  }

  if (m.inPlaceVsMarket !== null && Math.abs(m.inPlaceVsMarket) > MARK_TO_MARKET_THRESHOLD) {
    const above = m.inPlaceVsMarket > 0
    const turn = property.rentRoll.kind === 'multifamily' ? 'units turn' : 'leases roll'
    out.push(
      `In-place rents are ${pct(Math.abs(m.inPlaceVsMarket), 0)} ${above ? 'above' : 'below'} market; ` +
        `income ${above ? 'declines' : 'rises'} as ${turn}.`,
    )
  }

  const perSF = (x: number) => `$${x.toFixed(2)}/SF`
  for (const o of aboveMarketOptions) {
    out.push(
      `${o.tenant} (suite ${o.suite}) has a ${perSF(o.optionRentPerSF)} renewal option, above the projected ` +
        `${perSF(o.marketRentPerSF)} market rent at its ${o.expirationDate} expiration. ` +
        'The model assumes renewal at market.',
    )
  }

  if (m.loanAmount > 0 && m.leveredIRR === null) {
    out.push('Levered IRR could not be computed (levered cash flows never change sign).')
  }

  const occ1 = cashFlows[0]?.occupancy ?? 1
  if (occ1 < LOW_OCCUPANCY) {
    out.push(`Year-1 occupancy averages ${pct(occ1)}, below ${pct(LOW_OCCUPANCY, 0)}. Lease-up drives returns.`)
  }

  return out
}

function buildNotes(property: Property, asOf: ISODate, a: UnderwritingAssumptions): string[] {
  const out: string[] = []
  if (a.acquisition.purchasePrice.source === 'estimated') {
    out.push(
      'Purchase price is a model estimate at default assumptions (default year-1 NOI ÷ market cap rate), ' +
        'not an asking price or offer. At defaults the going-in cap equals the market cap by construction; ' +
        'other assumption edits move the going-in cap and returns, not the price.',
    )
  }
  if (property.t12) {
    out.push(
      `Year-1 operating expenses and other income are T-12 actuals (${periodLabel(property.t12)}) grown to Year 1; ` +
        'revenue still comes from the rent roll and the management fee stays the model’s % of EGI.',
    )
    if (a.acquisition.purchasePrice.source === 'estimated') out.push(`${t12PriceNote(property, a.acquisition.purchasePrice.value, asOf)}.`)
  }
  return out
}
