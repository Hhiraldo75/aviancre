import type { Confidence, EstimateRange, ISODate, Sourced } from '../types'

/** Helpers that build Sourced values so data files stay short and consistent. */

export function fromPublic<T>(value: T, sourceName: string, asOf?: ISODate): Sourced<T> {
  return { value, source: 'public', sourceName, asOf, confidence: 'high' }
}

export function fromImport<T>(value: T, sourceName: string, asOf?: ISODate, notes?: string): Sourced<T> {
  return { value, source: 'imported', sourceName, asOf, confidence: 'high', ...(notes ? { notes } : {}) }
}

export function estimate<T>(
  value: T,
  sourceName: string,
  opts: { confidence?: Confidence; range?: EstimateRange; notes?: string; asOf?: ISODate } = {},
): Sourced<T> {
  return {
    value,
    source: 'estimated',
    sourceName,
    confidence: opts.confidence ?? 'low',
    range: opts.range,
    notes: opts.notes,
    asOf: opts.asOf,
  }
}

/** Builds a numeric estimate with a symmetric ± band, e.g. ±10%. */
export function estimateWithBand(
  value: number,
  sourceName: string,
  bandPct: number,
  confidence: Confidence = 'low',
): Sourced<number> {
  return estimate(value, sourceName, {
    confidence,
    range: { low: value * (1 - bandPct), high: value * (1 + bandPct) },
  })
}
