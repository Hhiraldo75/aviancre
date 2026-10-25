import type { ExpressionSpecification, FilterSpecification } from 'maplibre-gl'

const ORDERED = new Set(['<', '<=', '>', '>='])
/** Far outside any tile property, so a missing value fails the comparison instead of throwing. */
const FAR = 1e9

/**
 * Basemap filters like ["<=", ["get", "ref_length"], 6] warn "Expected value to be of
 * type number, but found null" on every road without that property. Reading the
 * property with `number` and a fallback past the comparison makes a missing value fail
 * the test, as null would have. Null when the filter has no such comparison.
 */
export function nullSafeFilter(filter: FilterSpecification | undefined): FilterSpecification | null {
  if (!Array.isArray(filter)) return null
  let changed = false
  const walk = (e: unknown): unknown => {
    if (!Array.isArray(e)) return e
    const [op, ...args] = e
    if (typeof op === 'string' && ORDERED.has(op) && args.length === 2) {
      const fallback = op.startsWith('<') ? FAR : -FAR
      const safe = args.map((a, i) => {
        const isGet = Array.isArray(a) && a[0] === 'get' && a.length === 2
        // The fallback must lose against the other side, so it depends on which side the property is on.
        return isGet ? ['number', a, i === 0 ? fallback : -fallback] : a
      })
      if (safe.some((a, i) => a !== args[i])) changed = true
      return [op, ...safe]
    }
    return e.map(walk)
  }
  const next = walk(filter) as ExpressionSpecification
  return changed ? next : null
}
