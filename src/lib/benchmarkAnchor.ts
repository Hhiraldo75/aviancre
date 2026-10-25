/**
 * Anchors a set of submarket figures to one metro figure while keeping the
 * differences between submarkets: cap rates move by a constant, rents and
 * vacancy by a ratio, so the simple average across submarkets hits the anchor
 * before rounding. Rounding can leave the rounded average a step off.
 */

/** Rounds to the nearest step, half up, ignoring float noise (0.07675 → 0.077 at 0.0005). */
export function roundTo(x: number, step: number): number {
  const n = Math.round(Number((x / step).toFixed(9)))
  return Number((n * step).toFixed(10))
}

const average = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length

/** Adds the same amount to every value so their average equals the anchor, then rounds. */
export function anchorByShift(values: number[], anchor: number, step: number): number[] {
  const shift = anchor - average(values)
  return values.map((x) => roundTo(x + shift, step))
}

/** Scales every value by the same ratio so their average equals the anchor, then rounds. */
export function anchorByRatio(values: number[], anchor: number, step: number): number[] {
  const ratio = anchor / average(values)
  return values.map((x) => roundTo(x * ratio, step))
}
