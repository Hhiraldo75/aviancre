import type { BenchmarkType, BuildingClass, Confidence, ISODate, MarketTrendPoint, Pct, Sourced, Submarket, SubmarketBenchmark, SubmarketId } from '../types'
import { anchorByRatio, anchorByShift } from '../lib/benchmarkAnchor'
import { estimate } from '../lib/sourced'

/**
 * Market benchmarks for Providence submarkets, anchored to published metro
 * figures. No source breaks Providence into these submarkets, so each asset
 * type's submarket rows keep their earlier (illustrative) differences and are
 * anchored to the metro figure: cap rates shifted by a constant, rents and
 * vacancy scaled by a ratio, so the simple average across submarkets matches
 * the anchor (before rounding to 0.05% / $0.25/SF or $5/unit / 0.1%).
 * Retail and industrial rents are kept as they were (see KeptRent).
 * Everything stays an estimate (EST); operating expenses are still placeholders.
 *
 * NAR/CoStar: https://www.rirealtors.org/clientuploads/commercial_real_estate/Dashboard_1.pdf
 */
const NAR = 'NAR Commercial Real Estate Report Q1 2026, Providence-Warwick metro (CoStar data)'
const NAR_AS_OF: ISODate = '2026-03-31'
const CW_OFFICE = 'Cushman & Wakefield Providence Office MarketBeat Q3 2026'
const CW_OFFICE_AS_OF: ISODate = '2026-09-30'
const CW_INDUSTRIAL = 'Cushman & Wakefield Providence Industrial MarketBeat Q4 2025'
const CW_INDUSTRIAL_AS_OF: ISODate = '2025-12-31'

const ANCHORED = 'Submarket rows anchored to this metro figure, keeping the earlier submarket differences'
const CAP_METHOD = `${ANCHORED}: shifted by a constant so the simple average across submarkets is the metro figure; rounded to 0.05%.`
const RATIO_METHOD = (rounding: string) =>
  `${ANCHORED}: scaled by a ratio so the simple average across submarkets is the metro figure; rounded to ${rounding}.`

const PLACEHOLDER = 'Placeholder benchmark – replace with quarterly market report'
const LONG_RUN_GROWTH = 'Long-run underwriting default – not a market forecast'

/** Class B is the baseline; A trades at a premium, C at a discount. */
const CLASS_ADJUSTMENT: Record<BenchmarkType, Record<BuildingClass, number>> = {
  office: { A: 1.25, B: 1, C: 0.8 },
  retail: { A: 1.2, B: 1, C: 0.85 },
  industrial: { A: 1.15, B: 1, C: 0.82 },
  multifamily: { A: 1.2, B: 1, C: 0.85 },
}

/** Earlier per-submarket figures [rent, vacancy, cap rate]: only their differences survive anchoring. */
type Spread = [rent: number, vacancy: Pct, capRate: Pct]

const SPREADS: Record<BenchmarkType, Partial<Record<SubmarketId, Spread>>> = {
  office: {
    downtown: [22, 0.2, 0.0875],
    'capital-center': [26, 0.15, 0.08],
    'jewelry-district': [30, 0.12, 0.075],
  },
  retail: {
    downtown: [20, 0.11, 0.0775],
    'capital-center': [24, 0.09, 0.0725],
    'jewelry-district': [22, 0.1, 0.075],
    'federal-hill': [22, 0.07, 0.07],
    'fox-point': [26, 0.08, 0.07],
    'college-hill': [32, 0.06, 0.0675],
    olneyville: [16, 0.1, 0.08],
    valley: [18, 0.09, 0.0775],
  },
  industrial: {
    olneyville: [9.5, 0.04, 0.07],
    valley: [10, 0.045, 0.07],
    'port-allens-ave': [9, 0.05, 0.0725],
  },
  multifamily: {
    downtown: [2100, 0.055, 0.0575],
    'capital-center': [2400, 0.05, 0.055],
    'jewelry-district': [2300, 0.05, 0.055],
    'federal-hill': [1700, 0.04, 0.06],
    'fox-point': [1900, 0.04, 0.0575],
    'college-hill': [2200, 0.03, 0.055],
    olneyville: [1500, 0.05, 0.0625],
    valley: [1650, 0.05, 0.06],
  },
}

interface Anchor {
  value: number
  sourceName: string
  asOf: ISODate
  notes?: string
}

/** Submarket rents kept as they were rather than anchored, and how they are labeled. */
interface KeptRent {
  sourceName: string
  confidence: Confidence
  asOf?: ISODate
  notes: string
  /** A cited range for every submarket; else the relative band around each rent. */
  range?: { low: number; high: number }
}

interface TypeAnchors {
  capRate: Anchor
  rent: Anchor | KeptRent
  rentStep: number
  /** Relative band around each submarket rent, when no range is cited. */
  rentBand: number
  vacancy: Anchor
  longRunGrowth: Pct
  trailingGrowth: Pct
  opex: { value: number; notes: string }
}

const ANCHORS: Record<BenchmarkType, TypeAnchors> = {
  office: {
    capRate: { value: 0.101, sourceName: NAR, asOf: NAR_AS_OF },
    rent: {
      value: 25,
      sourceName: NAR,
      asOf: NAR_AS_OF,
      notes: `Gross asking rent. ${CW_OFFICE} reports $22.85/SF.`,
    },
    rentStep: 0.25,
    rentBand: 0.12,
    vacancy: {
      value: 0.133,
      sourceName: CW_OFFICE,
      asOf: CW_OFFICE_AS_OF,
      notes: `Multi-tenant office. CoStar (${NAR}) reports 6.9% across all office inventory.`,
    },
    longRunGrowth: 0.015,
    trailingGrowth: 0.029,
    opex: { value: 10.5, notes: 'Per SF, full-service office' },
  },
  retail: {
    capRate: { value: 0.078, sourceName: NAR, asOf: NAR_AS_OF },
    rent: {
      sourceName: 'Placeholder submarket rent, urban street retail – replace with a street-retail rent survey',
      confidence: 'low',
      notes:
        `Not anchored: the ${NAR} metro average of $20/SF (as of ${NAR_AS_OF}) includes suburban strip retail, ` +
        'and city street retail (Atwells, Thayer, Downtown) rents above it, so the metro figure is market context only.',
    },
    rentStep: 0.25,
    rentBand: 0.15,
    vacancy: { value: 0.036, sourceName: NAR, asOf: NAR_AS_OF },
    longRunGrowth: 0.02,
    trailingGrowth: 0.001,
    opex: { value: 7, notes: 'Per SF, NNN pass-throughs' },
  },
  industrial: {
    capRate: { value: 0.078, sourceName: NAR, asOf: NAR_AS_OF },
    rent: {
      sourceName: `${CW_INDUSTRIAL} ($7.50–8.50/SF NNN asking) to ${NAR} ($11/SF)`,
      confidence: 'medium',
      asOf: NAR_AS_OF,
      notes: `Submarket rents kept as they were; the sources bracket them from $7.50 (C&W net asking, as of ${CW_INDUSTRIAL_AS_OF}) to $11 (CoStar, as of ${NAR_AS_OF}).`,
      range: { low: 7.5, high: 11 },
    },
    rentStep: 0.25,
    rentBand: 0.1,
    vacancy: { value: 0.048, sourceName: NAR, asOf: NAR_AS_OF },
    longRunGrowth: 0.035,
    trailingGrowth: 0.052,
    opex: { value: 3.25, notes: 'Per SF, NNN pass-throughs' },
  },
  multifamily: {
    capRate: { value: 0.075, sourceName: NAR, asOf: NAR_AS_OF },
    rent: { value: 2058, sourceName: NAR, asOf: NAR_AS_OF, notes: 'Per unit per month.' },
    rentStep: 5,
    rentBand: 0.1,
    vacancy: { value: 0.045, sourceName: NAR, asOf: NAR_AS_OF },
    longRunGrowth: 0.03,
    trailingGrowth: 0.027,
    opex: { value: 6800, notes: 'Per unit per year' },
  },
}

const isAnchor = (r: Anchor | KeptRent): r is Anchor => 'value' in r

const metroPct = (x: number) => `${Number((x * 100).toFixed(2))}%`

const anchored = (a: Anchor, figure: string, value: number, method: string, range?: { low: number; high: number }): Sourced<number> =>
  estimate(value, `${a.sourceName}: metro ${figure}`, {
    confidence: 'medium',
    asOf: a.asOf,
    notes: [a.notes, method].filter(Boolean).join(' '),
    range,
  })

/** Every submarket's benchmark for one asset type, anchored to the metro figures. */
function benchmarksFor(type: BenchmarkType): Partial<Record<SubmarketId, SubmarketBenchmark>> {
  const a = ANCHORS[type]
  const rows = Object.entries(SPREADS[type]) as [SubmarketId, Spread][]
  const rents = rows.map(([, s]) => s[0])
  const rentAnchor = isAnchor(a.rent) ? a.rent : null
  const anchoredRents = rentAnchor ? anchorByRatio(rents, rentAnchor.value, a.rentStep) : rents
  const vacancies = anchorByRatio(rows.map(([, s]) => s[1]), a.vacancy.value, 0.001)
  const caps = anchorByShift(rows.map(([, s]) => s[2]), a.capRate.value, 0.0005)
  const isMF = type === 'multifamily'
  const rentRounding = isMF ? '$5/unit' : '$0.25/SF'
  const rentFigure = rentAnchor && (isMF ? `$${rentAnchor.value.toLocaleString('en-US')}/unit/mo` : `$${rentAnchor.value}/SF`)

  return Object.fromEntries(
    rows.map(([id], i) => {
      const rent = anchoredRents[i]
      const band = { low: rent * (1 - a.rentBand), high: rent * (1 + a.rentBand) }
      const kept = isAnchor(a.rent) ? null : a.rent
      const benchmark: SubmarketBenchmark = {
        rentBasis: isMF ? 'monthly-per-unit' : 'annual-per-sf',
        marketRent: rentAnchor
          ? anchored(rentAnchor, rentFigure!, rent, RATIO_METHOD(rentRounding), band)
          : estimate(rent, kept!.sourceName, { confidence: kept!.confidence, asOf: kept!.asOf, notes: kept!.notes, range: kept!.range ?? band }),
        classAdjustment: CLASS_ADJUSTMENT[type],
        vacancyRate: anchored(a.vacancy, metroPct(a.vacancy.value), vacancies[i], RATIO_METHOD('0.1%')),
        annualRentGrowth: estimate(a.longRunGrowth, LONG_RUN_GROWTH, {
          notes: `12-month trailing metro rent growth was ${metroPct(a.trailingGrowth)} (${NAR}).`,
        }),
        trailingRentGrowth: estimate(a.trailingGrowth, `${NAR}; 12-month trailing`, { confidence: 'medium', asOf: NAR_AS_OF }),
        marketCapRate: anchored(a.capRate, metroPct(a.capRate.value), caps[i], CAP_METHOD),
        opexPerYear: estimate(a.opex.value, PLACEHOLDER, { notes: a.opex.notes }),
      }
      return [id, benchmark]
    }),
  )
}

const BENCHMARKS = Object.fromEntries(
  (Object.keys(SPREADS) as BenchmarkType[]).map((type) => [type, benchmarksFor(type)]),
) as Record<BenchmarkType, Partial<Record<SubmarketId, SubmarketBenchmark>>>

/** The benchmarks a submarket has, by asset type. */
function benchmarksIn(id: SubmarketId): Submarket['benchmarks'] {
  return Object.fromEntries(
    (Object.keys(BENCHMARKS) as BenchmarkType[]).flatMap((type) => {
      const b = BENCHMARKS[type][id]
      return b ? [[type, b]] : []
    }),
  )
}

const submarket = (id: SubmarketId, name: string, center: Submarket['center']): Submarket => ({ id, name, center, benchmarks: benchmarksIn(id) })

export const SUBMARKETS: Record<SubmarketId, Submarket> = {
  downtown: submarket('downtown', 'Downtown / Downcity', [-71.4125, 41.8240]),
  'capital-center': submarket('capital-center', 'Capital Center', [-71.4135, 41.8290]),
  'jewelry-district': submarket('jewelry-district', 'Jewelry District / Innovation District', [-71.4085, 41.8185]),
  'federal-hill': submarket('federal-hill', 'Federal Hill', [-71.4270, 41.8230]),
  'fox-point': submarket('fox-point', 'Fox Point / Wickenden', [-71.3990, 41.8195]),
  'college-hill': submarket('college-hill', 'College Hill / Thayer St', [-71.4005, 41.8290]),
  olneyville: submarket('olneyville', 'Olneyville', [-71.4430, 41.8190]),
  valley: submarket('valley', 'Valley / Eagle Square', [-71.4290, 41.8300]),
  'port-allens-ave': submarket('port-allens-ave', 'Port of Providence / Allens Ave', [-71.4040, 41.8020]),
}

// ---------- metro trend history ----------

/**
 * Providence-Warwick metro history (CoStar, all inventory), oldest first, from
 * the NAR report's year-over-year view: Q1 2025 and Q1 2026. Rents are asking
 * rents on the benchmark's basis (multifamily per unit per month).
 */
export const METRO_TRENDS: Record<BenchmarkType, MarketTrendPoint[]> = {
  office: [
    { period: 'Q1 2025', marketRent: 24, vacancyRate: 0.059, capRate: 0.105 },
    { period: 'Q1 2026', marketRent: 25, vacancyRate: 0.069, capRate: 0.101 },
  ],
  retail: [
    { period: 'Q1 2025', marketRent: 20, vacancyRate: 0.03, capRate: 0.077 },
    { period: 'Q1 2026', marketRent: 20, vacancyRate: 0.036, capRate: 0.078 },
  ],
  industrial: [
    { period: 'Q1 2025', marketRent: 11, vacancyRate: 0.05, capRate: 0.083 },
    { period: 'Q1 2026', marketRent: 11, vacancyRate: 0.048, capRate: 0.078 },
  ],
  multifamily: [
    { period: 'Q1 2025', marketRent: 2004, vacancyRate: 0.033, capRate: 0.074 },
    { period: 'Q1 2026', marketRent: 2058, vacancyRate: 0.045, capRate: 0.075 },
  ],
}

export const TREND_SOURCE = `${NAR}, as of ${NAR_AS_OF}.`
