import type { ISODate, Pct, Property, UnderwritingAssumptions, USD } from '../../types'
import { fmt } from '../format'
import { npv } from './finance'
import { underwrite } from './underwrite'
import { operatingCashFlows } from './waterfall'

/**
 * Max bid: the purchase price at which the levered IRR equals the target.
 * Every trial is a full engine run with only the price changed, so the loan
 * (LTV × price), closing costs and loan fee all scale with it. Operating cash
 * flows don't depend on the price, so they're computed once per solve.
 */

/** Search range, as multiples of the current price. */
export const MAX_BID_RANGE = [0.25, 4] as const
/** Bisection stops once the bracket is narrower than this. */
const PRICE_TOLERANCE = 1

export type MaxBid =
  | {
      status: 'ok'
      target: Pct
      price: USD
      pricePerSF: USD
      goingInCapRate: Pct
      /** Max bid ÷ current price − 1: −0.06 means 6% below the current price. */
      vsCurrentPct: Pct
      /** Levered IRR at the max bid; equals the target to solver precision. */
      leveredIRR: Pct | null
    }
  | { status: 'none'; target: Pct; reason: string }

const withPrice = (a: UnderwritingAssumptions, price: number): UnderwritingAssumptions => ({
  ...a,
  acquisition: { ...a.acquisition, purchasePrice: { ...a.acquisition.purchasePrice, value: price } },
})

const cache = new WeakMap<UnderwritingAssumptions, { property: Property; asOf: ISODate; bid: MaxBid }>()

/**
 * Bisects on the levered cash flows' NPV at the target rate: zero exactly
 * where IRR = target, defined at every price (the IRR isn't above 100%), and
 * falling as price rises because operations don't depend on price.
 */
export function maxBid(property: Property, asOf: ISODate, a: UnderwritingAssumptions): MaxBid {
  const hit = cache.get(a)
  if (hit && hit.property === property && hit.asOf === asOf) return hit.bid
  const bid = solve(property, asOf, a)
  cache.set(a, { property, asOf, bid })
  return bid
}

function solve(property: Property, asOf: ISODate, a: UnderwritingAssumptions): MaxBid {
  const target = a.targetLeveredIRR.value
  const targetText = fmt.pct(target, 1)
  if (!a.debt.enabled || !(a.debt.ltv.value > 0)) {
    return { status: 'none', target, reason: 'Debt is off, so there is no levered IRR to solve for.' }
  }
  const current = a.acquisition.purchasePrice.value
  const operating = operatingCashFlows(property, a, asOf)
  const run = (price: number) => underwrite(property, asOf, withPrice(a, price), operating)
  const excess = (price: number) => {
    const r = run(price)
    return npv(target, [-r.metrics.equityRequired, ...r.cashFlows.map((c) => c.leveredCashFlow)])
  }

  let lo = current * MAX_BID_RANGE[0]
  let hi = current * MAX_BID_RANGE[1]
  if (excess(lo) < 0) {
    return {
      status: 'none',
      target,
      reason: `The levered IRR is below ${targetText} even at ${fmt.money(lo)}, ${MAX_BID_RANGE[0] * 100}% of the current price.`,
    }
  }
  if (excess(hi) > 0) {
    return {
      status: 'none',
      target,
      reason: `The levered IRR is still above ${targetText} at ${fmt.money(hi)}, ${MAX_BID_RANGE[1]}× the current price.`,
    }
  }
  while (hi - lo > PRICE_TOLERANCE) {
    const mid = (lo + hi) / 2
    if (excess(mid) > 0) lo = mid
    else hi = mid
  }

  const price = (lo + hi) / 2
  const m = run(price).metrics
  return {
    status: 'ok',
    target,
    price,
    pricePerSF: m.pricePerSF,
    goingInCapRate: m.goingInCapRate,
    vsCurrentPct: price / current - 1,
    leveredIRR: m.leveredIRR,
  }
}
