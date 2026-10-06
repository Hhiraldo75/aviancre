/**
 * Shared primitives used across the AVIANCRE data model.
 *
 * Unit aliases are plain numbers at runtime, but naming them makes every
 * field self-documenting (is this a percent or a decimal? annual or monthly?).
 */

/** US dollars. */
export type USD = number
/** Square feet. */
export type SF = number
/** A rate expressed as a decimal: 0.065 = 6.5%. Never 6.5. */
export type Pct = number
/** Basis points: 250 = 2.50%. */
export type Bps = number
/** ISO 8601 calendar date, e.g. "2026-10-04". */
export type ISODate = string

export type AssetType = 'office' | 'retail' | 'industrial' | 'multifamily' | 'mixed-use'
export type BuildingClass = 'A' | 'B' | 'C'

/**
 * Where a value came from.
 * - public:    government / open dataset (assessor, zoning, FEMA, Census, FRED)
 * - imported:  uploaded by the user (rent roll, OpEx statement) – treated as actuals
 * - estimated: produced by the rent model or a placeholder default
 */
export type DataSource = 'public' | 'imported' | 'estimated'

export type Confidence = 'high' | 'medium' | 'low'

/** Low/high band around an estimate, in the same units as the value. */
export interface EstimateRange {
  low: number
  high: number
}

/**
 * A value tagged with its provenance. Every number an analyst might question
 * is wrapped in this so the UI can show a source badge and the map can be
 * colored by data confidence.
 */
export interface Sourced<T> {
  value: T
  source: DataSource
  /** Human-readable source, e.g. "Providence Assessor FY2026" or "AVIANCRE rent model v1". */
  sourceName: string
  /** Date the value was observed or published. */
  asOf?: ISODate
  confidence?: Confidence
  /** Only meaningful for numeric estimates. */
  range?: EstimateRange
  notes?: string
}

/** [longitude, latitude] – the order MapLibre/GeoJSON expect. */
export type LngLat = [number, number]
