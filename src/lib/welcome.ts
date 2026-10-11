import type { ISODate, Property } from '../types'
import { filtersFromQuery, filtersToQuery } from './filters'
import { fmt } from './format'
import type { AssumptionEdits } from './underwriting/edits'
import { maxBid } from './underwriting/maxBid'
import { runUnderwriting } from './underwriting/summary'

/**
 * The welcome screen shows on a first visit only, and not when the link
 * already sets a view: valid filters or a non-default sort in the query.
 * (Links don't carry a selected property; only filters and sort are in the URL.)
 */
export function shouldShowWelcome(search: string, seen: boolean): boolean {
  if (seen) return false
  const { filters, sort } = filtersFromQuery(search)
  return filtersToQuery(filters, sort) === ''
}

/** The sample property on the welcome screen's selected tower. */
export const FEATURED_PROPERTY_ID = 'sample-westminster-tower'

export interface FeaturedStat {
  label: string
  value: string
  hint?: string
}

export type FeaturedDeal = { status: 'ok'; name: string; stats: FeaturedStat[] } | { status: 'unavailable'; name: string; reason: string }

/** "Westminster Office Tower (Sample)" → "Westminster Office Tower"; the card shows its own Sample tag. */
const displayName = (p: Property) => p.name.replace(/\s*\(Sample\)$/, '')

/**
 * Headline engine figures for the welcome screen's tower card: model price,
 * levered IRR, minimum DSCR and max bid, at the property's current assumptions.
 * Formats engine output only; no new math.
 */
export function featuredDeal(property: Property, asOf: ISODate, edits: AssumptionEdits = {}): FeaturedDeal {
  const name = displayName(property)
  const run = runUnderwriting(property, asOf, edits)
  if (run.status === 'unavailable') return { status: 'unavailable', name, reason: run.reason }
  const m = run.result.metrics
  const bid = maxBid(property, asOf, run.result.assumptions)
  return {
    status: 'ok',
    name,
    stats: [
      { label: 'Model price', value: fmt.money(m.purchasePrice) },
      { label: 'Levered IRR', value: m.leveredIRR === null ? '—' : fmt.pct(m.leveredIRR, 1) },
      { label: 'Min DSCR', value: m.minimumDSCR === null ? '—' : fmt.multiple(m.minimumDSCR) },
      {
        label: 'Max bid',
        value: bid.status === 'ok' ? fmt.money(bid.price) : '—',
        hint: bid.status === 'ok' ? `At ${fmt.pctShort(bid.target)} levered IRR` : bid.reason,
      },
    ],
  }
}
