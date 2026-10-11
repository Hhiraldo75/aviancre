import { filtersFromQuery, filtersToQuery } from './filters'

/**
 * The welcome overlay shows on a first visit only, and not when the link
 * already sets a view: valid filters or a non-default sort in the query.
 * (Links don't carry a selected property; only filters and sort are in the URL.)
 */
export function shouldShowWelcome(search: string, seen: boolean): boolean {
  if (seen) return false
  const { filters, sort } = filtersFromQuery(search)
  return filtersToQuery(filters, sort) === ''
}
